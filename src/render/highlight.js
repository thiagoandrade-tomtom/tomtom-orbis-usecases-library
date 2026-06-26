/* Tiny, dependency-free syntax highlighter for the Quickstart "Code"
   tab. Produces the same <span class="k|s|c|n|f"> structure the panel
   already styles (see styles/detail.css). Robust for JS (the bulk of
   the authored samples) and intentionally lighter for HTML/CSS.

   Placeholders of the form {{key}} are NOT touched here — they survive
   escaping and tokenisation as literal text, and snippets.js swaps them
   for live `dd-snip-val` tokens AFTER highlighting. That ordering only
   works because none of our param keys collide with a JS keyword or a
   bare number, so the tokenisers below leave `{{…}}` alone. */

const esc = s => String(s).replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[c]));

const JS_KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function',
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'new', 'await', 'async', 'class', 'extends', 'super', 'this',
  'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'finally', 'throw',
  'delete', 'void', 'yield', 'true', 'false', 'null', 'undefined',
]);

/* Single left-to-right pass: comment | string | number | identifier.
   Anything else (punctuation, whitespace) is escaped verbatim. Handling
   comments and strings first means keywords inside them aren't recoloured. */
function highlightJS(code) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) {
      out += `<span class="c">${esc(m[1])}</span>`;
    } else if (m[2]) {
      out += `<span class="s">${esc(m[2])}</span>`;
    } else if (m[3]) {
      out += `<span class="n">${esc(m[3])}</span>`;
    } else {
      const word = m[4];
      if (JS_KEYWORDS.has(word)) {
        out += `<span class="k">${word}</span>`;
      } else if (/^\s*\(/.test(code.slice(re.lastIndex))) {
        out += `<span class="f">${esc(word)}</span>`;   // call site
      } else {
        out += esc(word);
      }
    }
    last = re.lastIndex;
  }
  out += esc(code.slice(last));
  return out;
}

/* HTML: colour comments, tag names and quoted attribute values. The
   rest is escaped plain. */
function highlightHTML(code) {
  const re = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w-]*)|("[^"]*"|'[^']*')|(&|<|>)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) {
      out += `<span class="c">${esc(m[1])}</span>`;
    } else if (m[2]) {
      // "<" / "</" punctuation escaped plain, tag name in keyword colour
      const lead = m[2].startsWith('</') ? '</' : '<';
      const name = m[2].slice(lead.length);
      out += `${esc(lead)}<span class="k">${esc(name)}</span>`;
    } else if (m[3]) {
      out += `<span class="s">${esc(m[3])}</span>`;
    } else {
      out += esc(m[4]);
    }
    last = re.lastIndex;
  }
  out += esc(code.slice(last));
  return out;
}

/* CSS: colour comments, at-rules and property names (the token right
   before a colon). Values stay plain. */
function highlightCSS(code) {
  const re = /(\/\*[\s\S]*?\*\/)|(@[\w-]+)|([\w-]+)(?=\s*:)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += `<span class="c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="k">${esc(m[2])}</span>`;
    else out += `<span class="f">${esc(m[3])}</span>`;
    last = re.lastIndex;
  }
  out += esc(code.slice(last));
  return out;
}

/** Highlight `code` for the given language, returning HTML. Unknown
    languages fall back to plain escaped text. */
export function highlight(code, lang) {
  if (lang === 'js' || lang === 'javascript') return highlightJS(code);
  if (lang === 'html') return highlightHTML(code);
  if (lang === 'css') return highlightCSS(code);
  return esc(code);
}
