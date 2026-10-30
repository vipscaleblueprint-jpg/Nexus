import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Task, Checklist, ChecklistItem, User as UserModel } from '@/lib/types';
import { tasksApi } from '@/api/tasks';
import { ChevronDown, ChevronRight, User, Check, Plus, Trash2 } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { isNexusAuditChecklist, getRequiredAudits, getAiPickedAudits, ALL_AUDIT_OPTIONS } from '@/lib/auditChecklist';
import { isProjectManagerOrAdmin } from '@/lib/permissions';
import { getAssigneeAvatarColor } from './TaskDetailModal';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';

export { getRequiredAudits, ALL_AUDIT_OPTIONS };

// TEMPORARY TOGGLES: Hidden per user request until process is finalized. Set to false to restore.
export const HIDE_AUDIT_DELETE = true;
export const HIDE_ADD_AUDIT = true;
export const HIDE_DESIGN_AUDIT = true;

export const normalizeAuditName = (name: string) => {
  const clean = (name || '').trim().toLowerCase();
  return clean.replace(/[\/\-_]/g, ' ').replace(/\s+/g, ' ');
};

interface AuditSectionProps {
  task: Task;
  title: string;
  subtaskId?: string; 
  users: UserModel[];
  checklists: Checklist[];
  onUpdateChecklists: (checklists: Checklist[]) => void;
  currentUser?: UserModel | null;
}

