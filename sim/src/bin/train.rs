//! Self-play training, generation by generation, reporting to the lab.
//!
//!   cargo run --release --bin train -- --games 20000 --gens 100 --out runs/base
//!   (LAB_URL and LAB_TOKEN in the environment: progress goes to the lab page as it happens)
//!
//! Each generation:
//!  1. self-play: the champion plays itself, many games across all threads (a few moves at random, to explore);
//!     every position it chose is kept with who went on to win
//!  2. learn: the candidate network trains on the newest positions (a sliding window of recent generations)
//!  3. match: the candidate plays the champion, 4 seats rotated over the same games (same dice), no exploring
//!  4. if the candidate wins clearly more than a fair share it becomes champion; its rating is the champion's plus
//!     the gap the match measured
//!  5. report: rating, the match, a match against random play, how it plays, its map of the opening, to the lab

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tp_sim::agent::{opening_values, play_game, Ctx, Habits, Seat};
use tp_sim::encode::FEATURES;
use tp_sim::nn::{loss as holdout_loss, Net, Sample, Trainer};
use tp_sim::Pick;

struct Args {
    games: usize,
    gens: usize,
    eval: usize,
    threads: usize,
    out: String,
    hidden: usize,
    window: usize,
    epochs: f32,
    explore: f32,
    lr: f32,
    batch: usize,
    keep: usize,
    l2: f32,
    warmup: usize,
}

fn args() -> Args {
    let mut a = Args { games: 2000, gens: 1000, eval: 400, threads: std::thread::available_parallelism().map(|x| x.get()).unwrap_or(4), out: "runs/base".into(), hidden: 256, window: 3, epochs: 2., explore: 0.05, lr: 1e-3, batch: 256, keep: 40, l2: 1e-6, warmup: 20000 };
    let v: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i + 1 < v.len() {
        let x = &v[i + 1];
        match v[i].as_str() {
            "--games" => a.games = x.parse().unwrap(),
            "--gens" => a.gens = x.parse().unwrap(),
            "--eval" => a.eval = x.parse().unwrap(),
            "--threads" => a.threads = x.parse().unwrap(),
            "--out" => a.out = x.clone(),
            "--hidden" => a.hidden = x.parse().unwrap(),
            "--window" => a.window = x.parse().unwrap(),
            "--epochs" => a.epochs = x.parse().unwrap(),
            "--explore" => a.explore = x.parse().unwrap(),
            "--lr" => a.lr = x.parse().unwrap(),
            "--batch" => a.batch = x.parse().unwrap(),
            "--keep" => a.keep = x.parse().unwrap(),
            "--l2" => a.l2 = x.parse().unwrap(),
            "--warmup" => a.warmup = x.parse().unwrap(),
            other => panic!("unknown option {other}"),
        }
        i += 2;
    }
    a
}

/// the lab: where progress is reported (nothing is sent without LAB_URL and LAB_TOKEN)
struct Lab {
    url: Option<String>,
    token: String,
}
impl Lab {
    fn post(&self, body: &serde_json::Value) {
        let Some(url) = &self.url else { return };
        if let Err(e) = ureq::post(&format!("{url}/api/lab")).set("Authorization", &format!("Bearer {}", self.token)).send_json(body.clone()) {
            eprintln!("(lab report failed: {e})");
        }
    }
}

/// a share of games won in four-player play, as a rating gap: equal is 25%; a player who wins share s against three
/// equals is r = 3s/(1-s) times as strong (Bradley-Terry), 400·log10(r) on the chess scale
fn rating_gap(share: f64, players: f64) -> f64 {
    let s = share.clamp(0.001, 0.999);
    400. * ((players - 1.) * s / (1. - s)).log10()
}
/// a 90% interval for a share of n games (Wilson)
fn interval(share: f64, n: f64) -> (f64, f64) {
    let z = 1.645;
    let d = 1. + z * z / n;
    let c = (share + z * z / (2. * n)) / d;
    let h = z * ((share * (1. - share) / n) + z * z / (4. * n * n)).sqrt() / d;
    ((c - h).max(0.), (c + h).min(1.))
}

