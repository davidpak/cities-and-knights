# Towns and Peasants

A 3D hex-island trading and building game for 2–4 players, online with friends or solo against bots.
(The name lives in `client/src/lib/palette.ts` as `GAME_NAME`.)

**Two games in one.** *Knights and barbarians* (the default; pick it on the start screen or in the lobby) adds the
expansion, with our own names and wording throughout:

- Cities make **commodities** besides resources: paper from forest, cloth from pasture, coin from mountains. The second
  piece you place in setup is a city. First to **13 points** wins.
- Three **city tracks** (trade, politics, science): level n costs n of the track's commodity. Level 3 gives a perk
  (trade commodities 2 for 1; knights of the third strength; a resource of your choice when a roll brings you
  nothing). The first to reach level 4 raises a **metropolis** on a city (2 points); reaching 5 first takes it away.
- **Knights** (three strengths) stand on your roads. Ready one with grain; from your next turn it can move along your
  roads, push a weaker knight away, or chase the robber off. Knights also block other players' roads.
- The **barbarians** sail a step with every ship on the **event die** (the third die). When they land, every city on
  the island is their strength and every ready knight stands against them: held off, the best defender earns a point;
  beaten, whoever gave least loses a city (a walled one loses its wall instead). Metropolises can't be taken.
- **City walls** (2 brick) let you keep two more cards on a 7. The robber stays in the desert until the first landing.
- **Progress cards** (25 kinds, our own set) come from the event die's gates: a gate in a track's colour gives a card to
  everyone whose level in that track is high enough for the red die. Hold four at most; point cards go down at once.
- The **trader**: put it on a tile beside you to trade that tile's resource 2 for 1, and hold a point while it's yours.