function AuditSectionComponent({ task, title, subtaskId, users, checklists, onUpdateChecklists, currentUser }: AuditSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [highlightedAudits, setHighlightedAudits] = useState<string[] | null>(null);
  const [auditToDelete, setAuditToDelete] = useState<string | null>(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

  const canManageAudits = isProjectManagerOrAdmin(currentUser);

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

  // A task can end up with more than one Audit checklist (e.g. two clicks racing to create it).
  // Read items from all of them so an assignee or check saved on either one still shows.
  const auditChecklists = useMemo(() => checklists.filter(c => {
    if (!isNexusAuditChecklist(c)) return false;
    if (subtaskId) {
      return c.subtaskId === subtaskId || !c.subtaskId;
    } else {
      return !c.subtaskId;
    }
  }), [checklists, subtaskId]);
  const auditChecklist = auditChecklists[0];

  // Roles suggested by the auditor: from the specific "--Audit" subtask when one is targeted,
  // otherwise from the task's own roles plus every "--Audit" subtask attached to it
  // (the server's completion check uses the task's own roles too).
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

  // Audits the Galaxy AI picked replace the role/title rules (saved items and exclusions still apply).
  const hasAiPickedAudits = !subtaskId && getAiPickedAudits(checklists) !== null;
  const requiredAuditItems = useMemo(() => Array.from(new Set([
    ...(hasAiPickedAudits ? [] : getRequiredAudits(title, auditorRoles)),
    ...activeChecklistItems
  ].filter((text, i, all) => {
    const norm = normalizeAuditName(text);
    if (!text || text.startsWith('!') || excludedAudits.has(norm)) return false;
    if (HIDE_DESIGN_AUDIT && norm === 'design audit') return false;
    return all.findIndex(t => normalizeAuditName(t) === norm) === i;
  }))), [title, auditorRoles, activeChecklistItems, excludedAudits, hasAiPickedAudits]);

  // Lookup map for fast O(1) item access instead of flatMap + filter
  const auditItemsMap = useMemo(() => {
    const map = new Map<string, ChecklistItem>();
    const allItems = auditChecklists.flatMap(c => c.items || []);
    for (const item of allItems) {
      const norm = normalizeAuditName(item.text);
      const existing = map.get(norm);
      if (!existing || (!existing.completed && item.completed) || (!existing.assigneeId && item.assigneeId)) {
        map.set(norm, item);
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

  const handleToggleItem = async (text: string, currentItem?: ChecklistItem) => {
    const newCompleted = currentItem ? !currentItem.completed : true;

    // Remove from highlighted audits immediately if checking
    if (newCompleted && highlightedAudits) {
      const remaining = highlightedAudits.filter(
        t => t.toLowerCase() !== text.toLowerCase()
      );
      setHighlightedAudits(remaining.length === 0 ? null : remaining);
    }

    // 1. Immediately update the frontend (0ms optimistic update)
    let targetChecklistId = currentItem?.checklistId || auditChecklist?.id;
    const tempChecklistCreated = !targetChecklistId;
    if (!targetChecklistId) {
      targetChecklistId = `temp-cl-${Date.now()}`;
    }

    let optimisticItemId = currentItem?.id;
    const tempItemCreated = !optimisticItemId;
    if (!optimisticItemId) {
      optimisticItemId = `temp-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    let optimisticChecklists = [...checklists];

    if (tempChecklistCreated) {
      const newCl: Checklist = {
        id: targetChecklistId,
        taskId: task.id,
        subtaskId: subtaskId || undefined,
        name: 'Audit',
        createdAt: new Date().toISOString(),
        items: [],
      };
      optimisticChecklists.push(newCl);
    }

    if (tempItemCreated) {
      const newItem: ChecklistItem = {
        id: optimisticItemId,
        checklistId: targetChecklistId,
        text,
        completed: newCompleted,
        createdAt: new Date().toISOString(),
        checkedById: newCompleted ? currentUser?.id : undefined,
      };

      optimisticChecklists = optimisticChecklists.map(c => {
        if (c.id === targetChecklistId) {
          return { ...c, items: [...(c.items || []), newItem] };
        }
        return c;
      });
    } else {
      optimisticChecklists = optimisticChecklists.map(c => {
        if (c.id === targetChecklistId) {
          return {
            ...c,
            items: (c.items || []).map(i =>
              i.id === optimisticItemId
                ? {
                    ...i,
                    completed: newCompleted,
                    checkedById: newCompleted ? currentUser?.id : undefined,
                  }
                : i
            ),
          };
        }
        return c;
      });
    }

    // Apply to frontend state immediately
    onUpdateChecklists(optimisticChecklists);
    const optimisticTask = { ...task, checklists: optimisticChecklists };
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: optimisticTask } }));
    }
    useAppStore.getState().updateTask(optimisticTask);

    // 2. Persist to DB in the background
    try {
      const realChecklistId = currentItem?.checklistId || auditChecklist?.id || targetChecklistId;

      if (tempItemCreated) {
        // Atomic single request: server automatically finds or creates the Audit checklist if needed
        const res = await tasksApi.createChecklistItem(task.id, realChecklistId, { 
          text, 
          completed: newCompleted,
          assigneeId: currentItem?.assigneeId || undefined,
          subtaskId,
          checklistName: 'Audit',
        });

        const actualChecklistId = (res as any).checklistId || res.item.checklistId || realChecklistId;

        // Reconcile temporary IDs with actual database IDs
        const reconciled = optimisticChecklists.map(c => {
          if (c.id === targetChecklistId || c.id === actualChecklistId) {
            return {
              ...c,
              id: actualChecklistId,
              items: (c.items || []).map(i => i.id === optimisticItemId ? res.item : i),
            };
          }
          return c;
        });
        onUpdateChecklists(reconciled);
        const reconciledTask = { ...task, checklists: reconciled };
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: reconciledTask } }));
        }
        useAppStore.getState().updateTask(reconciledTask);
      } else {
        await tasksApi.updateChecklistItem(task.id, realChecklistId, optimisticItemId!, { completed: newCompleted });
      }
    } catch (e) {
      console.error('[AuditSection] Failed to persist audit toggle:', e);
      // Revert if API call fails
      onUpdateChecklists(checklists);
      const revertedTask = { ...task, checklists };
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: revertedTask } }));
      }
      useAppStore.getState().updateTask(revertedTask);
    }
  };

  const handleUpdateAssignee = async (text: string, currentItem: ChecklistItem | undefined, assigneeId: string) => {
    const selectedUser = users.find(u => u.id === assigneeId);

    let targetChecklistId = currentItem?.checklistId || auditChecklist?.id;
    const tempChecklistCreated = !targetChecklistId;
    if (!targetChecklistId) {
      targetChecklistId = `temp-cl-${Date.now()}`;
    }

    let optimisticItemId = currentItem?.id;
    const tempItemCreated = !optimisticItemId;
    if (!optimisticItemId) {
      optimisticItemId = `temp-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    let optimisticChecklists = [...checklists];

    if (tempChecklistCreated) {
      optimisticChecklists.push({
        id: targetChecklistId,
        taskId: task.id,
        subtaskId: subtaskId || undefined,
        name: 'Audit',
        createdAt: new Date().toISOString(),
        items: [],
      });
    }

    if (tempItemCreated) {
      const newItem: ChecklistItem = {
        id: optimisticItemId,
        checklistId: targetChecklistId,
        text,
        completed: false,
        assigneeId: assigneeId || undefined,
        assignee: selectedUser || undefined,
        createdAt: new Date().toISOString(),
      };
      optimisticChecklists = optimisticChecklists.map(c => {
        if (c.id === targetChecklistId) {
          return { ...c, items: [...(c.items || []), newItem] };
        }
        return c;
      });
    } else {
      optimisticChecklists = optimisticChecklists.map(c => {
        if (c.id === targetChecklistId) {
          return {
            ...c,
            items: (c.items || []).map(i =>
              i.id === optimisticItemId ? { ...i, assigneeId: assigneeId || undefined, assignee: selectedUser || undefined } : i
            ),
          };
        }
        return c;
      });
    }

    // Apply to frontend state immediately
    onUpdateChecklists(optimisticChecklists);
    const optimisticTask = { ...task, checklists: optimisticChecklists };
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: optimisticTask } }));
    }
    useAppStore.getState().updateTask(optimisticTask);

    try {
      const realChecklistId = currentItem?.checklistId || auditChecklist?.id || targetChecklistId;

      if (tempItemCreated) {
        const res = await tasksApi.createChecklistItem(task.id, realChecklistId, { 
          text, 
          assigneeId: assigneeId || undefined,
          completed: currentItem?.completed || false,
          subtaskId,
          checklistName: 'Audit',
        });

        const actualChecklistId = (res as any).checklistId || res.item.checklistId || realChecklistId;

        const reconciled = optimisticChecklists.map(c => {
          if (c.id === targetChecklistId || c.id === actualChecklistId) {
            return {
              ...c,
              id: actualChecklistId,
              items: (c.items || []).map(i => i.id === optimisticItemId ? res.item : i),
            };
          }
          return c;
        });
        onUpdateChecklists(reconciled);
        const reconciledTask = { ...task, checklists: reconciled };
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: reconciledTask } }));
        }
        useAppStore.getState().updateTask(reconciledTask);
      } else {
        await tasksApi.updateChecklistItem(task.id, realChecklistId, optimisticItemId!, { assigneeId });
      }
    } catch (e) {
      console.error('[AuditSection] Failed to persist assignee:', e);
      onUpdateChecklists(checklists);
      const revertedTask = { ...task, checklists };
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: revertedTask } }));
      }
      useAppStore.getState().updateTask(revertedTask);
    }
  };

  const handleAddAudit = async (auditId: string) => {
    if (!canManageAudits || isProcessing) return;
    setIsProcessing(true);

    const normAudit = normalizeAuditName(auditId);

    // Check if there is an exclusion marker for this audit (e.g. !UI UX Audit)
    const existingExclusionItem = auditChecklists
      .flatMap(c => c.items || [])
      .find(i => (i.text || '').startsWith('!') && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normAudit);

    let targetChecklistId = existingExclusionItem?.checklistId || auditChecklist?.id;
    const tempChecklistCreated = !targetChecklistId;
    if (!targetChecklistId) {
      targetChecklistId = `temp-cl-${Date.now()}`;
    }

    // Check if this audit is naturally generated by getRequiredAudits for this task title/roles
    const isNaturallyRequired = getRequiredAudits(title, auditorRoles).some(
      a => normalizeAuditName(a) === normAudit
    );

    // Check if an active item already exists
    const existingActiveItem = auditChecklists
      .flatMap(c => c.items || [])
      .find(i => !(i.text || '').startsWith('!') && normalizeAuditName(i.text) === normAudit);

    let optimisticItemId = existingActiveItem?.id;
    const tempItemCreated = !optimisticItemId && !isNaturallyRequired;
    if (!optimisticItemId) {
      optimisticItemId = `temp-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    let optimisticChecklists = [...checklists];

    if (tempChecklistCreated) {
      optimisticChecklists.push({
        id: targetChecklistId,
        taskId: task.id,
        subtaskId: subtaskId || undefined,
        name: 'Audit',
        createdAt: new Date().toISOString(),
        items: [],
      });
    }

    optimisticChecklists = optimisticChecklists.map(c => {
      if (c.id === targetChecklistId) {
        // Remove the exclusion marker if it existed
        const itemsWithoutExclusion = (c.items || []).filter(
          i => !(i.text || '').startsWith('!') || normalizeAuditName((i.text || '').replace(/^!\s*/, '')) !== normAudit
        );
        // Add active item if not already in items
        const alreadyHasActive = itemsWithoutExclusion.some(
          i => !(i.text || '').startsWith('!') && normalizeAuditName(i.text) === normAudit
        );
        const nextItems = alreadyHasActive
          ? itemsWithoutExclusion
          : [
              ...itemsWithoutExclusion,
              {
                id: optimisticItemId!,
                checklistId: targetChecklistId,
                text: auditId,
                completed: false,
                createdAt: new Date().toISOString(),
              },
            ];
        return { ...c, items: nextItems };
      }
      return c;
    });

    onUpdateChecklists(optimisticChecklists);
    const optimisticTask = { ...task, checklists: optimisticChecklists };
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: optimisticTask } }));
    }
    useAppStore.getState().updateTask(optimisticTask);

    try {
      let realChecklistId = targetChecklistId;

      // If there was an exclusion marker in DB, delete it
      if (existingExclusionItem && !existingExclusionItem.id.startsWith('temp-')) {
        await tasksApi.deleteChecklistItem(task.id, existingExclusionItem.checklistId, existingExclusionItem.id);
      }

      // If active item did not exist in DB and not naturally generated, create it
      if (tempItemCreated) {
        const res = await tasksApi.createChecklistItem(task.id, realChecklistId, { 
          text: auditId,
          subtaskId,
          checklistName: 'Audit',
        });
        const actualChecklistId = (res as any).checklistId || res.item.checklistId || realChecklistId;
        const reconciled = optimisticChecklists.map(c => {
          if (c.id === targetChecklistId || c.id === actualChecklistId) {
            return {
              ...c,
              id: actualChecklistId,
              items: (c.items || []).map(i => (i.id === optimisticItemId ? res.item : i)),
            };
          }
          return c;
        });
        onUpdateChecklists(reconciled);
        const reconciledTask = { ...task, checklists: reconciled };
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: reconciledTask } }));
        }
        useAppStore.getState().updateTask(reconciledTask);
      }
      toast.success(`Added ${auditId}`);
    } catch (e: any) {
      console.error('[AuditSection] Failed to add audit:', e);
      toast.error('Failed to add audit to server');
      onUpdateChecklists(checklists);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: { ...task, checklists } } }));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveAudit = async (auditText: string) => {
    if (!canManageAudits || isProcessing) return;
    setIsProcessing(true);

    const normAudit = normalizeAuditName(auditText);

    if (highlightedAudits) {
      const remaining = highlightedAudits.filter(t => normalizeAuditName(t) !== normAudit);
      setHighlightedAudits(remaining.length === 0 ? null : remaining);
    }

    // Check if an active item currently exists in DB/state
    const existingActiveItem = auditChecklists
      .flatMap(c => c.items || [])
      .find(i => !(i.text || '').startsWith('!') && normalizeAuditName(i.text) === normAudit);

    let targetChecklistId = existingActiveItem?.checklistId || auditChecklist?.id;
    const tempChecklistCreated = !targetChecklistId;
    if (!targetChecklistId) {
      targetChecklistId = `temp-cl-${Date.now()}`;
    }

    // Check if this audit is naturally generated by getRequiredAudits for this task title/roles
    const isNaturallyRequired = getRequiredAudits(title, auditorRoles).some(
      a => normalizeAuditName(a) === normAudit
    );

    const tempExclusionItemId = `temp-ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let optimisticChecklists = [...checklists];

    if (tempChecklistCreated) {
      optimisticChecklists.push({
        id: targetChecklistId,
        taskId: task.id,
        subtaskId: subtaskId || undefined,
        name: 'Audit',
        createdAt: new Date().toISOString(),
        items: [],
      });
    }

    optimisticChecklists = optimisticChecklists.map(c => {
      if (c.id === targetChecklistId) {
        // Remove the active item
        const nextItems = (c.items || []).filter(
          i => (i.text || '').startsWith('!') || normalizeAuditName(i.text) !== normAudit
        );
        // If naturally required by getRequiredAudits, add the exclusion marker
        if (isNaturallyRequired && !nextItems.some(i => (i.text || '').startsWith('!') && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normAudit)) {
          nextItems.push({
            id: tempExclusionItemId,
            checklistId: targetChecklistId,
            text: `!${auditText}`,
            completed: false,
            createdAt: new Date().toISOString(),
          });
        }
        return { ...c, items: nextItems };
      }
      return c;
    });

    // 1. Update frontend state immediately (optimistic update first)
    onUpdateChecklists(optimisticChecklists);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: { ...task, checklists: optimisticChecklists } } }));
    }

    // 2. Persist to DB in the background
    try {
      let realChecklistId = targetChecklistId;
      if (tempChecklistCreated) {
        const res = await tasksApi.createChecklist(task.id, {
          name: 'Audit',
          subtaskId,
        });
        realChecklistId = res.checklist.id;
      }

      // If active item existed in DB, delete it
      if (existingActiveItem && !existingActiveItem.id.startsWith('temp-')) {
        await tasksApi.deleteChecklistItem(task.id, existingActiveItem.checklistId, existingActiveItem.id);
      }

      // If naturally required, create exclusion item in DB so it stays excluded across sessions
      if (isNaturallyRequired) {
        const res = await tasksApi.createChecklistItem(task.id, realChecklistId, { text: `!${auditText}` });
        const reconciled = optimisticChecklists.map(c => {
          if (c.id === targetChecklistId || c.id === realChecklistId) {
            return {
              ...c,
              id: realChecklistId,
              items: (c.items || []).map(i => (i.id === tempExclusionItemId ? res.item : i)),
            };
          }
          return c;
        });
        onUpdateChecklists(reconciled);
        const reconciledTask = { ...task, checklists: reconciled };
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: reconciledTask } }));
        }
        useAppStore.getState().updateTask(reconciledTask);
      }
      toast.success(`Removed ${auditText}`);
    } catch (e: any) {
      console.error('[AuditSection] Failed to remove audit:', e);
      toast.error('Failed to remove audit from server');
      onUpdateChecklists(checklists);
      const revertedTask = { ...task, checklists };
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: revertedTask } }));
      }
      useAppStore.getState().updateTask(revertedTask);
    } finally {
      setIsProcessing(false);
    }
  };


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
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-700/80 border border-zinc-700/60 rounded-md transition-all shadow-sm cursor-pointer disabled:opacity-50"
                disabled={isProcessing}
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
                <span>Audit Items</span>
                <span className="text-xs text-zinc-500 font-normal">
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
                  const assigneeId = item?.assigneeId;
                  const assignee = assigneeId ? usersMap.get(assigneeId) : undefined;

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

                  const displayLabel = text === 'UI UX Audit' ? 'UI/UX Audit' : text;

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
                                  if (text === 'UI UX Audit' || text === 'UI/UX Audit') return uRoles.some(r => r.includes('ui/ux') || r.includes('ui ux') || r.includes('ui-ux'));
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
                            disabled={isProcessing}
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
