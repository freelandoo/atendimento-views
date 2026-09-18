'use strict'
// Autorização do CRM em EQUIPE — módulo PURO e dono ÚNICO do vocabulário de acesso.
// Sem banco, sem HTTP, sem IA, sem rede: testável com `node --test`.
// Mesmo padrão de services/conversa-modo-ia.js, instancia-envio.js e site-classificacao.js.
//
// ─── A PERGUNTA QUE ESTE MÓDULO RESPONDE ─────────────────────────────────────────────
// Ele NÃO responde "qual o papel deste usuário?", e sim **"esta capacidade está liberada para
// este vínculo?"**. A primeira pergunta admite resposta por heurística, e foi heurística
// (fallback para a PJ no webhook, instância "mais recentemente atualizada", papel GLOBAL valendo
// dentro de qualquer empresa) que produziu todos os defeitos desta família neste repositório.
//
// ─── O DEFEITO QUE ELE EXISTE PARA CORRIGIR ──────────────────────────────────────────
// `app.usuarios_empresas.role` existe desde a migration 001, é escrito em 3 lugares e nunca
// autorizou nada: `requireRole` lê `app.usuarios.role`, que é GLOBAL. Consequência medida: quem
// é `admin` global é admin em TODA empresa a que pertença. A partir daqui o papel que autoriza é
// o do VÍNCULO; `app.usuarios.role` fica restrito a `superadmin` = operador da plataforma.
//
// ─── PROIBIÇÕES (com guarda de regressão em test/acesso-capacidades.test.js) ──────────
//  1. Comparar papel ou capacidade com LITERAL fora deste módulo. Quem pergunta usa
//     `podeCapacidade(...)` / `CAPACIDADES.X`. Um `if (papel === 'admin')` espalhado pelas rotas
//     é como a matriz vira ficção.
//  2. `permissoes` NEGAR algo que o papel permite. Concessão é SOMENTE ADITIVA. Sem isso nasce o
//     estado "o papel diz sim, o override diz não", e a resposta a "por que ele não consegue?"
//     deixa de ser derivável do papel. Negar = trocar o papel.
//  3. Capacidade desconhecida virar permissão. Exigência que este módulo não conhece NEGA —
//     um enum novo escrito errado não pode abrir porta.
//
// ─── ESTADO NA ETAPA 1 (fundação) ────────────────────────────────────────────────────
// Nada consome esta matriz ainda. `requireCapacidade` nasce sem chamador de propósito: a troca
// dos mounts `requireRole('admin')` por capacidade é a Etapa 6, uma rota por commit, com teste
// de permissão por rota. Ver docs/plano-execucao-crm-equipe.md.

// ─── Papéis POR EMPRESA (app.usuarios_empresas.role) ─────────────────────────────────
// Espelha a CHECK app_usuarios_empresas_role_chk (migration 070). A ordem é do mais para o
// menos privilegiado e é usada só para legibilidade — a autorização NUNCA é por comparação de
// nível. Hierarquia numérica foi justamente o que impediu o papel comercial de existir: ele
// precisa de MAIS que `member` (operar ligação) e MENOS que `admin` (não gastar coleta paga).
const PAPEIS = Object.freeze(['owner', 'admin', 'comercial', 'member'])

// `superadmin` NÃO é papel de empresa: é o operador da PLATAFORMA (app.usuarios.role) e passa em
// tudo, em qualquer empresa. Fica aqui nomeado para ninguém escrever o literal nas rotas.
const PAPEL_PLATAFORMA = 'superadmin'

