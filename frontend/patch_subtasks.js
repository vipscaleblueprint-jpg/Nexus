const fs = require('fs');
const path = 'c:/Codes/Nexus/frontend/src/components/board/KanbanCard.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldReturn = `  return (
    <div
      ref={setNodeRef}
      style={style}
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
                    isSubtasksExpanded 
                      ? 'rotate-90 block' 
                      : 'hidden group-hover/subtasks:block'
                  }\`} 
                />
                <span>{subtasksCount} subtask{subtasksCount > 1 ? 's' : ''}</span>
             </div>
          )}
        </CardContent>
        
        {subtasksCount > 0 && isSubtasksExpanded && (
           <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-zinc-700/50">
              {task.subtasks.map(sub => (
                 <div key={sub.id} className="flex flex-col relative before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-px before:bg-zinc-700/50 pl-1 py-1.5 first:pt-0" onClick={(e) => {
                   e.stopPropagation();
                   // In future, click on subtask card inside Kanban
                 }}>
                    {/* We inject the breadcrumb context from parent since subtasks might not have list resolved */}
                    <CardContent task={{...sub, list: task.list} as any} isSubtask={true} />
                 </div>
              ))}
           </div>
        )}
      </div>
    </div>
  );
});`;

const newReturn = `  return (
    <>
      {/* ── Parent task card ── */}
      <div
        ref={setNodeRef}
        style={style}
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

      {/* ── Subtasks: separate cards, tree-indented outside the parent ── */}
      {subtasksCount > 0 && isSubtasksExpanded && !isDragging && (
        <div className="flex mt-1.5 pl-4">
          {/* Vertical tree spine */}
          <div className="relative shrink-0 flex flex-col" style={{ width: 16 }}>
            <div className="absolute left-2 top-0 bottom-2 w-px bg-zinc-700/70" />
          </div>

          {/* Subtask mini-cards */}
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            {task.subtasks.map((sub, idx) => (
              <div key={sub.id} className="flex items-start gap-0" onClick={(e) => e.stopPropagation()}>
                {/* Elbow connector: horizontal arm */}
                <div
                  className="shrink-0 flex items-center self-start mt-3"
                  style={{ width: 12, minWidth: 12 }}
                >
                  <div className="w-full h-px bg-zinc-700/70" />
                </div>

                {/* Subtask card */}
                <div className="flex-1 min-w-0 bg-zinc-900/70 border border-zinc-800/80 rounded-lg px-2.5 py-2 hover:border-zinc-700/80 hover:bg-zinc-800/50 transition-all cursor-pointer">
                  <CardContent task={{...sub, list: task.list} as any} isSubtask={true} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
});`;

if (!content.includes('  return (\n    <div\n      ref={setNodeRef}')) {
  // Try with \r\n
  const oldCRLF = oldReturn.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF.substring(0, 100).replace(/\r\n/g, '\r\n'))) {
    console.log('Found with CRLF');
  }
}

if (content.includes(oldReturn)) {
  content = content.replace(oldReturn, newReturn);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Done!');
} else {
  // Try matching with CRLF line endings  
  const oldCRLF = oldReturn.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) {
    content = content.replace(oldCRLF, newReturn);
    fs.writeFileSync(path, content, 'utf8');
    console.log('Done with CRLF!');
  } else {
    // Find where the return starts and replace from there
    const returnStart = content.lastIndexOf('  return (');
    const funcEnd = content.lastIndexOf('\r\n});\r\n');
    if (returnStart > -1 && funcEnd > -1) {
      const before = content.substring(0, returnStart);
      content = before + newReturn + '\n';
      fs.writeFileSync(path, content, 'utf8');
      console.log('Done with index-based replacement!');
    } else {
      console.error('Could not find section to replace');
      console.log('Return start:', returnStart, 'Func end:', funcEnd);
    }
  }
}
