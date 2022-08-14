"use strict"

const WebSocket = require('ws')
const fs = require('fs')

class MorriganClient {

    settings = null

    /**
     * Providers loaded onto this client.
     */
    providers = null
    /**
     * Environment object passed to providers during setup, when
     * they handle messages and when on disconnect.
     */
    coreEnv = null
    /**
     * Path to a folder where the client should store any data
     * that needs to persists between runs.
     */
    statedir = null
    /**
     * Function to be used by client to post log messages.
     * Only outputs to the console by default.
     */
    log = (msg) => {
        console.log(`${new Date()} | ${msg}`)
    }

    /**
     * Current WebSocket connection object.
     */
    connection = null
    /* Flag to determine if the client should attempt to reconnect
     * automatically if disconnected.
     */
    alwaysReconnect = false
    /**
     * Interval between reconnection attempts (in seconds).
     */
    reconnectIntervalSeconds = 30

    constructor (settings, log) {

        this.settings = settings

        if (log) {
            this.log = log
        } else {
            this.log = (msg) => {
                console.log(`${new Date()} | ${msg}`)
            }
        }

        this.stateDir = (settings.stateDir) ? settings.stateDir : `${__dirname}/state`
        
        console.log(`path '${this.stateDir}'`)

        if (!fs.existsSync(this.stateDir)) {
            fs.mkdirSync(this.stateDir, {recursive: true})
        }

        this.providers = this.loadProviders(settings.providers)

        this.coreEnv = {
            'settings': settings,
            'providers': this.providers,
            'log': this.log,
            'stateDir': this.stateDir
        }

        for (const p in this.providers) {
            let provider = this.providers[p]
            if (provider.setup) {
                provider.setup(this.coreEnv)
            }
        }
    }

    /**
     * Sends a message to the server.
     * 
     * @param {object} message Message object to send. 
     */
    send(message) {
        // 1. Verify state of connection to server:
        if (!this.connection) {
            throw new Error(`Unable to send message: No WebSocket connection established.`)
        }

        if (this.connection.readyState !== 1) {
            throw new Error(`Unable to send message: WebSocket connection was in a non-ready state (found '${this.connection.readyState}', expected '1')`)
        }

        // 2. Verify that message format is correct:
        if (typeof message.type !== 'string') {
            throw new Error(`Unable to send message: Invalid message 'type' declaration (found '${typeof message.type}', expected 'string')`)
        }

        // 3. Send message
        this.connection.send(JSON.stringify(message))
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
    loadProviders(providersList) {

        
        let providers = {}

        if (!Array.isArray(providersList)) {
            providersList = [providersList]
        }

        providersList.forEach(packageName => {

            switch (typeof packageName) {
                case 'string':
                    // Package name
                    try {
                        this.log(`Loading '${packageName}'...`)
                        let provider = require(packageName)
                        let name = packageName
                        if (provider.name) {
                            name = provider.name
                            this.log(`Registering '${packageName}' as '${name}'...`)
                        }
                        providers[name] = provider
                    } catch (e) {
                        this.log(`Failed to read provider module '${packageName}': ${e}`)
                    }
                    break
                case 'object':
                    // Preloaded module
                    let name = packageName.name

                    if (!name || typeof name !== 'string') {
                        return
                    }

                    this.log(`Registering pre-loaded module as '${name}'...`)

                    providers[name] = packageName

                    break
            }
        })

        return providers
    }


    /**
     * Main function, tries to connect to a server.
     */
    connect() {

        let self = this

        var reportURL = ""
        
        if(this.settings.reportURL) {
            reportURL = this.settings.reportURL
        } else {
            throw new Error('No reportURL specified.')
        }

        this.log(`Connecting to '${reportURL}'`)

        const connection = new WebSocket(reportURL, { origin: this.providers.client.getToken()})

        this.connection = connection

        connection.on('error', (e) => {
            self.log(`${new Date()} | Failed to contact server: ${e}`)
        })

        connection.on('open', () => {
            self.log(`${new Date()} | Connection to server opened.`)

            for (const n in self.providers) {
                let p = self.providers[n]

                if (p.onConnect) {
                    p.onConnect(connection, self.coreEnv)
                }
            }

        })

        connection.on('message', (message) => {

            try {
                var msg = JSON.parse(message)
            } catch (e) {
                self.log(`Invalid message received from server (not valid JSON): ${message}`)
                return
            }

            if (!msg.type) {
                self.log(`Invalid message received from server (no type declaration): ${message}`)
                return
            }

            let m = msg.type.match(/^(?<provider>[A-z0-9\-_]+)\.(?<message>[A-z0-9\-_.]+)$/)

            if (!m) {
                self.log(`Invalid message received from server (invalid type format): ${message}`)
                return
            }

            let p = self.providers[m.groups.provider]

            if (!p) {
                self.log(`No provider for the given message type: ${message}`)
                return
            }

            let h = p.messages[m.groups.message]

            if (!h) {
                self.log(`The provider does not support the given message type: ${message}`)
                return
            }

            try {
                h(msg, connection, self.coreEnv)
            } catch(e) {
                self.log(`Exception occured while processing message: ${e}`)
            }

        })

        connection.on('close', (e) => {
            self.log(`Connection to server closed`)

            for (const n in self.providers) {
                let p = self.providers[n]
        
                if (p.onDisconnect) {
                    p.onDisconnect(connection, self.coreEnv)
                }
            }

            if (self.alwaysReconnect) {
                self.log(`Attempting to reconnect in 30 seconds: ${e}`)
                self.nextConnectionAttempt = setTimeout(() => {
                    self.nextConnectionAttempt = null
                    self.connect()
                }, self.reconnectIntervalSeconds * 1000)
            }
        })

        const handleSignal = (e) => {
            self.log(e)
            self.alwaysReconnect = false
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
                for (const n in self.providers) {
                    let p = self.providers[n]
            
                    if (p.onDisconnect) {
                        p.onDisconnect(connection, self.coreEnv)
                    }
                }
            }

            for (const n in self.providers) {
                let p = self.providers[n]
        
                if (p.onStop) {
                    p.onStop(e, connection, self.coreEnv)
                }
            }

            process.exit()
        }

        process.on('SIGTERM', handleSignal)
        process.on('SIGINT',  handleSignal)
        process.on('SIGHUP',  handleSignal)

    }
}

module.exports = (settings, log) => {
    return new MorriganClient(settings, log)
} 