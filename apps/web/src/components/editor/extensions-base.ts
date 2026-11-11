/**
 * Tiptap extension set used for SERVER-SIDE rendering (`generateHTML`) by the
 * public reader. Anything that depends on the browser (React node views, paste
 * handlers, slash-menu UI) is added separately inside `editor.tsx` for the
 * editable client. Keeping both lists in sync is essential - diverging schemas
 * would corrupt round-tripped content.
 */
import { Blockquote } from '@tiptap/extension-blockquote';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Typography } from '@tiptap/extension-typography';
import { Underline } from '@tiptap/extension-underline';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';

import { Callout } from './extensions/callout';
import { DateChip } from './extensions/date-chip';
import { Mention } from './extensions/mention';
import { ToggleBlock, ToggleBody, ToggleSummary } from './extensions/toggle-block';

// A curated set instead of lowlight's `common` (~37 grammars): these cover what
// the team actually pastes, and keep the editor chunk lean. Aliases (js, ts,
// sh, html, yml, md) come from each grammar's own definition.
const lowlight = createLowlight({
  bash,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  sql,
  typescript,
  xml,
  yaml,
});

interface BaseExtensionsOptions {
  placeholder?: string;
  /**
   * Whether to include the plain `Image` extension. The editable client passes
   * `false` and registers `CustomImage` (a React node view subclass) instead,
   * so we don't end up with two image schemas competing for the same node name.
   */
  includeImage?: boolean;
}

export function baseExtensions(options: BaseExtensionsOptions = {}) {
  const { placeholder, includeImage = true } = options;
  return [
    StarterKit.configure({
      // CodeBlockLowlight and Blockquote are configured explicitly below.
      codeBlock: false,
      blockquote: false,
      heading: { levels: [1, 2, 3] },
      // v3 StarterKit bundles Link and Underline; they are registered
      // explicitly below (custom config), so disable the bundled copies to
      // avoid duplicates. TrailingNode is off to keep v2 behaviour.
      link: false,
      underline: false,
      trailingNode: false,
    }),
    Underline,
    Link.configure({
      // Surface clicks as navigation hints, not auto-followed by the editor.
      openOnClick: false,
      autolink: true,
      // Explicit scheme allowlist so a stored `javascript:`/`data:` href can
      // never survive into the public reader's generateHTML output, instead of
      // relying on Tiptap's implicit default sanitization.
      protocols: ['http', 'https', 'mailto', 'tel'],
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    // v3 Image renders width/height, and stored docs keep width as a percentage,
    // so rendering it would make images N pixels wide.
    ...(includeImage
      ? [
          Image.extend({
            addAttributes() {
              return {
                ...this.parent?.(),
                width: { default: null, rendered: false },
                height: { default: null, rendered: false },
              };
            },
          }).configure({ inline: false, allowBase64: false }),
        ]
      : []),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({
      lowlight,
      exitOnTripleEnter: false,
      exitOnArrowDown: false,
    }),
    Blockquote,
    CharacterCount,
    Typography,
    Placeholder.configure({
      placeholder: placeholder ?? 'Type "/" for commands or start writing…',
    }),
    // Advanced block extensions. KaTeX (math), iframe embeds and a code block
    // with a copy button are not included yet because they need new deps
    // (`katex`, the `@tiptap/extension-mention` suggestion driver, etc).
    Callout,
    ToggleBlock,
    ToggleSummary,
    ToggleBody,
    DateChip,
    Mention,
  ];
}
