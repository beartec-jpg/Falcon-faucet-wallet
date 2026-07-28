# Falcon Multi-Chain Implementation (Testnet)

**Status:** 2026-07-28 · Falcon network id **1001** · Bridge-only mint (no free bootstrap of F-assets)  
**Custody model:** Custodial lock-mint via multi-sig-capable `FalconCollateralLock` + off-chain deposit relays (not fully trustless).

This document describes the full multi-chain wallet + bridge system as implemented and deployed on testnet: architecture, addresses, transaction flows, backup model, ops services, and remaining work (especially **FBTC**).

---

## 1. Product model

### 1.1 Three wallet tabs

| Tab | What it holds | Keys |
|-----|----------------|------|
| **Falcon** | Native **FALCON** + bridged IOUs (**F-USDC**, **FETH**, **FBNB**; **FBTC** later) | Falcon-512 passkey vault |
| **Multi-chain** | Native deposit wallets: **ETH** (Sepolia), **BTC** (testnet P2PKH), **BNB** (BSC testnet) | Same passkey encrypts EVM + BTC keys |
| **Bridge** | In/Out lock-mint only (no Send/Receive Sepolia chrome) | Uses Multi-chain EVM key |

### 1.2 One passkey, three key domains

| Domain | Address format | Used for |
|--------|----------------|----------|
| **Falcon** | `r…` | Ledger payments, trust lines, F-asset send, bridge-out memos |
| **EVM** | `0x…` | Sepolia ETH/USDC, BSC testnet BNB, FETH/FBNB locks |
| **BTC** | testnet `m…`/`n…` (P2PKH); mainnet `1…` also derived | Native BTC receive/send (no FBTC bridge yet) |

**Important:** **ETH and BNB share the same `0x` key** (EVM).  
- Same address on Sepolia, BSC testnet, and BSC mainnet.  
- Balances are **per network** (mainnet BNB ≠ testnet tBNB).  
- Sending mainnet BNB to the `0x` on **BSC mainnet** does **not** credit BSC testnet.

### 1.3 Backup JSON (v3)

File type: `qxrp-falcon-wallet-backup`, version **3**.

Encrypted payload includes:

| Field | Content |
|-------|---------|
| `falcon_secret` | Falcon signing secret |
| `address` / `publicKey` / `label` | Falcon account |
| `evm_private_key` / `evm_address` | Shared ETH+BNB key |
| `btc_private_key` / `btc_address` / `btc_address_mainnet` | BTC keys + both networks’ P2PKH |

**Re-export** builds a **new snapshot** of whatever is currently in the browser vault (passkey decrypt). Old files do not auto-update. After provisioning BTC or EVM, export again.

Restore accepts backup versions **1–3** (v1 Falcon-only, v2 + EVM, v3 + BTC).

---

## 2. Live bridge routes (testnet)

All bridge-ins: **lock collateral on source chain → deposit relay mints 1:1 IOU on Falcon**.  
No free mint of QUC/ETH/BNB currency except via verified `DepositCreated` events.

| Route | Status | Source | Lock | Falcon currency | Issuer | Relay unit |
|-------|--------|--------|------|-----------------|--------|------------|
| **USDC → F-USDC** | **Live** (In + Out) | Sepolia USDC | `0x2dae31Cbf2E3a418d617081985661fCD0117b75C` | `QUC` | `rPh77fAAmvbVuMQQP9H9JKtyTFuhRjp3Fk` | `qxrp-bridge-relay` |
| **ETH → FETH** | **Live** (In only) | Sepolia WETH | `0x11808B5Cda14d4144dbD2279f92f447e0f8F8F1d` | `ETH` | `rNn8xd3hbeTEAcEmRQae8xVaKshAj7HrED` | `qxrp-feth-relay` |
| **BNB → FBNB** | **Live** (In only) | BSC testnet WBNB | `0x682D60Bbf8dE13065C71cbF35c1dAdAa23E79938` | `BNB` | `rf8NZLdcwxrXAnPppttTeenQcAJW75uj7E` | `qxrp-fbnb-relay` |
| **BTC → FBTC** | **Not live** | — | — | `BTC` (planned) | not issued | none |

### 2.1 Token / lock addresses

**Sepolia (chain id 11155111)**

