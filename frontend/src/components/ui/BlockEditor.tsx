import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TaskMention } from '../editor/extensions/TaskMention';
import { LiveKanbanBlock } from '../editor/extensions/LiveKanbanBlock';
import { taskSuggestion } from '../editor/suggestions/taskSuggestion';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Palette, X, CheckSquare
} from 'lucide-react';
import { useEffect, useRef } from 'react';

interface BlockEditorProps {
  content: string;
  onChange: (content: string) => void;
  onBlur: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  autoFocus?: boolean;
  editable?: boolean;
}

export function BlockEditor({ content, onChange, onBlur, onKeyDown, autoFocus, editable = true }: BlockEditorProps) {
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TaskMention.configure({
        suggestion: taskSuggestion,
      }),
      LiveKanbanBlock,
    ],
    content: content || '',
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    onBlur: ({ event }) => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      blurTimeoutRef.current = setTimeout(() => {
        onBlur();
      }, 150);
    },
    onFocus: () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[24px] text-sm text-zinc-100 prose-p:my-0 prose-headings:my-0 prose-ul:my-0 prose-ol:my-0 m-0 p-0',
      },
    },
  });

  const handleKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      const html = editor?.getHTML();
      if (html === '<p></p>' || html === '<p><br></p>') {
        e.preventDefault();
        e.stopPropagation();
        if (onKeyDown) onKeyDown(e);
      }
    }
  };

  useEffect(() => {
    if (editor && autoFocus && !editor.isFocused) {
      setTimeout(() => {
        editor.commands.focus('end');
      }, 10);
    }
  }, [editor, autoFocus]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (editor && content !== undefined && content !== null) {
      if (!editor.isFocused) {
        if (editor.getHTML() !== content) {
          editor.commands.setContent(content, false);
        }
      }
    }
  }, [editor, content]);

  useEffect(() => {
    if (!editor) return;

    const STATUS_COLORS: Record<string, string> = {
      'KYC': '#06b6d4',
      'Pin Board': '#06b6d4',
      'Daily': '#a855f7',
      'Weekly': '#a855f7',
      'Monthly': '#a855f7',
      'Pending': '#6366f1',
      'In Progress': '#eab308',
      'Revision': '#6366f1',
      'Waiting': '#f97316',
      'In Review': '#6366f1',
      'Checking': '#6366f1',
      'On-Hold': '#ef4444',
      'Closed': '#10b981',
    };
    const getStatusColor = (status: string) => STATUS_COLORS[status] || '#3b82f6';

    const handleTaskUpdated = (e: any) => {
      const task = e.detail?.task;
      if (!task) return;

      const { state, view } = editor;
      const { tr } = state;
      let modified = false;

      state.doc.descendants((node, pos) => {
        if (node.type.name === 'mention' && node.attrs.id === task.id) {
          tr.setNodeMarkup(pos, null, {
            ...node.attrs,
            label: task.title,
            taskStatus: JSON.stringify({ name: task.status, color: getStatusColor(task.status) }),
            taskAssignees: JSON.stringify(task.assignees || []),
            taskPriority: task.priority || '',
            taskDueDate: task.dueDate || ''
          });
          modified = true;
        }
      });

      if (modified) {
        view.dispatch(tr);
      }
    };

    const handleTaskDeleted = (e: any) => {
      const id = e.detail?.id;
      if (!id) return;

      const { state, view } = editor;
      const { tr } = state;
      let modified = false;

      const positions: number[] = [];
      const nodeSizes: number[] = [];
      
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'mention' && node.attrs.id === id) {
          positions.push(pos);
          nodeSizes.push(node.nodeSize);
        }
      });

      for (let i = positions.length - 1; i >= 0; i--) {
        tr.delete(positions[i], positions[i] + nodeSizes[i]);
        modified = true;
      }

      if (modified) {
        view.dispatch(tr);
      }
    };

    window.addEventListener('task:updated', handleTaskUpdated);

    return () => {
      window.removeEventListener('task:updated', handleTaskUpdated);
    };
  }, [editor]);

  if (!editor) {
    return <div className="flex-1 min-w-0 min-h-[24px]" />;
  }

  const colors = [
    '#ffffff', '#94a3b8',
    '#ef4444', '#f97316',
    '#f59e0b', '#84cc16',
    '#22c55e', '#14b8a6',
    '#06b6d4', '#3b82f6',
    '#6366f1', '#8b5cf6',
    '#d946ef', '#f43f5e',
  ];

  return (
    <div className="w-full">
      <div className="absolute top-0 left-0 w-0 h-0 overflow-visible pointer-events-none">
        <div className="pointer-events-auto">
          <BubbleMenu editor={editor} tippyOptions={{ duration: 100, maxWidth: 'none', zIndex: 99999 }} className="flex flex-wrap items-center gap-0.5 bg-[#1a1a1a] p-1 rounded-lg border border-zinc-700 shadow-2xl z-[99999]">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('bold') ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('italic') ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Italic"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('underline') ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Underline"
        >
          <UnderlineIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('strike') ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Strikethrough"
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </button>
        
        <div className="w-px h-4 bg-zinc-700 mx-1" />
        
        <button
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive({ textAlign: 'left' }) ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Align Left"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive({ textAlign: 'center' }) ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Align Center"
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive({ textAlign: 'right' }) ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Align Right"
        >
          <AlignRight className="w-3.5 h-3.5" />
        </button>
        
        <div className="w-px h-4 bg-zinc-700 mx-1" />
        
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('bulletList') ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Bullet List"
        >
          <List className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('orderedList') ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Numbered List"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('taskList') ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300'}`}
          title="Task List"
        >
          <CheckSquare className="w-3.5 h-3.5" />
        </button>
        
        <div className="w-px h-4 bg-zinc-700 mx-1" />
        
        <div className="relative group/color">
          <button className="p-1.5 rounded hover:bg-zinc-800 transition-colors text-zinc-300 flex items-center gap-1" title="Text Color">
            <Palette className="w-3.5 h-3.5" />
          </button>
          
          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover/color:flex bg-[#1a1a1a] border border-zinc-700 p-2 rounded-lg shadow-xl gap-1.5 z-[99999] w-max max-w-[160px] flex-wrap justify-center">
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => editor.chain().focus().setColor(color).run()}
                className="w-4 h-4 rounded-full border border-zinc-700 hover:scale-125 transition-transform cursor-pointer shadow-sm"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
            <button
               onClick={() => editor.chain().focus().unsetColor().run()}
               className="w-4 h-4 rounded-full border border-zinc-700 bg-transparent flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
               title="Remove Color"
            >
               <X className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      </BubbleMenu>
        </div>
      </div>
      
      <div 
        className="flex-1 min-w-0" 
        onMouseDown={(e) => {
          if (!editor.isFocused) {
            editor.commands.focus();
          }
        }}
        onKeyDownCapture={handleKeyDownCapture}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
