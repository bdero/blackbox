import * as http from "http"
import WebSocket = require("ws")
import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "../../shared/protos/messages_generated"
import Flags from "./flags"

const builder = new flatbuffers.Builder()

const httpServer = http.createServer()
const wsServer = new WebSocket.Server({ noServer: true })

wsServer.on("connection", (socket, request) => {
    console.log("New connection!")
    socket.on("message", (data) => {
        const buf = new flatbuffers.ByteBuffer(data as Uint8Array)
        const message = Buffers.Message.getRootAsMessage(buf)
        const payloadType = message.payloadType()
        if (payloadType === Buffers.AnyPayload.LoginPayload) {
            const username = message.payload(new Buffers.LoginPayload()).username()

            console.log(`Received login payload for username ${username}`)
            socket.send(`You have logged in as ${username}`)
        }
    })
})

httpServer.on("upgrade", (request, socket, head) => {
    //TODO(bdero): Do authentication

    console.log("Performing protocol upgrade")
    wsServer.handleUpgrade(request, socket, head, (socket) => {
        wsServer.emit("connection", socket, request)
    })
})

const port = Flags["--port"].value;
console.log(`Starting websocket server on port ${port}...`)
httpServer.listen(port)
