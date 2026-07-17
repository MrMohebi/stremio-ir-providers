import axios from 'axios'
import Source, {METADATA_SOURCE} from './source.js'
import {logAxiosError, REQUEST_TIMEOUT_MS} from '../utils.js'

export const PEEPBOXTV_ANDROID_USER_AGENT = 'okhttp/4.12.0'

function uniqueItems(items) {
    const seen = new Set()
    return items.filter((item) => {
        const id = String(item?.videos_id ?? '')
        if (!id || seen.has(id)) {
            return false
        }
        seen.add(id)
        return true
    })
}

function itemNames(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => String(item?.name ?? '').trim())
        .filter(Boolean)
}

function numberFromText(value, fallback = null) {
    const normalized = String(value ?? '')
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    const match = normalized.match(/\d+/)
    return match ? Number(match[0]) : fallback
}

function seriesVideos(movieData, itemId) {
    const videos = []
    const seen = new Set()
    const seasons = Array.isArray(movieData?.season) ? movieData.season : []

    for (const seasonData of seasons) {
        const season = numberFromText(seasonData?.seasons_name)
        if (!Number.isInteger(season) || season < 0) {
            continue
        }

        const episodes = Array.isArray(seasonData?.episodes) ? seasonData.episodes : []
        episodes.forEach((episodeData, episodeIndex) => {
            const episode = numberFromText(episodeData?.episodes_name, episodeIndex + 1)
            const key = `${season}:${episode}`
            if (!Number.isInteger(episode) || episode < 1 || seen.has(key)) {
                return
            }
            seen.add(key)
            videos.push({
                id: `${itemId}:${season}:${episode}`,
                title: String(episodeData?.episodes_name ?? `Episode ${episode}`),
                season,
                episode,
                thumbnail: episodeData?.image_url,
            })
        })
    }

    return videos.sort((left, right) => left.season - right.season || left.episode - right.episode)
}

export default class Peepboxtv extends Source {
    key = 'peepboxtv'
    metadataSource = METADATA_SOURCE.PROVIDER

    constructor(baseUrl, logger = console, httpClient = axios, env = process.env) {
        super(baseUrl, logger, httpClient)
        this.providerID = `${this.key}${this.idSeparator}`
        this.userId = env.PEEPBOXTV_USER_ID
        this.androidId = env.PEEPBOXTV_ANDROID_ID
        this.apiKey = env.PEEPBOXTV_API_KEY
    }

    async isLogin() {
        return true
    }

    async login() {
        return true
    }

    requestConfig() {
        return {
            headers: {
                'api-key': this.apiKey,
                Host: new URL(this.baseUrl).host,
                'User-Agent': PEEPBOXTV_ANDROID_USER_AGENT,
            },
            timeout: REQUEST_TIMEOUT_MS,
        }
    }

    async search(text) {
        const query = String(text ?? '').trim()
        if (!this.baseUrl) {
            this.logger.warn('PeepBoxTV search skipped', {reason: 'PEEPBOXTV_BASEURL is missing'})
            return []
        }
        if (!query) {
            this.logger.debug('PeepBoxTV search skipped', {reason: 'empty query'})
            return []
        }
        if (!this.apiKey) {
            this.logger.warn('PeepBoxTV search skipped', {reason: 'PEEPBOXTV_API_KEY is missing'})
            return []
        }

        try {
            this.logger.debug('PeepBoxTV search started', {query, baseUrl: this.baseUrl})
            const response = await this.httpClient.get(this.endpoint('rest-api/v130/search'), {
                ...this.requestConfig(),
                params: {
                    q: query,
                    page: 1,
                    type: 'all',
                    range_to: 2040,
                    range_from: 1300,
                    tv_category_id: 0,
                    genre_id: 0,
                    country_id: 0,
                    imdb_to: 10,
                    imdb_from: 1,
                },
            })
            const items = uniqueItems([
                ...(Array.isArray(response.data?.movie) ? response.data.movie : []),
                ...(Array.isArray(response.data?.tvseries) ? response.data.tvseries : []),
            ])
            const results = items
                .map((item) => ({
                    name: item.title ?? '',
                    poster: item.thumbnail_url,
                    type: String(item.is_tvseries) === '1' ? 'series' : 'movie',
                    id: String(item.videos_id),
                    genres: [],
                }))
            this.logger.debug('PeepBoxTV search completed', {query, resultCount: results.length})
            return results
        } catch (error) {
            logAxiosError(error, this.logger, 'PeepBoxTV search failed')
            return []
        }
    }

