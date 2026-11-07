//! The network as a player, and self-play.
//!
//! A move is chosen by trying each legal move on a copy and asking the network how likely the mover is to win from
//! the position it leads to (an "afterstate", as TD-Gammon chose its moves). Nothing is peeked at: a card being
//! bought is counted but its kind not shown; a steal goes to whoever leads (the card taken can't be known).
//! Discards are chosen a card at a time the same way.

use crate::encode::{encode, FEATURES};
use crate::nn::{quantise, Net, Sample, Scratch};
use crate::*;

/// who plays a seat: a network, or random legal moves (a yardstick)
#[derive(Clone, Copy)]
pub enum Seat<'a> {
    Net(&'a Net),
    Random,
}

pub struct Ctx {
    pub legal: Vec<Action>,
    pub x: Vec<f32>,
    pub best_x: Vec<f32>,
    pub scratch: Option<Scratch>,
    /// bank trades made this turn (turn, count): a player gets a few a turn, so no trading in circles
    pub trades: (u32, u32),
}
impl Ctx {
    pub fn new(net: &Net) -> Ctx {
        Ctx { legal: Vec::with_capacity(128), x: vec![0.; FEATURES], best_x: vec![0.; FEATURES], scratch: Some(net.scratch()), trades: (0, 0) }
    }
}

/// most bank trades a player makes in one turn
pub const TRADES_A_TURN: u32 = 3;

/// the position a move leads to, as p sees it, into ctx.best_x (a card bought: counted, its kind not shown)
fn chosen(g: &Game, p: usize, a: &Action, ctx: &mut Ctx) {
    if *a == Action::Roll || matches!(a, Action::Steal(_)) {
        encode(g, p, 0, &mut ctx.best_x);
        return;
    }
    let mut c = g.clone();
    if *a == Action::BuyCard {
        c.pay(p, &COST_CARD);
        encode(&c, p, 1, &mut ctx.best_x);
    } else {
        c.play(p, a);
        encode(&c, p, 0, &mut ctx.best_x);
    }
}

/// how good a position is for p: 1 or 0 if the game is over, else the network's chance
fn value(g: &Game, p: usize, bought: u32, net: &Net, ctx: &mut Ctx) -> f32 {
    encode(g, p, bought, &mut ctx.x);
    if let Phase::Over { winner } = g.phase {
        return (winner as usize == p) as u8 as f32;
    }
    net.value(&ctx.x, g.players.len(), ctx.scratch.as_mut().unwrap())
}

/// the move p makes, and (for learning from) the position it chose, as p sees it
pub fn decide(g: &Game, p: usize, seat: Seat, explore: f32, pick: &mut Pick, ctx: &mut Ctx) -> Action {
    let net = match seat {
        Seat::Net(n) => n,
        Seat::Random => {
            let a = random_move(g, p, pick, ctx);
            chosen(g, p, &a, ctx);
            return a;
        }
    };
    // a discard: drop cards one at a time, each the one whose loss hurts least
    let owed = g.owed(p);
    if owed > 0 {
        let mut copy = g.clone();
        let mut cards = [0u8; 5];
        for _ in 0..owed {
            let mut best = (f32::MIN, 0usize);
            for r in 0..5 {
                if copy.players[p].hand[r] == 0 {
                    continue;
                }
                let mut c = copy.clone();
                c.players[p].hand[r] -= 1;
                c.bank[r] += 1;
                let v = value(&c, p, 0, net, ctx);
                if v > best.0 {
                    best = (v, r);
                }
            }
            copy.players[p].hand[best.1] -= 1;
            copy.bank[best.1] += 1;
            cards[best.1] += 1;
        }
        let a = Action::Discard(cards);
        let mut after = g.clone();
        after.play(p, &a);
        value(&after, p, 0, net, ctx);
        ctx.best_x.copy_from_slice(&ctx.x);
        return a;
    }
    // a steal: from whoever leads (on points showing, then cards held)
    if let Phase::Steal { victims, .. } = &g.phase {
        let v = *victims.iter().max_by_key(|&&v| (g.victory_points(v as usize, false) * 3 + g.hand_size(v as usize), v)).unwrap();
        encode(g, p, 0, &mut ctx.best_x);
        return Action::Steal(v);
    }
    let mut legal = std::mem::take(&mut ctx.legal);
    g.legal(&mut legal);
    if ctx.trades.0 == g.turn && ctx.trades.1 >= TRADES_A_TURN {
        legal.retain(|a| !matches!(a, Action::BankTrade(..)));
    }
    let explore_now = legal.len() > 1 && (pick.below(1_000_000) as f32) < explore * 1_000_000.;
    let mut best = (f32::MIN, 0usize);
    for (i, a) in legal.iter().enumerate() {
        // (rolling: the position as it stands, before the dice)
        let v = if *a == Action::Roll {
            value(g, p, 0, net, ctx)
        } else if *a == Action::BuyCard {
            let mut c = g.clone();
            c.pay(p, &COST_CARD);
            value(&c, p, 1, net, ctx)
        } else {
            let mut c = g.clone();
            c.play(p, a);
            value(&c, p, 0, net, ctx)
        };
        if v > best.0 {
            best = (v, i);
            ctx.best_x.copy_from_slice(&ctx.x);
        }
    }
    let i = if explore_now { pick.below(legal.len()) } else { best.1 };
    if i != best.1 {
        // (an explored move: what it led to, for learning)
        let a = legal[i].clone();
        chosen(g, p, &a, ctx);
    }
    let a = legal[i].clone();
    ctx.legal = legal;
    a
}

