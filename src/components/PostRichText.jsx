import { Link } from 'react-router-dom';

// Renders the app's lightweight post-body markup — the exact format the
// composer's RichTextArea serializes: **bold**, *italic*, bullet/numbered
// lists ("- "/"1. "), links, @[username](uid) mentions, and {{c:#hex}}…{{/c}}
// colour spans. A single recursive tokenizer handles ANY nesting order
// (bold-wrapping-colour, colour-wrapping-bold, mention-inside-colour, …). The
// previous version pre-split colour spans and ran a separate ReactMarkdown per
// fragment, which orphaned a "**" whenever bold straddled a colour boundary
// (the literal "**" the founder saw in the feed) and produced loose,
// double-spaced lists. This parser has none of those seams.

const RULES = [
  { name: 'color',   re: /\{\{c:(#[0-9a-fA-F]{6})\}\}([\s\S]*?)\{\{\/c\}\}/ },
  { name: 'mention', re: /@\[([^\]]+)\]\(([^)]+)\)/ },
  { name: 'bold',    re: /\*\*([\s\S]+?)\*\*/ },
  { name: 'italic',  re: /\*([^*\n]+?)\*/ },
  { name: 'link',    re: /\[([^\]]+)\]\(([^)]+)\)/ },
];

const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*(\d+)\.\s+(.*)$/;

