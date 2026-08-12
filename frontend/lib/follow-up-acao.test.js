'use strict'

// Vocabulário e apresentação da próxima ação + a mesclagem da terceira fonte na fila única.
//
// O que estes testes protegem, em uma frase: a decisão de uma PESSOA vence a recomendação
// CALCULADA, e o mesmo contato nunca aparece duas vezes por causa disso.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const A = require('./follow-up-acao')
const { montarFila, aplicarFiltroRapido, aplicarAvancado, contagensRapidas, opcoesDeAcao, opcoesDeResponsavel, VIEW_PADRAO } = require('./followups-fila')

const AGORA = new Date('2026-08-08T12:00:00-03:00')

function followUp(extra = {}) {
  return {
    id: 'fu-1',
    canal: 'whatsapp',
    proxima_acao: 'Retomar por WhatsApp',
    agendado_para: '2026-08-09T10:00:00-03:00',
    prioridade: 'alta',
    status: 'aguardando',
    origem: 'ligacao',
    telefone_digitos: '5511999990001',
    responsavel_id: null,
    responsavel_nome: null,
    ligacao_id: 'lig-1',
    ligacao_resultado: 'atendeu',
    ligacao_em: '2026-08-08T09:30:00-03:00',
    campanha_lead_id: 'cl-1',
    campanha_nome: 'Nail designers SP',
    prospect_id: 'p-1',
    conversa_numero: '5511999990001@s.whatsapp.net',
    observacao: null,
    resultado_nota: null,
    concluido_em: null,
    criado_em: '2026-08-08T09:35:00-03:00',
    nome: 'Studio Bela',
    cidade: 'São Paulo',
    ...extra,
  }
}

function humano(extra = {}) {
  return {
    numero: '5511999990001@s.whatsapp.net',
    telefone_digitos: '5511999990001',
    nome: 'Studio Bela',
    negocio: 'Studio Bela',
    cidade: 'São Paulo',
    estagio: 'qualificacao',
    dias_silencio: 4,
    score: 72,
    temperatura: 'morno',
    motivo: 'Pediu preço e sumiu há 4 dias',
    motivos: [],
    followups_ignorados: 1,
    escalado: false,
    acao_recomendada: 'ligar',
    acao_label: 'Ligar',
    janela_recomendada: 'hoje, no horário comercial',
    janela_quando: 'hoje',
    orientacao: 'Retome pelo preço',
    prompt_preview: null,
    ...extra,
  }
}

function auto(extra = {}) {
  return {
    id: 41,
    numero: '5511999990001@s.whatsapp.net',
    sequencia: 1,
    status: 'agendado',
    agendado_para: '2026-08-08T18:00:00-03:00',
    executado_em: null,
    cancelado_em: null,
    motivo_decisao: null,
    detectado_em: '2026-08-08T08:00:00-03:00',
    estagio: 'qualificacao',
    nome: 'Studio Bela',
    ...extra,
  }
}

// ─── Roteamento: qual tela executa ────────────────────────────────────────────

test('o canal decide a tela executora — e o e-mail executa na PRÓPRIA fila', () => {
  assert.equal(A.destinoDoCanal('whatsapp'), 'central_mensagens')
  assert.equal(A.destinoDoCanal('ligacao'), 'central_ligacoes')
  // `email` deixou de ser `null` na migration 067, junto com o executor. Não existe uma
  // "Central de E-mails": compor uma mensagem 1:1 é o que a própria fila já faz.
  assert.equal(A.destinoDoCanal('email'), 'central_follow_ups')
  assert.deepEqual(Object.keys(A.DESTINO_POR_CANAL).sort(), ['email', 'ligacao', 'whatsapp'])
})

test('o destino do front espelha `telaExecutora` do backend', () => {
  // Duas listas que precisam concordar; discordar mandaria o operador para a tela errada.
  const backend = fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'src', 'services', 'follow-up-modelo.js'), 'utf8')
  assert.match(backend, /whatsapp: 'central_mensagens'/)
  assert.match(backend, /ligacao: 'central_ligacoes'/)
  assert.match(backend, /email: 'central_follow_ups'/)
})

