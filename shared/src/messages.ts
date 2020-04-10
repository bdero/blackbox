import WebSocket = require("ws")
import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "./protos/messages_generated"

class Vector2 {
    public x: number
    public y: number

    constructor(x: number = 0, y: number = 0) {
        this.x = x
        this.y = y
    }
}

class GameBoard {
    public visible?: boolean // Client only
    public atomLocations?: Vector2[] // Hidden on gameboards not owned by the client
    public moves: {in: Vector2, out: Vector2}[]

    static fromBuffer(buffer: Buffers.GameBoard): GameBoard {
        const result = new GameBoard()

        result.visible = buffer.visible()
        result.atomLocations = []
        for (let i = 0; i < buffer.atomLocationsLength(); i++) {
            const location = buffer.atomLocations(i)
            result.atomLocations.push(
                new Vector2(location.x(), location.y())
            )
        }
        result.moves = []
        for (let i = 0; i < buffer.movesLength(); i++) {
            const move = buffer.moves(i)
            const moveIn = move.in()
            const moveOut = move.out()
            result.moves.push({
                in: new Vector2(moveIn.x(), moveIn.y()),
                out: new Vector2(moveOut.x(), moveOut.y()),
            })
        }

        return result
    }

    toNormalizedObject() {
        return {
            atomLocations:
                this.atomLocations !== undefined ?
                    this.atomLocations.map(a => {return {x: a.x, y: a.y}}) : null,
            moves:
                this.moves.map(m => {return {in: {x: m.in.x, y: m.in.y}, out: {x: m.out.x, y: m.out.y}}}),
        }
    }

    static fromNormalizedObject(o: ReturnType<GameBoard['toNormalizedObject']>): GameBoard {
        const result = new GameBoard()
        result.atomLocations = o.atomLocations.map(a => new Vector2(a.x, a.y))
        result.moves = o.moves.map(m => {
            return {in: new Vector2(m.in.x, m.in.y), out: new Vector2(m.out.x, m.out.y)}
        })
        return result
    }
}

class GameMetadata {
    public inviteCode: string
    public seatNumber?: number // Client only
    public roster: {key?: string, username?: string, online?: boolean}[] // Keys are server only
    public status: Buffers.GameSessionStatus

    static fromBuffer(buffer: Buffers.GameMetadata): GameMetadata {
        const result = new GameMetadata()

        result.seatNumber = buffer.seatNumber();
        result.roster = []
        for (let i = 0; i < buffer.rosterLength(); i++) {
            const rosterItem = buffer.roster(i)
            result.roster.push({username: rosterItem.username(), online: rosterItem.online()})
        }
        result.status = buffer.status()

        return result
    }

    toNormalizedObject() {
        return {
            inviteCode: this.inviteCode,
            //roster: this.roster.filter(p => p !== undefined).map(p => p.key),
            status: this.status,
        }
    }

    static fromNormalizedObject(o: ReturnType<GameMetadata['toNormalizedObject']>): GameMetadata {
        const result = new GameMetadata()
        result.inviteCode = o.inviteCode,
        //result.roster = o.roster.map(k => {return {key: k}})
        result.status = o.status
        return result
    }
}

class GameState {
    public metadata: GameMetadata
    public boardA: GameBoard
    public boardB: GameBoard

    static fromBuffer(buffer: Buffers.GameSessionState): GameState {
        const result = new GameState()

        result.metadata = GameMetadata.fromBuffer(buffer.metadata())
        result.boardA = GameBoard.fromBuffer(buffer.boardA())
        result.boardB = GameBoard.fromBuffer(buffer.boardB())

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
        return GameState.fromNormalizedObject(this.toNormalizedObject())
    }
}

/**
 * Builder for game protocol flatbuffer messages suitable for WebSocket transport.
 */
class MessageBuilder {
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
        if (metadata.roster.length > 0) {
            const players = metadata.roster.map(player => {
                const usernameOffset = this.createString(player.username)
                Buffers.GameSessionPlayer.startGameSessionPlayer(this.builder)
                Buffers.GameSessionPlayer.addUsername(this.builder, usernameOffset)
                Buffers.GameSessionPlayer.addOnline(this.builder, player.online)
                return Buffers.GameSessionPlayer.endGameSessionPlayer(this.builder)
            })
            rosterOffset = Buffers.GameMetadata.createRosterVector(this.builder, players)
        }

        Buffers.GameMetadata.startGameMetadata(this.builder)
        Buffers.GameMetadata.addInviteCode(this.builder, rosterOffset)
        Buffers.GameMetadata.addSeatNumber(this.builder, metadata.seatNumber)
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
        gameBoard.moves.forEach(
            m => Buffers.BoardMove.createBoardMove(this.builder, m.in.x, m.in.y, m.out.x, m.out.y)
        )
        const movesOffset = this.builder.endVector()

        Buffers.GameBoard.startGameBoard(this.builder)
        Buffers.GameBoard.addVisible(this.builder, gameBoard.visible)
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
class MessageDispatcher {
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

export {
    MessageBuilder, MessageDispatcher,
    GameState, GameMetadata, GameBoard, Vector2,
}
