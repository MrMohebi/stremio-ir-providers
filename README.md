# Stremio IR Provider
A Stremio addon that finds movies and series on Iranian streaming providers.

Also, you can share one account for multiple users without any trouble :)

###### **Update:** We now support Iranian movies and series through PeepboxTV :)

## Install

- Follow the [English installation guide](docs/INSTALL.md).
- Or use the [Persian installation guide](docs/INSTALL-fa.md).

## Usage:
After installing the plugin (https://sip.m17i.xyz/manifest.json), 
search title and results will be available to watch.

## Proxy server
In countries like Iran, where IMDb and Metahub are sanctioned or censored, thumbnails and covers provided by these sources may be inaccessible. If your addon server is hosted outside these restricted regions, this service can automatically proxy all covers and thumbnails through a Proxy Server.

**Enabling the Proxy Feature:**

1. Set `PROXY_ENABLE=true` in `.env`.
2. Set `PROXY_URL` to the public URL of your proxy server.

The other default settings are sufficient for basic usage and should work without additional modifications.
## Supported providers

- [x] DigiMovie
- [x] F2Media
- [x] PeepBoxTV
- [ ] [filmju](https://filmju.com/)
- [ ] [30nama](https://30nama.com)
- [ ] [Download day](https://download-day.com/)

## To Do

- [ ] Display movies and new items from providers on the index page
- [ ] Integrate RPDB for posters
- [ ] Fetch results from IR providers for movies and series on the index page

## Development

Copy `.env.example` to `.env`, fill in the provider credentials, then run:

```sh
nvm use
corepack enable
pnpm install
pnpm test
pnpm dev
```

The addon listens on `http://127.0.0.1:7000` by default. Set `PORT` to override it.

## Cloudflare Workers

The addon and proxy can also run together in one Cloudflare Worker:

```sh
cp .dev.vars.example .dev.vars
pnpm worker:dev
```

Use `pnpm worker:deploy` to publish it. See [Deploying to Cloudflare Workers](docs/CLOUDFLARE.md) for secrets, proxy configuration, local testing, and deployment details. The existing Node.js and Docker deployments remain unchanged.

To integrate another streaming source, see [Adding a New Provider](docs/ADDING-A-PROVIDER.md).
