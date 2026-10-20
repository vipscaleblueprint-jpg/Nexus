import { Router } from 'express';
import {
  getClickUpStatus,
  listWorkspaces,
  listSpaces,
  listFolders,
  listFolderLists,
  listFolderlessLists,
  getMappings,
  createMapping,
  deleteMapping,
  getClickUpTaskProxy,
  getRecentSyncedActivity,
  syncAllClickUp,
  getClickUpSyncStatus,
  autoLinkMappings,
  getMappingBoardHandler,
  syncTaskCommentsHandler,
} from '../controllers/clickup.controller';
import { requireSystemRole } from '../middleware/auth.middleware';

const router = Router();

// Connectivity & Auth
router.get('/status', getClickUpStatus);

// Workspace hierarchy browsing (used by the frontend mapping UI)
router.get('/workspaces', listWorkspaces);
router.get('/workspaces/:teamId/spaces', listSpaces);
router.get('/spaces/:spaceId/folders', listFolders);
router.get('/folders/:folderId/lists', listFolderLists);
router.get('/spaces/:spaceId/folderless-lists', listFolderlessLists);

// Nexus → ClickUp list mappings. Reading is open to any signed-in user; changing them is admin-only.
// (/api is already behind the login gate in server.ts, which sets req.user.)
const adminOnly = requireSystemRole('ADMIN');
router.get('/mappings', getMappings);
router.get('/mapping-board', adminOnly, getMappingBoardHandler);
router.post('/mappings', adminOnly, createMapping);
router.post('/mappings/auto-link', adminOnly, autoLinkMappings);
router.delete('/mappings/:nexusListId', adminOnly, deleteMapping);

// Proxy task info from ClickUp
router.get('/tasks/:taskId', getClickUpTaskProxy);
router.post('/tasks/:taskId/sync-comments', syncTaskCommentsHandler);

// Recent synced activity (for the header panel)
router.get('/recent-activity', getRecentSyncedActivity);

// Sync all data
router.post('/sync-all', syncAllClickUp);
router.get('/sync-status', getClickUpSyncStatus);

export default router;
