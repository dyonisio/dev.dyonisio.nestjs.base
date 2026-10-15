# syntax=docker/dockerfile:1.7
#
# Imagem de produção da API (ECS, Railway, Fly.io, uma VM...). A mesma base de código
# continua indo para a Lambda via `npm run deploy` — este arquivo é a alternativa em container.
#
#   docker build -t nestjs-base-api .
#   docker run --env-file .env -p 3000:3000 nestjs-base-api
#
# Migrations (rode antes de subir a nova versão — no ECS, como uma task avulsa):
#   docker run --env-file .env nestjs-base-api npm run migration:run:prod

# ---------- 1) dependências (com as de desenvolvimento, para compilar) ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---------- 2) build ----------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build \
  # remove as devDependencies: só o necessário para rodar vai para a imagem final
  && npm prune --omit=dev --ignore-scripts

# ---------- 3) runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# tini: repassa sinais (SIGTERM do ECS) ao Node — encerramento gracioso de conexões
RUN apk add --no-cache tini

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Certificados extras (ex.: CA do RDS para TLS conferido com o banco: DB_SSL_CA_FILE=certs/...)
COPY --chown=node:node certs ./certs

# Nunca rodar como root
USER node

EXPOSE 3000

# Usado pelo Docker/ECS para saber se o container está saudável (API + banco)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
