import * as http from "http"
import WebSocket = require("ws")
import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder, MessageDispatcher} from "./shared/src/messages"
import {randomName} from "./shared/src/word_lists"
import Flags from "./flags"
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
    
    async login(username: string, key: string) {
        username = username.trim()
        if (username.length > 40) {
            username = username.slice(0, 40).trim()
        }
        if (username.length === 0) {
            username = randomName()
        }
        // TODO(bdero): Validate username characters (or don't, because who cares?)

        const resultKey: string = null
        if (key === null) {
            this.log(`Received registration payload for "${username}"`)
            key = await this.register(username)
        } else {
            const playerQuery: Array<Player> = await Player.findAll({
                where: {secretKey: key}
            })
            if (playerQuery.length === 0) {
                this.logError(`Received login payload for nonexistent key "${key}" (username: "${username}"); registering instead`)
                key = await this.register(username)
            } else {
                username = playerQuery[0].get('displayName') as string
            }
        }
        this.socket.send(
            MessageBuilder.create()
                .setLoginAckPayload(true, undefined, username, key)
                .build())
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
}

const httpServer = http.createServer()
const wsServer = new WebSocket.Server({ noServer: true })

const dispatcher = new MessageDispatcher()
dispatcher.register(
    Buffers.AnyPayload.LoginPayload,
    Buffers.LoginPayload,
    (connection: Connection, payload: Buffers.LoginPayload) => {
        const username = payload.username()
        const key = payload.key()
        connection.login(username, key)
    }
)

const connectionMap: Map<WebSocket, Connection> = new Map()

wsServer.on("connection", (socket, request) => {
    const connection = new Connection(socket)
    connectionMap.set(socket, connection)
    
    connection.log(`New socket connection: id=${connection.getId()}`)

    socket.on("message", (data) => {
        if (!(connectionMap.has(socket))) {
            connection.logError(`Received message from untracked connection id=${connection.getId()}; closing socket`)
            socket.close(undefined, "Connection untracked")
            return
        }
        dispatcher.dispatch(connection, data as Uint8Array)
    })
    socket.on("close", (code: number, reason: string) => {
        if (!(connectionMap.has(socket))) {
            connection.logError(`Received close message for untracked connection id=${connection.getId()}`)
        }
        connection.log(`Socket connection id=${connection.getId()} closed with code "${code}"; reason: ${reason}`)
        connectionMap.delete(socket)
    })
})

httpServer.on("upgrade", (request, socket, head) => {
    //TODO(bdero): Do authentication

    console.log("Performing protocol upgrade")
    wsServer.handleUpgrade(request, socket, head, (socket) => {
        wsServer.emit("connection", socket, request)
    })
})

sqliteDBInit().then(() => {
    const port = Flags["--port"].value;
    console.log(`Starting websocket server on port ${port}...`)
    httpServer.listen(port)
})
