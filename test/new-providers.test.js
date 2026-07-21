import assert from 'node:assert/strict'
import test from 'node:test'

import Aslmoviez from '../sources/aslmoviez.js'
import Cinamatic from '../sources/cinamatic.js'
import Serialblog from '../sources/serialblog.js'
import {encodePagePath} from '../sources/html-source.js'
import {silentLogger} from '../test-support/helpers.js'

// ───────── Helper ─────────

function httpOk(html) {
    return {data: String(html)}
}

// ═══════════ CINAMATIC ═══════════

const CINAMATIC_SEARCH_HTML = `
<article class="postItem">
  <div class="box">
    <div class="infos">
      <div class="info">
        <h2><a href="https://cinamatic.top/2025/10/29/inception-2010/" title="Inception 2010 تلقین">Inception 2010 تلقین</a></h2>
      </div>
      <div class="sideInfo">
        <img src="https://cinamatic.top/wp-content/uploads/2025/05/tt1375666-2010-203x300.jpg" alt="Inception 2010">
      </div>
    </div>
    <a href="https://cinamatic.top/category/film/">فیلم</a>
  </div>
</article>
<article>
  <div class="box">
    <div class="infos">
      <div class="info">
        <h2><a href="https://cinamatic.top/2026/07/17/silo-2023/" title="سیلو Silo 2023">سیلو Silo 2023</a></h2>
      </div>
      <div class="sideInfo">
        <img src="https://cinamatic.top/wp-content/uploads/2026/07/silo-poster.jpg" alt="Silo">
      </div>
    </div>
    <a href="https://cinamatic.top/category/series/">سریال</a>
  </div>
</article>`

test('Cinamatic search parses WordPress posts with IMDb IDs from images', async () => {
    const debugLogs = []
    const logger = {...silentLogger, debug(m, d) { debugLogs.push({m, d}) }}
    const httpClient = {
        async get(url, config) {
            assert.equal(config.params.s, 'Inception')
            assert.match(config.headers['User-Agent'], /StremioIRProviders/)
            return httpOk(CINAMATIC_SEARCH_HTML)
        },
    }
    const provider = new Cinamatic('https://cinamatic.top', logger, httpClient)
    const results = await provider.search('Inception')

    assert.equal(results.length, 2)
    const inception = results.find((r) => r.name.startsWith('Inception'))
    assert.ok(inception)
    assert.equal(inception.type, 'movie')
    assert.ok(inception.id)
    assert.ok(inception.poster)

    const silo = results.find((r) => r.name.includes('Silo'))
    assert.ok(silo)
    // Silo should be detected as series if the article text contains "سریال"
    assert.equal(silo.type, 'series')

    assert.deepEqual(debugLogs.at(-1), {
        m: 'Cinamatic search completed',
        d: {query: 'Inception', resultCount: 2},
    })
})

const CINAMATIC_MOVIE_HTML = `
<div class="contentWrapper">
  <article class="postItem">
    <div class="info">
      <h1><a title="Inception 2010 تلقین">Inception 2010 تلقین</a></h1>
      <div class="text">
        <span class="faa">دوبله فارسی</span>
        <span class="subb">زیرنویس فارسی</span>
      </div>
      <div class="rowInfo">
        <p><span class="title">ژانر : </span>اکشن,علمی تخیلی</p>
        <p><span class="title">سال انتشار : </span><a href="/release/2010/">2010</a></p>
        <p><span class="title">محصول : </span><a href="/country/united-states/">آمریکا</a></p>
        <p><span class="title">کارگردان : </span><a>Christopher Nolan</a></p>
      </div>
    </div>
  </article>
  <div class="downloadWrapper">
    <div class="downloadBox">
      <div class="boxHead"><p>دوبله فارسی <span>Cinamatic</span><span>دوبله فارسی</span></p></div>
      <div class="boxRows">
        <div class="row">
          <a class="download" href="https://dl21.namadownload.top/1404/movies/01/Inception.2010.1080p.Dubbed.ZarFilm.mp4">
            دانلود با لینک مستقیم
          </a>
          <div class="infos"><span class="name">1080p</span><span class="size">2.3GB</span></div>
        </div>
        <div class="row">
          <a class="download" href="https://dl21.namadownload.top/1404/movies/01/Inception.2010.720p.Dubbed.ZarFilm.mp4">
            دانلود با لینک مستقیم
          </a>
          <div class="infos"><span class="name">720p</span><span class="size">1.3GB</span></div>
        </div>
      </div>
    </div>
    <div class="downloadBox">
      <div class="boxHead"><p>زیرنویس چسبیده <span>Cinamatic</span><span>زیرنویس فارسی</span></p></div>
      <div class="boxRows">
        <div class="row">
          <a class="download" href="https://dl21.namadownload.top/1404/movies/01/Inception.2010.1080p.YIFY.mkv">
            دانلود با لینک مستقیم
          </a>
          <div class="infos"><span class="name">1080p</span><span class="size">1.9GB</span></div>
        </div>
      </div>
    </div>
  </div>
</div>`

