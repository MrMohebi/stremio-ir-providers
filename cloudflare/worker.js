import F2Media from '../sources/f2media.js'
import Peepboxtv from '../sources/peepboxtv.js'
import {ID_SEPARATOR, METADATA_SOURCE} from '../sources/source.js'
import {modifyUrls} from '../utils.js'
import {createFetchHttpClient} from './http-client.js'
import {createWorkerProxyConfig, handleProxyRequest} from './proxy.js'

const ADDON_PREFIX = 'ip'
const ADDON_VERSION = '2.4.0'

const CATALOGS = [
    {key: 'f2media', name: 'F2Media'},
    {key: 'peepboxtv', name: 'PeepBoxTv'},
]
const CORS_HEADERS = {
    'access-control-allow-headers': 'Content-Type',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-origin': '*',
}

export function createWorkerLogger(env = {}) {
    const levels = ['error', 'warn', 'info', 'debug']
    const configuredLevel = levels.includes(env.LOG_LEVEL) ? env.LOG_LEVEL : 'info'
    const threshold = levels.indexOf(configuredLevel)
    return Object.fromEntries(levels.map((level, index) => [
        level,
        (message, details) => {
            if (index <= threshold) {
                console[level](message, details ?? '')
            }
        },
    ]))
}

export function createWorkerManifest(env = {}) {
    const developmentSuffix = env.DEV_MODE === 'true' ? ' - DEV' : ''
    return {
        id: 'org.mmmohebi.stremioIrProviders',
        version: ADDON_VERSION,
        contactEmail: 'mmmohebi@outlook.com',
        description: 'Stream movies and series from Iranian providers. Source: https://github.com/MrMohebi/stremio-ir-providers',
        logo: 'https://raw.githubusercontent.com/MrMohebi/stremio-ir-providers/refs/heads/master/logo.png',
        name: `Iran Provider${developmentSuffix}`,
        catalogs: CATALOGS.flatMap(({key, name}) => ['movie', 'series'].map((type) => ({
            name: `${name}${developmentSuffix}`,
            type,
            id: `${key}_${type === 'movie' ? 'movies' : 'series'}`,
            extra: [{name: 'search', isRequired: true}],
        }))),
        resources: [
            'catalog',
            {name: 'meta', types: ['series', 'movie'], idPrefixes: [ADDON_PREFIX]},
            {name: 'stream', types: ['series', 'movie'], idPrefixes: [ADDON_PREFIX]},
            {name: 'subtitles', types: ['series', 'movie'], idPrefixes: [ADDON_PREFIX]},
        ],
        types: ['movie', 'series'],
    }
}

export function createWorkerProviders({env = {}, logger = console, httpClient} = {}) {
    return [
        new F2Media(env.F2MEDIA_BASEURL, logger, httpClient, env),
        new Peepboxtv(env.PEEPBOXTV_BASEURL, logger, httpClient, env),
    ]
}

export function parseWorkerAddonId(id, providers) {
    const parts = String(id ?? '').split(ID_SEPARATOR)
    const provider = providers.find((item) => parts[0] === `${ADDON_PREFIX}${item.key}`)
    if (!provider || !parts[1]) {
        return null
    }
    return {
        provider,
        providerItemId: parts[1],
        videoId: parts.slice(2).join(ID_SEPARATOR) || null,
    }
}

function json(value, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: {'content-type': 'application/json; charset=utf-8'},
    })
}

function withCors(response, headOnly = false) {
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
        headers.set(name, value)
    }
    return new Response(headOnly ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    })
}

function decoded(value) {
    try {
        return decodeURIComponent(value)
    } catch {
        return null
    }
}

function findCatalogProvider(catalogId, providers) {
    return providers.find((provider) => catalogId === `${provider.key}_movies` || catalogId === `${provider.key}_series`)
}

function proxyPrefix(env, requestUrl) {
    const baseUrl = String(env.PROXY_URL || new URL(requestUrl).origin).replace(/\/$/, '')
    const path = createWorkerProxyConfig(env).path
    return `${baseUrl}/${path}?url=`
}

function logResourceError(logger, resource, error) {
    logger.error(`${resource} request failed`, {message: error?.message ?? String(error)})
}

async function getCinemeta(type, imdbId, httpClient) {
    if (!imdbId) {
        return null
    }
    try {
        const response = await httpClient.get(
            `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`,
            {timeout: 15_000},
        )
        return response.data ?? null
    } catch {
        return null
    }
}

async function getSubtitle(type, imdbId, httpClient) {
    if (!imdbId) {
        return {subtitles: []}
    }
    try {
        const response = await httpClient.get(
            `https://opensubtitles-v3.strem.io/subtitles/${type}/${encodeURIComponent(imdbId)}.json`,
            {timeout: 15_000},
        )
        return response.data ?? {subtitles: []}
    } catch {
        return {subtitles: []}
    }
}

async function catalogResponse(route, providers, logger) {
    try {
        const provider = findCatalogProvider(route.id, providers)
        const search = new URLSearchParams(route.extraArgs ?? '').get('search')?.trim()
        if (!provider || !search || !['movie', 'series'].includes(route.type)) {
            return json({metas: []})
        }
        const results = await provider.search(search)
        const metas = (Array.isArray(results) ? results : [])
            .filter((item) => item?.id != null && item.type === route.type)
            .map((item) => ({...item, id: `${ADDON_PREFIX}${provider.providerID}${item.id}`}))
        return json({metas})
    } catch (error) {
        logResourceError(logger, 'Catalog', error)
        return json({metas: []})
    }
}

