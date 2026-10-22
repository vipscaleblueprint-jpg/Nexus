'use client';

import React, { useEffect, useState, useRef } from 'react';
import { AlignLeft, CheckCircle2, Flag, Shield, Users2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { loadTask } from '@/lib/taskBatchLoader';
import { getStatusColor } from '@/components/editor/nodes/TaskMentionNode';
import { CustomCircleDot, CustomCircleDotted } from '@/components/modals/TaskDetailModal';
import { getPriorityConfig } from '@/lib/priority';
import { PortalDropdown } from '@/components/ui/PortalDropdown';
import { sanitizeHtml } from '@/components/docs/docTransfer';

interface TaskMentionChipProps {
  taskId: string;
  mentionType?: 'task' | 'subtask' | 'status' | string;
  parentTaskId?: string;
  initialLabel?: string;
  attrs?: Record<string, any>;
  className?: string;
}

export function TaskMentionChip({
  taskId,
  mentionType = 'task',
  parentTaskId,
  initialLabel,
  attrs = {},
  className = '',
}: TaskMentionChipProps) {
  const isSubtask = mentionType === 'subtask' || Boolean(parentTaskId);
  const globalTask = useAppStore(s => s.tasksIndex[taskId]);
  const [taskData, setTaskData] = useState<any>(globalTask || null);
  const [isTitleHovered, setIsTitleHovered] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'description' | null>(null);
  const descTriggerRef = useRef<HTMLSpanElement>(null);

  // Sync with global store if present
  useEffect(() => {
    if (globalTask) {
      setTaskData(globalTask);
    }
  }, [globalTask]);

  // Load task or subtask data via batched loader if not in store
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;

    if (!globalTask) {
      loadTask(taskId)
        .then(({ task, subtask }) => {
          if (cancelled) return;
          if (subtask && isSubtask) {
            setTaskData(subtask);
          } else if (task) {
            setTaskData(task);
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [taskId, globalTask, isSubtask]);

  // Extract attributes (fallback to attrs if live data is still loading)
  const resolvedTitle = taskData?.title || taskData?.name || initialLabel || attrs['data-label'] || attrs.label || 'Task';
  const rawStatus = taskData?.status || attrs['data-task-status'] || '';
  let statusName = rawStatus;
  let statusColor = '#3b82f6';

  if (rawStatus) {
    if (typeof rawStatus === 'string' && rawStatus.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawStatus);
        statusName = parsed.name || parsed.NAME || rawStatus;
        statusColor = parsed.color || parsed.COLOR || getStatusColor(statusName);
      } catch {
        statusName = rawStatus;
        statusColor = getStatusColor(statusName);
      }
    } else {
      statusName = rawStatus;
      statusColor = getStatusColor(statusName);
    }
  }

  const priority = taskData?.priority || attrs['data-task-priority'] || attrs.taskPriority || '';
  let assignees: any[] = taskData?.assignees || [];
  if (assignees.length === 0 && (attrs['data-task-assignees'] || attrs.taskAssignees)) {
    try {
      assignees = JSON.parse(attrs['data-task-assignees'] || attrs.taskAssignees);
    } catch {}
  }

  let roleRestrictions: string[] = taskData?.assigneeRoleRestrictions || [];

  const isClosed = ['CLOSED', 'DONE'].includes((statusName || '').toUpperCase());
  const chipBg = isSubtask
    ? 'bg-[var(--task-chip-sub)] hover:bg-[var(--task-chip-sub)]/80'
    : 'bg-[var(--task-chip)] hover:bg-[var(--task-chip)]/80';
  const chipRing = isSubtask ? 'border-[var(--task-chip-sub)]' : 'border-[var(--task-chip)]';

  const titleClass = `cursor-pointer border-b pb-[1px] transition-all duration-300 align-middle ${
    isTitleHovered ? 'border-zinc-500' : 'border-transparent'
  } ${isSubtask ? 'text-[13px] font-normal text-zinc-400' : 'text-[15px] font-medium text-zinc-100'}`;

  const openTask = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('open-task-detail', {
        detail: {
          taskId: parentTaskId && isSubtask ? parentTaskId : taskId,
          subtaskId: isSubtask ? taskId : undefined,
          task: taskData,
        },
      })
    );
  };

  const titleProps = {
    title: resolvedTitle ? `${resolvedTitle} (Click to open)` : 'Open Task Detail',
    onMouseEnter: () => setIsTitleHovered(true),
    onMouseLeave: () => setIsTitleHovered(false),
    onClick: openTask,
  };

  return (
    <span className={`inline-block align-middle my-0.5 mx-0.5 select-none max-w-full ${className}`}>
      <span
        className={`relative inline-flex items-center align-middle px-1.5 py-[2px] rounded-md transition-all duration-300 max-w-full leading-relaxed ${chipBg} ${
          isClosed ? 'opacity-75' : ''
        }`}
      >
        {isClosed && (
          <div className="absolute top-1/2 left-1.5 right-1.5 h-[1.5px] bg-zinc-500/70 -translate-y-1/2 pointer-events-none z-50 rounded-full" />
        )}

        {/* Status circle icon */}
        <span
          className="inline-flex items-center justify-center shrink-0 cursor-pointer mr-1.5 align-middle transition-transform duration-300 hover:scale-110 relative z-10"
          title="Open Task Detail"
          onClick={openTask}
        >
          {isClosed ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor, fill: 'transparent' }} />
          ) : (statusName || '').toUpperCase() === 'KYC' ? (
            <CustomCircleDotted className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor }} />
          ) : (
            <CustomCircleDot className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor }} />
          )}
        </span>

        {/* Task Title */}
        <span
          className={`${titleClass} mr-1.5 truncate max-w-[220px] sm:max-w-[340px] md:max-w-[440px] shrink min-w-[50px]`}
          {...titleProps}
        >
          {resolvedTitle}
        </span>

        {/* Controls */}
        <span className="whitespace-nowrap inline-flex items-center shrink-0">

          {/* Deliverables AlignLeft icon */}
          <span
            ref={descTriggerRef}
            className="cursor-pointer hover:opacity-70 transition-opacity inline-flex items-center justify-center p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 rounded mr-1.5 align-middle"
            onClick={(e) => {
              e.stopPropagation();
              setOpenDropdown(openDropdown === 'description' ? null : 'description');
            }}
            title="Task Deliverables"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </span>

          {/* Status pill badge */}
          {statusName && (
            <span
              className={`px-2 py-[3px] rounded text-[10px] font-bold uppercase tracking-wider text-white shrink-0 mr-1.5 inline-flex items-center align-middle leading-none ${
                isSubtask ? 'opacity-60' : ''
              }`}
              style={{ backgroundColor: statusColor }}
              title={`Status: ${statusName}`}
            >
              {statusName}
            </span>
          )}

          {/* Priority flag */}
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700/50 transition-colors mr-1.5 align-middle cursor-default"
            title={priority ? `${getPriorityConfig(priority).label} Priority` : 'No Priority'}
          >
            <Flag
              className={`w-3.5 h-3.5 shrink-0 ${
                priority ? getPriorityConfig(priority).iconColor : 'text-zinc-400 dark:text-zinc-500'
              }`}
            />
          </span>

          {/* Role badge */}
          <span className="inline-flex items-center justify-center shrink-0 mr-1.5 align-middle">
            {roleRestrictions && roleRestrictions.length > 0 ? (
              roleRestrictions.slice(0, 2).map((role: string, i: number) => {
                const colors = ['bg-purple-500', 'bg-red-500', 'bg-emerald-500', 'bg-blue-500', 'bg-amber-500'];
                const bgColor = colors[i % colors.length];
                return (
                  <div
                    key={role}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white border-2 ${chipRing} ${
                      i > 0 ? '-ml-2' : ''
                    } relative ${bgColor}`}
                    style={{ zIndex: 10 - i }}
                    title={role}
                  >
                    {role.substring(0, 2).toUpperCase()}
                  </div>
                );
              })
            ) : (
              <span className="w-5 h-5 rounded border border-zinc-700 border-dashed text-zinc-400 flex items-center justify-center bg-transparent z-10 shrink-0">
                <Shield className="w-3 h-3" />
              </span>
            )}
          </span>

          {/* Assignees */}
          <span className="inline-flex items-center -space-x-1 shrink-0 align-middle">
            {assignees.length > 0 ? (
              assignees.slice(0, 3).map((user: any, i: number) => (
                <span
                  key={user.id || i}
                  className={`w-5 h-5 rounded-full overflow-hidden border-2 ${chipRing} z-10 shrink-0 bg-zinc-200 dark:bg-zinc-600 flex items-center justify-center relative`}
                  style={{ zIndex: 10 - i, marginLeft: i > 0 ? '-4px' : '0' }}
                  title={user.name || 'Assignee'}
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover rounded-full" />
                  ) : (
                    <span className="text-[9px] font-medium text-zinc-700 dark:text-zinc-300">
                      {user.name?.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
              ))
            ) : (
              <span className="w-5 h-5 rounded border border-zinc-700 border-dashed text-zinc-400 flex items-center justify-center bg-transparent z-10 shrink-0">
                <Users2 className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
              </span>
            )}
          </span>
        </span>
      </span>
      <span className="pl-1 cursor-text">&#8203;</span>

      {/* Deliverables Popover */}
      {openDropdown === 'description' && (
        <PortalDropdown triggerRef={descTriggerRef} onClose={() => setOpenDropdown(null)}>
          <div className="w-64 p-3 bg-popover border border-border rounded-xl shadow-2xl text-zinc-100">
            <div className="font-semibold mb-1.5 text-xs text-zinc-300 uppercase tracking-wider">Deliverables:</div>
            <div
              className="text-sm text-zinc-300 prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{
                __html: taskData?.description
                  ? sanitizeHtml(taskData.description).body.innerHTML
                  : 'No deliverables specified.',
              }}
            />
          </div>
        </PortalDropdown>
      )}
    </span>
  );
}
