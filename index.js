import express from 'express'
import cors from "cors"
import winston from "winston"

import Avamovie from "./sources/avamovie.js";
import {getCinemeta, getSubtitle, modifyUrls} from "./utils.js";
import Source from "./sources/source.js";
import {errorHandler} from "./errorMiddleware.js";
import Peepboxtv from "./sources/peepboxtv.js";


const logger = winston.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()],
});

const addon = express()
addon.use(cors())
addon.use(errorHandler);


// ------------- init providers ------------- :
// avamovie
const AvamovieProvider = new Avamovie(process.env.AVAMOVIE_BASEURL, logger)
const PeepboxtvProvider = new Peepboxtv(process.env.PEEPBOXTV_BASEURL, logger)

AvamovieProvider.login().then()


const ADDON_PREFIX = "ip"

const MANIFEST = {
    id: 'org.mmmohebi.stremioIrProviders',
    version: '2.1.4',
    contactEmail: "mmmohebi@outlook.com",
    description:"stream movies and series from Iranian providers like 30nama or avamovie. Source: https://github.com/MrMohebi/stremio-ir-providers",
    logo:"https://raw.githubusercontent.com/MrMohebi/stremio-ir-providers/refs/heads/master/logo.png",
    name: 'Iran Provider' + (process.env.DEV_MODE === 'true' ? " - DEV" : ""),

    catalogs: [
        {
            name: "AvaMovie" + (process.env.DEV_MODE === 'true' ? " - DEV" : ""),
            type: "movie",
            id: "avamovie_movies",
            extra: [
                {
                    name: "search",
                    isRequired: true
                },
            ]
        },
        {
            name: "AvaMovie" + (process.env.DEV_MODE === 'true' ? " - DEV" : ""),
            type: "series",
            id: "avamovie_series",
            extra: [
                {
                    name: "search",
                    isRequired: true
                },
            ]
        },
        {
            name: "PeepBoxTv" + (process.env.DEV_MODE === 'true' ? " - DEV" : ""),
            type: "movie",
            id: "peepboxtv_movies",
            extra: [
                {
                    name: "search",
                    isRequired: true
                },
            ]
        },
        {
            name: "PeepBoxTv" + (process.env.DEV_MODE === 'true' ? " - DEV" : ""),
            type: "series",
            id: "peepboxtv_series",
            extra: [
                {
                    name: "search",
                    isRequired: true
                },
            ]
        }
    ],
    resources: [
        "catalog",
        {
            "name": "meta",
            "types": ["series", "movie"],
            "idPrefixes": [ADDON_PREFIX]
        },
        {
            "name": "stream",
            "types": ["series", "movie"],
            "idPrefixes": [ADDON_PREFIX]
        },
        {
            "name": "subtitles",
            "types": ["series", "movie"],
            "idPrefixes": [ADDON_PREFIX]
        }
    ],
    types: ['movie', "series"],
}

addon.get('/manifest.json', function (req, res) {
    res.send(MANIFEST)
});

// search
addon.get('/catalog/:type/:id/:extraArgs.json', async function (req, res, next) {
    try {
        const args = {
            search: "",
            skip: 0,
        }

        if (!!req.params.extraArgs) {
            for (const item of decodeURIComponent(req.params.extraArgs).split("&")) {
                const [key, val] = item.split("=")
                args[key] = val
            }
        }

        let data = []

        // avamovie Provider
        if (req.params.id.includes('avamovie')) {
            data = await AvamovieProvider.search(args.search)

            // append Provider ID prefix
            for (let i = 0; i < data.length; i++) {
                data[i].id = AvamovieProvider.providerID + data[i].id
            }
        }

        // peepboxtv provider
        if (req.params.id.includes('peepboxtv')) {
            data = await PeepboxtvProvider.search(args.search)
            // append Provider ID prefix
            for (let i = 0; i < data.length; i++) {
                data[i].id = PeepboxtvProvider.providerID + data[i].id
            }
        }

        data = data.filter(i => i.type === req.params.type)

        // append addon prefix
        for (let i = 0; i < data.length; i++) {
            data[i].id = ADDON_PREFIX + data[i].id
        }

        res.send({
            "metas": data
        })
    } catch (e) {
        logger.error(e)
        res.send({
            "metas": {}
        })
    }
});


