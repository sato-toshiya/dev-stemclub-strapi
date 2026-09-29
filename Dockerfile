# Use Node.js 20 LTS as base image
FROM node:20-alpine AS base

# Install yarn and dependencies
RUN apk add --no-cache libc6-compat

# Set working directory
WORKDIR /app

# Install dependencies only when needed
FROM base AS deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Development stage
FROM base AS development
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 1337
CMD ["yarn", "develop"]

# Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Strapi
RUN yarn build

# Production image, copy all the files and run strapi
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Don't run as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 strapi

# Copy necessary files
COPY --from=builder --chown=strapi:nodejs /app/dist ./dist
COPY --from=builder --chown=strapi:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=strapi:nodejs /app/package.json ./package.json
COPY --from=builder --chown=strapi:nodejs /app/config ./config
COPY --from=builder --chown=strapi:nodejs /app/database ./database
COPY --from=builder --chown=strapi:nodejs /app/public ./public
COPY --from=builder --chown=strapi:nodejs /app/src ./src
COPY --from=builder --chown=strapi:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=strapi:nodejs /app/favicon.png ./favicon.png

# Create uploads directory
RUN mkdir -p /app/public/uploads && chown -R strapi:nodejs /app/public/uploads

USER strapi

EXPOSE 1337

# Start Strapi
CMD ["yarn", "start"]

