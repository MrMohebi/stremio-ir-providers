import Axios from "axios";

export function getBetweenParentheses(str){
    const regex = /\(([^)]+)\)/;
    const match = str.match(regex);

    return match ? match[1] : null;
}

export function extractImdbId(url) {
    const regex = /https:\/\/www\.imdb\.com\/title\/(.*?)\//;
    const match = url.match(regex);
    return match ? match[1] : null; // Returns the extracted ID or null if no match
}

export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function logAxiosError(error, logger= console, appendText = "") {
    if (Axios.isAxiosError(error)) {
        logger.error(appendText, 'Axios error message:', error.message);

        if (error.response) {
            logger.error('Status:', error.response.status);
            logger.error('Response data:', error.response.data);
        } else if (error.request) {
            logger.error('No response received:', error.request);
        } else {
            logger.error('Error setting up request:', error.message);
        }
    } else {
        logger.error(appendText, 'Unexpected error:', error);
    }
}

export function randomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        result += chars[randomIndex];
    }
    return result;
}

export async function getCinemeta(type, imdbId){
    try {
        const res = await Axios.request({
            url: `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`,
            method: "get",
        })
        if (!!res) {
            return res.data
        }
    }catch (e) {
        console.log("ERROR getting cinemeta=> ", e)
    }
    return null
}

export async function searchAndGetTMDB(title){
    if(!process.env.TMDB_API_KEY){
        console.log("Please enter TMDB_API_KEY env for this functionality!")
    }

    try {
        const searchResponse = await Axios.get('https://api.themoviedb.org/3/search/multi', {
            params: {
                api_key: process.env.TMDB_API_KEY,
                query: title,
            },
        });

        const results = searchResponse.data.results;

        if (results.length === 0) {
            console.log('No results found.');
            return null;
        }

        const item = results[0];
        const tmdbId = item.id;
        const mediaType = item.media_type; // 'movie' or 'tv'

        const tmdbDetails = await Axios.get(
            `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?append_to_response=external_ids`,
            {
                params: {
                    api_key: process.env.TMDB_API_KEY,
                },
            }
        );

        return tmdbDetails.data
    } catch (error) {
        console.error('Error:', error.message);
        return null;
    }
}


export async function getSubtitle(type, imdbId){
    try {
        const res = await Axios.request({
            url: `https://opensubtitles-v3.strem.io/subtitles/${type}/${imdbId}.json`,
            method: "get",
        })
        if(!!res){
            return res.data
        }
    }catch (e) {
        console.log("ERROR getting subtitle=> ", e)
    }

    return null
}


export function modifyUrls(obj, prepend) {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    const newObj = Array.isArray(obj) ? [] : {};

    for (let key in obj) {
        if (typeof obj[key] === 'string' && obj[key].startsWith('https://')) {
            newObj[key] = prepend + encodeURIComponent(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            newObj[key] = modifyUrls(obj[key], prepend);
        } else {
            newObj[key] = obj[key];
        }
    }

    return newObj;
}