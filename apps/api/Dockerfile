# ── Etapa 1: Construcción ─────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Instala dependencias primero (aprovecha caché de Docker)
COPY package*.json ./
RUN npm ci

# Copia el código fuente y compila TypeScript
COPY . .
RUN npm run build

# ── Etapa 2: Imagen de producción ─────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Solo dependencias de producción
COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# Copia el código compilado desde la etapa de construcción
COPY --from=builder /app/dist ./dist

EXPOSE 3001

# Healthcheck interno
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/main.js"]
