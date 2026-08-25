# sqlite-mcp-server is a stdio MCP server: the container's stdin/stdout carry the
# JSON-RPC protocol, not a network port. Run it with `docker run -i` (see README.md
# → Docker), and mount the SQLite file you want to query as a read-only volume.

# --- deps: install once, reused by both the build and runtime stages -------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 compiles a native addon at install time.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- build: compile TypeScript -> dist/ ------------------------------------------
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- prod-deps: same native addon, but without devDependencies -------------------
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime: no compiler toolchain, just node + the compiled addon --------------
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# No default DB_PATH — must be supplied at `docker run` time (see README.md → Docker),
# pointing at wherever the DB volume is mounted inside the container.
ENTRYPOINT ["node", "dist/index.js"]