| Asset | Address |
|-------|---------|
| USDC (Circle test) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| WETH | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| USDC lock | `0x2dae31Cbf2E3a418d617081985661fCD0117b75C` |
| WETH/FETH lock | `0x11808B5Cda14d4144dbD2279f92f447e0f8F8F1d` |
| Lock owner (ops) | `0x64BA18002B6E72fE443f3F8a146cE529250Db107` |

**BSC testnet (chain id 97)**

| Asset | Address |
|-------|---------|
| WBNB | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` |
| WBNB/FBNB lock | `0x682D60Bbf8dE13065C71cbF35c1dAdAa23E79938` |
| Lock owner (ops) | same `0x64BA…Db107` |

**Falcon (network 1001)**

| IOU | Currency code | Issuer |
|-----|---------------|--------|
| F-USDC | `QUC` | `rPh77fAAmvbVuMQQP9H9JKtyTFuhRjp3Fk` |
| FETH | `ETH` | `rNn8xd3hbeTEAcEmRQae8xVaKshAj7HrED` |
| FBNB | `BNB` | `rf8NZLdcwxrXAnPppttTeenQcAJW75uj7E` |

Config sources (wallet):

- `public/config/usdc-bridge.json` — USDC + FETH + BSC/FBNB  
- `public/config/bridges.json` — route catalog  
- `public/config/testnet-stables.json` — Falcon IOU catalog for balances/trust lines  
- `public/config/feth-bridge.json` / server `/var/lib/qxrp-bridge/*-bridge.json`

Ops issuer state: `/var/lib/qxrp-stables/stables_state.json` keys `qUSDC_issuer`, `FETH_issuer`, `FBNB_issuer`.

---

## 3. Architecture

```
┌──────────────────────┐     passkey encrypt      ┌─────────────────────┐
│  Browser wallet      │◄────────────────────────►│ IndexedDB vault     │
│  Falcon + EVM + BTC  │                          │ falcon / evm / btc  │
└──────────┬───────────┘                          └─────────────────────┘
           │
           │ Bridge In (user txs)
           ▼
┌──────────────────────┐   DepositCreated event   ┌─────────────────────┐
│ FalconCollateralLock │─────────────────────────►│ deposit relay       │
│ (Sepolia or BSC)     │                          │ bridge-deposit-     │
│ ERC-20: USDC/WETH/   │                          │ relay.py            │
│         WBNB         │                          │ mint Payment IOU    │
└──────────────────────┘                          └──────────┬──────────┘
                                                             │
                                                             ▼
                                                  ┌─────────────────────┐
                                                  │ Falcon Ledger       │
                                                  │ F-USDC / FETH / FBNB│
                                                  └─────────────────────┘
```

### 3.1 Contract

- Source: `qXRP/contracts/FalconCollateralLock.sol`  
- Deploy: `qXRP/scripts/deploy-falcon-lock.js`  
  - `USDC_TOKEN` = any ERC-20 (USDC, WETH, or WBNB)  
  - `OWNERS` / `REQUIRED` = multi-sig threshold (testnet often `REQUIRED=1`)  
- User path: `approve` + `deposit(amount, falconAccount)`  
- Event: `DepositCreated(bytes32 depositId, address sender, uint256 amount, string falconAccount)`  
- Topic (used by relay): `0x77b58ff3106992e69c25650940327d9c1f8845c6dad4c0ae1a0f601640d91c87`

### 3.2 Deposit relay (multi-asset)

Script: `qXRP/scripts/bridge-deposit-relay.py` (also copied under `/var/lib/qxrp-bridge/`).

```text
python3 bridge-deposit-relay.py --loop --interval 30 \
  --currency <QUC|ETH|BNB> \
  --decimals <6|18> \
  --issuer-key <qUSDC_issuer|FETH_issuer|FBNB_issuer> \
  --lock-contract 0x… \
  --sepolia-rpc <EVM_RPC> \    # name historical; any EVM JSON-RPC
  --relay-state /var/lib/qxrp-bridge/<route>_relay_state.json
```

Behaviour:

1. Scan `DepositCreated` logs on lock contract.  
2. Skip already-minted `deposit_id`s.  
3. Require Falcon account exists + trust line to issuer currency.  
4. Else queue in `pending_deposits`.  
5. Mint 1:1 via issuer `Payment` (IOU amount human-scaled by decimals).  

Issuer bootstrap (bridge-only, no free float):

```text
python3 scripts/issue-bridge-iou.py --symbol FETH --currency ETH
python3 scripts/issue-bridge-iou.py --symbol FBNB --currency BNB
```

### 3.3 Withdraw relay (F-USDC only today)

- `bridge-withdraw-relay.py` + `bridge-sepolia-withdraw.js`  
- Watches Falcon payments to QUC issuer with memo type `sepolia-withdraw`.  
- Multi-sig release of Sepolia USDC from lock.  
- **Not** parameterized for FETH/FBNB yet.

### 3.4 Wallet RPC proxies (browser CSP)

Direct public RPCs often fail in production (`Failed to fetch` / CSP). Same-origin APIs:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/wallet/btc-balance?address=&network=testnet` | BTC balance (Blockstream/Mempool server-side) |
| `GET /api/wallet/bnb-balance?address=` | BSC testnet native balance |
| `POST /api/wallet/bnb-rpc` | Allowlisted JSON-RPC for BSC (sign client-side; broadcast raw only) |

BNB **send** and FBNB **bridge** use the BSC proxy path. BTC **send** still signs + broadcasts via public explorers (Blockstream/Mempool) from the browser.

---

## 4. End-to-end transaction details

### 4.1 Bridge In — USDC → F-USDC

**User (Sepolia, EVM key)**

1. Optional: fund `0x` with Sepolia ETH (gas) + USDC.  
2. Falcon **TrustSet** to issuer `rPh77…` currency `QUC` (if missing).  
3. `USDC.approve(lock, amount)`.  
4. `lock.deposit(amount, falcon_r_address)`.  

**Relay**

5. Sees `DepositCreated`.  
6. Issuer mints `QUC` Payment → user `r…` (decimals 6).  

**Bridge Out (USDC only)**

7. User pays `QUC` to issuer with memo `sepolia-withdraw` + destination `0x`.  
8. Withdraw relay multi-sig `withdraw` / release on lock.  
9. USDC arrives on Multi-chain ETH wallet.

### 4.2 Bridge In — ETH → FETH

**User**

1. TrustSet currency `ETH` → issuer `rNn8…`.  
2. If needed: `WETH.deposit{value}` (wrap native ETH).  
3. `WETH.approve(feth_lock, amount)`.  
4. `feth_lock.deposit(amount, falcon_r_address)`.  

**Relay** (`qxrp-feth-relay`): mint currency `ETH` decimals 18.

**Bridge Out:** not enabled in UI.

### 4.3 Bridge In — BNB → FBNB

**User**

1. TrustSet currency `BNB` → issuer `rf8N…`.  
2. Wrap tBNB → WBNB on BSC testnet.  
3. Approve + deposit on FBNB lock `0x682D60Bb…`.  

**Relay** (`qxrp-fbnb-relay`): mint currency `BNB` decimals 18.  
**RPC:** wallet uses `/api/wallet/bnb-rpc` for wrap/approve/lock (and native send).

**Bridge Out:** not enabled.

### 4.4 Verified bridge mint ledger (relay state, 2026-07-28)

These are **real lock-mint pairs** recorded by the deposit relays (not AMM swaps).  
Falcon “Recent Transactions” shows only the **mint Payment** side (now labeled **FETH** / **FBNB** / **F-USDC** via currency mapping — fix `fde2fe8`). The **EVM lock tx** lives on Sepolia / BscScan.

#### FETH (`qxrp-feth-relay` / `feth_relay_state.json`)

| When (UTC) | Amount | Falcon destination | Sepolia lock tx | Falcon mint tx |
|------------|--------|--------------------|-----------------|----------------|
| 2026-07-28T13:13:36Z | **0.00005** ETH | `r44mzkfQTGAjdQ9WE3Jx9LnETm1Y4t8wRE` | [`0x840c79f8…6340b`](https://sepolia.etherscan.io/tx/0x840c79f8aa228bc2bc285af4b883e30582b5695bfa106cb71274c45c8976340b) | `D01327A523449A99C28FE41FE0EE71184FA3502B89C777DA5D38A45B5F7FC4B3` |
| 2026-07-28T15:44:23Z | **0.1** ETH | `rKqqPLMJkCqZPXotoGQBjGdZiPYQvCAzcN` | [`0xb4c54c25…04393`](https://sepolia.etherscan.io/tx/0xb4c54c25e79eae62fe5107fd445ce1484880bbdc80720afcc6850c7cf5504393) | `468692B3B3B551EDEE83980147ADF252E6793E2B9E2196A0EAC353995A297B14` |

Deposit ids: `0xed4786f5…dd7d70`, `0xca2f9bc6…9aa6c8`.

#### FBNB (`qxrp-fbnb-relay` / `fbnb_relay_state.json`)

| When (UTC) | Amount | Falcon destination | BSC testnet lock tx | Falcon mint tx |
|------------|--------|--------------------|---------------------|----------------|
| 2026-07-28T15:50:38Z | **0.15** BNB | `rKqqPLMJkCqZPXotoGQBjGdZiPYQvCAzcN` | [`0xcf7fe6e6…8d014`](https://testnet.bscscan.com/tx/0xcf7fe6e6f45f54891ff7de5a0f0a6c872aed29c6d5e8ed757054e7c9dc08d014) | `10E550D8D45DE2C7F457A83A539FF457B84F8F15D8109BB57A7F158E755EB195` |

Deposit id: `0x5adc4f39…a95011`.

#### F-USDC (`qxrp-bridge-relay` / `relay_state.json`)

Dozens of production testnet mints (sample of recent):

| When (UTC) | Amount USDC | Falcon destination | Sepolia lock tx (prefix) | Falcon mint (prefix) |
|------------|-------------|--------------------|--------------------------|----------------------|
| 2026-07-28T09:23:09Z | 30 | `rMpmiVGj…HSxGZ` | `0xd6a7eb74…bc1242` | `10107FAF…919BBF` |
| 2026-07-27T17:17:28Z | 5 | `rMpmiVGj…HSxGZ` | `0x55bca076…425e30` | `49E097FE…7F37DE` |
| 2026-07-27T17:12:50Z | 5 | `rMpmiVGj…HSxGZ` | `0x3692f2a0…b8aa6` | `B05DCC4A…F7EC54` |

Full history: `/var/lib/qxrp-bridge/relay_state.json` (`mints[]`).

#### Supporting multi-chain txs (not mint, but build path)

| Purpose | Network | Tx / id |
|---------|---------|---------|
| BTC testnet faucet → user P2PKH | BTC testnet3 | `bc0c8e4db4af032998353214ff571e931bfd01364cadfe7a105a6f6ed700ba01` → `mnviuZwNhDB4LcPrsNKrn14dLnCPZDpDR5` (0.00136498 tBTC) |
| Fund ops deployer for FBNB lock | BSC testnet | `0x1c797c0da89da7ffce6d4fff00de27cc9a270ef9f631af00c0718fd4d7c7e27d` (0.005 tBNB → `0x64BA…Db107`) |
| FBNB lock deploy | BSC testnet | Contract `0x682D60Bbf8dE13065C71cbF35c1dAdAa23E79938` |
| FETH lock deploy | Sepolia | Contract `0x11808B5Cda14d4144dbD2279f92f447e0f8F8F1d` |

### 4.5 Native Multi-chain (no Falcon mint)

| Action | Network | Notes |
|--------|---------|--------|
| ETH receive/send | Sepolia | `sendSepoliaEth` / balances via Sepolia RPC |
| USDC receive/send | Sepolia | ERC-20 transfer; bridge uses same wallet |
| BNB receive/send | BSC testnet | Balance proxy + signed raw broadcast proxy |
| BTC receive | BTC testnet3 | P2PKH only (`m`/`n`) |
| BTC send | BTC testnet3 | Browser P2PKH build/sign; broadcast Blockstream/Mempool |

### 4.6 Falcon IOU “swaps” vs bridge

- **Bridge** = lock-mint / burn-release across chains (section 4.4 txs).  
- **Swap / Pool / AMM** on Falcon = separate DEX (`/swap`, `/pool`); trades Falcon-side assets after IOUs exist.  
- Bridged FETH/FBNB are trust-line balances; no automatic AMM seed for bridge-only tokens.

---

## 4.7 What’s left on BTC (clear answer)

### Done (native BTC wallet)

| Item | Status |
|------|--------|
| Passkey-encrypted BTC key in vault | Done |
| Testnet + mainnet P2PKH addresses | Done |
| Backup v3 includes BTC | Done |
| Balance lookup (API proxy + explorers) | Done |
| Receive (QR / copy testnet `m`/`n`) | Done |
| Send P2PKH testnet | Done |
| Proven faucet receive | Yes — see 4.4 supporting txs |

### Not done (FBTC bridge)

| Item | Status | New deploy / script? |
|------|--------|----------------------|
| Falcon **FBTC** issuer (`currency: BTC`) | Not created | `issue-bridge-iou.py --symbol FBTC --currency BTC` |
| Mint path from **native BTC** | Not built | **Yes — new script** e.g. `bridge-btc-deposit-relay.py` (UTXO watcher → mint) |
| Mint path from **WBTC on EVM** | Not built | **No new relay binary** — deploy another `FalconCollateralLock` with WBTC + reuse `bridge-deposit-relay.py` + new systemd unit |
| Wallet Bridge **BTC → FBTC** UI | Not live | Wallet config + route after mint path exists |
| FBTC Bridge Out | Not live | Same class of work as FETH/FBNB out |
| Bech32 / Taproot send/receive | Not live | Optional UX (today P2PKH only) |
| Multi-chain BTC txs in Falcon “Recent Transactions” | N/A | Falcon list is **ledger-only**; BTC chain history is separate (explorer) |

### Do we need a new deployed script for BTC?

| Goal | Answer |
|------|--------|
| Keep using native BTC send/receive only | **No** new Falcon/ops script |
| **FBTC via WBTC** (same rails as FETH) | New **lock deploy** + issuer + **same** `bridge-deposit-relay.py` (new unit args only) |
| **FBTC via native BTC deposits** | **Yes — new deposit watcher script** + custody BTC address + confirmations policy |

**Recommended next for FBTC:** WBTC lock-mint first (fastest, reuses relay). Native BTC lock-mint second if product requires “true BTC in” without wrapping.

---


## 5. Key code map (wallet)

| Area | Path |
|------|------|
| Asset catalogs | `src/lib/multi-chain-assets.ts` |
| BTC keys / P2PKH | `src/lib/create-btc-wallet.ts` |
| BTC balance/send | `src/lib/btc-client.ts`, `api/wallet/btc-balance` |
| EVM keys | `src/lib/create-evm-wallet.ts` |
| Sepolia USDC/ETH + FETH wrap | `src/lib/evm-bridge-client.ts` |
| BNB balance/send + BSC proxy use | `src/lib/native-chain-balances.ts`, `api/wallet/bnb-*` |
| Bridge UI | `src/components/BridgeDepositPanel.tsx` |
| Wallet shell | `src/app/wallet/page.tsx` |
| Backup v3 | `src/lib/wallet-backup.ts` |
| Bridge config types | `src/lib/bridge-config.ts` |

Ops:

| Area | Path |
|------|------|
| Lock contract | `contracts/FalconCollateralLock.sol` |
| Deploy lock | `scripts/deploy-falcon-lock.js` |
| Deposit relay | `scripts/bridge-deposit-relay.py` |
| Withdraw relay (USDC) | `scripts/bridge-withdraw-relay.py` |
| Issue bridge IOU | `scripts/issue-bridge-iou.py` |

---

## 6. What’s left — BTC / FBTC

### 6.1 Already done (native BTC)

- Random secp256k1 key in passkey vault  
- Testnet + mainnet P2PKH derivation  
- Backup v3 fields  
- Balance (proxy + explorers)  
- Send P2PKH testnet (UTXO select, legacy sign, broadcast)  
- Receive UI + QR  

### 6.2 Not done (FBTC bridge)

| Piece | Needed? | Notes |
|-------|---------|--------|
| Falcon **FBTC issuer** | **Yes** | `issue-bridge-iou.py --symbol FBTC --currency BTC` |
| **Custody model** | **Yes — design choice** | Options below; not the same as WETH/WBNB lock |
| Deposit observer | **Yes** | New script or major extension of EVM-only log watcher |
| Wallet Bridge route | **Yes** | UI + trust line + amount |
| Bridge Out | Later | Same as FETH/FBNB |
| Bech32 / Taproot | Optional | Receive/send currently **P2PKH only** |

### 6.3 Do we need a new deployed script for BTC?

**Yes — for FBTC bridge-in you need new ops software**, not only another `FalconCollateralLock` deploy.

| Approach | New deploy / scripts | Pros | Cons |
|----------|----------------------|------|------|
| **A. WBTC on Ethereum** (same as USDC/WETH pattern) | Deploy **another** `FalconCollateralLock` with **WBTC** on Sepolia/mainnet; reuse `bridge-deposit-relay.py` with `--currency BTC --decimals 8 --issuer-key FBTC_issuer` | Reuses all rails; **no new relay binary** | Users need **WBTC**, not native BTC; extra wrap/swap step |
| **B. Native BTC lock-mint** | **New** watcher: scan BTC testnet for deposits to a **custody address** (or HTLC), then mint FBTC | True “native BTC” UX | New script + custody wallet ops + confirmation policy + different security story |
| **C. Multi-sig BTC vault + attestations** | New services + possible mainnet multi-party | Stronger custody story | Largest build |

**Recommendation for testnet parity with FETH/FBNB:**

1. **Fast path:** **Approach A (WBTC)**  
   - `issue-bridge-iou.py --symbol FBTC --currency BTC`  
   - Deploy lock with Sepolia WBTC (or documented test WBTC)  
   - One more systemd unit: `qxrp-fbtc-relay` (same Python, different args)  
   - Wallet: enable FBTC route like FETH  

2. **Product path for “Multi-chain BTC → FBTC”:** **Approach B**  
   - New script e.g. `scripts/bridge-btc-deposit-relay.py`  
   - Hot (or multi-sig) BTC deposit address  
   - Confirmation depth (e.g. 1 testnet / 3–6 mainnet)  
   - Map `txid:vout` → mint once  
   - Does **not** use `FalconCollateralLock` as-is  

**Native BTC send/receive does not need a new Falcon deploy script** — only FBTC minting does.

---

## 7. Remaining multi-chain work (non-BTC)

| Item | Priority |
|------|----------|
| FETH / FBNB **Bridge Out** (parameterize withdraw relay) | High for symmetry |
| Mainnet locks (USDC/WETH/WBNB) + multi-sig `REQUIRED≥2` | Mainnet gate |
| Proof-of-reserves / multi-party mint | Hardening |
| Bech32 BTC addresses | UX |
| DEX liquidity for FETH/FBNB | Markets |
| Company entity / custody policy before public mainnet bridge | Product/legal (already constrained in plan) |

---

## 8. Ops checklist (coordinator `46.224.0.140`)

```text
systemctl status qxrp-bridge-relay   # USDC in + out stack
systemctl status qxrp-feth-relay     # ETH mint
systemctl status qxrp-fbnb-relay     # BNB mint

# State
/var/lib/qxrp-bridge/usdc-bridge.json
/var/lib/qxrp-bridge/feth-bridge.json
/var/lib/qxrp-bridge/fbnb-bridge.json
/var/lib/qxrp-bridge/*_relay_state.json
/var/lib/qxrp-stables/stables_state.json
/var/lib/qxrp-stables/testnet-stables.json
```

Deploy a new ERC-20 lock:

```bash
cd /root/qXRP/scripts
RPC_URL=… PRIVATE_KEY=… USDC_TOKEN=<ERC20> OWNERS=… REQUIRED=1 \
  node deploy-falcon-lock.js
```

New Falcon issuer (no free mint):

```bash
python3 scripts/issue-bridge-iou.py --symbol FBTC --currency BTC
```

---

## 9. Security notes

- Relays hold **issuer** Falcon secrets on the coordinator (or in state files). Compromise ⇒ unauthorized mint of that IOU.  
- Locks hold ERC-20; withdraw path is multi-sig capable but testnet often `1-of-1`.  
- Browser never sends Falcon/EVM/BTC **private keys** to the API; only signed blobs / raw txs.  
- Bridge is **custodial attestation**, not a light-client bridge. Mainnet requires company + multi-sig + no free bootstrap (product constraint).

---

## 10. Quick reference — user flows

| Goal | Where |
|------|--------|
| Get testnet BTC | Multi-chain → BTC → Receive → P2PKH faucet (testnet3) |
| Get tBNB | Multi-chain → BNB → Receive → BSC testnet faucet |
| Get Sepolia ETH/USDC | Multi-chain → ETH → Receive / faucets |
| Mint F-USDC | Bridge → USDC → F-USDC (trust line first) |
| Mint FETH | Bridge → ETH → FETH (wrap + trust line) |
| Mint FBNB | Bridge → BNB → FBNB (wrap + trust line) |
| Full backup | Export falcon-backup v3 after all keys exist |

---

*Document generated from deployed testnet state and wallet/qXRP code as of 2026-07-28.*
