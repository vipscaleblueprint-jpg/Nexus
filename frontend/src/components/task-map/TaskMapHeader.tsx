import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { TaskMapShift, UpworkSession, taskMapApi } from '@/api/taskMap';
import { Users, Building2, ChevronDown, Check, Search, ShieldCheck, Kanban, UserCheck, X, Briefcase, Plus } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { isAaronUser } from '@/lib/permissions';

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

  // Upwork Clients state (Restricted to Aaron)
  const currentUser = useAppStore((s) => s.currentUser);
  const isAaron = isAaronUser(currentUser);
  const [upworkModalOpen, setUpworkModalOpen] = useState(false);
  const [upworkSearch, setUpworkSearch] = useState('');
  const [newUpworkClient, setNewUpworkClient] = useState('');
  const upworkClients = useAppStore((s) => s.upworkClients);
  const setUpworkClients = useAppStore((s) => s.setUpworkClients);

  const handleToggleUpworkClient = async (clientName: string) => {
    const trimmed = clientName.trim();
    if (!trimmed) return;
    const exists = upworkClients.some((c) => c.toLowerCase() === trimmed.toLowerCase());
    const nextList = exists
      ? upworkClients.filter((c) => c.toLowerCase() !== trimmed.toLowerCase())
      : [...upworkClients, trimmed];
    setUpworkClients(nextList);
    try {
      await taskMapApi.toggleUpworkClient({ clientName: trimmed, isUpwork: !exists });
    } catch (err) {
      console.error('Failed to toggle upwork client:', err);
      setUpworkClients(upworkClients);
    }
  };

  const handleAddNewUpworkClient = async () => {
    const trimmed = newUpworkClient.trim();
    if (!trimmed) return;
    if (!upworkClients.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      const nextList = [...upworkClients, trimmed];
      setUpworkClients(nextList);
      setNewUpworkClient('');
      try {
        await taskMapApi.toggleUpworkClient({ clientName: trimmed, isUpwork: true });
      } catch (err) {
        console.error('Failed to add upwork client:', err);
        setUpworkClients(upworkClients);
      }
    } else {
      setNewUpworkClient('');
    }
  };

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

  // Combine clients from tasks with any custom configured upwork clients
  const allCombinedClients = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    clients.forEach((c) => map.set(c.name.toLowerCase(), { id: c.id, name: c.name }));
    upworkClients.forEach((u) => {
      if (!map.has(u.toLowerCase())) {
        map.set(u.toLowerCase(), { id: u, name: u });
      }
    });
    return Array.from(map.values())
      .filter((c) => c.name.toLowerCase().includes(upworkSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, upworkClients, upworkSearch]);

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

  const activeShiftTokens = React.useMemo(() => {
    return (currentShift || 'ALL')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }, [currentShift]);

  const isAllActive = activeShiftTokens.includes('ALL') || activeShiftTokens.length === 0;

  return (
    <>
      <header className="px-6 pt-4 pb-2.5 flex flex-col gap-2.5 select-none">
      {/* LINE 1: Dedicated View Mode Line (Task Map | Audito Map | CRM Map) & Search Bar on Right */}
      <div className="flex items-center justify-between gap-4">
        {/* Left: View switcher tabs */}
        {onViewChange && (
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
        )}

        {/* Right: Clean Search Input with clear button */}
        <div className="relative flex items-center">
          <Search className="size-3.5 text-zinc-500 absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="w-48 sm:w-64 pl-8 pr-8 py-1.5 bg-card border border-zinc-800/80 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* LINE 2: Date & Day on left, Multi-select Shift Switcher, Manage Shifts & Client Selector on right */}
      <div className="flex items-center justify-between gap-4">
        {/* Left: Date & Day of Week */}
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl sm:text-2xl font-extrabold text-zinc-100 tracking-tight">
            {formattedDate}
          </h1>
          <span className="text-xs sm:text-sm font-medium text-zinc-400">
            {dayOfWeek}
          </span>
        </div>

        {/* Right: Shift Switcher, Manage Shifts & Client Selector */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Shift pills [All] [Day] [Noon] [Night] [Custom] */}
          <div className="flex items-center bg-card border border-zinc-800/80 rounded-xl p-1 text-xs font-medium">
            {shiftOptions.map((opt) => {
              const isCustom = opt.key === 'CUSTOM';
              const isActive = opt.key === 'ALL'
                ? isAllActive
                : (!isAllActive && activeShiftTokens.includes(opt.key));

              return (
                <div key={opt.key} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (opt.key === 'ALL') {
                        onShiftChange('ALL');
                        return;
                      }
                      if (isAllActive) {
                        onShiftChange(opt.key);
                        if (isCustom) setMaDropdownOpen(true);
                        return;
                      }
                      if (isActive) {
                        const remaining = activeShiftTokens.filter((k) => k !== opt.key && k !== 'ALL');
                        if (remaining.length === 0) {
                          onShiftChange('ALL');
                        } else {
                          onShiftChange(remaining.join(','));
                        }
                      } else {
                        const next = [...activeShiftTokens.filter((k) => k !== 'ALL'), opt.key];
                        onShiftChange(next.join(','));
                        if (isCustom) setMaDropdownOpen(true);
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
                        : `Filter by ${opt.label} shift (multi-select supported)`
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
                          if (!isActive) {
                            if (isAllActive) {
                              onShiftChange('CUSTOM');
                            } else {
                              const next = [...activeShiftTokens.filter((k) => k !== 'ALL'), 'CUSTOM'];
                              onShiftChange(next.join(','));
                            }
                          }
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
                      {/* Search */}
                      <div className="relative">
                        <Search className="size-3 text-zinc-500 absolute left-2 top-2" />
                        <input
                          type="text"
                          value={maSearch}
                          onChange={(e) => setMaSearch(e.target.value)}
                          placeholder="Search members..."
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

          {/* Upwork Clients Configuration Button (Restricted to Aaron) */}
          {isAaron && (
            <button
              type="button"
              onClick={() => setUpworkModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-zinc-800/80 hover:border-emerald-500/50 rounded-xl text-xs font-medium text-zinc-300 hover:text-emerald-300 transition-colors cursor-pointer"
              title="Configure which clients are UPWORK clients"
            >
              <Briefcase className="size-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Upwork Clients</span>
              {upworkClients.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold ml-0.5">
                  {upworkClients.length}
                </span>
              )}
            </button>
          )}

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
                          <div className="flex items-center gap-1.5 truncate max-w-[150px]">
                            <span className="truncate" title={c.name}>
                              {c.name}
                            </span>
                            {upworkClients.some((u) => u.toLowerCase() === c.name.toLowerCase()) && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold shrink-0">
                                UW
                              </span>
                            )}
                          </div>
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

                  {isAaron && (
                    <>
                      <div className="h-px bg-zinc-800/80 my-1" />
                      <button
                        type="button"
                        onClick={() => {
                          setClientDropdownOpen(false);
                          setUpworkModalOpen(true);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-emerald-400 hover:bg-emerald-950/30 transition-colors cursor-pointer font-semibold"
                      >
                        <Briefcase className="size-3.5" />
                        <span>Manage Upwork Clients</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>

      {/* Upwork Clients Management Modal */}
      {upworkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setUpworkModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-popover border border-zinc-800 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Briefcase className="size-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">Upwork Clients</h3>
                  <p className="text-[11px] text-zinc-400">Designate clients tracked under Upwork timers</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUpworkModalOpen(false)}
                className="size-7 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Quick Add Custom Client */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={newUpworkClient}
                  onChange={(e) => setNewUpworkClient(e.target.value)}
                  placeholder="Add client name (e.g. Melinda, ScaleUp)..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddNewUpworkClient();
                    }
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleAddNewUpworkClient}
                disabled={!newUpworkClient.trim()}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1 shrink-0"
              >
                <Plus className="size-3.5" />
                <span>Add</span>
              </button>
            </div>

            {/* Search filter within known clients */}
            <div className="relative">
              <Search className="size-3 text-zinc-500 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={upworkSearch}
                onChange={(e) => setUpworkSearch(e.target.value)}
                placeholder="Search clients..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Client List with 1-Click Toggles */}
            <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-1 pr-1">
              {allCombinedClients.length === 0 ? (
                <p className="text-xs text-zinc-500 italic text-center py-4">No clients match search</p>
              ) : (
                allCombinedClients.map((client) => {
                  const isUpwork = upworkClients.some((u) => u.toLowerCase() === client.name.toLowerCase());
                  return (
                    <div
                      key={client.id || client.name}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl border transition-all ${
                        isUpwork
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Building2 className={`size-3.5 shrink-0 ${isUpwork ? 'text-emerald-400' : 'text-zinc-500'}`} />
                        <span className={`text-xs font-medium truncate ${isUpwork ? 'text-zinc-100 font-semibold' : 'text-zinc-300'}`}>
                          {client.name}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleUpworkClient(client.name)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                          isUpwork
                            ? 'bg-emerald-500 text-zinc-950 shadow-xs hover:bg-emerald-400'
                            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                        }`}
                      >
                        {isUpwork ? 'UPWORK CLIENT' : 'MARK UPWORK'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 text-[11px] text-zinc-400">
              <span>{upworkClients.length} clients marked as Upwork</span>
              <button
                type="button"
                onClick={() => setUpworkModalOpen(false)}
                className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

