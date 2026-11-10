/* Worksheet Studio phone app: outbox for scans.
 * Pressing Send puts the cleaned pages here first, so nothing is lost without internet. The outbox
 * uploads by itself when the phone is back online: from the app (on start, when it comes back to
 * the screen, when the connection returns, every 20 s) and from the service worker through
 * Background Sync, which Android can run even after the app is closed.
 * Works the same in the page and in the service worker. A lock keeps the two from sending at once. */
(function (root) {
  'use strict';
  const SB = 'https://hlvjfmfabcbcdftkquen.supabase.co';
  const PK = 'sb_publishable_adVnAv6Meh06JxiLHPUIKw_55_j-hOS';
  const KEY = 'outbox';

  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, no) => {
    const r = indexedDB.open('ws-app', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('p')) r.result.createObjectStore('p'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  }));
  async function readAll() {
    const d = await db();
    return new Promise(ok => { const q = d.transaction('p').objectStore('p').get(KEY); q.onsuccess = () => ok(Array.isArray(q.result) ? q.result : []); q.onerror = () => ok([]); });
  }
  async function writeAll(list) {
    const d = await db();
    return new Promise((ok, no) => { const t = d.transaction('p', 'readwrite'); t.objectStore('p').put(list, KEY); t.oncomplete = () => ok(); t.onerror = () => no(t.error); });
  }
  async function save(job) { const l = await readAll(); const i = l.findIndex(x => x.id === job.id); if (i >= 0) l[i] = job; else l.push(job); await writeAll(l); }
  async function remove(id) { await writeAll((await readAll()).filter(x => x.id !== id)); }

  async function rpc(name, args) {
    const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: PK, Authorization: `Bearer ${PK}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error(/unknown household/.test(t) ? 'This phone was unlinked on the Mac' : `The service answered ${r.status}`); e.fatal = /unknown household/.test(t); throw e; }
    return r.json();
  }

  /** job: { key, sheetKey, title, student, pages: [Blob] }. Returns the stored job. */
  async function add(job) {
    const j = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString(), token: null, done: [], tries: 0, state: 'waiting', error: '' }, job);
    await save(j);
    try {
      const reg = root.navigator.serviceWorker && await root.navigator.serviceWorker.ready;
      if (reg && reg.sync) await reg.sync.register('ws-outbox');
    } catch (_) { /* no background sync: the app retries by itself */ }
    return j;
  }

  async function sendOne(job, tell) {
    job.state = 'sending'; job.error = ''; await save(job); tell({ type: 'progress', job });
    if (!job.token) {
      job.token = await rpc('hh_scan_start', { p_key: job.key, p_sheet_key: job.sheetKey, p_title: job.title, p_student: job.student || '' });
      job.done = []; await save(job);
    }
    for (let k = 0; k < job.pages.length; k++) {
      if (job.done.includes(k)) continue;
      const r = await fetch(`${SB}/storage/v1/object/scans/${job.token}/${k + 1}.jpg`, { method: 'POST', headers: { apikey: PK, Authorization: `Bearer ${PK}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: job.pages[k] });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        if (/already exists|duplicate/i.test(t)) { /* sent before the connection dropped */ }
        else if (r.status === 400 || r.status === 403) { job.token = null; job.done = []; await save(job); throw new Error('The scan link ran out; starting a fresh one'); }
        else throw new Error(`Page ${k + 1} didn’t upload (${r.status})`);
      }
      job.done.push(k); await save(job); tell({ type: 'progress', job });
    }
    const ok = await rpc('mark_phone_uploaded', { p_token: job.token, p_pages: job.pages.length });
    if (!ok) {
      // Maybe it was marked just before the connection dropped. If not, start over with a fresh link.
      const list = await rpc('hh_scans', { p_key: job.key }).catch(() => []);
      const hit = Array.isArray(list) && list.find(x => x.token === job.token);
      if (!(hit && hit.state !== 'waiting')) { job.token = null; job.done = []; await save(job); throw new Error('The upload wasn’t accepted; trying again'); }
    }
    await remove(job.id);
    tell({ type: 'sent', job });
  }

  /** Send everything waiting. tell(event) gets { type: 'progress' | 'sent' | 'failed', job }. */
  async function flush(tell) {
    const t = tell || (() => {});
    const run = async () => {
      const jobs = await readAll();
      let left = 0;
      for (const job of jobs) {
        if (root.navigator && root.navigator.onLine === false) { left++; continue; }
        try { await sendOne(job, t); }
        catch (e) {
          left++;
          job.state = 'waiting'; job.tries = (job.tries || 0) + 1; job.error = String(e.message || e); job.fatal = !!e.fatal;
          await save(job).catch(() => {}); t({ type: 'failed', job });
          if (e instanceof TypeError || e.fatal) break; // offline or unlinked: no point trying the rest now
        }
      }
      return { left };
    };
    if (root.navigator && root.navigator.locks) return root.navigator.locks.request('ws-outbox', { ifAvailable: true }, lock => (lock ? run() : { busy: true }));
    return run();
  }

  root.Outbox = { add, list: readAll, flush, remove };
})(typeof self !== 'undefined' ? self : window);
