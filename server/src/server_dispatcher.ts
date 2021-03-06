import WebSocket = require("ws")

import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder, MessageDispatcher, GameMetadata, GameState} from "./shared/src/messages"
import {Vector2} from "./shared/src/math"
import virtualBoard from "./shared/src/virtualboard"
import {randomName} from "./shared/src/word_lists"
import {Player, GameSession, GameSessionSeat} from "./database"
import { AssertionError } from "assert"

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BASE58_SET = new Set(BASE58_CHARS)
function generateKey(): string {
    let key = ""
    for (let i = 0; i < 64; i++) {
        key += BASE58_CHARS[Math.floor(Math.random() * BASE58_CHARS.length)]
    }
    return key
}

interface RosterEntry {player: Player, seatNumber: number}

class Game {
    static inviteCodeToGameIndex = new Map<String, Game>()

    gameState: GameState | null = null
    private model: GameSession | null = null
    private roster: Map<String, RosterEntry> // secretKeys to player
    private subscribers: Set<Connection>
    private dirty: boolean

    private constructor() {
        this.roster = new Map()
        this.subscribers = new Set()
        this.dirty = false
    }

    /**
     * Build or fetch the in-memory game context. Returns `null` if the invite code doesn't match a game.
     *
     * This should be used for fetching a game's live context in most situations.
     * @param inviteCode
     * @param newSubscriber
     */
    static async fromInviteCode(inviteCode: string, newSubscriber: Connection | null): Promise<Game | null> {
        if (Game.inviteCodeToGameIndex.has(inviteCode)) {
            const cachedGame = Game.inviteCodeToGameIndex.get(inviteCode)
            if (newSubscriber !== null) {
                await cachedGame?.subscribeConnection(newSubscriber)
            }
            return cachedGame as Game
        }

        // Load the game from the database if it doesn't exist yet
        const gameSession: GameSession | null = await GameSession.findOne({
            where: {
                inviteCode: inviteCode
            }
        })
        if (gameSession === null) return null

        const jsonGameState = gameSession.get('gameState') as string
        const gameStateObject = JSON.parse(jsonGameState)

        const result = new Game()
        result.model = gameSession
        result.gameState = GameState.fromNormalizedObject(gameStateObject)
        await result.refreshRoster()
        if (newSubscriber !== null) {
            await result.subscribeConnection(newSubscriber) // Also populates the roster
        } else {
            await result.publish()
        }

        Game.inviteCodeToGameIndex.set(inviteCode, result)
        return result
    }

    validateGameAction(action: string, connection: Connection): boolean {
        if (!connection.isLoggedIn()) return false

        if (connection.playerKey === null) return false
        if (!this.roster.has(connection.playerKey)) {
            connection.logError(
                `Player "${connection.playerKey}" attempted to ${action} for game "${this.gameState?.metadata.inviteCode}", but they're not in the roster.`)
            return false
        }

        const seat = this.roster.get(connection.playerKey)?.seatNumber
        if (seat !== 0 && seat !== 1) {
            connection.logError(
                `Player "${connection.playerKey}" attempted to ${action} for game "${this.gameState?.metadata.inviteCode}", `
                + `but they are not in a player seat (seat: ${seat}).`)
            return false
        }

        return true
    }

    validatePlayerTurn(action: string, connection: Connection): boolean {
        // Is it the Player's turn?
        if (connection.playerKey === null) {
            throw new Error("Unable to perform player turn validation because the connection's playerKey is `null`.")
        }
        const seat = this.roster.get(connection.playerKey)?.seatNumber
        if (!(
            this.gameState?.metadata.status === Buffers.GameSessionStatus.PlayerATurn && seat === 0
            || this.gameState?.metadata.status === Buffers.GameSessionStatus.PlayerBTurn && seat === 1
        )) {
            connection.logError(
                `Player "${connection.playerKey}" attempted to ${action} for game "${this.gameState?.metadata.inviteCode}", `
                + `but it's not the player's turn (seat: ${seat}, game status: ${this.gameState?.metadata.status}).`)
            return false
        }
        return true
    }

