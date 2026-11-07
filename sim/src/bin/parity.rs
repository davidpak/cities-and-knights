//! Plays games with random legal moves and writes every move, with a fingerprint of the whole state after it,
//! for sim/parity.ts to replay through the real engine. Each step also carries one random move tried out of turn
//! or out of place, and whether the rules here allowed it: the real engine must agree.
//! Usage: parity <games> <first seed> > trace.jsonl
use std::io::{BufWriter, Write};
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

fn random_any(g: &Game, rng: &mut Rng) -> (usize, Action) {
    let p = rng.below(g.players.len());
    let r = |rng: &mut Rng, n: usize| rng.below(n) as u8;
    let a = match rng.below(14) {
        0 => Action::BuildSettlement(r(rng, VERTS)),
        1 => Action::BuildRoad(r(rng, EDGES)),
        2 => Action::BuildCity(r(rng, VERTS)),
        3 => Action::Roll,
        4 => {
            let mut c = [0u8; 5];
            for _ in 0..rng.below(5) {
                c[rng.below(5)] += 1;
            }
            Action::Discard(c)
        }
        5 => Action::MoveRobber(r(rng, HEXES)),
        6 => Action::Steal(r(rng, 4)),
        7 => Action::BuyCard,
        8 => Action::PlayKnight,
        9 => Action::PlayRoadBuilding,
        10 => Action::PlayYearOfPlenty(r(rng, 5), r(rng, 5)),
        11 => Action::PlayMonopoly(r(rng, 5)),
        12 => Action::BankTrade(r(rng, 5), r(rng, 5)),
        _ => Action::EndTurn,
    };
    (p, a)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let games: usize = args.get(1).and_then(|x| x.parse().ok()).unwrap_or(100);
    let first: i32 = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(1);
    let out = std::io::stdout();
    let mut out = BufWriter::new(out.lock());
    let mut legal = vec![];
    for k in 0..games {
        let seed = first.wrapping_add(k as i32 * 7919);
        let n = 2 + k % 3;
        let mut rng = Rng(0x9E3779B97F4A7C15 ^ (seed as u64).wrapping_mul(0x2545F4914F6CDD1D) | 1);
        let mut g = Game::new(n, seed);
        write!(out, r#"{{"seed":{seed},"n":{n},"start":{},"steps":["#, fnv(&g.canonical())).unwrap();
        let mut first_step = true;
        for _ in 0..4000 {
            let Some(p) = g.actor() else { break };
            let a = if g.owed(p) > 0 {
                Action::Discard(random_discard(&g, p, &mut rng))
            } else {
                g.legal(&mut legal);
                // (builds and cards more often than trades and passing, so games move along)
                let builds: Vec<&Action> = legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).collect();
                if !builds.is_empty() && rng.below(10) < 8 { builds[rng.below(builds.len())].clone() } else { legal[rng.below(legal.len())].clone() }
            };
            // a random move, tried on a copy: allowed or not?
            let (pp, probe) = random_any(&g, &mut rng);
            let mut copy = g.clone();
            let ok = copy.apply(pp, &probe).is_ok();
            g.apply(p, &a).expect("a legal move was refused");
            if !first_step {
                out.write_all(b",").unwrap();
            }
            first_step = false;
            write!(out, "[{p},{},{},[{pp},{},{}]]", action_json(&a), fnv(&g.canonical()), action_json(&probe), ok).unwrap();
        }
        writeln!(out, "]}}").unwrap();
    }
}
