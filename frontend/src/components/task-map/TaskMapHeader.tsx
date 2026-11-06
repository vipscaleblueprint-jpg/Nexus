import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { TaskMapShift, UpworkSession } from '@/api/taskMap';
import { Users, Building2, ChevronDown, Check, Search, ShieldCheck, Kanban, UserCheck } from 'lucide-react';

export interface ClientOption {
  id: string;
  name: string;
  count: number;
}

interface Props {
  currentDate: string;
  currentShift: string;
  onShiftChange: (shift: string) => void;
  shifts?: TaskMapShift[];
  search: string;
  onSearchChange: (search: string) => void;
  activeUpworkSessions?: UpworkSession[];
  currentView?: 'BOARD' | 'AUDITING' | 'CRM' | 'UPWORK';
  onViewChange?: (view: 'BOARD' | 'AUDITING' | 'CRM') => void;
  clients?: ClientOption[];
  selectedClient?: string;
  onClientChange?: (clientId: string) => void;
  auditingCount?: number;
  availableMAs?: Array<{ id: string; name: string; avatarUrl?: string | null; roles?: string[] }>;
  selectedMAs?: string[];
  onSelectedMAsChange?: (maIds: string[]) => void;
  hasCrmAccess?: boolean;
}

function formatElapsed(startedAt: string, now: Date): string {
  const startMs = new Date(startedAt).getTime();
  const diffMs = Math.max(0, now.getTime() - startMs);
  const totalMins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

function formatManilaTime(dateOrIso: string | Date | null | undefined): string {
  if (!dateOrIso) return '';
  try {
    const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return '';
  }
}

function getCleanUpworkName(session: UpworkSession): string {
  // Prefer specific target name (e.g. HANNAH, BLESSIE, CHE, PAU, SHEMUEL)
  if (session.pmName && session.pmName !== 'Active' && session.pmName !== 'General') {
    return session.pmName.toUpperCase();
  }
  const raw = session.userName || '';
  if (raw.includes('@')) {
    return raw.split('@')[0].toUpperCase();
  }
  return (raw || 'USER').toUpperCase();
}

export const TaskMapHeader: React.FC<Props> = ({
  currentDate,
  currentShift,
  onShiftChange,
  shifts = [],
  search,
  onSearchChange,
  activeUpworkSessions = [],
  currentView = 'BOARD',
  onViewChange,
  clients = [],
  selectedClient = 'ALL',
  onClientChange,
  auditingCount = 0,
  availableMAs = [],
  selectedMAs = [],
  onSelectedMAsChange,
  hasCrmAccess = false,
}) => {
  // Live ticking timer for elapsed duration (Reverse-engineered from Teammap.js)
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Client dropdown state
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const clientDropdownRef = useRef<HTMLDivElement>(null);

  // Custom MA filter dropdown state
  const [maDropdownOpen, setMaDropdownOpen] = useState(false);
  const [maSearch, setMaSearch] = useState('');
  const maDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setClientDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [clientDropdownOpen]);

  useEffect(() => {
    if (!maDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (maDropdownRef.current && !maDropdownRef.current.contains(e.target as Node)) {
        setMaDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [maDropdownOpen]);

  // Compute total tasks and active client object
  const totalClientTasks = clients.reduce((acc, c) => acc + c.count, 0);
  const selectedClientObj = selectedClient !== 'ALL'
    ? clients.find((c) => c.id === selectedClient || c.name === selectedClient)
    : null;

  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const filteredMAs = (availableMAs || []).filter((m) =>
    (m.name || '').toLowerCase().includes(maSearch.toLowerCase())
  );

  // Format selected date
  const dateObj = currentDate ? new Date(currentDate) : new Date();
  const formattedDate = format(dateObj, 'MMMM d, yyyy');
  const dayOfWeek = format(dateObj, 'EEEE');

  const shiftOptions = [
    { key: 'ALL', label: 'All' },
    { key: 'DAY', label: 'Day' },
    { key: 'NOON', label: 'Noon' },
    { key: 'NIGHT', label: 'Night' },
    { key: 'CUSTOM', label: 'Custom' },
  ];

  return (
    <header className="px-6 pt-4 pb-3 flex flex-col gap-3 select-none">
      {/* Line 1: Dedicated View Mode Tabs (Task Map | Auditing | CRM) on the left, Search on the right */}
      {onViewChange && (
        <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800/60">
          <div className="flex items-center bg-card border border-zinc-800/80 rounded-xl p-1 text-xs font-semibold shadow-xs">
            <button
              type="button"
              onClick={() => onViewChange('BOARD')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                currentView === 'BOARD'
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 font-medium'
              }`}
            >
              <Kanban className="size-3.5" />
              <span>Task Map</span>
            </button>

            <button
              type="button"
              onClick={() => onViewChange('AUDITING')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                currentView === 'AUDITING'
                  ? 'bg-amber-600 text-white shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-amber-300 hover:bg-zinc-800/50 font-medium'
              }`}
            >
              <ShieldCheck className="size-3.5" />
              <span>Audito Map</span>
            </button>

            {hasCrmAccess && (
              <button
                type="button"
                onClick={() => onViewChange('CRM')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  currentView === 'CRM'
                    ? 'bg-[#22A3AE] text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-[#22A3AE] hover:bg-zinc-800/50 font-medium'
                }`}
              >
                <UserCheck className="size-3.5" />
                <span>CRM Map</span>
              </button>
            )}
          </div>

          {/* Search moved to right side of Line 1 */}
          <div className="relative flex items-center">
            <Search className="size-3 text-zinc-500 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search..."
              className="w-36 sm:w-48 pl-7 pr-3 py-1.5 bg-card border border-zinc-800/80 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Line 2: Date on the left, Shift switcher & Client selector on the right */}
      <div className="flex items-start justify-between gap-4">
        {/* Left: Date & Day of Week */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-100 tracking-tight">
            {formattedDate}
          </h1>
          <p className="text-sm font-medium text-zinc-400 mt-0.5">
            {dayOfWeek}
          </p>
        </div>

        {/* Right: Shift Switcher & Search Bar */}
        <div className="flex items-center gap-3">

          {/* Shift pills [All] [Day] [Noon] [Night] [Custom] */}
          <div className="flex items-center bg-card border border-zinc-800/80 rounded-xl p-1 text-xs font-medium">
            {shiftOptions.map((opt) => {
              const isActive = currentShift.toUpperCase() === opt.key;
              const isCustom = opt.key === 'CUSTOM';

              return (
                <div key={opt.key} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (isActive) {
                        if (isCustom) {
                          setMaDropdownOpen(!maDropdownOpen);
                        } else {
                          onShiftChange('ALL');
                        }
                      } else {
                        onShiftChange(opt.key);
                        if (isCustom) {
                          setMaDropdownOpen(true);
                        }
                      }
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-all cursor-pointer ${
                      isActive
                        ? 'bg-zinc-800 text-zinc-100 shadow-xs font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`}
                    title={
                      isActive
                        ? isCustom
                          ? 'Configure custom MAs (or click again to deselect)'
                          : `Click to deselect (${opt.label})`
                        : `Filter by ${opt.label} shift`
                    }
                  >
                    <span>{opt.label}</span>
                    {isCustom && selectedMAs.length > 0 && (
                      <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-blue-500/30 text-blue-300 font-bold ml-0.5">
                        {selectedMAs.length}
                      </span>
                    )}
                    {isCustom && (
                      <ChevronDown
                        className={`size-3 text-zinc-400 transition-transform ml-0.5 ${
                          maDropdownOpen ? 'rotate-180' : ''
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isActive) onShiftChange('CUSTOM');
                          setMaDropdownOpen(!maDropdownOpen);
                        }}
                      />
                    )}
                  </button>

                  {isCustom && maDropdownOpen && (
                    <div
                      ref={maDropdownRef}
                      className="absolute left-0 top-full mt-1.5 w-64 bg-popover border border-zinc-800 rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between px-1 pb-1 border-b border-zinc-800">
                        <span className="text-xs font-bold text-zinc-200">Filter Specific MAs</span>
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <button
                            type="button"
                            onClick={() => onSelectedMAsChange?.(availableMAs.map((m) => m.id))}
                            className="text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                          >
                            All
                          </button>
                          <span className="text-zinc-600">·</span>
                          <button
                            type="button"
                            onClick={() => onSelectedMAsChange?.([])}
                            className="text-zinc-400 hover:text-zinc-300 font-semibold cursor-pointer"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      {/* Search */}
                      <div className="relative">
                        <Search className="size-3 text-zinc-500 absolute left-2.5 top-2 pointer-events-none" />
                        <input
                          type="text"
                          value={maSearch}
                          onChange={(e) => setMaSearch(e.target.value)}
                          placeholder="Search team members..."
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-md pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                          autoFocus
                        />
                      </div>

                      {/* MA list */}
                      <div className="max-h-56 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
                        {filteredMAs.length === 0 ? (
                          <p className="text-[11px] text-zinc-500 italic text-center py-2">
                            No members found
                          </p>
                        ) : (
                          filteredMAs.map((ma) => {
                            const isChecked = selectedMAs.includes(ma.id);
                            return (
                              <button
                                key={ma.id}
                                type="button"
                                onClick={() => {
                                  const next = isChecked
                                    ? selectedMAs.filter((id) => id !== ma.id)
                                    : [...selectedMAs, ma.id];
                                  onSelectedMAsChange?.(next);
                                }}
                                className={`flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                                  isChecked
                                    ? 'bg-blue-600/15 text-blue-200 font-semibold'
                                    : 'text-zinc-300 hover:bg-zinc-800/60'
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <div
                                    className={`size-3.5 rounded border flex items-center justify-center shrink-0 ${
                                      isChecked
                                        ? 'bg-blue-600 border-blue-500 text-white'
                                        : 'border-zinc-700 bg-zinc-900'
                                    }`}
                                  >
                                    {isChecked && <Check className="size-2.5" />}
                                  </div>
                                  <span className="truncate">{ma.name}</span>
                                </div>
                                {ma.roles && ma.roles[0] && (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400 shrink-0">
                                    {ma.roles[0]}
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Link to Shift Members configuration UI */}
          <Link
            href="/settings/users?tab=shifts"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-zinc-800/80 hover:border-zinc-700 rounded-xl text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
            title="Configure Shift Members (Day, Noon, Night)"
          >
            <Users className="size-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Manage Shifts</span>
          </Link>

          {/* Client Selector Dropdown */}
          <div className="relative" ref={clientDropdownRef}>
            <button
              type="button"
              onClick={() => setClientDropdownOpen(!clientDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-card border border-zinc-800/80 hover:border-zinc-700 rounded-xl text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-all cursor-pointer shadow-xs select-none"
              title={
                selectedClientObj
                  ? `Filter: ${selectedClientObj.name} (${selectedClientObj.count} tasks)`
                  : `Filter: All Clients (${totalClientTasks} tasks)`
              }
            >
              <Building2 className="size-3.5 text-blue-400 shrink-0" />
              <span className="text-zinc-200 max-w-[120px] sm:max-w-[160px] truncate">
                {selectedClientObj ? selectedClientObj.name : 'All'}
              </span>
              <ChevronDown
                className={`size-3 text-zinc-400 transition-transform duration-150 ${
                  clientDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {clientDropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-60 bg-popover border border-zinc-800 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Search if > 4 clients */}
                {clients.length > 4 && (
                  <div className="px-2 py-1 relative">
                    <Search className="size-3 text-zinc-500 absolute left-4 top-2.5" />
                    <input
                      type="text"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      placeholder="Search clients..."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-md pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                      autoFocus
                    />
                  </div>
                )}

                <div className="max-h-56 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
                  {/* Option: All Clients */}
                  <button
                    type="button"
                    onClick={() => {
                      onClientChange?.('ALL');
                      setClientDropdownOpen(false);
                      setClientSearch('');
                    }}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                      selectedClient === 'ALL' || !selectedClient
                        ? 'bg-blue-600/20 text-blue-300 font-bold'
                        : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Building2 className="size-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">All</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800/80">
                        {totalClientTasks}
                      </span>
                      {(selectedClient === 'ALL' || !selectedClient) && (
                        <Check className="size-3 text-blue-400 shrink-0" />
                      )}
                    </div>
                  </button>

                  <div className="h-px bg-zinc-800/80 my-1" />

                  {/* List of individual clients */}
                  {filteredClients.length === 0 ? (
                    <p className="text-[11px] text-zinc-500 italic text-center py-2">
                      No clients found
                    </p>
                  ) : (
                    filteredClients.map((c) => {
                      const isSelected = selectedClient === c.id || selectedClient === c.name;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            onClientChange?.(c.id);
                            setClientDropdownOpen(false);
                            setClientSearch('');
                          }}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600/20 text-blue-300 font-bold'
                              : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'
                          }`}
                        >
                          <span className="truncate max-w-[150px]" title={c.name}>
                            {c.name}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800/80">
                              {c.count}
                            </span>
                            {isSelected && <Check className="size-3 text-blue-400 shrink-0" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Upwork Live Master Banner (Shows only when contracts are actively in use) */}
      {activeUpworkSessions.length > 0 && (
        <div className="w-full">
          <div className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-red-950/80 border border-red-800/80 text-red-200 shadow-lg shadow-red-950/40 animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5 truncate text-xs sm:text-sm font-bold tracking-wide">
              <span className="relative flex size-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-2.5 bg-red-500" />
              </span>
              <span className="truncate">
                {activeUpworkSessions.map((s) => {
                  const name = getCleanUpworkName(s);
                  const sinceTime = formatManilaTime(s.startedAt);
                  const elapsed = formatElapsed(s.startedAt, now);
                  const timePart = sinceTime ? `(since ${sinceTime} · ${elapsed})` : `(${elapsed})`;
                  return `${name} - UPWORK ACTIVE ${timePart}`;
                }).join('  |  ')}
              </span>
            </div>
            <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-900/80 border border-red-700/60 text-red-100 shrink-0">
              Contract In Use
            </span>
          </div>
        </div>
      )}
    </header>
  );
};
