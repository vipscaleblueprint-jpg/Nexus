const fs = require('fs');
const file_path = 'c:/Codes/Nexus/frontend/src/components/dashboard/WorkspaceDashboard.tsx';
let content = fs.readFileSync(file_path, 'utf-8');

// 1. Add states
const state_insertion = `
  // All Tasks Filters & Sort
  const [sortBy, setSortBy] = useState<'recent' | 'client' | 'priority' | 'status'>('recent');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
`;
content = content.replace('const [searchQuery, setSearchQuery] = useState("");', 'const [searchQuery, setSearchQuery] = useState("");' + state_insertion);

// 2. Add filteredAllTasks and groupedAllTasksByStatus
const all_tasks_logic = `
  // All Tasks filtering and sorting
  const filteredAllTasks = useMemo(() => {
    let result = [...tasks];
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.status.toLowerCase().includes(q) ||
          t.list?.name.toLowerCase().includes(q)
      );
    }
    
    if (filterAssignee !== 'all') {
      result = result.filter((t) => 
        t.assigneeId === filterAssignee || 
        t.assignee?.id === filterAssignee || 
        t.assignees?.some(a => a.id === filterAssignee)
      );
    }
    
    if (filterPriority !== 'all') {
      result = result.filter((t) => (t.priority || 'NORMAL').toUpperCase() === filterPriority);
    }
    
    if (filterStatus !== 'all') {
      result = result.filter((t) => (t.status || 'TODO').toUpperCase() === filterStatus);
    }
    
    // Sort
    result.sort((a, b) => {
      if (sortBy === 'recent') {
        return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
      } else if (sortBy === 'client') {
        const clientA = (a.list?.name || '').toLowerCase();
        const clientB = (b.list?.name || '').toLowerCase();
        return clientA.localeCompare(clientB);
      } else if (sortBy === 'priority') {
        const pOrder = ['URGENT', 'HIGH', 'MEDIUM', 'NORMAL', 'LOW'];
        const pA = pOrder.indexOf((a.priority || 'NORMAL').toUpperCase());
        const pB = pOrder.indexOf((b.priority || 'NORMAL').toUpperCase());
        return pA - pB;
      } else if (sortBy === 'status') {
        const sA = (a.status || 'TODO').toUpperCase();
        const sB = (b.status || 'TODO').toUpperCase();
        return sA.localeCompare(sB);
      }
      return 0;
    });
    
    return result;
  }, [tasks, searchQuery, filterAssignee, filterPriority, filterStatus, sortBy]);

  const groupedAllTasksByStatus = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    const priorityOrder = [
      "IN PROGRESS", "IN_PROGRESS", "PENDING", "DAILY", "KYC", "TODO", "REVIEW", "COMPLETED", "COMPLETE"
    ];
    filteredAllTasks.forEach((t) => {
      const s = (t.status || "TODO").trim().toUpperCase();
      if (!groups[s]) groups[s] = [];
      groups[s].push(t);
    });
    const allGroupKeys = Object.keys(groups);
    if (allGroupKeys.length === 0) return [];
    allGroupKeys.sort((a, b) => {
      const idxA = priorityOrder.indexOf(a);
      const idxB = priorityOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    return allGroupKeys.map((statusKey) => ({
      status: statusKey,
      config: getStatusConfig(statusKey),
      tasks: groups[statusKey],
    }));
  }, [filteredAllTasks]);
`;
content = content.replace('// Group tasks by status (ClickUp Style!)', all_tasks_logic + '\n  // Group tasks by status (ClickUp Style!)');

// 3. Add Filter UI
const filter_ui = `
          {/* Filters for All Tasks */}
          {currentTab === "all" && (
            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-[#18181c] border border-zinc-800 text-zinc-400 text-xs rounded-md px-2 py-1.5 focus:outline-none"
              >
                <option value="recent">Sort: Recent</option>
                <option value="client">Sort: Clients(A-Z)</option>
                <option value="priority">Sort: Priority</option>
                <option value="status">Sort: Status</option>
              </select>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="bg-[#18181c] border border-zinc-800 text-zinc-400 text-xs rounded-md px-2 py-1.5 focus:outline-none"
              >
                <option value="all">Priority: All</option>
                <option value="URGENT">Urgent</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-[#18181c] border border-zinc-800 text-zinc-400 text-xs rounded-md px-2 py-1.5 focus:outline-none"
              >
                <option value="all">Status: All</option>
                <option value="TODO">To Do</option>
                <option value="IN PROGRESS">In Progress</option>
                <option value="REVIEW">Review</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
          )}
`;
content = content.replace('{/* Filter for Recent (Visible in All Tasks) */}', filter_ui + '\n          {/* Filter for Recent (Visible in All Tasks) */}');

