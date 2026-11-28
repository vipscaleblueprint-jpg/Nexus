'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Save,
  RefreshCw,
  X,
  Pencil,
  ShieldCheck,
  Loader2,
  CalendarClock,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import { API_BASE_URL } from '@/api/client';
import { shiftTimesApi, ShiftTimeEntry } from '@/api/shiftTimes';
import { toast } from '@/lib/toast';
import {
  getScheduleShiftKinds,
  splitScheduleSegments,
  shiftBadgeStyle,
} from '@/lib/shiftSchedule';
import { ShiftScheduleEditor } from './ShiftScheduleEditor';

interface ShiftTimesTabProps {
  onRefreshUsers?: () => void;
}

export function ShiftTimesTab({ onRefreshUsers }: ShiftTimesTabProps) {
  const [entries, setEntries] = useState<ShiftTimeEntry[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'DAY' | 'MID' | 'NIGHT' | 'UNASSIGNED'>('ALL');

  // Modal editing state
  const [editingEntry, setEditingEntry] = useState<ShiftTimeEntry | null>(null);
  const [draftSchedule, setDraftSchedule] = useState('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const loadShiftTimes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await shiftTimesApi.getShiftTimes();
      setEntries(data.shiftTimes || []);
      setCanEdit(Boolean(data.canEdit));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load shift times');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShiftTimes();
  }, [loadShiftTimes]);

  // Real-time Socket.io listener so VIPScale Tools edits appear immediately
  useEffect(() => {
    const s = io(API_BASE_URL, { withCredentials: true });

    const handleUpdated = (payload: any) => {
      if (payload?.bulk) {
        loadShiftTimes();
        return;
      }
      if (payload?.userId) {
        setEntries((prev) =>
          prev.map((item) =>
            item.userId === payload.userId
              ? {
                  ...item,
                  schedule: payload.schedule ?? '',
                  source: payload.source ?? item.source,
                  updatedBy: payload.updatedBy ?? item.updatedBy,
                  updatedAt: payload.updatedAt ?? new Date().toISOString(),
                }
              : item
          )
        );
      }
    };

    s.on('shift_times:updated', handleUpdated);
    return () => {
      s.off('shift_times:updated', handleUpdated);
      s.disconnect();
    };
  }, [loadShiftTimes]);

  const startEdit = (entry: ShiftTimeEntry) => {
    if (!canEdit) return;
    setEditingEntry(entry);
    setDraftSchedule(entry.schedule || '');
  };

  const cancelEdit = useCallback(() => {
    if (savingUserId) return;
    setEditingEntry(null);
    setDraftSchedule('');
  }, [savingUserId]);

  useEffect(() => {
    if (!editingEntry) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelEdit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingEntry, cancelEdit]);

  const handleSave = async (userId: string) => {
    try {
      setSavingUserId(userId);
      const res = await shiftTimesApi.updateShiftTime(userId, draftSchedule);
      setEntries((prev) =>
        prev.map((item) =>
          item.userId === userId
            ? {
                ...item,
                schedule: res.shiftTime.schedule,
                source: res.shiftTime.source,
                updatedBy: res.shiftTime.updatedBy,
                updatedAt: res.shiftTime.updatedAt,
              }
            : item
        )
      );
      setEditingEntry(null);
      toast.success('Shift time updated & synced to VIPScale Tools');
      onRefreshUsers?.();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save shift time');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleImportSheet = async () => {
    try {
      setImporting(true);
      const res = await shiftTimesApi.importFromSheet();
      await loadShiftTimes();
      onRefreshUsers?.();
      toast.success(`Imported ${res.syncedCount} shift schedule(s) from Column X and synced to VIPScale Tools`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to import schedules from Google Sheet');
    } finally {
      setImporting(false);
    }
  };

  const counts = useMemo(() => {
    const c = { ALL: entries.length, DAY: 0, MID: 0, NIGHT: 0, UNASSIGNED: 0 };
    for (const e of entries) {
      for (const kind of getScheduleShiftKinds(e.schedule)) {
        c[kind]++;
      }
    }
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (shiftFilter !== 'ALL' && !getScheduleShiftKinds(e.schedule).includes(shiftFilter)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.userId.toLowerCase().includes(q) ||
        (e.schedule || '').toLowerCase().includes(q)
      );
    });
  }, [entries, search, shiftFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400 gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
        <span>Loading shift times...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Actions */}
      <div className="bg-card border border-zinc-800/80 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-white">Team Shift Times</h2>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Two-Way Sync
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Edits made here or in VIPScale Tools sync automatically in canonical format (e.g.{' '}
            <code className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-200 border border-zinc-800">M-F 8AM to 5PM</code>
            {' '}or split shifts like{' '}
            <code className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-200 border border-zinc-800">M-Th 8AM to 5PM, Fri 1PM to 9PM</code>).
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={loadShiftTimes}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium border border-zinc-800 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={handleImportSheet}
              disabled={importing}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm"
            >
              {importing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{importing ? 'Syncing Sheet...' : 'Sync from Sheet (Col X)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Pills + Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="inline-flex items-center bg-zinc-900 p-1 rounded-xl border border-zinc-800 flex-wrap gap-1">
          {(['ALL', 'DAY', 'MID', 'NIGHT', 'UNASSIGNED'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setShiftFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                shiftFilter === tab
                  ? 'bg-zinc-800 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab === 'UNASSIGNED' ? 'No Shift' : tab} ({counts[tab]})
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or schedule..."
            className="w-full pl-10 pr-4 py-2 bg-card border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500/60 rounded-xl text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-zinc-800/80 rounded-2xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-3 px-4 font-semibold">Member</th>
                <th className="py-3 px-4 font-semibold">Schedule</th>
                {canEdit && <th className="py-3 px-4 font-semibold text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-xs">
              {filtered.map((entry) => {
                const segments = splitScheduleSegments(entry.schedule);
                const initials = entry.name
                  .split(' ')
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <tr
                    key={entry.userId}
                    className="hover:bg-zinc-900/40 transition-colors"
                  >
                    {/* Member */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        {entry.avatarUrl ? (
                          <img
                            src={entry.avatarUrl}
                            alt={entry.name}
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-zinc-800"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                            {initials}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-white truncate">{entry.name}</span>
                            {entry.isSpecialEditor && (
                              <span
                                title="Granted Shift Times edit access"
                                className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30"
                              >
                                <ShieldCheck className="w-2.5 h-2.5" />
                                Shift Editor
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-500 truncate">{entry.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Schedule */}
                    <td className="py-3.5 px-4">
                      {segments.length > 0 ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {segments.map((seg, i) => (
                            <span
                              key={`${seg}-${i}`}
                              className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-semibold ${shiftBadgeStyle(
                                seg
                              )}`}
                            >
                              <span>{seg}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-semibold ${shiftBadgeStyle(
                            ''
                          )}`}
                        >
                          <span>Not set</span>
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    {canEdit && (
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(entry)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 text-[11px] font-medium cursor-pointer transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 3 : 2} className="py-12 text-center text-zinc-500 text-xs">
                    No members match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Shift Schedule Modal */}
      <AnimatePresence>
        {editingEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={cancelEdit}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl bg-card border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between gap-3 bg-zinc-900/50">
                <div className="flex items-center gap-3 min-w-0">
                  {editingEntry.avatarUrl ? (
                    <img
                      src={editingEntry.avatarUrl}
                      alt={editingEntry.name}
                      className="w-9 h-9 rounded-full object-cover shrink-0 border border-zinc-800"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {editingEntry.name
                        .split(' ')
                        .map((w) => w[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">
                      Edit Shift — {editingEntry.name}
                    </h3>
                    <p className="text-[11px] text-zinc-500 truncate">{editingEntry.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={Boolean(savingUserId)}
                  onClick={cancelEdit}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5">
                <ShiftScheduleEditor
                  value={draftSchedule}
                  onChange={setDraftSchedule}
                />
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3.5 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={Boolean(savingUserId)}
                  onClick={cancelEdit}
                  className="px-3.5 py-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={Boolean(savingUserId)}
                  onClick={() => handleSave(editingEntry.userId)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm"
                >
                  {savingUserId === editingEntry.userId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Save Schedule</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
