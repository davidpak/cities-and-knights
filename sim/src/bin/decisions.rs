//! Plays greedy net-vs-net games (no exploring) and writes each move the Rust agent (sim/src/agent.rs) chose, for
//! train/decide-parity.ts to replay through the real engine and check the TypeScript agent (train/agent.ts) makes
//! the same choices with the same network.
//!   decisions <net> <games> <first seed> > dec.jsonl
use std::io::{BufWriter, Write};
use tp_sim::agent::{decide, Ctx, Seat, TRADES_A_TURN};
use tp_sim::nn::Net;
use tp_sim::*;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let net = Net::load(&args[1]).expect("a .net file");
    let games: usize = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(50);
    let first: i32 = args.get(3).and_then(|x| x.parse().ok()).unwrap_or(1);
    let out = std::io::stdout();
    let mut out = BufWriter::new(out.lock());
    let mut ctx = Ctx::new(&net);
    for k in 0..games {
        let seed = first.wrapping_add(k as i32 * 7919);
        let n = 2 + k % 3;
        let mut g = Game::new(n, seed);
        ctx.trades = (u32::MAX, 0);
        let mut pick = Pick(0xA076_1D64_78BD_642F ^ ((k + 1) as u64).wrapping_mul(0xE703_7ED1_A0B4_28DB));
        write!(out, r#"{{"seed":{seed},"n":{n},"steps":["#).unwrap();
        let mut first_step = true;
        for _ in 0..6000 {
            let Some(p) = g.actor() else { break };
            let a = decide(&g, p, Seat::Net(&net), 0., &mut pick, &mut ctx);
            if matches!(a, Action::BankTrade(..)) {
                ctx.trades = if ctx.trades.0 == g.turn { (g.turn, ctx.trades.1 + 1) } else { (g.turn, 1) };
            }
            let _ = TRADES_A_TURN;
            if !first_step {
                out.write_all(b",").unwrap();
            }
            first_step = false;
            write!(out, "[{p},{}]", action_json(&a)).unwrap();
            g.play(p, &a);
        }
        writeln!(out, "]}}").unwrap();
    }
}
