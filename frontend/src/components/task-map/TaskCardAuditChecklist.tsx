'use client';

import React, { useState } from 'react';
import { ShieldCheck, Check, Lock } from 'lucide-react';
import { TaskMapItem } from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { toast } from '@/lib/toast';
import { normalizeAuditName, getRequiredAudits, isNexusAuditChecklist, HIDE_DESIGN_AUDIT } from '@/lib/auditChecklist';

interface Props {
  task: TaskMapItem;
  isQueueColumn?: boolean;
  currentUser?: any;
  onChecklistsUpdated?: (updatedChecklists: any[]) => void;
}

export const TaskCardAuditChecklist: React.FC<Props> = ({
  task,
  isQueueColumn = false,
  currentUser,
  onChecklistsUpdated,
}) => {
  // Local optimistic checklists state
  const [localChecklists, setLocalChecklists] = useState<any[]>(task.checklists || []);
  const [isUpdating, setIsUpdating] = useState(false);

  // Sync if task.checklists change externally
  React.useEffect(() => {
    if (task.checklists) {
      setLocalChecklists(task.checklists);
    }
  }, [task.checklists]);

  // Find audit checklist in task
  const auditCl = (localChecklists || []).find((c) => isNexusAuditChecklist(c));
  const existingItems = auditCl?.items || [];

  // Excluded items (starting with !)
  const excludedSet = new Set(
    existingItems
      .filter((i: any) => (i.text || '').startsWith('!'))
      .map((i: any) => normalizeAuditName((i.text || '').replace(/^!\s*/, '')))
  );

  // Required audits from title & roles + any active items on the task
  const assigneeRoles = task.assignee?.roles || task.assigneeRoleRestrictions || [];
  const requiredTitles = getRequiredAudits(task.title || '', assigneeRoles);
  const activeExistingTexts = existingItems
    .filter((i: any) => !(i.text || '').startsWith('!'))
    .map((i: any) => i.text);

  // Sub-status audits (Funnel Audit, UI UX Audit, Design Audit, Instruction Audit)
  const subStatusAudits: string[] = [];
  (task.taskMap?.statuses || []).forEach((st) => {
    const norm = normalizeAuditName(st);
    if (norm === 'funnel audit') subStatusAudits.push('Funnel Audit');
    if (norm === 'ui ux audit' || norm === 'ui/ux audit') subStatusAudits.push('UI UX Audit');
    if (norm === 'design audit') subStatusAudits.push('Design Audit');
    if (norm === 'instruction audit' || norm === 'instructions audit') subStatusAudits.push('Instructions Audit');
  });

  const allAuditNames = Array.from(
    new Set([
      ...requiredTitles,
      ...activeExistingTexts,
      ...subStatusAudits,
    ].filter((name) => {
      const norm = normalizeAuditName(name);
      if (!name || name.startsWith('!') || excludedSet.has(norm)) return false;
      if (
        HIDE_DESIGN_AUDIT &&
        norm === 'design audit' &&
        !activeExistingTexts.some((t: string) => normalizeAuditName(t) === norm) &&
        !subStatusAudits.some((t: string) => normalizeAuditName(t) === norm)
      ) {
        return false;
      }
      return true;
    }))
  );

  if (allAuditNames.length === 0) {
    return null;
  }

  // Map each name to its item (if present)
  const auditItems = allAuditNames.map((name) => {
    const norm = normalizeAuditName(name);
    const existing = existingItems.find((i: any) => normalizeAuditName(i.text) === norm);
    return {
      name,
      norm,
      item: existing || null,
      completed: Boolean(existing?.completed),
    };
  });

  const completedCount = auditItems.filter((i) => i.completed).length;
  const totalCount = auditItems.length;
  const allComplete = completedCount === totalCount && totalCount > 0;

  const handleToggleItem = async (e: React.MouseEvent, itemDef: typeof auditItems[0]) => {
    e.stopPropagation();
    e.preventDefault();

    if (isQueueColumn) {
      toast.info('Task must be assigned to an auditor first before checking items');
      return;
    }

    if (isUpdating) return;
    setIsUpdating(true);

    const nextCompleted = !itemDef.completed;

    // 1. Optimistic local update
    let updatedCls = [...localChecklists];
    let targetCl = updatedCls.find((c) => isNexusAuditChecklist(c));
    if (!targetCl) {
      targetCl = {
        id: `temp-cl-${Date.now()}`,
        name: 'Audit',
        taskId: task.id,
        items: [],
      };
      updatedCls.push(targetCl);
    }

    let itemExisted = false;
    const nextItems = (targetCl.items || []).map((i: any) => {
      if (normalizeAuditName(i.text) === itemDef.norm) {
        itemExisted = true;
        return {
          ...i,
          completed: nextCompleted,
          checkedById: nextCompleted ? currentUser?.id : null,
        };
      }
      return i;
    });

    if (!itemExisted) {
      nextItems.push({
        id: `temp-item-${Date.now()}`,
        checklistId: targetCl.id,
        text: itemDef.name,
        completed: nextCompleted,
        checkedById: nextCompleted ? currentUser?.id : null,
      });
    }

    const finalCls = updatedCls.map((c) =>
      c.id === targetCl!.id ? { ...c, items: nextItems } : c
    );

    setLocalChecklists(finalCls);
    task.checklists = finalCls;
    if (onChecklistsUpdated) {
      onChecklistsUpdated(finalCls);
    }

    // 2. Persist to server
    try {
      if (itemDef.item && itemDef.item.id && !itemDef.item.id.startsWith('temp-')) {
        await tasksApi.updateChecklistItem(task.id, targetCl.id, itemDef.item.id, {
          completed: nextCompleted,
        });
      } else {
        const res = await tasksApi.createChecklistItem(task.id, targetCl.id, {
          text: itemDef.name,
          completed: nextCompleted,
          checklistName: 'Audit',
        });
        if (res?.item) {
          // Reconcile id
          const reconciledItems = nextItems.map((i: any) =>
            normalizeAuditName(i.text) === itemDef.norm ? { ...i, id: res.item.id } : i
          );
          const reconciledCls = finalCls.map((c) =>
            c.id === targetCl!.id ? { ...c, items: reconciledItems } : c
          );
          setLocalChecklists(reconciledCls);
          task.checklists = reconciledCls;
        }
      }
      toast.success(
        nextCompleted
          ? `✓ Checked "${itemDef.name}"`
          : `Unchecked "${itemDef.name}"`
      );
    } catch (err: any) {
      console.error('Failed to toggle audit item:', err);
      toast.error('Failed to update audit item');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div
      className="mt-2.5 pt-2 border-t border-zinc-800/70 flex flex-col gap-1.5 select-none"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldCheck
            className={`size-3.5 ${
              allComplete ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Audit Checklist
          </span>
          {isQueueColumn && (
            <span
              className="flex items-center gap-0.5 text-[9px] text-zinc-500 font-medium"
              title="Must be assigned to an auditor first"
            >
              <Lock className="size-2.5" />
              <span>Queue</span>
            </span>
          )}
        </div>
        <span
          className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full font-semibold border ${
            allComplete
              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
              : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/60'
          }`}
        >
          {completedCount}/{totalCount}
        </span>
      </div>

      {/* Items List */}
      <div className="space-y-1">
        {auditItems.map((itemDef) => {
          return (
            <div
              key={itemDef.norm}
              onClick={(e) => handleToggleItem(e, itemDef)}
              className={`flex items-center gap-2 px-1.5 py-1 rounded-md transition-colors text-xs ${
                isQueueColumn
                  ? 'cursor-not-allowed opacity-75 hover:bg-zinc-800/30'
                  : 'cursor-pointer hover:bg-zinc-800/60'
              }`}
              title={
                isQueueColumn
                  ? 'Must be assigned to an auditor first before checking'
                  : itemDef.completed
                  ? 'Click to uncheck'
                  : 'Click to check off'
              }
            >
              {/* Checkbox */}
              <div
                className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-all ${
                  itemDef.completed
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : isQueueColumn
                    ? 'border-zinc-700 bg-zinc-800/50'
                    : 'border-zinc-600 hover:border-zinc-400 bg-zinc-800/30'
                }`}
              >
                {itemDef.completed && <Check className="size-2.5 stroke-[3]" />}
              </div>

              {/* Text */}
              <span
                className={`text-[11px] leading-tight truncate flex-1 ${
                  itemDef.completed
                    ? 'text-zinc-400 line-through'
                    : 'text-zinc-200 font-medium'
                }`}
              >
                {itemDef.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
