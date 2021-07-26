const fs = require('fs')

module.exports.version = '0.1.0.0'


var tokenPath = null
var tokenExpirationPath = null
var token = null
var tokenExpires = null
var tokenRefreshInterval

const loadToken = () => {
    try {
        token = fs.readFileSync(tokenPath)

        if (fs.existsSync(tokenExpirationPath)) {
            tokenExpires = fs.readFileSync(tokenExpirationPath)
        }
        return true
    } catch (e) {
        return false
    }
}

const saveToken = () => {
    fs.writeFileSync(tokenPath, token)
    if (tokenExpires) { 
        fs.writeFileSync(tokenExpirationPath, tokenExpires)
    }
}

module.exports.getToken = () => {
    return token
}

module.exports.setup = (core) => {
    
    tokenPath = `${core.stateDir}/token`
    tokenExpirationPath = `${core.stateDir}/token.expiration`

    if (!fs.existsSync(tokenPath)) {
        token = core.settings.token
        saveToken()
    } else {
        loadToken()
    }

}

module.exports.onConnect = (connection) => {
    console.log('Connection opened.')

    // Immediately request a new token:
    connection.send(JSON.stringify(
        { type: 'client.token.refresh' }
    ))

    // Request new tokens every 8 hours:
    tokenRefreshInterval = setInterval(() => {
        connection.send(JSON.stringify(
            { type: 'client.token.refresh' }
        ))
    }, (8 * 3600 * 1000) )

}

module.exports.onDisconnect = () => {
    console.log('Connection closed.')
    if (tokenRefreshInterval) {
        clearImmediate(tokenRefreshInterval)
    }
}

module.exports.messages = {
    'token.issue': (message) => {
        console.log(`${new Date()} | New token issued (expires ${message.expires}).`)
        token = message.token
        tokenExpires = message.expires
        saveToken()
    }
}
