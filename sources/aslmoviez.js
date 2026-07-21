import axios from 'axios'
import HtmlSource, {decodePagePath, normalizeText} from './html-source.js'
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

function numberFromText(value) {
    const normalized = String(value ?? '')
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    const match = normalized.match(/\d+/)
    return match ? Number(match[0]) : null
}

function seasonFromText(value) {
    const text = normalizeText(value)
    const numeric = numberFromText(text.match(/فصل\s*[:؛,.-]?\s*[۰-۹٠-٩\d]+/)?.[0])
    if (numeric != null) {
        return numeric
    }
    for (const [word, season] of PERSIAN_SEASONS) {
        if (text.includes(`فصل ${word}`)) {
            return season
        }
    }
    return null
}

function extractQualityFromFilename(url) {
    const match = String(url ?? '').match(/\.(\d{3,4}p)\b/i)
    return match?.[1]?.toLowerCase() ?? null
}

function extractEpisodeInfoFromFilename(url) {
    const match = String(url ?? '').match(/S(\d+)E(\d+)/i)
    if (match) {
        return {season: Number(match[1]), episode: Number(match[2])}
    }
    return null
}

function parseAslmoviezMovieLinks($) {
    const links = []
    $('.dlbox_group_body .dlbox_row').each((_, row) => {
        const url = $(row).find('a[href*=".sbs/"]').first().attr('href')
        const quality = normalizeText($(row).find('.dlbox_quality').first().text())
        const size = normalizeText($(row).find('.dlbox_meta_compact_item').first().text())

        if (!url) {
            return
        }

        const qualityFromUrl = extractQualityFromFilename(url)
        const label = quality || qualityFromUrl || ''
        const titleParts = [label, size].filter(Boolean)

        links.push({
            url,
            quality: label,
            size,
            title: titleParts.join(' - '),
        })
    })
    return links
}

function parseAslmoviezSeriesLinks($) {
    const links = []

    $('.season-item').each((_, seasonEl) => {
        const seasonTitle = normalizeText($(seasonEl).find('.dlbox_group_title').first().text())
        const season = seasonFromText(seasonTitle)
        if (season == null) {
            return
        }

        $(seasonEl).find('.quality-item').each((__, qualityEl) => {
            const qualityText = normalizeText($(qualityEl).find('.qh-quality strong').first().text())

            const sizeText = normalizeText(
                $(qualityEl).find('.qh-meta').map((__, m) => normalizeText($(m).text())).get()
                    .find((t) => /\d+\s*(MB|GB)/i.test(t)) ?? ''
            )

            $(qualityEl).find('.episodes-grid a[href]').each((epIndex, epLink) => {
                const $link = $(epLink)
                const url = $link.attr('href')

                if (!url) {
                    return
                }

                const epFromUrl = extractEpisodeInfoFromFilename(url)
                const episode = epFromUrl?.episode ?? epIndex + 1
                const qualityFromUrl = extractQualityFromFilename(url)

                const titleParts = [
                    `S${season}E${String(episode).padStart(2, '0')}`,
                    qualityText || qualityFromUrl || '',
                    sizeText,
                ].filter(Boolean)

                links.push({
                    url,
                    season,
                    episode,
                    quality: qualityText || qualityFromUrl || '',
                    size: sizeText || null,
                    title: titleParts.join(' - '),
                })
            })
        })
    })

    return links
}

function isSeriesPage($) {
    const text = normalizeText($('h1').first().text())
    return text.includes('سریال')
}

export default class Aslmoviez extends HtmlSource {
    key = 'aslmoviez'

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
            this.logger.warn('AslMoviez search skipped', {reason: 'ASLMOVIEZ_BASEURL is missing'})
            return []
        }
        if (!query) {
            this.logger.debug('AslMoviez search skipped', {reason: 'empty query'})
            return []
        }

        try {
            this.logger.debug('AslMoviez search started', {query, baseUrl: this.baseUrl})
            const $ = await this.fetchDocument('/', {
                params: {s: query},
            })
            if (!$) {
                return []
            }

            const results = []
            $('.fc6_poster').each((_, poster) => {
                const link = $(poster).closest('a') || $(poster).find('a').first()
                const href = link.attr('href')
                const path = this.pagePath(href)
                const id = this.pageId(path)

                const titleText = normalizeText($(poster).find('.fc6_title_fa').first().text())
                const name = titleText.replace(/^(دانلود\s+(فیلم|سریال)\s+)/, '').trim()

                if (!id || !name) {
                    return
                }

                const isSeries = titleText.includes('سریال')
                const year = normalizeText($(poster).find('.fc6_year').first().text())
                const posterUrl = $(poster).find('img').first().attr('src') ?? null
                const genres = normalizeText($(poster).find('.fc6_genres').first().text())

                const normalizedName = name.replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g, '').toLowerCase()
                const normalizedQuery = query.toLowerCase()
                if (!normalizedName.includes(normalizedQuery)) {
                    return
                }

                results.push({
                    id,
                    name: year ? `${name} ${year}` : name,
                    poster: posterUrl,
                    type: isSeries ? 'series' : 'movie',
                    genres: genres ? genres.split('•').map((g) => g.trim()).filter(Boolean) : [],
                })
            })

            this.logger.debug('AslMoviez search completed', {query, resultCount: results.length})
            return results
        } catch (error) {
            logAxiosError(error, this.logger, 'AslMoviez search failed')
            return []
        }
    }

    async getMovieData(type, id) {
        const path = decodePagePath(id)
        if (!this.baseUrl || !path) {
            return null
        }

        try {
            this.logger.debug('AslMoviez detail started', {type, path})
            const $ = await this.fetchDocument(path)
            if (!$) {
                return null
            }

            const title = normalizeText($('h1').first().text()).replace(/^(دانلود\s+(فیلم|سریال)\s+)/, '').trim()

            const imdbHref = $('a[href*="imdb.com/title/tt"]').first().attr('href') ?? ''
            const imdbId = imdbHref.match(/\/title\/(tt\d+)/)?.[1] ?? null

            const isSeries = type === 'series' || isSeriesPage($)
            const links = isSeries ? parseAslmoviezSeriesLinks($) : parseAslmoviezMovieLinks($)

            const result = {path, title, imdbId, isSeries, links}
            this.logger.debug('AslMoviez detail completed', {
                path,
                title,
                imdbId: imdbId ?? null,
                isSeries,
                linkCount: links.length,
            })
            return result
        } catch (error) {
            logAxiosError(error, this.logger, 'AslMoviez detail request failed')
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
