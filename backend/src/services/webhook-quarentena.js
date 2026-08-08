'use strict'

// Quarentena de webhooks SEM DONO COMPROVADO — regras PURAS.
//
// POR QUE ESTE MÓDULO EXISTE
// `middleware/tenant.js` resolvia a empresa do webhook pela instância Evolution e, quando
// não conseguia, devolvia o `empresa_id` da PJ Codeworks. Isso não era um "default
// inofensivo": o atendimento seguia e gravava conversa, perfil de lead e evento comercial
// SOB A PJ, com dado de um negócio que não é a PJ. Medido em produção em 2026-08-08, das
// 6 conversas marcadas como PJ apenas 1 era PJ de verdade.
//
// Cada instância é um negócio separado. Para uma mensagem cuja origem não foi PROVADA não
// existe empresa padrão — existe pendência técnica. Este módulo decide quando é uma coisa
// e quando é a outra.
//
// SEM BANCO, HTTP, IA OU REDE. `crypto` entra só como função determinística de hash.
//
// PRIVACIDADE — invariantes deste arquivo:
//   - nada aqui loga; quem loga é o chamador, e só com o que `resumoPendencia` devolve;
//   - o id da mensagem sai daqui SEMPRE como hash (nunca em claro): ele é rastreável até
//     a conversa, e a quarentena não é dona de conversa nenhuma;
//   - telefone, texto, pushName e payload não entram nem saem deste módulo.

const { createHash } = require('node:crypto')

// ─── Procedência da empresa resolvida no webhook ──────────────────────────────
//
// Só `instancia` COMPROVA a empresa. Os outros três não são "fallbacks" (o fallback foi
// removido) — são as três formas de não saber de quem é a mensagem, e cada uma pede uma
// ação diferente do operador:
//   - sem_instancia          → o payload não identificou a instância. Configuração do
//                              webhook na Evolution, não cadastro faltando;
//   - instancia_desconhecida → a instância existe e fala, mas não tem vínculo autorizado
//                              em `app.empresa_whatsapp_instances` (nunca foi criada pelo
//                              Atendimento Views, ou o vínculo dela está desativado). NÃO
//                              se resolve cadastrando à mão — ver `acaoDoMotivo`;
//   - erro_resolucao         → falha TÉCNICA ao consultar (banco fora, timeout). Não pede
//                              cadastro: pede olhar a infraestrutura. Misturá-la com a
//                              anterior mandaria o operador procurar cadastro onde o
//                              problema é o serviço.
//
// Os valores são exatamente os motivos gravados em `app.webhook_quarentena.motivo`
// (CHECK fechado na migration 060) — um vocabulário só, não dois que precisam ser
// mantidos em sincronia.
const ORIGEM_EMPRESA = Object.freeze({
  INSTANCIA: 'instancia',
  SEM_INSTANCIA: 'sem_instancia',
  INSTANCIA_DESCONHECIDA: 'instancia_desconhecida',
  ERRO_RESOLUCAO: 'erro_resolucao',
})

const ORIGENS_EMPRESA = Object.freeze(Object.values(ORIGEM_EMPRESA))

/** A empresa deste webhook foi COMPROVADA pela instância? Só isso libera escrita. */
function empresaComprovada(origem) {
  return origem === ORIGEM_EMPRESA.INSTANCIA
}

/** Os motivos que vão para a quarentena — tudo que não é `instancia`. */
const MOTIVO_QUARENTENA = Object.freeze({
  SEM_INSTANCIA: ORIGEM_EMPRESA.SEM_INSTANCIA,
  INSTANCIA_DESCONHECIDA: ORIGEM_EMPRESA.INSTANCIA_DESCONHECIDA,
  ERRO_RESOLUCAO: ORIGEM_EMPRESA.ERRO_RESOLUCAO,
})

const MOTIVOS_QUARENTENA = Object.freeze(Object.values(MOTIVO_QUARENTENA))

/** Só `erro_resolucao` é falha técnica transitória — as outras duas são configuração. */
function motivoEhTransitorio(motivo) {
  return motivo === MOTIVO_QUARENTENA.ERRO_RESOLUCAO
}

/**
 * O que o operador precisa fazer. Fica aqui (regra), não na tela: a tela do desktop e a
 * resposta da API precisam dizer a MESMA coisa.
 *
 * `instancia_desconhecida` NÃO manda mais "cadastrar a instância". Cadastrar à mão um
 * número que apareceu sozinho era a adoção de instância externa — e um vínculo criado
 * depois não prova como a instância nasceu. A ação agora é AUDITAR a origem: se o número
 * é seu, ele volta pelo fluxo de criação dentro do Atendimento Views (que gera outro nome
 * técnico); se não é, o bloqueio já está fazendo o trabalho dele.
 */
function acaoDoMotivo(motivo) {
  if (motivo === MOTIVO_QUARENTENA.INSTANCIA_DESCONHECIDA) return 'auditar_origem_instancia'
  if (motivo === MOTIVO_QUARENTENA.SEM_INSTANCIA) return 'revisar_webhook_evolution'
  if (motivo === MOTIVO_QUARENTENA.ERRO_RESOLUCAO) return 'verificar_infraestrutura'
  return null
}

// ─── Normalização ─────────────────────────────────────────────────────────────

