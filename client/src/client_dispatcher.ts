// Using a symlink to the shared directory in order to work around a parceljs bug:
// https://github.com/parcel-bundler/parcel/issues/2978
import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageDispatcher, GameMetadata, GameState} from "./shared/src/messages"
import {LocalStorageState} from "./localstorage"
import {stateController, View} from "./state_controller"
import {parseQueryParameters} from "./utils"
import {playerState} from "./global"
import * as Views from "./views"

export const dispatcher = new MessageDispatcher();
dispatcher.register(
    Buffers.AnyPayload.LoginAckPayload,
    Buffers.LoginAckPayload,
    (state, payload: Buffers.LoginAckPayload) => {
        if (!payload.success()) {
            const failReason = payload.errorMessage()
            console.error(`Login failed; reason: ${failReason}`)
            playerState.socket.close(undefined, "Login rejected")

            stateController.setView(View.Register, true)
            stateController.setState({loggingIn: false})
            return
        }
        const key = payload.key()
        const username = payload.username()
        LocalStorageState.setUserLogin(key, username)

        playerState.loginInfo = {key, username}
        console.log(`Login successful: key="${key}"; username="${username}"`)

        // TODO(bdero): If invite code set, attempt to join game session
        const queryParams = parseQueryParameters()
        if ("invite" in queryParams) {
            const inviteCode = queryParams["invite"]
            console.log(`Invite code set (invite="${inviteCode}); attempting to join session`)

            Views.joinGame(false, inviteCode)
            return
        }

        Views.listGames()
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
dispatcher.register(
    Buffers.AnyPayload.JoinGameAckPayload,
    Buffers.JoinGameAckPayload,
    (state, payload: Buffers.JoinGameAckPayload) => {
        if (!payload.success()) {
            const failReason = payload.errorMessage()
            console.error(`Failed to join game; reason: ${failReason}`)
            Views.listGames()
            return
        }

        console.log(`Join game successful`)
        const gameState = GameState.fromBuffer(payload.gameState())

        stateController.setView(View.GamePlay, true, {invite: gameState.metadata.inviteCode})
        stateController.setState({gameState})
    }
)
dispatcher.register(
    Buffers.AnyPayload.UpdateGamePayload,
    Buffers.UpdateGamePayload,
    (state, payload: Buffers.UpdateGamePayload) => {
        const newState = GameState.fromBuffer(payload.gameState())
        const currentInviteCode = stateController.getCurrentInviteCode()
        if (currentInviteCode === null) {
            console.error(
                `Received update message for game \`${newState.metadata.inviteCode}\`, but there is currently no active game running.`)
            return
        }
        if (currentInviteCode !== newState.metadata.inviteCode) {
            console.log(
                `Received update message for game \`${newState.metadata.inviteCode}\`, but the current active game is: ${currentInviteCode}`)
            // TODO(bdero): Update the game state entry with the new metadata (which will in-turn keep the status of all currently subscribed
            // games up-to-date).
            return
        }

        stateController.setState({gameState: newState})
    }
)
