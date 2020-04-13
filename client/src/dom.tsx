import * as React from "react"
import * as ReactDOM from "react-dom"

import {login, joinGame} from "./client_dispatcher"
import {GameMetadata, GameState} from "./shared/src/messages"

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
    gamesList: GameMetadata[],
    gameState: GameState | null,
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

    setView(view: View, params: Object = {}) {
        this.stateSetter({currentView: view})

        const currentLocation = window.location.href
        const [urlBase] = currentLocation.split("?")

        const queryParams = new URLSearchParams()
        Object.keys(params).forEach(k => queryParams.set(k, params[k]))
        const queryString = queryParams.toString()
        const urlParams = queryString ? `?${queryString}` : ""
        window.history.replaceState('', '', `${urlBase}${urlParams}`)
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

class GameListItem extends React.Component<{game: GameMetadata}> {
    constructor(props) {
        super(props)

        this.joinGameClicked = this.joinGameClicked.bind(this)
    }

    joinGameClicked() {
        joinGame(false, this.props.game.inviteCode)
    }

    render() {
        return (
            <tr>
                <td>{this.props.game.status}</td>
                <td>{this.props.game.inviteCode}</td>
                <td><button onClick={this.joinGameClicked}>Join game</button></td>
            </tr>
        )
    }
}

class GameListView extends React.Component<{gamesList: GameMetadata[]}> {
    newGameClicked() {
        joinGame(true)
    }

    getListContents(): JSX.Element {
        if (this.props.gamesList.length === 0) {
            return <h1>No games started!</h1>
        }

        const listItems: JSX.Element[] = this.props.gamesList.map(
            g => <GameListItem key={g.inviteCode} game={g} />
        )
        return (
            <table>
                <tbody>
                    {listItems}
                </tbody>
            </table>
        )
    }

    render() {
        return (
            <div>
                {this.getListContents()}
                <button onClick={this.newGameClicked}>New game</button>
            </div>
        )
    }
}

class GamePlayView extends React.Component<{gameState: GameState}> {
    render() {
        if (this.props.gameState === null) {
            return <div>No game loaded</div>
        }
        return <div>Game loaded!</div>
    }
}

class Root extends React.Component<{}, RenderState> {
    constructor(props) {
        super(props)
        this.state = {
            currentView: View.Init,
            username: "",
            loggingIn: false,
            gamesList: [],
            gameState: null,
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
                return (
                    <GameListView
                        gamesList={this.state.gamesList}
                    />
                )
            case View.GamePlay:
                return <GamePlayView gameState={this.state.gameState} />
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