async function metaResponse(route, providers, services, env, requestUrl, logger) {
    try {
        const parsedId = parseWorkerAddonId(route.id, providers)
        if (!parsedId || !['movie', 'series'].includes(route.type)) {
            return json({})
        }
        const movieData = await parsedId.provider.getMovieData(route.type, parsedId.providerItemId)
        if (!movieData) {
            return json({})
        }

        const upstreamMeta = parsedId.provider.metadataSource === METADATA_SOURCE.PROVIDER
            ? {meta: await parsedId.provider.getMeta(route.type, parsedId.providerItemId, movieData)}
            : await services.getCinemeta(route.type, await parsedId.provider.imdbID(movieData, route.type))
        if (!upstreamMeta?.meta) {
            return json({})
        }
        let result = structuredClone(upstreamMeta)
        if (env.PROXY_ENABLE === 'true' || env.PROXY_ENABLE === '1') {
            result = modifyUrls(result, proxyPrefix(env, requestUrl))
        }

        if (route.type === 'series') {
            const videos = Array.isArray(result.meta.videos) ? result.meta.videos : []
            result.meta.videos = videos
                .filter((video) => video?.id)
                .map((video) => ({
                    ...video,
                    id: `${ADDON_PREFIX}${parsedId.provider.providerID}${parsedId.providerItemId}${ID_SEPARATOR}${video.id}`,
                }))
            result.meta.id = route.id
        } else {
            result.meta.id = `${ADDON_PREFIX}${parsedId.provider.providerID}${parsedId.providerItemId}${ID_SEPARATOR}${result.meta.id}`
            result.meta.behaviorHints = {
                ...(result.meta.behaviorHints ?? {}),
                defaultVideoId: result.meta.id,
            }
        }
        return json(result)
    } catch (error) {
        logResourceError(logger, 'Meta', error)
        return json({})
    }
}

async function streamResponse(route, providers, logger) {
    try {
        const parsedId = parseWorkerAddonId(route.id, providers)
        if (!parsedId || !['movie', 'series'].includes(route.type)) {
            return json({streams: []})
        }
        const movieData = await parsedId.provider.getMovieData(route.type, parsedId.providerItemId)
        const streams = movieData
            ? parsedId.provider.getLinks(route.type, parsedId.videoId, movieData)
            : []
        return json({streams: Array.isArray(streams) ? streams : []})
    } catch (error) {
        logResourceError(logger, 'Stream', error)
        return json({streams: []})
    }
}

async function subtitleResponse(route, providers, services, logger) {
    try {
        const parsedId = parseWorkerAddonId(route.id, providers)
        if (!parsedId || !parsedId.videoId || !['movie', 'series'].includes(route.type)) {
            return json({subtitles: []})
        }
        const result = await services.getSubtitle(route.type, parsedId.videoId)
        return json(result?.subtitles ? result : {subtitles: []})
    } catch (error) {
        logResourceError(logger, 'Subtitle', error)
        return json({subtitles: []})
    }
}

function matchRoute(pathname) {
    const resource = pathname.match(/^\/(meta|stream)\/([^/]+)\/([^/]+)\.json$/)
    if (resource) {
        return {resource: resource[1], type: decoded(resource[2]), id: decoded(resource[3])}
    }
    const variable = pathname.match(/^\/(catalog|subtitles)\/([^/]+)\/([^/]+)(?:\/(.*))?\.json$/)
    if (variable) {
        return {
            resource: variable[1],
            type: decoded(variable[2]),
            id: decoded(variable[3]),
            extraArgs: decoded(variable[4] ?? ''),
        }
    }
    return null
}

export function createWorkerHandler(options = {}) {
    return async function workerFetch(request, env = {}) {
        const logger = options.logger ?? createWorkerLogger(env)
        try {
            if (request.method === 'OPTIONS') {
                return withCors(new Response(null, {status: 204}))
            }
            if (!['GET', 'HEAD'].includes(request.method)) {
                return withCors(new Response('Method Not Allowed', {status: 405}))
            }

            const url = new URL(request.url)
            const headOnly = request.method === 'HEAD'
            let response
            if (url.pathname === '/manifest.json') {
                response = json(createWorkerManifest(env))
            } else if (url.pathname === '/health') {
                response = new Response('ok', {headers: {'content-type': 'text/plain; charset=utf-8'}})
            } else if (url.pathname === `/${createWorkerProxyConfig(env).path}`) {
                response = await handleProxyRequest(request, env, options.fetcher ?? fetch, logger)
            } else {
                const route = matchRoute(url.pathname)
                if (!route || Object.values(route).some((value) => value === null)) {
                    response = new Response('Not Found', {status: 404})
                } else {
                    const httpClient = options.httpClient ?? createFetchHttpClient(options.fetcher ?? fetch)
                    const providers = options.providers ?? createWorkerProviders({env, logger, httpClient})
                    const services = options.services ?? {
                        getCinemeta: (type, id) => getCinemeta(type, id, httpClient),
                        getSubtitle: (type, id) => getSubtitle(type, id, httpClient),
                    }
                    if (route.resource === 'catalog') {
                        response = await catalogResponse(route, providers, logger)
                    } else if (route.resource === 'meta') {
                        response = await metaResponse(route, providers, services, env, request.url, logger)
                    } else if (route.resource === 'stream') {
                        response = await streamResponse(route, providers, logger)
                    } else {
                        response = await subtitleResponse(route, providers, services, logger)
                    }
                }
            }
            return withCors(response, headOnly)
        } catch (error) {
            logger.error('Unhandled Worker request error', {message: error?.message ?? String(error)})
            return withCors(json({error: 'Internal Server Error'}, 500))
        }
    }
}
