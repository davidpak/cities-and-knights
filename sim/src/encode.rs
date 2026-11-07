//! What the network sees: a position, from one player's side, as numbers (mostly 0 or 1, all between 0 and 1).
//!
//! Only what that player could know: their own hand and cards exactly; for everyone else, what's on the table and
//! how many cards they hold. Players are written in turn order starting from the one who sees ("me" first), so
//! the network learns one way of looking at the table whatever seat it's in.
//!
//! The same encoding is written in TypeScript (train/encode.ts) for playing in the real game; a test keeps the two
//! identical.

use crate::*;

/// tiles (terrain, pips, robber)
const HEX_F: usize = 8;
/// corners: harbour kind (static), settlement and city by whose (relative), open for a settlement
const VERT_F: usize = 6 + 8 + 1;
/// sides: road by whose (relative)
const EDGE_F: usize = 4;
/// each player (relative)
const PLAYER_F: usize = 23;
/// me only: hand, cards I can play by kind, cards bought this turn, a card played this turn
const ME_F: usize = 5 + 5 + 1 + 1;
/// the bank, the pile, the phase, whose turn (relative), the turn, setup's round
const GLOBAL_F: usize = 5 + 1 + 8 + 4 + 1 + 1;

pub const FEATURES: usize = HEXES * HEX_F + VERTS * VERT_F + EDGES * EDGE_F + 4 * PLAYER_F + ME_F + GLOBAL_F;

const PIPS: [f32; 13] = [0., 0., 1., 2., 3., 4., 5., 0., 5., 4., 3., 2., 1.];

/// a player's production in pips, by resource
pub fn production(g: &Game, p: usize) -> [f32; 5] {
    let t = topo();
    let mut out = [0f32; 5];
    for v in 0..VERTS {
        if g.owner[v] != p as i8 {
            continue;
        }
        for &h in &t.vert_hexes[v] {
            let h = h as usize;
            if g.terrain[h] == DESERT {
                continue;
            }
            out[YIELD[g.terrain[h] as usize] as usize] += PIPS[g.number[h] as usize] * g.kind[v] as f32;
        }
    }
    out
}

/// the position as `me` sees it. `bought` counts cards just bought whose kind `me` doesn't know yet (a card
/// considered, not drawn: the network must not see what it would get).
pub fn encode(g: &Game, me: usize, bought: u32, out: &mut [f32]) {
    debug_assert_eq!(out.len(), FEATURES);
    out.iter_mut().for_each(|x| *x = 0.);
    let t = topo();
    let n = g.players.len();
    let rel = |p: i8| -> usize { ((p as usize + n - me) % n) as usize };
    let mut o = 0;
    // tiles
    for h in 0..HEXES {
        out[o + g.terrain[h] as usize] = 1.;
        out[o + 6] = PIPS[g.number[h] as usize] / 5.;
        out[o + 7] = (g.robber as usize == h) as u8 as f32;
        o += HEX_F;
    }
    // corners
    let mut harbor = [6u8; VERTS];
    for &(e, k) in &g.harbors {
        for &v in &t.edges[e as usize] {
            harbor[v as usize] = k;
        }
    }
    for v in 0..VERTS {
        if harbor[v] < 6 {
            out[o + harbor[v] as usize] = 1.;
        }
        if g.owner[v] != NO {
            out[o + 6 + (g.kind[v] as usize - 1) * 4 + rel(g.owner[v])] = 1.;
        } else if t.vert_neighbors[v].iter().all(|&u| g.owner[u as usize] == NO) {
            out[o + 14] = 1.;
        }
        o += VERT_F;
    }
    // sides
    for e in 0..EDGES {
        if g.road[e] != NO {
            out[o + rel(g.road[e])] = 1.;
        }
        o += EDGE_F;
    }
    // players, me first
    for k in 0..4 {
        if k >= n {
            o += PLAYER_F;
            continue;
        }
        let p = (me + k) % n;
        let pl = &g.players[p];
        out[o] = 1.;
        out[o + 1] = g.victory_points(p, false) as f32 / 10.;
        out[o + 2] = if k == 0 { g.victory_points(p, true) as f32 / 10. } else { out[o + 1] };
        out[o + 3] = (g.hand_size(p) as f32 / 20.).min(1.);
        out[o + 4] = ((pl.cards.len() as u32 + if k == 0 { bought } else { 0 }) as f32 / 10.).min(1.);
        out[o + 5] = (pl.knights as f32 / 5.).min(1.);
        out[o + 6] = pl.roads as f32 / 15.;
        out[o + 7] = pl.settlements as f32 / 5.;
        out[o + 8] = pl.cities as f32 / 4.;
        out[o + 9] = (g.longest_road == p as i8) as u8 as f32;
        out[o + 10] = (g.largest_army == p as i8) as u8 as f32;
        out[o + 11] = (g.longest_run(p) as f32 / 15.).min(1.);
        let prod = production(g, p);
        for r in 0..5 {
            out[o + 12 + r] = (prod[r] / 15.).min(1.);
        }
        let ratios = g.ratios(p);
        for r in 0..5 {
            out[o + 17 + r] = (ratios[r] == 2) as u8 as f32;
        }
        out[o + 22] = (ratios.iter().any(|&x| x == 3) || ratios.iter().all(|&x| x <= 3)) as u8 as f32;
        o += PLAYER_F;
    }
    // me: hand, cards I can play (bought before this turn), cards bought this turn (kind not shown), a card played
    let pl = &g.players[me];
    for r in 0..5 {
        out[o + r] = (pl.hand[r] as f32 / 10.).min(1.);
    }
    let mut new = bought;
    for &(c, turn) in &pl.cards {
        if turn < g.turn {
            out[o + 5 + c as usize] += 1. / 3.;
        } else {
            new += 1;
        }
    }
    for c in 0..5 {
        out[o + 5 + c] = out[o + 5 + c].min(1.);
    }
    out[o + 10] = (new as f32 / 3.).min(1.);
    out[o + 11] = g.card_played as u8 as f32;
    o += ME_F;
    // the bank, the pile, the phase, whose turn, the turn, setup's round
    for r in 0..5 {
        out[o + r] = g.bank[r] as f32 / 19.;
    }
    out[o + 5] = (g.pile.len() as f32 - bought as f32).max(0.) / 25.;
    let phase = match g.phase {
        Phase::Setup { .. } => 0,
        Phase::Roll => 1,
        Phase::Main => 2,
        Phase::Discard { .. } => 3,
        Phase::Robber { .. } => 4,
        Phase::Steal { .. } => 5,
        Phase::RoadBuilding { .. } => 6,
        Phase::Over { .. } => 7,
    };
    out[o + 6 + phase] = 1.;
    out[o + 14 + rel(g.current as i8)] = 1.;
    out[o + 18] = (g.turn as f32 / 200.).min(1.);
    out[o + 19] = matches!(g.phase, Phase::Setup { round: 2, .. }) as u8 as f32;
    o += GLOBAL_F;
    debug_assert_eq!(o, FEATURES);
}
