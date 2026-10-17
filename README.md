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
  (sem nenhuma chave de IA, a geração de flashcards falha com uma mensagem
  clara — o resto do app funciona normalmente).
- Opcionais, para ter mais de um provedor de IA: `OPENAI_API_KEY` e
  `ANTHROPIC_API_KEY` (Claude, em https://console.anthropic.com). A ordem
  padrão é OpenAI, Gemini e Claude — cada um só entra se tiver chave, e quando
  um falha (sem créditos, sobrecarga) o app tenta o próximo. Para mudar a ordem
  ou desligar um provedor sem apagar a chave: `AI_PROVIDER_ORDER=claude,gemini`.
  O Claude cobre tópico, texto, imagem, PDF, resumos, mapas mentais, bullet
  points e a análise de edital; áudio, vídeo e YouTube seguem só no Gemini. O
  modelo é `claude-sonnet-5-5`, e `ANTHROPIC_MODEL` troca por outro.
- A leitura em voz alta tem uma voz **natural** (gerada pelo Gemini, com a mesma
  `GEMINI_API_KEY`) e a voz do navegador. A natural é a padrão e fica guardada em
  disco depois de gerada (fora da pasta do projeto, para o OneDrive não sincronizar);
  se o Gemini falhar ou o limite do plano gratuito acabar, o app lê com a voz do
  navegador. Voz, velocidade e motor se escolhem em Configurações. As opções
  `GEMINI_TTS_MODEL`, `TTS_CACHE_DIR` e `TTS_CACHE_MAX_MB` estão no `.env.example`.

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3000 (o Vite faz proxy de `/api` para cá)

## Rodando em segundo plano (Windows)

Para o app ficar no ar sem terminal aberto, ele roda como tarefa agendada do
Windows (`BaseConcurseira`): sobe sozinho quando você entra no Windows e volta
sozinho se o processo cair (num teste de queda forçada, voltou em ~2 minutos).
É a versão de **produção** (um
processo só serve a interface e a API), numa porta própria para não colidir com
o `npm run dev`:

- Neste PC: http://localhost:3200
- Outros aparelhos da mesma rede: `http://<IP-do-PC>:3200` (veja o IP com `ipconfig`)

```bash
npm run service:install   # registra a tarefa (uma vez; não exige administrador)
npm run deploy            # depois de mudar o código: typecheck + build + reinicia
```

A versão de produção é uma "foto" do código: mudanças só aparecem depois de
`npm run deploy`. O `npm run dev` continua funcionando ao lado (portas
3000/5173) e usa o mesmo banco.

Como a tarefa se religa sozinha, parar o app exige desabilitá-la antes:

```bash
schtasks /change /tn BaseConcurseira /disable   # impede de religar
schtasks /end /tn BaseConcurseira               # derruba o processo atual
schtasks /change /tn BaseConcurseira /enable    # volta ao normal
schtasks /run /tn BaseConcurseira               # sobe agora
```

Não defina `NODE_ENV=production` nessa tarefa: o cookie de sessão passaria a
ser `secure` e deixaria de funcionar em HTTP pelo IP da rede.

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

**Para restaurar um backup:** pare o servidor (se estiver como tarefa agendada,
desabilite e encerre a tarefa, como descrito acima), substitua `data/app.db` pelo
arquivo de backup desejado (renomeando-o para `app.db`), apague eventuais
`data/app.db-wal` e `data/app.db-shm` residuais, e suba o servidor de novo.

## Scripts

- `npm run dev` — frontend + API em modo desenvolvimento.
- `npm run typecheck` — checagem de tipos.
- `npm run build` — build de produção (frontend + servidor).
- `npm start` — roda o build de produção (em primeiro plano).
- `npm run service:install` — registra o app como tarefa agendada do Windows.
- `npm run deploy` — typecheck, build e reinício do app em segundo plano.

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

## Simulados

Listas de cartões para treinar como numa prova, separadas da revisão espaçada:

1. Em qualquer cartão (no estudo ou na lista da coleção), o botão "Adicionar ao simulado"
   abre a lista dos seus simulados: marque os que devem ter o cartão ou crie um novo ali
   mesmo. Um cartão pode estar em vários simulados.
2. Em **Simulados**, "Fazer simulado" mostra um cartão por vez, com cronômetro: você
   mostra a resposta e marca "Errei" ou "Acertei". Atalhos: `Enter` mostra a resposta,
   `1` errei, `2` acertei, `←` volta ao cartão anterior.
3. No fim há a nota, o tempo, a lista do que errou e a opção de refazer só os erros.
   Cada tentativa fica no histórico do simulado.
4. O simulado não mexe no agendamento dos cartões nem no painel de estudo.

Nas telas de estudo comum também há atalhos: `Enter` mostra a resposta, `1` a `4` avaliam
(errei, difícil, bom, fácil), `←` volta ao cartão anterior e `→` pula o cartão.

## Limite diário de cartões novos

Em **Configurações → Plano de estudo** dá para limitar quantos cartões que você nunca estudou
entram na revisão de cada dia. Vazio (o padrão) = sem limite, como sempre foi.

- Só os cartões **novos** são limitados; as revisões dos que você já estudou entram todas.
- Os novos que entram são os mais antigos (na ordem em que foram criados ou importados). O
  que já foi estudado pela primeira vez hoje desconta do limite, e amanhã ele recomeça.
- A revisão global, o botão "Revisar pendentes" do Painel e o aviso "Meta de hoje" da lista de
  coleções usam a mesma conta. O Painel mostra os "Novos aguardando".
- Estudar uma coleção direto (pelo botão "Estudar" dela) não tem limite: ali a escolha é sua.

## Disciplinas (coleções agrupadas)

Na lista de coleções, as coleções de **mesmo nome** (sem diferenciar maiúsculas nem acentos)
viram uma disciplina: uma linha com o total de cartões e de pendentes, que abre e fecha as
coleções dela (cada uma aparece pelo assunto). A escolha de quais ficam abertas é lembrada neste
navegador; pesquisando, todas abrem. Nome que aparece uma vez só continua sendo uma linha comum.

"Estudar a disciplina inteira" abre uma revisão com os pendentes de todas as coleções da
disciplina juntos (`/disciplina/estudar`). Como estudar uma coleção direto, ela não é contida
pelo limite diário de cartões novos. Nessa revisão (e na global) cada cartão mostra a coleção e o
assunto dela.
