/* Pure parsing and evidence checks. No network, filesystem, or Zotero writes. */
var TitleDropCore = (function () {
  'use strict';
  const clean = s => String(s || '').normalize('NFKC')
    .replace(/<[^>]*>/g, '').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalized = s => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const tokens = s => clean(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

  function plausibleTitle(value) {
    const s = clean(value), ts = tokens(s);
    return s.length >= 12 && s.length <= 350
      && (ts.length >= 3 || /[\u3400-\u9fff]{7}/.test(s)) && ts.length <= 55
      && !/^(?:untitled|unknown|document\d*|microsoft\s+(?:word|powerpoint)|latex|template|abstract|references|bibliography|supporting information|supplementary (?:material|information)|accepted manuscript|preprint submitted|proceedings of|journal of|ieee transactions|acm reference format)\b/i.test(s)
      && !/[@]|https?:\/\/|\.pdf$|\.docx?$|all rights reserved|copyright\s*©/i.test(s);
  }

  function titleAppears(title, text) {
    const t = normalized(title), body = normalized(text);
    // Allow spacing, punctuation and ligature differences, but not token bags
    // assembled out of unrelated sentences or an unrelated references section.
    return t.length >= 12 && body.includes(t);
  }

  function safeFilename(title) {
    let s = clean(title).replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ')
      .replace(/^[. ]+|[. ]+$/g, '');
    if (!s) throw new Error('A non-empty title is required.');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = '_' + s;
    // 220 UTF-8 bytes leaves room for Zotero's collision suffix and extension.
    const bytes = c => { const n = c.codePointAt(0); return n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4; };
    let out = '', count = 0;
    for (const c of s) { const n = bytes(c); if (count + n > 220) break; out += c; count += n; }
    return out.replace(/[. ]+$/g, '') + '.pdf';
  }

  function parseRecognizer(data) {
    const pages = [];
    for (const page of (data?.pages || []).slice(0, 2)) {
      const lines = [];
      const word = v => Array.isArray(v) && v.length >= 14 && typeof v[13] === 'string' && typeof v[0] === 'number';
      function visit(v) {
        if (!Array.isArray(v)) return;
        if (v.length && v.every(word)) {
          const text = clean(v.map(w => w[13] + (w[5] ? ' ' : '')).join(''));
          if (text) lines.push({text, x: Math.min(...v.map(w => w[0])), y: Math.min(...v.map(w => w[1])),
            bottom: Math.max(...v.map(w => w[3])), size: Math.max(...v.map(w => w[4])),
            bold: v.filter(w => w[9]).length / v.length});
        } else for (const child of v) visit(child);
      }
      visit(page[2]);
      pages.push({width: page[0], height: page[1], lines});
    }
    return {metadata: data?.metadata || {}, pages};
  }

  function pageText(page) { return (page?.lines || []).map(l => l.text).join('\n'); }
  function openingText(page) {
    // Never search identifiers through the bibliography.
    return pageText(page).split(/\n\s*(?:(?:\d+|[IVX]+)[.\s]+)?(?:references|bibliography)\s*\n/i)[0];
  }

  function identifiers(filename, text) {
    const base = clean(filename).replace(/\.pdf$/i, '').replace(/\s*\(\d+\)$/, '');
    const fileID = base.match(/^(?:arxiv[-_: ]*)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i)?.[1];
    const found = [...text.matchAll(/\barxiv\s*[:：]\s*((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)/gi)].map(m => m[1]);
    const canonical = s => String(s).toLowerCase().replace(/v\d+$/, '');
    const ids = [...new Set([fileID, ...found].filter(Boolean))];
    const conflict = new Set(ids.map(canonical)).size > 1;
    const arxiv = conflict ? null : (found[0] || fileID || null);
    const cleanDOI = s => {
      s = s.replace(/[.,;:]+$/, '');
      while (s.endsWith(')') && (s.match(/\)/g)||[]).length > (s.match(/\(/g)||[]).length) s = s.slice(0,-1);
      return s;
    };
    const dois = [...new Set([...text.matchAll(/\b10\.\d{4,9}\/[A-Z0-9._;()/:+-]+/gi)]
      .map(m => cleanDOI(m[0])))]
      .filter(x => !/XXXX|1234\/example|0000\//i.test(x));
    return { arxiv, conflict, dois: dois.slice(0, 3) };
  }

  function titleCandidate(parsed) {
    const page = parsed.pages[0];
    if (!page) return {title: '', confidence: 'review', reason: 'No readable first page.'};
    const opening = openingText(page);
    const meta = clean(parsed.metadata.Title || parsed.metadata.title);
    if (plausibleTitle(meta) && titleAppears(meta, opening)) {
      return {title: meta, confidence: 'high', source: 'PDF metadata + first-page text'};
    }
    const lines = page.lines.filter(l => l.size > 0 && l.text.length > 2);
    const weighted = lines.flatMap(l => Array(Math.min(60, l.text.length)).fill(l.size)).sort((a,b) => a-b);
    const bodySize = weighted[Math.floor(weighted.length / 2)] || 10;
    const eligible = lines.filter(l => l.y < page.height * 0.52 && l.x >= 0 && l.text.length > 3
      && !/arxiv\s*:|https?:|@|\b(?:doi|issn|isbn)\b|copyright|all rights reserved|proceedings|\b(?:conference|journal|transactions)\b.*\b(?:20\d\d|volume|vol\.)/i.test(l.text)
      && !/^(abstract|introduction|references|keywords|research article|original article|open access|article|accepted manuscript)\b/i.test(l.text));
    const max = Math.max(0, ...eligible.map(l => l.size));
    const large = eligible.filter(l => l.size >= max * 0.88).sort((a,b) => a.y-b.y || a.x-b.x);
    const blocks = [];
    for (const l of large) {
      const previous = blocks.at(-1);
      if (previous && l.y - previous.at(-1).bottom < max * 1.45 && l.y >= previous.at(-1).y - 1) previous.push(l);
      else blocks.push([l]);
    }
    const candidates = blocks.map(block => ({title: clean(block.map(l => l.text).join(' ')), block}))
      .filter(c => plausibleTitle(c.title));
    if (!candidates.length) return {title: plausibleTitle(meta) ? meta : '', confidence:'review', reason:'No clear title block on the first page.'};
    const best = candidates[0];
    const strong = candidates.length === 1 && max >= bodySize * 1.17
      && best.block.length <= 6 && best.block[0].y < page.height * 0.43;
    return { title: best.title, confidence: strong ? 'high' : 'review',
      source: 'First-page title layout', reason: strong ? '' : 'Title layout is ambiguous; confirm it before renaming.' };
  }

  function analyze(data, filename) {
    const parsed = parseRecognizer(data), text = openingText(parsed.pages[0]);
    const candidate = titleCandidate(parsed), ids = identifiers(filename, text);
    if (ids.conflict) { candidate.confidence = 'review'; candidate.reason = 'The filename and first page contain conflicting arXiv IDs.'; }
    return {parsed, text, candidate, ids};
  }

  const api = { clean, normalized, plausibleTitle, titleAppears, safeFilename, parseRecognizer, pageText, openingText, identifiers, titleCandidate, analyze };
  return api;
})();
if (typeof module !== 'undefined') module.exports = TitleDropCore;
