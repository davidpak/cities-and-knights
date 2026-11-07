//! The network: a small multi-layer perceptron that reads a position (see encode.rs) and says how likely each
//! player is to win from it. Written out by hand (forward, backward, Adam) so training needs nothing but Rust.
//!
//! Inputs are mostly zero, so the first layer only does work for the inputs that aren't (its weights are stored
//! input by input, each a row of the hidden width), which is most of the speed.

use std::io::{Read, Write};

pub const OUT: usize = 4;

#[derive(Clone)]
pub struct Net {
    pub inputs: usize,
    pub h1: usize,
    pub h2: usize,
    /// input-major: row i is the first layer's weights from input i
    pub w1: Vec<f32>,
    pub b1: Vec<f32>,
    /// out-major: row j is the second layer's weights into unit j
    pub w2: Vec<f32>,
    pub b2: Vec<f32>,
    pub w3: Vec<f32>,
    pub b3: Vec<f32>,
}

/// a small deterministic generator for initial weights
fn gauss(state: &mut u64) -> f32 {
    let mut u = || {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        ((*state >> 11) as f64 / (1u64 << 53) as f64).max(1e-12)
    };
    let (a, b) = (u(), u());
    ((-2. * a.ln()).sqrt() * (2. * std::f64::consts::PI * b).cos()) as f32
}

pub struct Scratch {
    a1: Vec<f32>,
    a2: Vec<f32>,
    nz: Vec<(usize, f32)>,
}

impl Net {
    pub fn new(inputs: usize, h1: usize, h2: usize, seed: u64) -> Net {
        let mut s = seed | 1;
        let mut init = |n: usize, fan_in: usize| (0..n).map(|_| gauss(&mut s) * (2. / fan_in as f32).sqrt()).collect::<Vec<f32>>();
        // (the first layer sees ~10% of its inputs at once: scaled for those, not all of them)
        let w1 = init(inputs * h1, inputs / 10);
        let w2 = init(h2 * h1, h1);
        let w3: Vec<f32> = init(OUT * h2, h2).into_iter().map(|x| x * 0.1).collect();
        Net { inputs, h1, h2, w1, b1: vec![0.; h1], w2, b2: vec![0.; h2], w3, b3: vec![0.; OUT] }
    }
    pub fn scratch(&self) -> Scratch {
        Scratch { a1: vec![0.; self.h1], a2: vec![0.; self.h2], nz: Vec::with_capacity(512) }
    }

    /// the four logits (who wins: me, the next player, ...)
    pub fn forward(&self, x: &[f32], s: &mut Scratch) -> [f32; OUT] {
        s.nz.clear();
        for (i, &v) in x.iter().enumerate() {
            if v != 0. {
                s.nz.push((i, v));
            }
        }
        self.forward_sparse(s)
    }

    fn forward_sparse(&self, s: &mut Scratch) -> [f32; OUT] {
        let (h1, h2) = (self.h1, self.h2);
        s.a1.copy_from_slice(&self.b1);
        for &(i, v) in &s.nz {
            let row = &self.w1[i * h1..(i + 1) * h1];
            for (a, w) in s.a1.iter_mut().zip(row) {
                *a += v * w;
            }
        }
        for a in s.a1.iter_mut() {
            *a = a.max(0.);
        }
        for j in 0..h2 {
            let row = &self.w2[j * h1..(j + 1) * h1];
            let mut z = self.b2[j];
            for (a, w) in s.a1.iter().zip(row) {
                z += a * w;
            }
            s.a2[j] = z.max(0.);
        }
        let mut out = [0f32; OUT];
        for k in 0..OUT {
            let row = &self.w3[k * h2..(k + 1) * h2];
            out[k] = self.b3[k] + s.a2.iter().zip(row).map(|(a, w)| a * w).sum::<f32>();
        }
        out
    }

    /// the chance that the one who sees (slot 0) wins, among the n players in the game
    pub fn value(&self, x: &[f32], players: usize, s: &mut Scratch) -> f32 {
        softmax(&self.forward(x, s), players)[0]
    }

