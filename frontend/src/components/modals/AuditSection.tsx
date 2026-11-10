/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Task, Checklist, ChecklistItem, User as UserModel } from '@/lib/types';
import { tasksApi } from '@/api/tasks';
import { ChevronDown, ChevronRight, User, Check, Plus, Trash2 } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { isNexusAuditChecklist, getRequiredAudits, getAiPickedAudits, ALL_AUDIT_OPTIONS, isAuditorFor } from '@/lib/auditChecklist';
import { isProjectManagerOrAdmin } from '@/lib/permissions';
import { getAssigneeAvatarColor, isSystemUser } from '@/lib/taskTokens';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';

export { getRequiredAudits, ALL_AUDIT_OPTIONS };

// TEMPORARY TOGGLES: Hidden per user request until process is finalized. Set to false to restore.
export const HIDE_AUDIT_DELETE = false;
export const HIDE_ADD_AUDIT = true;
export const HIDE_DESIGN_AUDIT = true;

export const normalizeAuditName = (name: string) => {
  const clean = (name || '').trim().toLowerCase();
  return clean.replace(/[\/\-_]/g, ' ').replace(/\s+/g, ' ');
};

const generateTempChecklistId = () => `temp-cl-${Date.now()}`;
const generateTempItemId = () => `temp-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const generateTempExclusionId = () => `temp-ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

interface AuditSectionProps {
  task: Task;
  title: string;
  subtaskId?: string; 
  users: UserModel[];
  checklists: Checklist[];
  onUpdateChecklists: (checklists: Checklist[]) => void;
  currentUser?: UserModel | null;
  socket?: any;
}

