import assert from 'node:assert/strict'
import test from 'node:test'

import Digimovie from '../sources/digimovie.js'
import Peepboxtv, {
    PEEPBOXTV_ANDROID_USER_AGENT,
} from '../sources/peepboxtv.js'
import {normalizeBaseUrl} from '../sources/source.js'
import {silentLogger} from '../test-support/helpers.js'

test('normalizes provider base URLs and rejects unsafe protocols', () => {
    assert.equal(normalizeBaseUrl('api.example.com/'), 'https://api.example.com')
    assert.equal(normalizeBaseUrl('http://api.example.com/'), 'http://api.example.com')
    assert.equal(normalizeBaseUrl('file:///etc/passwd'), null)
    assert.equal(normalizeBaseUrl(''), null)
})

test('Digimovie link parsing tolerates missing and malformed data', () => {
    const provider = new Digimovie('', silentLogger)
    assert.deepEqual(provider.getMovieLinks(null), [])
    assert.deepEqual(provider.getSeriesLinks({}, 'tt1:1:1'), [])
    assert.deepEqual(provider.getLinks('other', null, {}), [])
})

test('Digimovie selects the requested one-based episode', () => {
    const provider = new Digimovie('', silentLogger)
    const movieData = {
        serie_download_urls: [{
            season_name: 'Season : 2',
            quality: '1080p',
            size: '2 GB',
            links: [{movie: 'episode-1'}, {movie: 'episode-2'}],
        }],
    }
    assert.deepEqual(provider.getSeriesLinks(movieData, 'tt1:2:2'), [
        {url: 'episode-2', title: '1080p - 2 GB'},
    ])
})

test('PeepBoxTV selects the requested one-based episode', () => {
    const provider = new Peepboxtv('', silentLogger)
    const movieData = {
        title: 'Show',
        season: [{
            seasons_name: 'فصل 1 - Dubbed',
            episodes: [
                {episodes_name: 'Episode 1', file_url: 'episode-1'},
                {episodes_name: 'Episode 2', file_url: 'episode-2'},
            ],
        }],
    }
    assert.deepEqual(provider.getSeriesLinks(movieData, 'tt1:1:2'), [
        {url: 'episode-2', title: 'Show - فصل 1 - Episode 2 - Dubbed'},
    ])
})

test('providers do not make requests when required configuration is absent', async () => {
    let requests = 0
    const httpClient = new Proxy({}, {get() { requests += 1 }})
    const digimovie = new Digimovie('', silentLogger, httpClient)
    const peepbox = new Peepboxtv('', silentLogger, httpClient)
    digimovie.username = undefined
    digimovie.password = undefined
    peepbox.apiKey = undefined

    assert.deepEqual(await digimovie.search('movie'), [])
    assert.equal(await digimovie.getMovieData('movie', '1'), null)
    assert.deepEqual(await peepbox.search('movie'), [])
    assert.equal(await peepbox.getMovieData('movie', '1'), null)
    assert.equal(requests, 0)
})

test('Digimovie search maps current API results into Stremio metadata', async () => {
    const httpClient = {
        async post(url, data, config) {
            assert.equal(url, 'https://digi.example/api/app/v1/adv_search_movies')
            assert.equal(data.adv_s, 'Matrix')
            assert.equal(config.timeout, 15_000)
            return {data: {result: {items: [
                {id: 1, title_en: 'Movie', image_url: 'poster', type: 'movie'},
                {id: 2, title_en: 'Show', image_url: 'poster-2', type: 'series'},
            ]}}}
        },
    }
    const provider = new Digimovie('digi.example', silentLogger, httpClient)
    assert.deepEqual(await provider.search('Matrix'), [
        {id: '1', name: 'Movie', poster: 'poster', type: 'movie', genres: []},
        {id: '2', name: 'Show', poster: 'poster-2', type: 'series', genres: []},
    ])
})

