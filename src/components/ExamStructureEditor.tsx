import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import type { ExamDisciplineDraft, ExamDraft } from '../types';

interface ExamStructureEditorProps {
  value: ExamDraft;
  onChange: (next: ExamDraft) => void;
}

function move<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function toNumberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const iconButton =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200';

function DisciplineEditor({
  discipline,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  discipline: ExamDisciplineDraft;
  index: number;
  count: number;
  onChange: (next: ExamDisciplineDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [bulk, setBulk] = useState('');

  function setTopicTitle(i: number, title: string) {
    onChange({ ...discipline, topics: discipline.topics.map((t, j) => (j === i ? { ...t, title } : t)) });
  }

  function addBulkTopics() {
    const titles = bulk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (titles.length === 0) return;
    onChange({ ...discipline, topics: [...discipline.topics, ...titles.map((title) => ({ title }))] });
    setBulk('');
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <label className="label-field">Disciplina {index + 1}</label>
          <input
            className="input-field"
            value={discipline.name}
            onChange={(e) => onChange({ ...discipline, name: e.target.value })}
            placeholder="Nome da disciplina"
          />
        </div>
        <div className="w-24">
          <label className="label-field">Questões</label>
          <input
            className="input-field"
            inputMode="numeric"
            value={discipline.questionCount ?? ''}
            onChange={(e) => onChange({ ...discipline, questionCount: toNumberOrNull(e.target.value) })}
            placeholder="—"
          />
        </div>
        <div className="w-20">
          <label className="label-field">Peso</label>
          <input
            className="input-field"
            inputMode="decimal"
            value={discipline.weight ?? ''}
            onChange={(e) => onChange({ ...discipline, weight: toNumberOrNull(e.target.value) })}
            placeholder="—"
          />
        </div>
        <div className="min-w-[10rem] flex-1 sm:max-w-[14rem]">
          <label className="label-field">Critério mínimo</label>
          <input
            className="input-field"
            value={discipline.cutoff}
            onChange={(e) => onChange({ ...discipline, cutoff: e.target.value })}
            placeholder="ex.: mínimo de 50%"
          />
        </div>
        <div className="flex items-center pb-1.5">
          <button type="button" className={iconButton} onClick={() => onMove(-1)} disabled={index === 0} aria-label="Subir disciplina">
            <ArrowUp size={15} />
          </button>
          <button type="button" className={iconButton} onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Descer disciplina">
            <ArrowDown size={15} />
          </button>
          <button type="button" className={`${iconButton} hover:!text-red-600`} onClick={onRemove} aria-label="Remover disciplina">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {discipline.topics.map((topic, i) => (
          <div key={topic.id ?? `novo-${i}`} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-right text-xs text-neutral-400 dark:text-neutral-500">{i + 1}</span>
            <input
              className="input-field !py-1.5"
              value={topic.title}
              onChange={(e) => setTopicTitle(i, e.target.value)}
              aria-label={`Tópico ${i + 1} de ${discipline.name || 'disciplina'}`}
            />
            <button
              type="button"
              className={iconButton}
              onClick={() => onChange({ ...discipline, topics: move(discipline.topics, i, -1) })}
              disabled={i === 0}
              aria-label="Subir tópico"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              className={iconButton}
              onClick={() => onChange({ ...discipline, topics: move(discipline.topics, i, 1) })}
              disabled={i === discipline.topics.length - 1}
              aria-label="Descer tópico"
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              className={`${iconButton} hover:!text-red-600`}
              onClick={() => onChange({ ...discipline, topics: discipline.topics.filter((_, j) => j !== i) })}
              aria-label="Remover tópico"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {discipline.topics.length === 0 && (
          <p className="py-1 text-sm text-neutral-400 dark:text-neutral-500">Nenhum tópico ainda.</p>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          rows={2}
          className="input-field resize-none"
          placeholder="Adicionar tópicos: um por linha"
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
        />
        <button type="button" className="btn-secondary shrink-0" onClick={addBulkTopics} disabled={!bulk.trim()}>
          <Plus size={16} />
          Adicionar
        </button>
      </div>
    </div>
  );
}

/**
 * Edita o concurso inteiro: dados gerais, disciplinas e tópicos. Serve tanto
 * pra revisar o que a IA extraiu do edital quanto pra montar tudo à mão e pra
 * editar um concurso já salvo — os tópicos que já existem carregam o `id`, e é
 * ele que mantém seus vínculos com as coleções quando só mudam de nome ou lugar.
 */
export function ExamStructureEditor({ value, onChange }: ExamStructureEditorProps) {
  function setDiscipline(index: number, next: ExamDisciplineDraft) {
    onChange({ ...value, disciplines: value.disciplines.map((d, i) => (i === index ? next : d)) });
  }

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label-field">Nome do concurso</label>
          <input
            className="input-field"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="ex.: Analista de Tecnologia da Informação — Órgão X"
          />
        </div>
        <div>
          <label className="label-field">Cargo</label>
          <input
            className="input-field"
            value={value.position}
            onChange={(e) => onChange({ ...value, position: e.target.value })}
          />
        </div>
        <div>
          <label className="label-field">Banca</label>
          <input
            className="input-field"
            value={value.board}
            onChange={(e) => onChange({ ...value, board: e.target.value })}
          />
        </div>
        <div>
          <label className="label-field">Data da prova</label>
          <input
            type="date"
            className="input-field"
            value={value.examDate ?? ''}
            onChange={(e) => onChange({ ...value, examDate: e.target.value || null })}
          />
        </div>
      </div>

      {value.disciplines.map((discipline, index) => (
        <DisciplineEditor
          key={discipline.id ?? `nova-${index}`}
          discipline={discipline}
          index={index}
          count={value.disciplines.length}
          onChange={(next) => setDiscipline(index, next)}
          onMove={(direction) => onChange({ ...value, disciplines: move(value.disciplines, index, direction) })}
          onRemove={() => onChange({ ...value, disciplines: value.disciplines.filter((_, i) => i !== index) })}
        />
      ))}

      <button
        type="button"
        className="btn-secondary"
        onClick={() =>
          onChange({
            ...value,
            disciplines: [...value.disciplines, { name: '', questionCount: null, weight: null, cutoff: '', topics: [] }],
          })
        }
      >
        <Plus size={16} />
        Adicionar disciplina
      </button>
    </div>
  );
}
