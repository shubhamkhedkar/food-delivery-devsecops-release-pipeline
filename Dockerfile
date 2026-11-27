# syntax=docker/dockerfile:1.7
# Stage 1: install the exact lockfile, then lint, test (coverage gate) and build the SPA.
# An image can only be produced from code that passes its own quality gates.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS verify
WORKDIR /src
ENV CI=true NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
COPY app/package.json app/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit
COPY app/ ./
RUN npm run lint && npm test && npm run build

# Stage 2: distroless runtime with no shell or package manager, running as UID 65532.
# The API server has zero npm dependencies, so node_modules never reaches this image.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:675c532423b908f9e56f9d60a4e62309b63cd2a3175acb90a46b96f7ee68e121
ARG APP_VERSION=1.0.0
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.title="platewise" \
      org.opencontainers.image.description="Restaurant discovery and food ordering (React SPA + hardened Node.js API)" \
      org.opencontainers.image.source="https://github.com/shubhamkhedkar/food-delivery-devsecops-release-pipeline" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    APP_VERSION=${APP_VERSION} \
    GIT_COMMIT=${GIT_COMMIT}
WORKDIR /app
COPY --from=verify --chown=0:0 /src/package.json ./package.json
COPY --from=verify --chown=0:0 /src/src/server ./src/server
COPY --from=verify --chown=0:0 /src/dist ./public
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/src/server/healthcheck.js"]
ENTRYPOINT ["/nodejs/bin/node", "/app/src/server/server.js"]
