import type { Alternative, Level } from '../ai/pastexam';

export type { Alternative, Level };

/** A última resposta do usuário a uma questão. */
export interface LastAnswer {
  chosen: string;
  correct: boolean;
  answeredAt: string;
}

export interface QuestionView {
  id: string;
  examId: string;
  examName: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: string;
  number: number;
  support: string;
  statement: string;
  alternatives: Alternative[];
  discipline: string;
  subject: string;
  needsFigure: boolean;
  /** O texto lido pela IA não bateu com o do PDF na importação. */
  suspect: boolean;
  annulled: boolean;
  /** Existe gabarito (e a questão não foi anulada): só então ela pode ser respondida e corrigida. */
  gradable: boolean;
  note: string;
  mine: LastAnswer | null;
  /**
   * A alternativa certa. Só vai para o navegador depois que o usuário respondeu a questão ao menos uma vez
   * (ou quando ele pede a questão para editar): a correção é feita no servidor, que guarda o gabarito.
   */
  answer?: string;
  timesAnswered: number;
  timesCorrect: number;
  notebookCount: number;
}

export interface FacetOption {
  value: string;
  count: number;
}

export interface Facets {
  discipline: FacetOption[];
  /** O assunto vem com a disciplina a que pertence, para o filtro mostrar só os da disciplina escolhida. */
  subject: (FacetOption & { discipline: string })[];
  board: FacetOption[];
  organ: FacetOption[];
  year: FacetOption[];
  position: FacetOption[];
  level: FacetOption[];
  exam: (FacetOption & { id: string })[];
}

export interface BankTotals {
  questions: number;
  exams: number;
  answered: number;
  correct: number;
  annulled: number;
  withoutAnswer: number;
}
