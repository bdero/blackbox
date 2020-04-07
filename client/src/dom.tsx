import * as React from "react"
import * as ReactDOM from "react-dom"
import {login} from "./connection"

enum View {
    Init,
    Register,
    GameList,
    GamePlay
}
type RenderState = {
    currentView: View,
    username: string,
    loggingIn: boolean, // For registration view
}
type StateSetter = (stateTransform: {[key: string]: any} | ((previousState: RenderState) => RenderState)) => void

class StateController {
    stateSetter: StateSetter

    registerState(stateSetter: StateSetter) {
        this.stateSetter = stateSetter
    }

    setState(data: {[key: string]: any}) {
        this.stateSetter(data)
    }

    setView(view: View) {
        this.stateSetter({currentView: view})
    }
}
const stateController = new StateController()

class InitView extends React.Component {
    render() {
        return <div>Loading</div>
    }
}

class RegisterView extends React.Component<{username: string, loggingIn: boolean}> {
    constructor(props) {
        super(props)
        this.state = {
            username: "",
            loggingIn: false,
        }
    }
    submit() {
        stateController.setState({loggingIn: true})
        login({
            username: this.props.username,
            key: null
        }, true)
    }
    render() {
        return (
            <div>
                <input
                    placeholder="Nickname"
                    value={this.props.username}
                    onChange={e => stateController.setState({username: e.target.value})}
                    disabled={this.props.loggingIn}
                />
                <button
                    onClick={e => this.submit()}
                    disabled={this.props.loggingIn}>
                    Play
                </button>
            </div>
        )
    }
}

class GameListView extends React.Component {
    render() {
        return <div>Game list view</div>
    }
}

class GamePlayView extends React.Component {
    render() {
        return <div>Game play view</div>
    }
}

class Root extends React.Component<{}, RenderState> {
    constructor(props) {
        super(props)
        this.state = {
            currentView: View.Init,
            username: "",
            loggingIn: false
        }
    }
    componentDidMount() {
        stateController.registerState(this.setState.bind(this))
    }
    render() {
        switch (this.state.currentView) {
            case View.Register:
                return (
                    <RegisterView
                        username={this.state.username}
                        loggingIn={this.state.loggingIn}
                    />
                )
            case View.GameList:
                return <GameListView />
            case View.GamePlay:
                return <GamePlayView />
            default:
                return <InitView />
        }
    }
}

function initDom() {
    ReactDOM.render(
        <Root />,
        document.getElementById("root")
    )
}

export {initDom, stateController, View}
