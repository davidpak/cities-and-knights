//! The list of legal moves is exactly what the rules accept: at every position along many random games, every
//! possible move is tried on a copy, and it is accepted if and only if it's in the list.
use tp_sim::*;

fn universe(g: &Game) -> Vec<Action> {
    let mut u = vec![Action::Roll, Action::BuyCard, Action::PlayKnight, Action::PlayRoadBuilding, Action::EndTurn];
    u.extend((0..VERTS as u8).map(Action::BuildSettlement));
    u.extend((0..VERTS as u8).map(Action::BuildCity));
    u.extend((0..EDGES as u8).map(Action::BuildRoad));
    u.extend((0..HEXES as u8).map(Action::MoveRobber));
    u.extend((0..g.players.len() as u8).map(Action::Steal));
    for x in 0..5 {
        for y in x..5 {
            u.push(Action::PlayYearOfPlenty(x, y));
        }
        u.push(Action::PlayMonopoly(x));
        for y in 0..5 {
            u.push(Action::BankTrade(x, y));
        }
    }
    u
}

#[test]
fn legal_is_exactly_what_the_rules_accept() {
    let mut x: u64 = 88172645463325252;
    let mut rnd = |m: usize| {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        (x % m as u64) as usize
    };
    let mut legal = vec![];
    let mut checked = 0;
    for k in 0..300 {
        let mut g = Game::new(2 + k % 3, 99 + k as i32);
        for _ in 0..3000 {
            let Some(p) = g.actor() else { break };
            if g.owed(p) > 0 {
                let mut c = [0u8; 5];
                let mut h = g.players[p].hand;
                for _ in 0..g.owed(p) {
                    let r = (0..5).filter(|&r| h[r] > 0).nth(0).unwrap();
                    h[r] -= 1;
                    c[r] += 1;
                }
                g.play(p, &Action::Discard(c));
                continue;
            }
            g.legal(&mut legal);
            for a in universe(&g) {
                let mut copy = g.clone();
                let ok = copy.apply(p, &a).is_ok();
                assert_eq!(ok, legal.contains(&a), "{a:?} by {p} in {:?}: rules say {ok}", g.phase);
                checked += 1;
            }
            let builds: Vec<&Action> = legal.iter().filter(|a| !matches!(a, Action::BankTrade(..) | Action::EndTurn)).collect();
            let a = if !builds.is_empty() && rnd(10) < 8 { builds[rnd(builds.len())].clone() } else { legal[rnd(legal.len())].clone() };
            g.play(p, &a);
        }
    }
    println!("{checked} moves checked");
}
