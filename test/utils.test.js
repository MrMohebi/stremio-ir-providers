import assert from 'node:assert/strict'
import test from 'node:test'

import {getCinemeta, getSubtitle, modifyUrls, searchAndGetTMDB} from '../utils.js'
import {silentLogger} from '../test-support/helpers.js'

test('modifyUrls recursively proxies HTTP URLs without mutating input', () => {
    const original = {poster: 'https://example.com/p.jpg', nested: [{url: 'http://example.com/a'}], id: 'tt1'}
    const result = modifyUrls(original, 'https://proxy.test/?url=')
    assert.deepEqual(result, {
        poster: 'https://proxy.test/?url=https%3A%2F%2Fexample.com%2Fp.jpg',
        nested: [{url: 'https://proxy.test/?url=http%3A%2F%2Fexample.com%2Fa'}],
        id: 'tt1',
    })
    assert.equal(original.poster, 'https://example.com/p.jpg')
})

test('external metadata helpers return valid empty values on missing IDs', async () => {
    assert.equal(await getCinemeta('movie', ''), null)
    assert.deepEqual(await getSubtitle('movie', ''), {subtitles: []})
})

test('external metadata helpers use encoded IDs and request timeouts', async () => {
    const calls = []
    const httpClient = {
        async get(url, config) {
            calls.push({url, config})
            return url.includes('cinemeta')
                ? {data: {meta: {id: 'tt 1'}}}
                : {data: {subtitles: []}}
        },
    }
    assert.deepEqual(await getCinemeta('movie', 'tt 1', httpClient), {meta: {id: 'tt 1'}})
    assert.deepEqual(await getSubtitle('movie', 'tt 1', httpClient), {subtitles: []})
    assert.ok(calls.every(({url}) => url.includes('tt%201.json')))
    assert.ok(calls.every(({config}) => config.timeout === 15_000))
})

test('TMDB lookup prefers a result matching the Stremio media type', async () => {
    const calls = []
    const httpClient = {
        async get(url) {
            calls.push(url)
            if (url.endsWith('/search/multi')) {
                return {data: {results: [
                    {id: 1, media_type: 'movie'},
                    {id: 2, media_type: 'tv'},
                ]}}
            }
            return {data: {external_ids: {imdb_id: 'tt2'}}}
        },
    }

    const result = await searchAndGetTMDB('Show', 'series', httpClient, silentLogger, 'test-key')
    assert.equal(result.external_ids.imdb_id, 'tt2')
    assert.match(calls[1], /\/tv\/2$/)
})

test('TMDB lookup rejects results from the wrong media type', async () => {
    const calls = []
    const httpClient = {
        async get(url) {
            calls.push(url)
            return url.endsWith('/search/multi')
                ? {data: {results: [{id: 1, media_type: 'movie'}]}}
                : {data: {external_ids: {imdb_id: 'tt1234567'}}}
        },
    }

    assert.equal(
        await searchAndGetTMDB('Show', 'series', httpClient, silentLogger, 'test-key'),
        null,
    )
    assert.equal(calls.length, 1)
})
