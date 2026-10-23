/**
 * O cronograma até a prova: só tabelas novas, nada que já existe é alterado. O plano em si NÃO é guardado: ele é refeito
 * a cada leitura a partir de hoje, do edital e do que o usuário já marcou como feito (assim o tópico que ficou para trás
 * volta nos próximos dias sozinho). Só se guardam as duas escolhas do usuário:
 *  - `schedule_settings`: quanto tempo ele tem por dia, quanto leva um tópico e em que dias da semana estuda, por concurso;
 *  - `schedule_topic_done`: os tópicos que ele marcou como estudados.
 * Apagar o concurso (ou o tópico) leva a linha junto; editar o edital mantém os tópicos que já existiam, e as marcas deles.
 */
export const SCHEDULE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS schedule_settings (
    exam_id           TEXT PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE,
    minutes_per_day   INTEGER NOT NULL,
    minutes_per_topic INTEGER NOT NULL,
    weekdays          TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule_topic_done (
    topic_id TEXT PRIMARY KEY REFERENCES exam_topics(id) ON DELETE CASCADE,
    done_at  TEXT NOT NULL
  );
`;
