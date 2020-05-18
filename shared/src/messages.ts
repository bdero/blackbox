// @ts-ignore
import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "./protos/messages_generated"
import {Vector2} from "./math"

export class GameBoard {
    public visible?: boolean // Client only
    public atomsSubmitted: boolean = false
    public atomLocations?: Vector2[] // Hidden on gameboards not owned by the client
    public moves: {in: Vector2, out: Vector2 | null}[] = []

    private constructor() {}

    static createNew(): GameBoard {
        const gameBoard = new GameBoard()
        return gameBoard
    }

    static fromBuffer(buffer: Buffers.GameBoard): GameBoard {
        const result = new GameBoard()

        result.visible = buffer.visible()
        result.atomsSubmitted = buffer.atomsSubmitted()
        result.atomLocations = []
        for (let i = 0; i < buffer.atomLocationsLength(); i++) {
            const location = buffer.atomLocations(i) as Buffers.Vec2
            result.atomLocations.push(
                new Vector2(location.x(), location.y())
            )
        }
        result.moves = []
        for (let i = 0; i < buffer.movesLength(); i++) {
            const move = buffer.moves(i) as Buffers.BoardMove
            const moveIn = move.in() as Buffers.Vec2
            const moveOut = move.out() as Buffers.Vec2
            result.moves.push({
                in: new Vector2(moveIn.x(), moveIn.y()),
                out: (moveOut.x() === -1 && moveOut.y() === -1) ? null : new Vector2(moveOut.x(), moveOut.y()),
            })
        }

        return result
    }

    toNormalizedObject() {
        return {
            atomLocations:
                this.atomLocations !== undefined ?
                    this.atomLocations.map(a => {return {x: a.x, y: a.y}}) : null,
            atomsSubmitted: this.atomsSubmitted,
            moves:
                this.moves.map(m => {return {in: {x: m.in.x, y: m.in.y}, out: m.out === null ? null : {x: m.out.x, y: m.out.y}}}),
        }
    }

    static fromNormalizedObject(o: ReturnType<GameBoard['toNormalizedObject']>): GameBoard {
        const result = new GameBoard()
        if (o.atomLocations != null) result.atomLocations = o.atomLocations.map(a => new Vector2(a.x, a.y))
        result.atomsSubmitted = o.atomsSubmitted
        result.moves = o.moves.map(m => {
            return {in: new Vector2(m.in.x, m.in.y), out: m.out === null ? null : new Vector2(m.out.x, m.out.y)}
        })
        return result
    }
}

export class GameMetadata {
    // @ts-ignore
    public inviteCode: string
    public seatNumber?: number // Client only
    public roster: {key?: string, username?: string, online?: boolean}[] = [] // Keys are server only
    public status: Buffers.GameSessionStatus = Buffers.GameSessionStatus.SelectingAtoms

    private constructor() {}

    static createNew(inviteCode: string): GameMetadata {
        const metadata = new GameMetadata()
        metadata.inviteCode = inviteCode
        return metadata
    }

    static fromBuffer(buffer: Buffers.GameMetadata): GameMetadata {
        const result = new GameMetadata()

        result.inviteCode = buffer.inviteCode() as string
        result.seatNumber = buffer.seatNumber()
        result.roster = []
        for (let i = 0; i < buffer.rosterLength(); i++) {
            const rosterItem = buffer.roster(i) as Buffers.GameSessionPlayer
            result.roster.push({username: rosterItem.username() ?? undefined, online: rosterItem.online()})
        }
        result.status = buffer.status()

        return result
    }

    toNormalizedObject() {
        return {
            inviteCode: this.inviteCode,
            roster: this.roster.filter(p => p !== undefined).map(p => p.key),
            status: this.status,
        }
    }

    static fromNormalizedObject(o: ReturnType<GameMetadata['toNormalizedObject']>): GameMetadata {
        const result = new GameMetadata()
        result.inviteCode = o.inviteCode
        result.roster = o.roster.map(k => {return {key: k}})
        result.status = o.status
        return result
    }
}

