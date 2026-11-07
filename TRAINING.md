# Training the bots: the brief

This is the brief for running and developing the bot training on a Windows PC (Ryzen 7 7700X, 16 threads, and an
RTX 4060 Ti). It is written so a Claude Code session on that PC can take over from scratch. Read it all before
doing anything.

## The goal

A bot for the base game that gets measurably stronger by playing itself, generation by generation, until it is
far stronger than today's hand-written Expert bot (`shared/bot.ts`). Its progress shows on the lab page,
https://cities-and-knights-production.up.railway.app/lab, as it trains. Later:
- the best network plays as Expert in the real game;
- the same network powers a Game Review: every move graded from Best to Blunder, with a luck rating apart.

Every claim of progress is a measured number: matches with seats rotated over the same dice, prediction scores on
games the network has never seen. Nothing on the lab page is ever made up or estimated by hand.

## What exists (all in this repo, branch `master`)

| Part | Where | State |
|---|---|---|
| The game's rules (the source of truth) | `shared/engine.ts` | the live game runs on it |
| Today's Expert bot | `shared/bot.ts` | the yardstick to beat |
| A fast copy of the base-game rules in Rust | `sim/src/lib.rs` | done and proved identical, see below |
| The proof it is identical | `sim/parity.ts`, `sim/src/bin/parity.rs`, `sim/tests/legal.rs` | passes |
| What the network sees | `sim/src/encode.rs` | 1,374 numbers per position, from one player's side |
| The network (forward, backward, Adam), pure Rust | `sim/src/nn.rs` | works |
| The network as a player, and self-play | `sim/src/agent.rs` | works |
| The training loop, reporting to the lab | `sim/src/bin/train.rs` | works at small scale |
| The lab page | `client/src/ui/Lab.tsx`, `server/index.ts` (`/api/lab`) | live |

### The simulator and its proof

`sim/` copies the base-game rules from `shared/engine.ts` exactly, including the engine's random-number generator
(mulberry32), stepped in the same order. That covers the board deal, the card pile, the seat shuffle, the dice,
the fan a robbed hand is spread in, and the card taken. So the same seed and the same moves give the same game.

The proof:
- 3,000 games and 2,476,066 moves were replayed through the real engine, comparing the whole state after every
  move. All were identical.
- At every step, one random move (often illegal) was tried in both. All 2.48 million were allowed or refused
  alike.
- `cargo test` checks that the legal-move list is exactly what the rules accept, at every position along 300
  games.

**If anyone changes the base-game rules in `shared/engine.ts`, mirror the change in `sim/src/lib.rs` and run the
proof again.** A simulator that drifts from the real game trains the wrong game.

Not in the simulator yet:
- trades between players (only bank and harbour trades);
- sneaking cards;
- the Cities & Knights expansion.

### How the bot plays (`sim/src/agent.rs`)

It works the way TD-Gammon chose its moves. For each legal move:
1. Play the move on a copy of the game.
2. Encode the resulting position from the mover's side.
3. Ask the network for the mover's chance of winning.

Then play the best move. While training, it plays a random legal move 5% of the time (`--explore`), to explore.

The network never cheats:
- It sees only what that player could know: its own hand and cards exactly, and for others only what's on the
  table and how many cards they hold.
- A card being bought is counted, but its kind is not shown.
- A steal goes to the leader (by points showing, then cards held), because the card taken can't be known.
- Discards are chosen one card at a time the same way.
- A player makes at most 3 bank trades a turn, so it can't trade in circles.

### How it learns (`sim/src/bin/train.rs`)

Each generation:
1. **Self-play.** The champion plays itself for `--games` games across all threads. A sample of each game's
   positions (`--keep`) is kept, each labelled with who went on to win.
2. **Honest score.** Before learning from these new games, the candidate predicts their winners. This
   prediction loss on unseen games is reported as "holdout". 1.386 (ln 4) is pure guessing for 4 players; lower
   is better.
3. **Learning.** The candidate trains on the newest `--window` generations of positions: `--epochs` passes, with
   Adam (`--lr`) and weight decay (`--l2`).
