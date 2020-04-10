import * as http from "http"
import WebSocket = require("ws")

import Flags from "./flags"
import {sqliteDBInit} from "./database"
import {dispatcher, connectionMap, Connection} from "./server_dispatcher"

const httpServer = http.createServer()
const wsServer = new WebSocket.Server({ noServer: true })

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

        connection.logout()
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
