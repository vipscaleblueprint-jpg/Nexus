'use client';

import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Shield, Check, Search } from 'lucide-react';
import { TaskMapItem } from '@/api/taskMap';

export interface ColumnClientDropdownProps {
  tasks: TaskMapItem[];
  clients?: Array<{ id: string; name: string; count?: number }>;
  showAdmin: boolean;
  onToggleAdmin: () => void;
  selectedClients: string[] | 'ALL';
  onSelectClients: (clients: string[] | 'ALL') => void;
  isTaskUnderAdmin: (task: TaskMapItem) => boolean;
}

export const ColumnClientDropdown: React.FC<ColumnClientDropdownProps> = ({
  tasks,
  clients,
  showAdmin,
  onToggleAdmin,
  selectedClients,
  onSelectClients,
  isTaskUnderAdmin,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const calcPos = (rect: DOMRect) => {
    const width = 240;
    const height = 320;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 10) {
      top = Math.max(10, rect.top - height - 4);
    }
    let left = rect.left;
    if (left + width > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - width - 10);
    }
    return { top, left };
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      setCoords(null);
      setSearchQuery('');
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pos = calcPos(rect);
    setCoords(pos);
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCoords(null);
        setSearchQuery('');
      }
    };
    const handleScrollOrResize = (e?: Event) => {
      if (e && dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
      setCoords(null);
      setSearchQuery('');
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  // Compute distinct clients and task counts for the current column
  const { clientsList, adminCount, totalClientCount } = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();

    // Seed all clients from "Client Dashboard"
    for (const c of clients || []) {
      map.set(c.id, { id: c.id, name: c.name, count: 0 });
    }

    let admin = 0;
    let clientTotal = 0;

    for (const t of tasks || []) {
      if (!t) continue;
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
        x.trim().toUpperCase().replace(/[\s_-]+/g, '')
      );
      const isExcluded =
        s === 'DAILY' ||
        s.includes('DAILY') ||
        s === 'WEEKLY' ||
        s.includes('WEEKLY') ||
        s === 'MONTHLY' ||
        s.includes('MONTHLY') ||
        s === 'RECURRING' ||
        s.includes('RECURRING') ||
        !!(t as any)?.recurringConfig ||
        mapStatuses.some((st: string) =>
          ['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(st) ||
          st.includes('DAILY') ||
          st.includes('WEEKLY') ||
          st.includes('MONTHLY') ||
          st.includes('RECURRING')
        );
      if (isExcluded) continue;

      if (isTaskUnderAdmin(t)) {
        admin++;
      } else {
        const id = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
        const name = t.list?.name || 'General';
        clientTotal++;
        const existing = map.get(id);
        if (existing) {
          existing.count++;
        } else {
          map.set(id, { id, name, count: 1 });
        }
      }
    }

    const sortedClients = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return {
      clientsList: sortedClients,
      adminCount: admin,
      totalClientCount: clientTotal,
    };
  }, [tasks, clients, isTaskUnderAdmin]);

  const allClientsChecked =
    selectedClients === 'ALL' ||
    (Array.isArray(selectedClients) && selectedClients.length === clientsList.length);

  const isClientChecked = (id: string, name: string) => {
    if (selectedClients === 'ALL') return true;
    return selectedClients.includes(id) || selectedClients.includes(name);
  };

  const filteredClients = clientsList.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const isFiltered = showAdmin || !allClientsChecked;

  const getButtonDetails = () => {
    if (!isFiltered) {
      return {
        label: '',
        btnClass:
          'bg-card hover:bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:border-zinc-700',
        badgeClass: 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/60',
        iconClass: 'text-blue-400',
      };
    }

    let label = 'Filtered';
    if (showAdmin && Array.isArray(selectedClients) && selectedClients.length === 0) {
      label = 'Admin only';
    } else if (!showAdmin && Array.isArray(selectedClients) && selectedClients.length === 1) {
      const match = clientsList.find((c) => isClientChecked(c.id, c.name));
      if (match) label = match.name;
    } else if (showAdmin && Array.isArray(selectedClients) && selectedClients.length === 1) {
      const match = clientsList.find((c) => isClientChecked(c.id, c.name));
      if (match) label = `${match.name} + Admin`;
    }

    return {
      label,
      btnClass:
        'bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 dark:bg-blue-950/70 dark:hover:bg-blue-950 dark:text-blue-200 dark:border-blue-700/80 shadow-sm',
      badgeClass: 'bg-blue-200/60 text-blue-800 dark:bg-black/40 dark:text-blue-300',
      iconClass: 'text-blue-600 dark:text-blue-400',
    };
  };

  const details = getButtonDetails();

  const handleToggleAllClients = () => {
    if (allClientsChecked) {
      onSelectClients([]);
    } else {
      onSelectClients('ALL');
    }
  };

  const handleToggleClient = (clientId: string) => {
    if (selectedClients === 'ALL') {
      const remaining = clientsList.map((c) => c.id).filter((id) => id !== clientId);
      onSelectClients(remaining);
    } else {
      const current = new Set(selectedClients);
      if (current.has(clientId)) {
        current.delete(clientId);
      } else {
        current.add(clientId);
      }
      const arr = Array.from(current);
      if (arr.length === clientsList.length) {
        onSelectClients('ALL');
      } else {
        onSelectClients(arr);
      }
    }
  };

  const handleSelectOnlyClient = (clientId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectClients([clientId]);
  };

  const handleReset = () => {
    onSelectClients('ALL');
    if (showAdmin) onToggleAdmin();
    setSearchQuery('');
  };

  return (
    <div
      className="relative inline-block text-left shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-xs select-none ${details.btnClass}`}
        title={
          details.label
            ? `Filtered by: ${details.label}`
            : 'Filter by Client & Admin (All Clients visible)'
        }
      >
        <Building2 className={`size-3 shrink-0 ${details.iconClass}`} />
        {details.label && <span className="font-semibold max-w-[80px] truncate">{details.label}</span>}
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
            }}
            className="w-60 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Search if > 4 clients */}
            {clientsList.length > 4 && (
              <div className="px-1.5 py-0.5 relative">
                <Search className="size-3 text-zinc-500 absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search clients..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>
            )}

            {/* Master Options: All Clients & Admin Tasks */}
            <div className="flex flex-col gap-0.5">
              {/* All Clients Option */}
              <button
                type="button"
                onClick={handleToggleAllClients}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                  allClientsChecked
                    ? 'bg-blue-600/15 text-blue-700 dark:text-blue-200 font-semibold'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      allClientsChecked
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                    }`}
                  >
                    <Check className="size-2.5" />
                  </div>
                  <Building2 className="size-3 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="truncate">All Clients</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400 shrink-0">
                  {totalClientCount}
                </span>
              </button>

              {/* Admin Tasks Option */}
              <button
                type="button"
                onClick={onToggleAdmin}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                  showAdmin
                    ? 'bg-purple-100 text-purple-800 border border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-800/60 font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      showAdmin
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                    }`}
                  >
                    <Check className="size-2.5" />
                  </div>
                  <Shield className="size-3 text-purple-600 dark:text-purple-400 shrink-0" />
                  <span className="truncate">Admin Tasks</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 shrink-0">
                  {adminCount}
                </span>
              </button>
            </div>

            <div className="h-px bg-zinc-800/80 my-0.5" />

            {/* List of individual clients */}
            <div className="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
              {filteredClients.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic text-center py-2">
                  No clients found
                </p>
              ) : (
                filteredClients.map((client) => {
                  const checked = isClientChecked(client.id, client.name);
                  return (
                    <div
                      key={client.id}
                      onClick={() => handleToggleClient(client.id)}
                      className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                        checked
                          ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-100 font-medium'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/40 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            checked
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                          }`}
                        >
                          <Check className="size-2.5" />
                        </div>
                        <span className="truncate">{client.name}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* 'Only' button visible on group hover */}
                        <button
                          type="button"
                          onClick={(e) => handleSelectOnlyClient(client.id, e)}
                          className="opacity-0 group-hover:opacity-100 px-1 py-0.2 text-[9px] text-zinc-400 hover:text-blue-300 hover:bg-blue-950/60 rounded transition-all cursor-pointer"
                          title={`Show only ${client.name}`}
                        >
                          only
                        </button>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400">
                          {client.count}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reset Filter Button */}
            {isFiltered && (
              <>
                <div className="h-px bg-zinc-800/80 my-0.5" />
                <button
                  type="button"
                  onClick={handleReset}
                  className="w-full text-center py-1 text-[11px] text-zinc-400 hover:text-white rounded hover:bg-zinc-800/60 transition-colors cursor-pointer"
                >
                  Reset Client Filter
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

