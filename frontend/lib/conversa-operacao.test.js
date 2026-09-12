'use strict'
// Central de Mensagens em equipe — apresentação pura (Etapa 7).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const C = require('./conversa-operacao')

// ─── A regra que separa conversa de lead ─────────────────────────────────────────────────

test('RESPONDER nunca e bloqueado — nem na conversa de outra pessoa', () => {
  // Travar a resposta deixaria o CLIENTE sem resposta porque o sistema decidiu que a pessoa
  // errada estava na tela. O ownership de conversa organiza; nao barra atendimento.
  const alheia = { responsavel_id: 'u2', responsavel_nome: 'Ana' }
  const r = C.avisoDeAtendimento(alheia, 'u1')
  assert.equal(r.podeResponder, true)
  assert.equal(r.avisar, true)
  assert.match(r.texto, /Ana/)
  assert.match(r.texto, /pode responder/)
})

test('conversa propria e sem dono NAO geram aviso', () => {
  assert.equal(C.avisoDeAtendimento({ responsavel_id: 'u1' }, 'u1').avisar, false)
  assert.equal(C.avisoDeAtendimento({ responsavel_id: null }, 'u1').avisar, false)
  assert.equal(C.avisoDeAtendimento({ responsavel_id: null }, 'u1').texto, '')
  // Mesmo sem aviso, a permissao continua sendo sempre verdadeira.
  assert.equal(C.avisoDeAtendimento(null, 'u1').podeResponder, true)
})

test('guarda: o modulo NAO ganhou uma funcao de bloquear resposta', () => {
  // Alguem, mais tarde, vai querer "travar a conversa do colega". A conversa sobre isso tem de
  // acontecer aqui — e nao num podeResponder falso que aparece em silencio.
  const fonte = fs.readFileSync(path.join(__dirname, 'conversa-operacao.js'), 'utf8')
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*$/gm, '')
  assert.ok(!/podeResponder\s*:\s*false/.test(semComentarios), 'podeResponder nunca pode ser false')
  assert.ok(!/function\s+(podeResponder|bloquearResposta|travarConversa)/.test(semComentarios),
    'nao crie funcao que barra o atendimento — leia o cabecalho do modulo')
})

// ─── Recorte ─────────────────────────────────────────────────────────────────────────────

test('quem nao ve todas recebe apenas o recorte das proprias conversas', () => {
  const semTodas = C.opcoesEscopoConversa(false).map((o) => o.valor)
  assert.deepEqual(semTodas, [''])
  assert.equal(C.opcoesEscopoConversa(false)[0].rotulo, 'Minhas conversas')
  assert.deepEqual(C.opcoesEscopoConversa(true).map((o) => o.valor), ['', 'minhas', 'nao_atribuidas', 'todas'])
  assert.equal(C.opcoesEscopoConversa(true)[0].rotulo, 'Todas')
})

test('o escopo EFETIVO do servidor tem rotulo proprio', () => {
  assert.equal(C.rotuloEscopoEfetivoConversa('proprias'), 'Minhas conversas')
  assert.equal(C.rotuloEscopoEfetivoConversa('nao_atribuidas'), 'Não atribuídas')
  assert.equal(C.rotuloEscopoEfetivoConversa('desconhecido'), 'Todas')
})

test('o aviso de recorte so aparece quando houve REBAIXAMENTO', () => {
  // Recortar em silencio faria o atendente achar que a Central esvaziou.
  assert.match(C.avisoDeRecorte('todas', 'proprias'), /atribuídas a você/)
  assert.equal(C.avisoDeRecorte('minhas', 'minhas'), '')
  assert.equal(C.avisoDeRecorte('', ''), '')
  // Pedir nada e receber o padrao tambem e' rebaixamento: a tela precisa dizer o que mostra.
  assert.ok(C.avisoDeRecorte('', 'proprias').length > 0)
})

// ─── Atendente ───────────────────────────────────────────────────────────────────────────

test('"sem atendente" e a FILA, nao uma pendencia', () => {
  const livre = C.atendenteDaConversa({ responsavel_id: null }, 'u1')
  assert.equal(livre.estado, 'nao_atribuida')
  assert.equal(livre.rotulo, 'Sem atendente')
  assert.equal(livre.meu, false)
})

