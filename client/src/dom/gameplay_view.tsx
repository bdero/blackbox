import * as React from "react"
import {Vector2, GameState, GameBoard} from "../shared/src/messages"
import { BlackBox } from "../shared/src/protos/messages_generated"

export class GamePlayView extends React.Component<{gameState: GameState}> {
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
                        gameBoardIndex={playerIndex}
                        seatNumber={this.props.gameState.metadata.seatNumber}
                        isJoined={hasPlayerJoined}
                        gameStatus={this.props.gameState.metadata.status} />
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

interface GameBoardProps {
    gameBoard: GameBoard,
    gameBoardIndex: number,
    seatNumber: number,
    isJoined: boolean,
    gameStatus: BlackBox.GameSessionStatus
}

class GameBoardComponent extends React.Component<GameBoardProps, {rayCoords: null | Vector2, localAtoms: Vector2[]}> {
    static readonly CELL_SIZE: number = 100;
    static readonly CELL_BORDER_SIZE: number = 3;
    static readonly BOARD_SIZE: number = 500;

    constructor(props) {
        super(props)

        this.state = {
            rayCoords: null,
            localAtoms: []
        }

        this.setRayCoords = this.setRayCoords.bind(this)
        this.isMoveAllowed = this.isMoveAllowed.bind(this)
        this.localUserIsPlayer = this.localUserIsPlayer.bind(this)
        this.isLocalPlayerBoard = this.isLocalPlayerBoard.bind(this)
        this.isAtomSelectionAllowed = this.isAtomSelectionAllowed.bind(this)
        this.addAtom = this.addAtom.bind(this)
        this.removeAtom = this.removeAtom.bind(this)
    }

    setRayCoords(x?: number, y?: number) {
        if (x === undefined || y === undefined) {
            this.setState({rayCoords: null})
            return
        }
        this.setState({rayCoords: new Vector2(x, y)})
    }

    // Determines if the player is allowed to make moves on this game board
    isMoveAllowed(): boolean {
        // If it's the local player's turn, the player is allowed to submit moves against the opponent's game board
        return (
            (this.props.seatNumber === 0 && this.props.gameStatus === BlackBox.GameSessionStatus.PlayerATurn && this.props.gameBoardIndex === 1)
            || (this.props.seatNumber === 1 && this.props.gameStatus === BlackBox.GameSessionStatus.PlayerBTurn && this.props.gameBoardIndex === 0)
        )
    }

    // Determines if the local user is a player; false means the user is a spectator
    localUserIsPlayer(): boolean {
        return this.props.seatNumber === 0 || this.props.seatNumber === 1
    }

    // Determines if the current game board is the local player's game board
    isLocalPlayerBoard(): boolean {
        return this.props.seatNumber == this.props.gameBoardIndex
    }

    isAtomSelectionAllowed(): boolean {
        this.localUserIsPlayer() && this.isLocalPlayerBoard() && this.props.gameStatus === BlackBox.GameSessionStatus.SelectingAtoms
        this.localUserIsPlayer() && !this.isLocalPlayerBoard() && (this.props.gameStatus === BlackBox.GameSessionStatus.PlayerATurn || this.props.gameStatus === BlackBox.GameSessionStatus.PlayerBTurn)
        return this.localUserIsPlayer() && (
            (this.isLocalPlayerBoard() && this.props.gameStatus === BlackBox.GameSessionStatus.SelectingAtoms)
            || (
                !this.isLocalPlayerBoard()
                && (this.props.gameStatus === BlackBox.GameSessionStatus.PlayerATurn || this.props.gameStatus === BlackBox.GameSessionStatus.PlayerBTurn)
            )
        )
    }

    addAtom(x: number, y: number) {
        if (this.state.localAtoms.length >= 4) return
        this.setState(prevState => {
            const newAtoms = prevState.localAtoms.filter(a => !(a.x === x && a.y === y))
            newAtoms.push(new Vector2(x, y))
            return {localAtoms: newAtoms}
        })
    }

    removeAtom(x: number, y: number) {
        this.setState(prevState => {
            const newAtoms = prevState.localAtoms.filter(a => !(a.x === x && a.y === y))
        })
    }

    getCells(): JSX.Element {
        const isMoveAllowed = this.isMoveAllowed()
        const isAtomSelectionAllowed = this.isAtomSelectionAllowed()
        const cells: JSX.Element[] = []
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                let cellType = 0
                if (x === 0 || x === 9) cellType += 1
                if (y === 0 || y === 9) cellType += 1
                if (cellType === 2) continue  // Don't render corners

                let extraProps = {}
                if (cellType === 1 && isMoveAllowed) {
                    extraProps = {
                        onMouseEnter: () => {this.setRayCoords(x, y)},
                        //onMouseOver: () => {this.setRayCoords(x, y)},
                        onMouseLeave: () => {this.setRayCoords()},
                    }
                }
                if (cellType === 0 && isAtomSelectionAllowed) {
                    extraProps = {
                        onMouseUp: () => this.addAtom(x - 1, y - 1)
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

    getRay(): JSX.Element {
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

    getAtoms(): JSX.Element {
        const atoms = this.state.localAtoms.map(a => {
            return (
                <circle
                    key={`atom_x${a.x}y${a.y}`}
                    className="atom-circle"
                    cx={GameBoardComponent.CELL_SIZE*1.5 + a.x*GameBoardComponent.CELL_SIZE}
                    cy={GameBoardComponent.CELL_SIZE*1.5 + a.y*GameBoardComponent.CELL_SIZE}
                    r="30"
                />
            )
        })
        return <g>{atoms}</g>
    }

    render() {
        return (
            <svg
                className="game-board"
                viewBox={`0 0 ${GameBoardComponent.BOARD_SIZE} ${GameBoardComponent.BOARD_SIZE}`}
                preserveAspectRatio="xMidYMid meet">
                <g transform="scale(0.5, 0.5)">
                    {this.getCells()}
                    {this.getRay()}
                    {this.getAtoms()}
                </g>
            </svg>
        )
    }
}
