import * as React from "react"
import {GameState, GameBoard} from "../shared/src/messages"
import {Vector2} from "../shared/src/math"
import virtualBoard from "../shared/src/virtualboard"
import {BlackBox} from "../shared/src/protos/messages_generated"
import {submitAtoms} from "../views"

export class GamePlayView extends React.Component<{gameState: GameState}> {
    constructor(props) {
        super(props)

        this.isCurrentPlayer = this.isCurrentPlayer.bind(this)

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

        const gameBoard = playerIndex === 0 ? this.props.gameState.boardA : this.props.gameState.boardB

        let playerModal: JSX.Element | null = null
        if (!hasPlayerJoined) {
            playerModal = (
                <div className="invite-link-modal">
                    <label htmlFor="inviteCode">Invite a friend to play</label>
                    <input id="inviteCode" type="text" value={window.location.toString()} readOnly/>
                </div>
            )
        } else if (!isCurrentPlayer && this.props.gameState.metadata.status === BlackBox.GameSessionStatus.SelectingAtoms) {
            playerModal = (
                <div className="invite-link-modal">
                    {gameBoard.atomsSubmitted ? `Ready!${this.props.gameState.metadata.seatNumber <= 1 ? " Place your atoms to begin." : ""}` : "Waiting for atom placements..."}
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
                        gameBoard={gameBoard}
                        gameBoardIndex={playerIndex}
                        seatNumber={this.props.gameState.metadata.seatNumber}
                        isJoined={hasPlayerJoined}
                        gameStatus={this.props.gameState.metadata.status}
                        inviteCode={this.props.gameState.metadata.inviteCode} />
                    {playerModal}
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

// This is a neat hack for "instancing" component state by enclosing restoration instructions
// between component unmounting and remounting.
// https://stackoverflow.com/a/31372045/5221054
type RestoreProcedure<S = any> = (component: React.Component<any, S>) => void
interface InstanceState<S = any> {
    save: (restoreProcedure: RestoreProcedure<S>) => void,
    restore: (component: React.Component<any, S>) => boolean,
}
function createInstance(): InstanceState {
    let restoreProcedure: RestoreProcedure | null = null
    return {
        save: (restore: RestoreProcedure) => {
            restoreProcedure = restore
        },
        restore: (context): boolean => {
            if (restoreProcedure === null) return false
            restoreProcedure(context)
            return true
        }
    }
}

interface GameBoardProps {
    gameBoard: GameBoard,
    gameBoardIndex: number,
    seatNumber: number,
    isJoined: boolean,
    gameStatus: BlackBox.GameSessionStatus
    inviteCode: string,
}

interface GameBoardState {
    rayCoords: null | Vector2,
    localAtoms: {position: Vector2, instance: InstanceState}[],
    dragAtomIndex: number | null,
    mouseX: number,
    mouseY: number,
}

class GameBoardComponent extends React.Component<GameBoardProps, GameBoardState> {
    static readonly CELL_SIZE: number = 100;
    static readonly CELL_BORDER_SIZE: number = 3;
    static readonly BOARD_SIZE: number = 500;

    constructor(props) {
        super(props)

        this.state = {
            rayCoords: null,
            localAtoms: [],
            dragAtomIndex: null,
            mouseX: 0,
            mouseY: 0,
        }

        this.setRayCoords = this.setRayCoords.bind(this)
        this.isMoveAllowed = this.isMoveAllowed.bind(this)
        this.localUserIsPlayer = this.localUserIsPlayer.bind(this)
        this.localUserIsSpectator = this.localUserIsSpectator.bind(this)
        this.isLocalPlayerBoard = this.isLocalPlayerBoard.bind(this)
        this.isAtomSelectionAllowed = this.isAtomSelectionAllowed.bind(this)
        this.addAtom = this.addAtom.bind(this)
        this.removeAtom = this.removeAtom.bind(this)
        this.updateAtom = this.updateAtom.bind(this)
        this.onCellMouseDown = this.onCellMouseDown.bind(this)
        this.onMouseDeactivate = this.onMouseDeactivate.bind(this)
        this.onMouseMove = this.onMouseMove.bind(this)
        this.submitAtoms = this.submitAtoms.bind(this)
    }

    componentDidMount() {
        if (this.props.gameBoard.atomLocations) {
            this.props.gameBoard.atomLocations.forEach(a => this.addAtom(a.x, a.y))
        }
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

    localUserIsSpectator(): boolean {
        return this.props.seatNumber >= 2
    }

    // Determines if the current game board is the local player's game board
    isLocalPlayerBoard(): boolean {
        return this.props.seatNumber == this.props.gameBoardIndex
    }

    isAtomSelectionAllowed(): boolean {
        return this.localUserIsPlayer() && (
            (this.isLocalPlayerBoard() && this.props.gameStatus === BlackBox.GameSessionStatus.SelectingAtoms && !this.props.gameBoard.atomsSubmitted)
            || (
                !this.isLocalPlayerBoard()
                && (this.props.gameStatus === BlackBox.GameSessionStatus.PlayerATurn || this.props.gameStatus === BlackBox.GameSessionStatus.PlayerBTurn)
            )
        )
    }

    addAtom(x: number, y: number) {
        if (this.state.localAtoms.length >= 4) return
        this.setState(prevState => {
            const newAtoms = prevState.localAtoms.filter(a => !(a.position.x === x && a.position.y === y))
            newAtoms.push({position: new Vector2(x, y), instance: createInstance()})
            return {localAtoms: newAtoms}
        })
    }

    removeAtom(x: number, y: number) {
        this.setState(prevState => {
            const newAtoms = prevState.localAtoms.filter(a => !(a.position.x === x && a.position.y === y))
            return {localAtoms: newAtoms}
        })
    }

    updateAtom(index: number, x: number, y: number) {
        if (x < 0 || x > 7 || y < 0 || y > 7) return

        this.setState(prevState => {
            const newAtoms = [...prevState.localAtoms]
            newAtoms[index].position.x = x
            newAtoms[index].position.y = y
            return {localAtoms: newAtoms}
        })
    }

    onCellMouseDown(cellX, cellY) {
        if (!this.isAtomSelectionAllowed()) return
        if (this.state.dragAtomIndex !== null) return

        const targetCell = this.state.localAtoms.findIndex(a => a.position.x === cellX && a.position.y === cellY)
        // If there's no existing cell in this location, add one.
        if (targetCell === -1) {
            if (this.state.localAtoms.length >= 4) return

            this.addAtom(cellX, cellY)
            return
        }

        // If there is an existing cell in this location, begin dragging it.
        this.setState({dragAtomIndex: targetCell})
    }

    /** Called whenever the mouse is released or goes out of bounds. */
    onMouseDeactivate(event: React.MouseEvent<SVGSVGElement, MouseEvent>) {
        if (!this.isAtomSelectionAllowed()) return
        if (this.state.dragAtomIndex === null) return

        const rect = event.currentTarget.getBoundingClientRect()
        const releaseX: number = Math.max(0, Math.min(7, Math.floor((event.clientX - rect.left)/rect.width*10) - 1))
        const releaseY: number = Math.max(0, Math.min(7, Math.floor((event.clientY - rect.top)/rect.height*10) - 1))
        const draggedCell = this.state.localAtoms[this.state.dragAtomIndex]

        // If the atom was released on its own cell, remove it.
        if (draggedCell.position.x === releaseX && draggedCell.position.y === releaseY) {
            this.removeAtom(releaseX, releaseY)
            this.setState({dragAtomIndex: null})
            return
        }

        // If the atom was released on a different cell that already has an atom on it, keep the cell where it is.
        if (this.state.localAtoms.findIndex(a => a.position.x === releaseX && a.position.y === releaseY) !== -1) {
            this.setState({dragAtomIndex: null})
            return
        }

        // If the atom was released on a different cell, move the cell.
        this.updateAtom(this.state.dragAtomIndex, releaseX, releaseY)
        this.setState({dragAtomIndex: null})
    }

    onMouseMove(event: React.MouseEvent<SVGSVGElement, MouseEvent>) {
        if (!this.isAtomSelectionAllowed()) return

        event.persist()
        const rect = event.currentTarget.getBoundingClientRect()
        this.setState(prevState => {
            return {
                mouseX: (event.clientX - rect.left)/rect.width*10*GameBoardComponent.CELL_SIZE,
                mouseY: (event.clientY - rect.top)/rect.height*10*GameBoardComponent.CELL_SIZE,
            }
        })
    }

    submitAtoms() {
        submitAtoms(this.props.inviteCode, this.state.localAtoms.map(a => a.position))
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
                        onMouseDown: () => this.onCellMouseDown(x - 1, y - 1)
                    }
                }
                cells.push(
                    <rect
                        key={`cell_x${x}y${y}`}
                        rx="8"
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

    getRay(start: Vector2, end: Vector2 | null = null, pathVisible: boolean = true, classOverride: string | null = null): JSX.Element {
        virtualBoard.setAtoms(...this.state.localAtoms.map(a => Vector2.add(a.position, new Vector2(1, 1))))
        const pathPoints = virtualBoard.castRay(start)
        const pathString = pathPoints.map((s, i) => (
            `${i === 0 ? `M` : `L`} ${s.x*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_SIZE/2} ${s.y*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_SIZE/2}`)
        ).join(" ")

        const first = pathPoints[0]
        const last = end || (pathPoints.length > 1 ? pathPoints[pathPoints.length - 1] : null)
        return <g>
            {pathVisible &&
                <path
                    className={`ray-path${classOverride ? ` ${classOverride}` : ""}`}
                    d={pathString}
                />
            }
            <circle
                className="ray-circle"
                r="18"
                cx={first.x*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_SIZE/2}
                cy={first.y*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_SIZE/2}
            />
            {last !== null &&
                <circle
                    className="ray-circle"
                    r="18"
                    cx={last.x*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_SIZE/2}
                    cy={last.y*GameBoardComponent.CELL_SIZE + GameBoardComponent.CELL_SIZE/2}
                />
            }
        </g>
    }

    getAtoms(): JSX.Element {
        const atoms = this.state.localAtoms.map((a, i) => {
            let posX = GameBoardComponent.CELL_SIZE*1.5 + a.position.x*GameBoardComponent.CELL_SIZE
            let posY = GameBoardComponent.CELL_SIZE*1.5 + a.position.y*GameBoardComponent.CELL_SIZE
            if (i === this.state.dragAtomIndex) {
                posX = this.state.mouseX
                posY = this.state.mouseY
            }
            return (
                <Atom
                    isStatic={!this.isAtomSelectionAllowed()}
                    key={`atom_x${a.position.x}y${a.position.y}`}
                    instance={a.instance}
                    x={posX}
                    y={posY}
                />
            )
        })
        return <g>{atoms}</g>
    }

    getStatusLine(): JSX.Element | null {
        if (!this.isAtomSelectionAllowed()) return null
        const playingGame = this.props.gameStatus === BlackBox.GameSessionStatus.PlayerATurn || this.props.gameStatus === BlackBox.GameSessionStatus.PlayerBTurn
        if (this.state.localAtoms.length === 4) {
            if (playingGame) {
                return <button
                    className="atom-selection-button"
                    onClick={this.submitAtoms}
                    disabled={!this.isMoveAllowed()}>
                    Guess solution
                </button>
            }
            return <button
                className="atom-selection-button"
                onClick={this.submitAtoms}
                disabled={this.state.localAtoms.length !== 4}>
                Submit Atoms
            </button>
        }
        return <span>
            Place {4 - this.state.localAtoms.length} more atom{this.state.localAtoms.length !== 3 && `s`}{playingGame && ` to guess solution`}
        </span>
    }

    render() {
        return (
            <div>
                <svg
                    onMouseUp={this.onMouseDeactivate}
                    onMouseLeave={this.onMouseDeactivate}
                    onMouseMove={this.onMouseMove}
                    className={`game-board ${this.localUserIsPlayer && !this.isMoveAllowed() && "game-board-disabled"}`}
                    viewBox={`0 0 ${GameBoardComponent.BOARD_SIZE} ${GameBoardComponent.BOARD_SIZE}`}
                    preserveAspectRatio="xMidYMid meet">
                    <g transform="scale(0.5, 0.5)">
                        {this.getCells()}
                        {this.state.rayCoords !== null && this.getRay(this.state.rayCoords)}
                        {this.getAtoms()}
                    </g>
                </svg>
                <div className="game-board-status-line">
                    {this.getStatusLine()}
                </div>
            </div>
        )
    }
}

class Atom extends React.Component<{isStatic: boolean, instance: InstanceState, x: number, y: number}, {visualX: number, visualY: number}> {
    unmounting = false
    previousTime: number | null = null

    constructor(props) {
        super(props)

        this.state = {
            visualX: props.x,
            visualY: props.y,
        }

        this.animate = this.animate.bind(this)
    }

    animate(timestamp) {
        if (this.unmounting) return

        if (this.previousTime === null) this.previousTime = timestamp
        const dt = (timestamp - this.previousTime)/1000

        this.setState((prevState) => {
            return {
                visualX: prevState.visualX + (this.props.x - prevState.visualX)*(1 - 1/Math.pow(2, dt)),
                visualY: prevState.visualY + (this.props.y - prevState.visualY)*(1 - 1/Math.pow(2, dt)),
            }
        })

        requestAnimationFrame(this.animate)
    }

    componentDidMount() {
        this.props.instance.restore(this)
        requestAnimationFrame(this.animate)
    }

    componentWillUnmount() {
        this.unmounting = true
        let state = this.state
        this.props.instance.save((component) => {
            component.setState(() => {
                return {
                    visualX: state.visualX,
                    visualY: state.visualY,
                }
            })
        })
    }

    render() {
        return (
            <circle
                pointerEvents="none"
                className={`atom-circle-movable${this.props.isStatic ? " atom-circle-static" : ""}`}
                cx={this.state.visualX}
                cy={this.state.visualY}
                r="30"
            />
        )
    }
}