test('o id do usuario NUNCA vira rotulo', () => {
  const semNome = C.atendenteDaConversa({ responsavel_id: '8f3c-uuid' }, 'u1')
  assert.equal(semNome.rotulo, 'Outro atendente')
  assert.ok(!semNome.rotulo.includes('8f3c'))
  assert.equal(C.atendenteDaConversa({ responsavel_id: 'u1' }, 'u1').rotulo, 'Você')
})

test('as tres acoes de atendente sao distintas', () => {
  const livre = { responsavel_id: null }
  const minha = { responsavel_id: 'u1' }
  const alheia = { responsavel_id: 'u2', responsavel_nome: 'Ana' }

  assert.equal(C.acoesDeAtendente(livre, { usuarioId: 'u1', podeAtender: true }).assumir, true)
  assert.equal(C.acoesDeAtendente(alheia, { usuarioId: 'u1', podeAtender: true }).assumir, false)
  // Devolver o proprio NAO exige capacidade de transferir: quem pegou pode largar.
  assert.equal(C.acoesDeAtendente(minha, { usuarioId: 'u1', podeAtender: true, podeTransferir: false }).devolver, true)
  assert.equal(C.acoesDeAtendente(alheia, { usuarioId: 'u1', podeAtender: true, podeTransferir: false }).devolver, false)
  // Transferir a de outra pessoa exige a capacidade de ver a Central inteira.
  assert.equal(C.acoesDeAtendente(alheia, { usuarioId: 'u1', podeTransferir: true }).transferir, true)
  assert.equal(C.acoesDeAtendente(alheia, { usuarioId: 'u1', podeTransferir: false }).transferir, false)
  // Atribuir a que nao tem dono e' transferencia tambem.
  assert.equal(C.acoesDeAtendente(livre, { usuarioId: 'u1', podeTransferir: true }).atribuir, true)
})

test('quando o botao de assumir nao aparece, ha MOTIVO em texto', () => {
  const alheia = { responsavel_id: 'u2', responsavel_nome: 'Ana Paula' }
  const r = C.acoesDeAtendente(alheia, { usuarioId: 'u1', podeAtender: true })
  // O nome entra COMO ESTA — normalizar destruiria nome proprio.
  assert.match(r.motivoSemAssumir, /Ana Paula/)
  assert.equal(C.acoesDeAtendente({ responsavel_id: 'u1' }, { usuarioId: 'u1', podeAtender: true }).motivoSemAssumir,
    'Esta conversa já é sua.')
  assert.match(C.acoesDeAtendente({ responsavel_id: null }, { usuarioId: 'u1', podeAtender: false }).motivoSemAssumir,
    /não pode assumir/)
  // Quando PODE, nao ha motivo.
  assert.equal(C.acoesDeAtendente({ responsavel_id: null }, { usuarioId: 'u1', podeAtender: true }).motivoSemAssumir, '')
})

// ─── Histórico ───────────────────────────────────────────────────────────────────────────

test('o historico usa os nomes que o backend devolve, e nunca o id', () => {
  assert.equal(C.descreverMudancaDeAtendente({ acao: 'assumiu', responsavel_novo_nome: 'Bia' }).rotulo, 'Bia assumiu')
  assert.equal(C.descreverMudancaDeAtendente({ acao: 'liberou', responsavel_anterior_nome: 'Bia' }).rotulo,
    'Bia devolveu para a fila')
  assert.match(C.descreverMudancaDeAtendente({
    acao: 'transferiu', responsavel_anterior_nome: 'Bia', responsavel_novo_nome: 'Caio',
  }).rotulo, /de Bia para Caio/)
  assert.equal(C.descreverMudancaDeAtendente({ acao: 'atribuiu', responsavel_novo_nome: 'Caio' }).rotulo, 'Atribuída a Caio')
  assert.equal(C.descreverMudancaDeAtendente(null).rotulo, '—')
})

test('guarda: a tela NAO reimplementa o recorte do servidor', () => {
  // A regra de quem ve o que vive em services/conversa-responsavel.js. Aqui so se traduz.
  const fonte = fs.readFileSync(path.join(__dirname, 'conversa-operacao.js'), 'utf8')
  assert.ok(!/responsavel_id\s*IS\s*NULL/i.test(fonte), 'SQL nao pode aparecer no front')
  assert.ok(!/CONVERSA_VER_TODAS/.test(fonte), 'a matriz de capacidades nao vaza para o front')
})
