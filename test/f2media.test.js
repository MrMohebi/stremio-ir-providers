import assert from 'node:assert/strict'
import test from 'node:test'

import {load} from 'cheerio'

import F2Media, {parseF2MediaDetail} from '../sources/f2media.js'
import {decodePagePath, encodePagePath} from '../sources/html-source.js'
import {silentLogger} from '../test-support/helpers.js'

const SEARCH_HTML = `
<main><div class="posts">
  <article class="entry">
    <figure class="entry-cover"><img src="https://img.example/silo.jpg">
      <div class="entry-ganers"><a>درام</a><a>علمی تخیلی</a></div>
    </figure>
    <a href="https://f2.example/series/silo/" class="stretched-link" rel="bookmark">
      <h2 class="entry-title">Silo</h2>
    </a>
  </article>
  <article class="entry">
    <figure class="entry-cover"><img src="https://img.example/offworld.jpg"></figure>
    <a href="https://f2.example/45442/offworld-alien-planet-2024/" class="stretched-link" rel="bookmark">
      <h2 class="entry-title">Offworld: Alien Planet</h2>
    </a>
  </article>
</div></main>`

const MOVIE_HTML = `
<section id="post-intro"><h1 class="entry-title">Offworld: Alien Planet 2024</h1></section>
<section id="downloads"><div class="download-list hardsub"><p class="title"><span>بدون زیرنویس</span></p><ul>
  <li><span class="text" dir="ltr">WEB-DL 1080p</span>
    <a href="https://media.example/offworld-1080.mp4" download>دانلود مستقیم</a>
    <a href="#" onclick="handleDownloadClick('https://media.example/offworld-1080.mp4')">player</a>
  </li>
</ul></div></section>`

const SERIES_HTML = `
<section id="post-intro">
  <h1 class="entry-title">Silo 2023</h1>
  <a href="https://www.imdb.com/title/tt14688458">IMDb</a>
</section>
<section id="downloads">
  <div class="download-season"><button>فصل اول زیرنویس و دوبله</button>
    <div class="download-list dubbled"><p class="title"><span>دوبله فارسی</span></p><ul><li>
      <span class="text" dir="ltr">WEB-DL 1080p</span>
      <div class="series-downloaditems">
        <div class="d-flex"><a href="https://media.example/s01e01.mkv" class="btn btn-block btn-default">قسمت 01</a></div>
        <div class="d-flex"><a href="#" onclick="handleDownloadClick('https://media.example/s01e02.mkv')">player</a><a href="https://media.example/s01e02.mkv" class="btn btn-block btn-default">قسمت 02</a></div>
      </div>
    </li></ul></div>
  </div>
  <div class="download-season"><button>فصل دوم</button>
    <div class="download-list"><ul><li><span class="text" dir="ltr">720p</span>
      <div class="series-downloaditems"><div class="d-flex"><a href="https://media.example/s01e01.mkv" class="btn btn-block btn-default">قسمت 01</a></div></div>
    </li></ul></div>
  </div>
</section>`

test('HTML source encodes only valid page paths into route-safe IDs', () => {
    const id = encodePagePath('/series/silo/')
    assert.equal(decodePagePath(id), '/series/silo/')
    assert.match(id, /^[A-Za-z0-9_-]+$/)
    assert.equal(encodePagePath('https://evil.example/'), null)
    assert.equal(decodePagePath('not valid'), null)
})

test('F2Media searches both content types and maps WordPress cards', async () => {
    const debugLogs = []
    const logger = {...silentLogger, debug(message, details) { debugLogs.push({message, details}) }}
    const httpClient = {
        async get(url, config) {
            assert.equal(url, 'https://f2.example/')
            assert.equal(config.params.s, 'Silo')
            assert.equal(config.params.type, 'both')
            assert.equal(config.timeout, 15_000)
            assert.match(config.headers['User-Agent'], /StremioIRProviders/)
            return {data: SEARCH_HTML}
        },
    }
    const provider = new F2Media('https://f2.example', logger, httpClient)
    assert.deepEqual(await provider.search(' Silo '), [
        {
            id: encodePagePath('/series/silo/'),
            name: 'Silo',
            poster: 'https://img.example/silo.jpg',
            type: 'series',
            genres: ['درام', 'علمی تخیلی'],
        },
        {
            id: encodePagePath('/45442/offworld-alien-planet-2024/'),
            name: 'Offworld: Alien Planet',
            poster: 'https://img.example/offworld.jpg',
            type: 'movie',
            genres: [],
        },
    ])
    assert.deepEqual(debugLogs.at(-1), {
        message: 'F2Media search completed',
        details: {query: 'Silo', resultCount: 2},
    })
})

test('F2Media parses direct movie downloads without duplicate player links', () => {
    const movieData = parseF2MediaDetail(load(MOVIE_HTML), 'movie', '/45442/offworld-alien-planet-2024/')
    assert.equal(movieData.title, 'Offworld: Alien Planet 2024')
    assert.deepEqual(movieData.links, [{
        url: 'https://media.example/offworld-1080.mp4',
        title: 'WEB-DL 1080p - بدون زیرنویس',
    }])
})

test('F2Media parses seasons and returns every edition for the requested episode', () => {
    const provider = new F2Media('https://f2.example', silentLogger, {})
    const movieData = parseF2MediaDetail(load(SERIES_HTML), 'series', '/series/silo/')
    assert.equal(movieData.imdbId, 'tt14688458')
    assert.deepEqual(provider.getSeriesLinks(movieData, 'tt14688458:1:2'), [{
        url: 'https://media.example/s01e02.mkv',
        title: 'Season 1 - Episode 2 - WEB-DL 1080p - دوبله فارسی',
    }])
    assert.equal(provider.getSeriesLinks(movieData, 'tt14688458:2:1').length, 1)
})

test('F2Media rejects forged detail paths without making a request', async () => {
    let requests = 0
    const provider = new F2Media('https://f2.example', silentLogger, {
        async get() {
            requests += 1
            return {data: MOVIE_HTML}
        },
    })
    assert.equal(await provider.getMovieData('movie', encodePagePath('/profile/')), null)
    assert.equal(await provider.getMovieData('series', encodePagePath('/45442/offworld/')), null)
    assert.equal(requests, 0)
})
