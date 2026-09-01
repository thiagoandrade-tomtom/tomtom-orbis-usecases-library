#!/usr/bin/env node
/* ===================================================================
   Design-system audit — checks the CSS against docs/DESIGN_SYSTEM.md.

   Three independent checks:
     spacing  padding / margin / gap        vs the Playbook spacing scale
     type     font-size + line-height pairs vs DESIGN_SYSTEM.md §8
     icon     inline <svg width/height>     vs DESIGN_SYSTEM.md §16

   Usage:
     node scripts/design-audit.mjs              # all checks, summary + detail
     node scripts/design-audit.mjs spacing      # one check only
     node scripts/design-audit.mjs --quiet      # summary only, no detail
     node scripts/design-audit.mjs --strict     # exit 1 if any violation

   The CANON block below is the single source of truth. When the design
   system changes, edit it here AND in docs/DESIGN_SYSTEM.md.
   =================================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/* ---------- CANON ------------------------------------------------- */

/* Playbook spacing scale. Values in the middle can appear, but each one
   should be a deliberate exception, not drift. */
const SPACING_SCALE = [4, 8, 12, 16, 20, 24, 32, 40, 80];

/* Type scale from DESIGN_SYSTEM.md §8 — `font-size / line-height`. */
const TYPE_PAIRS = [
  [24, 32], [22, 28], [20, 28], [18, 24], [16, 20],
  [14, 20], [13, 18], [13, 16], [12, 16], [11, 14], [10, 14],
];

/* Icon glyph sizes from DESIGN_SYSTEM.md §16. 14 is legacy, folded into 16
   as call sites are touched. */
const ICON_SIZES = [12, 16, 18, 22];

// A value that is deliberately off-scale is excused by an inline CSS
// comment on the same line, of the form:
//
//     padding: 5px 5px 5px 10px;   /* design-audit-ok(5): centres the 36px CTA */
//
// The parenthesised list scopes the excuse to those values only, so a
// line carrying both a deliberate value and real drift still reports the
// drift. Omit it to excuse every off-scale value on the line.
//
// The marker travels with the code, so it survives refactors and cannot
// drift out of sync the way a file:line allowlist does. Anything without
// one is drift, and the reason stays visible where the value lives.
const OK_MARKER = /design-audit-ok(?:\(([\d\s,px]*)\))?:\s*([^*]+)/;

/* ---------- SCANNER ---------------------------------------------- */

const SPACING_PROP = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?$/;

function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'fonts', '.git'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/* Blank out comments while preserving line numbers. */
const decomment = t => t.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

const cssFiles = () => walk(join(ROOT, 'src/styles'), ['.css']).sort();
const markupFiles = () => [
  join(ROOT, 'index.html'), join(ROOT, 'split.html'),
  ...walk(join(ROOT, 'src'), ['.js']),
].sort();

const rel = p => relative(ROOT, p);

/* ---------- CHECK 1 · spacing ------------------------------------ */

function checkSpacing() {
  const hits = [];
  for (const file of cssFiles()) {
    const raw = readFileSync(file, 'utf8').split('\n');
    decomment(raw.join('\n')).split('\n').forEach((line, i) => {
      /* The marker is read from the raw line — decomment() has blanked it. */
      const marker = raw[i].match(OK_MARKER);
      const scoped = marker?.[1]?.trim()
        ? marker[1].split(',').map(s => parseFloat(s)).filter(Number.isFinite)
        : null;
      const excuses = n => marker && (!scoped || scoped.includes(n));
      for (const m of line.matchAll(/(^|[;{])\s*([a-z-]+)\s*:\s*([^;{}]+)/g)) {
        const prop = m[2], value = m[3].trim();
        if (!SPACING_PROP.test(prop)) continue;
        for (const p of value.matchAll(/(-?\d*\.?\d+)px/g)) {
          const n = Math.abs(parseFloat(p[1]));
          if (n === 0 || SPACING_SCALE.includes(n)) continue;
          hits.push({
            file: rel(file), line: i + 1, prop, value, n,
            exempt: excuses(n) ? marker[2].trim() : null,
          });
        }
      }
    });
  }
  return hits;
}

/* ---------- CHECK 2 · type --------------------------------------- */

function checkType() {
  const hits = [];
  const known = new Set(TYPE_PAIRS.map(([f, l]) => `${f}/${l}`));
  for (const file of cssFiles()) {
    const text = decomment(readFileSync(file, 'utf8'));
    /* Pair a font-size with the line-height in the same rule block. */
    text.split('\n').forEach((line, i) => {
      const fs = line.match(/font-size:\s*(\d+)px/);
      if (!fs) return;
      const lh = line.match(/line-height:\s*(\d+)px/);
      const size = +fs[1];
      const lineH = lh ? +lh[1] : null;
      const pair = lineH ? `${size}/${lineH}` : null;
      if (pair && known.has(pair)) return;
      if (!lineH && TYPE_PAIRS.some(([f]) => f === size)) return;  // size ok, lh set elsewhere
      hits.push({ file: rel(file), line: i + 1, size, lineH, pair: pair || `${size}/—` });
    });
  }
  return hits;
}

/* ---------- CHECK 3 · icon --------------------------------------- */

function checkIcon() {
  const hits = [];
  for (const file of markupFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/<svg[^>]*?width="(\d+)"[^>]*?height="(\d+)"/g)) {
        const w = +m[1], h = +m[2];
        if (ICON_SIZES.includes(w) && w === h) continue;
        hits.push({ file: rel(file), line: i + 1, w, h, square: w === h });
      }
    });
  }
  return hits;
}

