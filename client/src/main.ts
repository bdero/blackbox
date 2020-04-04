import {flatbuffers} from "flatbuffers"

// Using a symlink to the shared directory in order to work around a parceljs bug:
// https://github.com/parcel-bundler/parcel/issues/2978
import {BlackBox as Buffers} from "./shared/src/protos/messages_generated"
import {MessageMap, dispatchMessage} from "./shared/src/dispatch"

const messageMap: MessageMap = {}

class MessageBuilder {
    private builder: flatbuffers.Builder
    private payloadType: Buffers.AnyPayload
    private payloadOffset: number | null

    constructor() {
        this.builder = new flatbuffers.Builder()
        this.payloadType = Buffers.AnyPayload.NONE
        this.payloadOffset = null
    }

    static create(): MessageBuilder {
        return new MessageBuilder()
    }

    setLoginPayload(username: string, key: string | null = null): MessageBuilder {
        this.payloadType = Buffers.AnyPayload.LoginPayload
        
        const usernameOffset = this.builder.createString(username)
        Buffers.LoginPayload.startLoginPayload(this.builder)
        Buffers.LoginPayload.addUsername(this.builder, usernameOffset)
        if (key !== null) {
            const keyOffset = this.builder.createString(key)
            Buffers.LoginPayload.addKey(this.builder, keyOffset)
        }

        this.payloadOffset = Buffers.LoginPayload.endLoginPayload(this.builder)

        return this
    }

    build(): Uint8Array {
        if (this.payloadType === Buffers.AnyPayload.NONE || this.payloadOffset === null) {
            throw new Error("Unable to build message without a payload")
        }

        Buffers.Message.startMessage(this.builder)
        Buffers.Message.addPayloadType(this.builder, this.payloadType)
        Buffers.Message.addPayload(this.builder, this.payloadOffset)
        const messageOffset = Buffers.Message.endMessage(this.builder)
        
        this.builder.finish(messageOffset)
        return this.builder.asUint8Array()
    }
}

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
