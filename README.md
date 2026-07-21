<div align="center">
  <img src="https://raw.githubusercontent.com/MrMohebi/stremio-ir-providers/refs/heads/master/logo.png" alt="Stremio IR Providers Logo" width="120" height="120" />
  <h1>Stremio IR Providers</h1>
  <p>A Stremio addon that aggregates Iranian and international streaming sources, delivering movies, series, and live TV directly inside Stremio.</p>

  <p>
    <a href="#-features">Features</a> •
    <a href="#-supported-providers">Providers</a> •
    <a href="#-installation">Installation</a> •
    <a href="#-configuration">Configuration</a> •
    <a href="#-deployment">Deployment</a> •
    <a href="#-development">Development</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/version-2.5.0-blue.svg" alt="Version 2.5.0" />
    <img src="https://img.shields.io/badge/node-%3E%3D24.18.0-green.svg" alt="Node >=24.18.0" />
    <img src="https://img.shields.io/badge/cloudflare-workers-orange.svg" alt="Cloudflare Workers" />
    <img src="https://img.shields.io/badge/license-MIT-lightgrey.svg" alt="License MIT" />
  </p>
</div>

---

## 📖 Introduction

**Stremio IR Providers** is a [Stremio](https://www.stremio.com/) addon that brings together multiple Iranian and international media sources into a single, unified streaming experience.

Instead of juggling multiple websites, this addon lets you search once and get results from all supported providers — with automatic quality sorting, metadata enrichment, and a consistent stream interface.

Whether you're looking for the latest Persian films, classic Iranian series, international blockbusters, or live TV channels, this addon aggregates everything through Stremio's familiar interface.

---

## ✨ Features

| Capability | Description |
|---|---|
| **Multi-Provider Search** | Search across all supported providers simultaneously |
| **Movie & Series Support** | Full support for both movies and TV series with season/episode handling |
| **Iranian Content** | Dedicated providers for Persian-dubbed and original Iranian content |
| **Quality Sorting** | Streams are automatically sorted by resolution (4K → 1080p → 720p → 480p) |
| **Stream Metadata** | Quality, file size, audio type, and encoder info displayed in stream titles |
| **IMDb ID Lookup** | Streams appear on main Stremio pages via IMDb ID integration |
| **Live TV / IPTV** | Watch live Iranian TV channels directly in Stremio |
| **Cloudflare Workers** | Deploy the entire addon as a serverless Cloudflare Worker |
| **Image Proxy** | Built-in proxy for metadata images in restricted regions |
| **Subtitles** | Integrated subtitle support via OpenSubtitles |

---

## 🎯 Supported Providers

| Provider | Type | Description |
|---|---|---|
| **Cinamatic** | 🎬 Movies & 📺 Series | Persian movie and series site with dubbed and subtitled content, multiple quality options and file sizes |
| **AslMoviez** | 🎬 Movies & 📺 Series | Comprehensive Persian media library with IMDb ratings, genre classification, and multiple CDN sources |
| **SerialBlog** | 🎬 Movies & 📺 Series | Mirrors AslMoviez content (redirects to aslmoviez.com) |
| **F2Media** | 🎬 Movies & 📺 Series | Persian movie and series site with direct download links, multiple encoders, and quality options |
| **PeepBoxTV** | 🎬 Movies & 📺 Series | REST API-based provider with search, genre categories, and streaming details |
| **Seda va Sima - Telewebion** | 📺 Live TV | IPTV channels from the official Iranian Telewebion M3U playlist — watch live TV directly in Stremio |

---

## 🔧 Installation

### Install in Stremio

Paste the following URL into Stremio → Community Add-ons → **Install from URL**:

```
https://sip.m17i.xyz/manifest.json
```

> **Note:** An official personal deployment is available at `https://persianstremio.vercel.app/manifest.json`. This is not the official project deployment — see [Deployment](#-deployment) to run your own instance.

### Run Locally

```sh
# 1. Clone the repository
git clone https://github.com/MrMohebi/stremio-ir-providers.git
cd stremio-ir-providers

# 2. Install dependencies
corepack enable
pnpm install

# 3. Copy and configure environment variables
cp .env.example .env
# Edit .env with your provider credentials (see Configuration below)

# 4. Run the addon
pnpm dev
```

The addon will be available at `http://127.0.0.1:7000/manifest.json`.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in the required values:

| Variable | Required | Description |
|---|---|---|
| `CINAMATIC_BASEURL` | ✅ | Cinamatic website base URL |
| `ASLMOVIEZ_BASEURL` | ✅ | AslMoviez website base URL |
| `SERIALBLOG_BASEURL` | ✅ | SerialBlog website base URL |
| `F2MEDIA_BASEURL` | ✅ | F2Media website base URL |
| `PEEPBOXTV_BASEURL` | ✅ | PeepBoxTV API base URL |
| `PEEPBOXTV_USER_ID` | ✅ | PeepBoxTV account user ID |
| `PEEPBOXTV_ANDROID_ID` | ✅ | PeepBoxTV device identifier |
| `PEEPBOXTV_API_KEY` | ✅ | PeepBoxTV API credential |
| `TMDB_API_KEY` | ⬜ | TMDB API key (IMDb ID fallback for some providers) |
| `PROXY_ENABLE` | ⬜ | Set to `true` to proxy metadata images |
| `LOG_LEVEL` | ⬜ | Logging level: `error`, `warn`, `info`, `debug` |

> **Note:** Base URLs should point to the provider's root domain. The `TMDB_API_KEY` improves IMDb ID resolution when providers don't expose it directly.

---

## ☁️ Deployment

### Cloudflare Workers

The addon can run entirely on Cloudflare Workers — no server needed.

```sh
# 1. Authenticate with Cloudflare
npx wrangler login

# 2. Copy secrets file
cp .dev.vars.example .dev.vars
# Fill in .dev.vars with your provider credentials

# 3. Deploy
pnpm worker:deploy
```

Your worker will be available at `https://stremio-ir-providers.<your-subdomain>.workers.dev/manifest.json`.

See [Deploying to Cloudflare Workers](docs/CLOUDFLARE.md) for detailed instructions on secrets, proxy configuration, and local testing.

### Docker

```sh
docker compose up -d
```

The addon runs on port `7000` with an optional proxy on port `3005`.

---

## 🛠️ Development

### Requirements

- **Node.js** >= 24.18.0
- **pnpm** (enable with `corepack enable`)
- A code editor of your choice

### Commands

| Command | Description |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm test` | Run the full test suite |
| `pnpm dev` | Start local development server with file watching |
| `pnpm check` | Run tests + syntax checks |
| `pnpm start` | Start production server |
| `pnpm worker:dev` | Run locally as a Cloudflare Worker |
| `pnpm worker:deploy` | Deploy to Cloudflare Workers |

### Project Structure

```
stremio-ir-providers/
├── app.js                  # Express addon — routing, catalogs, streams, metadata
├── index.js                # Express entry point
├── cloudflare/
│   ├── index.js            # Worker entry point
│   ├── worker.js           # Worker request routing (mirrors app.js)
│   ├── http-client.js      # Fetch-based HTTP client for Workers
│   └── proxy.js            # Worker-native image proxy
├── sources/
│   ├── source.js            # Base Source class
│   ├── html-source.js       # Cheerio-based HTML scraping source
│   ├── cinamatic.js         # Cinamatic provider
│   ├── aslmoviez.js         # AslMoviez provider
│   ├── serialblog.js        # SerialBlog provider
│   ├── f2media.js           # F2Media provider
│   ├── peepboxtv.js         # PeepBoxTV provider (REST API)
│   ├── iptv.js              # IPTV / live TV provider
│   └── digimovie.js         # DigiMovie provider (REST API, experimental)
├── test/                    # Test suite (Node.js built-in test runner)
├── docs/                    # Documentation
└── utils.js                 # Shared utilities (Cinemeta, TMDB, image proxy)
```

### Running Tests

```sh
pnpm test
```

All tests use mock HTTP responses — no external network calls are made during testing.

### Adding a New Provider

See [Adding a New Provider](docs/ADDING-A-PROVIDER.md) for a complete integration guide.

---

## 🏗️ Architecture

### Provider Layer

Each provider extends one of two base classes:

- **`Source`** — for REST API-based providers (PeepBoxTV, DigiMovie, IPTV)
- **`HtmlSource`** — for HTML-scraped providers (Cinamatic, AslMoviez, F2Media)

All providers implement the same interface (`search()`, `getMovieData()`, `getLinks()`) with dependency-injected HTTP client and logger.

### Stream Handling

1. **Catalog Search** → User searches → provider's `search()` returns results → IDs prefixed with addon namespace
2. **Metadata Lookup** → Stremio requests metadata → provider fetches details → IMDb ID resolved via Cinemeta or TMDB
3. **Stream Extraction** → Stremio requests streams → `getMovieData()` fetches detail → `getLinks()` extracts URLs → quality-sorted and returned

For generic IMDb IDs from Stremio's main pages, the addon searches each provider, finds matching content, and returns streams — making the addon work alongside Torrentio and other addons.

### Catalog Types

| Type | Description |
|---|---|
| `movies` | Search-based catalogs (f2media, peepboxtv, cinamatic, aslmoviez) |
| `series` | Same providers, filtered to series only |
| `tv` | Browseable catalogs with pagination (IPTV channels) |

---

## 📸 Screenshots

> Screenshots coming soon. If you'd like to contribute, feel free to open a PR with screenshots showing the addon in action.

---

## ⚠️ Disclaimer

This project is for **educational purposes only**. The addon indexes publicly available content from third-party sources. Users are responsible for complying with applicable laws and the terms of service of any sources they access. The maintainers do not host, store, or distribute any copyrighted content.

---

## 🤝 Contributing

Contributions are welcome! Whether it's adding a new provider, fixing a bug, or improving documentation:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm test` to ensure nothing is broken
5. Submit a Pull Request

---

## 📄 License

This project is open source and available under the [ISC License](https://opensource.org/licenses/ISC).

---

<div align="center">
  <sub>Built with ❤️ for the Stremio community</sub>
</div>
