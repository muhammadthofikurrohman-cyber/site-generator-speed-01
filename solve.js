// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01).
// Faithful port of the reference pipeline, rewritten for speed:
// no regex in hot paths, Markdown rendered directly from lines (no token
// objects), templates compiled once per case and rendered with a flat
// scope stack, ASCII fast paths for slug/escape, per-case slug cache.

const RESERVED = ['posts', 'tags', 'page'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const INCLUDE_DEPTH = 8;

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------ text

const HAS_SPECIAL = /[&<>"']/;
const HAS_NONASCII = /[^\x00-\x7F]/;

function escapeHtml(s) {
  if (!HAS_SPECIAL.test(s)) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let e = null;
    if (c === 38) e = '&amp;';
    else if (c === 60) e = '&lt;';
    else if (c === 62) e = '&gt;';
    else if (c === 34) e = '&quot;';
    else if (c === 39) e = '&#39;';
    else continue;
    out += s.slice(start, i) + e;
    start = i + 1;
  }
  return start === 0 ? s : out + s.slice(start);
}

function longDate(date) {
  // date is a validated YYYY-MM-DD string.
  const d = (date.charCodeAt(8) - 48) * 10 + (date.charCodeAt(9) - 48);
  const m = (date.charCodeAt(5) - 48) * 10 + (date.charCodeAt(6) - 48);
  return `${d} ${MONTHS[m - 1]} ${date.slice(0, 4)}`;
}

// per-case slug cache (fresh Map per run call)
let slugCache = null;

function slugify(text) {
  const cached = slugCache.get(text);
  if (cached !== undefined) return cached;
  let out;
  if (!HAS_NONASCII.test(text)) {
    out = '';
    let gap = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      let keep = -1;
      if (c >= 65 && c <= 90) keep = c + 32;
      else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
      if (keep === -1) {
        gap = out.length > 0;
        continue;
      }
      if (gap) out += '-';
      gap = false;
      out += String.fromCharCode(keep);
    }
    if (out.length > 64) out = out.slice(0, 64);
    out = out.replace(/-+$/, '');
    if (out === '') out = 'untitled';
  } else {
    const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
    out = '';
    let gap = false;
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) {
        gap = out.length > 0;
        continue;
      }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
    out = out.slice(0, 64).replace(/-+$/, '');
    if (out === '') out = 'untitled';
  }
  slugCache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

// ------------------------------------------------------------ front matter

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function isDigit(c) {
  return c >= 48 && c <= 57;
}

