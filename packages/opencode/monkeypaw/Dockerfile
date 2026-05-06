# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE=opencode-monkeypaw-base:local
FROM ${BASE_IMAGE} AS ubuntu-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends git socat libgcc-s1 libstdc++6 ripgrep unzip \
    && rm -rf /var/lib/apt/lists/*

FROM ubuntu-base AS ubuntu-build-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

FROM ubuntu-build-base AS landlock-builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

COPY packages/opencode/monkeypaw/landlock-restrict.c /build/landlock-restrict.c
RUN cc -static -Os -s -o /build/landlock-restrict /build/landlock-restrict.c

FROM ubuntu-build-base AS deno-build

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    jq \
    openssh-client \
    pkg-config \
    python3 \
    xz-utils \
    zip \
  && rm -rf /var/lib/apt/lists/*

ARG BUN_VERSION=1.3.11

ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN set -euo pipefail; \
  curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"; \
  printf '#!/bin/sh\nexec bun --bun "$@"\n' > "${BUN_INSTALL}/bin/node"; \
  chmod +x "${BUN_INSTALL}/bin/node"; \
  bun install -g node-gyp; \
  bun --version; \
  node-gyp --version

WORKDIR /src

COPY package.json bun.lock bunfig.toml tsconfig.json turbo.json /src/
COPY patches /src/patches

# Bun validates the frozen lockfile against the full workspace graph from the
# root package.json, so copy every workspace manifest even when monkeypaw only
# builds the opencode package.
COPY packages/app/package.json /src/packages/app/
COPY packages/console/app/package.json /src/packages/console/app/
COPY packages/console/core/package.json /src/packages/console/core/
COPY packages/console/function/package.json /src/packages/console/function/
COPY packages/console/mail/package.json /src/packages/console/mail/
COPY packages/console/resource/package.json /src/packages/console/resource/
COPY packages/desktop/package.json /src/packages/desktop/
COPY packages/desktop-electron/package.json /src/packages/desktop-electron/
COPY packages/enterprise/package.json /src/packages/enterprise/
COPY packages/function/package.json /src/packages/function/
COPY packages/opencode/package.json packages/opencode/tsconfig.json /src/packages/opencode/
COPY packages/opencode/script/fix-node-pty.ts /src/packages/opencode/script/fix-node-pty.ts
COPY packages/plugin/package.json packages/plugin/tsconfig.json /src/packages/plugin/
COPY packages/script/package.json /src/packages/script/
COPY packages/shared/package.json /src/packages/shared/
COPY packages/sdk/js/package.json packages/sdk/js/tsconfig.json /src/packages/sdk/js/
COPY packages/slack/package.json /src/packages/slack/
COPY packages/storybook/package.json /src/packages/storybook/
COPY packages/ui/package.json /src/packages/ui/
COPY packages/web/package.json /src/packages/web/

RUN --mount=type=cache,target=/opt/bun/install/cache,sharing=locked \
  bun install --frozen-lockfile

COPY . /src

RUN --mount=type=cache,target=/opt/bun/install/cache,sharing=locked \
  --mount=type=cache,target=/root/.cache,sharing=locked \
  cd packages/opencode && bun run script/deno-build.ts --single

FROM ubuntu-base

ENV DEBIAN_FRONTEND=noninteractive \
    DENO_INSTALL=/usr/local \
    DENO_AUDIT_PERMISSIONS=/home/opencode/deno-permissions.audit.jsonl \
    DENO_TRACE_PERMISSIONS=1 \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=safe.directory \
    GIT_CONFIG_VALUE_0=* \
    HOME=/stacks \
    TMPDIR=/tmp/opencode \
    DENO_DIR=/home/opencode/cache/deno \
    XDG_CONFIG_HOME=/home/opencode/config \
    XDG_CACHE_HOME=/home/opencode/cache \
    XDG_DATA_HOME=/home/opencode/share \
    XDG_STATE_HOME=/home/opencode/state \
    OPENCODE_APP_ROOT=/home/opencode/app \
    OPENCODE_CONFIG_DIR=/home/opencode/config/opencode \
    OPENCODE_LAUNCH_CWD=/home/opencode/app/dist/deno/src \
    OPENCODE_MOUNT_ROOT=/stacks \
    OPENCODE_TEST_HOME=/stacks \
    OPENCODE_WORKSPACE_ROOT=/stacks/agents/workspaces \
    OPENCODE_WORKTREE_ROOT=/stacks/agents/workspaces/worktree \
    OPENCODE_DATA_DIR=/home/opencode/share/opencode \
    OPENCODE_STATE_DIR=/home/opencode/state/opencode \
    OPENCODE_CACHE_DIR=/home/opencode/cache/opencode

RUN curl -fsSL https://deno.land/install.sh | sh

RUN groupadd --system opencode \
    && useradd --system --gid opencode --home-dir /home/opencode --create-home --shell /bin/bash opencode \
    && mkdir -p /home/opencode/config/opencode /home/opencode/cache/opencode /home/opencode/cache/deno \
        /home/opencode/share/opencode /home/opencode/state/opencode /home/opencode/monkeypaw /stacks/agents/workspaces/worktree /tmp/opencode \
    && ln -sfn /stacks/agents/workspaces/worktree /home/opencode/share/opencode/worktree \
    && chown -R opencode:opencode /home/opencode /tmp/opencode

COPY --from=deno-build --chown=opencode:opencode /src/packages/opencode/deno.jsonc /home/opencode/app/deno.jsonc
COPY --from=deno-build --chown=opencode:opencode /src/packages/opencode/deno-shims /home/opencode/app/deno-shims
COPY --from=deno-build --chown=opencode:opencode /src/packages/opencode/dist/deno /home/opencode/app/dist/deno

USER opencode

RUN set -euo pipefail; \
    node_pty_package="@lydell/node-pty-linux-x64"; \
    if [ "$(uname -m)" = "aarch64" ]; then node_pty_package="@lydell/node-pty-linux-arm64"; fi; \
    cd /home/opencode/app/dist/deno/src \
    && deno cache --quiet --config ../../../deno.jsonc "npm:${node_pty_package}@1.2.0-beta.10" ./index-deno.js

USER root

COPY --from=landlock-builder /build/landlock-restrict /usr/local/bin/landlock-restrict
COPY --chmod=755 packages/opencode/monkeypaw/entrypoint.sh /usr/local/bin/entrypoint.sh

USER opencode

# RUN addgroup -S opencode && adduser -S -G opencode -h /home/opencode -s /bin/sh opencode \
#     && mkdir -p /home/opencode /workspaces /home/opencode/.local/share/opencode /home/opencode/.local/state/opencode \
#     && chown -R opencode:opencode /home/opencode /workspaces

WORKDIR /home/opencode/app/dist/deno/src
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

EXPOSE 4097
CMD ["deno", "run", "--config", "/home/opencode/app/deno.jsonc", "--sloppy-imports", "/home/opencode/app/dist/deno/src/index-deno.js", "--log-level", "DEBUG", "--print-logs", "--port", "4097", "--hostname", "0.0.0.0", "serve"]
