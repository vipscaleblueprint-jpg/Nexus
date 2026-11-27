'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { NexusLogoLoader } from '@/components/ui/NexusLogo';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import {
  X,
  Rocket,
  GitBranch,
  RotateCcw,
  ChevronDown,
  ChevronsUpDown,
  Check,
  Sparkles,
  Loader2,
  Link2,
  Globe,
  Mail,
  FileText,
  Layout,
  MessageCircle,
  Send,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import {
  tasksApi,
  type GalaxyClientOption,
  type GalaxyParentTaskOption,
  type GalaxyTaskPayload,
} from '@/api/tasks';
import type { GalaxyModalInitialData } from '@/lib/galaxyTask';

type GalaxyMode = 'task' | 'subtask';

interface GalaxyTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: GalaxyModalInitialData | null;
}

const PRIORITY_OPTIONS = ['Urgent', 'High', 'Low'];
const COMPLEXITY_OPTIONS = ['Beginner', 'Advanced', 'High', 'Important'];
const CHANNEL_OPTIONS = [
  { label: 'ClickUp', value: 'https://app.clickup.com/', icon: Layout },
  { label: 'Gmail', value: 'https://gmail.com/', icon: Mail },
  { label: 'Google Docs', value: 'https://docs.google.com/', icon: FileText },
  { label: 'Google Calendar', value: 'https://calendar.google.com/', icon: Globe },
  { label: 'WhatsApp', value: 'WhatsApp', icon: MessageCircle },
  { label: 'Telegram', value: 'Telegram', icon: Send },
];

function extractClickUpTaskId(url?: string): string | null {
  if (!url) return null;
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const parts = cleanUrl.split('/');
    const tIndex = parts.indexOf('t');
    if (tIndex !== -1) {
      let startIndex = tIndex + 1;
      if (parts[startIndex] === 'h') startIndex++;
      const remaining = parts.slice(startIndex).filter(Boolean);
      if (remaining.length > 0) return remaining[remaining.length - 1];
    }
  } catch {
    // Ignore malformed link
  }
  return null;
}

function getLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function isClientMatch(clientName: string, selectedClientName: string): boolean {
  const targetName = clientName.trim().toLowerCase();
  const selName = selectedClientName.trim().toLowerCase();
  if (!targetName || !selName) return false;
  if (targetName === selName) return true;
  if (targetName.includes(selName) || selName.includes(targetName)) return true;
  return getLevenshteinDistance(targetName, selName) <= 2;
}

/**
 * On-demand Galaxy Task & Subtask creation modal connected to VIPScale's Galaxy API.
 * Only fetches clients when opened, and only fetches parent tasks when switching to Subtask mode.
 */
