'use strict'

/**
 * Vocabulario e REGRA PURA da instancia de ENVIO (Fase 2 de
 * `docs/analise-contexto-instancia.md`).
 *
 * Modulo PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao responde "qual instancia
 * usar?" — responde "**esta instancia esta PROVADA para este envio?**". A diferenca nao e
 * estilistica: a primeira pergunta admite resposta por heuristica (a mais recente, a unica
 * ativa, a do env) e foi exatamente ela que produziu o defeito que esta fase remove.
 *
 * A regra inteira em uma frase: **so envia por instancia NOMEADA por um vinculo provado**
 * (o nome gravado na conversa, ou um nome que o chamador declarou), que EXISTA, esteja
 * ATIVA, seja do canal WhatsApp/Evolution e pertenca a MESMA empresa da conversa e do
 * chamador. Qualquer outra coisa e bloqueio auditavel.
 *
 * O que este modulo NAO faz, de proposito:
 *  - nao le `process.env` (nem `EVOLUTION_INSTANCE`, nem nada);
 *  - nao conhece o literal `'PJ'` nem UUID de empresa alguma;
 *  - nao ordena instancias por data nem por qualquer outro criterio — escolher uma entre N
 *    e' inventar dono, o mesmo defeito que a quarentena de webhook removeu na ENTRADA;
 *  - nao aceita "a empresa so tem uma instancia, entao deve ser essa": a contagem pode virar
 *    2 amanha e o codigo passaria a mentir em silencio.
 *
 * Ha guarda de regressao em `test/instancia-envio.test.js` que le o fonte deste modulo e o
 * de `src/whatsapp.js` e falha se qualquer um desses fallbacks voltar.
 */

/** Motivos de bloqueio. Lista fechada — o log e a API falam este vocabulario. */
const MOTIVOS_BLOQUEIO = Object.freeze({
  /** A conversa nao tem `evolution_instance` e o chamador nao declarou nenhuma. */
  SEM_VINCULO_COMPROVADO: 'sem_vinculo_comprovado',
  /** O nome existe mas nao e um identificador Evolution valido. */
  NOME_INVALIDO: 'nome_invalido',
  /** O nome nao casa com nenhuma linha de `app.empresa_whatsapp_instances`. */
  INSTANCIA_DESCONHECIDA: 'instancia_desconhecida',
  /** A instancia existe mas esta desligada. */
  INSTANCIA_INATIVA: 'instancia_inativa',
  /** A instancia existe e esta ativa, mas e de OUTRA empresa. */
  INSTANCIA_DE_OUTRA_EMPRESA: 'instancia_de_outra_empresa',
  /** A instancia nao fala Evolution (hoje: canal `freelandoo`, que tem transporte proprio). */
  CANAL_INCOMPATIVEL: 'canal_incompativel',
  /** Falha tecnica ao consultar o vinculo — distinta de "nao existe", como na quarentena. */
  ERRO_RESOLUCAO: 'erro_resolucao',
})

/** De onde veio o NOME que foi julgado. Nao e' juizo de valor: os dois sao aceitaveis. */
const ORIGENS_NOME = Object.freeze({
  /** O chamador declarou explicitamente (`opts.instanceName`). */
  EXPLICITA: 'explicita',
  /** O nome estava gravado em `vendas.conversas.evolution_instance`. */
  CONVERSA: 'conversa',
})

/** Canal cujo transporte e a Evolution API. `freelandoo` tem cliente proprio. */
const CANAL_EVOLUTION = 'whatsapp'

const MENSAGENS = Object.freeze({
  [MOTIVOS_BLOQUEIO.SEM_VINCULO_COMPROVADO]:
    'Esta conversa nao tem instancia WhatsApp comprovada; o envio foi bloqueado.',
  [MOTIVOS_BLOQUEIO.NOME_INVALIDO]:
    'Nome de instancia WhatsApp invalido para envio.',
  [MOTIVOS_BLOQUEIO.INSTANCIA_DESCONHECIDA]:
    'A instancia WhatsApp desta conversa nao esta cadastrada.',
  [MOTIVOS_BLOQUEIO.INSTANCIA_INATIVA]:
    'A instancia WhatsApp desta conversa nao esta ativa para envio.',
  [MOTIVOS_BLOQUEIO.INSTANCIA_DE_OUTRA_EMPRESA]:
    'A instancia WhatsApp indicada pertence a outra empresa.',
  [MOTIVOS_BLOQUEIO.CANAL_INCOMPATIVEL]:
    'A instancia indicada nao usa o canal WhatsApp/Evolution.',
  [MOTIVOS_BLOQUEIO.ERRO_RESOLUCAO]:
    'Nao foi possivel confirmar a instancia WhatsApp desta conversa.',
})

/**
 * Erro unico de bloqueio de envio. `statusCode` 409 porque a rota de operador ja usa esse
 * contrato (`INSTANCE_UNAVAILABLE`) e o front ja sabe traduzi-lo: nao e erro do pedido
 * (400) nem do transporte (502) — e um estado do cadastro que precisa de acao humana.
 */
class ErroInstanciaEnvio extends Error {
  constructor(motivo, detalhe = null) {
    const base = MENSAGENS[motivo] || MENSAGENS[MOTIVOS_BLOQUEIO.SEM_VINCULO_COMPROVADO]
    super(detalhe ? `${base} (${detalhe})` : base)
    this.name = 'ErroInstanciaEnvio'
    this.motivo = motivo
    this.code = 'INSTANCIA_NAO_COMPROVADA'
    this.statusCode = 409
    this.instanciaBloqueada = true
  }
}

function erroInstanciaEnvio(motivo, detalhe = null) {
  return new ErroInstanciaEnvio(motivo, detalhe)
}

