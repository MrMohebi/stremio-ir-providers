import assert from 'node:assert/strict'
import test from 'node:test'

import {createFetchHttpClient} from '../cloudflare/http-client.js'
import {createWorkerHandler} from '../cloudflare/worker.js'
import {fetchAllowedResource} from '../cloudflare/proxy.js'
import {METADATA_SOURCE} from '../sources/source.js'
import {silentLogger} from '../test-support/helpers.js'

function createProvider(overrides = {}) {
    return {
        key: 'f2media',
        providerID: 'f2media___',
        metadataSource: METADATA_SOURCE.PROVIDER,
        async search() {
            return [{id: '10', name: 'Movie', type: 'movie'}]
        },
        async getMovieData() {
            return {title: 'Movie'}
        },
        getMeta(type, id) {
            return {
                id,
                type,
                name: 'Movie',
                poster: 'https://images.example/poster.jpg',
            }
        },
        getLinks() {
            return [{url: 'https://media.example/movie.mp4', title: '1080p'}]
        },
        ...overrides,
    }
}

function createHandler(options = {}) {
    return createWorkerHandler({
        providers: [createProvider()],
        logger: silentLogger,
        services: {
            async getCinemeta() {
                return null
            },
            async getSubtitle() {
                return {subtitles: [{id: 'sub-1', url: 'https://sub.example/file.srt'}]}
            },
        },
        ...options,
    })
}

test('Cloudflare Worker serves manifest, health, and CORS without Express', async () => {
    const handler = createHandler()
    const manifest = await handler(new Request('https://addon.example/manifest.json'), {})
    assert.equal(manifest.status, 200)
    assert.equal(manifest.headers.get('access-control-allow-origin'), '*')
    assert.equal((await manifest.json()).id, 'org.mmmohebi.stremioIrProviders')

    const health = await handler(new Request('https://addon.example/health'), {})
    assert.equal(await health.text(), 'ok')

    const preflight = await handler(new Request('https://addon.example/manifest.json', {method: 'OPTIONS'}), {})
    assert.equal(preflight.status, 204)
})

test('Cloudflare Worker exposes catalog, metadata, stream, and subtitle routes', async () => {
    const handler = createHandler()
    const catalog = await handler(new Request(
        'https://addon.example/catalog/movie/f2media_movies/search=Movie.json',
    ), {})
    assert.deepEqual(await catalog.json(), {
        metas: [{id: 'ipf2media___10', name: 'Movie', type: 'movie'}],
    })

    const metadata = await handler(new Request('https://addon.example/meta/movie/ipf2media___10.json'), {})
    const metaBody = await metadata.json()
    assert.equal(metaBody.meta.id, 'ipf2media___10___10')
    assert.equal(metaBody.meta.behaviorHints.defaultVideoId, metaBody.meta.id)

    const stream = await handler(new Request('https://addon.example/stream/movie/ipf2media___10___10.json'), {})
    assert.deepEqual(await stream.json(), {
        streams: [{url: 'https://media.example/movie.mp4', title: '1080p'}],
    })

    const subtitles = await handler(new Request(
        'https://addon.example/subtitles/movie/ipf2media___10___tt1234567.json',
    ), {})
    assert.deepEqual(await subtitles.json(), {
        subtitles: [{id: 'sub-1', url: 'https://sub.example/file.srt'}],
    })
})

test('Cloudflare metadata uses the current Worker origin for its built-in proxy', async () => {
    const handler = createHandler()
    const response = await handler(
        new Request('https://addon.example/meta/movie/ipf2media___10.json'),
        {PROXY_ENABLE: 'true', PROXY_PATH: '/asset/'},
    )
    assert.equal(
        (await response.json()).meta.poster,
        'https://addon.example/asset?url=https%3A%2F%2Fimages.example%2Fposter.jpg',
    )
})

test('Cloudflare proxy rejects missing, disallowed, and oversized resources', async () => {
    const handler = createHandler({
        fetcher: async () => new Response(new Uint8Array(5), {
            headers: {'content-type': 'image/png'},
        }),
    })
    const missing = await handler(new Request('https://addon.example/proxy'), {
        PROXY_ALLOWED_URLS: 'example.com',
    })
    assert.equal(missing.status, 400)

    const denied = await handler(new Request(
        `https://addon.example/proxy?url=${encodeURIComponent('https://evil.test/image.png')}`,
    ), {PROXY_ALLOWED_URLS: 'example.com'})
    assert.equal(denied.status, 403)

    await assert.rejects(
        fetchAllowedResource(
            'https://example.com/image.png',
            {allowedDomains: ['example.com'], maxRedirects: 1, maxFileSize: 4},
            async () => new Response(new Uint8Array(5)),
        ),
        (error) => error.statusCode === 413,
    )
})

test('Cloudflare proxy validates redirects and returns allowed binary content', async () => {
    const requested = []
    const handler = createHandler({
        fetcher: async (url) => {
            requested.push(String(url))
            if (requested.length === 1) {
                return new Response(null, {status: 302, headers: {location: '/final.png'}})
            }
            return new Response(new Uint8Array([1, 2, 3]), {
                headers: {
                    'content-type': 'image/png',
                    'cache-control': 'public, max-age=60',
                },
            })
        },
    })
    const response = await handler(new Request(
        `https://addon.example/proxy?url=${encodeURIComponent('https://example.com/image.png')}`,
    ), {PROXY_ALLOWED_URLS: 'example.com'})

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('cache-control'), 'public, max-age=60')
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]))
    assert.deepEqual(requested, ['https://example.com/image.png', 'https://example.com/final.png'])
})

test('Fetch HTTP client maps query parameters and strips the forbidden Host header', async () => {
    let received
    const client = createFetchHttpClient(async (url, init) => {
        received = {url, init}
        return Response.json({ok: true})
    })
    const response = await client.get('https://api.example/search', {
        params: {q: 'a movie'},
        headers: {Host: 'api.example', 'api-key': 'key'},
        timeout: 1_000,
    })

    assert.equal(received.url, 'https://api.example/search?q=a+movie')
    assert.equal(received.init.headers.has('host'), false)
    assert.equal(received.init.headers.get('api-key'), 'key')
    assert.deepEqual(response.data, {ok: true})
})
