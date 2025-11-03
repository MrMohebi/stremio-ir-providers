import Source from "./source.js";
import Axios from "axios";
import {logAxiosError, searchAndGetTMDB} from "../utils.js";

export default class Digimovie extends Source{
    username = process.env.DIGIMOVIE_USERNAME
    password = process.env.DIGIMOVIE_PASSWORD

    token = ""
    refreshToken = ""

    constructor(baseURL, logger) {
        super(baseURL, logger)
        this.providerID = "digimovie" + this.idSeparator
    }

    async isLogin(){
        try {
            const res = await Axios.request({
                url: `https://${this.baseURL}/api/app/v1/get_profile`,
                method: "post",
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400,
                headers: {
                    'Content-Type': 'application/json',
                    "authorization": this.token
                }
            })
            if(res.data?.status){
                this.logger.debug(`Digimovie was logged in with token: ${this.token}`)
                return true;
            }
        }catch (e) {}
        this.logger.info(`Digimovie is NOT logged in`)
        return false
    }

    async login(){
        const isLogin = await this.isLogin()
        if(isLogin){
            this.logger.debug(`Digimovie was logged in with token: ${this.token}`)
            return true
        }

        try {
            const res = await Axios.request({
                url: `https://${this.baseURL}/api/app/v1/login`,
                method: "post",
                maxRedirects: 0,
                validateStatus: (status) =>
                    status >= 200 && status < 400,
                data:{
                    username:this.username,
                    password:this.password
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            if(res.data?.status){
                this.token = res.data.auth_token
                this.refreshToken = res.data.refresh_token
                this.logger.info(`Digimovie now is logged in with token: ${this.token}`)
                return true;
            }
        }catch (e) {
            logAxiosError(e, this.logger, "Digimovie login error: ")
        }
        return false
    }

    async search(text) {
        try {
            this.logger.debug(`Digimovie searching for ${text}`)
            const res = await Axios.request({
                url: `https://${this.baseURL}/api/app/v1/adv_search_movies`,
                method: "post",
                data:{
                    "adv_s": text,
                    "adv_movie_type": "all",
                    "adv_director": "",
                    "adv_cast": "",
                    "adv_release_year": {
                        "min": null,
                        "max": null
                    },
                    "adv_imdb_rate": {
                        "min": null,
                        "max": null
                    },
                    "adv_country": "0",
                    "adv_age": "0",
                    "adv_genre": "0",
                    "adv_quality": "0",
                    "adv_network": "0",
                    "adv_order": "publish_date",
                    "adv_dubbed": "0",
                    "adv_censorship": "0",
                    "adv_subtitle": "0",
                    "adv_online": "0",
                    "per_page": 30,
                    "paged": 1
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            if(!!res){
                const items = []

                if(res.data?.result.total_items < 1){
                    return items
                }

                for (const item of res.data.result.items) {
                    const movie = {
                        name: item.title_en,
                        poster: item.image_url,
                        type:item.type === "movie" ? "movie" : "series",
                        id:item.id,
                        genres: []
                    }
                    items.push(movie)
                }
                return items
            }
        }catch (e) {
            logAxiosError(e, this.logger, "Digimovie search error: ")
        }

        return []
    }

    async getMovieData(type, id){
        try {
            this.logger.debug(`Digimovie getting movie with id ${id}`)
            const res = await Axios.request({
                url: `https://${this.baseURL}/api/app/v1/get_movie_detail`,
                method: "get",
                params:{
                    movie_id:id,
                },
                headers: {
                    'Content-Type': 'application/json',
                    "authorization": this.token,
                }
            })
            if(res.data?.status){
                return res.data;
            }
        }catch (e) {
            logAxiosError(e, this.logger, "Digimovie getMovieData error: ")
            this.login().then()
        }

        return null
    }

    getMovieLinks(movieData){
        const links = []

        for (const item of movieData.movie_download_urls) {
            const link = {url:"", title:""}
            link.title = item.quality + " - "
            link.title += item.size + " - "
            link.title += item.encode + " - "
            link.title += item.label

            link.url = item.file

            links.push(link)
        }

        return links
    }

    getSeriesLinks(movieData, imdbId){
        const links = []
        try {
            const season = +imdbId.split(":")[1]
            const episode = +imdbId.split(":")[2]

            const seasonTitle = `:${season}`

            for (const item of movieData.serie_download_urls.filter(i=>i.season_name.replace(" ","").includes(seasonTitle))) {
                const link = {url:"", title:""}
                link.title = item.quality + " - " + item.size
                link.url = item.links[episode-1].movie
                links.push(link)
            }
        }catch (e) {
            this.logger.debug(`error with => Digimovie, ${movieData}, ${imdbId}`)
            this.logger.error(e.message)
        }


        return links
    }

    getLinks(type, imdbId, movieData){
        if(type === "movie"){
            return this.getMovieLinks(movieData)
        }

        if(type === "series"){
            return this.getSeriesLinks(movieData, imdbId)
        }

    }

    async imdbID(movieData){
        const tmdbData = await searchAndGetTMDB(movieData.movie_info.title_en)
        if(tmdbData){
            return tmdbData.external_ids.imdb_id
        }
        return null
    }


}