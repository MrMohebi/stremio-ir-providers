import axios from 'axios'
import Source from './source.js'
import {logAxiosError, REQUEST_TIMEOUT_MS, searchAndGetTMDB} from '../utils.js'

export default class Digimovie extends Source {
    key = 'digimovie'
    token = ''
    refreshToken = ''

    constructor(baseUrl, logger = console, httpClient = axios, env = process.env) {
        super(baseUrl, logger, httpClient)
        this.providerID = `${this.key}${this.idSeparator}`
        this.username = env.DIGIMOVIE_USERNAME
        this.password = env.DIGIMOVIE_PASSWORD
        this.tmdbApiKey = env.TMDB_API_KEY
    }

    async isLogin() {
        if (!this.endpoint('api/app/v1/get_profile') || !this.token) {
            return false
        }

        try {
            const response = await this.httpClient.post(
                this.endpoint('api/app/v1/get_profile'),
                undefined,
                {
                    headers: {authorization: this.token},
                    maxRedirects: 0,
                    timeout: REQUEST_TIMEOUT_MS,
                    validateStatus: (status) => status >= 200 && status < 400,
                },
            )
            return Boolean(response.data?.status)
        } catch {
            return false
        }
    }

    async login() {
        if (!this.baseUrl || !this.username || !this.password) {
            return false
        }
        if (await this.isLogin()) {
            return true
        }

        try {
            const response = await this.httpClient.post(
                this.endpoint('api/app/v1/login'),
                {username: this.username, password: this.password},
                {
                    maxRedirects: 0,
                    timeout: REQUEST_TIMEOUT_MS,
                    validateStatus: (status) => status >= 200 && status < 400,
                },
            )
            if (response.data?.status && response.data.auth_token) {
                this.token = response.data.auth_token
                this.refreshToken = response.data.refresh_token ?? ''
                this.logger.info('Digimovie login succeeded')
                return true
            }
        } catch (error) {
            logAxiosError(error, this.logger, 'Digimovie login failed')
        }
        return false
    }

    async search(text) {
        if (!this.baseUrl || !String(text ?? '').trim()) {
            return []
        }

        try {
            const response = await this.httpClient.post(
                this.endpoint('api/app/v1/adv_search_movies'),
                {
                    adv_s: text,
                    adv_movie_type: 'all',
                    adv_director: '',
                    adv_cast: '',
                    adv_release_year: {min: null, max: null},
                    adv_imdb_rate: {min: null, max: null},
                    adv_country: '0',
                    adv_age: '0',
                    adv_genre: '0',
                    adv_quality: '0',
                    adv_network: '0',
                    adv_order: 'publish_date',
                    adv_dubbed: '0',
                    adv_censorship: '0',
                    adv_subtitle: '0',
                    adv_online: '0',
                    per_page: 30,
                    paged: 1,
                },
                {timeout: REQUEST_TIMEOUT_MS},
            )
            const items = Array.isArray(response.data?.result?.items) ? response.data.result.items : []
            return items
                .filter((item) => item?.id != null)
                .map((item) => ({
                    name: item.title_en || item.title || '',
                    poster: item.image_url,
                    type: item.type === 'movie' ? 'movie' : 'series',
                    id: String(item.id),
                    genres: [],
                }))
        } catch (error) {
            logAxiosError(error, this.logger, 'Digimovie search failed')
            return []
        }
    }

    async getMovieData(type, id) {
        if (!this.baseUrl || !id) {
            return null
        }
        if (!this.token) {
            await this.login()
        }

        try {
            const response = await this.httpClient.get(this.endpoint('api/app/v1/get_movie_detail'), {
                params: {movie_id: id},
                headers: {authorization: this.token},
                timeout: REQUEST_TIMEOUT_MS,
            })
            return response.data?.status ? response.data : null
        } catch (error) {
            logAxiosError(error, this.logger, 'Digimovie detail request failed')
            this.token = ''
            return null
        }
    }

    getMovieLinks(movieData) {
        const items = Array.isArray(movieData?.movie_download_urls) ? movieData.movie_download_urls : []
        return items
            .filter((item) => item?.file)
            .map((item) => ({
                url: item.file,
                title: [item.quality, item.size, item.encode, item.label].filter(Boolean).join(' - '),
            }))
    }

    getSeriesLinks(movieData, videoId) {
        const [, seasonText, episodeText] = String(videoId ?? '').split(':')
        const season = Number(seasonText)
        const episode = Number(episodeText)
        if (!Number.isInteger(season) || !Number.isInteger(episode) || episode < 1) {
            return []
        }

        const seasons = Array.isArray(movieData?.serie_download_urls) ? movieData.serie_download_urls : []
        return seasons
            .filter((item) => String(item.season_name ?? '').replace(/\s/g, '').includes(`:${season}`))
            .map((item) => ({
                url: item.links?.[episode - 1]?.movie,
                title: [item.quality, item.size].filter(Boolean).join(' - '),
            }))
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
        const existingId = movieData?.movie_info?.imdb_id ?? movieData?.movie_info?.imdb
        if (typeof existingId === 'string' && existingId.startsWith('tt')) {
            return existingId
        }
        const title = movieData?.movie_info?.title_en
        const tmdbData = await searchAndGetTMDB(title, type, this.httpClient, this.logger, this.tmdbApiKey)
        return tmdbData?.external_ids?.imdb_id ?? null
    }
}
