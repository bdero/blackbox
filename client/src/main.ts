import {initDom, stateController, View} from "./dom"
import {login} from "./connection"
import {LocalStorageState} from "./localstorage"


window.addEventListener('DOMContentLoaded', (event) => {
    initDom() // Initialize react

    // Initial logistration
    const loginInfo = LocalStorageState.getUserLogin()
    if (loginInfo.key === null) {
        console.log("No previous user on record; diaplaying registration form")
        
        stateController.setView(View.Register)
        return
    }
    console.log(`Stored user info found: key="${loginInfo.key}"; username="${loginInfo.username}; logging in"`)
    login(loginInfo, false)
})
