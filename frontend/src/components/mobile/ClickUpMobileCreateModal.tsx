'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Search,
  CheckCircle2,
  FolderKanban,
  Layers,
  Folder as FolderIcon,
  FileText,
  Rocket,
  Plus,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { tasksApi } from '@/api/tasks';
import { toast } from '@/lib/toast';

export interface ClickUpMobileCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCreateSpace?: () => void;
  onOpenCreateFolder?: () => void;
  onOpenCreateList?: () => void;
  onOpenCreateDoc?: () => void;
  onOpenGalaxyTasks?: () => void;
}

export function ClickUpMobileCreateModal({
  isOpen,
  onClose,
  onOpenCreateSpace,
  onOpenCreateFolder,
  onOpenCreateList,
  onOpenCreateDoc,
  onOpenGalaxyTasks,
}: ClickUpMobileCreateModalProps) {
  const { allLists, addTask, currentUser } = useAppStore();
  const [inputText, setInputText] = useState('');
  const [selectedListId, setSelectedListId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const flatLists = useMemo(() => {
    return (allLists || []).map((item: any) => item.list || item).filter(Boolean);
  }, [allLists]);

  const effectiveListId = selectedListId || (flatLists.length > 0 ? flatLists[0].id : '');

  const handleCreateTask = async (customTitle?: string) => {
    const titleToUse = (customTitle || inputText).trim();
    if (!titleToUse) {
      toast.error('Please enter a task title');
      return;
    }

    if (!effectiveListId) {
      toast.error('No list available to create task');
      return;
    }

    try {
      setIsCreating(true);
      const res = await tasksApi.createTask({
        title: titleToUse,
        listId: effectiveListId,
        assigneeId: currentUser?.id,
        status: 'PENDING',
        priority: 'MEDIUM',
      });

      if (res?.task) {
        addTask(res.task);
        toast.success(`Task "${titleToUse}" created`);
        setInputText('');
        onClose();
      }
    } catch {
      toast.error('Failed to create task');
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateTask();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 md:hidden"
          />

          {/* Create Modal / Bottom Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className="fixed inset-x-0 bottom-0 z-50 bg-card border-t border-border rounded-t-3xl max-h-[85vh] flex flex-col md:hidden shadow-2xl safe-bottom text-foreground"
          >
            {/* Sheet Handle */}
            <div className="w-10 h-1 bg-muted-foreground/30 rounded-full mx-auto mt-3 mb-1" />

            {/* Header: Title + Dismiss */}
            <div className="px-5 py-2.5 flex items-center justify-between shrink-0">
              <span className="w-8" />
              <h2 className="text-base font-bold text-foreground">Create in Nexus</h2>
              <button
                onClick={onClose}
                className="size-7 rounded-full bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Quick Task Input Bar */}
            <div className="px-5 py-2 shrink-0 space-y-2">
              <div className="relative w-full">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
                  <Search className="size-4" />
                </div>
                <input
                  type="text"
                  placeholder="Create a new task..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isCreating}
                  className="w-full pl-10 pr-10 py-3 bg-secondary/50 border border-border rounded-2xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-indigo-500/70 transition-all shadow-inner"
                  autoFocus
                />
                {isCreating ? (
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-indigo-400">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                ) : inputText ? (
                  <button
                    onClick={() => setInputText('')}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>

              {/* Target List Selector */}
              {flatLists.length > 0 && (
                <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                  <span>Destination list:</span>
                  <select
                    value={effectiveListId}
                    onChange={(e) => setSelectedListId(e.target.value)}
                    className="bg-secondary border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none"
                  >
                    {flatLists.map((l: any) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Creation Options */}
            <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2 custom-scrollbar">
              {/* Quick Create Task button */}
              <button
                onClick={() => handleCreateTask()}
                disabled={isCreating || !inputText.trim()}
                className={`w-full flex items-center justify-between px-3 py-3 rounded-xl border transition-all text-left ${
                  inputText.trim()
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm cursor-pointer'
                    : 'bg-secondary/40 border-border text-muted-foreground cursor-not-allowed opacity-70'
                }`}
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="size-5 shrink-0" />
                  <span className="text-sm font-semibold">
                    {inputText.trim() ? `Create Task "${inputText.trim()}"` : 'Enter task title above'}
                  </span>
                </div>
                <Plus className="size-4 shrink-0" />
              </button>

              <div className="pt-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1.5">
                  Nexus Entities
                </h3>

                <div className="space-y-1">
                  {/* Create List */}
                  <button
                    onClick={() => {
                      onClose();
                      if (onOpenCreateList) onOpenCreateList();
                    }}
                    className="w-full flex items-center gap-3.5 px-3 py-2.5 hover:bg-hover-subtle rounded-xl transition-colors text-left"
                  >
                    <div className="p-1.5 rounded-lg bg-blue-500/15 text-blue-400">
                      <FolderKanban className="size-4" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-foreground block">New List</span>
                      <span className="text-[11px] text-muted-foreground">Add a client list or task board</span>
                    </div>
                  </button>

                  {/* Create Folder */}
                  <button
                    onClick={() => {
                      onClose();
                      if (onOpenCreateFolder) onOpenCreateFolder();
                    }}
                    className="w-full flex items-center gap-3.5 px-3 py-2.5 hover:bg-hover-subtle rounded-xl transition-colors text-left"
                  >
                    <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400">
                      <FolderIcon className="size-4" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-foreground block">New Folder</span>
                      <span className="text-[11px] text-muted-foreground">Group lists inside a space</span>
                    </div>
                  </button>

                  {/* Create Space */}
                  <button
                    onClick={() => {
                      onClose();
                      if (onOpenCreateSpace) onOpenCreateSpace();
                    }}
                    className="w-full flex items-center gap-3.5 px-3 py-2.5 hover:bg-hover-subtle rounded-xl transition-colors text-left"
                  >
                    <div className="p-1.5 rounded-lg bg-purple-500/15 text-purple-400">
                      <Layers className="size-4" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-foreground block">New Space</span>
                      <span className="text-[11px] text-muted-foreground">Top-level workspace department</span>
                    </div>
                  </button>

                  {/* Create Doc */}
                  <button
                    onClick={() => {
                      onClose();
                      if (onOpenCreateDoc) onOpenCreateDoc();
                    }}
                    className="w-full flex items-center gap-3.5 px-3 py-2.5 hover:bg-hover-subtle rounded-xl transition-colors text-left"
                  >
                    <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400">
                      <FileText className="size-4" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-foreground block">New Doc</span>
                      <span className="text-[11px] text-muted-foreground">Collaborative rich document</span>
                    </div>
                  </button>

                  {/* Galaxy Tasks */}
                  {onOpenGalaxyTasks && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenGalaxyTasks();
                      }}
                      className="w-full flex items-center gap-3.5 px-3 py-2.5 hover:bg-hover-subtle rounded-xl transition-colors text-left"
                    >
                      <div className="p-1.5 rounded-lg bg-sky-500/15 text-sky-400">
                        <Rocket className="size-4" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-foreground block">Galaxy Tasks</span>
                        <span className="text-[11px] text-muted-foreground">Tasks from VIP Scale webhooks</span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
