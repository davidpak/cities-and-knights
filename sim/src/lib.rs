//! A fast copy of the base game's rules (shared/engine.ts), for self-play.
//!
//! It must play exactly the same game: the same random-number generator stepped in the same order (dealing the
//! board, the card pile, the seats, the dice, the fan a robbed hand is spread in, the card taken), and the same
//! rules. `cargo run --release --bin parity` writes games played here; `npx tsx sim/parity.ts` replays every move
//! through the real engine and checks the whole state after each one.
//!
//! Not here (yet): trades between players, sneaking cards, the expansion.

use serde::Deserialize;
use std::sync::OnceLock;

// ---------------------------------------------------------------- the board

#[derive(Deserialize)]
struct HexJ {
    vertices: Vec<u8>,
    neighbors: Vec<u8>,
}
#[derive(Deserialize)]
struct VertexJ {
    hexes: Vec<u8>,
    neighbors: Vec<u8>,
    edges: Vec<u8>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopoJ {
    hexes: Vec<HexJ>,
    vertices: Vec<VertexJ>,
    edges: Vec<[u8; 2]>,
    harbors: Vec<u8>,
    tile_set: Vec<String>,
    number_set: Vec<u8>,
    harbor_set: Vec<String>,
    card_set: Vec<String>,
}

pub const HEXES: usize = 19;
pub const VERTS: usize = 54;
pub const EDGES: usize = 72;

/// the board's layout, from the same source the game uses (sim/topo.json, written by sim/export-topo.ts)
pub struct Topo {
    pub hex_vertices: [[u8; 6]; HEXES],
    pub hex_neighbors: Vec<Vec<u8>>,
    pub vert_hexes: Vec<Vec<u8>>,
    pub vert_neighbors: Vec<Vec<u8>>,
    pub vert_edges: Vec<Vec<u8>>,
    pub edges: [[u8; 2]; EDGES],
    pub harbors: Vec<u8>,
    pub tile_set: Vec<u8>,
    pub number_set: Vec<u8>,
    pub harbor_set: Vec<u8>,
    pub card_set: Vec<u8>,
}

pub const TERRAINS: [&str; 6] = ["forest", "pasture", "fields", "hills", "mountains", "desert"];
pub const DESERT: u8 = 5;
pub const RES: [&str; 5] = ["lumber", "brick", "wool", "grain", "ore"];
pub const CARDS: [&str; 5] = ["knight", "victoryPoint", "roadBuilding", "yearOfPlenty", "monopoly"];
pub const KNIGHT: u8 = 0;
pub const VP_CARD: u8 = 1;
pub const ROAD_BUILDING: u8 = 2;
pub const PLENTY: u8 = 3;
pub const MONOPOLY: u8 = 4;
/// a harbour that takes any resource, 3:1
pub const ANY: u8 = 5;

/// the resource a terrain yields (forest lumber, pasture wool, fields grain, hills brick, mountains ore)
pub const YIELD: [u8; 5] = [0, 2, 3, 1, 4];

pub fn topo() -> &'static Topo {
    static T: OnceLock<Topo> = OnceLock::new();
    T.get_or_init(|| {
        let j: TopoJ = serde_json::from_str(include_str!("../topo.json")).expect("topo.json");
        let idx = |list: &[&str], s: &str| list.iter().position(|x| *x == s).unwrap_or_else(|| panic!("unknown {s}")) as u8;
        let mut hex_vertices = [[0u8; 6]; HEXES];
        for (i, h) in j.hexes.iter().enumerate() {
            hex_vertices[i].copy_from_slice(&h.vertices);
        }
        let mut edges = [[0u8; 2]; EDGES];
        for (i, e) in j.edges.iter().enumerate() {
            edges[i] = *e;
        }
        let mut harbor_kinds: Vec<&str> = RES.to_vec();
        harbor_kinds.push("any");
        Topo {
            hex_vertices,
            hex_neighbors: j.hexes.iter().map(|h| h.neighbors.clone()).collect(),
            vert_hexes: j.vertices.iter().map(|v| v.hexes.clone()).collect(),
            vert_neighbors: j.vertices.iter().map(|v| v.neighbors.clone()).collect(),
            vert_edges: j.vertices.iter().map(|v| v.edges.clone()).collect(),
            edges,
            harbors: j.harbors.clone(),
            tile_set: j.tile_set.iter().map(|s| idx(&TERRAINS, s)).collect(),
            number_set: j.number_set.clone(),
            harbor_set: j.harbor_set.iter().map(|s| idx(&harbor_kinds, s)).collect(),
            card_set: j.card_set.iter().map(|s| idx(&CARDS, s)).collect(),
        }
    })
}

// ---------------------------------------------------------------- the rules' numbers

pub const BANK_EACH: u8 = 19;
pub const WIN_POINTS: u32 = 10;
pub const HAND_LIMIT: u32 = 7;
pub const LONGEST_ROAD_MIN: u32 = 5;
pub const LARGEST_ARMY_MIN: u8 = 3;
pub const COST_ROAD: [u8; 5] = [1, 1, 0, 0, 0];
pub const COST_SETTLEMENT: [u8; 5] = [1, 1, 1, 1, 0];
pub const COST_CITY: [u8; 5] = [0, 0, 0, 2, 3];
pub const COST_CARD: [u8; 5] = [0, 0, 1, 1, 1];

