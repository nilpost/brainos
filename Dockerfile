# Dockerfile — portable container for hosting the real brain-tree-os Node app.
# Additive (not part of upstream). Works on Render, Fly.io, Koyeb, or any
# container host. The app needs a persistent Node process (custom server +
# WebSocket + chokidar), so it must NOT be deployed to a serverless/edge host.
#
# Build:  docker build -t brainos .
# Run:    docker run -p 3000:3000 -e PORT=3000 brainos

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BRAIN_PATH=/app/brain
# Copy the built app + production dependencies from the build stage.
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "node deploy/register-brain.mjs && node packages/web/dist/server/custom-server.js"]
