import { Router } from 'express';
import { listLists, getList, createList, updateList, duplicateList, deleteList, createStatus, updateStatus, deleteStatus } from '../controllers/list.controller';
import { idParams, validate } from '../validation';
import { createListSchema, updateListSchema } from '../validation/schemas';

export const listRouter = Router();

listRouter.get('/', listLists);
listRouter.get('/:id', validate({ params: idParams }), getList);
listRouter.post('/', validate({ body: createListSchema }), createList);
listRouter.patch('/:id', validate({ params: idParams, body: updateListSchema }), updateList);
listRouter.post('/:id/duplicate', validate({ params: idParams }), duplicateList);
listRouter.delete('/:id', validate({ params: idParams }), deleteList);

listRouter.post('/:id/statuses', validate({ params: idParams }), createStatus);
listRouter.patch('/:id/statuses/:statusId', validate({ params: idParams }), updateStatus);
listRouter.delete('/:id/statuses/:statusId', validate({ params: idParams }), deleteStatus);

