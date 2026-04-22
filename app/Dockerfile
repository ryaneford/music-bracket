FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p data

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app /app
RUN apk add --no-cache python3 make g++ && \
    npm rebuild better-sqlite3 2>/dev/null || true
EXPOSE 3000
VOLUME /app/data
CMD ["node", "server.js"]