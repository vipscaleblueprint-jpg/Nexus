'use client';

import React from 'react';
import Link from 'next/link';
import {
  Rocket,
  Calendar as CalendarIcon,
  AlertTriangle,
  Plus,
  X,
  Pencil,
  Trash2,
  ExternalLink,
  Flag,
} from 'lucide-react';
import { LaunchMapAssignee, LaunchMapLightItem } from '@/api/taskMap';
import { LaunchAssigneeChips, LaunchTextWithLinks } from './LaunchTextWithLinks';

export interface EnrichedLaunchEntry {
  task: LaunchMapLightItem;
  dateKey: string | null;
  targetPeriod: string | null;
  isInReview: boolean;
  isMilestone: boolean;
  isClosed: boolean;
  isUrgent: boolean;
  clientName: string;
  workstream: string;
  details: string;
  notes: string;
  assignees: LaunchMapAssignee[];
  subStatuses: string[];
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
        className="w-full max-w-lg h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[var(--text)]">{formattedDate}</h2>
              {dateKey === todayKey && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--accent)] text-[var(--on-accent)]">
                  Today
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {entries.length} launch deliverable{entries.length === 1 ? '' : 's'}
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
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] cursor-pointer"
              aria-label="Close day drawer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-3">
          {entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center gap-2">
              <CalendarIcon className="size-8 text-[var(--muted)]/40" />
              <p className="text-xs font-medium text-[var(--muted)]">
                No launch dates scheduled for this date.
              </p>
              <button
                type="button"
                onClick={() => onAddTask(dateKey)}
                className="mt-1 px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:bg-[var(--hover-subtle)] text-xs font-semibold text-[var(--text)] cursor-pointer"
              >
                + Schedule Launch Deliverable
              </button>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.task.id}
                className={`rounded-xl border p-3.5 flex flex-col gap-2.5 transition-colors ${
                  entry.isInReview
                    ? 'border-orange-500/60 bg-orange-500/10 [.theme-light_&]:bg-orange-50 [.theme-light_&]:border-orange-300'
                    : entry.isMilestone
                    ? 'border-rose-500/45 bg-rose-500/[0.07] [.theme-light_&]:bg-rose-50 [.theme-light_&]:border-rose-300'
                    : 'border-[var(--border)] bg-[var(--bg)]'
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
                    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)]">
                        {entry.clientName}
                      </span>
                      {entry.workstream && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)]">
                          {entry.workstream}
                        </span>
                      )}
                      {entry.isUrgent && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/20 text-red-300 border border-red-500/40 [.theme-light_&]:bg-red-50 [.theme-light_&]:text-red-700 [.theme-light_&]:border-red-300">
                          <Flag className="size-2.5" />
                          URGENT
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
                      {entry.subStatuses.map((sub) => (
                        <span
                          key={sub}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]"
                        >
                          {sub}
                        </span>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenDetail(entry.task)}
                      className="text-left text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                    >
                      {entry.task.title}
                    </button>
                  </div>
                </div>

                {entry.details && (
                  <div className="text-xs text-[var(--text)]/90 bg-[var(--surface)]/70 rounded-lg px-2.5 py-2 border border-[var(--border)]/70">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-0.5">
                      Details
                    </span>
                    <LaunchTextWithLinks text={entry.details} />
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Assignees
                  </span>
                  <LaunchAssigneeChips assignees={entry.assignees} />
                </div>

                {entry.notes && (
                  <div className="text-xs text-[var(--muted)] bg-[var(--surface)]/70 rounded-lg px-2.5 py-2 border border-[var(--border)]/70">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-0.5">
                      Notes
                    </span>
                    <LaunchTextWithLinks text={entry.notes} />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border)]/70">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => onToggleMilestone(entry, e)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                        entry.isMilestone
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 [.theme-light_&]:bg-rose-100 [.theme-light_&]:text-rose-800 [.theme-light_&]:border-rose-300'
                          : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--text)]'
                      }`}
                      title="Toggle LAUNCH DATE status marker"
                    >
                      <Rocket className="size-3" />
                      <span>{entry.isMilestone ? 'LAUNCH DATE' : 'Mark Launch'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditTask(entry.task)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                    >
                      <Pencil className="size-3" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUnschedule(entry.task.id)}
                      className="p-1 rounded-md text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                      title="Remove from Launch Map"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {entry.task.listId && (
                      <Link
                        href={`/lists/${entry.task.listId}?task=${entry.task.id}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                        title="Open in Client Board"
                      >
                        <span>Board</span>
                        <ExternalLink className="size-3" />
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenDetail(entry.task)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--accent-tint)] text-[var(--accent)] hover:opacity-85 cursor-pointer"
                    >
                      <span>Open</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