// ---------------------------------------------------------------- the state

pub const NO: i8 = -1;

#[derive(Clone, Debug, PartialEq)]
pub struct Player {
    /// which seat (of those given to new_game) this player is: seats are shuffled
    pub seat: u8,
    pub hand: [u8; 5],
    /// development cards held: (card, the turn it was bought)
    pub cards: Vec<(u8, u32)>,
    pub knights: u8,
    pub roads: u8,
    pub settlements: u8,
    pub cities: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum After {
    Roll,
    Main,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Phase {
    Setup { round: u8, road: bool, settlement: i8 },
    Roll,
    Main,
    /// owed per player (0: nothing owed); then the robber (in the base game a 7 always moves it)
    Discard { owed: [u8; 4] },
    Robber { then: After },
    /// victims in seat order, each with the fan their hand is spread in
    Steal { hex: u8, victims: Vec<u8>, fans: Vec<Vec<u8>>, then: After },
    RoadBuilding { left: u8 },
    Over { winner: u8 },
}

#[derive(Clone, Debug)]
pub struct Game {
    pub rng: u32,
    pub terrain: [u8; HEXES],
    /// 0 for the desert
    pub number: [u8; HEXES],
    /// (edge, kind) for each harbour
    pub harbors: Vec<(u8, u8)>,
    pub players: Vec<Player>,
    /// owner of the building on each corner (NO: none), and its kind (1 settlement, 2 city)
    pub owner: [i8; VERTS],
    pub kind: [u8; VERTS],
    pub road: [i8; EDGES],
    pub robber: u8,
    pub bank: [u8; 5],
    pub pile: Vec<u8>,
    pub current: u8,
    pub turn: u32,
    pub phase: Phase,
    pub dice: Option<(u8, u8)>,
    pub card_played: bool,
    pub longest_road: i8,
    pub largest_army: i8,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    BuildSettlement(u8),
    BuildRoad(u8),
    BuildCity(u8),
    Roll,
    Discard([u8; 5]),
    MoveRobber(u8),
    Steal(u8),
    BuyCard,
    PlayKnight,
    PlayRoadBuilding,
    PlayYearOfPlenty(u8, u8),
    PlayMonopoly(u8),
    BankTrade(u8, u8),
    EndTurn,
}

type R = Result<(), &'static str>;

impl Game {
    /// mulberry32, stepped exactly as the engine steps it
    fn rand(&mut self) -> f64 {
        self.rng = self.rng.wrapping_add(0x6d2b79f5);
        let mut t = self.rng;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.rand() * n as f64).floor() as usize
    }
    fn shuffle<T: Clone>(&mut self, a: &[T]) -> Vec<T> {
        let mut out = a.to_vec();
        for i in (1..out.len()).rev() {
            let j = self.below(i + 1);
            out.swap(i, j);
        }
        out
    }

    pub fn new(players: usize, seed: i32) -> Game {
        assert!((2..=4).contains(&players));
        let t = topo();
        let mut g = Game {
            rng: seed as u32,
            terrain: [0; HEXES],
            number: [0; HEXES],
            harbors: vec![],
            players: vec![],
            owner: [NO; VERTS],
            kind: [0; VERTS],
            road: [NO; EDGES],
            robber: 0,
            bank: [BANK_EACH; 5],
            pile: vec![],
            current: 0,
            turn: 0,
            phase: Phase::Setup { round: 1, road: false, settlement: NO },
            dice: None,
            card_played: false,
            longest_road: NO,
            largest_army: NO,
        };
        // tiles and numbers, dealt again until no two red numbers touch and no two touching tiles share a number
        loop {
            let terrains = g.shuffle(&t.tile_set);
            let numbers = g.shuffle(&t.number_set);
            let mut n = 0;
            for i in 0..HEXES {
                g.terrain[i] = terrains[i];
                g.number[i] = if terrains[i] == DESERT { 0 } else { n += 1; numbers[n - 1] };
            }
            let red = |g: &Game, i: usize| g.number[i] == 6 || g.number[i] == 8;
            let ok = (0..HEXES).all(|i| t.hex_neighbors[i].iter().all(|&j| {
                let j = j as usize;
                !(red(&g, i) && red(&g, j)) && (g.number[i] == 0 || g.number[i] != g.number[j])
            }));
            if ok {
                break;
            }
        }
        g.robber = g.terrain.iter().position(|&x| x == DESERT).unwrap() as u8;
        let kinds = g.shuffle(&t.harbor_set);
        g.harbors = kinds.iter().enumerate().map(|(i, &k)| (t.harbors[i], k)).collect();
        g.pile = g.shuffle(&t.card_set);
        let seats: Vec<u8> = (0..players as u8).collect();
        let order = g.shuffle(&seats);
        g.players = order
            .iter()
            .map(|&seat| Player { seat, hand: [0; 5], cards: vec![], knights: 0, roads: 15, settlements: 5, cities: 4 })
            .collect();
        g
    }

    // ------------------------------------------------------------ reading

    pub fn hand_size(&self, p: usize) -> u32 {
        self.players[p].hand.iter().map(|&x| x as u32).sum()
    }
    fn has(h: &[u8; 5], cost: &[u8; 5]) -> bool {
        (0..5).all(|r| h[r] >= cost[r])
    }
    pub fn victory_points(&self, p: usize, hidden: bool) -> u32 {
        let mut vp = 0;
        for v in 0..VERTS {
            if self.owner[v] == p as i8 {
                vp += self.kind[v] as u32;
            }
        }
        if self.longest_road == p as i8 {
            vp += 2;
        }
        if self.largest_army == p as i8 {
            vp += 2;
        }
        if hidden {
            vp += self.players[p].cards.iter().filter(|c| c.0 == VP_CARD).count() as u32;
        }
        vp
    }
    pub fn ratios(&self, p: usize) -> [u8; 5] {
        let t = topo();
        let mut out = [4u8; 5];
        for &(e, k) in &self.harbors {
            let [a, b] = t.edges[e as usize];
            if self.owner[a as usize] != p as i8 && self.owner[b as usize] != p as i8 {
                continue;
            }
            for r in 0..5 {
                out[r] = out[r].min(if k == ANY { 3 } else if k as usize == r { 2 } else { 4 });
            }
        }
        out
    }
    fn road_touches(&self, p: usize, v: usize) -> bool {
        topo().vert_edges[v].iter().any(|&e| self.road[e as usize] == p as i8)
    }
    fn blocked_for(&self, p: usize, v: usize) -> bool {
        self.owner[v] != NO && self.owner[v] != p as i8
    }
    pub fn settlement_spots(&self, p: usize, out: &mut Vec<u8>) {
        let t = topo();
        let setup = matches!(self.phase, Phase::Setup { .. });
        out.clear();
        for v in 0..VERTS {
            if self.owner[v] != NO || t.vert_neighbors[v].iter().any(|&n| self.owner[n as usize] != NO) {
                continue;
            }
            if setup || self.road_touches(p, v) {
                out.push(v as u8);
            }
        }
    }
    pub fn road_spots(&self, p: usize, out: &mut Vec<u8>) {
        let t = topo();
        out.clear();
        if let Phase::Setup { settlement, .. } = self.phase {
            if settlement == NO {
                return;
            }
            for &e in &t.vert_edges[settlement as usize] {
                if self.road[e as usize] == NO {
                    out.push(e);
                }
            }
            return;
        }
        for e in 0..EDGES {
            if self.road[e] != NO {
                continue;
            }
            let ok = t.edges[e].iter().any(|&v| {
                let v = v as usize;
                self.owner[v] == p as i8 || (!self.blocked_for(p, v) && self.road_touches(p, v))
            });
            if ok {
                out.push(e as u8);
            }
        }
    }
    fn can_play(&self, p: usize, card: u8) -> bool {
        !self.card_played && self.players[p].cards.iter().any(|c| c.0 == card && c.1 < self.turn)
    }
    fn victims_at(&self, hex: usize, thief: usize) -> Vec<u8> {
        let mut out: Vec<u8> = vec![];
        for &v in &topo().hex_vertices[hex] {
            let o = self.owner[v as usize];
            if o != NO && o as usize != thief && self.hand_size(o as usize) > 0 && !out.contains(&(o as u8)) {
                out.push(o as u8);
            }
        }
        out.sort();
        out
    }
    /// the longest single run of p's roads (another player's building cuts a run)
    pub fn longest_run(&self, p: usize) -> u32 {
        let t = topo();
        let mut used = [false; EDGES];
        let mut best = 0;
        fn walk(g: &Game, t: &Topo, p: usize, v: usize, len: u32, used: &mut [bool; EDGES], best: &mut u32) {
            if len > *best {
                *best = len;
            }
            if g.blocked_for(p, v) {
                return;
            }
            for &e in &t.vert_edges[v] {
                let e = e as usize;
                if g.road[e] != p as i8 || used[e] {
                    continue;
                }
                used[e] = true;
                let [a, b] = t.edges[e];
                let to = if a as usize == v { b } else { a };
                walk(g, t, p, to as usize, len + 1, used, best);
                used[e] = false;
            }
        }
        for e in 0..EDGES {
            if self.road[e] != p as i8 {
                continue;
            }
            for &to in &t.edges[e] {
                used[e] = true;
                walk(self, t, p, to as usize, 1, &mut used, &mut best);
                used[e] = false;
            }
        }
        best
    }

    /// who must move now: the first player owing a discard, else the current player
    pub fn actor(&self) -> Option<usize> {
        match &self.phase {
            Phase::Over { .. } => None,
            Phase::Discard { owed } => owed.iter().position(|&n| n > 0),
            _ => Some(self.current as usize),
        }
    }

    // ------------------------------------------------------------ changing

    fn pay(&mut self, p: usize, cost: &[u8; 5]) {
        for r in 0..5 {
            self.players[p].hand[r] -= cost[r];
            self.bank[r] += cost[r];
        }
    }
    fn update_longest_road(&mut self) {
        let runs: Vec<u32> = (0..self.players.len()).map(|i| self.longest_run(i)).collect();
        let max = *runs.iter().max().unwrap();
        let before = self.longest_road;
        if max < LONGEST_ROAD_MIN {
            self.longest_road = NO;
        } else if before != NO && runs[before as usize] == max {
        } else {
            let top: Vec<usize> = (0..runs.len()).filter(|&i| runs[i] == max).collect();
            self.longest_road = if top.len() == 1 { top[0] as i8 } else { NO };
        }
    }
    fn produce(&mut self, roll: u8) {
        let t = topo();
        let n = self.players.len();
        let mut owed = [[0u8; 5]; 4];
        for h in 0..HEXES {
            if self.terrain[h] == DESERT || self.number[h] != roll || h == self.robber as usize {
                continue;
            }
            let r = YIELD[self.terrain[h] as usize] as usize;
            for &v in &t.hex_vertices[h] {
                let o = self.owner[v as usize];
                if o == NO {
                    continue;
                }
                owed[o as usize][r] += self.kind[v as usize];
            }
        }
        for r in 0..5 {
            let takers: Vec<usize> = (0..n).filter(|&i| owed[i][r] > 0).collect();
            let total: u32 = takers.iter().map(|&i| owed[i][r] as u32).sum();
            if total == 0 {
                continue;
            }
            if total <= self.bank[r] as u32 {
                for &i in &takers {
                    self.players[i].hand[r] += owed[i][r];
                    self.bank[r] -= owed[i][r];
                }
            } else if takers.len() == 1 {
                self.players[takers[0]].hand[r] += self.bank[r];
                self.bank[r] = 0;
            }
        }
    }
    fn start_turn(&mut self) {
        self.phase = Phase::Roll;
        self.dice = None;
        self.card_played = false;
    }
    fn after_robber(&mut self, hex: u8, then: After) {
        let victims = self.victims_at(hex as usize, self.current as usize);
        if victims.is_empty() {
            self.phase = if then == After::Roll { Phase::Roll } else { Phase::Main };
            return;
        }
        let mut fans = vec![];
        for &v in &victims {
            let bag = self.bag(v as usize);
            fans.push(self.shuffle(&bag));
        }
        self.phase = Phase::Steal { hex, victims, fans, then };
    }
    fn bag(&self, p: usize) -> Vec<u8> {
        let mut out = vec![];
        for r in 0..5 {
            for _ in 0..self.players[p].hand[r] {
                out.push(r as u8);
            }
        }
        out
    }
    fn check_win(&mut self) {
        if matches!(self.phase, Phase::Over { .. }) {
            return;
        }
        let p = self.current as usize;
        if self.victory_points(p, true) >= WIN_POINTS {
            self.phase = Phase::Over { winner: p as u8 };
        }
    }

    /// a move by player p; Err when the rules say no (and then nothing has changed)
    pub fn apply(&mut self, p: usize, a: &Action) -> R {
        let before = self.clone();
        let r = self.step(p, a);
        if r.is_err() {
            *self = before;
            return r;
        }
        self.check_win();
        Ok(())
    }

    /// as apply, for a move known to be legal (no copy kept: faster)
    pub fn play(&mut self, p: usize, a: &Action) {
        let r = self.step(p, a);
        debug_assert!(r.is_ok(), "{a:?}: {r:?}");
        self.check_win();
    }

    fn step(&mut self, p: usize, a: &Action) -> R {
        if matches!(self.phase, Phase::Over { .. }) {
            return Err("over");
        }
        if p >= self.players.len() {
            return Err("no such player");
        }
        let t = topo();
        if let Action::Discard(cards) = a {
            let Phase::Discard { owed } = &self.phase else { return Err("nothing to discard") };
            let need = owed[p];
            if need == 0 {
                return Err("nothing to discard");
            }
            let n: u32 = cards.iter().map(|&x| x as u32).sum();
            if n != need as u32 {
                return Err("discard exactly");
            }
            if !Game::has(&self.players[p].hand, cards) {
                return Err("not your cards");
            }
            let cards = *cards;
            self.pay(p, &cards);
            let Phase::Discard { owed } = &mut self.phase else { unreachable!() };
            owed[p] = 0;
            if owed.iter().all(|&x| x == 0) {
                self.phase = Phase::Robber { then: After::Main };
            }
            return Ok(());
        }
        if p != self.current as usize {
            return Err("not your turn");
        }
        let mut spots = Vec::with_capacity(72);
        match a {
            Action::BuildSettlement(v) => {
                let v = *v as usize;
                if let Phase::Setup { round, road, .. } = self.phase {
                    if road {
                        return Err("road first");
                    }
                    self.settlement_spots(p, &mut spots);
                    if !spots.contains(&(v as u8)) {
                        return Err("cannot build there");
                    }
                    self.owner[v] = p as i8;
                    self.kind[v] = 1;
                    self.players[p].settlements -= 1;
                    if round == 2 {
                        for &h in &t.vert_hexes[v] {
                            let h = h as usize;
                            if self.terrain[h] == DESERT {
                                continue;
                            }
                            let r = YIELD[self.terrain[h] as usize] as usize;
                            if self.bank[r] > 0 {
                                self.players[p].hand[r] += 1;
                                self.bank[r] -= 1;
                            }
                        }
                    }
                    self.phase = Phase::Setup { round, road: true, settlement: v as i8 };
                    return Ok(());
                }
                if self.phase != Phase::Main {
                    return Err("cannot build now");
                }
                if self.players[p].settlements == 0 {
                    return Err("no settlements left");
                }
                if !Game::has(&self.players[p].hand, &COST_SETTLEMENT) {
                    return Err("cannot afford");
                }
                self.settlement_spots(p, &mut spots);
                if !spots.contains(&(v as u8)) {
                    return Err("cannot build there");
                }
                self.pay(p, &COST_SETTLEMENT);
                self.owner[v] = p as i8;
                self.kind[v] = 1;
                self.players[p].settlements -= 1;
                self.update_longest_road();
                Ok(())
            }
            Action::BuildRoad(e) => {
                let e = *e as usize;
                if let Phase::Setup { round, road, .. } = self.phase {
                    if !road {
                        return Err("settlement first");
                    }
                    self.road_spots(p, &mut spots);
                    if !spots.contains(&(e as u8)) {
                        return Err("must touch the settlement");
                    }
                    self.road[e] = p as i8;
                    self.players[p].roads -= 1;
                    let n = self.players.len() as u8;
                    if round == 1 {
                        if self.current < n - 1 {
                            self.current += 1;
                            self.phase = Phase::Setup { round: 1, road: false, settlement: NO };
                        } else {
                            self.phase = Phase::Setup { round: 2, road: false, settlement: NO };
                        }
                    } else if self.current > 0 {
                        self.current -= 1;
                        self.phase = Phase::Setup { round: 2, road: false, settlement: NO };
                    } else {
                        self.turn = 1;
                        self.start_turn();
                    }
                    return Ok(());
                }
                if let Phase::RoadBuilding { left } = self.phase {
                    self.road_spots(p, &mut spots);
                    if !spots.contains(&(e as u8)) {
                        return Err("cannot build a road there");
                    }
                    self.road[e] = p as i8;
                    self.players[p].roads -= 1;
                    let left = left - 1;
                    self.road_spots(p, &mut spots);
                    self.phase = if left > 0 && self.players[p].roads > 0 && !spots.is_empty() { Phase::RoadBuilding { left } } else { Phase::Main };
                    self.update_longest_road();
                    return Ok(());
                }
                if self.phase != Phase::Main {
                    return Err("cannot build now");
                }
                if self.players[p].roads == 0 {
                    return Err("no roads left");
                }
                if !Game::has(&self.players[p].hand, &COST_ROAD) {
                    return Err("cannot afford");
                }
                self.road_spots(p, &mut spots);
                if !spots.contains(&(e as u8)) {
                    return Err("cannot build a road there");
                }
                self.pay(p, &COST_ROAD);
                self.road[e] = p as i8;
                self.players[p].roads -= 1;
                self.update_longest_road();
                Ok(())
            }
            Action::BuildCity(v) => {
                let v = *v as usize;
                if self.phase != Phase::Main {
                    return Err("cannot build now");
                }
                if self.players[p].cities == 0 {
                    return Err("no cities left");
                }
                if !Game::has(&self.players[p].hand, &COST_CITY) {
                    return Err("cannot afford");
                }
                if !(self.owner[v] == p as i8 && self.kind[v] == 1) {
                    return Err("must replace a settlement");
                }
                self.pay(p, &COST_CITY);
                self.kind[v] = 2;
                self.players[p].cities -= 1;
                self.players[p].settlements += 1;
                Ok(())
            }
            Action::Roll => {
                if self.phase != Phase::Roll {
                    return Err("already rolled");
                }
                let d1 = 1 + self.below(6) as u8;
                let d2 = 1 + self.below(6) as u8;
                self.dice = Some((d1, d2));
                let total = d1 + d2;
                if total != 7 {
                    self.produce(total);
                    self.phase = Phase::Main;
                    return Ok(());
                }
                let mut owed = [0u8; 4];
                for i in 0..self.players.len() {
                    let n = self.hand_size(i);
                    if n > HAND_LIMIT {
                        owed[i] = (n / 2) as u8;
                    }
                }
                self.phase = if owed.iter().any(|&x| x > 0) { Phase::Discard { owed } } else { Phase::Robber { then: After::Main } };
                Ok(())
            }
            Action::MoveRobber(h) => {
                let Phase::Robber { then } = self.phase else { return Err("not now") };
                if *h as usize >= HEXES || *h == self.robber {
                    return Err("a different tile");
                }
                self.robber = *h;
                self.after_robber(*h, then);
                Ok(())
            }
            Action::Steal(v) => {
                let Phase::Steal { victims, fans, then, .. } = &self.phase else { return Err("nobody to steal from") };
                let Some(i) = victims.iter().position(|x| x == v) else { return Err("pick someone next to the robber") };
                let then = *then;
                let fan = fans[i].clone();
                let vi = *v as usize;
                // (the fan stands if it still holds exactly their hand; else a fresh bag)
                let mut h = self.players[vi].hand;
                let same = fan.len() as u32 == self.hand_size(vi) && {
                    for &c in &fan {
                        if h[c as usize] == 0 {
                            break;
                        }
                        h[c as usize] -= 1;
                    }
                    h.iter().all(|&x| x == 0)
                };
                let bag = if same { fan } else { self.bag(vi) };
                if !bag.is_empty() {
                    let r = bag[self.below(bag.len())] as usize;
                    self.players[vi].hand[r] -= 1;
                    self.players[p].hand[r] += 1;
                }
                self.phase = if then == After::Roll { Phase::Roll } else { Phase::Main };
                Ok(())
            }
            Action::BuyCard => {
                if self.phase != Phase::Main {
                    return Err("cannot buy now");
                }
                if self.pile.is_empty() {
                    return Err("no cards left");
                }
                if !Game::has(&self.players[p].hand, &COST_CARD) {
                    return Err("cannot afford");
                }
                self.pay(p, &COST_CARD);
                let c = self.pile.pop().unwrap();
                let turn = self.turn;
                self.players[p].cards.push((c, turn));
                Ok(())
            }
            Action::PlayKnight | Action::PlayRoadBuilding | Action::PlayYearOfPlenty(..) | Action::PlayMonopoly(_) => {
                let card = match a {
                    Action::PlayKnight => KNIGHT,
                    Action::PlayRoadBuilding => ROAD_BUILDING,
                    Action::PlayYearOfPlenty(..) => PLENTY,
                    _ => MONOPOLY,
                };
                let when = if card == KNIGHT { self.phase == Phase::Roll || self.phase == Phase::Main } else { self.phase == Phase::Main };
                if !when {
                    return Err("cannot play now");
                }
                if self.card_played {
                    return Err("already played a card");
                }
                if !self.can_play(p, card) {
                    return Err("no such card");
                }
                if let Action::PlayYearOfPlenty(x, y) = a {
                    if *x > 4 || *y > 4 {
                        return Err("two resources");
                    }
                    let mut need = [0u8; 5];
                    need[*x as usize] += 1;
                    need[*y as usize] += 1;
                    if !Game::has(&self.bank, &need) {
                        return Err("the bank has not those");
                    }
                }
                if let Action::PlayMonopoly(r) = a {
                    if *r > 4 {
                        return Err("a resource");
                    }
                }
                if *a == Action::PlayRoadBuilding {
                    self.road_spots(p, &mut spots);
                    if self.players[p].roads == 0 || spots.is_empty() {
                        return Err("nowhere to build a road");
                    }
                }
                let turn = self.turn;
                let i = self.players[p].cards.iter().position(|c| c.0 == card && c.1 < turn).unwrap();
                self.players[p].cards.remove(i);
                self.card_played = true;
                match a {
                    Action::PlayKnight => {
                        self.players[p].knights += 1;
                        let k = self.players[p].knights;
                        let holder = self.largest_army;
                        if k >= LARGEST_ARMY_MIN && holder != p as i8 && (holder == NO || k > self.players[holder as usize].knights) {
                            self.largest_army = p as i8;
                        }
                        let then = if self.phase == Phase::Roll { After::Roll } else { After::Main };
                        self.phase = Phase::Robber { then };
                    }
                    Action::PlayRoadBuilding => self.phase = Phase::RoadBuilding { left: 2 },
                    Action::PlayYearOfPlenty(x, y) => {
                        for r in [*x, *y] {
                            self.players[p].hand[r as usize] += 1;
                            self.bank[r as usize] -= 1;
                        }
                    }
                    Action::PlayMonopoly(r) => {
                        let r = *r as usize;
                        for i in 0..self.players.len() {
                            if i == p {
                                continue;
                            }
                            let n = self.players[i].hand[r];
                            self.players[p].hand[r] += n;
                            self.players[i].hand[r] = 0;
                        }
                    }
                    _ => unreachable!(),
                }
                Ok(())
            }
            Action::BankTrade(give, get) => {
                if self.phase != Phase::Main {
                    return Err("cannot trade now");
                }
                if *give > 4 || *get > 4 || give == get {
                    return Err("two different kinds");
                }
                let ratio = self.ratios(p)[*give as usize];
                if self.players[p].hand[*give as usize] < ratio {
                    return Err("not enough");
                }
                if self.bank[*get as usize] == 0 {
                    return Err("the bank has none");
                }
                self.players[p].hand[*give as usize] -= ratio;
                self.bank[*give as usize] += ratio;
                self.players[p].hand[*get as usize] += 1;
                self.bank[*get as usize] -= 1;
                Ok(())
            }
            Action::EndTurn => {
                if self.phase != Phase::Main {
                    return Err("not now");
                }
                self.current = (self.current + 1) % self.players.len() as u8;
                self.turn += 1;
                self.start_turn();
                Ok(())
            }
            Action::Discard(_) => unreachable!(),
        }
    }

    /// every legal move for the player who must move (a discard: not listed, it's a choice of cards; see `discards`)
    pub fn legal(&self, out: &mut Vec<Action>) {
        out.clear();
        let Some(p) = self.actor() else { return };
        let mut spots = Vec::with_capacity(72);
        let me = &self.players[p];
        match &self.phase {
            Phase::Over { .. } | Phase::Discard { .. } => {}
            Phase::Setup { road, .. } => {
                if *road {
                    self.road_spots(p, &mut spots);
                    out.extend(spots.iter().map(|&e| Action::BuildRoad(e)));
                } else {
                    self.settlement_spots(p, &mut spots);
                    out.extend(spots.iter().map(|&v| Action::BuildSettlement(v)));
                }
            }
            Phase::Roll => {
                out.push(Action::Roll);
                if self.can_play(p, KNIGHT) {
                    out.push(Action::PlayKnight);
                }
            }
            Phase::Robber { .. } => out.extend((0..HEXES as u8).filter(|&h| h != self.robber).map(Action::MoveRobber)),
            Phase::Steal { victims, .. } => out.extend(victims.iter().map(|&v| Action::Steal(v))),
            Phase::RoadBuilding { .. } => {
                self.road_spots(p, &mut spots);
                out.extend(spots.iter().map(|&e| Action::BuildRoad(e)));
            }
            Phase::Main => {
                if me.settlements > 0 && Game::has(&me.hand, &COST_SETTLEMENT) {
                    self.settlement_spots(p, &mut spots);
                    out.extend(spots.iter().map(|&v| Action::BuildSettlement(v)));
                }
                if me.cities > 0 && Game::has(&me.hand, &COST_CITY) {
                    out.extend((0..VERTS as u8).filter(|&v| self.owner[v as usize] == p as i8 && self.kind[v as usize] == 1).map(Action::BuildCity));
                }
                if me.roads > 0 && Game::has(&me.hand, &COST_ROAD) {
                    self.road_spots(p, &mut spots);
                    out.extend(spots.iter().map(|&e| Action::BuildRoad(e)));
                }
                if !self.pile.is_empty() && Game::has(&me.hand, &COST_CARD) {
                    out.push(Action::BuyCard);
                }
                if self.can_play(p, KNIGHT) {
                    out.push(Action::PlayKnight);
                }
                if self.can_play(p, ROAD_BUILDING) && me.roads > 0 {
                    self.road_spots(p, &mut spots);
                    if !spots.is_empty() {
                        out.push(Action::PlayRoadBuilding);
                    }
                }
                if self.can_play(p, PLENTY) {
                    for x in 0..5u8 {
                        for y in x..5u8 {
                            let ok = if x == y { self.bank[x as usize] >= 2 } else { self.bank[x as usize] >= 1 && self.bank[y as usize] >= 1 };
                            if ok {
                                out.push(Action::PlayYearOfPlenty(x, y));
                            }
                        }
                    }
                }
                if self.can_play(p, MONOPOLY) {
                    out.extend((0..5).map(Action::PlayMonopoly));
                }
                let ratios = self.ratios(p);
                for give in 0..5u8 {
                    if me.hand[give as usize] < ratios[give as usize] {
                        continue;
                    }
                    for get in 0..5u8 {
                        if get != give && self.bank[get as usize] > 0 {
                            out.push(Action::BankTrade(give, get));
                        }
                    }
                }
                out.push(Action::EndTurn);
            }
        }
    }

    /// how many cards player p owes in a discard (0: none)
    pub fn owed(&self, p: usize) -> u8 {
        match &self.phase {
            Phase::Discard { owed } => owed[p],
            _ => 0,
        }
    }

    // ------------------------------------------------------------ the fingerprint the parity check compares

    /// the whole state, written the same way the TypeScript side writes it (sim/parity.ts)
    pub fn canonical(&self) -> String {
        use std::fmt::Write;
        let mut s = String::with_capacity(1024);
        let then = |a: After| if a == After::Roll { "r" } else { "m" };
        let _ = write!(s, "{};", self.rng as i32);
        for h in 0..HEXES {
            let _ = write!(s, "{}:{},", self.terrain[h], self.number[h]);
        }
        s.push(';');
        for (e, k) in &self.harbors {
            let _ = write!(s, "{e}:{k},");
        }
        let _ = write!(s, ";{:?};{};{};{};", self.bank, self.robber, self.current, self.turn);
        match &self.phase {
            Phase::Setup { round, road, settlement } => {
                let _ = write!(s, "S{round}{}{}", if *road { "r" } else { "s" }, settlement);
            }
            Phase::Roll => s.push('R'),
            Phase::Main => s.push('M'),
            Phase::Discard { owed } => {
                s.push('D');
                for (i, &n) in owed.iter().enumerate() {
                    if n > 0 {
                        let _ = write!(s, "{i}={n},");
                    }
                }
            }
            Phase::Robber { then: t } => {
                let _ = write!(s, "B{}", then(*t));
            }
            Phase::Steal { hex, victims, fans, then: t } => {
                let _ = write!(s, "T{hex}{}", then(*t));
                for (v, f) in victims.iter().zip(fans) {
                    let _ = write!(s, "{v}:{:?},", f);
                }
            }
            Phase::RoadBuilding { left } => {
                let _ = write!(s, "L{left}");
            }
            Phase::Over { winner } => {
                let _ = write!(s, "O{winner}");
            }
        }
        let _ = write!(s, ";{};{};{};", self.card_played as u8, self.longest_road, self.largest_army);
        match self.dice {
            Some((a, b)) => {
                let _ = write!(s, "{a},{b};");
            }
            None => s.push_str("-;"),
        }
        let _ = write!(s, "{:?};", self.pile);
        for pl in &self.players {
            let _ = write!(s, "{:?}|", pl.hand);
            for (c, t) in &pl.cards {
                let _ = write!(s, "{c}@{t},");
            }
            let _ = write!(s, "|{}|{},{},{};", pl.knights, pl.roads, pl.settlements, pl.cities);
        }
        for v in 0..VERTS {
            if self.owner[v] != NO {
                let _ = write!(s, "{v}:{}:{},", self.owner[v], self.kind[v]);
            }
        }
        s.push(';');
        for e in 0..EDGES {
            if self.road[e] != NO {
                let _ = write!(s, "{e}:{},", self.road[e]);
            }
        }
        s
    }
}

/// 32-bit FNV-1a, as the TypeScript side computes it
pub fn fnv(s: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

/// an action as the game's own engine spells it (JSON), for replaying in TypeScript
pub fn action_json(a: &Action) -> String {
    match a {
        Action::BuildSettlement(v) => format!(r#"{{"type":"buildSettlement","vertex":{v}}}"#),
        Action::BuildRoad(e) => format!(r#"{{"type":"buildRoad","edge":{e}}}"#),
        Action::BuildCity(v) => format!(r#"{{"type":"buildCity","vertex":{v}}}"#),
        Action::Roll => r#"{"type":"roll"}"#.into(),
        Action::Discard(c) => format!(
            r#"{{"type":"discard","cards":{{"lumber":{},"brick":{},"wool":{},"grain":{},"ore":{},"paper":0,"cloth":0,"coin":0}}}}"#,
            c[0], c[1], c[2], c[3], c[4]
        ),
        Action::MoveRobber(h) => format!(r#"{{"type":"moveRobber","hex":{h}}}"#),
        Action::Steal(v) => format!(r#"{{"type":"steal","victim":{v}}}"#),
        Action::BuyCard => r#"{"type":"buyCard"}"#.into(),
        Action::PlayKnight => r#"{"type":"playKnight"}"#.into(),
        Action::PlayRoadBuilding => r#"{"type":"playRoadBuilding"}"#.into(),
        Action::PlayYearOfPlenty(x, y) => format!(r#"{{"type":"playYearOfPlenty","take":["{}","{}"]}}"#, RES[*x as usize], RES[*y as usize]),
        Action::PlayMonopoly(r) => format!(r#"{{"type":"playMonopoly","resource":"{}"}}"#, RES[*r as usize]),
        Action::BankTrade(g, t) => format!(r#"{{"type":"bankTrade","give":"{}","get":"{}"}}"#, RES[*g as usize], RES[*t as usize]),
        Action::EndTurn => r#"{"type":"endTurn"}"#.into(),
    }
}

// ---------------------------------------------------------------- games with random legal moves (the benchmark, and the browser demo)

/// a small, fast random-number generator for choosing moves (not the game's own: that one deals the dice)
pub struct Pick(pub u64);
impl Pick {
    pub fn below(&mut self, n: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % n as u64) as usize
    }
}

/// one whole game, every move a random legal one (builds and cards preferred over trades and passing);
/// returns (moves, turns, winner or -1)
pub fn random_game(players: usize, seed: i32, pick: &mut Pick, legal: &mut Vec<Action>) -> (u32, u32, i8) {
    let mut g = Game::new(players, seed);
    let mut moves = 0;
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
            g.legal(legal);
            let builds = legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).count();
            if builds > 0 && pick.below(10) < 8 {
                let k = pick.below(builds);
                legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).nth(k).unwrap().clone()
            } else {
                legal[pick.below(legal.len())].clone()
            }
        };
        g.play(p, &a);
        moves += 1;
    }
    let winner = if let Phase::Over { winner } = g.phase { winner as i8 } else { NO };
    (moves, g.turn, winner)
}

#[cfg(target_arch = "wasm32")]
mod web {
    use super::*;
    static mut MOVES: u32 = 0;
    static mut TURNS: u32 = 0;
    /// plays n games from seed; the moves and turns they took are read with moves() and turns()
    #[no_mangle]
    pub extern "C" fn play(n: u32, seed: u32) -> u32 {
        let mut pick = Pick((seed as u64).wrapping_mul(0x9E3779B97F4A7C15) | 1);
        let mut legal = Vec::with_capacity(128);
        let (mut m, mut t, mut done) = (0u32, 0u32, 0u32);
        for k in 0..n {
            let (mv, tu, w) = random_game(4, seed.wrapping_add(k) as i32, &mut pick, &mut legal);
            m += mv;
            t += tu;
            if w >= 0 {
                done += 1;
            }
        }
        unsafe {
            MOVES = m;
            TURNS = t;
        }
        done
    }
    #[no_mangle]
    pub extern "C" fn moves() -> u32 {
        unsafe { MOVES }
    }
    #[no_mangle]
    pub extern "C" fn turns() -> u32 {
        unsafe { TURNS }
    }
}
