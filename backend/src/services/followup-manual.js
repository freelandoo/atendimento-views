'use strict'
// Modo Manual + Roteiro de ligacao (IA) da pagina de Follow-ups. Compoe os MESMOS
// blocos standalone que o motor de follow-up usa (getContextoAtivoEmpresa +
// gerarFollowupComPlaybook + enviarMensagem), sem reimplementar o engine. Fluxo em 2
// passos (gerar preview -> operador revisa -> enviar), por isso NAO reusa o
// executarFollowupUmNumero (que gera e envia num tiro so). Isolado por empresa.
const { generateAIResponse } = require('../ai-provider')
const { getContextoAtivoEmpresa } = require('./contexto-empresa')
const { gerarFollowupComPlaybook } = require('./contexto2-runtime')
const { enviarMensagem } = require('../whatsapp')
const { logger } = require('../logger')

const TIMEOUT_MS = 30000
const HISTORICO_MAX = 40

function erroNaoEncontrado() {
  const err = new Error('Conversa nao encontrada para esta empresa.')
  err.statusCode = 404
  return err
}

// Busca a conversa SEMPRE filtrando por empresa (seguranca multi-tenant: empresa A
// nunca gera/envia follow-up para lead da empresa B).
async function buscarConversaEmpresa(pool, empresaId, numero) {
  const jid = String(numero || '').trim()
  if (!jid) return null
  const { rows } = await pool.query(
    `SELECT numero, historico, estagio, status, empresa_id, atualizado_em
       FROM vendas.conversas WHERE numero = $1 AND empresa_id = $2`,
    [jid, empresaId]
  )
  return rows[0] || null
}

function normalizarHistorico(historico) {
  if (Array.isArray(historico)) return historico
  try { return JSON.parse(historico) } catch { return [] }
}

// --- ROTEIRO DE LIGACAO (Semi) — read-only, nao envia nada -----------------------
const SYSTEM_ROTEIRO = [
  'Voce e um coach de vendas preparando um vendedor para uma LIGACAO por telefone (Brasil, PT-BR).',
  'A partir do historico da conversa e dos sinais do lead, escreva um briefing CURTO e pratico para o vendedor ligar preparado.',
  'Estrutura (use estes titulos, texto direto, sem enrolacao):',
  '- Contexto: 1-2 frases sobre onde o lead parou e por que sumiu.',
  '- Angulo: a melhor abordagem/gancho para retomar (valor, nao pressao).',
  '- Objecao provavel: a resistencia mais esperada + como responder.',
  '- Abertura sugerida: 1 frase que o vendedor pode falar ao ligar.',
  'Maximo 700 caracteres no total. Nao invente dados que nao estejam no material.',
  'Responda apenas com o briefing — sem titulo geral, sem comentarios.',
].join('\n')

async function gerarRoteiroLigacao({ pool, log = logger, empresaId, numero, motivo, _generate }) {
  const gerar = _generate || generateAIResponse
  const conversa = await buscarConversaEmpresa(pool, empresaId, numero)
  if (!conversa) throw erroNaoEncontrado()
  const historico = normalizarHistorico(conversa.historico).slice(-12)
  const partes = []
  partes.push(`ESTAGIO ATUAL: ${conversa.estagio || 'primeiro_contato'}`)
  if (motivo) partes.push(`MOTIVO PARA LIGAR: ${String(motivo).slice(0, 300)}`)
  partes.push(`HISTORICO RECENTE DA CONVERSA:\n${JSON.stringify(historico, null, 2)}`)

  const input = {
    systemPrompt: SYSTEM_ROTEIRO,
    userPrompt: partes.join('\n\n'),
    task: 'roteiro_ligacao',
    maxTokens: 400,
    timeoutMs: TIMEOUT_MS,
    empresaId,
    ref_type: 'followup_roteiro',
    ref_id: numero,
    client_numero: numero,
  }
  const res = await gerar(input, pool, log)
  const roteiro = String(res?.text || '').trim()
  if (!roteiro) throw new Error('IA nao retornou o roteiro. Tente novamente.')
  return { roteiro }
}

