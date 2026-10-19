# Memória Concurseira

*Aprenda. Revise. Memorize. Conquiste.*

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
Windows (`BaseConcurseira`, o nome antigo do app, mantido de propósito: renomear a tarefa
exige recriá-la): sobe sozinho quando você entra no Windows e volta
sozinho se o processo cair (num teste de queda forçada, voltou em ~2 minutos).
É a versão de **produção** (um
processo só serve a interface e a API), numa porta própria para não colidir com
o `npm run dev`:

- Neste PC: http://localhost:3200
- Outros aparelhos da mesma rede: `http://<IP-do-PC>:3200` (veja o IP com `ipconfig`;
  sem criptografia, veja "Usando no celular")

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

## Modo mãos livres

Para ouvir os cartões sem olhar a tela (andando, por exemplo). Abra **Mãos livres** no menu (ou
o botão no Painel): a voz lê a pergunta, espera o tempo para pensar (3, 5, 8 ou 12 segundos, à
sua escolha), lê a resposta e passa ao próximo, em ordem aleatória, com os cartões pendentes de
todas as coleções. Com `/maos-livres?ids=<id>,<id>` a fila fica só nas coleções indicadas.

- **Não conta como estudo:** nada é avaliado e o agendamento dos cartões não muda. Para avaliar,
  use "Revisar pendentes".
- **Controles:** pausar/continuar (continuar recomeça o cartão pela pergunta), cartão anterior,
  próximo e repetir. No PC, `Espaço` pausa e `←`/`→` trocam de cartão. Mudar o tempo para pensar
  vale na hora, até no meio da sessão.
- **Voz:** a escolhida em Configurações. A **natural** (Gemini) tem limite diário no plano
  gratuito e este modo gasta duas leituras por cartão; quando ela falha, o modo segue com a voz do
  navegador. A voz do navegador (como as vozes "Natural" gratuitas do Edge) não tem limite.
- **Tela do celular:** o app pede para a tela ficar ligada enquanto toca, porque a voz do
  navegador costuma parar quando ela apaga. A voz natural toca como áudio e, em navegadores que
  oferecem isso, pode mostrar os controles na tela de bloqueio.
- Cartões só com imagem na pergunta são pulados. Se a leitura falhar 3 vezes seguidas (sem som,
  sem voz em português), o modo para e avisa.

## Usando no celular

O app roda no seu PC e o celular só o acessa, então o PC precisa estar **ligado e sem
suspender** (Configurações do Windows → Sistema → Energia: "Suspender" em "Nunca", na
tomada). Há dois jeitos de chegar lá.

### Tailscale (recomendado)

O Tailscale cria uma rede privada e criptografada entre os seus aparelhos: funciona em casa e
fora dela e **não expõe o app à internet**. O endereço `https://...ts.net` tem HTTPS de
verdade, que é o que permite **instalar o app** na tela inicial.

1. Instale o Tailscale no PC e no celular (tailscale.com/download) e entre nos dois com a
   mesma conta.
2. Uma vez só, no painel de administração (login.tailscale.com/admin/dns), ligue o
   **MagicDNS** e os **HTTPS Certificates**.
3. No PC, num terminal: `tailscale serve --bg 3200`. Ele mostra o endereço, algo como
   `https://meu-pc.minha-rede.ts.net`. Para ver o que está ligado: `tailscale serve status`;
   para desligar: `tailscale serve reset`. (Em versões antigas do Tailscale, veja
   `tailscale serve --help`.) **Nunca use `tailscale funnel`**: ele publica o app na internet.
4. No celular, com o Tailscale ligado, abra esse endereço. No Chrome (Android): menu ⋮ →
   **Instalar app**. No Safari (iPhone): Compartilhar → **Adicionar à Tela de Início**. Entre
   com a sua conta do app (a sessão dura 30 dias).

O app instalado tem ícone próprio e abre em tela cheia. Se o PC estiver fora do ar (desligado,
suspenso, ou o Tailscale desligado no celular), aparece "Não consegui falar com o seu
computador" e o app volta sozinho assim que ele responde. O código do app nunca fica guardado
no celular: depois de um `npm run deploy`, a próxima abertura já usa a versão nova.

### Rede de casa, sem Tailscale

`http://<IP-do-PC>:3200` já funciona no Wi-Fi de casa, mas só em casa e **sem criptografia**
(a senha e a sessão passam em texto puro pelo Wi-Fi). Sem HTTPS o navegador também não instala o
app; só dá para criar um atalho na tela inicial.

