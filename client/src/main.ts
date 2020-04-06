import {flatbuffers} from "flatbuffers"

// Using a symlink to the shared directory in order to work around a parceljs bug:
// https://github.com/parcel-bundler/parcel/issues/2978
import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder, MessageDispatcher} from "./shared/src/messages"

interface UserLoginInfo {
    key: string | null,
    username: string | null
}

class ClientState {
    public static readonly KEY_FIELD = "key"
    public static readonly USERNAME_FIELD = "username"

    static getUserLogin(): UserLoginInfo {
        return {
            key: localStorage.getItem(ClientState.KEY_FIELD),
            username: localStorage.getItem(ClientState.USERNAME_FIELD)
        }
    }
    static setUserLogin(key: string, username: string) {
        localStorage.setItem(ClientState.KEY_FIELD, key)
        localStorage.setItem(ClientState.USERNAME_FIELD, username)
    }
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
            // TODO(bdero): display registration form
            return
        }
        const key = payload.key()
        const username = payload.username()
        ClientState.setUserLogin(key, username)
        console.log(`Login successful: key="${key}"; username="${username}"`)
        // TODO(bdero): If invite code set, attempt to join game session
        // TODO(bdero): If no invite code, attempt to list sessions
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

function init() {
    const loginInfo = ClientState.getUserLogin()
    if (loginInfo.key === null) {
        console.log("No previous user on record; diaplaying registration form")
        // TODO(bdero): display registration form
        return
    }
    
    console.log(`Stored user info found: key="${loginInfo.key}"; username="${loginInfo.username}; logging in"`)
    login(loginInfo, false)
}
init();