// get movie or series data
addon.get('/meta/:type/:id.json', async function (req, res, next) {
    try {
        let imdbId = ""

        let providerPrefix = ""

        let meta = {}

        const providerMovieId = req.params.id.split((new Source).idSeparator)[1]

        // avamovie Provider
        if (req.params.id.includes('avamovie')) {
            providerPrefix = AvamovieProvider.providerID
            const movieData = await AvamovieProvider.getMovieData(req.params.type, providerMovieId)
            if (!!movieData) {
                imdbId = await AvamovieProvider.imdbID(movieData)
            }
        }

        // peepboxtv Provider
        if (req.params.id.includes('peepboxtv')) {
            providerPrefix = PeepboxtvProvider.providerID
            const movieData = await PeepboxtvProvider.getMovieData(req.params.type, providerMovieId)
            if (!!movieData) {
                imdbId = await PeepboxtvProvider.imdbID(movieData)
            }
        }

        if (imdbId.length > 0) {
            meta = await getCinemeta(req.params.type, imdbId)
            if(process.env.PROXY_ENABLE === 'true' || process.env.PROXY_ENABLE === '1'){
                meta = modifyUrls(meta, `${process.env.PROXY_URL}/${process.env.PROXY_PATH}?url=`)
            }
        }


        if (meta.hasOwnProperty("meta")) {
            // append addon prefix to series video
            if (req.params.type === "series") {
                for (let i = 0; i < meta.meta.videos.length; i++) {
                    meta.meta.videos[i].id = ADDON_PREFIX + providerPrefix + providerMovieId + (new Source).idSeparator + meta.meta.videos[i].id
                }
                meta.meta.id = req.params.id
            }

            // append addon prefix to movie
            if (req.params.type === "movie") {
                meta.meta.id = ADDON_PREFIX + providerPrefix + providerMovieId + (new Source).idSeparator + meta.meta.id
                meta.meta.behaviorHints.defaultVideoId = meta.meta.id
            }
        } else {
            logger.warn("meta is empty!")
        }
        return res.send(meta)

    } catch (e) {
        logger.error(e)
        res.send({})
    }
});


addon.get('/stream/:type/:id.json', async function (req, res, next) {
    try {
        const providerMovieId = req.params.id.split((new Source).idSeparator)[1]
        const imdbId = req.params.id.split((new Source).idSeparator)[2]

        let streams = []

        if (req.params.id.includes('avamovie')) {
            const movieData = await AvamovieProvider.getMovieData(req.params.type, providerMovieId)
            streams = AvamovieProvider.getLinks(req.params.type, imdbId, movieData)
        }

        if (req.params.id.includes('peepboxtv')) {
            const movieData = await PeepboxtvProvider.getMovieData(req.params.type, providerMovieId)
            streams = PeepboxtvProvider.getLinks(req.params.type, imdbId, movieData)
        }

        return res.send({streams})

    } catch (e) {
        logger.error(e)
        res.send({})
    }
});

addon.get('/subtitles/:type/:id/:extraArgs.json', async function (req, res, next) {
    try {
        const args = {
            videoID: "",
            videoSize: 0,
        }

        if (!!req.params.extraArgs) {
            for (const item of decodeURIComponent(req.params.extraArgs).split("&")) {
                const [key, val] = item.split("=")
                args[key] = val
            }
        }

        const imdbId = req.params.id.split((new Source).idSeparator)[2]

        const data = await getSubtitle(req.params.type, imdbId)

        return res.send(data)
    } catch (e) {
        logger.error(e)
        res.send({})
    }
});


addon.get('/health', async function (req, res, next) {
    return res.send('ok')
});

addon.listen(7000, function () {
    logger.info('Add-on Repository URL: http://127.0.0.1:7000/manifest.json')
    return "0.0.0.0"
});



