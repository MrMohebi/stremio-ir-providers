import Aslmoviez from '../sources/aslmoviez.js'
import Cinamatic from '../sources/cinamatic.js'
import F2Media from '../sources/f2media.js'
import IPTV from '../sources/iptv.js'
import Peepboxtv from '../sources/peepboxtv.js'
import Serialblog from '../sources/serialblog.js'
import {ID_SEPARATOR, METADATA_SOURCE} from '../sources/source.js'
import {modifyUrls} from '../utils.js'
import {createFetchHttpClient} from './http-client.js'
import {createWorkerProxyConfig, handleProxyRequest} from './proxy.js'

const ADDON_PREFIX = 'ip'
const ADDON_VERSION = '2.5.0'

const CATALOGS = [
    {key: 'f2media', name: 'F2Media', catalogType: 'movies'},
    {key: 'peepboxtv', name: 'PeepBoxTv', catalogType: 'movies'},
    {key: 'cinamatic', name: 'Cinamatic', catalogType: 'movies'},
    {key: 'aslmoviez', name: 'AslMoviez', catalogType: 'movies'},
    {key: 'serialblog', name: 'SerialBlog', catalogType: 'movies'},
    {key: 'iptv', name: 'Seda va Sima - Telewebion', catalogType: 'tv', searchRequired: false},
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
        catalogs: CATALOGS.flatMap((cfg) => {
            const isSearchable = cfg.searchRequired !== false
            const types = cfg.catalogType === 'tv' ? ['tv'] : ['movie', 'series']
            return types.map((type) => ({
                name: cfg.catalogType === 'tv' ? cfg.name : `${cfg.name}${developmentSuffix}`,
                type,
                id: `${cfg.key}_${cfg.catalogType === 'tv' ? 'tv' : (type === 'movie' ? 'movies' : 'series')}`,
                extra: isSearchable
                    ? [{name: 'search', isRequired: true}]
                    : [{name: 'skip', isRequired: false}, {name: 'search', isRequired: false}],
            }))
        }),
        resources: [
            'catalog',
            {name: 'meta', types: ['series', 'movie', 'tv'], idPrefixes: [ADDON_PREFIX]},
            {name: 'stream', types: ['series', 'movie', 'tv'], idPrefixes: [ADDON_PREFIX, 'tt']},
            {name: 'subtitles', types: ['series', 'movie'], idPrefixes: [ADDON_PREFIX]},
        ],
        types: ['movie', 'series', 'tv'],
    }
}