test('Digimovie login stores credentials without logging token values', async () => {
    const messages = []
    const logger = {...silentLogger, info(message) { messages.push(message) }}
    const httpClient = {
        async post(url, data) {
            assert.equal(url, 'https://digi.example/api/app/v1/login')
            assert.deepEqual(data, {username: 'user', password: 'pass'})
            return {data: {status: true, auth_token: 'secret-token', refresh_token: 'secret-refresh'}}
        },
    }
    const provider = new Digimovie('digi.example', logger, httpClient)
    provider.username = 'user'
    provider.password = 'pass'
    assert.equal(await provider.login(), true)
    assert.equal(provider.token, 'secret-token')
    assert.ok(messages.every((message) => !message.includes('secret-token')))
})

test('PeepBoxTV search maps movies and series from the current API', async () => {
    const debugLogs = []
    const logger = {...silentLogger, debug(message, details) { debugLogs.push({message, details}) }}
    const httpClient = {
        async get(url, config) {
            assert.equal(url, 'https://peep.example/rest-api/v130/search')
            assert.equal(config.headers['api-key'], 'api-key')
            assert.equal(config.headers['User-Agent'], PEEPBOXTV_ANDROID_USER_AGENT)
            assert.equal(config.params.range_to, 2040)
            return {data: {
                movie: [{videos_id: 1, title: 'Movie', thumbnail_url: 'one', is_tvseries: '0'}],
                tvseries: [{videos_id: 2, title: 'Show', thumbnail_url: 'two', is_tvseries: '1'}],
            }}
        },
    }
    const provider = new Peepboxtv('peep.example', logger, httpClient)
    provider.apiKey = 'api-key'
    assert.deepEqual(await provider.search('query'), [
        {id: '1', name: 'Movie', poster: 'one', type: 'movie', genres: []},
        {id: '2', name: 'Show', poster: 'two', type: 'series', genres: []},
    ])
    assert.deepEqual(debugLogs.at(-1), {
        message: 'PeepBoxTV search completed',
        details: {query: 'query', resultCount: 2},
    })
})

test('PeepBoxTV sends the current detail parameters and maps movie files', async () => {
    const httpClient = {
        async get(url, config) {
            assert.equal(url, 'https://peep.example/rest-api/v130/single_details')
            assert.deepEqual(config.params, {
                type: 'movie',
                id: '2846',
                user_id: 'test-user',
                android_id: 'test-device',
            })
            return {data: {
                videos_id: '2846',
                title: 'سیلو / Silo',
                videos: [{label: '1080p', file_url: 'https://media.example/silo.mp4'}],
            }}
        },
    }
    const provider = new Peepboxtv('peep.example', silentLogger, httpClient)
    provider.apiKey = 'api-key'
    provider.userId = 'test-user'
    provider.androidId = 'test-device'
    const movieData = await provider.getMovieData('movie', '2846')
    assert.deepEqual(provider.getMovieLinks(movieData), [
        {url: 'https://media.example/silo.mp4', title: '1080p'},
    ])
})

test('PeepBoxTV logs API-level detail rejections', async () => {
    const warnings = []
    const logger = {...silentLogger, warn(message, details) { warnings.push({message, details}) }}
    const provider = new Peepboxtv('peep.example', logger, {
        async get() {
            return {data: {status: 'error', message: 'ID must be valid.'}}
        },
    })
    provider.apiKey = 'api-key'

    assert.equal(await provider.getMovieData('series', '1987'), null)
    assert.deepEqual(warnings, [{
        message: 'PeepBoxTV detail rejected',
        details: {type: 'series', id: '1987', status: 'error', upstreamMessage: 'ID must be valid.'},
    }])
})

test('PeepBoxTV uses the English half of bilingual titles for TMDB lookup', async () => {
    const httpClient = {
        async get(url, config) {
            if (url.includes('/search/multi')) {
                assert.equal(config.params.query, 'Silo')
                return {data: {results: [{id: 10, media_type: 'tv'}]}}
            }
            return {data: {external_ids: {imdb_id: 'tt14688458'}}}
        },
    }
    const provider = new Peepboxtv('peep.example', silentLogger, httpClient)
    provider.tmdbApiKey = 'tmdb-key'
    assert.equal(await provider.imdbID({title: 'سیلو / Silo'}, 'series'), 'tt14688458')
})
