const fs = require('fs');
const path = 'c:/Codes/Nexus/frontend/src/components/dashboard/WorkspaceDashboard.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldToolbar = content.slice(
  content.indexOf('\n      {/* Filter Tabs & Search Bar */}'),
  content.indexOf('\n\n      {/* ─── TAB CONTENT: ALL TASKS (OVERVIEW) ─── */}')
);

const newToolbar = `

      {/* ─── TOOLBAR ─── */}
      <div className="flex flex-col gap-3 border-b border-zinc-800/80 pb-4">

        {/* Row 1: Search bar — full width, prominent */}
        <div className="relative w-full">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search tasks, lists, statuses…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 bg-[#18181c] border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/20 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Row 2: Tabs (left) + Sort & Filter controls (right) */}
        <div className="flex items-center justify-between gap-3 flex-wrap">

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-[#18181c] p-1 rounded-lg border border-zinc-800 shrink-0">
            <button
              onClick={() => handleTabChange("all")}
              className={\`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer \${
                currentTab === "all"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }\`}
            >
              All Tasks
            </button>
            <button
              onClick={() => handleTabChange("my")}
              className={\`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer \${
                currentTab === "my"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }\`}
            >
              <span>My Tasks</span>
              {myTasks.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/30 text-[10px] text-indigo-200 font-mono font-bold">
                  {myTasks.length}
                </span>
              )}
            </button>
          </div>

          {/* Sort + Filter controls (uniform pill-selects) */}
          {currentTab === "all" && (
            <div className="flex items-center gap-2 flex-wrap">

              {/* Sort */}
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-zinc-400">
                    <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="appearance-none h-8 pl-7 pr-7 bg-[#18181c] border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-medium rounded-lg focus:outline-none focus:border-indigo-500/70 transition-all cursor-pointer"
                >
                  <option value="recent">Sort: Recent</option>
                  <option value="client">Sort: Clients (A–Z)</option>
                  <option value="priority">Sort: Priority</option>
                  <option value="status">Sort: Status</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
              </div>

              <div className="w-px h-5 bg-zinc-800 shrink-0" />

              {/* Filter: Assignee */}
              <div className="relative flex items-center">
                <UserIcon className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <select
                  value={filterAssignee}
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  className={\`appearance-none h-8 pl-7 pr-7 bg-[#18181c] border text-xs font-medium rounded-lg focus:outline-none focus:border-indigo-500/70 transition-all cursor-pointer \${
                    filterAssignee !== "all" ? "border-indigo-500/60 text-indigo-300" : "border-zinc-800 hover:border-zinc-700 text-zinc-300"
                  }\`}
                >
                  <option value="all">Assignee</option>
                  {Array.from(
                    new Map(
                      tasks
                        .flatMap((t) => [t.assignee, ...(t.assignees || [])])
                        .filter(Boolean)
                        .map((a: any) => [a.id, a])
                    ).values()
                  ).map((a: any) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
              </div>

              {/* Filter: Priority */}
              <div className="relative flex items-center">
                <Flag className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  className={\`appearance-none h-8 pl-7 pr-7 bg-[#18181c] border text-xs font-medium rounded-lg focus:outline-none focus:border-indigo-500/70 transition-all cursor-pointer \${
                    filterPriority !== "all" ? "border-indigo-500/60 text-indigo-300" : "border-zinc-800 hover:border-zinc-700 text-zinc-300"
                  }\`}
                >
                  <option value="all">Priority</option>
                  <option value="URGENT">Urgent</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
              </div>

              {/* Filter: Status */}
              <div className="relative flex items-center">
                <CheckSquare className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className={\`appearance-none h-8 pl-7 pr-7 bg-[#18181c] border text-xs font-medium rounded-lg focus:outline-none focus:border-indigo-500/70 transition-all cursor-pointer \${
                    filterStatus !== "all" ? "border-indigo-500/60 text-indigo-300" : "border-zinc-800 hover:border-zinc-700 text-zinc-300"
                  }\`}
                >
                  <option value="all">Status</option>
                  <option value="TODO">To Do</option>
                  <option value="IN PROGRESS">In Progress</option>
                  <option value="DAILY">Daily</option>
                  <option value="KYC">KYC</option>
                  <option value="PENDING">Pending</option>
                  <option value="REVIEW">Review</option>
                  <option value="COMPLETED">Completed</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
              </div>

              {/* Clear filters — only when active */}
              {(filterAssignee !== "all" || filterPriority !== "all" || filterStatus !== "all") && (
                <button
                  onClick={() => { setFilterAssignee("all"); setFilterPriority("all"); setFilterStatus("all"); }}
                  className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 text-xs font-medium hover:bg-indigo-500/25 transition-all cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
          )}

          {/* My Tasks: Recent toggle */}
          {currentTab === "my" && (
            <button
              onClick={() => setIsRecentFilter(!isRecentFilter)}
              className={\`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer \${
                isRecentFilter
                  ? "bg-indigo-600/25 border-indigo-500/70 text-indigo-300"
                  : "bg-[#18181c] border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }\`}
            >
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Recent only</span>
              {isRecentFilter && <span className="size-1.5 rounded-full bg-indigo-400" />}
            </button>
          )}
        </div>
      </div>`;

if (!oldToolbar) {
  console.error('Could not find toolbar section to replace!');
  process.exit(1);
}

console.log('Found toolbar, length:', oldToolbar.length);
content = content.replace(oldToolbar, newToolbar);
fs.writeFileSync(path, content, 'utf8');
console.log('Done! File written successfully.');