    validateUniqueAtoms(action: string, connection: Connection, atoms: Vector2[]): boolean {
        const uniqueAtoms: Set<string> = new Set()
        for (let atom of atoms) {
            const s = atom.toString()
            if (uniqueAtoms.has(s)) {
                connection.logError(
                    `Player "${connection.playerKey}" attempted to ${action} for game "${this.gameState?.metadata.inviteCode}" `
                    + `but the payload contains duplicate atom: ${s}.`)
                return false
            }
            uniqueAtoms.add(s)
        }
        return true
    }

    async setAtoms(connection: Connection, atoms: Vector2[]) {
        if (!this.validateGameAction("set atoms", connection)) return

        if (connection.playerKey === null) return
        if (this.gameState === null) return
        const seat = this.roster.get(connection.playerKey)?.seatNumber
        const board = seat === 0 ? this.gameState.boardA : this.gameState.boardB
        if (board.atomsSubmitted) {
            connection.logError(
                `Player "${connection.playerKey}" attempted to set atoms for game "${this.gameState.metadata.inviteCode}" (seat: ${seat}), `
                + `but their atoms are already submitted.`)
            return
        }

        if (this.gameState.metadata.status !== Buffers.GameSessionStatus.SelectingAtoms) {
            connection.logError(
                `Invalid game status "${this.gameState.metadata.status}" while setting atoms for game "${this.gameState.metadata.inviteCode}" `
                + `-- not all players in the game have submitted atoms, but the game status is not "SelectingAtoms".`)
                // This would be wonky, but might be correctable should it happen, so just log the error message and not return here.
        }

        if (!this.validateUniqueAtoms("set atoms", connection, atoms)) return

        board.atomLocations = atoms
        board.atomsSubmitted = true

        if (this.gameState.boardA.atomsSubmitted && this.gameState.boardB.atomsSubmitted) {
            this.gameState.metadata.status = Buffers.GameSessionStatus.PlayerATurn
        }

        this.dirty = true
        this.save()
        this.publish()
    }

    async submitSolution(connection: Connection, atoms: Vector2[]) {
        if (!this.validateGameAction("submit solution", connection)) return
        if (!this.validatePlayerTurn("submit solution", connection)) return
        if (!this.validateUniqueAtoms("submit solution", connection, atoms)) return

        if (connection.playerKey === null) return
        if (this.gameState === null) return
        const seat = this.roster.get(connection.playerKey)?.seatNumber
        const opponentBoard = seat === 0 ? this.gameState.boardB : this.gameState.boardA

        const opponentAtoms = new Set(opponentBoard.atomLocations?.map(a => a.toString()))
        atoms.forEach(a => opponentAtoms.delete(a.toString()))

        if (opponentAtoms.size === 0) {
            console.log(`Player "${connection.playerKey}" won game "${this.gameState.metadata.inviteCode}".`)

            this.gameState.metadata.status = seat === 0 ? Buffers.GameSessionStatus.PlayerAWin : Buffers.GameSessionStatus.PlayerBWin
        } else {
            const atomsRepr = atoms.map(a => a.toString()).join(", ")
            console.log (`Player "${connection.playerKey}" attempted incorrect solution in game "${this.gameState.metadata.inviteCode}": ${atomsRepr}.`)

            this.gameState.metadata.status =
            this.gameState.metadata.status === Buffers.GameSessionStatus.PlayerATurn ?
                Buffers.GameSessionStatus.PlayerBTurn : Buffers.GameSessionStatus.PlayerATurn

            // TODO(bdero): Submit message to player connection indicating that the guess failed.
        }

        this.dirty = true
        this.save()
        this.publish()
    }

