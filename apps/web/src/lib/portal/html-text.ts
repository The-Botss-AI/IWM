/**
 * Plain-text view of serialized HTML, by a single linear scan: everything
 * from a '<' to the next '>' is dropped (an unterminated tag drops the rest),
 * so no '<' can survive in the result. No regex, so nothing to backtrack on,
 * and no multi-pass stripping that a nested payload such as '<scr<script>ipt>'
 * could reassemble. The result is only ever inspected (is there any text?),
 * never rendered; the HTML itself comes from the Tiptap serializer, which
 * emits schema-permitted nodes only.
 */
export function stripTags(html: string): string {
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (inTag) {
      if (ch === '>') inTag = false;
    } else if (ch === '<') {
      inTag = true;
    } else {
      out += ch;
    }
  }
  return out;
}

/** True when the HTML has any non-whitespace text outside its tags. */
export function htmlHasText(html: string): boolean {
  return stripTags(html).trim() !== '';
}
