export const ID_SEPARATOR = '___'

export function normalizeBaseUrl(value, defaultProtocol = 'https:') {
    const input = String(value ?? '').trim()
    if (!input) {
        return null
    }

    try {
        const url = new URL(input.includes('://') ? input : `${defaultProtocol}//${input}`)
        if (!['http:', 'https:'].includes(url.protocol)) {
            return null
        }
        return url.toString().replace(/\/$/, '')
    } catch {
        return null
    }
}

export default class Source {
    idSeparator = ID_SEPARATOR

    constructor(baseUrl, logger = console, httpClient = null, defaultProtocol = 'https:') {
        this.baseUrl = normalizeBaseUrl(baseUrl, defaultProtocol)
        this.baseURL = this.baseUrl
        this.providerID = `NOT_SET${this.idSeparator}`
        this.logger = logger
        this.httpClient = httpClient
    }

    endpoint(path) {
        if (!this.baseUrl) {
            return null
        }
        return `${this.baseUrl}/${String(path).replace(/^\/+/, '')}`
    }

    async login() {
        return false
    }

    async isLogin() {
        return false
    }

    async search() {
        return []
    }

    async getMovieData() {
        return null
    }

    getLinks() {
        return []
    }

    async imdbID() {
        return null
    }
}