    async submitMove(connection: Connection, move: Vector2) {
        if (!this.validateGameAction("submit move", connection)) return

        if (connection.playerKey === null) return
        if (this.gameState === null) return

        if (!(move.x === 0 || move.x === 9 || move.y === 0 || move.y === 9)) {
            connection.logError(
                `Player "${connection.playerKey}" attempted to submit move for game "${this.gameState.metadata.inviteCode}", `
                + `but the submitted move has invalid coordinates: ${move.toString()}.`)
            return
        }

        if (!this.validatePlayerTurn("submit move", connection)) return

        const seat = this.roster.get(connection.playerKey)?.seatNumber
        const opponentBoard = seat === 0 ? this.gameState.boardB : this.gameState.boardA
        // Is there an existing move in this location?
        const existingMove = opponentBoard.moves.findIndex(m => m.in.equals(move) || (m.out !== null && m.out.equals(move)))
        if (existingMove !== -1) {
            connection.logError(
                `Player "${connection.playerKey}" attempted to submit move for game "${this.gameState.metadata.inviteCode}", `
                + `but there's already a another move that covers the given coordinates (seat: ${seat}, submitted move: ${move.toString()}).`)
            return
        }

        if (opponentBoard.atomLocations === undefined) {
            connection.logError(
                `Player "${connection.playerKey}" attempted to submit move for game "${this.gameState.metadata.inviteCode}", `
                + `but the opponent's atoms are undefined. This should never happen.`
            )
            return
        }
        virtualBoard.setAtoms(...opponentBoard.atomLocations.map(a => Vector2.add(a, new Vector2(1, 1))))
        const rayCast = virtualBoard.castRay(move)
        if (rayCast === null) {
            connection.logError(
                `Player "${connection.playerKey}" attempted to submit move for game "${this.gameState.metadata.inviteCode}", `
                + `but the raycast result for given move \`${move.toString()}\` was invalid.`
            )
            return
        }
        const endPoint = rayCast[rayCast.length - 1]
        const didHit = rayCast.length === 1 || !virtualBoard.isSide(endPoint)
        opponentBoard.moves.push({
            in: rayCast[0],
            out: didHit ? null : endPoint,
        })

        this.gameState.metadata.status =
            this.gameState.metadata.status === Buffers.GameSessionStatus.PlayerATurn ?
                Buffers.GameSessionStatus.PlayerBTurn : Buffers.GameSessionStatus.PlayerATurn

        this.dirty = true
        this.save()
        this.publish()
    }

    async refreshRoster() {
        if (this.gameState === null) {
            throw new Error("Unable to refresh roster due to null gameState.")
        }

        const seats = await (this.model as any).getGameSessionSeats() as GameSessionSeat[]
        const orderedRoster: Player[] = new Array(seats.length)

        // Note: Array.forEach cannot await async functions
        for (let i = 0; i < seats.length; i++) {
            const seat = seats[i]
            const player = await (seat as any).getPlayer() as Player
            orderedRoster[seat.get('seatNumber') as number] = player
        }

        this.gameState.metadata.roster = []
        orderedRoster.forEach((p, i) => {
            const key = p.get('secretKey') as string
            this.roster.set(key, {player: p, seatNumber: i}) // Update player map roster
            // Update the flat roster (sent to clients)
            this.gameState?.metadata.roster.push({
                key: key,
                username: p.get('displayName') as string,
                online: Connection.playerKeyToConnectionIndex.has(key),
            })
        })
    }

    async subscribeConnection(connection: Connection) {
        if (!connection.isLoggedIn()) return
        if (connection.playerKey === null) {
            throw new Error("Unable to subscribe connection due to null playerKey.")
        }

        if (this.subscribers.has(connection)) return
        this.subscribers.add(connection)

        if (!this.roster.get(connection.playerKey)) {
            await GameSessionSeat.upsert({
                seatNumber: this.roster.size,
                GameSessionId: this.model?.get('id') as number,
                PlayerId: connection.playerModel?.get('id') as number,
            })
            this.dirty = true
        }

        await this.refreshRoster()
        await this.save()
        await this.publish()
    }

    async unsubscribeConnection(connection: Connection) {
        if (!this.subscribers.has(connection)) return
        this.subscribers.delete(connection)
        // This shouldn't change anything in the database, so there's no need to save to the database.
    }

