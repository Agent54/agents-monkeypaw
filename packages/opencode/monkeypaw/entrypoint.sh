#!/bin/bash
set -euo pipefail

readonly workspace_root="${OPENCODE_WORKSPACE_ROOT:-/stacks/agents/workspaces}"
readonly worktree_root="${OPENCODE_WORKTREE_ROOT:-${workspace_root}/worktree}"
readonly data_dir="${OPENCODE_DATA_DIR:-/home/opencode/share/opencode}"
readonly state_dir="${OPENCODE_STATE_DIR:-/home/opencode/state/opencode}"
readonly cache_dir="${OPENCODE_CACHE_DIR:-/home/opencode/cache/opencode}"
readonly temp_dir="${TMPDIR:-/tmp/opencode}"
readonly deno_dir="${DENO_DIR:-/home/opencode/cache/deno}"
readonly app_root="${OPENCODE_APP_ROOT:-/home/opencode/app/packages/opencode}"
readonly launch_cwd="${OPENCODE_LAUNCH_CWD:-$app_root/dist/deno}"
readonly mount_root="${OPENCODE_MOUNT_ROOT:-/stacks}"
readonly audit_file="${DENO_AUDIT_PERMISSIONS:-/home/opencode/deno-permissions.audit.jsonl}"
readonly broker_socket="${DENO_PERMISSION_BROKER_PATH:-/home/opencode/monkeypaw/permission-broker.sock}"
readonly broker_socket_dir="$(dirname "$broker_socket")"
readonly global_config_dir="${XDG_CONFIG_HOME:-/home/opencode/config}/opencode"
readonly runtime_cwd="$(pwd -P)"
export HOME="${HOME:-$mount_root}"
export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/home/opencode/config/opencode}"
export OPENCODE_TEST_HOME="${OPENCODE_TEST_HOME:-$mount_root}"
if [ -z "${OPENCODE_CONFIG_CONTENT:-}" ]; then
  export OPENCODE_CONFIG_CONTENT='{"username":"opencode"}'
else
  export OPENCODE_CONFIG_CONTENT
fi
export DENO_AUDIT_PERMISSIONS="${DENO_AUDIT_PERMISSIONS:-$audit_file}"
export DENO_TRACE_PERMISSIONS="${DENO_TRACE_PERMISSIONS:-1}"
export DENO_PERMISSION_BROKER_PATH="${DENO_PERMISSION_BROKER_PATH:-$broker_socket}"

require_dir() {
  if [ -d "$1" ]; then
    return
  fi
  echo "[security] missing directory: $1" >&2
  ls -ldn "$1" "$(dirname "$1")" >&2 || true
  exit 1
}

require_writable_dir() {
  require_dir "$1"
  if [ -w "$1" ]; then
    return
  fi
  echo "[security] directory is not writable: $1" >&2
  ls -ldn "$1" >&2 || true
  mount | grep " /stacks " >&2 || true
  exit 1
}

require_socket() {
  if [ -S "$1" ]; then
    return
  fi
  echo "[security] missing unix socket: $1" >&2
  exit 1
}

broker_socket_accepts() {
  socat -T 1 -u OPEN:/dev/null "UNIX-CONNECT:$broker_socket" >/dev/null 2>&1
}

wait_for_broker_socket() {
  local deadline
  deadline=$((SECONDS + ${BROKER_SOCKET_READY_TIMEOUT:-60}))

  while [ "$SECONDS" -le "$deadline" ]; do
    if [ -S "$broker_socket" ] && broker_socket_accepts; then
      return
    fi
    sleep "${BROKER_SOCKET_READY_INTERVAL:-1}"
  done

  echo "[security] permission broker socket is not accepting connections: $broker_socket" >&2
  ls -ldn "$broker_socket" "$(dirname "$broker_socket")" >&2 || true
  exit 1
}

join_paths() {
  local -n paths=$1
  local IFS=:
  echo "${paths[*]}"
}

append_if_exists() {
  local -n paths=$1
  if [ -e "$2" ]; then
    paths+=("$2")
  fi
}

apply_resource_limits() {
  ulimit -n 4096 2>/dev/null || true
  ulimit -u 256 2>/dev/null || true
  ulimit -f 1048576 2>/dev/null || true
}

prepare_proxy_environment() {
  local proxy_url="${MONKEYPAW_PROXY_URL:-http://proxy:8080}"
  local no_proxy_value="${NO_PROXY:-${no_proxy:-agent,proxy,mcp-everything,localhost,127.0.0.1}}"

  export HTTP_PROXY="${HTTP_PROXY:-$proxy_url}"
  export HTTPS_PROXY="${HTTPS_PROXY:-$proxy_url}"
  export ALL_PROXY="${ALL_PROXY:-$proxy_url}"
  if [ "$HTTPS_PROXY" = "https://proxy:8443" ]; then
    export HTTPS_PROXY="$proxy_url"
  fi
  export http_proxy="${http_proxy:-$HTTP_PROXY}"
  export https_proxy="${https_proxy:-$HTTPS_PROXY}"
  export all_proxy="${all_proxy:-$ALL_PROXY}"
  if [ "$https_proxy" = "https://proxy:8443" ]; then
    export https_proxy="$proxy_url"
  fi
  case ",$no_proxy_value," in
    *,proxy,*) ;;
    *) no_proxy_value="proxy,$no_proxy_value" ;;
  esac
  case ",$no_proxy_value," in
    *,agent,*) ;;
    *) no_proxy_value="agent,$no_proxy_value" ;;
  esac
  case ",$no_proxy_value," in
    *,mcp-everything,*) ;;
    *) no_proxy_value="mcp-everything,$no_proxy_value" ;;
  esac
  export NO_PROXY="$no_proxy_value"
  export no_proxy="$NO_PROXY"
}

