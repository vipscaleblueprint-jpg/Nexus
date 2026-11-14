'use client';

import { useState, Suspense } from 'react';
import { WorkspaceDashboard } from '@/components/dashboard/WorkspaceDashboard';
import { CreateSpaceModal } from '@/components/modals/CreateSpaceModal';
import { CreateFolderModal } from '@/components/modals/CreateFolderModal';
import { CreateListModal } from '@/components/modals/CreateListModal';
import { CreateDocModal } from '@/components/modals/CreateDocModal';
import { CreatePageModal } from '@/components/modals/CreatePageModal';
import dynamic from 'next/dynamic';
import { EntityType } from '@/components/modals/CreateEntityModal';

const TaskDetailModal = dynamic(
  () => import('@/components/modals/TaskDetailModal').then((m) => m.TaskDetailModal),
  { ssr: false }
);
import { useAppStore } from '@/lib/store';
import { Space, Folder, Doc, Task } from '@/lib/types';
import { ClickUpMobileTasksHub } from '@/components/mobile/ClickUpMobileTasksHub';
import { ClickUpMobileInboxView } from '@/components/mobile/ClickUpMobileInboxView';

export default function Home() {
  const {
    spaces,
    allDocs,
    loadSpaces,
    loadingSpaces,
    mobileActiveTab,
    setIsMobileCreateOpen,
    activeMobileTask,
    setActiveMobileTask,
    updateTask,
    workspaceRoles,
  } = useAppStore();

  // Individual Modals State
  const [isCreateSpaceOpen, setIsCreateSpaceOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [isCreateDocOpen, setIsCreateDocOpen] = useState(false);
  const [isCreatePageOpen, setIsCreatePageOpen] = useState(false);
  const [selectedMobileTask, setSelectedMobileTask] = useState<Task | null>(null);

  const [targetSpaceId, setTargetSpaceId] = useState<string | undefined>();
  const [targetFolderId, setTargetFolderId] = useState<string | undefined>();
  const [targetDocId, setTargetDocId] = useState<string | undefined>();

  const handleOpenCreate = (type: EntityType, spaceId?: string, folderId?: string, docId?: string) => {
    setTargetSpaceId(spaceId);
    setTargetFolderId(folderId);
    setTargetDocId(docId);

    if (type === 'SPACE') setIsCreateSpaceOpen(true);
    else if (type === 'FOLDER') setIsCreateFolderOpen(true);
    else if (type === 'LIST') setIsCreateListOpen(true);
    else if (type === 'DOC') setIsCreateDocOpen(true);
    else if (type === 'PAGE') setIsCreatePageOpen(true);
  };

  const flatDocs = allDocs.map((item: any) => item.doc);

  return (
    <>
      {/* ── DESKTOP VIEWPORT: High-Density Workspace Dashboard ── */}
      <div className="hidden md:block w-full h-full">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          }
        >
          <WorkspaceDashboard
            activeView="all"
            spaces={spaces}
            loading={loadingSpaces}
            onOpenCreate={handleOpenCreate}
          />
        </Suspense>
      </div>

      {/* ── MOBILE VIEWPORT: ClickUp-Inspired Mobile Experience ── */}
      <div className="block md:hidden w-full h-full overflow-y-auto">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center min-h-[50vh]">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          }
        >
          {mobileActiveTab === 'inbox' ? (
            <ClickUpMobileInboxView />
          ) : mobileActiveTab === 'home' ? (
            <WorkspaceDashboard
              activeView="all"
              spaces={spaces}
              loading={loadingSpaces}
              onOpenCreate={handleOpenCreate}
            />
          ) : (
            <ClickUpMobileTasksHub
              onOpenCreateTask={() => setIsMobileCreateOpen(true)}
              onOpenCreateList={() => setIsCreateListOpen(true)}
              onSelectTask={(task) => {
                setSelectedMobileTask(task);
                setActiveMobileTask(task);
              }}
            />
          )}
        </Suspense>
      </div>

      {/* ── SHARED TASK DETAIL MODAL ON MOBILE ─────────────────── */}
      <TaskDetailModal
        isOpen={!!selectedMobileTask}
        onClose={() => {
          setSelectedMobileTask(null);
          setActiveMobileTask(null);
        }}
        task={selectedMobileTask || null}
        mode="full"
        workspaceRoles={workspaceRoles}
        onUpdateTask={(updatedTask) => {
          setSelectedMobileTask(updatedTask);
          updateTask(updatedTask);
        }}
      />

      {/* ── CREATION MODALS ────────────────────────────────────── */}
      <CreateSpaceModal
        isOpen={isCreateSpaceOpen}
        onClose={() => setIsCreateSpaceOpen(false)}
        onSuccess={loadSpaces}
      />
      <CreateFolderModal
        isOpen={isCreateFolderOpen}
        onClose={() => setIsCreateFolderOpen(false)}
        onSuccess={loadSpaces}
        spaces={spaces}
        defaultSpaceId={targetSpaceId}
      />
      <CreateListModal
        isOpen={isCreateListOpen}
        onClose={() => setIsCreateListOpen(false)}
        onSuccess={loadSpaces}
        spaces={spaces}
        defaultSpaceId={targetSpaceId}
        defaultFolderId={targetFolderId}
      />
      <CreateDocModal
        isOpen={isCreateDocOpen}
        onClose={() => setIsCreateDocOpen(false)}
        onSuccess={loadSpaces}
        spaces={spaces}
        defaultSpaceId={targetSpaceId}
        defaultFolderId={targetFolderId}
      />
      <CreatePageModal
        isOpen={isCreatePageOpen}
        onClose={() => setIsCreatePageOpen(false)}
        onSuccess={loadSpaces}
        allDocs={flatDocs}
        defaultDocId={targetDocId}
      />
    </>
  );
}
