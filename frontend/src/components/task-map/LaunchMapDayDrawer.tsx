'use client';

import React from 'react';
import {
  Rocket,
  Calendar as CalendarIcon,
  AlertTriangle,
  Plus,
  X,
  Pencil,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { LaunchMapLightItem } from '@/api/taskMap';

export interface EnrichedLaunchEntry {
  task: LaunchMapLightItem;
  dateKey: string;
  isInReview: boolean;
  isMilestone: boolean;
  isClosed: boolean;
  clientName: string;
  workstream: string;
  notes: string;
  statusColor: string;
  canonicalStatus: string;
}

interface LaunchMapDayDrawerProps {
  dateKey: string;
  todayKey: string;
  formattedDate: string;
  entries: EnrichedLaunchEntry[];
  onClose: () => void;
  onAddTask: (dateKey: string) => void;
  onEditTask: (task: LaunchMapLightItem) => void;
  onOpenDetail: (task: LaunchMapLightItem) => void;
  onToggleMilestone: (entry: EnrichedLaunchEntry, e: React.MouseEvent) => void;
  onUnschedule: (taskId: string) => void;
}

export const LaunchMapDayDrawer: React.FC<LaunchMapDayDrawerProps> = ({
  dateKey,
  todayKey,
  formattedDate,
  entries,
  onClose,
  onAddTask,
  onEditTask,
  onOpenDetail,
  onToggleMilestone,
  onUnschedule,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[1px] animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-foreground">{formattedDate}</h2>
              {dateKey === todayKey && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--accent)] text-[var(--on-accent)]">
                  Today
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {entries.length} scheduled deliverable{entries.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onAddTask(dateKey)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--accent)] hover:opacity-90 text-[var(--on-accent)] text-xs font-semibold cursor-pointer"
            >
              <Plus className="size-3.5" />
              <span>Add Task</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
              aria-label="Close day drawer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-2.5">
          {entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center gap-2">
              <CalendarIcon className="size-8 text-muted-foreground/40" />
              <p className="text-xs font-medium text-muted-foreground">
                Nothing scheduled for this date.
              </p>
              <button
                type="button"
                onClick={() => onAddTask(dateKey)}
                className="mt-1 px-3 py-1.5 rounded-lg bg-card border border-border hover:bg-muted text-xs font-semibold text-foreground cursor-pointer"
              >
                + Schedule Launch Deliverable
              </button>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.task.id}
                className={`rounded-xl border p-3.5 flex flex-col gap-2 transition-colors ${
                  entry.isInReview
                    ? 'border-orange-500/60 bg-orange-500/10 [.theme-light_&]:bg-orange-50 [.theme-light_&]:border-orange-300'
                    : entry.isMilestone
                    ? 'border-rose-500/50 bg-rose-500/10 [.theme-light_&]:bg-rose-50 [.theme-light_&]:border-rose-300'
                    : 'border-border bg-card'
                }`}
              >
                {entry.isInReview && (
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-300 [.theme-light_&]:text-orange-800">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    <span>IN REVIEW — PM &amp; Auditor alert active</span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">
                        {entry.clientName}
                      </span>
                      {entry.workstream && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">
                          {entry.workstream}
                        </span>
                      )}
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border"
                        style={{
                          backgroundColor: `${entry.statusColor}20`,
                          color: entry.statusColor,
                          borderColor: `${entry.statusColor}45`,
                        }}
                      >
                        {entry.canonicalStatus}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenDetail(entry.task)}
                      className="text-left text-sm font-semibold text-foreground hover:text-[var(--accent)] transition-colors cursor-pointer"
                    >
                      {entry.task.title}
                    </button>
                  </div>
                </div>

                {entry.notes && (
                  <p className="text-xs text-muted-foreground bg-background/60 rounded-lg px-2.5 py-1.5 border border-border/60">
                    {entry.notes}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => onToggleMilestone(entry, e)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                        entry.isMilestone
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 [.theme-light_&]:bg-rose-100 [.theme-light_&]:text-rose-800 [.theme-light_&]:border-rose-300'
                          : 'bg-background text-muted-foreground border-border hover:text-foreground'
                      }`}
                      title="Toggle LAUNCH DATE milestone badge"
                    >
                      <Rocket className="size-3" />
                      <span>{entry.isMilestone ? 'LAUNCH DATE' : 'Mark Launch'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditTask(entry.task)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-background border border-border text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <Pencil className="size-3" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUnschedule(entry.task.id)}
                      className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                      title="Remove from Launch Map"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenDetail(entry.task)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--accent-tint)] text-[var(--accent)] hover:opacity-85 cursor-pointer"
                  >
                    <span>Open</span>
                    <ExternalLink className="size-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
