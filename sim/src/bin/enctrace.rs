//! Plays games with random legal moves and, at each position, writes a fingerprint of what the network sees
//! (sim/src/encode.rs) — the FNV of the quantised bytes and of the raw f32 — plus the moves, for train/enc-parity.ts
//! to replay through the real engine and check the TypeScript encoder (train/encode.ts) matches number for number.
//! The first game also carries the full quantised vector per position, to point at the first difference if any.
//! With a third argument (a .net file) it also writes the network's value at each position, to check train/net.ts.
//!   enctrace <games> <first seed> [net] > enc.jsonl
use std::io::{BufWriter, Write};
use tp_sim::encode::{encode, FEATURES};
use tp_sim::nn::{quantise, Net, Scratch};
use tp_sim::*;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn random_discard(g: &Game, p: usize, rng: &mut Rng) -> [u8; 5] {
    let mut bag = vec![];
    for r in 0..5 {
        for _ in 0..g.players[p].hand[r] {
            bag.push(r);
        }
    }
    let mut out = [0u8; 5];
    for _ in 0..g.owed(p) {
        let i = rng.below(bag.len());
        out[bag.swap_remove(i)] += 1;
    }
    out
}

fn fnv_bytes(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &b in bytes {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let games: usize = args.get(1).and_then(|x| x.parse().ok()).unwrap_or(100);
    let first: i32 = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(1);
    let net: Option<Net> = args.get(3).and_then(|p| Net::load(p).ok());
    let mut scratch: Option<Scratch> = net.as_ref().map(|n| n.scratch());

    let out = std::io::stdout();
    let mut out = BufWriter::new(out.lock());
    let mut legal = vec![];
    let mut x = vec![0f32; FEATURES];
    for k in 0..games {
        let seed = first.wrapping_add(k as i32 * 7919);
        let n = 2 + k % 3;
        let mut rng = Rng(0x9E3779B97F4A7C15 ^ (seed as u64).wrapping_mul(0x2545F4914F6CDD1D) | 1);
        let mut g = Game::new(n, seed);
        write!(out, r#"{{"seed":{seed},"n":{n},"steps":["#).unwrap();
        let mut first_step = true;
        let mut full: Vec<String> = vec![];
        for _ in 0..4000 {
            let Some(p) = g.actor() else { break };
            // what the network would see here, from the actor's side
            encode(&g, p, 0, &mut x);
            let q = quantise(&x);
            let qhash = fnv_bytes(&q);
            let mut raw = Vec::with_capacity(FEATURES * 4);
            for v in &x {
                raw.extend_from_slice(&v.to_le_bytes());
            }
            let rhash = fnv_bytes(&raw);
            let val_bits: u32 = match (&net, &mut scratch) {
                (Some(nn), Some(sc)) => nn.value(&x, n, sc).to_bits(),
                _ => 0,
            };
            if k == 0 {
                full.push(format!("[{}]", q.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(",")));
            }
            // choose a move to advance the game
            let a = if g.owed(p) > 0 {
                Action::Discard(random_discard(&g, p, &mut rng))
            } else {
                g.legal(&mut legal);
                let builds: Vec<&Action> = legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).collect();
                if !builds.is_empty() && rng.below(10) < 8 { builds[rng.below(builds.len())].clone() } else { legal[rng.below(legal.len())].clone() }
            };
            g.apply(p, &a).expect("a legal move was refused");
            if !first_step {
                out.write_all(b",").unwrap();
            }
            first_step = false;
            write!(out, "[{p},{},{},{},{}]", action_json(&a), qhash, rhash, val_bits).unwrap();
        }
        if k == 0 {
            write!(out, r#"],"full":[{}]}}"#, full.join(",")).unwrap();
        } else {
            write!(out, "]}}").unwrap();
        }
        out.write_all(b"\n").unwrap();
    }
}
