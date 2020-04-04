import WebSocket = require("ws")
import {flatbuffers} from "flatbuffers"

import {BlackBox as Buffers} from "./protos/messages_generated"

type MessageMap = {
    [key: number]: {
        payloadType: any,
        dispatch: (socket: WebSocket, payload: any) => void
    }
}

function dispatchMessage(messageMap: MessageMap, socket: WebSocket, data: Uint8Array) {
    const buf = new flatbuffers.ByteBuffer(data)
    const message = Buffers.Message.getRootAsMessage(buf)
    const payloadType = message.payloadType()
    if (!(payloadType in messageMap)) {
        console.log(`Received invalid message with payload type ${payloadType}`)
        return
    }
    const payloadClass = messageMap[payloadType].payloadType
    const payload = message.payload(new payloadClass())
    messageMap[payloadType].dispatch(socket, payload)
}

export {MessageMap, dispatchMessage}
