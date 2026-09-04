import { Router } from 'express';
import { listLists, createList, deleteList } from '../controllers/list.controller';
import { idParams, validate } from '../validation';
import { createListSchema } from '../validation/schemas';

export const listRouter = Router();

listRouter.get('/', listLists);
listRouter.post('/', validate({ body: createListSchema }), createList);
listRouter.delete('/:id', validate({ params: idParams }), deleteList);
