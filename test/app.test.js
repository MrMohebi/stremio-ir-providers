import assert from 'node:assert/strict'
import test from 'node:test'

import {createAddon, createManifest, parseAddonId} from '../app.js'
import {silentLogger, withServer} from '../test-support/helpers.js'

function createProvider(overrides = {}) {
    return {
        key: 'digimovie',
        providerID: 'digimovie___',
        async search() {
            return [
                {id: '10', name: 'A movie', type: 'movie', genres: []},
                {id: '20', name: 'A series', type: 'series', genres: []},
            ]
        },
        async getMovieData() {
            return {title: 'Example'}
        },
        async imdbID() {
            return 'tt1234567'
        },
        getLinks() {
            return [{url: 'https://media.example/movie.mkv', title: '1080p'}]
        },
        ...overrides,
    }
}

function createTestApp(provider = createProvider(), options = {}) {
    return createAddon({
        env: options.env ?? {},
        logger: silentLogger,
        providers: [provider],
        services: {
            async getCinemeta(type, imdbId) {
                return {
                    meta: {
                        id: imdbId,
                        type,
                        poster: 'https://images.example/poster.jpg',
                        videos: [{id: `${imdbId}:1:1`}],
                    },
                }
            },
            async getSubtitle() {
                return {subtitles: [{id: 'sub-1', url: 'https://sub.example/file.srt'}]}
            },
            ...options.services,
        },
    })
}

test('manifest keeps the public addon contract', () => {
    const manifest = createManifest({DEV_MODE: 'true'})
    assert.equal(manifest.id, 'org.mmmohebi.stremioIrProviders')
    assert.equal(manifest.version, '2.2.1')
    assert.equal(manifest.name, 'Iran Provider - DEV')
    assert.equal(manifest.catalogs.length, 4)
    assert.deepEqual(manifest.types, ['movie', 'series'])
})

test('catalog filters by type and creates stable provider IDs', async () => {
    let receivedSearch
    const provider = createProvider({
        async search(search) {
            receivedSearch = search
            return [
                {id: 10, name: 'A movie', type: 'movie', genres: []},
                {id: 20, name: 'A series', type: 'series', genres: []},
            ]
        },
    })

    await withServer(createTestApp(provider), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/catalog/movie/digimovie_movies/search=The%20Matrix.json`)
        const body = await response.json()
        assert.equal(receivedSearch, 'The Matrix')
        assert.deepEqual(body.metas, [
            {id: 'ipdigimovie___10', name: 'A movie', type: 'movie', genres: []},
        ])
    })
})

test('catalog failures return a valid empty Stremio response', async () => {
    const provider = createProvider({async search() { throw new Error('upstream failed') }})
    await withServer(createTestApp(provider), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/catalog/movie/digimovie_movies/search=test.json`)
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), {metas: []})
    })
})

test('movie metadata keeps IDs and creates behavior hints', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/meta/movie/ipdigimovie___10.json`)
        const body = await response.json()
        assert.equal(body.meta.id, 'ipdigimovie___10___tt1234567')
        assert.equal(body.meta.behaviorHints.defaultVideoId, body.meta.id)
    })
})

test('series metadata rewrites each video ID without mutating the provider ID', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/meta/series/ipdigimovie___20.json`)
        const body = await response.json()
        assert.equal(body.meta.id, 'ipdigimovie___20')
        assert.equal(body.meta.videos[0].id, 'ipdigimovie___20___tt1234567:1:1')
    })
})

test('metadata proxying rewrites nested HTTP URLs', async () => {
    const app = createTestApp(createProvider(), {
        env: {PROXY_ENABLE: 'true', PROXY_URL: 'https://proxy.example/', PROXY_PATH: '/asset/'},
    })
    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/meta/movie/ipdigimovie___10.json`)
        const body = await response.json()
        assert.equal(
            body.meta.poster,
            'https://proxy.example/asset?url=https%3A%2F%2Fimages.example%2Fposter.jpg',
        )
    })
})

test('stream and subtitle routes return valid arrays', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
        const streamResponse = await fetch(`${baseUrl}/stream/series/ipdigimovie___20___tt1234567:1:1.json`)
        assert.deepEqual(await streamResponse.json(), {
            streams: [{url: 'https://media.example/movie.mkv', title: '1080p'}],
        })

        const subtitleResponse = await fetch(`${baseUrl}/subtitles/series/ipdigimovie___20___tt1234567:1:1.json`)
        assert.deepEqual(await subtitleResponse.json(), {
            subtitles: [{id: 'sub-1', url: 'https://sub.example/file.srt'}],
        })
    })
})

test('malformed or unknown IDs cannot select a provider by substring', async () => {
    const provider = createProvider()
    assert.equal(parseAddonId('prefix-digimovie___10', [provider]), null)

    await withServer(createTestApp(provider), async (baseUrl) => {
        const streamResponse = await fetch(`${baseUrl}/stream/movie/prefix-digimovie___10___tt1.json`)
        assert.deepEqual(await streamResponse.json(), {streams: []})
    })
})

test('health endpoint remains compatible', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`)
        assert.equal(response.status, 200)
        assert.equal(await response.text(), 'ok')
    })
})