test('os limites do compositor espelham os do backend', () => {
  // Divergir faria o campo aceitar um texto que a rota recusaria, e o operador perderia o
  // que escreveu num 400.
  const backend = fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'src', 'services', 'followup-email.js'), 'utf8')
  const ler = (nome) => Number(backend.match(new RegExp(`const ${nome} = (\\d+)`))[1])
  assert.equal(A.LIMITE_ASSUNTO_EMAIL, ler('LIMITE_ASSUNTO'))
  assert.equal(A.LIMITE_CORPO_EMAIL, ler('LIMITE_CORPO'))
})

// ─── Prazo legível ────────────────────────────────────────────────────────────

test('prazo vira linguagem de operador: hoje, amanhã, ontem', () => {
  assert.equal(A.formatarQuando('2026-08-08T15:30:00-03:00', AGORA), 'hoje às 15:30')
  assert.equal(A.formatarQuando('2026-08-09T10:00:00-03:00', AGORA), 'amanhã às 10:00')
  assert.equal(A.formatarQuando('2026-08-07T10:00:00-03:00', AGORA), 'ontem às 10:00')
  assert.match(A.formatarQuando('2026-08-20T10:00:00-03:00', AGORA), /^20\/08 às 10:00$/)
  assert.equal(A.formatarQuando(null, AGORA), null)
})

test('atrasado só existe enquanto o item está aberto', () => {
  const passado = '2026-08-08T09:00:00-03:00'
  assert.equal(A.classificarPrazoFollowUp(passado, AGORA, true), 'atrasado')
  assert.equal(A.classificarPrazoFollowUp(passado, AGORA, false), 'hoje',
    'um item já concluído não está atrasado — está feito')
})

// ─── datetime-local ↔ ISO ─────────────────────────────────────────────────────

test('o horário do input é LOCAL e a ida-e-volta não desloca o compromisso', () => {
  // Converter errado aqui vira ligação na hora errada em produção, não bug de tela.
  const iso = '2026-08-09T10:00:00-03:00'
  const local = A.paraInputLocal(iso)
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  assert.equal(new Date(A.deInputLocal(local)).getTime(), new Date(iso).getTime())
})

// ─── Formulário da etapa "Próxima ação" ───────────────────────────────────────

test('"sem próxima ação" é resposta válida e não cria nada', () => {
  const form = { canal: 'nenhuma', proxima_acao: '', agendado_para: '' }
  assert.equal(A.validarProximaAcao(form).ok, true, 'não pode exigir campos de um compromisso que não existe')
  assert.equal(A.montarPayloadProximaAcao(form), null, 'null, não objeto vazio: o backend trata ausência como "nada a criar"')
})

test('escolhido um canal, texto e data passam a ser obrigatórios', () => {
  const r = A.validarProximaAcao({ canal: 'whatsapp', proxima_acao: '  ', agendado_para: '' })
  assert.equal(r.ok, false)
  assert.ok(r.erros.proxima_acao, 'fila sem verbo não diz o que fazer')
  assert.ok(r.erros.agendado_para)
})

test('a sugestão parte do resultado da chamada, e número inválido não sugere nada', () => {
  assert.equal(A.sugerirProximaAcao('nao_atendeu', AGORA).canal, 'ligacao')
  assert.equal(A.sugerirProximaAcao('atendeu', AGORA).canal, 'whatsapp')
  const invalido = A.sugerirProximaAcao('numero_invalido', AGORA)
  assert.equal(invalido.canal, 'nenhuma', 'não há para onde ligar nem para onde escrever')
  assert.equal(invalido.agendado_para, '')
})

test('a primeira opção do seletor é "sem próxima ação" — não um default escondido', () => {
  assert.equal(A.CANAL_OPCOES[0].valor, 'nenhuma')
})

// ─── Resumo mostrado na Central de Ligações ───────────────────────────────────

