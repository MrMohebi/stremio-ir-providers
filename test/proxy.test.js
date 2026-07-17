import assert from 'node:assert/strict'
import test from 'node:test'

import {createProxyApp, createProxyConfig, requestAllowedResource, validateTargetUrl} from '../proxyServer.js'
import {silentLogger, withServer} from '../test-support/helpers.js'

test('proxy config has safe defaults when environment variables are absent', () => {
    const config = createProxyConfig({})
    assert.equal(config.port, 3005)
    assert.equal(config.path, 'proxy')
    assert.ok(config.allowedDomains.includes('imdb.com'))
})

test('proxy only accepts HTTP URLs on exact domains or subdomains', () => {
    const domains = ['example.com']
    assert.equal(validateTargetUrl('https://img.example.com/a.jpg', domains).hostname, 'img.example.com')
    assert.throws(() => validateTargetUrl('https://example.com.evil.test/a.jpg', domains), /not allowed/)
    assert.throws(() => validateTargetUrl('file:///etc/passwd', domains), /HTTP and HTTPS/)
    assert.throws(() => validateTargetUrl('not a url', domains), /Invalid URL/)
})

test('proxy validates redirects before making the redirected request', async () => {
    const requested = []
    const httpClient = {
        async get(url) {
            requested.push(url)
            return {status: 302, headers: {location: 'https://evil.test/payload'}, data: Buffer.alloc(0)}
        },
    }
    const config = {...createProxyConfig({PROXY_ALLOWED_URLS: 'example.com'}), maxRedirects: 2}
    await assert.rejects(
        requestAllowedResource('https://example.com/image.jpg', config, httpClient),
        /not allowed/,
    )
    assert.deepEqual(requested, ['https://example.com/image.jpg'])
})

test('proxy rejects oversized responses', async () => {
    const config = {...createProxyConfig({PROXY_ALLOWED_URLS: 'example.com'}), maxFileSize: 4}
    const httpClient = {
        async get() {
            return {status: 200, headers: {'content-type': 'image/png'}, data: Buffer.alloc(5)}
        },
    }
    await assert.rejects(
        requestAllowedResource('https://example.com/image.jpg', config, httpClient),
        (error) => error.statusCode === 413,
    )
})

test('proxy app starts with defaults and rejects missing URLs', async () => {
    await withServer(createProxyApp({env: {}, logger: silentLogger}), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/proxy`)
        assert.equal(response.status, 400)
        assert.equal(await response.text(), 'URL parameter is required')
    })
})

test('proxy app returns allowed binary content and its content type', async () => {
    const httpClient = {
        async get() {
            return {
                status: 200,
                headers: {'content-type': 'image/png', 'cache-control': 'public, max-age=60'},
                data: Buffer.from([1, 2, 3]),
            }
        },
    }
    const app = createProxyApp({
        env: {PROXY_ALLOWED_URLS: 'example.com'},
        httpClient,
        logger: silentLogger,
    })
    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent('https://example.com/image.png')}`)
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('content-type'), 'image/png')
        assert.equal(response.headers.get('cache-control'), 'public, max-age=60')
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3]))
    })
})
