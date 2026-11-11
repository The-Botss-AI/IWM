'use client';

import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type FormEvent,
} from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { normalizeLinkHref, SAFE_URI } from '@/lib/forms/link';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

type ToolButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  label: string;
  active: boolean;
  onClick?: () => void;
  icon: ComponentType<{ className?: string }>;
};

const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { label, active, onClick, icon: Icon, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      {...rest}
      className={cn(
        'text-ink-muted hover:bg-bg-subtle hover:text-ink flex h-11 w-11 items-center justify-center rounded disabled:opacity-50 sm:h-8 sm:w-8',
        active && 'bg-brand-50 text-brand-purple',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
});

const EDITOR_CLASS =
  'min-h-32 px-3.5 py-2.5 text-sm text-ink focus:outline-none [&_a]:text-brand-purple [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5';

/**
 * Small Tiptap editor limited to the nodes and marks the server accepts
 * (RICH_NODES / RICH_MARKS in @botss/forms). Value is `getJSON()`.
 */
export function RichTextField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'rich_text'>) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !ctx.disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        horizontalRule: false,
        // Underline and Link are added below with their own options.
        underline: false,
        link: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ['mailto'],
        isAllowedUri: (url) => SAFE_URI.test(url),
      }),
    ],
    content: value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined,
    editorProps: {
      attributes: {
        id: inputId,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': field.label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': 'true' } : {}),
        class: EDITOR_CLASS,
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.isEmpty ? undefined : ed.getJSON());
    },
  });

  useEffect(() => {
    editor?.setEditable(!ctx.disabled);
  }, [editor, ctx.disabled]);

  // The attributes are read once at creation; keep the described-by ids and
  // the invalid state current as help text and errors come and go.
  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        attributes: {
          id: inputId,
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': field.label,
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          ...(error ? { 'aria-invalid': 'true' } : {}),
          class: EDITOR_CLASS,
        },
      },
    });
  }, [editor, inputId, field.label, describedBy, error]);

  if (!editor) return <div className="border-line bg-bg-subtle h-40 rounded-md border" />;

  function onLinkOpenChange(next: boolean) {
    setLinkOpen(next);
    if (next && editor) {
      setHref((editor.getAttributes('link').href as string | undefined) ?? '');
      setLinkError(null);
    }
  }

  function applyLink(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    const check = normalizeLinkHref(href);
    if (!check.ok) {
      setLinkError(check.error);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: check.href }).run();
    setLinkOpen(false);
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  }

  const off = ctx.disabled;
  return (
    <div
      className={cn(
        'focus-within:border-brand-purple focus-within:shadow-focus rounded-md border bg-white',
        error ? 'border-state-error' : 'border-line',
      )}
    >
      <div
        className="border-line flex flex-wrap gap-0.5 border-b p-1"
        role="toolbar"
        aria-label="Formatting"
      >
        <ToolButton
          label="Bold"
          icon={Bold}
          disabled={off}
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolButton
          label="Italic"
          icon={Italic}
          disabled={off}
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolButton
          label="Underline"
          icon={UnderlineIcon}
          disabled={off}
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolButton
          label="Bullet list"
          icon={List}
          disabled={off}
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolButton
          label="Numbered list"
          icon={ListOrdered}
          disabled={off}
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <Popover open={linkOpen} onOpenChange={onLinkOpenChange}>
          <PopoverTrigger asChild>
            <ToolButton
              label="Link"
              icon={LinkIcon}
              disabled={off}
              active={editor.isActive('link')}
            />
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-2 p-3">
            <form onSubmit={applyLink} className="space-y-2">
              <Input
                autoFocus
                type="text"
                inputMode="url"
                aria-label="Link address"
                placeholder="https://example.com"
                value={href}
                aria-invalid={linkError ? true : undefined}
                onChange={(e) => {
                  setHref(e.target.value);
                  setLinkError(null);
                }}
              />
              {linkError ? (
                <p role="alert" className="text-state-error text-xs font-medium">
                  {linkError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                {editor.isActive('link') ? (
                  <Button type="button" variant="outline" size="sm" onClick={removeLink}>
                    Remove link
                  </Button>
                ) : null}
                <Button type="submit" size="sm">
                  Apply
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
