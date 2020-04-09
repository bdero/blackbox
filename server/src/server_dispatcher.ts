import WebSocket = require("ws")

import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder, MessageDispatcher, GameMetadata} from "./shared/src/messages"
import {randomName} from "./shared/src/word_lists"
import {sqliteDBInit, Player, GameSession, GameSessionSeat} from "./database"

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BASE58_SET = new Set(BASE58_CHARS)
function generatePlayerKey(): string {
    let key = ""
    for (let i = 0; i < 64; i++) {
        key += BASE58_CHARS[Math.floor(Math.random() * BASE58_CHARS.length)]
    }
    return key
}

class Connection {
    private static nextId = 0
    private connectionId: number;

    private socket: WebSocket
    private playerModel: Player | null

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

            this.socket.send(MessageBuilder.create()
                .setLoginAckPayload(true, undefined, username, key)
                .build())
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
        this.log(`Login successful for "${key}" (username: "${username}")`)
        this.socket.send(
            MessageBuilder.create()
                .setLoginAckPayload(true, undefined, username, key)
                .build()
        )
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

    private isLoggedIn(): boolean {
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

const connectionMap: Map<WebSocket, Connection> = new Map()

export {dispatcher, connectionMap, Connection}
