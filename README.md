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

## Disciplinas (coleções agrupadas)

Na lista de coleções, as coleções de **mesmo nome** (sem diferenciar maiúsculas nem acentos)
viram uma disciplina: uma linha com o total de cartões e de pendentes, que abre e fecha as
coleções dela (cada uma aparece pelo assunto). A escolha de quais ficam abertas é lembrada neste
navegador; pesquisando, todas abrem. Nome que aparece uma vez só continua sendo uma linha comum.

"Estudar a disciplina inteira" abre uma revisão com os pendentes de todas as coleções da
disciplina juntos (`/disciplina/estudar`). Como estudar uma coleção direto, ela não é contida
pelo limite diário de cartões novos. Nessa revisão (e na global) cada cartão mostra a coleção e o
assunto dela.
