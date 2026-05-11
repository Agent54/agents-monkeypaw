#!/bin/sh
set -eu

mkdir -p /sockets/internal /sockets/external /mitm-ca
rm -f /sockets/internal/permission-broker.sock /sockets/external/debug-http.sock

if [ ! -s /mitm-ca/mitmproxy-ca-cert.pem ] || [ ! -s /mitm-ca/mitmproxy-ca.pem ]; then
  openssl genrsa -out /mitm-ca/mitmproxy-ca.pem 2048
  openssl req -x509 -new -nodes -key /mitm-ca/mitmproxy-ca.pem -sha256 -days 3650 \
    -out /mitm-ca/mitmproxy-ca-cert.pem \
    -subj "/CN=opencode-monkeypaw-ca"
fi

if [ ! -s /mitm-ca/workerd-proxy-key.pem ] || [ ! -s /mitm-ca/workerd-proxy-cert.pem ]; then
  openssl genrsa -out /mitm-ca/workerd-proxy-key.pem 2048
  openssl req -new -key /mitm-ca/workerd-proxy-key.pem -out /mitm-ca/workerd-proxy.csr \
    -subj "/CN=proxy"
  cat > /mitm-ca/workerd-proxy.ext <<'EOF'
subjectAltName = DNS:proxy,DNS:localhost,IP:127.0.0.1
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF
  openssl x509 -req -in /mitm-ca/workerd-proxy.csr \
    -CA /mitm-ca/mitmproxy-ca-cert.pem \
    -CAkey /mitm-ca/mitmproxy-ca.pem \
    -CAcreateserial \
    -out /mitm-ca/workerd-proxy-cert.pem \
    -days 825 \
    -sha256 \
    -extfile /mitm-ca/workerd-proxy.ext
fi

cp /mitm-ca/workerd-proxy-key.pem /app/workerd-proxy-key.pem
cp /mitm-ca/workerd-proxy-cert.pem /app/workerd-proxy-cert.pem

umask 000
set -- workerd serve /app/main.capnp config --experimental
if [ "${WORKERD_WATCH:-true}" = "true" ]; then
  set -- "$@" --watch
fi
exec "$@" \
  --socket-addr internalBroker=unix:/sockets/internal/permission-broker.sock \
  --socket-addr externalHttp=unix:/sockets/external/debug-http.sock \
  --socket-addr httpProxy=0.0.0.0:8080 \
  --socket-addr httpsProxy=0.0.0.0:8443 \
  --socket-addr agentHttp=0.0.0.0:4097