    async getMovieData(type, id) {
        if (!this.baseUrl || !id) {
            return null
        }
        if (!this.apiKey) {
            this.logger.warn('PeepBoxTV detail skipped', {reason: 'PEEPBOXTV_API_KEY is missing'})
            return null
        }

        try {
            this.logger.debug('PeepBoxTV detail started', {type, id: String(id)})
            const response = await this.httpClient.get(this.endpoint('rest-api/v130/single_details'), {
                ...this.requestConfig(),
                params: {
                    type: type === 'movie' ? 'movie' : 'tvseries',
                    id,
                    user_id: this.userId,
                    android_id: this.androidId,
                },
            })
            if (!response.data?.videos_id) {
                this.logger.warn('PeepBoxTV detail rejected', {
                    type,
                    id: String(id),
                    status: response.data?.status,
                    upstreamMessage: response.data?.message,
                })
                return null
            }
            this.logger.debug('PeepBoxTV detail completed', {
                type,
                id: String(id),
                seasonCount: Array.isArray(response.data.season) ? response.data.season.length : 0,
                videoCount: Array.isArray(response.data.videos) ? response.data.videos.length : 0,
            })
            return response.data
        } catch (error) {
            logAxiosError(error, this.logger, 'PeepBoxTV detail request failed')
            return null
        }
    }

    getMovieLinks(movieData) {
        const videos = Array.isArray(movieData?.videos) ? movieData.videos : []
        return videos
            .filter((item) => item?.file_url)
            .map((item) => ({url: item.file_url, title: item.label ?? ''}))
    }

    getSeriesLinks(movieData, videoId) {
        const [, seasonText, episodeText] = String(videoId ?? '').split(':')
        const season = Number(seasonText)
        const episode = Number(episodeText)
        if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 0 || episode < 1) {
            return []
        }

        const seasonTitle = `فصل ${season}`
        const seasons = Array.isArray(movieData?.season) ? movieData.season : []
        return seasons
            .filter((item) => numberFromText(item?.seasons_name) === season)
            .map((item) => {
                const episodes = Array.isArray(item?.episodes) ? item.episodes : []
                const selectedEpisode = episodes.find((candidate, index) => (
                    numberFromText(candidate?.episodes_name, index + 1) === episode
                ))
                const edition = String(item.seasons_name ?? '').split(' - ')[1]
                return {
                    url: selectedEpisode?.file_url,
                    title: [movieData?.title, seasonTitle, selectedEpisode?.episodes_name, edition]
                        .filter(Boolean)
                        .join(' - '),
                }
            })
            .filter((item) => item.url)
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

    getMeta(type, id, movieData) {
        const itemId = String(id ?? movieData?.videos_id ?? '')
        const name = String(movieData?.title ?? '').trim()
        if (!itemId || !name || !['movie', 'series'].includes(type)) {
            return null
        }

        const meta = {
            id: itemId,
            type,
            name,
            description: movieData?.description,
            poster: movieData?.poster_url ?? movieData?.thumbnail_url,
            background: movieData?.thumbnail_url ?? movieData?.poster_url,
            releaseInfo: movieData?.release,
            runtime: movieData?.runtime,
            imdbRating: movieData?.imdb_rating,
            genres: itemNames(movieData?.genre),
            country: itemNames(movieData?.country).join(', '),
            director: itemNames(movieData?.director),
            cast: itemNames(movieData?.cast),
        }
        if (type === 'series') {
            meta.videos = seriesVideos(movieData, itemId)
        }
        return meta
    }
}
