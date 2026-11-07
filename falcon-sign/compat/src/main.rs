// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC
//! `gen <dir>`: write node-signed.json and txid-golden.json using fd-pl's own code.
//! `verify <file>...`: check SDK/wallet vectors with fd-pl `Tx::verify`.
use fd_pl::crypto::{CryptoScheme, KeyRing};
use fd_pl::{Tx, TxBody};
use serde_json::{json, Value};

fn bodies() -> Vec<(&'static str, String, u64, TxBody)> {
    let s = |x: &str| x.to_string();
    vec![
        ("pay", s("bob"), 1234, TxBody::Pay),
        ("asset_pay", s("bob"), u64::MAX, TxBody::AssetPay { asset: s("ETH") }),
        ("pay_to_key", s("bob"), 9, TxBody::PayToKey { key_hash: "ab".repeat(32) }),
        ("swap_route", s(""), 0, TxBody::SwapRoute { token_in: s("FPL"), token_out: s("USDC"), amount_in: 20_000_000_000_000_001, min_out: 1 }),
        ("add_liquidity", s(""), 0, TxBody::AddLiquidity { pool_id: s("FPL-USDC"), amt_a: 10, amt_b: 20 }),
        ("remove_liquidity", s(""), 0, TxBody::RemoveLiquidity { pool_id: s("FPL-USDC"), lp_burn: 5 }),
        ("lend_supply", s(""), 0, TxBody::LendSupply { market_id: s("USDC"), amount: 7 }),
        ("lend_withdraw", s(""), 0, TxBody::LendWithdraw { market_id: s("USDC"), shares: 7 }),
        ("lend_borrow", s(""), 0, TxBody::LendBorrow { market_id: s("USDC"), amount: 7, collateral_fpl: 100 }),
        ("lend_repay", s(""), 0, TxBody::LendRepay { market_id: s("USDC"), amount: 7 }),
        ("vault_open", s("cold"), 0, TxBody::VaultOpen { destination: s("cold") }),
        ("vault_lock", s(""), 0, TxBody::VaultLock),
        ("claim", s(""), 0, TxBody::Claim),
        ("watcher_heartbeat", s(""), 0, TxBody::WatcherHeartbeat),
        ("rail_withdraw", s("tb1qexample"), 15000, TxBody::RailWithdraw { asset: s("BTC"), amount: 15000, external_to: s("tb1qexample"), vault_sig: s(""), signed_btc_tx: s("") }),
        ("rail_withdraw_kickoff", s("tb1qexample"), 15000, TxBody::RailWithdraw { asset: s("BTC"), amount: 15000, external_to: s("tb1qexample"), vault_sig: s(""), signed_btc_tx: s("00ff") }),
        ("set_external_addrs", s(""), 0, TxBody::SetExternalAddrs { chain: s("btc"), address: s("tb1q\"esc\\aped\u{e9}") }),
        ("place_limit_order", s(""), 0, TxBody::PlaceLimitOrder { pair: s("FPL/USDC"), side: s("sell"), price: 123, amount: 456, expiry_height: None }),
        ("place_limit_order_expiry", s(""), 0, TxBody::PlaceLimitOrder { pair: s("FPL/USDC"), side: s("buy"), price: 1, amount: 2, expiry_height: Some(999) }),
        ("cancel_order", s(""), 0, TxBody::CancelOrder { order_id: u64::MAX }),
    ]
}

fn gen(dir: &str) {
    let acct = "node-alice";
    let mut ring = KeyRing::new(CryptoScheme::Falcon512);
    ring.generate_id(acct);
    let mut signed = vec![];
    let mut golden = vec![];
    for (name, dest, amt, body) in bodies() {
        let tx = Tx::sign_body(&ring, acct, 42, &dest, amt, 2, 2300, body.clone()).unwrap();
        tx.verify(&ring).unwrap();
        signed.push(json!({"name": name, "source": "fd-pl", "json": serde_json::to_string(&tx).unwrap()}));
        let payload = Tx::payload("rGoldenAccount", 7, &dest, amt, 2, 2300, &body);
        let unsigned = Tx { account: "rGoldenAccount".into(), sequence: 7, destination: dest.clone(), amount: amt, fee: 2, network_id: 2300,
            public_key: String::new(), signature: String::new(), tx_id: String::new(), body: body.clone() };
        golden.push(json!({"name": name, "tx": serde_json::to_string(&unsigned).unwrap(), "body_json": serde_json::to_string(&body).unwrap(),
            "payload": payload, "tx_id": fd_pl::crypto::sha256_hex(payload.as_bytes())}));
    }
    // falcon-sign Rust crate -> must verify in fd-pl, and its JSON parses as fd-pl Tx.
    let kp = falcon_sign::Keypair::generate();
    for (name, dest, amt, body) in bodies() {
        let body_s = serde_json::to_string(&body).unwrap();
        let Ok(b2) = serde_json::from_str::<falcon_sign::TxBody>(&body_s) else { continue };
        let t = falcon_sign::UnsignedTx::new("crate-bob", 5, &dest, amt, b2).sign(&kp);
        let node_tx: Tx = serde_json::from_str(&t.to_json()).unwrap();
        let mut r = KeyRing::new(CryptoScheme::Falcon512);
        r.insert_public("crate-bob", &t.public_key).unwrap();
        node_tx.verify(&r).unwrap_or_else(|e| panic!("crate {name}: {e}"));
        assert_eq!(t.tx_id, node_tx.tx_id);
        signed.push(json!({"name": format!("crate:{name}"), "source": "falcon-sign-rs", "json": t.to_json()}));
    }
    std::fs::write(format!("{dir}/node-signed.json"), serde_json::to_string_pretty(&signed).unwrap() + "\n").unwrap();
    std::fs::write(format!("{dir}/txid-golden.json"), serde_json::to_string_pretty(&golden).unwrap() + "\n").unwrap();
    println!("gen: {} signed vectors, {} tx-id goldens (fd-pl Tx::sign_body + falcon-sign crate)", signed.len(), golden.len());
}

fn verify(files: &[String]) -> bool {
    let (mut ok, mut bad) = (0, 0);
    for f in files {
        let v: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(f).unwrap()).unwrap();
        for e in v {
            let name = e["name"].as_str().unwrap_or("?");
            let expect_reject = e["expect"] == "reject";
            let res = (|| -> Result<(), String> {
                let tx: Tx = serde_json::from_str(e["json"].as_str().unwrap()).map_err(|e| format!("parse: {e}"))?;
                let mut r = KeyRing::new(CryptoScheme::Falcon512);
                r.insert_public(&tx.account, &tx.public_key).map_err(|e| format!("key: {e}"))?;
                tx.verify(&r)?;
                let c: falcon_sign::Tx = serde_json::from_str(e["json"].as_str().unwrap()).map_err(|e| format!("crate parse: {e}"))?;
                c.verify().map_err(|e| format!("crate: {e}"))
            })();
            match (res, expect_reject) {
                (Ok(()), false) | (Err(_), true) => ok += 1,
                (r, _) => {
                    bad += 1;
                    eprintln!("FAIL {f} {name}: {r:?} (expect_reject={expect_reject})");
                }
            }
        }
    }
    println!("verify: {ok} ok, {bad} failed (fd-pl Tx::verify)");
    bad == 0
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("gen") => gen(&a[2]),
        Some("verify") => if !verify(&a[2..]) { std::process::exit(1) },
        _ => { eprintln!("usage: gen <dir> | verify <file>..."); std::process::exit(2) }
    }
}
