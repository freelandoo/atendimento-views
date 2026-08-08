'use strict'
// MEDICAO READ-ONLY do isolamento por empresa. Dimensiona o risco ANTES de qualquer
// correcao em producao (Fase A) e ANTES de decidir a dimensao "instancia" (Fase C).
//
// GARANTIAS
//   - Roda dentro de `BEGIN TRANSACTION READ ONLY` e termina em ROLLBACK. Nao existe
//     caminho de escrita neste arquivo — nem CREATE, nem UPDATE, nem temp table.
//   - Imprime SOMENTE contagens agregadas. Nenhum telefone, nome, token, mensagem,
//     e-mail ou id de lead sai daqui. Ate' os ids de EMPRESA sao mascarados (8 primeiros
//     caracteres), que basta para distinguir tenants sem virar um cadastro de clientes.
//   - Nenhuma chamada externa (nao fala com a Meta, com a Evolution nem com a Bright Data).
//
// Uso:
//   node scripts/medir-isolamento-empresa.js            # usa DATABASE_URL do ambiente
//   DATABASE_URL=<url> node scripts/medir-isolamento-empresa.js
//
// Contra producao, exige confirmacao explicita do responsavel — o script nao escolhe
// banco sozinho: ele usa exatamente a DATABASE_URL que voce passar.

const { Pool } = require('pg')

const MASC = (v) => (v ? `${String(v).slice(0, 8)}…` : '(sem empresa)')

async function existeRelacao(client, nome) {
  const { rows } = await client.query('SELECT to_regclass($1) AS t', [nome])
  return !!(rows[0] && rows[0].t)
}