// value grammar for one key; returns {value} or {error}
function valueOf(key, raw) {
  if (key === 'title' || key === 'summary') {
    if (raw.charCodeAt(0) === 34) {
      // quoted: "..." with only \" and \\ escapes, no other quote inside
      if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: `key "${key}": a quoted string is not closed` };
      let out = '';
      for (let i = 1; i < raw.length - 1; i++) {
        const c = raw[i];
        if (c === '\\') {
          const n = raw[i + 1];
          if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: `key "${key}": a quoted string holds an escape other than \\" or \\\\'` };
          out += n;
          i++;
        } else if (c === '"') return { error: `key "${key}": a quoted string holds a stray quote` };
        else out += c;
      }
      return { value: out };
    }
    if (raw.charCodeAt(0) === 91) return { error: `key "${key}": a bare string opens on [` };
    return { value: raw };
  }
  if (key === 'date') {
    let ok = raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45;
    if (ok) {
      for (let i = 0; i < 10; i++) {
        if (i === 4 || i === 7) continue;
        if (!isDigit(raw.charCodeAt(i))) { ok = false; break; }
      }
    }
    const y = ok ? (raw.charCodeAt(0) - 48) * 1000 + (raw.charCodeAt(1) - 48) * 100 + (raw.charCodeAt(2) - 48) * 10 + (raw.charCodeAt(3) - 48) : 0;
    const mo = ok ? (raw.charCodeAt(5) - 48) * 10 + (raw.charCodeAt(6) - 48) : 0;
    const d = ok ? (raw.charCodeAt(8) - 48) * 10 + (raw.charCodeAt(9) - 48) : 0;
    if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    return { value: raw };
  }
  if (key === 'tags') {
    if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') return { value: [] };
    const parts = inner.split(',');
    const tags = new Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i].trim();
      if (t === '') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      for (let j = 0; j < t.length; j++) {
        const c = t.charCodeAt(j);
        if (c === 34 || c === 91 || c === 93) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      tags[i] = t;
    }
    return { value: tags };
  }
  if (key === 'draft') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'key "draft": true or false' };
  }
  if (key === 'layout') {
    if (raw.length === 0) return { error: 'key "layout": not a template name' };
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return { error: 'key "layout": not a template name' };
    }
    return { value: raw };
  }
  if (key === 'slug') {
    let ok = raw.length >= 1 && raw.length <= 64;
    if (ok) {
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) { ok = false; break; }
      }
      // /^[a-z0-9]+(?:-[a-z0-9]+)*$/ : no leading/trailing/double '-'
      if (ok && (raw.charCodeAt(0) === 45 || raw.charCodeAt(raw.length - 1) === 45 || raw.indexOf('--') !== -1)) ok = false;
    }
    return ok ? { value: raw } : { error: 'key "slug": not a slug' };
  }
  return { error: `unknown key "${key}"` };
}

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function parseFrontMatter(text) {
  if (text !== '---' && !text.startsWith('---\n')) return { error: 'no front matter' };
  if (text.length > 3 && text.charCodeAt(3) !== 10) return { error: 'no front matter' };
  // phase 1: find the closing '---' line first (the reference validates lines only after it is found)
  let closeEnd = -1;
  let closeIndex = -1;
  {
    let start = 4;
    let i = 1;
    for (;;) {
      const lineEnd = text.indexOf('\n', start);
      const line = lineEnd === -1 ? text.slice(start) : text.slice(start, lineEnd);
      if (line === '---') { closeEnd = lineEnd; closeIndex = i; break; }
      if (lineEnd === -1) return { error: 'the front matter is not closed' };
      start = lineEnd + 1;
      i++;
    }
  }
  const data = {};
  let start = 4;
  for (let i = 1; i < closeIndex; i++) {
    const lineEnd = text.indexOf('\n', start);
    const line = lineEnd === -1 ? text.slice(start) : text.slice(start, lineEnd);
    // blank (spaces/tabs only) or comment
    let blank = true;
    for (let p = 0; p < line.length; p++) {
      const c = line.charCodeAt(p);
      if (c !== 32 && c !== 9) { blank = false; break; }
    }
    if (!blank && line.charCodeAt(0) !== 35) {
      // LINE: /^([a-z_]+):(?: (.*))?$/
      let k = 0;
      while (k < line.length) {
        const c = line.charCodeAt(k);
        if ((c >= 97 && c <= 122) || c === 95) k++;
        else break;
      }
      if (k === 0 || k >= line.length || line.charCodeAt(k) !== 58) return { error: `line ${i + 1} is not "key: value"` };
      const key = line.slice(0, k);
      let raw;
      const rest = k + 1;
      if (rest === line.length) raw = '';
      else if (line.charCodeAt(rest) === 32) raw = line.slice(rest + 1);
      else return { error: `line ${i + 1} is not "key: value"` };
      let e = raw.length;
      while (e > 0) {
        const c = raw.charCodeAt(e - 1);
        if (c === 32 || c === 9) e--;
        else break;
      }
      if (e !== raw.length) raw = raw.slice(0, e);
      if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    start = lineEnd + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd === -1 ? '' : text.slice(closeEnd + 1) };
}

// ------------------------------------------------------------ markdown

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

// fence open: /^```([A-Za-z0-9_+-]*)[ \t]*$/ ; returns lang or null
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  return i === line.length ? lang : null;
}

function fenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// heading: /^(#{1,6})[ \t]+(.*?)[ \t]*$/ with non-empty text; returns {depth,text} or null
function headingOf(line) {
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === 35) n++;
  if (n === 0 || n > 6) return null;
  if (n >= line.length) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  let e = line.length;
  while (e > n && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  if (e === n + 1 && (line.charCodeAt(n) === 32 || line.charCodeAt(n) === 9)) {
    // text would be empty after the mandatory space(s): check if anything non-space remains
  }
  // text = line[n+..e] with leading spaces/tabs skipped; must be non-empty
  let s = n;
  while (s < e && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  if (s >= e) return null;
  return { depth: n, text: line.slice(s, e) };
}

function isHr(line) {
  if (line !== '---' && line !== '***') {
    // /^(?:---|\*\*\*)[ \t]*$/ : exactly --- or *** then spaces/tabs
    let base = null;
    if (line.startsWith('---')) base = 3;
    else if (line.startsWith('***')) base = 3;
    else return false;
    for (let i = base; i < line.length; i++) {
      const c = line.charCodeAt(i);
      if (c !== 32 && c !== 9) return false;
    }
    return true;
  }
  return true;
}

function isWsCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 0xA0 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200A) || c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF;
}

// /^ {2,}\S/ : two or more spaces, then a non-whitespace character
function isContinued(l) {
  let sp = 0;
  while (sp < l.length && l.charCodeAt(sp) === 32) sp++;
  return sp >= 2 && sp < l.length && !isWsCode(l.charCodeAt(sp));
}

function endsParagraph(line) {
  if (line === '') return true;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) return isBlank(line);
  if (c0 === 96) return fenceOpen(line) !== null;
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return isHr(line);
  return false;
}

// A candidate match at j is real only when the run of backslashes just before
// it (bounded by `from`) is even: an odd run means the last backslash escapes it.
function backslashRunEven(s, j, from) {
  let n = 0;
  for (let k = j - 1; k >= from && s[k] === '\\'; k--) n++;
  return (n & 1) === 0;
}

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  let j = s.indexOf(what, from);
  while (j !== -1) {
    if (backslashRunEven(s, j, from)) return j;
    j = s.indexOf(what, j + 1);
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  let j = s.indexOf('*', from);
  while (j !== -1) {
    if (!backslashRunEven(s, j, from)) {
      j = s.indexOf('*', j + 1);
      continue;
    }
    if (s[j + 1] === '*') {
      j = s.indexOf('*', j + 2);
      continue;
    }
    return j;
  }
  return -1;
}

// Inline rendering into `out` array. One C++ regex scan finds the next
// markdown- or HTML-special char; plain runs between them are clean by
// construction and are pushed as-is (no second escape pass).
const NEXT_SPECIAL = /[\\`*[&<>"']/g;
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function inlineTo(out, s, env) {
  let i = 0;
  const n = s.length;
  while (i < n) {
    NEXT_SPECIAL.lastIndex = i;
    const m = NEXT_SPECIAL.exec(s);
    if (m === null) {
      out.push(s.slice(i));
      return;
    }
    const j = m.index;
    if (j > i) out.push(s.slice(i, j));
    const c = s[j];
    if (c === '&' || c === '<' || c === '>' || c === '"' || c === "'") {
      out.push(ENT[c]);
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      if (j + 1 < n && ESCAPABLE.has(s[j + 1])) {
        const e = s[j + 1];
        out.push(ENT[e] ?? e);
        i = j + 2;
      } else {
        out.push('\\');
        i = j + 1;
      }
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        out.push('<code>', escapeHtml(s.slice(j + 1, k)), '</code>');
        i = k + 1;
      } else {
        out.push('`');
        i = j + 1;
      }
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findUnescaped(s, '**', j + 2);
        if (k > j + 2) {
          out.push('<strong>');
          inlineTo(out, s.slice(j + 2, k), env);
          out.push('</strong>');
          i = k + 2;
        } else {
          out.push('**');
          i = j + 2;
        }
        continue;
      }
      const k = findSingleStar(s, j + 1);
      if (k > j + 1) {
        out.push('<em>');
        inlineTo(out, s.slice(j + 1, k), env);
        out.push('</em>');
        i = k + 1;
      } else {
        out.push('*');
        i = j + 1;
      }
      continue;
    }
    // '['
    const k = findUnescaped(s, ']', j + 1);
    const mm = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
    const target = mm === -1 ? '' : s.slice(k + 2, mm);
    if (target !== '' && !/\s/.test(target)) {
      out.push('<a href="', escapeHtml(env.link(target)), '">');
      inlineTo(out, s.slice(j + 1, k), env);
      out.push('</a>');
      i = mm + 1;
      continue;
    }
    out.push('[');
    i = j + 1;
  }
}

