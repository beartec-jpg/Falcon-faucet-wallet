#!/usr/bin/env bash
# One command: unit tests + cross-compat vectors between the Falcon Sign SDK
# (TS + Rust), the Falcon wallet's signing code (../src/lib) and the Falcon PL
# node's own code (fd-pl). Needs node >= 20, npm, cargo, git.
#   FPL_NODE_DIR=/path/to/Falcon-PL  (default: clone at $FPL_NODE_REV into .cache/)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
FPL_NODE_REV="${FPL_NODE_REV:-e265e21}"
if [[ -z "${FPL_NODE_DIR:-}" ]]; then
  FPL_NODE_DIR="$here/.cache/Falcon-PL"
  if [[ ! -d "$FPL_NODE_DIR/.git" ]]; then
    git clone -q https://github.com/beartec-uk/Falcon-PL "$FPL_NODE_DIR"
  fi
  git -C "$FPL_NODE_DIR" fetch -q origin || true
  git -C "$FPL_NODE_DIR" checkout -q "$FPL_NODE_REV"
fi
echo "== node: $(git -C "$FPL_NODE_DIR" log --oneline -1)"
fdpl="$(cd "$FPL_NODE_DIR/falcon-pl-rs/crates/fd-pl" && pwd -P)"
sed "s|@FD_PL_PATH@|$fdpl|" compat/Cargo.toml.in > compat/Cargo.toml
mkdir -p vectors
rm -f vectors/*.json

echo "== rust crate tests"
(cd rust && cargo test --quiet)

echo "== node (fd-pl) + crate -> vectors"
(cd compat && cargo run --quiet --release -- gen ../vectors)

echo "== TS: unit, wallet<->SDK, node->SDK"
cd ts
[[ -d node_modules ]] || npm ci --silent
npm run --silent typecheck
REQUIRE_NODE_VECTORS=1 npx vitest run
cd ..

echo "== SDK/wallet -> node (fd-pl Tx::verify)"
(cd compat && cargo run --quiet --release -- verify ../vectors/sdk-ts-signed.json ../vectors/wallet-signed.json)
echo "== all compat tests passed"
