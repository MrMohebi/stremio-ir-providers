import {once} from 'node:events'

export const silentLogger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
}

export async function withServer(app, callback) {
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const {port} = server.address()

    try {
        return await callback(`http://127.0.0.1:${port}`)
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
}
