'use strict'
// ORIENTAÇÃO COMERCIAL POR NICHO — seleção da oferta, composição do prompt da 1ª abordagem e
// continuidade (resposta do lead + follow-up). Cobre os defeitos corrigidos em 2026-10-22.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  selecionarOfertaAbordagem,
  montarEstrategiaAbordagem,
  montarPromptContratoAbordagem,
  snapshotOrientacaoAbordagem,
  blocoOrientacaoOrigem,
  MOTIVO_OFERTA,
} = require('../src/services/abordagem-inicial-contrato')

const SRC = path.join(__dirname, '..', 'src')
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

function cfg(ofertas, extra = {}) {
  return [
    '[ABORDAGEM_IA_CONFIG]',
    JSON.stringify({ idiomaAutomatico: true, ofertas, ...extra }),
    '[/ABORDAGEM_IA_CONFIG]',
  ].join('\n')
}

const CRM_SOLAR = { id: 'solar', nome: 'Estrutura comercial com CRM', descricao: 'CRM com controle de leads, propostas e follow-up para integradores', nicho: 'energia solar', ativo: true, sitePronto: false }
const SITE_PADARIA = { id: 'padaria', nome: 'Site de delivery', descricao: 'Site com cardapio e pedido pelo WhatsApp', nicho: 'padaria', ativo: true }
const GERAL = { id: 'geral', nome: 'Presenca digital completa', descricao: 'Site institucional', geral: true, ativo: true }

// ─── 1. Energia solar com oferta especifica (CRM) ────────────────────────────
test('caso 1: energia solar recebe a oferta especifica de CRM, nao a geral', () => {
  const out = selecionarOfertaAbordagem(cfg([GERAL, SITE_PADARIA, CRM_SOLAR]), { nicho: 'Energia Solar' })
  assert.equal(out.oferta.id, 'solar')
  assert.equal(out.motivo, MOTIVO_OFERTA.ESPECIFICA)
  assert.doesNotMatch(out.instrucoes, /Presenca digital completa|Site de delivery/)
  // A oferta de CRM nao pode ser reduzida a "presenca digital".
  assert.match(out.instrucoes, /controlar leads, acompanhar o funil/)
})

// ─── 2. Outro nicho com oferta especifica diferente ──────────────────────────
test('caso 2: outro nicho recebe a oferta DELE (mesma config, lead diferente)', () => {
  const out = selecionarOfertaAbordagem(cfg([GERAL, SITE_PADARIA, CRM_SOLAR]), { nicho: 'padaria' })
  assert.equal(out.oferta.id, 'padaria')
  assert.doesNotMatch(out.instrucoes, /Estrutura comercial com CRM/)
})

// ─── 3. Sem oferta especifica → geral ────────────────────────────────────────
test('caso 3: nicho sem oferta propria cai na oferta geral ativa', () => {
  const out = selecionarOfertaAbordagem(cfg([GERAL, CRM_SOLAR]), { nicho: 'barbearia' })
  assert.equal(out.oferta.id, 'geral')
  assert.equal(out.motivo, MOTIVO_OFERTA.GERAL)
})

// ─── 4. Sem especifica E sem geral → NENHUMA (o defeito corrigido) ───────────
test('caso 4: sem oferta do nicho e sem geral, NAO usa oferta de outro nicho', () => {
  const out = selecionarOfertaAbordagem(cfg([CRM_SOLAR, SITE_PADARIA]), { nicho: 'barbearia' })
  assert.equal(out.oferta, null)
  assert.equal(out.motivo, MOTIVO_OFERTA.SEM_CORRESPONDENCIA)
  assert.doesNotMatch(out.instrucoes, /Estrutura comercial com CRM|Site de delivery/)
  assert.match(out.instrucoes, /PROIBIDO usar a oferta configurada para outro nicho/)
})

test('caso 4b: o prompt da 1a abordagem manda abordar consultivo e proibe afirmar oferta pronta', () => {
  const estrategia = montarEstrategiaAbordagem({ nome: 'Barbearia Z', nicho: 'barbearia' })
  const p = montarPromptContratoAbordagem({
    estrategia,
    dadosLead: { nome: 'Barbearia Z', nicho: 'barbearia' },
    instrucoes: cfg([CRM_SOLAR, SITE_PADARIA]),
  })
  assert.equal(p.oferta_abordagem, null)
  assert.equal(p.aviso_site_pronto, false)
  assert.equal(p.motivo_oferta, MOTIVO_OFERTA.SEM_CORRESPONDENCIA)
  assert.match(p.userPrompt, /Nao assuma o carro-chefe/)
  assert.doesNotMatch(p.userPrompt, /Estrutura comercial com CRM/)
})

