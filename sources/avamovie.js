import Source from "./source.js";
import Axios from "axios";
import {parse} from "node-html-parser";
import {extractImdbId, getBetweenParentheses} from "../utils.js";

export default class Avamovie extends Source{
    constructor(baseURL) {
        super(baseURL)
        this.providerID = "avamovie" + this.idSeparator
    }

    async search(text) {
        try {
            const res = await Axios.request({
                url: `https://${this.baseURL}/search/?s=${text}`,
                method: "get",
            })
            if(!!res){
                const parsed = parse(res.data)
                const items = []
                for (const item of parsed.querySelectorAll(".item-movie")) {

                    const movie = {
                        name: item.querySelector('.title_en').innerText,
                        poster: "",
                        type:"movie",
                        link:"",
                        id:"",
                        genres: []
                    }
                    if(!!getBetweenParentheses(item.querySelector('.top').getAttribute('style'))){
                        movie.poster = getBetweenParentheses(item.querySelector('.top').getAttribute('style'))
                    }

                    movie.link = item.getElementsByTagName('a')[0].getAttribute('href')
                    movie.type = movie.link.includes("series") ? "series" : "movie"
                    movie.id = movie.link.split("/").filter(i=>!!i).pop()

                    items.push(movie)

                }
                return items
            }
        }catch (e) {
            console.log("ERROR in getting list from avamovie", e)
        }

        return []

    }

    async getMovieData(type, id){
        let url = `https://${this.baseURL}`
        if(type==="series"){
            url += "/series"
        }
        url += `/${id}`
        try {
            const res = await Axios.request({
                url: url,
                method: "get",
            })
            if(!!res){
                return res.data
            }
        }catch (e) {
            console.log("ERROR in getting movie from avamovie", e)
        }

        return null
    }

    imdbID(movieData){
        return extractImdbId(movieData)
    }

}