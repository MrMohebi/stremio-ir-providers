import cors from 'cors'
import express from 'express'
import winston from 'winston'

import {createErrorHandler} from './errorMiddleware.js'
import Aslmoviez from './sources/aslmoviez.js'
import Cinamatic from './sources/cinamatic.js'
import Digimovie from './sources/digimovie.js'
import F2Media from './sources/f2media.js'
import IPTV from './sources/iptv.js'
import Peepboxtv from './sources/peepboxtv.js'
import Serialblog from './sources/serialblog.js'
import {ID_SEPARATOR, METADATA_SOURCE} from './sources/source.js'
import {getCinemeta, getSubtitle, modifyUrls} from './utils.js'

export const ADDON_PREFIX = 'ip'
export const ADDON_VERSION = '2.5.0'

const CATALOGS = [
    {key: 'f2media', name: 'F2Media', catalogType: 'movies'},
    {key: 'peepboxtv', name: 'PeepBoxTv', catalogType: 'movies'},
    {key: 'cinamatic', name: 'Cinamatic', catalogType: 'movies'},
    {key: 'aslmoviez', name: 'AslMoviez', catalogType: 'movies'},
    {key: 'serialblog', name: 'SerialBlog', catalogType: 'movies'},
    {key: 'iptv', name: 'Seda va Sima - Telewebion', catalogType: 'tv', searchRequired: false},
    // {key: 'digimovie', name: 'DigiMovie', catalogType: 'movies'},
]

export function createLogger(env = process.env) {
    return winston.createLogger({
        level: env.LOG_LEVEL || 'info',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        transports: [new winston.transports.Console()],
    })
}

