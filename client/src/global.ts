export interface UserLoginInfo {
    key: string | null,
    username: string | null
}

class PlayerState {
    loginInfo: UserLoginInfo | null = null
    socket: WebSocket | null = null
}

export const playerState = new PlayerState()
