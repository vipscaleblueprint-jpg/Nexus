import { Router } from 'express';
import {
  listSpaces,
  getDashboardData,
  createSpace,
  deleteSpace,
  updateSpace,
  duplicateSpace,
  createFolder,
  deleteFolder,
  updateFolder,
  duplicateFolder,
  createDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  duplicateDoc,
  createPage,
  updatePage,
  deletePage,
  duplicatePage,
  listDocTaskSubtab,
  reorderSpaces,
  reorderFolders,
  reorderLists,
  reorderDocs,
} from '../controllers/space.controller';
import { idParams, validate } from '../validation';
import {
  createDocSchema,
  createFolderSchema,
  createPageSchema,
  createSpaceSchema,
  updateSpaceSchema,
  updateDocSchema,
  updatePageSchema,
  updateFolderSchema,
} from '../validation/schemas';

export const spaceRouter = Router();

spaceRouter.get('/dashboard', getDashboardData);

// Reorder routes (must come before generic /:id routes)
spaceRouter.put('/reorder', reorderSpaces);
spaceRouter.put('/folders/reorder', reorderFolders);
spaceRouter.put('/lists/reorder', reorderLists);
spaceRouter.put('/docs/reorder', reorderDocs);

spaceRouter.post('/folders', validate({ body: createFolderSchema }), createFolder);
spaceRouter.patch('/folders/:id', validate({ params: idParams, body: updateFolderSchema }), updateFolder);
spaceRouter.post('/folders/:id/duplicate', validate({ params: idParams }), duplicateFolder);
spaceRouter.delete('/folders/:id', validate({ params: idParams }), deleteFolder);

spaceRouter.post('/docs', validate({ body: createDocSchema }), createDoc);
spaceRouter.get('/docs/:id', validate({ params: idParams }), getDoc);
spaceRouter.get('/docs/:id/task-subtab', validate({ params: idParams }), listDocTaskSubtab);
spaceRouter.patch('/docs/:id', validate({ params: idParams, body: updateDocSchema }), updateDoc);
spaceRouter.post('/docs/:id/duplicate', validate({ params: idParams }), duplicateDoc);
spaceRouter.delete('/docs/:id', validate({ params: idParams }), deleteDoc);

spaceRouter.post('/pages', validate({ body: createPageSchema }), createPage);
spaceRouter.patch('/pages/:id', validate({ params: idParams, body: updatePageSchema }), updatePage);
spaceRouter.post('/pages/:id/duplicate', validate({ params: idParams }), duplicatePage);
spaceRouter.delete('/pages/:id', validate({ params: idParams }), deletePage);

spaceRouter.get('/', listSpaces);
spaceRouter.post('/', validate({ body: createSpaceSchema }), createSpace);
spaceRouter.patch('/:id', validate({ params: idParams, body: updateSpaceSchema }), updateSpace);
spaceRouter.post('/:id/duplicate', validate({ params: idParams }), duplicateSpace);
spaceRouter.delete('/:id', validate({ params: idParams }), deleteSpace);