fn random_move(g: &Game, p: usize, pick: &mut Pick, ctx: &mut Ctx) -> Action {
    let owed = g.owed(p);
    if owed > 0 {
        let mut c = [0u8; 5];
        let mut h = g.players[p].hand;
        for _ in 0..owed {
            let have: Vec<usize> = (0..5).filter(|&r| h[r] > 0).collect();
            let r = have[pick.below(have.len())];
            h[r] -= 1;
            c[r] += 1;
        }
        return Action::Discard(c);
    }
    g.legal(&mut ctx.legal);
    if ctx.trades.0 == g.turn && ctx.trades.1 >= TRADES_A_TURN {
        ctx.legal.retain(|a| !matches!(a, Action::BankTrade(..)));
    }
    let builds = ctx.legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).count();
    if builds > 0 && pick.below(10) < 8 {
        let k = pick.below(builds);
        ctx.legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).nth(k).unwrap().clone()
    } else {
        ctx.legal[pick.below(ctx.legal.len())].clone()
    }
}

/// what one player did in a game (for the lab's "how it plays")
#[derive(Clone, Default, Debug)]
pub struct Habits {
    pub settlements: u32,
    pub cities: u32,
    pub roads: u32,
    pub cards: u32,
    pub knights: u32,
    pub bank_trades: u32,
    pub longest_road: u32,
    pub largest_army: u32,
    pub points: u32,
}
impl Habits {
    pub fn add(&mut self, o: &Habits) {
        self.settlements += o.settlements;
        self.cities += o.cities;
        self.roads += o.roads;
        self.cards += o.cards;
        self.knights += o.knights;
        self.bank_trades += o.bank_trades;
        self.longest_road += o.longest_road;
        self.largest_army += o.largest_army;
        self.points += o.points;
    }
}

pub struct Played {
    /// the winner's place in the turn order, if the game finished
    pub winner: Option<usize>,
    pub turns: u32,
    pub samples: Vec<Sample>,
    /// by place in the turn order
    pub habits: Vec<Habits>,
    /// by place in the turn order: which of the given seats played there
    pub seat_of: Vec<u8>,
}

/// one whole game. `seats[i]` plays whoever drew seat i (seats are shuffled at the start, as in the game).
pub fn play_game(players: usize, seed: i32, seats: &[Seat], explore: f32, record: bool, pick: &mut Pick, ctx: &mut Ctx) -> Played {
    let mut g = Game::new(players, seed);
    ctx.trades = (u32::MAX, 0);
    let mut taken: Vec<(Vec<u8>, usize)> = vec![];
    let mut habits = vec![Habits::default(); players];
    for _ in 0..6000 {
        let Some(p) = g.actor() else { break };
        let seat = seats[g.players[p].seat as usize];
        let a = decide(&g, p, seat, explore, pick, ctx);
        if record {
            taken.push((quantise(&ctx.best_x), p));
        }
        if matches!(a, Action::BankTrade(..)) {
            ctx.trades = if ctx.trades.0 == g.turn { (g.turn, ctx.trades.1 + 1) } else { (g.turn, 1) };
        }
        let main = g.phase == Phase::Main;
        match a {
            Action::BuildSettlement(_) if main => habits[p].settlements += 1,
            Action::BuildCity(_) => habits[p].cities += 1,
            Action::BuildRoad(_) if main => habits[p].roads += 1,
            Action::BuyCard => habits[p].cards += 1,
            Action::PlayKnight => habits[p].knights += 1,
            Action::BankTrade(..) => habits[p].bank_trades += 1,
            _ => {}
        }
        g.play(p, &a);
    }
    let winner = if let Phase::Over { winner } = g.phase { Some(winner as usize) } else { None };
    for i in 0..players {
        habits[i].longest_road = (g.longest_road == i as i8) as u32;
        habits[i].largest_army = (g.largest_army == i as i8) as u32;
        habits[i].points = g.victory_points(i, true);
    }
    let samples = match winner {
        Some(w) => taken.into_iter().map(|(x, p)| Sample { x, winner: ((w + players - p) % players) as u8, players: players as u8 }).collect(),
        None => vec![],
    };
    Played { winner, turns: g.turn, samples, habits, seat_of: g.players.iter().map(|p| p.seat).collect() }
}

/// the network's value of each corner as a first settlement, on a board (player 0 to place)
pub fn opening_values(net: &Net, players: usize, seed: i32) -> Vec<(u8, f32)> {
    let g = Game::new(players, seed);
    let mut ctx = Ctx::new(net);
    let mut spots = vec![];
    g.settlement_spots(0, &mut spots);
    spots
        .iter()
        .map(|&v| {
            let mut c = g.clone();
            c.play(0, &Action::BuildSettlement(v));
            (v, value(&c, 0, 0, net, &mut ctx))
        })
        .collect()
}