export function GalaxyTaskModal({ isOpen, onClose, initialData }: GalaxyTaskModalProps) {
  const router = useRouter();

  const [mode, setMode] = useState<GalaxyMode>(initialData?.mode || 'task');

  // On-demand remote options
  const [clients, setClients] = useState<GalaxyClientOption[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);

  const [parentTasks, setParentTasks] = useState<GalaxyParentTaskOption[]>([]);
  const [hasLoadedParentTasks, setHasLoadedParentTasks] = useState(false);
  const [loadingParentTasks, setLoadingParentTasks] = useState(false);
  const [parentTasksError, setParentTasksError] = useState<string | null>(null);

  // Popover controls
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [parentPopoverOpen, setParentPopoverOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [complexityOpen, setComplexityOpen] = useState(false);

  // Form fields
  const [clientName, setClientName] = useState(initialData?.clientName || '');
  const [title, setTitle] = useState(initialData?.title || '');
  const [taskLink, setTaskLink] = useState(initialData?.taskLink || '');
  const [parentTaskName, setParentTaskName] = useState(initialData?.parentTaskName || '');
  const [link, setLink] = useState('');
  const [priority, setPriority] = useState(initialData?.priority || '');
  const [complexity, setComplexity] = useState(initialData?.complexity || '');
  const [goal, setGoal] = useState(initialData?.goal || '');
  const [prompt, setPrompt] = useState(initialData?.prompt || '');
  const [launchDate, setLaunchDate] = useState('');

  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const parentTasksRequestedRef = useRef(false);

  // Validation & submission state
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [resultState, setResultState] = useState<{
    status: 'idle' | 'success' | 'error';
    assignedTeam?: string;
    nexusTaskId?: string;
    targetLink?: string;
    errorMessage?: string;
  }>({ status: 'idle' });

  const loadClients = useCallback(async () => {
    setLoadingClients(true);
    setClientsError(null);
    try {
      const res = await tasksApi.getGalaxyClients();
      setClients(res.clients || []);
    } catch (err: unknown) {
      setClientsError(err instanceof Error ? err.message : 'Failed to load clients from VIPScale.');
    } finally {
      setLoadingClients(false);
    }
  }, []);

  const loadParentTasks = useCallback(async () => {
    setLoadingParentTasks(true);
    setParentTasksError(null);
    try {
      const res = await tasksApi.getGalaxyParentTasks();
      setParentTasks(res.tasks || []);
      setHasLoadedParentTasks(true);
    } catch (err: unknown) {
      setParentTasksError(err instanceof Error ? err.message : 'Failed to load parent tasks from VIPScale.');
    } finally {
      setLoadingParentTasks(false);
    }
  }, []);

  // Only fetch clients once the modal mounts (triggered when user clicks "+ Add Task")
  useEffect(() => {
    let cancelled = false;
    tasksApi
      .getGalaxyClients()
      .then((res) => {
        if (!cancelled) setClients(res.clients || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setClientsError(err instanceof Error ? err.message : 'Failed to load clients from VIPScale.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingClients(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTaskLinkChange = (nextLink: string) => {
    setTaskLink(nextLink);
    if (fieldErrors.task_link) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.task_link;
        return next;
      });
    }

    const pastedTaskId = extractClickUpTaskId(nextLink.trim());
    if (!pastedTaskId || parentTasks.length === 0 || clients.length === 0) return;

    const matchingTask = parentTasks.find(
      (t) => extractClickUpTaskId(t.clickup_task_link) === pastedTaskId,
    );
    if (!matchingTask?.client_name) return;

    const matchedClient = clients.find(
      (c) => c.name && isClientMatch(matchingTask.client_name, c.name),
    );
    if (matchedClient?.name && matchedClient.name !== clientName) {
      setClientName(matchedClient.name);
      setFieldErrors((prev) => {
        if (!prev.client) return prev;
        const next = { ...prev };
        delete next.client;
        return next;
      });
    }
  };

  const filteredParentTasks = useMemo(() => {
    return parentTasks.filter((t) => {
      if (t.task_name && t.task_name.includes('--')) return false;
      if (!clientName) return true;
      return isClientMatch(t.client_name, clientName);
    });
  }, [parentTasks, clientName]);

  const canonicalTaskLink = useMemo(() => {
    const trimmed = taskLink.trim();
    if (!trimmed) return '';
    const pastedId = extractClickUpTaskId(trimmed);
    if (!pastedId) return trimmed;
    const match = filteredParentTasks.find(
      (t) => extractClickUpTaskId(t.clickup_task_link) === pastedId,
    );
    return match ? match.clickup_task_link : trimmed;
  }, [taskLink, filteredParentTasks]);

  const handleReset = useCallback(() => {
    setTitle('');
    setTaskLink('');
    setParentTaskName('');
    setLink('');
    setPriority('');
    setComplexity('');
    setGoal('');
    setPrompt('');
    setLaunchDate('');
    setClientName('');
    setFieldErrors({});
    setResultState({ status: 'idle' });
  }, []);

  // Sync initialData when modal opens
  useEffect(() => {
    if (isOpen) {
      const nextMode = initialData?.mode || 'task';
      setMode(nextMode);
      setClientName(initialData?.clientName || '');
      setTitle(initialData?.title || '');
      setTaskLink(initialData?.taskLink || '');
      setParentTaskName(initialData?.parentTaskName || '');
      setLink('');
      setPriority(initialData?.priority || '');
      setComplexity(initialData?.complexity || '');
      setGoal(initialData?.goal || '');
      setPrompt(initialData?.prompt || '');
      setLaunchDate('');
      setFieldErrors({});
      setResultState({ status: 'idle' });

      if (nextMode === 'subtask' && !parentTasksRequestedRef.current) {
        parentTasksRequestedRef.current = true;
        loadParentTasks();
      }

      // Auto-focus prompt input: "we just gonna put the prompt"
      const t = setTimeout(() => {
        promptInputRef.current?.focus();
      }, 120);
      return () => clearTimeout(t);
    }
  }, [isOpen, initialData, loadParentTasks]);

  // When clients load, match prefilled client name
  useEffect(() => {
    if (clients.length > 0 && clientName) {
      const exact = clients.find((c) => c.name.toLowerCase() === clientName.toLowerCase());
      if (exact) {
        if (clientName !== exact.name) setClientName(exact.name);
      } else {
        const fuzzy = clients.find((c) => isClientMatch(clientName, c.name));
        if (fuzzy && fuzzy.name !== clientName) {
          setClientName(fuzzy.name);
        }
      }
    }
  }, [clients, clientName]);

  // When parent tasks load, match taskLink or parentTaskName
  useEffect(() => {
    if (!isOpen || parentTasks.length === 0) return;

    const pastedTaskId = extractClickUpTaskId(taskLink.trim());
    let matchedParent = pastedTaskId
      ? parentTasks.find((t) => extractClickUpTaskId(t.clickup_task_link) === pastedTaskId)
      : undefined;

    if (!matchedParent && parentTaskName) {
      matchedParent = parentTasks.find(
        (t) => t.task_name && t.task_name.trim().toLowerCase() === parentTaskName.trim().toLowerCase(),
      );
      if (matchedParent?.clickup_task_link && !pastedTaskId) {
        setTaskLink(matchedParent.clickup_task_link);
      }
    }

    if (matchedParent) {
      if (matchedParent.task_name && !parentTaskName) {
        setParentTaskName(matchedParent.task_name);
      }
      if (matchedParent.client_name && clients.length > 0) {
        const matchedClient = clients.find(
          (c) => c.name && isClientMatch(matchedParent.client_name, c.name),
        );
        if (matchedClient?.name && matchedClient.name !== clientName) {
          setClientName(matchedClient.name);
        }
      }
    }
  }, [isOpen, parentTasks, taskLink, parentTaskName, clients, clientName]);

  useEffect(() => {
    if (resultState.status !== 'success') return;
    const timer = window.setTimeout(() => {
      handleReset();
      onClose();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [resultState.status, handleReset, onClose]);

  const handleModeChange = (nextMode: GalaxyMode) => {
    if (submitting) return;
    setMode(nextMode);
    setFieldErrors({});
    setResultState({ status: 'idle' });
    if (nextMode === 'subtask' && !hasLoadedParentTasks && !loadingParentTasks) {
      parentTasksRequestedRef.current = true;
      loadParentTasks();
    }
  };

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!clientName.trim()) {
      nextErrors.client = 'Please select a client.';
    }
    if (mode === 'subtask' && !taskLink.trim()) {
      nextErrors.task_link = 'Please select or provide a parent task link.';
    }
    if (mode === 'task' && !goal.trim()) {
      nextErrors.goal = 'Please say what this task is for.';
    }
    if (!prompt.trim()) {
      nextErrors.prompt = 'Prompt is required.';
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitForm = async () => {
    if (!validate() || submitting) return;

    const clientObj = clients.find((c) => c.name === clientName);
    if (!clientObj) {
      setFieldErrors((prev) => ({ ...prev, client: 'Please select a valid client.' }));
      return;
    }

    const payload: GalaxyTaskPayload = {
      clients: {
        name: clientObj.name,
        id: clientObj.clickup_id || clientObj.id,
      },
      prompt: prompt.trim(),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(link.trim() ? { link: link.trim() } : {}),
      ...(mode === 'subtask' && taskLink.trim() ? { task_link: taskLink.trim() } : {}),
      ...(goal.trim() ? { goal: goal.trim() } : {}),
      ...(priority ? { priority } : {}),
      ...(complexity ? { complexity } : {}),
      ...(mode === 'task' && launchDate ? { launch_date: launchDate } : {}),
    };

    setSubmitting(true);
    setResultState({ status: 'idle' });

    try {
      const data =
        mode === 'subtask'
          ? await tasksApi.createGalaxySubtask(payload)
          : await tasksApi.createGalaxyTask(payload);

      const targetLink = data.nexus_task_link || data.task_link;
      if (!data.error && targetLink) {
        setResultState({
          status: 'success',
          assignedTeam: data.assigned_team,
          nexusTaskId: data.nexus_task_id,
          targetLink,
        });
      } else {
        setResultState({
          status: 'error',
          errorMessage: data.error || 'Unknown response format from VIPScale Galaxy.',
          nexusTaskId: data.nexus_task_id,
          targetLink,
        });
      }
    } catch (err: unknown) {
      setResultState({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'An error occurred while creating the task.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitForm();
  };

  const handleViewResult = () => {
    if (resultState.nexusTaskId) {
      onClose();
      router.push(`/tasks/${resultState.nexusTaskId}`);
      return;
    }
    if (resultState.targetLink) {
      window.open(resultState.targetLink, '_blank', 'noopener,noreferrer');
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto"
        onClick={() => !submitting && onClose()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl bg-zinc-950 border border-purple-500/20 rounded-2xl shadow-2xl shadow-purple-500/10 overflow-hidden text-zinc-200 my-auto max-h-[92vh] flex flex-col"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-purple-500/15 flex items-center justify-between shrink-0 bg-gradient-to-r from-purple-500/10 via-transparent to-pink-500/10">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
                <Rocket className="size-4 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold leading-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
                  {mode === 'task' ? 'Create Galaxy Task' : 'Create Galaxy Subtask'}
                </h2>
                <p className="text-xs text-purple-200/70">
                  {mode === 'task'
                    ? 'Start a fresh task for a client via VIPScale Galaxy'
                    : 'Add a sub-item to an existing ClickUp / Nexus task'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleReset}
                disabled={submitting}
                title="Reset form"
                className="p-1.5 rounded-md text-zinc-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors cursor-pointer disabled:opacity-40"
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                title="Close"
                className="p-1.5 rounded-md text-zinc-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors cursor-pointer disabled:opacity-40"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="px-5 pt-3 pb-2 border-b border-purple-500/15 flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleModeChange('task')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'task'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md shadow-purple-500/25'
                  : 'text-zinc-400 hover:text-purple-300 hover:bg-purple-500/10'
              }`}
            >
              <Rocket className="size-3.5" />
              <span>New Task</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('subtask')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'subtask'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md shadow-purple-500/25'
                  : 'text-zinc-400 hover:text-purple-300 hover:bg-purple-500/10'
              }`}
            >
              <GitBranch className="size-3.5" />
              <span>Subtask</span>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
            {submitting || resultState.status !== 'idle' ? (
              <div className="py-8 px-4 flex flex-col items-center text-center gap-4">
                {submitting ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 shadow-xl flex items-center justify-center">
                      <NexusLogoLoader size={56} />
                    </div>
                    <div className="space-y-1.5 max-w-sm">
                      <h3 className="text-base font-bold text-zinc-100">
                        {mode === 'subtask' ? 'Creating Subtask...' : 'Creating Task...'}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        Synchronizing details and assigning via Galaxy AI. Please wait...
                      </p>
                    </div>
                  </div>
                ) : resultState.status === 'success' ? (
                  <>
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 24 }}
                      className="size-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center"
                    >
                      <CheckCircle2 className="size-8 text-emerald-400" />
                    </motion.div>
                    <div className="space-y-1.5">
                      <h3 className="text-lg font-bold text-zinc-100">
                        {mode === 'subtask' ? 'Subtask Created Successfully!' : 'Task Created Successfully!'}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        Your {mode === 'subtask' ? 'subtask' : 'task'} has been synced to ClickUp and Nexus.
                      </p>
                      {resultState.assignedTeam && (
                        <p className="text-xs font-semibold text-purple-400 pt-1">
                          Assigned to: {resultState.assignedTeam}
                        </p>
                      )}
                    </div>
                    <div className="w-40 h-1 rounded-full bg-zinc-800 overflow-hidden mt-1">
                      <motion.div
                        initial={{ width: '100%' }}
                        animate={{ width: '0%' }}
                        transition={{ duration: 2.5, ease: 'linear' }}
                        className="h-full bg-emerald-500"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="size-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
                      <AlertCircle className="size-8 text-red-400" />
                    </div>
                    <div className="space-y-1.5 max-w-md">
                      <h3 className="text-lg font-bold text-red-400">
                        {mode === 'subtask' ? 'Subtask Creation Failed' : 'Task Creation Failed'}
                      </h3>
                      <p className="text-xs text-zinc-300 leading-relaxed">
                        {resultState.errorMessage}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 w-full max-w-sm">
                      <button
                        type="button"
                        onClick={() => setResultState({ status: 'idle' })}
                        className="flex-1 px-4 py-2 rounded-lg border border-zinc-700 text-sm font-medium text-purple-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        Back to Form
                      </button>
                      {resultState.nexusTaskId || resultState.targetLink ? (
                        <button
                          type="button"
                          onClick={handleViewResult}
                          className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <span>Open Existing</span>
                          <ExternalLink className="size-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={submitForm}
                          className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors cursor-pointer"
                        >
                          Try Again
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <form id="galaxy-task-form" onSubmit={handleSubmit} className="space-y-5">
                {clientsError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center justify-between gap-2">
                    <span>{clientsError}</span>
                    <button
                      type="button"
                      onClick={loadClients}
                      className="px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-400 font-semibold shrink-0 cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Client */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-purple-200">
                      Client <span className="text-pink-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={loadClients}
                      disabled={loadingClients}
                      title="Refresh clients"
                      className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <RefreshCw className={`size-3.5 ${loadingClients ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  <Popover.Root open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
                    <Popover.Trigger asChild>
                      <button
                        type="button"
                        disabled={loadingClients}
                        className="w-full flex items-center justify-between bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-left text-zinc-200 hover:border-purple-500/50 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <span className={`truncate ${clientName ? 'text-zinc-100' : 'text-zinc-500'}`}>
                          {loadingClients ? 'Loading clients...' : clientName || 'Select a client'}
                        </span>
                        <ChevronsUpDown className="size-4 text-zinc-500 shrink-0 ml-2" />
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        align="start"
                        sideOffset={4}
                        className="z-[100001] w-[var(--radix-popover-trigger-width)] bg-zinc-950 border border-purple-500/20 rounded-lg shadow-2xl overflow-hidden outline-none"
                      >
                        <Command className="w-full">
                          <div className="border-b border-zinc-800 px-2.5 py-2">
                            <Command.Input
                              placeholder="Search client..."
                              className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                            />
                          </div>
                          <Command.List className="max-h-56 overflow-y-auto custom-scrollbar p-1">
                            <Command.Empty className="py-4 text-center text-xs text-zinc-500">
                              No clients found.
                            </Command.Empty>
                            {clients.map((c) => {
                              const selected = clientName === c.name;
                              return (
                                <Command.Item
                                  key={c.id}
                                  value={c.name}
                                  onSelect={() => {
                                    setClientName(c.name);
                                    setFieldErrors((prev) => {
                                      const next = { ...prev };
                                      delete next.client;
                                      return next;
                                    });
                                    setClientPopoverOpen(false);
                                  }}
                                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-zinc-200 cursor-pointer data-[selected=true]:bg-purple-500/20 data-[selected=true]:text-white"
                                >
                                  <Check
                                    className={`size-3.5 text-purple-400 shrink-0 ${
                                      selected ? 'opacity-100' : 'opacity-0'
                                    }`}
                                  />
                                  <span className="truncate">{c.name}</span>
                                </Command.Item>
                              );
                            })}
                          </Command.List>
                        </Command>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                  {fieldErrors.client && (
                    <p className="text-xs text-pink-400">{fieldErrors.client}</p>
                  )}
                </div>

                {/* Task Title */}
                <div className="space-y-1.5">
                  <label htmlFor="galaxy-task-title" className="text-sm font-medium text-purple-200 block">
                    Task Title <span className="text-zinc-500 font-normal">(Optional)</span>
                  </label>
                  <input
                    id="galaxy-task-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter task title..."
                    className="w-full bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/40"
                  />
                </div>

                {/* Parent Task & Task Link (Subtask mode only) */}
                {mode === 'subtask' && (
                  <div className="space-y-3 p-3.5 rounded-xl border border-purple-500/20 bg-purple-500/5">
                    {parentTasksError && (
                      <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center justify-between gap-2">
                        <span>{parentTasksError}</span>
                        <button
                          type="button"
                          onClick={loadParentTasks}
                          className="px-2 py-0.5 rounded bg-red-500/15 hover:bg-red-500/25 text-red-400 font-semibold shrink-0 cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-purple-200">
                          Parent Task
                        </label>
                        <button
                          type="button"
                          onClick={loadParentTasks}
                          disabled={loadingParentTasks}
                          title="Refresh parent tasks"
                          className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-40"
                        >
                          <RefreshCw className={`size-3.5 ${loadingParentTasks ? 'animate-spin' : ''}`} />
                        </button>
                      </div>

                      <Popover.Root open={parentPopoverOpen} onOpenChange={setParentPopoverOpen}>
                        <Popover.Trigger asChild>
                          <button
                            type="button"
                            disabled={loadingParentTasks}
                            className="w-full flex items-center justify-between bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-left text-zinc-200 hover:border-purple-500/50 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer disabled:opacity-60"
                          >
                            <span className="truncate text-zinc-300">
                              {loadingParentTasks
                                ? 'Loading parent tasks...'
                                : filteredParentTasks.find((t) => t.clickup_task_link === canonicalTaskLink)
                                    ?.task_name || parentTaskName || 'Search parent tasks...'}
                            </span>
                            <ChevronsUpDown className="size-4 text-zinc-500 shrink-0 ml-2" />
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content
                            align="start"
                            sideOffset={4}
                            className="z-[100001] w-[var(--radix-popover-trigger-width)] bg-zinc-950 border border-purple-500/20 rounded-lg shadow-2xl overflow-hidden outline-none"
                          >
                            <Command className="w-full">
                              <div className="border-b border-zinc-800 px-2.5 py-2">
                                <Command.Input
                                  placeholder="Search parent tasks..."
                                  className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                                />
                              </div>
                              <Command.List className="max-h-56 overflow-y-auto custom-scrollbar p-1">
                                <Command.Empty className="py-4 text-center text-xs text-zinc-500">
                                  No parent tasks found.
                                </Command.Empty>
                                {filteredParentTasks.map((t) => {
                                  const label = `${t.task_name} (${t.client_name})`;
                                  const selected = canonicalTaskLink === t.clickup_task_link;
                                  return (
                                    <Command.Item
                                      key={t.clickup_task_link}
                                      value={label}
                                      onSelect={() => {
                                        handleTaskLinkChange(t.clickup_task_link);
                                        setParentTaskName(t.task_name);
                                        setParentPopoverOpen(false);
                                      }}
                                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-zinc-200 cursor-pointer data-[selected=true]:bg-purple-500/20 data-[selected=true]:text-white"
                                    >
                                      <Check
                                        className={`size-3.5 text-purple-400 shrink-0 ${
                                          selected ? 'opacity-100' : 'opacity-0'
                                        }`}
                                      />
                                      <span className="truncate">{label}</span>
                                    </Command.Item>
                                  );
                                })}
                              </Command.List>
                            </Command>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="galaxy-parent-link" className="text-sm font-medium text-purple-200 block">
                        Task Link / ClickUp Link <span className="text-pink-500">*</span>
                      </label>
                      <input
                        id="galaxy-parent-link"
                        type="text"
                        value={taskLink}
                        onChange={(e) => handleTaskLinkChange(e.target.value)}
                        placeholder="https://app.clickup.com/t/..."
                        className="w-full bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/40"
                      />
                      {fieldErrors.task_link && (
                        <p className="text-xs text-pink-400">{fieldErrors.task_link}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Link / Channel */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="galaxy-link" className="text-sm font-medium text-purple-200">
                      Link / Channel <span className="text-zinc-500 font-normal">(Optional)</span>
                    </label>
                    <Popover.Root open={channelsOpen} onOpenChange={setChannelsOpen}>
                      <Popover.Trigger asChild>
                        <button
                          type="button"
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          <Link2 className="size-3.5" />
                          <span>Channels</span>
                          <ChevronDown className="size-3 opacity-70" />
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          align="end"
                          sideOffset={4}
                          className="z-[100001] w-48 bg-zinc-950 border border-purple-500/20 rounded-lg shadow-xl p-1 outline-none"
                        >
                          {CHANNEL_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setLink(opt.value);
                                setChannelsOpen(false);
                              }}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-zinc-200 hover:bg-purple-500/20 hover:text-white transition-colors cursor-pointer text-left"
                            >
                              <opt.icon className="size-3.5 text-zinc-400 shrink-0" />
                              <span>{opt.label}</span>
                            </button>
                          ))}
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </div>
                  <input
                    id="galaxy-link"
                    type="text"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://example.com or WhatsApp, Slack, Telegram…"
                    className="w-full bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/40"
                  />
                </div>

                {/* Priority & Complexity */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-purple-200 block">
                      Priority <span className="text-zinc-500 font-normal">(Optional)</span>
                    </label>
                    <Popover.Root open={priorityOpen} onOpenChange={setPriorityOpen}>
                      <Popover.Trigger asChild>
                        <button
                          type="button"
                          className="w-full flex items-center justify-between bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-left hover:border-purple-500/50 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer"
                        >
                          <span className={priority ? 'text-zinc-100' : 'text-zinc-500'}>
                            {priority || 'Select priority'}
                          </span>
                          <ChevronDown className="size-4 text-zinc-500 shrink-0" />
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          align="start"
                          sideOffset={4}
                          className="z-[100001] w-[var(--radix-popover-trigger-width)] bg-zinc-950 border border-purple-500/20 rounded-lg shadow-xl p-1 outline-none"
                        >
                          {PRIORITY_OPTIONS.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                setPriority(opt);
                                setPriorityOpen(false);
                              }}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-zinc-200 hover:bg-purple-500/20 hover:text-white transition-colors cursor-pointer text-left"
                            >
                              <span>{opt}</span>
                              {priority === opt && <Check className="size-3.5 text-purple-400" />}
                            </button>
                          ))}
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-purple-200 block">
                      Complexity <span className="text-zinc-500 font-normal">(Optional)</span>
                    </label>
                    <Popover.Root open={complexityOpen} onOpenChange={setComplexityOpen}>
                      <Popover.Trigger asChild>
                        <button
                          type="button"
                          className="w-full flex items-center justify-between bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-left hover:border-purple-500/50 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer"
                        >
                          <span className={complexity ? 'text-zinc-100' : 'text-zinc-500'}>
                            {complexity || 'Select complexity'}
                          </span>
                          <ChevronDown className="size-4 text-zinc-500 shrink-0" />
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          align="start"
                          sideOffset={4}
                          className="z-[100001] w-[var(--radix-popover-trigger-width)] bg-zinc-950 border border-purple-500/20 rounded-lg shadow-xl p-1 outline-none"
                        >
                          {COMPLEXITY_OPTIONS.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                setComplexity(opt);
                                setComplexityOpen(false);
                              }}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-zinc-200 hover:bg-purple-500/20 hover:text-white transition-colors cursor-pointer text-left"
                            >
                              <span>{opt}</span>
                              {complexity === opt && <Check className="size-3.5 text-purple-400" />}
                            </button>
                          ))}
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </div>
                </div>

                {/* Goal */}
                <div className="space-y-1.5">
                  <label htmlFor="galaxy-goal" className="text-sm font-medium text-purple-200 block">
                    Goal{' '}
                    {mode === 'task' ? (
                      <span className="text-pink-500">*</span>
                    ) : (
                      <span className="text-zinc-500 font-normal">(Optional)</span>
                    )}
                  </label>
                  <input
                    id="galaxy-goal"
                    type="text"
                    value={goal}
                    onChange={(e) => {
                      setGoal(e.target.value);
                      if (fieldErrors.goal) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.goal;
                          return next;
                        });
                      }
                    }}
                    placeholder="What is this for, and where will it be used? e.g. Facebook ad for the Nov 5 webinar"
                    className="w-full bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/40"
                  />
                  {fieldErrors.goal && (
                    <p className="text-xs text-pink-400">{fieldErrors.goal}</p>
                  )}
                </div>

                {/* Launch date (task mode only) */}
                {mode === 'task' && (
                <div className="space-y-1.5">
                  <label htmlFor="galaxy-launch-date" className="text-sm font-medium text-purple-200 block">
                    Launch date <span className="text-zinc-500 font-normal">(Optional — sets the due date)</span>
                  </label>
                  <input
                    id="galaxy-launch-date"
                    type="date"
                    value={launchDate}
                    onChange={(e) => setLaunchDate(e.target.value)}
                    className="w-full bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/40 [color-scheme:dark]"
                  />
                </div>
                )}

                {/* Prompt */}
                <div className="space-y-1.5">
                  <label htmlFor="galaxy-prompt" className="text-sm font-medium text-purple-200 block">
                    Prompt <span className="text-pink-500">*</span>
                  </label>
                  <textarea
                    ref={promptInputRef}
                    id="galaxy-prompt"
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      if (fieldErrors.prompt) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.prompt;
                          return next;
                        });
                      }
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        submitForm();
                      }
                    }}
                    placeholder={
                      mode === 'subtask'
                        ? 'Describe the subtask details, requirements, or instructions...'
                        : 'Describe the task details and requirements...'
                    }
                    className="w-full bg-background border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/40 min-h-[110px] resize-y"
                  />
                  {fieldErrors.prompt && (
                    <p className="text-xs text-pink-400">{fieldErrors.prompt}</p>
                  )}
                </div>
              </form>
            )}
          </div>

          {!submitting && resultState.status === 'idle' && (
            <div className="px-5 py-3.5 border-t border-purple-500/15 shrink-0">
              <button
                type="submit"
                form="galaxy-task-form"
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-base font-bold shadow-lg shadow-purple-500/25 transition-all cursor-pointer"
              >
                <Sparkles className="size-4" />
                <span>{mode === 'subtask' ? 'Create Subtask' : 'Create Task'}</span>
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
