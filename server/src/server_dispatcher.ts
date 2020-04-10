import WebSocket = require("ws")

import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder, MessageDispatcher, GameMetadata, GameState} from "./shared/src/messages"
import {randomName} from "./shared/src/word_lists"
import {sqliteDBInit, Player, GameSession, GameSessionSeat} from "./database"
import { runInThisContext } from "vm"

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BASE58_SET = new Set(BASE58_CHARS)
function generatePlayerKey(): string {
    let key = ""
    for (let i = 0; i < 64; i++) {
        key += BASE58_CHARS[Math.floor(Math.random() * BASE58_CHARS.length)]
    }
    return key
}

class Game {
    static inviteCodeToGameIndex = new Map<String, Game>()

    private model: GameSession
    private gameState: GameState
    private roster: Map<String, Player> // secretKeys to player
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
     * This should only ever be used in a situation where a connection is trying to subscribe to a game.
     * @param inviteCode
     * @param newSubscriber
     */
    static async fromInviteCode(inviteCode: string, newSubscriber: Connection): Promise<Game | null> {
        if (Game.inviteCodeToGameIndex.has(inviteCode)) {
            const cachedGame = Game.inviteCodeToGameIndex.get(inviteCode)
            cachedGame.subscribeConnection(newSubscriber)
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
        result.subscribeConnection(newSubscriber) // Also populates the roster

        Game.inviteCodeToGameIndex.set(inviteCode, result)
        return result
    }

    async refreshRoster() {
        const seats = await (this.model as any).getGameSessionSeats() as GameSessionSeat[]
        const orderedRoster: Player[] = new Array(seats.length)
        seats.forEach(async s => {
            const player = await (s as any).getPlayer() as Player
            orderedRoster[s.get('seatNumber') as number] = player
        })

        this.gameState.metadata.roster = []
        orderedRoster.forEach(p => {
            const key = p.get('secretKey') as string
            this.roster.set(key, p) // Update player map roster
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

        await GameSessionSeat.upsert({
            seatNumber: this.roster.size,
            GameSessionId: this.model.get('id') as number,
            PlayerId: connection.playerModel.get('id') as number,
        })
        this.dirty = true

        this.refreshRoster()
        this.save()
        this.publish()
    }

    async unsubscribeConnection(connection: Connection) {
        if (!this.subscribers.has(connection)) return
        this.subscribers.delete(connection)
        // This shouldn't change anything in the database, so there's no need to save to the database.
    }

    getGameStateForConnection(connection: Connection): GameState | null {
        if (!connection.isLoggedIn) return null

        const result = this.gameState.clone()

        return result
    }

    save() {
        if (!this.dirty) return

        this.dirty = false
    }

    publish() {

    }
}

class Connection {
    static playerKeyToConnectionIndex = new Map<string, Connection>()

    private static nextId = 0
    private connectionId: number;

    private socket: WebSocket
    private gameSubscriptions: Game[]

    playerModel: Player | null

    constructor(socket: WebSocket) {
        this.connectionId = Connection.nextId
        Connection.nextId += 1

        this.socket = socket
        this.playerModel = null
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
    }

    private async register(username: string): Promise<string> {
        let key: string = null
        while (key === null) {
            const newKey = generatePlayerKey()
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
        const result = new GameMetadata()
        // TODO(bdero): Populate the game metadata
        return result
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
        if (joinPayload.createGame()) {
            await this.createGame()
            return
        }
    }

    private async createGame() {

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
