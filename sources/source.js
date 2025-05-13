
export default class Source {
    idSeparator = "___"
    constructor(baseURL, logger=console) {
        this.baseURL = baseURL;
        this.providerID = "NOT_SET" + this.idSeparator;
        this.logger = logger
    }
    async login(){}
    async isLogin(){}

    async search(text){}
    async getMovieData(type, id){}
    getMovieLinks(movieData){}
    getSeriesLinks(movieData, imdbId){}
    getLinks(type, imdbId, movieData){}
    async imdbID(type, id){}
}