# Taktbuch Online: API + Oberfläche in einem Image.
# Bauen:  docker build -t taktbuch .

# 1) Oberfläche für das Build-Ziel "online" erzeugen
FROM python:3.13-slim AS web
WORKDIR /src
COPY VERSION REPO.txt build.py ./
COPY packages/core packages/core
COPY packages/web packages/web
RUN TARGET=online python3 build.py

# 2) Laufzeit-Abhängigkeiten der API
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json ./
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# 3) Laufzeit-Image
FROM node:24-slim
ENV NODE_ENV=production \
    WEB_DIR=/app/dist/online \
    PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY packages/core packages/core
COPY packages/api packages/api
COPY --from=web /src/dist/online dist/online
USER 65532:65532
EXPOSE 8080
CMD ["node", "packages/api/src/main.ts"]