    pub fn save(&self, path: &str) -> std::io::Result<()> {
        let mut f = std::io::BufWriter::new(std::fs::File::create(path)?);
        f.write_all(b"TPNET1")?;
        for d in [self.inputs, self.h1, self.h2] {
            f.write_all(&(d as u32).to_le_bytes())?;
        }
        for v in [&self.w1, &self.b1, &self.w2, &self.b2, &self.w3, &self.b3] {
            for x in v.iter() {
                f.write_all(&x.to_le_bytes())?;
            }
        }
        Ok(())
    }
    pub fn load(path: &str) -> std::io::Result<Net> {
        let mut bytes = vec![];
        std::fs::File::open(path)?.read_to_end(&mut bytes)?;
        if &bytes[..6] != b"TPNET1" {
            return Err(std::io::Error::other("not a network file"));
        }
        let u = |i: usize| u32::from_le_bytes(bytes[6 + 4 * i..10 + 4 * i].try_into().unwrap()) as usize;
        let (inputs, h1, h2) = (u(0), u(1), u(2));
        let mut at = 18;
        let mut take = |n: usize| {
            let v: Vec<f32> = bytes[at..at + 4 * n].chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
            at += 4 * n;
            v
        };
        Ok(Net { inputs, h1, h2, w1: take(inputs * h1), b1: take(h1), w2: take(h2 * h1), b2: take(h2), w3: take(OUT * h2), b3: take(OUT) })
    }
}

pub fn softmax(z: &[f32; OUT], players: usize) -> [f32; OUT] {
    let m = z[..players].iter().cloned().fold(f32::MIN, f32::max);
    let mut p = [0f32; OUT];
    let mut s = 0.;
    for k in 0..players {
        p[k] = (z[k] - m).exp();
        s += p[k];
    }
    for k in 0..players {
        p[k] /= s;
    }
    p
}

/// one training example: a position (quantised to bytes, value/255), whose seat won (relative to the one who sees),
/// and how many played
#[derive(Clone)]
pub struct Sample {
    pub x: Vec<u8>,
    pub winner: u8,
    pub players: u8,
}

pub fn quantise(x: &[f32]) -> Vec<u8> {
    x.iter().map(|&v| (v.clamp(0., 1.) * 255.).round() as u8).collect()
}

/// the mean loss (cross-entropy of who won) on samples it hasn't learned from: how well it predicts new games
pub fn loss(net: &Net, samples: &[Sample]) -> f32 {
    let mut s = net.scratch();
    let mut total = 0.;
    for smp in samples {
        s.nz.clear();
        for (i, &q) in smp.x.iter().enumerate() {
            if q != 0 {
                s.nz.push((i, q as f32 / 255.));
            }
        }
        let p = softmax(&net.forward_sparse(&mut s), smp.players as usize);
        total -= p[smp.winner as usize].max(1e-7).ln();
    }
    total / samples.len().max(1) as f32
}

/// Adam over the whole network, with the gradient of a batch summed in place
pub struct Trainer {
    pub lr: f32,
    pub l2: f32,
    step: i32,
    g: Net,
    m: Net,
    v: Net,
}

fn zeros_like(n: &Net) -> Net {
    let z = |v: &Vec<f32>| vec![0f32; v.len()];
    Net { inputs: n.inputs, h1: n.h1, h2: n.h2, w1: z(&n.w1), b1: z(&n.b1), w2: z(&n.w2), b2: z(&n.b2), w3: z(&n.w3), b3: z(&n.b3) }
}

impl Trainer {
    pub fn new(net: &Net, lr: f32) -> Trainer {
        Trainer { lr, l2: 1e-6, step: 0, g: zeros_like(net), m: zeros_like(net), v: zeros_like(net) }
    }

