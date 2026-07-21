import assert from 'node:assert/strict'
import test from 'node:test'

import F2Media from '../sources/f2media.js'
import {decodePagePath, encodePagePath} from '../sources/html-source.js'
import {silentLogger} from '../test-support/helpers.js'

// Mock HTML helpers ----------------------------------------------------------

function searchHTML(results) {
    const items = results.map(
        (r) => `
<article class="entry">
  <a href="${r.href}" class="stretched-link" rel="bookmark">
    <h2 class="entry-title">${r.title}</h2>
  </a>
  <figure class="entry-cover"><img src="${r.img || ''}" alt=""></figure>
</article>`,
    )
    return `<main>${items.join('\n')}</main>`
}

const MOVIE_HTML = `
<section id="post-intro">
  <h1 class="entry-title">Offworld: Alien Planet 2024</h1>
  <a href="https://www.imdb.com/title/tt1234567">IMDb</a>
</section>
<section id="downloads">
  <div class="download-list hardsub">
    <p class="title"><span>بدون زیرنویس</span></p>
    <ul>
      <li>
        <div><span>کیفیت :</span> <span class="text" dir="ltr">WEB-DL 1080p</span></div>
        <div><span class="text-muted">YIFY</span></div>
        <div><a href="https://abrtech.top/movie-1080.mp4" download class="btn btn-block btn-download nobr">دانلود مستقیم</a></div>
      </li>
      <li>
        <div><span>کیفیت :</span> <span class="text" dir="ltr">WEB-DL 720p</span></div>
        <div><span class="text-muted">YIFY</span></div>
        <div><a href="https://abrtech.top/movie-720.mp4" download class="btn btn-block btn-download nobr">دانلود مستقیم</a></div>
      </li>
    </ul>
  </div>
</section>`

const SERIES_HTML = `
<section id="post-intro">
  <h1 class="entry-title">Silo 2023</h1>
  <a href="https://www.imdb.com/title/tt14688458">IMDb</a>
</section>
<section id="downloads">
  <div class="download-season">
    <button>فصل 1</button>
    <div class="series-downloaditems">
      <div class="d-flex"><a href="https://abrtech.top/silo-s01e01-1080.mkv" download class="btn btn-block btn-default">قسمت 01</a></div>
      <div class="d-flex"><a href="https://abrtech.top/silo-s01e02-1080.mkv" download class="btn btn-block btn-default">قسمت 02</a></div>
    </div>
  </div>
  <div class="download-season">
    <button>فصل 2</button>
    <div class="series-downloaditems">
      <div class="d-flex"><a href="https://abrtech.top/silo-s02e01-1080.mkv" download class="btn btn-block btn-default">قسمت 01</a></div>
    </div>
  </div>
</section>`

// Tests ----------------------------------------------------------------------

test('HTML source encodes only valid page paths into route-safe IDs', () => {
    const id = encodePagePath('/series/silo/')
    assert.equal(decodePagePath(id), '/series/silo/')
    assert.match(id, /^[A-Za-z0-9_-]+$/)
    assert.equal(encodePagePath('https://evil.example/'), null)
    assert.equal(decodePagePath('not valid'), null)
})

test('F2Media HTML search filters irrelevant results via relevance check', async () => {
    const httpClient = {
        async get(url, config) {
            if (config?.params?.s) {
                assert.equal(config.params.s, 'Silo')
                return {
                    data: searchHTML([
                        {href: 'https://www.my-f2mx.top/45442/offworld/', title: 'Offworld: Alien Planet'},
                    ]),
                }
            }
            return {data: []}
        },
    }
    const provider = new F2Media('https://www.my-f2mx.top', silentLogger, httpClient)
    const results = await provider.search('Silo')

    // HTML search returns "Offworld" which doesn't contain "Silo" → filtered out
    // REST API fallback returns nothing → 0 results
    assert.equal(results.length, 0)
})

test('F2Media falls back to REST API when HTML search has no relevant matches', async () => {
    let callCount = 0
    const httpClient = {
        async get(url, config) {
            callCount++
            if (config?.params?.s) {
                return {data: searchHTML([])}
            }
            if (url.includes('/wp-json/wp/v2/series')) {
                return {data: [{
                    link: 'https://www.my-f2mx.top/series/silo/',
                    title: {rendered: 'دانلود سریال Silo'},
                }]}
            }
            if (url.includes('/wp-json/wp/v2/posts')) {
                return {data: []}
            }
            return {data: ''}
        },
    }
    const provider = new F2Media('https://www.my-f2mx.top', silentLogger, httpClient)
    const results = await provider.search('Silo')

    assert.equal(results.length, 1)
    assert.equal(results[0].type, 'series')
    assert.ok(results[0].name.includes('Silo'))
    assert.ok(callCount >= 2)
})

test('F2Media parses movie downloads with quality info', async () => {
    const httpClient = {
        async get(url, config) {
            return {data: MOVIE_HTML}
        },
    }
    const provider = new F2Media('https://www.my-f2mx.top', silentLogger, httpClient)
    const path = '/45442/offworld-alien-planet-2024/'
    const id = encodePagePath(path)
    const result = await provider.getMovieData('movie', id)

    assert.ok(result)
    assert.equal(result.title, 'Offworld: Alien Planet 2024')
    assert.equal(result.imdbId, 'tt1234567')
    assert.equal(result.isSeries, false)
    assert.equal(result.links.length, 2)

    const links = provider.getMovieLinks(result)
    assert.ok(links.some((l) => l.url.includes('1080')))
    assert.ok(links.some((l) => l.url.includes('720')))
})

test('F2Media parses series seasons and episodes', async () => {
    const httpClient = {
        async get(url, config) {
            return {data: SERIES_HTML}
        },
    }
    const provider = new F2Media('https://www.my-f2mx.top', silentLogger, httpClient)
    const path = '/series/silo/'
    const id = encodePagePath(path)
    const result = await provider.getMovieData('series', id)

    assert.ok(result)
    assert.equal(result.title, 'Silo 2023')
    assert.equal(result.imdbId, 'tt14688458')
    assert.equal(result.isSeries, true)

    const s01e01 = provider.getSeriesLinks(result, 'tt14688458:1:1')
    assert.equal(s01e01.length, 1)
    assert.ok(s01e01[0].url.includes('s01e01'))

    const s02e01 = provider.getSeriesLinks(result, 'tt14688458:2:1')
    assert.equal(s02e01.length, 1)
})

test('F2Media rejects forged paths and missing config', async () => {
    let requests = 0
    const provider = new F2Media('https://www.my-f2mx.top', silentLogger, {
        async get() { requests += 1; return {data: ''} },
    })
    assert.equal(await provider.getMovieData('movie', encodePagePath('/profile/')), null)
    assert.equal(requests, 0)

    const empty = new F2Media('', silentLogger)
    assert.deepEqual(await empty.search('test'), [])
})