    getGameStateForConnection(connection: Connection): GameState | null {
        if (!connection.isLoggedIn()) {
            connection.logError("Attempted to get specialized game state, but the connection has no logged in player.")
            return null
        }
        if (connection.playerKey === null) {
            connection.logError("Attempted to get specialized game state, but the connection has a null playerKey.")
            return null
        }
        if (!this.roster.has(connection.playerKey)) {
            connection.logError("Attempted to get specialized game state, but the connection's player is not in the roster.")
            return null
        }
        const rosterEntry = this.roster.get(connection.playerKey) as RosterEntry

        if (this.gameState === null) {
            connection.logError("Attempted to get specialized game state, but there is no game state defined.")
            return null
        }
        const result = this.gameState.clone()
        result.metadata.seatNumber = rosterEntry.seatNumber

        if (result.metadata.status == Buffers.GameSessionStatus.PlayerAWin
            || result.metadata.status == Buffers.GameSessionStatus.PlayerBWin) {
            // Don't occlude any state if the game has been won
            return result
        }

        if (rosterEntry.seatNumber == 0) {
            // Player A: Can't see Board B
            result.boardA.visible = true
            result.boardB.visible = false
            result.boardB.atomLocations = undefined
        } else if (rosterEntry.seatNumber == 1) {
            // Player B: Can't see Board A
            result.boardB.visible = true
            result.boardA.visible = false
            result.boardA.atomLocations = undefined
        } else {
            // Spectators can't see either players' boards
            result.boardA.visible = false
            result.boardB.visible = false
            result.boardA.atomLocations = undefined
            result.boardB.atomLocations = undefined
        }
        return result
    }

    async save() {
        if (!this.dirty) return

        if (this.gameState === null) {
            throw new Error(`Attempted to save game, but there is no gameState set. This should never happen.`)
        }

        const serializedGameState = JSON.stringify(this.gameState.toNormalizedObject())
        await this.model?.update({gameState: serializedGameState})

        this.dirty = false
    }

    async publish() {
        this.subscribers.forEach(c => {
            const newState = this.getGameStateForConnection(c)
            if (newState === null) return
            c.sendUpdate(newState)
        })
    }
}

class Connection {
    static playerKeyToConnectionIndex = new Map<string, Connection>()

    private static nextId = 0
    private connectionId: number;

    private socket: WebSocket
    private gameSubscriptions: Game[]

    playerModel: Player | null
    playerKey: string | null

    constructor(socket: WebSocket) {
        this.connectionId = Connection.nextId
        Connection.nextId += 1

        this.socket = socket
        this.playerModel = null
        this.playerKey = null
        this.gameSubscriptions = []
    }

    log(message: string) {
        console.log(`[id=${this.getId()}]: ${message}`)
    }

    logError(message: string) {
        console.error(`[id=${this.getId()}]: ${message}`)
    }

    getId(): number {
        return this.connectionId;
    }

    async login(loginPayload: Buffers.LoginPayload) {
        let registering = loginPayload.register()
        let username = loginPayload.username()
        let key = loginPayload.key()

        if (registering) {
            // Sanitize username
            if (username && username.length > 0) {
                username = username.trim()
                if (username.length > 50) {
                    username = username.slice(0, 50).trim()
                }
            }
            if (username === null || username.length === 0) {
                username = randomName()
            }
            // TODO(bdero): Validate username characters (or don't, because who cares?)

            this.log(`Received registration payload for "${username}"`)
            key = await this.register(username)

            this.loginSuccessful(username, key)
            return
        }

        const player: Player | null = await Player.findOne({
            where: {secretKey: key}
        })

        if (player === null || key === null) {
            this.log(`Received login payload for nonexistent key "${key}" (username: "${username}")`)

            this.socket.send(MessageBuilder.create()
                .setLoginAckPayload(false, "Unknown player key")
                .build())
            return
        }
        this.playerModel = player

        username = player.get('displayName') as string
        this.loginSuccessful(username, key)
    }

    private loginSuccessful(username: string, key: string) {
        Connection.playerKeyToConnectionIndex.set(key, this)
        this.playerKey = key

        this.log(`Login successful for "${key}" (username: "${username}")`)
        this.socket.send(
            MessageBuilder.create()
                .setLoginAckPayload(true, undefined, username, key)
                .build()
        )
    }

    logout() {
        if (!this.isLoggedIn()) return

        this.gameSubscriptions.forEach(s => s.unsubscribeConnection(this));

        if (this.playerModel === null) return
        Connection.playerKeyToConnectionIndex.delete(this.playerModel.get('secretKey') as string)

        // TODO(bdero): Loop through all games this connection is a part of and remove and remove the game from Game.inviteCodeToGameIndex
        // if 0 players are online
    }

