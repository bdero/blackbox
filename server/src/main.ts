import WebSocket = require('ws')
import Flags from "./flags"



const wss = new WebSocket.Server({port: Flags["--port"].value})
console.log(Flags["--port"].value)