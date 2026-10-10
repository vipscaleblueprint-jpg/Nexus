import React, { useState, useEffect, useRef } from 'react';
import { Task, Checklist, ChecklistItem, User as UserModel } from '@/lib/types';
import { tasksApi } from '@/api/tasks';
import { Plus, ChevronDown, ChevronRight, User, Trash2, X, MoreHorizontal, Maximize2, Check, ListTodo, Pencil } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { isNexusAuditChecklist } from '@/lib/auditChecklist';

interface ChecklistsSectionProps {
  task: Task;
  subtaskId?: string; 
  users: UserModel[];
  checklists: Checklist[];
  onUpdateChecklists: (checklists: Checklist[]) => void;
  currentUser?: UserModel | null;
}

export function ChecklistsSection({ task, subtaskId, users, checklists, onUpdateChecklists, currentUser }: ChecklistsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [creatingChecklist, setCreatingChecklist] = useState(false);
  // Inline rename of a checklist header (no modal)
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Set on Escape so the blur that follows doesn't save the draft
  const cancelRenameRef = useRef(false);

  const standardChecklists = checklists.filter(c => {
    // Only Nexus's own Audit checklist lives in the Audit section; ClickUp checklists
    // (even one named "Audit") show here as written in ClickUp.
    if (isNexusAuditChecklist(c)) return false;
    if (subtaskId) {
      return c.subtaskId === subtaskId;
    } else {
      return !c.subtaskId;
    }
  });

  const completedCount = standardChecklists.reduce((acc, list) => {
    return acc + (list.items?.every(i => i.completed) && list.items.length > 0 ? 1 : 0);
  }, 0);

  const handleCreateChecklist = async (name: string = 'Checklist') => {
    try {
      const res = await tasksApi.createChecklist(task.id, { 
        name, 
        subtaskId 
      });
      onUpdateChecklists([...checklists, res.checklist]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteChecklist = async (id: string) => {
    try {
      await tasksApi.deleteChecklist(task.id, id);
      onUpdateChecklists(checklists.filter(c => c.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const startRename = (checklist: Checklist) => {
    cancelRenameRef.current = false;
    setRenameDraft(checklist.name);
    setRenamingId(checklist.id);
  };

  const commitRename = async (checklistId: string) => {
    const wasCancelled = cancelRenameRef.current;
    cancelRenameRef.current = false;
    setRenamingId(null);
    if (wasCancelled) return;

    const original = checklists.find(c => c.id === checklistId);
    const name = renameDraft.trim();
    if (!original || !name || name === original.name) return;

    // Optimistic: the header shows the new name immediately; revert if the save fails
    onUpdateChecklists(checklists.map(c => (c.id === checklistId ? { ...c, name } : c)));
    try {
      await tasksApi.updateChecklist(task.id, checklistId, { name });
    } catch (e) {
      console.error(e);
      onUpdateChecklists(checklists.map(c => (c.id === checklistId ? { ...c, name: original.name } : c)));
    }
  };

  const handleCreateItem = async (checklistId: string) => {
    if (!newItemText.trim()) {
      setAddingItemTo(null);
      return;
    }
    try {
      const res = await tasksApi.createChecklistItem(task.id, checklistId, { text: newItemText });
      const updated = checklists.map(c => {
        if (c.id === checklistId) {
          return { ...c, items: [...(c.items || []), res.item] };
        }
        return c;
      });
      onUpdateChecklists(updated);
      setNewItemText('');
      setAddingItemTo(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateItem = async (checklistId: string, itemId: string, updates: Partial<ChecklistItem>) => {
    try {
      // Optimistic update
      const updated = checklists.map(c => {
        if (c.id === checklistId) {
          return {
            ...c,
            items: c.items.map(i => i.id === itemId ? { ...i, ...updates } : i)
          };
        }
        return c;
      });
      onUpdateChecklists(updated);

      await tasksApi.updateChecklistItem(task.id, checklistId, itemId, updates);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteItem = async (checklistId: string, itemId: string) => {
    try {
      await tasksApi.deleteChecklistItem(task.id, checklistId, itemId);
      const updated = checklists.map(c => {
        if (c.id === checklistId) {
          return { ...c, items: c.items.filter(i => i.id !== itemId) };
        }
        return c;
      });
      onUpdateChecklists(updated);
    } catch (e) {
      console.error(e);
    }
  };

  if (standardChecklists.length === 0 && !creatingChecklist) {
    return (
      <button 
        className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer"
        onClick={() => { setCreatingChecklist(true); handleCreateChecklist('Checklist'); }}
      >
        <ListTodo className="w-4 h-4 shrink-0" /> Create checklist
      </button>
    );
  }

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
          <span className="font-semibold text-zinc-100">Checklists</span>
          <span className="text-sm text-zinc-500">{completedCount} complete</span>
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-zinc-700 mx-1" />
          <button 
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateChecklist('Checklist');
            }}
            title="Create checklist"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Checklists List */}
      {isExpanded && (
        <div className="flex flex-col gap-4">
          {standardChecklists.map((checklist, index) => (
            <div key={checklist.id} className="bg-secondary/50 border border-zinc-800/60 rounded-xl">
              {/* Checklist Header */}
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800/60">
                <div className="flex items-center min-w-0 flex-1 font-medium text-sm text-zinc-100">
                  {renamingId === checklist.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        // Keep Enter/Escape from reaching the task modal's own key handlers
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.blur();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          cancelRenameRef.current = true;
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={() => commitRename(checklist.id)}
                      aria-label="Checklist name"
                      className="flex-1 min-w-0 bg-transparent font-medium text-sm text-zinc-100 rounded-md px-1.5 py-0.5 -mx-1.5 border border-zinc-700 outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/20"
                    />
                  ) : (
                    <span
                      className="truncate cursor-text"
                      onDoubleClick={() => startRename(checklist)}
                      title="Double-click to rename"
                    >
                      {checklist.name}
                    </span>
                  )}
                  <span className="text-zinc-400 font-normal text-xs ml-2 shrink-0">{index + 1} of {standardChecklists.length}</span>
                </div>
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <button className="text-zinc-400 hover:text-zinc-200 p-1 hover:bg-zinc-800 rounded-md cursor-pointer shrink-0">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content
                      className="z-[100000] w-48 rounded-lg bg-secondary border border-zinc-800 p-1 shadow-xl outline-none"
                      align="end"
                      sideOffset={5}
                      // Don't send focus back to the ⋯ button on close — it would steal focus from the rename input
                      onCloseAutoFocus={(e) => e.preventDefault()}
                    >
                      <Popover.Close asChild>
                        <button
                          className="w-full text-left px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 rounded flex items-center gap-2 cursor-pointer"
                          onClick={() => startRename(checklist)}
                        >
                          <Pencil className="w-4 h-4" /> Rename
                        </button>
                      </Popover.Close>
                      <button
                        className="w-full text-left px-2 py-1.5 text-sm text-red-400 hover:bg-zinc-800 rounded flex items-center gap-2 cursor-pointer"
                        onClick={() => handleDeleteChecklist(checklist.id)}
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </div>

              {/* Items */}
              <div className="p-2 flex flex-col">
                {(checklist.items || []).map(item => {
                  // Auditor-only ticking is for Nexus's Audit checklist; ClickUp checklists follow ClickUp.
                  const isAuditChecklist = isNexusAuditChecklist(checklist);
                  const isAuditor = (currentUser && (currentUser.roles || [])
                    .some(r => r?.toLowerCase().includes('auditor'))) || currentUser?.systemRole === 'ADMIN';
                  const canCheck = !isAuditChecklist || isAuditor;

                  return (
                  <div key={item.id} className="flex items-start gap-3 py-1.5 px-2 group/item hover:bg-zinc-800/30 rounded-lg">
                    <button 
                      className={`w-4 h-4 mt-0.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${!canCheck ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${item.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-600 hover:border-zinc-400'}`}
                      onClick={() => {
                        if (canCheck) {
                          handleUpdateItem(checklist.id, item.id, { completed: !item.completed });
                        }
                      }}
                      title={!canCheck ? "Only auditors can check this item" : ""}
                    >
                      {item.completed && <Check className="w-2.5 h-2.5" />}
                    </button>
                    
                    <input 
                      type="text" 
                      value={item.text}
                      onChange={(e) => {
                        const updated = checklists.map(c => c.id === checklist.id ? {
                          ...c, items: c.items.map(i => i.id === item.id ? { ...i, text: e.target.value } : i)
                        } : c);
                        onUpdateChecklists(updated);
                      }}
                      onBlur={(e) => handleUpdateItem(checklist.id, item.id, { text: e.target.value })}
                      className={`flex-1 bg-transparent border-none outline-none text-sm min-w-0 ${item.completed ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}
                    />

                    <div className="flex items-center gap-1">
                      {/* Assignee */}
                      <Popover.Root>
                        <Popover.Trigger asChild>
                          <button className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 cursor-pointer">
                            {item.assigneeId ? (
                              <div className="w-full h-full rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-medium border border-indigo-500/30">
                                {users.find(u => u.id === item.assigneeId)?.name?.substring(0, 2).toUpperCase() || <User className="w-3 h-3" />}
                              </div>
                            ) : (
                              <User className="w-3 h-3" />
                            )}
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content className="z-[100000] w-56 rounded-lg bg-secondary border border-zinc-800 p-2 shadow-xl outline-none" align="end" sideOffset={5}>
                            <div className="text-xs font-medium text-zinc-500 mb-2 px-1">Assign to</div>
                            <div className="max-h-60 overflow-y-auto">
                              <button 
                                className="w-full text-left px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 rounded flex items-center gap-2 mb-1 cursor-pointer"
                                onClick={() => handleUpdateItem(checklist.id, item.id, { assigneeId: '' })}
                              >
                                <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center"><X className="w-3 h-3" /></div>
                                Unassigned
                              </button>
                              {users.map(u => (
                                <button 
                                  key={u.id}
                                  className="w-full text-left px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 rounded flex items-center gap-2 cursor-pointer"
                                  onClick={() => handleUpdateItem(checklist.id, item.id, { assigneeId: u.id })}
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

                      {/* Delete */}
                      <button 
                        className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-red-400 rounded hover:bg-zinc-800 cursor-pointer"
                        onClick={() => handleDeleteItem(checklist.id, item.id)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  );
                })}

                {/* Add Item Row */}
                {addingItemTo === checklist.id ? (
                  <div className="flex items-start gap-3 py-1.5 px-2 mt-1">
                    <div className="w-4 h-4 mt-0.5 rounded-full border border-zinc-700 shrink-0" />
                    <input 
                      autoFocus
                      type="text" 
                      value={newItemText}
                      onChange={(e) => setNewItemText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateItem(checklist.id);
                        if (e.key === 'Escape') setAddingItemTo(null);
                      }}
                      onBlur={() => handleCreateItem(checklist.id)}
                      placeholder="Add an item"
                      className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-200 min-w-0"
                    />
                  </div>
                ) : (
                  <button 
                    className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 py-1.5 px-2 mt-1 w-full text-left rounded-lg hover:bg-zinc-800/30 cursor-pointer"
                    onClick={() => {
                      setAddingItemTo(checklist.id);
                      setNewItemText('');
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add item
                  </button>
                )}
              </div>
            </div>
          ))}
          
          <button
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 mt-2 px-1 w-max cursor-pointer"
            onClick={() => handleCreateChecklist('Checklist')}
          >
            <Plus className="w-3.5 h-3.5" /> Add checklist
          </button>
        </div>
      )}
    </div>
  );
}
