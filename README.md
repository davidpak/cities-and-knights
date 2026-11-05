# Hearth Isles

A 3D hex-island trading and building game for 2–4 players, online with friends or solo against bots.
(*Hearth Isles* is a working title; it lives in `client/src/lib/palette.ts` as `GAME_NAME`.)

Every move is a plain click or button press: the board only shows spots where a move is legal, and the server
decides every result. The board is 3D, tipped a little toward you; real dice tumble in a tray beside it.

**The table.** The other players sit across the top on plaques (points, cards in hand, a "+2 grain" that pops up when
they collect). Your seat is along the bottom: what to do now, your hand fanned out, your moves. The big moments are
announced across the top of the board for a moment, and the whole story is told down the side, line by line, with
everyone's colours and the actual cards: who rolled what, who got what, who traded what with whom.

**Trading** happens on one mat, right above your hand: click cards in your hand to give them, pick what you want on
the mat. "Trade with the bank" is ready as soon as the cards fit your rates (harbours included). "Ask everyone" puts
the offer to the table; each player's yes or no shows on the mat, and you pick who to trade with.

**Fast on any computer:** the board draws only when something moves (nothing at all while you think), the whole
island is two draw calls, shadows are recomputed only when a piece moves, and the home screen loads without three.js.

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
npm test            # rules: 14 tests, including 120 whole bot games checked after every move
npm run check       # the 3D spec's fit checks
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
