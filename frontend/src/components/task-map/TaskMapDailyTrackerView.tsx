'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  FileSpreadsheet,
  Lock,
  Users,
  RefreshCw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  TaskMapItem,
  DailySheetLogItem,
  taskMapApi,
} from '@/api/taskMap';
import { TaskMapSheetsView } from './TaskMapSheetsView';
import { hasCrmAccess } from '@/lib/permissions';

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
  onOpenDetail?: (task: TaskMapItem) => void;
  onRefresh?: () => void;
}

/**
 * Normalizes a user's Google Sheets URL so it loads directly inside an iframe
 * with full 1:1 editing, formulas, dropdowns, and Apps Script behavior.
 */
function toEmbeddableSheetUrl(rawUrl?: string | null): string | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.hostname.includes('docs.google.com') &&
      parsed.pathname.includes('/spreadsheets/d/')
    ) {
      const hasAction =
        parsed.pathname.includes('/edit') ||
        parsed.pathname.includes('/pubhtml') ||
        parsed.pathname.includes('/preview');
      if (!hasAction) {
        parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/edit`;
      }
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
  onOpenDetail,
  onRefresh,
}) => {
  const [viewScope, setViewScope] = useState<'PRIVATE' | 'TEAM'>('PRIVATE');
  const canViewAllMaSheets = useMemo(() => hasCrmAccess(currentUser), [currentUser]);
  const [dailySheetUrl, setDailySheetUrl] = useState<string | null>(
    currentUser?.dailySheetUrl || null
  );
  const [loadingConfig, setLoadingConfig] = useState<boolean>(false);
  const [iframeLoading, setIframeLoading] = useState<boolean>(true);
  const [iframeKey, setIframeKey] = useState<number>(0);

  const myDisplayName = useMemo(
    () => (currentUser?.name || currentUser?.email || '').trim(),
    [currentUser?.name, currentUser?.email]
  );

  // Fetch the logged-in user's personal dailySheetUrl from the DB
  useEffect(() => {
    if (!currentUser?.id) return;
    let active = true;
    setLoadingConfig(true);
    taskMapApi
      .getDailyScheduleConfig(currentUser.id)
      .then((res) => {
        if (active && res?.success) {
          setDailySheetUrl(res.dailySheetUrl || null);
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

  const embedUrl = useMemo(() => toEmbeddableSheetUrl(dailySheetUrl), [dailySheetUrl]);

  useEffect(() => {
    if (embedUrl) {
      setIframeLoading(true);
    }
  }, [embedUrl, iframeKey]);

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* SCOPE SWITCHER BAR (Private My Daily Tracker vs Team Sheets History) */}
      <div className="px-6 py-2 border-b border-zinc-800/80 bg-zinc-900/50 backdrop-blur-md flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
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
        </div>

        <div className="flex items-center gap-3">
          {viewScope === 'PRIVATE' && embedUrl && (
            <button
              type="button"
              onClick={() => setIframeKey((k) => k + 1)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
              title="Reload embedded spreadsheet"
            >
              <RefreshCw className={`size-3.5 ${iframeLoading ? 'animate-spin' : ''}`} />
              <span>Reload</span>
            </button>
          )}
        </div>
      </div>

      {/* MAIN CONTENT */}
      {viewScope === 'TEAM' && canViewAllMaSheets ? (
        <TaskMapSheetsView
          allTasks={allTasks}
          allUsers={allUsers}
          initialDate={initialDate}
          initialLogs={initialLogs}
          onOpenDetail={onOpenDetail}
          onRefreshBoard={onRefresh}
        />
      ) : loadingConfig && !embedUrl ? (
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
              Your account does not have a personal Google Daily Schedule URL linked yet. Add your sheet link in Settings to use the embedded spreadsheet here.
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
        <div className="relative flex-1 w-full h-full bg-zinc-950">
          {iframeLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xs pointer-events-none">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 shadow-lg">
                <Loader2 className="size-4 animate-spin text-emerald-400" />
                <span>Loading your spreadsheet...</span>
              </div>
            </div>
          )}
          <iframe
            key={`${embedUrl}-${iframeKey}`}
            src={embedUrl}
            title={`${myDisplayName || 'My'} Daily Schedule`}
            className="w-full h-full border-0 bg-white"
            allow="clipboard-read; clipboard-write"
            onLoad={() => setIframeLoading(false)}
          />
        </div>
      )}
    </div>
  );
};
