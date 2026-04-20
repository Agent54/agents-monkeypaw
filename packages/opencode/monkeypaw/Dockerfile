FROM alpine:3.23 AS landlock-builder
RUN apk add libgcc libstdc++ ripgrep
RUN apk add --no-cache gcc musl-dev linux-headers
COPY landlock-restrict.c /build/landlock-restrict.c
RUN gcc -static -O2 -o /build/landlock-restrict /build/landlock-restrict.c

FROM base

# Alpine-based image — use apk
RUN apk add --no-cache bash libcap curl git gcompat

COPY --from=landlock-builder /build/landlock-restrict /usr/local/bin/landlock-restrict

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

RUN addgroup -S opencode && adduser -S -G opencode -h /home/opencode -s /bin/sh opencode \
    && mkdir -p /home/opencode /stacks/agents/workspaces /home/opencode/.local/share/opencode /home/opencode/.local/state/opencode \
    && chown -R opencode:opencode /home/opencode /stacks/agents/workspaces

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

USER opencode

RUN opencode --version
