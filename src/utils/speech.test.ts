import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserVoiceScore,
  bulletPointsToSpeech,
  clampSpeechRate,
  describeNaturalOutage,
  NATURAL_PAUSE_MAX_MS,
  NATURAL_PAUSE_MS,
  naturalPauseMs,
  pickBestBrowserVoice,
  portugueseVoices,
  SPEECH_RATE,
  stripHtmlForSpeech,
  summaryToSpeech,
  tidySpeechText,
  type BrowserVoice,
} from './speech';

const voice = (name: string, lang = 'pt-BR', localService = true): BrowserVoice => ({
  name,
  lang,
  voiceURI: name,
  localService,
});

// vozes de verdade, como o Windows, o Edge e o Chrome as listam
const DANIEL = voice('Microsoft Daniel - Portuguese (Brazil)');
const MARIA = voice('Microsoft Maria - Portuguese (Brazil)');
const FRANCISCA = voice('Microsoft Francisca Online (Natural) - Portuguese (Brazil)', 'pt-BR', false);
const ANTONIO = voice('Microsoft Antonio Online (Natural) - Portuguese (Brazil)', 'pt-BR', false);
const GOOGLE = voice('Google português do Brasil', 'pt-BR', false);
const PORTUGAL = voice('Microsoft Helia Online (Natural) - Portuguese (Portugal)', 'pt-PT', false);
const ENGLISH = voice('Microsoft David - English (United States)', 'en-US');

test('voz: só o português tem nota; as demais ficam de fora', () => {
  assert.equal(browserVoiceScore(ENGLISH), -Infinity);
  assert.ok(browserVoiceScore(DANIEL) > 0);
  assert.ok(browserVoiceScore(voice('x', 'pt_BR')) > 0, 'aceita "pt_BR" com sublinhado');
  assert.equal(browserVoiceScore(voice('x', 'portugues')), -Infinity, '"portugues" não é um código de idioma');
});

test('voz: a natural (neural) vence a local do sistema', () => {
  assert.ok(browserVoiceScore(FRANCISCA) > browserVoiceScore(MARIA));
  assert.ok(browserVoiceScore(GOOGLE) > browserVoiceScore(MARIA));
  assert.ok(browserVoiceScore(FRANCISCA) > browserVoiceScore(GOOGLE));
});

test('voz: o português do Brasil vem antes do de Portugal, até a local contra a natural', () => {
  assert.ok(browserVoiceScore(FRANCISCA) > browserVoiceScore(PORTUGAL));
  assert.ok(browserVoiceScore(MARIA) > browserVoiceScore(PORTUGAL), 'uma voz robótica daqui ainda vence uma natural de Portugal');
  // sem nenhuma voz do Brasil, a de Portugal é melhor que nada
  assert.equal(pickBestBrowserVoice([PORTUGAL, ENGLISH])?.name, PORTUGAL.name);
});

test('escolha: sem preferência, a melhor voz em português', () => {
  // Daniel e Maria empatam (as duas locais): vale a ordem alfabética, sempre a mesma
  assert.equal(pickBestBrowserVoice([MARIA, DANIEL, ENGLISH])?.name, DANIEL.name);
  // Francisca e Antonio também empatam; as duas naturais passam de qualquer local
  assert.equal(pickBestBrowserVoice([MARIA, GOOGLE, ENGLISH, ANTONIO, FRANCISCA])?.name, ANTONIO.name);
});

test('escolha: a voz que o usuário escolheu ganha, se ainda existir', () => {
  assert.equal(pickBestBrowserVoice([MARIA, FRANCISCA], MARIA.voiceURI)?.name, MARIA.name);
  // a escolhida sumiu (outro navegador, voz desinstalada): volta à melhor
  assert.equal(pickBestBrowserVoice([MARIA, FRANCISCA], 'voz que não existe mais')?.name, FRANCISCA.name);
  assert.equal(pickBestBrowserVoice([MARIA, FRANCISCA], null)?.name, FRANCISCA.name);
});

test('escolha: sem nenhuma voz em português, devolve null (o navegador usa a dele)', () => {
  assert.equal(pickBestBrowserVoice([ENGLISH]), null);
  assert.equal(pickBestBrowserVoice([]), null);
});

test('lista: só português, da melhor para a pior, sempre na mesma ordem', () => {
  const list = portugueseVoices([ENGLISH, PORTUGAL, MARIA, GOOGLE, FRANCISCA, DANIEL]);
  assert.deepEqual(
    list.map((v) => v.name),
    [FRANCISCA.name, GOOGLE.name, DANIEL.name, MARIA.name, PORTUGAL.name], // Daniel e Maria empatam: ordem alfabética
  );
});

test('velocidade: respeita os limites e não aceita lixo', () => {
  assert.equal(clampSpeechRate(1), 1);
  assert.equal(clampSpeechRate(0.1), SPEECH_RATE.min);
  assert.equal(clampSpeechRate(9), SPEECH_RATE.max);
  assert.equal(clampSpeechRate(Number.NaN), SPEECH_RATE.default);
  assert.equal(clampSpeechRate(1.234), 1.23);
});

test('texto: o HTML do cartão vira texto corrido, sem soletrar tags', () => {
  assert.equal(
    stripHtmlForSpeech('<div style="text-align:justify">Primeira linha</div><div>Segunda<br>linha</div><ul><li>a</li><li>b</li></ul>', 'html'),
    'Primeira linha Segunda linha a b',
  );
  assert.equal(stripHtmlForSpeech('a &lt; b &amp; c &nbsp;d', 'html'), 'a < b & c d');
  assert.equal(stripHtmlForSpeech('<img src="data:image/png;base64,AAAA">Legenda', 'html'), 'Legenda');
  // texto simples (cartões da IA) não é mexido
  assert.equal(stripHtmlForSpeech('x < y e <b> literal', 'plain'), 'x < y e <b> literal');
});

