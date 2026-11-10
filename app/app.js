/* Worksheet Studio phone app.
 * Shows what the Mac knows (students, worksheets waiting to be graded, results, progress) and sends
 * scans of finished worksheets to the Mac, which grades them with its local AI.
 * Linked to a household by a secret key received once from the Mac's QR code. */
(function () {
  'use strict';
  const SB = 'https://hlvjfmfabcbcdftkquen.supabase.co';
  const PK = 'sb_publishable_adVnAv6Meh06JxiLHPUIKw_55_j-hOS';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* full */ } } };

  const S = {
    key: ls.get('ws.key', ''), data: ls.get('ws.data', null), dataAt: ls.get('ws.dataAt', null), name: ls.get('ws.name', ''),
    scans: ls.get('ws.scans', []), me: ls.get('ws.me', ''), tab: 'home', filter: ls.get('ws.filter', 'all'), online: navigator.onLine, lastPull: 0, installEvt: null,
  };

  // ---------------- cloud ----------------
  async function rpc(name, args) {
    const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: PK, Authorization: `Bearer ${PK}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(/unknown household/.test(t) ? 'unlinked' : `The service answered ${r.status}`); }
    return r.json();
  }
  async function pull(force) {
    if (!S.key) return;
    try {
      const r = await rpc('hh_pull', { p_key: S.key, p_since: force ? null : S.dataAt });
      if (!r.ok) { unlinked(); return; }
      S.online = true;
      if (r.data) { S.data = r.data; S.dataAt = r.data_at; S.name = r.name; ls.set('ws.data', S.data); ls.set('ws.dataAt', S.dataAt); ls.set('ws.name', S.name); }
      S.lastPull = Date.now();
      if (!pull.who) { pull.who = true; rpc('hh_whoami', { p_key: S.key }).then(w => { if (w && w.label) { S.me = w.label; ls.set('ws.me', S.me); renderTop(); } }).catch(() => {}); }
      await pullScans();
      render();
    } catch (e) { S.online = false; renderTop(); }
  }
  async function pullScans() {
    const before = new Map(S.scans.map(x => [x.token, x.state]));
    const list = await rpc('hh_scans', { p_key: S.key });
    S.scans = Array.isArray(list) ? list.filter(x => x.state !== 'waiting') : [];
    ls.set('ws.scans', S.scans);
    for (const x of S.scans) {
      const was = before.get(x.token);
      if (was && was !== x.state && x.state === 'graded') toast(`${x.title} is graded: ${x.result && x.result.letter ? x.result.letter + ', ' + x.result.pct + '%' : 'done'}`, 5000, true);
      if (was && was !== x.state && x.state === 'error') toast(`${x.title} couldn’t be graded. Open it to see why.`, 6000);
    }
  }
  function unlinked() {
    S.key = ''; ls.set('ws.key', ''); S.data = null; ls.set('ws.data', null);
    toast('This phone was unlinked on the Mac. Scan the new code to link it again.', 7000);
    render();
  }

  // ---------------- helpers ----------------
  const D = () => S.data || { students: [], sheets: [], attempts: [], smart: {} };
  const letter = (p) => p == null ? '' : p >= 97 ? 'A+' : p >= 90 ? 'A' : p >= 80 ? 'B' : p >= 70 ? 'C' : p >= 60 ? 'D' : 'F';
  const gclass = (p) => p == null ? '' : p >= 80 ? 'good' : p >= 70 ? 'ok' : 'low';
  const day = (iso) => { if (!iso) return ''; const d = new Date(iso), n = new Date(); const diff = Math.floor((new Date(n.toDateString()) - new Date(d.toDateString())) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const ago = (t) => { if (!t) return ''; const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : day(t); };
  const gradeLabel = (g) => { const v = String(g == null ? '' : g); return /^\d+$/.test(v) ? `Grade ${v}` : /^k$/i.test(v) ? 'Kindergarten' : /^p(re)?-?k$/i.test(v) ? 'Pre-K' : v; };
  const student = (id) => D().students.find(x => x.id === id);
  const first = (name) => String(name || '').split(' ')[0];
  const COLORS = ['#3B5BF6', '#7B4DF2', '#FF4F8B', '#1FA36E', '#F08A00', '#0EA5D9', '#D2473A'];
  const colorOf = (id) => { const st = student(id); if (st && st.color) return st.color; let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const SUBJ = [[/math/i, '#3B5BF6', '➗'], [/science|bio|chem|phys/i, '#1FA36E', '🔬'], [/english|language arts|reading|writing|ela/i, '#E5484D', '📖'], [/social|history|geo|civic/i, '#F08A00', '🌎'], [/spanish|french|arabic|language/i, '#7B4DF2', '💬'], [/computer|coding/i, '#0EA5D9', '💻'], [/art|music/i, '#FF4F8B', '🎨']];
  const subj = (s) => { const m = SUBJ.find(([re]) => re.test(s || '')); return m ? { color: m[1], emoji: m[2] } : { color: '#5B6577', emoji: '📝' }; };
  const avatar = (id, name, cls) => `<span class="av ${cls || ''}" style="--c:${colorOf(id)}">${esc((name || '?').slice(0, 1).toUpperCase())}</span>`;
  const STATUS = { new: 'New', printed: 'Printed', started: 'Started', marking: 'Needs marking', graded: 'Graded' };
  // The red pen: a hand-drawn loop around a handwritten letter. Each loop wobbles a little differently.
  function mark(letterText, opts) {
    const o = opts || {}, seed = String(letterText + (o.seed || '')).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
    const r = (k) => ((Math.sin(seed * (k + 1) * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const w = 100, h = 92, cx = 50, cy = 47, rx = 44 + r(1) * 3, ry = 38 + r(2) * 3;
    const pts = [];
    for (let i = 0; i <= 26; i++) {
      const t = -0.5 + (i / 24) * Math.PI * 2, wob = 1 + (r(i + 3) - 0.5) * 0.06;
      pts.push([cx + Math.cos(t) * rx * wob, cy + Math.sin(t) * ry * wob]);
    }
    const d = 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    return `<span class="mark ${o.big ? 'big' : ''} ${o.draw ? 'draw' : ''}" role="img" aria-label="Grade ${esc(letterText)}"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg><b>${esc(letterText || '–')}</b></span>`;
  }
  const todoSheets = () => D().sheets.filter(x => !x.arch && (x.status === 'new' || x.status === 'printed' || x.status === 'started'));
  const inFilter = (stId) => S.filter === 'all' || (S.filter === 'none' ? !stId : stId === S.filter);
  function toast(msg, ms, good) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (good ? ' good' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms || 3000); }

  // ---------------- layout ----------------
  function renderTop() {
    const line = $('#syncLine');
    if (!S.key) { line.textContent = ''; return; }
    line.innerHTML = !S.online ? '<i class="dot off"></i>Offline: showing the last copy'
      : `<i class="dot"></i>${S.dataAt ? `Updated ${esc(ago(S.dataAt))}` : esc(S.name || 'Your household')}${S.me ? `, on ${esc(S.me)}` : ''}`;
    if (typeof OB !== 'undefined' && OB.length) {
      const n = `${OB.length} scan${OB.length > 1 ? 's' : ''}`;
      line.innerHTML = !S.online ? `<i class="dot off"></i><span class="obLine">Offline: ${n} waiting to send</span>` : `<i class="dot"></i><span class="obLine">Sending ${n}…</span>`;
    }
    const n = todoSheets().length;
    $('#todoBadge').textContent = n ? (n > 99 ? '99+' : n) : '';
  }
  function render() {
    renderTop();
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
    $('#tabs').classList.toggle('hidden', !S.key);
    $('#refreshBtn').classList.toggle('hidden', !S.key);
    const v = $('#view');
    if (!S.key) { v.innerHTML = pairView(); return; }
    if (S.tab === 'scan') return renderScan();
    v.innerHTML = S.tab === 'home' ? homeView() : S.tab === 'todo' ? todoView() : S.tab === 'graded' ? gradedView() : kidsView();
  }
  function go(tab) { S.tab = tab; render(); $('#view').scrollTop = 0; window.scrollTo(0, 0); }

  // ---------------- pairing ----------------
  function pairView() {
    return `<section class="pair">
      <img src="icons/icon-512.png" class="pairLogo" alt="">
      <h1>Link this phone to your Mac</h1>
      <ol class="steps">
        <li>On the Mac, open <b>Worksheet Studio</b>.</li>
        <li>Go to <b>Settings</b>, then <b>Phone app</b>, and press <b>Set up the phone app</b> (or <b>Show code</b>).</li>
        <li>Point this phone's camera at the code and tap the link.</li>
      </ol>
      <p class="fine">There's no account or password. The code links this phone to your household only.</p>
    </section>`;
  }
  async function tryPair() {
    const m = location.hash.match(/pair=([a-f0-9]{64})/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const r = await rpc('hh_pull', { p_key: m[1], p_since: null });
      if (!r.ok) { toast('That code isn’t valid any more. Show a new one on the Mac.', 6000); return; }
      S.key = m[1]; ls.set('ws.key', S.key);
      S.data = r.data; S.dataAt = r.data_at; S.name = r.name; ls.set('ws.data', S.data); ls.set('ws.dataAt', S.dataAt); ls.set('ws.name', S.name);
      toast('Linked to your Mac!', 3000, true);
      await pullScans().catch(() => {});
    } catch (e) { toast('Couldn’t reach the service. Check the phone’s connection and scan the code again.', 6000); }
  }

  // ---------------- home ----------------
  function homeView() {
    const d = D(), todo = todoSheets();
    const week = d.attempts.filter(a => Date.now() - new Date(a.at) < 7 * 864e5);
    const recent = d.attempts.filter(a => Date.now() - new Date(a.at) < 30 * 864e5 && a.pct != null);
    const avg = recent.length ? Math.round(recent.reduce((n, a) => n + a.pct, 0) / recent.length) : null;
    const hr = new Date().getHours();
    const live = S.scans.filter(x => x.state === 'received' || x.state === 'grading' || Date.now() - new Date(x.created_at) < 2 * 864e5).slice(0, 6);
    return `<section class="home">
      <h1 class="hello"><span>${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}</span></h1>
      ${S.installEvt ? `<button class="install" data-act="install"><img src="icons/icon-192.png" alt=""><span><b>Install the app</b><small>Opens from your home screen, like any app.</small></span><i>Install</i></button>` : ''}
      <div class="reportCard">
        <button data-go="todo"><b>${todo.length}</b><span>to grade</span></button>
        <button data-go="graded"><b>${week.length}</b><span>graded this week</span></button>
        <button data-go="kids"><b>${avg == null ? '–' : avg + '%'}</b><span>average, last 30 days</span></button>
      </div>
      ${live.length || OB.length ? `<h2>Scans</h2><div class="list paper">${OB.map(outRow).join('')}${live.map(scanRow).join('')}</div>` : ''}
      <h2>Children</h2>
      ${d.students.length ? `<div class="kidCards">${d.students.map(kidCard).join('')}</div>` : '<p class="empty">Add students in Worksheet Studio on the Mac and they appear here.</p>'}
      <button class="bigScan" data-go="scan"><img src="icons/icon-192.png" alt=""><span><b>Scan a finished worksheet</b><small>Your Mac grades it and the result shows up here.</small></span></button>
    </section>`;
  }
  function scanRow(x) {
    const st = x.state === 'received' ? ['wait', 'Waiting for your Mac', 'The Mac grades it as soon as Worksheet Studio is open.']
      : x.state === 'grading' ? ['busy', 'Being graded…', 'The Mac is reading the answers.']
      : x.state === 'graded' ? ['done', x.result && x.result.letter ? `${x.result.letter}, ${x.result.pct}%` : 'Graded', x.result ? `${x.result.right || 0} right, ${x.result.wrong || 0} wrong${x.result.pending ? `, ${x.result.pending} to mark` : ''}` : '']
      : ['err', 'Couldn’t grade', (x.result && x.result.message) || 'Scan it again.'];
    return `<div class="row scan ${st[0]}" ${x.state === 'error' ? `data-err="${esc(x.token)}"` : ''}>
      <span class="sIc">${st[0] === 'done' ? '★' : st[0] === 'err' ? '!' : st[0] === 'busy' ? '<i class="spin"></i>' : '⏳'}</span>
      <span class="rMain"><b>${esc(x.title || 'Worksheet')}</b><small>${esc(x.student ? first(x.student) + ': ' : '')}${esc(st[2])}</small></span>
      <span class="rSide"><b class="${st[0]}">${esc(st[1])}</b><small>${esc(ago(x.created_at))}</small></span>
    </div>`;
  }
  function kidCard(st) {
    const d = D(), atts = d.attempts.filter(a => a.st === st.id && a.pct != null);
    const avg = atts.length ? Math.round(atts.slice(0, 10).reduce((n, a) => n + a.pct, 0) / Math.min(10, atts.length)) : null;
    const todo = todoSheets().filter(x => x.st === st.id).length;
    return `<button class="kid" data-kid="${esc(st.id)}" style="--c:${colorOf(st.id)}">
      <span class="kTop">Hello<small>my name is</small></span>
      <span class="kName">${esc(first(st.name))}</span>
      <span class="kFoot"><span>${esc(gradeLabel(st.grade))}<br>${todo ? todo + ' to grade' : 'all caught up'}</span>${avg == null ? '' : mark(letter(avg), { seed: st.id })}</span>
    </button>`;
  }

  // ---------------- to grade ----------------
  function chips() {
    const d = D();
    const opts = [['all', 'Everyone']].concat(d.students.map(s => [s.id, first(s.name)]));
    if (d.sheets.some(x => !x.st)) opts.push(['none', 'Anyone']);
    return `<div class="chips">${opts.map(([v, t]) => `<button data-filter="${esc(v)}" class="${S.filter === v ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
  }
  function sheetRow(x) {
    const su = subj(x.s);
    return `<button class="row sheetRow" data-sheet="${esc(x.k)}" style="--c:${su.color}">
      <span class="sub">${su.emoji}</span>
      <span class="rMain"><b>${esc(x.tp || x.t)}</b><small>${x.sn ? esc(first(x.sn)) + ', ' : ''}${esc(x.g)}${x.n > 1 ? `, sheet ${x.i + 1} of ${x.n}` : ''}</small></span>
      <span class="tag t-${x.status}">${STATUS[x.status] || 'Sent'}</span>
    </button>`;
  }
  function todoView() {
    const list = todoSheets().filter(x => inFilter(x.st)).sort((a, b) => (a.status === 'printed' ? 0 : a.status === 'started' ? 1 : 2) - (b.status === 'printed' ? 0 : b.status === 'started' ? 1 : 2) || (b.made || '').localeCompare(a.made || ''));
    const waiting = new Set(S.scans.filter(x => x.state === 'received' || x.state === 'grading').map(x => x.sheet_key));
    return `<section><h1 class="pageT"><span>To grade</span></h1>${chips()}
      ${list.length ? `<p class="hint">Printed ones first. Tap a worksheet to scan it when it's finished.</p><div class="list paper">${list.map(x => sheetRow(waiting.has(x.k) ? Object.assign({}, x, { status: 'sent' }) : x)).join('')}</div>`
        : `<div class="emptyBig"><span>🎉</span><b>Nothing waiting</b><small>Every worksheet${S.filter === 'all' ? '' : ' for ' + esc(first((student(S.filter) || {}).name || ''))} is graded.</small></div>`}
    </section>`;
  }
  function sheetDetail(k) {
    const x = D().sheets.find(s => s.k === k); if (!x) return;
    const su = subj(x.s);
    openSheet(`<div class="shHead" style="--c:${su.color}"><span class="sub big">${su.emoji}</span><div><h2>${esc(x.tp || x.t)}</h2><p>${esc(x.t)}</p></div></div>
      <dl class="facts"><dt>For</dt><dd>${x.sn ? esc(x.sn) : 'Anyone'}</dd><dt>Level</dt><dd>${esc(x.g)}${x.c && x.c !== x.s ? ', ' + esc(x.c) : ''}</dd>
        <dt>Questions</dt><dd>${x.q}</dd>${x.n > 1 ? `<dt>Sheet</dt><dd>${x.i + 1} of ${x.n}</dd>` : ''}<dt>Status</dt><dd>${STATUS[x.status]}${x.pr ? `, printed ${esc(day(x.pr))}` : ''}</dd></dl>
      <button class="primary wide" data-scan-sheet="${esc(x.k)}">📷 Scan this worksheet</button>
      <button class="ghost wide" data-close>Close</button>`);
  }

  // ---------------- graded ----------------
  function gradedView() {
    const atts = D().attempts.filter(a => inFilter(a.st));
    let lastDay = '';
    return `<section><h1 class="pageT"><span>Graded</span></h1>${chips()}
      ${atts.length ? `<div class="list paper">${atts.slice(0, 150).map(a => {
        const dd = day(a.at), head = dd !== lastDay ? `<div class="dayHead">${esc(dd)}</div>` : ''; lastDay = dd;
        const st = student(a.st), su = subj(a.s);
        return `${head}<button class="row resRow" data-att="${esc(a.id)}">
          ${mark(letter(a.pct), { seed: a.id })}
          <span class="rMain"><b>${esc(a.tp || a.t)}</b><small>${su.emoji} ${esc(st ? first(st.name) : '')}${a.pend ? `, ${a.pend} to mark on the Mac` : ''}</small></span>
          <span class="pct">${a.pct == null ? '' : a.pct + '%'}</span></button>`;
      }).join('')}</div>` : '<div class="emptyBig"><span>📝</span><b>No results yet</b><small>Scan a finished worksheet and its result shows up here.</small></div>'}
    </section>`;
  }
  function resultDetail(id) {
    const a = D().attempts.find(x => x.id === id); if (!a) return;
    const st = student(a.st);
    const markOf = (c) => c === 1 ? ['qok', '✓'] : c === 0.5 ? ['qhalf', '½'] : c === 0 ? ['qno', '✗'] : ['qwait', '?'];
    const right = a.r.filter(r => r[1] === 1).length, wrong = a.r.filter(r => r[1] === 0).length;
    openSheet(`<div class="resHead">${mark(letter(a.pct), { big: true, draw: true, seed: a.id })}
        <div><h2>${esc(a.tp || a.t)}</h2><p>${esc(st ? st.name : '')}, ${esc(day(a.at))}${a.pct == null ? '' : `, ${a.pct}%`}</p><p class="tally"><b class="qok">${right} right</b>, <b class="qno">${wrong} wrong</b>${a.pend ? `, ${a.pend} to mark` : ''}</p></div></div>
      <ol class="qs">${a.r.map(r => { const [cls, sym] = markOf(r[1]); return `<li class="${cls}"><span class="qm">${sym}</span><div><p class="qq"><b>${r[0]}.</b> ${esc(r[4])}</p>
        <p class="qa">Answer: <b>${esc(r[2]) || '<i>blank</i>'}</b>${r[1] !== 1 && r[3] ? `<br><span class="key">${esc(r[3])}</span>` : ''}</p></div></li>`; }).join('')}</ol>
      <button class="ghost wide" data-close>Close</button>`);
  }

  // ---------------- progress ----------------
  function kidsView() {
    const d = D();
    if (!d.students.length) return '<section><h1 class="pageT"><span>Progress</span></h1><div class="emptyBig"><span>👧</span><b>No students yet</b><small>Add them in Worksheet Studio on the Mac.</small></div></section>';
    const sel = d.students.find(s => s.id === S.filter) || d.students[0];
    const atts = d.attempts.filter(a => a.st === sel.id && a.pct != null);
    const bySub = {};
    for (const a of atts) (bySub[a.s || 'Other'] = bySub[a.s || 'Other'] || []).push(a.pct);
    const subs = Object.entries(bySub).map(([s, v]) => [s, Math.round(v.reduce((x, y) => x + y, 0) / v.length), v.length]).sort((a, b) => b[2] - a[2]);
    const byTopic = {};
    for (const a of atts) (byTopic[a.tp] = byTopic[a.tp] || []).push(a.pct);
    const weak = Object.entries(byTopic).map(([t, v]) => [t, Math.round(v.reduce((x, y) => x + y, 0) / v.length)]).filter(x => x[1] < 75).sort((a, b) => a[1] - b[1]).slice(0, 4);
    const avg = atts.length ? Math.round(atts.reduce((n, a) => n + a.pct, 0) / atts.length) : null;
    const trend = atts.slice(0, 12).reverse();
    const week = atts.filter(a => Date.now() - new Date(a.at) < 7 * 864e5).length;
    return `<section><h1 class="pageT"><span>Progress</span></h1>
      <div class="chips">${d.students.map(s => `<button data-filter="${esc(s.id)}" class="${s.id === sel.id ? 'on' : ''}">${esc(first(s.name))}</button>`).join('')}</div>
      <div class="kidHero" style="--c:${colorOf(sel.id)}"><div><h2>${esc(sel.name)}</h2><p>${esc(gradeLabel(sel.grade))}${avg == null ? ', no results yet' : `, ${avg}% average`}</p></div>
        ${avg == null ? '' : mark(letter(avg), { big: true, seed: sel.id })}</div>
      <div class="reportCard mini"><div><b>${atts.length}</b><span>graded</span></div><div><b>${week}</b><span>this week</span></div><div><b>${todoSheets().filter(x => x.st === sel.id).length}</b><span>to grade</span></div></div>
      ${trend.length > 1 ? `<h2>Recent scores</h2><div class="card">${spark(trend.map(a => a.pct))}</div>` : ''}
      ${subs.length ? `<h2>By subject</h2><div class="card bars">${subs.map(([s, p, n]) => `<div class="bar"><span class="bl">${subj(s).emoji} ${esc(s)}</span><b class="${gclass(p)}">${p}%</b><span class="bt"><i style="width:${p}%;--c:${subj(s).color}"></i></span><small>${n} worksheet${n === 1 ? '' : 's'}</small></div>`).join('')}</div>` : ''}
      ${weak.length ? `<h2>Needs practice</h2><div class="card weak">${weak.map(([t, p]) => `<div><span>${esc(t)}</span><b class="${gclass(p)}">${p}%</b></div>`).join('')}<p class="fine">Make a new worksheet on these from the student's page on the Mac.</p></div>` : atts.length ? '<h2>Needs practice</h2><div class="card"><p class="fine">Nothing below 75%. Nice work!</p></div>' : ''}
    </section>`;
  }
  function spark(v) {
    const W = 320, H = 96, n = v.length, lo = Math.max(0, Math.min(50, Math.min(...v) - 10));
    const x = (i) => 46 + (i * (W - 60)) / Math.max(1, n - 1), y = (p) => H - 12 - ((p - lo) / (100 - lo)) * (H - 24);
    const pts = v.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Recent scores, oldest to newest: ${v.join(', ')} percent">
      <line x1="36" x2="${W}" y1="${y(80)}" y2="${y(80)}" class="ref"/><text x="2" y="${y(80) + 4}" class="refT" style="text-anchor:start">80%</text>
      <polyline points="${pts}" class="ln"/>${v.map((p, i) => `<circle cx="${x(i)}" cy="${y(p)}" r="4.5" class="pt ${gclass(p)}"/>`).join('')}</svg>`;
  }

  // ---------------- sheet (bottom panel) ----------------
  function openSheet(html) { $('#sheetPanel').innerHTML = html; $('#sheet').classList.remove('hidden'); requestAnimationFrame(() => $('#sheet').classList.add('open')); }
  function closeSheet() { $('#sheet').classList.remove('open'); setTimeout(() => $('#sheet').classList.add('hidden'), 250); }

  // ---------------- scan ----------------
  // Pages are cleaned up on the phone as soon as they're taken (straightened, cropped, shadows evened,
  // shrunk) and checked (blur, light, which worksheet and page). Sending puts them in the outbox,
  // which uploads by itself whenever there's a connection.
  const SC = { pages: [], sheetKey: null, picked: false, busy: false, seq: 0 };
  let db = null;
  const idb = () => db || (db = new Promise((ok, no) => { const r = indexedDB.open('ws-app', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('p')) r.result.createObjectStore('p'); }; r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
  const KEEP = ['blob', 'id', 'code', 'page', 'of', 'sheet', 'how', 'issues', 'foreign', 'bytesIn', 'bytesOut', 'seq'];
  async function saveDraft() {
    try { const d = await idb(); d.transaction('p', 'readwrite').objectStore('p').put({ v: 2, sheetKey: SC.sheetKey, picked: SC.picked, pages: SC.pages.filter(p => p.blob).map(p => Object.fromEntries(KEEP.map(k => [k, p[k]]))) }, 'draft'); } catch (_) { /* no storage */ }
  }
  async function loadDraft() {
    try {
      const d = await idb();
      const v = await new Promise(ok => { const q = d.transaction('p').objectStore('p').get('draft'); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); });
      if (!v || !v.pages || !v.pages.length) return;
      SC.sheetKey = v.sheetKey; SC.picked = v.picked;
      if (v.v === 2) { SC.pages = v.pages.map(p => Object.assign({}, p, { url: URL.createObjectURL(p.blob) })); SC.seq = Math.max(0, ...SC.pages.map(p => p.seq || 0)) + 1; }
      else for (const p of v.pages) await addPage(p.blob); // pages saved by an older version: clean them up now
    } catch (_) { /* fine */ }
  }
  function clearDraft() { SC.pages.forEach(p => p.url && URL.revokeObjectURL(p.url)); SC.pages = []; SC.sheetKey = null; SC.picked = false; idb().then(d => d.transaction('p', 'readwrite').objectStore('p').delete('draft')).catch(() => {}); }

  // What the Mac printed: code on the page -> which worksheet, paper size, number of pages.
  function registry() {
    const d = D(), out = {};
    for (const [code, v] of Object.entries(d.smart || {})) {
      const sh = d.sheets.find(x => x.k === v.k);
      out[code] = Object.assign({}, v, { title: sh ? `${sh.tp || sh.t}${sh.sn ? ' for ' + first(sh.sn) : ''}` : '' });
    }
    return out;
  }
  const order = (p) => (p.page != null ? p.page : 100 + (p.seq || 0));
  const sortPages = () => SC.pages.sort((a, b) => order(a) - order(b));

  /** Clean up one photo (a Blob from the gallery/camera app, or a canvas/Blob from the live camera) and add it. */
  async function addPage(src) {
    if (SC.pages.length >= 6) { toast('Up to 6 pages per worksheet.'); return { ok: false, message: 'That’s 6 pages already', detail: 'Send these first.' }; }
    const p = { id: Math.random().toString(36).slice(2), checking: true, url: '', seq: SC.seq++, issues: [] };
    SC.pages.push(p); renderScanSoon();
    try {
      const reg = registry();
      const r = await Pages.process(src, reg);
      Object.assign(p, { blob: r.blob, url: URL.createObjectURL(r.blob), how: r.how, issues: r.issues, bytesIn: r.bytesIn || 0, bytesOut: r.bytesOut, checking: false });
      if (r.code != null) {
        p.code = r.code; p.page = r.page;
        const info = reg[r.code];
        if (info) { p.of = info.pages; p.sheet = info.k; if (!SC.sheetKey || !SC.picked) SC.sheetKey = p.sheet; }
        else p.foreign = true;
      }
      sortPages(); saveDraft(); renderScanSoon();
      return { ok: true, page: p };
    } catch (e) {
      SC.pages.splice(SC.pages.indexOf(p), 1); renderScanSoon();
      return { ok: false, message: e.message || 'Couldn’t use that photo' };
    }
  }
  async function addFiles(files) {
    for (const f of Array.from(files || [])) { const r = await addPage(f); if (!r.ok) { toast(r.message); break; } }
  }
  const hasPage = (code, page) => SC.pages.some(p => p.code === code && p.page === page);

  // ----- live camera -----
  function openCamera(retakeId) {
    if (retakeId) { const i = SC.pages.findIndex(p => p.id === retakeId); if (i >= 0) { const p = SC.pages.splice(i, 1)[0]; if (p.url) URL.revokeObjectURL(p.url); saveDraft(); renderScan(); } }
    const fallback = (why) => { if (why) toast(why, 5000); const i = $('#cam'); if (i) i.click(); };
    if (!window.Camera || !Camera.supported()) return fallback();
    Camera.open({
      registry: registry(),
      expectSheet: () => (SC.pages.some(p => p.sheet) || SC.picked ? SC.sheetKey : null),
      has: hasPage,
      count: () => SC.pages.filter(p => p.blob).length,
      onCapture: async (shot) => {
        const r = await addPage(shot);
        if (!r.ok) return r;
        const p = r.page, bad = p.issues.map(k => Pages.ISSUE_TEXT[k][0].toLowerCase());
        if (p.code != null && p.sheet) {
          const info = registry()[p.code], need = Array.from({ length: info.pages }, (_, i) => i).filter(i => !hasPage(p.code, i));
          return { ok: true, warn: bad.length > 0, message: `Page ${p.page + 1}${info.pages > 1 ? ' of ' + info.pages : ''} ✓${bad.length ? ', but ' + bad.join(' and ') : ''}`,
            detail: bad.length ? 'You can retake it from the list.' : need.length ? `Now page ${need[0] + 1}.` : 'All pages done!', allDone: !need.length && !bad.length };
        }
        return { ok: true, warn: bad.length > 0, message: bad.length ? `Saved, but ${bad.join(' and ')}` : 'Photo saved ✓', detail: bad.length ? 'Retake it from the list if the writing is hard to read.' : 'Take the next page, or tap Done.' };
      },
      onClose: () => { if (S.tab === 'scan') renderScan(); },
    }).catch((e) => fallback(e.message === 'blocked' ? 'Camera access is blocked for this app, so the phone’s camera app opens instead.' : 'The camera couldn’t start here, so the phone’s camera app opens instead.'));
  }

  // ----- checks before sending -----
  function checks() {
    const d = D(), x = d.sheets.find(s => s.k === SC.sheetKey);
    const ready = SC.pages.filter(p => p.blob);
    const hard = [], soft = [], good = [];
    const info = x && Object.values(registry()).find(v => v.k === x.k);
    const other = ready.filter(p => p.sheet && x && p.sheet !== x.k);
    const foreign = ready.filter(p => p.foreign);
    const seen = new Map(), dups = [];
    ready.forEach(p => { if (p.code == null) return; const k = p.code + ':' + p.page; if (seen.has(k)) dups.push(p); else seen.set(k, p); });
    if (other.length) hard.push(`${other.length === 1 ? 'A page' : other.length + ' pages'} from a different worksheet. Remove ${other.length === 1 ? 'it' : 'them'}, or press Change.`);
    if (foreign.length) hard.push(`${foreign.length === 1 ? 'A page isn’t' : foreign.length + ' pages aren’t'} from your library on the Mac.`);
    if (dups.length) hard.push(`Page ${dups.map(p => p.page + 1).join(' and ')} is in twice. Remove the extra copy.`);
    const have = x ? new Set(ready.filter(p => p.sheet === x.k).map(p => p.page)) : new Set();
    const missing = info && have.size ? Array.from({ length: info.pages }, (_, i) => i).filter(i => !have.has(i)) : [];
    if (missing.length) soft.push(`Page ${missing.map(i => i + 1).join(' and ')} of ${info.pages} is missing.`);
    else if (info && have.size === info.pages) good.push(`All ${info.pages} page${info.pages > 1 ? 's' : ''} are here${info.pages > 1 ? ', in order' : ''}`);
    ready.forEach((p, i) => p.issues.forEach(k => soft.push(`${p.page != null ? 'Page ' + (p.page + 1) : 'Photo ' + (i + 1)}: ${Pages.ISSUE_TEXT[k][1]}`)));
    if (ready.length && ready.every(p => !p.issues.length)) good.push('Sharp and well lit');
    if (ready.some(p => p.how === 'smart' || p.how === 'edges')) good.push('Straightened and cropped');
    return { x, hard, soft, good, missing, dups: new Set(dups.map(p => p.id)), other: new Set(other.map(p => p.id)), foreign: new Set(foreign.map(p => p.id)) };
  }

  let rsT = null; const renderScanSoon = () => { clearTimeout(rsT); rsT = setTimeout(() => { if (S.tab === 'scan') renderScan(); }, 30); };
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  function renderScan() {
    const c = checks(), x = c.x;
    const n = SC.pages.length, busy = SC.pages.some(p => p.checking);
    const bytesIn = SC.pages.reduce((a, p) => a + (p.bytesIn || 0), 0), bytesOut = SC.pages.reduce((a, p) => a + (p.bytesOut || 0), 0);
    const tileFlag = (p) => c.other.has(p.id) ? ['bad', 'Other worksheet'] : c.foreign.has(p.id) ? ['bad', 'Not yours'] : c.dups.has(p.id) ? ['bad', 'In twice']
      : p.issues.length ? ['warn', Pages.ISSUE_TEXT[p.issues[0]][0]] : null;
    $('#view').innerHTML = `<section class="scanV">
      <h1 class="pageT"><span>Scan a worksheet</span></h1>
      <div class="which ${x ? 'set' : ''}">
        ${x ? `<span class="sub">${subj(x.s).emoji}</span><span class="rMain"><b>${esc(x.tp || x.t)}</b><small>${esc(x.sn ? first(x.sn) : 'Anyone')}${x.n > 1 ? `, sheet ${x.i + 1} of ${x.n}` : ''}${SC.pages.some(p => p.sheet === x.k) ? ', recognised from the page ✓' : ''}</small></span><button class="link" data-act="pick">Change</button>`
          : `<span class="sub">❓</span><span class="rMain"><b>Which worksheet?</b><small>${n ? (busy ? 'Reading the page…' : 'Couldn’t tell from the photo. Pick it from the list.') : 'Smart worksheets are recognised from the page.'}</small></span><button class="link" data-act="pick">Pick</button>`}
      </div>
      <div class="pages">${SC.pages.map((p, k) => { const f = tileFlag(p); return `<div class="pg ${f ? f[0] : ''}">
          ${p.url ? `<img src="${p.url}" alt="Page ${k + 1}">` : '<span class="pgWait"><i class="spin"></i><small>Cleaning up…</small></span>'}
          <span class="pgL">${p.checking ? 'Checking…' : p.page != null ? `Page ${p.page + 1}${p.of ? ' of ' + p.of : ''}` : `Photo ${k + 1}`}</span>
          ${f ? `<span class="pgFlag ${f[0]}">${esc(f[1])}</span>` : ''}
          ${f && f[0] === 'warn' ? `<button class="pgRetake" data-retake="${p.id}">Retake</button>` : ''}
          ${p.checking ? '' : `<button class="pgX" data-rm="${k}" aria-label="Remove">×</button>`}</div>`; }).join('')}
        ${n < 6 ? `<button class="addTile" data-act="camera"><span><b>+</b>${n ? 'Add page ' + (n + 1) : 'Scan the first page'}</span></button>` : ''}</div>
      ${n && !busy ? `<div class="checkList paper">
          ${c.hard.map(t => `<p class="ck bad">✗ ${esc(t)}</p>`).join('')}
          ${c.soft.map(t => `<p class="ck warn">! ${esc(t)}</p>`).join('')}
          ${c.good.map(t => `<p class="ck ok">✓ ${esc(t)}</p>`).join('')}
          ${bytesIn > bytesOut * 1.3 ? `<p class="ck size">Shrunk on the phone from ${kb(bytesIn)} to ${kb(bytesOut)}</p>` : ''}
        </div>` : ''}
      <input id="cam" type="file" accept="image/*" capture="environment" hidden>
      <input id="lib" type="file" accept="image/*" multiple hidden>
      <div class="scanBtns">
        <button class="btnCam" data-act="camera">📷 ${n ? 'Scan more pages' : 'Scan pages'}</button>
        <label class="btnLib" for="lib">🖼️ From gallery</label>
      </div>
      <button class="primary wide" data-act="send" ${!n || !x || busy || c.hard.length ? 'disabled' : ''}>${navigator.onLine ? `Send ${n || ''} page${n === 1 ? '' : 's'} to the Mac` : `Save ${n || ''} page${n === 1 ? '' : 's'} to send later`}</button>
      ${n ? '<button class="ghost wide" data-act="clear">Start over</button>' : ''}
      <ul class="tips"><li>Smart worksheets are taken by themselves when all four corner squares are in view</li><li>Lay it flat, in good light</li><li>No internet? Scans wait on the phone and send themselves later</li></ul>
    </section>`;
    $('#cam').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    $('#lib').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  }
  function pickSheet() {
    const list = D().sheets.filter(x => !x.arch && x.status !== 'graded').sort((a, b) => (a.status === 'printed' ? 0 : 1) - (b.status === 'printed' ? 0 : 1) || (b.made || '').localeCompare(a.made || ''));
    openSheet(`<h2>Which worksheet is this?</h2><div class="list paper pickList">${list.slice(0, 80).map(sheetRow).join('') || '<p class="empty">No worksheets are waiting to be graded.</p>'}</div><button class="ghost wide" data-close>Cancel</button>`);
    $('#sheetPanel').dataset.picking = '1';
  }
  async function send(anyway) {
    const c = checks(), x = c.x;
    if (!x || !SC.pages.length || SC.busy || c.hard.length || SC.pages.some(p => p.checking)) return;
    if (c.soft.length && !anyway) {
      return openSheet(`<h2>Before you send</h2><div class="checkList paper">${c.soft.map(t => `<p class="ck warn">! ${esc(t)}</p>`).join('')}</div>
        <p class="me">The Mac can still try, but answers on these pages may be misread.</p>
        <button class="primary wide" data-close>Go back and fix it</button><button class="ghost wide" data-act="sendAnyway">Send anyway</button>`);
    }
    SC.busy = true;
    try {
      await Outbox.add({ key: S.key, sheetKey: x.k, title: x.tp || x.t, student: x.sn || '', pages: SC.pages.map(p => p.blob) });
    } catch (e) { SC.busy = false; return toast('Couldn’t save the scan on this phone. Free up some space and try again.', 6000); }
    clearDraft(); SC.busy = false;
    toast(navigator.onLine ? 'Sending to your Mac…' : 'Saved on this phone. It sends by itself when you’re back online.', 4500, true);
    go('home');
    flushOutbox();
  }

  // ----- outbox -----
  let OB = [];
  async function refreshOutbox() {
    OB = window.Outbox ? await Outbox.list().catch(() => []) : [];
    renderTop(); if (S.tab === 'home') render();
  }
  function onOutbox(ev) {
    if (ev.type === 'sent') {
      S.scans.unshift({ token: ev.job.token, sheet_key: ev.job.sheetKey, title: ev.job.title, student: ev.job.student, state: 'received', created_at: new Date().toISOString() });
      ls.set('ws.scans', S.scans);
      toast(`Sent “${ev.job.title}”. Your Mac will grade it.`, 3500, true);
    }
    refreshOutbox();
  }
  let flushing = false;
  async function flushOutbox() {
    if (!window.Outbox || flushing) return;
    flushing = true;
    try { await refreshOutbox(); if (OB.length && navigator.onLine) await Outbox.flush(onOutbox); } catch (_) { /* tries again later */ }
    flushing = false;
    await refreshOutbox();
  }
  function outRow(j) {
    const sending = j.state === 'sending' && navigator.onLine;
    const st = j.fatal ? ['err', 'Can’t send', 'This phone was unlinked on the Mac. Link it again to send this.']
      : !navigator.onLine ? ['wait', 'Waiting for internet', 'It sends by itself when the phone is back online.']
      : sending ? ['busy', `Sending ${Math.min(j.done.length + 1, j.pages.length)} of ${j.pages.length}`, 'Uploading the pages…']
      : ['wait', 'Will try again', j.error ? j.error : 'Trying again shortly.'];
    return `<div class="row scan out ${st[0]}" data-out="${esc(j.id)}">
      <span class="sIc">${st[0] === 'busy' ? '<i class="spin"></i>' : st[0] === 'err' ? '!' : '📤'}</span>
      <span class="rMain"><b>${esc(j.title || 'Worksheet')}</b><small>${esc(j.student ? first(j.student) + ': ' : '')}${esc(st[2])}</small></span>
      <span class="rSide"><b class="${st[0]}">${esc(st[1])}</b><small>${j.pages.length} page${j.pages.length > 1 ? 's' : ''}</small></span>
    </div>`;
  }

  // ---------------- events ----------------
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const tab = t.closest('#tabs [data-tab]'); if (tab) return go(tab.dataset.tab);
    const g = t.closest('[data-go]'); if (g) return go(g.dataset.go);
    const f = t.closest('[data-filter]'); if (f) { S.filter = f.dataset.filter; ls.set('ws.filter', S.filter); return render(); }
    const kid = t.closest('[data-kid]'); if (kid) { S.filter = kid.dataset.kid; ls.set('ws.filter', S.filter); return go('kids'); }
    const sh = t.closest('[data-sheet]');
    if (sh) {
      if ($('#sheetPanel').dataset.picking) { SC.sheetKey = sh.dataset.sheet; SC.picked = true; delete $('#sheetPanel').dataset.picking; closeSheet(); saveDraft(); return renderScan(); }
      return sheetDetail(sh.dataset.sheet);
    }
    const ss = t.closest('[data-scan-sheet]'); if (ss) { closeSheet(); if (SC.sheetKey !== ss.dataset.scanSheet && SC.pages.length) clearDraft(); SC.sheetKey = ss.dataset.scanSheet; SC.picked = true; return go('scan'); }
    const at = t.closest('[data-att]'); if (at) return resultDetail(at.dataset.att);
    const er = t.closest('[data-err]'); if (er) { const x = S.scans.find(y => y.token === er.dataset.err); if (x) openSheet(`<h2>${esc(x.title)}</h2><p class="warn">${esc((x.result && x.result.message) || 'It couldn’t be graded.')}</p><button class="primary wide" data-scan-sheet="${esc(x.sheet_key)}">📷 Scan it again</button><button class="ghost wide" data-close>Close</button>`); return; }
    if (t.closest('[data-close]') || t.id === 'sheet') { delete $('#sheetPanel').dataset.picking; return closeSheet(); }
    const rt = t.closest('[data-retake]'); if (rt) return openCamera(rt.dataset.retake);
    const ob = t.closest('[data-out]');
    if (ob) {
      const j = OB.find(y => y.id === ob.dataset.out); if (!j) return;
      return openSheet(`<h2>${esc(j.title)}</h2><p class="me">${j.pages.length} page${j.pages.length > 1 ? 's are' : ' is'} saved on this phone and ${navigator.onLine ? 'will be sent to the Mac' : 'will be sent when the phone is back online'}.${j.error ? `<br><small>Last try: ${esc(j.error)}</small>` : ''}</p>
        <button class="primary wide" data-act="outNow" ${navigator.onLine ? '' : 'disabled'}>Send now</button><button class="ghost wide" data-act="outDel" data-id="${esc(j.id)}">Delete this scan</button><button class="ghost wide" data-close>Close</button>`);
    }
    const rm = t.closest('[data-rm]'); if (rm) { const p = SC.pages.splice(Number(rm.dataset.rm), 1)[0]; if (p && p.url) URL.revokeObjectURL(p.url); if (!SC.picked && !SC.pages.some(q => q.sheet)) SC.sheetKey = null; saveDraft(); return renderScan(); }
    const a = t.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'pick') return pickSheet();
    if (act === 'me') {
      if (!S.key) return;
      return openSheet(`<div class="shHead"><img src="icons/icon-192.png" alt="" style="width:56px;height:56px;border-radius:16px;transform:rotate(-6deg)"><div><h2>${esc(S.me || 'This phone')}</h2><p>Linked to ${esc(S.name || 'your household')}</p></div></div>
        <p class="me">To rename this phone or unlink it for good, use Settings, then Phone app, on the Mac.</p>
        <button class="ghost wide" data-act="forget">Unlink this phone here</button><button class="primary wide" data-close>Close</button>`);
    }
    if (act === 'forget') {
      if (!confirm('Unlink this phone? You will need a new code from the Mac to link it again.')) return;
      closeSheet(); S.me = ''; ls.set('ws.me', ''); S.key = ''; ls.set('ws.key', ''); S.data = null; ls.set('ws.data', null); return render();
    }
    if (act === 'send') return send();
    if (act === 'sendAnyway') { closeSheet(); return send(true); }
    if (act === 'camera') return openCamera();
    if (act === 'outNow') { closeSheet(); return flushOutbox(); }
    if (act === 'outDel') { const id = a.dataset.id; if (!confirm('Delete this scan from the phone? It hasn’t reached the Mac yet.')) return; closeSheet(); await Outbox.remove(id); return refreshOutbox(); }
    if (act === 'clear') { clearDraft(); return renderScan(); }
    if (act === 'install' && S.installEvt) { S.installEvt.prompt(); const c = await S.installEvt.userChoice.catch(() => null); S.installEvt = null; render(); if (c && c.outcome === 'accepted') toast('Installed! Open it from your home screen.', 4000, true); }
  });
  $('#refreshBtn').addEventListener('click', () => { $('#refreshBtn').classList.add('turn'); setTimeout(() => $('#refreshBtn').classList.remove('turn'), 700); pull(true); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; if (S.tab === 'home') render(); });
  window.addEventListener('online', () => { S.online = true; pull(); flushOutbox(); if (S.tab === 'scan') renderScan(); });
  window.addEventListener('offline', () => { S.online = false; renderTop(); refreshOutbox(); if (S.tab === 'scan') renderScan(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pull(); flushOutbox(); } });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.outbox) { if (e.data.outbox === 'sent') { pullScans().then(render).catch(() => {}); } refreshOutbox(); } });
  // The outbox tries again every 20 s while something is waiting.
  setInterval(() => { if (OB.length && navigator.onLine && !document.hidden) flushOutbox(); }, 20000);
  window.addEventListener('hashchange', async () => { await tryPair(); render(); });

  // Refresh: every 8 s while something is waiting on the Mac, otherwise every 30 s.
  (function loop() {
    const waiting = S.scans.some(x => x.state === 'received' || x.state === 'grading');
    setTimeout(async () => { if (!document.hidden && S.key) await pull(); loop(); }, waiting ? 8000 : 30000);
  })();

  // ---------------- start ----------------
  (async () => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    await tryPair();
    await loadDraft();
    await refreshOutbox();
    render();
    if (S.key) pull(true);
    flushOutbox();
  })();
  window.WSPhone = { S, SC, render };
})();
