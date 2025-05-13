import Source from "./source.js";
import Axios from "axios";

export default class Avamovie extends Source{
    username = process.env.AVAMOVIE_USERNAME
    password = process.env.AVAMOVIE_PASSWORD

    token = ""
    userId = ""

    constructor(baseURL, logger) {
        super(baseURL, logger)
        this.providerID = "avamovie" + this.idSeparator
    }

    async isLogin(){
        try {
            const res = await Axios.request({
                url: `https://${this.baseURL}/api-url/app/1/user_info`,
                method: "post",
                maxRedirects: 0,
                validateStatus: (status) =>
                    status >= 200 && status < 400,
                data:{
                    token:this.token,
                    user_id:this.userId
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            if(res.data?.stat === "ok"){
                this.logger.debug(`Avamovie was logged in with token: ${this.token}, user_id: ${this.userId}`)
                return true;
            }
        }catch (e) {}
        this.logger.info(`Avamovie is NOT logged in`)
        return false
    }

    async login(){
        const isLogin = await this.isLogin()
        if(isLogin){
            this.logger.debug(`Avamovie was logged in with token: ${this.token}, user_id: ${this.userId}`)
            return true
        }

        try {
            const res = await Axios.request({
                url: `https://${this.baseURL}/api-url/app/1/login`,
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
            if(res.data?.stat === "ok"){
                this.token = res.data.token
                this.userId = res.data.user_id
                this.logger.info(`Avamovie now is logged in with token: ${this.token}, user_id: ${this.userId}`)
                return true;
            }
        }catch (e) {
            this.logger.error(e)
        }
        return false
    }

    async search(text) {
        try {
            this.logger.debug(`Avamovie searching for ${text}`)
            const res = await Axios.request({
                url: `https://${this.baseURL}/api-url/app/1/search`,
                method: "post",
                data:{
                    text:text,
                    sort:"",
                    page:"1",
                    per_page:"99999"
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            if(!!res){
                const items = []

                if(!res.data.hasOwnProperty("results")){
                    return items
                }

                for (const item of res.data.results) {
                    const movie = {
                        name: item.title_en,
                        poster: item.poster,
                        type:item.type,
                        id:item.id,
                        genres: []
                    }
                    items.push(movie)
                }
                return items
            }
        }catch (e) {
            this.logger.error("ERROR in getting list from avamovie", e)
        }

        return []
    }

    async getMovieData(type, id){
        try {
            this.logger.debug(`Avamovie getting movie with id ${id}`)
            const res = await Axios.request({
                url: `https://${this.baseURL}/api-url/app/1/single`,
                method: "post",
                data:{
                    id:id,
                    token: this.token,
                    user_id: this.userId
                },
                params:{
                    id:id,
                    token: this.token,
                    user_id: this.userId
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            if(res.data?.id > 0){
                return res.data;
            }
        }catch (e) {
            this.logger.error(e)
            this.login().then()
        }

        return null
    }

    getMovieLinks(movieData){
        const links = []
        // sub
        if(movieData?.dl?.movie.hasOwnProperty("sub")){
            for (const item of movieData.dl.movie.sub.items) {
                const link = {url:"", title:""}
                link.title = item.quality + " - "
                link.title += item.size + " - "
                link.title += item.encoder + " - "
                link.title += item.subtype

                link.url = item.url

                links.push(link)
            }
        }

        // dub
        if(movieData?.dl?.movie.hasOwnProperty("dub")) {
            for (const item of movieData.dl.movie.dub.items) {
                const link = {url: "", title: ""}
                link.title = "(DUBBED) - "
                link.title += item.quality + " - "
                link.title += item.size + " - "
                link.title += item.encoder

                link.url = item.url
                links.push(link)
            }
        }

        return links

    }

    getSeriesLinks(movieData, imdbId){
        const links = []
        try {
            const season = (+imdbId.split(":")[1]).toLocaleString("en-US", {minimumIntegerDigits:2})
            const episode = +imdbId.split(":")[2]


            for (const item of movieData.dl.series[season].items) {
                const link = {url:"", title:""}
                if(!!(+item.dub)){
                    link.title = "(DUBBED) - " + `S${season}E${episode}`
                }else{
                    link.title = (item?.subtype ? (item.subtype + " - ") : "") + `S${season}E${episode}`
                }

                link.title += item.quality + " - "
                link.title += item.size + " - "

                link.url = item?.episodes[episode - 1]?.url

                links.push(link)
            }
        }catch (e) {
            this.logger.debug(`error with => Avamovie, ${movieData}, ${imdbId}`)
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
        return movieData.imdb
    }
}