// --- MANUAL — gerar preview (NAO envia) ------------------------------------------
async function gerarPreviewFollowup({ pool, log = logger, empresaId, numero, aiProvider }) {
  const conversa = await buscarConversaEmpresa(pool, empresaId, numero)
  if (!conversa) throw erroNaoEncontrado()
  const historico = normalizarHistorico(conversa.historico)

  const playbook = await getContextoAtivoEmpresa(pool, empresaId).catch(() => null)
  let texto = ''
  if (playbook) {
    texto = await gerarFollowupComPlaybook({
      pool, log, empresaId, leadPhone: numero, historico, playbook, contextoTempo: null,
      aiProvider: aiProvider || undefined,
    })
  } else {
    // Empresa sem Contexto 2: gera um reengajamento simples pela IA base.
    const input = {
      systemPrompt: [
        'Voce e um consultor comercial escrevendo UMA mensagem curta de retomada por WhatsApp (PT-BR).',
        'Tom humano e leve. Retome o assunto de onde parou, agregue valor e termine com UMA pergunta.',
        'Maximo 400 caracteres. Nao invente dados. Responda so com o texto da mensagem.',
      ].join('\n'),
      userPrompt: `HISTORICO DA CONVERSA:\n${JSON.stringify(historico.slice(-12), null, 2)}`,
      task: 'followup_manual',
      maxTokens: 300,
      timeoutMs: TIMEOUT_MS,
      empresaId,
      ref_type: 'followup_manual',
      ref_id: numero,
      client_numero: numero,
    }
    const res = await generateAIResponse(input, pool, log)
    texto = String(res?.text || '').trim()
  }
  if (!texto) throw new Error('IA nao retornou a mensagem. Tente novamente.')
  return { texto }
}

// --- MANUAL — enviar o texto (possivelmente editado pelo operador) ----------------
async function enviarFollowupTexto({ pool, log = logger, empresaId, numero, texto }) {
  const msg = String(texto || '').trim()
  if (!msg) throw new Error('Mensagem vazia.')
  const conversa = await buscarConversaEmpresa(pool, empresaId, numero)
  if (!conversa) throw erroNaoEncontrado()

  try {
    await enviarMensagem(numero, msg)
  } catch (e) {
    await registrarEnvioFollowup(pool, { empresaId, numero, preview: null, ok: false, erro: e.message })
    throw e
  }

  // Anexa ao historico (mesma politica do motor: teto de 40) e atualiza atualizado_em.
  let historico = normalizarHistorico(conversa.historico)
  historico = [...historico, { role: 'assistant', content: msg }]
  if (historico.length > HISTORICO_MAX) historico = historico.slice(-HISTORICO_MAX)
  await pool.query(
    `UPDATE vendas.conversas SET historico = $2::jsonb, atualizado_em = NOW()
      WHERE numero = $1 AND empresa_id = $3`,
    [numero, JSON.stringify(historico), empresaId]
  )
  await registrarEnvioFollowup(pool, { empresaId, numero, preview: msg.slice(0, 300), ok: true, erro: null })
  const destino = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  return { ok: true, destino, trecho: msg.slice(0, 200) }
}

// Registra em vendas.followup_envios (mesma tabela do motor). Inclui empresa_id para
// as metricas multi-tenant. Nao lanca — log de auditoria nao pode quebrar o envio.
async function registrarEnvioFollowup(pool, { empresaId, numero, preview, ok, erro }) {
  try {
    await pool.query(
      `INSERT INTO vendas.followup_envios (numero, modo, mensagem_preview, envio_ok, erro, empresa_id)
       VALUES ($1::text, 'reengajamento', $2::text, $3::boolean, $4::text, $5)`,
      [numero, preview, !!ok, erro ? String(erro).slice(0, 500) : null, empresaId]
    )
  } catch (e) {
    if (logger && logger.warn) logger.warn({ err: e.message }, '[followup-manual] registrarEnvioFollowup falhou')
  }
}

module.exports = {
  gerarRoteiroLigacao,
  gerarPreviewFollowup,
  enviarFollowupTexto,
  buscarConversaEmpresa,
}
