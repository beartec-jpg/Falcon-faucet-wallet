#!/usr/bin/env bash
# Prove the wallet's SetExternalAddrs tx is accepted by the Falcon PL node's own parse/verify.
# Usage: FD_PL=/path/to/Falcon-PL/falcon-pl-rs/crates/fd-pl tests/node-compat/run.sh [--gen]
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${FD_PL:?set FD_PL to the fd-pl crate dir of a Falcon-PL checkout}"
sed "s|@FD_PL@|$FD_PL|" tests/node-compat/Cargo.toml.in > tests/node-compat/Cargo.toml
M=tests/node-compat/Cargo.toml
[ "${1:-}" = "--gen" ] && cargo run -q --manifest-path "$M" -- gen tests/fixtures/node-set-external-addrs.golden.json
WRITE_NODE_COMPAT_VECTORS=1 pnpm exec vitest run tests/set-external-addrs-node-compat.test.ts
cargo run -q --manifest-path "$M" -- verify tests/fixtures/wallet-set-external-addrs.signed.json
