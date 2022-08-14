let MorriganClient = require('./client')
let settings = require('./client.settings')

let client = MorriganClient(settings, console.log)

const handleSignal = (e) => {
    client.stop(e)
}

process.on('SIGTERM', handleSignal)
process.on('SIGINT',  handleSignal)
process.on('SIGHUP',  handleSignal)