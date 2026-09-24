'use strict'
// Operacao Comercial — Etapa 1. Modulo PURO e dono UNICO do vocabulario do programa.
// Sem banco, sem HTTP, sem IA, sem rede: testavel com `node --test`.
// Mesmo padrao de services/acesso-capacidades.js, conversa-modo-ia.js e instancia-envio.js.
//
// ─── A PERGUNTA QUE ESTE MODULO RESPONDE ────────────────────────────────────────────────
// Ele NAO responde "esta pessoa pode fazer X?" — isso e' `acesso-capacidades.js`. Ele responde
// **"esta pessoa ja ENTROU no programa?"**. Sao duas perguntas diferentes e mistura-las teria um
// custo concreto: aceite virando capacidade deixaria um admin conceder "dispensa de termo" pela
// concessao aditiva de `app.usuarios_empresas.permissoes` — ou seja, dispensar por tela o
// consentimento que o programa existe para colher.
//
// ─── AS DUAS PORTAS SAO INDEPENDENTES E AMBAS PRECISAM ESTAR ABERTAS ────────────────────
//   capacidade (o papel alcanca a acao?)  ×  aceite (a pessoa entrou no programa?)
// A capacidade e' verificada por `requireCapacidade`; o aceite, por `requireEmpresaAccess`. Uma
// nao substitui a outra, e nenhuma das duas e' verificada no frontend.
//
// ─── PROIBICOES (com guarda de regressao em test/programa-aceite.test.js) ────────────────
//  1. Comparar `programa` ou papel-sujeito com LITERAL fora deste modulo.
//  2. Criar uma capacidade de "dispensa de aceite". Dispensar = nao ser sujeito do programa,
//     o que e' decidido pelo PAPEL, nao por concessao.
//  3. O frontend decidir o bloqueio. A tela redireciona por conveniencia; quem barra e' a API.

// ─── Vocabulario ────────────────────────────────────────────────────────────────────────
// Espelha a CHECK `programa_aceites_programa_chk` (migration 084). Ha teste anti-drift que le a
// migration e falha se os dois divergirem.
const PROGRAMA = Object.freeze({ OPERACAO_COMERCIAL: 'operacao_comercial' })
const PROGRAMAS = Object.freeze([PROGRAMA.OPERACAO_COMERCIAL])

// QUEM esta sujeito ao termo. Decisao do operador (2026-09-24): so' `comercial`.
//
// `owner` NAO e' sujeito, e isso nao e' cortesia: o termo e' o contrato de quem
// TRABALHA no programa, e quem responde pela empresa e' a outra parte do acordo. Torna-los
// sujeitos trancaria o dono fora do proprio produto no primeiro boot depois do deploy — e nao ha
// ninguem acima dele para destravar.
const PAPEIS_SUJEITOS = Object.freeze(['comercial'])

// `superadmin` e' o operador da PLATAFORMA e nao tem vinculo com a empresa (ver
// acesso-capacidades.js). Nomeado aqui para ninguem escrever o literal no middleware.
const PAPEL_PLATAFORMA = 'superadmin'

// Vocabulario FECHADO de motivos. Existe para o log e a tela explicarem sem inventar texto, e
// para o teste poder afirmar POR QUE algo foi liberado ou barrado — um booleano sozinho nao
// distingue "nao e' sujeito" de "ja aceitou", e as duas situacoes pedem telas diferentes.
const MOTIVOS = Object.freeze({
  PLATAFORMA: 'plataforma',                     // superadmin: nao e' sujeito do programa
  NAO_SUJEITO: 'nao_sujeito',                   // owner: o papel nao participa do programa
  ACEITE_VIGENTE: 'aceite_vigente',             // aceitou a versao que esta valendo
  ACEITE_AUSENTE: 'aceite_ausente',             // nunca aceitou — primeiro acesso
  ACEITE_DESATUALIZADO: 'aceite_desatualizado', // aceitou outra versao do termo
})

// Os dois unicos motivos que BARRAM. A lista e' explicita para o middleware nao precisar deduzir
// o bloqueio por negacao — motivo novo nasce liberando, nunca trancando por acidente.
const MOTIVOS_QUE_BARRAM = Object.freeze([MOTIVOS.ACEITE_AUSENTE, MOTIVOS.ACEITE_DESATUALIZADO])

/** O papel participa do programa? Papel desconhecido NAO e' sujeito — ver `avaliarAcesso`. */
function papelSujeito(papel) {
  return typeof papel === 'string' && PAPEIS_SUJEITOS.includes(papel)
}

/** O programa existe neste vocabulario? Nome desconhecido NEGA (nunca lanca). */
function programaConhecido(programa) {
  return typeof programa === 'string' && PROGRAMAS.includes(programa)
}

function textoLimpo(v) {
  return String(v == null ? '' : v).trim()
}

/**
 * O aceite registrado cobre a versao que esta valendo?
 * Comparacao EXATA de versao, nos dois sentidos: uma versao gravada diferente da vigente — mais
 * nova (rollback de deploy) ou mais velha (texto atualizado) — volta a exigir o aceite. Preferir
 * pedir de novo a supor que a pessoa concordou com um texto que nao viu.
 */
function aceiteCobreVersao(aceite, versaoVigente) {
  const gravada = textoLimpo(aceite && aceite.versao)
  const vigente = textoLimpo(versaoVigente)
  if (!gravada || !vigente) return false
  return gravada === vigente
}

