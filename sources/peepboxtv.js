import axios from 'axios'
import Source from './source.js'
import {logAxiosError, REQUEST_TIMEOUT_MS, searchAndGetTMDB} from '../utils.js'

export default class Peepboxtv extends Source {
    key = 'peepboxtv'

    constructor(baseUrl, logger = console, httpClient = axios, env = process.env) {
        super(baseUrl, logger, httpClient, 'https:')
        this.providerID = `${this.key}${this.idSeparator}`
        this.userId = env.PEEPBOXTV_USER_ID
        this.androidId = env.PEEPBOXTV_ANDROID_ID
        this.apiKey = env.PEEPBOXTV_API_KEY
        this.tmdbApiKey = env.TMDB_API_KEY
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
            },
            timeout: REQUEST_TIMEOUT_MS,
        }
    }

    async search(text) {
        if (!this.baseUrl || !this.apiKey || !String(text ?? '').trim()) {
            return []
        }

        try {
            const response = await this.httpClient.get(this.endpoint('rest-api/v130/search'), {
                ...this.requestConfig(),
                params: {
                    q: text,
                    page: 1,
                    type: 'all',
                    range_to: 2030,
                    range_from: 1300,
                    tv_category_id: 0,
                    genre_id: 0,
                    country_id: 0,
                    imdb_to: 10,
                    imdb_from: 1,
                },
            })
            const items = Array.isArray(response.data?.movie) ? response.data.movie : []
            return items
                .filter((item) => item?.videos_id != null)
                .map((item) => ({
                    name: item.title ?? '',
                    poster: item.thumbnail_url,
                    type: String(item.is_tvseries) === '1' ? 'series' : 'movie',
                    id: String(item.videos_id),
                    genres: [],
                }))
        } catch (error) {
            logAxiosError(error, this.logger, 'PeepBoxTV search failed')
            return []
        }
    }

    async getMovieData(type, id) {
        if (!this.baseUrl || !this.apiKey || !id) {
            return null
        }

        try {
            const response = await this.httpClient.get(this.endpoint('rest-api/v130/single_details'), {
                ...this.requestConfig(),
                params: {
                    type: type === 'movie' ? 'movie' : 'tvseries',
                    id,
                    user_id: this.userId,
                    android_id: this.androidId,
                },
            })
            return response.data?.videos_id ? response.data : null
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
        if (!Number.isInteger(season) || !Number.isInteger(episode) || episode < 1) {
            return []
        }

        const seasonTitle = `فصل ${season}`
        const seasons = Array.isArray(movieData?.season) ? movieData.season : []
        return seasons
            .filter((item) => String(item.seasons_name ?? '').includes(seasonTitle))
            .map((item) => {
                const selectedEpisode = item.episodes?.[episode - 1]
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

    async imdbID(movieData, type) {
        const existingId = movieData?.imdb_id ?? movieData?.imdb
        if (typeof existingId === 'string' && existingId.startsWith('tt')) {
            return existingId
        }
        const title = String(movieData?.title ?? '').split('/')[0].trim()
        const tmdbData = await searchAndGetTMDB(title, type, this.httpClient, this.logger, this.tmdbApiKey)
        return tmdbData?.external_ids?.imdb_id ?? null
    }
}
