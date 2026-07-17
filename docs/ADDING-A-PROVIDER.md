# Adding a New Provider

This guide explains what an upstream provider must expose and how to integrate it into the Stremio IR Provider addon.

The examples use a fictional provider named `Example`. Replace its URLs and response fields with the real provider's API. Do not copy provider-specific credentials into source code or tests.

Before starting, use Node.js 24.18.0 or newer (`nvm use` selects the repository version), enable Corepack with `corepack enable`, run `pnpm install`, and confirm the existing suite passes with `pnpm check`. You should be comfortable with JavaScript classes, async functions, HTTP APIs, and dependency injection; no Stremio SDK knowledge is required.

## How a Provider Integration Works

The addon translates between three different contracts:

1. The provider API supplies search results, title details, and playable files.
2. Cinemeta supplies Stremio-compatible metadata and episode IDs using an IMDb ID.
3. The provider class maps the selected Stremio movie or episode back to one or more playable provider URLs.

The request flow is:

```text
Stremio search
  -> provider.search(query)
  -> catalog metadata with an addon ID

Stremio opens a result
  -> provider.getMovieData(type, providerItemId)
  -> provider.imdbID(movieData, type)
  -> Cinemeta metadata

Stremio requests streams
  -> provider.getMovieData(type, providerItemId)
  -> provider.getLinks(type, videoId, movieData)
  -> playable URLs
```

The common HTTP routes and ID transformation live in [`app.js`](../app.js). Provider-specific behavior belongs in `sources/<provider>.js`.

Cinemeta availability is required when Stremio opens a provider result. Providers supply identity and streams; they do not replace Cinemeta metadata in the current architecture.

`getMovieData()` is normally called once while building metadata and again when Stremio requests streams. The corresponding upstream endpoint should be safe to call repeatedly. If a provider has strict rate limits, add a small bounded cache with an expiry that is shorter than the lifetime of its signed stream URLs, and cover the cache behavior with tests.

## Upstream API Requirements

A provider does not need to use a specific API format. Its responses only need to contain enough information to implement the following operations.

| Operation | Required? | Data the addon needs |
| --- | --- | --- |
| Search | Yes | Stable provider item ID, display title, movie/series type, and preferably a poster URL |
| Title details | Yes | The data needed to identify the title and locate its movie or series files |
| Movie streams | For supported movies | One or more directly playable HTTP(S) URLs, with useful quality labels |
| Series streams | For supported series | Seasons, episodes, and one or more directly playable HTTP(S) URLs for each episode |
| IMDb mapping | Yes | Preferably an IMDb ID such as `tt0133093`; otherwise a reliable English title for TMDB lookup |
| Authentication | Only if required | A documented login/token flow and the credentials required by protected endpoints |

The provider API should ideally also have:

- HTTPS support.
- Stable IDs that do not change when titles are renamed.
- An explicit movie-versus-series field.
- Predictable numeric seasons and one-based episode numbers, including a clear convention for specials.
- Reasonable response times and documented rate limits.
- File URLs that are playable outside the provider's website.

The current `search(text)` contract does not expose pagination or Stremio's `skip` value. Return a useful, bounded result set—roughly the best 20 to 30 matches—instead of loading an entire provider catalog.

Provider item IDs are embedded in URL path segments. They should use a path-safe, reversible format and must not contain the addon's `___` separator. If an upstream ID can contain slashes, `___`, or other unsafe characters, encode it into a safe representation in `search()` and decode it inside `getMovieData()` before calling the provider API.

This repository currently returns simple stream objects containing `url` and `title`. A provider that requires browser-only cookies, JavaScript challenges, DRM, or complex custom playback headers cannot be integrated by only adding a provider class. Supporting one would require a deliberate extension of the stream/proxy architecture and client testing.

### HTML-Only Providers