/**
 * A pergunta central: esta pessoa pode ENTRAR na Operacao Comercial desta empresa?
 *
 * @param {object} sujeito
 * @param {string|null} sujeito.papel            `app.usuarios_empresas.role` (papel do VINCULO).
 * @param {string|null} sujeito.papelPlataforma  `app.usuarios.role` — so' `superadmin` importa.
 * @param {{versao: string, em: string|Date}|null} sujeito.aceite  ultimo aceite registrado.
 * @param {string} versaoVigente                 versao do termo no fonte (programa-termo.js).
 * @returns {{liberado: boolean, motivo: string, versao_exigida: string|null}}
 *          `motivo` e' vocabulario FECHADO, para log e tela. Nunca contem PII.
 */
function avaliarAcesso(sujeito, versaoVigente) {
  const s = sujeito || {}
  const vigente = textoLimpo(versaoVigente) || null

  if (s.papelPlataforma === PAPEL_PLATAFORMA) {
    return { liberado: true, motivo: MOTIVOS.PLATAFORMA, versao_exigida: null }
  }

  // Papel desconhecido cai aqui e passa — de proposito. Este modulo nao autoriza nada: quem nao
  // tem papel conhecido ja nao alcanca capacidade alguma (`capacidadesDoVinculo` devolve []), e
  // fazer o gate do TERMO barrar por papel invalido seria este modulo tomando, por tabela, uma
  // decisao de AUTORIZACAO que nao e' dele. Uma porta, uma pergunta.
  if (!papelSujeito(s.papel)) {
    return { liberado: true, motivo: MOTIVOS.NAO_SUJEITO, versao_exigida: null }
  }

  if (!s.aceite || !textoLimpo(s.aceite.versao)) {
    return { liberado: false, motivo: MOTIVOS.ACEITE_AUSENTE, versao_exigida: vigente }
  }
  if (!aceiteCobreVersao(s.aceite, vigente)) {
    return { liberado: false, motivo: MOTIVOS.ACEITE_DESATUALIZADO, versao_exigida: vigente }
  }
  return { liberado: true, motivo: MOTIVOS.ACEITE_VIGENTE, versao_exigida: null }
}

/** Atalho booleano para quem nao precisa do motivo. */
function podeEntrar(sujeito, versaoVigente) {
  return avaliarAcesso(sujeito, versaoVigente).liberado
}

/** O veredito barra o acesso? Lista explicita — motivo novo nasce liberando. */
function barra(motivo) {
  return MOTIVOS_QUE_BARRAM.includes(motivo)
}

// ─── Validacao do que a pessoa enviou ────────────────────────────────────────────────────
// Vocabulario FECHADO de recusa, pelo mesmo motivo dos MOTIVOS: a tela precisa dizer o que
// faltou, e "dados invalidos" nao diz.
const RECUSAS = Object.freeze({
  PROGRAMA_DESCONHECIDO: 'programa_desconhecido',
  VERSAO_DIVERGENTE: 'versao_divergente',
  MAIORIDADE_NAO_CONFIRMADA: 'maioridade_nao_confirmada',
  REGRAS_NAO_CONFIRMADAS: 'regras_nao_confirmadas',
})

/**
 * O aceite enviado e' valido?
 *
 * As duas confirmacoes exigem o booleano `true` LITERAL. `'false'`, `0` e `''` sao recusados de
 * proposito: `Boolean('false')` e' `true`, e um formulario mal serializado gravaria o oposto do
 * que a pessoa marcou. Mesma recusa explicita da migration 066 e de `permissoes` (070).
 *
 * A versao vai no corpo e e' CONFERIDA contra a vigente: se o termo mudar entre a tela abrir e o
 * botao ser clicado, a pessoa aceitou um texto e o sistema gravaria outro. Recusar e reapresentar
 * e' a unica resposta honesta.
 */
function validarAceite(entrada, { programa, versaoVigente } = {}) {
  const e = entrada || {}
  if (!programaConhecido(programa)) {
    return { ok: false, recusa: RECUSAS.PROGRAMA_DESCONHECIDO }
  }
  if (!aceiteCobreVersao({ versao: e.termo_versao }, versaoVigente)) {
    return { ok: false, recusa: RECUSAS.VERSAO_DIVERGENTE }
  }
  if (e.maioridade_confirmada !== true) {
    return { ok: false, recusa: RECUSAS.MAIORIDADE_NAO_CONFIRMADA }
  }
  if (e.regras_confirmadas !== true) {
    return { ok: false, recusa: RECUSAS.REGRAS_NAO_CONFIRMADAS }
  }
  return {
    ok: true,
    dados: {
      programa,
      termo_versao: textoLimpo(versaoVigente),
      maioridade_confirmada: true,
      regras_confirmadas: true,
    },
  }
}

module.exports = {
  PROGRAMA,
  PROGRAMAS,
  PAPEIS_SUJEITOS,
  PAPEL_PLATAFORMA,
  MOTIVOS,
  MOTIVOS_QUE_BARRAM,
  RECUSAS,
  papelSujeito,
  programaConhecido,
  aceiteCobreVersao,
  avaliarAcesso,
  podeEntrar,
  barra,
  validarAceite,
}
