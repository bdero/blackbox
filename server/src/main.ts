import * as http from "http"
import WebSocket = require("ws")
import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageDispatcher} from "./shared/src/messages"
import Flags from "./flags"
import {sqliteDBInit, Player, GameSession, GameSessionSeat} from "./database"

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
function generatePlayerKey(): string {
    let key = ""
    for (let i = 0; i < 64; i++) {
        key += BASE58_CHARS[Math.floor(Math.random() * BASE58_CHARS.length)]
    }
    return key
}

const httpServer = http.createServer()
const wsServer = new WebSocket.Server({ noServer: true })

const dispatcher = new MessageDispatcher()
dispatcher.register(
    Buffers.AnyPayload.LoginPayload,
    Buffers.LoginPayload,
    (socket: WebSocket, payload: Buffers.LoginPayload) => {
        const username = payload.username()
        const key = payload.key()

        console.log(`Payload key: ${key}`)
        if (key === null) {
            console.log(`Received registration payload for "${username}"`)
        }
        console.log(`Received login payload for username ${username}`)
        socket.send(`You have logged in as ${username}`)
    }
)

wsServer.on("connection", (socket, request) => {
    console.log("New connection!")
    socket.on("message", (data) => {
        dispatcher.dispatch(socket, data as Uint8Array)
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
