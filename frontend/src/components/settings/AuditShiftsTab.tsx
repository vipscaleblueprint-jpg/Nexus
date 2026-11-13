'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock,
  Users,
  CheckCircle2,
  AlertCircle,
  Save,
  RotateCcw,
  Play,
  ShieldCheck,
  Search,
  X,
  Sun,
  Sunset,
  Moon,
  Sparkles,
  Loader2,
  Calendar,
  Filter,
} from 'lucide-react';
import { auditShiftsApi, AuditShift, AuditShiftUser } from '@/api/auditShifts';
import { toast } from '@/lib/toast';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';

interface AuditShiftsTabProps {
  onRefreshUsers?: () => void;
  readOnly?: boolean;
}

const SHIFT_ICONS: Record<string, any> = {
  AM: Sun,
  PM_AFTERNOON: Sunset,
  PM_NIGHT: Moon,
};

const SHIFT_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  AM: {
    bg: 'from-amber-500/10 to-orange-500/5',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  PM_AFTERNOON: {
    bg: 'from-indigo-500/10 to-purple-500/5',
    border: 'border-indigo-500/30',
    text: 'text-indigo-400',
    badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  PM_NIGHT: {
    bg: 'from-blue-500/10 to-cyan-500/5',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
};

function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const m = minute.toString().padStart(2, '0');
  return `${h}:${m} ${ampm}`;
}

export function AuditShiftsTab({ onRefreshUsers, readOnly = false }: AuditShiftsTabProps) {
  const [shifts, setShifts] = useState<AuditShift[]>([]);
  const [users, setUsers] = useState<AuditShiftUser[]>([]);
  const [activeShiftKey, setActiveShiftKey] = useState<string>('AM');
  const [selectedShiftKey, setSelectedShiftKey] = useState<string>('AM');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Live Manila Clock
  const [manilaTime, setManilaTime] = useState<string>('');

  // Editing state for the selected shift
  const [editName, setEditName] = useState('');
  const [editStartHour, setEditStartHour] = useState(8);
  const [editStartMinute, setEditStartMinute] = useState(0);
  const [editEndHour, setEditEndHour] = useState(12);
  const [editEndMinute, setEditEndMinute] = useState(0);
  const [editIsActive, setEditIsActive] = useState(true);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [selectedMemberNames, setSelectedMemberNames] = useState<string[]>([]);
  const [selectedAuditorIds, setSelectedAuditorIds] = useState<string[]>([]);
  const [selectedAuditorNames, setSelectedAuditorNames] = useState<string[]>([]);

  // Search and filter for member/auditor picker
  const [auditorSearch, setAuditorSearch] = useState('');
  const [auditorsOnly, setAuditorsOnly] = useState(false);

  // Load shifts and users
  const loadShifts = async () => {
    try {
      setLoading(true);
      const data = await auditShiftsApi.getAuditShifts();
      setShifts(data.shifts || []);
      setUsers(data.users || []);
      setActiveShiftKey(data.activeShiftKey || 'OFF_SHIFT');

      // Select first shift or current active
      if (data.shifts && data.shifts.length > 0) {
        const initial = data.shifts.find((s) => s.shiftKey === data.activeShiftKey) || data.shifts[0];
        setSelectedShiftKey(initial.shiftKey);
        populateEditForm(initial);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load audit shifts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShifts();
  }, []);

  // Update live Manila clock every second
  useEffect(() => {
    const updateClock = () => {
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(new Date());
      setManilaTime(formatted);
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const populateEditForm = (shift: AuditShift) => {
    setEditName(shift.name);
    setEditStartHour(shift.startHour);
    setEditStartMinute(shift.startMinute || 0);
    setEditEndHour(shift.endHour);
    setEditEndMinute(shift.endMinute || 0);
    setEditIsActive(shift.isActive);
    setSelectedMemberIds(shift.memberIds && shift.memberIds.length > 0 ? shift.memberIds : (shift.auditorIds || []));
    setSelectedMemberNames(shift.memberNames && shift.memberNames.length > 0 ? shift.memberNames : (shift.auditorNames || []));
    setSelectedAuditorIds(shift.auditorIds || []);
    setSelectedAuditorNames(shift.auditorNames || []);
  };

  const handleSelectShift = (shiftKey: string) => {
    const shift = shifts.find((s) => s.shiftKey === shiftKey);
    if (!shift) return;
    setSelectedShiftKey(shiftKey);
    populateEditForm(shift);
  };

  const selectedShift = useMemo(() => {
    return shifts.find((s) => s.shiftKey === selectedShiftKey);
  }, [shifts, selectedShiftKey]);

  // Filter eligible users for member/auditor picker
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const hasAuditorRole = (u.roles || []).some((r) => r.toLowerCase().includes('audit'));
      if (auditorsOnly && !hasAuditorRole) return false;

      if (!auditorSearch.trim()) return true;
      const search = auditorSearch.toLowerCase();
      const matchName = (u.name || '').toLowerCase().includes(search);
      const matchEmail = (u.email || '').toLowerCase().includes(search);
      const matchRole = (u.roles || []).some((r) => r.toLowerCase().includes(search));
      return matchName || matchEmail || matchRole;
    });
  }, [users, auditorSearch, auditorsOnly]);

  const toggleMember = (user: AuditShiftUser) => {
    const isMember = selectedMemberIds.includes(user.id) ||
      selectedMemberNames.some((n) => n.toLowerCase() === user.name.toLowerCase());
    const hasAuditorRole = (user.roles || []).some((r) => r.toLowerCase().includes('audit'));

    if (isMember) {
      // Remove from members
      setSelectedMemberIds((prev) => prev.filter((id) => id !== user.id));
      setSelectedMemberNames((prev) => prev.filter((name) => name.toLowerCase() !== user.name.toLowerCase()));
      // Also remove from auditors if present
      setSelectedAuditorIds((prev) => prev.filter((id) => id !== user.id));
      setSelectedAuditorNames((prev) => prev.filter((name) => name.toLowerCase() !== user.name.toLowerCase()));
    } else {
      // Add to members
      setSelectedMemberIds((prev) => [...prev, user.id]);
      setSelectedMemberNames((prev) => Array.from(new Set([...prev, user.name])));
      // If user is an auditor by role, also add to auditors
      if (hasAuditorRole) {
        setSelectedAuditorIds((prev) => [...prev, user.id]);
        setSelectedAuditorNames((prev) => Array.from(new Set([...prev, user.name])));
      }
    }
  };

  const handleSaveShift = async () => {
    if (!selectedShift) return;

    try {
      setSaving(true);
      const payload = {
        name: editName.trim(),
        startHour: editStartHour,
        startMinute: editStartMinute,
        endHour: editEndHour,
        endMinute: editEndMinute,
        isActive: editIsActive,
        memberIds: selectedMemberIds,
        memberNames: selectedMemberNames,
        auditorIds: selectedAuditorIds,
        auditorNames: selectedAuditorNames,
      };

      const res = await auditShiftsApi.updateAuditShift(selectedShift.id, payload);
      toast.success(`Saved "${editName}" shift to database!`);

      // Update local shifts
      setShifts((prev) => prev.map((s) => (s.id === selectedShift.id ? res.shift : s)));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save shift changes');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    try {
      setLoading(true);
      const res = await auditShiftsApi.resetAuditShifts();
      setShifts(res.shifts);
      if (res.shifts.length > 0) {
        setSelectedShiftKey(res.shifts[0].shiftKey);
        populateEditForm(res.shifts[0]);
      }
      toast.success('Reset all 3 shifts back to standard defaults!');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reset shifts');
    } finally {
      setLoading(false);
      setIsResetModalOpen(false);
    }
  };

  const handleTriggerSweep = async () => {
    try {
      setSweeping(true);
      const res = await auditShiftsApi.triggerShiftSweep(selectedShiftKey);
      toast.success(`Sweep finished: checked ${res.checkedTasks} tasks, updated ${res.updatedTasks} audits.`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to trigger sweep');
    } finally {
      setSweeping(false);
    }
  };

  const isOvernight = editStartHour > editEndHour;

  if (loading && shifts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        <span className="text-sm text-zinc-400">Loading audit shift schedules from database...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      {/* Header Banner: Live Manila Clock & Current Active Shift */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white tracking-tight">Audit Shift Schedules</h2>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              Database Connected
            </span>
            {readOnly && (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                View Only
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400">
            {readOnly
              ? 'View shift hours and assigned auditors & members. Only Admins can modify shift schedules.'
              : 'Configure shift hours and auto-assigned auditors for In-Review tasks. All times evaluate against Manila Time (UTC+8).'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          {/* Live Clock Pill */}
          <div className="flex items-center gap-2 bg-zinc-800/80 px-3 py-1.5 rounded-xl border border-zinc-700/60 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-medium text-zinc-200">{manilaTime || 'UTC+8 Manila'}</span>
          </div>

          {!readOnly && (
            <>
              {/* Trigger Sweep Button */}
              <button
                onClick={handleTriggerSweep}
                disabled={sweeping}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700/60 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                title="Execute sweep for current tasks in review"
              >
                <Play className={`w-3.5 h-3.5 text-emerald-400 ${sweeping ? 'animate-spin' : ''}`} />
                <span>{sweeping ? 'Sweeping...' : 'Run Sweep Now'}</span>
              </button>

              {/* Reset Defaults Button */}
              <button
                onClick={() => setIsResetModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium border border-zinc-800 transition-colors cursor-pointer"
                title="Reset shifts to default schedule"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Defaults</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 3 Shift Cards Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {shifts.map((shift) => {
          const isSelected = shift.shiftKey === selectedShiftKey;
          const isCurrentlyActive = shift.shiftKey === activeShiftKey;
          const ShiftIcon = SHIFT_ICONS[shift.shiftKey] || Clock;
          const colors = SHIFT_COLORS[shift.shiftKey] || SHIFT_COLORS.AM;

          return (
            <div
              key={shift.id}
              onClick={() => handleSelectShift(shift.shiftKey)}
              className={`relative rounded-2xl p-4 transition-all cursor-pointer border ${isSelected
                  ? `bg-gradient-to-br ${colors.bg} ${colors.border} shadow-lg ring-1 ring-indigo-500/40`
                  : 'bg-card border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-850/50'
                }`}
            >
              {/* Active Now Ribbon */}
              {isCurrentlyActive && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>ACTIVE NOW</span>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 ${colors.text}`}>
                  <ShiftIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-white truncate">{shift.name}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ${colors.badge}`}>
                      {shift.shiftKey}
                    </span>
                    <span className="text-xs text-zinc-400 font-medium">
                      {formatTime(shift.startHour, shift.startMinute)} – {formatTime(shift.endHour, shift.endMinute)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Member Count & State */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800/60 text-xs">
                <div className="flex items-center gap-1.5 text-zinc-300">
                  <Users className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="font-medium">
                    {shift.memberNames?.length || shift.auditorNames?.length || 0} Members
                  </span>
                </div>
                <span
                  className={`text-[11px] font-semibold ${shift.isActive ? 'text-emerald-400' : 'text-zinc-500'
                    }`}
                >
                  {shift.isActive ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Shift Detail & Editor */}
      {selectedShift && (
        <div className="bg-card border border-zinc-800 rounded-2xl p-6 space-y-6 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">{editName}</h3>
                <span className="text-xs font-mono px-2 py-0.5 rounded font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {selectedShift.shiftKey}
                </span>
                {selectedShift.shiftKey === activeShiftKey && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Currently Running in Manila
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                {readOnly
                  ? 'Operating hours and automatically assigned auditors & members for this shift.'
                  : 'Edit operating hours and select which auditors are automatically assigned during this shift.'}
              </p>
            </div>

            {readOnly ? (
              <span
                className={`text-xs font-semibold px-3 py-1 rounded-xl border self-end sm:self-center ${editIsActive
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                  }`}
              >
                {editIsActive ? 'Shift Enabled' : 'Shift Disabled'}
              </span>
            ) : (
              <div className="flex items-center gap-3 self-end sm:self-center">
                {/* Active Toggle */}
                <label className="flex items-center gap-2 text-xs font-medium text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                    className="rounded bg-zinc-800 border-zinc-700 text-indigo-500 focus:ring-indigo-500/30 cursor-pointer"
                  />
                  <span>Shift Enabled</span>
                </label>

                {/* Save Button */}
                <button
                  onClick={handleSaveShift}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors shadow cursor-pointer disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>{saving ? 'Saving...' : 'Save Shift'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Section 1: Shift Time Window Configuration */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Shift Time Window (Manila Time UTC+8)</span>
            </h4>

            {!readOnly && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Start Time Picker */}
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 space-y-2">
                  <label className="text-xs font-semibold text-zinc-300 block">Start Time</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={editStartHour}
                      onChange={(e) => setEditStartHour(parseInt(e.target.value, 10))}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {Array.from({ length: 24 }).map((_, i) => (
                        <option key={i} value={i}>
                          {formatTime(i, 0)} ({i.toString().padStart(2, '0')}:00)
                        </option>
                      ))}
                    </select>
                    <select
                      value={editStartMinute}
                      onChange={(e) => setEditStartMinute(parseInt(e.target.value, 10))}
                      className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs font-medium text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value={0}>:00</option>
                      <option value={15}>:15</option>
                      <option value={30}>:30</option>
                      <option value={45}>:45</option>
                    </select>
                  </div>
                </div>

                {/* End Time Picker */}
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 space-y-2">
                  <label className="text-xs font-semibold text-zinc-300 block">End Time</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={editEndHour}
                      onChange={(e) => setEditEndHour(parseInt(e.target.value, 10))}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {Array.from({ length: 24 }).map((_, i) => (
                        <option key={i} value={i}>
                          {formatTime(i, 0)} ({i.toString().padStart(2, '0')}:00)
                        </option>
                      ))}
                    </select>
                    <select
                      value={editEndMinute}
                      onChange={(e) => setEditEndMinute(parseInt(e.target.value, 10))}
                      className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs font-medium text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value={0}>:00</option>
                      <option value={15}>:15</option>
                      <option value={30}>:30</option>
                      <option value={45}>:45</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Helper note explaining shift window */}
            <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/80 flex items-center gap-2 text-xs text-zinc-400">
              <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                Active from <strong className="text-zinc-200">{formatTime(editStartHour, editStartMinute)}</strong> to{' '}
                <strong className="text-zinc-200">{formatTime(editEndHour, editEndMinute)}</strong> Manila Time.
                {isOvernight && (
                  <span className="text-amber-400 ml-1 font-semibold">
                    (Overnight shift spans past midnight to next day)
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Section 2: Selected Members Chips */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Assigned Shift Members & Auditors ({selectedMemberNames.length})</span>
              </h4>
              {!readOnly && selectedMemberNames.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMemberIds([]);
                    setSelectedMemberNames([]);
                    setSelectedAuditorIds([]);
                    setSelectedAuditorNames([]);
                  }}
                  className="text-[11px] text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              )}
            </div>

            {selectedMemberNames.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-zinc-800 text-center text-xs text-zinc-500">
                {readOnly
                  ? 'No members assigned to this shift.'
                  : 'No members selected for this shift. Click directory members below to assign.'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedMemberNames.map((name) => {
                  const matchingUser = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
                  const isAuditor = matchingUser ? (matchingUser.roles || []).some((r) => r.toLowerCase().includes('audit')) : false;

                  return (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-indigo-200 text-xs font-medium"
                    >
                      <span>{name}</span>
                      {isAuditor ? (
                        <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          Auditor
                        </span>
                      ) : null}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMemberNames((prev) => prev.filter((n) => n !== name));
                            setSelectedAuditorNames((prev) => prev.filter((n) => n !== name));
                            if (matchingUser) {
                              setSelectedMemberIds((prev) => prev.filter((id) => id !== matchingUser.id));
                              setSelectedAuditorIds((prev) => prev.filter((id) => id !== matchingUser.id));
                            }
                          }}
                          className="hover:text-rose-400 transition-colors cursor-pointer ml-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 3: User Picker Grid (Admins only) */}
          {!readOnly && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Select Members & Auditors from Directory
                </h4>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  {/* Search Bar */}
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search by name, email, or role..."
                      value={auditorSearch}
                      onChange={(e) => setAuditorSearch(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                    />
                    {auditorSearch && (
                      <button
                        onClick={() => setAuditorSearch('')}
                        className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Filter Auditors Only */}
                  <button
                    type="button"
                    onClick={() => setAuditorsOnly(!auditorsOnly)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${auditorsOnly
                        ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
                      }`}
                  >
                    <Filter className="w-3 h-3" />
                    <span>{auditorsOnly ? 'Auditors Only' : 'All Directory'}</span>
                  </button>
                </div>
              </div>

              {/* User Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[380px] overflow-y-auto custom-scrollbar p-1">
                {filteredUsers.map((user) => {
                  const isSelected =
                    selectedMemberIds.includes(user.id) ||
                    selectedMemberNames.some((n) => n.toLowerCase() === user.name.toLowerCase());
                  const auditorRoles = (user.roles || []).filter((r) => r.toLowerCase().includes('audit'));
                  const nonAuditorRoles = (user.roles || []).filter((r) => !r.toLowerCase().includes('audit'));

                  return (
                    <div
                      key={user.id}
                      onClick={() => toggleMember(user)}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${isSelected
                          ? 'bg-indigo-600/15 border-indigo-500/40 shadow-xs'
                          : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-800/50'
                        }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt={user.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300 shrink-0">
                            {user.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-zinc-200 truncate">{user.name}</div>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {auditorRoles.length > 0 ? (
                              auditorRoles.map((r) => (
                                <span
                                  key={r}
                                  className="text-[9px] px-1.5 py-0.2 rounded font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20"
                                >
                                  {r}
                                </span>
                              ))
                            ) : nonAuditorRoles.length > 0 ? (
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                                {nonAuditorRoles[0]}
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-500 truncate">{user.email}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ml-2 transition-colors ${isSelected
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-zinc-600 bg-zinc-800'
                          }`}
                      >
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reset Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onConfirm={handleResetDefaults}
        title="Reset Shifts to Defaults?"
        itemName="All Custom Shift Changes"
        description="This will overwrite custom shifts with the standard 3 shifts: Morning (8–12), Afternoon (12–17), and Night (17–1). Are you sure?"
      />
    </div>
  );
}