    private async register(username: string): Promise<string> {
        let key: string | null = null
        while (key === null) {
            const newKey = `p${generateKey()}`
            const count = await Player.count({
                where: {secretKey: newKey}
            })
            if (count === 0) {
                key = newKey
            }
        }
        this.log(`Registering as "${key}"`)
        this.playerModel = await Player.create({
            displayName: username,
            secretKey: key
        })
        return key
    }

    isLoggedIn(): boolean {
        return this.playerModel != null
    }

    private async createMetadataFromSessionModel(gameSession: GameSession): Promise<GameMetadata> {
        const gameState = JSON.parse(gameSession.get('gameState') as string)
        return GameState.fromNormalizedObject(gameState).metadata
    }

    async listGames() {
        if (!this.isLoggedIn()) {
            this.logError("Requested to list games, but the connection is not logged in")
            this.socket.send(
                MessageBuilder.create()
                    .setListGamesAckPayload(false, "Not logged in")
                    .build()
            )
            return
        }

        // TODO(bdero): Figure out how to get these dynamic model getters typed correctly
        const gameSessions: GameSession[] = await (this.playerModel as any).getGameSessions() as GameSession[]
        const metadatas = await Promise.all(gameSessions.map(s => this.createMetadataFromSessionModel(s)))
        this.log(`Listing ${metadatas.length} game(s)`)

        this.socket.send(
            MessageBuilder.create()
                .setListGamesAckPayload(true, undefined, metadatas)
                .build()
        )
    }

    async joinGame(joinPayload: Buffers.JoinGamePayload) {
        if (!this.isLoggedIn()) {
            this.logError("Requested to join game, but the connection is not logged in")
            this.socket.send(
                MessageBuilder.create()
                    .setJoinGameAckPayload(false, "Not logged in")
                    .build()
            )
            return
        }
        let inviteCode: string
        if (joinPayload.createGame()) {
            inviteCode = await this.createGame()
        } else {
            const code = joinPayload.inviteCode()
            if (code === null) {
                this.logError("Requested to join game, but the invite code supplied is null")
                return
            }
            inviteCode = code
        }

        const game = await Game.fromInviteCode(inviteCode, this)
        if (game === null) {
            this.logError(`Requested to join game for nonexistent invite code: ${inviteCode}`)
            this.socket.send(
                MessageBuilder.create()
                    .setJoinGameAckPayload(false, "Game session not found")
                    .build()
            )
            return
        }
        const gameState = game.getGameStateForConnection(this)
        if (gameState === null) {
            this.logError(`Requested to join game ${inviteCode}, but failed to get specialized connection state for connection`)
            return
        }
        this.socket.send(
            MessageBuilder.create()
                .setJoinGameAckPayload(true, undefined, inviteCode, gameState)
                .build()
        )
    }

    validateGameMessage(payloadName: string, inviteCode: string): boolean {
        if (!this.isLoggedIn()) {
            this.logError(`Received "${payloadName}", for game "${inviteCode}" but the connection is not logged in`)
            return false
        }
        if (!Game.inviteCodeToGameIndex.has(inviteCode)) {
            this.logError(`Received "${payloadName}" for nonexistent invite code: ${inviteCode}`)
            return false
        }
        return true
    }

    async setAtoms(setAtomsPayload: Buffers.SetAtomsPayload) {
        const inviteCode = setAtomsPayload.inviteCode()
        if (inviteCode === null) return
        if (!this.validateGameMessage("SetAtomsPayload", inviteCode)) return

        const atomsLength = setAtomsPayload.atomLocationsLength()
        if (atomsLength !== 4) {
            this.logError(
                `Received "SetAtomsPayload" with ${setAtomsPayload.atomLocationsLength()} atom(s), but exactly 4 is required`)
            return
        }

        const atoms: Vector2[] = []
        for (let i = 0; i < atomsLength; i++) {
            const a: Buffers.Vec2 = setAtomsPayload.atomLocations(i) as Buffers.Vec2
            atoms.push(new Vector2(a.x(), a.y()))
        }

        const game = await Game.fromInviteCode(inviteCode, null)
        if (game === null) {
            this.logError(
                `Unable to retreive game from invite code: ${inviteCode}`
            )
            return
        }
        await game.setAtoms(this, atoms)
    }

