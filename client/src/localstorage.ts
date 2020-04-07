interface UserLoginInfo {
    key: string | null,
    username: string | null
}

class LocalStorageState {
    public static readonly KEY_FIELD = "key"
    public static readonly USERNAME_FIELD = "username"

    static getUserLogin(): UserLoginInfo {
        return {
            key: localStorage.getItem(LocalStorageState.KEY_FIELD),
            username: localStorage.getItem(LocalStorageState.USERNAME_FIELD)
        }
    }
    static setUserLogin(key: string, username: string) {
        localStorage.setItem(LocalStorageState.KEY_FIELD, key)
        localStorage.setItem(LocalStorageState.USERNAME_FIELD, username)
    }
}

export {UserLoginInfo, LocalStorageState}
