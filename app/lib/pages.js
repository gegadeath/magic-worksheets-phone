/* Worksheet Studio phone app: turns a camera photo into a clean page before it is sent.
 * Smart worksheets are straightened and cropped using their four corner squares. Other sheets are
 * found against the table and straightened. Every page then has its shadows evened out, is shrunk
 * to a sensible size, and is checked for blur, darkness and glare.
 * Everything runs on the phone. */
(function (root) {
  'use strict';
  const SS = () => root.SmartScan;

  // Measured on test photos: sharp straightened pages score 400-800, a 2-3 px blur drops them under 60.
  const LIMIT = { blurSmart: 80, blurPlain: 35, darkSmart: 110, darkPlain: 75, glare: 0.3 };
  const MAX_SIDE = 1700, QUALITY = 0.82;

  async function toCanvas(src) {
    if (src instanceof HTMLCanvasElement) return SS().toCanvas(src, 2400);
    // createImageBitmap applies the photo's rotation from the camera (EXIF) for us
    let bmp = null;
    try { bmp = await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch (_) { bmp = null; }
    if (!bmp) {
      bmp = await new Promise((ok, no) => { const u = URL.createObjectURL(src), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => no(new Error('Could not read that photo')); i.src = u; });
    }
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }
  const toBlob = (c) => new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('Could not save that photo'))), 'image/jpeg', QUALITY));

  /** registry: { [code]: { k, paper, pages } } from the Mac. Returns the cleaned page and what was found. */
  async function process(src, registry) {
    const reg = registry || {};
    const bytesIn = src && src.size ? src.size : 0;
    const full = await toCanvas(src);
    let page = null, how = 'none', code = null, pageNo = null;
    const a = SS().analyzeCanvas(full, (c) => reg[c] && reg[c].paper);
    if (a.ok) { page = a.canvas; how = 'smart'; code = a.code; pageNo = a.page; }
    else {
      const f = SS().flattenDocument(full);
      if (f) { page = f; how = 'edges'; } else page = full;
    }
    const q = SS().quality(page), smart = how === 'smart';
    const issues = [];
    if (q.sharpness < (smart ? LIMIT.blurSmart : LIMIT.blurPlain)) issues.push('blurry');
    if (q.brightness < (how === 'none' ? LIMIT.darkPlain : LIMIT.darkSmart)) issues.push('dark');
    if (q.glare > LIMIT.glare) issues.push('glare');
    const out = SS().toCanvas(page, MAX_SIDE);
    SS().evenLight(out);
    const blob = await toBlob(out);
    return { blob, code, page: pageNo, how, issues, quality: q, bytesIn, bytesOut: blob.size, known: code != null && !!reg[code] };
  }

  const ISSUE_TEXT = {
    blurry: ['Blurry', 'The writing is blurry. Hold the phone still and retake it.'],
    dark: ['Too dark', 'Too dark to read well. Turn on a light or move to a window.'],
    glare: ['Washed out', 'Too bright or shiny. Move out of direct light.'],
  };
  root.Pages = { process, LIMIT, ISSUE_TEXT };
})(window);
