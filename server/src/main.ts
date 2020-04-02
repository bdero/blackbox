import WebSocket = require("ws")
import Flags from "./flags"
import {BlackBox as Buffers} from "../../shared/protos/messages_generated"

const builder = new flatbuffers.Builder();

const wss = new WebSocket.Server({port: Flags["--port"].value})
console.log(Flags["--port"].value)