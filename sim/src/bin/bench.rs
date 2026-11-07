//! How fast the simulator plays: whole games with random legal moves, one thread and all of them.
use std::time::Instant;
use tp_sim::*;

fn play_games(n: usize, seed: u64) -> (usize, usize) {
    let mut x = seed | 1;
    let mut rnd = move |m: usize| {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        (x % m as u64) as usize
    };
    let mut legal = vec![];
    let mut moves = 0;
    let mut finished = 0;
    for k in 0..n {
        let mut g = Game::new(4, (seed as i32).wrapping_add(k as i32));
        for _ in 0..4000 {
            let Some(p) = g.actor() else { break };
            let owed = g.owed(p);
            let a = if owed > 0 {
                let mut c = [0u8; 5];
                let mut h = g.players[p].hand;
                for _ in 0..owed {
                    let r = (0..5).find(|&r| h[r] > 0).unwrap();
                    h[r] -= 1;
                    c[r] += 1;
                }
                Action::Discard(c)
            } else {
                g.legal(&mut legal);
                let builds = legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).count();
                if builds > 0 && rnd(10) < 8 {
                    legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).nth(rnd(builds)).unwrap().clone()
                } else {
                    legal[rnd(legal.len())].clone()
                }
            };
            g.play(p, &a);
            moves += 1;
        }
        if matches!(g.phase, Phase::Over { .. }) {
            finished += 1;
        }
    }
    (moves, finished)
}

fn main() {
    let n = 20000;
    let t = Instant::now();
    let (moves, fin) = play_games(n, 12345);
    let s = t.elapsed().as_secs_f64();
    println!("1 thread: {n} games in {s:.2}s = {:.0} games/s, {:.2}M moves/s, {fin} reached 10 points", n as f64 / s, moves as f64 / s / 1e6);
    let threads = std::thread::available_parallelism().map(|x| x.get()).unwrap_or(1);
    let t = Instant::now();
    let total: usize = std::thread::scope(|sc| {
        let hs: Vec<_> = (0..threads).map(|i| sc.spawn(move || play_games(n, 1000 + i as u64 * 7).0)).collect();
        hs.into_iter().map(|h| h.join().unwrap()).count() * n
    });
    let s = t.elapsed().as_secs_f64();
    println!("{threads} threads: {total} games in {s:.2}s = {:.0} games/s", total as f64 / s);
}
