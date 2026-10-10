FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data ALLOW_INSECURE_HTTP=false
LABEL org.opencontainers.image.title="Command Table" \
      org.opencontainers.image.description="A Magic life counter for one device or shared rooms" \
      org.opencontainers.image.source="https://github.com/Addison16/commanders-table" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0" \
      net.unraid.docker.icon="https://raw.githubusercontent.com/Addison16/command-table/main/public/icon-512.png" \
      net.unraid.docker.webui="http://[IP]:[PORT:8080]/"
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/LICENSE ./LICENSE
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts/backup.mjs ./scripts/backup.mjs
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/server/index.js"]
