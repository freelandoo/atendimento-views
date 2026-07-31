'use strict'
// Leitura/normalizacao de telefone brasileiro para a Central de Ligacoes. PURA e testavel
// (node:test), mesma convencao de ligacao-estado.js / ligacao-sinais-resumo.js.
//
// Por que existe: prospectador.prospects.telefone NAO e' normalizado na ingestao — na base
// convivem 4 formatos (E.164 '+55...', '(DD) NNNN-NNNN', '55DDNNNNNNNNN' cru e DDD+numero),
// com 10 a 13 digitos. Isto aqui e' SO EXIBICAO/DISCAGEM: nao altera nada gravado.
//
// O bug que motivou o modulo: a versao anterior fazia
//     digitos.replace(/^55/, '')
// removendo "55" INCONDICIONALMENTE, sem distinguir DDI de DDD. Consequencias reais:
//   - DDD 55 (Santa Maria/RS) sem DDI era comido -> o numero virava indiscavel;
//   - '+55' + 8~9 digitos (DDI presente, DDD AUSENTE) caia no fallback e era exibido cru,
//     parecendo completo quando nao e'.
//
// Regra central: o '+' EXPLICITO no texto original e' o desempatador. '+55 3220-1234' declara
// 55 como DDI, logo faltam 2 digitos de DDD -> incompleto. Ja '55 9999-8888' (11 digitos, sem
// '+') e' DDD 55 + numero -> discavel. Sem esse sinal os dois casos sao indistinguiveis.

/** @typedef {{ddd:string|null, numero:string|null, e164:string|null, completo:boolean, motivo:string|null}} FoneInfo */

/** Analisa o telefone cru e devolve as partes + se da para discar. */
function analisarFone(bruto) {
  const raw = bruto == null ? '' : String(bruto)
  const digitos = raw.replace(/\D/g, '')
  if (!digitos) return { ddd: null, numero: null, e164: null, completo: false, motivo: 'vazio' }

  const temPlus = /^\s*\+/.test(raw)
  let resto = digitos

  if (digitos.startsWith('55')) {
    const semDdi = digitos.slice(2)
    // So tratamos "55" como DDI quando o que sobra e' um numero nacional completo (DDD+8/9).
    // Assim 11 digitos comecando em 55 seguem sendo DDD 55 — que era exatamente o caso quebrado.
    if (semDdi.length === 10 || semDdi.length === 11) resto = semDdi
    else if (temPlus && (semDdi.length === 8 || semDdi.length === 9)) {
      // DDI declarado, mas sem DDD: nao da para discar e NAO pode parecer completo.
      return { ddd: null, numero: semDdi, e164: null, completo: false, motivo: 'sem_ddd' }
    }
  }

  if (resto.length === 10 || resto.length === 11) {
    const ddd = resto.slice(0, 2)
    const numero = resto.slice(2)
    return { ddd, numero, e164: `+55${ddd}${numero}`, completo: true, motivo: null }
  }
  if (resto.length === 8 || resto.length === 9) {
    return { ddd: null, numero: resto, e164: null, completo: false, motivo: 'sem_ddd' }
  }
  return { ddd: null, numero: null, e164: null, completo: false, motivo: 'formato_desconhecido' }
}

/** Exibicao. Completo -> "(11) 99988-7766". Incompleto -> o cru, para o operador conferir. */
function fmtFone(bruto) {
  const i = analisarFone(bruto)
  if (!i.completo) return (bruto == null ? '' : String(bruto)).trim() || '—'
  const meio = i.numero.length === 9 ? i.numero.slice(0, 5) : i.numero.slice(0, 4)
  return `(${i.ddd}) ${meio}-${i.numero.slice(-4)}`
}

/** href para discagem (tel:+55...) — null quando o numero nao e' discavel. */
function telHref(bruto) {
  const { e164 } = analisarFone(bruto)
  return e164 ? `tel:${e164}` : null
}

/**
 * Aviso para a UI quando o numero nao da para discar (null se estiver ok).
 * Frase completa porque o destino e' TOOLTIP (title/aria-label), nao mais texto solto na
 * celula da tabela — o motivo continua acessivel, sem ocupar a coluna Telefone.
 */
function avisoFone(bruto) {
  const { completo, motivo } = analisarFone(bruto)
  if (completo) return null
  if (motivo === 'vazio') return 'sem telefone'
  if (motivo === 'sem_ddd') return 'Número sem DDD. Confira antes de ligar.'
  return 'Número em formato não reconhecido. Confira antes de ligar.'
}

module.exports = { analisarFone, fmtFone, telHref, avisoFone }