// ---------- voz natural fora do ar ----------

test('pausa: cota com horário de volta espera até ele; o resto, 5 minutos', () => {
  assert.equal(naturalPauseMs('quota', 30948), 30948 * 1000, 'até a hora que o Gemini informou');
  assert.equal(naturalPauseMs('quota', 7200), 7200 * 1000);
  assert.equal(naturalPauseMs('quota'), NATURAL_PAUSE_MS, 'sem horário informado');
  assert.equal(naturalPauseMs('quota', 0), NATURAL_PAUSE_MS);
  assert.equal(naturalPauseMs('overloaded', 30948), NATURAL_PAUSE_MS, 'só a cota tem horário de volta');
  assert.equal(naturalPauseMs('other'), NATURAL_PAUSE_MS);
});

test('pausa: nunca passa de 12 horas, nem fica menor que meio minuto', () => {
  assert.equal(naturalPauseMs('quota', 3 * 24 * 3600), NATURAL_PAUSE_MAX_MS);
  assert.equal(naturalPauseMs('quota', 1), 30_000);
});

test('aviso: a cota diz o motivo e a hora aproximada em que a voz natural volta', () => {
  const now = new Date(2026, 9, 11, 12, 30).getTime(); // 11/10/2026, 12:30 (horário local)
  const until = now + 30948 * 1000; // 21:05:48
  const text = describeNaturalOutage({ reason: 'quota', until, retryAfterSeconds: 30948 }, now);
  assert.equal(text, 'O limite diário gratuito do Gemini foi atingido. A voz natural deve voltar por volta das 21:10.');
});

test('aviso: se a volta é só no dia seguinte, diz "amanhã"', () => {
  const now = new Date(2026, 9, 11, 20, 0).getTime();
  const until = now + 10 * 3600 * 1000; // 06:00 do dia 12
  const text = describeNaturalOutage({ reason: 'quota', until, retryAfterSeconds: 36000 }, now);
  assert.match(text, /deve voltar amanhã, por volta das 06:00\.$/);
});

test('aviso: cota por minuto não é chamada de diária, e sem horário não promete nenhum', () => {
  const now = new Date(2026, 9, 11, 12, 0).getTime();
  const perMinute = describeNaturalOutage({ reason: 'quota', until: now + 45_000, retryAfterSeconds: 45 }, now);
  assert.match(perMinute, /^O limite gratuito do Gemini/);
  const unknown = describeNaturalOutage({ reason: 'quota', until: now + NATURAL_PAUSE_MS }, now);
  assert.equal(unknown, 'O limite gratuito do Gemini foi atingido. A voz natural será tentada de novo em alguns minutos.');
  assert.doesNotMatch(unknown, /\d\d:\d\d/);
});

test('aviso: sobrecarga e falha genérica têm texto próprio', () => {
  const base = { until: Date.now() + NATURAL_PAUSE_MS };
  assert.match(describeNaturalOutage({ reason: 'overloaded', ...base }), /sobrecarregado/);
  assert.match(describeNaturalOutage({ reason: 'other', ...base }), /não está disponível/);
});

test('bullet points: título e tópicos viram frases terminadas, para a voz fazer a pausa entre eles', () => {
  assert.equal(
    bulletPointsToSpeech('Protocolos de Rede', ['O Telnet usa a porta 23.', 'O FTP usa duas conexões', 'Qual é a porta do SSH?']),
    'Protocolos de Rede. O Telnet usa a porta 23. O FTP usa duas conexões. Qual é a porta do SSH?',
  );
});

test('bullet points: não duplica a pontuação, mesmo com aspas ou parênteses depois dela', () => {
  assert.equal(bulletPointsToSpeech('Título:', ['Chama-se "legalidade."', 'Veja (art. 5º)', 'Lista:']), 'Título: Chama-se "legalidade." Veja (art. 5º). Lista:');
});

test('bullet points: espaços e linhas quebradas viram um espaço só, e tópicos vazios somem', () => {
  assert.equal(bulletPointsToSpeech('  Resumo\n', ['  um   tópico \n com quebra ', '', '   ']), 'Resumo. um tópico com quebra.');
  assert.equal(bulletPointsToSpeech('', []), '');
});

test('resumo: o título e cada parágrafo viram frases terminadas, na ordem', () => {
  assert.equal(
    summaryToSpeech('Cluster e Grid', 'O cluster usa nós próximos.\n\nO grid é distribuído\nUsa recursos heterogêneos.'),
    'Cluster e Grid. O cluster usa nós próximos. O grid é distribuído. Usa recursos heterogêneos.',
  );
});

test('texto: espaços e quebras viram um espaço só, igual ao que o servidor faz', () => {
  assert.equal(tidySpeechText('  a  b\n\n c \t d '), 'a b c d');
  assert.equal(tidySpeechText('   '), '');
});

test('resumo editado (HTML): cada parágrafo e item vira uma frase, sem soletrar as tags', () => {
  const html =
    '<div style="text-align:justify">O cluster usa nós <b>próximos</b></div><div><br></div>' +
    '<div>Grid &amp; nuvem&nbsp;diferem</div><ul><li>Item um</li><li>Item dois.</li></ul>Fim<br>de linha';
  assert.equal(
    summaryToSpeech('Cluster', html, 'html'),
    'Cluster. O cluster usa nós próximos. Grid & nuvem diferem. Item um. Item dois. Fim. de linha.',
  );
  // o mesmo texto como resumo simples não é tratado como HTML
  assert.equal(summaryToSpeech('T', 'a < b e <b> literal', 'plain'), 'T. a < b e <b> literal.');
});
