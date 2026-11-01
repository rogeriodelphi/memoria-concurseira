import { useState, type FormEvent } from 'react';
import { Loader2, Save } from 'lucide-react';

import { ApiError, pomodoroApi } from '../../services/api';
import { formatDateKey, formatMinutes, localDateKey, MIN_DATE, totalMinutes } from '../../utils/pomodoroManual';

interface ManualTimeFormProps {
  /** O que sugerir em Disciplina e Assunto (as dos concursos e coleções): digitar um desses nomes liga o tempo aos cartões e ao edital. */
  suggestions: { disciplines: string[]; subjects: string[] };
  /** Chamado com a data lançada depois que o servidor gravou. */
  onSaved: (date: string) => void;
  onCancel: () => void;
}

/** "Lançar tempo estudado": um estudo que ficou sem registro no Pomodoro, lançado depois com a data e o tempo. */
export function ManualTimeForm({ suggestions, onSaved, onCancel }: ManualTimeFormProps) {
  const today = localDateKey();
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [subject, setSubject] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = totalMinutes(hours, minutes);
  const dateOk = date >= MIN_DATE && date <= today;
  const canSave = total !== null && dateOk && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave || total === null) return;
    setSaving(true);
    setError(null);
    try {
      await pomodoroApi.logManual({ date, minutes: total, discipline, subject });
      onSaved(date);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível lançar o tempo.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card mb-6 space-y-4 p-5">
      <datalist id="manual-disciplines">
        {suggestions.disciplines.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="manual-subjects">
        {suggestions.subjects.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Lançar tempo estudado</h2>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          Para um estudo que você esqueceu de registrar. Ele entra nas suas estatísticas, no dia que você escolher.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label-field" htmlFor="manual-date">
            Data
          </label>
          <input
            id="manual-date"
            type="date"
            className="input-field w-auto"
            value={date}
            min={MIN_DATE}
            max={today}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label-field" htmlFor="manual-hours">
              Horas
            </label>
            <input
              id="manual-hours"
              type="number"
              inputMode="numeric"
              min={0}
              max={24}
              className="input-field w-20"
              placeholder="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <div>
            <label className="label-field" htmlFor="manual-minutes">
              Minutos
            </label>
            <input
              id="manual-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              className="input-field w-20"
              placeholder="0"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label-field" htmlFor="manual-discipline">
            Disciplina <span className="font-normal text-neutral-400">(opcional)</span>
          </label>
          <input
            id="manual-discipline"
            className="input-field"
            list="manual-disciplines"
            maxLength={120}
            placeholder="Ex.: Direito Administrativo"
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value)}
          />
        </div>
        <div>
          <label className="label-field" htmlFor="manual-subject">
            Assunto <span className="font-normal text-neutral-400">(opcional)</span>
          </label>
          <input
            id="manual-subject"
            className="input-field"
            list="manual-subjects"
            maxLength={120}
            placeholder="Ex.: Poder de polícia"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
      </div>

      {!dateOk && (
        <p className="text-sm text-red-600">
          {date === '' ? 'Informe a data.' : date > today ? 'A data não pode ser no futuro.' : 'A data é antiga demais.'}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!canSave} className="btn-primary">
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Lançando...
            </>
          ) : (
            <>
              <Save size={16} />
              Lançar tempo
            </>
          )}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="btn-secondary">
          Cancelar
        </button>
        {total !== null && dateOk && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Será lançado: {formatMinutes(total)} em {formatDateKey(date)}
          </span>
        )}
      </div>
    </form>
  );
}
