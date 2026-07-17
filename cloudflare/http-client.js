function appendParams(url, params) {
    const result = new URL(url)
    for (const [key, value] of Object.entries(params ?? {})) {
        if (value != null) {
            result.searchParams.append(key, String(value))
        }
    }
    return result.toString()
}

function requestHeaders(values = {}) {
    const headers = new Headers()
    for (const [key, value] of Object.entries(values)) {
        if (value != null && key.toLowerCase() !== 'host') {
            headers.set(key, String(value))
        }
    }
    return headers
}

async function responseData(response, responseType) {
    if (responseType === 'arraybuffer') {
        return response.arrayBuffer()
    }

    const body = await response.text()
    if (!body) {
        return ''
    }
    try {
        return JSON.parse(body)
    } catch {
        return body
    }
}

async function fetchRequest(fetcher, method, url, data, config = {}) {
    const controller = new AbortController()
    const timeout = Number(config.timeout)
    const timer = Number.isFinite(timeout) && timeout > 0
        ? setTimeout(() => controller.abort(), timeout)
        : null
    const headers = requestHeaders(config.headers)
    let body

    if (data != null) {
        if (typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            body = data
        } else {
            body = JSON.stringify(data)
            if (!headers.has('content-type')) {
                headers.set('content-type', 'application/json')
            }
        }
    }

    try {
        const response = await fetcher(appendParams(url, config.params), {
            method,
            headers,
            body,
            redirect: config.maxRedirects === 0 ? 'manual' : 'follow',
            signal: controller.signal,
        })
        const result = {
            status: response.status,
            headers: Object.fromEntries(response.headers),
            data: await responseData(response, config.responseType),
        }
        const validateStatus = config.validateStatus ?? ((status) => status >= 200 && status < 300)
        if (!validateStatus(response.status)) {
            const error = new Error(`Request failed with status code ${response.status}`)
            error.response = result
            throw error
        }
        return result
    } finally {
        if (timer) {
            clearTimeout(timer)
        }
    }
}

export function createFetchHttpClient(fetcher = fetch) {
    return {
        get(url, config) {
            return fetchRequest(fetcher, 'GET', url, null, config)
        },
        post(url, data, config) {
            return fetchRequest(fetcher, 'POST', url, data, config)
        },
    }
}
