'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WorkspaceDashboard } from '@/components/dashboard/WorkspaceDashboard';
import { CreateSpaceModal } from '@/components/modals/CreateSpaceModal';
import { CreateFolderModal } from '@/components/modals/CreateFolderModal';
import { CreateListModal } from '@/components/modals/CreateListModal';
import { CreateDocModal } from '@/components/modals/CreateDocModal';
import { CreatePageModal } from '@/components/modals/CreatePageModal';
import { EntityType } from '@/components/modals/CreateEntityModal';
import { useAppStore } from '@/lib/store';
import { authApi } from '@/api';
import { Space, Folder, Doc } from '@/lib/types';

function getAllDocs(spaces: Space[]): Doc[] {
  const docs: Doc[] = [];
  function collectFromFolders(fList: Folder[]) {
    fList.forEach((f) => {
      if (f.docs) docs.push(...f.docs);
      if (f.subfolders) collectFromFolders(f.subfolders);
    });
  }
  spaces.forEach((s) => {
    if (s.docs) docs.push(...s.docs);
    if (s.folders) collectFromFolders(s.folders);
  });
  return docs;
}

export default function Home() {
  const { currentUser, setCurrentUser, spaces, loadSpaces, loadingSpaces } = useAppStore();

  // Individual Modals State
  const [isCreateSpaceOpen, setIsCreateSpaceOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [isCreateDocOpen, setIsCreateDocOpen] = useState(false);
  const [isCreatePageOpen, setIsCreatePageOpen] = useState(false);

  const [targetSpaceId, setTargetSpaceId] = useState<string | undefined>();
  const [targetFolderId, setTargetFolderId] = useState<string | undefined>();
  const [targetDocId, setTargetDocId] = useState<string | undefined>();

  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentUser) {
        try {
          const { user } = await authApi.getMe();
          if (!cancelled && user) setCurrentUser(user);
        } catch (e) {
          if (!cancelled) {
            router.push('/login');
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser, setCurrentUser, router]);

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

  const allDocs = getAllDocs(spaces);

  return (
    <>
      <WorkspaceDashboard
        activeView="folders"
        spaces={spaces}
        loading={loadingSpaces}
        onOpenCreate={handleOpenCreate}
      />

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
        allDocs={allDocs}
        defaultDocId={targetDocId}
      />
    </>
  );
}
