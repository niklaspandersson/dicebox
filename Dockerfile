# Stage 1: Build frontend assets
FROM node:24.0.2-slim AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source files needed for build
COPY public/ ./public/
COPY vite.config.js ./

# Build frontend assets with Vite
# Set VITE_BASE=/ since app is served at root
RUN VITE_BASE=/ npm run build

# Stage 2: Production image
FROM node:24.0.2-slim

# Create non-root user for security
RUN groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server files
COPY server.js ./
COPY state-storage.js ./
COPY logger.js ./

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist/

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

EXPOSE 3000

# Health check - verify server is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