// ─── 5. Oferta especifica INATIVA ────────────────────────────────────────────
test('caso 5: oferta especifica inativa nao e selecionada (cai na geral)', () => {
  const out = selecionarOfertaAbordagem(cfg([GERAL, { ...CRM_SOLAR, ativo: false }]), { nicho: 'energia solar' })
  assert.equal(out.oferta.id, 'geral')
})

test('caso 5b: unica oferta do nicho inativa e sem geral = nenhuma oferta', () => {
  const out = selecionarOfertaAbordagem(cfg([{ ...CRM_SOLAR, ativo: false }, SITE_PADARIA]), { nicho: 'energia solar' })
  assert.equal(out.oferta, null)
  assert.equal(out.motivo, MOTIVO_OFERTA.SEM_CORRESPONDENCIA)
})

// ─── 6. Nicho ausente, ambiguo e concorrente ─────────────────────────────────
test('caso 6a: lead SEM nicho nao escolhe oferta especifica arbitraria', () => {
  const out = selecionarOfertaAbordagem(cfg([CRM_SOLAR, SITE_PADARIA]), { nome: 'Negocio sem nicho' })
  assert.equal(out.oferta, null)
  assert.equal(out.motivo, MOTIVO_OFERTA.SEM_CORRESPONDENCIA)
})

test('caso 6b: correspondencia e por frase inteira — "sol" nao casa "solar"', () => {
  const out = selecionarOfertaAbordagem(cfg([{ ...CRM_SOLAR, nicho: 'sol' }]), { nicho: 'energia solar' })
  assert.equal(out.oferta, null)
})

test('caso 6c: a oferta pode ser mais generica que o lead, nunca mais especifica', () => {
  // oferta "energia solar" casa lead "energia solar fotovoltaica"
  const ok = selecionarOfertaAbordagem(cfg([CRM_SOLAR]), { nicho: 'energia solar fotovoltaica' })
  assert.equal(ok.oferta.id, 'solar')
  // oferta "energia solar residencial" NAO captura o lead generico "energia solar"
  const nao = selecionarOfertaAbordagem(cfg([{ ...CRM_SOLAR, nicho: 'energia solar residencial' }]), { nicho: 'energia solar' })
  assert.equal(nao.oferta, null)
})

test('caso 6d: duas ofertas concorrentes — desempate DETERMINISTICO pela mais especifica', () => {
  const ampla = { id: 'ampla', nome: 'A ampla', nicho: 'energia solar', ativo: true }
  const estrita = { id: 'estrita', nome: 'B estrita', nicho: 'energia solar fotovoltaica', ativo: true }
  const lead = { nicho: 'energia solar fotovoltaica' }
  // ordem igual nos dois sentidos: a escolha nao depende da ordem do array
  assert.equal(selecionarOfertaAbordagem(cfg([ampla, estrita]), lead).oferta.id, 'estrita')
  assert.equal(selecionarOfertaAbordagem(cfg([estrita, ampla]), lead).oferta.id, 'estrita')
})

test('caso 6e: a PROCEDENCIA da coleta nao e nicho (oferta "instagram" nao captura lead do Instagram)', () => {
  const out = selecionarOfertaAbordagem(
    cfg([{ id: 'ig', nome: 'Pacote Instagram', nicho: 'instagram', ativo: true }]),
    { nicho: 'padaria', fonte: 'instagram', origem: 'instagram' }
  )
  assert.equal(out.oferta, null)
})