// 4. Modify Lists and Docs to be List Items instead of Grid Cards
const lists_block = content.match(/(<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">\s*\{filteredLists\.map[\s\S]*?(?=<\/div>\s*\)\}\s*<\/div>))/);
if (lists_block) {
    let new_lists = lists_block[1].replace(
        '<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">',
        '<div className="flex flex-col gap-2">'
    ).replace(
        'className="group p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 hover:border-blue-500/50 transition-all shadow-md flex flex-col justify-between"',
        'className="group px-4 py-2.5 rounded-lg bg-[#18181c] border border-zinc-800/40 hover:bg-zinc-800/30 hover:border-blue-500/30 transition-all flex items-center justify-between"'
    ).replace(
        `<div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-blue-500/15 text-blue-400">
                            <ListIcon className="w-4 h-4" />
                          </div>
                          <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors">
                            {list.name}
                          </h3>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                      </div>

                      <p className="text-[11px] text-zinc-500 truncate">
                        {[spaceName, folderName].filter(Boolean).join(" / ") ||
                          "Workspace List"}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
                      <span>{list.tasks?.length ?? 0} tasks</span>
                      <span className="text-blue-400 group-hover:underline">
                        Open Board →
                      </span>
                    </div>`,
        `<div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-md bg-blue-500/15 text-blue-400">
                          <ListIcon className="w-3.5 h-3.5" />
                        </div>
                        <h3 className="text-sm font-medium text-zinc-200 group-hover:text-blue-400 transition-colors">
                          {list.name}
                        </h3>
                        <p className="text-[11px] text-zinc-500 truncate ml-2 hidden sm:block">
                          {[spaceName, folderName].filter(Boolean).join(" / ") || "Workspace List"}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-zinc-400">
                        <span>{list.tasks?.length ?? 0} tasks</span>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
                      </div>`
    );
    content = content.replace(lists_block[1], new_lists);
}

const docs_block = content.match(/(<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">\s*\{filteredDocs\.map[\s\S]*?(?=<\/div>\s*\)\}\s*<\/div>))/);
if (docs_block) {
    let new_docs = docs_block[1].replace(
        '<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">',
        '<div className="flex flex-col gap-2">'
    ).replace(
        'className="group p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 hover:border-purple-500/50 transition-all shadow-md flex flex-col justify-between"',
        'className="group px-4 py-2.5 rounded-lg bg-[#18181c] border border-zinc-800/40 hover:bg-zinc-800/30 hover:border-purple-500/30 transition-all flex items-center justify-between"'
    ).replace(
        `<div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-purple-500/15 text-purple-400">
                            <FileText className="w-4 h-4" />
                          </div>
                          <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-purple-400 transition-colors">
                            {doc.title}
                          </h3>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                      </div>

                      <p className="text-[11px] text-zinc-500 truncate">
                        {[spaceName, folderName].filter(Boolean).join(" / ") ||
                          "Workspace Doc"}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
                      <span>{doc.pages?.length ?? 0} pages</span>
                      <span className="text-purple-400 group-hover:underline">
                        View Document →
                      </span>
                    </div>`,
        `<div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-md bg-purple-500/15 text-purple-400">
                          <FileText className="w-3.5 h-3.5" />
                        </div>
                        <h3 className="text-sm font-medium text-zinc-200 group-hover:text-purple-400 transition-colors">
                          {doc.title}
                        </h3>
                        <p className="text-[11px] text-zinc-500 truncate ml-2 hidden sm:block">
                          {[spaceName, folderName].filter(Boolean).join(" / ") || "Workspace Doc"}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-zinc-400">
                        <span>{doc.pages?.length ?? 0} pages</span>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all" />
                      </div>`
    );
    content = content.replace(docs_block[1], new_docs);
}

// 5. Add ALL TASKS section below docs
const all_tasks_render = `
          {/* Tasks Overview */}
          <div className="space-y-4 pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-indigo-400" />
                <h2 className="text-base font-semibold text-zinc-200">
                  Workspace Tasks ({filteredAllTasks.length})
                </h2>
              </div>
            </div>
            
            <div className="space-y-6">
              {groupedAllTasksByStatus.map(({ status, config, tasks: groupTasks }) => (
                <div key={status} className="space-y-0.5">
                  <div className="flex items-center justify-between px-1 pb-2">
                    <div className="flex items-center gap-2">
                      <span className={\`text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider \${config.pill} shadow-sm flex items-center gap-1\`}>
                        {config.label}
                        <ChevronDown className="w-3 h-3 opacity-70" />
                      </span>
                      <span className="text-xs font-semibold text-zinc-500 ml-1">{groupTasks.length}</span>
                    </div>
                  </div>

                  <div className="hidden sm:flex items-center justify-between text-[11px] font-medium text-zinc-500 px-1 pb-1.5 border-b border-zinc-800/60 w-full">
                     <span className="w-1/2 text-left pl-8">Name</span>
                     <div className="flex items-center gap-8 pr-10">
                        <span className="w-24 text-left">Client / List</span>
                        <span className="w-20 text-left">Priority</span>
                     </div>
                  </div>

                  <div className="flex flex-col w-full">
                    {groupTasks.map((task) => {
                      const priorityConfig = task.priority && PRIORITY_FLAGS[task.priority] ? PRIORITY_FLAGS[task.priority] : { label: task.priority || 'Normal', color: 'text-zinc-500', iconColor: 'text-zinc-500' };
                      return (
                        <div
                          key={task.id}
                          onClick={() => setSelectedTask(task)}
                          className="group relative flex items-center justify-between px-1 py-1.5 hover:bg-zinc-800/30 border-b border-zinc-800/40 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1 pl-1 pr-4">
                            <div className="w-3.5 h-3.5 rounded-[3px] border border-zinc-600 shrink-0 flex items-center justify-center transition-colors shadow-sm" />
                            <span className="text-[13px] font-medium text-zinc-200 truncate">{task.title}</span>
                          </div>
                          <div className="hidden sm:flex items-center gap-8 pr-10 shrink-0">
                            <span className="w-24 text-[11px] text-zinc-400 truncate">{task.list?.name || 'Workspace'}</span>
                            <div className="w-20 flex items-center gap-1.5">
                              <Flag className={\`w-3 h-3 \${priorityConfig.iconColor}\`} />
                              <span className={\`text-[11px] font-medium \${priorityConfig.color}\`}>{priorityConfig.label}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
`;
content = content.replace('        </>\n      )}', all_tasks_render + '\n        </>\n      )}');

fs.writeFileSync(file_path, content, 'utf-8');
console.log('Updated WorkspaceDashboard.tsx successfully.');