function AuditSectionComponent({ task, title, subtaskId, users, checklists, onUpdateChecklists, currentUser, socket }: AuditSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isShaking, setIsShaking] = useState(false);
  const [shakingAuditItem, setShakingAuditItem] = useState<string | null>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [highlightedAudits, setHighlightedAudits] = useState<string[] | null>(null);
  const [auditToDelete, setAuditToDelete] = useState<string | null>(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);
  const selfAuditShakeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Local state for immediate 0ms updates and real-time synchronization
  const [localChecklists, setLocalChecklists] = useState<Checklist[]>(checklists || []);
  const localChecklistsRef = useRef<Checklist[]>(localChecklists);
  useEffect(() => {
    localChecklistsRef.current = localChecklists;
  }, [localChecklists]);

  // Track recent optimistic updates per item (normText -> { completed, assigneeId, timestamp })
  const pendingUpdatesRef = useRef<Map<string, { completed?: boolean; assigneeId?: string[]; timestamp: number }>>(new Map());
  // In-flight operation promises per normText to chain rapid operations and avoid temp-ID collisions on PATCH
  const inFlightOpsRef = useRef<Map<string, Promise<{ checklistId: string; itemId: string } | null>>>(new Map());

  const canManageAudits = isProjectManagerOrAdmin(currentUser);

  const isSelfAuditBlocked = useMemo(() => {
    if (!currentUser?.id) return false;

    // In REVISION, editors are reset back to zero
    const currentSubtask = subtaskId ? task.subtasks?.find((s: any) => s.id === subtaskId) : null;
    const currentStatus = (currentSubtask?.status || task.status || '').toUpperCase();
    if (currentStatus === 'REVISION') return false;

    // Contributor is the assignees only: auditors commenting on the task can check audit tasks
    const cName = (currentUser.name || '').trim().toLowerCase();
    const cEmail = (currentUser.email || '').trim().toLowerCase();
    const matchesUser = (u?: { id?: string | null; name?: string | null; email?: string | null } | null) => {
      if (!u) return false;
      if (u.id && u.id === currentUser.id) return true;
      const uName = (u.name || '').trim().toLowerCase();
      const uEmail = (u.email || '').trim().toLowerCase();
      if (cName && uName && (cName === uName || cName.includes(uName) || uName.includes(cName))) return true;
      if (cEmail && uEmail && (cEmail === uEmail || cEmail.includes(uEmail) || uEmail.includes(cEmail))) return true;
      return false;
    };

    const isDirectAssignee = task.assigneeId === currentUser.id ||
      matchesUser(task.assignee) ||
      (task.assignees || []).some((a: any) => matchesUser(a));

    const isSubtaskAssignee = currentSubtask
      ? ((currentSubtask.assigneeIds && currentSubtask.assigneeIds.includes(currentUser.id)) || (currentSubtask.assignees || []).some((a: any) => matchesUser(a)))
      : (task.subtasks || []).some((s: any) => (s.assigneeIds && s.assigneeIds.includes(currentUser.id)) || (s.assignees || []).some((a: any) => matchesUser(a)));

    return isDirectAssignee || isSubtaskAssignee;
  }, [currentUser?.id, currentUser?.name, currentUser?.email, task.assigneeId, task.assignee, task.assignees, task.subtasks, task.status, subtaskId]);

  // Synchronize incoming checklists prop changes smoothly, preserving pending local updates
  useEffect(() => {
    if (!checklists) return;
    setLocalChecklists(prev => {
      const now = Date.now();
      const updated = checklists.map(c => {
        if (!isNexusAuditChecklist(c)) return c;
        if (subtaskId ? c.subtaskId !== subtaskId : Boolean(c.subtaskId)) return c;

        const items = (c.items || []).map(serverItem => {
          const norm = normalizeAuditName(serverItem.text || '');
          const pending = pendingUpdatesRef.current.get(norm);
          if (pending && now - pending.timestamp < 5000) {
            return {
              ...serverItem,
              ...(pending.completed !== undefined ? { completed: pending.completed } : {}),
              ...(pending.assigneeId !== undefined ? { assigneeId: pending.assigneeId } : {}),
            };
          }
          return serverItem;
        });

        // Also preserve any temp items that haven't reconciled yet
        const prevMatchingCl = prev.find(pc => pc.id === c.id || (isNexusAuditChecklist(pc) && isNexusAuditChecklist(c)));
        if (prevMatchingCl) {
          const pendingTempItems = (prevMatchingCl.items || []).filter(pi =>
            typeof pi.id === 'string' && pi.id.startsWith('temp-') &&
            !items.some(si => normalizeAuditName(si.text) === normalizeAuditName(pi.text))
          );
          if (pendingTempItems.length > 0) {
            return { ...c, items: [...items, ...pendingTempItems] };
          }
        }
        return { ...c, items };
      });

      // Also preserve any pending temp checklists
      const pendingTempChecklists = prev.filter(pc =>
        typeof pc.id === 'string' && pc.id.startsWith('temp-') &&
        !updated.some(uc => uc.name === pc.name)
      );

      const merged = [...updated, ...pendingTempChecklists];
      localChecklistsRef.current = merged;
      return merged;
    });
  }, [checklists, subtaskId]);

  // Direct real-time WebSocket and Window event listeners
  useEffect(() => {
    const handleItemCreated = (payload: any) => {
      if (!payload || payload.taskId !== task.id) return;
      if (subtaskId ? payload.subtaskId !== subtaskId : Boolean(payload.subtaskId)) return;
      if (!payload.item) return;

      const norm = normalizeAuditName(payload.item.text || '');
      const pending = pendingUpdatesRef.current.get(norm);
      if (pending && Date.now() - pending.timestamp < 1500) return;

      setLocalChecklists(prev => {
        let foundCl = false;
        const next = prev.map(c => {
          if (!isNexusAuditChecklist(c)) return c;
          if (c.id === payload.checklistId || c.id === payload.item.checklistId) {
            foundCl = true;
            const existingIdx = (c.items || []).findIndex(i =>
              i.id === payload.item.id ||
              (typeof i.id === 'string' && i.id.startsWith('temp-') && normalizeAuditName(i.text) === norm)
            );
            if (existingIdx !== -1) {
              const nextItems = [...(c.items || [])];
              nextItems[existingIdx] = payload.item;
              return { ...c, items: nextItems };
            }
            return { ...c, items: [...(c.items || []), payload.item] };
          }
          return c;
        });

        const res = foundCl ? next : [
          ...prev,
          {
            id: payload.checklistId || payload.item.checklistId || `cl-${Date.now()}`,
            taskId: task.id,
            subtaskId: subtaskId || undefined,
            name: 'Audit',
            createdAt: new Date().toISOString(),
            items: [payload.item],
          }
        ];
        localChecklistsRef.current = res;
        onUpdateChecklists(res);
        return res;
      });
    };

    const handleItemUpdated = (payload: any) => {
      if (!payload || payload.taskId !== task.id) return;
      if (subtaskId ? payload.subtaskId !== subtaskId : Boolean(payload.subtaskId)) return;
      if (!payload.item) return;

      const norm = normalizeAuditName(payload.item.text || '');
      const pending = pendingUpdatesRef.current.get(norm);
      if (pending && Date.now() - pending.timestamp < 1500) return;

      setLocalChecklists(prev => {
        const next = prev.map(c => {
          if (!isNexusAuditChecklist(c)) return c;
          const items = (c.items || []).map(i => {
            if (i.id === payload.item.id || normalizeAuditName(i.text) === norm) {
              return { ...i, ...payload.item };
            }
            return i;
          });
          return { ...c, items };
        });
        localChecklistsRef.current = next;
        onUpdateChecklists(next);
        return next;
      });
    };

    const handleItemDeleted = (payload: any) => {
      if (!payload || payload.taskId !== task.id) return;
      if (subtaskId ? payload.subtaskId !== subtaskId : Boolean(payload.subtaskId)) return;

      const norm = payload.text ? normalizeAuditName(payload.text) : null;
      setLocalChecklists(prev => {
        const next = prev.map(c => {
          if (!isNexusAuditChecklist(c)) return c;
          const items = (c.items || []).filter(i => {
            if (payload.itemId && i.id === payload.itemId) return false;
            if (norm && normalizeAuditName(i.text) === norm) return false;
            return true;
          });
          return { ...c, items };
        });
        localChecklistsRef.current = next;
        onUpdateChecklists(next);
        return next;
      });
    };

    const handleChecklistDeleted = (payload: any) => {
      if (!payload || payload.taskId !== task.id) return;
      if (subtaskId ? payload.subtaskId !== subtaskId : Boolean(payload.subtaskId)) return;

      setLocalChecklists(prev => {
        const next = prev.filter(c => c.id !== payload.checklistId);
        localChecklistsRef.current = next;
        onUpdateChecklists(next);
        return next;
      });
    };

    const onWinItemCreated = (e: any) => handleItemCreated(e.detail);
    const onWinItemUpdated = (e: any) => handleItemUpdated(e.detail);
    const onWinItemDeleted = (e: any) => handleItemDeleted(e.detail);
    const onWinChecklistDeleted = (e: any) => handleChecklistDeleted(e.detail);

    window.addEventListener('task:checklist_item_created', onWinItemCreated);
    window.addEventListener('task:checklist_item_updated', onWinItemUpdated);
    window.addEventListener('task:checklist_item_deleted', onWinItemDeleted);
    window.addEventListener('task:checklist_deleted', onWinChecklistDeleted);

    if (socket) {
      socket.on('task:checklist_item_created', handleItemCreated);
      socket.on('task:checklist_item_updated', handleItemUpdated);
      socket.on('task:checklist_item_deleted', handleItemDeleted);
      socket.on('task:checklist_deleted', handleChecklistDeleted);
    }

    return () => {
      window.removeEventListener('task:checklist_item_created', onWinItemCreated);
      window.removeEventListener('task:checklist_item_updated', onWinItemUpdated);
      window.removeEventListener('task:checklist_item_deleted', onWinItemDeleted);
      window.removeEventListener('task:checklist_deleted', onWinChecklistDeleted);
      if (socket) {
        socket.off('task:checklist_item_created', handleItemCreated);
        socket.off('task:checklist_item_updated', handleItemUpdated);
        socket.off('task:checklist_item_deleted', handleItemDeleted);
        socket.off('task:checklist_deleted', handleChecklistDeleted);
      }
    };
  }, [task.id, subtaskId, socket, onUpdateChecklists]);

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

      // If there are no unchecked audits to highlight, do not shake or highlight
      if (!detail?.uncheckedAudits || detail.uncheckedAudits.length === 0) {
        return;
      }

      setIsExpanded(true);
      setIsShaking(true);
      setHighlightedAudits(detail.uncheckedAudits);

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

  // Read items from audit checklists for this task or subtask
  const auditChecklists = useMemo(() => localChecklists.filter(c => {
    if (!isNexusAuditChecklist(c)) return false;
    if (subtaskId) {
      return c.subtaskId === subtaskId;
    } else {
      return !c.subtaskId;
    }
  }), [localChecklists, subtaskId]);

  // Roles suggested by the auditor
  const auditorRoles = useMemo(() => subtaskId
    ? (task.subtasks?.find((s: any) => s.id === subtaskId)?.assigneeRoleRestrictions || [])
    : [
        ...(task.assigneeRoleRestrictions || []),
        ...(task.subtasks || [])
          .filter((s: any) => s.title?.toLowerCase().startsWith('--audit'))
          .flatMap((s: any) => s.assigneeRoleRestrictions || []),
      ], [subtaskId, task.subtasks, task.assigneeRoleRestrictions]);

  const excludedAudits = useMemo(() => new Set(
    auditChecklists.flatMap(c => c.items || [])
      .filter(i => (i.text || '').startsWith('!'))
      .map(i => normalizeAuditName((i.text || '').replace(/^!\s*/, '')))
  ), [auditChecklists]);

  const activeChecklistItems = useMemo(() => auditChecklists.flatMap(c => c.items || [])
    .filter(i => !(i.text || '').startsWith('!'))
    .map(i => i.text), [auditChecklists]);

  // Audits the Galaxy AI picked replace the role/title rules
  const hasAiPickedAudits = !subtaskId && getAiPickedAudits(localChecklists) !== null;
  const requiredAuditItems = useMemo(() => Array.from(new Set([
    ...(hasAiPickedAudits ? [] : getRequiredAudits(title, auditorRoles)),
    ...activeChecklistItems
  ].filter((text, i, all) => {
    const norm = normalizeAuditName(text);
    if (!text || text.startsWith('!') || excludedAudits.has(norm)) return false;
    if (HIDE_DESIGN_AUDIT && norm === 'design audit') return false;
    return all.findIndex(t => normalizeAuditName(t) === norm) === i;
  }))), [title, auditorRoles, activeChecklistItems, excludedAudits, hasAiPickedAudits]);

  // Unified lookup map for fast O(1) item access
  const auditItemsMap = useMemo(() => {
    const map = new Map<string, ChecklistItem>();
    const allItems = auditChecklists.flatMap(c => c.items || []);
    for (const item of allItems) {
      const norm = normalizeAuditName(item.text);
      if (!norm || norm.startsWith('!')) continue;
      const existing = map.get(norm);
      if (!existing) {
        map.set(norm, item);
      } else {
        const isExistingTemp = typeof existing.id === 'string' && existing.id.startsWith('temp-');
        const isItemTemp = typeof item.id === 'string' && item.id.startsWith('temp-');
        if (isExistingTemp && !isItemTemp) {
          map.set(norm, { ...existing, ...item, id: item.id, checklistId: item.checklistId });
        } else if (!isExistingTemp && isItemTemp) {
          map.set(norm, { ...item, ...existing, completed: item.completed, assigneeId: item.assigneeId });
        } else {
          map.set(norm, { ...existing, ...item });
        }
      }
    }
    return map;
  }, [auditChecklists]);

  const getAuditItem = (text: string) => {
    return auditItemsMap.get(normalizeAuditName(text));
  };

  const usersMap = useMemo(() => new Map<string, UserModel>(users.map(u => [u.id, u])), [users]);

  const completedCount = useMemo(() => requiredAuditItems.reduce((acc, text) => {
    const item = auditItemsMap.get(normalizeAuditName(text));
    return acc + (item?.completed ? 1 : 0);
  }, 0), [requiredAuditItems, auditItemsMap]);

  const availableAuditsToAdd = useMemo(() => ALL_AUDIT_OPTIONS.filter(option => {
    const norm = normalizeAuditName(option.id);
    if (HIDE_DESIGN_AUDIT && norm === 'design audit') return false;
    return !requiredAuditItems.some(req => normalizeAuditName(req) === norm) || excludedAudits.has(norm);
  }), [requiredAuditItems, excludedAudits]);

  const broadcastTaskChecklists = useCallback((updatedLists: Checklist[]) => {
    if (typeof window === 'undefined') return;
    if (subtaskId) {
      const updatedSubtasks = (task.subtasks || []).map(st =>
        st.id === subtaskId ? { ...st, checklists: updatedLists } : st
      );
      const optimisticTask = { ...task, subtasks: updatedSubtasks };
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: optimisticTask } }));
      useAppStore.getState().updateTask(optimisticTask);
    } else {
      const optimisticTask = { ...task, checklists: updatedLists };
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: optimisticTask } }));
      useAppStore.getState().updateTask(optimisticTask);
    }
  }, [task, subtaskId]);

  const handleToggleItem = useCallback(async (text: string, currentItem?: ChecklistItem) => {
    const norm = normalizeAuditName(text);
    const newCompleted = currentItem ? !currentItem.completed : true;

    // Track pending update for 5s to prevent stale server overrides
    pendingUpdatesRef.current.set(norm, {
      completed: newCompleted,
      timestamp: Date.now(),
    });

    // Remove from highlighted audits immediately if checking
    if (newCompleted && highlightedAudits) {
      const remaining = highlightedAudits.filter(t => normalizeAuditName(t) !== norm);
      setHighlightedAudits(remaining.length === 0 ? null : remaining);
    }

    // 1. Immediately update local state & parent (0ms optimistic update)
    let currentLists = [...localChecklistsRef.current];
    let auditCl = currentLists.find(c => isNexusAuditChecklist(c) && (subtaskId ? c.subtaskId === subtaskId : !c.subtaskId));

    let targetChecklistId = currentItem?.checklistId || auditCl?.id;
    const tempChecklistCreated = !targetChecklistId;
    if (!targetChecklistId) {
      targetChecklistId = generateTempChecklistId();
    }

    let optimisticItemId = currentItem?.id;
    if (!optimisticItemId) {
      optimisticItemId = generateTempItemId();
    }

    if (tempChecklistCreated) {
      auditCl = {
        id: targetChecklistId,
        taskId: task.id,
        subtaskId: subtaskId || undefined,
        name: 'Audit',
        createdAt: new Date().toISOString(),
        items: [],
      };
      currentLists.push(auditCl);
    }

    // Update ALL matching items across all audit checklists for this task/subtask
    let itemFound = false;
    currentLists = currentLists.map(c => {
      if (!isNexusAuditChecklist(c)) return c;
      if (subtaskId ? c.subtaskId !== subtaskId : Boolean(c.subtaskId)) return c;

      const items = (c.items || []).map(i => {
        if (i.id === optimisticItemId || normalizeAuditName(i.text) === norm) {
          itemFound = true;
          return {
            ...i,
            completed: newCompleted,
            checkedById: newCompleted ? currentUser?.id : undefined,
          };
        }
        return i;
      });
      return { ...c, items };
    });

    if (!itemFound) {
      const newItem: ChecklistItem = {
        id: optimisticItemId,
        checklistId: targetChecklistId,
        text,
        completed: newCompleted,
        createdAt: new Date().toISOString(),
        checkedById: newCompleted ? currentUser?.id : undefined,
      };
      currentLists = currentLists.map(c => {
        if (c.id === targetChecklistId) {
          return { ...c, items: [...(c.items || []), newItem] };
        }
        return c;
      });
    }

    // Apply to local state and notify parent immediately (0ms)
    setLocalChecklists(currentLists);
    localChecklistsRef.current = currentLists;
    onUpdateChecklists(currentLists);
    broadcastTaskChecklists(currentLists);

    // 2. Persist to DB in the background with chaining to prevent temp-ID collisions
    const previousOp = inFlightOpsRef.current.get(norm) || Promise.resolve(null);

    const currentOp = previousOp.catch(() => null).then(async (prevResult: any) => {
      const realChecklistId = prevResult?.checklistId || currentItem?.checklistId || auditCl?.id || targetChecklistId;
      const realItemId = prevResult?.itemId || (optimisticItemId && !optimisticItemId.startsWith('temp-') ? optimisticItemId : undefined);

      if (!realItemId) {
        // Needs creation
        const res = await tasksApi.createChecklistItem(task.id, realChecklistId, {
          text,
          completed: newCompleted,
          assigneeIds: currentItem?.assigneeId || [],
          subtaskId,
          checklistName: 'Audit',
        });
        const actualChecklistId = (res as any).checklistId || res.item.checklistId || realChecklistId;
        const actualItemId = res.item.id;

        // Reconcile temp ID in local checklists
        setLocalChecklists(prev => {
          const reconciled = prev.map(c => {
            if (c.id === targetChecklistId || c.id === actualChecklistId) {
              return {
                ...c,
                id: actualChecklistId,
                items: (c.items || []).map(i =>
                  i.id === optimisticItemId || normalizeAuditName(i.text) === norm
                    ? { ...res.item, completed: pendingUpdatesRef.current.get(norm)?.completed ?? res.item.completed }
                    : i
                ),
              };
            }
            return c;
          });
          localChecklistsRef.current = reconciled;
          onUpdateChecklists(reconciled);
          return reconciled;
        });

        return { checklistId: actualChecklistId, itemId: actualItemId };
      } else {
        // Already has real database ID
        await tasksApi.updateChecklistItem(task.id, realChecklistId, realItemId, { completed: newCompleted });
        return { checklistId: realChecklistId, itemId: realItemId };
      }
    });

    inFlightOpsRef.current.set(norm, currentOp);

    try {
      await currentOp;
    } catch (e: any) {
      console.error('[AuditSection] Failed to persist audit toggle:', e);
      toast.error(e?.response?.data?.error || e?.message || 'Failed to save audit change');
      pendingUpdatesRef.current.delete(norm);
      // Revert this item
      setLocalChecklists(prev => {
        const reverted = prev.map(c => {
          if (!isNexusAuditChecklist(c)) return c;
          if (subtaskId ? c.subtaskId !== subtaskId : Boolean(c.subtaskId)) return c;
          const items = (c.items || []).map(i => {
            if (normalizeAuditName(i.text) === norm) {
              return {
                ...i,
                completed: !newCompleted,
                checkedById: !newCompleted ? currentUser?.id : undefined,
              };
            }
            return i;
          });
          return { ...c, items };
        });
        localChecklistsRef.current = reverted;
        onUpdateChecklists(reverted);
        broadcastTaskChecklists(reverted);
        return reverted;
      });
    }
  }, [task, subtaskId, currentUser?.id, highlightedAudits, onUpdateChecklists, broadcastTaskChecklists]);

  const handleUpdateAssignee = useCallback(async (text: string, currentItem: ChecklistItem | undefined, assigneeIds: string[]) => {
    const norm = normalizeAuditName(text);

    pendingUpdatesRef.current.set(norm, {
      assigneeId: assigneeIds,
      timestamp: Date.now(),
    });

    let currentLists = [...localChecklistsRef.current];
    let auditCl = currentLists.find(c => isNexusAuditChecklist(c) && (subtaskId ? c.subtaskId === subtaskId : !c.subtaskId));

    let targetChecklistId = currentItem?.checklistId || auditCl?.id;
    const tempChecklistCreated = !targetChecklistId;
    if (!targetChecklistId) {
      targetChecklistId = generateTempChecklistId();
    }

    let optimisticItemId = currentItem?.id;
    if (!optimisticItemId) {
      optimisticItemId = generateTempItemId();
    }

    if (tempChecklistCreated) {
      auditCl = {
        id: targetChecklistId,
        taskId: task.id,
        subtaskId: subtaskId || undefined,
        name: 'Audit',
        createdAt: new Date().toISOString(),
        items: [],
      };
      currentLists.push(auditCl);
    }

    let itemFound = false;
    currentLists = currentLists.map(c => {
      if (!isNexusAuditChecklist(c)) return c;
      if (subtaskId ? c.subtaskId !== subtaskId : Boolean(c.subtaskId)) return c;

      const items = (c.items || []).map(i => {
        if (i.id === optimisticItemId || normalizeAuditName(i.text) === norm) {
          itemFound = true;
          return { ...i, assigneeId: assigneeIds };
        }
        return i;
      });
      return { ...c, items };
    });

    if (!itemFound) {
      const newItem: ChecklistItem = {
        id: optimisticItemId,
        checklistId: targetChecklistId,
        text,
        completed: false,
        assigneeId: assigneeIds,
        createdAt: new Date().toISOString(),
      };
      currentLists = currentLists.map(c => {
        if (c.id === targetChecklistId) {
          return { ...c, items: [...(c.items || []), newItem] };
        }
        return c;
      });
    }

    setLocalChecklists(currentLists);
    localChecklistsRef.current = currentLists;
    onUpdateChecklists(currentLists);
    broadcastTaskChecklists(currentLists);

    const previousOp = inFlightOpsRef.current.get(norm) || Promise.resolve(null);

    const currentOp = previousOp.catch(() => null).then(async (prevResult: any) => {
      const realChecklistId = prevResult?.checklistId || currentItem?.checklistId || auditCl?.id || targetChecklistId;
      const realItemId = prevResult?.itemId || (optimisticItemId && !optimisticItemId.startsWith('temp-') ? optimisticItemId : undefined);

      if (!realItemId) {
        const res = await tasksApi.createChecklistItem(task.id, realChecklistId, {
          text,
          assigneeIds,
          completed: currentItem?.completed || false,
          subtaskId,
          checklistName: 'Audit',
        });

        const actualChecklistId = (res as any).checklistId || res.item.checklistId || realChecklistId;
        const actualItemId = res.item.id;

        setLocalChecklists(prev => {
          const reconciled = prev.map(c => {
            if (c.id === targetChecklistId || c.id === actualChecklistId) {
              return {
                ...c,
                id: actualChecklistId,
                items: (c.items || []).map(i =>
                  i.id === optimisticItemId || normalizeAuditName(i.text) === norm
                    ? { ...res.item, assigneeId: pendingUpdatesRef.current.get(norm)?.assigneeId ?? res.item.assigneeId }
                    : i
                ),
              };
            }
            return c;
          });
          localChecklistsRef.current = reconciled;
          onUpdateChecklists(reconciled);
          return reconciled;
        });

        return { checklistId: actualChecklistId, itemId: actualItemId };
      } else {
        await tasksApi.updateChecklistItem(task.id, realChecklistId, realItemId, { assigneeIds });
        return { checklistId: realChecklistId, itemId: realItemId };
      }
    });

    inFlightOpsRef.current.set(norm, currentOp);

    try {
      await currentOp;
    } catch (e: any) {
      console.error('[AuditSection] Failed to persist assignee:', e);
      toast.error(e?.response?.data?.error || e?.message || 'Failed to update auditor assignment');
      pendingUpdatesRef.current.delete(norm);
      setLocalChecklists(prev => {
        const reverted = prev.map(c => {
          if (!isNexusAuditChecklist(c)) return c;
          if (subtaskId ? c.subtaskId !== subtaskId : Boolean(c.subtaskId)) return c;
          const items = (c.items || []).map(i => {
            if (normalizeAuditName(i.text) === norm) {
              return { ...i, assigneeId: currentItem?.assigneeId || [] };
            }
            return i;
          });
          return { ...c, items };
        });
        localChecklistsRef.current = reverted;
        onUpdateChecklists(reverted);
        broadcastTaskChecklists(reverted);
        return reverted;
      });
    }
  }, [task, subtaskId, onUpdateChecklists, broadcastTaskChecklists]);

  const handleAddAudit = useCallback(async (auditId: string) => {
    if (!canManageAudits) return;

    const normAudit = normalizeAuditName(auditId);

    // Check if an exclusion marker or active item already exists
    const existingExclusionItem = auditChecklists
      .flatMap(c => c.items || [])
      .find(i => (i.text || '').startsWith('!') && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normAudit);

    let currentLists = [...localChecklistsRef.current];
    let auditCl = currentLists.find(c => isNexusAuditChecklist(c) && (subtaskId ? c.subtaskId === subtaskId : !c.subtaskId));

    let targetChecklistId = existingExclusionItem?.checklistId || auditCl?.id;
    const tempChecklistCreated = !targetChecklistId;
    if (!targetChecklistId) {
      targetChecklistId = generateTempChecklistId();
    }

    const isNaturallyRequired = getRequiredAudits(title, auditorRoles).some(
      a => normalizeAuditName(a) === normAudit
    );

    const existingActiveItem = auditChecklists
      .flatMap(c => c.items || [])
      .find(i => !(i.text || '').startsWith('!') && normalizeAuditName(i.text) === normAudit);

    let optimisticItemId = existingActiveItem?.id;
    const tempItemCreated = !optimisticItemId && !isNaturallyRequired;
    if (!optimisticItemId) {
      optimisticItemId = generateTempItemId();
    }

    if (tempChecklistCreated) {
      auditCl = {
        id: targetChecklistId,
        taskId: task.id,
        subtaskId: subtaskId || undefined,
        name: 'Audit',
        createdAt: new Date().toISOString(),
        items: [],
      };
      currentLists.push(auditCl);
    }

    // Immediately remove exclusion markers and add active item across all audit checklists
    currentLists = currentLists.map(c => {
      if (!isNexusAuditChecklist(c)) return c;
      if (subtaskId ? c.subtaskId !== subtaskId : Boolean(c.subtaskId)) return c;

      const itemsWithoutExclusion = (c.items || []).filter(
        i => !(i.text || '').startsWith('!') || normalizeAuditName((i.text || '').replace(/^!\s*/, '')) !== normAudit
      );
      const alreadyHasActive = itemsWithoutExclusion.some(
        i => !(i.text || '').startsWith('!') && normalizeAuditName(i.text) === normAudit
      );
      const nextItems = alreadyHasActive
        ? itemsWithoutExclusion
        : [
            ...itemsWithoutExclusion,
            {
              id: optimisticItemId!,
              checklistId: c.id,
              text: auditId,
              completed: false,
              createdAt: new Date().toISOString(),
            },
          ];
      return { ...c, items: nextItems };
    });

    setLocalChecklists(currentLists);
    localChecklistsRef.current = currentLists;
    onUpdateChecklists(currentLists);
    broadcastTaskChecklists(currentLists);

    try {
      const realChecklistId = targetChecklistId;

      if (existingExclusionItem && !existingExclusionItem.id.startsWith('temp-')) {
        await tasksApi.deleteChecklistItem(task.id, existingExclusionItem.checklistId, existingExclusionItem.id);
      }

      if (tempItemCreated) {
        const res = await tasksApi.createChecklistItem(task.id, realChecklistId, { 
          text: auditId,
          subtaskId,
          checklistName: 'Audit',
        });
        const actualChecklistId = (res as any).checklistId || res.item.checklistId || realChecklistId;

        setLocalChecklists(prev => {
          const reconciled = prev.map(c => {
            if (c.id === targetChecklistId || c.id === actualChecklistId) {
              return {
                ...c,
                id: actualChecklistId,
                items: (c.items || []).map(i => (i.id === optimisticItemId ? res.item : i)),
              };
            }
            return c;
          });
          localChecklistsRef.current = reconciled;
          onUpdateChecklists(reconciled);
          return reconciled;
        });
      }
      toast.success(`Added ${auditId}`);
    } catch (e: any) {
      console.error('[AuditSection] Failed to add audit:', e);
      toast.error('Failed to add audit to server');
    }
  }, [canManageAudits, auditChecklists, title, auditorRoles, task.id, subtaskId, onUpdateChecklists, broadcastTaskChecklists]);

  const handleRemoveAudit = useCallback(async (auditText: string) => {
    if (!canManageAudits) return;

    const normAudit = normalizeAuditName(auditText);

    if (highlightedAudits) {
      const remaining = highlightedAudits.filter(t => normalizeAuditName(t) !== normAudit);
      setHighlightedAudits(remaining.length === 0 ? null : remaining);
    }

    const existingActiveItem = auditChecklists
      .flatMap(c => c.items || [])
      .find(i => !(i.text || '').startsWith('!') && normalizeAuditName(i.text) === normAudit);

    let currentLists = [...localChecklistsRef.current];
    let auditCl = currentLists.find(c => isNexusAuditChecklist(c) && (subtaskId ? c.subtaskId === subtaskId : !c.subtaskId));

    let targetChecklistId = existingActiveItem?.checklistId || auditCl?.id;
    const tempChecklistCreated = !targetChecklistId;
    if (!targetChecklistId) {
      targetChecklistId = generateTempChecklistId();
    }

    const isNaturallyRequired = getRequiredAudits(title, auditorRoles).some(
      a => normalizeAuditName(a) === normAudit
    );

    const tempExclusionItemId = generateTempExclusionId();

    if (tempChecklistCreated) {
      auditCl = {
        id: targetChecklistId,
        taskId: task.id,
        subtaskId: subtaskId || undefined,
        name: 'Audit',
        createdAt: new Date().toISOString(),
        items: [],
      };
      currentLists.push(auditCl);
    }

    currentLists = currentLists.map(c => {
      if (!isNexusAuditChecklist(c)) return c;
      if (subtaskId ? c.subtaskId !== subtaskId : Boolean(c.subtaskId)) return c;

      const nextItems = (c.items || []).filter(
        i => (i.text || '').startsWith('!') || normalizeAuditName(i.text) !== normAudit
      );
      if (isNaturallyRequired && !nextItems.some(i => (i.text || '').startsWith('!') && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normAudit)) {
        nextItems.push({
          id: tempExclusionItemId,
          checklistId: c.id,
          text: `!${auditText}`,
          completed: false,
          createdAt: new Date().toISOString(),
        });
      }
      return { ...c, items: nextItems };
    });

    setLocalChecklists(currentLists);
    localChecklistsRef.current = currentLists;
    onUpdateChecklists(currentLists);
    broadcastTaskChecklists(currentLists);

    try {
      let realChecklistId = targetChecklistId;
      if (tempChecklistCreated) {
        const res = await tasksApi.createChecklist(task.id, {
          name: 'Audit',
          subtaskId,
        });
        realChecklistId = res.checklist.id;
      }

      if (existingActiveItem && !existingActiveItem.id.startsWith('temp-')) {
        await tasksApi.deleteChecklistItem(task.id, existingActiveItem.checklistId, existingActiveItem.id);
      }

      if (isNaturallyRequired) {
        const res = await tasksApi.createChecklistItem(task.id, realChecklistId, { text: `!${auditText}` });
        setLocalChecklists(prev => {
          const reconciled = prev.map(c => {
            if (c.id === targetChecklistId || c.id === realChecklistId) {
              return {
                ...c,
                id: realChecklistId,
                items: (c.items || []).map(i => (i.id === tempExclusionItemId ? res.item : i)),
              };
            }
            return c;
          });
          localChecklistsRef.current = reconciled;
          onUpdateChecklists(reconciled);
          return reconciled;
        });
      }
      toast.success(`Removed ${auditText}`);
    } catch (e: any) {
      console.error('[AuditSection] Failed to remove audit:', e);
      toast.error('Failed to remove audit from server');
    }
  }, [canManageAudits, highlightedAudits, auditChecklists, title, auditorRoles, task.id, subtaskId, onUpdateChecklists, broadcastTaskChecklists]);

  // If no audits are required and user cannot manage audits, hide section entirely
  if (requiredAuditItems.length === 0 && !canManageAudits) return null;

  return (
    <div className={`w-full ${isExpanded ? 'mb-4' : 'mb-1'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between select-none ${isExpanded ? 'mb-3' : 'mb-0'}`}>
        <div 
          className="flex items-center gap-2 group cursor-pointer" 
          onClick={() => setIsExpanded(!isExpanded)}
        >
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

        {/* PM Action: Add Audit Popover */}
        {!HIDE_ADD_AUDIT && canManageAudits && (
          <Popover.Root open={isAddMenuOpen} onOpenChange={setIsAddMenuOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-700/80 border border-zinc-700/60 rounded-md transition-all shadow-sm cursor-pointer"
                title="Add audit (Project Managers and Admins only)"
              >
                <Plus className="w-3.5 h-3.5 text-zinc-400" />
                <span>Add Audit</span>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="z-[100] w-64 rounded-xl bg-zinc-900 border border-zinc-800 p-2 shadow-2xl outline-none"
                align="end"
                sideOffset={6}
              >
                <div className="flex items-center justify-between px-2 py-1.5 mb-1.5 border-b border-zinc-800/80">
                  <span className="text-xs font-semibold text-zinc-200">Add Audit</span>
                  <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">PM Action</span>
                </div>

                {availableAuditsToAdd.length === 0 ? (
                  <div className="px-3 py-4 text-center">
                    <p className="text-xs text-zinc-400 font-medium">All Audits Added</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">All 4 standard audit types are active on this task.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {availableAuditsToAdd.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          handleAddAudit(option.id);
                          setIsAddMenuOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-zinc-200 hover:text-white hover:bg-zinc-800/80 transition-all flex items-center justify-between group cursor-pointer"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-medium text-zinc-200 group-hover:text-zinc-100 truncate">
                            {option.label}
                          </span>
                          <span className="text-[11px] text-zinc-500 truncate">
                            {option.description}
                          </span>
                        </div>
                        {option.role ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-zinc-400 shrink-0 font-normal">
                            {option.role}
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 border border-zinc-700/40 text-zinc-500 shrink-0 font-normal">
                            General
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
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
                <div className="flex items-center gap-2 min-w-0">
                  <span>Audit Items</span>
                </div>
                <span className="text-xs text-zinc-500 font-normal shrink-0">
                  {completedCount} of {requiredAuditItems.length}
                </span>
              </div>
            </div>

            {/* Empty state when all audits are removed by a PM */}
            {requiredAuditItems.length === 0 ? (
              <div className="p-5 flex flex-col items-center justify-center text-center gap-2">
                <div className="text-xs text-zinc-300 font-medium">No Audits Configured</div>
                <p className="text-[11px] text-zinc-500 max-w-[300px]">
                  No audits are currently required for this task. Project Managers can add audits at any time.
                </p>
                {!HIDE_ADD_AUDIT && canManageAudits && (
                  <button
                    type="button"
                    onClick={() => setIsAddMenuOpen(true)}
                    className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Audit</span>
                  </button>
                )}
              </div>
            ) : (
              /* Items */
              <div className="p-2 flex flex-col gap-0.5">
                {requiredAuditItems.map((text, idx) => {
                  const item = getAuditItem(text);
                  const isCompleted = !!item?.completed;
                  const assigneeIds = item?.assigneeId || [];

                  const isItemNeeded = Boolean(
                    highlightedAudits &&
                    !isCompleted &&
                    highlightedAudits.length > 0 &&
                    highlightedAudits.some(a => a.toLowerCase() === text.toLowerCase())
                  );

                  const roles = (currentUser?.roles || []).map(r => r?.toLowerCase() || '');
                  const isAdmin = currentUser?.systemRole === 'ADMIN';

                  let canCheck = isAdmin;
                  let requiredRole = "";
                  if (!canCheck) {
                    if (text === 'UI UX Audit' || text === 'UI/UX Audit') {
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

                  if (isSelfAuditBlocked) {
                    canCheck = false;
                  }

                  const displayLabel = text === 'UI UX Audit' ? 'UI/UX Audit' : text;

                  return (
                    <div 
                      key={idx} 
                      className={`flex items-center justify-between py-1.5 px-2 group/item rounded-lg transition-colors ${
                        shakingAuditItem === text ? 'animate-shake' : ''
                      } ${
                        isItemNeeded
                          ? 'bg-zinc-800/40 border border-emerald-500/30 shadow-sm my-0.5'
                          : 'hover:bg-accent/30'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button 
                          type="button"
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            !canCheck && !isSelfAuditBlocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                          } ${
                            isCompleted
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : isItemNeeded
                              ? 'border-emerald-500 bg-emerald-500/20'
                              : 'border-zinc-600 bg-zinc-800/40 hover:border-zinc-400 hover:bg-zinc-800'
                          }`}
                          onClick={() => {
                            if (isSelfAuditBlocked) {
                              setShakingAuditItem(text);
                              setIsShaking(true);
                              if (selfAuditShakeTimerRef.current) {
                                clearTimeout(selfAuditShakeTimerRef.current);
                              }
                              selfAuditShakeTimerRef.current = setTimeout(() => {
                                setShakingAuditItem(null);
                                setIsShaking(false);
                              }, 700);
                              toast.error("You're not allowed to check an audit that you or your group edited! 🙄");
                              return;
                            }
                            if (canCheck) {
                              handleToggleItem(text, item);
                            }
                          }}
                          title={
                            isSelfAuditBlocked
                              ? "You're not allowed to check an audit that you or your group edited! 🙄"
                              : !canCheck
                              ? `Only ${requiredRole || 'Admins'} can check this item`
                              : "Click to check audit"
                          }
                          disabled={!canCheck && !isSelfAuditBlocked}
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
                          {displayLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isItemNeeded && (
                          <span className="text-[10px] uppercase font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 tracking-wider shrink-0">
                            Required
                          </span>
                        )}

                        {/* Assignee */}
                        <Popover.Root open={canManageAudits ? undefined : false}>
                          <Popover.Trigger asChild>
                            {assigneeIds.length === 0 ? (
                              <button 
                                type="button"
                                className={`w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border-hover ${canManageAudits ? 'cursor-pointer' : 'cursor-default'}`} 
                                title={canManageAudits ? 'Assign auditors' : 'Unassigned. Only Project Managers can assign auditors'}
                              >
                                <User className="w-3 h-3" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={`flex items-center -space-x-1.5 ${canManageAudits ? 'cursor-pointer' : 'cursor-default'}`}
                                title={assigneeIds.map(id => usersMap.get(id)?.name || 'Unknown').join(', ')}
                              >
                                {assigneeIds.slice(0, 3).map(id => {
                                  const assignee = usersMap.get(id);
                                  return assignee?.avatarUrl ? (
                                    <img key={id} src={assignee.avatarUrl} alt={assignee.name} className="w-6 h-6 rounded-full object-cover ring-2 ring-card" />
                                  ) : (
                                    <div key={id} className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] text-white font-bold ring-2 ring-card ${getAssigneeAvatarColor(assignee?.name || id)}`}>
                                      {assignee?.name?.substring(0, 2).toUpperCase() || <User className="w-3 h-3" />}
                                    </div>
                                  );
                                })}
                                {assigneeIds.length > 3 && (
                                  <div className="w-6 h-6 rounded-full bg-zinc-800 text-muted-foreground text-[9px] font-bold flex items-center justify-center ring-2 ring-card">
                                    +{assigneeIds.length - 3}
                                  </div>
                                )}
                              </button>
                            )}
                          </Popover.Trigger>
                          <Popover.Portal>
                            <Popover.Content className="z-[100] w-56 rounded-lg bg-popover border border-border p-2 shadow-xl outline-none" align="end" sideOffset={5}>
                              <div className="text-xs font-medium text-muted-foreground mb-2 px-1">Assign to</div>
                              <div className="max-h-60 overflow-y-auto">
                                <button 
                                  type="button"
                                  className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground rounded flex items-center gap-2 mb-1 cursor-pointer"
                                  onClick={() => handleUpdateAssignee(text, item, [])}
                                >
                                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center"><User className="w-3 h-3 text-muted-foreground" /></div>
                                  Unassigned
                                </button>
                                {/* Strictly holders of this audit's auditor role */}
                                {users.filter(u => !isSystemUser(u) && isAuditorFor(text, u.roles)).map(u => {
                                  const isUserContributor = (() => {
                                    // Contributor is the assignees only
                                    const currentSubtask = subtaskId ? task.subtasks?.find((s: any) => s.id === subtaskId) : null;
                                    const uName = (u.name || '').trim().toLowerCase();
                                    const uEmail = (u.email || '').trim().toLowerCase();
                                    const matchesUser = (a?: { id?: string | null; name?: string | null; email?: string | null } | null) => {
                                      if (!a) return false;
                                      if (a.id && a.id === u.id) return true;
                                      const aName = (a.name || '').trim().toLowerCase();
                                      const aEmail = (a.email || '').trim().toLowerCase();
                                      if (uName && aName && (uName === aName || uName.includes(aName) || aName.includes(uName))) return true;
                                      if (uEmail && aEmail && (uEmail === aEmail || uEmail.includes(aEmail) || aEmail.includes(uEmail))) return true;
                                      return false;
                                    };

                                    const isDirectAssignee = task.assigneeId === u.id ||
                                      matchesUser(task.assignee) ||
                                      (task.assignees || []).some((a: any) => matchesUser(a));

                                    const isSubtaskAssignee = currentSubtask
                                      ? ((currentSubtask.assigneeIds && currentSubtask.assigneeIds.includes(u.id)) || (currentSubtask.assignees || []).some((a: any) => matchesUser(a)))
                                      : (task.subtasks || []).some((s: any) => (s.assigneeIds && s.assigneeIds.includes(u.id)) || (s.assignees || []).some((a: any) => matchesUser(a)));

                                    return isDirectAssignee || isSubtaskAssignee;
                                  })();

                                  return (
                                  <button 
                                    key={u.id}
                                    type="button"
                                    className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground rounded flex items-center gap-2 cursor-pointer"
                                    onClick={() => handleUpdateAssignee(
                                      text,
                                      item,
                                      assigneeIds.includes(u.id) ? assigneeIds.filter(id => id !== u.id) : [...assigneeIds, u.id],
                                    )}
                                  >
                                    {u.avatarUrl ? (
                                      <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                                    ) : (
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] text-white font-bold ${getAssigneeAvatarColor(u.name || u.id)}`}>
                                        {u.name?.substring(0, 2).toUpperCase()}
                                      </div>
                                    )}
                                    <span className="flex-1 truncate">{u.name}</span>
                                    {isUserContributor && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium shrink-0" title="Task assignee">
                                        Contributor
                                      </span>
                                    )}
                                    {assigneeIds.includes(u.id) && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                                  </button>
                                );
                              })}
                                {/* Assigned before the strict role lists: removable only */}
                                {assigneeIds.filter(id => !isAuditorFor(text, usersMap.get(id)?.roles)).map(id => {
                                  const u = usersMap.get(id);
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      className="w-full text-left px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded flex items-center gap-2 cursor-pointer"
                                      title="Not an auditor for this audit — click to remove"
                                      onClick={() => handleUpdateAssignee(text, item, assigneeIds.filter(a => a !== id))}
                                    >
                                      {u?.avatarUrl ? (
                                        <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover opacity-60" />
                                      ) : (
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] text-white font-bold opacity-60 ${getAssigneeAvatarColor(u?.name || id)}`}>
                                          {u?.name?.substring(0, 2).toUpperCase() || <User className="w-3 h-3" />}
                                        </div>
                                      )}
                                      <span className="flex-1 truncate">{u?.name || 'Unknown user'}</span>
                                      <span className="text-[10px] text-rose-500 shrink-0">Remove</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </Popover.Content>
                          </Popover.Portal>
                        </Popover.Root>

                        {/* PM Action: Remove Audit Button */}
                        {!HIDE_AUDIT_DELETE && canManageAudits && (
                          <button
                            type="button"
                            className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0 opacity-0 group-hover/item:opacity-100 focus:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAuditToDelete(text);
                            }}
                            title={`Remove ${displayLabel}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {auditToDelete && (
        <ConfirmDeleteModal
          isOpen={!!auditToDelete}
          onClose={() => setAuditToDelete(null)}
          onConfirm={async () => {
            if (auditToDelete) {
              const target = auditToDelete;
              setAuditToDelete(null);
              await handleRemoveAudit(target);
            }
          }}
          title="Remove Audit Item"
          itemName={ALL_AUDIT_OPTIONS.find(o => normalizeAuditName(o.id) === normalizeAuditName(auditToDelete))?.label || (auditToDelete === 'UI UX Audit' ? 'UI/UX Audit' : auditToDelete)}
        />
      )}
    </div>
  );
}

export const AuditSection = React.memo(AuditSectionComponent);