Providers without an API can extend [`HtmlSource`](../sources/html-source.js). It supplies timeout-limited HTML requests with browser-compatible headers, Cheerio document loading, same-origin page validation, and reversible base64url page-path IDs. Keep selectors, season naming rules, and stream extraction in the provider class because those details are website-specific.

Use `pageId()` on same-origin detail links found during search, then use `decodePagePath()` before fetching a detail page. Validate decoded paths against the provider's actual movie and series URL shapes so a forged addon ID cannot turn the scraper into an arbitrary page fetcher. Parse all network responses inside `search()` or `getMovieData()`; `getLinks()` must remain a synchronous transformation of the parsed result.

Prefer semantic markup such as canonical links, Open Graph metadata, IMDb links, direct download anchors, and season/episode labels. Do not scrape layout-only class names when a more stable attribute is available. Store small representative HTML fragments in tests rather than committing complete upstream pages, which are large and change frequently.

### Example Search Response

The provider's JSON might look like this:

```json
{
  "results": [
    {
      "id": 123,
      "title": "The Example Movie",
      "kind": "movie",
      "poster_url": "https://cdn.example.com/posters/123.jpg"
    }
  ]
}
```

The integration maps it to the catalog shape used by this addon:

```json
{
  "id": "123",
  "name": "The Example Movie",
  "type": "movie",
  "poster": "https://cdn.example.com/posters/123.jpg",
  "genres": []
}
```

### Example Detail Response

There is no required detail-response schema. A useful response could contain:

```json
{
  "id": 123,
  "title": "The Example Movie",
  "imdb_id": "tt1234567",
  "downloads": [
    {
      "quality": "1080p",
      "size": "2.1 GB",
      "url": "https://media.example.com/movie-1080p.mkv"
    }
  ],
  "seasons": [
    {
      "number": 1,
      "episodes": [
        {
          "number": 1,
          "title": "Episode 1",
          "files": [
            {
              "quality": "1080p",
              "url": "https://media.example.com/s01e01-1080p.mkv"
            }
          ]
        }
      ]
    }
  ]
}
```

Your class is responsible for adapting the real response into the addon contracts. The upstream property names do not need to match this example.

## The Provider Class Contract

All providers extend `Source` from [`sources/source.js`](../sources/source.js).

| Member | Purpose | Expected result |
| --- | --- | --- |
| `key` | Stable lowercase, delimiter-free slug | For example, `example` |
| `providerID` | Provider portion of Stremio IDs | `` `${this.key}${this.idSeparator}` `` |
| `search(text)` | Search the provider | Array of catalog items; return `[]` on failure |
| `getMovieData(type, id)` | Fetch provider details | Provider response object; return `null` on failure |
| `imdbID(movieData, type)` | Resolve metadata identity | IMDb ID string or `null` |
| `getLinks(type, videoId, movieData)` | Synchronously dispatch movie/series link parsing | Array of stream objects, never a Promise |
| `login()` | Authenticate if necessary | Boolean success value |
| `isLogin()` | Validate an existing session if supported | Boolean login state |

Provider methods must not throw for normal upstream failures. Log a safe error and return the empty value shown above. The route layer also guards against exceptions, but keeping failures inside the provider makes behavior easier to test and understand.

`getLinks()` must remain synchronous because `app.js` does not await it. Perform all network I/O in the awaited `getMovieData()` method, then make `getMovieLinks()` and `getSeriesLinks()` pure transformations of the returned data.

One provider instance is shared by concurrent addon requests. Keep methods safe for concurrent use and do not store request-specific or Stremio-user-specific state on the instance. A shared authentication token is appropriate; a partially built search result or selected episode is not.

## Understanding Addon IDs

Do not invent a different ID format for a new provider. The addon uses `___` as a separator:

```text
Catalog/meta ID:
ip<provider-key>___<provider-item-id>

Movie stream ID:
ip<provider-key>___<provider-item-id>___<imdb-id>

Series stream ID:
ip<provider-key>___<provider-item-id>___<imdb-id>:<season>:<episode>
```

