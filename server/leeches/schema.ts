/**
 * Cartões sanguessuga: só uma tabela nova, nada que já existe é alterado. O que torna um cartão sanguessuga sai do
 * histórico de revisões (`study_sessions`); esta tabela guarda só o que o usuário decidiu sobre o cartão:
 *  - `reset_at`: quando ele reescreveu o cartão ou mandou recomeçar a contagem (os erros de antes deixam de valer);
 *  - `snoozed_until`: até quando pediu para adiar a revisão (a data de vencimento do cartão também é empurrada, mas
 *    só isto distingue "adiado pelo usuário" de "vence amanhã porque acabou de ser revisado").
 *
 * Apagar o cartão leva a linha junto.
 */
export const LEECH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS leech_state (
    flashcard_id  TEXT PRIMARY KEY REFERENCES flashcards(id) ON DELETE CASCADE,
    reset_at      TEXT,
    snoozed_until TEXT
  );
`;
