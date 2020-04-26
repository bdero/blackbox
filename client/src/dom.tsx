import * as React from "react"
import * as ReactDOM from "react-dom"

import {login, joinGame, loginInfo} from "./client_dispatcher"
import {Vector2, GameMetadata, GameState, GameBoard} from "./shared/src/messages"

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
type StateGetter = () => RenderState

class StateController {
    stateSetter: StateSetter
    stateGetter: StateGetter

    registerState(stateSetter: StateSetter, stateGetter: StateGetter) {
        this.stateSetter = stateSetter
        this.stateGetter = stateGetter
    }

    setState(data: {[key: string]: any}) {
        this.stateSetter(data)
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
    constructor(props) {
        super(props)

        this.isCurrentPlayer = this.isCurrentPlayer.bind(this)
        this.getPlayerDisplay = this.getPlayerDisplay.bind(this)

    }

    isCurrentPlayer(playerIndex: number): boolean {
        if (playerIndex >= this.props.gameState.metadata.roster.length) return false
        if (this.props.gameState.metadata.seatNumber !== playerIndex) return false
        return true
    }

    getPlayerDisplay(playerIndex: number) {
        const hasPlayerJoined = playerIndex < this.props.gameState.metadata.roster.length
        const isCurrentPlayer = this.isCurrentPlayer(playerIndex)

        let playerName = hasPlayerJoined ? this.props.gameState.metadata.roster[playerIndex].username : "MISSINGNO."
        if (isCurrentPlayer) playerName += " 🕹️"
        const playerTitle = hasPlayerJoined ? playerName : "No opponent has joined! 😧"

        let inviteLink: JSX.Element | null = null
        if (!hasPlayerJoined) {
            inviteLink = (
                <div className="invite-link-modal">
                    <label htmlFor="inviteCode">Invite link</label>
                    <input id="inviteCode" type="text" value={window.location.toString()} readOnly/>
                </div>
            )
        }

        return (
            <div className="game-player-container">
                <div className="game-player-header">
                    {playerTitle}
                </div>
                <div className="game-board-container">
                    <GameBoardComponent
                        gameBoard={this.props.gameState.boardB}
                        isCurrentPlayer={isCurrentPlayer}
                        isJoined={hasPlayerJoined} />
                    {inviteLink}
                </div>
            </div>
        )
    }

    render() {
        if (this.props.gameState === null) {
            return <div>No game loaded</div>
        }

        return (
            <div className="game-container">
                {this.getPlayerDisplay(0)}
                {this.getPlayerDisplay(1)}
            </div>
        )
    }
}

class GameBoardComponent extends React.Component<{gameBoard: GameBoard, isCurrentPlayer: boolean, isJoined: boolean},{rayCoords: null | Vector2}> {
    static readonly CELL_SIZE: number = 100;
    static readonly CELL_BORDER_SIZE: number = 3;
    static readonly BOARD_SIZE: number = 500;

    constructor(props) {
        super(props)

        this.state = {
            rayCoords: null
        }

        this.setRayCoords = this.setRayCoords.bind(this)
    }

    setRayCoords(x?: number, y?: number) {
        if (x === undefined || y === undefined) {
            this.setState({rayCoords: null})
            return
        }
        this.setState({rayCoords: new Vector2(x, y)})
    }

    getCells() {
        const cells: JSX.Element[] = []
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                let cellType = 0
                if (x === 0 || x === 9) cellType += 1
                if (y === 0 || y === 9) cellType += 1
                if (cellType === 2) continue  // Don't render corners

                let extraProps = {}
                if (cellType === 1) {
                    extraProps = {
                        onMouseEnter: () => {this.setRayCoords(x, y)},
                        //onMouseOver: () => {this.setRayCoords(x, y)},
                        onMouseLeave: () => {this.setRayCoords()},
                    }
                }
                cells.push(
                    <rect
                        key={`cell_x${x}y${y}`}
                        x={x*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_BORDER_SIZE}
                        y={y*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_BORDER_SIZE}
                        width={GameBoardComponent.CELL_SIZE - GameBoardComponent.CELL_BORDER_SIZE*2}
                        height={GameBoardComponent.CELL_SIZE - GameBoardComponent.CELL_BORDER_SIZE*2}
                        className={cellType === 1 ? "selection-cell" : "atom-cell"}
                        {...extraProps}
                    />
                )
            }
        }
        return (
            <g>
                {cells}
            </g>
        )
    }

    getRay() {
        if (this.state.rayCoords === null) return null

        const xdir = this.state.rayCoords.x === 0 ? 1 : this.state.rayCoords.x === 9 ? -1 : 0
        const ydir = this.state.rayCoords.y === 0 ? 1 : this.state.rayCoords.y === 9 ? -1 : 0

        const props = {
            x1: this.state.rayCoords.x*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_SIZE/2,
            y1: this.state.rayCoords.y*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_SIZE/2,
        }
        return <line
            {...props}
            x2={props.x1 + xdir*GameBoardComponent.CELL_SIZE*8}
            y2={props.y1 + ydir*GameBoardComponent.CELL_SIZE*8}
            stroke="white"
            strokeWidth="20"
            pointerEvents="none"
        />
    }

    render() {
        return (
            <svg className="game-board" viewBox={`0 0 ${GameBoardComponent.BOARD_SIZE} ${GameBoardComponent.BOARD_SIZE}`} preserveAspectRatio="xMidYMid meet">
                <g transform="scale(0.5, 0.5)">
                    {this.getCells()}
                    {this.getRay()}
                </g>
            </svg>
        )
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

        this.getView = this.getView.bind(this)
    }

    componentDidMount() {
        stateController.registerState(this.setState.bind(this), () => this.state)
    }

    getView(): JSX.Element {
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

    render() {

        return (
            <div className="main-container">
                {this.getView()}
            </div>
        )
    }
}

function initDom() {
    ReactDOM.render(
        <Root />,
        document.getElementById("root")
    )
}

export {initDom, stateController, View}