const MEDICOES = [
  {
    titulo: '1. lead_profiles com empresa_id divergente da conversa',
    async executar(client) {
      const { rows } = await client.query(`
        SELECT COUNT(*)::int                                                        AS perfis,
               COUNT(*) FILTER (WHERE lp.empresa_id IS DISTINCT FROM c.empresa_id)::int AS divergentes,
               COUNT(*) FILTER (WHERE lp.empresa_id IS DISTINCT FROM c.empresa_id
                                  AND lp.empresa_id = '00000000-0000-0000-0000-000000000001')::int AS divergentes_marcados_pj,
               COUNT(*) FILTER (WHERE lp.empresa_id IS NULL)::int                   AS sem_empresa,
               COUNT(*) FILTER (WHERE c.numero IS NULL)::int                        AS sem_conversa,
               COUNT(*) FILTER (WHERE c.empresa_id IS NULL)::int                    AS conversa_sem_empresa
          FROM vendas.lead_profiles lp
          LEFT JOIN vendas.conversas c ON c.numero = lp.numero
      `)
      return rows[0]
    },
  },
  {
    titulo: '2. lead_profiles de anuncio (meta_ads) — o recorte que a Meta usa',
    async executar(client) {
      const { rows } = await client.query(`
        SELECT COUNT(*)::int AS leads_meta_ads,
               COUNT(*) FILTER (WHERE lp.origem_anuncio->>'ctwa_clid' IS NOT NULL)::int AS com_ctwa_clid,
               COUNT(*) FILTER (WHERE lp.empresa_id IS DISTINCT FROM c.empresa_id)::int AS divergentes,
               COUNT(DISTINCT c.empresa_id)::int AS empresas_reais_envolvidas
          FROM vendas.lead_profiles lp
          LEFT JOIN vendas.conversas c ON c.numero = lp.numero
         WHERE lp.origem = 'meta_ads'
      `)
      return rows[0]
    },
  },
  {
    titulo: '3. Conversas x instancia (ausente / orfa / contraditoria com a empresa)',
    async executar(client) {
      const { rows } = await client.query(`
        SELECT COUNT(*)::int AS conversas,
               COUNT(*) FILTER (WHERE COALESCE(c.evolution_instance, '') = '')::int AS sem_instancia,
               COUNT(*) FILTER (WHERE COALESCE(c.evolution_instance, '') <> ''
                                  AND i.evolution_instance IS NULL)::int            AS instancia_orfa,
               COUNT(*) FILTER (WHERE i.evolution_instance IS NOT NULL
                                  AND i.empresa_id IS DISTINCT FROM c.empresa_id)::int AS instancia_de_outra_empresa,
               COUNT(*) FILTER (WHERE c.empresa_id IS NULL)::int                    AS conversa_sem_empresa,
               COUNT(*) FILTER (WHERE c.empresa_id = '00000000-0000-0000-0000-000000000001')::int AS conversa_marcada_pj
          FROM vendas.conversas c
          LEFT JOIN app.empresa_whatsapp_instances i ON i.evolution_instance = c.evolution_instance
      `)
      return rows[0]
    },
  },
  {
    titulo: '4. Empresas e instancias ativas',
    async executar(client) {
      const { rows } = await client.query(`
        SELECT COUNT(*)::int                                          AS empresas_com_instancia,
               COUNT(*) FILTER (WHERE ativas >= 1)::int               AS com_1_ou_mais_ativas,
               COUNT(*) FILTER (WHERE ativas >= 2)::int               AS com_2_ou_mais_ativas,
               COALESCE(MAX(ativas), 0)::int                          AS max_instancias_ativas_numa_empresa
          FROM (
            SELECT empresa_id, COUNT(*) FILTER (WHERE ativo)::int AS ativas
              FROM app.empresa_whatsapp_instances
             GROUP BY empresa_id
          ) t
      `)
      return rows[0]
    },
  },
  {
    titulo: '5. Telefone visto em MAIS DE UMA instancia (tabela do Evolution)',
    async executar(client) {
      if (!(await existeRelacao(client, 'public."Message"'))) {
        return { indisponivel: 'tabela public."Message" nao existe neste banco' }
      }
      // Sem telefone na saida: so' quantos telefones distintos apareceram em 2+ instancias.
      const { rows } = await client.query(`
        SELECT COUNT(*)::int                                   AS telefones_distintos,
               COUNT(*) FILTER (WHERE instancias >= 2)::int     AS em_2_ou_mais_instancias,
               COALESCE(MAX(instancias), 0)::int                AS max_instancias_por_telefone
          FROM (
            SELECT m.key->>'remoteJidAlt' AS telefone,
                   COUNT(DISTINCT m."instanceId")::int AS instancias
              FROM public."Message" m
             WHERE m.key->>'remoteJidAlt' LIKE '%@s.whatsapp.net'
               AND m."messageTimestamp" > extract(epoch from now() - interval '90 days')
             GROUP BY 1
          ) t
      `)
      return rows[0]
    },
  },
  {
    titulo: '6. Reunioes recentes (45d) com atribuicao CTWA — volume da Fase B',
    async executar(client) {
      const app = await client.query(`
        SELECT COUNT(*)::int AS reunioes,
               COUNT(*) FILTER (WHERE lp.origem_anuncio->>'ctwa_clid' IS NOT NULL)::int AS com_ctwa_hoje,
               COUNT(*) FILTER (WHERE lp2.origem_anuncio->>'ctwa_clid' IS NOT NULL)::int AS com_ctwa_se_corrigido
          FROM app.agenda_eventos e
          LEFT JOIN vendas.lead_profiles lp
                 ON lp.empresa_id = e.empresa_id
                AND regexp_replace(lp.numero, '\\D', '', 'g')
                    = regexp_replace(COALESCE(e.lead_telefone, ''), '\\D', '', 'g')
          LEFT JOIN vendas.lead_profiles lp2
                 ON regexp_replace(lp2.numero, '\\D', '', 'g')
                    = regexp_replace(COALESCE(e.lead_telefone, ''), '\\D', '', 'g')
         WHERE e.tipo = 'reuniao' AND e.excluido_em IS NULL
           AND GREATEST(e.criado_em, e.atualizado_em) > NOW() - interval '45 days'
      `)
      const vendas = await client.query(`
        SELECT COUNT(*)::int AS reunioes,
               COUNT(*) FILTER (WHERE lp.origem_anuncio->>'ctwa_clid' IS NOT NULL)::int AS com_ctwa_hoje,
               COUNT(*) FILTER (WHERE lp2.origem_anuncio->>'ctwa_clid' IS NOT NULL)::int AS com_ctwa_se_corrigido,
               COUNT(DISTINCT c.empresa_id)::int AS empresas_envolvidas
          FROM vendas.agenda_eventos e
          JOIN vendas.conversas c
                 ON regexp_replace(c.numero, '\\D', '', 'g')
                    = regexp_replace(COALESCE(e.metadata->>'lead_numero', ''), '\\D', '', 'g')
          LEFT JOIN vendas.lead_profiles lp
                 ON lp.empresa_id = c.empresa_id
                AND regexp_replace(lp.numero, '\\D', '', 'g') = regexp_replace(c.numero, '\\D', '', 'g')
          LEFT JOIN vendas.lead_profiles lp2
                 ON regexp_replace(lp2.numero, '\\D', '', 'g') = regexp_replace(c.numero, '\\D', '', 'g')
         WHERE e.tipo = 'reuniao' AND e.excluido_em IS NULL
           AND GREATEST(e.criado_em, e.atualizado_em) > NOW() - interval '45 days'
      `)
      return { agenda_app: app.rows[0], agenda_bot: vendas.rows[0] }
    },
  },
  {
    titulo: '7. Integracoes Meta configuradas (existe risco de envio agora?)',
    async executar(client) {
      if (!(await existeRelacao(client, 'app.meta_integracoes'))) {
        return { indisponivel: 'tabela app.meta_integracoes ainda nao existe (migration 057 nao aplicada)' }
      }
      const { rows } = await client.query(`
        SELECT COUNT(*)::int AS integracoes,
               COUNT(*) FILTER (WHERE status = 'ativa')::int AS ativas,
               COUNT(*) FILTER (WHERE status = 'em_teste')::int AS em_teste
          FROM app.meta_integracoes
      `)
      return rows[0]
    },
  },
  {
    // A procedencia `conversa` do perfil so' vale o que a CONVERSA vale: se a empresa
    // dela veio do fallback da PJ (instancia ausente ou nao mapeada, tenant.js), o
    // carimbo dira' 'conversa' sem que ninguem tenha de fato resolvido a empresa.
    // Este e' o numero que a Fase B precisa para decidir em que confiar.
    titulo: '8. Conversas da PJ cuja empresa pode ter vindo do FALLBACK (nao da instancia)',
    async executar(client) {
      const { rows } = await client.query(`
        WITH c AS (
          SELECT c.numero,
                 c.empresa_id,
                 CASE
                   WHEN COALESCE(c.evolution_instance, '') = ''      THEN 'sem_instancia'
                   WHEN i.evolution_instance IS NULL                 THEN 'instancia_nao_mapeada'
                   ELSE 'resolvida_pela_instancia'
                 END AS procedencia
            FROM vendas.conversas c
            LEFT JOIN app.empresa_whatsapp_instances i ON i.evolution_instance = c.evolution_instance
           WHERE c.empresa_id = '00000000-0000-0000-0000-000000000001'
        )
        SELECT COUNT(*)::int                                                          AS conversas_pj,
               COUNT(*) FILTER (WHERE procedencia = 'sem_instancia')::int             AS pj_sem_instancia,
               COUNT(*) FILTER (WHERE procedencia = 'instancia_nao_mapeada')::int     AS pj_instancia_nao_mapeada,
               COUNT(*) FILTER (WHERE procedencia = 'resolvida_pela_instancia')::int  AS pj_confirmada_pela_instancia,
               COUNT(lp.id)::int                                                      AS perfis_nessas_conversas,
               COUNT(lp.id) FILTER (WHERE procedencia <> 'resolvida_pela_instancia')::int AS perfis_de_procedencia_duvidosa
          FROM c
          LEFT JOIN vendas.lead_profiles lp ON lp.numero = c.numero
      `)
      return rows[0]
    },
  },
  {
    titulo: '9. Distribuicao de conversas por empresa (ids mascarados)',
    async executar(client) {
      const { rows } = await client.query(`
        SELECT c.empresa_id, COUNT(*)::int AS conversas
          FROM vendas.conversas c
         GROUP BY 1
         ORDER BY 2 DESC
         LIMIT 20
      `)
      const out = {}
      for (const r of rows) out[MASC(r.empresa_id)] = r.conversas
      return out
    },
  },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL nao definida. Passe explicitamente qual banco medir.')
    process.exit(1)
  }
  const pool = new Pool({
    connectionString: url,
    ssl: /railway|amazonaws|supabase|neon|render/i.test(url) ? { rejectUnauthorized: false } : undefined,
  })
  const client = await pool.connect()
  const resultado = {}
  try {
    // READ ONLY de verdade: o proprio Postgres recusa qualquer escrita nesta sessao.
    await client.query('BEGIN TRANSACTION READ ONLY')
    for (const m of MEDICOES) {
      try {
        resultado[m.titulo] = await m.executar(client)
      } catch (e) {
        resultado[m.titulo] = { erro: e.message }
      }
    }
    await client.query('ROLLBACK')
  } finally {
    client.release()
    await pool.end()
  }

  console.log('')
  console.log('══════════════════════════════════════════════════════════')
  console.log(' MEDICAO READ-ONLY — isolamento por empresa')
  console.log(` ${new Date().toISOString()}`)
  console.log('══════════════════════════════════════════════════════════')
  for (const [titulo, dados] of Object.entries(resultado)) {
    console.log('')
    console.log(titulo)
    console.log(JSON.stringify(dados, null, 2))
  }
  console.log('')
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\nFalhou:', e && e.message ? e.message : e)
    process.exit(1)
  })
}

module.exports = { MEDICOES }
