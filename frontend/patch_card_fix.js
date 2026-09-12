const fs = require('fs');
const path = 'c:/Codes/Nexus/frontend/src/components/board/KanbanCard.tsx';
let content = fs.readFileSync(path, 'utf8');

// Find and replace the entire return block
const startMarker = '  return (\n    <>\n      {/* ── Parent task card ── */}';
const endMarker = '    </>\n  );\n});\r\n';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker) + endMarker.length;

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found. startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}

const before = content.substring(0, startIdx);
const after = content.substring(endIdx);

const newReturn = `  return (
    // Outer wrapper owns the DnD ref+style so dnd-kit tracks a single stable DOM node.
    // Card visuals and subtasks are children — prevents the infinite loop that occurs
    // when a Fragment is used as the root of a useSortable component.
    <div ref={setNodeRef} style={style} className="relative">
      {/* ── Visible card ── */}
      <div
        {...attributes}
        {...listeners}
        onPointerDown={(e) => {
          pointerPosRef.current = { x: e.clientX, y: e.clientY };
          if (listeners?.onPointerDown) {
            listeners.onPointerDown(e as any);
          }
        }}
        onClick={(e) => {
          if (!pointerPosRef.current) return;
          const dx = Math.abs(e.clientX - pointerPosRef.current.x);
          const dy = Math.abs(e.clientY - pointerPosRef.current.y);
          if (dx < 5 && dy < 5 && onClick) {
            onClick(task);
          }
          pointerPosRef.current = null;
        }}
        className={isDragging
          ? "bg-zinc-800/60 rounded-xl p-3.5 border border-transparent shadow-none flex flex-col gap-3"
          : \`bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 rounded-xl p-3.5 group relative shadow-sm flex flex-col transition-all duration-300 ease-out hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20 \${
            isMoveDisabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
          } \${
            isOverlay ? 'rotate-2 scale-105 shadow-xl shadow-black/40 cursor-grabbing' : ''
          } \${hasOpenDropdown ? 'z-50' : 'z-10'}\`}
      >
        <div className={isDragging ? 'opacity-0 pointer-events-none flex flex-col gap-3 w-full h-full' : 'contents'}>
          <CardContent task={task} listStatuses={listStatuses} onDropdownOpenChange={setHasOpenDropdown}>
            {subtasksCount > 0 && (
              <div
                className="flex items-center gap-2 text-[11px] text-zinc-400 hover:bg-zinc-700/50 -mx-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors group/subtasks"
                onClick={(e) => { e.stopPropagation(); setIsSubtasksExpanded(!isSubtasksExpanded); }}
              >
                {!isSubtasksExpanded && (
                  <CornerDownRight className="w-3.5 h-3.5 block group-hover/subtasks:hidden shrink-0" />
                )}
                <ChevronRight
                  className={\`w-3.5 h-3.5 shrink-0 transition-transform duration-200 \${
                    isSubtasksExpanded ? 'rotate-90 block' : 'hidden group-hover/subtasks:block'
                  }\`}
                />
                <span>{subtasksCount} subtask{subtasksCount > 1 ? 's' : ''}</span>
              </div>
            )}
          </CardContent>
        </div>
      </div>

      {/* ── Subtasks: tree-indented, outside the draggable card ── */}
      {subtasksCount > 0 && isSubtasksExpanded && !isDragging && (
        <div className="mt-1 ml-3">
          {task.subtasks.map((sub, idx) => {
            const isLast = idx === task.subtasks.length - 1;
            return (
              <div key={sub.id} className="relative flex items-start" onClick={(e) => e.stopPropagation()}>
                {/* Vertical line — stops at elbow midpoint on last item */}
                <div
                  className="absolute left-0 w-px bg-zinc-700/50"
                  style={{ top: 0, bottom: isLast ? '50%' : 0 }}
                />
                {/* Horizontal elbow */}
                <div
                  className="absolute left-0 h-px bg-zinc-700/50"
                  style={{ top: '1.25rem', width: 10 }}
                />
                {/* Subtask card */}
                <div className="flex-1 min-w-0 ml-3 mb-1.5 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-2.5 py-2 hover:border-zinc-600 hover:bg-zinc-800 transition-all cursor-pointer">
                  <CardContent task={{...sub, list: task.list} as any} isSubtask={true} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
`;

content = before + newReturn + after;
fs.writeFileSync(path, content, 'utf8');
console.log('Done!');
