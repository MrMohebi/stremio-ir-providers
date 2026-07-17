import {pathToFileURL} from 'node:url'

import {createAddon, createLogger, createProviders} from './app.js'

export function startAddon(env = process.env) {
    const logger = createLogger(env)
    const providers = createProviders({env, logger})
    const addon = createAddon({env, logger, providers})
    const parsedPort = Number(env.PORT)
    const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 7000
    const server = addon.listen(port, '0.0.0.0', () => {
        logger.info(`Add-on Repository URL: http://127.0.0.1:${port}/manifest.json`)
    })

    const shutdown = (signal) => {
        logger.info(`Received ${signal}; shutting down`)
        server.close((error) => {
            if (error) {
                logger.error('Graceful shutdown failed', {message: error.message})
                process.exitCode = 1
            }
        })
    }
    process.once('SIGTERM', () => shutdown('SIGTERM'))
    process.once('SIGINT', () => shutdown('SIGINT'))
    return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startAddon()
}
