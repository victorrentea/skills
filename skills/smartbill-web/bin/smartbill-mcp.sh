#!/bin/bash
# Launcher for the SmartBill MCP server.
#
# Claude Desktop spawns MCP servers with a minimal environment - not your login
# shell - so `node` is usually not on PATH and `command: "npx"` fails with
# spawn ENOENT. Hardcoding the nvm path instead (~/.nvm/versions/node/v22.21.1/
# bin/node) breaks the moment nvm installs a new patch release. So resolve node
# here, at launch, and let the Desktop config point at this stable path.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_node() {
  # Prefer whatever nvm calls "default", so a version bump is picked up for free.
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" --no-use >/dev/null 2>&1 || true
    local n
    n="$(nvm which default 2>/dev/null | tail -1)" || true
    [ -n "${n:-}" ] && [ -x "$n" ] && { printf '%s' "$n"; return 0; }
  fi
  command -v node 2>/dev/null || true
}

NODE="$(resolve_node)"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "smartbill-mcp: could not find a node binary (looked at nvm default, then PATH)" >&2
  exit 1
fi

# tsx runs the TypeScript sources directly, so there is no build step to forget.
exec "$NODE" "$HERE/node_modules/tsx/dist/cli.mjs" "$HERE/src/mcp.ts" "$@"
