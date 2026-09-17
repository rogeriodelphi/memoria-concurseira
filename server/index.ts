import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';

// Primeiro import de propósito: preenche process.env antes de qualquer outro
// módulo do server ser avaliado (db, auth, ai dependem de variáveis de ambiente).
import './env';
import { authRouter } from './auth/routes';
import { collectionsRouter } from './collections/routes';
import { documentsRouter } from './documents/routes';
import { flashcardsRouter } from './flashcards/routes';
import { exportsRouter } from './exports/routes';
import { statsRouter } from './stats/routes';
import { transcribeRouter } from './transcribe/routes';
import { pomodoroRouter } from './pomodoro/routes';
import { mindMapsRouter } from './mindmaps/routes';
import { summariesRouter } from './summaries/routes';
import { bulletPointsRouter } from './bulletpoints/routes';
import { searchRouter } from './search/routes';
import { startBackupSchedule } from './backup';

process.on('unhandledRejection', (reason) => {
  console.error('\n  ✗ Promise rejeitada sem tratamento:', reason, '\n');
});
process.on('uncaughtException', (err) => {
  console.error('\n  ✗ Exceção não capturada:', err, '\n');
});

function portFromArgs(): number | null {
  const i = process.argv.indexOf('--port');
  if (i === -1) return null;
  const value = Number(process.argv[i + 1]);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : null;
}

const PORT = portFromArgs() ?? Number(process.env.API_PORT ?? process.env.PORT ?? 3000);

const app = express();
// 10mb: pergunta/resposta podem carregar imagens embutidas em base64
// (o editor de texto rico já comprime antes de inserir, mas o limite
// precisa de folga pra caber mais de uma imagem por cartão).
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/collections/:collectionId/documents', documentsRouter);
app.use('/api/flashcards', flashcardsRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/transcribe', transcribeRouter);
app.use('/api/pomodoro', pomodoroRouter);
app.use('/api/mindmaps', mindMapsRouter);
app.use('/api/summaries', summariesRouter);
app.use('/api/bulletpoints', bulletPointsRouter);
app.use('/api/search', searchRouter);

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ success: true, ok: true });
});

// Erros do multer (ex.: arquivo grande demais) e outros erros síncronos de
// middleware caem aqui em vez de derrubar a requisição sem resposta.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(400).json({ success: false, error: err.message || 'Erro inesperado.' });
});

const distDir = path.join(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n  ✓ Base Concurseira API rodando em http://localhost:${PORT}\n`);
});

startBackupSchedule();
