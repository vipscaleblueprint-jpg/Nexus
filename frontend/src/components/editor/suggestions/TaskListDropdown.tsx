import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Circle } from 'lucide-react';

export const TaskListDropdown = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      if (item.type === 'liveblock') {
        let assigneeName = '';
        try {
          const { editor } = props;
          const $from = editor.state.selection.$from;
          for (let i = $from.depth; i > 0; i--) {
            const node = $from.node(i);
            if (node.type.name === 'heading') {
              assigneeName = node.textContent;
              break;
            }
          }
          if (!assigneeName) {
            let pos = $from.before();
            while (pos > 0) {
              const node = editor.state.doc.nodeAt(pos);
              if (node && node.type.name === 'heading') {
                assigneeName = node.textContent;
                break;
              }
              pos--;
            }
          }
        } catch(e) {}

        props.editor.chain().focus().deleteRange(props.range).insertContent({
          type: 'liveKanbanBlock',
          attrs: {
            blockType: item.blockType,
            assigneeName: assigneeName || '',
          }
        }).run();
      } else {
        props.command({
          id: item.id,
          label: item.name || item.title || 'Untitled',
          mentionType: item.type, // 'task' or 'status'
          taskStatus: item.type === 'status' ? JSON.stringify(item.status) : (item.status || ''),
          tasks: item.type === 'status' ? JSON.stringify(item.tasks || []) : '',
          taskAssignees: item.type === 'task' ? JSON.stringify(item.assignees || []) : '',
          taskPriority: item.type === 'task' ? (item.priority || '') : '',
          taskDueDate: item.type === 'task' ? (item.dueDate || '') : '',
        });
      }
    }
  };

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: any) => {
      if (event.key === 'ArrowUp') {
        upHandler();
        return true;
      }
      if (event.key === 'ArrowDown') {
        downHandler();
        return true;
      }
      if (event.key === 'Enter') {
        enterHandler();
        return true;
      }
      return false;
    },
  }));

  if (!props.items || props.items.length === 0) {
    return (
      <div className="bg-white dark:bg-[#1a1a1a] border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden p-2 text-sm text-zinc-500">
        No suggestions found
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#1a1a1a] border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden w-[320px] max-h-[300px] overflow-y-auto z-[99999] flex flex-col custom-scrollbar">
      <div className="p-1">
        {props.items.map((item: any, index: number) => (
          <button
            className={`w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ${
              index === selectedIndex
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
            }`}
            key={index}
            onClick={() => selectItem(index)}
          >
            {item.type === 'status' ? (
              <>
                <span 
                  className="px-1.5 py-[1px] rounded text-[9px] font-bold uppercase tracking-wide shrink-0"
                  style={{ backgroundColor: item.status?.color || '#3b82f6', color: '#fff' }}
                >
                  {item.name}
                </span>
                <span className="truncate flex-1 text-zinc-500 italic text-xs">Kanban Column</span>
                <span className="text-xs text-zinc-500">{item.tasks?.length || 0} tasks</span>
              </>
            ) : item.type === 'liveblock' ? (
              <>
                <span className="text-base shrink-0">{item.blockType === 'newtasks' ? '🆕' : '📊'}</span>
                <span className="truncate flex-1 font-bold text-blue-500">{item.name}</span>
                <span className="text-xs text-zinc-500 italic shrink-0 bg-blue-500/10 px-1.5 py-0.5 rounded text-blue-400">Live Sync</span>
              </>
            ) : (
              <>
                <Circle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="truncate flex-1">{item.name || item.title || 'Untitled'}</span>
                {item.status && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 shrink-0">
                    {item.status}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
});
