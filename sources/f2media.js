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

function mediaUrl($element) {
    const href = $element.attr('href')
    if (isHttpUrl(href)) {
        return href
    }
    const onclickUrl = urlFromOnclick($element.attr('onclick'))
    return isHttpUrl(onclickUrl) ? onclickUrl : null
}

function listLabel($, item, season, episode) {
    const list = $(item).closest('.download-list')
    const quality = normalizeText($(item).closest('li').find('.text[dir="ltr"]').first().text())
    const edition = normalizeText(list.children('.title').first().text())
    return [season && `Season ${season}`, episode && `Episode ${episode}`, quality, edition]
        .filter(Boolean)
        .join(' - ')
}

function parseMovieLinks($) {
    const links = []
    $('#downloads .download-list li').each((_, item) => {
        $(item).find('a[download], a[onclick*="handleDownloadClick"]').each((__, anchor) => {
            const url = mediaUrl($(anchor))
            if (url) {
                links.push({url, title: listLabel($, item)})
            }
        })
    })
    return uniqueLinks(links)
}

function parseSeriesLinks($) {
    const links = []
    $('#downloads .download-season').each((seasonIndex, seasonElement) => {
        const season = seasonFromText($(seasonElement).children('button').first().text(), seasonIndex + 1)
        $(seasonElement).find('.series-downloaditems > .d-flex').each((episodeIndex, episodeElement) => {
            const directLink = $(episodeElement).find('a.btn-default[href]').last()
            const fallbackLink = $(episodeElement).find('a[onclick*="handleDownloadClick"]').first()
            const url = mediaUrl(directLink.length ? directLink : fallbackLink)
            const episode = numberFromText(directLink.text()) ?? episodeIndex + 1
            if (url) {
                links.push({
                    season,
                    episode,
                    url,
                    title: listLabel($, episodeElement, season, episode),
                })
            }
        })
    })
    return uniqueLinks(links, (item) => `${item.season}:${item.episode}:${item.url}`)
}

export function parseF2MediaDetail($, type, path) {
    const imdbHref = $('a[href*="imdb.com/title/tt"]').first().attr('href') ?? ''
    const imdbId = imdbHref.match(/\/title\/(tt\d+)/)?.[1] ?? null
    const title = normalizeText($('#post-intro h1.entry-title').first().text())
    return {
        path,
        title,
        imdbId,
        links: type === 'series' ? parseSeriesLinks($) : parseMovieLinks($),
    }
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
            const $ = await this.fetchDocument('/', {
                params: {
                    s: query,
                    type: 'both',
                    'genre[]': 0,
                    sortby: 'newest',
                    imdbrate: 0,
                    'madeby[]': 0,
                    min_year: 1800,
                    max_year: new Date().getFullYear(),
                    paged: 1,
                },
            })
            if (!$) {
                return []
            }

            const results = []
            $('main article.entry > a.stretched-link[rel="bookmark"]').each((_, anchor) => {
                const item = $(anchor).closest('article.entry')
                const path = this.pagePath($(anchor).attr('href'))
                const id = this.pageId(path)
                const name = normalizeText($(anchor).find('.entry-title').text())
                const type = path?.startsWith('/series/') ? 'series' : 'movie'
                if (!id || !name || !isDetailPath(type, path)) {
                    return
                }
                results.push({
                    id,
                    name,
                    poster: item.find('figure.entry-cover img').first().attr('src'),
                    type,
                    genres: item.find('.entry-ganers a').map((__, genre) => normalizeText($(genre).text())).get(),
                })
            })
            this.logger.debug('F2Media search completed', {query, resultCount: results.length})
            return results
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
            const result = $ ? parseF2MediaDetail($, type, path) : null
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
            .map(({url, title}) => ({url, title}))
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
        const title = normalizeText(movieData?.title).replace(/\s+(?:19|20)\d{2}$/, '')
        const tmdbData = await searchAndGetTMDB(title, type, this.httpClient, this.logger, this.tmdbApiKey)
        return tmdbData?.external_ids?.imdb_id ?? null
    }
}
