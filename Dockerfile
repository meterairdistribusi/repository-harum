# Satu container berisi backend + panel admin + versi web aplikasi pelanggan (untuk prototype)
FROM node:22-slim AS web
WORKDIR /src/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci
COPY mobile/ ./
RUN npx expo export -p web --output-dir /out/app

FROM node:22-slim
ENV NODE_ENV=production TZ=Asia/Jakarta PORT=4000
WORKDIR /srv/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=web /out/app ./public/app
EXPOSE 4000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