// ─── Capacidades ─────────────────────────────────────────────────────────────────────
// Uma capacidade é uma AÇÃO de negócio, não uma rota e não uma tela. Rotas mudam de caminho;
// telas mudam de nome; "disparar mensagem em lote pela Evolution" continua sendo a mesma decisão.
const CAPACIDADES = Object.freeze({
  // Aquisição e triagem — o lado da COLETA
  AQUISICAO_GERENCIAR: 'aquisicao_gerenciar',       // buscar, importar, rotinas (coleta PAGA)
  LEAD_TRIAR: 'lead_triar',                         // aprovar / descartar (a porta)
  LEAD_VER_BRUTOS: 'lead_ver_brutos',               // ver 'pendente'/'legado'/'descartado'

  // Banco de Leads — o lado do TRABALHO
  LEAD_VER_APROVADOS: 'lead_ver_aprovados',
  LEAD_ASSUMIR: 'lead_assumir',                     // pegar lead livre (claim)
  LEAD_ABORDAR_MANUAL: 'lead_abordar_manual',       // wa.me + "marcar como enviado"
  LEAD_DISPARAR_SEMI: 'lead_disparar_semi',         // preparar/enviar rascunhos do modo semi
  LEAD_DISPARAR_LOTE: 'lead_disparar_lote',         // envio pela Evolution (teto/reputação)
  LEAD_TRANSFERIR: 'lead_transferir',               // mexer no responsável de OUTRA pessoa

  // Central de Mensagens
  CONVERSA_ATENDER: 'conversa_atender',             // ler e responder as suas conversas
  CONVERSA_VER_TODAS: 'conversa_ver_todas',
  CONVERSA_GERENCIAR_IA: 'conversa_gerenciar_ia',   // modo_ia / pausar agente / ativar instância
  CONVERSA_APAGAR_HISTORICO: 'conversa_apagar_historico',

  // Central de Ligações
  LIGACAO_OPERAR: 'ligacao_operar',                 // fila, ligar, registrar
  LIGACAO_VER_TODAS: 'ligacao_ver_todas',
  CAMPANHA_GERENCIAR: 'campanha_gerenciar',         // criar campanha, adicionar leads nela

  // Follow-ups
  FOLLOWUP_VER_FILA: 'followup_ver_fila',           // fila da EMPRESA (visibilidade geral)
  FOLLOWUP_OPERAR: 'followup_operar',               // criar / concluir / reagendar os seus
  FOLLOWUP_REATRIBUIR: 'followup_reatribuir',
  FOLLOWUP_CONFIG_EMPRESA: 'followup_config_empresa', // pausar o automático da empresa

  // Roteiros
  ROTEIRO_LER: 'roteiro_ler',                       // necessário para conduzir a ligação
  ROTEIRO_GERENCIAR: 'roteiro_gerenciar',

  // Agenda
  AGENDA_OPERAR_PROPRIA: 'agenda_operar_propria',
  AGENDA_VER_EQUIPE: 'agenda_ver_equipe',

  // Instâncias
  INSTANCIA_GERENCIAR_PROPRIA: 'instancia_gerenciar_propria',
  INSTANCIA_GERENCIAR_EMPRESA: 'instancia_gerenciar_empresa',
  INSTANCIA_GERENCIAR_CONTEXTO: 'instancia_gerenciar_contexto', // conhecimento = ativo da empresa

  // Comissão do comercial (migration 083)
  // Ver a PRÓPRIA comissão é do trabalho: um programa de comissão que a pessoa não consegue
  // conferir é uma promessa sem prova. Mexer no plano, registrar venda e dar baixa em pagamento
  // é gestão — quem define quanto se paga não pode ser quem recebe.
  COMISSAO_VER_PROPRIA: 'comissao_ver_propria',
  COMISSAO_GERENCIAR: 'comissao_gerenciar',

  // Administração da empresa
  MEMBROS_GERENCIAR: 'membros_gerenciar',
  INTEGRACOES_GERENCIAR: 'integracoes_gerenciar',   // Meta, e-mail, modelo de IA, prompts, custos
  RELATORIOS_VER: 'relatorios_ver',
})

const TODAS_CAPACIDADES = Object.freeze(Object.values(CAPACIDADES))

