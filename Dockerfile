FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/MrMohebi/stremio-ir-providers"

ENV NODE_ENV=production
WORKDIR /home/node/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

USER node
EXPOSE 7000 3005

CMD ["npm", "run", "start"]