For example:

```text
ipexample___123
ipexample___123___tt1234567
ipexample___123___tt1234567:2:4
```

`app.js` creates and parses these IDs. A provider receives only the original provider item ID in `getMovieData`, and receives the Cinemeta video ID in `getLinks`. `:2:4` means season 2, episode 4. Episodes are one-based. Seasons normally begin at 1, but Cinemeta may use season 0 for specials. Do not reject season 0 unless the provider deliberately does not support specials. Convert a number to a zero-based array index only where the upstream response is known to use a positional array.

The provider `key` becomes part of persistent Stremio IDs and catalog IDs. Choose it once, use a simple lowercase slug containing only letters and digits, and do not rename it after release.

## Implementing a Provider

### 1. Add Environment Variables

Add only the variables the provider actually needs to [`.env.example`](../.env.example):

```dotenv
EXAMPLE_BASEURL=api.example.com
EXAMPLE_API_KEY=
EXAMPLE_USERNAME=
EXAMPLE_PASSWORD=
```

Also pass them through the `app` service in [`docker-compose.yml`](../docker-compose.yml). Never commit real credentials, access tokens, cookies, or private API keys.

Base URLs may include `http://` or `https://`. Without a scheme, `Source` defaults to HTTPS. Keep endpoint paths in code rather than including them in `EXAMPLE_BASEURL`.

### 2. Create the Provider Class

Create `sources/example.js`:

```js
import axios from 'axios'

import Source from './source.js'
import {logAxiosError, REQUEST_TIMEOUT_MS, searchAndGetTMDB} from '../utils.js'

function isPlayableUrl(value) {
    if (typeof value !== 'string') {
        return false
    }
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

function isSafeProviderId(value) {
    const id = String(value ?? '')
    return id !== '.'
        && id !== '..'
        && /^[A-Za-z0-9._~-]+$/.test(id)
        && !id.includes('___')
}

export default class Example extends Source {
    key = 'example'

    constructor(baseUrl, logger = console, httpClient = axios, env = process.env) {
        super(baseUrl, logger, httpClient)
        this.providerID = `${this.key}${this.idSeparator}`
        this.apiKey = env.EXAMPLE_API_KEY
        this.tmdbApiKey = env.TMDB_API_KEY
    }

    requestConfig() {
        return {
            headers: {'api-key': this.apiKey},
            timeout: REQUEST_TIMEOUT_MS,
        }
    }

    async search(text) {
        if (!this.baseUrl || !this.apiKey || !String(text ?? '').trim()) {
            return []
        }

        try {
            const response = await this.httpClient.get(this.endpoint('/v1/search'), {
                ...this.requestConfig(),
                params: {q: text},
            })
            const results = Array.isArray(response.data?.results) ? response.data.results : []

            return results
                .filter((item) => (
                    isSafeProviderId(item?.id)
                    && typeof item.title === 'string'
                    && item.title.trim()
                    && ['movie', 'series'].includes(item.kind)
                ))
                .map((item) => ({
                    id: String(item.id).trim(),
                    name: item.title.trim(),
                    poster: item.poster_url,
                    type: item.kind,
                    genres: [],
                }))
        } catch (error) {
            logAxiosError(error, this.logger, 'Example search failed')
            return []
        }
    }

    async getMovieData(type, id) {
        if (!this.baseUrl || !this.apiKey || !isSafeProviderId(id)) {
            return null
        }

        try {
            const response = await this.httpClient.get(this.endpoint(`/v1/titles/${id}`), {
                ...this.requestConfig(),
                params: {type},
            })
            return response.data?.id != null ? response.data : null
        } catch (error) {
            logAxiosError(error, this.logger, 'Example detail request failed')
            return null
        }
    }

    getMovieLinks(movieData) {
        const downloads = Array.isArray(movieData?.downloads) ? movieData.downloads : []
        return downloads
            .filter((file) => isPlayableUrl(file?.url))
            .map((file) => ({
                url: file.url,
                title: [file.quality, file.size].filter(Boolean).join(' - '),
            }))
    }

    getSeriesLinks(movieData, videoId) {
        const [, seasonText, episodeText] = String(videoId ?? '').split(':')
        if (!/^\d+$/.test(seasonText) || !/^\d+$/.test(episodeText)) {
            return []
        }
        const seasonNumber = Number(seasonText)
        const episodeNumber = Number(episodeText)
        if (
            !Number.isInteger(seasonNumber)
            || !Number.isInteger(episodeNumber)
            || seasonNumber < 0
            || episodeNumber < 1
        ) {
            return []
        }

        const seasons = Array.isArray(movieData?.seasons) ? movieData.seasons : []
        const season = seasons.find((item) => Number(item.number) === seasonNumber)
        const episodes = Array.isArray(season?.episodes) ? season.episodes : []
        const episode = episodes.find((item) => Number(item.number) === episodeNumber)
        const files = Array.isArray(episode?.files) ? episode.files : []

        return files
            .filter((file) => isPlayableUrl(file?.url))
            .map((file) => ({
                url: file.url,
                title: [
                    `S${seasonNumber}E${episodeNumber}`,
                    file.quality,
                    file.size,
                ].filter(Boolean).join(' - '),
            }))
    }

    getLinks(type, videoId, movieData) {
        if (type === 'movie') {
            return this.getMovieLinks(movieData)
        }
        if (type === 'series') {
            return this.getSeriesLinks(movieData, videoId)
        }
        return []
    }

    async imdbID(movieData, type) {
        const providerImdbId = movieData?.imdb_id
        if (/^tt\d{7,10}$/.test(providerImdbId)) {
            return providerImdbId
        }

        const tmdbData = await searchAndGetTMDB(
            movieData?.title,
            type,
            this.httpClient,
            this.logger,
            this.tmdbApiKey,
        )
        const resolvedImdbId = tmdbData?.external_ids?.imdb_id
        return /^tt\d{7,10}$/.test(resolvedImdbId) ? resolvedImdbId : null
    }
}
```