test('Cinamatic parses movie download links with audio types and qualities', async () => {
    const httpClient = {
        async get(url, config) {
            return httpOk(CINAMATIC_MOVIE_HTML)
        },
    }
    const provider = new Cinamatic('https://cinamatic.top', silentLogger, httpClient)
    const path = '/2025/10/29/inception-2010/'
    const id = encodePagePath(path)
    const movieData = await provider.getMovieData('movie', id)

    assert.ok(movieData)
    assert.equal(movieData.isSeries, false)
    assert.ok(movieData.links.length >= 3)

    const dubbedd1080 = movieData.links.find((l) => l.url.includes('1080p.Dubbed'))
    assert.ok(dubbedd1080)
    assert.equal(dubbedd1080.quality, '1080p')

    const subtitled1080 = movieData.links.find((l) => l.url.includes('YIFY'))
    assert.ok(subtitled1080)

    // getMovieLinks returns all links
    const streamLinks = provider.getMovieLinks(movieData)
    assert.equal(streamLinks.length, movieData.links.length)
})

const CINAMATIC_SERIES_HTML = `
<div class="contentWrapper">
  <article class="postItem">
    <div class="info">
      <h1><a title="Silo 2023">Silo 2023</a></h1>
      <div class="rowInfo">
        <p><span class="title">ژانر : </span>درام,علمی تخیلی</p>
        <p><span class="title">سال انتشار : </span><a href="/release/2023/">2023</a></p>
      </div>
    </div>
  </article>
  <div class="downloadWrapper">
    <div class="downloadBox">
      <div class="boxHead"><p>فصل 1 - زیرنویس <span>کیفیت 1080</span><span>زیرنویس</span></p></div>
      <div class="boxRows">
        <div class="row">
          <a class="download" href="https://dl22.cinamadownload.top/1404/series/03.1/Silo.S01E01.1080p.mkv">دانلود</a>
          <div class="infos"><span class="name">قسمت 1</span><span class="size">967MB</span></div>
        </div>
        <div class="row">
          <a class="download" href="https://dl22.cinamadownload.top/1404/series/03.1/Silo.S01E02.1080p.mkv">دانلود</a>
          <div class="infos"><span class="name">قسمت 2</span><span class="size">950MB</span></div>
        </div>
      </div>
    </div>
    <div class="downloadBox">
      <div class="boxHead"><p>فصل 1 - دوبله فارسی <span>کیفیت 1080</span><span>دوبله فارسی</span></p></div>
      <div class="boxRows">
        <div class="row">
          <a class="download" href="https://dl27.cinamadownload.top/1404/series/12.5/Silo.S01E01.1080p.Dubbed.mkv">دانلود</a>
          <div class="infos"><span class="name">قسمت 1</span><span class="size">962MB</span></div>
        </div>
      </div>
    </div>
  </div>
</div>`

test('Cinamatic parses series seasons, episodes, and audio versions', async () => {
    const httpClient = {
        async get(url, config) {
            return httpOk(CINAMATIC_SERIES_HTML)
        },
    }
    const provider = new Cinamatic('https://cinamatic.top', silentLogger, httpClient)
    const path = '/2026/07/17/silo-2023/'
    const id = encodePagePath(path)
    const movieData = await provider.getMovieData('series', id)

    assert.ok(movieData)
    assert.equal(movieData.isSeries, true)
    assert.ok(movieData.links.length >= 3)

    // Episode 1 season 1 - should have softsub
    const ep1Links = provider.getSeriesLinks(movieData, 'tt14688458:1:1')
    assert.ok(ep1Links.length >= 2, 'should have at least 2 audio versions for ep1') // softsub + dubbed
    assert.ok(ep1Links.every((l) => l.url && l.title))

    // Episode 2 season 1 - should only have softsub (dubbed only has ep1)
    const ep2Links = provider.getSeriesLinks(movieData, 'tt14688458:1:2')
    assert.equal(ep2Links.length, 1)
})

// ═══════════ ASLMOVIEZ ═══════════