export function createWorkerProviders({env = {}, logger = console, httpClient} = {}) {
    return [
        new F2Media(env.F2MEDIA_BASEURL, logger, httpClient, env),
        new Peepboxtv(env.PEEPBOXTV_BASEURL, logger, httpClient, env),
        new Cinamatic(env.CINAMATIC_BASEURL, logger, httpClient, env),
        new Aslmoviez(env.ASLMOVIEZ_BASEURL, logger, httpClient, env),
        new Serialblog(env.SERIALBLOG_BASEURL, logger, httpClient, env),
        new IPTV(null, logger, httpClient, env),
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
    return providers.find((provider) => {
        const cfg = CATALOGS.find((c) => c.key === provider.key)
        if (cfg?.catalogType === 'tv') {
            return catalogId === `${provider.key}_tv`
        }
        return catalogId === `${provider.key}_movies` || catalogId === `${provider.key}_series`
    })
}

function proxyPrefix(env, requestUrl) {
    const baseUrl = String(env.PROXY_URL || new URL(requestUrl).origin).replace(/\/$/, '')
    const path = createWorkerProxyConfig(env).path
    return `${baseUrl}/${path}?url=`
}

const QUALITY_RANKS = {
    '2160': 7, '4k': 7,
    '1440': 6,
    '1080': 5,
    '720': 4,
    '576': 3,
    '480': 2,
    '360': 1,
    '240': 0,
}

function rankFromTitle(title) {
    const t = String(title ?? '').toLowerCase()
    for (const [key, rank] of Object.entries(QUALITY_RANKS)) {
        if (t.includes(key)) {
            return rank
        }
    }
    return -1
}

function sortByQuality(streams) {
    if (!Array.isArray(streams)) {
        return streams
    }
    return streams
        .map((s) => ({
            ...s,
            title: (s.title ?? '').replace(/انکودر\s*:/gi, '').replace(/encoder\s*:/gi, '').trim(),
        }))
        .sort((a, b) => rankFromTitle(b.title) - rankFromTitle(a.title))
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
        if (!provider) {
            return json({metas: []})
        }

        const cfg = CATALOGS.find((c) => c.key === provider.key)
        const isSearchable = cfg ? cfg.searchRequired !== false : true
        const extraQuery = new URLSearchParams(route.extraArgs ?? '')
        const search = extraQuery.get('search')?.trim()

        if (isSearchable) {
            if (!search || !['movie', 'series'].includes(route.type)) {
                return json({metas: []})
            }
            const results = await provider.search(search)
            const metas = (Array.isArray(results) ? results : [])
                .filter((item) => item?.id != null && item.type === route.type)
                .map((item) => ({...item, id: `${ADDON_PREFIX}${provider.providerID}${item.id}`}))
            return json({metas})
        }

        if (route.type !== 'tv') {
            return json({metas: []})
        }

        const extraArgs = Object.fromEntries(extraQuery)
        const results = await provider.getCatalog(route.type, extraArgs)
        const metas = (Array.isArray(results) ? results : [])
            .filter((item) => item?.id != null)
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
        if (!parsedId || !['movie', 'series', 'tv'].includes(route.type)) {
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

function parseImdbId(value) {
    const parts = String(value ?? '').split(':')
    const imdbId = parts[0]
    if (!/^tt\d+$/.test(imdbId)) {
        return null
    }
    return {
        imdbId,
        season: parts[1] ? Number(parts[1]) : null,
        episode: parts[2] ? Number(parts[2]) : null,
    }
}

async function getCinemetaName(type, imdbId, services) {
    const cinemeta = await services.getCinemeta(type, imdbId)
    return cinemeta?.meta?.name ?? null
}

async function imdbStreamResponse(type, id, providers, services, logger) {
    const parsed = parseImdbId(id)
    if (!parsed) {
        return json({streams: []})
    }

    const title = await getCinemetaName(type, parsed.imdbId, services)
    if (!title) {
        return json({streams: []})
    }

    const cleanTitle = title.replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g, '').trim().toLowerCase()

    const settled = await Promise.allSettled(
        providers.map(async (provider) => {
            const results = await provider.search(cleanTitle)
            const match = results.find((r) => {
                const cleanName = r.name.replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g, '').toLowerCase()
                return cleanName.includes(cleanTitle) || cleanTitle.includes(cleanName)
            })
            if (!match) {
                return {key: provider.key, streams: []}
            }

            const movieData = await provider.getMovieData(match.type, match.id)
            if (!movieData) {
                return {key: provider.key, streams: []}
            }

            const videoId = parsed.season && parsed.episode
                ? `${parsed.imdbId}:${parsed.season}:${parsed.episode}`
                : null
            const links = provider.getLinks(match.type, videoId, movieData)

            const streamName = match.name || title
            return {
                key: provider.key,
                streams: (Array.isArray(links) ? links : []).map((link) => ({
                    url: link.url,
                    title: `${provider.key} - ${streamName} - ${link.title}`,
                })),
            }
        }),
    )

    const allStreams = settled
        .filter((r) => r.status === 'fulfilled')
        .flatMap((r) => r.value.streams)

    return json({streams: sortByQuality(allStreams)})
}

async function streamResponse(route, providers, services, logger) {
    try {
        if (!['movie', 'series', 'tv'].includes(route.type)) {
            return json({streams: []})
        }

        const parsedId = parseWorkerAddonId(route.id, providers)
        if (parsedId) {
            const movieData = await parsedId.provider.getMovieData(route.type, parsedId.providerItemId)
            let streams = movieData
                ? parsedId.provider.getLinks(route.type, parsedId.videoId, movieData)
                : []
            if (Array.isArray(streams) && movieData?.title) {
                streams = streams.map((link) => ({
                    ...link,
                    title: `${parsedId.provider.key} - ${movieData.title} - ${link.title}`,
                }))
            }
            return json({streams: sortByQuality(Array.isArray(streams) ? streams : [])})
        }

        if (!/^tt/.test(route.id)) {
            return json({streams: []})
        }

        return await imdbStreamResponse(route.type, route.id, providers, services, logger)
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
                        response = await streamResponse(route, providers, services, logger)
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
