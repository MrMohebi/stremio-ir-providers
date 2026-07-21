import assert from 'node:assert/strict'
import test from 'node:test'

import {createAddon, createManifest, parseAddonId} from '../app.js'
import {METADATA_SOURCE} from '../sources/source.js'
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
    assert.equal(manifest.version, '2.5.0')
    assert.equal(manifest.name, 'Iran Provider - DEV')
    assert.deepEqual(manifest.catalogs.map((catalog) => catalog.id), [
        'f2media_movies',
        'f2media_series',
        'peepboxtv_movies',
        'peepboxtv_series',
        'cinamatic_movies',
        'cinamatic_series',
        'aslmoviez_movies',
        'aslmoviez_series',
        'serialblog_movies',
        'serialblog_series',
        'iptv_tv',
    ])
    assert.deepEqual(manifest.types, ['movie', 'series', 'tv'])
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

test('provider metadata bypasses IMDb and Cinemeta while keeping stream IDs routable', async () => {
    const provider = createProvider({
        metadataSource: METADATA_SOURCE.PROVIDER,
        getMeta(type, id) {
            return {
                id,
                type,
                name: 'Native series',
                videos: [{id: `${id}:2:3`, season: 2, episode: 3}],
            }
        },
        async imdbID() {
            throw new Error('IMDb lookup must not run')
        },
    })
    const app = createTestApp(provider, {
        services: {
            async getCinemeta() {
                throw new Error('Cinemeta must not run')
            },
        },
    })

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/meta/series/ipdigimovie___20.json`)
        const body = await response.json()
        assert.equal(body.meta.name, 'Native series')
        assert.equal(body.meta.id, 'ipdigimovie___20')
        assert.equal(body.meta.videos[0].id, 'ipdigimovie___20___20:2:3')
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
        const body = await streamResponse.json()
        assert.equal(body.streams.length, 1)
        assert.equal(body.streams[0].url, 'https://media.example/movie.mkv')
        assert.ok(body.streams[0].title.includes('1080p'))

        const subtitleResponse = await fetch(`${baseUrl}/subtitles/series/ipdigimovie___20___tt1234567:1:1.json`)
        assert.deepEqual(await subtitleResponse.json(), {
            subtitles: [{id: 'sub-1', url: 'https://sub.example/file.srt'}],
        })
    })
})

test('IMDb series request does not match a movie with the same title', async () => {
    const provider = {
        key: 'digimovie',
        providerID: 'digimovie___',
        async search(query) {
            return [
                {id: 'movie-1', name: 'Breaking Bad', type: 'movie', genres: []},
                {id: 'series-1', name: 'Breaking Bad', type: 'series', genres: []},
            ]
        },
        async getMovieData(type, id) {
            if (id === 'series-1') return {title: 'Breaking Bad', videos_id: 'series-1'}
            if (id === 'movie-1') return {title: 'Breaking Bad', videos_id: 'movie-1'}
            return null
        },
        async imdbID() { return 'tt1234567' },
        getLinks(type, videoId, movieData) {
            if (movieData?.videos_id === 'series-1') {
                return [{url: 'https://series.example/episode.mkv', title: 'Series stream'}]
            }
            return [{url: 'https://movie.example/film.mp4', title: 'Movie stream'}]
        },
    }

    await withServer(createAddon({
        logger: silentLogger,
        env: {},
        providers: [provider],
        services: {
            async getCinemeta(type, imdbId) {
                return {meta: {id: imdbId, name: 'Breaking Bad', type}}
            },
            async getSubtitle() { return {subtitles: []} },
        },
    }), async (baseUrl) => {
        const seriesRes = await fetch(`${baseUrl}/stream/series/tt1234567.json`)
        const seriesBody = await seriesRes.json()
        assert.equal(seriesBody.streams.length, 1)
        assert.ok(seriesBody.streams[0].url.includes('series.example'))

        const movieRes = await fetch(`${baseUrl}/stream/movie/tt1234567.json`)
        const movieBody = await movieRes.json()
        assert.equal(movieBody.streams.length, 1)
        assert.ok(movieBody.streams[0].url.includes('movie.example'))
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