// ─── 7. Contexto geral com informacao comercial concorrente ──────────────────
test('caso 7: a oferta do nicho vence o carro-chefe do conhecimento e da etapa do playbook', () => {
  const estrategia = montarEstrategiaAbordagem({ nome: 'Solar X', nicho: 'energia solar', tem_site: false })
  const p = montarPromptContratoAbordagem({
    estrategia,
    dadosLead: { nome: 'Solar X', nicho: 'energia solar' },
    conhecimento: 'A empresa vende SITES institucionais a partir de R$200.',
    orientacaoEtapa: 'No primeiro contato, ofereca sempre o site institucional.',
    instrucoes: cfg([GERAL, CRM_SOLAR]),
  })
  // o conhecimento e a etapa continuam no prompt (fatos/tom/conducao)...
  assert.match(p.userPrompt, /CONHECIMENTO DA EMPRESA/)
  assert.match(p.userPrompt, /ORIENTACAO DA ETAPA "PRIMEIRO CONTATO"/)
  // ...mas a UNICA oferta comercial e a do nicho, e a precedencia esta dita.
  assert.equal(p.oferta_abordagem.id, 'solar')
  assert.match(p.userPrompt, /Use somente essa oferta/)
  assert.match(p.userPrompt, /quem manda e' a OFERTA SELECIONADA/)
})

// ─── 8/9. Continuidade: resposta do lead e follow-up ─────────────────────────
test('caso 8: o snapshot congela a oferta usada, com as fontes da composicao', () => {
  const sel = selecionarOfertaAbordagem(cfg([GERAL, CRM_SOLAR]), { nicho: 'energia solar' })
  const snap = snapshotOrientacaoAbordagem(sel, { contextoId: 'ctx-1', temEtapa: true, origemEnvio: 'banco_leads' })
  assert.equal(snap.oferta.id, 'solar')
  assert.equal(snap.oferta.geral, false)
  assert.equal(snap.motivo, MOTIVO_OFERTA.ESPECIFICA)
  assert.equal(snap.contexto_id, 'ctx-1')
  assert.equal(snap.etapa_playbook, 'primeiro_contato')
  assert.ok(snap.registrado_em)
})

test('caso 9: o bloco de continuidade proibe trocar de oferta', () => {
  const sel = selecionarOfertaAbordagem(cfg([GERAL, CRM_SOLAR]), { nicho: 'energia solar' })
  const bloco = blocoOrientacaoOrigem(snapshotOrientacaoAbordagem(sel, {}))
  assert.match(bloco, /Estrutura comercial com CRM/)
  assert.match(bloco, /Nao troque para a oferta geral nem para a oferta de outro nicho/)
  // sitePronto=false: nao pode afirmar material pronto na continuacao
  assert.match(bloco, /nao afirme que existe algo pronto/)
})

// ─── 10/11. A configuracao muda DEPOIS da abordagem ──────────────────────────
test('caso 10/11: snapshot e COPIA — apagar/editar a oferta nao reescreve a conversa', () => {
  const sel = selecionarOfertaAbordagem(cfg([CRM_SOLAR]), { nicho: 'energia solar' })
  const snap = snapshotOrientacaoAbordagem(sel, {})
  // o operador troca tudo na tela depois
  const depois = selecionarOfertaAbordagem(cfg([{ id: 'novo', nome: 'Outra coisa', geral: true, ativo: true }]), { nicho: 'energia solar' })
  assert.equal(depois.oferta.id, 'novo')
  // a conversa ja iniciada continua na oferta original
  assert.equal(snap.oferta.nome, 'Estrutura comercial com CRM')
  assert.match(blocoOrientacaoOrigem(snap), /Estrutura comercial com CRM/)
})

// ─── 12. Historico antigo sem evidencia ──────────────────────────────────────
test('caso 12: sem origem registrada o bloco e VAZIO — nao se inventa atribuicao', () => {
  assert.equal(blocoOrientacaoOrigem(null), '')
  assert.equal(blocoOrientacaoOrigem({}), '')
  assert.equal(blocoOrientacaoOrigem({ oferta: null }), '')
  assert.equal(blocoOrientacaoOrigem(snapshotOrientacaoAbordagem({ oferta: null, motivo: MOTIVO_OFERTA.SEM_ATIVA }, {})), '')
})

// ─── 13. Isolamento ──────────────────────────────────────────────────────────
test('caso 13: leitura e escrita da origem sao escopadas por empresa + numero', () => {
  const fonte = ler('db/abordagem-origem.js')
  assert.match(fonte, /WHERE empresa_id = \$1 AND numero = \$2/)
  assert.match(fonte, /INSERT INTO app\.lead_insights \(empresa_id, numero, tipo/)
  // nao existe leitura sem empresa
  assert.doesNotMatch(fonte, /FROM app\.lead_insights\s+WHERE numero/)
})

// ─── 14. Proibicao de inventar prova/urgencia/material pronto ────────────────
test('caso 14: o prompt proibe inventar e so libera "pronto" com declaracao', () => {
  const estrategia = montarEstrategiaAbordagem({ nome: 'Solar X', nicho: 'energia solar' })
  const semPronto = montarPromptContratoAbordagem({
    estrategia, dadosLead: { nicho: 'energia solar' }, instrucoes: cfg([CRM_SOLAR]),
  })
  assert.equal(semPronto.aviso_site_pronto, false)
  assert.match(semPronto.userPrompt, /nao invente faturamento, campanhas, resultados, desconto ou urgencia falsa/)
  assert.match(semPronto.userPrompt, /Nao diga que existe oferta, site, previa, estrutura, analise ou material pronto/)

  const comPronto = montarPromptContratoAbordagem({
    estrategia,
    dadosLead: { nicho: 'energia solar' },
    instrucoes: cfg([{ ...CRM_SOLAR, sitePronto: true }]),
  })
  assert.equal(comPronto.aviso_site_pronto, true)
})

// ─── 15. Guardas de regressao (leem o fonte) ─────────────────────────────────
test('guarda: nao volta o fallback "primeira oferta ativa da lista"', () => {
  const fonte = ler('services/abordagem-inicial-contrato.js')
  assert.doesNotMatch(fonte, /geral\s*\|\|\s*ativas\[0\]/)
  assert.doesNotMatch(fonte, /ativas\[0\]\s*\|\|\s*null/)
})

test('guarda: a procedencia da coleta nao volta aos campos de nicho', () => {
  const fonte = ler('services/abordagem-inicial-contrato.js')
  const trecho = fonte.slice(fonte.indexOf('function nichosDoLead'), fonte.indexOf('function grauCorrespondenciaNicho'))
  assert.doesNotMatch(trecho, /lead\.fonte|lead\.origem/)
})

test('guarda: a origem viaja para os DOIS motores de resposta e para o follow-up', () => {
  // playbook (bundle, caminho padrao) + decisao em duas chamadas + follow-up
  const runtime = ler('services/contexto2-runtime.js')
  assert.equal((runtime.match(/ORIENTACAO COMERCIAL QUE ORIGINOU/g) || []).length, 3)
  assert.match(runtime, /abordagemOrigem/)
  // motor legado (contexto com estagios) — via flags do system prompt
  assert.match(ler('agent.js'), /ORIGEM_DA_CONVERSA/)
  assert.match(ler('core-funnel.js'), /abordagemOrigem: abordagemOrigemTurno/)
  assert.match(ler('followup-execution.js'), /abordagemOrigem: origemFollow/)
})

test('guarda: a origem so e gravada depois do envio CONFIRMADO no caminho Manual/Auto', () => {
  const fonte = ler('services/rodar-leads.js')
  const i = fonte.indexOf('await finalizarDisparoEnviado(pool, { disparoId, prospectId: p.id })')
  const j = fonte.indexOf('registrarOrigemDoLead', i)
  assert.ok(i > 0 && j > i, 'registro da origem deve vir DEPOIS de finalizarDisparoEnviado')
})

test('guarda: template (sem IA) nao registra origem — nenhuma oferta foi selecionada', () => {
  const fonte = ler('services/rodar-leads.js')
  assert.match(fonte, /gerada_por_ia: false, falha_ia: false, orientacao: null/)
})

// ─── INTEGRACAO: 1a abordagem -> snapshot -> resposta do lead -> follow-up ───
const { gerarAbordagemAnalise } = require('../src/services/saudacao-analise')
const { extrairEDecidirBundle, gerarFollowupComPlaybook } = require('../src/services/contexto2-runtime')

const CONTRATO_OK = JSON.stringify({
  schema_version: 'abordagem_inicial_v1',
  mensagem: 'Oi, tudo bem? Vi a Solar X em Goiania. A ideia e organizar leads e propostas em um lugar so. Posso te mostrar?',
  angulo: 'sem_site',
  sinais_usados: ['Solar X em Goiania'],
  pergunta_final: 'Posso te mostrar?',
  confianca: 0.8,
})

// Pool falso: so o contexto da instancia (conhecimento + etapa primeiro_contato).
function poolContexto(estagios = {}) {
  return {
    query: async () => ({
      rows: [{
        id: 'ctx-1',
        empresa_id: 'emp-1',
        nome: 'PJ',
        conteudo: 'A empresa faz sites institucionais.',
        contexto_form_json: {},
        estagios_json: estagios,
        runtime_ativo: true,
      }],
    }),
  }
}

test('integracao: a 1a abordagem devolve TEXTO + ORIENTACAO com a oferta do nicho', async () => {
  let promptVisto = ''
  const out = await gerarAbordagemAnalise({
    pool: poolContexto({ primeiro_contato: 'Abra citando um sinal real e termine com permissao.' }),
    empresaId: 'emp-1',
    contextoId: 'ctx-1',
    jsonApresentacao: { nome: 'Solar X', nicho: 'energia solar', cidade: 'Goiania', tem_site: false },
    instrucoes: cfg([GERAL, CRM_SOLAR]),
    nomeLead: 'Solar X',
    _generate: async (input) => { promptVisto = input.userPrompt; return { text: CONTRATO_OK } },
  })
  assert.ok(out.texto.length > 0)
  assert.equal(out.orientacao.oferta.id, 'solar')
  assert.equal(out.orientacao.motivo, MOTIVO_OFERTA.ESPECIFICA)
  assert.equal(out.orientacao.contexto_id, 'ctx-1')
  assert.equal(out.orientacao.etapa_playbook, 'primeiro_contato')
  // o prompt levou conhecimento + etapa + oferta do nicho, e NAO a oferta geral
  assert.match(promptVisto, /CONHECIMENTO DA EMPRESA/)
  assert.match(promptVisto, /ORIENTACAO DA ETAPA "PRIMEIRO CONTATO"/)
  assert.match(promptVisto, /Estrutura comercial com CRM/)
  assert.doesNotMatch(promptVisto, /Presenca digital completa/)
})

test('integracao: a RESPOSTA ao lead recebe a oferta que originou a conversa', async () => {
  const sel = selecionarOfertaAbordagem(cfg([GERAL, CRM_SOLAR]), { nicho: 'energia solar' })
  const origem = snapshotOrientacaoAbordagem(sel, { contextoId: 'ctx-1' })
  let promptVisto = ''
  const aiProvider = {
    generateAIResponse: async (input) => {
      promptVisto = input.userPrompt
      return { text: JSON.stringify({ extracao: {}, decisao: { mensagem_pro_lead: 'claro!' } }) }
    },
  }
  await extrairEDecidirBundle({
    pool: null,
    playbook: { json: { resumo_empresa: { nome: 'PJ' }, carro_chefe: 'Site institucional' } },
    historico: [{ role: 'user', content: 'me explica melhor' }],
    mensagem: 'me explica melhor',
    leadInsights: {},
    empresaId: 'emp-1',
    leadPhone: '5562999990000@s.whatsapp.net',
    aiProvider,
    abordagemOrigem: origem,
  })
  assert.match(promptVisto, /ORIENTACAO COMERCIAL QUE ORIGINOU ESTA CONVERSA/)
  assert.match(promptVisto, /Estrutura comercial com CRM/)
  assert.match(promptVisto, /Nao troque para a oferta geral nem para a oferta de outro nicho/)
})

test('integracao: conversa SEM origem registrada nao ganha bloco nenhum', async () => {
  let promptVisto = ''
  const aiProvider = {
    generateAIResponse: async (input) => {
      promptVisto = input.userPrompt
      return { text: JSON.stringify({ extracao: {}, decisao: { mensagem_pro_lead: 'ok' } }) }
    },
  }
  await extrairEDecidirBundle({
    pool: null,
    playbook: { json: {} },
    historico: [],
    mensagem: 'oi',
    leadInsights: {},
    empresaId: 'emp-1',
    leadPhone: '5562999990000@s.whatsapp.net',
    aiProvider,
    abordagemOrigem: null,
  })
  assert.doesNotMatch(promptVisto, /ORIENTACAO COMERCIAL QUE ORIGINOU/)
})

test('integracao: o FOLLOW-UP reabre na oferta que originou a conversa', async () => {
  const sel = selecionarOfertaAbordagem(cfg([GERAL, CRM_SOLAR]), { nicho: 'energia solar' })
  const origem = snapshotOrientacaoAbordagem(sel, {})
  let promptVisto = ''
  const aiProvider = {
    generateAIResponse: async (input) => {
      promptVisto = input.userPrompt
      return { text: JSON.stringify({ analise: {}, mensagem: 'E ai, conseguiu ver?' }) }
    },
  }
  const texto = await gerarFollowupComPlaybook({
    pool: { query: async () => ({ rows: [] }) },
    empresaId: 'emp-1',
    leadPhone: '5562999990000@s.whatsapp.net',
    historico: [{ role: 'assistant', content: 'Posso te mostrar?' }],
    playbook: { json: { carro_chefe: 'Site institucional' } },
    contextoTempo: { dias_sem_resposta: 3 },
    aiProvider,
    abordagemOrigem: origem,
  })
  assert.equal(texto, 'E ai, conseguiu ver?')
  assert.match(promptVisto, /ORIENTACAO COMERCIAL QUE ORIGINOU ESTA CONVERSA/)
  assert.match(promptVisto, /Estrutura comercial com CRM/)
})

test('guarda: o follow-up LEGADO (sem playbook) tambem recebe a oferta de origem', () => {
  const fonte = ler('followup-execution.js')
  assert.match(fonte, /ORIENTACAO COMERCIAL QUE ORIGINOU ESTA CONVERSA/)
  assert.match(fonte, /\$\{blocoOrigemFollow\}/)
  // uma leitura so, compartilhada pelos dois caminhos
  assert.equal((fonte.match(/obterAbordagemOrigem\(pool/g) || []).length, 1)
})
