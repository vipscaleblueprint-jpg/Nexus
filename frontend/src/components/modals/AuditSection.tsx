import React, { useState, useEffect, useRef } from 'react';
import { Task, Checklist, ChecklistItem, User as UserModel } from '@/lib/types';
import { tasksApi } from '@/api/tasks';
import { ChevronDown, ChevronRight, User, Check } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { isNexusAuditChecklist, getRequiredAudits } from '@/lib/auditChecklist';
import { getAssigneeAvatarColor } from './TaskDetailModal';

export { getRequiredAudits };

interface AuditSectionProps {
  task: Task;
  title: string;
  subtaskId?: string; 
  users: UserModel[];
  checklists: Checklist[];
  onUpdateChecklists: (checklists: Checklist[]) => void;
  currentUser?: UserModel | null;
}

export function AuditSection({ task, title, subtaskId, users, checklists, onUpdateChecklists, currentUser }: AuditSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [highlightedAudits, setHighlightedAudits] = useState<string[] | null>(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleHighlight = (e: any) => {
      const detail = e.detail;
      if (detail?.subtaskId) {
        if (subtaskId !== detail.subtaskId) return;
      } else if (subtaskId) {
        if (detail?.taskId !== subtaskId) return;
      } else if (detail?.taskId && detail.taskId !== task.id) {
        return;
      }

      setIsExpanded(true);
      setIsShaking(true);
      setHighlightedAudits(detail?.uncheckedAudits || []);

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = setTimeout(() => {
        setIsShaking(false);
        setHighlightedAudits(null);
      }, 4000);

      setTimeout(() => {
        const el = document.getElementById(subtaskId ? `audit-box-${subtaskId}` : 'task-modal-audit-box');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    };

    window.addEventListener('task:highlight-audits', handleHighlight);
    window.addEventListener('task:focus-audits', handleHighlight);

    return () => {
      window.removeEventListener('task:highlight-audits', handleHighlight);
      window.removeEventListener('task:focus-audits', handleHighlight);
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [subtaskId, task.id]);


  // A task can end up with more than one Audit checklist (e.g. two clicks racing to create it).
  // Read items from all of them so an assignee or check saved on either one still shows.
  const auditChecklists = checklists.filter(c => {
    if (!isNexusAuditChecklist(c)) return false;
    if (subtaskId) {
      return c.subtaskId === subtaskId || !c.subtaskId;
    } else {
      return !c.subtaskId;
    }
  });
  const auditChecklist = auditChecklists[0];

  // Roles suggested by the auditor: from the specific "--Audit" subtask when one is targeted,
  // otherwise from the task's own roles plus every "--Audit" subtask attached to it
  // (the server's completion check uses the task's own roles too).
  const auditorRoles = subtaskId
    ? (task.subtasks?.find((s: any) => s.id === subtaskId)?.assigneeRoleRestrictions || [])
    : [
        ...(task.assigneeRoleRestrictions || []),
        ...(task.subtasks || [])
          .filter((s: any) => s.title?.toLowerCase().startsWith('--audit'))
          .flatMap((s: any) => s.assigneeRoleRestrictions || []),
      ];

  const requiredAuditItems = Array.from(new Set([
    ...getRequiredAudits(title, auditorRoles),
    ...auditChecklists.flatMap(c => c.items?.map(i => i.text) || [])
  ].filter((text, i, all) => all.findIndex(t => t.toLowerCase() === text.toLowerCase()) === i)));

  // Prefer the copy that carries state (assigned or checked) when duplicates exist.
  const getAuditItem = (text: string) => {
    const matches = auditChecklists.flatMap(c => c.items || []).filter(i => i.text.toLowerCase() === text.toLowerCase());
    return matches.find(i => i.assigneeId || i.completed) || matches[0];
  };

  const completedCount = requiredAuditItems.reduce((acc, text) => {
    const item = getAuditItem(text);
    return acc + (item?.completed ? 1 : 0);
  }, 0);

  const handleToggleItem = async (text: string, currentItem?: ChecklistItem) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      let targetChecklistId = currentItem?.checklistId || auditChecklist?.id;
      let newChecklists = [...checklists];

      if ((!currentItem || !currentItem.completed) && highlightedAudits) {
        const remaining = highlightedAudits.filter(
          t => t.toLowerCase() !== text.toLowerCase()
        );
        setHighlightedAudits(remaining.length === 0 ? null : remaining);
      }

      // Create checklist if it doesn't exist
      if (!targetChecklistId) {
        const res = await tasksApi.createChecklist(task.id, { 
          name: 'Audit', 
          subtaskId 
        });
        targetChecklistId = res.checklist.id;
        newChecklists.push(res.checklist);
        onUpdateChecklists(newChecklists);
      }

      // If item doesn't exist, create it (completed = true since we toggle from false)
      if (!currentItem) {
        const res = await tasksApi.createChecklistItem(task.id, targetChecklistId!, { text });
        const updatedItem = await tasksApi.updateChecklistItem(task.id, targetChecklistId!, res.item.id, { completed: true });
        
        newChecklists = newChecklists.map(c => {
          if (c.id === targetChecklistId) {
            return { ...c, items: [...(c.items || []), updatedItem.item] };
          }
          return c;
        });
        onUpdateChecklists(newChecklists);
      } else {
        // Optimistic update
        const newCompleted = !currentItem.completed;
        const optimisticChecklists = newChecklists.map(c => {
          if (c.id === targetChecklistId) {
            return {
              ...c,
              items: c.items.map(i => i.id === currentItem.id ? { ...i, completed: newCompleted } : i)
            };
          }
          return c;
        });
        onUpdateChecklists(optimisticChecklists);

        // API update
        await tasksApi.updateChecklistItem(task.id, targetChecklistId!, currentItem.id, { completed: newCompleted });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateAssignee = async (text: string, currentItem: ChecklistItem | undefined, assigneeId: string) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      let targetChecklistId = currentItem?.checklistId || auditChecklist?.id;
      let newChecklists = [...checklists];

      if (!targetChecklistId) {
        const res = await tasksApi.createChecklist(task.id, { name: 'Audit', subtaskId });
        targetChecklistId = res.checklist.id;
        newChecklists.push(res.checklist);
        onUpdateChecklists(newChecklists);
      }

      let itemId = currentItem?.id;
      if (!itemId) {
        const res = await tasksApi.createChecklistItem(task.id, targetChecklistId!, { text });
        itemId = res.item.id;
        newChecklists = newChecklists.map(c => {
          if (c.id === targetChecklistId) {
            return { ...c, items: [...(c.items || []), res.item] };
          }
          return c;
        });
        onUpdateChecklists(newChecklists);
      }

      // Optimistic
      const optimistic = newChecklists.map(c => {
        if (c.id === targetChecklistId) {
          return {
            ...c,
            items: c.items.map(i => i.id === itemId ? { ...i, assigneeId } : i)
          };
        }
        return c;
      });
      onUpdateChecklists(optimistic);

      await tasksApi.updateChecklistItem(task.id, targetChecklistId!, itemId!, { assigneeId });
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  // Tasks with nothing to audit (e.g. onboarding tasks created with skipAutoAudit) show no Audit section.
  if (requiredAuditItems.length === 0) return null;

  return (
    <div className={`w-full ${isExpanded ? 'mb-4' : 'mb-1'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between group cursor-pointer select-none ${isExpanded ? 'mb-3' : 'mb-0'}`} onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
          )}
          <span className="font-semibold text-zinc-100">Audit</span>
          <span className="text-xs text-zinc-500 ml-1 font-normal">
            {completedCount} of {requiredAuditItems.length} complete
          </span>
        </div>
      </div>

      {/* Checklists List */}
      {isExpanded && (
        <div className="flex flex-col gap-4">
          <div
            id={subtaskId ? `audit-box-${subtaskId}` : "task-modal-audit-box"}
            className={`bg-secondary/50 rounded-xl overflow-hidden transition-all duration-300 ${
              highlightedAudits
                ? 'border-2 border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
                : 'border border-zinc-800/80'
            } ${isShaking ? 'animate-shake' : ''}`}
          >
            {/* Checklist Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/40">
              <div className="font-medium text-sm text-zinc-200 flex items-center justify-between w-full">
                <span>Audit Items</span>
                <span className="text-xs text-zinc-500 font-normal">
                  {completedCount} of {requiredAuditItems.length}
                </span>
              </div>
            </div>

            {/* Items */}
            <div className="p-2 flex flex-col gap-0.5">
              {requiredAuditItems.map((text, idx) => {
                const item = getAuditItem(text);
                const isCompleted = !!item?.completed;
                const assigneeId = item?.assigneeId;
                const assignee = assigneeId ? users.find(u => u.id === assigneeId) : undefined;

                const isItemNeeded = Boolean(
                  highlightedAudits &&
                  !isCompleted &&
                  (highlightedAudits.length === 0 || highlightedAudits.some(a => a.toLowerCase() === text.toLowerCase()))
                );

                const roles = (currentUser?.roles || []).map(r => r?.toLowerCase() || '');
                const isAdmin = currentUser?.systemRole === 'ADMIN';

                let canCheck = isAdmin;
                let requiredRole = "";
                if (!canCheck) {
                  if (text === 'UI UX Audit') {
                    canCheck = roles.some(r => r.includes('ui/ux') || r.includes('ui ux') || r.includes('ui-ux'));
                    requiredRole = "UI/UX";
                  } else if (text === 'Design Audit') {
                    canCheck = roles.some(r => r.includes('design'));
                    requiredRole = "Designer";
                  } else if (text === 'Funnel Audit') {
                    canCheck = roles.some(r => r.includes('funnel') || r.includes('backend'));
                    requiredRole = "Funnel/Backend";
                  } else if (text === 'Instructions Audit') {
                    canCheck = true;
                  }
                }

                return (
                  <div 
                    key={idx} 
                    className={`flex items-center justify-between py-1.5 px-2 group/item rounded-lg transition-colors ${
                      isItemNeeded
                        ? 'bg-zinc-800/40 border border-emerald-500/30 shadow-sm my-0.5'
                        : 'hover:bg-accent/30'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button 
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${!canCheck || isProcessing ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${
                          isCompleted
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : isItemNeeded
                            ? 'border-emerald-500 bg-emerald-500/20'
                            : 'border-zinc-600 bg-zinc-800/40 hover:border-zinc-400 hover:bg-zinc-800'
                        }`}
                        onClick={() => {
                          if (canCheck) {
                            handleToggleItem(text, item);
                          }
                        }}
                        title={!canCheck ? `Only ${requiredRole || 'Admins'} can check this item` : "Click to check audit"}
                        disabled={isProcessing || !canCheck}
                      >
                        {isCompleted && <Check className="w-2.5 h-2.5" />}
                      </button>
                      <span className={`text-sm truncate ${
                        isCompleted
                          ? 'text-muted-foreground line-through'
                          : isItemNeeded
                          ? 'font-medium text-zinc-100'
                          : 'text-foreground'
                      }`}>
                        {text}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isItemNeeded && (
                        <span className="text-[10px] uppercase font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 tracking-wider shrink-0">
                          Required
                        </span>
                      )}

                      {/* Assignee */}
                      <Popover.Root>
                        <Popover.Trigger asChild>
                          <button className="w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border-hover cursor-pointer" disabled={isProcessing}>
                            {assignee?.avatarUrl ? (
                              <img src={assignee.avatarUrl} alt={assignee.name} title={assignee.name} className="w-full h-full rounded-full object-cover" />
                            ) : assigneeId ? (
                              <div title={assignee?.name} className={`w-full h-full rounded-full flex items-center justify-center text-[9px] text-white font-bold ${getAssigneeAvatarColor(assignee?.name || assigneeId)}`}>
                                {assignee?.name?.substring(0, 2).toUpperCase() || <User className="w-3 h-3" />}
                              </div>
                            ) : (
                              <User className="w-3 h-3" />
                            )}
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content className="z-[100] w-56 rounded-lg bg-popover border border-border p-2 shadow-xl outline-none" align="end" sideOffset={5}>
                            <div className="text-xs font-medium text-muted-foreground mb-2 px-1">Assign to</div>
                            <div className="max-h-60 overflow-y-auto">
                              <button 
                                className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground rounded flex items-center gap-2 mb-1 cursor-pointer"
                                onClick={() => handleUpdateAssignee(text, item, '')}
                              >
                                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center"><User className="w-3 h-3 text-muted-foreground" /></div>
                                Unassigned
                              </button>
                              {users.filter(u => {
                                const uRoles = (u.roles || []).map(r => r?.toLowerCase() || '');
                                if (text === 'UI UX Audit') return uRoles.some(r => r.includes('ui/ux') || r.includes('ui ux') || r.includes('ui-ux'));
                                if (text === 'Design Audit') return uRoles.some(r => r.includes('design'));
                                if (text === 'Funnel Audit') return uRoles.some(r => r.includes('funnel') || r.includes('backend'));
                                return true;
                              }).map(u => (
                                <button 
                                  key={u.id}
                                  className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground rounded flex items-center gap-2 cursor-pointer"
                                  onClick={() => handleUpdateAssignee(text, item, u.id)}
                                >
                                  {u.avatarUrl ? (
                                    <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                                  ) : (
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] text-white font-bold ${getAssigneeAvatarColor(u.name || u.id)}`}>
                                      {u.name?.substring(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                  <span className="flex-1 truncate">{u.name}</span>
                                  {u.id === assigneeId && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                                </button>
                              ))}
                            </div>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
