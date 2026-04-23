ARG BASE_IMAGE=opencode-monkeypaw-base:local
FROM ${BASE_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_VERSION=24.4.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends xz-utils \
    && rm -rf /var/lib/apt/lists/*

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN set -euo pipefail; \
    arch=$(uname -m); \
    node_arch=x64; \
    if [ "$arch" = "aarch64" ]; then node_arch=arm64; fi; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    | tar -xJf - -C /usr/local --strip-components=1; \
    npm install -g workerd; \
    node --version; \
    npm --version; \
    workerd --version

WORKDIR /app

COPY packages/opencode/monkeypaw/proxy/main.capnp packages/opencode/monkeypaw/proxy/main.js /app/

CMD ["sh", "-lc", "mkdir -p /sockets/internal /sockets/external && rm -f /sockets/internal/permission-broker.sock /sockets/external/debug-http.sock && umask 000 && exec workerd serve /app/main.capnp config --experimental --socket-addr internalBroker=unix:/sockets/internal/permission-broker.sock --socket-addr externalHttp=unix:/sockets/external/debug-http.sock"]