test('a Central de Ligações recebe um RESUMO, não uma fila', () => {
  const resumo = A.resumoProximaAcao(followUp(), AGORA)
  assert.equal(resumo, 'Retomar por WhatsApp — WhatsApp amanhã às 10:00')
  assert.equal(A.resumoProximaAcao(null, AGORA), null)
})

// ─── Normalização do item ─────────────────────────────────────────────────────

test('prazo futuro fica "aguardando"; prazo vencido/hoje vira trabalho "aberto"', () => {
  // É a diferença entre "tem compromisso marcado" e "precisa ser feito" — sem ela, um
  // follow-up do mês que vem disputaria o topo da fila com o trabalho de hoje.
  const futuro = A.itemDeFollowUp(followUp({ agendado_para: '2026-09-20T10:00:00-03:00' }), AGORA)
  assert.equal(futuro.situacao, 'aguardando')
  const hoje = A.itemDeFollowUp(followUp({ agendado_para: '2026-08-08T09:00:00-03:00' }), AGORA)
  assert.equal(hoje.situacao, 'aberto')
  assert.equal(hoje.prazo_quando, 'atrasado')
})

test('estados terminais mapeiam para as situações da fila', () => {
  for (const [status, esperado] of [['concluido', 'concluido'], ['cancelado', 'cancelado'], ['falha', 'falha']]) {
    const i = A.itemDeFollowUp(followUp({ status, concluido_em: '2026-08-08T11:00:00-03:00' }), AGORA)
    assert.equal(i.situacao, esperado)
  }
})

test('falha nunca é apresentada como aguardando', () => {
  const i = A.itemDeFollowUp(followUp({ status: 'falha', concluido_em: '2026-08-08T11:00:00-03:00' }), AGORA)
  assert.notEqual(i.situacao, 'aguardando')
  assert.equal(i.situacao, 'falha')
})

test('o contexto de origem explica POR QUE a ação existe, sem virar requisição', () => {
  const item = { ...A.itemDeFollowUp(followUp(), AGORA), followup_id: 'fu-1' }
  const ctx = A.contextoDeOrigem(item, AGORA)
  assert.equal(ctx.titulo, 'Follow-up por WhatsApp')
  assert.ok(ctx.linhas.some((l) => /Veio da ligação/.test(l)))
  assert.ok(ctx.linhas.some((l) => /Prazo:/.test(l)))
  assert.equal(A.contextoDeOrigem({ followup_id: null }, AGORA), null)
})

// ─── Mesclagem na fila única ──────────────────────────────────────────────────

test('follow-up registrado vence a recomendação: UMA linha, não duas', () => {
  const fila = montarFila({ humanos: [humano()], followups: [followUp()], agora: AGORA })
  assert.equal(fila.length, 1, 'o mesmo contato não pode ocupar duas linhas da fila')
  assert.equal(fila[0].id, 'fu:fu-1', 'quem manda é a decisão registrada por uma pessoa')
  assert.equal(fila[0].acao_label, 'Retomar por WhatsApp')
  assert.equal(fila[0].motivo, 'Pediu preço e sumiu há 4 dias',
    'a recomendação heurística não some: vira o "por que agora" do item')
  assert.equal(fila[0].prioridade_score, 72, 'o call score continua disponível como apoio')
})

test('o agendamento do motor também não vira segunda linha', () => {
  const fila = montarFila({ humanos: [humano()], automaticos: [auto()], followups: [followUp()], agora: AGORA })
  assert.equal(fila.length, 1)
  assert.equal(fila[0].ia_agendada, true, 'o automático continua visível como contexto')
  assert.equal(fila[0].ia_status, 'agendado')
})

test('sem follow-up registrado, a fila se comporta exatamente como antes', () => {
  const fila = montarFila({ humanos: [humano()], automaticos: [auto()], agora: AGORA })
  assert.equal(fila.length, 1)
  assert.equal(fila[0].id, 'humano:5511999990001@s.whatsapp.net')
  assert.equal(fila[0].canal, null, 'item derivado não recebe canal presumido')
  assert.equal(fila[0].followup_id, null)
})

