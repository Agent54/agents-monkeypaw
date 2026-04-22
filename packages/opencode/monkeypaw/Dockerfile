FROM ubuntu:24.04 AS landlock-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

COPY packages/opencode/monkeypaw/landlock-restrict.c /build/landlock-restrict.c
RUN cc -static -Os -s -o /build/landlock-restrict /build/landlock-restrict.c

FROM ubuntu:24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/home/opencode \
    TMPDIR=/tmp/opencode \
    XDG_CONFIG_HOME=/home/opencode/config \
    XDG_CACHE_HOME=/home/opencode/cache \
    XDG_DATA_HOME=/home/opencode/share \
    XDG_STATE_HOME=/home/opencode/state \
    OPENCODE_CONFIG_DIR=/home/opencode/config/opencode \
    OPENCODE_WORKSPACE_ROOT=/home/opencode/workspaces \
    OPENCODE_WORKTREE_ROOT=/home/opencode/workspaces/worktree \
    OPENCODE_DATA_DIR=/home/opencode/share/opencode \
    OPENCODE_STATE_DIR=/home/opencode/state/opencode \
    OPENCODE_CACHE_DIR=/home/opencode/cache/opencode

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git libgcc-s1 libstdc++6 ripgrep \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build-amd64
COPY dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

FROM base AS build-arm64
COPY dist/opencode-linux-arm64-musl/bin/opencode /usr/local/bin/opencode

ARG TARGETARCH
FROM build-${TARGETARCH}

COPY --from=landlock-builder /build/landlock-restrict /usr/local/bin/landlock-restrict
COPY packages/opencode/monkeypaw/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

RUN groupadd --system opencode \
    && useradd --system --gid opencode --home-dir /home/opencode --create-home --shell /bin/bash opencode \
    && mkdir -p /home/opencode/config/opencode /home/opencode/cache/opencode /home/opencode/share/opencode \
        /home/opencode/state/opencode /home/opencode/workspaces/worktree /tmp/opencode \
    && ln -sfn /home/opencode/workspaces/worktree /home/opencode/share/opencode/worktree \
    && chown -R opencode:opencode /home/opencode /tmp/opencode

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

USER opencode

RUN opencode --version
