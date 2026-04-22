FROM ubuntu:24.04 AS landlock-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

COPY monkeypaw/landlock-restrict.c /build/landlock-restrict.c
RUN cc -static -Os -s -o /build/landlock-restrict /build/landlock-restrict.c

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

RUN curl -fsSL https://deno.land/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

COPY --from=landlock-builder /build/landlock-restrict /usr/local/bin/landlock-restrict
COPY monkeypaw/entrypoint.sh /usr/local/bin/entrypoint.sh

COPY deno.jsonc /home/opencode/app/packages/opencode/deno.jsonc
COPY bun-global.ts /home/opencode/app/packages/opencode/bun-global.ts
COPY bun-shim.ts /home/opencode/app/packages/opencode/bun-shim.ts
COPY bun-ffi-shim.ts /home/opencode/app/packages/opencode/bun-ffi-shim.ts
COPY bun-pty-shim.ts /home/opencode/app/packages/opencode/bun-pty-shim.js
COPY bun-sqlite-shim.ts /home/opencode/app/packages/opencode/bun-sqlite-shim.ts
COPY fs-promises-shim.ts /home/opencode/app/packages/opencode/fs-promises-shim.ts
COPY hono-deno.ts /home/opencode/app/packages/opencode/hono-deno.ts
COPY dist/deno /home/opencode/app/packages/opencode/dist/deno

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
