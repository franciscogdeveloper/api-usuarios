# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Imagen de producción multi-stage: las etapas de compilación (con devDependencies,
# TypeScript, etc.) se descartan y la imagen final solo lleva lo imprescindible.
# ---------------------------------------------------------------------------

# Base común. Usamos Debian slim (glibc) y no alpine (musl): Prisma y argon2
# traen binarios nativos precompilados para glibc y evitamos problemas de
# compatibilidad. openssl lo necesita el motor de Prisma para detectar la
# librería TLS. --no-install-recommends y limpiar /var/lib/apt/lists reducen
# el tamaño de la capa.
FROM node:24-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 1) deps: todas las dependencias (dev incluidas) para poder compilar.
# Se copian solo package*.json y prisma/ primero: mientras no cambien, Docker
# reutiliza esta capa en caché y no reinstala en cada cambio de código.
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# 2) build: genera el cliente de Prisma y compila TypeScript a dist/.
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# 3) prod-deps: solo dependencias de producción (sin TypeScript, vitest, etc.).
# El CLI de prisma está en "dependencies" porque el contenedor ejecuta
# `prisma migrate deploy` al arrancar.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# 4) runtime: imagen final.
FROM base AS runtime
ENV NODE_ENV=production
# package.json es necesario: contiene "type": "module" (ESM) y los scripts.
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --chmod=755 docker-entrypoint.sh ./

# Sin root: si alguien explota la app, no tiene privilegios en el contenedor.
USER node
EXPOSE 3000

# Docker marca el contenedor como healthy/unhealthy consultando /api/health
# (que a su vez comprueba la base de datos). Node 24 trae fetch, no hace falta curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# El entrypoint aplica las migraciones y luego arranca la app (con exec, para
# que Node sea el proceso principal y reciba las señales de parada).
ENTRYPOINT ["./docker-entrypoint.sh"]