On the table: your knights and walls wait beside your pieces. Your three tracks are desk **flip charts** by the dice:
each page shows the level reached, the building it has grown to, and what the next step costs; click a chart to take
its next step and the page goes over the top (everyone else's stand small beside their cards). The barbarians'
**voyage** is a little sea board above the bank: their longship sails buoy to buoy toward an island with a town, and a
signpost on the shore is painted with their strength against the knights standing ready. Click a
knight on the board to ready it, click a ready one to pick it up and then where it goes. Click a progress card to play
it; if it needs a target, the line at the top says what to click.

Every move is a plain click or button press: the board only shows spots where a move is legal, and the server
decides every result. The board is 3D, tipped a little toward you; two real dice are thrown into a tray beside it.

**Everything is on the table.** Your cards lie in front of you in stacks, with your development cards beside them
and your pieces waiting to be built. The bank sits at the side as one card of each kind, fanned like a hand of cards (a kind's count shows only when it
runs low), with its development deck (or the three progress piles), next to the dice
in their tray. Everyone else's cards lie face down at their places. To do something, you do it to the thing:

- **Build:** click a piece in your supply (the ones you can afford stand on a little mat), then click a white spot.
- **Buy a development card:** click the deck. **Play one:** click it.
- **Trade:** click cards in your hand to put them on the trade tray, and the cards behind the tray for what you want.
  To trade with the bank, click the bank's card you want. To trade with a player, click their cards. The green
  check puts it to everyone; the red cross puts it back. An offer to you shows on your own tray: check or cross.
- **Roll:** click the dice. **Rob:** click a tile, then the cards of the player to steal from.

On screen there's only whose turn it is, what just happened, the turn button, the tray's check and cross, counts on
the stacks, everyone's name and points, and a History panel you can open.

**The things on the table are real objects.** Every card and every piece waiting in your supply is a body in a
physics world (Rapier). When the game changes, the cards that must move fly to their new places and settle there:
they land on their stacks, a stolen card crosses the table and turns over. You can pick any of them up with the mouse,
carry it, drop it, or toss it into the others (a card from your hand dropped on the tray goes on the tray). Whatever
comes to rest out of place goes back home a moment later. The board is not physical: pieces on it and the robber are
fixed where they stand. Click a piece in your supply, then a spot, and it flies over and is set down there. The dice are a real throw too,
worked out the moment they're rolled and seeded by the roll's number, so everyone sees the same throw; once it lands,
each die's printing is turned so the server's roll is on top. Clicks never depend on any of this: a click acts on the
pile a thing belongs to, wherever it lies.

The pieces are wooden toys, each one solid piece: a house (square walls under a steep gable), a city (a tall gabled
hall with a lower wing), a square road bar, a turned pawn for the robber, all sawn from a silhouette and sanded round,
with a faint grain under the paint. Stacks of cards are one solid block each in the physics world, as table-top
simulators do it, so twenty paper-thin cards never jitter; a card is a body of its own only while it's loose.

**Fast on any computer.** Measured, not guessed: a frame-cost benchmark on a software GPU (a stand-in for the
weakest hardware) showed where the time goes, and each fix was kept only if it paid.

- Nothing draws while nothing moves: zero frames while you think.
- About 40 draw calls a frame: the island is two, every card on the table one, each kind of piece one (on the board
  and in your supply alike, however many are built), each die one, the trade tray two.
- Cards are drawn top first, so a stack of nineteen costs the GPU about one card: the cards under the top are
  rejected before they're shaded. The table top is drawn last for the same reason.
- Soft shadows take four hardware-filtered samples with no trigonometry (three.js's own take five with a sine, a
  cosine and a noise term each, for every pixel), one on a weak GPU. The shadow map is redrawn only while something
  moves.
- Weak GPUs (integrated Intel, phone and tablet GPUs, software renderers) are recognised by name and start without
  multisampling, at one pixel per CSS pixel, with a smaller shadow map. High-density screens never multisample.
- While things move, the frame time is watched; if frames run long the resolution steps down (and then the shadow
  map), remembered per device. A step that doesn't help is undone, so a display that's simply slow is left alone.
- No shader is compiled mid-game (everything that appears later is drawn once, out of sight, as the table opens),
  the next dice throw is worked out while nothing's happening, and the drawing code allocates nothing per frame.
- The canvas is opaque, and laptops with two GPUs use the faster one.
- The home screen loads without three.js; the physics engine follows in the background.

## Layout

| Folder | What's in it |
|---|---|
| `shared/` | The rules (`engine.ts`), the generated board layout (`board.ts`), costs and counts (`rules.ts`), a simple bot (`bot.ts`), the socket protocol, and tests |
| `server/` | Node + socket.io. Rooms, lobby, bots, reconnecting after a refresh. Also serves the built client |
| `client/` | React + react-three-fiber. The 3D table (`src/three/`), the HUD (`src/ui/`), the connection (`src/net.ts`) |

Every size is in `client/src/three/spec.ts` (millimetres, each tagged with its source), and `checkBoard()` in the
same file checks that the parts fit together. `client/src/three/island.ts` merges the board into two meshes.

## Running it

```sh
npm install                       # root: test tools
(cd server && npm install)
(cd client && npm install)

npm run dev:server                # :3001
npm run dev:client                # :5173, talks to :3001
```

Open http://localhost:5173. **Play solo** runs entirely in the browser (the same rules engine, with bots), so it works
without the server.

## Checks

```sh
npm test            # rules: 24 tests, including 120 whole bot games (and 60 with the expansion) checked after every move
npm run check       # the 3D spec's fit checks; that nothing on the table overlaps (2-4 players, wide and tall);
                    # the physics table headless (stacks lie still, moved cards land, tossed things go home, all sleep);
                    # 30 real dice throws land flat in the tray showing the roll
npm run typecheck   # shared, server and client
npm run e2e         # two scripted players and a bot play a whole game through a running server
```

## Pages for looking at things alone

- `?part=board`: a sample game a few turns in (`&seed=`, `&turns=`)
- `?part=check`: the spec's checks beside a straight-down view of the board

## Deploying

- **Railway (everything):** `railway.json` / `nixpacks.toml` build the client and run the server, which serves the
  client on the same address. One URL, solo and online both work.
- **Vercel (the client):** import the repo as-is; `vercel.json` builds `client/` from the repo root. Vercel can't run
  the socket server, so set `VITE_SERVER_URL` in the Vercel project to the server's address (the Railway one) for
  online play. Without it, solo works and the home screen says online play is off.

## Rules covered

Setup (two settlements and two roads each, snake order, the second settlement pays), dice and production (with the
bank running short), the robber on a 7 (discard half above 7 cards, move it, steal), roads, settlements and cities
with costs and piece limits, development cards (knight, road building, year of plenty, monopoly, victory point; not
on the turn you buy them, one per turn), harbours (3:1 and 2:1), trading with the bank and with players, Longest Road
(5+, cut by others' settlements), Largest Army (3+), and winning at 10 points on your turn.

Not yet: the knights-and-cities expansion layer.
