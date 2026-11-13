/* Worksheet Studio — Smart worksheet scanner.
 * Finds the four corner markers on a photo of a printed smart worksheet, works out the perspective
 * (so rotated, tilted or angled photos are fine), reads the ID strip between the top markers, and
 * straightens the page. Then it cuts out each question's answer area using the layout saved at print
 * time, so the AI reads every answer next to the right question number.
 * Everything here is plain canvas maths: no network, no libraries. */
(function (root) {
  'use strict';

  // Geometry shared with core/render.js (CSS px at 96 per inch).
  const R = root.Render;
  const S = R.SMART, PAPERS = R.PAPER;

  // ---------- image helpers ----------
  function loadImage(b64) {
    return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('A page image could not be opened')); i.src = 'data:image/jpeg;base64,' + b64; });
  }
  function toCanvas(img, maxSide) {
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const c = document.createElement('canvas');
    c.width = Math.round((img.naturalWidth || img.width) * k); c.height = Math.round((img.naturalHeight || img.height) * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function gray(canvas) {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return { g, w, h };
  }
  // Stretch to full contrast: the darkest 1% become black and the brightest 1% white. A washed-out or
  // dim camera picture (grey "black", grey paper) then looks like a clean print to the checks below.
  function stretch(G) {
    const { g } = G, hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
    const cut = g.length * 0.01;
    let lo = 0, hi = 255;
    for (let acc = 0; lo < 255 && (acc += hist[lo]) < cut; lo++);
    for (let acc = 0; hi > 0 && (acc += hist[hi]) < cut; hi--);
    if (hi - lo < 24 || (lo < 12 && hi > 243)) return G;      // already full range (or nothing there)
    const k = 255 / (hi - lo);
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, (g[i] - lo) * k));
    return G;
  }

  // ---------- marker detection ----------
  function darkMask({ g, w, h }) {
    // Local-mean threshold (window much larger than a marker) plus an absolute "really dark" test.
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i] | 0]++;
    let median = 0;
    for (let acc = 0; median < 255 && (acc += hist[median]) < g.length / 2; median++);
    const r = Math.max(8, Math.round(Math.min(w, h) / 9));
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0)), v = g[y * w + x];
        m[y * w + x] = (v < mean * 0.72 || v < median * 0.42) ? 1 : 0;
      }
    }
    return m;
  }
  function blobs(mask, w, h) {
    const lab = new Int32Array(w * h), out = [], stack = new Int32Array(w * h);
    let id = 0;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || lab[s]) continue;
      id++;
      let sp = 0; stack[sp++] = s; lab[s] = id;
      const b = { n: 0, sx: 0, sy: 0, minx: w, maxx: 0, miny: h, maxy: 0, L: null, Rt: null, T: null, B: null };
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p - x) / w;
        b.n++; b.sx += x; b.sy += y;
        if (x < b.minx) { b.minx = x; b.L = [x, y]; } if (x > b.maxx) { b.maxx = x; b.Rt = [x, y]; }
        if (y < b.miny) { b.miny = y; b.T = [x, y]; } if (y > b.maxy) { b.maxy = y; b.B = [x, y]; }
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      out.push(b);
    }
    return out;
  }
  const quadArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
  // A printed corner square is solid ink with clean paper all round it. Wood knots, floor tiles, keyboard
  // keys and letters mostly fail this, so they can't crowd the real squares out of the search.
  function surround(G, b) {
    const cx = b.sx / b.n, cy = b.sy / b.n, side = Math.sqrt(b.n);
    let black = 0;
    for (const [dx, dy] of [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]) black = Math.max(black, sampleAt(G, cx + dx * side, cy + dy * side));
    const ring = [];
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, r = side * (Math.abs(Math.cos(a)) > 0.7 || Math.abs(Math.sin(a)) > 0.7 ? 1.0 : 1.2); ring.push(sampleAt(G, cx + Math.cos(a) * r, cy + Math.sin(a) * r)); }
    ring.sort((x, y) => x - y);
    const low = ring[1], mid = ring[6];           // allow one dark sample (a nearby line or the code strip)
    if (mid - black < 35 || low - black < 0.45 * (mid - black)) return null;
    return { q: mid - black, hole: (sampleAt(G, cx, cy) - black) / (mid - black) };
  }
  function markerCandidates(bl, w, h, G) {
    const md = Math.min(w, h);
    const list = bl.filter(b => {
      const bw = b.maxx - b.minx + 1, bh = b.maxy - b.miny + 1;
      if (bw < md * 0.012 || bh < md * 0.012 || bw > md * 0.11 || bh > md * 0.11) return false;
      if (bw / bh > 1.9 || bh / bw > 1.9) return false;
      // A filled square at any angle fills the quadrilateral through its four extreme points.
      const qa = quadArea([b.L, b.T, b.Rt, b.B]);
      const fillBox = b.n / (bw * bh);
      return fillBox > 0.42 && (qa < 4 || b.n / qa > 0.78);
    }).map(b => { const r = G ? surround(G, b) : { q: 1, hole: 0 }; return r && { x: b.sx / b.n, y: b.sy / b.n, size: Math.sqrt(b.n), q: r.q, hole: r.hole }; }).filter(Boolean);
    return G ? list.sort((a, b) => b.q - a.q).slice(0, 40) : list;
  }

  // ---------- homography ----------
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
    return x;
  }
  // Maps page coordinates (src) to photo coordinates (dst).
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h && [...h, 1];
  }
  const apply = (H, x, y) => { const d = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d]; };

  function markerCentres(P) {
    const c = S.inset + S.marker / 2;
    return [[c, c], [P.w - c, c], [P.w - c, P.h - c], [c, P.h - c]]; // TL, TR, BR, BL
  }
  function sampleAt(G, x, y) {
    const xi = Math.round(x), yi = Math.round(y);
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = xi + dx, Y = yi + dy;
      if (X >= 0 && Y >= 0 && X < G.w && Y < G.h) { s += G.g[Y * G.w + X]; n++; }
    }
    return n ? s / n : 255;
  }
  // Average over a small box (r = half-width in pixels).
  function sampleBox(G, x, y, r) {
    if (r <= 1.2) return sampleAt(G, x, y);
    const R0 = Math.round(r);
    let s = 0, n = 0;
    for (let dy = -R0; dy <= R0; dy++) for (let dx = -R0; dx <= R0; dx++) {
      const X = Math.round(x + dx), Y = Math.round(y + dy);
      if (X >= 0 && Y >= 0 && X < G.w && Y < G.h) { s += G.g[Y * G.w + X]; n++; }
    }
    return n ? s / n : 255;
  }
  // hi (optional): { source, scale } — a sharper copy of the same picture (e.g. the live video at full size),
  // `scale` times bigger than G. The code strip's cells are tiny, so they're read from that when offered.
  function readStrip(G, H, P, hi, info) {
    const left = (P.w - 32 * S.cell) / 2, cy = S.stripTop + S.cellH / 2;
    const pts = [];
    for (let i = 0; i < 32; i++) pts.push(apply(H, left + (i + 0.5) * S.cell, cy));
    let v;
    const cellPx = Math.hypot(pts[31][0] - pts[0][0], pts[31][1] - pts[0][1]) / 31;
    if (hi && hi.scale > 1.2 && cellPx < 9) {
      const k = hi.scale, pad = cellPx * 2;
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x0 = Math.max(0, (Math.min(...xs) - pad) * k), y0 = Math.max(0, (Math.min(...ys) - pad) * k);
      const x1 = (Math.max(...xs) + pad) * k, y1 = (Math.max(...ys) + pad) * k;
      const sw = Math.max(1, Math.round(x1 - x0)), sh = Math.max(1, Math.round(y1 - y0));
      const f = Math.min(1, 1600 / sw);                       // keep the copied strip small
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * f)); c.height = Math.max(1, Math.round(sh * f));
      try {
        c.getContext('2d', { willReadFrequently: true }).drawImage(hi.source, x0, y0, sw, sh, 0, 0, c.width, c.height);
        const Gh = stretch(gray(c)), m = k * f;
        v = pts.map(([x, y]) => sampleBox(Gh, (x * k - x0) * f, (y * k - y0) * f, cellPx * m * 0.22));
      } catch (_) { v = null; }
    }
    if (!v) v = pts.map(([x, y]) => sampleBox(G, x, y, cellPx * 0.22));
    const black = (v[0] + v[31]) / 2, white = (v[1] + v[30]) / 2;
    if (white - black < 25) return null;
    // Blank paper right above and below the strip (a random pattern rarely has that).
    let clear = 0;
    for (let i = 0; i < 32; i += 3) for (const dy of [-0.85, 0.85]) {
      const [x, y] = apply(H, left + (i + 0.5) * S.cell, cy + dy * S.cellH * 1.25);
      if (sampleAt(G, x, y) > black + 0.6 * (white - black)) clear++;
    }
    if (clear < 20) return null;
    if (info) info.strip = true;                               // the strip is there, even if it can't be read yet
    const t = (black + white) / 2, cells = v.slice(2, 30);
    const id = R.smartDecode(cells.map(x => (x < t ? 1 : 0)));
    if (!id) return null;
    id.margin = Math.min(...cells.map(x => Math.abs(x - t))) / (white - black); // how cleanly every cell read
    return id;
  }

  // Does each predicted marker look like a marker: dark in the middle, paper-white just outside it,
  // and (top-left only) a white hole in the centre? Returns a score; null if any check fails.
  function verify(G, H, P) {
    const c = markerCentres(P), m = S.marker;
    let score = 0, inkSum = 0, paperSum = 0;
    const holes = [];
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = c[i];
      const out = [[-0.95, 0], [0.95, 0], [0, -0.95], [0, 0.95]].map(([dx, dy]) => sampleAt(G, ...apply(H, cx + dx * m, cy + dy * m)));
      const ink = [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]].map(([dx, dy]) => sampleAt(G, ...apply(H, cx + dx * m, cy + dy * m)));
      const white = out.reduce((a, b) => a + b, 0) / 4, black = Math.max(...ink);
      if (white - black < 24) return null;
      const mid = sampleAt(G, ...apply(H, cx, cy));
      holes.push((mid - black) / (white - black));
      inkSum += black; paperSum += white;
      if (i > 0 && holes[i] > 0.55) return null;
      score += white - black;
    }
    // The top-left square has a white hole. In a far or blurry picture it fades to grey, so it only has
    // to be clearly lighter than the middles of the other three squares.
    if (holes[0] < 0.4 && holes[0] - Math.max(holes[1], holes[2], holes[3]) < 0.12) return null;
    // A printed page has blank paper margins running between the squares; a tabletop doesn't.
    const ink = inkSum / 4, paper = paperSum / 4;             // the squares' black and the paper next to them
    const [ax, ay] = c[0], [bx] = c[1], [, dy] = c[3];
    const left = (P.w - 32 * S.cell) / 2 - 6, right = P.w - left;
    const pts = [];
    for (let t = 1; t < 10; t++) {
      const fx = ax + (bx - ax) * t / 10, fy = ay + (dy - ay) * t / 10;
      if (fx < left || fx > right) pts.push([fx, ay]);       // top edge, skipping the code strip
      pts.push([fx, dy], [ax, fy], [bx, fy]);                // bottom, left and right edges
    }
    let clean = 0;
    for (const [x, y] of pts) if (sampleAt(G, ...apply(H, x, y)) - ink > 0.6 * (paper - ink)) clean++;
    if (clean < pts.length * 0.8) return null;
    return score;
  }

  // Find four candidates that form the page's marker rectangle. Every set of four from the strongest
  // candidates (plus the ones nearest each corner of the picture) is put in order around its centre and
  // checked for a plausible shape before the slower pixel checks. A match needs all four markers to
  // check out AND the ID strip to decode; the best-scoring match wins.
  function locate(G, cands, paperFor, hi) {
    if (cands.length < 4) return null;
    const byQ = cands.slice().sort((a, b) => (b.q || 0) - (a.q || 0)).slice(0, 18);
    const ext = (score) => cands.slice().sort((a, b) => score(a) - score(b)).slice(0, 4);
    const pool = [...new Set([...byQ, ...ext(c => c.x + c.y), ...ext(c => -c.x + c.y), ...ext(c => -c.x - c.y), ...ext(c => c.x - c.y)])].slice(0, 30);
    const minArea = G.w * G.h * 0.02;
    const N = pool.length, hits = [];
    const okSize = (a, b) => a.size / b.size < 3.2 && b.size / a.size < 3.2;   // near squares look bigger than far ones
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      if (!okSize(pool[i], pool[j])) continue;
      for (let k = j + 1; k < N; k++) {
        if (!okSize(pool[i], pool[k]) || !okSize(pool[j], pool[k])) continue;
        for (let l = k + 1; l < N; l++) {
          const d = pool[l];
          if (!okSize(pool[i], d) || !okSize(pool[j], d) || !okSize(pool[k], d)) continue;
          const four = [pool[i], pool[j], pool[k], d];
          const cx = (four[0].x + four[1].x + four[2].x + d.x) / 4, cy = (four[0].y + four[1].y + four[2].y + d.y) / 4;
          for (const p of four) p.ang = Math.atan2(p.y - cy, p.x - cx);
          const pts = four.sort((a, b) => a.ang - b.ang); // clockwise on screen
          // convex, big enough, sides roughly in proportion, squares the right size for the rectangle
          let convex = true;
          for (let t = 0; t < 4 && convex; t++) {
            const a = pts[t], b = pts[(t + 1) % 4], c = pts[(t + 2) % 4];
            if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) convex = false;
          }
          if (!convex) continue;
          // A sheet photographed at any sensible angle keeps its corners roughly square.
          let square = true;
          for (let t = 0; t < 4 && square; t++) {
            const a = pts[(t + 3) % 4], b = pts[t], c = pts[(t + 1) % 4];
            const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
            const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
            if (Math.abs(cos) > 0.574) square = false;            // outside 55°–125°
          }
          if (!square) continue;
          const s0 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y), s1 = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
          const s2 = Math.hypot(pts[3].x - pts[2].x, pts[3].y - pts[2].y), s3 = Math.hypot(pts[0].x - pts[3].x, pts[0].y - pts[3].y);
          if (s0 / s2 > 2.2 || s2 / s0 > 2.2 || s1 / s3 > 2.2 || s3 / s1 > 2.2) continue;
          const msz = (pts[0].size + pts[1].size + pts[2].size + pts[3].size) / 4, rel = msz / ((s0 + s1 + s2 + s3) / 4);
          if (rel < 0.016 || rel > 0.08) continue;
          if (quadArea(pts.map(p => [p.x, p.y])) < minArea) continue;
          // The four points are the same whichever way up the page is, so the pixel check runs once, with
          // the square that has the clearest white hole as top-left. Which way up (and which paper size)
          // is settled below by reading the code strip, for the best few sets only.
          const order = [0, 1, 2, 3].sort((a, b) => (pts[b].hole || 0) - (pts[a].hole || 0));
          const dst = [0, 1, 2, 3].map(t => [pts[(t + order[0]) % 4].x, pts[(t + order[0]) % 4].y]);
          const H = homography(markerCentres(PAPERS.Letter), dst);
          const score = H && verify(G, H, PAPERS.Letter);
          if (score != null) hits.push({ pts: pts.slice(), order, score });
        }
      }
    }
    if (!hits.length) return null;
    hits.sort((a, b) => b.score - a.score);
    const best = {};
    let shape = null;
    for (const h of hits.slice(0, 4)) {
      for (const rot of h.order) {
        const dst = [0, 1, 2, 3].map(t => [h.pts[(t + rot) % 4].x, h.pts[(t + rot) % 4].y]);
        for (const paper of ['Letter', 'A4']) {
          const P = PAPERS[paper], H = homography(markerCentres(P), dst);
          if (!H) continue;
          const info = {};
          const id = readStrip(G, H, P, hi, info);
          if (!shape && info.strip) shape = { H, P, paper };
          if (id && (!best[paper] || id.margin > best[paper].id.margin)) best[paper] = { H, paper, P, id, score: h.score };
        }
        if (best.Letter || best.A4) break;
      }
      if (best.Letter || best.A4) break;
    }
    const found = Object.values(best);
    if (!found.length) return shape ? Object.assign({ geoOnly: true }, shape) : null;
    // Both paper sizes can fit the same four markers; the print record knows which was used.
    const known = found.map(f => ({ f, p: paperFor && paperFor(f.id.code) })).find(x => x.p === x.f.paper);
    return known ? known.f : found.sort((a, b) => b.id.margin - a.id.margin)[0];
  }

  // Straighten the page: a canvas of the whole printed page at `k` pixels per CSS pixel.
  function warp(srcCanvas, H, P, k) {
    const sw = srcCanvas.width, sh = srcCanvas.height;
    const src = srcCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
    const W = Math.round(P.w * k), Ht = Math.round(P.h * k);
    const out = document.createElement('canvas'); out.width = W; out.height = Ht;
    const ctx = out.getContext('2d'), od = ctx.createImageData(W, Ht), o = od.data;
    for (let y = 0; y < Ht; y++) {
      for (let x = 0; x < W; x++) {
        const [u, v] = apply(H, x / k, y / k);
        const j = (y * W + x) * 4;
        if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) { o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = 255; continue; }
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        for (let c = 0; c < 3; c++) {
          o[j + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
        }
        o[j + 3] = 255;
      }
    }
    ctx.putImageData(od, 0, 0);
    return out;
  }

  /** Look at one photo. Returns { ok, code, page, paper, canvas (straightened) } or { ok: false }. */
  async function analyzeOne(b64, paperFor) {
    const img = await loadImage(b64);
    const full = toCanvas(img, 2400);
    const small = toCanvas(full, 1100);
    const G = stretch(gray(small));
    const cands = markerCandidates(blobs(darkMask(G), G.w, G.h), G.w, G.h, G);
    const hit = locate(G, cands, paperFor, { source: full, scale: full.width / small.width });
    if (!hit || hit.geoOnly) return { ok: false };
    const s = full.width / small.width;
    const Hfull = hit.H.slice(); for (let i = 0; i < 3; i++) { Hfull[i] *= s; Hfull[3 + i] *= s; }
    return { ok: true, code: hit.id.code, page: hit.id.page, paper: hit.paper, canvas: warp(full, Hfull, hit.P, 1.6), k: 1.6, P: hit.P };
  }
  async function analyze(images, paperFor) {
    const out = [];
    for (const b of images) { try { out.push(await analyzeOne(b, paperFor)); } catch (_) { out.push({ ok: false }); } }
    return out;
  }

  // ---------- phone helpers: live camera frames, photo checks, cleanup ----------

  /** Find a smart page in one small camera frame (about 640 px wide). Fast enough for several frames a second.
   *  Returns the page's code and page number plus where its four corner squares and outline are in the frame. */
  /** Follow a page found in an earlier frame. prev: an earlier detectFrame() result with ok:true.
   *  Only the four corner squares are looked for, near where they were; the page code is not re-read
   *  (it's the part a slightly blurry frame loses first). Returns the same shape as detectFrame(). */
  function trackFrame(canvas, prev, source) {
    if (!prev || !prev.ok || !prev.corners || !prev.P) return { ok: false };
    const G = stretch(gray(canvas));
    const cands = markerCandidates(blobs(darkMask(G), G.w, G.h), G.w, G.h, G);
    if (cands.length < 4) return { ok: false };
    const reach = Math.max(10, 0.08 * Math.max(G.w, G.h));
    const used = new Set(), pts = [];
    for (const [px, py] of prev.corners) {
      let best = null, bd = reach;
      for (const c of cands) { if (used.has(c)) continue; const d = Math.hypot(c.x - px, c.y - py); if (d < bd) { bd = d; best = c; } }
      if (!best) return { ok: false };
      used.add(best); pts.push([best.x, best.y]);
    }
    const P = prev.P, H = homography(markerCentres(P), pts);
    if (!H || verify(G, H, P) === null) return { ok: false };
    // Still try the code: if the student turned to another page (same squares, new code), notice it.
    const sw = source ? (source.videoWidth || source.width) : 0;
    const id = readStrip(G, H, P, sw ? { source, scale: sw / canvas.width } : null);
    const code = id ? id.code : prev.code, page = id ? id.page : prev.page;
    return {
      ok: true, tracked: !id, code, page, paper: prev.paper, H, P,
      corners: pts,
      outline: [[0, 0], [P.w, 0], [P.w, P.h], [0, P.h]].map(([x, y]) => apply(H, x, y)),
    };
  }

  // source (optional): the same picture at full size (a <video> or canvas), used to read the small code strip.
  function detectFrame(canvas, paperFor, source) {
    const G = stretch(gray(canvas));
    const cands = markerCandidates(blobs(darkMask(G), G.w, G.h), G.w, G.h, G);
    const sw = source ? (source.videoWidth || source.width) : 0;
    const hit = locate(G, cands, paperFor, sw ? { source, scale: sw / canvas.width } : null);
    if (!hit) return { ok: false };
    const P = hit.P;
    const where = {
      corners: markerCentres(P).map(([x, y]) => apply(hit.H, x, y)),
      outline: [[0, 0], [P.w, 0], [P.w, P.h], [0, P.h]].map(([x, y]) => apply(hit.H, x, y)),
    };
    // Four squares found but the code strip couldn't be read yet (too far, blurry or moving).
    if (hit.geoOnly) return Object.assign({ ok: false, squares: true }, where);
    return {
      ok: true, code: hit.id.code, page: hit.id.page, paper: hit.paper, H: hit.H, P,
      corners: markerCentres(P).map(([x, y]) => apply(hit.H, x, y)),
      outline: [[0, 0], [P.w, 0], [P.w, P.h], [0, P.h]].map(([x, y]) => apply(hit.H, x, y)),
    };
  }

  /** Same as analyze() for one photo, but from a canvas: finds the page and returns it straightened. */
  function analyzeCanvas(full, paperFor, k) {
    const small = toCanvas(full, 1100);
    const G = stretch(gray(small));
    const hit = locate(G, markerCandidates(blobs(darkMask(G), G.w, G.h), G.w, G.h, G), paperFor, { source: full, scale: full.width / small.width });
    if (!hit || hit.geoOnly) return { ok: false };
    const s = full.width / small.width;
    const Hf = hit.H.slice(); for (let i = 0; i < 3; i++) { Hf[i] *= s; Hf[3 + i] *= s; }
    const kk = k || 1.6;
    return { ok: true, code: hit.id.code, page: hit.id.page, paper: hit.paper, canvas: warp(full, Hf, hit.P, kk), k: kk, P: hit.P };
  }

  /** How usable is this photo? brightness 0-255 (mean), sharpness (spread of edge strength; higher is
   *  crisper), glare (share of blown-out white pixels). Measured on a copy about 900 px on its long side. */
  function quality(canvas) {
    const c = toCanvas(canvas, 900), G = gray(c), { g, w, h } = G;
    let sum = 0; for (let i = 0; i < g.length; i++) sum += g[i];
    const mean = sum / g.length;
    // variance of the Laplacian over the middle 80% (edges of the photo are often table or shadow)
    const x0 = Math.round(w * 0.1), x1 = Math.round(w * 0.9), y0 = Math.round(h * 0.1), y1 = Math.round(h * 0.9);
    let n = 0, m = 0, m2 = 0, blown = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      const L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      n++; const d = L - m; m += d / n; m2 += d * (L - m);
      if (g[i] > 250) blown++;
    }
    return { brightness: mean, sharpness: n > 1 ? m2 / (n - 1) : 0, glare: blown / Math.max(1, n) };
  }

  /** Even out shadows and uneven light: divide every pixel by an estimate of the bare paper's brightness
   *  around it (the photo with all ink removed by a wide "max" filter, then blurred). Works in place. */
  function evenLight(canvas) {
    const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
    const f = 8, sw = Math.max(8, Math.round(W / f)), sh = Math.max(8, Math.round(H / f));
    const sm = document.createElement('canvas'); sm.width = sw; sm.height = sh;
    sm.getContext('2d').drawImage(canvas, 0, 0, sw, sh);
    const sd = sm.getContext('2d').getImageData(0, 0, sw, sh).data;
    let B = new Float32Array(sw * sh);
    for (let i = 0, j = 0; i < B.length; i++, j += 4) B[i] = Math.max(sd[j], sd[j + 1], sd[j + 2]);
    const pass = (src, r, op) => { // separable max filter or box blur
      const out = new Float32Array(src.length), tmp = new Float32Array(src.length);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        let v = op === 'max' ? 0 : 0, c = 0;
        for (let k = -r; k <= r; k++) { const X = Math.min(sw - 1, Math.max(0, x + k)), q = src[y * sw + X]; if (op === 'max') { if (q > v) v = q; } else { v += q; c++; } }
        tmp[y * sw + x] = op === 'max' ? v : v / c;
      }
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        let v = 0, c = 0;
        for (let k = -r; k <= r; k++) { const Y = Math.min(sh - 1, Math.max(0, y + k)), q = tmp[Y * sw + x]; if (op === 'max') { if (q > v) v = q; } else { v += q; c++; } }
        out[y * sw + x] = op === 'max' ? v : v / c;
      }
      return out;
    };
    B = pass(pass(pass(B, 4, 'max'), 4, 'box'), 3, 'box');
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) {
      const fy = Math.min(sh - 1.001, Math.max(0, (y + 0.5) / f - 0.5)), y0 = fy | 0, ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(sw - 1.001, Math.max(0, (x + 0.5) / f - 0.5)), x0 = fx | 0, tx = fx - x0;
        const i0 = y0 * sw + x0;
        const bg = (B[i0] * (1 - tx) + B[i0 + 1] * tx) * (1 - ty) + (B[i0 + sw] * (1 - tx) + B[i0 + sw + 1] * tx) * ty;
        const gain = 248 / Math.max(60, bg), j = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) { const v = d[j + c] * gain; d[j + c] = v > 255 ? 255 : v; }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** Pages without corner squares: find the sheet of paper against the table (the biggest bright,
   *  four-sided shape), then straighten and crop to it. Returns a new canvas, or null if no clear page. */
  function flattenDocument(full) {
    const small = toCanvas(full, 480), w = small.width, h = small.height;
    const d = small.getContext('2d').getImageData(0, 0, w, h).data;
    // light blur so paper texture and JPEG noise don't stop the growth
    const R = new Float32Array(w * h), Gc = new Float32Array(w * h), Bc = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = Math.min(w - 1, Math.max(0, x + dx)), Y = Math.min(h - 1, Math.max(0, y + dy)), j = (Y * w + X) * 4;
        r += d[j]; g += d[j + 1]; b += d[j + 2]; n++;
      }
      const i = y * w + x; R[i] = r / n; Gc[i] = g / n; Bc[i] = b / n;
    }
    // Grow the sheet outward from the middle of the photo. Shadows change gradually from pixel to pixel;
    // the edge of the paper against the table is a sudden step, so the growth stops there.
    const lum = (i) => 0.299 * R[i] + 0.587 * Gc[i] + 0.114 * Bc[i];
    const cx = w >> 1, cy = h >> 1, rad = Math.round(Math.min(w, h) * 0.08);
    const seeds = [];
    for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) seeds.push(y * w + x);
    const sl = seeds.map(lum).sort((p, q) => p - q), bright = sl[Math.floor(sl.length * 0.7)];
    const lab = new Uint8Array(w * h), stack = new Int32Array(w * h);
    let sp = 0;
    for (const i of seeds) if (lum(i) >= bright * 0.9) { lab[i] = 1; stack[sp++] = i; }
    const big = { n: 0, s1: Infinity, s2: -Infinity, s3: -Infinity, s4: -Infinity, tl: null, tr: null, br: null, bl: null, edge: 0 };
    const step = (a, b) => Math.abs(R[a] - R[b]) + Math.abs(Gc[a] - Gc[b]) + Math.abs(Bc[a] - Bc[b]);
    while (sp) {
      const q = stack[--sp], x = q % w, y = (q - x) / w;
      big.n++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) big.edge++;
      if (x + y < big.s1) { big.s1 = x + y; big.tl = [x, y]; }
      if (x - y > big.s2) { big.s2 = x - y; big.tr = [x, y]; }
      if (x + y > big.s3) { big.s3 = x + y; big.br = [x, y]; }
      if (y - x > big.s4) { big.s4 = y - x; big.bl = [x, y]; }
      const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
      for (const k of nb) if (k >= 0 && !lab[k] && step(q, k) < 18 && lum(k) > bright * 0.22) { lab[k] = 1; stack[sp++] = k; }
    }
    // grow through the dark print inside the page too: fill holes by taking the region's outline only
    if (big.n < w * h * 0.15 || big.n > w * h * 0.97) return null;
    if (big.edge > (w + h) * 1.2) return null; // ran off along the photo's edges: the table and the page look alike
    const tl = big.tl, tr = big.tr, br = big.br, bl2 = big.bl;
    const quad = [tl, tr, br, bl2];
    const area = Math.abs(quad.reduce((a, p, i) => { const q = quad[(i + 1) % 4]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    if (area < w * h * 0.15 || big.n / area < 0.6 || big.n / area > 1.08) return null; // not a clean four-sided sheet
    const s = full.width / w, Q = quad.map(([x, y]) => [x * s, y * s]);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ow = Math.round(Math.max(dist(Q[0], Q[1]), dist(Q[3], Q[2]))), oh = Math.round(Math.max(dist(Q[0], Q[3]), dist(Q[1], Q[2])));
    if (ow < 200 || oh < 200) return null;
    const Hm = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], Q);
    return Hm ? warp(full, Hm, { w: ow, h: oh }, 1) : null;
  }

  // ---------- which answer boxes have handwriting ----------
  // Sliding max / min over a (2r+1) square, done as two 1-D passes.
  function slide(g, w, h, r, pickMax) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const f = pickMax ? Math.max : Math.min;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = g[y * w + x];
      for (let d = 1; d <= r; d++) { if (x - d >= 0) v = f(v, g[y * w + x - d]); if (x + d < w) v = f(v, g[y * w + x + d]); }
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let d = 1; d <= r; d++) { if (y - d >= 0) v = f(v, tmp[(y - d) * w + x]); if (y + d < h) v = f(v, tmp[(y + d) * w + x]); }
      out[y * w + x] = v;
    }
    return out;
  }
  /** Compare each question's area on the straightened scan with the same area on a blank copy of the page.
   *  Counts the pixels that are clearly darker than anything printed there: the student's own marks.
   *  blanks: { [pageNumber]: image or canvas of the blank page }. Returns { [q]: { ink, area } } in page pixels
   *  (1 px = 1/96 inch). Shadows are evened out first; printed text is allowed to be a few pixels out of place. */
  function inkCheck(found, layout, blanks, opt) {
    const DIFF = (opt && opt.diff) || 18, CUT = (opt && opt.cut) || 235;
    const out = {};
    for (const f of found) {
      const pg = layout.pages.find(p => p.n === f.page), B = blanks && blanks[f.page];
      if (!pg || !B) continue;
      const P = f.P, W = Math.round(P.w), H = Math.round(P.h);
      const draw = (src) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(src, 0, 0, W, H); return gray(c).g; };
      const scan = draw(f.canvas), blank = draw(B);
      const paper = slide(scan, W, H, 9, true);           // local paper brightness (evens out shadows)
      const printed = slide(blank, W, H, 3, false);       // printed ink, grown by 3 px to allow for small misalignment
      const c0 = S.inset + S.marker / 2, fw = P.w - 2 * c0, fh = P.h - 2 * c0;
      for (const it of pg.items) {
        const x0 = Math.max(0, Math.floor(c0 + it.x * fw) - 2), y0 = Math.max(0, Math.floor(c0 + it.y * fh) - 2);
        const x1 = Math.min(W, Math.ceil(c0 + (it.x + it.w) * fw) + 2), y1 = Math.min(H, Math.ceil(c0 + (it.y + it.h) * fh) + 2);
        let ink = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * W + x, v = Math.min(255, scan[i] * 255 / Math.max(40, paper[i]));
          if (v < CUT && v < printed[i] - DIFF) ink++;
        }
        out[it.q] = { ink, area: (x1 - x0) * (y1 - y0) };
      }
    }
    return out;
  }
  // Fewer marks than this (in 1/96-inch pixels) means nothing was written: a single small digit in light
  // pencil leaves about 100; an empty box on a phone photo usually 0, rarely more than 20.
  const INK_EMPTY = 25;

  /** Cut each question's area out of the straightened pages and stack them, labelled, into a few tall
   *  images for the AI. layout.pages[n].items = [{ q, x, y, w, h }] in fractions of the marker frame. */
  function answerBoards(found, layout) {
    const pieces = [];
    for (const f of found) {
      const pg = layout.pages.find(p => p.n === f.page); if (!pg) continue;
      const P = f.P, k = f.k, c0 = S.inset + S.marker / 2, fw = P.w - 2 * c0, fh = P.h - 2 * c0;
      for (const it of pg.items) {
        const pad = 6;
        const x = Math.max(0, (c0 + it.x * fw - pad - 22) * k), y = Math.max(0, (c0 + it.y * fh - pad) * k);
        const w = Math.min(f.canvas.width - x, (it.w * fw + 2 * pad + 22) * k), h = Math.min(f.canvas.height - y, (it.h * fh + 2 * pad) * k);
        if (w > 4 && h > 4) pieces.push({ q: it.q, src: f.canvas, x, y, w, h });
      }
    }
    pieces.sort((a, b) => a.q - b.q);
    const W = 1100, LABEL = 34, GAP = 14, MAXH = 1900;
    const boards = [];
    let cur = [], curH = 0;
    const flush = () => {
      if (!cur.length) return;
      const c = document.createElement('canvas'); c.width = W; c.height = curH;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, curH);
      let y = 0;
      for (const p of cur) {
        g.fillStyle = '#1B2A8A'; g.fillRect(0, y, W, LABEL);
        g.fillStyle = '#fff'; g.font = 'bold 22px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle';
        g.fillText(`Question ${p.q}`, 12, y + LABEL / 2);
        g.drawImage(p.src, p.x, p.y, p.w, p.h, 0, y + LABEL, p.dw, p.dh);
        g.strokeStyle = '#1B2A8A'; g.lineWidth = 2; g.strokeRect(1, y + 1, W - 2, LABEL + p.dh - 2);
        y += LABEL + p.dh + GAP;
      }
      boards.push(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
      cur = []; curH = 0;
    };
    for (const p of pieces) {
      const sc = Math.min(W / p.w, 1.5); p.dw = Math.round(p.w * sc); p.dh = Math.round(p.h * sc);
      const need = LABEL + p.dh + GAP;
      if (curH + need > MAXH && cur.length) flush();
      cur.push(p); curH += need;
    }
    flush();
    return { boards, questions: pieces.map(p => p.q) };
  }

  root.SmartScan = { analyze, answerBoards, inkCheck, INK_EMPTY, trackFrame, detectFrame, analyzeCanvas, quality, evenLight, flattenDocument, toCanvas, _internal: { darkMask, blobs, markerCandidates, homography, apply, locate, gray, readStrip, verify, markerCentres, surround } };
})(typeof self !== 'undefined' ? self : this);
