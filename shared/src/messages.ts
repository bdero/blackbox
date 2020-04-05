import WebSocket = require("ws")
import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "./protos/messages_generated"

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

type MessageHandler = (socket: WebSocket, payload: any) => void
type MessageMap = {
    [key: number]: {
        payloadType: any,
        dispatch: MessageHandler
    }
}

class MessageDispatcher {
    private messageMap: MessageMap

    constructor() {
        this.messageMap = {}
    }

    register(payloadId: number, payloadType: any, callback: MessageHandler) {
        this.messageMap[payloadId] = {
            payloadType,
            dispatch: callback,
        }
    }

    has(payloadId: number): boolean {
        return payloadId in this.messageMap
    }

    dispatch(socket: WebSocket, data: Uint8Array) {
        const buf = new flatbuffers.ByteBuffer(data)
        const message = Buffers.Message.getRootAsMessage(buf)
        const payloadType = message.payloadType()
        if (!(payloadType in this.messageMap)) {
            console.log(`Received invalid message with payload type ${payloadType}`)
            return
        }
        const payloadClass = this.messageMap[payloadType].payloadType
        const payload = message.payload(new payloadClass())
        this.messageMap[payloadType].dispatch(socket, payload)
    }
}

export {MessageBuilder, MessageDispatcher}
