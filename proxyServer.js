import {pathToFileURL} from 'node:url'

import axios from 'axios'
import express from 'express'

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5

export function createProxyConfig(env = process.env) {
    const parsedPort = Number(env.PROXY_PORT)
    return {
        port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3005,
        path: String(env.PROXY_PATH || 'proxy').replace(/^\/+|\/+$/g, '') || 'proxy',
        allowedDomains: String(env.PROXY_ALLOWED_URLS || 'metahub.space,imdb.com,strem.io,tmdb.org')
            .split(',')
            .map((domain) => domain.trim().toLowerCase())
            .filter(Boolean),
        maxFileSize: DEFAULT_MAX_FILE_SIZE,
        maxRedirects: DEFAULT_MAX_REDIRECTS,
    }
}

export function validateTargetUrl(value, allowedDomains) {
    let url
    try {
        url = new URL(value)
    } catch {
        throw Object.assign(new Error('Invalid URL'), {statusCode: 400})
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw Object.assign(new Error('Only HTTP and HTTPS URLs are supported'), {statusCode: 400})
    }

    const hostname = url.hostname.toLowerCase()
    const allowed = allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    if (!allowed) {
        throw Object.assign(new Error('Access to the specified domain is not allowed'), {statusCode: 403})
    }
    return url
}

export async function requestAllowedResource(targetUrl, config, httpClient = axios) {
    let currentUrl = validateTargetUrl(targetUrl, config.allowedDomains)

    for (let redirectCount = 0; redirectCount <= config.maxRedirects; redirectCount += 1) {
        const response = await httpClient.get(currentUrl.toString(), {
            responseType: 'arraybuffer',
            maxRedirects: 0,
            maxContentLength: config.maxFileSize,
            timeout: 30_000,
            validateStatus: (status) => status >= 200 && status < 400,
        })

        if (response.status >= 300) {
            if (redirectCount === config.maxRedirects || !response.headers?.location) {
                throw Object.assign(new Error('Too many or invalid redirects'), {statusCode: 502})
            }
            currentUrl = validateTargetUrl(
                new URL(response.headers.location, currentUrl).toString(),
                config.allowedDomains,
            )
            continue
        }

        const contentLength = Number(response.headers?.['content-length'])
        const actualLength = response.data?.byteLength ?? response.data?.length ?? 0
        if ((Number.isFinite(contentLength) && contentLength > config.maxFileSize) || actualLength > config.maxFileSize) {
            throw Object.assign(new Error('File size exceeds the allowed limit of 10MB'), {statusCode: 413})
        }
        return response
    }

    throw Object.assign(new Error('Too many redirects'), {statusCode: 502})
}

export function createProxyApp({env = process.env, httpClient = axios, logger = console} = {}) {
    const config = createProxyConfig(env)
    const app = express()
    app.disable('x-powered-by')

    app.get(`/${config.path}`, async (req, res) => {
        const targetUrl = req.query.url
        if (typeof targetUrl !== 'string' || !targetUrl) {
            return res.status(400).send('URL parameter is required')
        }

        try {
            const response = await requestAllowedResource(targetUrl, config, httpClient)
            if (response.headers?.['content-type']) {
                res.type(response.headers['content-type'])
            }
            if (response.headers?.['cache-control']) {
                res.set('Cache-Control', response.headers['cache-control'])
            }
            return res.send(response.data)
        } catch (error) {
            const sizeLimitExceeded = error.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED'
                || String(error.message).includes('maxContentLength')
            const statusCode = error.statusCode || (sizeLimitExceeded ? 413 : 502)
            logger.error('Proxy request failed', {message: error.message, statusCode})
            return res.status(statusCode).send(error.message || 'Error fetching the resource')
        }
    })
    app.get('/health', (req, res) => res.type('text/plain').send('ok'))
    return app
}

export function startProxy(env = process.env) {
    const config = createProxyConfig(env)
    const app = createProxyApp({env})
    return app.listen(config.port, '0.0.0.0', () => {
        console.log(`Proxy server is running on http://127.0.0.1:${config.port}/${config.path}`)
    })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startProxy()
}
