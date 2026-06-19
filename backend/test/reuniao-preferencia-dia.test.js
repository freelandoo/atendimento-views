'use strict'

// Regressao: lead recebe oferta de horario HOJE e responde "So amanha". O bot
// deve FLEXIBILIZAR — reconsultar a agenda a partir de amanha e re-ofertar
// horarios concretos ("Tenho amanha as 19:30 ou 19:45"), em vez de re-ofertar
// hoje OU cair no convite generico sem dia/horario.
//
// Cobre as 3 camadas do fix:
//   1. Orquestrador detecta preferencia de dia ('outro_dia') e mantem a rota
//      consultar_agenda.
//   2. Agenda (buscarSlotsDisponiveis) respeita incluirHoje:false — pula hoje e
//      sugere amanha.
//   3. Validador nao barra a re-oferta como "mensagem_repetida" quando o lead
//      pediu outro dia.

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  decidirProximaAcao,
  extrairDadosMensagem,
  extrairPreferenciaDia,
} = require('../src/next-action-orchestrator')
const { validarRespostaPorAcao } = require('../src/action-response-validator')

// Stub do pool ANTES de requerer a agenda: sem eventos, todos os slots livres.
const db = require('../src/db')
db.pool.query = async () => ({ rows: [] })
const { buscarSlotsDisponiveis } = require('../src/agenda')

// 2026-05-27 e uma quarta-feira; 19:00 (SP) cai dentro da janela de reuniao.
const QUARTA_19H = new Date('2026-05-27T19:00:00-03:00')

// ─── Camada 1: orquestrador ─────────────────────────────────────────────────

test('extrairPreferenciaDia: "So amanha" => outro_dia; "hoje" => hoje', () => {
  assert.equal(extrairPreferenciaDia('Só amanhã'), 'outro_dia')
  assert.equal(extrairPreferenciaDia('semana que vem'), 'outro_dia')
  assert.equal(extrairPreferenciaDia('hoje nao, so amanha'), 'outro_dia')
  assert.equal(extrairPreferenciaDia('pode ser hoje'), 'hoje')
  assert.equal(extrairPreferenciaDia('19:45'), null)
})

test('extrairDadosMensagem inclui preferencia_dia', () => {
  assert.equal(extrairDadosMensagem('Só amanhã').preferencia_dia, 'outro_dia')
})

test('"So amanha" mantem rota consultar_agenda e carrega preferencia_dia', () => {
  const historico = [
    { role: 'user', content: 'quero um site' },
    { role: 'assistant', content: 'em qual cidade?' },
    { role: 'user', content: 'Curitiba' },
    { role: 'assistant', content: 'como seus clientes te encontram?' },
    { role: 'user', content: 'telefone' },
    { role: 'assistant', content: 'Tenho hoje às 19:30 ou 19:45. Qual fica melhor?' },
    { role: 'user', content: 'Só amanhã' },
  ]
  const d = decidirProximaAcao({
    mensagemAtual: 'Só amanhã',
    historico: [...historico, { role: 'assistant', content: '...' }], // >= 8
    perfil: { negocio: 'topografia', cidade: 'Curitiba', necessidade: 'site', origem_clientes: 'telefone' },
    etapaAtual: 'agendamento_pendente',
  })
  assert.equal(d.acao_decidida, 'consultar_agenda')
  assert.equal(d.dados_extraidos.preferencia_dia, 'outro_dia')
})

// ─── Camada 2: agenda ───────────────────────────────────────────────────────

test('buscarSlotsDisponiveis incluirHoje:false pula hoje e sugere amanha', async () => {
  const hoje = await buscarSlotsDisponiveis({ dataInicial: QUARTA_19H })
  const outroDia = await buscarSlotsDisponiveis({ dataInicial: QUARTA_19H, incluirHoje: false })
  assert.equal(hoje.data_label, 'hoje')
  assert.equal(outroDia.data_label, 'amanha')
  // Os horarios concretos continuam vindo da agenda real (nao some o dia/hora):
  assert.ok(outroDia.horarios_sugeridos.length > 0)
})

// ─── Camada 3: validador ────────────────────────────────────────────────────

function contextoReoferta(mensagemAtual) {
  const oferta = 'Tenho amanhã às 19:30 ou 19:45 disponíveis. Qual fica melhor?'
  return {
    resultado: { mensagens_bolhas: [oferta] },
    contexto: {
      decisao: { acao_decidida: 'convite_reuniao', etapa_sugerida: 'agendamento_pendente' },
      etapaAtual: 'agendamento_pendente',
      mensagemAtual,
      horarios_disponiveis: ['19:30', '19:45'],
      // Historico com a MESMA oferta no turno anterior => repeticao textual.
      historico: [
        { role: 'assistant', content: 'Tenho amanhã às 19:30 ou 19:45 disponíveis. Qual fica melhor?' },
        { role: 'user', content: mensagemAtual },
      ],
      perfil: { negocio: 'topografia', cidade: 'Curitiba', horarios_oferecidos: ['19:30', '19:45'] },
    },
  }
}

test('re-oferta apos "So amanha" NAO e barrada como repeticao', () => {
  const { resultado, contexto } = contextoReoferta('Só amanhã')
  const out = validarRespostaPorAcao(resultado, contexto)
  assert.equal(out.bloqueado, false)
  assert.match(out.resultado.mensagem_pro_lead, /19:30/)
  assert.match(out.resultado.mensagem_pro_lead, /amanh/i)
})

test('controle: mesma re-oferta repetida SEM preferencia de dia E barrada', () => {
  const { resultado, contexto } = contextoReoferta('ok')
  const out = validarRespostaPorAcao(resultado, contexto)
  assert.equal(out.bloqueado, true)
  assert.ok(out.erros.some((e) => String(e.erro || e).startsWith('mensagem_repetida')))
})