test('dois canais abertos para o mesmo contato são DOIS trabalhos', () => {
  // "Ligar na sexta" e "mandar mensagem amanhã" são feitos em telas diferentes; juntá-los
  // esconderia um dos dois.
  const fila = montarFila({
    followups: [followUp(), followUp({ id: 'fu-2', canal: 'ligacao', proxima_acao: 'Ligar na sexta' })],
    agora: AGORA,
  })
  assert.equal(fila.length, 2)
  assert.deepEqual(fila.map((i) => i.canal).sort(), ['ligacao', 'whatsapp'])
})

test('follow-up sem conversa ainda entra na fila (lead que só foi ligado)', () => {
  const fila = montarFila({ followups: [followUp({ conversa_numero: null })], agora: AGORA })
  assert.equal(fila.length, 1)
  assert.equal(fila[0].numero, null, 'sem JID a tela oferece iniciar, em vez de abrir conversa que não há')
  assert.equal(fila[0].telefone_digitos, '5511999990001', 'a identidade do contato continua íntegra')
})

test('a linha nunca mostra o identificador técnico do Evolution', () => {
  const fila = montarFila({ followups: [followUp({ nome: null })], agora: AGORA })
  assert.doesNotMatch(fila[0].rotulo, /@s\.whatsapp\.net/)
  assert.match(fila[0].rotulo, /\d/, 'sem nome, o fallback é o telefone formatado')
})

// ─── Filtros ──────────────────────────────────────────────────────────────────

test('filtros rápidos por canal só alcançam item que tem canal escolhido', () => {
  const fila = montarFila({
    humanos: [humano({ numero: '5511888880002@s.whatsapp.net', telefone_digitos: '5511888880002' })],
    followups: [followUp()],
    agora: AGORA,
  })
  assert.equal(aplicarFiltroRapido(fila, 'whatsapp').length, 1)
  assert.equal(aplicarFiltroRapido(fila, 'ligacao').length, 0)
  assert.equal(aplicarFiltroRapido(fila, 'todos').length, 2)
})

test('filtro por origem da ação e por responsável não atribuído', () => {
  const comDono = followUp({ id: 'fu-3', canal: 'ligacao', responsavel_id: 'u-1', responsavel_nome: 'Ana' })
  const fila = montarFila({ followups: [followUp(), comDono], agora: AGORA })
  assert.equal(aplicarAvancado(fila, { ...VIEW_PADRAO, origemAcao: 'ligacao' }).length, 2)
  assert.equal(aplicarAvancado(fila, { ...VIEW_PADRAO, origemAcao: 'manual' }).length, 0)
  assert.equal(aplicarAvancado(fila, { ...VIEW_PADRAO, responsavel: 'sem' }).length, 1)
  assert.equal(aplicarAvancado(fila, { ...VIEW_PADRAO, responsavel: 'u-1' })[0].responsavel_nome, 'Ana')
})

test('o seletor de responsável sai dos itens presentes, com "não atribuído" na frente', () => {
  const fila = montarFila({
    followups: [followUp(), followUp({ id: 'fu-4', canal: 'ligacao', responsavel_id: 'u-1', responsavel_nome: 'Ana' })],
    agora: AGORA,
  })
  const ops = opcoesDeResponsavel(fila)
  assert.equal(ops[0].valor, 'sem')
  assert.deepEqual(ops.map((o) => o.label), ['Não atribuído', 'Ana'])
})

test('o filtro "Ação" usa rótulo ESTÁVEL, não o texto livre da linha', () => {
  const fila = montarFila({
    followups: [followUp(), followUp({ id: 'fu-5', proxima_acao: 'Mandar o orçamento revisado' })],
    agora: AGORA,
  })
  const ops = opcoesDeAcao(fila)
  const whats = ops.find((o) => o.valor === 'followup_whatsapp')
  assert.equal(whats.label, 'Follow-up por WhatsApp',
    'texto livre como opção de seletor produziria uma lista diferente a cada carga da fila')
})

