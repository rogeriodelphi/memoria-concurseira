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
import { aiUsageRouter } from './aiusage/routes';
import { ankiImportRouter } from './anki/routes';
import { examsRouter } from './exams/routes';
import { ttsRouter } from './tts/routes';
import { mockExamsRouter } from './mockexams/routes';
import { studyPlanRouter } from './studyplan/routes';
import { startBackupSchedule } from './backup';
import { bindAddress, cacheControlFor } from './hosting';

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
app.use('/api/ai-usage', aiUsageRouter);
app.use('/api/anki-import', ankiImportRouter);
app.use('/api/exams', examsRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/mock-exams', mockExamsRouter);
app.use('/api/study-plan', studyPlanRouter);

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
  app.use(
    express.static(distDir, {
      setHeaders: (res, filePath) => {
        const cacheControl = cacheControlFor(path.relative(distDir, filePath));
        if (cacheControl) res.setHeader('Cache-Control', cacheControl);
      },
    }),
  );
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

let HOST: string | undefined;
try {
  HOST = bindAddress(process.env);
} catch (err) {
  // O handler de exceções acima só registra; aqui o erro precisa parar a subida de verdade.
  console.error(`\n  ✗ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
}
const onListening = () => {
  const where = HOST ? `${HOST}:${PORT}` : `localhost:${PORT}`;
  console.log(`\n  ✓ Memória Concurseira API rodando em http://${where}\n`);
};
if (HOST) app.listen(PORT, HOST, onListening);
else app.listen(PORT, onListening);

startBackupSchedule();
