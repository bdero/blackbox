import {GameMetadata, GameState} from "./shared/src/messages"

export enum View {
    Init,
    Register,
    GameList,
    GamePlay
}
export type RenderState = {
    currentView: View,
    username: string,
    loggingIn: boolean, // For registration view
    gamesList: GameMetadata[],
    gameState: GameState | null,
}

type StateSetter = (stateTransform: {[key: string]: any} | ((previousState: RenderState) => RenderState)) => void
type StateGetter = () => RenderState

class StateController {
    stateSetter: StateSetter
    stateGetter: StateGetter
    component: React.Component

    registerState(stateSetter: StateSetter, stateGetter: StateGetter, component: React.Component) {
        this.stateSetter = stateSetter
        this.stateGetter = stateGetter
        this.component = component
    }

    setState(data: {[key: string]: any}) {
        this.stateSetter(data)
        this.component.forceUpdate()
    }

    getState(): RenderState {
        return this.stateGetter()
    }

    getCurrentInviteCode(): string | null {
        const state = this.getState()
        if (state.gameState === null) return null
        return state.gameState.metadata.inviteCode
    }

    setView(view: View, updateParams: boolean = true, params: Object = {}) {
        this.stateSetter({currentView: view})

        if (updateParams === false) return

        const currentLocation = window.location.href
        const [urlBase] = currentLocation.split("?")

        const queryParams = new URLSearchParams()
        Object.keys(params).forEach(k => queryParams.set(k, params[k]))
        const queryString = queryParams.toString()
        const urlParams = queryString ? `?${queryString}` : ""
        window.history.replaceState('', '', `${urlBase}${urlParams}`)
    }
}
export const stateController = new StateController()