### Fechar a porta para a rede de casa (opcional)

Por padrão o servidor escuta em todas as interfaces, e o Windows está liberando o Node na rede
de casa: qualquer aparelho dela (visitas, por exemplo) consegue abrir o app, criar uma conta e
gastar a sua cota de IA. Se você passar a usar só o Tailscale, pode restringir o servidor ao
próprio PC: ponha `BIND_ADDRESS=127.0.0.1` no `.env` e rode `npm run deploy`. O Tailscale
continua funcionando (o `tailscale serve` conecta em `localhost`), e o acesso por
`http://<IP-do-PC>:3200` deixa de funcionar. Um valor inválido impede o servidor de subir, com
a mensagem no log, em vez de ignorar o pedido em silêncio.

### Lembrete de estudo no celular

Em **Configurações → Lembrete de estudo** o celular passa a receber **uma notificação por dia**, na
hora que você escolher (padrão 19h), do tipo "56 cartões para revisar hoje · faltam 50 dias para a
prova". Começa desligado.

- **Para funcionar:** abra o app pelo endereço `https://...ts.net` do Tailscale (sem HTTPS o
  navegador não oferece notificações), instale-o na tela inicial (no iPhone é obrigatório: iOS 16.4 ou
  mais novo, e só funciona com o app aberto pelo ícone da tela inicial), toque em **Ativar neste
  aparelho** e permita as notificações. **Enviar um teste** confere na hora. Cada aparelho se ativa por
  si; a hora vale para a conta toda.
- **Quando manda:** na hora escolhida (ou até 3 horas depois, se o PC estava desligado nela; depois
  disso fica para o dia seguinte), no máximo **uma vez por dia**, e só se houver cartões na fila de
  revisão e você **ainda não tiver estudado hoje**. O PC precisa estar ligado e o servidor rodando.
  A verificação roda a cada 5 minutos.
- **Tocar na notificação** abre a revisão do dia (ou usa a janela do app, se já estiver aberta).
- **Como funciona:** é o Web Push padrão (RFC 8030, 8291 e 8292), escrito só com o `crypto` do Node,
  sem pacote novo. O conteúdo é cifrado de ponta a ponta para o aparelho; o serviço de push do
  navegador (Google, Mozilla, Apple ou Microsoft) só vê bytes cifrados e o tamanho. O servidor só aceita
  inscrições desses serviços (um endereço qualquer seria o servidor fazendo requisições para onde o
  usuário mandasse). As chaves VAPID do servidor são geradas na primeira vez e ficam no banco
  (`app_kv`): trocá-las invalidaria todas as inscrições. Para o contato exigido pelo protocolo, o
  padrão é o endereço do repositório; troque com `VAPID_SUBJECT=mailto:voce@exemplo.com` no `.env`.
- Desativar neste aparelho cancela a inscrição; **Desligar o lembrete** apaga a hora. Uma inscrição que
  o navegador cancelou ou deixou expirar é removida sozinha na próxima tentativa.

## Backup do banco