const MAX_NOME_INSTANCIA = 120

/**
 * Nome da instância como veio do payload, saneado para armazenar/exibir.
 * É texto de entrada externa: cortado no comprimento e limpo de caracteres de controle
 * (que quebrariam log estruturado e a tabela do painel). NÃO é dado pessoal — é o
 * identificador que o operador configurou na Evolution.
 */
function normalizarNomeInstancia(valor) {
  if (valor == null) return null
  const limpo = String(valor)
    // Caracteres de controle escritos como ESCAPE, nunca como byte cru no fonte.
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!limpo) return null
  return limpo.slice(0, MAX_NOME_INSTANCIA)
}

/**
 * Chave de deduplicação da pendência. Instância sem nome vira string vazia, e não NULL,
 * porque NULL não colide com NULL em índice único no Postgres — sem isto cada webhook
 * sem instância abriria uma linha nova.
 */
function chaveInstancia(nome) {
  return normalizarNomeInstancia(nome) || ''
}

/**
 * SHA-256 do id da mensagem. O id em claro identifica a mensagem dentro da conversa; a
 * quarentena só precisa saber "é a mesma de antes?", e para isso o hash basta.
 */
function hashMensagemId(mensagemId) {
  const s = mensagemId == null ? '' : String(mensagemId).trim()
  if (!s) return null
  return createHash('sha256').update(s).digest('hex')
}

// ─── Decisão ──────────────────────────────────────────────────────────────────

/**
 * A resolução de tenant deste webhook, a partir do que o middleware conseguiu apurar.
 *
 * Não recebe (e não pode receber) empresa nenhuma como sugestão: o único jeito de sair
 * daqui com `empresaId` preenchido é o vínculo da instância ter sido encontrado.
 *
 * @param {object} entrada
 * @param {string|null} entrada.instanceName nome cru da instância no payload
 * @param {{empresa:{id:string}, instanciaId:string}|null} entrada.vinculo resultado de
 *   `findEmpresaEInstanciaPorEvolution` — null quando a instância não está mapeada
 * @param {boolean} entrada.erro houve falha TÉCNICA ao consultar o vínculo
 * @returns {{
 *   processavel: boolean, empresaId: string|null, instanciaId: string|null,
 *   evolutionInstance: string|null, origem: string, pendencia: {motivo:string,
 *   evolutionInstance:string|null, instanciaChave:string, transitorio:boolean}|null
 * }}
 */
function resolverTenantWebhook({ instanceName = null, vinculo = null, erro = false } = {}) {
  const nome = normalizarNomeInstancia(instanceName)

  const emQuarentena = (motivo) => ({
    processavel: false,
    // Explicitamente nulos. É o ponto da tarefa: sem prova, sem dono — nem o da PJ.
    empresaId: null,
    instanciaId: null,
    evolutionInstance: nome,
    origem: motivo,
    pendencia: {
      motivo,
      evolutionInstance: nome,
      instanciaChave: chaveInstancia(nome),
      transitorio: motivoEhTransitorio(motivo),
    },
  })

  // A falha técnica é checada ANTES do vínculo: numa consulta que falhou, `vinculo` é
  // null pelo mesmo motivo que seria se a instância não existisse, e tratar as duas como
  // "não cadastrada" mandaria o operador cadastrar uma instância que já está lá.
  if (erro) return emQuarentena(MOTIVO_QUARENTENA.ERRO_RESOLUCAO)
  if (!nome) return emQuarentena(MOTIVO_QUARENTENA.SEM_INSTANCIA)
  if (!vinculo || !vinculo.empresa?.id || !vinculo.instanciaId) {
    return emQuarentena(MOTIVO_QUARENTENA.INSTANCIA_DESCONHECIDA)
  }

  return {
    processavel: true,
    empresaId: vinculo.empresa.id,
    instanciaId: vinculo.instanciaId,
    evolutionInstance: nome,
    origem: ORIGEM_EMPRESA.INSTANCIA,
    pendencia: null,
  }
}

// ─── Observabilidade (sem PII) ────────────────────────────────────────────────

/**
 * Resumo seguro da pendência para log.
 *
 * O nome da instância ENTRA (é configuração do operador, não dado de pessoa, e sem ele o
 * log não serve para nada). Telefone, texto, pushName, id de mensagem em claro e payload
 * NÃO entram — nem têm como, porque este módulo nunca os recebe.
 */
function resumoPendencia(pendencia, extra = {}) {
  if (!pendencia) return null
  return {
    operation: 'webhook_quarentena',
    motivo: pendencia.motivo,
    evolution_instance: pendencia.evolutionInstance,
    transitorio: pendencia.transitorio === true,
    acao: acaoDoMotivo(pendencia.motivo),
    ...extra,
  }
}

module.exports = {
  ORIGEM_EMPRESA,
  ORIGENS_EMPRESA,
  MOTIVO_QUARENTENA,
  MOTIVOS_QUARENTENA,
  MAX_NOME_INSTANCIA,
  empresaComprovada,
  motivoEhTransitorio,
  acaoDoMotivo,
  normalizarNomeInstancia,
  chaveInstancia,
  hashMensagemId,
  resolverTenantWebhook,
  resumoPendencia,
}
