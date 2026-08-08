'use strict'

// Fonte UNICA de como `vendas.lead_profiles.empresa_id` é escrito.
//
// PROBLEMA QUE ESTE MODULO RESOLVE
// A migration 006 pôs `DEFAULT '<PJ>'` na coluna porque, na época, nenhum insert
// informava empresa e o campo ficava NULL. O default nunca saiu — e como NENHUM dos
// quatro caminhos que inserem perfil informa `empresa_id`, todo lead de toda empresa
// nasce marcado como PJ. O consumidor que sofre é a Meta: `meta-dispatch` casa
// `lp.empresa_id` com a empresa da reunião/conversa, o join não fecha, o lead conta
// como "sem atribuição" e a conversão do tenant simplesmente nunca sai.
//
// POR QUE A EMPRESA VEM DA CONVERSA, E NAO DE UM PARAMETRO DO CHAMADOR
//   1. É a MESMA coluna com que os consumidores casam (`lp.empresa_id = c.empresa_id`
//      em meta-dispatch.js). Um parâmetro que discordasse da conversa reintroduziria
//      exatamente o bug que esta correção existe para fechar.
//   2. `lead_profiles.numero` é `REFERENCES vendas.conversas(numero)`: não existe
//      perfil sem conversa. A fonte está sempre disponível no INSERT.
//   3. Nem a IA nem as rotas alcançam o campo — `empresa_id` não está na whitelist
//      `LEAD_PROFILE_CAMPOS_PERMITIDOS`, e aqui o valor nasce de uma subconsulta, não
//      de entrada externa. Não há como poluir a atribuição por payload.
//
// O UPSERT NUNCA MIGRA O DONO (mesmo contrato de `salvarConversa`): a empresa é fixada
// na criação do perfil. Corrigir linha antiga é trabalho do backfill, com simulação,
// lote e rollback — não de um UPDATE silencioso no meio do atendimento.

const EMPRESA_PADRAO_PJ = '00000000-0000-0000-0000-000000000001'

// Procedência do valor gravado. É o que permitirá à Meta (Fase B) RECUSAR atribuição não
// confiável sem que o fallback precise ser removido agora.
//
//   conversa_confirmada     — a empresa veio da conversa E a instância WhatsApp dela
//                             aponta para essa MESMA empresa. Confiável.
//   conversa_nao_confirmada — a empresa veio da conversa, mas nada a confirmou: a conversa
//                             não tem instância, ou a instância não está mapeada em
//                             app.empresa_whatsapp_instances, ou a empresa é o fallback da
//                             PJ (middleware/tenant.js). NÃO É CONFIÁVEL.
//   NULL                    — linha anterior a esta correção. Também não confiável.
//
// POR QUE A CONFIRMAÇÃO PELA INSTÂNCIA, E NÃO SÓ "veio da conversa"
// Medição em produção (2026-08-08): das 6 conversas marcadas como PJ, apenas 1 é PJ de
// verdade — 2 estão sem instância e 3 têm instância não mapeada. Carimbar essas como
// "veio da conversa" entregaria à Fase B uma confiança que não existe: a conversa só vale
// o que a resolução dela valeu. Quem escreveu o valor (código de atendimento ou backfill)
// NÃO entra nesta coluna de propósito — esse rastro vive em
// vendas.lead_profiles_empresa_backfill, que é auditoria, não semântica.
const ORIGENS_EMPRESA_ID = ['conversa_confirmada', 'conversa_nao_confirmada']
const ORIGENS_CONFIAVEIS = ['conversa_confirmada']

function assertPlaceholder(nome, valor) {
  if (!/^\$\d+$/.test(String(valor || ''))) {
    throw new Error(`lead-profile-empresa: ${nome} precisa ser um placeholder ($1, $2, ...) — recebido: ${valor}`)
  }
}

/** Subconsulta escalar que lê a empresa da conversa dona do telefone. */
function sqlEmpresaDaConversa(numeroParam) {
  assertPlaceholder('numeroParam', numeroParam)
  return `(SELECT c.empresa_id FROM vendas.conversas c WHERE c.numero = ${numeroParam})`
}

/**
 * A empresa da conversa foi CONFIRMADA pela instância WhatsApp dela?
 * Dois índices únicos (`conversas.numero`, `empresa_whatsapp_instances.evolution_instance`)
 * — custo desprezível mesmo no caminho quente do atendimento.
 */
function sqlEmpresaConfirmadaPelaInstancia(numeroParam) {
  assertPlaceholder('numeroParam', numeroParam)
  return (
    `EXISTS (SELECT 1 FROM vendas.conversas c ` +
    `JOIN app.empresa_whatsapp_instances i ON i.evolution_instance = c.evolution_instance ` +
    `WHERE c.numero = ${numeroParam} AND i.empresa_id = c.empresa_id)`
  )
}

/**
 * Colunas e valores de empresa para um INSERT em vendas.lead_profiles.
 * @param {string} numeroParam placeholder do telefone (ex.: '$1')
 * @param {string} pjParam     placeholder da empresa padrão PJ (ex.: '$5')
 */
function insertEmpresa(numeroParam, pjParam) {
  assertPlaceholder('pjParam', pjParam)
  const conversa = sqlEmpresaDaConversa(numeroParam)
  const confirmada = sqlEmpresaConfirmadaPelaInstancia(numeroParam)
  return {
    colunas: 'empresa_id, empresa_id_origem',
    valores:
      `COALESCE(${conversa}, ${pjParam}::uuid), ` +
      `CASE WHEN ${confirmada} THEN 'conversa_confirmada' ELSE 'conversa_nao_confirmada' END`,
  }
}

/**
 * Cláusulas SET do `ON CONFLICT (numero) DO UPDATE`. Só preenchem a empresa quando a
 * linha existente ainda está sem dono; jamais reescrevem uma atribuição já feita.
 */
function conflitoEmpresa() {
  return (
    'empresa_id = COALESCE(vendas.lead_profiles.empresa_id, EXCLUDED.empresa_id), ' +
    'empresa_id_origem = CASE WHEN vendas.lead_profiles.empresa_id IS NULL ' +
    'THEN EXCLUDED.empresa_id_origem ELSE vendas.lead_profiles.empresa_id_origem END'
  )
}

module.exports = {
  EMPRESA_PADRAO_PJ,
  ORIGENS_EMPRESA_ID,
  ORIGENS_CONFIAVEIS,
  sqlEmpresaDaConversa,
  sqlEmpresaConfirmadaPelaInstancia,
  insertEmpresa,
  conflitoEmpresa,
}
