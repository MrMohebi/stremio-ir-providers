import axios from 'axios'

import HtmlSource, {decodePagePath, isHttpUrl, normalizeText} from './html-source.js'
import {logAxiosError, searchAndGetTMDB} from '../utils.js'

const PERSIAN_SEASONS = new Map([
    ['اول', 1],
    ['دوم', 2],
    ['سوم', 3],
    ['چهارم', 4],
    ['پنجم', 5],
    ['ششم', 6],
    ['هفتم', 7],
    ['هشتم', 8],
    ['نهم', 9],
    ['دهم', 10],
])

function uniqueLinks(items, keyFor = (item) => item.url) {
    const seen = new Set()
    return items.filter((item) => {
        const key = keyFor(item)
        if (!item.url || seen.has(key)) {
            return false
        }
        seen.add(key)
        return true
    })
}

function numberFromText(value) {
    const normalized = String(value ?? '')
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    const match = normalized.match(/\d+/)
    return match ? Number(match[0]) : null
}

function seasonFromText(value, fallback) {
    const text = normalizeText(value)
    const numeric = numberFromText(text.match(/فصل\s*[۰-۹٠-٩\d]+/)?.[0])
    if (numeric != null) {
        return numeric
    }
    for (const [word, season] of PERSIAN_SEASONS) {
        if (text.includes(`فصل ${word}`)) {
            return season
        }
    }
    return fallback
}

