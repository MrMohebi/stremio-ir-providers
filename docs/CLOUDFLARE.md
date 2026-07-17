# Deploying to Cloudflare Workers

The Cloudflare entrypoint serves the complete Stremio addon and the image proxy from one Worker. The existing Node.js, Docker, and standalone proxy commands are unchanged.

## Local development

```sh
corepack enable
pnpm install
cp .dev.vars.example .dev.vars
pnpm worker:dev
```

Fill in `.dev.vars` with the provider configuration you use. Wrangler serves the addon at the URL shown in the terminal; append `/manifest.json` to install it in Stremio.

`.dev.vars` is ignored by Git. Do not commit API keys or provider credentials.

## Deploy

Authenticate Wrangler once:

```sh
pnpm wrangler login
```

Store deployed configuration in `.dev.vars`. Every deploy reads the variable names and values from that file and uploads them as encrypted Worker secrets together with the Worker code:

```sh
pnpm worker:check
pnpm worker:deploy
```

Both commands fail if `.dev.vars` is missing or malformed. `worker:check` performs a dry run, while `worker:deploy` updates the secrets and code atomically. Variables present in both `.dev.vars` and `wrangler.jsonc` use the local `.dev.vars` value for that deployment.

To synchronize every non-empty value separately, run:

```sh
pnpm worker:secrets
```

The variable names are discovered from `.dev.vars`; the script has no hard-coded allowlist. You can preview the names without uploading their values with `pnpm worker:secrets -- --dry-run`.

Alternatively, set each secret interactively:

```sh
pnpm wrangler secret put TMDB_API_KEY
pnpm wrangler secret put F2MEDIA_BASEURL
pnpm wrangler secret put PEEPBOXTV_BASEURL
pnpm wrangler secret put PEEPBOXTV_USER_ID
pnpm wrangler secret put PEEPBOXTV_ANDROID_ID
pnpm wrangler secret put PEEPBOXTV_API_KEY
```

The deployed manifest URL is `https://stremio-ir-providers.<your-subdomain>.workers.dev/manifest.json`, unless you attach a custom domain or rename the Worker in `wrangler.jsonc`.

## Enable the built-in proxy

In `wrangler.jsonc`, set `PROXY_ENABLE` to `true`. The Worker automatically uses its current public origin, so `PROXY_URL` is normally unnecessary. Set `PROXY_URL` only when proxy traffic should use a different public hostname.

`PROXY_ALLOWED_URLS` is a comma-separated allowlist. A hostname must exactly match an entry or be its subdomain. Add any provider image host that is not covered by the defaults; do not use an unrestricted or user-controlled domain.

The proxy route defaults to:

```text
/proxy?url=https%3A%2F%2Fallowed.example%2Fimage.jpg
```

It accepts only HTTP(S), checks every redirect against the allowlist, limits responses to 10 MB, and forwards the upstream `Content-Type` and `Cache-Control` headers.

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `F2MEDIA_BASEURL` | F2Media website base URL |
| `TMDB_API_KEY` | TMDB fallback when F2Media has no IMDb ID |
| `PEEPBOXTV_BASEURL` | PeepBoxTV API base URL |
| `PEEPBOXTV_USER_ID` | PeepBoxTV account user ID |
| `PEEPBOXTV_ANDROID_ID` | PeepBoxTV device ID |
| `PEEPBOXTV_API_KEY` | PeepBoxTV API credential |
| `DEV_MODE` | Adds `- DEV` to catalog and addon names when `true` |
| `LOG_LEVEL` | `error`, `warn`, `info`, or `debug` |
| `PROXY_ENABLE` | Rewrites metadata artwork through the Worker proxy |
| `PROXY_URL` | Optional external proxy origin |
| `PROXY_PATH` | Proxy route name; defaults to `proxy` |
| `PROXY_ALLOWED_URLS` | Comma-separated proxy hostname allowlist |

Cloudflare configuration is in `wrangler.jsonc`. Its `nodejs_compat` flag supports dependencies used by the provider parsers, while incoming requests and proxy requests use the Worker-native Fetch API.
