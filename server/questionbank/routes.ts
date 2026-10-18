import express, { type Request, type Response } from 'express';
import multer, { type FileFilterCallback } from 'multer';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { extractPastExam } from '../ai/router';
import { withUsageContext } from '../ai/usage';
import type { PastExamHints } from '../ai/pastexam';
import { type Failure } from '../mockexams/store';
import { attemptCutoff, cutoffOverview } from './cutoff';
import { buildDraft, validateDraft, type Reading } from './draft';
import { JobStore } from './jobs';
import {
  addQuestions,
  createNotebook,
  deleteNotebook,
  deleteSavedFilter,
  getNotebookDetail,
  listNotebooks,
  listSavedFilters,
  recordSimulado,
  removeQuestion,
  renameNotebook,
  saveFilter,
} from './notebooks';
import {
  answerQuestion,
  deleteExam,
  deleteQuestion,
  getFacets,
  getQuestionDetail,
  getTotals,
  listExams,
  saveExam,
  searchQuestions,
  updateExam,
  updateQuestion,
} from './store';

export const questionBankRouter = express.Router();
questionBankRouter.use(requireAuth);

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_ANSWER_KEY_TEXT_CHARS = 20_000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 2 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Envie a prova (e o gabarito, se for à parte) em PDF.'));
      return;
    }
    cb(null, true);
  },
});

const sendFailure = (res: Response, failure: Failure) => res.status(failure.status).json({ success: false, error: failure.error });

// ---------- importar uma prova ----------

const jobs = new JobStore();

