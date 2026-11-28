'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  FileSpreadsheet,
  Lock,
  Users,
  RefreshCw,
  Loader2,
  AlertCircle,
  Filter,
  Target,
  ExternalLink,
  Settings,
} from 'lucide-react';
import {
  TaskMapItem,
  DailySheetLogItem,
  DailyScheduleSheetMetadata,
  taskMapApi,
} from '@/api/taskMap';
import { TaskMapSheetsView } from './TaskMapSheetsView';
import { hasCrmAccess } from '@/lib/permissions';
import { toast } from '@/lib/toast';

export type SheetFilterOption = 'today' | 'week' | 'month' | 'all';

interface Props {
  tasks: TaskMapItem[];
  allTasks?: TaskMapItem[];
  allUsers?: any[];
  currentUser?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    dailySheetUrl?: string | null;
    systemRole?: string | null;
    roles?: string[];
  } | null;
  initialDate?: string;
  initialLogs?: DailySheetLogItem[];
  clients?: Array<{ id?: string; name: string }>;
  isActive?: boolean;
  onOpenDetail?: (task: TaskMapItem) => void;
  onRefresh?: () => void;
}

/**
 * Normalizes a user's Google Sheets URL so it loads directly inside an iframe
 * with full 1:1 editing, formulas, dropdowns, and Apps Script behavior.
 */
