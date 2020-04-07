import {flatbuffers} from "flatbuffers"

// Using a symlink to the shared directory in order to work around a parceljs bug:
// https://github.com/parcel-bundler/parcel/issues/2978
import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder, MessageDispatcher} from "./shared/src/messages"
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
            return
        }

        // TODO(bdero): If no invite code, attempt to list sessions
        stateController.setView(View.GameList)
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

export {login}
