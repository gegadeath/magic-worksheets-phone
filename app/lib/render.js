/* Worksheet Studio — turns worksheet data into printable HTML (student pages and answer keys). */
(function (root) {
  'use strict';

  const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const blanks = (html) => html.replace(/_{3,}/g, '<span class="blank"></span>');

  const CSS = `
  @page { size: Letter; margin: 0.6in 0.65in; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; font-size: 12.5pt; line-height: 1.45; margin: 0; }
  .sheet { page-break-after: always; break-after: page; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .screen .sheet { background: #fff; width: 8.5in; min-height: 11in; margin: 0 auto 24px; padding: 0.6in 0.65in; box-shadow: 0 1px 2px rgba(28,36,51,.08), 0 8px 24px rgba(28,36,51,.10); border-radius: 3px; }
  .screen { background: transparent; padding: 22px 0 30px; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2.5px solid #111; padding-bottom: 6px; margin-bottom: 10px; }
  .hdr h1 { font-size: 19pt; margin: 0; line-height: 1.15; }
  .hdr .meta { font-size: 9.5pt; color: #444; text-align: right; white-space: nowrap; }
  .name { display: flex; gap: 24px; font-size: 11pt; margin: 4px 0 12px; }
  .name span { flex: 1; border-bottom: 1px solid #111; padding-bottom: 2px; }
  .name span.date { flex: 0 0 2.2in; }
  .name .stu { font-family: 'Marker Felt', 'Comic Sans MS', 'Chalkboard SE', cursive; font-size: 13.5pt; font-weight: 400; margin-left: 6px; }
  .instructions { font-style: italic; margin: 0 0 12px; }
  .passage { border: 1.5px solid #111; border-radius: 6px; padding: 10px 14px; margin: 0 0 14px; }
  .passage h2 { font-size: 12pt; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .04em; }
  .passage p { margin: 0 0 8px; text-indent: 1.5em; }
  .vocab { margin: 0 0 14px; font-size: 11pt; }
  .vocab b { font-weight: 700; }
  .section h2 { font-size: 13pt; margin: 14px 0 4px; }
  .section .sinst { font-style: italic; margin: 0 0 8px; }
  ol.items { margin: 0; padding-left: 1.9em; }
  ol.items > li { margin: 0 0 14px; break-inside: avoid; page-break-inside: avoid; padding-left: 4px; }
  .blank { display: inline-block; min-width: 1.3in; border-bottom: 1.3px solid #111; height: 1em; vertical-align: baseline; }
  .choices { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 24px; margin-top: 4px; }
  .choices.long { grid-template-columns: 1fr; }
  .choices div::before { content: attr(data-l) ".  "; font-weight: 700; }
  .tf { margin-top: 4px; letter-spacing: .05em; }
  .tf span { display: inline-block; border: 1.3px solid #111; border-radius: 14px; padding: 0 12px; margin-right: 14px; }
  .lines div { border-bottom: 1px solid #777; height: 26px; }
  .work { border: 1px dashed #999; border-radius: 4px; height: 72px; margin-top: 6px; }
  .fig { margin: 6px 0 2px; }
  .figwork { display: flex; gap: 16px; align-items: stretch; }
  .figwork .fig { flex: 0 0 auto; }
  .figwork .work { flex: 1; height: auto; min-height: 90px; margin-top: 6px; }
  .fig svg { max-width: 100%; height: auto; }
  .trace svg { width: 100%; height: auto; display: block; }
  .items.math { columns: 2; column-gap: 0.45in; }
  .items.math > li { break-inside: avoid; }
  .footer { margin-top: 18px; font-size: 8.5pt; color: #777; text-align: center; }
  .key ol.items > li { margin-bottom: 9px; }
  .key .ans { font-weight: 700; }
  .key .exp { color: #333; font-size: 10.5pt; }
  .key .flag { color: #a33; font-size: 10pt; font-weight: 600; }
  .key .q { color: #555; font-size: 10.5pt; }

  /* ---- graded (teacher-marked) copy ---- */
  .hand { font-family: "Bradley Hand", "Noteworthy", "Marker Felt", "Comic Sans MS", cursive; color: #1F4FB8; font-size: 15pt; line-height: 1.1; }
  .red { font-family: "Marker Felt", "Chalkboard SE", "Noteworthy", "Comic Sans MS", cursive; color: #D02B20; }
  .graded ol.items > li { position: relative; }
  .pen { position: absolute; left: -64px; top: -4px; width: 30px; height: 30px; }
  .lineAns { border-bottom: 1px solid #777; min-height: 26px; padding: 2px 4px 0; }
  .fixit { margin-top: 3px; font-size: 13pt; }
  .fixit small { font-size: 11pt; display: block; opacity: .9; }
  .choices div.picked { position: relative; }
  .choices div.picked::after { content: ""; position: absolute; left: -6px; top: -3px; width: 26px; height: 24px; border: 2px solid #1F4FB8; border-radius: 50%; transform: rotate(-8deg); }
  .choices div.right { text-decoration: underline 2.5px #D02B20; text-underline-offset: 3px; }
  .tf span.picked { border: 2.5px solid #1F4FB8; }
  .blankFilled { display: inline-block; min-width: 1.1in; border-bottom: 1.3px solid #111; text-align: center; padding: 0 6px; }
  .scoreMark { flex: 0 0 1.45in; margin-top: -10px; }
  .scoreMark svg { width: 100%; height: auto; }
  .gradedHead { display: flex; gap: 14px; align-items: flex-start; }
  .gradedHead .hdr { flex: 1; }
  .comment { font-size: 15pt; margin: -2px 0 10px; }
  .badge { display: inline-block; border: 1.5px solid #111; border-radius: 4px; padding: 0 6px; font-size: 9pt; font-weight: 700; letter-spacing: .08em; margin-left: 8px; vertical-align: middle; }
  `;

  function traceSvg(text) {
    const W = 680, H = 118, base = 92, top = 20, mid = (base + top) / 2;
    const guide = (y, dash) => `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${dash ? '#9aa' : '#567'}" stroke-width="${dash ? 1 : 1.4}" ${dash ? 'stroke-dasharray="6 6"' : ''}/>`;
    const row = (y0, content) => `<g transform="translate(0 ${y0})">${guide(top)}${guide(mid, true)}${guide(base)}${content}</g>`;
    const t = `<text x="8" y="${base}" font-size="96" font-family="'Arial Rounded MT Bold','Helvetica Neue',Arial,sans-serif" letter-spacing="14" fill="none" stroke="#666" stroke-width="2" stroke-dasharray="5 4">${esc(text)}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H * 2}">${row(0, t)}${row(H, '')}</svg>`;
  }

  function studentItem(it) {
    const p = blanks(esc(it.prompt));
    let h = `<div class="p">${p}</div>`;
    if (it.svg && it.workSpace && it.type !== 'multiple_choice') {
      // Figure and work space side by side to save paper.
      return `<li>${h}<div class="figwork"><div class="fig">${it.svg}</div><div class="work"></div></div></li>`;
    }
    if (it.svg) h += `<div class="fig">${it.svg}</div>`;
    if (it.type === 'trace') return `<li class="trace">${h}${traceSvg(it.traceText || '')}</li>`;
    if (it.type === 'multiple_choice') {
      const long = (it.choices || []).some(c => c.length > 32);
      h += `<div class="choices${long ? ' long' : ''}">${(it.choices || []).map((c, i) => `<div data-l="${LETTERS[i]}">${esc(c)}</div>`).join('')}</div>`;
    } else if (it.type === 'true_false') {
      h += '<div class="tf"><span>True</span><span>False</span></div>';
    } else if (it.type === 'short_answer') {
      h += '<div class="lines"><div></div><div></div></div>';
    } else if (it.type === 'long_answer') {
      h += '<div class="lines"><div></div><div></div><div></div><div></div><div></div></div>';
    } else if (it.type === 'fill_blank' && !/_{3,}/.test(it.prompt)) {
      h += '<div class="lines"><div></div></div>';
    }
    if (it.workSpace) h += '<div class="work"></div>';
    return `<li>${h}</li>`;
  }

  function keyItem(it, opts) {
    let a = it.type === 'multiple_choice' ? `${LETTERS[it.answerIndex]}. ${esc(it.answer)}` : esc(it.answer);
    let h = `<div class="q">${esc(it.prompt).slice(0, 220)}</div><div class="ans">${a}</div>`;
    if (opts.explanations !== false && it.explanation) h += `<div class="exp">${esc(it.explanation)}</div>`;
    if (it.flag) h += `<div class="flag">⚠ Second AI engine suggests: ${esc(it.flag)} — please double-check.</div>`;
    return `<li>${h}</li>`;
  }

  function header(ws, meta, idx, total, key) {
    const sub = [meta.gradeLabel, meta.course && meta.course !== meta.subject ? meta.course : meta.subject].filter(Boolean).join(' · ');
    return `<div class="hdr"><h1>${esc(ws.title)}${key ? '<span class="badge">ANSWER KEY</span>' : ''}</h1>
      <div class="meta">${esc(sub)}<br>${total > 1 ? `Worksheet ${idx + 1} of ${total}` : esc(meta.difficulty || '')}</div></div>`;
  }

  // Smart worksheets: every question gets its number as data so the page layout can be measured.
  const numberItem = (html, n) => html.replace(/^<li( class="[^"]*")?>/, (m, c) => `<li${c || ''} data-q="${n}"><span class="qn">${n}.</span>`);

  function studentSheet(ws, meta, idx, total, opts) {
    const smart = opts.smart && opts.smart.codes && opts.smart.codes[idx] !== undefined;
    let h = header(ws, meta, idx, total, false);
    if (opts.nameLine !== false) h += `<div class="name"><span>Name: ${meta.studentName ? `<b class="stu">${esc(meta.studentName)}</b>` : ''}</span><span class="date">Date:</span></div>`;
    if (ws.instructions) h += `<p class="instructions">${esc(ws.instructions)}</p>`;
    if (ws.passage) h += `<div class="passage"><h2>Read the passage</h2>${ws.passage.split(/\n\s*\n|\n/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
    if (ws.vocabulary && ws.vocabulary.length) h += `<div class="vocab"><b>Vocabulary:</b> ${ws.vocabulary.map(v => `<b>${esc(v.word)}</b> — ${esc(v.definition)}`).join('; ')}</div>`;
    let start = 1;
    for (const s of ws.sections) {
      const compact = ws.source === 'code' && s.items.every(i => i.type === 'fill_blank' && !i.svg && i.prompt.length < 60);
      h += `<div class="section">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}${s.instructions ? `<p class="sinst">${esc(s.instructions)}</p>` : ''}
        <ol class="items${compact ? ' math' : ''}" start="${start}">${s.items.map((it, k) => smart ? numberItem(studentItem(it), start + k) : studentItem(it)).join('')}</ol></div>`;
      start += s.items.length;
    }
    if (smart) return `<section class="sheet smartFlow" data-ws="${idx}" data-code="${opts.smart.codes[idx]}" data-title="${esc(ws.title)}">${h}</section>`;
    return `<section class="sheet">${h}</section>`;
  }

  function keySheet(ws, meta, idx, total, opts) {
    let h = header(ws, meta, idx, total, true);
    let start = 1;
    for (const s of ws.sections) {
      if (s.items.every(i => i.type === 'trace')) { h += '<p>Tracing practice — no answer key needed.</p>'; continue; }
      h += `<div class="section">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}<ol class="items" start="${start}">${s.items.map(it => keyItem(it, opts)).join('')}</ol></div>`;
      start += s.items.length;
    }
    return `<section class="sheet key">${h}</section>`;
  }


  // ---------- graded (teacher-marked) copy ----------
  const PEN = {
    ok: '<svg class="pen" viewBox="0 0 30 30"><path d="M4 16 C7 18 9 21 11 25 C15 15 20 8 27 3" fill="none" stroke="#D02B20" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    no: '<svg class="pen" viewBox="0 0 30 30"><path d="M6 5 C12 12 18 18 25 26" fill="none" stroke="#D02B20" stroke-width="3.2" stroke-linecap="round"/><path d="M25 5 C18 11 12 18 5 25" fill="none" stroke="#D02B20" stroke-width="3.2" stroke-linecap="round"/></svg>',
    half: '<svg class="pen" viewBox="0 0 30 30"><text x="3" y="23" font-size="22" fill="#D02B20" font-family="Marker Felt, Chalkboard SE, cursive">½</text></svg>',
    rev: '<svg class="pen" viewBox="0 0 30 30"><text x="8" y="23" font-size="22" fill="#D02B20" font-family="Marker Felt, Chalkboard SE, cursive">?</text></svg>',
  };
  function letterGrade(p) { return p === null || p === undefined ? '' : p >= 97 ? 'A+' : p >= 90 ? 'A' : p >= 80 ? 'B' : p >= 70 ? 'C' : p >= 60 ? 'D' : 'F'; }
  function teacherComment(p) {
    if (p === null || p === undefined) return '';
    return p === 100 ? 'Perfect! Superstar work!' : p >= 90 ? 'Excellent work!' : p >= 80 ? 'Great job!' : p >= 70 ? 'Good effort. Keep going!' : p >= 60 ? 'Nice try. Let\'s review the red ones.' : 'Let\'s practice this together.';
  }
  function scoreMark(a) {
    const star = a.pct >= 90 ? `<g transform="translate(118 6) rotate(12)"><polygon points="14,0 18,9 28,10 20.5,16.5 23,26 14,21 5,26 7.5,16.5 0,10 10,9" fill="#F4B63F" stroke="#C98A12" stroke-width="1.2"/></g>` : '';
    return `<div class="scoreMark"><svg viewBox="0 0 150 96"><ellipse cx="72" cy="50" rx="62" ry="38" fill="none" stroke="#D02B20" stroke-width="3" transform="rotate(-6 72 50)"/>
      <path d="M18 58 C 30 92, 120 96, 132 50" fill="none" stroke="#D02B20" stroke-width="2" opacity=".55"/>
      <text x="72" y="46" text-anchor="middle" font-size="27" fill="#D02B20" font-family="Marker Felt, Chalkboard SE, cursive">${esc(a.earned)}/${esc(a.total)}</text>
      <text x="72" y="74" text-anchor="middle" font-size="21" fill="#D02B20" font-family="Marker Felt, Chalkboard SE, cursive">${esc(letterGrade(a.pct))} · ${esc(a.pct)}%</text>${star}</svg></div>`;
  }
  function gradedItem(it, r) {
    const LET = ['A', 'B', 'C', 'D', 'E', 'F'];
    const ans = r ? String(r.answer || '') : '';
    const mark = !r || r.skip ? '' : PEN[r.correct === 1 ? 'ok' : r.correct === 0.5 ? 'half' : r.correct === 0 ? 'no' : 'rev'];
    let p = esc(it.prompt);
    let h = '';
    if (it.type === 'fill_blank' && /_{3,}/.test(it.prompt)) {
      let used = false;
      p = p.replace(/_{3,}/g, () => { if (used) return '<span class="blank"></span>'; used = true; return `<span class="blankFilled hand">${esc(ans) || '&nbsp;'}</span>`; });
    }
    h += `<div class="p">${p}</div>`;
    if (it.svg) h += `<div class="fig">${it.svg}</div>`;
    if (it.type === 'trace') return `<li>${h}<div class="hand" style="font-size:12pt">(tracing practice)</div></li>`;
    if (it.type === 'multiple_choice') {
      const pick = (() => { const m = ans.trim().match(/^\(?([A-F])\b/i); if (m) return LET.indexOf(m[1].toUpperCase()); return (it.choices || []).findIndex(c => c.toLowerCase() === ans.trim().toLowerCase()); })();
      const long = (it.choices || []).some(c => c.length > 32);
      h += `<div class="choices${long ? ' long' : ''}">${(it.choices || []).map((c, i) => `<div data-l="${LET[i]}" class="${i === pick ? 'picked' : ''} ${r && r.correct !== 1 && i === it.answerIndex ? 'right' : ''}">${esc(c)}</div>`).join('')}</div>`;
    } else if (it.type === 'true_false') {
      const t = /^t/i.test(ans.trim()), f = /^f/i.test(ans.trim());
      h += `<div class="tf"><span class="${t ? 'picked' : ''}">True</span><span class="${f ? 'picked' : ''}">False</span></div>`;
    } else if (!(it.type === 'fill_blank' && /_{3,}/.test(it.prompt))) {
      h += `<div class="lineAns hand">${esc(ans) || '&nbsp;'}</div>`;
    }
    if (r && !r.skip && r.correct !== 1) {
      const key = it.type === 'multiple_choice' ? `${LET[it.answerIndex]}. ${it.answer}` : it.type === 'long_answer' ? '' : it.answer;
      h += `<div class="fixit red">${key ? `→ ${esc(key)}` : ''}${r.feedback ? `<small>${esc(r.feedback)}</small>` : ''}</div>`;
    } else if (r && r.correct === 1 && r.feedback && it.type === 'long_answer') {
      h += `<div class="fixit red"><small>${esc(r.feedback)}</small></div>`;
    }
    return `<li>${mark}${h}</li>`;
  }
  function gradedSheet(ws, meta, idx, total, opts) {
    const a = opts.attempt;
    const byN = new Map((a.results || []).map(r => [r.n, r]));
    let h = `<div class="gradedHead">${header(ws, meta, idx, total, false)}${scoreMark(a)}</div>`;
    h += `<div class="name"><span>Name: ${meta.studentName || a.studentName ? `<b class="stu">${esc(meta.studentName || a.studentName)}</b>` : ''}</span><span class="date">Date: <span class="hand" style="font-size:12pt">${esc(new Date(a.takenAt).toLocaleDateString())}</span></span></div>`;
    h += `<p class="comment red">${esc(teacherComment(a.pct))}</p>`;
    if (ws.passage) h += `<div class="passage"><h2>Read the passage</h2>${ws.passage.split(/\n\s*\n|\n/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
    let n = 0;
    for (const s of ws.sections) {
      h += `<div class="section">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}<ol class="items" start="${n + 1}">${s.items.map(it => { n++; return gradedItem(it, byN.get(n)); }).join('')}</ol></div>`;
    }
    return `<section class="sheet graded">${h}</section>`;
  }

  /**
   * pack: { meta, worksheets: [...] }, mode: 'student' | 'key' | 'graded'
   * opts: { nameLine, explanations, screen (adds paper preview styling), only: index }
   */
  function renderDocument(pack, mode, opts) {
    opts = opts || {};
    const list = pack.worksheets.map((ws, i) => [ws, i]).filter(([, i]) => opts.only === undefined || opts.only === i);
    const body = list.map(([ws, i]) => (mode === 'key' ? keySheet : mode === 'graded' ? gradedSheet : studentSheet)(ws, pack.meta, i, pack.worksheets.length, opts)).join('\n');
    const smartCss = mode === 'student' && opts.smart ? SMART_CSS(opts.smart.paper) : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(pack.meta.title || 'Worksheets')}</title><style>${CSS}${smartCss}</style></head>
<body class="${opts.screen ? 'screen' : ''}">${body}</body></html>`;
  }

  // ---------------- Smart worksheets ----------------
  // Page geometry in CSS pixels (96 per inch). Markers sit 0.3in in from each corner; the ID strip runs
  // between the top two. Everything a scanner needs is described relative to the marker centres.
  const PAPER = { Letter: { w: 816, h: 1056 }, A4: { w: 794, h: 1123 } };
  const SMART = { inset: 29, marker: 31, cell: 11, cellH: 13, stripTop: 37, bits: 28,
    content: { top: 92, right: 62, bottom: 78, left: 62 } };
  function SMART_CSS(paper) {
    const P = PAPER[paper] || PAPER.Letter, S = SMART, c = S.content;
    return `
  @page { size: ${paper === 'A4' ? 'A4' : 'Letter'}; margin: 0; }
  body.smartBody { margin: 0; }
  .smartFlow { width: ${P.w - c.left - c.right}px; }
  .spage { position: relative; width: ${P.w}px; height: ${P.h}px; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
  .spage:last-child { page-break-after: auto; break-after: auto; }
  .spage .box { position: absolute; left: ${c.left}px; top: ${c.top}px; width: ${P.w - c.left - c.right}px; height: ${P.h - c.top - c.bottom}px; overflow: hidden; }
  .mk { position: absolute; width: ${S.marker}px; height: ${S.marker}px; background: #000; }
  .mk.tl { left: ${S.inset}px; top: ${S.inset}px; }
  .mk.tl::after { content: ""; position: absolute; left: 10px; top: 10px; width: 11px; height: 11px; background: #fff; }
  .mk.tr { right: ${S.inset}px; top: ${S.inset}px; }
  .mk.bl { left: ${S.inset}px; bottom: ${S.inset}px; }
  .mk.br { right: ${S.inset}px; bottom: ${S.inset}px; }
  .idstrip { position: absolute; top: ${S.stripTop}px; display: flex; height: ${S.cellH}px; }
  .idstrip i { display: block; width: ${S.cell}px; height: 100%; }
  .idstrip i.b { background: #000; }
  .idtext { position: absolute; top: ${S.stripTop + S.cellH + 3}px; left: 0; right: 0; text-align: center; font-size: 7pt; color: #777; letter-spacing: .04em; }
  .pfoot { position: absolute; bottom: ${S.inset + 8}px; left: 0; right: 0; text-align: center; font-size: 8pt; color: #777; }
  ol.items > li[data-q] { list-style: none; position: relative; }
  ol.items:has(> li[data-q]) { padding-left: 1.9em; }
  .qn { position: absolute; left: -1.9em; width: 1.6em; text-align: right; font-weight: 400; }
  .items.math:has(> li[data-q]) { columns: auto; display: grid; grid-template-columns: 1fr 1fr; column-gap: 0.45in; }
  `;
  }
  // 20-bit worksheet code + 3-bit page + 5-bit check = 28 cells.
  function smartBits(code, page) {
    const v = [];
    for (let i = 19; i >= 0; i--) v.push((code >> i) & 1);
    for (let i = 2; i >= 0; i--) v.push((page >> i) & 1);
    // CRC-5 (x^5 + x^2 + 1) over the 23 data bits catches any one- or two-cell misread.
    let r = 0;
    for (const b of v) { const top = ((r >> 4) & 1) ^ b; r = (r << 1) & 31; if (top) r ^= 0x05; }
    for (let i = 4; i >= 0; i--) v.push((r >> i) & 1);
    return v;
  }
  function smartDecode(bits) {
    if (!bits || bits.length !== 28) return null;
    const n = (a, b) => bits.slice(a, b).reduce((x, y) => x * 2 + y, 0);
    const code = n(0, 20), page = n(20, 23);
    const good = smartBits(code, page);
    return code > 0 && good.every((b, i) => b === bits[i]) ? { code, page } : null;
  }
  const codeLabel = (code) => 'WS-' + String(code).padStart(7, '0').replace(/(\d{3})(\d{4})/, '$1-$2');

  /* Runs inside the hidden print window: pours each .smartFlow sheet into fixed pages with markers,
     then reports where every question landed (as fractions of the marker frame). */
  function smartPaginate(cfg) {
    const S = cfg.S, P = cfg.P;
    const bitsFor = new Function('code', 'page', cfg.bitsSrc + '; return smartBits(code, page);');
    const out = [];
    const flows = Array.from(document.querySelectorAll('.smartFlow'));
    document.body.classList.add('smartBody');
    for (const flow of flows) {
      const code = Number(flow.dataset.code), ws = Number(flow.dataset.ws);
      // Units: header block, passage, vocab, section headings (kept with the next item) and each question.
      const units = [];
      let pendingHead = [];
      for (const el of Array.from(flow.children)) {
        if (el.classList.contains('section')) {
          const ol = el.querySelector('ol.items');
          const heads = Array.from(el.children).filter(c => c !== ol);
          pendingHead.push(...heads.map(hh => ({ el: hh, kind: 'head' })));
          const items = ol ? Array.from(ol.children) : [];
          items.forEach((li, k) => {
            units.push({ el: li, kind: 'item', ol, with: k === 0 ? pendingHead : [] });
            if (k === 0) pendingHead = [];
          });
        } else units.push({ el, kind: 'block', with: [] });
      }
      const pages = [];
      let page = null, box = null, curOl = null, curOlSrc = null;
      const newPage = () => {
        page = document.createElement('div'); page.className = 'spage';
        box = document.createElement('div'); box.className = 'box'; page.appendChild(box);
        flow.parentNode.insertBefore(page, flow);
        pages.push(page); curOl = null; curOlSrc = null;
      };
      const fits = () => box.scrollHeight <= box.clientHeight + 1;
      const place = (u) => {
        const added = [];
        for (const h of u.with) { const c = h.el; box.appendChild(c); added.push(c); curOl = null; }
        if (u.kind === 'item') {
          if (!curOl || curOlSrc !== u.ol) {
            curOl = u.ol.cloneNode(false); curOlSrc = u.ol; box.appendChild(curOl); added.push(curOl);
          }
          curOl.appendChild(u.el); added.push(u.el);
        } else { box.appendChild(u.el); added.push(u.el); curOl = null; }
        return added;
      };
      newPage();
      for (const u of units) {
        const added = place(u);
        if (!fits() && box.children.length > added.filter(a => a.parentNode === box).length) {
          // Undo and start a fresh page (unless this unit alone overflows an empty page).
          for (const a of added.slice().reverse()) { if (a !== u.el) a.remove(); }
          u.el.remove();
          if (curOl && !curOl.children.length) curOl.remove();
          newPage(); place(u);
        }
      }
      flow.remove();
      // Furniture + measurements
      const fx0 = S.inset + S.marker / 2, fy0 = S.inset + S.marker / 2;
      const fw = P.w - 2 * fx0, fh = P.h - 2 * fy0;
      const meta = { code, ws, pages: [] };
      pages.forEach((pg, n) => {
        for (const c of ['tl', 'tr', 'bl', 'br']) { const m = document.createElement('div'); m.className = 'mk ' + c; pg.appendChild(m); }
        const strip = document.createElement('div'); strip.className = 'idstrip';
        const bits = [1, 0].concat(bitsFor(code, n), [0, 1]);
        strip.innerHTML = bits.map(b => `<i class="${b ? 'b' : ''}"></i>`).join('');
        strip.style.left = Math.round((P.w - bits.length * S.cell) / 2) + 'px';
        pg.appendChild(strip);
        const t = document.createElement('div'); t.className = 'idtext';
        t.textContent = `${cfg.label(code)}  ·  page ${n + 1} of ${pages.length}`;
        pg.appendChild(t);
        const pr = pg.getBoundingClientRect();
        const items = Array.from(pg.querySelectorAll('li[data-q]')).map(li => {
          const r = li.getBoundingClientRect();
          return { q: Number(li.dataset.q), x: (r.left - pr.left - fx0) / fw, y: (r.top - pr.top - fy0) / fh, w: r.width / fw, h: r.height / fh };
        });
        meta.pages.push({ n, items });
      });
      meta.stripX = (P.w - 32 * S.cell) / 2;
      out.push(meta);
    }
    return out;
  }
  function smartScript(paper) {
    const cfg = { S: SMART, P: PAPER[paper] || PAPER.Letter, bitsSrc: smartBits.toString() };
    return `(${smartPaginate.toString()})(Object.assign(${JSON.stringify(cfg)}, { label: ${codeLabel.toString()} }))`;
  }

  const api = { renderDocument, esc, letterGrade, teacherComment, smartScript, smartBits, smartDecode, codeLabel, SMART, PAPER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Render = api;
})(typeof self !== 'undefined' ? self : this);
