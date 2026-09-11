'use strict'
// Abordagem MANUAL pelo WhatsApp — módulo PURO. CRM em equipe, Etapa 5.
// Sem banco, sem HTTP, sem IA, sem rede. **Este módulo não envia nada, e nunca deve.**
// Ver docs/especificacao-crm-equipe.md §5.4.
//
// ─── A REGRA QUE GOVERNA O MÓDULO ────────────────────────────────────────────────────────
// **Abrir um link `wa.me` não prova que a mensagem foi enviada.** O produto monta a URL e abre o
// WhatsApp; quem envia é o vendedor, no aparelho dele, fora do alcance de qualquer webhook.
// Portanto existem TRÊS fatos distintos, e confundi-los é o defeito a evitar:
//   1. o sistema preparou a mensagem          → não é abordagem
//   2. o vendedor ABRIU o WhatsApp             → é intenção, registrada como abertura
//   3. o vendedor DECLAROU que enviou          → é o fato mais forte que existe neste canal,
//                                                e ainda assim é DECLARAÇÃO, não prova
//
// ─── O QUE ESTE MÓDULO NÃO FAZ (e há guarda de regressão para cada um) ───────────────────
//   * não chama a Evolution, nem qualquer cliente HTTP;
//   * não chama IA — o rascunho é DETERMINÍSTICO (um canal novo não estreia com custo de LLM por
//     clique; se isso mudar, será decisão de produto, e é este teste que a torna visível);
//   * não decide qualificação nem ownership (são os módulos das Etapas 3 e 4).

// Como o fato foi confirmado. Espelha a CHECK lead_disparos_confirmado_por_chk (migration 073).
const CONFIRMACAO = Object.freeze({
  /** A Evolution confirmou a entrega (DELIVERY_ACK | READ | PLAYED). */
  PROVIDER: 'provider',
  /** Uma PESSOA declarou que enviou. Não é prova. */
  OPERADOR: 'operador',
})

// Canais de disparo. Espelha a CHECK lead_disparos_canal_chk.
const CANAL = Object.freeze({
  EVOLUTION: 'evolution',
  MANUAL_WA_ME: 'manual_wa_me',
})

// Estados próprios do canal manual, gravados em `lead_disparos.status`.
// `aberto` é o registro do CLIQUE — deliberadamente um estado próprio, e não `enviado`.
const STATUS_MANUAL = Object.freeze({
  ABERTO: 'aberto',
  ENVIADO: 'enviado',
})

const MOTIVOS = Object.freeze({
  OK: 'ok',
  SEM_TELEFONE: 'sem_telefone',
  TELEFONE_INVALIDO: 'telefone_invalido',
})

// ─── Telefone ────────────────────────────────────────────────────────────────────────────
// `wa.me` exige o número em formato internacional, só dígitos, sem `+`, sem espaço, sem
// parêntese. Um número malformado não dá erro: o WhatsApp abre uma tela dizendo que o número é
// inválido, e o vendedor culpa o sistema. Por isso a validação é explícita.

/** Só os dígitos. */
function digitos(valor) {
  return String(valor == null ? '' : valor).replace(/\D+/g, '')
}

/**
 * Normaliza para o formato que o `wa.me` aceita (E.164 sem o `+`).
 *
 * Assume Brasil quando o DDI está ausente, porque é o único mercado do produto e porque um número
 * de 10-11 dígitos sem DDI é inequivocamente local. **Não "conserta" o 9º dígito** e não remove
 * nada: inventar dígito produziria uma abordagem para outra pessoa.
 *
 * @returns {string|null} `null` quando não dá para montar um número plausível.
 */
function normalizarParaWaMe(telefone) {
  const bruto = String(telefone == null ? '' : telefone)
  const d = digitos(bruto)
  if (!d) return null
  // Um `+` no original PROVA que o DDI já está lá: nunca prefixar 55 nesse caso. Sem esta
  // checagem, `+1 415 555 2671` (11 dígitos) virava `5514155552671` — abordagem para o número
  // errado, em outro país.
  const temDdiExplicito = bruto.trim().startsWith('+')
  if (temDdiExplicito) return d.length >= 8 && d.length <= 15 ? d : null
  // Já tem DDI do Brasil e comprimento coerente (55 + DDD 2 + 8|9).
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d
  // Local, sem DDI: DDD 2 + 8|9.
  if (d.length === 10 || d.length === 11) return `55${d}`
  // Outro DDI sem o `+`: só aceita comprimento que não colide com número local brasileiro.
  if (d.length >= 12 && d.length <= 15) return d
  return null
}

/** O lead tem um número que dá para abrir? */
function avaliarTelefone(telefone) {
  const d = digitos(telefone)
  if (!d) return { permitido: false, motivo: MOTIVOS.SEM_TELEFONE }
  if (!normalizarParaWaMe(telefone)) return { permitido: false, motivo: MOTIVOS.TELEFONE_INVALIDO }
  return { permitido: true, motivo: MOTIVOS.OK }
}

