import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "../../shared/protos/messages_generated"

const builder = new flatbuffers.Builder()
Buffers.Message.startMessage(builder)
const loginMessage = builder.asUint8Array();

const socket = new WebSocket("ws://localhost:8888")

socket.onopen = (event) => {
    socket.send(loginMessage)
}
socket.onmessage = (event) => {
    console.log(`Message received from server: ${event.data}`)
}