export class GameState {
    // @ts-ignore
    public metadata: GameMetadata
    public boardA: GameBoard = GameBoard.createNew()
    public boardB: GameBoard = GameBoard.createNew()

    private constructor() {}

    static createNew(inviteCode: string): GameState {
        const gameState = new GameState()
        gameState.metadata = GameMetadata.createNew(inviteCode)
        return gameState
    }

    static fromBuffer(buffer: Buffers.GameSessionState): GameState {
        const result = new GameState()

        result.metadata = GameMetadata.fromBuffer(buffer.metadata() as Buffers.GameMetadata)
        result.boardA = GameBoard.fromBuffer(buffer.boardA() as Buffers.GameBoard)
        result.boardB = GameBoard.fromBuffer(buffer.boardB() as Buffers.GameBoard)

        return result
    }

    toNormalizedObject() {
        return {
            metadata: this.metadata.toNormalizedObject(),
            boardA: this.boardA.toNormalizedObject(),
            boardB: this.boardB.toNormalizedObject(),
        }
    }

    static fromNormalizedObject(o: ReturnType<GameState['toNormalizedObject']>): GameState {
        const result = new GameState()
        result.metadata = GameMetadata.fromNormalizedObject(o.metadata)
        result.boardA = GameBoard.fromNormalizedObject(o.boardA)
        result.boardB = GameBoard.fromNormalizedObject(o.boardB)
        return result
    }

    clone(): GameState {
        const prevRoster = this.metadata.roster
        const result = GameState.fromNormalizedObject(this.toNormalizedObject())
        // When cloning, denormalized fields need to be copied.
        result.metadata.roster = prevRoster.map(r => {
            return {key: r.key, username: r.username, online: r.online}
        })
        return result
    }
}