test('concluídos e cancelados saem de "Todos" e ficam nos próprios filtros', () => {
  const fila = montarFila({
    followups: [
      followUp(),
      followUp({ id: 'fu-6', canal: 'ligacao', status: 'concluido', concluido_em: '2026-08-08T11:00:00-03:00' }),
    ],
    agora: AGORA,
  })
  const c = contagensRapidas(fila)
  assert.equal(c.todos, 1, 'trabalho já feito não pode afogar a fila')
  assert.equal(c.concluidos, 1)
})

// ─── Disponibilidade de canal do CONTATO (migration 066) ─────────────────────
//
// A regra que estes testes protegem: "ninguém verificou" (`null`) NÃO é "não tem" (`false`).
// A tela nunca deduz indisponibilidade, e nunca regrava um veredito que não mudou.

test('o veredito do backend chega ao item da fila em TRÊS estados', () => {
  const naoVerificado = montarFila({ followups: [followUp()], agora: AGORA })[0]
  assert.equal(naoVerificado.whatsapp_disponivel, null,
    'campo ausente na API é "ninguém verificou" — jamais `false`')

  const semWhats = montarFila({
    followups: [followUp({ canal: 'ligacao', whatsapp_disponivel: false, whatsapp_motivo: 'só fixo' })],
    agora: AGORA,
  })[0]
  assert.equal(semWhats.whatsapp_disponivel, false)
  assert.equal(semWhats.whatsapp_motivo, 'só fixo')

  const temWhats = montarFila({ followups: [followUp({ whatsapp_disponivel: true })], agora: AGORA })[0]
  assert.equal(temWhats.whatsapp_disponivel, true)
})

test('item DERIVADO (sem follow-up registrado) fica sem veredito, nunca com `false`', () => {
  // Não há fonte: presumir indisponibilidade num item que ninguém marcou seria inventar a
  // verificação — o mesmo defeito, do outro lado.
  const fila = montarFila({ humanos: [humano()], agora: AGORA })
  assert.equal(fila[0].whatsapp_disponivel, null)
})

test('a tela só acende o aviso com marcação EXPLÍCITA de indisponibilidade', () => {
  assert.equal(A.canalDescartadoPeloOperador({ canal: 'whatsapp', whatsapp_disponivel: false }), true)
  assert.equal(A.canalDescartadoPeloOperador({ canal: 'whatsapp', whatsapp_disponivel: null }), false)
  assert.equal(A.canalDescartadoPeloOperador({ canal: 'whatsapp', whatsapp_disponivel: true }), false)
  assert.equal(A.canalDescartadoPeloOperador({ canal: 'ligacao', whatsapp_disponivel: false }), false,
    'item que já é de ligação não está num canal descartado')
  assert.equal(A.canalDescartadoPeloOperador(null), false)
})

test('o rótulo distingue os três estados — "não verificado" não vira "não tem"', () => {
  assert.equal(A.rotuloDisponibilidadeWhatsapp(true), 'Tem WhatsApp')
  assert.equal(A.rotuloDisponibilidadeWhatsapp(false), 'Sem WhatsApp')
  assert.equal(A.rotuloDisponibilidadeWhatsapp(null), 'WhatsApp não verificado')
  assert.equal(A.rotuloDisponibilidadeWhatsapp(undefined), 'WhatsApp não verificado')
})

test('desmarcar é DESFAZER quando já havia marcação, e silêncio quando não havia', () => {
  assert.equal(A.alternarSemWhatsapp(null, true), false, 'marcar afirma "não tem"')
  assert.equal(A.alternarSemWhatsapp(false, false), true,
    'quem já estava marcado como sem WhatsApp desmarca para DESFAZER — é uma afirmação nova')
  assert.equal(A.alternarSemWhatsapp(null, false), null,
    'quem nunca foi verificado volta a "não verificado": desmarcar não registra verificação')
  assert.equal(A.alternarSemWhatsapp(true, false), true, 'continua o que o operador já afirmara')
})

