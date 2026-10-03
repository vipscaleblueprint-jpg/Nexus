'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TaskDetailModalContent } from '@/components/modals/TaskDetailModal';
import { tasksApi } from '@/api/tasks';
import { Task } from '@/lib/types';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export default function TaskFullPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.taskId as string;
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const { workspaceRoles, loadRoles } = useAppStore();

  useEffect(() => {
    if (workspaceRoles.length === 0) {
      loadRoles();
    }
  }, [workspaceRoles.length, loadRoles]);

  useEffect(() => {
    if (!taskId) return;
    
    tasksApi.getTask(taskId)
      .then((res) => {
        setTask(res.subtask || res.task);
      })
      .catch((err) => {
        console.error("Failed to load task:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [taskId]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0e0e10]">
        <Loader2 className="w-8 h-8 text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col h-screen w-full items-center justify-center bg-[#0e0e10] text-zinc-400 gap-4">
        <div>Task not found</div>
        <button onClick={() => router.back()} className="flex items-center gap-2 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Go back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-[#0e0e10] overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-800/60 flex items-center gap-4 bg-[#111113]">
        <button 
          onClick={() => router.back()} 
          className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>
      <div className="flex-1 overflow-hidden relative">
        <TaskDetailModalContent 
          isOpen={true} 
          onClose={() => router.back()} 
          task={task}
          workspaceRoles={workspaceRoles}
          mode="full"
        />
      </div>
    </div>
  );
}