/// games between seats, in parallel: returns the wins of the seat under test and the habits it showed.
/// Each game seed is played `rotations` times with the seat under test moved round, so all face the same dice.
fn match_games(test: Seat, others: Seat, games: usize, players: usize, threads: usize, seed: i32) -> (usize, usize, Habits) {
    let seeds = games / players;
    let next = AtomicU64::new(0);
    let result = Mutex::new((0usize, 0usize, Habits::default()));
    let any_net = match (test, others) {
        (Seat::Net(n), _) | (_, Seat::Net(n)) => n.clone(),
        _ => Net::new(FEATURES, 8, 8, 1),
    };
    std::thread::scope(|sc| {
        for t in 0..threads {
            let (next, result, any_net) = (&next, &result, &any_net);
            sc.spawn(move || {
                let mut ctx = Ctx::new(any_net);
                let mut pick = Pick(0x9E3779B97F4A7C15 ^ (t as u64 + 1) * 0x2545F4914F6CDD1D);
                loop {
                    let k = next.fetch_add(1, Ordering::Relaxed) as usize;
                    if k >= seeds {
                        break;
                    }
                    for rot in 0..players {
                        let seats: Vec<Seat> = (0..players).map(|i| if i == rot { test } else { others }).collect();
                        let r = play_game(players, seed.wrapping_add(k as i32 * 7919), &seats, 0., false, &mut pick, &mut ctx);
                        let mine = r.seat_of.iter().position(|&s| s as usize == rot).unwrap();
                        let mut res = result.lock().unwrap();
                        res.1 += 1;
                        if r.winner == Some(mine) {
                            res.0 += 1;
                        }
                        res.2.add(&r.habits[mine]);
                    }
                }
            });
        }
    });
    result.into_inner().unwrap()
}

