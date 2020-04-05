import {flatbuffers} from "flatbuffers"

// Using a symlink to the shared directory in order to work around a parceljs bug:
// https://github.com/parcel-bundler/parcel/issues/2978
import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageBuilder} from "./shared/src/messages"


const socket = new WebSocket("ws://localhost:8888")

const existingKey: string | null = localStorage.getItem("userKey")
if (existingKey === null) {
    console.log("No previous user on record")
} else {
    console.log("Previous user exists")
}

socket.onopen = (event) => {
    socket.send(
        MessageBuilder
            .create()
            .setLoginPayload("bdero", existingKey)
            .build()
    )
}
socket.onmessage = (event) => {
    console.log(`Message received from server: ${event.data}`)
}
