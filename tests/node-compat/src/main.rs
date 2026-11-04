//! `gen <file>`: write the SetExternalAddrs golden (payload / body / tx_id) using fd-pl's own code.
//! `verify <file>`: parse each wallet vector as fd-pl `Tx` and run `Tx::verify`.
use fd_pl::crypto::{sha256_hex, CryptoScheme, KeyRing};
use fd_pl::{Tx, TxBody};
use serde_json::{json, Value};

fn gen(path: &str) {
    let cases = [("btc", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"), ("eth", "0x52908400098527886E0F7030069857D2E4169EE7"), ("btc", "")];
    let mut out = vec![];
    for (chain, address) in cases {
        let body = TxBody::SetExternalAddrs { chain: chain.into(), address: address.into() };
        let payload = Tx::payload("scott.reynolds.123", 7, "", 0, 2, 2300, &body);
        out.push(json!({"account": "scott.reynolds.123", "sequence": 7, "destination": "", "amount": 0, "fee": 2, "network_id": 2300,
            "chain": chain, "address": address, "body_json": serde_json::to_string(&body).unwrap(),
            "payload": payload, "tx_id": sha256_hex(payload.as_bytes())}));
    }
    std::fs::write(path, serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
    println!("gen: {} SetExternalAddrs goldens from fd-pl Tx::payload", out.len());
}

fn verify(path: &str) -> bool {
    let v: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let (mut ok, mut bad) = (0, 0);
    for e in v {
        let name = e["name"].as_str().unwrap_or("?");
        let expect_reject = e["expect"] == "reject";
        let res = (|| -> Result<(), String> {
            let tx: Tx = serde_json::from_str(e["json"].as_str().unwrap()).map_err(|e| format!("parse: {e}"))?;
            if !matches!(tx.body, TxBody::SetExternalAddrs { .. }) { return Err(format!("body is {:?}", tx.body)); }
            let mut r = KeyRing::new(CryptoScheme::Falcon512);
            r.insert_public(&tx.account, &tx.public_key).map_err(|e| format!("key: {e}"))?;
            tx.verify(&r)
        })();
        match (&res, expect_reject) {
            (Ok(()), false) | (Err(_), true) => { ok += 1; println!("ok   {name}: {}", if expect_reject { format!("rejected as expected ({})", res.unwrap_err()) } else { "accepted".into() }); }
            _ => { bad += 1; eprintln!("FAIL {name}: {res:?} (expect_reject={expect_reject})"); }
        }
    }
    println!("verify: {ok} ok, {bad} failed (fd-pl Tx parse + Tx::verify)");
    bad == 0
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("gen") => gen(&a[2]),
        Some("verify") => if !verify(&a[2]) { std::process::exit(1) },
        _ => { eprintln!("usage: gen <file> | verify <file>"); std::process::exit(2) }
    }
}
