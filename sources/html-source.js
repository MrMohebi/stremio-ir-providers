import {load} from 'cheerio'

import Source from './source.js'
import {REQUEST_TIMEOUT_MS} from '../utils.js'

const MAX_PAGE_PATH_LENGTH = 2_048

export function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function isHttpUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
        return false
    }
}

export function encodePagePath(value) {
    const path = String(value ?? '')
    if (!path.startsWith('/') || path.startsWith('//') || path.length > MAX_PAGE_PATH_LENGTH) {
        return null
    }
    return Buffer.from(path).toString('base64url')
}

export function decodePagePath(value) {
    const id = String(value ?? '')
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
        return null
    }

    try {
        const path = Buffer.from(id, 'base64url').toString()
        return encodePagePath(path) === id ? path : null
    } catch {
        return null
    }
}

export default class HtmlSource extends Source {
    requestConfig() {
        return {
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (compatible; StremioIRProviders/2.3)',
            },
            timeout: REQUEST_TIMEOUT_MS,
        }
    }

    pagePath(value) {
        if (!this.baseUrl) {
            return null
        }

        try {
            const url = new URL(value, `${this.baseUrl}/`)
            return url.origin === new URL(this.baseUrl).origin ? url.pathname : null
        } catch {
            return null
        }
    }

    pageId(value) {
        return encodePagePath(this.pagePath(value))
    }

    async fetchDocument(path, config = {}) {
        const pagePath = this.pagePath(path)
        if (!pagePath) {
            return null
        }

        const defaults = this.requestConfig()
        const response = await this.httpClient.get(new URL(pagePath, `${this.baseUrl}/`).toString(), {
            ...defaults,
            ...config,
            headers: {...defaults.headers, ...config.headers},
        })
        return typeof response.data === 'string' ? load(response.data) : null
    }
}