Important implementation rules:

- Use the injected `this.httpClient`; do not import and call a second global client inside methods. Injection keeps tests offline and deterministic.
- Apply `REQUEST_TIMEOUT_MS` to every provider request.
- Validate nested arrays before iterating over them.
- Convert provider IDs to strings in search results.
- Return only stream entries with a real URL.
- Validate that stream URLs are strings using the `http:` or `https:` protocol.
- Keep upstream response mapping inside the provider class.
- Do not log full responses, authorization headers, credentials, tokens, or signed stream URLs.
- Return `[]` or `null` for unavailable content instead of throwing.

### 3. Add Authentication When Required

Do not implement authentication if the provider's content endpoints are public. When authentication is required, store tokens only in memory and authenticate lazily before a protected request.

Add the required fields to the provider constructor:

```js
this.username = env.EXAMPLE_USERNAME
this.password = env.EXAMPLE_PASSWORD
this.token = ''
```

A typical login method looks like this:

```js
async login() {
    if (!this.baseUrl || !this.username || !this.password) {
        return false
    }

    try {
        const response = await this.httpClient.post(
            this.endpoint('/v1/login'),
            {username: this.username, password: this.password},
            {timeout: REQUEST_TIMEOUT_MS},
        )
        if (!response.data?.access_token) {
            return false
        }

        this.token = response.data.access_token
        this.logger.info('Example login succeeded')
        return true
    } catch (error) {
        logAxiosError(error, this.logger, 'Example login failed')
        return false
    }
}
```

Before a protected detail request:

```js
if (!this.token && !await this.login()) {
    return null
}
```

Send the token in the provider's documented header. If an authenticated request returns `401`, clear the in-memory token. A later request can log in again. Avoid endless login/retry loops.

