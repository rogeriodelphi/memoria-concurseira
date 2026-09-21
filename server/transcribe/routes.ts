import express, { type Response } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';

import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { transcribeMedia } from '../ai/gemini';
import { withUsageContext } from '../ai/usage';
import { isYoutubeUrl } from '../urlValidation';

export const transcribeRouter = express.Router();
transcribeRouter.use(requireAuth);

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ACCEPTED_PREFIXES = ['audio/', 'video/'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!ACCEPTED_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix))) {
      cb(new Error('Envie um arquivo de áudio ou vídeo.'));
      return;
    }
    cb(null, true);
  },
});

transcribeRouter.post('/file', upload.single('file'), async (req: AuthedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'Envie um arquivo de áudio ou vídeo.' });
    return;
  }
  try {
    const file = req.file;
    const text = await withUsageContext({ userId: req.userId!, feature: 'transcription' }, () =>
      transcribeMedia({ type: 'file', buffer: file.buffer, mimeType: file.mimetype }),
    );
    res.json({ success: true, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao transcrever o arquivo.';
    res.status(422).json({ success: false, error: message });
  }
});

transcribeRouter.post('/youtube', async (req: AuthedRequest, res: Response) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url || !isYoutubeUrl(url)) {
    res.status(400).json({ success: false, error: 'Informe um link válido do YouTube.' });
    return;
  }
  try {
    const text = await withUsageContext({ userId: req.userId!, feature: 'transcription' }, () =>
      transcribeMedia({ type: 'youtube', url }),
    );
    res.json({ success: true, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao transcrever o vídeo.';
    res.status(422).json({ success: false, error: message });
  }
});