// ─── A matriz. Ela É a regra inteira. ────────────────────────────────────────────────
// `owner` e `admin` são IDÊNTICOS aqui de propósito: a diferença entre eles não é uma
// capacidade, é uma regra dentro de "Contas da empresa" (um `admin` não desativa o `owner` nem
// troca o dono). Criar uma capacidade `empresa_gerenciar` sem consumidor seria criar código
// morto nascendo pronto.
const COMERCIAL = Object.freeze([
  CAPACIDADES.LEAD_VER_APROVADOS,
  CAPACIDADES.LEAD_ASSUMIR,
  CAPACIDADES.LEAD_ABORDAR_MANUAL,
  CAPACIDADES.LEAD_DISPARAR_SEMI,
  CAPACIDADES.CONVERSA_ATENDER,
  CAPACIDADES.LIGACAO_OPERAR,
  CAPACIDADES.FOLLOWUP_OPERAR,
  CAPACIDADES.ROTEIRO_LER,
  CAPACIDADES.AGENDA_OPERAR_PROPRIA,
  CAPACIDADES.INSTANCIA_GERENCIAR_PROPRIA,
  CAPACIDADES.COMISSAO_VER_PROPRIA,
])

// `member` é o papel LEGADO de compatibilidade (decisão C de docs/especificacao-crm-equipe.md):
// hoje um `user` global alcança `/conversas`, `/agenda`, `/whatsapp` e `/contextos`, e vê TODAS
// as conversas da empresa. Ele mantém isso — inclusive `CONVERSA_VER_TODAS`, que o `comercial`
// NÃO tem. Não é incoerência: `comercial` é o papel novo, recortado por ownership; `member` é o
// que já existia e não pode quebrar.
//
// ⚠️ MUDANÇA DE COMPORTAMENTO DECLARADA, a confirmar antes da Etapa 6 (ver plano, item Q1):
// `member` PERDE duas ações que hoje alcança em `/conversas`: ligar/desligar a IA
// (`CONVERSA_GERENCIAR_IA`) e apagar histórico (`CONVERSA_APAGAR_HISTORICO`). Manter a primeira
// tornaria o toggle de IA — a capacidade sensível que motivou este trabalho — liberada por
// padrão justamente para o papel menos privilegiado; a segunda é destrutiva e irreversível.
// Nada disso vale nesta etapa: nenhuma rota consome a matriz ainda.
const MEMBER = Object.freeze([
  CAPACIDADES.CONVERSA_ATENDER,
  CAPACIDADES.CONVERSA_VER_TODAS,
  CAPACIDADES.AGENDA_OPERAR_PROPRIA,
  CAPACIDADES.INSTANCIA_GERENCIAR_PROPRIA,
])

const MATRIZ = Object.freeze({
  owner: Object.freeze([...TODAS_CAPACIDADES]),
  admin: Object.freeze([...TODAS_CAPACIDADES]),
  comercial: COMERCIAL,
  member: MEMBER,
})

// Índice para consulta O(1). Construído a partir da MATRIZ — nunca escrito à mão duas vezes.
const _MATRIZ_SET = Object.freeze(
  Object.fromEntries(Object.entries(MATRIZ).map(([papel, caps]) => [papel, new Set(caps)]))
)
const _CAPACIDADES_SET = new Set(TODAS_CAPACIDADES)

/** A capacidade existe neste vocabulário? Nome desconhecido NEGA (nunca lança). */
function capacidadeConhecida(capacidade) {
  return typeof capacidade === 'string' && _CAPACIDADES_SET.has(capacidade)
}

/** O papel pertence ao vocabulário de papéis POR EMPRESA? */
function papelConhecido(papel) {
  return typeof papel === 'string' && PAPEIS.includes(papel)
}

/**
 * Concessões aditivas de um vínculo, saneadas.
 * Aceita só `true` como concessão (string 'false' e 0 não viram permissão — `Boolean('false')`
 * é `true`, e foi esse tipo de coerção que a migration 066 teve de recusar explicitamente).
 * Chave que não é capacidade conhecida é IGNORADA: um typo em `permissoes` não abre porta e
 * também não quebra o request.
 */
function concessoesDe(permissoes) {
  if (!permissoes || typeof permissoes !== 'object' || Array.isArray(permissoes)) return []
  return Object.keys(permissoes)
    .filter((k) => permissoes[k] === true && capacidadeConhecida(k))
}

