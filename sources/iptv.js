import axios from 'axios'
import Source, {METADATA_SOURCE, ID_SEPARATOR} from './source.js'
import {logAxiosError} from '../utils.js'

const PLAYLIST_URL = 'https://github.com/iptv-org/iptv/raw/refs/heads/master/streams/ir_telewebion.m3u'
const CACHE_TTL_MS = 5 * 60 * 1000
const CATALOG_PAGE_SIZE = 20

function generatePlaceholder(name) {
    const safe = String(name ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="540" viewBox="0 0 360 540">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#16213e"/>
    </linearGradient>
  </defs>
  <rect fill="url(#g)" width="360" height="540"/>
  <text x="180" y="260" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="22" font-family="Tahoma, sans-serif" font-weight="bold">${safe}</text>
  <text x="180" y="300" text-anchor="middle" dominant-baseline="middle" fill="#888" font-size="13" font-family="Tahoma, sans-serif">پخش زنده تلویزیون</text>
</svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function parseM3U(content) {
    const channels = []
    const lines = String(content ?? '').split(/\r?\n/)
    let currentMeta = null

    for (const raw of lines) {
        const line = raw.trim()
        if (!line) {
            continue
        }

        if (line.startsWith('#EXTINF:')) {
            const nameMatch = line.match(/,(.+)$/)
            const name = nameMatch?.[1]?.trim()
            if (!name) {
                continue
            }

            const tvgIdMatch = line.match(/tvg-id="([^"]*)"/)
            const tvgNameMatch = line.match(/tvg-name="([^"]*)"/)
            const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/)
            const groupMatch = line.match(/group-title="([^"]*)"/)

            currentMeta = {
                name,
                tvgId: tvgIdMatch?.[1] ?? '',
                tvgName: tvgNameMatch?.[1] ?? '',
                tvgLogo: tvgLogoMatch?.[1] ?? '',
                groupTitle: groupMatch?.[1] ?? '',
            }
            continue
        }

        if (line.startsWith('#')) {
            continue
        }

        if (currentMeta && (line.startsWith('http://') || line.startsWith('https://'))) {
            channels.push({
                id: Buffer.from(line).toString('base64url'),
                name: currentMeta.name,
                url: line,
                tvgId: currentMeta.tvgId,
                tvgName: currentMeta.tvgName,
                tvgLogo: currentMeta.tvgLogo,
                groupTitle: currentMeta.groupTitle,
                poster: generatePlaceholder(currentMeta.name),
            })
            currentMeta = null
        }
    }

    return channels
}

export default class IPTV extends Source {
    key = 'iptv'
    metadataSource = METADATA_SOURCE.PROVIDER

    #cache = null
    #cacheTime = 0

    constructor(baseUrl, logger = console, httpClient = axios) {
        super(baseUrl, logger, httpClient, 'https:')
        this.providerID = `${this.key}${ID_SEPARATOR}`
    }

    async #loadChannels() {
        if (this.#cache && Date.now() - this.#cacheTime < CACHE_TTL_MS) {
            return this.#cache
        }

        try {
            this.logger.debug('IPTV fetching playlist', {url: PLAYLIST_URL})
            const response = await this.httpClient.get(PLAYLIST_URL, {timeout: 15_000})
            const content = typeof response.data === 'string' ? response.data : ''
            const channels = parseM3U(content)
            this.logger.debug('IPTV playlist loaded', {channelCount: channels.length})
            this.#cache = channels
            this.#cacheTime = Date.now()
            return channels
        } catch (error) {
            logAxiosError(error, this.logger, 'IPTV playlist fetch failed')
            if (this.#cache) {
                this.logger.warn('IPTV using stale cache')
                return this.#cache
            }
            return []
        }
    }

    async getCatalog(type, extraArgs = {}) {
        const channels = await this.#loadChannels()
        if (!channels.length) {
            return []
        }

        const search = String(extraArgs?.search ?? '').trim()

        let filtered = channels
        if (search) {
            const q = search.toLowerCase()
            filtered = channels.filter((ch) => ch.name.toLowerCase().includes(q))
        } else {
            const skip = Math.max(0, Number(extraArgs?.skip) || 0)
            filtered = channels.slice(skip, skip + CATALOG_PAGE_SIZE)
        }

        return filtered.map((ch) => ({
            id: ch.id,
            name: ch.name,
            type,
            poster: ch.poster,
        }))
    }

    async search(text) {
        const query = String(text ?? '').trim()
        if (!query) {
            return []
        }
        return this.getCatalog('tv', {search: query})
    }

    async getMovieData(type, id) {
        if (!id) {
            return null
        }

        const channels = await this.#loadChannels()
        const channel = channels.find((ch) => ch.id === id)
        if (!channel) {
            return null
        }

        return {
            id: channel.id,
            name: channel.name,
            url: channel.url,
            poster: channel.poster,
            tvgId: channel.tvgId,
            tvgName: channel.tvgName,
            groupTitle: channel.groupTitle,
        }
    }

    getMeta(type, id, movieData) {
        if (!movieData?.id || !movieData?.name) {
            return null
        }

        return {
            id: movieData.id,
            type,
            name: movieData.name,
            poster: movieData.poster,
            background: movieData.poster,
        }
    }

    getMovieLinks(movieData) {
        if (movieData?.url) {
            return [{url: movieData.url, title: 'پخش زنده'}]
        }
        return []
    }

    getLinks(type, videoId, movieData) {
        return this.getMovieLinks(movieData)
    }

    async imdbID() {
        return null
    }
}
