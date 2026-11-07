// Runs the Rust simulator (compiled for the browser) in the background: whole games with random legal moves,
// a batch at a time, reporting how many games, moves and turns each batch took and how long.
let sim = null
let running = false
let seed = (Math.random() * 2 ** 31) | 0
async function load() {
  const bytes = await (await fetch('/lab/sim.wasm')).arrayBuffer()
  const { instance } = await WebAssembly.instantiate(bytes, {})
  sim = instance.exports
}
async function loop() {
  if (!sim) await load()
  while (running) {
    const n = 40
    const t = performance.now()
    const won = sim.play(n, seed)
    const ms = performance.now() - t
    seed = (seed + n) | 0
    postMessage({ games: n, won, moves: sim.moves(), turns: sim.turns(), ms })
    // (a breath between batches, so a pause takes at once)
    await new Promise((r) => setTimeout(r, 0))
  }
}
onmessage = (e) => {
  if (e.data === 'start' && !running) {
    running = true
    loop().catch((err) => postMessage({ error: String(err) }))
  }
  if (e.data === 'stop') running = false
}