// A colour or bold span the user applied across multiple lines serializes as
// one wrapper containing "\n". Re-wrap it per line so the line-splitting below
// can never orphan a marker (this is what fixes bold-across-a-colour-boundary).
function reflowMultiline(text) {
  let s = text;
  s = s.replace(/\{\{c:(#[0-9a-fA-F]{6})\}\}([\s\S]*?)\{\{\/c\}\}/g,
    (_, hex, inner) => inner.split('\n').map(l => (l ? `{{c:${hex}}}${l}{{/c}}` : '')).join('\n'));
  s = s.replace(/\*\*([\s\S]+?)\*\*/g,
    (_, inner) => inner.split('\n').map(l => (l ? `**${l}**` : '')).join('\n'));
  return s;
}

// Recursively renders a single line's inline markup. Picks the earliest-
// matching rule, renders the text before it plainly, the token itself
// (recursing into its inner content), then the remainder.
function renderInline(text, key) {
  if (!text) return [];
  let best = null;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m && (best === null || m.index < best.m.index)) best = { rule, m };
  }
  if (!best) return [text];
  const { rule, m } = best;
  const before = text.slice(0, m.index);
  const rest = text.slice(m.index + m[0].length);
  const k = `${key}-${rule.name}${m.index}`;
  const out = [];
  if (before) out.push(before);
  if (rule.name === 'color') out.push(<span key={k} style={{ color: m[1] }}>{renderInline(m[2], k)}</span>);
  else if (rule.name === 'mention') out.push(<Link key={k} to={`/user/${m[2]}`} className="text-brand-violet-light font-semibold hover:underline">@{m[1]}</Link>);
  else if (rule.name === 'bold') out.push(<strong key={k}>{renderInline(m[1], k)}</strong>);
  else if (rule.name === 'italic') out.push(<em key={k}>{renderInline(m[1], k)}</em>);
  else out.push(<a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" className="link">{renderInline(m[1], k)}</a>);
  return out.concat(renderInline(rest, `${key}-a${m.index}`));
}

// Balances the custom markers so a stray one NEVER renders as literal text
// (e.g. a caption truncated mid-span, or any malformed stored post): unmatched
// {{c}} opens get a closing {{/c}}, orphan {{/c}} closes are dropped, and an
// odd trailing ** gets a partner. Runs on every render so existing posts are
// fixed with no data migration.
function sanitizeMarkers(s) {
  const re = /\{\{c:#[0-9a-fA-F]{6}\}\}|\{\{\/c\}\}/g;
  let out = '', last = 0, depth = 0, m;
  while ((m = re.exec(s))) {
    out += s.slice(last, m.index);
    if (m[0] === '{{/c}}') { if (depth > 0) { depth--; out += m[0]; } /* else drop orphan close */ }
    else { depth++; out += m[0]; }
    last = m.index + m[0].length;
  }
  out += s.slice(last);
  if (depth > 0) out += '{{/c}}'.repeat(depth);
  if (((out.match(/\*\*/g) || []).length) % 2 === 1) out += '**';
  return out;
}

// Groups lines into blocks: consecutive "- "/"1. " lines become one tight
// <ul>/<ol>; everything else is a run of lines separated by <br/>.
function renderBlocks(text) {
  const lines = reflowMultiline(sanitizeMarkers(text)).split('\n');
  const blocks = [];
  let i = 0, bk = 0;
  while (i < lines.length) {
    const isUl = UL_RE.test(lines[i]);
    const isOl = !isUl && OL_RE.test(lines[i]);
    if (isUl || isOl) {
      const ordered = isOl;
      const items = [];
      while (i < lines.length) {
        const um = lines[i].match(UL_RE);
        const om = lines[i].match(OL_RE);
        if (ordered && om) { items.push(om[2]); i++; }
        else if (!ordered && um) { items.push(um[1]); i++; }
        else break;
      }
      const Tag = ordered ? 'ol' : 'ul';
      const key = `b${bk++}`;
      blocks.push(
        <Tag key={key} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-1 space-y-0.5`}>
          {items.map((it, j) => <li key={j}>{renderInline(it, `${key}i${j}`)}</li>)}
        </Tag>
      );
    } else {
      const textLines = [];
      while (i < lines.length && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])) { textLines.push(lines[i]); i++; }
      const key = `b${bk++}`;
      const nodes = [];
      textLines.forEach((ln, j) => {
        if (j > 0) nodes.push(<br key={`${key}br${j}`} />);
        nodes.push(...renderInline(ln, `${key}l${j}`));
      });
      blocks.push(<span key={key}>{nodes}</span>);
    }
  }
  return blocks;
}

/** Renders post/comment body text with **bold**, *italic*, bullet/numbered
 * lists, links, @mentions, and the composer's {{c:#hex}}…{{/c}} colour spans.
 * Drop-in replacement for a plain `{content}` interpolation. */
export default function PostRichText({ text, className }) {
  if (!text) return null;
  return <span className={className}>{renderBlocks(text)}</span>;
}

// Truncates to `maxVisible` VISIBLE characters without ever cutting through a
// marker ({{c:…}}, {{/c}}, **, or a whole @[name](uid) mention), and closes any
// span left open by the cut. This is why "Read more" previews never leak raw
// "{{c:#7b1fff}}" or a dangling "**".
export function truncateFormatted(markup, maxVisible) {
  if (!markup) return '';
  const colorOpen = /^\{\{c:#[0-9a-fA-F]{6}\}\}/;
  const mention = /^@\[([^\]]+)\]\(([^)]+)\)/;
  let i = 0, visible = 0, depth = 0, out = '', m;
  while (i < markup.length && visible < maxVisible) {
    const rest = markup.slice(i);
    if ((m = colorOpen.exec(rest))) { out += m[0]; depth++; i += m[0].length; continue; }
    if (rest.startsWith('{{/c}}')) { out += '{{/c}}'; if (depth > 0) depth--; i += 6; continue; }
    if (rest.startsWith('**')) { out += '**'; i += 2; continue; }
    if ((m = mention.exec(rest))) { out += m[0]; visible += m[1].length + 1; i += m[0].length; continue; }
    out += markup[i];
    if (markup[i] !== '\n') visible++;
    i += 1;
  }
  if (depth > 0) out += '{{/c}}'.repeat(depth);
  if (((out.match(/\*\*/g) || []).length) % 2 === 1) out += '**';
  return out;
}

const COLOR_RE = /\{\{c:(#[0-9a-fA-F]{6})\}\}([\s\S]*?)\{\{\/c\}\}/g;
const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Plain-text fallback for non-visual contexts (share sheet titles, OS share
 * text) where the raw colour/bold/mention markup would show up as literal
 * characters. */
export function stripPostFormatting(text) {
  if (!text) return '';
  return text
    .replace(COLOR_RE, (_, __, inner) => inner)
    .replace(MENTION_RE, (_, username) => `@${username}`)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '');
}
