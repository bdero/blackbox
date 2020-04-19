import * as React from "react"
import * as ReactDOM from "react-dom"

import {login, joinGame} from "./client_dispatcher"
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

        let boardBHeader = (
            <div className="game-player-header">
                Invite link: <input type="text" value={window.location.toString()} readOnly/>
            </div>
        )
        if (this.props.gameState.metadata.roster.length >= 2) {
            boardBHeader = <div className="game-player-header">{this.props.gameState.metadata.roster[1].username}</div>
        }
        return (
            <div>
                <div className="game-player-container">
                    <div className="game-player-header">{this.props.gameState.metadata.roster[0].username}</div>
                    <GameBoardComponent gameBoard={this.props.gameState.boardA} />
                </div>
                <div className="game-player-container">
                    {boardBHeader}
                    <GameBoardComponent gameBoard={this.props.gameState.boardB} />
                </div>
            </div>
        )
    }
}

class GameBoardComponent extends React.Component<{gameBoard: GameBoard}, {rayCoords: null | Vector2}> {
    static readonly CELL_SIZE: number = 100;
    static readonly CELL_BORDER_SIZE: number = 3;
    static readonly BOARD_SIZE: number = 500;

    static defaultProps = {
    }

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
            <svg width={GameBoardComponent.BOARD_SIZE} height={GameBoardComponent.BOARD_SIZE}>
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
