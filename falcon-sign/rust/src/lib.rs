// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC
//! Falcon Sign SDK (Rust): Falcon-512 keys, signing and tx building for the
//! Falcon PL testnet. Uses the same `pqcrypto-falcon` (PQClean) backend and the
//! same tx format as the node (`fd-pl` `Tx::payload` / `Tx::verify`).
//!
//! payload = `pl-tx:v2|account|sequence|destination|amount|fee|network_id|body_json`,
//! signature = detached Falcon-512 over the payload, tx_id = sha256 hex(payload).

use pqcrypto_falcon::falcon512;
use pqcrypto_traits::sign::{DetachedSignature as _, PublicKey as _, SecretKey as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const FPL_TESTNET_NETWORK_ID: u32 = 2300;
pub const DEFAULT_FEE: u64 = 2;
pub const TX_DOMAIN: &str = "pl-tx:v2";
pub const PUBLIC_KEY_BYTES: usize = 897;
pub const SECRET_KEY_BYTES: usize = 1281;

/// Subset of the node's `TxBody` (same serde tag, names and field order).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TxBody {
    #[default]
    Pay,
    AssetPay { asset: String },
    VaultOpen { destination: String },
    VaultLock,
    Claim,
    AddLiquidity { pool_id: String, amt_a: u64, amt_b: u64 },
    RemoveLiquidity { pool_id: String, lp_burn: u64 },
    SwapRoute { token_in: String, token_out: String, amount_in: u64, min_out: u64 },
    LendSupply { market_id: String, amount: u64 },
    LendWithdraw { market_id: String, shares: u64 },
    LendBorrow { market_id: String, amount: u64, collateral_fpl: u64 },
    LendRepay { market_id: String, amount: u64 },
    WatcherHeartbeat,
    RailWithdraw {
        asset: String,
        amount: u64,
        external_to: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        vault_sig: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        signed_btc_tx: String,
    },
    PayToKey { key_hash: String },
    #[serde(alias = "set_external_addr")]
    SetExternalAddrs { chain: String, address: String },
    PlaceLimitOrder {
        pair: String,
        side: String,
        price: u64,
        amount: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expiry_height: Option<u64>,
    },
    CancelOrder { order_id: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tx {
    pub account: String,
    pub sequence: u64,
    pub destination: String,
    pub amount: u64,
    pub fee: u64,
    pub network_id: u32,
    pub public_key: String,
    pub signature: String,
    pub tx_id: String,
    #[serde(default)]
    pub body: TxBody,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsignedTx {
    pub account: String,
    pub sequence: u64,
    pub destination: String,
    pub amount: u64,
    pub fee: u64,
    pub network_id: u32,
    pub body: TxBody,
}

impl UnsignedTx {
    /// Native FPL transfer with default fee and testnet network id.
    pub fn transfer(account: &str, sequence: u64, destination: &str, amount: u64) -> Self {
        Self::new(account, sequence, destination, amount, TxBody::Pay)
    }
    /// Op with no recipient (destination "", amount 0), as the wallet builds them.
    pub fn op(account: &str, sequence: u64, body: TxBody) -> Self {
        Self::new(account, sequence, "", 0, body)
    }
    pub fn new(account: &str, sequence: u64, destination: &str, amount: u64, body: TxBody) -> Self {
        Self {
            account: account.into(),
            sequence,
            destination: destination.into(),
            amount,
            fee: DEFAULT_FEE,
            network_id: FPL_TESTNET_NETWORK_ID,
            body,
        }
    }
    pub fn payload(&self) -> String {
        payload(&self.account, self.sequence, &self.destination, self.amount, self.fee, self.network_id, &self.body)
    }
    pub fn tx_id(&self) -> String {
        sha256_hex(self.payload().as_bytes())
    }
    pub fn sign(self, kp: &Keypair) -> Tx {
        let p = self.payload();
        let signature = hex::encode(kp.sign(p.as_bytes()));
        Tx {
            tx_id: sha256_hex(p.as_bytes()),
            public_key: kp.public_hex(),
            signature,
            account: self.account,
            sequence: self.sequence,
            destination: self.destination,
            amount: self.amount,
            fee: self.fee,
            network_id: self.network_id,
            body: self.body,
        }
    }
}

pub fn payload(account: &str, sequence: u64, destination: &str, amount: u64, fee: u64, network_id: u32, body: &TxBody) -> String {
    let b = serde_json::to_string(body).expect("body serializes");
    format!("{TX_DOMAIN}|{account}|{sequence}|{destination}|{amount}|{fee}|{network_id}|{b}")
}

pub fn sha256_hex(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

impl Tx {
    pub fn payload(&self) -> String {
        payload(&self.account, self.sequence, &self.destination, self.amount, self.fee, self.network_id, &self.body)
    }
    /// tx_id and signature check (the node additionally checks the key registry).
    pub fn verify(&self) -> Result<(), String> {
        let p = self.payload();
        if sha256_hex(p.as_bytes()) != self.tx_id {
            return Err("tx_id mismatch".into());
        }
        if verify(p.as_bytes(), &self.signature, &self.public_key) {
            Ok(())
        } else {
            Err("bad signature".into())
        }
    }
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("tx serializes")
    }
}

/// Falcon-512 keypair. Debug output never includes the secret.
pub struct Keypair {
    pk: falcon512::PublicKey,
    sk: falcon512::SecretKey,
}

impl std::fmt::Debug for Keypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Keypair").field("public_key", &self.public_hex()).finish_non_exhaustive()
    }
}

impl Keypair {
    pub fn generate() -> Self {
        let (pk, sk) = falcon512::keypair();
        Self { pk, sk }
    }
    /// Wallet `falcon_secret` hex: 0xFB || pk(897) || sk(1281).
    pub fn from_falcon_secret(hex_s: &str) -> Result<Self, String> {
        let b = hex::decode(hex_s.trim()).map_err(|e| e.to_string())?;
        if b.len() != 1 + PUBLIC_KEY_BYTES + SECRET_KEY_BYTES || b[0] != 0xfb {
            return Err("invalid falcon_secret".into());
        }
        let pk = falcon512::PublicKey::from_bytes(&b[1..1 + PUBLIC_KEY_BYTES]).map_err(|e| format!("{e:?}"))?;
        let sk = falcon512::SecretKey::from_bytes(&b[1 + PUBLIC_KEY_BYTES..]).map_err(|e| format!("{e:?}"))?;
        Ok(Self { pk, sk })
    }
    pub fn to_falcon_secret(&self) -> String {
        let mut v = vec![0xfbu8];
        v.extend_from_slice(self.pk.as_bytes());
        v.extend_from_slice(self.sk.as_bytes());
        hex::encode(v)
    }
    pub fn public_bytes(&self) -> &[u8] {
        self.pk.as_bytes()
    }
    pub fn public_hex(&self) -> String {
        hex::encode(self.pk.as_bytes())
    }
    pub fn sign(&self, msg: &[u8]) -> Vec<u8> {
        falcon512::detached_sign(msg, &self.sk).as_bytes().to_vec()
    }
}

/// Verify a detached Falcon-512 signature (hex sig, hex raw public key).
pub fn verify(msg: &[u8], sig_hex: &str, pk_hex: &str) -> bool {
    use pqcrypto_traits::sign::DetachedSignature;
    let (Ok(sig), Ok(pk)) = (hex::decode(sig_hex), hex::decode(pk_hex)) else { return false };
    let (Ok(sig), Ok(pk)) = (falcon512::DetachedSignature::from_bytes(&sig), falcon512::PublicKey::from_bytes(&pk)) else {
        return false;
    };
    falcon512::verify_detached_signature(&sig, msg, &pk).is_ok()
}

/// `PayToKey` commitment: sha256 hex of the raw public key.
pub fn key_hash(raw_pk: &[u8]) -> String {
    sha256_hex(raw_pk)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sign_verify_roundtrip() {
        let kp = Keypair::generate();
        let tx = UnsignedTx::transfer("alice", 1, "bob", 5).sign(&kp);
        assert_eq!(tx.payload(), "pl-tx:v2|alice|1|bob|5|2|2300|{\"kind\":\"pay\"}");
        tx.verify().unwrap();
        let mut bad = tx.clone();
        bad.amount = 6;
        assert!(bad.verify().is_err());
        let back: Tx = serde_json::from_str(&tx.to_json()).unwrap();
        back.verify().unwrap();
        let kp2 = Keypair::from_falcon_secret(&kp.to_falcon_secret()).unwrap();
        assert_eq!(kp2.public_hex(), kp.public_hex());
        assert!(!format!("{kp:?}").contains(&kp.to_falcon_secret()[1800..1900]));
    }
}
