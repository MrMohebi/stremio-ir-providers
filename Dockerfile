FROM node:24.18-alpine
LABEL org.opencontainers.image.source="https://github.com/MrMohebi/stremio-ir-providers"

ENV NODE_ENV=production
WORKDIR /home/node/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY --chown=node:node . .

USER node
EXPOSE 7000 3005

CMD ["pnpm", "start"]
