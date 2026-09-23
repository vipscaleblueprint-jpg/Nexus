import React, { useState } from 'react';
import { Task, Checklist, ChecklistItem, User as UserModel } from '@/lib/types';
import { tasksApi } from '@/api/tasks';
import { ChevronDown, ChevronRight, User, Check, ShieldCheck } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';

interface AuditSectionProps {
  task: Task;
  title: string;
  subtaskId?: string; 
  users: UserModel[];
  checklists: Checklist[];
  onUpdateChecklists: (checklists: Checklist[]) => void;
  currentUser?: UserModel | null;
}
export const getRequiredAudits = (taskTitle: string, auditorRoles?: string[]) => {
  const t = taskTitle.toLowerCase();
  const audits = new Set<string>();

  // Whatever auditor role was actually assigned (e.g. via the Galaxy "--Audit - <Role> -" subtask)
  // determines the required audit item directly, regardless of what the task title says.
  (auditorRoles || []).forEach((role) => {
    const r = role.toLowerCase();
    if (r.includes('ui') || r.includes('ux')) audits.add('UI UX Audit');
    if (r.includes('design')) audits.add('Design Audit');
    if (r.includes('funnel') || r.includes('backend')) audits.add('Funnel Audit');
  });

  // 3. Websites, Links, Landing Pages -> ALL THREE
  if (t.match(/website|page|funnel|link|domain|hosting|web|app/)) {
    audits.add('UI UX Audit');
    audits.add('Design Audit');
    audits.add('Funnel Audit');
  }
  
  // 2. Newsletters, Emails, Social Media Packages -> Design + Funnel
  if (t.match(/email|newsletter|social media|post|copy|campaign|marketing|seo/)) {
    audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  // 4. Backend and Logic -> Funnel Audit
  if (t.match(/backend|logic|api|database|server|function|endpoint|integration|automation|webhook|workflow|system|data/)) {
    audits.add('Funnel Audit');
  }

  // 1. Graphics, Reels, Video, Samples, Images, Audio, Content Creation -> ONLY Design
  if (t.match(/graphic|reel|video|sample|image|picture|photo|visual|motion|voice|audio|sound|caption|wardrobe|animation|vfx|sfx|content|media|edit|render|upscale|thumbnail|typography|podcast/)) {
    audits.add('Design Audit');
  }
  
  return Array.from(audits);
};

export function AuditSection({ task, title, subtaskId, users, checklists, onUpdateChecklists, currentUser }: AuditSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const auditChecklist = checklists.find(c => c.name.toLowerCase() === 'audit');

  // Roles suggested by the auditor: from the specific "--Audit" subtask when one is targeted,
  // otherwise from every "--Audit" subtask attached to this task.
  const auditorRoles = subtaskId
    ? (task.subtasks?.find((s: any) => s.id === subtaskId)?.assigneeRoleRestrictions || [])
    : (task.subtasks || [])
        .filter((s: any) => s.title?.toLowerCase().startsWith('--audit'))
        .flatMap((s: any) => s.assigneeRoleRestrictions || []);

  const requiredAuditItems = getRequiredAudits(title, auditorRoles);

  const getAuditItem = (text: string) => {
    return auditChecklist?.items?.find(i => i.text.toLowerCase() === text.toLowerCase());
  };

  const completedCount = requiredAuditItems.reduce((acc, text) => {
    const item = getAuditItem(text);
    return acc + (item?.completed ? 1 : 0);
  }, 0);

  const handleToggleItem = async (text: string, currentItem?: ChecklistItem) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      let targetChecklistId = auditChecklist?.id;
      let newChecklists = [...checklists];

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
      let targetChecklistId = auditChecklist?.id;
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

  return (
    <div className="w-full mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 group cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
          )}
          <span className="font-semibold text-zinc-100 flex items-center gap-2">
            Audit
          </span>
          <span className="text-sm text-zinc-500">{completedCount} of {requiredAuditItems.length} complete</span>
        </div>
      </div>

      {/* Checklists List */}
      {isExpanded && (
        <div className="flex flex-col gap-4">
          <div className="bg-white dark:bg-[#18181b] border border-emerald-900/30 rounded-xl overflow-hidden">
            {/* Checklist Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/60 bg-emerald-500/5">
              <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                Audit Items
              </div>
            </div>

            {/* Items */}
            <div className="p-2 flex flex-col">
              {requiredAuditItems.map((text, idx) => {
                const item = getAuditItem(text);
                const isCompleted = !!item?.completed;
                const assigneeId = item?.assigneeId;

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
                  }
                }

                return (
                  <div key={idx} className="flex items-center justify-between py-1.5 px-2 group/item hover:bg-zinc-800/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <button 
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${!canCheck || isProcessing ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${isCompleted ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-600 hover:border-zinc-400'}`}
                        onClick={() => {
                          if (canCheck) {
                            handleToggleItem(text, item);
                          }
                        }}
                        title={!canCheck ? `Only ${requiredRole || 'Admins'} can check this item` : ""}
                        disabled={isProcessing || !canCheck}
                      >
                        {isCompleted && <Check className="w-2.5 h-2.5" />}
                      </button>
                      <span className={`text-sm ${isCompleted ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                        {text}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100 transition-opacity">
                      {/* Assignee */}
                      <Popover.Root>
                        <Popover.Trigger asChild>
                          <button className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 cursor-pointer" disabled={isProcessing}>
                            {assigneeId ? (
                              <div className="w-full h-full rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-medium border border-emerald-500/30">
                                {users.find(u => u.id === assigneeId)?.name?.substring(0, 2).toUpperCase() || <User className="w-3 h-3" />}
                              </div>
                            ) : (
                              <User className="w-3 h-3" />
                            )}
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content className="z-[100] w-56 rounded-lg bg-zinc-900 border border-zinc-800 p-2 shadow-xl outline-none" align="end" sideOffset={5}>
                            <div className="text-xs font-medium text-zinc-500 mb-2 px-1">Assign to</div>
                            <div className="max-h-60 overflow-y-auto">
                              {users.map(u => (
                                <button 
                                  key={u.id}
                                  className="w-full text-left px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 rounded flex items-center gap-2 cursor-pointer"
                                  onClick={() => handleUpdateAssignee(text, item, u.id)}
                                >
                                  {u.avatarUrl ? (
                                    <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                                  ) : (
                                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-medium">
                                      {u.name?.substring(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                  {u.name}
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