    async submitSolution(submitSolutionPayload: Buffers.SubmitSolutionPayload) {
        const inviteCode = submitSolutionPayload.inviteCode()
        if (inviteCode === null) return
        if (!this.validateGameMessage("SubmitSolutionPayload", inviteCode)) return

        const atomsLength = submitSolutionPayload.atomLocationsLength()
        if (atomsLength !== 4) {
            this.logError(
                `Received "SubmitAtomsPayload" with ${submitSolutionPayload.atomLocationsLength()} atom(s), but exactly 4 is required`)
            return
        }

        const atoms: Vector2[] = []
        for (let i = 0; i < atomsLength; i++) {
            const a: Buffers.Vec2 = submitSolutionPayload.atomLocations(i) as Buffers.Vec2
            atoms.push(new Vector2(a.x(), a.y()))
        }

        const game = await Game.fromInviteCode(inviteCode, null)
        if (game === null) {
            this.logError(
                `Unable to retreive game from invite code: ${inviteCode}`
            )
            return
        }
        await game.submitSolution(this, atoms)
    }

    async submitMove(submitMovePayload: Buffers.SubmitMovePayload) {
        const inviteCode = submitMovePayload.inviteCode()
        if (inviteCode === null) return
        if (!this.validateGameMessage("SubmitMovePayload", inviteCode)) return

        const moveProto = submitMovePayload.move() as Buffers.Vec2
        const move = new Vector2(moveProto.x(), moveProto.y())

        const game = await Game.fromInviteCode(inviteCode, null)
        if (game === null) {
            this.logError(
                `Unable to retreive game from invite code: ${inviteCode}`
            )
            return
        }
        await game.submitMove(this, move)
    }

    private async createGame(): Promise<string> {
        let key: string | null = null
        while (key === null) {
            const newKey = `g${generateKey()}`
            const count = await GameSession.count({
                where: {inviteCode: newKey}
            })
            if (count === 0) {
                key = newKey
            }
        }
        this.log(`Creating new game with invite key "${key}"`)
        const gameState = GameState.createNew(key).toNormalizedObject()
        const serializedGameState = JSON.stringify(gameState)
        // TODO(bdero): What happens when this fails? Does sequelize throw an exception that needs to be caught?
        await GameSession.create({
            inviteCode: key,
            gameState: serializedGameState,
        })
        return key
    }

    public async sendUpdate(newState: GameState) {
        this.socket.send(
            MessageBuilder.create()
                .setUpdateGamePayload(newState)
                .build()
        )
    }
}

const dispatcher = new MessageDispatcher()
dispatcher.register(
    Buffers.AnyPayload.LoginPayload,
    Buffers.LoginPayload,
    (connection: Connection, payload: Buffers.LoginPayload) => connection.login(payload)
)
dispatcher.register(
    Buffers.AnyPayload.ListGamesPayload,
    Buffers.ListGamesPayload,
    (connection: Connection, payload: Buffers.ListGamesPayload) => connection.listGames()
)
dispatcher.register(
    Buffers.AnyPayload.JoinGamePayload,
    Buffers.JoinGamePayload,
    (connection: Connection, payload: Buffers.JoinGamePayload) => connection.joinGame(payload)
)
dispatcher.register(
    Buffers.AnyPayload.SetAtomsPayload,
    Buffers.SetAtomsPayload,
    (connection: Connection, payload: Buffers.SetAtomsPayload) => connection.setAtoms(payload)
)
dispatcher.register(
    Buffers.AnyPayload.SubmitSolutionPayload,
    Buffers.SubmitSolutionPayload,
    (connection: Connection, payload: Buffers.SubmitSolutionPayload) => connection.submitSolution(payload)
)
dispatcher.register(
    Buffers.AnyPayload.SubmitMovePayload,
    Buffers.SubmitMovePayload,
    (connection: Connection, payload: Buffers.SubmitMovePayload) => connection.submitMove(payload)
)

const connectionMap: Map<WebSocket, Connection> = new Map()

export {dispatcher, connectionMap, Connection}