const ASLMOVIEZ_SEARCH_HTML = `
<div class="posts">
  <a href="https://aslmoviez.com/tt1375666-inception-2010" class="card_link">
    <div class="fc6_poster">
      <img src="https://aslmoviez.com/wp-content/uploads/inception.jpg" alt="دانلود فیلم Inception">
      <div class="fc6_imdb is-high"><span class="fc6_imdb_val">8.8</span></div>
      <div class="fc6_info">
        <h2 class="fc6_title_fa">دانلود فیلم Inception</h2>
        <div class="fc6_meta">
          <span class="fc6_year">2010</span>
          <span class="fc6_genres">اکشن • علمی تخیلی</span>
        </div>
      </div>
    </div>
  </a>
  <a href="https://aslmoviez.com/tt14688458-silo" class="card_link">
    <div class="fc6_poster">
      <img src="https://aslmoviez.com/wp-content/uploads/silo.jpg" alt="دانلود سریال Silo">
      <div class="fc6_imdb"><span class="fc6_imdb_val">8.1</span></div>
      <div class="fc6_info">
        <h2 class="fc6_title_fa">دانلود سریال Silo</h2>
        <div class="fc6_meta">
          <span class="fc6_year">2023</span>
          <span class="fc6_genres">درام • علمی تخیلی</span>
        </div>
      </div>
    </div>
  </a>
</div>`

const ASLMOVIEZ_MOVIE_HTML = `
<div>
  <h1>دانلود فیلم Inception (2010)</h1>
  <a href="https://www.imdb.com/title/tt1375666">IMDb</a>
  <div class="dlbox_group">
    <div class="dlbox_group_header">
      <span class="dlbox_group_title">نسخه زیرنویس فارسی</span>
    </div>
    <div class="dlbox_group_body">
      <div class="dlbox_row">
        <div class="dlbox_row_info">
          <div class="dlbox_quality_block">
            <span class="dlbox_quality">BluRay 1080p</span>
            <span class="dlbox_meta_compact"><span class="dlbox_meta_compact_item">1.9 GB</span></span>
          </div>
        </div>
        <a href="https://cdn.aslmd.sbs/movies/2010/tt1375666/Softsub/Inception.2010.1080p.BrRip.x264.Softsub.AslMoviez.mkv">دانلود با لینک مستقیم</a>
      </div>
      <div class="dlbox_row">
        <div class="dlbox_row_info">
          <span class="dlbox_quality">BluRay 720p</span>
          <span class="dlbox_meta_compact"><span class="dlbox_meta_compact_item">1.1 GB</span></span>
        </div>
        <a href="https://cdn.aslmd.sbs/movies/2010/tt1375666/Softsub/Inception.2010.720p.x264.Softsub.AslMoviez.mkv">دانلود با لینک مستقیم</a>
      </div>
    </div>
  </div>
</div>`

test('AslMoviez search parses fc6_poster cards with type detection', async () => {
    const httpClient = {
        async get(url, config) {
            assert.equal(config.params.s, 'Inception')
            return httpOk(ASLMOVIEZ_SEARCH_HTML)
        },
    }
    const provider = new Aslmoviez('https://aslmoviez.com', silentLogger, httpClient)
    const results = await provider.search('Inception')

    assert.equal(results.length, 1)

    const movie = results.find((r) => r.name.startsWith('Inception'))
    assert.ok(movie)
    assert.equal(movie.type, 'movie')
    assert.match(movie.id, /^[A-Za-z0-9_-]+$/)
})

test('AslMoviez parses movie download links with quality labels', async () => {
    const httpClient = {
        async get(url, config) {
            return httpOk(ASLMOVIEZ_MOVIE_HTML)
        },
    }
    const provider = new Aslmoviez('https://aslmoviez.com', silentLogger, httpClient)
    const path = '/tt1375666-inception-2010'
    const id = encodePagePath(path)
    const movieData = await provider.getMovieData('movie', id)

    assert.ok(movieData)
    assert.equal(movieData.imdbId, 'tt1375666')
    assert.equal(movieData.isSeries, false)
    assert.ok(movieData.links.length >= 2)

    const links = provider.getMovieLinks(movieData)
    assert.ok(links.every((l) => l.url && l.title))
    assert.ok(links.some((l) => l.url.includes('cdn.aslmd.sbs')))
})