function inlineStr(s, env) {
  const out = [];
  inlineTo(out, s, env);
  return out.join('');
}

// Render Markdown body -> {html, toc, excerpt}; writes blocks into out array.
// Count the words of one line (runs of non-whitespace, JS \s set).
function countWordsLine(line) {
  let count = 0;
  let inWord = false;
  for (let p = 0; p < line.length; p++) {
    const c = line.charCodeAt(p);
    if (isWsCode(c)) inWord = false;
    else if (!inWord) { inWord = true; count++; }
  }
  return count;
}

function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let words = 0;
  let i = 0;
  const L = lines.length;
  while (i < L) {
    const line = lines[i];
    words += countWordsLine(line);
    const c0 = line.length === 0 ? -1 : line.charCodeAt(0);
    if (c0 === -1 || c0 === 32 || c0 === 9) {
      if (c0 === -1 || isBlank(line)) { i++; continue; }
      // indented non-blank: a paragraph (no block starts with space/tab)
    } else if (c0 === 96) {
      const lang = fenceOpen(line);
      if (lang !== null) {
        i++;
        const parts = [];
        while (i < L && !fenceClose(lines[i])) {
          words += countWordsLine(lines[i]);
          parts.push(lines[i], '\n');
          i++;
        }
        if (i < L) words += countWordsLine(lines[i]); // the closing ``` line is a word too
        i++;
        // '\n' is never escaped, so escaping the joined body equals escaping each line
        blocks.push('<pre><code' + (lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`) + '>' + escapeHtml(parts.join('')) + '</code></pre>', '\n');
        continue;
      }
      // not a fence: paragraph below
    } else if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        blocks.push(`<h${heading.depth} id="${id}">`);
        const hs = blocks.length;
        inlineTo(blocks, heading.text, env);
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html: blocks.slice(hs).join('') });
        blocks.push(`</h${heading.depth}>`, '\n');
        i++;
        continue;
      }
      // not a heading: paragraph below
    } else if (c0 === 45 || c0 === 42) {
      if (isHr(line)) {
        blocks.push('<hr>', '\n');
        i++;
        continue;
      }
      // else: a bullet list or a paragraph below
    } else if (c0 === 62) {
      const body = [];
      let firstQ = true;
      while (i < L && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        if (!firstQ) words += countWordsLine(l); // first line already counted above
        firstQ = false;
        body.push(l.startsWith('> ') ? l.slice(2) : l.slice(1));
      }
      const kept = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') kept.push(t);
      }
      if (kept.length === 0) blocks.push('<blockquote>\n</blockquote>', '\n');
      else {
        blocks.push('<blockquote>\n<p>');
        inlineTo(blocks, kept.join('\n'), env);
        blocks.push('</p>\n</blockquote>', '\n');
      }
      continue;
    }
    // list?
    let m = null;
    let isOrdered = false;
    let startNum = 1;
    if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) {
      m = line.slice(2);
    } else if (c0 >= 48 && c0 <= 57) {
      let j = 0;
      while (j < line.length && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
      if (j >= 1 && j <= 9 && line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) {
        m = line.slice(j + 2);
        isOrdered = true;
        startNum = Number(line.slice(0, j));
      }
    }
    if (m !== null) {
      const items = [];
      let cur = [trimLine(m)];
      const orderedMarker = isOrdered;
      const firstNum = startNum;
      i++;
      while (i < L) {
        const l = lines[i];
        let nm = null;
        const lc0 = l.charCodeAt(0);
        if (!orderedMarker && (lc0 === 45 || lc0 === 42) && l.charCodeAt(1) === 32) {
          nm = l.slice(2);
        } else if (orderedMarker && lc0 >= 48 && lc0 <= 57) {
          let j = 0;
          while (j < l.length && l.charCodeAt(j) >= 48 && l.charCodeAt(j) <= 57) j++;
          if (j >= 1 && j <= 9 && l.charCodeAt(j) === 46 && l.charCodeAt(j + 1) === 32) nm = l.slice(j + 2);
        }
        if (nm !== null) {
          words += countWordsLine(l);
          items.push(cur.join('\n'));
          cur = [trimLine(nm)];
          i++;
        } else if (isContinued(l)) {
          words += countWordsLine(l);
          cur.push(trimLine(l));
          i++;
        } else break;
      }
      items.push(cur.join('\n'));
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && firstNum !== 1 ? `<ol start="${firstNum}">` : `<${tag}>`;
      blocks.push(open, '\n');
      for (const item of items) {
        blocks.push('<li>');
        inlineTo(blocks, item, env);
        blocks.push('</li>\n');
      }
      blocks.push(`</${tag}>`, '\n');
      continue;
    }
    // paragraph
    const body = [trimLine(line)];
    i++;
    while (i < L && !endsParagraph(lines[i])) {
      words += countWordsLine(lines[i]);
      body.push(trimLine(lines[i++]));
    }
    const text = body.join('\n');
    blocks.push('<p>');
    const ps = blocks.length;
    inlineTo(blocks, text, env);
    if (excerpt === null) excerpt = blocks.slice(ps).join('');
    blocks.push('</p>', '\n');
  }
  return { html: blocks.join(''), toc, excerpt: excerpt ?? '', words };
}

// ------------------------------------------------------------ templates

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// scope: array of vars objects, innermost last
function lookup(scopes, path) {
  for (let s = scopes.length - 1; s >= 0; s--) {
    const vars = scopes[s];
    if (Object.hasOwn(vars, path[0])) {
      let v = vars[path[0]];
      for (let k = 1; k < path.length; k++) {
        if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
        v = v[path[k]];
      }
      return v;
    }
  }
  return undefined;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function renderNodes(nodes, scopes, ctx, depth, out) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    switch (n.kind) {
      case 'text':
        out.push(n.text);
        break;
      case 'var':
        out.push(escapeHtml(textOf(lookup(scopes, n.path))));
        break;
      case 'raw':
        out.push(textOf(lookup(scopes, n.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scopes, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scopes, ctx, depth, out);
        break;
      }
      case 'for': {
        const xs = lookup(scopes, n.path);
        if (!Array.isArray(xs)) break;
        const vars = { loop: { index: 0, first: false, last: false, length: xs.length } };
        scopes.push(vars);
        for (let k = 0; k < xs.length; k++) {
          vars[n.name] = xs[k];
          const loop = vars.loop;
          loop.index = k + 1;
          loop.first = k === 0;
          loop.last = k === xs.length - 1;
          renderNodes(n.body, scopes, ctx, depth, out);
        }
        scopes.pop();
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scopes, ctx, depth + 1, out);
        break;
      }
    }
  }
}

// ------------------------------------------------------------ build

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

function hasScheme(target) {
  // /^[A-Za-z][A-Za-z0-9+.-]*:/
  const c0 = target.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < target.length; i++) {
    const c = target.charCodeAt(i);
    if (c === 58) return true;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

export function run(input) {
  slugCache = new Map();
  const templates = new Map();
  const report = [];
  const tNames = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of tNames) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n');
      sources.push({ path: f.path, text });
    } else statics.push({ path: f.path, content: f.content });
  }

  // front matter
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own = undefined;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // permalinks
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // markdown
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (hasScheme(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = md.words;
  }

  // collections
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    const tags = s.data.tags ?? [];
    for (const name of tags) {
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(name);
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name);
      const t = bySlug.get(slug);
      return t ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // cards / pages
  const cards = new Map();
  const cardOf = (s) => {
    if (s.card !== undefined) return s.card;
    const c = {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
    s.card = c;
    return c;
  };
  for (const p of posts) cards.set(p, cardOf(p));
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const pageOf = (s) => {
    const c = { ...cardOf(s) };
    c.slug = s.slug;
    c.content = s.html;
    c.toc = s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html }));
    c.newer = linkOf(s.newer ?? null);
    c.older = linkOf(s.older ?? null);
    c.is_post = s.post;
    return c;
  };

  // layouts
  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const ctx = { templates };
  const rootVars = { site, tags: allTags, recent, page: undefined, posts: undefined, pager: undefined, tag: undefined };
  const rootScopes = [rootVars];
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    rootVars.page = vars.page;
    rootVars.posts = vars.posts;
    rootVars.pager = vars.pager;
    rootVars.tag = vars.tag;
    renderNodes(nodes, rootScopes, ctx, 0, out);
    return out.join('');
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // report
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
