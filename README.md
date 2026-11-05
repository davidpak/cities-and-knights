# Towns and Peasants

A 3D hex-island trading and building game for 2–4 players, online with friends or solo against bots.
(The name lives in `client/src/lib/palette.ts` as `GAME_NAME`.)

Every move is a plain click or button press: the board only shows spots where a move is legal, and the server
decides every result. The board is 3D, tipped a little toward you; two real dice are thrown into a tray beside it.

**Everything is on the table.** Your cards lie in front of you in stacks, with your development cards beside them
and your pieces waiting to be built. The bank's five stacks and its development deck sit at the side, next to the dice
in their tray. Everyone else's cards lie face down at their places. To do something, you do it to the thing:

- **Build:** click a piece in your supply (the ones you can afford stand on a little mat), then click a white spot.
- **Buy a development card:** click the deck. **Play one:** click it.
- **Trade:** click cards in your hand to put them on the trade tray, and the cards behind the tray for what you want.
  To trade with the bank, click the bank's card you want. To trade with a player, click their cards. The green
  check puts it to everyone; the red cross puts it back. An offer to you shows on your own tray: check or cross.
- **Roll:** click the dice. **Rob:** click a tile, then the cards of the player to steal from.

On screen there's only whose turn it is, what just happened, the turn button, the tray's check and cross, counts on
the stacks, everyone's name and points, and a History panel you can open.

**Everything is a real object.** Every card and every piece is a body in a physics world (Rapier). When the game
changes, the things that must move fly to their new places and settle there: cards land on their stacks, a new road
flies from your supply to its side of a tile, a stolen card crosses the table and turns over. You can also pick
anything up with the mouse, carry it, drop it, or toss it into the others (a card from your hand dropped on the tray
goes on the tray). Whatever comes to rest out of place goes back home a moment later. The dice are a real throw too,
worked out the moment they're rolled and seeded by the roll's number, so everyone sees the same throw; once it lands,
each die's printing is turned so the server's roll is on top. Clicks never depend on any of this: a click acts on the
pile a thing belongs to, wherever it lies.

The pieces are wooden toys, each one solid piece: a house (square walls under a steep gable), a city (a tall gabled
hall with a lower wing), a square road bar, a turned pawn for the robber, all sawn from a silhouette and sanded round,
with a faint grain under the paint. Stacks of cards are one solid block each in the physics world, as table-top
simulators do it, so twenty paper-thin cards never jitter; a card is a body of its own only while it's loose.

**Fast on any computer:** the table draws only when something moves (nothing at all while you think), the whole
island is two draw calls, every card on the table is one more and each kind of piece one more (about 50 in all),
shadows are recomputed only when something moves, sleeping bodies cost nothing, and the home screen loads without
three.js (the physics engine follows in the background).

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
npm test            # rules: 15 tests, including 120 whole bot games checked after every move
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
