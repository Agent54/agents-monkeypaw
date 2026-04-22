FROM ubuntu:24.04 AS landlock-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

COPY packages/opencode/monkeypaw/landlock-restrict.c /build/landlock-restrict.c
RUN cc -static -Os -s -o /build/landlock-restrict /build/landlock-restrict.c

FROM ubuntu:24.04 AS deno-build

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    jq \
    openssh-client \
    pkg-config \
    python3 \
    unzip \
    xz-utils \
    zip \
  && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-lc"]

ARG NODE_VERSION=24.4.0
ARG BUN_VERSION=1.3.11

ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN set -euo pipefail; \
  arch=$(uname -m); \
  node_arch=x64; \
  if [ "$arch" = "aarch64" ]; then node_arch=arm64; fi; \
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
  | tar -xJf - -C /usr/local --strip-components=1; \
  corepack enable

RUN set -euo pipefail; \
  curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"; \
  bun --version; \
  node --version; \
  npm --version

WORKDIR /src

COPY . /src

RUN bun install --frozen-lockfile
RUN cd packages/opencode && bun run script/deno-build.ts --single

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    DENO_INSTALL=/usr/local \
    HOME=/home/opencode \
    TMPDIR=/tmp/opencode \
    DENO_DIR=/home/opencode/cache/deno \
    XDG_CONFIG_HOME=/home/opencode/config \
    XDG_CACHE_HOME=/home/opencode/cache \
    XDG_DATA_HOME=/home/opencode/share \
    XDG_STATE_HOME=/home/opencode/state \
    OPENCODE_APP_ROOT=/home/opencode/app/packages/opencode \
    OPENCODE_CONFIG_DIR=/home/opencode/config/opencode \
    OPENCODE_WORKSPACE_ROOT=/home/opencode/workspaces \
    OPENCODE_WORKTREE_ROOT=/home/opencode/workspaces/worktree \
    OPENCODE_DATA_DIR=/home/opencode/share/opencode \
    OPENCODE_STATE_DIR=/home/opencode/state/opencode \
    OPENCODE_CACHE_DIR=/home/opencode/cache/opencode

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git libgcc-s1 libstdc++6 ripgrep unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deno.land/install.sh | sh

COPY --from=landlock-builder /build/landlock-restrict /usr/local/bin/landlock-restrict
COPY packages/opencode/monkeypaw/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=deno-build /src/packages/opencode/deno.jsonc /home/opencode/app/packages/opencode/deno.jsonc
COPY --from=deno-build /src/packages/opencode/deno-shims /home/opencode/app/packages/opencode/deno-shims
COPY --from=deno-build /src/packages/opencode/dist/deno /home/opencode/app/packages/opencode/dist/deno

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && groupadd --system opencode \
    && useradd --system --gid opencode --home-dir /home/opencode --create-home --shell /bin/bash opencode \
    && mkdir -p /home/opencode/config/opencode /home/opencode/cache/opencode /home/opencode/cache/deno \
        /home/opencode/share/opencode /home/opencode/state/opencode /home/opencode/workspaces/worktree /tmp/opencode \
    && ln -sfn /home/opencode/workspaces/worktree /home/opencode/share/opencode/worktree \
    && chown -R opencode:opencode /home/opencode /tmp/opencode

USER opencode

RUN deno cache --quiet --config /home/opencode/app/packages/opencode/deno.jsonc /home/opencode/app/packages/opencode/dist/deno/src/index-deno.js

WORKDIR /home/opencode/workspaces
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["deno", "run", "--config", "/home/opencode/app/packages/opencode/deno.jsonc", "--allow-run=git,rg", "--deny-run=open,deno", "--allow-env", "--allow-ffi", "--allow-sys", "--allow-read=/home/opencode/app,/home/opencode/config,/home/opencode/share,/home/opencode/state,/home/opencode/cache,/home/opencode/workspaces,/tmp/opencode,/usr,/bin,/sbin,/lib,/lib64", "--allow-write=/home/opencode/share/opencode,/home/opencode/state/opencode,/home/opencode/cache/opencode,/home/opencode/cache/deno,/home/opencode/workspaces,/tmp/opencode", "--allow-net=models.dev:443,0.0.0.0:4097,opencode.ai:443,104.16.7.34:443", "--sloppy-imports", "/home/opencode/app/packages/opencode/dist/deno/src/index-deno.js", "--log-level", "DEBUG", "--print-logs", "--port", "4097", "--hostname", "0.0.0.0"]
