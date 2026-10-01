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
} from '../controllers/clickup.controller';

const router = Router();

// Connectivity & Auth
router.get('/status', getClickUpStatus);

// Workspace hierarchy browsing (used by the frontend mapping UI)
router.get('/workspaces', listWorkspaces);
router.get('/workspaces/:teamId/spaces', listSpaces);
router.get('/spaces/:spaceId/folders', listFolders);
router.get('/folders/:folderId/lists', listFolderLists);
router.get('/spaces/:spaceId/folderless-lists', listFolderlessLists);

// Nexus → ClickUp list mappings
router.get('/mappings', getMappings);
router.post('/mappings', createMapping);
router.delete('/mappings/:nexusListId', deleteMapping);

// Proxy task info from ClickUp
router.get('/tasks/:taskId', getClickUpTaskProxy);

// Recent synced activity (for the header panel)
router.get('/recent-activity', getRecentSyncedActivity);

export default router;
