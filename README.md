> ایشالا بعد اجیاری درستش میکنم ❤️.

# Stremio IR Provide
A plugin for Stremio to stream movies and series from Iranian providers like 30nama or avamovie. 

Also, you can share one account for multiple users without any trouble :)

###### **Update:** We now support Iranian movies and series through PeepboxTV :)

## Install:
- fallow this [install guide - English](docs/INSTALL.md)
- or for Persian version fallow [آموزش نصب فارسی](docs/INSTALL-fa.md)

## Usage:
After installing the plugin (https://sip.m17i.xyz/manifest.json), 
search title and results will be available to watch.

## proxy server:
In countries like Iran, where IMDb and Metahub are sanctioned or censored, thumbnails and covers provided by these sources may be inaccessible. If your addon server is hosted outside these restricted regions, this service can automatically proxy all covers and thumbnails through a Proxy Server.

**Enabling the Proxy Feature:**

1. To enable this feature, set [PROXY_ENABLE](./.env.example#L11) to true.
2. Specify the public URL endpoint of your proxy server by setting [PROXY_URL](./.env.example#L11).

The other default settings are sufficient for basic usage and should work without additional modifications.
## Supported provides:

- [x] [Avamovie](https://avamovie.shop)
- [x] [peepboxtv](https://peepboxtv.me)
- [ ] [filmju](https://filmju.com/)
- [ ] [30nama](https://30nama.com)
- [ ] [Download day](https://download-day.com/)

## To Do

- [ ] Display movies and new items from providers on the index page
- [ ] Integrate RPDB for posters
- [ ] Fetch results from IR providers for movies and series on the index page
