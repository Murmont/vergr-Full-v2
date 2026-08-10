import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { stripPostFormatting } from '../PostRichText';

// A real WYSIWYG text box: bold/colour/lists show up styled as you apply
// them (native contentEditable + execCommand), not as raw markup you have
// to read. It's uncontrolled by design — React never writes into the DOM
// after mount, which is what avoids the classic contentEditable+React
// cursor-jump bug. The parent only ever *reads* the current content via
// onChange (fired on every input) or the imperative getMarkup(); writes go
// through the ref methods below (toggleBold, appendText, etc).
//
// On submit the live DOM is serialized into the app's lightweight post-body
// markup (**bold**, {{c:#hex}}...{{/c}}, "- "/"1. " lists) — the same format
// PostRichText already renders — so storage stays a plain string.

function colorToHex(css) {
  if (!css) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(css)) return css.toLowerCase();
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const h = (n) => Number(n).toString(16).padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

function serialize(node) {
  let out = '';
  const kids = Array.from(node.childNodes);
  kids.forEach((child, i) => {
    if (child.nodeType === Node.TEXT_NODE) { out += child.textContent; return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = child.tagName.toLowerCase();
    const inner = () => serialize(child);
    if (tag === 'br') { out += '\n'; return; }
    if (tag === 'b' || tag === 'strong') { out += `**${inner()}**`; return; }
    if (tag === 'i' || tag === 'em') { out += `*${inner()}*`; return; }
    if (tag === 'ul') { Array.from(child.children).forEach(li => { out += `- ${serialize(li)}\n`; }); return; }
    if (tag === 'ol') { Array.from(child.children).forEach((li, idx) => { out += `${idx + 1}. ${serialize(li)}\n`; }); return; }
    if (child.dataset && child.dataset.uid) { out += `@[${child.dataset.username}](${child.dataset.uid})`; return; }
    // A top-level div/p is how Chrome marks "start of a new line" on Enter —
    // the break belongs BEFORE it, not after (there's no trailing sibling to
    // hang a trailing "after" newline off of on the last line).
    if (tag === 'div' || tag === 'p') {
      if (i > 0) out += '\n';
      out += inner();
      return;
    }
    const hex = colorToHex((child.style && child.style.color) || (tag === 'font' && child.color));
    out += hex ? `{{c:${hex}}}${inner()}{{/c}}` : inner();
  });
  return out;
}

// A bare "@" (start of content, or right after whitespace) followed by zero
// or more word chars up to the caret triggers the mention dropdown — same
// heuristic every platform uses so "user@example.com" doesn't false-trigger.
const MENTION_TRIGGER_RE = /(?:^|\s)@(\w*)$/;

// ── markup → HTML (the inverse of serialize) ──────────────────────────
// Seeds the editor when EDITING an existing post: turns the stored post-body
// markup (**bold**, *italic*, {{c:#hex}}…{{/c}}, "- "/"1. " lists,
// @[username](uid) mentions) back into the exact DOM shape serialize() emits,
// so a round-trip (seed → edit → serialize) is lossless.
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const SEED_RULES = [
  { name: 'color', re: /\{\{c:(#[0-9a-fA-F]{6})\}\}([\s\S]*?)\{\{\/c\}\}/ },
  { name: 'mention', re: /@\[([^\]]+)\]\(([^)]+)\)/ },
  { name: 'bold', re: /\*\*([\s\S]+?)\*\*/ },
  { name: 'italic', re: /\*([^*\n]+?)\*/ },
];

function inlineToHtml(text) {
  if (!text) return '';
  let best = null;
  for (const rule of SEED_RULES) {
    const m = rule.re.exec(text);
    if (m && (best === null || m.index < best.m.index)) best = { rule, m };
  }
  if (!best) return escHtml(text);
  const { rule, m } = best;
  const before = escHtml(text.slice(0, m.index));
  const rest = text.slice(m.index + m[0].length);
  let mid = '';
  if (rule.name === 'color') mid = `<span style="color:${m[1]}">${inlineToHtml(m[2])}</span>`;
  else if (rule.name === 'mention') mid = `<span class="rte-mention" contenteditable="false" data-uid="${escHtml(m[2])}" data-username="${escHtml(m[1])}">@${escHtml(m[1])}</span>`;
  else if (rule.name === 'bold') mid = `<b>${inlineToHtml(m[1])}</b>`;
  else mid = `<i>${inlineToHtml(m[1])}</i>`;
  return before + mid + inlineToHtml(rest);
}

const SEED_UL = /^\s*[-*]\s+(.*)$/;
const SEED_OL = /^\s*(\d+)\.\s+(.*)$/;

function markupToHtml(markup) {
  const lines = (markup || '').split('\n');
  let html = ''; let i = 0;
  while (i < lines.length) {
    const isUl = SEED_UL.test(lines[i]);
    const isOl = !isUl && SEED_OL.test(lines[i]);
    if (isUl || isOl) {
      const ordered = isOl;
      const items = [];
      while (i < lines.length) {
        const um = lines[i].match(SEED_UL);
        const om = lines[i].match(SEED_OL);
        if (ordered && om) { items.push(om[2]); i++; }
        else if (!ordered && um) { items.push(um[1]); i++; }
        else break;
      }
      html += `<${ordered ? 'ol' : 'ul'}>` + items.map(it => `<li>${inlineToHtml(it) || '<br>'}</li>`).join('') + `</${ordered ? 'ol' : 'ul'}>`;
    } else {
      // Each non-list line is its own <div> — the shape Chrome's contentEditable
      // builds on Enter, and exactly what serialize() joins back with "\n".
      html += `<div>${inlineToHtml(lines[i]) || '<br>'}</div>`;
      i++;
    }
  }
  return html;
}

const RichTextArea = forwardRef(function RichTextArea({ compact, placeholder, maxLength = 2000, onChange, onMentionQuery }, ref) {
  const elRef = useRef(null);
  const savedRangeRef = useRef(null);
  const mentionAnchorRef = useRef(null); // { node, atOffset } of the triggering "@"

  const emit = useCallback(() => { onChange?.(elRef.current ? serialize(elRef.current) : ''); }, [onChange]);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && elRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = () => {
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (savedRangeRef.current) { sel.addRange(savedRangeRef.current); return; }
    const r = document.createRange();
    r.selectNodeContents(elRef.current);
    r.collapse(false);
    sel.addRange(r);
  };

  // Looks at the text immediately before the caret for an "@word" the user
  // is actively typing, and reports it (+ the caret's screen position) up
  // so the parent can render a floating suggestions dropdown next to it.
  const checkMentionTrigger = useCallback(() => {
    if (!onMentionQuery) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) { mentionAnchorRef.current = null; onMentionQuery(null); return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) { mentionAnchorRef.current = null; onMentionQuery(null); return; }
    const before = node.textContent.slice(0, range.startOffset);
    const m = before.match(MENTION_TRIGGER_RE);
    if (!m) { mentionAnchorRef.current = null; onMentionQuery(null); return; }
    mentionAnchorRef.current = { node, atOffset: range.startOffset - m[1].length - 1 };
    const rects = range.getClientRects();
    const rect = rects[0] || range.getBoundingClientRect();
    onMentionQuery(m[1], rect);
  }, [onMentionQuery]);

  useImperativeHandle(ref, () => ({
    focus: () => elRef.current?.focus(),
    getMarkup: () => (elRef.current ? serialize(elRef.current) : ''),
    // Seed the editor with existing post markup (edit mode). Uncontrolled by
    // design, so this is the ONE place React writes into the DOM — called once
    // when the composer opens on a post, never on subsequent keystrokes.
    setMarkup: (markup) => {
      const el = elRef.current; if (!el) return;
      el.innerHTML = markupToHtml(markup);
      emit();
    },
    saveSelection,
    insertPrefixOnce: (prefix) => {
      const el = elRef.current; if (!el) return;
      if (serialize(el).startsWith(prefix)) return;
      el.insertBefore(document.createTextNode(prefix), el.firstChild);
      emit();
    },
    appendText: (str) => {
      const el = elRef.current; if (!el) return;
      const current = serialize(el);
      const sep = (!current || /\s$/.test(current)) ? '' : ' ';
      el.appendChild(document.createTextNode(sep + str));
      emit();
      el.focus();
    },
    insertAtSaved: (str) => {
      const el = elRef.current; if (!el) return;
      el.focus();
      restoreSelection();
      document.execCommand('insertText', false, str);
      saveSelection();
      emit();
    },
    toggleBold: () => { elRef.current?.focus(); document.execCommand('bold'); emit(); },
    toggleBulletList: () => { elRef.current?.focus(); document.execCommand('insertUnorderedList'); emit(); },
    applyColor: (hex) => { elRef.current?.focus(); document.execCommand('foreColor', false, hex); emit(); },
    // Replaces the "@query" the user just typed (tracked by checkMentionTrigger)
    // with an atomic, non-editable mention chip — used by the inline "@" dropdown.
    insertMention: ({ uid, username }) => {
      const el = elRef.current; if (!el || !mentionAnchorRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const cur = sel.getRangeAt(0);
      const { node, atOffset } = mentionAnchorRef.current;
      const range = document.createRange();
      range.setStart(node, atOffset);
      range.setEnd(cur.endContainer, cur.endOffset);
      range.deleteContents();
      const chip = document.createElement('span');
      chip.className = 'rte-mention';
      chip.contentEditable = 'false';
      chip.dataset.uid = uid;
      chip.dataset.username = username;
      chip.textContent = `@${username}`;
      range.insertNode(chip);
      // Collapsing THIS range (not a freshly-built one via setStartAfter — that
      // gives a parent/child-index range which execCommand('insertText') was
      // observed to mishandle, silently dropping a space typed right after it)
      // is what keeps the caret reliably positioned right after the chip.
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, ' ');
      mentionAnchorRef.current = null;
      el.focus();
      emit();
    },
    // Inserts a mention chip at the last saved cursor position — used by the
    // toolbar "Tag players" tool, whose search box steals focus while typing.
    insertMentionAtCursor: ({ uid, username }) => {
      const el = elRef.current; if (!el) return;
      el.focus();
      restoreSelection();
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const chip = document.createElement('span');
      chip.className = 'rte-mention';
      chip.contentEditable = 'false';
      chip.dataset.uid = uid;
      chip.dataset.username = username;
      chip.textContent = `@${username}`;
      range.insertNode(chip);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, ' ');
      saveSelection();
      emit();
    },
  }), [emit, saveSelection]);

  const onSelectionEvent = () => { saveSelection(); checkMentionTrigger(); };

  return (
    <div
      ref={elRef}
      className={`rte ${compact ? 'compact' : ''}`}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={() => { emit(); checkMentionTrigger(); }}
      onKeyUp={onSelectionEvent}
      onMouseUp={onSelectionEvent}
      onBlur={() => { mentionAnchorRef.current = null; onMentionQuery?.(null); }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      onKeyDown={(e) => {
        const el = elRef.current;
        if (!el) return;
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && stripPostFormatting(serialize(el)).length >= maxLength) {
          e.preventDefault();
        }
      }}
    />
  );
});

export default RichTextArea;