const ASLMOVIEZ_SERIES_HTML = `
<div>
  <h1>دانلود سریال Silo (2023)</h1>
  <a href="https://www.imdb.com/title/tt14688458">IMDb</a>

  <div class="dlbox_group season-item" id="serialSeason1">
    <div class="dlbox_group_header">
      <span class="dlbox_group_title">فصل : 1</span>
    </div>
    <div class="dlbox_group_body" style="display:block">
      <div class="dlbox_group quality-accordion quality-item" id="serialQ1_1">
        <div class="dlbox_group_header quality-header">
          <strong>WEB-DL 1080p.10bit.x265 - PSA</strong>
          <span class="qh-badges"><span class="badge-subtitle">زیرنویس</span></span>
        </div>
        <div class="dlbox_group_body quality-episodes-body" style="display:block">
          <div class="episodes-grid">
            <a download="" href="https://cdn.aslmd.sbs/series2/tt14688458/S01/1080/Silo.S01E01.1080p.10bit.WEB-DL.6CH.x265.HEVC.PSA.SoftSub.Aslmoviez.mkv" class="btn-episode btn-ep-dl">دانلود قسمت 1</a>
            <a download="" href="https://cdn.aslmd.sbs/series2/tt14688458/S01/1080/Silo.S01E02.1080p.10bit.WEB-DL.6CH.x265.HEVC.PSA.SoftSub.Aslmoviez.mkv" class="btn-episode btn-ep-dl">دانلود قسمت 2</a>
          </div>
        </div>
      </div>
      <div class="dlbox_group quality-accordion quality-item" id="serialQ1_2">
        <div class="dlbox_group_header quality-header">
          <strong>WEB-DL 720p.10bit.x265 - PSA</strong>
        </div>
        <div class="dlbox_group_body quality-episodes-body" style="display:block">
          <div class="episodes-grid">
            <a download="" href="https://cdn.aslmd.sbs/series2/tt14688458/S01/720/Silo.S01E01.720p.WEB-DL.x264.Pahe.SoftSub.Aslmoviez.mkv" class="btn-episode btn-ep-dl">دانلود قسمت 1</a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="dlbox_group season-item" id="serialSeason2">
    <div class="dlbox_group_header">
      <span class="dlbox_group_title">فصل : 2</span>
    </div>
    <div class="dlbox_group_body" style="display:block">
      <div class="dlbox_group quality-accordion quality-item" id="serialQ2_1">
        <div class="dlbox_group_header quality-header">
          <strong>WEB-DL 1080p.10bit.x265 - PSA</strong>
        </div>
        <div class="dlbox_group_body quality-episodes-body" style="display:block">
          <div class="episodes-grid">
            <a download="" href="https://cdn.aslmd.sbs/series2/tt14688458/S02/1080/Silo.S02E01.1080p.10bit.WEB-DL.6CH.x265.HEVC-PSA.SoftSub.Aslmoviez.mkv" class="btn-episode btn-ep-dl">دانلود قسمت 1</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`

test('AslMoviez parses series season structure with nested quality accordions', async () => {
    const httpClient = {
        async get(url, config) {
            return httpOk(ASLMOVIEZ_SERIES_HTML)
        },
    }
    const provider = new Aslmoviez('https://aslmoviez.com', silentLogger, httpClient)
    const path = '/tt14688458-silo'
    const id = encodePagePath(path)
    const movieData = await provider.getMovieData('series', id)

    assert.ok(movieData)
    assert.equal(movieData.imdbId, 'tt14688458')
    assert.equal(movieData.isSeries, true)
    assert.ok(movieData.links.length >= 3)

    // Season 1 Episode 1 should have 2 quality options
    const s01e01 = provider.getSeriesLinks(movieData, 'tt14688458:1:1')
    assert.equal(s01e01.length, 2)

    // Season 2 Episode 1 should have 1 quality option
    const s02e01 = provider.getSeriesLinks(movieData, 'tt14688458:2:1')
    assert.equal(s02e01.length, 1)
})

// ═══════════ SERIALBLOG ═══════════

test('Serialblog extends Aslmoviez with different key', () => {
    const provider = new Serialblog('https://serialblog1.top', silentLogger, {})
    assert.equal(provider.key, 'serialblog')
    assert.ok(provider.providerID.startsWith('serialblog'))
})

test('AslMoviez rejects missing baseUrl gracefully', async () => {
    const provider = new Aslmoviez('', silentLogger)
    assert.deepEqual(await provider.search('test'), [])
    assert.equal(await provider.getMovieData('movie', 'test'), null)
})

test('Cinamatic rejects missing baseUrl gracefully', async () => {
    const provider = new Cinamatic('', silentLogger)
    assert.deepEqual(await provider.search('test'), [])
    assert.equal(await provider.getMovieData('movie', 'test'), null)
})

test('All new providers handle empty search gracefully', async () => {
    const providers = [
        new Aslmoviez('https://aslmoviez.com', silentLogger, {}),
        new Cinamatic('https://cinamatic.top', silentLogger, {}),
        new Serialblog('https://serialblog1.top', silentLogger, {}),
    ]
    for (const provider of providers) {
        assert.deepEqual(await provider.search(''), [])
        assert.deepEqual(await provider.search('   '), [])
    }
})