/**
 * Builder for game protocol flatbuffer messages suitable for WebSocket transport.
 */
 export class MessageBuilder {
    private builder: flatbuffers.Builder
    private payloadType: Buffers.AnyPayload
    private payloadOffset: number | null

    constructor() {
        this.builder = new flatbuffers.Builder()
        this.payloadType = Buffers.AnyPayload.NONE
        this.payloadOffset = null
    }

    static create(): MessageBuilder {
        return new MessageBuilder()
    }

    private createString(str: string | null | undefined): number | null {
        if (str === null || str === undefined) return null
        return this.builder.createString(str)
    }

    private createGameMetadata(metadata: GameMetadata): number {
        const inviteCodeOffset = this.createString(metadata.inviteCode);

        let rosterOffset: number | null = null
        let players: number[] = []
        if (metadata.roster.length > 0) {
            players = metadata.roster.map(player => {
                const usernameOffset = this.createString(player.username) as number
                Buffers.GameSessionPlayer.startGameSessionPlayer(this.builder)
                Buffers.GameSessionPlayer.addUsername(this.builder, usernameOffset)
                Buffers.GameSessionPlayer.addOnline(this.builder, player.online as boolean)
                return Buffers.GameSessionPlayer.endGameSessionPlayer(this.builder)
            })
        }
        rosterOffset = Buffers.GameMetadata.createRosterVector(this.builder, players)

        Buffers.GameMetadata.startGameMetadata(this.builder)
        Buffers.GameMetadata.addInviteCode(this.builder, inviteCodeOffset as number)
        Buffers.GameMetadata.addSeatNumber(this.builder, metadata.seatNumber as number)
        if (rosterOffset !== null) Buffers.GameMetadata.addRoster(this.builder, rosterOffset)
        Buffers.GameMetadata.addStatus(this.builder, metadata.status)
        return Buffers.GameMetadata.endGameMetadata(this.builder)
    }

    private createGameBoard(gameBoard: GameBoard) {
        let atomLocationsOffset: number | null = null
        if (gameBoard.atomLocations !== undefined && gameBoard.atomLocations.length > 0) {
            Buffers.GameBoard.startAtomLocationsVector(this.builder, gameBoard.atomLocations.length)
            gameBoard.atomLocations.forEach(a => Buffers.Vec2.createVec2(this.builder, a.x, a.y))
            atomLocationsOffset = this.builder.endVector()
        }
        Buffers.GameBoard.startMovesVector(this.builder, gameBoard.moves.length)
        // Flatbuffers packs vectors in reverse order, so reverse them to ensure the moves will be deserialized in chronological order
        const reverseMoves = [...gameBoard.moves].reverse()
        reverseMoves.forEach(
            m => Buffers.BoardMove.createBoardMove(
                this.builder, m.in.x, m.in.y,
                m.out === null ? -1 : m.out.x,
                m.out === null ? -1 : m.out.y
            )
        )
        const movesOffset = this.builder.endVector()

        Buffers.GameBoard.startGameBoard(this.builder)
        Buffers.GameBoard.addVisible(this.builder, gameBoard.visible as boolean)
        Buffers.GameBoard.addAtomsSubmitted(this.builder, gameBoard.atomsSubmitted)
        if (atomLocationsOffset !== null) Buffers.GameBoard.addAtomLocations(this.builder, atomLocationsOffset)
        Buffers.GameBoard.addMoves(this.builder, movesOffset)

        return Buffers.GameBoard.endGameBoard(this.builder)
    }

    private createGameState(gameState: GameState) {
        const metadataOffset = this.createGameMetadata(gameState.metadata)
        const boardAOffset = this.createGameBoard(gameState.boardA)
        const boardBOffset = this.createGameBoard(gameState.boardB)

        Buffers.GameSessionState.startGameSessionState(this.builder)
        Buffers.GameSessionState.addMetadata(this.builder, metadataOffset)
        Buffers.GameSessionState.addBoardA(this.builder, boardAOffset)
        Buffers.GameSessionState.addBoardB(this.builder, boardBOffset)
        return Buffers.GameSessionState.endGameSessionState(this.builder)
    }

    setLoginPayload(register: boolean, username: string, key: string | null = null): MessageBuilder {
        this.payloadType = Buffers.AnyPayload.LoginPayload

        const usernameOffset = this.builder.createString(username)
        const keyOffset = this.createString(key)

        Buffers.LoginPayload.startLoginPayload(this.builder)
        Buffers.LoginPayload.addRegister(this.builder, register)
        Buffers.LoginPayload.addUsername(this.builder, usernameOffset)
        if (keyOffset !== null) Buffers.LoginPayload.addKey(this.builder, keyOffset)

        this.payloadOffset = Buffers.LoginPayload.endLoginPayload(this.builder)
        return this
    }

    setLoginAckPayload(success: boolean, errorMessage?: string, username?: string, key?: string): MessageBuilder {
        this.payloadType = Buffers.AnyPayload.LoginAckPayload

        const errorMessageOffset = this.createString(errorMessage)
        const usernameOffset = this.createString(username)
        const keyOffset = this.createString(key)

        Buffers.LoginAckPayload.startLoginAckPayload(this.builder)
        Buffers.LoginAckPayload.addSuccess(this.builder, success)
        if (errorMessageOffset !== null) Buffers.LoginAckPayload.addErrorMessage(this.builder, errorMessageOffset)
        if (usernameOffset !== null) Buffers.LoginAckPayload.addUsername(this.builder, usernameOffset)
        if (keyOffset !== null) Buffers.LoginAckPayload.addKey(this.builder, keyOffset)

        this.payloadOffset = Buffers.LoginAckPayload.endLoginAckPayload(this.builder)
        return this
    }

    setJoinGamePayload(createGame: boolean, inviteCode?: string): MessageBuilder {
        this.payloadType = Buffers.AnyPayload.JoinGamePayload

        const inviteCodeOffset = inviteCode !== undefined ? this.createString(inviteCode) : null
        Buffers.JoinGamePayload.startJoinGamePayload(this.builder)
        Buffers.JoinGamePayload.addCreateGame(this.builder, createGame)
        if (inviteCodeOffset !== null) Buffers.JoinGamePayload.addInviteCode(this.builder, inviteCodeOffset)

        this.payloadOffset = Buffers.JoinGamePayload.endJoinGamePayload(this.builder)
        return this
    }

    setJoinGameAckPayload(success: boolean, errorMessage?: string, inviteCode?: string, gameState?: GameState): MessageBuilder {
        this.payloadType = Buffers.AnyPayload.JoinGameAckPayload

        const errorMessageOffset = this.createString(errorMessage)
        const inviteCodeOffset = this.createString(inviteCode)
        const gameStateOffset = gameState !== undefined ? this.createGameState(gameState) : null

        Buffers.JoinGameAckPayload.startJoinGameAckPayload(this.builder)
        Buffers.JoinGameAckPayload.addSuccess(this.builder, success)
        if (errorMessageOffset !== null) Buffers.JoinGameAckPayload.addErrorMessage(this.builder, errorMessageOffset)
        if (inviteCodeOffset !== null) Buffers.JoinGameAckPayload.addInviteCode(this.builder, inviteCodeOffset)
        if (gameStateOffset !== null) Buffers.JoinGameAckPayload.addGameState(this.builder, gameStateOffset)

        this.payloadOffset = Buffers.JoinGameAckPayload.endJoinGameAckPayload(this.builder)
        return this
    }

    setListGamesPayload(): MessageBuilder {
        this.payloadType = Buffers.AnyPayload.ListGamesPayload
        Buffers.ListGamesPayload.startListGamesPayload(this.builder)
        this.payloadOffset = Buffers.ListGamesPayload.endListGamesPayload(this.builder)
        return this
    }

    setListGamesAckPayload(success: boolean, errorMessage?: string, metadatas?: GameMetadata[]): MessageBuilder {
        this.payloadType = Buffers.AnyPayload.ListGamesAckPayload

        const errorMessageOffset = this.createString(errorMessage)

        let metadataOffset: number | null = null
        if (metadatas !== undefined && metadatas.length > 0) {
            let offsets = metadatas.map(m => this.createGameMetadata(m))
            metadataOffset = Buffers.ListGamesAckPayload.createMetadatasVector(this.builder, offsets)
        }

        Buffers.ListGamesAckPayload.startListGamesAckPayload(this.builder)
        Buffers.ListGamesAckPayload.addSuccess(this.builder, success)
        if (metadataOffset !== null) Buffers.ListGamesAckPayload.addMetadatas(this.builder, metadataOffset)
        if (errorMessageOffset !== null) Buffers.ListGamesAckPayload.addErrorMessage(this.builder, errorMessageOffset)

        this.payloadOffset = Buffers.ListGamesAckPayload.endListGamesAckPayload(this.builder)
        return this
    }

    setUpdateGamePayload(gameState: GameState) {
        this.payloadType = Buffers.AnyPayload.UpdateGamePayload

        const gameStateOffset = gameState !== undefined ? this.createGameState(gameState) : null

        Buffers.UpdateGamePayload.startUpdateGamePayload(this.builder)
        if (gameStateOffset !== null) Buffers.UpdateGamePayload.addGameState(this.builder, gameStateOffset)

        this.payloadOffset = Buffers.UpdateGamePayload.endUpdateGamePayload(this.builder)
        return this
    }

    setSetAtomsPayload(inviteCode: string, atoms: Vector2[]) {
        this.payloadType = Buffers.AnyPayload.SetAtomsPayload

        const inviteCodeOffset = this.createString(inviteCode) as number
        Buffers.SetAtomsPayload.startAtomLocationsVector(this.builder, atoms.length)
        atoms.forEach(a => {
            Buffers.Vec2.createVec2(this.builder, a.x, a.y)
        })
        const atomLocationsVectorOffset: number = this.builder.endVector()

        Buffers.SetAtomsPayload.startSetAtomsPayload(this.builder)
        Buffers.SetAtomsPayload.addInviteCode(this.builder, inviteCodeOffset)
        Buffers.SetAtomsPayload.addAtomLocations(this.builder, atomLocationsVectorOffset)

        this.payloadOffset = Buffers.SetAtomsPayload.endSetAtomsPayload(this.builder)
        return this
    }

    setSubmitMovePayload(inviteCode: string, move: Vector2) {
        this.payloadType = Buffers.AnyPayload.SubmitMovePayload

        const inviteCodeOffset = this.createString(inviteCode) as number

        Buffers.SubmitMovePayload.startSubmitMovePayload(this.builder)
        Buffers.SubmitMovePayload.addInviteCode(this.builder, inviteCodeOffset)
        Buffers.SubmitMovePayload.addMove(
            this.builder, Buffers.Vec2.createVec2(this.builder, move.x, move.y))

        this.payloadOffset = Buffers.SubmitMovePayload.endSubmitMovePayload(this.builder)
        return this
    }

    setSubmitSolutionPayload(inviteCode: string, atoms: Vector2[]) {
        this.payloadType = Buffers.AnyPayload.SubmitSolutionPayload

        const inviteCodeOffset = this.createString(inviteCode) as number
        Buffers.SubmitSolutionPayload.startAtomLocationsVector(this.builder, atoms.length)
        atoms.forEach(a => {
            Buffers.Vec2.createVec2(this.builder, a.x, a.y)
        })
        const atomLocationsVectorOffset: number = this.builder.endVector()

        Buffers.SubmitSolutionPayload.startSubmitSolutionPayload(this.builder)
        Buffers.SubmitSolutionPayload.addInviteCode(this.builder, inviteCodeOffset)
        Buffers.SubmitSolutionPayload.addAtomLocations(this.builder, atomLocationsVectorOffset)

        this.payloadOffset = Buffers.SubmitSolutionPayload.endSubmitSolutionPayload(this.builder)
        return this
    }

    build(): Uint8Array {
        if (this.payloadType === Buffers.AnyPayload.NONE || this.payloadOffset === null) {
            throw new Error("Unable to build message without a payload")
        }

        Buffers.Message.startMessage(this.builder)
        Buffers.Message.addPayloadType(this.builder, this.payloadType)
        Buffers.Message.addPayload(this.builder, this.payloadOffset)
        const messageOffset = Buffers.Message.endMessage(this.builder)

        this.builder.finish(messageOffset)
        return this.builder.asUint8Array()
    }
}

type MessageHandler = (state: any, payload: any) => void
type MessageMap = {
    [key: number]: {
        payloadType: any,
        dispatch: MessageHandler
    }
}

/**
 * Game protocol flatbuffer parser and payload dispatcher.
 */
export class MessageDispatcher {
    private messageMap: MessageMap

    constructor() {
        this.messageMap = {}
    }

    register(payloadId: number, payloadType: any, callback: MessageHandler) {
        this.messageMap[payloadId] = {
            payloadType,
            dispatch: callback,
        }
    }

    has(payloadId: number): boolean {
        return payloadId in this.messageMap
    }

    dispatch(state: any, data: Uint8Array) {
        const buf = new flatbuffers.ByteBuffer(data)
        const message = Buffers.Message.getRootAsMessage(buf)
        const payloadType = message.payloadType()
        if (!(payloadType in this.messageMap)) {
            console.log(`Received invalid message with payload type ${payloadType}`)
            return
        }
        const payloadClass = this.messageMap[payloadType].payloadType
        const payload = message.payload(new payloadClass())
        this.messageMap[payloadType].dispatch(state, payload)
    }
}
