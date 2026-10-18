import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

import { useConfirm } from '../../contexts/ConfirmContext';
import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/api';
import { questionBankApi } from '../../services/questionBankApi';
import type { QbAlternative, QbQuestion } from '../../types';
import { AlternativesEditor } from './AlternativesEditor';
import { Modal } from './Modal';

const ANNULLED = 'ANULADA';

/**
 * "Reportar erro", virado para o dono da questão: ela foi lida de um PDF por uma IA, então o texto, a disciplina ou
 * o gabarito podem estar errados. Aqui tudo se corrige, ou a questão é apagada.
 */
export function EditQuestionModal({
  questionId,
  onClose,
  onSaved,
  onDeleted,
}: {
  questionId: string;
  onClose: () => void;
  onSaved: (question: QbQuestion) => void;
  onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [original, setOriginal] = useState<QbQuestion | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [statement, setStatement] = useState('');
  const [support, setSupport] = useState('');
  const [alternatives, setAlternatives] = useState<QbAlternative[]>([]);
  const [answer, setAnswer] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [subject, setSubject] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    questionBankApi
      .question(questionId)
      .then(({ question }) => {
        if (!alive) return;
        setOriginal(question);
        setStatement(question.statement);
        setSupport(question.support);
        setAlternatives(question.alternatives);
        setAnswer(question.annulled ? ANNULLED : (question.answer ?? ''));
        setDiscipline(question.discipline);
        setSubject(question.subject);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [questionId]);

  const answerStillValid = answer === '' || answer === ANNULLED || alternatives.some((a) => a.letter === answer);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !original) return;
    setBusy(true);
    try {
      const { question } = await questionBankApi.updateQuestion(questionId, {
        statement,
        support,
        alternatives,
        answer: answerStillValid ? answer : '',
        discipline,
        subject,
        ...(reviewed ? { suspect: false } : {}),
      });
      showToast('Questão corrigida.');
      onSaved(question);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível salvar a correção.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove_() {
    const ok = await confirm({
      message: 'Apagar esta questão? As suas respostas a ela e o lugar dela nos cadernos também são apagados.',
      danger: true,
    });
    if (!ok) return;
    try {
      await questionBankApi.removeQuestion(questionId);
      showToast('Questão apagada.');
      onDeleted();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível apagar a questão.', 'error');
    }
  }

  return (
    <Modal title="Corrigir questão" onClose={onClose} size="lg">
      {loadError && <p className="text-sm text-red-600">Não foi possível carregar a questão.</p>}
      {!original && !loadError && (
        <p className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 size={14} className="animate-spin" />
          Carregando...
        </p>
      )}
      {original && (
        <form onSubmit={save} className="space-y-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Questão {original.number} de {original.examName}. O texto foi lido do PDF por uma IA: corrija o que estiver errado.
          </p>

          <div>
            <label className="label-field" htmlFor="qb-statement">Enunciado</label>
            <textarea id="qb-statement" className="input-field resize-y" rows={5} value={statement} onChange={(e) => setStatement(e.target.value)} maxLength={6000} />
          </div>

          <div>
            <label className="label-field" htmlFor="qb-support">Texto de apoio (opcional)</label>
            <textarea id="qb-support" className="input-field resize-y" rows={3} value={support} onChange={(e) => setSupport(e.target.value)} maxLength={12000} />
          </div>

          <fieldset>
            <legend className="label-field">Alternativas</legend>
            <AlternativesEditor alternatives={alternatives} onChange={setAlternatives} />
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label-field" htmlFor="qb-answer">Gabarito</label>
              <select id="qb-answer" className="input-field" value={answerStillValid ? answer : ''} onChange={(e) => setAnswer(e.target.value)}>
                <option value="">Sem gabarito</option>
                {alternatives.map((a) => (
                  <option key={a.letter} value={a.letter}>
                    Alternativa {a.letter}
                  </option>
                ))}
                <option value={ANNULLED}>Questão anulada</option>
              </select>
            </div>
            <div>
              <label className="label-field" htmlFor="qb-discipline">Disciplina</label>
              <input id="qb-discipline" className="input-field" value={discipline} onChange={(e) => setDiscipline(e.target.value)} maxLength={160} />
            </div>
            <div>
              <label className="label-field" htmlFor="qb-subject">Assunto</label>
              <input id="qb-subject" className="input-field" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
            </div>
          </div>

          {original.suspect && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
              Já conferi o texto com o PDF: tirar o aviso &quot;Confira o texto&quot;.
            </label>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button type="button" onClick={() => void remove_()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
              <Trash2 size={15} />
              Apagar questão
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={busy || statement.trim().length < 8 || alternatives.some((a) => !a.text.trim())}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
