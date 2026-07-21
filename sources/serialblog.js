import axios from 'axios'
import Aslmoviez from './aslmoviez.js'

export default class Serialblog extends Aslmoviez {
    key = 'serialblog'

    constructor(baseUrl, logger = console, httpClient = axios, env = process.env) {
        super(baseUrl, logger, httpClient, env)
        this.providerID = `${this.key}${this.idSeparator}`
    }
}
