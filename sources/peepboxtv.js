import Source from "./source.js";
import Axios from "axios";
import {searchAndGetTMDB} from "../utils.js";

export default class Peepboxtv extends Source{
    userId = process.env.PEEPBOXTV_USER_ID
    androidId = process.env.PEEPBOXTV_ANDROID_ID
    apiKey = process.env.PEEPBOXTV_API_KEY

    constructor(baseURL, logger) {
        super(baseURL, logger)
        this.providerID = "peepboxtv" + this.idSeparator
    }

    async isLogin(){
        return true
    }

    async login(){
        return true
    }

    async search(text) {
        try {
            this.logger.debug(`PeepBoxTv searching for ${text}`)
            const res = await Axios.request({
                url: `http://${this.baseURL}/rest-api/v130/search`,
                method: "get",
                params:{
                    q:text,
                    page:1,
                    type:"all",
                    range_to:2030,
                    range_from:1300,
                    tv_category_id:0,
                    genre_id:0,
                    country_id:0,
                    imdb_to:10,
                    imdb_from:1,
                    // user_id:this.userId,
                },
                headers: {
                    'Content-Type': 'application/json',
                    "api-key": this.apiKey,
                    "Host": this.baseURL,
                }
            })

            if(!!res){
                const items = []

                if(!res.data.hasOwnProperty("movie")){
                    return items
                }

                for (const item of res.data.movie) {
                    const movie = {
                        name: item.title,
                        poster: item.thumbnail_url,
                        type:item.is_tvseries === "1" ? "series" : "movie",
                        id:item.videos_id,
                        genres: []
                    }
                    items.push(movie)
                }
                return items
            }
        }catch (e) {
            this.logger.error("ERROR in getting list from PeepBoxTv", e)
        }

        return []
    }

    async getMovieData(type, id){
        try {
            this.logger.debug(`PeepBoxTv getting movie with id ${id}`)
            const res = await Axios.request({
                url: `https://${this.baseURL}/rest-api/v130/single_details`,
                method: "get",
                params:{
                    type: type === "movie" ? "movie" : "tvseries",
                    id:id,
                    user_id:this.userId,
                    android_id:this.androidId,
                },
                headers: {
                    'Content-Type': 'application/json',
                    "api-key": this.apiKey,
                    "Host": this.baseURL,
                }
            })
            if(res.data?.videos_id){
                return res.data;
            }
        }catch (e) {
            this.logger.error(e)
        }

        return null
    }

    getMovieLinks(movieData){
        const links = []

        for (const item of movieData.videos) {
            const link = {url:"", title:""}
            link.title = item.label
            link.url = item.file_url

            links.push(link)
        }

        return links
    }

    getSeriesLinks(movieData, imdbId){
        const links = []
        try {
            const season = (+imdbId.split(":")[1])
            const episode = +imdbId.split(":")[2]

            const seasonTitle = "فصل" + " " + season

            for (const item of movieData.season.filter(i=>i.seasons_name.includes(seasonTitle))) {
                const link = {url:"", title:""}

                link.title = movieData.title + " - " + seasonTitle + " - " + item?.episodes[episode+1].episodes_name

                const seasonTitleParts = item.seasons_name.split(" - ")

                if(seasonTitleParts.length > 1){
                    link.title += " - " + seasonTitleParts[1]
                }

                link.url = item?.episodes[episode+1].file_url

                links.push(link)
            }
        }catch (e) {
            this.logger.debug(`error with => PeepBoxTv, ${movieData}, ${imdbId}`)
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
        const tmdbData = await searchAndGetTMDB(  `${movieData.title.split("/")[0]}`)
        if(tmdbData){
            return tmdbData.external_ids.imdb_id
        }
        return null
    }
}