# Base Concurseira

PDF → IA → Flashcards → Exportação para Anki.

Envie um PDF (apostila, legislação, artigo, material de curso), escolha como
quer os flashcards e a IA (Gemini) gera as perguntas e respostas. Revise,
edite ou exclua o que quiser e exporte um `.apkg` pronto para abrir direto no Anki.

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind CSS, React Router.
- **Backend:** Express + TypeScript, SQLite (`node:sqlite`, sem dependência nativa extra).
- **IA:** Google Gemini, via saída estruturada (JSON schema) para retorno confiável.
- **Auth:** sessão via cookie httpOnly assinado com JWT, senha com bcrypt.

Este é o MVP: fluxo síncrono (sem fila/Celery/Redis) — login → criar coleção
→ enviar PDF → IA gera os flashcards → revisar/editar → exportar .apkg → Anki.
O PDF inteiro (texto ou escaneado) vai direto para o Gemini, que lê o
conteúdo nativamente — não há etapa separada de OCR. Estatísticas ficam para
uma próxima iteração.

## Rodando localmente

Requer Node 22.5+ (usa `node:sqlite`).

```bash
npm install
cp .env.example .env
```

Edite `.env` e preencha:

- `JWT_SECRET`: qualquer string aleatória longa.
- `GEMINI_API_KEY`: sua chave em https://aistudio.google.com/apikey
  (sem ela, a geração de flashcards falha com uma mensagem clara — o resto do
  app funciona normalmente).

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3000 (o Vite faz proxy de `/api` para cá)

## Backup do banco

O servidor tira um backup do banco (`backups/app-AAAAMMDD-HHMMSS.db`) assim
que sobe, e depois a cada 6 horas enquanto estiver rodando — mantém os 14
mais recentes, os mais antigos são apagados automaticamente. Usa a API nativa
de backup do SQLite (`node:sqlite`'s `backup()`), que gera um snapshot
consistente mesmo com o banco aberto e em uso.

`backups/` fica dentro do projeto e é ignorada pelo git — mas como o projeto
todo mora numa pasta sincronizada pelo OneDrive, o próprio OneDrive replica
esses arquivos para a nuvem sem precisar de nenhuma configuração extra
(diferente do `data/app.db` ao vivo, que fica sendo escrito o tempo todo e é
um péssimo candidato a sincronização confiável).

**Para restaurar um backup:** pare o servidor, substitua `data/app.db` pelo
arquivo de backup desejado (renomeando-o para `app.db`), apague eventuais
`data/app.db-wal` e `data/app.db-shm` residuais, e suba o servidor de novo.

## Scripts

- `npm run dev` — frontend + API em modo desenvolvimento.
- `npm run typecheck` — checagem de tipos.
- `npm run build` — build de produção (frontend + servidor).
- `npm start` — roda o build de produção.

## Fluxo do MVP

1. Criar conta / entrar.
2. Criar uma coleção (nome, descrição, categoria).
3. Na página da coleção, enviar um PDF e configurar a geração (quantidade,
   dificuldade, tipo de flashcard, profundidade, foco).
4. A IA processa o PDF e gera os flashcards.
5. Revisar, editar ou excluir flashcards; editar nome/descrição/categoria da coleção.
6. Estudar direto no app: pergunta → mostrar resposta → marcar Errei/Difícil/Bom/Fácil.
   Cartões marcados como "Errei" voltam para o fim da fila na mesma sessão.
7. Exportar para Anki (`.apkg`: pergunta → Frente, resposta → Verso, dificuldade
   vira tag da nota).
8. No Anki: Arquivo → Importar → selecionar o `.apkg` (ou dar duplo clique nele).