fn main() {
    let a = args();
    std::fs::create_dir_all(&a.out).unwrap();
    let lab = Lab { url: std::env::var("LAB_URL").ok(), token: std::env::var("LAB_TOKEN").unwrap_or_default() };
    let players = 4usize;
    // the champion and the candidate (picked up again if this run was stopped and started again)
    let champ_path = format!("{}/champion.net", a.out);
    let cand_path = format!("{}/candidate.net", a.out);
    let hist_path = format!("{}/history.json", a.out);
    let mut champion = Net::load(&champ_path).unwrap_or_else(|_| Net::new(FEATURES, a.hidden, a.hidden, 20261107));
    let mut candidate = Net::load(&cand_path).unwrap_or_else(|_| champion.clone());
    let mut history: Vec<serde_json::Value> = std::fs::read_to_string(&hist_path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut rating: f64 = history.iter().rev().find(|h| h["promoted"] == true).and_then(|h| h["rating"].as_f64()).unwrap_or(0.);
    let mut total_games: u64 = history.last().and_then(|h| h["games"].as_u64()).unwrap_or(0);
    let mut total_positions: u64 = history.last().and_then(|h| h["positions"].as_u64()).unwrap_or(0);
    let first_gen = history.len();
    let mut trainer = Trainer::new(&candidate, a.lr);
    trainer.l2 = a.l2;
    let mut window: VecDeque<Vec<Sample>> = VecDeque::new();
    println!("training: {} games a generation on {} threads, {} inputs, hidden {}x{}", a.games, a.threads, FEATURES, a.hidden, a.hidden);

    let status = |history: &[serde_json::Value], live: serde_json::Value| {
        serde_json::json!({
            "phases": [
                { "key": "simulator", "name": "Fast simulator", "status": "done", "summary": "The base game's rules in Rust, playing exactly the same game as the real engine.",
                  "facts": [{ "label": "Moves checked against the real engine", "value": "2,476,066" }, { "label": "Differences found", "value": "0" }, { "label": "Games a second, one CPU thread", "value": "3,400" }] },
                { "key": "brain", "name": "Network and search", "status": "done", "summary": "What the bot sees, the network that judges a position, and choosing moves with it.", "facts": [] },
                { "key": "training", "name": "Self-play training", "status": "now", "summary": "Generation after generation, each kept only if it beats the last.", "facts": [] },
                { "key": "expert", "name": "The new Expert", "status": "next", "summary": "The best network plays as Expert in the game.", "facts": [] },
                { "key": "review", "name": "Game Review", "status": "next", "summary": "Every move graded, Best to Blunder, with a luck rating apart.", "facts": [] }
            ],
            "training": { "generations": history, "live": live }
        })
    };

    for gen in first_gen..first_gen + a.gens {
        // ---- 1. self-play
        let t0 = Instant::now();
        let next = AtomicU64::new(0);
        let done = AtomicU64::new(0);
        let turns = AtomicU64::new(0);
        let unfinished = AtomicU64::new(0);
        let fresh: Mutex<Vec<Sample>> = Mutex::new(vec![]);
        let seed_base = (gen as i32).wrapping_mul(1_000_003);
        let warm = gen == 0 && a.warmup > 0;
        let games = if warm { a.warmup } else { a.games };
        std::thread::scope(|sc| {
            for t in 0..a.threads {
                let (next, done, fresh, champion, turns, unfinished) = (&next, &done, &fresh, &champion, &turns, &unfinished);
                sc.spawn(move || {
                    let mut ctx = Ctx::new(champion);
                    let mut pick = Pick(0xA076_1D64_78BD_642F ^ ((gen * 64 + t) as u64 + 1).wrapping_mul(0xE703_7ED1_A0B4_28DB));
                    // (the very first generation learns from random builders: an untrained network's own games teach nothing)
                    let seats = if warm { vec![Seat::Random; players] } else { vec![Seat::Net(champion); players] };
                    let mut local = vec![];
                    loop {
                        let k = next.fetch_add(1, Ordering::Relaxed) as usize;
                        if k >= games {
                            break;
                        }
                        let mut r = play_game(players, seed_base.wrapping_add(k as i32), &seats, a.explore, true, &mut pick, &mut ctx);
                        // (a sample of each game's positions: all of them would teach it that game, not the game)
                        while r.samples.len() > a.keep {
                            let i = pick.below(r.samples.len());
                            r.samples.swap_remove(i);
                        }
                        turns.fetch_add(r.turns as u64, Ordering::Relaxed);
                        if r.winner.is_none() {
                            unfinished.fetch_add(1, Ordering::Relaxed);
                        }
                        local.extend(r.samples);
                        done.fetch_add(1, Ordering::Relaxed);
                        if local.len() > 20000 {
                            fresh.lock().unwrap().append(&mut local);
                        }
                    }
                    fresh.lock().unwrap().append(&mut local);
                });
            }
            // (while they play: tell the lab how it's going, now and then)
            let mut last = Instant::now();
            while done.load(Ordering::Relaxed) < games as u64 {
                std::thread::sleep(std::time::Duration::from_millis(200));
                if last.elapsed().as_secs() >= 20 {
                    last = Instant::now();
                    let d = done.load(Ordering::Relaxed);
                    let rate = d as f64 / t0.elapsed().as_secs_f64();
                    lab.post(&status(&history, serde_json::json!({ "step": if warm { format!("Generation 0: learning what winning looks like from random builders, game {d} of {games}") } else { format!("Generation {gen}: self-play, game {d} of {games}") }, "gamesPerSec": rate, "totalGames": total_games + d, "positions": total_positions, "generation": gen })));
                }
            }
        });
        let fresh = fresh.into_inner().unwrap();
        let play_secs = t0.elapsed().as_secs_f64();
        total_games += games as u64;
        total_positions += fresh.len() as u64;
        let rate = games as f64 / play_secs;
        // how well the candidate predicts these games before it has learned from them: the honest score
        let holdout = holdout_loss(&candidate, &fresh);
        let avg_turns = turns.load(Ordering::Relaxed) as f64 / games as f64;
        let unfinished = unfinished.load(Ordering::Relaxed);
        println!("gen {gen}: {games} games{} in {play_secs:.0}s ({rate:.1}/s), {} positions, {avg_turns:.0} turns a game, {unfinished} unfinished, loss on these new games {holdout:.3}", if warm { " by random builders" } else { "" }, fresh.len());
        window.push_back(fresh);
        while window.len() > a.window {
            window.pop_front();
        }

        // ---- 2. learn
        lab.post(&status(&history, serde_json::json!({ "step": format!("Generation {gen}: learning from {} positions", window.iter().map(|w| w.len()).sum::<usize>()), "gamesPerSec": rate, "totalGames": total_games, "positions": total_positions, "generation": gen })));
        let t1 = Instant::now();
        let all: Vec<&Sample> = window.iter().flatten().collect();
        let steps = ((all.len() as f32 * a.epochs) / a.batch as f32).ceil() as usize;
        let mut pick = Pick(0x1234_5678 ^ gen as u64 * 0x9E37_79B9);
        let mut loss_sum = 0.;
        let mut batch: Vec<&Sample> = Vec::with_capacity(a.batch);
        for _ in 0..steps {
            batch.clear();
            for _ in 0..a.batch {
                batch.push(all[pick.below(all.len())]);
            }
            loss_sum += trainer.train(&mut candidate, &batch);
        }
        let loss = loss_sum / steps.max(1) as f32;
        println!("  learned: {steps} steps, loss {loss:.4}, {:.0}s", t1.elapsed().as_secs_f64());
        candidate.save(&cand_path).unwrap();

        // ---- 3. the match: candidate against champion; and against random play, as a yardstick
        lab.post(&status(&history, serde_json::json!({ "step": format!("Generation {gen}: match against the champion"), "gamesPerSec": rate, "totalGames": total_games, "positions": total_positions, "generation": gen })));
        let (w, n, habits) = match_games(Seat::Net(&candidate), Seat::Net(&champion), a.eval, players, a.threads, 777_000 + gen as i32 * 13);
        let share = w as f64 / n as f64;
        let (lo, hi) = interval(share, n as f64);
        let (rw, rn, _) = match_games(Seat::Net(&candidate), Seat::Random, 200, players, a.threads, 555_000 + gen as i32 * 13);
        let vs_random = rw as f64 / rn as f64;
        // ---- 4. promote it if it clearly won more than a fair share (the lower end of its interval above 25%)
        let promoted = lo > 0.25;
        let gap = rating_gap(share, players as f64);
        // (the candidate's rating: the champion's, plus the gap this match measured, with its interval)
        let prev = rating;
        if promoted {
            rating += gap;
            champion = candidate.clone();
            champion.save(&champ_path).unwrap();
        }
        println!("  match: {w}/{n} = {:.1}% (90%: {:.1}–{:.1}) {} · against random play {:.0}%", share * 100., lo * 100., hi * 100., if promoted { "PROMOTED" } else { "kept training" }, vs_random * 100.);
        // ---- 5. report
        let h = |x: u32| x as f64 / n as f64;
        let heat: serde_json::Map<String, serde_json::Value> = opening_values(&champion, 4, 20261107).into_iter().map(|(v, x)| (v.to_string(), serde_json::json!(x))).collect();
        history.push(serde_json::json!({
            "gen": gen, "at": chrono_now(), "games": total_games, "positions": total_positions, "loss": loss, "holdout": holdout, "turns": avg_turns,
            "vsChampion": share, "lo": lo, "hi": hi, "promoted": promoted,
            "rating": prev + gap, "ratingLo": prev + rating_gap(lo, 4.), "ratingHi": prev + rating_gap(hi, 4.), "championRating": rating,
            "vsRandom": vs_random, "gamesPerSec": rate,
            "habits": { "settlements": h(habits.settlements), "cities": h(habits.cities), "roads": h(habits.roads), "cards": h(habits.cards), "knights": h(habits.knights), "bankTrades": h(habits.bank_trades), "longestRoad": h(habits.longest_road), "largestArmy": h(habits.largest_army), "points": h(habits.points) },
            "heat": heat,
        }));
        std::fs::write(&hist_path, serde_json::to_string(&history).unwrap()).unwrap();
        lab.post(&status(&history, serde_json::json!({ "step": format!("Generation {gen} done: {}", if promoted { "promoted" } else { "not yet better: training on" }), "gamesPerSec": rate, "totalGames": total_games, "positions": total_positions, "generation": gen + 1 })));
    }
}

/// now, as an ISO time (UTC), without a date library
fn chrono_now() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let (days, rem) = (s.div_euclid(86400), s.rem_euclid(86400));
    // civil-from-days (Howard Hinnant)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y + (m <= 2) as i64, m, d, rem / 3600, rem % 3600 / 60, rem % 60)
}
