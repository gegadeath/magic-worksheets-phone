/* Worksheet Studio phone app: live scanner.
 * Shows the camera full screen and looks for a smart worksheet's four corner squares several times a
 * second. When all four are in view, the page fills enough of the picture, the light is good and the
 * phone has been steady for about half a second, it takes the photo by itself. Pages without corner
 * squares are taken with the shutter button.
 *
 * Camera.open({
 *   registry,                       // { [code]: { k, paper, pages, title } } from the Mac
 *   expectSheet,                    // sheet key the pages must belong to (optional)
 *   has(code, page) -> bool,        // already captured?
 *   onCapture(canvas) -> Promise<{ ok, code, page, message }>,   // clean up and keep the page
 *   onClose()                       // camera closed (by Done, ×, or every page captured)
 * }) */
(function (root) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const WORK = 640;          // long side of the frame that gets analysed (the code strip is read from the full frame)
  const TICK = 170;          // ms between looks
  const STEADY = 3;          // steady looks in a row before taking the photo
  const HOLD_MS = 700;       // keep showing a found page this long through frames where it's lost
  const TRACK_MS = 1500;     // follow a found page from frame to frame for this long after last seeing it
  const READ_MS = 900;       // how long a page code read earlier is trusted while following the squares
  const MOVE = 0.012;        // corners may move this share of the frame diagonal and still count as steady

  let cur = null;

  function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  async function open(opts) {
    if (cur) close();
    const el = document.createElement('div');
    el.className = 'cam';
    el.innerHTML = `
      <video playsinline muted autoplay></video>
      <canvas class="camDraw"></canvas>
      <div class="camFlash"></div>
      <div class="camTop">
        <button class="camX" data-cam="close" aria-label="Close the camera">×</button>
        <span class="camCount"></span>
        <button class="camTorch hidden" data-cam="torch" aria-label="Light">⚡</button>
      </div>
      <div class="camMsg"><b>Starting the camera…</b></div>
      <button class="camSave hidden" data-cam="save">Not finding it? Save a test picture</button>
      <div class="camBottom">
        <span class="camHint">Pages with corner squares are taken by themselves</span>
        <button class="camShutter" data-cam="shoot" aria-label="Take the photo"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" class="ringBg"/><circle cx="40" cy="40" r="34" class="ring"/></svg><i></i></button>
        <button class="camDone" data-cam="done">Done</button>
      </div>`;
    document.body.appendChild(el);
    const st = { opts, el, video: $('video', el), draw: $('.camDraw', el), work: document.createElement('canvas'), stream: null, track: null,
      timer: null, prev: null, steady: 0, busy: false, last: null, torch: false, closed: false, taken: 0 };
    cur = st;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cam]'); if (!b) return;
      const a = b.dataset.cam;
      if (a === 'close' || a === 'done') close();
      else if (a === 'shoot') capture(st, null);
      else if (a === 'torch') setTorch(st, !st.torch);
      else if (a === 'save') saveTest(st);
    });
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
    } catch (e) {
      close();
      throw new Error(e && e.name === 'NotAllowedError' ? 'blocked' : 'nocamera');
    }
    if (st.closed) { st.stream.getTracks().forEach(t => t.stop()); return; }
    st.track = st.stream.getVideoTracks()[0];
    st.video.srcObject = st.stream;
    try { await st.video.play(); } catch (_) { /* autoplay with muted is allowed */ }
    try {
      const caps = st.track.getCapabilities ? st.track.getCapabilities() : {};
      if (caps.torch) $('.camTorch', el).classList.remove('hidden');
      if (caps.focusMode && caps.focusMode.includes('continuous')) st.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    } catch (_) { /* fine */ }
    updateCount(st);
    say(st, 'Point at the worksheet', 'Keep all four corner squares in view.');
    st.timer = setInterval(() => look(st), TICK);
  }

  function close() {
    const st = cur; if (!st) return;
    cur = null; st.closed = true;
    clearInterval(st.timer);
    if (st.stream) st.stream.getTracks().forEach(t => t.stop());
    st.el.classList.add('out');
    setTimeout(() => st.el.remove(), 250);
    if (st.opts.onClose) st.opts.onClose(st.taken);
  }

  function setTorch(st, on) {
    if (!st.track) return;
    st.track.applyConstraints({ advanced: [{ torch: on }] }).then(() => { st.torch = on; $('.camTorch', st.el).classList.toggle('on', on); }).catch(() => {});
  }

  function say(st, big, small, tone) {
    const m = $('.camMsg', st.el);
    const html = `<b>${big}</b>${small ? `<small>${small}</small>` : ''}`;
    if (m.dataset.html !== html) { m.dataset.html = html; m.innerHTML = html; }
    m.className = 'camMsg' + (tone ? ' ' + tone : '');
  }
  function updateCount(st) {
    const n = st.opts.count ? st.opts.count() : st.taken;
    $('.camCount', st.el).textContent = n ? `${n} page${n === 1 ? '' : 's'}` : '';
  }
  function ring(st, share) {
    const c = $('.camShutter .ring', st.el);
    c.style.strokeDashoffset = String(213.6 * (1 - Math.max(0, Math.min(1, share))));
  }

  // Where a point in the analysed frame lands on screen (the video fills the screen and is cropped).
  function mapper(st) {
    const v = st.video, vw = v.videoWidth, vh = v.videoHeight, ew = v.clientWidth, eh = v.clientHeight;
    const s = Math.max(ew / vw, eh / vh), ox = (ew - vw * s) / 2, oy = (eh - vh * s) / 2, f = st.work.width / vw;
    return ([x, y]) => [x / f * s + ox, y / f * s + oy];
  }
  function paint(st, hit, tone) {
    const c = st.draw, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    if (!hit) return;
    const m = mapper(st), o = hit.outline.map(m), k = hit.corners.map(m);
    x.lineJoin = 'round';
    x.fillStyle = tone === 'go' ? 'rgba(18,163,122,.18)' : tone === 'bad' ? 'rgba(224,57,62,.16)' : 'rgba(255,225,90,.14)';
    x.strokeStyle = tone === 'go' ? '#12A37A' : tone === 'bad' ? '#E0393E' : '#FFE15A';
    x.lineWidth = 4;
    x.beginPath(); o.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill(); x.stroke();
    k.forEach(([px, py]) => { x.beginPath(); x.arc(px, py, 9, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 3; x.stroke(); });
  }

  function look(st) {
    const v = st.video;
    if (st.busy || !v.videoWidth) return;
    const k = WORK / Math.max(v.videoWidth, v.videoHeight);
    const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
    if (st.work.width !== w) { st.work.width = w; st.work.height = h; }
    const wx = st.work.getContext('2d', { willReadFrequently: true });
    wx.drawImage(v, 0, 0, w, h);
    const reg = st.opts.registry || {};
    const now = Date.now();
    let hit;
    try {
      // Follow the page found a moment ago (fast, and works on frames too blurry to read the code);
      // search the whole picture only when that fails.
      if (st.last && now - st.last.at < TRACK_MS) hit = root.SmartScan.trackFrame(st.work, st.last.hit, v);
      if (!hit || !hit.ok) hit = root.SmartScan.detectFrame(st.work, (c) => reg[c] && reg[c].paper, v);
    } catch (_) { hit = { ok: false }; }
    if (hit.ok || hit.squares) { st.missSince = null; $('.camSave', st.el).classList.add('hidden'); }
    else if (!st.missSince) st.missSince = now;
    else if (now - st.missSince > 5000) $('.camSave', st.el).classList.remove('hidden');
    if (hit.ok) st.last = { hit, at: now };
    else if (st.last && now - st.last.at < HOLD_MS) {
      // A frame or two lost (hand moved, camera refocusing): keep showing the page and the countdown.
      paint(st, st.last.hit, st.steady >= STEADY ? 'go' : '');
      return;
    }
    // Following the squares doesn't tell which page it is. A remembered page code is trusted for a
    // moment only; after that the code has to be read again (the student may have turned the page).
    if (hit.ok && !hit.tracked) st.read = now;
    if (hit.ok && hit.tracked && (!st.read || now - st.read > READ_MS)) hit = Object.assign({}, hit, { ok: false, squares: true });
    const q = root.SmartScan.quality(st.work);
    // A code that isn't in the library has to be seen twice in a row before we say so (one misread
    // frame shouldn't flash a red warning).
    if (hit.ok && !reg[hit.code]) {
      const again = st.lastUnknown === hit.code;
      st.lastUnknown = hit.code;
      if (!again) hit = Object.assign({}, hit, { ok: false, squares: true });
    } else st.lastUnknown = null;
    if (!hit.ok && hit.squares) {
      // All four corner squares are in view but the page code isn't readable yet.
      st.prev = null; st.steady = 0; ring(st, 0); paint(st, hit);
      const area = polyArea(hit.outline) / (w * h);
      if (area < 0.22) return say(st, 'Move closer', 'Found the corner squares. Fill more of the screen with the page.');
      if (q.brightness < 55) return say(st, 'Too dark', 'Tap ⚡ for light, or move somewhere brighter.', 'warn');
      return say(st, 'Hold still…', 'Found the corner squares. Reading the page code.');
    }
    if (!hit.ok) {
      st.prev = null; st.steady = 0; ring(st, 0); paint(st, null);
      if (q.brightness < 55) return say(st, 'Too dark', st.track && !$('.camTorch', st.el).classList.contains('hidden') ? 'Tap ⚡ for light, or move somewhere brighter.' : 'Move somewhere brighter.', 'warn');
      return say(st, 'Point at the worksheet', 'Keep all four corner squares in view. For a sheet without them, tap the button.');
    }
    const info = reg[hit.code];
    const label = `page ${hit.page + 1}${info && info.pages > 1 ? ' of ' + info.pages : ''}`;
    if (!info) { st.steady = 0; ring(st, 0); paint(st, hit, 'bad'); return say(st, 'Not one of your worksheets', 'This page isn’t in your library on the Mac.', 'bad'); }
    const expect = typeof st.opts.expectSheet === 'function' ? st.opts.expectSheet() : st.opts.expectSheet;
    if (expect && info.k !== expect) {
      st.steady = 0; ring(st, 0); paint(st, hit, 'bad');
      return say(st, 'That’s a different worksheet', `${info.title || 'Another worksheet'}. Close the camera and press Change to switch.`, 'bad');
    }
    if (st.opts.has && st.opts.has(hit.code, hit.page)) {
      st.steady = 0; ring(st, 0); paint(st, hit, 'go');
      const next = info.pages > 1 ? nextMissing(st, hit.code, info.pages) : null;
      return say(st, `Got ${label} ✓`, next != null ? `Turn to page ${next + 1}.` : 'Tap Done.', 'good');
    }
    // the page has to fill a fair part of the picture to be readable
    const area = polyArea(hit.outline) / (w * h);
    if (area < 0.22) { st.steady = 0; ring(st, 0); paint(st, hit); return say(st, 'Move closer', `Found ${label}. Fill more of the screen with it.`); }
    if (q.brightness < 55) { st.steady = 0; ring(st, 0); paint(st, hit); return say(st, 'Too dark', 'Tap ⚡ for light, or move somewhere brighter.', 'warn'); }
    // steady?
    const diag = Math.hypot(w, h);
    const moved = st.prev ? Math.max(...hit.corners.map((p, i) => Math.hypot(p[0] - st.prev[i][0], p[1] - st.prev[i][1]))) / diag : 1;
    st.prev = hit.corners;
    st.steady = moved < MOVE ? st.steady + 1 : 0;
    ring(st, st.steady / STEADY);
    paint(st, hit, st.steady >= STEADY ? 'go' : '');
    if (st.steady < STEADY) return say(st, 'Hold still…', `Found ${label}.`);
    st.steady = 0;
    capture(st, hit);
  }
  // Save exactly what the camera sees (full size), so a scanning problem can be looked at on a computer.
  function saveTest(st) {
    const v = st.video;
    if (!v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `scan-test-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      const btn = $('.camSave', st.el);
      btn.textContent = 'Saved to Downloads ✓';
      setTimeout(() => { btn.textContent = 'Not finding it? Save a test picture'; }, 4000);
    }, 'image/jpeg', 0.92);
  }
  function nextMissing(st, code, pages) {
    for (let i = 0; i < pages; i++) if (!st.opts.has(code, i)) return i;
    return null;
  }
  const polyArea = (p) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;

  async function grabFull(st) {
    // The camera's own still photo is sharper than a video frame; fall back to the frame if it isn't offered.
    if (root.ImageCapture && st.track) {
      try {
        const ic = new root.ImageCapture(st.track);
        const blob = await Promise.race([ic.takePhoto(), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 2500))]);
        if (blob && blob.size) return blob;
      } catch (_) { /* use the video frame */ }
    }
    const v = st.video, c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  }

  async function capture(st, hit) {
    if (st.busy || st.closed) return;
    st.busy = true;
    const fl = $('.camFlash', st.el); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    if (navigator.vibrate) navigator.vibrate(30);
    say(st, 'Saving the page…', hit ? '' : 'Straightening and cleaning it up.', 'good');
    try {
      const shot = await grabFull(st);
      const r = await st.opts.onCapture(shot, hit);
      if (st.closed) return;
      if (r && r.ok) {
        st.taken++; updateCount(st);
        say(st, r.message || 'Saved ✓', r.detail || '', r.warn ? 'warn' : 'good');
        if (r.allDone) { setTimeout(close, 1100); return; }
      } else say(st, (r && r.message) || 'Couldn’t use that photo', (r && r.detail) || 'Try again.', 'bad');
    } catch (e) {
      say(st, 'Couldn’t take the photo', String(e.message || e), 'bad');
    }
    await new Promise(ok => setTimeout(ok, 900));
    st.busy = false; st.prev = null; st.read = null; ring(st, 0);
  }

  root.Camera = { open, close, supported, isOpen: () => !!cur };
})(window);
