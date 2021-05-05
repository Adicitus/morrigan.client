module.exports = {
    version: '0.1.0.0',
    messages: {
        state: (message, connection, core) => {

            let log = core.log

            switch(message.state) {
                case 'rejected': {
                    log(`The server rejected connection: ${message.reason}`)
                    return
                }
                case 'accepted': {
                    log(`The server accepted connection.`)
                    connection.send(JSON.stringify({
                        type: 'client.state',
                        state: 'ready'
                    }))
                    return
                }
            }
        }
    }
}