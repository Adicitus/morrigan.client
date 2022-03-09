"use strict"

const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const argv = yargs(hideBin(process.argv)).argv

const WebSocket = require('ws')
const fs = require('fs')

let clientSettingsPath = `${__dirname}/client.settings`

if (argv.settingsFile) {
    let sfp = argv.settingsFile

    let r = (sfp.match(/^(?<module>.*)\.js$/))
    
    if (r && fs.existsSync(sfp)) {
        clientSettingsPath = r.groups.module
    }
}

var settings = {}

if (fs.existsSync(`${clientSettingsPath}.js`)) {
    settings = require(clientSettingsPath)
}

var stateDir = (settings.stateDir) ? settings.stateDir : `${__dirname}/state`

if (argv.stateDir) {
    stateDir = argv.stateDir
}

function log(msg) {
    console.log(`${new Date()} | ${msg}`)
}

if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, {recursive: true})
}


/**
 * Handlers should be defined as modules and loaded from the 'providers' directory.
 * Provider modules should export a 'version' string and optionally:
 *  + A 'messages' object. Each key on the 'messages' object should
 *    define a handler that can accept the message object received
 *    from the server, a connection object and the core environment.
 *  + A 'setup' function that will be called with the core environment
 *    as parameter once client has finished initializing.
 *  + A 'onConnect' function that will be called when the client
 *    connects to a server.
 *  + A 'onDisconnect' function that will be called when the connection
 *    the server is closed.
 *  + A 'onStop' function that is called when the client receives a stop
 *    signal rom the OS.
 */
function loadProviders(providersList, providers) {

    if (!providers) {
        providers = {}
    }

    if (!Array.isArray(providersList)) {
        providersList = [providersList]
    }

    providersList.forEach(packageName => {
        try {
            log(`Loading '${packageName}'...`)
            let provider = require(packageName)
            let name = packageName
            if (provider.name) {
                name = provider.name
                log(`Registering '${packageName}' as '${name}'...`)
            }
            providers[name] = provider
        } catch (e) {
            log(`Failed to read provider module '${packageName}': ${e}`)
        } 
    })

    return providers
}
// Loading core providers:
var providers = loadProviders(settings.providers, providers)

/**
 * Core environment object, passed to all message handlers and setup functions.
 */
const coreEnv = {
    'settings': settings,
    'args': argv,
    'providers': providers,
    'log': log,
    'stateDir': stateDir
}

for (const p in providers) {
    let provider = providers[p]
    if (provider.setup) {
        provider.setup(coreEnv)
    }
}


/**
 * Main function, tries to connect to a server.
 */
function connect() {

    var reconnect = true
    var reportURL = ""
    if(argv.reportURL) {
        reportURL = argv.reportURL
    } else if(settings.reportURL) {
        reportURL = settings.reportURL
    } else {
        throw new Error('No reportURL specified.')
    }

    log(`Connecting to '${reportURL}'`)

    const connection = new WebSocket(reportURL, { origin: providers.client.getToken()})

    connection.on('error', (e) => {
        console.log(`${new Date()} | Failed to contact server: ${e}`)
    })

    connection.on('open', () => {
        console.log(`${new Date()} | Connection to server opened.`)

        for (const n in providers) {
            let p = providers[n]

            if (p.onConnect) {
                p.onConnect(connection, coreEnv)
            }
        }

    })

    connection.on('message', (message) => {

        try {
            var msg = JSON.parse(message)
        } catch (e) {
            log(`Invalid message received from server (not valid JSON): ${message}`)
            return
        }

        if (!msg.type) {
            log(`Invalid message received from server (no type declaration): ${message}`)
            return
        }

        let m = msg.type.match(/^(?<provider>[A-z0-9\-_]+)\.(?<message>[A-z0-9\-_.]+)$/)

        if (!m) {
            log(`Invalid message received from server (invalid type format): ${message}`)
            return
        }

        let p = providers[m.groups.provider]

        if (!p) {
            log(`No provider for the given message type: ${message}`)
            return
        }

        let h = p.messages[m.groups.message]

        if (!h) {
            log(`The provider does not support the given message type: ${message}`)
            return
        }

        try {
            h(msg, connection, coreEnv)
        } catch(e) {
            log(`Exception occured while processing message: ${e}`)
        }

    })

    connection.on('close', (e) => {
        log(`Connection to server closed`)

        for (const n in providers) {
            let p = providers[n]
    
            if (p.onDisconnect) {
                p.onDisconnect(connection, coreEnv)
            }
        }

        if (reconnect) {
            log(`Attempting to reconnect in 30 seconds: ${e}`)
            setTimeout(connect, 30000)
        }
    })

    const handleSignal = (e) => {
        console.log(e)
        reconnect = false
        if (connection.readyState === 1) {
            connection.send(JSON.stringify({
                type: 'client.state',
                state: `stopped.${e}`
            }))
            connection.close()

            /*
             * Calling 'onDisconnect' handlers here because the 'close' event
             * on ws connection objects does not get called when the 'close'
             * method is called.
             */
            for (const n in providers) {
                let p = providers[n]
        
                if (p.onDisconnect) {
                    p.onDisconnect(connection, coreEnv)
                }
            }
        }

        for (const n in providers) {
            let p = providers[n]
    
            if (p.onStop) {
                p.onStop(e, connection, coreEnv)
            }
        }

        process.exit()
    }

    process.on('SIGTERM', handleSignal)
    process.on('SIGINT',  handleSignal)
    process.on('SIGHUP',  handleSignal)

}


connect()