export function createManifest(env = process.env) {
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

export function createProviders({env = process.env, logger = console, httpClient} = {}) {
    return [
        new F2Media(env.F2MEDIA_BASEURL, logger, httpClient, env),
        new Peepboxtv(env.PEEPBOXTV_BASEURL, logger, httpClient, env),
        new Cinamatic(env.CINAMATIC_BASEURL, logger, httpClient, env),
        new Aslmoviez(env.ASLMOVIEZ_BASEURL, logger, httpClient, env),
        new Serialblog(env.SERIALBLOG_BASEURL, logger, httpClient, env),
        new IPTV(null, logger, httpClient, env),
        // new Digimovie(env.DIGIMOVIE_BASEURL, logger, httpClient, env),
    ]
}

export function parseAddonId(id, providers) {
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

function findCatalogProvider(catalogId, providers) {
    return providers.find((provider) => {
        const cfg = CATALOGS.find((c) => c.key === provider.key)
        if (cfg?.catalogType === 'tv') {
            return catalogId === `${provider.key}_tv`
        }
        return catalogId === `${provider.key}_movies` || catalogId === `${provider.key}_series`
    })
}

function parseExtraArgs(extraArgs = '') {
    return Object.fromEntries(new URLSearchParams(extraArgs))
}

function proxyPrefix(env) {
    const baseUrl = String(env.PROXY_URL ?? '').replace(/\/$/, '')
    const path = String(env.PROXY_PATH ?? 'proxy').replace(/^\/+|\/+$/g, '')
    return baseUrl && path ? `${baseUrl}/${path}?url=` : null
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
        return {streams: []}
    }

    const title = await getCinemetaName(type, parsed.imdbId, services)
    if (!title) {
        return {streams: []}
    }

    const cleanTitle = title.replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g, '').trim().toLowerCase()
    const proto = String(id ?? '')

    const settled = await Promise.allSettled(
        providers.map(async (provider) => {
            const results = await provider.search(cleanTitle)
            const match = results.find((r) => {
                const cleanName = r.name.replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g, '').toLowerCase()
                return (cleanName.includes(cleanTitle) || cleanTitle.includes(cleanName)) && r.type === type
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

    const allStreams = sortByQuality(
        settled
            .filter((r) => r.status === 'fulfilled')
            .flatMap((r) => r.value.streams)
    )

    return {streams: allStreams}
}

async function getProviderMetadata(provider, type, itemId, movieData, services) {
    if (provider.metadataSource === METADATA_SOURCE.PROVIDER) {
        const meta = await provider.getMeta(type, itemId, movieData)
        return meta ? {meta} : null
    }

    const imdbId = await provider.imdbID(movieData, type)
    return imdbId ? services.getCinemeta(type, imdbId) : null
}

export function createAddon({
    env = process.env,
    logger = createLogger(env),
    providers = createProviders({env, logger}),
    services = {getCinemeta, getSubtitle},
} = {}) {
    const addon = express()
    addon.disable('x-powered-by')
    addon.use(cors())

    addon.get('/manifest.json', (req, res) => res.json(createManifest(env)))

    const catalogHandler = async (req, res) => {
        try {
            const provider = findCatalogProvider(req.params.id, providers)
            if (!provider) {
                return res.json({metas: []})
            }

            const cfg = CATALOGS.find((c) => c.key === provider.key)
            const isSearchable = cfg ? cfg.searchRequired !== false : true
            const extraArgs = parseExtraArgs(req.params.extraArgs)
            const search = extraArgs.search?.trim()

            if (isSearchable) {
                if (!search || !['movie', 'series'].includes(req.params.type)) {
                    return res.json({metas: []})
                }
                const results = await provider.search(search)
                const metas = (Array.isArray(results) ? results : [])
                    .filter((item) => item?.id != null && item.type === req.params.type)
                    .map((item) => ({
                        ...item,
                        id: `${ADDON_PREFIX}${provider.providerID}${item.id}`,
                    }))
                logger.debug('Catalog search completed', {
                    provider: provider.key,
                    type: req.params.type,
                    query: search,
                    resultCount: Array.isArray(results) ? results.length : 0,
                    metaCount: metas.length,
                })
                return res.json({metas})
            }

            if (req.params.type !== 'tv') {
                return res.json({metas: []})
            }

            const results = await provider.getCatalog(req.params.type, extraArgs)
            const metas = (Array.isArray(results) ? results : [])
                .filter((item) => item?.id != null)
                .map((item) => ({
                    ...item,
                    id: `${ADDON_PREFIX}${provider.providerID}${item.id}`,
                }))
            logger.debug('IPTV catalog completed', {resultCount: metas.length})
            return res.json({metas})
        } catch (error) {
            logResourceError(logger, 'Catalog', error)
            return res.json({metas: []})
        }
    }
    addon.get('/catalog/:type/:id/:extraArgs.json', catalogHandler)
    addon.get('/catalog/:type/:id.json', catalogHandler)

    addon.get('/meta/:type/:id.json', async (req, res) => {
        try {
            const parsedId = parseAddonId(req.params.id, providers)
            if (!parsedId || !['movie', 'series', 'tv'].includes(req.params.type)) {
                return res.json({})
            }

            const movieData = await parsedId.provider.getMovieData(req.params.type, parsedId.providerItemId)
            if (!movieData) {
                return res.json({})
            }
            const upstreamMeta = await getProviderMetadata(
                parsedId.provider,
                req.params.type,
                parsedId.providerItemId,
                movieData,
                services,
            )
            if (!upstreamMeta?.meta) {
                return res.json({})
            }
            let result = structuredClone(upstreamMeta)

            if (env.PROXY_ENABLE === 'true' || env.PROXY_ENABLE === '1') {
                const prepend = proxyPrefix(env)
                if (prepend) {
                    result = modifyUrls(result, prepend)
                }
            }

            if (req.params.type === 'series') {
                const videos = Array.isArray(result.meta.videos) ? result.meta.videos : []
                result.meta.videos = videos
                    .filter((video) => video?.id)
                    .map((video) => ({
                        ...video,
                        id: `${ADDON_PREFIX}${parsedId.provider.providerID}${parsedId.providerItemId}${ID_SEPARATOR}${video.id}`,
                    }))
                result.meta.id = req.params.id
            } else {
                result.meta.id = `${ADDON_PREFIX}${parsedId.provider.providerID}${parsedId.providerItemId}${ID_SEPARATOR}${result.meta.id}`
                result.meta.behaviorHints = {
                    ...(result.meta.behaviorHints ?? {}),
                    defaultVideoId: result.meta.id,
                }
            }
            return res.json(result)
        } catch (error) {
            logResourceError(logger, 'Meta', error)
            return res.json({})
        }
    })

    addon.get('/stream/:type/:id.json', async (req, res) => {
        try {
            const {type, id} = req.params
            if (!['movie', 'series', 'tv'].includes(type)) {
                return res.json({streams: []})
            }

            const parsedId = parseAddonId(id, providers)
            if (parsedId) {
                const movieData = await parsedId.provider.getMovieData(type, parsedId.providerItemId)
                let streams = movieData
                    ? parsedId.provider.getLinks(type, parsedId.videoId, movieData)
                    : []
                if (Array.isArray(streams) && movieData?.title) {
                    streams = streams.map((link) => ({
                        ...link,
                        title: `${parsedId.provider.key} - ${movieData.title} - ${link.title}`,
                    }))
                }
                return res.json({streams: sortByQuality(Array.isArray(streams) ? streams : [])})
            }

            if (!/^tt/.test(id)) {
                return res.json({streams: []})
            }

            const result = await imdbStreamResponse(type, id, providers, services, logger)
            return res.json(result)
        } catch (error) {
            logResourceError(logger, 'Stream', error)
            return res.json({streams: []})
        }
    })

    const subtitleHandler = async (req, res) => {
        try {
            const parsedId = parseAddonId(req.params.id, providers)
            if (!parsedId || !parsedId.videoId || !['movie', 'series'].includes(req.params.type)) {
                return res.json({subtitles: []})
            }
            const result = await services.getSubtitle(req.params.type, parsedId.videoId)
            return res.json(result?.subtitles ? result : {subtitles: []})
        } catch (error) {
            logResourceError(logger, 'Subtitle', error)
            return res.json({subtitles: []})
        }
    }
    addon.get('/subtitles/:type/:id/:extraArgs.json', subtitleHandler)
    addon.get('/subtitles/:type/:id.json', subtitleHandler)

    addon.get('/health', (req, res) => res.type('text/plain').send('ok'))
    addon.use(createErrorHandler(logger))
    return addon
}