    /// one step on a batch: returns the mean loss (cross-entropy of who won)
    pub fn train(&mut self, net: &mut Net, batch: &[&Sample]) -> f32 {
        let (h1, h2) = (net.h1, net.h2);
        for v in [&mut self.g.w1, &mut self.g.b1, &mut self.g.w2, &mut self.g.b2, &mut self.g.w3, &mut self.g.b3] {
            v.iter_mut().for_each(|x| *x = 0.);
        }
        let mut s = net.scratch();
        let mut d2 = vec![0f32; h2];
        let mut d1 = vec![0f32; h1];
        let mut loss = 0.;
        for smp in batch {
            s.nz.clear();
            for (i, &q) in smp.x.iter().enumerate() {
                if q != 0 {
                    s.nz.push((i, q as f32 / 255.));
                }
            }
            let z = net.forward_sparse(&mut s);
            let n = smp.players as usize;
            let p = softmax(&z, n);
            loss -= p[smp.winner as usize].max(1e-7).ln();
            // output layer
            let mut dz = [0f32; OUT];
            for k in 0..n {
                dz[k] = p[k] - if k == smp.winner as usize { 1. } else { 0. };
            }
            d2.iter_mut().for_each(|x| *x = 0.);
            for k in 0..n {
                self.g.b3[k] += dz[k];
                let row = &mut self.g.w3[k * h2..(k + 1) * h2];
                for j in 0..h2 {
                    row[j] += dz[k] * s.a2[j];
                    d2[j] += dz[k] * net.w3[k * h2 + j];
                }
            }
            // second layer
            d1.iter_mut().for_each(|x| *x = 0.);
            for j in 0..h2 {
                if s.a2[j] <= 0. {
                    continue;
                }
                let dj = d2[j];
                self.g.b2[j] += dj;
                let grow = &mut self.g.w2[j * h1..(j + 1) * h1];
                let wrow = &net.w2[j * h1..(j + 1) * h1];
                for i in 0..h1 {
                    grow[i] += dj * s.a1[i];
                    d1[i] += dj * wrow[i];
                }
            }
            // first layer (only the inputs that were on)
            for i in 0..h1 {
                if s.a1[i] <= 0. {
                    d1[i] = 0.;
                }
            }
            for (a, d) in self.g.b1.iter_mut().zip(&d1) {
                *a += d;
            }
            for &(i, xv) in &s.nz {
                let row = &mut self.g.w1[i * h1..(i + 1) * h1];
                for (g, d) in row.iter_mut().zip(&d1) {
                    *g += xv * d;
                }
            }
        }
        // Adam
        self.step += 1;
        let (b1, b2, eps) = (0.9f32, 0.999f32, 1e-8f32);
        let c1 = 1. - b1.powi(self.step);
        let c2 = 1. - b2.powi(self.step);
        let scale = 1. / batch.len() as f32;
        let lr = self.lr;
        let l2 = self.l2;
        let upd = |w: &mut Vec<f32>, g: &Vec<f32>, m: &mut Vec<f32>, v: &mut Vec<f32>, sparse: bool| {
            for i in 0..w.len() {
                let gi = g[i] * scale + l2 * w[i];
                // (the first layer: inputs never seen in this batch keep their moments, so they aren't nudged)
                if sparse && g[i] == 0. {
                    continue;
                }
                m[i] = b1 * m[i] + (1. - b1) * gi;
                v[i] = b2 * v[i] + (1. - b2) * gi * gi;
                w[i] -= lr * (m[i] / c1) / ((v[i] / c2).sqrt() + eps);
            }
        };
        upd(&mut net.w1, &self.g.w1, &mut self.m.w1, &mut self.v.w1, true);
        upd(&mut net.b1, &self.g.b1, &mut self.m.b1, &mut self.v.b1, false);
        upd(&mut net.w2, &self.g.w2, &mut self.m.w2, &mut self.v.w2, false);
        upd(&mut net.b2, &self.g.b2, &mut self.m.b2, &mut self.v.b2, false);
        upd(&mut net.w3, &self.g.w3, &mut self.m.w3, &mut self.v.w3, false);
        upd(&mut net.b3, &self.g.b3, &mut self.m.b3, &mut self.v.b3, false);
        loss / batch.len() as f32
    }
}
