import {initDom} from "./dom"
import {stateController, View} from "./state_controller"
import * as Views from "./views"
import {LocalStorageState} from "./localstorage"


window.addEventListener('DOMContentLoaded', (event) => {
    initDom() // Initialize react

    // Initial logistration
    const loginInfo = LocalStorageState.getUserLogin()
    if (loginInfo.key === null) {
        console.log("No previous user on record; diaplaying registration form")

        stateController.setView(View.Register, false)
        return
    }
    console.log(`Stored user info found: key="${loginInfo.key}"; username="${loginInfo.username}; logging in"`)
    Views.login(loginInfo, false)
})