/* ---------- REPORT ----------------------------------------------- */

const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const strict = argv.includes('--strict');
const only = argv.find(a => !a.startsWith('-'));
const want = c => !only || only === c;

const bar = s => '\n' + '─'.repeat(64) + '\n' + s + '\n' + '─'.repeat(64);
let violations = 0;

function tally(hits, total) {
  const pct = total ? ((total - hits) / total * 100).toFixed(1) : '100.0';
  return `${hits} off-canon of ${total} (${pct}% compliant)`;
}

if (want('spacing')) {
  const hits = checkSpacing();
  const live = hits.filter(h => !h.exempt);
  const exempt = hits.filter(h => h.exempt);
  /* Total spacing px declarations, for the compliance ratio. */
  let total = 0;
  for (const file of cssFiles()) {
    decomment(readFileSync(file, 'utf8')).split('\n').forEach(line => {
      for (const m of line.matchAll(/(^|[;{])\s*([a-z-]+)\s*:\s*([^;{}]+)/g)) {
        if (!SPACING_PROP.test(m[2])) continue;
        for (const p of m[3].matchAll(/(-?\d*\.?\d+)px/g)) if (Math.abs(parseFloat(p[1])) !== 0) total++;
      }
    });
  }
  console.log(bar(`SPACING  scale ${SPACING_SCALE.join(' / ')}`));
  console.log(tally(live.length, total) + `   ·   ${exempt.length} documented exception${exempt.length === 1 ? '' : 's'}`);

  const byValue = {};
  for (const h of live) (byValue[h.n] ??= []).push(h);
  console.log('\nby value:');
  for (const [v, list] of Object.entries(byValue).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(v).padStart(5)}px  ×${String(list.length).padStart(3)}`);
  }
  if (!quiet) {
    console.log('\ndetail:');
    for (const h of live.sort((a, b) => b.n - a.n || a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${(h.file + ':' + h.line).padEnd(34)} ${h.prop}: ${h.value}`);
    }
    if (exempt.length) {
      console.log('\nexempt (verified deliberate):');
      for (const h of exempt) console.log(`  ${(h.file + ':' + h.line).padEnd(34)} ${h.exempt}`);
    }
  }
  violations += live.length;
}

if (want('type')) {
  const hits = checkType();
  console.log(bar('TYPE  font-size / line-height pairs — DESIGN_SYSTEM.md §8'));
  console.log(`canon: ${TYPE_PAIRS.map(([f, l]) => `${f}/${l}`).join('  ')}`);
  console.log(`\n${hits.length} pair${hits.length === 1 ? '' : 's'} off-canon`);
  const byPair = {};
  for (const h of hits) (byPair[h.pair] ??= []).push(h);
  for (const [pair, list] of Object.entries(byPair).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${pair.padStart(8)}  ×${String(list.length).padStart(2)}${quiet ? '' : '   ' + list.map(h => h.file + ':' + h.line).join(', ')}`);
  }
  violations += hits.length;
}

if (want('icon')) {
  const hits = checkIcon();
  console.log(bar(`ICON  inline <svg> glyph size — DESIGN_SYSTEM.md §16 (${ICON_SIZES.join(' / ')})`));
  console.log(`${hits.length} off-canon`);
  const bySize = {};
  for (const h of hits) (bySize[`${h.w}×${h.h}`] ??= []).push(h);
  const ranked = Object.entries(bySize).sort((a, b) => b[1].length - a[1].length);
  for (const [size, list] of ranked) {
    console.log(`  ${size.padStart(7)}  ×${String(list.length).padStart(2)}${quiet ? '' : '   ' + list.map(h => h.file + ':' + h.line).join(', ')}`);
  }
  /* When one undocumented size outnumbers the whole canon, the doc is the
     thing that is wrong — say so rather than reporting N defects. */
  if (ranked.length) {
    const [topSize, topList] = ranked[0];
    const canonUses = markupFiles().reduce((acc, f) => acc + [...readFileSync(f, 'utf8')
      .matchAll(/<svg[^>]*?width="(\d+)"[^>]*?height="(\d+)"/g)]
      .filter(m => ICON_SIZES.includes(+m[1]) && m[1] === m[2]).length, 0);
    if (topList.length > canonUses) {
      console.log(`\n  note: ${topSize} (×${topList.length}) outnumbers the documented ${ICON_SIZES.join('/')} (×${canonUses}).`);
      console.log('        Reconcile DESIGN_SYSTEM.md §16 with reality before treating these as defects.');
    }
  }
  violations += hits.length;
}

console.log('');
if (strict && violations) {
  console.error(`design-audit: ${violations} violation(s) — failing because --strict.`);
  process.exit(1);
}
