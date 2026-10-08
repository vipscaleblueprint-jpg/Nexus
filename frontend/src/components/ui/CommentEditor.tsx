import React from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Palette, Highlighter, Bold, Italic, Underline as UnderlineIcon, Strikethrough, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Link2 } from 'lucide-react';

const colors = [
  '#ef4444', '#f97316', '#eab308', '#3b82f6', '#6366f1', '#d946ef', '#22c55e', '#14b8a6', '#52525b', 'transparent'
];

interface CommentEditorProps {
  value: string;
  onChange: (value: string, text?: string, selectionStart?: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
  disabled?: boolean;
  onSubmit?: () => void;
}

export interface CommentEditorRef {
  insertMention: (name: string, matchLength: number, userId: string) => void;
}

export const CommentEditor = React.forwardRef<CommentEditorRef, CommentEditorProps>(({ value, onChange, placeholder = 'Write a comment...', autoFocus, id = 'default', disabled, onSubmit }, ref) => {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        protocols: ['mention'],
        HTMLAttributes: {
          class: 'text-blue-400 underline cursor-pointer',
        },
      })
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      const selectionStart = editor.state.selection.from - 1;
      onChange(editor.getHTML(), text, selectionStart);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm prose-invert focus:outline-none min-h-[40px] max-h-[400px] overflow-y-auto custom-scrollbar max-w-full pr-20'
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (onSubmit) onSubmit();
          return true;
        }
        return false;
      }
    }
  });

  React.useImperativeHandle(ref, () => ({
    insertMention: (name: string, matchLength: number, userId: string) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      // We insert a link with href mention://userId
      editor.chain().focus().deleteRange({ from: from - matchLength, to: from })
        .insertContent([
          {
            type: 'text',
            text: `@${name}`,
            marks: [{ type: 'link', attrs: { href: `mention://${userId}` } }]
          },
          { type: 'text', text: ' ' }
        ]).run();
    }
  }));

  React.useEffect(() => {
    if (editor && value === '' && editor.getHTML() !== '<p></p>') {
      editor.commands.setContent('');
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="relative w-full rounded-md border border-zinc-700/60 bg-zinc-800/60 p-3 text-sm focus-within:border-indigo-500/60 transition-colors custom-scrollbar">
      {editor && (
        <div className="absolute top-0 left-0 w-0 h-0 overflow-visible pointer-events-none">
          <div className="pointer-events-auto">
            <BubbleMenu pluginKey={`bubbleMenu-${id}`} editor={editor} tippyOptions={{ duration: 100, zIndex: 999999, placement: 'top' }} shouldShow={({ state }) => !state.selection.empty} className="flex items-center bg-popover border border-[#27272a] p-1 rounded-xl shadow-2xl mb-2 gap-0.5 text-zinc-300">
              {/* Text Color / Highlight Dropdown */}
              <div className="relative group/color">
                <button onMouseDown={e => e.preventDefault()} className="px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-1 text-sm font-medium" title="Text Color & Highlight">
                  <span className="w-5 h-5 flex items-center justify-center font-serif text-[15px] border border-zinc-600 rounded">A</span>
                </button>
                <div className="absolute bottom-full pb-2 left-0 hidden group-hover/color:flex flex-col z-[9999]" onMouseDown={e => e.preventDefault()}>
                  <div className="bg-popover border border-zinc-800 p-3 rounded-xl shadow-2xl w-[260px] flex flex-col gap-3">
                    {/* Text Colors */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-zinc-500 px-1">Text colors</span>
                      <div className="flex flex-wrap gap-1.5">
                        {colors.map((color) => (
                          <button key={`text-${color}`} onMouseDown={e => e.preventDefault()} onClick={() => color === 'transparent' ? editor.chain().focus().unsetColor().run() : editor.chain().focus().setColor(color).run()} className="w-6 h-6 flex items-center justify-center rounded transition-transform hover:scale-110" style={{ backgroundColor: color === 'transparent' ? 'transparent' : 'rgba(255,255,255,0.05)', color: color === 'transparent' ? '#a1a1aa' : color, border: color === 'transparent' ? '1px solid #3f3f46' : 'none' }}>
                            {color === 'transparent' ? <div className="w-full h-full relative"><div className="absolute inset-0 border-t-2 border-red-500/80 rotate-45 transform origin-center top-1/2 -mt-px" /></div> : <span className="font-serif text-[14px]">A</span>}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Text Highlights */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-zinc-500 px-1">Text highlights</span>
                      <div className="flex flex-wrap gap-1.5">
                        {colors.map((color) => (
                          <button key={`bg-${color}`} onMouseDown={e => e.preventDefault()} onClick={() => color === 'transparent' ? editor.chain().focus().unsetHighlight().run() : editor.chain().focus().setHighlight({ color }).run()} className="w-6 h-6 rounded-full border border-zinc-700 hover:scale-110 transition-transform shrink-0 flex items-center justify-center" style={{ backgroundColor: color === 'transparent' ? '#18181b' : color }}>
                            {color === 'transparent' && <div className="w-full h-full relative"><div className="absolute inset-0 border-t-2 border-red-500/80 rotate-45 transform origin-center top-1/2 -mt-px" /></div>}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button onMouseDown={e => e.preventDefault()} onClick={() => { editor.chain().focus().unsetColor().unsetHighlight().run(); }} className="w-full py-1.5 mt-1 rounded border border-zinc-700/50 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition-colors flex items-center justify-center gap-1.5">
                      <span className="w-3 h-3 rounded-full border border-zinc-500 flex items-center justify-center"><div className="w-full h-px bg-zinc-500 rotate-45 transform" /></span>
                      Remove color
                    </button>
                  </div>
                </div>
              </div>

              <div className="w-px h-5 bg-zinc-800 mx-1" />

              <button onClick={() => editor.chain().focus().toggleBold().run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('bold') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <Bold className="w-4 h-4" />
              </button>
              <button onClick={() => editor.chain().focus().toggleItalic().run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('italic') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <Italic className="w-4 h-4" />
              </button>
              <button onClick={() => editor.chain().focus().toggleUnderline().run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('underline') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <UnderlineIcon className="w-4 h-4" />
              </button>
              <button onClick={() => editor.chain().focus().toggleStrike().run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('strike') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <Strikethrough className="w-4 h-4" />
              </button>
              <button 
                onClick={() => {
                  const previousUrl = editor.getAttributes('link').href;
                  const url = window.prompt('URL', previousUrl);
                  
                  if (url === null) return;
                  if (url === '') {
                    editor.chain().focus().extendMarkRange('link').unsetLink().run();
                    return;
                  }
                  
                  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                }}
                className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('link') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}
              >
                <Link2 className="w-4 h-4" />
              </button>

              <div className="w-px h-5 bg-zinc-800 mx-1" />

              <button onClick={() => editor.chain().focus().setTextAlign('left').run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive({ textAlign: 'left' }) ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <AlignLeft className="w-4 h-4" />
              </button>
              <button onClick={() => editor.chain().focus().setTextAlign('center').run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive({ textAlign: 'center' }) ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <AlignCenter className="w-4 h-4" />
              </button>
            </BubbleMenu>
          </div>
        </div>
      )}
      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #52525b; /* zinc-600 */
          pointer-events: none;
          height: 0;
        }
      `}</style>
      <div><EditorContent editor={editor} /></div>
    </div>
  );
});
