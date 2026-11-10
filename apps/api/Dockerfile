# ── Etapa 1: Construcción ─────────────────────────────────────────────────
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS builder

WORKDIR /app

# Alpine no siempre incluye el conjunto de autoridades raíz necesario para npm.
RUN --mount=type=secret,id=build_ca,target=/etc/apk/ca.pem \
    apk add --no-cache ca-certificates && update-ca-certificates

# Instala dependencias primero (aprovecha caché de Docker)
COPY package*.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -r /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund

# Copia el código fuente y compila TypeScript
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── Etapa 2: Imagen de producción ─────────────────────────────────────────
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS runner

WORKDIR /app

RUN --mount=type=secret,id=build_ca,target=/etc/apk/ca.pem \
    apk add --no-cache ca-certificates && update-ca-certificates

# Solo dependencias de producción
COPY package*.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -r /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Copia el código compilado desde la etapa de construcción
COPY --from=builder /app/dist ./dist

EXPOSE 3001

# Healthcheck interno
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/main.js"]
