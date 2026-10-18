import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Loader2, Pencil, Play, Trash2 } from 'lucide-react';

import { BankTabs } from '../components/questions/BankTabs';
import { Modal } from '../components/questions/Modal';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError } from '../services/api';
import { questionBankApi } from '../services/questionBankApi';
import type { QbExam } from '../types';
import { percent } from '../utils/questionBank';

const LEVELS = ['', 'Fundamental', 'Médio', 'Técnico', 'Superior'];

function EditExamModal({ exam, onClose, onSaved }: { exam: QbExam; onClose: () => void; onSaved: (next: QbExam) => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState(exam.name);
  const [board, setBoard] = useState(exam.board);
  const [organ, setOrgan] = useState(exam.organ);
  const [year, setYear] = useState(exam.year ? String(exam.year) : '');
  const [position, setPosition] = useState(exam.position);
  const [level, setLevel] = useState(exam.level);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || name.trim().length < 2) return;
    setBusy(true);
    try {
      const { exam: next } = await questionBankApi.updateExam(exam.id, { name, board, organ, year: year ? Number(year) : null, position, level });
      showToast('Prova atualizada.');
      onSaved(next);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível salvar a prova.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Dados da prova" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label-field" htmlFor="ex-name">Nome</label>
          <input id="ex-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="ex-board">Banca</label>
            <input id="ex-board" className="input-field" value={board} onChange={(e) => setBoard(e.target.value)} maxLength={160} />
          </div>
          <div>
            <label className="label-field" htmlFor="ex-organ">Órgão</label>
            <input id="ex-organ" className="input-field" value={organ} onChange={(e) => setOrgan(e.target.value)} maxLength={160} />
          </div>
          <div>
            <label className="label-field" htmlFor="ex-year">Ano</label>
            <input id="ex-year" className="input-field" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
          <div>
            <label className="label-field" htmlFor="ex-level">Nível</label>
            <select id="ex-level" className="input-field" value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l || 'Não informado'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label-field" htmlFor="ex-position">Cargo</label>
          <input id="ex-position" className="input-field" value={position} onChange={(e) => setPosition(e.target.value)} maxLength={160} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy || name.trim().length < 2}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PastExams() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [exams, setExams] = useState<QbExam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<QbExam | null>(null);

  useEffect(() => {
    questionBankApi
      .exams()
      .then((r) => setExams(r.exams))
      .catch(() => setError('Não foi possível carregar suas provas.'));
  }, []);

  async function remove(exam: QbExam) {
    const ok = await confirm({
      message: `Apagar a prova "${exam.name}" com as ${exam.questionCount} questões dela? As suas respostas a elas e o lugar delas nos cadernos também são apagados.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await questionBankApi.removeExam(exam.id);
      setExams((prev) => prev?.filter((e) => e.id !== exam.id) ?? prev);
      showToast('Prova apagada.');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível apagar a prova.', 'error');
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Provas anteriores</h1>
      <p className="mb-5 mt-1 text-sm text-neutral-500 dark:text-neutral-400">As provas que você importou. Cada uma vira questões que você resolve na aba Questões.</p>
      <BankTabs />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {exams === null && !error && <p className="text-sm text-neutral-400">Carregando...</p>}
      {exams && exams.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <FileText size={24} className="text-neutral-400" />
          <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">Nenhuma prova importada ainda.</p>
          <Link to="/questoes/importar" className="btn-primary">
            Importar uma prova
          </Link>
        </div>
      )}
      {exams && exams.length > 0 && (
        <ul className="space-y-3">
          {exams.map((exam) => {
            const meta = [exam.board, exam.organ, exam.year, exam.position, exam.level].filter(Boolean).join(' · ');
            const missing = exam.questionCount - exam.withAnswerCount;
            return (
              <li key={exam.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{exam.name}</h2>
                    {meta && <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{meta}</p>}
                    <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                      {exam.questionCount} {exam.questionCount === 1 ? 'questão' : 'questões'}
                      {exam.answeredCount > 0
                        ? ` · ${exam.answeredCount} resolvidas · ${percent(exam.correctCount, exam.answeredCount)}% de acerto`
                        : ' · nenhuma resolvida ainda'}
                    </p>
                    {missing > 0 && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        {missing} {missing === 1 ? 'questão sem gabarito ou anulada' : 'questões sem gabarito ou anuladas'} (não podem ser respondidas).
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(exam)}
                      className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                      title="Editar os dados da prova"
                      aria-label={`Editar ${exam.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(exam)}
                      className="rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      title="Apagar a prova"
                      aria-label={`Apagar ${exam.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-4">
                  <Link to={`/questoes?prova=${exam.id}`} className="btn-primary">
                    <Play size={16} />
                    Resolver as questões
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <EditExamModal
          exam={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setExams((prev) => prev?.map((e) => (e.id === next.id ? next : e)) ?? prev);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