test('o payload só carrega disponibilidade quando o veredito MUDOU nesta tela', () => {
  // Reenviar o mesmo valor gravaria `marcado_por`/`marcado_em` novos e uma linha de auditoria
  // a cada reagendamento — passaria a parecer que alguém reverificou o contato toda vez que
  // mexeu na data.
  assert.deepEqual(A.patchDisponibilidade(null, null), {})
  assert.deepEqual(A.patchDisponibilidade(false, false, 'só fixo'), {})
  assert.deepEqual(A.patchDisponibilidade(true, true), {})
  assert.deepEqual(A.patchDisponibilidade(null, false), { whatsapp_disponivel: false })
  assert.deepEqual(A.patchDisponibilidade(false, true), { whatsapp_disponivel: true })
})

test('o motivo acompanha só a marcação de indisponibilidade', () => {
  assert.deepEqual(A.patchDisponibilidade(null, false, '  só fixo  '),
    { whatsapp_disponivel: false, disponibilidade_motivo: 'só fixo' })
  assert.deepEqual(A.patchDisponibilidade(null, false, '   '), { whatsapp_disponivel: false },
    'motivo em branco não vira nota vazia no banco')
  assert.deepEqual(A.patchDisponibilidade(false, true, 'ele confirmou'), { whatsapp_disponivel: true },
    'explicar por que um contato TEM WhatsApp não é informação que alguém vá procurar depois')
})

test('o estado inicial do controle espelha o backend, sem palpite da tela', () => {
  assert.equal(A.estadoDisponibilidadeInicial({ whatsapp_disponivel: false }), false)
  assert.equal(A.estadoDisponibilidadeInicial({ whatsapp_disponivel: true }), true)
  assert.equal(A.estadoDisponibilidadeInicial({}), null)
  assert.equal(A.estadoDisponibilidadeInicial(null), null)
})

