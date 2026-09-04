import { Router } from 'express';
import {
  listSpaces,
  getDashboardData,
  createSpace,
  deleteSpace,
  createFolder,
  deleteFolder,
  createDoc,
  updateDoc,
  deleteDoc,
  createPage,
  updatePage,
  deletePage,
  listDocTaskSubtab,
} from '../controllers/space.controller';
import { idParams, validate } from '../validation';
import {
  createDocSchema,
  createFolderSchema,
  createPageSchema,
  createSpaceSchema,
  updateDocSchema,
  updatePageSchema,
} from '../validation/schemas';

export const spaceRouter = Router();

spaceRouter.get('/dashboard', getDashboardData);

spaceRouter.post('/folders', validate({ body: createFolderSchema }), createFolder);
spaceRouter.delete('/folders/:id', validate({ params: idParams }), deleteFolder);

spaceRouter.post('/docs', validate({ body: createDocSchema }), createDoc);
spaceRouter.get('/docs/:id/task-subtab', validate({ params: idParams }), listDocTaskSubtab);
spaceRouter.patch('/docs/:id', validate({ params: idParams, body: updateDocSchema }), updateDoc);
spaceRouter.delete('/docs/:id', validate({ params: idParams }), deleteDoc);

spaceRouter.post('/pages', validate({ body: createPageSchema }), createPage);
spaceRouter.patch('/pages/:id', validate({ params: idParams, body: updatePageSchema }), updatePage);
spaceRouter.delete('/pages/:id', validate({ params: idParams }), deletePage);

spaceRouter.get('/', listSpaces);
spaceRouter.post('/', validate({ body: createSpaceSchema }), createSpace);
spaceRouter.delete('/:id', validate({ params: idParams }), deleteSpace);