/**
 * Monta a URL do `wa.me`.
 *
 * `https://wa.me/<numero>?text=<mensagem>` — `encodeURIComponent` na mensagem, sempre. Sem ele,
 * um `&` ou `#` no texto cortaria a mensagem no meio, e uma quebra de linha viraria `+`.
 * Mensagem vazia devolve a URL sem `?text=`, que abre a conversa em branco (caso legítimo: o
 * vendedor quer escrever do zero).
 *
 * @returns {string|null} `null` quando o telefone não serve — a tela não deve montar link quebrado.
 */
function montarUrlWaMe(telefone, mensagem = '') {
  const numero = normalizarParaWaMe(telefone)
  if (!numero) return null
  const texto = String(mensagem == null ? '' : mensagem).trim()
  if (!texto) return `https://wa.me/${numero}`
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}

// ─── Rascunho DETERMINÍSTICO ─────────────────────────────────────────────────────────────
// Sem IA, de propósito (ver o cabeçalho). O rascunho é uma sugestão editável: o vendedor sempre
// vê e altera antes de enviar, porque o envio é dele.

const LIMITE_MENSAGEM = 1000

/** Primeiro nome, para a saudação. Nome de empresa fica inteiro. */
function primeiroNome(nome) {
  const limpo = String(nome == null ? '' : nome).trim()
  if (!limpo) return ''
  return limpo.split(/\s+/)[0]
}

/**
 * Rascunho da primeira mensagem.
 *
 * Usa `saudacao` da instância quando existir (é o texto que o operador já escreveu e aprovou para
 * aquele número) e, na falta dela, monta algo mínimo e honesto. **Nunca inventa oferta, preço,
 * prazo ou elogio ao negócio** — o vendedor é quem sabe o que dizer, e um rascunho que afirma
 * coisas vira mensagem enviada sem ninguém ter decidido afirmá-las.
 */
function montarRascunho(lead, { saudacao = '', remetente = '' } = {}) {
  const base = String(saudacao == null ? '' : saudacao).trim()
  if (base) return base.slice(0, LIMITE_MENSAGEM)

  // `lead = {}` como default NÃO protege contra `null` — o default de parâmetro só vale para
  // `undefined`, e um lead nulo chega de qualquer camada que não achou a linha.
  const nome = primeiroNome((lead || {}).nome)
  const quem = String(remetente || '').trim()
  const partes = [
    nome ? `Olá, ${nome}!` : 'Olá!',
    quem ? `Aqui é ${quem}.` : '',
  ].filter(Boolean)
  return partes.join(' ').slice(0, LIMITE_MENSAGEM)
}

/** Saneia a mensagem que o vendedor editou, antes de ir para a URL. */
function sanearMensagem(valor) {
  return String(valor == null ? '' : valor).replace(/\r\n/g, '\n').trim().slice(0, LIMITE_MENSAGEM)
}

// ─── Rótulos de força de prova ───────────────────────────────────────────────────────────

/**
 * Como este disparo deve ser DESCRITO.
 *
 * Existe aqui, e não na tela, porque é regra: um número que soma entrega confirmada com
 * declaração do vendedor não se sustenta, e a única defesa contra isso é a descrição vir do
 * backend junto do dado.
 */
function forcaDaProva(disparo = {}) {
  const canal = disparo.canal || CANAL.EVOLUTION
  const por = disparo.confirmado_por || null
  if (por === CONFIRMACAO.PROVIDER) {
    return { comprovado: true, rotulo: 'Entrega confirmada', detalhe: 'O WhatsApp confirmou a entrega.' }
  }
  if (por === CONFIRMACAO.OPERADOR) {
    return {
      comprovado: false,
      rotulo: 'Marcado como enviado',
      detalhe: 'Quem enviou marcou manualmente. O sistema não tem confirmação de entrega.',
    }
  }
  if (canal === CANAL.MANUAL_WA_ME) {
    return {
      comprovado: false,
      rotulo: 'WhatsApp aberto',
      detalhe: 'O WhatsApp foi aberto; ninguém confirmou o envio ainda.',
    }
  }
  return { comprovado: false, rotulo: 'Envio em andamento', detalhe: 'Aguardando confirmação do WhatsApp.' }
}

/** Um disparo manual conta para o teto diário anti-ban da Evolution? **Nunca.** */
function contaParaTetoEvolution(disparo = {}) {
  return (disparo.canal || CANAL.EVOLUTION) === CANAL.EVOLUTION
}

module.exports = {
  CANAL,
  CONFIRMACAO,
  STATUS_MANUAL,
  MOTIVOS,
  LIMITE_MENSAGEM,
  digitos,
  normalizarParaWaMe,
  avaliarTelefone,
  montarUrlWaMe,
  primeiroNome,
  montarRascunho,
  sanearMensagem,
  forcaDaProva,
  contaParaTetoEvolution,
}