/** As disciplinas que o usuário já usa (as do concurso dele e as das provas que já importou): a IA as reaproveita. */
function disciplineHints(userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM (
         SELECT d.name AS name, 0 AS source FROM exam_disciplines d JOIN exams e ON e.id = d.exam_id WHERE e.user_id = ?
         UNION
         SELECT discipline AS name, 1 AS source FROM qb_questions WHERE user_id = ? AND discipline != ''
       ) GROUP BY name COLLATE NOCASE ORDER BY MIN(source), name COLLATE NOCASE LIMIT 30`,
    )
    .all(userId, userId) as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

function parseYear(raw: unknown): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 1950 && year <= 2100 ? year : null;
}

// Recebe o PDF da prova (e o gabarito, em PDF ou colado, se vier à parte) e começa a leitura em segundo plano.
questionBankRouter.post(
  '/import',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'answerKeyFile', maxCount: 1 },
  ]),
  (req: AuthedRequest, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const exam = files?.file?.[0];
    if (!exam) {
      res.status(400).json({ success: false, error: 'Envie o PDF da prova.' });
      return;
    }
    const keyFile = files?.answerKeyFile?.[0];
    const keyText = typeof req.body?.answerKeyText === 'string' ? req.body.answerKeyText.trim() : '';
    if (keyText.length > MAX_ANSWER_KEY_TEXT_CHARS) {
      res.status(400).json({ success: false, error: 'O gabarito colado é longo demais: cole só a tabela de respostas.' });
      return;
    }

    const userId = req.userId!;
    const hints: PastExamHints = {
      board: typeof req.body?.board === 'string' ? req.body.board.trim().slice(0, 160) : '',
      year: parseYear(req.body?.year),
      position: typeof req.body?.position === 'string' ? req.body.position.trim().slice(0, 160) : '',
      disciplines: disciplineHints(userId),
    };

    const started = jobs.start(userId, (report) =>
      withUsageContext({ userId, feature: 'questions' }, async () => {
        const readings: Reading[] = [];
        report({ stage: 'Lendo a prova', done: 0, total: 0 });
        readings.push(
          await extractPastExam({ type: 'file', buffer: exam.buffer, mimeType: exam.mimetype }, hints, {
            onProgress: (done, total) => report({ stage: 'Lendo a prova', done, total }),
          }),
        );
        if (keyFile || keyText) {
          report({ stage: 'Lendo o gabarito', done: 0, total: 0 });
          readings.push(
            await extractPastExam(
              keyFile ? { type: 'file', buffer: keyFile.buffer, mimeType: keyFile.mimetype } : { type: 'text', text: keyText },
              hints,
              {
                minTextChars: 20,
                onProgress: (done, total) => report({ stage: 'Lendo o gabarito', done, total }),
              },
            ),
          );
        }
        const draft = buildDraft(readings);
        if (draft.questions.length === 0) {
          throw new Error(
            'Não encontrei questões de múltipla escolha neste PDF. Confira se é a prova (e não só o gabarito ou o edital) e tente de novo.',
          );
        }
        return draft;
      }),
    );
    if (!started.ok) return sendFailure(res, started);
    res.status(202).json({ success: true, job: started.value });
  },
);

questionBankRouter.get('/import/:jobId', (req: AuthedRequest, res: Response) => {
  const job = jobs.get(req.userId!, req.params.jobId);
  if (!job.ok) return sendFailure(res, job);
  res.json({ success: true, job: job.value });
});

// Confirma a prova revisada: o servidor valida tudo de novo e só então grava.
questionBankRouter.post('/exams', (req: AuthedRequest, res: Response) => {
  const validated = validateDraft(req.body);
  if (!validated.ok) {
    res.status(400).json({ success: false, error: validated.error });
    return;
  }
  const saved = saveExam(db, req.userId!, validated.draft);
  if (!saved.ok) return sendFailure(res, saved);
  if (typeof req.body?.jobId === 'string') jobs.discard(req.userId!, req.body.jobId);
  res.status(201).json({ success: true, exam: saved.value });
});

// ---------- provas ----------

questionBankRouter.get('/exams', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, exams: listExams(db, req.userId!) });
});

questionBankRouter.patch('/exams/:id', (req: AuthedRequest, res: Response) => {
  const updated = updateExam(db, req.userId!, req.params.id, req.body);
  if (!updated.ok) return sendFailure(res, updated);
  res.json({ success: true, exam: updated.value });
});

questionBankRouter.delete('/exams/:id', (req: AuthedRequest, res: Response) => {
  const deleted = deleteExam(db, req.userId!, req.params.id);
  if (!deleted.ok) return sendFailure(res, deleted);
  res.json({ success: true });
});

// ---------- questões ----------

// As opções de cada campo do filtro (só o que existe no banco do usuário) e os totais.
questionBankRouter.get('/overview', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, facets: getFacets(db, req.userId!), totals: getTotals(db, req.userId!) });
});

questionBankRouter.post('/questions/search', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, ...searchQuestions(db, req.userId!, req.body) });
});

questionBankRouter.get('/questions/:id', (req: AuthedRequest, res: Response) => {
  const detail = getQuestionDetail(db, req.userId!, req.params.id);
  if (!detail.ok) return sendFailure(res, detail);
  res.json({ success: true, ...detail.value });
});

questionBankRouter.patch('/questions/:id', (req: AuthedRequest, res: Response) => {
  const updated = updateQuestion(db, req.userId!, req.params.id, req.body);
  if (!updated.ok) return sendFailure(res, updated);
  res.json({ success: true, question: updated.value });
});

questionBankRouter.delete('/questions/:id', (req: AuthedRequest, res: Response) => {
  const deleted = deleteQuestion(db, req.userId!, req.params.id);
  if (!deleted.ok) return sendFailure(res, deleted);
  res.json({ success: true });
});

questionBankRouter.post('/questions/:id/answer', (req: AuthedRequest, res: Response) => {
  const answered = answerQuestion(db, req.userId!, req.params.id, req.body);
  if (!answered.ok) return sendFailure(res, answered);
  res.json({ success: true, ...answered.value });
});

// ---------- cadernos e simulados ----------

questionBankRouter.get('/notebooks', (req: AuthedRequest, res: Response) => {
  const questionId = typeof req.query.questionId === 'string' ? req.query.questionId : undefined;
  res.json({ success: true, notebooks: listNotebooks(db, req.userId!, questionId) });
});

questionBankRouter.post('/notebooks', (req: AuthedRequest, res: Response) => {
  const created = createNotebook(db, req.userId!, req.body);
  if (!created.ok) return sendFailure(res, created);
  res.status(201).json({ success: true, ...created.value });
});

questionBankRouter.get('/notebooks/:id', (req: AuthedRequest, res: Response) => {
  const detail = getNotebookDetail(db, req.userId!, req.params.id);
  if (!detail.ok) return sendFailure(res, detail);
  res.json({ success: true, ...detail.value });
});

questionBankRouter.put('/notebooks/:id', (req: AuthedRequest, res: Response) => {
  const renamed = renameNotebook(db, req.userId!, req.params.id, req.body?.name);
  if (!renamed.ok) return sendFailure(res, renamed);
  res.json({ success: true, notebook: renamed.value });
});

questionBankRouter.delete('/notebooks/:id', (req: AuthedRequest, res: Response) => {
  const deleted = deleteNotebook(db, req.userId!, req.params.id);
  if (!deleted.ok) return sendFailure(res, deleted);
  res.json({ success: true });
});

questionBankRouter.post('/notebooks/:id/questions', (req: AuthedRequest, res: Response) => {
  const added = addQuestions(db, req.userId!, req.params.id, req.body?.questionIds);
  if (!added.ok) return sendFailure(res, added);
  res.json({ success: true, ...added.value });
});

questionBankRouter.delete('/notebooks/:id/questions/:questionId', (req: AuthedRequest, res: Response) => {
  const removed = removeQuestion(db, req.userId!, req.params.id, req.params.questionId);
  if (!removed.ok) return sendFailure(res, removed);
  res.json({ success: true });
});

questionBankRouter.post('/notebooks/:id/attempts', (req: AuthedRequest, res: Response) => {
  const recorded = recordSimulado(db, req.userId!, req.params.id, req.body);
  if (!recorded.ok) return sendFailure(res, recorded);
  res.status(201).json({ success: true, ...recorded.value });
});

// ---------- nota de corte ----------

// Um simulado contra a nota de corte do concurso (?exam= escolhe outro que não o "meu concurso").
questionBankRouter.get('/attempts/:id/cutoff', (req: AuthedRequest, res: Response) => {
  const result = attemptCutoff(db, req.userId!, req.params.id, req.query.exam);
  if (!result.ok) return sendFailure(res, result);
  res.json({ success: true, ...result.value });
});

// Os últimos simulados contra a nota de corte, disciplina por disciplina.
questionBankRouter.get('/cutoff', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, ...cutoffOverview(db, req.userId!, req.query.exam) });
});

// ---------- filtros salvos ----------

questionBankRouter.get('/filters', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, filters: listSavedFilters(db, req.userId!) });
});

questionBankRouter.post('/filters', (req: AuthedRequest, res: Response) => {
  const saved = saveFilter(db, req.userId!, req.body);
  if (!saved.ok) return sendFailure(res, saved);
  res.status(201).json({ success: true, filter: saved.value });
});

questionBankRouter.delete('/filters/:id', (req: AuthedRequest, res: Response) => {
  const deleted = deleteSavedFilter(db, req.userId!, req.params.id);
  if (!deleted.ok) return sendFailure(res, deleted);
  res.json({ success: true });
});