For example, a protected request should clear an expired token without recursively retrying forever:

```js
try {
    if (!this.token && !await this.login()) {
        return null
    }
    const response = await this.httpClient.get(this.endpoint('/v1/protected'), {
        headers: {authorization: `Bearer ${this.token}`},
        timeout: REQUEST_TIMEOUT_MS,
    })
    return response.data ?? null
} catch (error) {
    if (error.response?.status === 401) {
        this.token = ''
    }
    logAxiosError(error, this.logger, 'Example protected request failed')
    return null
}
```

`isLogin()` is optional unless the provider exposes a cheap session/profile endpoint and the implementation uses it. The inherited method returns `false`; the addon does not call it directly.

### 4. Resolve the IMDb ID

Cinemeta requires an IMDb ID to construct Stremio metadata. Use these strategies in order:

1. Read a validated `tt...` ID directly from the provider response.
2. If the provider exposes an IMDb URL, extract and validate the `tt...` portion.
3. Use `searchAndGetTMDB(title, type, ...)` as a fallback.

For an IMDb URL, match only a title ID segment such as `/title/tt1234567/`; do not accept arbitrary strings merely because they start with `tt`.

TMDB fallback requires `TMDB_API_KEY`. Passing `type` is important because the same title can exist as both a movie and a television series. The shared helper rejects results from the wrong media type. Still treat its output as a candidate: validate the IMDb format and, for ambiguous titles, compare release year or another provider field. If the candidate cannot be validated, return `null`. Adding more matching inputs requires matching unit tests.

### 5. Register the Provider

Update [`app.js`](../app.js) in three places.

Import the class:

```js
import Example from './sources/example.js'
```

Add its catalog label:

```js
const CATALOGS = [
    // Existing providers...
    {key: 'example', name: 'Example'},
]
```

The catalog `key` must exactly match the class `key` and the prefix used in `providerID`.

Create the provider instance:

```js
export function createProviders({env = process.env, logger = console, httpClient} = {}) {
    return [
        // Existing providers...
        new Example(env.EXAMPLE_BASEURL, logger, httpClient, env),
    ]
}
```

The manifest will then expose movie and series search catalogs named `example_movies` and `example_series`.

If the provider supports only one media type, the current manifest code must be refactored rather than merely adding a `types` property that nothing reads. Give every catalog entry an explicit type list, such as `{key: 'example', name: 'Example', types: ['movie']}`, and change `createManifest()` to map over each entry's `types` instead of the hardcoded `['movie', 'series']`. Update `findCatalogProvider()` if needed so hidden catalog IDs are rejected. Add manifest tests for the supported and unsupported type. Do not advertise a catalog that can never return results.

Finally, add the provider to the supported-provider list in [`README.md`](../README.md).

## Testing the Integration

Tests must not contact the live provider. Inject a fake HTTP client and use representative provider responses with secrets removed.

At minimum, add tests for:

1. Search response mapping for every media type the provider supports.
2. Empty or malformed search responses.
3. Movie stream extraction when movies are supported.
4. Series season and episode selection when series are supported, especially episode 1 and the last episode.
5. Missing seasons, episodes, and file URLs for supported media types.
6. Direct IMDb ID resolution and TMDB fallback.
7. Missing configuration causing zero HTTP requests.
8. Authentication success, failure, and token expiry if authentication exists.
9. Verification that tokens and credentials are not logged.

A provider search test follows this pattern. Put it in a new `test/example.test.js` file; if you add it to `test/providers.test.js` instead, reuse that file's existing imports rather than duplicating them.

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import Example from '../sources/example.js'
import {silentLogger} from '../test-support/helpers.js'