prepare_ca_bundle() {
  local system_bundle="/etc/ssl/certs/ca-certificates.crt"
  local monkeypaw_ca="/mitm-ca/mitmproxy-ca-cert.pem"
  local bundle="$temp_dir/ca-certificates-with-monkeypaw.pem"

  if [ ! -s "$system_bundle" ]; then
    return
  fi

  if [ -s "$monkeypaw_ca" ]; then
    cat "$system_bundle" "$monkeypaw_ca" > "$bundle"
  else
    cp "$system_bundle" "$bundle"
  fi

  export CURL_CA_BUNDLE="$bundle"
  export SSL_CERT_FILE="$bundle"
  export REQUESTS_CA_BUNDLE="$bundle"
  export GIT_SSL_CAINFO="$bundle"
  export DENO_CERT="$bundle"
  export NODE_EXTRA_CA_CERTS="$bundle"
}

prepare_runtime() {
  mkdir -p "$temp_dir"
  require_writable_dir "$mount_root"
  require_writable_dir "$workspace_root"
  require_writable_dir "$worktree_root"
  require_writable_dir "$data_dir"
  require_writable_dir "$state_dir"
  require_writable_dir "$cache_dir"
  require_writable_dir "$deno_dir"
  require_writable_dir "$temp_dir"
  touch "$audit_file"
  require_dir "$broker_socket_dir"
  require_socket "$broker_socket"
  wait_for_broker_socket
  require_dir "$global_config_dir"
  require_dir "$OPENCODE_CONFIG_DIR"
  require_dir "$app_root"
  require_dir "$launch_cwd"
  require_dir "$runtime_cwd"
  if [ ! -e "$data_dir/worktree" ]; then
    ln -s "$worktree_root" "$data_dir/worktree"
    return
  fi
  if [ "$(readlink "$data_dir/worktree" 2>/dev/null || true)" = "$worktree_root" ]; then
    return
  fi
  echo "[security] expected $data_dir/worktree -> $worktree_root" >&2
  exit 1
}

apply_landlock() {
  local rx=()
  local ro=("$app_root")
  local rw=("$mount_root" "$runtime_cwd" "$workspace_root" "$OPENCODE_CONFIG_DIR" "$global_config_dir" "$data_dir" "$state_dir" "$cache_dir" "$deno_dir" "$temp_dir" "$audit_file" "$broker_socket_dir")

  append_if_exists rx /usr
  append_if_exists rx /bin
  append_if_exists rx /sbin
  append_if_exists rx /lib
  append_if_exists rx /lib64

  append_if_exists ro /home/opencode
  append_if_exists ro /etc/ssl
  append_if_exists ro /etc/ca-certificates
  append_if_exists ro /etc/profile
  append_if_exists ro /etc/bash.bashrc
  append_if_exists ro /etc/resolv.conf
  append_if_exists ro /etc/hosts
  append_if_exists ro /etc/nsswitch.conf
  append_if_exists ro /etc/passwd
  append_if_exists ro /etc/group
  append_if_exists ro /etc/ld.so.cache
  append_if_exists ro /etc/ld.so.conf
  append_if_exists ro /etc/ld.so.conf.d
  append_if_exists ro /etc/ld-musl-x86_64.path
  append_if_exists ro /etc/ld-musl-aarch64.path
  append_if_exists ro /mitm-ca
  append_if_exists ro /dev/urandom
  append_if_exists ro /dev/random

  append_if_exists rw /dev/null
  append_if_exists rw /dev/tty
  append_if_exists rw /dev/ptmx
  append_if_exists rw /dev/pts
  append_if_exists rw /dev/pts/ptmx

  export LANDLOCK_RX="$(join_paths rx)"
  export LANDLOCK_RO="$(join_paths ro)"
  export LANDLOCK_RW="$(join_paths rw)"

  local abi
  abi="$(/usr/local/bin/landlock-restrict --check)"
  echo "[security] Landlock ABI ${abi}"
  exec /usr/local/bin/landlock-restrict "$@"
}

socket_identity() {
  stat -c '%d:%i' "$broker_socket" 2>/dev/null || true
}

supervise_broker_socket() {
  local child="$1"
  local identity="$2"

  while kill -0 "$child" 2>/dev/null; do
    sleep "${BROKER_SOCKET_WATCH_INTERVAL:-1}"
    if [ -S "$broker_socket" ] && [ "$(socket_identity)" = "$identity" ] && broker_socket_accepts; then
      continue
    fi
    echo "[security] permission broker socket changed or stopped accepting; restarting agent" >&2
    kill -TERM "$child" 2>/dev/null || true
    sleep 2
    kill -KILL "$child" 2>/dev/null || true
    exit 42
  done
}

run_supervised() {
  wait_for_broker_socket

  local identity
  identity="$(socket_identity)"
  if [ -z "$identity" ]; then
    echo "[security] cannot identify permission broker socket: $broker_socket" >&2
    exit 1
  fi

  "$@" &
  local child=$!
  supervise_broker_socket "$child" "$identity" &
  local watcher=$!

  set +e
  wait "$child"
  local status=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  exit "$status"
}

echo "[security] OpenCode secure entrypoint starting"
echo "[security] PID=$$ UID=$(id -u) GID=$(id -g)"

if [ "${1:-}" = "--supervised" ]; then
  shift
  run_supervised "$@"
fi

apply_resource_limits
prepare_proxy_environment
prepare_runtime
prepare_ca_bundle
cd "$launch_cwd"

if [ "${LANDLOCK_ENABLED:-true}" != "true" ]; then
  echo "[security] Landlock disabled via LANDLOCK_ENABLED=false"
  run_supervised "$@"
fi

apply_landlock /usr/local/bin/entrypoint.sh --supervised "$@"
