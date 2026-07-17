import cors from 'cors'
import express from 'express'
import winston from 'winston'

import {createErrorHandler} from './errorMiddleware.js'
import Digimovie from './sources/digimovie.js'
import F2Media from './sources/f2media.js'
import Peepboxtv from './sources/peepboxtv.js'
import {ID_SEPARATOR} from './sources/source.js'
import {getCinemeta, getSubtitle, modifyUrls} from './utils.js'

export const ADDON_PREFIX = 'ip'
export const ADDON_VERSION = '2.3.0'

const CATALOGS = [
    {key: 'f2media', name: 'F2Media'},
    {key: 'peepboxtv', name: 'PeepBoxTv'},
    // {key: 'digimovie', name: 'DigiMovie'},
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

export function createProviders({env = process.env, logger = console, httpClient} = {}) {
    return [
        new F2Media(env.F2MEDIA_BASEURL, logger, httpClient, env),
        new Peepboxtv(env.PEEPBOXTV_BASEURL, logger, httpClient, env),
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
    return providers.find((provider) => catalogId === `${provider.key}_movies` || catalogId === `${provider.key}_series`)
}

function parseExtraArgs(extraArgs = '') {
    return Object.fromEntries(new URLSearchParams(extraArgs))
}

function proxyPrefix(env) {
    const baseUrl = String(env.PROXY_URL ?? '').replace(/\/$/, '')
    const path = String(env.PROXY_PATH ?? 'proxy').replace(/^\/+|\/+$/g, '')
    return baseUrl && path ? `${baseUrl}/${path}?url=` : null
}

function logResourceError(logger, resource, error) {
    logger.error(`${resource} request failed`, {message: error?.message ?? String(error)})
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
            const search = parseExtraArgs(req.params.extraArgs).search?.trim()
            if (!provider || !search || !['movie', 'series'].includes(req.params.type)) {
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
            if (!parsedId || !['movie', 'series'].includes(req.params.type)) {
                return res.json({})
            }

            const movieData = await parsedId.provider.getMovieData(req.params.type, parsedId.providerItemId)
            if (!movieData) {
                return res.json({})
            }
            const imdbId = await parsedId.provider.imdbID(movieData, req.params.type)
            if (!imdbId) {
                return res.json({})
            }

            const upstreamMeta = await services.getCinemeta(req.params.type, imdbId)
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
            const parsedId = parseAddonId(req.params.id, providers)
            if (!parsedId || !['movie', 'series'].includes(req.params.type)) {
                return res.json({streams: []})
            }
            const movieData = await parsedId.provider.getMovieData(req.params.type, parsedId.providerItemId)
            const streams = movieData
                ? parsedId.provider.getLinks(req.params.type, parsedId.videoId, movieData)
                : []
            return res.json({streams: Array.isArray(streams) ? streams : []})
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