// Vocabulário FECHADO de motivos. Existe para o log e a tela explicarem a recusa sem inventar
// texto, e para o teste poder afirmar POR QUE algo foi negado (um `false` sozinho não distingue
// "o papel não alcança" de "a capacidade não existe" — e as duas pedem ações opostas).
const MOTIVOS = Object.freeze({
  PLATAFORMA: 'plataforma',                           // superadmin da plataforma
  PAPEL: 'papel',                                     // a matriz permite
  CONCESSAO: 'concessao',                             // liberado pontualmente pelo admin
  PAPEL_NAO_ALCANCA: 'papel_nao_alcanca',
  SEM_VINCULO: 'sem_vinculo',                         // papel ausente/desconhecido
  CAPACIDADE_DESCONHECIDA: 'capacidade_desconhecida', // nome fora do vocabulário
})

/**
 * A pergunta central.
 *
 * @param {object} vinculo
 * @param {string|null} vinculo.papel        `app.usuarios_empresas.role` (papel EFETIVO).
 * @param {object|null} vinculo.permissoes   `app.usuarios_empresas.permissoes` (aditivas).
 * @param {string|null} vinculo.papelPlataforma `app.usuarios.role` — só `superadmin` importa.
 * @param {string} capacidade                uma de CAPACIDADES.
 * @returns {{permitido: boolean, motivo: string}}  `motivo` é vocabulário FECHADO, para log e
 *          para a tela explicarem a recusa sem inventar texto. Nunca contém PII.
 */
function avaliarCapacidade(vinculo, capacidade) {
  if (!capacidadeConhecida(capacidade)) {
    return { permitido: false, motivo: MOTIVOS.CAPACIDADE_DESCONHECIDA }
  }
  const v = vinculo || {}
  if (v.papelPlataforma === PAPEL_PLATAFORMA) {
    return { permitido: true, motivo: MOTIVOS.PLATAFORMA }
  }
  if (!papelConhecido(v.papel)) {
    return { permitido: false, motivo: MOTIVOS.SEM_VINCULO }
  }
  if (_MATRIZ_SET[v.papel].has(capacidade)) {
    return { permitido: true, motivo: MOTIVOS.PAPEL }
  }
  if (concessoesDe(v.permissoes).includes(capacidade)) {
    return { permitido: true, motivo: MOTIVOS.CONCESSAO }
  }
  return { permitido: false, motivo: MOTIVOS.PAPEL_NAO_ALCANCA }
}

/** Atalho booleano. Use quando o motivo não importa. */
function podeCapacidade(vinculo, capacidade) {
  return avaliarCapacidade(vinculo, capacidade).permitido
}

/** Todas as capacidades efetivas de um vínculo (papel + concessões). Ordem estável. */
function capacidadesDoVinculo(vinculo) {
  const v = vinculo || {}
  if (v.papelPlataforma === PAPEL_PLATAFORMA) return [...TODAS_CAPACIDADES]
  if (!papelConhecido(v.papel)) return []
  const efetivas = new Set(_MATRIZ_SET[v.papel])
  for (const c of concessoesDe(v.permissoes)) efetivas.add(c)
  return TODAS_CAPACIDADES.filter((c) => efetivas.has(c))
}

/**
 * As capacidades que o admin pode CONCEDER a um papel — as que o papel ainda não tem.
 * É o que a tela de "Contas da empresa" (Etapa 2) precisa para oferecer concessões sem oferecer
 * o que já está incluído. Papel desconhecido devolve [] (não se concede a quem não tem vínculo).
 */
function concedeveisPara(papel) {
  if (!papelConhecido(papel)) return []
  return TODAS_CAPACIDADES.filter((c) => !_MATRIZ_SET[papel].has(c))
}

module.exports = {
  PAPEIS,
  PAPEL_PLATAFORMA,
  CAPACIDADES,
  TODAS_CAPACIDADES,
  MATRIZ,
  MOTIVOS,
  capacidadeConhecida,
  papelConhecido,
  concessoesDe,
  avaliarCapacidade,
  podeCapacidade,
  capacidadesDoVinculo,
  concedeveisPara,
}
