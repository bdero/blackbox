import WebSocket = require("ws")

import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder, MessageDispatcher, GameMetadata, GameState} from "./shared/src/messages"
import {randomName} from "./shared/src/word_lists"
import {Player, GameSession, GameSessionSeat} from "./database"

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BASE58_SET = new Set(BASE58_CHARS)
function generateKey(): string {
    let key = ""
    for (let i = 0; i < 64; i++) {
        key += BASE58_CHARS[Math.floor(Math.random() * BASE58_CHARS.length)]
    }
    return key
}

class Game {
    static inviteCodeToGameIndex = new Map<String, Game>()

    gameState: GameState
    private model: GameSession
    private roster: Map<String, {player: Player, seatNumber: number}> // secretKeys to player
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
     * This should only ever be used in a situation where a connection is trying to subscribe to an existing game.
     * @param inviteCode
     * @param newSubscriber
     */
    static async fromInviteCode(inviteCode: string, newSubscriber: Connection): Promise<Game | null> {
        if (Game.inviteCodeToGameIndex.has(inviteCode)) {
            const cachedGame = Game.inviteCodeToGameIndex.get(inviteCode)
            await cachedGame.subscribeConnection(newSubscriber)
            return cachedGame
        }

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
        await result.subscribeConnection(newSubscriber) // Also populates the roster

        Game.inviteCodeToGameIndex.set(inviteCode, result)
        return result
    }

    async refreshRoster() {
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
            this.gameState.metadata.roster.push({
                key: key,
                username: p.get('displayName') as string,
                online: Connection.playerKeyToConnectionIndex.has(key),
            })
        })
    }

    async subscribeConnection(connection: Connection) {
        if (!connection.isLoggedIn()) return

        if (this.subscribers.has(connection)) return
        this.subscribers.add(connection)

        if (!this.roster.get(connection.playerKey)) {
            await GameSessionSeat.upsert({
                seatNumber: this.roster.size,
                GameSessionId: this.model.get('id') as number,
                PlayerId: connection.playerModel.get('id') as number,
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
            connection.logError("Attempted to get specialized game state, but the connection has no logged in player")
            return null
        }
        if (!this.roster.has(connection.playerKey)) {
            connection.logError("Attempted to get specialized game state, but the connection's player is not in the roster")
            return null
        }
        const rosterEntry = this.roster.get(connection.playerKey)

        const result = this.gameState.clone()
        if (result.metadata.status == Buffers.GameSessionStatus.PlayerAWin
            || result.metadata.status == Buffers.GameSessionStatus.PlayerBWin) {
            // Don't occlude any state if the game has been won
            return result
        }

        result.metadata.seatNumber = rosterEntry.seatNumber
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

        const serializedGameState = JSON.stringify(this.gameState.toNormalizedObject())
        await this.model.update({gameState: serializedGameState})

        this.dirty = false
    }

    async publish() {
        this.subscribers.forEach(c => {
            const newState = this.getGameStateForConnection(c)
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

        const resultKey: string = null
        if (registering) {
            // Sanitize username
            username = username.trim()
            if (username.length > 50) {
                username = username.slice(0, 50).trim()
            }
            if (username.length === 0) {
                username = randomName()
            }
            // TODO(bdero): Validate username characters (or don't, because who cares?)

            this.log(`Received registration payload for "${username}"`)
            key = await this.register(username)

            this.loginSuccessful(username, key)
            return
        }

        const player: Player = await Player.findOne({
            where: {secretKey: key}
        })

        if (player === null) {
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
        Connection.playerKeyToConnectionIndex.delete(this.playerModel.get('secretKey') as string)

        // TODO(bdero): Loop through all games this connection is a part of and remove and remove the game from Game.inviteCodeToGameIndex
        // if 0 players are online
    }

    private async register(username: string): Promise<string> {
        let key: string = null
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
            inviteCode = joinPayload.inviteCode()
        }

        const game = await Game.fromInviteCode(inviteCode, this)
        if (game === null) {
            this.logError(`Requested to join game for nonexistent invite code: ${inviteCode}`)
            this.socket.send(
                MessageBuilder.create()
                    .setJoinGameAckPayload(false, "Game session not found")
                    .build()
            )
        }
        this.socket.send(
            MessageBuilder.create()
                .setJoinGameAckPayload(true, undefined, inviteCode, game.getGameStateForConnection(this))
                .build()
        )
    }

    private async createGame(): Promise<string> {
        let key: string = null
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

const connectionMap: Map<WebSocket, Connection> = new Map()

export {dispatcher, connectionMap, Connection}
