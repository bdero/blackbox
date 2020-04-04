import * as http from "http"
import WebSocket = require("ws")
import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "../../shared/src/protos/messages_generated"
import {MessageMap, dispatchMessage} from "../../shared/src/dispatch"
import Flags from "./flags"
import {sqliteDBInit, Player, GameSession, GameSessionSeat} from "./database"

function generatePlayerKey(): string {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    let key = ""
    for (let i = 0; i < 64; i++) {
        key += chars[Math.floor(Math.random() * chars.length)]
    }
    return key
}

const httpServer = http.createServer()
const wsServer = new WebSocket.Server({ noServer: true })


const messageMap: MessageMap = {}
messageMap[Buffers.AnyPayload.LoginPayload] = {
    payloadType: Buffers.LoginPayload,
    dispatch: (socket: WebSocket, payload: Buffers.LoginPayload) => {
        const username = payload.username()

        if (payload.key === null) {
            console.log(`Received registration payload for "${username}"`)
        }
        console.log(`Received login payload for username ${username}`)
        socket.send(`You have logged in as ${username}`)
    }
}



wsServer.on("connection", (socket, request) => {
    console.log("New connection!")
    socket.on("message", (data) => {
        dispatchMessage(messageMap, socket, data as Uint8Array)
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
