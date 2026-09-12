import fs from 'fs';

const filepath = 'c:/Codes/Nexus/frontend/src/components/layout/Sidebar.tsx';
let content = fs.readFileSync(filepath, 'utf-8');

const components = `
function SortableWrapper({ id, children, disabled = false }: { id: string; children: React.ReactNode; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={isDragging ? "relative z-50" : ""}>
      {children}
    </div>
  );
}

function ActiveDragItem({ id, spaces }: { id: string; spaces: Space[] }) {
  const parentType = id.split('-')[0];
  const parentId = id.split('-')[1];
  const itemType = id.split('-')[2];
  const itemId = id.split('-')[3];

  let item: any = null;
  if (parentType === 'space') {
    const space = spaces.find(s => s.id === parentId);
    if (space) {
      if (itemType === 'folder') item = space.folders?.find(f => f.id === itemId);
      if (itemType === 'list') item = space.lists?.find(l => l.id === itemId);
      if (itemType === 'doc') item = space.docs?.find(d => d.id === itemId);
    }
  } else if (parentType === 'folder') {
     for (const s of spaces) {
       const findFolder = (folders: any[]) => {
         for (const f of folders) {
           if (f.id === parentId) return f;
           if (f.subfolders) {
             const found: any = findFolder(f.subfolders);
             if (found) return found;
           }
         }
         return null;
       };
       const found = findFolder(s.folders || []);
       if (found) {
          if (itemType === 'folder') item = found.subfolders?.find((f: any) => f.id === itemId);
          if (itemType === 'list') item = found.lists?.find((l: any) => l.id === itemId);
          if (itemType === 'doc') item = found.docs?.find((d: any) => d.id === itemId);
          break;
       }
     }
  }

  if (!item) return null;

  return (
    <div className="bg-[hsl(240,3.7%,15.9%)] rounded-md shadow-lg border border-[hsl(240,3.7%,25.9%)] opacity-90 scale-105 cursor-grabbing pointer-events-none">
      {itemType === 'folder' && (
        <div className="flex items-center gap-2 px-2 py-1 text-sm">
          <FolderIcon className="size-3.5 text-amber-400 shrink-0" />
          <span className="truncate text-xs text-[hsl(240,4.8%,95.9%)]">{item.name}</span>
        </div>
      )}
      {itemType === 'list' && (
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-[hsl(240,4.8%,95.9%)]">
          <ListIcon className="size-3.5 text-blue-400 shrink-0" />
          <span className="truncate">{item.name}</span>
        </div>
      )}
      {itemType === 'doc' && (
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-[hsl(240,4.8%,95.9%)]">
          <FileText className="size-3.5 text-purple-400 shrink-0" />
          <span className="truncate">{item.title}</span>
        </div>
      )}
    </div>
  );
}
`;

if (!content.includes('function SortableWrapper')) {
  content += components;
}

if (!content.includes('<DndContext')) {
  content = content.replace(
    'return (\n    <div className="flex h-screen shrink-0 z-20">',
    'return (\n    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>\n    <div className="flex h-screen shrink-0 z-20">'
  );
  
  content = content.replace(
    '</ConfirmDeleteModal>\n    </div>\n  );\n}',
    '</ConfirmDeleteModal>\n      <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }) }}>\n        {activeId ? <ActiveDragItem id={activeId} spaces={spaces} /> : null}\n      </DragOverlay>\n    </div>\n    </DndContext>\n  );\n}'
  );
}

fs.writeFileSync(filepath, content, 'utf-8');
console.log('Done!');