/**
 * Normaliza um nome tecnico de instancia Evolution.
 * Devolve `''` quando vazio; LANCA quando ha conteudo mas ele nao e um identificador valido
 * (nao silencia: um nome torto vindo de payload precisa quebrar, nao virar outro nome).
 */
function normalizarNomeInstancia(valor) {
  const raw = String(valor == null ? '' : valor).trim()
  if (!raw) return ''
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) {
    throw erroInstanciaEnvio(MOTIVOS_BLOQUEIO.NOME_INVALIDO)
  }
  return raw
}

/** Canal declarado no `config_json` da instancia. Ausente = WhatsApp (o default do schema). */
function canalDaInstancia(instancia) {
  const cfg = instancia && instancia.config_json
  const obj = typeof cfg === 'string' ? seguroJson(cfg) : (cfg || {})
  const canal = String((obj && obj.canal) || '').trim().toLowerCase()
  return canal || CANAL_EVOLUTION
}

function seguroJson(texto) {
  try {
    const v = JSON.parse(texto)
    return v && typeof v === 'object' ? v : {}
  } catch (_) {
    return {}
  }
}

/**
 * PASSO 1 — qual NOME sera julgado, e de onde ele veio.
 *
 * Precedencia: o que o chamador declarou vence o que esta gravado na conversa. Nao e' um
 * atalho: quem declara e' codigo que SABE por qual numero quer falar (o disparo do Banco de
 * Leads, o teste de instancia, o operador). O que nao existe e' o terceiro passo — se nem o
 * chamador nem a conversa nomearam ninguem, o envio para aqui.
 *
 * @returns {{ok: true, nome: string, origem: string}|{ok: false, motivo: string}}
 */
function nomeParaEnvio({ nomeSolicitado = '', nomeDaConversa = '' } = {}) {
  const solicitado = normalizarNomeInstancia(nomeSolicitado)
  if (solicitado) return { ok: true, nome: solicitado, origem: ORIGENS_NOME.EXPLICITA }
  const daConversa = normalizarNomeInstancia(nomeDaConversa)
  if (daConversa) return { ok: true, nome: daConversa, origem: ORIGENS_NOME.CONVERSA }
  return { ok: false, motivo: MOTIVOS_BLOQUEIO.SEM_VINCULO_COMPROVADO }
}

/**
 * PASSO 2 — a instancia NOMEADA pode enviar?
 *
 * `instancia` e' a linha de `app.empresa_whatsapp_instances` ja lida pelo nome do passo 1
 * (`null` quando o nome nao casou com nenhuma). A empresa e' conferida contra as DUAS fontes
 * que podem discordar: a da conversa e a que o chamador declarou. Conferir so uma deixaria
 * passar o caso em que a conversa e' orfa (empresa nula) e o chamador e' de outro tenant.
 *
 * `empresaIdDaConversa` NULO nao bloqueia: conversas anteriores ao isolamento existem sem
 * dono, e a instancia gravada nelas E' a prova do vinculo. O dono efetivo do envio passa a
 * ser o `empresa_id` da propria instancia — que e' NOT NULL no schema.
 *
 * @returns {{ok: true, instanceName, origem, empresaId, instanciaId, divergeDaConversa}|
 *           {ok: false, motivo: string}}
 */
function validarInstanciaParaEnvio({
  nome,
  origem,
  instancia = null,
  empresaIdDaConversa = null,
  empresaIdDeclarada = null,
  nomeDaConversa = '',
} = {}) {
  if (!nome) return { ok: false, motivo: MOTIVOS_BLOQUEIO.SEM_VINCULO_COMPROVADO }
  if (!instancia) return { ok: false, motivo: MOTIVOS_BLOQUEIO.INSTANCIA_DESCONHECIDA }
  if (instancia.ativo !== true) return { ok: false, motivo: MOTIVOS_BLOQUEIO.INSTANCIA_INATIVA }
  if (canalDaInstancia(instancia) !== CANAL_EVOLUTION) {
    return { ok: false, motivo: MOTIVOS_BLOQUEIO.CANAL_INCOMPATIVEL }
  }

  const empresaDaInstancia = instancia.empresa_id || null
  if (!empresaDaInstancia) return { ok: false, motivo: MOTIVOS_BLOQUEIO.INSTANCIA_DESCONHECIDA }
  for (const esperada of [empresaIdDaConversa, empresaIdDeclarada]) {
    if (esperada && String(esperada) !== String(empresaDaInstancia)) {
      return { ok: false, motivo: MOTIVOS_BLOQUEIO.INSTANCIA_DE_OUTRA_EMPRESA }
    }
  }

  // Divergencia NAO bloqueia: o chamador que nomeia outra instancia da MESMA empresa esta
  // fazendo uma escolha humana (disparo do Banco de Leads, teste de numero). O que ela nunca
  // pode causar e' migrar a conversa — quem garante isso e' a precedencia de ESCRITA de
  // `evolution_instance` (D-8, `db-crud.js`), nao este julgamento. Fica exposta para o log.
  const nomeGravado = String(nomeDaConversa || '').trim()
  const divergeDaConversa = Boolean(nomeGravado) && nomeGravado !== nome

  return {
    ok: true,
    instanceName: nome,
    origem: origem || ORIGENS_NOME.CONVERSA,
    empresaId: empresaDaInstancia,
    instanciaId: instancia.id || null,
    divergeDaConversa,
  }
}

module.exports = {
  MOTIVOS_BLOQUEIO,
  ORIGENS_NOME,
  CANAL_EVOLUTION,
  MENSAGENS,
  ErroInstanciaEnvio,
  erroInstanciaEnvio,
  normalizarNomeInstancia,
  canalDaInstancia,
  nomeParaEnvio,
  validarInstanciaParaEnvio,
}
