# FRONT-END HOSPITAL — production image
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so this layer caches between code changes.
COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# Snapshots survive a container restart only if this is a mounted volume.
RUN mkdir -p /app/.data
ENV DATA_DIR=/app/.data
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
