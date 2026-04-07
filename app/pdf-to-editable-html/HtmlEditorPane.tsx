'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface HtmlEditorPaneProps {
  content: string;
  onChange: (html: string) => void;
  containerHeight?: string;
}

export default function HtmlEditorPane({
  content,
  onChange,
  containerHeight = 'h-[65vh]',
}: HtmlEditorPaneProps): React.JSX.Element {
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    editorProps: {
      attributes: {
        class:
          'prose prose-slate max-w-none flex-1 rounded-lg border border-slate-200 bg-white p-4 focus:outline-none overflow-auto',
      },
    },
    content,
    onUpdate: ({ editor: editorInstance }) => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }

      updateTimeoutRef.current = setTimeout(() => {
        onChange(editorInstance.getHTML());
      }, 300);
    },
  });

  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const current = editor.getHTML();
    if (current !== content) {
      editor.commands.setContent(content, {
        emitUpdate: false,
      });
    }
  }, [content, editor]);

  if (!editor) {
    return (
      <div className={`flex ${containerHeight === 'h-[65vh]' ? containerHeight : 'flex-1'} items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500`}>
        Initializing editor...
      </div>
    );
  }

  const toolbarButtonClass = 'h-8 px-3';

  return (
    <div className={`${containerHeight === 'h-full' ? 'flex flex-col h-full' : containerHeight + ' flex flex-col'} gap-3 overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <Button
          type="button"
          variant={editor.isActive('bold') ? 'default' : 'secondary'}
          size="sm"
          className={toolbarButtonClass}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </Button>
        <Button
          type="button"
          variant={editor.isActive('italic') ? 'default' : 'secondary'}
          size="sm"
          className={toolbarButtonClass}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </Button>
        <Button
          type="button"
          variant={editor.isActive('underline') ? 'default' : 'secondary'}
          size="sm"
          className={toolbarButtonClass}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          Underline
        </Button>
        <Button
          type="button"
          variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'secondary'}
          size="sm"
          className={toolbarButtonClass}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </Button>
        <Button
          type="button"
          variant={editor.isActive('bulletList') ? 'default' : 'secondary'}
          size="sm"
          className={toolbarButtonClass}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          Bullets
        </Button>
        <Button
          type="button"
          variant={editor.isActive('orderedList') ? 'default' : 'secondary'}
          size="sm"
          className={toolbarButtonClass}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          Numbered
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(toolbarButtonClass, 'ml-auto')}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          Clear formatting
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