export function toEmbeddableSheetUrl(rawUrl?: string | null): string | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.hostname.includes('docs.google.com') &&
      parsed.pathname.includes('/spreadsheets/d/')
    ) {
      let gid = parsed.searchParams.get('gid');
      if (!gid && parsed.hash) {
        const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
        gid = hashParams.get('gid');
      }
      if (!gid) {
        gid = '0';
      }

      // Ensure /edit pathname
      const hasAction =
        parsed.pathname.includes('/edit') ||
        parsed.pathname.includes('/pubhtml') ||
        parsed.pathname.includes('/preview');
      if (!hasAction) {
        parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/edit`;
      }

      parsed.searchParams.set('gid', gid);
      parsed.hash = `gid=${gid}`;

      return parsed.toString();
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

export const TaskMapDailyTrackerView: React.FC<Props> = ({
  allTasks = [],
  allUsers = [],
  currentUser,
  initialDate,
  initialLogs,
  isActive = true,
  onOpenDetail,
  onRefresh,
}) => {
  const [viewScope, setViewScope] = useState<'PRIVATE' | 'TEAM'>('PRIVATE');
  const canViewAllMaSheets = useMemo(() => hasCrmAccess(currentUser), [currentUser]);
  const [dailySheetUrl, setDailySheetUrl] = useState<string | null>(() => {
    if (currentUser?.dailySheetUrl) return currentUser.dailySheetUrl;
    if (typeof window !== 'undefined' && currentUser?.id) {
      try {
        return localStorage.getItem(`nexus_daily_sheet_url:${currentUser.id}`) || null;
      } catch {
        return null;
      }
    }
    return null;
  });
  const [loadingConfig, setLoadingConfig] = useState<boolean>(false);
  const [iframeLoading, setIframeLoading] = useState<boolean>(true);
  const [iframeKey, setIframeKey] = useState<number>(0);

  // Sheet filter: "today(default), week, month, all"
  const [sheetFilter, setSheetFilter] = useState<SheetFilterOption>('today');
  const [metadata, setMetadata] = useState<DailyScheduleSheetMetadata | null>(null);
  const [filteringInProgress, setFilteringInProgress] = useState<boolean>(false);

  // Optional Apps Script Web App URL for remote-triggering spreadsheet filter
  const [scriptAppUrl, setScriptAppUrl] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && currentUser?.id) {
      try {
        return localStorage.getItem(`nexus_sheet_script_url:${currentUser.id}`) || null;
      } catch {
        return null;
      }
    }
    return null;
  });
  const [showScriptConfig, setShowScriptConfig] = useState<boolean>(false);
  const [draftScriptUrl, setDraftScriptUrl] = useState<string>('');

  const myDisplayName = useMemo(
    () => (currentUser?.name || currentUser?.email || '').trim(),
    [currentUser?.name, currentUser?.email]
  );

  // Fetch the logged-in user's personal dailySheetUrl & dailySheetScriptUrl from the DB and cache them
  useEffect(() => {
    if (!currentUser?.id) return;
    const cacheKey = `nexus_daily_sheet_url:${currentUser.id}`;
    const scriptCacheKey = `nexus_sheet_script_url:${currentUser.id}`;
    let active = true;
    setLoadingConfig((prev) => (dailySheetUrl ? prev : true));
    taskMapApi
      .getDailyScheduleConfig(currentUser.id)
      .then((res) => {
        if (active && res?.success) {
          const nextUrl = res.dailySheetUrl || null;
          setDailySheetUrl((prev) => (prev === nextUrl ? prev : nextUrl));
          const nextScriptUrl = res.dailySheetScriptUrl || null;
          setScriptAppUrl(nextScriptUrl);
          try {
            if (nextUrl) localStorage.setItem(cacheKey, nextUrl);
            else localStorage.removeItem(cacheKey);
            if (nextScriptUrl) localStorage.setItem(scriptCacheKey, nextScriptUrl);
            else localStorage.removeItem(scriptCacheKey);
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingConfig(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser?.id]);

  // Load active task info once on mount or opening from local / initial logs (zero API overhead)
  const resolveCurrentTaskFromLogs = useCallback(() => {
    if (!initialLogs || initialLogs.length === 0) return;
    let todayKey = '';
    try {
      todayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      todayKey = new Date().toISOString().split('T')[0];
    }
    const todayLogs = initialLogs.filter((l) => l.dateKey === todayKey && l.sheetRow && l.sheetRow > 0);
    const liveLog = todayLogs.find((l) => l.isLive) || todayLogs[todayLogs.length - 1];
    if (liveLog?.sheetRow) {
      setMetadata({
        spreadsheetId: '',
        gid: '0',
        todayKey,
        weekStartKey: '',
        monthStartKey: '',
        currentTaskRow: liveLog.sheetRow,
        currentTask: {
          row: liveLog.sheetRow,
          date: liveLog.dateKey,
          timeIn: liveLog.timeIn,
          timeOut: liveLog.timeOut,
          client: liveLog.client,
          task: liveLog.taskName,
          isLive: liveLog.isLive,
        },
        todayRange: {
          startRow: todayLogs[0].sheetRow!,
          endRow: todayLogs[todayLogs.length - 1].sheetRow!,
        },
        weekRange: null,
        monthRange: null,
        totalRows: initialLogs.length,
        source: 'INITIAL_LOGS',
      });
    }
  }, [initialLogs]);

  useEffect(() => {
    resolveCurrentTaskFromLogs();
  }, [resolveCurrentTaskFromLogs]);

  // Stable embed URL (does NOT reload when filter changes)
  const embedUrl = useMemo(() => toEmbeddableSheetUrl(dailySheetUrl), [dailySheetUrl]);

  useEffect(() => {
    if (embedUrl) {
      setIframeLoading(true);
    }
  }, [embedUrl, iframeKey]);

  // Handle Sheet Filter selection: connects to the spreadsheet's Apps Script
  const handleSelectFilter = async (f: SheetFilterOption) => {
    setSheetFilter(f);

    const filterLabels: Record<SheetFilterOption, string> = {
      today: 'Today (Default)',
      week: 'This Week (Mon-Sat)',
      month: 'This Month',
      all: 'Show All Rows',
    };

    setFilteringInProgress(true);
    try {
      // 1. Trigger via server-side proxy (bypasses browser CORS & validates response from Apps Script)
      const res = await taskMapApi.triggerSheetFilter({
        filter: f,
        scriptUrl: scriptAppUrl || undefined,
      });

      if (res?.success) {
        const details = res.result;
        const countInfo = details?.matchedRows != null ? ` (${details.matchedRows} tasks visible)` : '';
        toast.success(`Filter applied: ${filterLabels[f]}${countInfo}`);
        return;
      }
      throw new Error(res?.error || 'Server trigger did not succeed');
    } catch (err: any) {
      console.warn('[DailyTracker] Sheet filter trigger failed:', err);
      const errMsg = err?.message || 'Could not apply filter. Please check your Apps Script deployment.';
      toast.error(errMsg);
      if (!scriptAppUrl || errMsg.includes('Apps Script') || errMsg.includes('doGet') || errMsg.includes('deployment')) {
        setShowScriptConfig(true);
      }
    } finally {
      setFilteringInProgress(false);
    }
  };

  const handleSaveScriptUrl = async () => {
    const trimmed = draftScriptUrl.trim();
    if (!currentUser?.id) return;
    const cacheKey = `nexus_sheet_script_url:${currentUser.id}`;
    try {
      if (trimmed) {
        localStorage.setItem(cacheKey, trimmed);
        setScriptAppUrl(trimmed);
      } else {
        localStorage.removeItem(cacheKey);
        setScriptAppUrl(null);
      }
      await taskMapApi.updateDailyScheduleConfig({
        userId: currentUser.id,
        dailySheetScriptUrl: trimmed || undefined,
      });
      toast.success(trimmed ? 'Apps Script Web App connected & saved!' : 'Apps Script Web App disconnected.');
    } catch {
      toast.success(trimmed ? 'Apps Script Web App connected locally!' : 'Apps Script Web App disconnected.');
    }
    setShowScriptConfig(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* SCOPE SWITCHER & SHEET FILTER BAR */}
      <div className="px-6 py-2 border-b border-zinc-800/80 bg-zinc-900/50 backdrop-blur-md flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewScope('PRIVATE')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                viewScope === 'PRIVATE'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <Lock className="size-3" />
              <span>My Daily Tracker</span>
            </button>
            {canViewAllMaSheets && (
              <button
                type="button"
                onClick={() => setViewScope('TEAM')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  viewScope === 'TEAM'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <Users className="size-3" />
                <span>All MAs (Sheets)</span>
              </button>
            )}
          </div>

          {viewScope === 'PRIVATE' && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 border border-zinc-700 text-zinc-300"
              title="Private to your account"
            >
              <Lock className="size-2.5 text-emerald-400" />
              Private{myDisplayName ? ` • ${myDisplayName}` : ''}
            </span>
          )}

          {/* SHEET FILTER: "today (default), week, month, all" */}
          {viewScope === 'PRIVATE' && embedUrl && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-xs">
                <span className="text-[11px] font-medium text-zinc-400 pl-2 pr-1 select-none flex items-center gap-1">
                  <Filter className="size-3 text-emerald-400" />
                  <span className="hidden sm:inline">Sheet:</span>
                </span>
                {(['today', 'week', 'month', 'all'] as SheetFilterOption[]).map((f) => {
                  const isSelected = sheetFilter === f;
                  const label =
                    f === 'today' ? 'Today' : f === 'week' ? 'Week' : f === 'month' ? 'Month' : 'All';
                  return (
                    <button
                      key={f}
                      type="button"
                      disabled={filteringInProgress}
                      onClick={() => void handleSelectFilter(f)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer disabled:opacity-50 ${
                        isSelected
                          ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                      title={
                        f === 'today'
                          ? 'Today (default) • Only show today tasks & jump to current task'
                          : f === 'week'
                          ? 'This Week • Only show whole week (Mon-Saturday)'
                          : f === 'month'
                          ? 'This Month • Only show current month rows'
                          : 'All • Show all spreadsheet rows'
                      }
                    >
                      {label}
                      {f === 'today' && (
                        <span className="ml-1 text-[10px] opacity-80">(default)</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Current Task row auto-scroll badge */}
              {metadata?.currentTaskRow && metadata.currentTaskRow > 1 && (
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300"
                  title={`Current working task on today: Row ${metadata.currentTaskRow}`}
                >
                  <span
                    className={`size-2 rounded-full ${
                      metadata.currentTask?.isLive
                        ? 'bg-emerald-400 animate-pulse'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <Target className="size-3 text-emerald-400" />
                  <span className="font-semibold text-zinc-200">
                    Row {metadata.currentTaskRow}
                  </span>
                  {metadata.currentTask?.isLive && (
                    <span className="text-[10px] text-emerald-400 font-medium">Live</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right actions: Apps Script connect + Open in Google Sheets + Reload */}
        <div className="flex items-center gap-2">
          {viewScope === 'PRIVATE' && (
            <button
              type="button"
              onClick={() => {
                setDraftScriptUrl(scriptAppUrl || '');
                setShowScriptConfig(!showScriptConfig);
              }}
              className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                scriptAppUrl
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
              title="Apps Script Web App Connection (for 1-click remote filter execution)"
            >
              <Settings className="size-3.5" />
            </button>
          )}

          {viewScope === 'PRIVATE' && dailySheetUrl && (
            <a
              href={dailySheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
              title="Open spreadsheet in new Google Sheets tab"
            >
              <ExternalLink className="size-3.5 text-zinc-400" />
              <span className="hidden sm:inline">Open in Sheets</span>
            </a>
          )}

          {viewScope === 'PRIVATE' && embedUrl && (
            <button
              type="button"
              onClick={() => {
                setIframeKey((k) => k + 1);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
              title="Reload embedded spreadsheet"
            >
              <RefreshCw className={`size-3.5 ${iframeLoading ? 'animate-spin' : ''}`} />
              <span>Reload</span>
            </button>
          )}
        </div>
      </div>

      {/* APPS SCRIPT WEB APP CONFIG POPUP */}
      {showScriptConfig && (
        <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-md flex items-center justify-between gap-4 flex-wrap text-xs animate-in fade-in duration-150">
          <div className="flex-1 min-w-[280px] max-w-2xl space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-200">Apps Script Web App Connection</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                Optional
              </span>
            </div>
            <p className="text-zinc-400 text-[11px]">
              Paste your deployed Google Apps Script Web App URL below (e.g. from{' '}
              <span className="text-zinc-300 font-mono">Deploy &gt; Web App</span>). This allows
              Nexus filter buttons to trigger sheet row hiding instantly without any iframe reload.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="url"
                value={draftScriptUrl}
                onChange={(e) => setDraftScriptUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={handleSaveScriptUrl}
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setShowScriptConfig(false)}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      {viewScope === 'TEAM' && canViewAllMaSheets && (
        <TaskMapSheetsView
          allTasks={allTasks}
          allUsers={allUsers}
          initialDate={initialDate}
          initialLogs={initialLogs}
          onOpenDetail={onOpenDetail}
          onRefreshBoard={onRefresh}
        />
      )}

      <div
        className={
          viewScope === 'TEAM' && canViewAllMaSheets
            ? 'hidden'
            : 'flex-1 flex flex-col min-h-0 h-full'
        }
      >
        {loadingConfig && !embedUrl ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400 text-xs">
            <Loader2 className="size-6 animate-spin text-emerald-400" />
            <span>Loading your Daily Schedule spreadsheet...</span>
          </div>
        ) : !embedUrl ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="size-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500">
              <FileSpreadsheet className="size-6" />
            </div>
            <div className="space-y-1 max-w-md">
              <h3 className="text-sm font-semibold text-zinc-200">No Daily Sheet Configured</h3>
              <p className="text-xs text-zinc-400">
                Your account does not have a personal Google Daily Schedule URL linked yet. Add your
                sheet link in Settings to use the embedded spreadsheet here.
              </p>
            </div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors"
            >
              <AlertCircle className="size-3.5" />
              <span>Configure in Settings</span>
            </Link>
          </div>
        ) : (
          <div className="relative flex-1 min-h-0 w-full h-full bg-zinc-950">
            {iframeLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xs pointer-events-none">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 shadow-lg">
                  <Loader2 className="size-4 animate-spin text-emerald-400" />
                  <span>Loading spreadsheet...</span>
                </div>
              </div>
            )}
            <iframe
              key={`${embedUrl}-${iframeKey}`}
              src={embedUrl}
              title={`${myDisplayName || 'My'} Daily Schedule`}
              className="absolute inset-0 w-full h-full border-0 bg-white"
              allow="clipboard-read; clipboard-write"
              onLoad={() => setIframeLoading(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
