const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5
const PROXY_TIMEOUT_MS = 30_000

function httpError(message, statusCode) {
    return Object.assign(new Error(message), {statusCode})
}

export function createWorkerProxyConfig(env = {}) {
    return {
        path: String(env.PROXY_PATH || 'proxy').replace(/^\/+|\/+$/g, '') || 'proxy',
        allowedDomains: String(env.PROXY_ALLOWED_URLS || 'metahub.space,imdb.com,strem.io,tmdb.org')
            .split(',')
            .map((domain) => domain.trim().toLowerCase())
            .filter(Boolean),
        maxFileSize: DEFAULT_MAX_FILE_SIZE,
        maxRedirects: DEFAULT_MAX_REDIRECTS,
    }
}

export function validateWorkerProxyUrl(value, allowedDomains) {
    let url
    try {
        url = new URL(value)
    } catch {
        throw httpError('Invalid URL', 400)
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw httpError('Only HTTP and HTTPS URLs are supported', 400)
    }

    const hostname = url.hostname.toLowerCase()
    const allowed = allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    if (!allowed) {
        throw httpError('Access to the specified domain is not allowed', 403)
    }
    return url
}

async function fetchWithTimeout(fetcher, url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)
    try {
        return await fetcher(url, {redirect: 'manual', signal: controller.signal})
    } finally {
        clearTimeout(timer)
    }
}

export async function fetchAllowedResource(targetUrl, config, fetcher = fetch) {
    let currentUrl = validateWorkerProxyUrl(targetUrl, config.allowedDomains)

    for (let redirectCount = 0; redirectCount <= config.maxRedirects; redirectCount += 1) {
        const response = await fetchWithTimeout(fetcher, currentUrl.toString())
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location')
            if (redirectCount === config.maxRedirects || !location) {
                throw httpError('Too many or invalid redirects', 502)
            }
            currentUrl = validateWorkerProxyUrl(new URL(location, currentUrl).toString(), config.allowedDomains)
            continue
        }
        if (!response.ok) {
            throw httpError(`Upstream request failed with status ${response.status}`, 502)
        }

        const contentLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(contentLength) && contentLength > config.maxFileSize) {
            throw httpError('File size exceeds the allowed limit of 10MB', 413)
        }
        const body = await response.arrayBuffer()
        if (body.byteLength > config.maxFileSize) {
            throw httpError('File size exceeds the allowed limit of 10MB', 413)
        }
        return {body, headers: response.headers}
    }

    throw httpError('Too many redirects', 502)
}

export async function handleProxyRequest(request, env, fetcher = fetch, logger = console) {
    const config = createWorkerProxyConfig(env)
    const targetUrl = new URL(request.url).searchParams.get('url')
    if (!targetUrl) {
        return new Response('URL parameter is required', {status: 400})
    }

    try {
        const result = await fetchAllowedResource(targetUrl, config, fetcher)
        const headers = new Headers()
        for (const name of ['content-type', 'cache-control']) {
            const value = result.headers.get(name)
            if (value) {
                headers.set(name, value)
            }
        }
        return new Response(result.body, {headers})
    } catch (error) {
        const statusCode = error.statusCode || 502
        logger.error('Proxy request failed', {message: error?.message ?? String(error), statusCode})
        return new Response(error?.message || 'Error fetching the resource', {status: statusCode})
    }
}