O servidor tira um backup do banco (`backups/app-AAAAMMDD-HHMMSS.db`) assim
que sobe, e depois a cada 6 horas enquanto estiver rodando. Usa a API nativa
de backup do SQLite (`node:sqlite`'s `backup()`), que gera um snapshot
consistente mesmo com o banco aberto e em uso.

**Quais ficam:** os **14 mais recentes** e, além deles, **o último backup de cada um dos
últimos 30 dias**. Só os 14 não bastavam: cada vez que o servidor sobe (um deploy, o PC
reiniciando) sai um backup novo, e num dia movimentado os 14 caíam todos em um ou dois dias,
sem ter para onde voltar de um problema notado uma semana depois. O resto é apagado
automaticamente. Só se mexe em arquivos com o nome de backup (`app-AAAAMMDD-HHMMSS.db`);
qualquer outro arquivo na pasta é deixado em paz. Com o banco em ~10 MB, a pasta chega a uns
450 MB no máximo (o OneDrive sincroniza tudo isso).

`backups/` fica dentro do projeto e é ignorada pelo git — mas como o projeto
todo mora numa pasta sincronizada pelo OneDrive, o próprio OneDrive replica
esses arquivos para a nuvem sem precisar de nenhuma configuração extra
(diferente do `data/app.db` ao vivo, que fica sendo escrito o tempo todo e é
um péssimo candidato a sincronização confiável).

**Para restaurar um backup:** pare o servidor (se estiver como tarefa agendada,
desabilite e encerre a tarefa, como descrito acima), substitua `data/app.db` pelo
arquivo de backup desejado (renomeando-o para `app.db`), apague eventuais
`data/app.db-wal` e `data/app.db-shm` residuais, e suba o servidor de novo.

### Exportar os seus dados

Em **Configurações → Seus dados**, "Exportar meus dados" baixa um arquivo
`memoria-concurseira-AAAA-MM-DD.json` com tudo o que é da conta de quem está logado: coleções,
cartões (com a agenda de revisão), histórico de estudo, resumos, bullet points, mapas mentais,
concursos, simulados (com tentativas e alternativas geradas), Pomodoro e o uso de IA. Serve
como cópia extra para guardar **fora** do PC (nuvem, pen drive).

- É **por conta**, de propósito: o app tem cadastro aberto e pode ser alcançado pela rede, então
  um botão que baixasse o banco inteiro entregaria a qualquer conta os dados de todas. A senha
  nunca vai no arquivo.
- As linhas saem como estão no banco (colunas em `snake_case`), sob `tabelas`, com `usuario`,
  `contagens` e a versão do formato (`versao`) no começo.
- Ainda não há importação pelo app. Para restaurar o banco inteiro, use os backups automáticos
  acima.
- Uma tabela nova do banco precisa ser listada em `server/account/export.ts` (ou nas exclusões,
  com o motivo): um teste falha se alguma ficar de fora, para o "tudo" não ficar incompleto sem
  ninguém notar.

## O nome do app

O app se chamava **Base Concurseira** e hoje é **Memória Concurseira**. O nome, o slogan e o
logotipo (um cartão de memorização com um cérebro, em `src/components/BrandMark.tsx`; os ícones
do app instalado, em `public/icons`, são o mesmo desenho) estão em tudo o que aparece na tela.
Alguns identificadores **internos** ficaram com o nome antigo de propósito, porque trocá-los
teria um custo que o nome não compensa:

- o cookie de sessão `bc_session` (trocar desconectaria quem está logado);
- as chaves `bc-*` do armazenamento do navegador (trocar apagaria as preferências de voz, de
  tema e o tempo para pensar do modo mãos livres);
- a tarefa agendada `BaseConcurseira` do Windows e a pasta de cache de voz `BaseConcurseira`
  em `%LOCALAPPDATA%` (trocar exige recriar a tarefa ou perder o cache);
- o nome da pasta do projeto, que o OneDrive e a tarefa agendada usam como caminho.

Se um dia quiser trocar algum deles, dá para fazer com migração (ler o nome antigo e gravar o
novo), sem perder nada.

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
   Ao **colar** no editor de um cartão (ou de um resumo) um texto copiado de um site, do Word ou de um
   chat de IA, o app mantém negrito, itálico, sublinhado, sobrescrito/subscrito, a **cor do texto e o
   realce quando são cores vivas** (laranja, azul, vermelho...; o preto, o cinza e o branco do tema do
   site ficam de fora), listas, títulos (em negrito), parágrafos e quebras de linha. Fonte, tamanho, links
   (fica o texto) e imagens de fora não vêm, e uma tabela vira uma linha por linha, com as células
   separadas por " | ". O botão de borracha do editor tira a formatação que não interessar.
   **Ctrl+Shift+V** cola só o texto, sem formatação. Uma imagem copiada continua entrando como imagem.
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

### Múltipla escolha (gerada por IA)

Autoavaliar é otimista: quem se marca "Fácil" nem sempre acerta quando precisa escolher entre
alternativas parecidas. Ao fazer um simulado, escolha **Múltipla escolha** e a quantidade de
questões (10, 20, 30, 50 ou todas):

- Cada cartão vira uma questão com **cinco alternativas** (uma correta e quatro erradas
  plausíveis), geradas pela IA pelo mesmo caminho dos outros recursos (`AI_PROVIDER_ORDER`:
  OpenAI, Gemini e Claude, nesta ordem, passando ao próximo se um falha).
- As alternativas são geradas **uma única vez por cartão** e ficam guardadas no banco
  (tabela `card_choices`). A preparação pede à IA só o que falta, em lotes de 8 cartões (uma
  chamada por lote), com barra de progresso e botão de cancelar. Se a cota acabar no meio,
  a tela oferece começar com as questões já prontas ou tentar de novo; o que foi gerado antes
  continua guardado. O gasto aparece em **Uso de IA**, como "Alternativas de simulado".
- Se você editar a pergunta ou a resposta do cartão, as alternativas dele são geradas de novo
  na próxima prova (mudar só a formatação não conta). Cartões só com imagem não viram questão.
- A posição da correta é sorteada a cada prova. Depois de responder, aparecem o gabarito e
  a **resposta do próprio cartão** (a IA pode errar; vale o que está no cartão). "Não sei"
  conta como erro, sem chute.
- Atalhos: `1` a `5` (ou `A` a `E`) escolhem, `0` é "não sei", `Enter` segue para a próxima,
  `←` volta e refaz a anterior.
- O histórico do simulado mostra o **tipo** de cada tentativa (autoavaliado ou múltipla
  escolha). Tentativas antigas contam como autoavaliadas.

### Simulado de uma disciplina do concurso

Em **Concursos**, abra uma disciplina e use **Simulado da disciplina**: o app cria um simulado
chamado "Disciplina — Concurso" com os cartões de todas as coleções ligadas aos tópicos dela
(sem repetir cartões). Usar o botão de novo, depois de ligar mais coleções, acrescenta só os
cartões que faltam ao mesmo simulado; nada é removido.

Ao lado dele, a disciplina tem **Revisar** e **Ouvir**: abrem, para as coleções ligadas aos tópicos
dela, a revisão dos cartões pendentes e o modo mãos livres (a voz lê, sem contar como estudo). O
"voltar" dessas telas leva de volta ao concurso. Como em "Estudar a disciplina inteira" da lista de
coleções, a revisão não é contida pelo limite diário de cartões novos.

Nas telas de estudo comum também há atalhos: `Enter` mostra a resposta, `1` a `4` avaliam
(errei, difícil, bom, fácil), `←` volta ao cartão anterior e `→` pula o cartão.

### Cobrir os tópicos sem material (cartões por IA)

Na página do concurso, os tópicos do edital sem cartões aparecem com o ponto cinza e o botão
**Gerar cartões com IA**. Nada roda sozinho: cada geração pede confirmação.

- **Um tópico:** a IA cria cerca de 12 cartões a partir do título do tópico, da disciplina e do
  concurso, cargo e banca. O tópico ganha uma **coleção nova**, já ligada a ele (assim os cartões
  dela são exatamente os dele e a cobertura não conta o mesmo cartão duas vezes). Se o título é
  "Grupo: assunto", o nome da coleção é o grupo e o assunto é o que vem depois, como nas suas
  outras coleções; sem "Grupo:", o nome é o da disciplina.
- **Os cartões não entram direto na revisão.** A IA pode errar (leis, números, datas), então eles ficam
  como **rascunhos** em **Cartões da IA a conferir** (o item aparece no menu, com a contagem, enquanto
  há algo esperando; a página do concurso também avisa). Enquanto são rascunhos, nenhuma tela de estudo,
  contagem, simulado ou estatística os vê. Veja "Conferir os cartões da IA" abaixo.
- **Uma rodada na disciplina:** "Gerar cartões dos próximos 20 tópicos sem material" faz um tópico
  por vez (cada um é uma chamada de IA), mostra o andamento e tem **Parar**. Para sozinho no primeiro
  erro (a cota do dia, por exemplo); o que já foi gerado fica, e a próxima rodada continua no
  tópico seguinte. O limite de 20 por rodada protege a cota da IA.
- **Confira o que a IA gerou.** Sem texto-fonte, ela pode errar, sobretudo em leis, números e datas
  (o pedido já manda não inventar artigos, datas nem valores). A descrição da coleção diz que ela
  foi gerada assim, e o arquivo de origem aparece como um tópico, não um PDF. Para trocar por
  material seu, ligue outra coleção ao tópico em "Vincular coleção" ou apague a coleção gerada.
- O uso entra no contador de IA ("Flashcards") das Configurações.
- Um tópico que já tem material não é gerado de novo. Se o tópico está ligado só a coleções
  vazias, a coleção nova se soma aos vínculos que ele já tinha.

### Conferir os cartões da IA

Em **Cartões da IA a conferir** (`/conferir-cartoes`), cada coleção gerada mostra os cartões com
**Aprovar**, **Editar** e **Descartar**, e no alto da coleção **Aprovar todos**, **Descartar todos** e
**Conferir com outra IA**.

- **Aprovar** faz do rascunho um cartão comum, na coleção do tópico: só então ele entra na fila de
  estudo (como novo). Se a coleção já tem um cartão com a mesma pergunta, nada é duplicado. **Editar**
  corrige a pergunta ou a resposta (ou "Salvar e aprovar"). **Descartar** apaga o rascunho; se uma coleção
  criada pela IA ficar sem cartões e sem rascunhos, ela é apagada junto e o tópico volta a poder receber
  cartões novos. Coleções suas nunca são apagadas por aqui. "Aprovar todos" e "Descartar todos" pedem
  confirmação.
- **Conferir com outra IA** pede uma **segunda opinião**: cada cartão volta com um veredito (certo, com
  dúvida ou possível erro) e o motivo, em lotes de 12 cartões (até 60 por vez). É **só um alerta**: nada é
  aprovado ou descartado por ele, e a IA que confere também pode errar. Editar um cartão apaga o veredito
  dele (valia para o texto antigo). Com mais de uma chave de IA configurada, quem confere tende a ser outro
  provedor que não o que escreveu (a ordem é a de `AI_PROVIDER_ORDER` ao contrário; ou defina
  `AI_VERIFY_ORDER`, por exemplo `claude,openai,gemini`); com uma chave só, o mesmo provedor confere, com
  outro pedido. O uso aparece em Configurações como "Conferência de cartões".
- Os rascunhos entram na exportação dos seus dados. Cartões gerados antes desta conferência existir
  continuam como estavam (já são cartões comuns).

## Banco de questões (provas anteriores)

No menu lateral, **Banco de questões** (`/questoes`) guarda as questões de provas antigas da banca, com o
gabarito, para você resolver no estilo dela. As questões **não são cartões**: não entram na fila de revisão
nem nas estatísticas dos cartões.

- **Importar uma prova** (`/questoes/importar`): envie o PDF da prova e diga onde está o gabarito (no mesmo
  PDF, em outro PDF ou colado). A IA copia enunciados e alternativas como estão no PDF e **nunca escolhe a
  alternativa certa**: o gabarito vem só do que está escrito. A leitura roda em segundo plano (pode levar
  alguns minutos) e a página mostra o andamento. Sem gabarito a prova entra do mesmo jeito, e você informa a
  letra depois, questão por questão.
- **Captura de um site de questões** (por exemplo, a impressão ou a captura de tela de uma busca do
  QConcursos, mesmo só de imagens): cada questão vem com o **código** do site (`Q4229308`), a disciplina e o
  assunto, e o **ano, a banca, o órgão e a prova dela**, que a IA copia da linha da própria questão. As
  questões se juntam em **uma prova por nome de prova** (a captura pode misturar várias). A **resposta** vem do
  "Gabarito: C" escrito junto da questão, e o **gabarito comentado** (fundamento, análise das alternativas,
  dicas) é transcrito por inteiro. Importar de novo a mesma captura não duplica: a questão que já está no banco,
  pelo código, é pulada, e as novas entram na prova que já existe. Sem o gabarito comentado aberto na página, a
  questão entra sem gabarito.
- **Conferir antes de salvar:** nada é gravado até você confirmar. A tela lista os avisos: questões que
  faltam na numeração, gabarito conflitante ou com letra que a questão não tem, texto que não bate com o do
  PDF (a IA pode ter reescrito), questões que dependem de figura e PDF escaneado. Numa captura de site, mostra
  as provas encontradas, com nome, banca, órgão e ano para corrigir. Tudo se edita ali.
- **Questões de múltipla escolha** (2 a 5 alternativas) e **Certo/Errado**. Questão sem alternativas
  (discursiva) é descartada.
- **Resolver** (aba Questões): filtros por Minhas questões (resolvidas, não resolvidas, acertei, errei,
  pela última resposta), palavra, disciplina, assunto, banca, nível, cargo, ano, órgão e prova, o que
  excluir (já em caderno, anuladas, sem gabarito), "com gabarito comentado" e "só com minhas anotações" (a
  busca por palavra olha também o gabarito comentado). Há **Salvar filtro**, **Meus filtros** e **Aplicar
  último filtro**. A correção é feita no servidor, que só manda o gabarito e o **gabarito comentado**
  depois que você responde (o comentário entrega a resposta). O botão **Corrigir** edita texto, gabarito,
  gabarito comentado, disciplina ou anula a questão (mudar o gabarito refaz o acerto e o erro das respostas e
  dos simulados já feitos).
- **Cadernos e simulados:** **Gerar caderno** guarda as questões do filtro que têm gabarito (até 300);
  **Criar simulado** faz o mesmo, sorteando, e já começa cronometrado, com a correção só no final e o
  histórico no caderno. **Praticar as que errei** refaz as pendentes.
- **Provas** (aba Provas): editar os dados de uma prova ou apagá-la (leva as questões e as suas respostas).
- **Cartões das questões que você errou** (sem IA): **Criar cartão** (na questão, depois de responder),
  **Cartões das que errei** (na lista, usando o filtro aplicado) e **Criar cartões das que errei** (no
  resultado de um simulado) viram cartões de revisão espaçada: o enunciado e as alternativas na frente; o
  gabarito, o gabarito comentado (se houver) e a fonte (banca, ano, código) no verso. Vão para uma coleção
  sua: por padrão "Erros do banco de questões", que é criada na primeira vez e reaproveitada depois (ou
  escolha outra coleção). Nada é criado sozinho. A questão que já tem cartão é pulada (não duplica); só entram
  as que você respondeu, com gabarito e não anuladas; são até 100 por pedido (o resto vem no pedido
  seguinte). Apagar o cartão libera a questão para ter outro; apagar a questão mantém o cartão.
- **Nota de corte** (resultado do simulado e aba **Desempenho**): cada simulado guarda o placar por
  disciplina (as questões em branco contam) e o app o compara com o **critério mínimo** que está no
  concurso (o campo "Critério mínimo" da disciplina). Entende "mínimo de 50%", "30 pontos" (precisa do nº
  de questões e do peso para saber o total) e "20 questões"; o que não der para ler como nota fica de fora
  da comparação, sem chute. A disciplina das questões casa com a do concurso pelo nome, sem diferenciar
  acento e caixa, ou quando um nome contém o outro ("Português" e "Língua Portuguesa"), se só uma servir;
  as que não casam aparecem à parte (corrija o nome da disciplina da questão para entrarem). O resultado
  mostra quanto falta em cada disciplina (acertos e pontos), a **nota estimada na prova** (pelo peso de
  cada disciplina) e, nas que ficaram abaixo, o atalho **Ver as que errei**. A aba **Desempenho** acompanha
  os últimos 10 simulados: por disciplina, a situação pelos **últimos 3** (menos sujeita a um simulado
  ruim ou bom), a tendência (subindo, caindo ou estável) e um gráfico com a linha da nota de corte. Com
  poucas questões por disciplina a nota balança, e o app avisa. É uma estimativa: não vê a nota de corte
  geral nem a classificação, e só os simulados do banco entram (os de cartão são autoavaliados). Simulados
  feitos antes desta função não têm placar por disciplina e só mostram o total.
- Os dados entram na exportação da conta (`qb_*`). Como a leitura gasta IA, ela aparece em
  "Leitura de provas" no uso de IA.

## Limite diário de cartões novos

Em **Configurações → Plano de estudo** dá para limitar quantos cartões que você nunca estudou
entram na revisão de cada dia. Vazio (o padrão) = sem limite, como sempre foi.

- Só os cartões **novos** são limitados; as revisões dos que você já estudou entram todas.
- Os novos que entram são os mais antigos (na ordem em que foram criados ou importados). O
  que já foi estudado pela primeira vez hoje desconta do limite, e amanhã ele recomeça.
- A revisão global, o botão "Revisar pendentes" do Painel e o aviso "Meta de hoje" da lista de
  coleções usam a mesma conta. O Painel mostra os "Novos aguardando".
- Estudar uma coleção direto (pelo botão "Estudar" dela) não tem limite: ali a escolha é sua.

### Ordem dos cartões novos

Por padrão, os novos entram do mais antigo ao mais novo. Em **Configurações → Ordem dos
cartões novos** dá para trocar por **Pelo edital da prova**: as vagas de cada dia são repartidas
entre as disciplinas do concurso com data mais próxima, na proporção do peso de cada uma
(questões × peso no edital).

- **Só vale com limite diário.** Sem limite, todos os novos entram e a ordem não muda nada.
- **Como escolhe:** a cada vaga, entra um cartão da disciplina que está mais abaixo da sua
  cota, **contando o que você já estudou**. Assim a divisão se corrige sozinha: uma disciplina
  que ficou para trás recebe mais vagas até alcançar as outras. Dentro de uma disciplina, a
  ordem é a de criação.
- **A cota** reparte o peso só entre as disciplinas que têm cartões (uma disciplina do edital
  sem nenhuma coleção ligada não "segura" vagas que ela não pode usar). Cartões de coleções
  que não estão ligadas ao edital entram por último.
- Uma coleção ligada a mais de uma disciplina conta para a de maior peso.
- Sem concurso com data (ou sem disciplinas no edital), vale a ordem de criação. Se o cálculo
  falhar por qualquer motivo, o app registra o erro no log e usa a ordem de criação: o estudo
  nunca fica sem fila.
- A tabela em Configurações mostra a cota, a parte já estudada e os novos de cada disciplina, e
  a "Meta para a prova" avisa qual ordem vale para o cenário escolhido.

## Meta para a prova

Se algum concurso tem **data da prova**, o Painel mostra "Meta para a prova" (do concurso com a
data mais próxima que ainda não passou): quantos cartões novos e vencidos você tem, quanto
você estuda por dia e o que cada tempo diário cobre até a prova.

- **Cenários:** "No seu ritmo atual" (quantos novos cabem sem deixar as revisões para trás),
  dois tempos fixos (30, 45, 60 ou 90 min, os que ficam entre o seu ritmo e o necessário) e "Ver
  todos os cartões novos". Cada um diz quantos novos por dia, quanto trabalho dá, quanto tempo
  leva e que parte dos novos é vista antes da prova. O gráfico mostra a carga de cada dia.
- **Como é calculado:** uma simulação dia a dia com o **mesmo algoritmo de revisão do app**
  (1 dia, depois 6, depois o intervalo × facilidade), e não uma regra de bolso: cada cartão novo
  volta várias vezes antes da prova, e isso pesa mais do que parece. O tempo vem do **seu**
  tempo médio por cartão nos últimos 30 dias (30 s se ainda não há medida).
- **Suposições** (também escritas no rodapé do cartão): você acerta os cartões ("Bom"); os
  últimos 7 dias antes da prova são só de revisão (3 dias ou menos: só revisar); os cartões já
  vencidos são recuperados ao longo de uma semana; o tempo leva uma margem de 15% pelos erros;
  o ritmo é a média dos últimos 14 dias, **contando os dias sem estudo**.
- **"Usar N novos por dia"** grava o limite diário de cartões novos (o mesmo de Configurações →
  Plano de estudo) e atualiza o contador de "Revisar pendentes". Nada é aplicado sem o clique.
- O cartão some se nenhum concurso tem data. Um concurso sem data pode ganhar uma em
  **Concursos → Editar**.

## Meu desempenho

No menu lateral, **Meu desempenho** (`/desempenho`) mostra o que você estudou num período, por
**nome da coleção** e por **assunto**. A página de Estatísticas continua como era.

- **Período:** Hoje, 7, 15 e 30 dias, Desde o início, ou um período personalizado (o ícone do
  calendário: dois dias, os dois inclusos, de até 10 anos). "7 dias" é hoje e os 6 anteriores,
  em dias do calendário local.
- **Os números:** *cartões estudados* (cartões diferentes com ao menos uma revisão no período; um
  cartão revisto três vezes conta uma), taxa de acerto, acertos e erros. **Acerto = Bom ou Fácil;
  erro = Errei ou Difícil.** O cartão "Cartões estudados" também diz que parte dos seus cartões
  isso representa.
- **Gráficos:** revisões por dia, separadas em acertos (verde) e erros (vermelho), em curva suave
  (períodos longos agrupam os dias; com um ou dois pontos só, viram barras); uma rosca com as
  revisões por resultado (Fácil, Bom, Difícil, Errei); barras de cartões estudados por nome da
  coleção e por assunto (com a chave "Cartões / Revisões"); e a tabela "Desempenho por nome da
  coleção", em que cada nome abre e mostra os assuntos dele.
- **Tendência:** na tabela, a seta compara o acerto com o **período anterior de mesma duração**
  (sobe, cai ou estável: menos de 2 pontos de diferença é estável). "Desde o início" não tem
  período anterior, então não mostra seta.
- **Filtros:** "Todos os filtros" (nome e assunto), ou tocar numa barra ou no funil de uma linha da
  tabela: a página inteira passa a valer só para aquele nome ou assunto. "Meu concurso" (se você tem
  concurso) limita aos cartões das coleções ligadas ao edital do concurso de data mais próxima (sem
  data futura, o criado por último). O período e os filtros ficam no endereço da página.
- **Pontos de atenção:** logo abaixo dos números, a página aponta até 5 grupos (um assunto dentro de um
  nome, ou o nome todo quando nenhum assunto sozinho tem revisões o bastante) onde o acerto está **abaixo
  de 60%** ou **caiu 10 pontos ou mais** em relação ao período anterior. Só entra grupo com **6 revisões ou
  mais** no período (e, para a queda, 6 ou mais no período anterior): com menos que isso o acerto balança
  demais para dizer algo. Cada ponto traz os motivos e dois botões: **Revisar os N errados** e **Filtrar**.
- **Revisar os errados** (`/revisar-erros`) abre só os cartões daquele grupo que você errou (**Errei** ou
  **Difícil**) no período da página, **vencidos ou não**, os que mais errou primeiro (até 200). É uma
  revisão extra: o que você avaliar entra no agendamento como qualquer revisão. O "voltar" leva à página
  com o mesmo período e filtros.
- **Tempo de estudo:** um painel mostra onde o seu tempo vai, com o mesmo período, escopo e filtros da
  página. Há duas fontes, mostradas lado a lado e **nunca somadas em dobro**:
  - **Pomodoro:** o tempo de foco que você registrou, com a disciplina e o assunto que digitou.
  - **Cartões:** o tempo de cada revisão. É o medido; se não foi medido (revisões antigas), é o
    intervalo até a revisão anterior quando plausível (de 1 s a 2 min); senão a mediana. É a mesma regra do
    Painel, e o painel diz quantas revisões tiveram o tempo estimado.
  - Uma revisão feita **dentro de um Pomodoro** (do começo ao fim dele) já está no tempo do Pomodoro: fica
    de fora do tempo dos cartões, e o painel mostra quanto foi descontado. Vale a disciplina que você
    declarou no Pomodoro. O acerto dos cartões continua contando por coleção.
  - **Por disciplina do edital** (quando há concurso): cada disciplina mostra o **peso na prova** (questões ×
    peso, como na ordem dos cartões novos), a fatia do seu tempo e o acerto, e uma leitura: **Pouco tempo
    para o peso** (menos de 70% do que o peso pede e ao menos 5 pontos de diferença), **Equilibrado** ou
    **Tempo de sobra** (mais de 130%). Pouco tempo junto de acerto abaixo de 70% vira **Prioridade**, e uma
    frase no topo aponta onde mais falta. Com menos de 30 min no total o painel não opina. As coleções
    contam para a disciplina do edital a que estão ligadas (a de maior peso, se forem várias); o que não
    está no edital aparece em "Fora do edital".
  - **Por nome da coleção:** o mesmo tempo, agrupado pelo nome, com os assuntos de cada um.
  - O Pomodoro entra na disciplina pelo **nome que você digitou** (sem diferenciar maiúsculas e acentos):
    ele casa com o nome de uma disciplina do edital ou de uma coleção. Os campos Disciplina e Assunto do
    Pomodoro agora **sugerem** esses nomes (continuam livres), para o tempo se juntar aos cartões sem
    ninguém ter que lembrar a grafia. Um nome que não casa com nada fica numa linha própria.
- Nomes e assuntos são agrupados como na lista de coleções (sem diferenciar maiúsculas nem
  acentos); coleções sem assunto entram em "Sem assunto". Tudo vem do histórico de revisões: nada é
  guardado à parte, e a página não altera nem apaga nada.

## Disciplinas (coleções agrupadas)

Na lista de coleções, as coleções de **mesmo nome** (sem diferenciar maiúsculas nem acentos)
viram uma disciplina: uma linha com o total de cartões e de pendentes, que abre e fecha as
coleções dela (cada uma aparece pelo assunto). A escolha de quais ficam abertas é lembrada neste
navegador; pesquisando, todas abrem. Nome que aparece uma vez só continua sendo uma linha comum.

"Estudar a disciplina inteira" abre uma revisão com os pendentes de todas as coleções da
disciplina juntos (`/disciplina/estudar`). Como estudar uma coleção direto, ela não é contida
pelo limite diário de cartões novos. Nessa revisão (e na global) cada cartão mostra a coleção e o
assunto dela.
