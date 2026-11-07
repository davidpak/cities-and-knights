# tp-sim: the base game, fast

A Rust copy of the base game's rules (`shared/engine.ts`), for self-play training. It plays the same game exactly:
the same random-number generator stepped in the same order (the board deal, the card pile, the seats, the dice,
the fan a robbed hand is spread in, the card taken), and the same rules.

Not here yet: trades between players, sneaking cards, and the Cities & Knights expansion.

## The proof

```sh
cargo run --release --bin parity -- 3000 424242 > trace.jsonl   # random legal moves, a state fingerprint after each
npx tsx sim/parity.ts trace.jsonl                               # replays every move through the real engine
cargo test --release                                            # the legal-move list is exactly what the rules accept
```

`parity.ts` checks, after every move, that the whole state (hands, cards and when they were bought, the pile in
order, pieces, buildings, roads, robber, awards, dice, the phase, the random generator's position) is identical,
and that a random move tried at every step is allowed or refused by both alike.

## Speed

```sh
cargo run --release --bin bench
```

Whole games with random legal moves: about 3,400 games a second on one thread (2.8 million moves a second).

## The board

`topo.json` is the board's layout and the rules' fixed sets, written from the game's own code:
`npx tsx sim/export-topo.ts`.
