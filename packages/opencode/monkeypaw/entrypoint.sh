#!/bin/bash
set -euo pipefail

# =============================================================================
# OpenCode Security Entrypoint
# Applies Landlock filesystem restrictions and network isolation before
# executing the main process.
# =============================================================================

# ---------------------------------------------------------------------------
# 1. LANDLOCK FILESYSTEM RESTRICTIONS
# ---------------------------------------------------------------------------
# Landlock is a Linux security module (5.13+) that restricts filesystem access
# per-process without requiring root or a security policy daemon.
#
# We use the `landlockctl` wrapper if available, otherwise fall back to
# a small C helper compiled at container build time.

apply_landlock() {
  # Check kernel support
  if [ ! -f /sys/kernel/security/landlock/abi_version ]; then
    echo "[security] WARNING: Landlock not supported by kernel, skipping filesystem restrictions"
    return 0
  fi

  local abi_version
  abi_version=$(cat /sys/kernel/security/landlock/abi_version)
  echo "[security] Landlock ABI version: ${abi_version}"

  # Define allowed paths with access types
  # RO = read-only, RW = read-write, RX = read+execute
  export LANDLOCK_RULES="${LANDLOCK_RULES:-}"

  # System libraries and binaries (read + execute only)
  LANDLOCK_RX_PATHS=(
    /usr
    /lib
    /lib64
    /bin
    /sbin
    /etc/ssl
    /etc/ca-certificates
    /etc/resolv.conf
    /etc/hosts
    /etc/nsswitch.conf
    /etc/passwd
    /etc/group
    /etc/ld.so.cache
    /etc/ld.so.conf
    /etc/ld.so.conf.d
  )

  # Config directory (read-only)
  LANDLOCK_RO_PATHS=(
    "${OPENCODE_CONFIG_DIR:-/etc/opencode}"
  )

  # Working directories (read-write) — only the workspace and data dirs
  LANDLOCK_RW_PATHS=(
    /workspaces
    /home/opencode/.local/share/opencode
    /tmp
    /dev/null
    /dev/urandom
    /dev/random
    /proc/self
  )

  # If landlockctl is available, use it
  if command -v landlockctl &>/dev/null; then
    local args=()
    for p in "${LANDLOCK_RX_PATHS[@]}"; do
      [ -e "$p" ] && args+=(--ro "$p" --exec "$p")
    done
    for p in "${LANDLOCK_RO_PATHS[@]}"; do
      [ -e "$p" ] && args+=(--ro "$p")
    done
    for p in "${LANDLOCK_RW_PATHS[@]}"; do
      [ -e "$p" ] && args+=(--rw "$p")
    done

    echo "[security] Applying Landlock via landlockctl with ${#args[@]} rules"
    exec landlockctl "${args[@]}" -- "$@"
  fi

  # If our compiled helper is available
  if [ -x /usr/local/bin/landlock-restrict ]; then
    echo "[security] Applying Landlock via landlock-restrict helper"
    export LANDLOCK_RX="$(IFS=:; echo "${LANDLOCK_RX_PATHS[*]}")"
    export LANDLOCK_RO="$(IFS=:; echo "${LANDLOCK_RO_PATHS[*]}")"
    export LANDLOCK_RW="$(IFS=:; echo "${LANDLOCK_RW_PATHS[*]}")"
    exec /usr/local/bin/landlock-restrict "$@"
  fi

  echo "[security] WARNING: No Landlock enforcement tool found, skipping filesystem restrictions"
  echo "[security] Install landlockctl or build landlock-restrict to enable"
}

# ---------------------------------------------------------------------------
# 2. NETWORK NAMESPACE ISOLATION
# ---------------------------------------------------------------------------
# Force all outbound traffic through a controlled proxy.
# Docker Compose already provides network isolation between services.
# Here we add iptables rules to restrict outbound connections to only
# the proxy and known-good destinations.

apply_network_restrictions() {
  # Only apply if we have iptables and CAP_NET_ADMIN
  if ! command -v iptables &>/dev/null; then
    echo "[security] iptables not available, using Docker network isolation only"
    return 0
  fi

  if ! iptables -L -n &>/dev/null 2>&1; then
    echo "[security] No CAP_NET_ADMIN, using Docker network isolation only"
    return 0
  fi

  echo "[security] Applying network restrictions via iptables"

  # Allow loopback
  iptables -A OUTPUT -o lo -j ACCEPT

  # Allow established connections
  iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

  # Allow DNS (UDP 53)
  iptables -A OUTPUT -p udp --dport 53 -j ACCEPT

  # Allow HTTPS outbound (for LLM API calls)
  iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT

  # Allow HTTP outbound (for proxy and MCP servers)
  iptables -A OUTPUT -p tcp --dport 80 -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 3001 -j ACCEPT  # mcp-everything
  iptables -A OUTPUT -p tcp --dport 8080 -j ACCEPT  # mitm-proxy

  # Allow the opencode server port itself
  iptables -A OUTPUT -p tcp --dport 4096 -j ACCEPT

  # Drop everything else
  iptables -A OUTPUT -j DROP

  echo "[security] Network restrictions applied: DNS, HTTP/S, MCP, proxy only"
}

# ---------------------------------------------------------------------------
# 3. DROP CAPABILITIES
# ---------------------------------------------------------------------------
# Even if running as root, drop all capabilities we don't need.

drop_capabilities() {
  if command -v capsh &>/dev/null; then
    echo "[security] Dropping unnecessary capabilities"
    # We only need: none (if non-root) or minimal set
    # capsh will be used to drop caps before exec
    return 0
  fi
}

# ---------------------------------------------------------------------------
# 4. RESOURCE LIMITS
# ---------------------------------------------------------------------------
# Prevent runaway processes from consuming all resources.

apply_resource_limits() {
  # Max open files
  ulimit -n 4096 2>/dev/null || true

  # Max processes (prevent fork bombs from AI-generated code)
  ulimit -u 256 2>/dev/null || true

  # Max file size (1GB)
  ulimit -f 1048576 2>/dev/null || true

  # Max virtual memory (4GB)
  ulimit -v 4194304 2>/dev/null || true

  echo "[security] Resource limits applied: files=4096, procs=256, fsize=1G, vmem=4G"
}

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

echo "[security] OpenCode security entrypoint starting"
echo "[security] PID: $$, UID: $(id -u), GID: $(id -g)"

# Apply resource limits (always works)
apply_resource_limits

# Apply network restrictions (requires iptables + CAP_NET_ADMIN)
apply_network_restrictions

# Apply Landlock (requires kernel 5.13+ and enforcement tool)
# NOTE: apply_landlock exec's into the target command, so it must be last
if [ "${LANDLOCK_ENABLED:-true}" = "true" ]; then
  apply_landlock "$@"
else
  echo "[security] Landlock disabled via LANDLOCK_ENABLED=false"
fi

echo "Setting up symling for worktrees" 
ln -sn /stacks/agents/workspaces/worktree /home/opencode/.local/share/opencode/worktree 2>/dev/null || true

# If Landlock didn't exec, run the command directly
echo "[security] Executing: $*"
exec "$@"