4. **Match.** The candidate plays the champion, `--eval` games.
   - It takes each of the 4 seats in turn on the same game seeds, so both face the same dice.
   - There is no exploring in the match.
   - It is promoted only if the lower end of its 90% interval is above a fair share (25%).
5. **Rating.** A share s against three equals converts to a rating gap of 400·log10(3s/(1−s)). The candidate's
   rating is the champion's plus that gap.
6. **Report to the lab:**
   - the rating chain and the holdout loss;
   - a match against random-move players (a fixed yardstick);
   - how it plays: settlements, cities, roads, cards, knights, bank trades and awards per game;
   - its map of the opening, on a fixed board (seed 20261107, the same board the lab draws).
7. **Save.** `runs/<name>/champion.net`, `candidate.net` and `history.json` are written, so a stopped run picks
   up where it left off.

Generation 0 of a fresh run learns from `--warmup` games between random builders. An untrained network's own
games teach nothing: it barely builds, and its games run 1,300 turns.

### Results so far (on a 4-core cloud machine, tiny scale)

| Measure | Generation 0 | Generation 1 | Generation 2 |
|---|---|---|---|
| Prediction on new games (holdout loss) | 1.41 | 1.25 | 1.42 |
| Against random play (25% is even) | 32% | 43% | 47% |
| Turns a game | 271 | 251 | 250 |
| Self-play speed | – | about 21 games/s | about 21 games/s |

So it learns. At this scale, though, the data is too small and the holdout loss swings. The PC's job is scale.

An earlier run without the warm start and the 3-trades-a-turn limit fell into a degenerate habit (5% against random
play, 1,300-turn games). Watch the "turns a game" and "unfinished" numbers in the log: if they climb, something has
gone wrong again.

## Setting up the PC (Windows)

1. **Git:** https://git-scm.com/download/win
2. **Rust:** https://rustup.rs. Run `rustup-init.exe` and accept the defaults. If it asks for the Visual Studio C++
   build tools, install them ("Desktop development with C++"); Rust needs their linker on Windows.
3. **Node.js 22 LTS:** https://nodejs.org. It's needed for the parity proof and, later, for matches against
   today's Expert.
4. **Clone and build:**
   ```powershell
   git clone https://github.com/davidpak/cities-and-knights.git
   cd cities-and-knights
   npm install
   cd sim
   cargo build --release
   cargo test --release
   cargo run --release --bin bench
   ```
   `bench` should report several thousand games a second on one thread, and much more across 16.
5. **Optional, recommended once:** prove the simulator again on this machine.
   ```powershell
   cargo run --release --bin parity -- 1000 777 > ..\trace.jsonl
   cd ..
   npx tsx sim/parity.ts trace.jsonl
   ```
   Expect `every state identical` and `every one agreed`.

## Running the training

The lab needs two environment variables:
- `LAB_URL=https://cities-and-knights-production.up.railway.app`
- `LAB_TOKEN`: the secret. Copy it from Railway: the project, the `cities-and-knights` service, Variables,
  `LAB_TOKEN`. Never commit it or paste it anywhere public.

```powershell
cd sim
$env:LAB_URL = "https://cities-and-knights-production.up.railway.app"
$env:LAB_TOKEN = "<paste from Railway>"
cargo run --release --bin train -- --warmup 50000 --games 20000 --gens 1000 --eval 400 --threads 16 --keep 12 --epochs 1 --l2 1e-4 --window 4 --out runs/base
```

- It prints a line per generation and reports to the lab after every step. A generation should take a few
  minutes on 16 threads.
- Stopping it (Ctrl+C) and starting it again with the same `--out` carries on from the last generation.
- Keep the PC awake while it trains (Windows: Settings, Power, Screen and sleep: "Never" while plugged in). The
  screen can be off.