test('Example maps provider search results', async () => {
    const httpClient = {
        async get(url, config) {
            assert.equal(url, 'https://api.example.com/v1/search')
            assert.equal(config.params.q, 'Matrix')
            return {
                data: {
                    results: [
                        {id: 123, title: 'Matrix', kind: 'movie', poster_url: 'poster'},
                    ],
                },
            }
        },
    }

    const provider = new Example(
        'api.example.com',
        silentLogger,
        httpClient,
        {EXAMPLE_API_KEY: 'test-key'},
    )

    assert.deepEqual(await provider.search('Matrix'), [
        {id: '123', name: 'Matrix', poster: 'poster', type: 'movie', genres: []},
    ])
})
```

Also add at least one addon-route test using an injected provider in [`test/app.test.js`](../test/app.test.js). Confirm the new provider produces the expected catalog ID, metadata ID, and stream response.

Update the existing manifest assertions as well. In particular, `test/app.test.js` currently expects four catalogs; registering a provider changes that count unless the test is refactored to assert catalog IDs instead. Prefer asserting the expected IDs so an accidental missing catalog is easier to diagnose.

Run the complete checks:

```sh
pnpm check
pnpm audit
docker compose config --quiet
docker build .
```

## Failure Behavior

Provider APIs are external systems and will fail occasionally. Use these return values consistently:

| Failure | Provider return value | Addon response |
| --- | --- | --- |
| Search unavailable | `[]` | `{"metas":[]}` |
| Detail unavailable | `null` | `{}` for metadata or an empty stream list |
| No playable movie/episode file | `[]` | `{"streams":[]}` |
| IMDb ID cannot be resolved | `null` | `{}` |
| Subtitle service unavailable | Not provider-controlled | `{"subtitles":[]}` |

Do not turn ordinary upstream misses into HTTP 500 responses. Stremio handles valid empty addon responses more reliably.

## Provider Readiness Checklist

Before opening a pull request, verify all of the following:

- [ ] The provider has a stable lowercase alphanumeric `key`.
- [ ] Search maps stable IDs, titles, types, and posters when available.
- [ ] Every supported media type is filtered to its correct catalog.
- [ ] Details return enough information for IMDb resolution and streams.
- [ ] Series episode mapping is tested with one-based episode numbers and season-zero specials where supported.
- [ ] Stream URLs are valid, directly playable HTTP(S) resources.
- [ ] Every HTTP request has a timeout.
- [ ] Missing configuration makes no network requests.
- [ ] Authentication tokens and credentials never appear in logs.
- [ ] Normal provider failures return `[]` or `null`.
- [ ] Environment and Compose examples contain placeholders only.
- [ ] The provider is registered in `CATALOGS` and `createProviders`.
- [ ] The README supported-provider list is updated.
- [ ] Unit tests and addon-route tests pass.
- [ ] `pnpm check`, `pnpm audit`, and the Docker build pass.

## Troubleshooting

### Search works but opening a title returns no metadata

Check `imdbID()`. It must return a validated IMDb title ID such as `tt0133093`, matching `^tt\d{7,10}$`. Confirm `TMDB_API_KEY` is configured if the provider does not expose IMDb IDs directly.

### Movie streams work but series streams are empty

Log only the non-sensitive season and episode numbers passed to `getSeriesLinks`. Confirm the Cinemeta video ID is parsed as `imdbId:season:episode`, and verify whether the provider response uses one-based numbers, zero-based array positions, or textual season names.

### URLs appear in Stremio but do not play

Test whether the URL is a direct media resource rather than a web page. Check whether it expires, requires cookies, restricts the `User-Agent` or `Referer`, uses DRM, or is reachable from the Stremio client's network. Do not place credentials into the URL to work around access controls.

### The provider repeatedly logs in

Confirm the token is stored on the provider instance, sent using the correct authorization scheme, and cleared only after an authentication failure. If the API exposes a lightweight profile endpoint, implement `isLogin()` without logging token values.

### The wrong movie or series metadata appears

Prefer a provider-supplied IMDb ID. When using TMDB fallback, ensure `type` is passed and normalize the title. If titles are ambiguous, include release-year validation or use another stable external identifier.
