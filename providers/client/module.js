const fs = require('fs')

module.exports.version = '0.1.0.0'


var tokenPath = null
var token = null
var tokenRefreshInterval

const loadToken = () => {
    try {
        let b = fs.readFileSync(tokenPath)
        return b.toString()
    } catch (e) {
        return false
    }
}

const saveToken = () => {
    fs.writeFileSync(tokenPath, token)
}

module.exports.getToken = () => {
    return token
}

module.exports.setup = (core) => {
    
    tokenPath = `${core.stateDir}/curToken`

    if (!fs.existsSync(tokenPath)) {
        token = core.settings.token
        saveToken()
    } else {
        token = loadToken()
    }

}

module.exports.onConnect = (connection) => {
    console.log('Connection opened.')

    tokenRefreshInterval = setInterval(() => {
        connection.send(JSON.stringify(
            { type: 'client.token.refresh' }
        ))
    },
    (/* 8 * 3600 */ 30 * 1000)
)

}

module.exports.onDisconnect = () => {
    console.log('Connection closed.')

    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval)
        tokenRefreshInterval = null
    }
}

module.exports.messages = {
    'token.issue': (message, connection, core) => {
        console.log(`${new Date()} | New token issued.`)
        token = message.token
        saveToken()
    }
}
