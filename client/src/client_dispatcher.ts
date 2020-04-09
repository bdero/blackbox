// Using a symlink to the shared directory in order to work around a parceljs bug:
// https://github.com/parcel-bundler/parcel/issues/2978
import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder, MessageDispatcher, GameMetadata} from "./shared/src/messages"
import {UserLoginInfo, LocalStorageState} from "./localstorage"
import {stateController, View} from "./dom"

function parseQueryParameters(): {[key: string]: string} {
    const urlParameters = {}
    location.search
        .substr(1)
        .split("&")
        .forEach((item) => {
            const [key, value] = item.split("=")
            urlParameters[key] = value
        })
    return urlParameters
}

let socket: WebSocket | null = null

const dispatcher = new MessageDispatcher();
dispatcher.register(
    Buffers.AnyPayload.LoginAckPayload,
    Buffers.LoginAckPayload,
    (state, payload: Buffers.LoginAckPayload) => {
        if (!payload.success()) {
            const failReason = payload.errorMessage()
            console.error(`Login failed; reason: ${failReason}`)
            socket.close(undefined, "Login rejected")

            stateController.setView(View.Register)
            stateController.setState({loggingIn: false})
            return
        }
        const key = payload.key()
        const username = payload.username()
        LocalStorageState.setUserLogin(key, username)
        console.log(`Login successful: key="${key}"; username="${username}"`)

        // TODO(bdero): If invite code set, attempt to join game session
        const queryParams = parseQueryParameters()
        if ("invite" in queryParams) {
            const inviteCode = queryParams["invite"]
            console.log(`Invite code set (invite="${inviteCode}); attempting to join session`)

            joinGame(false, inviteCode)
            return
        }

        listGames()
    }
)
dispatcher.register(
    Buffers.AnyPayload.ListGamesAckPayload,
    Buffers.ListGamesAckPayload,
    (state, payload: Buffers.ListGamesAckPayload) => {
        if (!payload.success()) {
            const failReason = payload.errorMessage()
            console.error(`Failed to list games; reason: ${failReason}`)
            return
        }

        const gameMetadatas: GameMetadata[] = []
        for (let i = 0; i < payload.metadatasLength(); i++) {
            const m = payload.metadatas(i)
            gameMetadatas.push(GameMetadata.fromBuffer(m))
        }

        console.log(`Received ${gameMetadatas.length} game(s) from server`)
        stateController.setState({gamesList: gameMetadatas})
    }
)

function login(loginInfo: UserLoginInfo, register: boolean) {
    if (socket !== null) {
        socket.close(undefined, "Reconnecting")
    }

    socket = new WebSocket("ws://localhost:8888")
    socket.binaryType = "arraybuffer"
    socket.onopen = (event) => {
        socket.send(
            MessageBuilder
                .create()
                .setLoginPayload(register, loginInfo.username, loginInfo.key)
                .build())
    }
    socket.onclose = (event) => {
        console.log(`Socket connection closed with code "${event.code}"; reason: ${event.reason}`)
    }
    socket.onmessage = (event) => {
        dispatcher.dispatch(null, new Uint8Array(event.data))
    }
}

function joinGame(createGame = false, inviteCode?: string) {
    if (createGame) {
        console.log(`Joining new game`)
    } else {
        console.log(`Joining game: ${inviteCode}`)
    }

    stateController.setState({gameState: null})
    stateController.setView(View.GamePlay)

    socket.send(
        MessageBuilder.create()
            .setJoinGamePayload(createGame, inviteCode)
            .build())
}

function listGames() {
    console.log("Requesting current games list")

    stateController.setView(View.GameList)
    socket.send(MessageBuilder.create().setListGamesPayload().build())
}

export {login, joinGame}
