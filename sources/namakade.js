import Source from "./source.js";
import Axios from "axios";
import { parse } from "node-html-parser";
import { logAxiosError } from "../utils.js";

export default class Namakade extends Source {
    constructor(baseURL, logger) {
        super(baseURL, logger)
        this.providerID = "namakade" + this.idSeparator
        this.posterCache = new Map() // Cache posters to avoid repeated lookups
    }

    async isLogin() {
        return true
    }

    async login() {
        return true
    }

    // Fetch poster from Cinemeta with timeout
    async fetchPosterFromCinemeta(title, timeoutMs = 2000) {
        try {
            // Check cache first
            if (this.posterCache.has(title)) {
                return this.posterCache.get(title)
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), timeoutMs)

            const res = await Axios.get(
                `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(title)}.json`,
                { 
                    signal: controller.signal,
                    timeout: timeoutMs
                }
            )
            clearTimeout(timeout)

            if (res.data?.metas?.length > 0) {
                // Find best match (exact or close title match)
                const normalizedTitle = title.toLowerCase().trim()
                let bestMatch = res.data.metas[0]
                
                for (const meta of res.data.metas) {
                    if (meta.name?.toLowerCase().trim() === normalizedTitle) {
                        bestMatch = meta
                        break
                    }
                }
                
                const poster = bestMatch.poster || ''
                this.posterCache.set(title, poster)
                return poster
            }
        } catch (e) {
            // Silently fail - we'll just use empty poster
            this.logger.debug(`Cinemeta lookup failed for "${title}": ${e.message}`)
        }
        return ''
    }

    async search(text) {
        try {
            this.logger.debug(`Namakade searching for ${text}`)
            const res = await Axios.request({
                url: `https://${this.baseURL}/search`,
                method: "get",
                params: {
                    page: 'search',
                    searchField: text
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Referer': 'https://namakade.com/',
                }
            })

            if (res && res.data) {
                const items = []
                const root = parse(res.data)

                this.logger.debug(`Namakade search response length: ${res.data.length}`)

                // Movies are in #divGridMason4 ul#gridMason4 li
                let movieContainer = root.querySelector('#divGridMason4 #gridMason4')
                if (!movieContainer) {
                    this.logger.debug('Namakade: Could not find #divGridMason4 #gridMason4, trying #gridMason4')
                    movieContainer = root.querySelector('#gridMason4')
                }
                
                if (movieContainer) {
                    const movieItems = movieContainer.querySelectorAll('li')
                    this.logger.debug(`Namakade: Found ${movieItems.length} movie items`)
                    
                    for (const element of movieItems) {
                        try {
                            // Get the link from the divBorder3 anchor
                            const linkEl = element.querySelector('.divBorder3 a')
                            if (!linkEl) {
                                this.logger.debug('Namakade: No .divBorder3 a found in li')
                                continue
                            }
                            
                            const link = linkEl.getAttribute('href') || ''
                            this.logger.debug(`Namakade: Found link: ${link}`)
                            
                            // Extract slug from URL like "/best-1-movies/drama/pir-pesar"
                            // We need the full path for the video page
                            const slugMatch = link.match(/\/(best-\d+-movies|movies)\/([^?]+)/)
                            const slug = slugMatch ? slugMatch[0] : link
                            
                            if (!slug) continue
                            
                            // Get the title from .SSh3
                            const titleEl = element.querySelector('.SSh3')
                            const title = titleEl ? titleEl.text.trim() : ''
                            
                            if (!title) continue
                            
                            // Get the poster from img (may be empty on namakade)
                            const imgEl = element.querySelector('.divBorder3 img')
                            const localPoster = imgEl ? imgEl.getAttribute('src') : ''
                            this.logger.debug(`Namakade: Local poster URL: ${localPoster}`)
                            
                            // Get genre from .SSpD2
                            const genreEl = element.querySelector('.SSpD2')
                            let genres = []
                            if (genreEl) {
                                const genreText = genreEl.text.replace('Genre:', '').trim()
                                genres = genreText.split('|').map(g => g.trim()).filter(g => g)
                            }
                            
                            const movie = {
                                name: title,
                                poster: localPoster, // Will be enriched with Cinemeta poster below
                                type: 'movie',
                                id: slug,
                                genres: genres
                            }
                            this.logger.debug(`Namakade: Adding movie: ${title}`)
                            items.push(movie)
                        } catch (e) {
                            this.logger.debug(`Error parsing search result item: ${e.message}`)
                        }
                    }
                }
                
                // Enrich items with Cinemeta posters (in parallel, with timeout)
                // Only fetch posters for items that don't have one
                const posterPromises = items.map(async (item) => {
                    if (!item.poster) {
                        item.poster = await this.fetchPosterFromCinemeta(item.name)
                    }
                    return item
                })
                
                // Wait for all poster fetches with a global timeout of 3 seconds
                await Promise.race([
                    Promise.all(posterPromises),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ])
                
                this.logger.debug(`Namakade: Returning ${items.length} items`)
                return items
            }
        } catch (e) {
            logAxiosError(e, this.logger, "Namakade search error: ")
        }

        return []
    }

    async getMovieData(type, id) {
        try {
            this.logger.debug(`Namakade getting movie with id ${id}`)
            
            // id is the slug path like "/best-1-movies/drama/pir-pesar"
            const res = await Axios.request({
                url: `https://${this.baseURL}${id}`,
                method: "get",
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                }
            })

            if (res && res.data) {
                const root = parse(res.data)
                
                // Extract title from #divTitrGrid
                const titleEl = root.querySelector('#divTitrGrid')
                const title = titleEl ? titleEl.text.trim() : ''
                
                // Extract video source URL from <source src="...">
                let videoUrl = ''
                const sourceEl = root.querySelector('#videoTag source')
                if (sourceEl) {
                    videoUrl = sourceEl.getAttribute('src') || ''
                }
                
                // Also try to find it in the script (backup method)
                if (!videoUrl) {
                    const scripts = root.querySelectorAll('script')
                    for (const script of scripts) {
                        const scriptContent = script.text || ''
                        const match = scriptContent.match(/video_url\s*=\s*["']([^"']+\.mp4)["']/)
                        if (match) {
                            videoUrl = match[1]
                            break
                        }
                    }
                }
                
                // Get poster from video tag
                let poster = ''
                const videoEl = root.querySelector('#videoTag')
                if (videoEl) {
                    poster = videoEl.getAttribute('poster') || ''
                }
                
                // Get genre from #divVidDet03
                const genreEl = root.querySelector('#divVidDet03')
                let genres = []
                if (genreEl) {
                    const genreText = genreEl.text.replace('Genre :', '').replace('Genre:', '').trim()
                    genres = genreText.split('|').map(g => g.trim()).filter(g => g)
                }
                
                // Get description
                const description = `Watch ${title} - Persian Movie`
                
                return {
                    title: title,
                    poster: poster,
                    description: description,
                    genres: genres,
                    videoUrl: videoUrl
                }
            }
        } catch (e) {
            logAxiosError(e, this.logger, "Namakade getMovieData error: ")
        }

        return null
    }

    getLinks(type, imdbId, movieData) {
        const streams = []
        
        if (!movieData || !movieData.videoUrl) {
            return streams
        }
        
        // The video URL is a direct .mp4 file from media.negahestan.com
        // It needs Referer header to play
        const videoUrl = movieData.videoUrl
        
        // Extract quality from filename if possible, default to HD
        let quality = 'HD'
        if (videoUrl.includes('720')) {
            quality = '720p'
        } else if (videoUrl.includes('1080')) {
            quality = '1080p'
        } else if (videoUrl.includes('480')) {
            quality = '480p'
        }
        
        streams.push({
            name: movieData.title || 'Persian Movie',
            title: `${quality} - Direct MP4`,
            url: videoUrl,
            behaviorHints: {
                notWebReady: true,
                proxyHeaders: {
                    request: {
                        'Referer': 'https://namakade.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                }
            }
        })
        
        return streams
    }
}