test('a tela NAO reimplementa a regra de canal — quem troca é o backend', () => {
  // Guarda de regressão: o módulo de apresentação não pode decidir canal a partir da
  // disponibilidade. O canal que vale é sempre o que volta na resposta do reagendamento.
  //
  // O `=(?!=)` restringe a guarda ao que ela sempre quis dizer: ATRIBUIR canal. Sem ele a
  // expressão também pegava `item.canal === 'email'` de `canalDescartadoPeloOperador`, que
  // só LÊ o canal do item para acender um aviso — o oposto de decidir canal.
  const fonte = fs.readFileSync(path.join(__dirname, 'follow-up-acao.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const veredito of ['whatsapp_disponivel', 'email_disponivel']) {
    assert.doesNotMatch(fonte, new RegExp(`${veredito}[\\s\\S]{0,80}canal\\s*=(?!=)`),
      'trocar canal no front criaria uma segunda regra, que divergiria da do backend')
  }
})

// ─── Canal de e-mail do contato (migration 067) ──────────────────────────────

test('o veredito de e-mail é tri-estado: `null` não é `false`', () => {
  assert.equal(A.estadoEmailInicial({ email_disponivel: true }), true)
  assert.equal(A.estadoEmailInicial({ email_disponivel: false }), false)
  assert.equal(A.estadoEmailInicial({}), null, 'ninguém verificou não é "não tem"')
  assert.equal(A.estadoEmailInicial(null), null)
  assert.equal(A.rotuloDisponibilidadeEmail(null), 'E-mail não verificado')
  assert.notEqual(A.rotuloDisponibilidadeEmail(null), A.rotuloDisponibilidadeEmail(false))
})

test('desmarcar só registra veredito quando havia um a desfazer', () => {
  // Espelha `alternarSemWhatsapp` com o sinal invertido: aqui o marcado é a afirmação
  // POSITIVA. Desmarcar o que ninguém verificou não pode registrar uma verificação que não
  // houve.
  assert.equal(A.alternarTemEmail(null, true), true)
  assert.equal(A.alternarTemEmail(true, false), false, 'desfazer confirmação é declarar que não tem')
  assert.equal(A.alternarTemEmail(null, false), null, 'não inventa verificação')
  assert.equal(A.alternarTemEmail(false, true), true)
})

test('confirmar e-mail exige endereço — canal sem destino não é canal', () => {
  assert.ok(A.emailValido('contato@empresa.com.br'))
  assert.ok(!A.emailValido(''))
  assert.ok(!A.emailValido('sem-arroba.com'))
  assert.ok(!A.emailValido('a@b'), 'domínio sem ponto não é endereço')
  assert.ok(!A.emailValido('a b@c.com'), 'espaço no endereço')
  assert.ok(!A.emailValido('a@c.com\nBcc: x@y.com'), 'quebra de linha seria injeção de cabeçalho')
})

test('o patch de e-mail só sai quando o operador MUDOU alguma coisa', () => {
  // Reenviar o mesmo veredito gravaria `marcado_por`/`marcado_em` novos e uma linha de
  // auditoria a cada mexida na data — pareceria que alguém reverificou o contato toda vez.
  assert.deepEqual(A.patchEmailDisponibilidade(null, null, '', '', ''), {})
  assert.deepEqual(A.patchEmailDisponibilidade(true, true, 'a@b.com', 'a@b.com', ''), {},
    'mesmo veredito e mesmo endereço não é mudança')
  assert.deepEqual(A.patchEmailDisponibilidade(null, true, 'A@B.com', '', ''),
    { email_disponivel: true, email_endereco: 'a@b.com' })
  assert.deepEqual(A.patchEmailDisponibilidade(true, true, 'novo@b.com', 'a@b.com', ''),
    { email_disponivel: true, email_endereco: 'novo@b.com' }, 'trocar o destino é mudança')
  assert.deepEqual(A.patchEmailDisponibilidade(true, false, '', 'a@b.com', 'voltou'),
    { email_disponivel: false, email_motivo: 'voltou' }, 'negar não carrega destino')
  assert.deepEqual(A.patchEmailDisponibilidade(null, true, 'a@b.com', '', 'confirmou'),
    { email_disponivel: true, email_endereco: 'a@b.com' },
    'explicar por que um contato TEM e-mail não é informação que alguém vá procurar depois')
})

test('a consequência anunciada segue a ordem WhatsApp → e-mail confirmado → ligação', () => {
  // É o salto que a Decisão 4 deixou declarado e que a migration 067 passou a permitir.
  assert.equal(A.avisoDaTrocaDeCanal({ canal: 'whatsapp', semWhatsapp: true, emailConfirmado: 'a@b.com' }),
    A.AVISO_TROCA_PARA_EMAIL)
  assert.equal(A.avisoDaTrocaDeCanal({ canal: 'whatsapp', semWhatsapp: true, emailConfirmado: '' }),
    A.AVISO_TROCA_PARA_LIGACAO, 'sem e-mail confirmado o destino continua sendo a ligação')
  assert.equal(A.avisoDaTrocaDeCanal({ canal: 'whatsapp', semWhatsapp: false, emailConfirmado: 'a@b.com' }), null)
  assert.equal(A.avisoDaTrocaDeCanal({ canal: 'ligacao', semWhatsapp: true, emailConfirmado: 'a@b.com' }), null,
    'num item que já é de ligação a marcação vale como fato do contato, mas não move trabalho')
  assert.equal(A.avisoDaTrocaDeCanal({}), null)
})

test('o aviso de canal descartado acende para o canal do próprio item', () => {
  assert.ok(A.canalDescartadoPeloOperador({ canal: 'email', email_disponivel: false }))
  assert.ok(!A.canalDescartadoPeloOperador({ canal: 'email', email_disponivel: null }))
  assert.ok(!A.canalDescartadoPeloOperador({ canal: 'email', whatsapp_disponivel: false }),
    'o veredito de WhatsApp não descarta um item que já é de e-mail')
  assert.ok(A.canalDescartadoPeloOperador({ canal: 'whatsapp', whatsapp_disponivel: false }))
  assert.ok(!A.canalDescartadoPeloOperador({ canal: 'ligacao', whatsapp_disponivel: false }))
})
