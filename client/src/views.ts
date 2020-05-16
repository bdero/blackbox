import {UserLoginInfo, playerState} from "./global"
import {MessageBuilder} from "./shared/src/messages"
import {Vector2} from "./shared/src/math"
import {stateController, View} from "./state_controller"
import {dispatcher} from "./client_dispatcher"

export function login(loginInfo: UserLoginInfo, register: boolean) {
    if (playerState.socket !== null) {
        playerState.socket.close(undefined, "Reconnecting")
    }
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws"
    playerState.socket = new WebSocket(`${wsProtocol}://${window.location.hostname}:8888`)
    playerState.socket.binaryType = "arraybuffer"
    playerState.socket.onopen = (event) => {
        playerState.socket.send(
            MessageBuilder
                .create()
                .setLoginPayload(register, loginInfo.username, loginInfo.key)
                .build())
    }
    playerState.socket.onclose = (event) => {
        loginInfo = null
        console.log(`Socket connection closed with code "${event.code}"; reason: ${event.reason}`)
    }
    playerState.socket.onmessage = (event) => {
        dispatcher.dispatch(null, new Uint8Array(event.data))
    }
}

export function joinGame(createGame = false, inviteCode?: string) {
    if (createGame) {
        console.log(`Joining new game`)
    } else {
        console.log(`Joining game: ${inviteCode}`)
    }

    stateController.setState({gameState: null})

    playerState.socket.send(
        MessageBuilder.create()
            .setJoinGamePayload(createGame, inviteCode)
            .build())
}

export function listGames() {
    console.log("Requesting current games list")

    stateController.setView(View.GameList, true)
    playerState.socket.send(MessageBuilder.create().setListGamesPayload().build())
}

export function submitAtoms(inviteCode: string, atoms: Vector2[]) {
    console.log("Submitting atoms")

    playerState.socket.send(MessageBuilder.create().setSetAtomsPayload(inviteCode, atoms).build())
}

export function submitSolution(inviteCode: string, atoms: Vector2[]) {
    console.log("Submitting solution")

    playerState.socket.send(MessageBuilder.create().setSubmitSolutionPayload(inviteCode, atoms).build())
}

export function submitMove(inviteCode: string, move: Vector2) {
    console.log("Submitting move")

    playerState.socket.send(MessageBuilder.create().setSubmitMovePayload(inviteCode, move).build())
}
