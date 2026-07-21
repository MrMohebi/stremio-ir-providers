import axios from 'axios'
import HtmlSource, {decodePagePath, normalizeText} from './html-source.js'
import {logAxiosError, searchAndGetTMDB} from '../utils.js'

function numberFromText(value) {
    const normalized = String(value ?? '')
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    const match = normalized.match(/\d+/)
    return match ? Number(match[0]) : null
}

function extractImdbId($) {
    const imdbHref = $('a[href*="imdb.com/title/tt"]').first().attr('href') ?? ''
    let id = imdbHref.match(/\/title\/(tt\d+)/)?.[1] ?? null
    if (id) {
        return id
    }

    const articleImg = $('article.postItem .thumbnailWrapper img[src*="tt"]').first()
    const articleSrc = articleImg.attr('src') ?? ''
    id = articleSrc.match(/tt\d+/)?.[0] ?? null
    if (id) {
        return id
    }

    $('img[src*="tt"]').each((_, img) => {
        const src = $(img).attr('src') ?? ''
        const match = src.match(/tt\d+/)
        if (match) {
            id = match[0]
            return false
        }
    })

    return id ?? null
}

function detectAudioType(text) {
    if (text.includes('دوبله')) {
        return 'dubbed'
    }
    if (text.includes('زیرنویس')) {
        return 'subtitled'
    }
    return 'original'
}

function audioTypeLabel(type) {
    if (type === 'dubbed') {
        return 'دوبله فارسی'
    }
    if (type === 'subtitled') {
        return 'زیرنویس فارسی'
    }
    return ''
}

function parseCinamaticMovieLinks($) {
    const links = []
    $('.downloadWrapper .downloadBox').each((_, box) => {
        const boxHeadText = normalizeText($(box).find('.boxHead p').text())
        const audioType = detectAudioType(boxHeadText)
        const label = audioTypeLabel(audioType)

        $(box).find('.boxRows .row').each((__, row) => {
            const url = $(row).find('a.download').attr('href')
            const quality = normalizeText($(row).find('.infos .name').text())
            const size = normalizeText($(row).find('.infos .size').text())

            if (!url) {
                return
            }

            const titleParts = [quality, label, size].filter(Boolean)
            links.push({
                url,
                quality,
                size,
                audioType,
                title: titleParts.join(' - '),
            })
        })
    })
    return links
}

function parseCinamaticSeriesLinks($) {
    const links = []
    $('.downloadWrapper .downloadBox').each((_, box) => {
        const boxHeadText = normalizeText($(box).find('.boxHead p').text())
        if (!boxHeadText.includes('فصل')) {
            return
        }

        const season = numberFromText(boxHeadText)
        if (season == null) {
            return
        }

        const audioType = detectAudioType(boxHeadText)
        const label = audioTypeLabel(audioType)

        $(box).find('.boxRows .row').each((__, row) => {
            const url = $(row).find('a.download').attr('href')
            const nameText = normalizeText($(row).find('.infos .name').text())
            const size = normalizeText($(row).find('.infos .size').text())

            if (!url) {
                return
            }

            const episode = numberFromText(nameText)
            if (episode == null) {
                return
            }

            const quality = normalizeText(
                $(box).find('.boxHead p span').filter((__, s) => normalizeText($(s).text()).includes('کیفیت'))
                    .first().text().replace(/کیفیت\s*/, '')
            )

            const titleParts = [
                `S${season}E${String(episode).padStart(2, '0')}`,
                quality,
                label,
                size,
            ].filter(Boolean)

            links.push({
                url,
                season,
                episode,
                quality: quality || nameText,
                size,
                audioType,
                title: titleParts.join(' - '),
            })
        })
    })
    return links
}

export default class Cinamatic extends HtmlSource {
    key = 'cinamatic'

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
            this.logger.warn('Cinamatic search skipped', {reason: 'CINAMATIC_BASEURL is missing'})
            return []
        }
        if (!query) {
            this.logger.debug('Cinamatic search skipped', {reason: 'empty query'})
            return []
        }

        try {
            this.logger.debug('Cinamatic search started', {query, baseUrl: this.baseUrl})
            const $ = await this.fetchDocument('/', {params: {s: query}})
            if (!$) {
                return []
            }

            const results = []
            $('article h2 a').each((_, anchor) => {
                const item = $(anchor).closest('article')
                const href = $(anchor).attr('href')
                const path = this.pagePath(href)
                const id = this.pageId(path)
                const name = normalizeText($(anchor).text())

                if (!id || !name || !path) {
                    return
                }

                const linkTitle = normalizeText($(anchor).attr('title') ?? '')
                const imgAlt = normalizeText(item.find('img').first().attr('alt') ?? '')
                const categoryLinks = item.find('a[href*="/category/"]').map((__, l) => $(l).attr('href')).get()
                const hasSeriesCategory = categoryLinks.some((href) => href.includes('/category/series/'))
                const hasSeriesLink = item.find('a[href*="/series/"]').length > 0
                const type = hasSeriesCategory || hasSeriesLink ? 'series' : 'movie'
                const poster = item.find('img').first().attr('src') ?? null

                results.push({
                    id,
                    name,
                    poster,
                    type,
                    genres: [],
                })
            })

            this.logger.debug('Cinamatic search completed', {query, resultCount: results.length})
            return results
        } catch (error) {
            logAxiosError(error, this.logger, 'Cinamatic search failed')
            return []
        }
    }

    async getMovieData(type, id) {
        const path = decodePagePath(id)
        if (!this.baseUrl || !path) {
            return null
        }

        try {
            this.logger.debug('Cinamatic detail started', {type, path})
            const $ = await this.fetchDocument(path)
            if (!$) {
                return null
            }

            const title = normalizeText($('h1').first().text())
            const imdbId = extractImdbId($)

            let isSeries = false
            $('.downloadWrapper .downloadBox .boxHead p').each((_, p) => {
                if (normalizeText($(p).text()).includes('فصل')) {
                    isSeries = true
                    return false
                }
            })

            const links = isSeries ? parseCinamaticSeriesLinks($) : parseCinamaticMovieLinks($)
            const audioTypes = [...new Set(links.map((item) => item.audioType).filter(Boolean))]

            const result = {path, title, imdbId, isSeries, links, audioTypes}
            this.logger.debug('Cinamatic detail completed', {
                path,
                title,
                imdbId: imdbId ?? null,
                isSeries,
                linkCount: links.length,
            })
            return result
        } catch (error) {
            logAxiosError(error, this.logger, 'Cinamatic detail request failed')
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

        const title = normalizeText(movieData?.title ?? '')
            .replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿].*$/, '')
            .replace(/\s+(?:19|20)\d{2}\s*$/, '')
            .trim()

        if (!title) {
            return null
        }

        const tmdbData = await searchAndGetTMDB(title, type, this.httpClient, this.logger, this.tmdbApiKey)
        return tmdbData?.external_ids?.imdb_id ?? null
    }
}