- `runs/` is not committed (it's large and changes constantly). Back up `runs/base/champion.net` now and then.

### What healthy training looks like on the lab page

- **Predicting new games:** the holdout loss falls below 1.386 and keeps falling, slowly.
- **Against random play:** this climbs toward 90% or more.
- **Strength by generation:** filled dots (promotions) come regularly at first, then less often; the rating line
  climbs.
- **How it plays:** turns a game fall toward 60–90 (four players' turns); cities and settlements per game rise.
- **The opening map:** sharpens from scattered dots to a few clear favourite corners.

If the holdout loss rises while the training loss falls, it's memorising boards: more games per generation,
fewer positions kept per game, more weight decay. If nothing is promoted for 10+ generations, see the work list
below.

## The work list, in order

Do these one at a time. Each ends with a measured result reported on the lab page, then a commit.

1. **First real run.** Start training as above, and confirm the lab page fills in: live numbers, then each
   generation. Let it run while doing the next items. (Rebuilding the trainer needs it stopped; stop, rebuild,
   restart with the same `--out`.)

2. **Measure against today's Expert.** This is the number that matters most: the lab's "strength" today is only
   relative to generation 0.
   1. Port `sim/src/encode.rs` to TypeScript (`train/encode.ts`), reading the real engine's `GameState`.
   2. Prove it identical: the Rust side writes encodings for positions along parity traces, and TypeScript
      compares them number by number. The same approach as `sim/parity.ts`.
   3. Write the network's forward pass in TypeScript (`train/net.ts`), reading the `.net` file format in
      `sim/src/nn.rs`.
   4. Write the network as a player in TypeScript, the same choice rules as `agent.rs`, over
      `shared/engine.ts`.
   5. Write a match runner (`train/vs-expert.ts`): the champion network in one seat and today's Expert
      (`botAction` from `shared/bot.ts` with `brain('expert')`) in the other three. Rotate seats over the same
      seeds; run 400 games across several Node processes.
   6. Have `train.rs` run it after each promotion and report `winVsExpert` (with its interval) in that
      generation's record. Then draw it on the lab's strength chart as a second line, with 25% marked.

3. **Learn faster and better.**
   - **TD(λ) targets:** blend each position's label between the final result and the network's own prediction a
     few moves later (rotated to the mover's side). This is what made TD-Gammon work, and it cuts the noise of
     "who won" a lot.
   - **Board symmetry:** the hex board has 12 symmetries (rotations and reflections). Augment each training
     position with a random one. That needs the symmetry maps of corners, sides and tiles, computed once from
     `sim/topo.json`.
   - Try a bigger network (`--hidden 512`) once data is plentiful.

4. **The rest of the game.**
   - Trades between players: a fixed menu (1-for-1 and 2-for-1 offers to one player or all; yes or no as a move
     the network judges).
   - Steal choice by the network.
   - Rules changes: mirror in `shared/engine.ts` and `sim/src/lib.rs`, extend the parity proof to cover them,
     and re-run it.

5. **Look-ahead search (the GPU becomes useful here).** Add a search over the network's judgements:
   - chance nodes averaged exactly over the 11 dice totals;
   - several plausible deals of the hidden cards.

   With a bigger network, inference and training move to the 4060 Ti: PyTorch with CUDA
   (`pip install torch --index-url https://download.pytorch.org/whl/cu124`), with the simulator exposed to
   Python via PyO3/maturin. Until then the CPU trainer is the simpler and faster path; don't move to Python
   without a measured reason.

6. **The new Expert in the game.** Ship the champion network as the Expert bot: a `.net` file, and the TypeScript
   forward pass from item 2, run by the server and by solo play in the browser. It plays only after it beats
   today's Expert clearly in item 2's match.

7. **Game Review.** After a game, grade every move by how much win chance it gave up compared with the best move,
   averaged over the dice:
   - Best: 0
   - Excellent: under 2 points
   - Good: under 5
   - Inaccuracy: under 10
   - Mistake: under 20
   - Blunder: 20 or more
   - Brilliant: a best move that gives something up visibly to gain more.

   Show it as a win-chance graph through the game, an accuracy score per player, and a luck rating per player.

## Rules for working in this repo

- **`CLAUDE.md`'s UI rules apply to anything a player sees:** simplicity first, no chatty text, no hand-holding.
- **The game's names, art and rules text are its own.** Don't copy the published game's names, art or text.
- **Commit messages:** no model names or identifiers.
- **`master` deploys automatically to Railway**, to the live site. Run `npm test` and `npm run typecheck` before
  pushing anything that touches `shared/`, `server/` or `client/`. The trainer under `sim/` doesn't deploy.
- **The lab page is the shared record of progress.** Keep every number on it measured, never estimated or
  invented.
