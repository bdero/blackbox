import {flatbuffers} from "flatbuffers"

// Using a symlink to the shared directory in order to work around a parceljs bug:
// https://github.com/parcel-bundler/parcel/issues/2978
import {BlackBox as Buffers} from "./shared/protos/messages_generated"

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
