import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { addTodo, clearDone, listTodos, removeTodo, setDone, type Result } from './todos';

export const todosRouter = express.Router();
todosRouter.use(requireAuth);

function send<T extends object>(res: Response, result: Result<T>, status = 200): void {
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.status(status).json({ success: true, ...result.value });
}

// Os lembretes do usuário: pendentes primeiro (o mais antigo em cima), depois os feitos.
todosRouter.get('/', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, todos: listTodos(db, req.userId!) });
});

// Escreve um lembrete: `{ text }`.
todosRouter.post('/', (req: AuthedRequest, res: Response) => {
  send(res, addTodo(db, req.userId!, req.body?.text), 201);
});

// Apaga os já feitos (os pendentes ficam). Vem antes de `/:id` só por clareza: os dois não se confundem (um tem id).
todosRouter.delete('/', (req: AuthedRequest, res: Response) => {
  send(res, clearDone(db, req.userId!));
});

// Marca como feito ou volta a pendente: `{ done: true | false }`.
todosRouter.patch('/:id', (req: AuthedRequest, res: Response) => {
  send(res, setDone(db, req.userId!, req.params.id, req.body?.done));
});

todosRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  send(res, removeTodo(db, req.userId!, req.params.id));
});