function urlFromOnclick(value) {
    const match = String(value ?? '').match(/handleDownloadClick\(\s*(['"])(https?:\/\/.*?)\1/)
    return match?.[2] ?? null
}

function extractQualityFromFilename(url) {
    const match = String(url ?? '').match(/\.(\d{3,4}p)\b/i)
    return match?.[1]?.toLowerCase() ?? null
}

function mediaUrl($element) {
    const href = $element.attr('href')
    if (isHttpUrl(href)) {
        return href
    }
    const onclickUrl = urlFromOnclick($element.attr('onclick'))
    return isHttpUrl(onclickUrl) ? onclickUrl : null
}

function parseMovieLinks($) {
    const links = []
    $('#downloads .download-list li').each((_, item) => {
        const quality = normalizeText($(item).find('.text[dir="ltr"]').first().text())
        const url = mediaUrl($(item).find('a[download][href], a[onclick*="handleDownloadClick"]').first())

        if (url) {
            const titleParts = [quality].filter(Boolean)
            links.push({url, title: titleParts.join(' - ')})
        }
    })
    return uniqueLinks(links)
}

function parseSeriesLinks($) {
    const links = []
    $('#downloads .download-season').each((seasonIndex, seasonElement) => {
        const season = seasonFromText(
            normalizeText($(seasonElement).children('button').first().text()),
            seasonIndex + 1,
        )
        $(seasonElement).find('.series-downloaditems > .d-flex').each((episodeIndex, episodeElement) => {
            const directLink = $(episodeElement).find('a.btn-default[href]').last()
            const fallbackLink = $(episodeElement).find('a[onclick*="handleDownloadClick"]').first()
            const url = mediaUrl(directLink.length ? directLink : fallbackLink)
            const episode = numberFromText(directLink.text()) ?? episodeIndex + 1
            if (url) {
                const quality = normalizeText($(episodeElement).find('.text[dir="ltr"]').first().text())
                    || extractQualityFromFilename(url)
                    || ''
                const titleParts = [
                    `S${season}E${String(episode).padStart(2, '0')}`,
                    quality,
                ].filter(Boolean)
                links.push({
                    season,
                    episode,
                    quality: quality || null,
                    url,
                    title: titleParts.join(' - '),
                })
            }
        })
    })
    return uniqueLinks(links, (item) => `${item.season}:${item.episode}:${item.url}`)
}

function parseF2MediaMovieDetail($, path) {
    const imdbHref = $('a[href*="imdb.com/title/tt"]').first().attr('href') ?? ''
    const imdbId = imdbHref.match(/\/title\/(tt\d+)/)?.[1] ?? null
    const title = normalizeText($('h1.entry-title').first().text())
    const links = parseMovieLinks($)
    return {path, title, imdbId, isSeries: false, links}
}

function parseF2MediaSeriesDetail($, path) {
    const imdbHref = $('a[href*="imdb.com/title/tt"]').first().attr('href') ?? ''
    const imdbId = imdbHref.match(/\/title\/(tt\d+)/)?.[1] ?? null
    const title = normalizeText($('h1.entry-title').first().text())
    const links = parseSeriesLinks($)
    return {path, title, imdbId, isSeries: true, links}
}

function isDetailPath(type, path) {
    if (type === 'series') {
        return /^\/series\/[^/]+\/$/.test(path)
    }
    return type === 'movie' && /^\/\d+\/[^/]+\/$/.test(path)
}

export default class F2Media extends HtmlSource {
    key = 'f2media'

    constructor(baseUrl, logger = console, httpClient = axios, env = process.env) {
        super(baseUrl, logger, httpClient)
        this.providerID = `${this.key}${this.idSeparator}`
        this.tmdbApiKey = env.TMDB_API_KEY
    }

    async isLogin() {
        return true
    }

    async login() {
        return true
    }

    async search(text) {
        const query = normalizeText(text)
        if (!this.baseUrl) {
            this.logger.warn('F2Media search skipped', {reason: 'F2MEDIA_BASEURL is missing'})
            return []
        }
        if (!query) {
            this.logger.debug('F2Media search skipped', {reason: 'empty query'})
            return []
        }

        try {
            this.logger.debug('F2Media search started', {query, baseUrl: this.baseUrl})
            const $ = await this.fetchDocument('/', {params: {s: query}})
            if (!$) {
                return []
            }

            const results = []
            const q = query.toLowerCase()

            $('article.entry a.stretched-link[rel="bookmark"]').each((_, anchor) => {
                const item = $(anchor).closest('article.entry')
                const href = $(anchor).attr('href')
                const path = this.pagePath(href)
                const id = this.pageId(path)
                const name = normalizeText($(anchor).find('.entry-title').text())

                if (!id || !name || !path) {
                    return
                }

                if (!name.toLowerCase().includes(q)) {
                    return
                }

                const type = path.startsWith('/series/') ? 'series' : 'movie'
                if (!isDetailPath(type, path)) {
                    return
                }

                const poster = item.find('figure.entry-cover img').first().attr('src') ?? null

                results.push({
                    id,
                    name,
                    poster,
                    type,
                    genres: [],
                })
            })

            this.logger.debug('F2Media search completed', {query, resultCount: results.length, method: 'html'})
            if (results.length > 0) {
                return results
            }

            this.logger.debug('F2Media search falling back to REST API', {query})
            const restUrl = `${this.baseUrl}/wp-json/wp/v2`
            const lcQuery = query.toLowerCase()
            const fallbackResults = []

            const [postsRes, seriesRes] = await Promise.allSettled([
                this.httpClient.get(`${restUrl}/posts?search=${encodeURIComponent(query)}&per_page=10`, {
                    timeout: 10_000,
                    headers: this.requestConfig().headers,
                }),
                this.httpClient.get(`${restUrl}/series?search=${encodeURIComponent(query)}&per_page=10`, {
                    timeout: 10_000,
                    headers: this.requestConfig().headers,
                }),
            ])

            for (const res of [postsRes, seriesRes]) {
                if (res.status !== 'fulfilled' || !Array.isArray(res.value?.data)) {
                    continue
                }
                for (const item of res.value.data) {
                    const link = item.link ?? ''
                    const path = this.pagePath(link)
                    const id = this.pageId(path)
                    const name = item.title?.rendered
                        ? normalizeText(item.title.rendered).replace(/^(دانلود\s+(فیلم|سریال)\s+)/, '').trim()
                        : ''
                    if (!id || !name || !name.toLowerCase().includes(lcQuery)) {
                        continue
                    }
                    const type = path?.startsWith('/series/') ? 'series' : 'movie'
                    if (!isDetailPath(type, path)) {
                        continue
                    }
                    const imgUrl = item.featured_media_url ?? item.jetpack_featured_media_url ?? null
                    fallbackResults.push({id, name, poster: imgUrl, type, genres: []})
                }
            }

            this.logger.debug('F2Media search completed', {
                query,
                resultCount: fallbackResults.length,
                method: 'rest-api',
            })
            return fallbackResults
        } catch (error) {
            logAxiosError(error, this.logger, 'F2Media search failed')
            return []
        }
    }

    async getMovieData(type, id) {
        const path = decodePagePath(id)
        if (!this.baseUrl || !path || !isDetailPath(type, path)) {
            return null
        }

        try {
            this.logger.debug('F2Media detail started', {type, path})
            const $ = await this.fetchDocument(path)
            const result = $
                ? (type === 'series' ? parseF2MediaSeriesDetail($, path) : parseF2MediaMovieDetail($, path))
                : null
            this.logger.debug('F2Media detail completed', {
                type,
                path,
                linkCount: result?.links.length ?? 0,
                imdbId: result?.imdbId ?? null,
            })
            return result
        } catch (error) {
            logAxiosError(error, this.logger, 'F2Media detail request failed')
            return null
        }
    }

    getMovieLinks(movieData) {
        return Array.isArray(movieData?.links) ? movieData.links : []
    }

    getSeriesLinks(movieData, videoId) {
        const [, seasonText, episodeText] = String(videoId ?? '').split(':')
        const season = Number(seasonText)
        const episode = Number(episodeText)
        if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 0 || episode < 1) {
            return []
        }
        return this.getMovieLinks(movieData)
            .filter((item) => item.season === season && item.episode === episode)
    }

    getLinks(type, videoId, movieData) {
        if (type === 'movie') {
            return this.getMovieLinks(movieData)
        }
        if (type === 'series') {
            return this.getSeriesLinks(movieData, videoId)
        }
        return []
    }

    async imdbID(movieData, type) {
        if (movieData?.imdbId) {
            return movieData.imdbId
        }
        const title = normalizeText(movieData?.title ?? '').replace(/\s+(?:19|20)\d{2}$/, '')
        if (!title) {
            return null
        }
        const tmdbData = await searchAndGetTMDB(title, type, this.httpClient, this.logger, this.tmdbApiKey)
        return tmdbData?.external_ids?.imdb_id ?? null
    }
}
