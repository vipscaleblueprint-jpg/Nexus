'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { TaskDetailModalContent } from '@/components/modals/TaskDetailModal';
import { SubtaskDetailView } from '@/components/modals/TaskDetailModal';
import { tasksApi } from '@/api/tasks';
import { Task } from '@/lib/types';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export default function TaskFullPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromPath = searchParams.get('from');
  const taskId = params.taskId as string;
  const { workspaceRoles, loadRoles, currentUser, workspaceUsers, workspaceTeams, tasksIndex, tasks } = useAppStore();

  const handleClose = () => {
    if (fromPath) {
      router.push(fromPath);
    } else {
      router.back();
    }
  };

  const [task, setTask] = useState<Task | null>(null);
  const [subtask, setSubtask] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (workspaceRoles.length === 0) loadRoles();
  }, [workspaceRoles.length, loadRoles]);

  useEffect(() => {
    if (!taskId) return;

    // Reset state when navigating between different tasks
    const currMain = tasksIndex[taskId];
    let currSub = null;
    let currParent = null;
    if (!currMain) {
      for (const t of tasks) {
        const foundSub = t.subtasks?.find((st: any) => st.id === taskId);
        if (foundSub) {
          currSub = foundSub;
          currParent = t;
          break;
        }
      }
    }

    setTask(currMain || currParent || null);
    setSubtask(currSub || null);
    setLoading(!currMain && !currSub);

    // Fallback: stop spinner after 5s if DB is unreachable
    const timeout = setTimeout(() => setLoading(false), 5000);

    tasksApi.getTask(taskId)
      .then((res) => {
        if (res.subtask) {
          setSubtask(res.subtask);
          setTask(res.task); // Backend already provides the parent task in res.task
        } else if (res.task) {
          setTask(res.task);
        }
      })
      .catch((err) => console.error('Failed to load task:', err))
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => clearTimeout(timeout);
  }, [taskId]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center bg-background text-zinc-400 gap-4">
        <div>Task not found</div>
        <button
          onClick={handleClose}
          className="flex items-center gap-2 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Go back
        </button>
      </div>
    );
  }

  // Subtask full page view
  if (subtask) {
    return (
      <div className="flex flex-col h-full w-full bg-background overflow-hidden">
        <SubtaskDetailView
          subtask={subtask}
          parentTask={task}
          onClose={handleClose}
          currentUser={currentUser}
          workspaceUsers={workspaceUsers}
          workspaceTeams={workspaceTeams}
          workspaceRoles={workspaceRoles}
        />
      </div>
    );
  }

  // Main task full page view
  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      <div className="flex-1 overflow-hidden relative">
        <TaskDetailModalContent
          isOpen={true}
          onClose={handleClose}
          task={task}
          workspaceRoles={workspaceRoles}
          mode="full"
        />
      </div>
    </div>
  );
}
