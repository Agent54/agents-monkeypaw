#!/bin/bash
set -euo pipefail

readonly workspace_root="${OPENCODE_WORKSPACE_ROOT:-/home/opencode/workspaces}"
readonly worktree_root="${OPENCODE_WORKTREE_ROOT:-${workspace_root}/worktree}"
readonly data_dir="${OPENCODE_DATA_DIR:-/home/opencode/share/opencode}"
readonly state_dir="${OPENCODE_STATE_DIR:-/home/opencode/state/opencode}"
readonly cache_dir="${OPENCODE_CACHE_DIR:-/home/opencode/cache/opencode}"
readonly temp_dir="${TMPDIR:-/tmp/opencode}"
readonly deno_dir="${DENO_DIR:-/home/opencode/cache/deno}"
readonly app_root="${OPENCODE_APP_ROOT:-/home/opencode/app/packages/opencode}"
readonly launch_cwd="${OPENCODE_LAUNCH_CWD:-$app_root/dist/deno}"
readonly audit_file="${DENO_AUDIT_PERMISSIONS:-/home/opencode/deno-permissions.audit.jsonl}"
readonly broker_socket="${DENO_PERMISSION_BROKER_PATH:-/home/opencode/monkeypaw/permission-broker.sock}"
readonly global_config_dir="${XDG_CONFIG_HOME:-/home/opencode/config}/opencode"
export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/home/opencode/config/opencode}"
export DENO_AUDIT_PERMISSIONS="${DENO_AUDIT_PERMISSIONS:-$audit_file}"
export DENO_TRACE_PERMISSIONS="${DENO_TRACE_PERMISSIONS:-1}"
export DENO_PERMISSION_BROKER_PATH="${DENO_PERMISSION_BROKER_PATH:-$broker_socket}"

require_dir() {
  if [ -d "$1" ]; then
    return
  fi
  echo "[security] missing directory: $1" >&2
  exit 1
}

require_writable_dir() {
  require_dir "$1"
  if [ -w "$1" ]; then
    return
  fi
  echo "[security] directory is not writable: $1" >&2
  exit 1
}

require_socket() {
  if [ -S "$1" ]; then
    return
  fi
  echo "[security] missing unix socket: $1" >&2
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

prepare_runtime() {
  require_writable_dir "$workspace_root"
  mkdir -p "$worktree_root"
  require_writable_dir "$worktree_root"
  require_writable_dir "$data_dir"
  require_writable_dir "$state_dir"
  require_writable_dir "$cache_dir"
  require_writable_dir "$deno_dir"
  require_writable_dir "$temp_dir"
  touch "$audit_file"
  require_socket "$broker_socket"
  require_dir "$global_config_dir"
  require_dir "$OPENCODE_CONFIG_DIR"
  require_dir "$app_root"
  require_dir "$launch_cwd"
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
  local rw=("$workspace_root" "$OPENCODE_CONFIG_DIR" "$global_config_dir" "$data_dir" "$state_dir" "$cache_dir" "$deno_dir" "$temp_dir" "$audit_file" "$broker_socket")

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

  append_if_exists rw /dev/null
  append_if_exists rw /dev/urandom
  append_if_exists rw /dev/random
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

echo "[security] OpenCode secure entrypoint starting"
echo "[security] PID=$$ UID=$(id -u) GID=$(id -g)"

apply_resource_limits
prepare_runtime
cd "$launch_cwd"

if [ "${LANDLOCK_ENABLED:-true}" != "true" ]; then
  echo "[security] Landlock disabled via LANDLOCK_ENABLED=false"
  exec "$@"
fi

apply_landlock "$@"
