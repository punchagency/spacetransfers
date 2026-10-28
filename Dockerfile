# Space Transfers API. Node 26, the version the code is tested on.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The one-off scripts in the README (create-admin, the webhook setups) run from here.
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh && mkdir -p uploads && chown -R node:node /app
EXPOSE 4000
# Starts as root only to hand the uploads disk to the app's user; see the entrypoint.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
