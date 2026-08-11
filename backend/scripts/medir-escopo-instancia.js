'use strict'
// MEDICAO READ-ONLY do escopo por INSTANCIA de WhatsApp — Fase 0 do plano registrado em
// `docs/analise-contexto-instancia.md`.
//
// POR QUE ESTE SCRIPT EXISTE
// A plataforma ja identifica empresa E instancia no webhook (middleware/tenant.js), mas quase
// todos os modulos operacionais ainda trabalham no escopo da EMPRESA. Antes de mexer em
// qualquer regra, filtro, schema ou automacao, e' preciso saber a exposicao REAL do ambiente:
// quantas empresas ja operam com mais de um numero, quantas conversas estao sem instancia
// gravada e quantas dessas poderiam ser atribuidas com seguranca. Sem esses numeros, a ordem
// das proximas fases e' chute.
//
// O QUE ELE **NAO** FAZ (declarado, e e' proposital)
//   - nao corrige o envio pela instancia errada (whatsapp.js:51-60);
//   - nao altera a precedencia de `evolution_instance` nas conversas (db-crud.js:154);
//   - nao mexe no teto diario do "Rodar leads" nem em configuracao alguma;
//   - nao cria o seletor por instancia, nem filtro, nem coluna, nem migration.
// Ele MEDE. Nada mais.
//
// GARANTIAS DE SEGURANCA
//   - Roda inteiro dentro de `BEGIN TRANSACTION READ ONLY` e termina em `ROLLBACK`. O proprio
//     Postgres recusa escrita nesta sessao, entao a garantia nao depende de eu ter lido o SQL
//     com atencao. Nao existe INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE neste arquivo —
//     nem temp table, nem `SELECT INTO`. Ha guarda de regressao em
//     `test/medir-escopo-instancia.test.js` que le este fonte e falha se algum aparecer.
//   - Imprime SOMENTE contagens agregadas e ids MASCARADOS (8 primeiros caracteres). Nenhum
//     telefone, JID, nome de lead, mensagem, token ou credencial sai daqui. O prefixo
//     mascarado basta para achar a empresa/instancia em Configuracoes > Instancias.
//   - `--nomes` revela o nome tecnico/rotulo das INSTANCIAS (nunca telefone, nunca lead).
//     E opt-in porque a saida padrao precisa ser colavel em qualquer lugar.
//   - Nenhuma chamada externa: nao fala com a Evolution, com a Meta nem com a Bright Data.
//   - Nenhuma dependencia nova (`pg` ja e' dependencia do projeto).
//   - O script NUNCA escolhe banco sozinho: usa exatamente a `DATABASE_URL` que voce passar.
//
// REGRA DE NEGOCIO QUE ELE RESPEITA — nao se inventa dono
// Conversa SEM `evolution_instance` nao tem vinculo PROVADO com instancia alguma. Agrupar por
// `c.empresa_id` e' informativo, nunca prova: aquele `empresa_id` pode ter vindo do antigo
// fallback da PJ (ver AGENTS.md, "Quarentena de webhook"). Por isso a atribuibilidade e'
// classificada de forma conservadora (ver `classificarAtribuibilidade`): empresa com UMA
// instancia ativa = atribuivel; com DUAS OU MAIS = nao atribuivel; sem empresa = quarentena
// analitica. Um numero otimista aqui viraria um backfill errado depois.
//
// Uso:
//   npm run medir:escopo-instancia
//   DATABASE_URL=<url> node scripts/medir-escopo-instancia.js
//   DATABASE_URL=<url> node scripts/medir-escopo-instancia.js --nomes --json

const { Pool } = require('pg')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'
const TOP_LINHAS = 25

// ─── Apresentacao (funcoes PURAS — testadas em test/medir-escopo-instancia.test.js) ────────

/** Mascara um UUID para o prefixo identificavel. Ausencia vira rotulo explicito, nunca ''. */
function mascarar(valor, rotuloVazio = '(sem empresa)') {
  if (valor == null || valor === '') return rotuloVazio
  const s = String(valor)
  return s.length <= 8 ? s : `${s.slice(0, 8)}…`
}

/**
 * Atribuibilidade de uma conversa a uma instancia — o coracao da medicao.
 *
 * `ativasNaEmpresa` e' quantas instancias ATIVAS a empresa da conversa tem. Com duas ou mais,
 * escolher uma seria repetir, agora em repouso e permanente, o mesmo defeito do fallback
 * "instancia mais recentemente atualizada" que a analise apontou em whatsapp.js:51-60.
 */
function classificarAtribuibilidade({ temInstancia, empresaId, ativasNaEmpresa }) {
  if (temInstancia) return 'ja_atribuida'
  if (!empresaId) return 'quarentena_analitica'
  const ativas = Number(ativasNaEmpresa) || 0
  if (ativas === 0) return 'sem_instancia_ativa'
  if (ativas === 1) return 'atribuivel'
  return 'nao_atribuivel'
}

const ROTULO_ATRIBUIBILIDADE = {
  ja_atribuida: 'ja tem instancia gravada',
  atribuivel: 'atribuivel (empresa tem 1 instancia ativa)',
  nao_atribuivel: 'NAO atribuivel (empresa tem 2+ instancias ativas)',
  sem_instancia_ativa: 'empresa sem nenhuma instancia ativa',
  quarentena_analitica: 'quarentena analitica (conversa sem empresa)',
}

/** Formata uma tabela de largura fixa para terminal. `alinhar[i] === 'd'` = numero a direita. */
function tabela(cabecalhos, linhas, alinhar = []) {
  const corpo = linhas.map((l) => l.map((c) => (c == null ? '—' : String(c))))
  const larguras = cabecalhos.map((h, i) =>
    Math.max(String(h).length, ...corpo.map((l) => (l[i] || '').length), 1)
  )
  const pad = (txt, i) => (alinhar[i] === 'd' ? txt.padStart(larguras[i]) : txt.padEnd(larguras[i]))
  const linha = (cols) => `  ${cols.map((c, i) => pad(c, i)).join('  ')}`.replace(/\s+$/, '')
  const sep = `  ${larguras.map((w) => '─'.repeat(w)).join('  ')}`
  return [linha(cabecalhos.map(String)), sep, ...corpo.map(linha)].join('\n')
}

/**
 * Traduz os numeros medidos em ACHADOS acionaveis.
 *
 * Cada achado diz o que foi medido e o que ele impede — nunca "conserte X". Corrigir e'
 * outra tarefa, com outra aprovacao.
 */
function montarAchados(d) {
  const out = []
  const add = (nivel, texto) => out.push({ nivel, texto })

  const multi = d.empresas?.com_2_ou_mais_ativas || 0
  if (multi === 0) {
    add('ok', 'Nenhuma empresa opera com 2+ instancias ativas hoje. O escopo por instancia ainda nao tem consequencia pratica — as fases podem ser priorizadas pela correcao de envio, nao pela urgencia de filtro.')
  } else {
    add('alto', `${multi} empresa(s) ja operam com 2+ instancias ativas. A partir daqui o fallback "instancia mais recentemente atualizada" (whatsapp.js:51-60) tem efeito real: envio pode sair pelo numero errado.`)
  }

  const semInst = d.conversas?.sem_instancia || 0
  if (semInst > 0) {
    const pct = d.conversas.total ? Math.round((semInst / d.conversas.total) * 100) : 0
    add(semInst > 0 && multi > 0 ? 'alto' : 'medio',
      `${semInst} de ${d.conversas.total} conversas (${pct}%) estao sem \`evolution_instance\`. Para essas, a instancia de envio e' escolhida em tempo de execucao, nao gravada.`)
  }

  const naoAtrib = d.atribuibilidade?.nao_atribuivel || 0
  if (naoAtrib > 0) {
    add('alto', `${naoAtrib} conversa(s) sem instancia pertencem a empresas MULTI-INSTANCIA. Essas NAO podem ser atribuidas por backfill: nao ha como provar qual numero atendeu. Devem permanecer como "nao definida".`)
  }

  const atrib = d.atribuibilidade?.atribuivel || 0
  if (atrib > 0) {
    add('info', `${atrib} conversa(s) sem instancia estao em empresas com exatamente UMA instancia ativa. Sao as unicas seguramente atribuiveis por backfill derivavel (passo 3 do plano, §7.4).`)
  }

  const orfas = d.conversas?.instancia_orfa || 0
  if (orfas > 0) {
    add('alto', `${orfas} conversa(s) apontam para uma \`evolution_instance\` que NAO existe mais em app.empresa_whatsapp_instances. O vinculo e' textual e sem FK: se o nome for reusado, essas conversas mudam de dono sozinhas.`)
  }

  const contra = d.conversas?.instancia_de_outra_empresa || 0
  if (contra > 0) {
    add('critico', `${contra} conversa(s) tem \`empresa_id\` de uma empresa e \`evolution_instance\` de OUTRA. Contradicao de dado: qualquer filtro por instancia vai discordar do filtro por empresa nessas linhas.`)
  }

  const semEmpresa = d.conversas?.sem_empresa || 0
  if (semEmpresa > 0) {
    add('medio', `${semEmpresa} conversa(s) sem \`empresa_id\`. Continuam visiveis para a PJ pelo fallback de api-conversas.js:26 e nao sao atribuiveis a instancia alguma.`)
  }

  const pjSuspeita = d.conversas?.pj_sem_prova_de_instancia || 0
  if (pjSuspeita > 0) {
    add('medio', `${pjSuspeita} conversa(s) marcadas como PJ nao tem instancia que confirme esse dono (sem instancia ou instancia nao mapeada). Agrupar por empresa nessas linhas e' informativo, nao prova.`)
  }

  const ociosas = d.instancias?.ativas_sem_conversa || 0
  if (ociosas > 0) {
    add('info', `${ociosas} instancia(s) ATIVAS sem nenhuma conversa. Podem ser numeros recem-criados, de teste, ou abandonados — vale revisar antes de povoar um seletor com eles.`)
  }

  const inativasComUso = d.instancias?.inativas_com_conversa || 0
  if (inativasComUso > 0) {
    add('medio', `${inativasComUso} instancia(s) INATIVAS ainda tem conversas ligadas. Um filtro que listasse so instancias ativas esconderia essas conversas da operacao.`)
  }

  const quarentena = d.quarentena?.abertas
  if (quarentena > 0) {
    add('alto', `${quarentena} pendencia(s) abertas em app.webhook_quarentena. Ha webhook chegando de instancia sem dono comprovado — mensagens desses numeros nao estao sendo atendidas.`)
  }

  const legado = d.instancias?.origem_legado
  if (legado > 0) {
    add('info', `${legado} instancia(s) com \`origem_vinculo = 'legado'\` (origem nao comprovada, migration 061). Nao impede a medicao; e' contexto para quem for decidir o que entra no seletor.`)
  }

  if (!out.some((a) => a.nivel === 'critico' || a.nivel === 'alto')) {
    add('ok', 'Nenhum sinal de risco alto encontrado nesta medicao.')
  }
  return out
}

// ─── Consultas (SOMENTE SELECT) ────────────────────────────────────────────────────────────

async function existeRelacao(client, nome) {
  const { rows } = await client.query('SELECT to_regclass($1) AS t', [nome])
  return !!(rows[0] && rows[0].t)
}

async function existeColuna(client, schema, tabela_, coluna) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3 LIMIT 1`,
    [schema, tabela_, coluna]
  )
  return rows.length > 0
}

// Normalizacao unica do nome da instancia. Espaco em branco nao e' instancia: sem isto,
// uma linha com `' '` contaria como "tem instancia" e sumiria da conta de risco.
const INST = `NULLIF(BTRIM(c.evolution_instance), '')`

async function medirEmpresasEInstancias(client) {
  const { rows } = await client.query(`
    SELECT COUNT(*)::int                                        AS empresas_com_instancia,
           COUNT(*) FILTER (WHERE ativas >= 1)::int             AS com_1_ou_mais_ativas,
           COUNT(*) FILTER (WHERE ativas >= 2)::int             AS com_2_ou_mais_ativas,
           COUNT(*) FILTER (WHERE ativas = 0)::int              AS sem_nenhuma_ativa,
           COALESCE(MAX(ativas), 0)::int                        AS max_ativas_numa_empresa,
           COALESCE(SUM(total), 0)::int                         AS instancias_total,
           COALESCE(SUM(ativas), 0)::int                        AS instancias_ativas
      FROM (
        SELECT empresa_id,
               COUNT(*)::int                        AS total,
               COUNT(*) FILTER (WHERE ativo)::int   AS ativas
          FROM app.empresa_whatsapp_instances
         GROUP BY empresa_id
      ) t
  `)
  return rows[0]
}

async function medirConversas(client) {
  const { rows } = await client.query(`
    SELECT COUNT(*)::int                                                       AS total,
           COUNT(*) FILTER (WHERE ${INST} IS NULL)::int                        AS sem_instancia,
           COUNT(*) FILTER (WHERE ${INST} IS NOT NULL)::int                    AS com_instancia,
           COUNT(*) FILTER (WHERE ${INST} IS NOT NULL AND i.id IS NULL)::int   AS instancia_orfa,
           COUNT(*) FILTER (WHERE i.id IS NOT NULL
                              AND i.empresa_id IS DISTINCT FROM c.empresa_id)::int AS instancia_de_outra_empresa,
           COUNT(*) FILTER (WHERE c.empresa_id IS NULL)::int                   AS sem_empresa,
           COUNT(*) FILTER (WHERE c.empresa_id = $1::uuid)::int                AS marcadas_pj,
           COUNT(*) FILTER (WHERE c.empresa_id = $1::uuid AND i.id IS NULL)::int AS pj_sem_prova_de_instancia
      FROM vendas.conversas c
      LEFT JOIN app.empresa_whatsapp_instances i
             ON i.evolution_instance = ${INST}
  `, [PJ_EMPRESA_ID])
  return rows[0]
}

/**
 * Atribuibilidade das conversas SEM instancia, pelo numero de instancias ATIVAS da empresa
 * declarada na conversa. A regra vive em `classificarAtribuibilidade`; o SQL apenas replica
 * os mesmos cortes para poder contar em lote.
 */
async function medirAtribuibilidade(client) {
  const { rows } = await client.query(`
    WITH ativas AS (
      SELECT empresa_id, COUNT(*)::int AS n
        FROM app.empresa_whatsapp_instances
       WHERE ativo
       GROUP BY empresa_id
    ),
    sem AS (
      SELECT c.empresa_id
        FROM vendas.conversas c
       WHERE ${INST} IS NULL
    )
    SELECT COUNT(*)::int                                                             AS conversas_sem_instancia,
           COUNT(*) FILTER (WHERE sem.empresa_id IS NULL)::int                       AS quarentena_analitica,
           COUNT(*) FILTER (WHERE sem.empresa_id IS NOT NULL
                              AND COALESCE(a.n, 0) = 0)::int                         AS sem_instancia_ativa,
           COUNT(*) FILTER (WHERE COALESCE(a.n, 0) = 1)::int                          AS atribuivel,
           COUNT(*) FILTER (WHERE COALESCE(a.n, 0) >= 2)::int                         AS nao_atribuivel
      FROM sem
      LEFT JOIN ativas a ON a.empresa_id = sem.empresa_id
  `)
  return rows[0]
}

/** Tabela por empresa. FULL OUTER JOIN para nao perder empresa sem instancia nem conversa orfa. */
async function medirPorEmpresa(client) {
  const { rows } = await client.query(`
    WITH inst AS (
      SELECT empresa_id,
             COUNT(*)::int                      AS instancias,
             COUNT(*) FILTER (WHERE ativo)::int AS ativas
        FROM app.empresa_whatsapp_instances
       GROUP BY empresa_id
    ),
    conv AS (
      SELECT c.empresa_id,
             COUNT(*)::int                                                     AS conversas,
             COUNT(*) FILTER (WHERE ${INST} IS NULL)::int                      AS sem_instancia,
             COUNT(*) FILTER (WHERE ${INST} IS NOT NULL AND i.id IS NULL)::int AS orfas,
             COUNT(*) FILTER (WHERE i.id IS NOT NULL
                                AND i.empresa_id IS DISTINCT FROM c.empresa_id)::int AS de_outra_empresa
        FROM vendas.conversas c
        LEFT JOIN app.empresa_whatsapp_instances i ON i.evolution_instance = ${INST}
       GROUP BY c.empresa_id
    )
    SELECT COALESCE(inst.empresa_id, conv.empresa_id) AS empresa_id,
           COALESCE(inst.instancias, 0)::int          AS instancias,
           COALESCE(inst.ativas, 0)::int              AS ativas,
           COALESCE(conv.conversas, 0)::int           AS conversas,
           COALESCE(conv.sem_instancia, 0)::int       AS sem_instancia,
           COALESCE(conv.orfas, 0)::int               AS orfas,
           COALESCE(conv.de_outra_empresa, 0)::int    AS de_outra_empresa
      FROM inst
      FULL OUTER JOIN conv ON conv.empresa_id = inst.empresa_id
     ORDER BY 3 DESC, 4 DESC
  `)
  return rows
}

/** Conversas por instancia + instancias sem uso. `origem_vinculo` so existe apos a 061. */
async function medirPorInstancia(client) {
  const temOrigem = await existeColuna(client, 'app', 'empresa_whatsapp_instances', 'origem_vinculo')
  const colOrigem = temOrigem ? 'i.origem_vinculo' : `NULL::text`
  const { rows } = await client.query(`
    SELECT i.id,
           i.empresa_id,
           i.ativo,
           i.nome,
           i.evolution_instance,
           COALESCE(i.config_json->>'canal', 'whatsapp')            AS canal,
           ${colOrigem}                                             AS origem_vinculo,
           COUNT(c.numero)::int                                     AS conversas,
           MAX(c.atualizado_em)                                     AS ultima_conversa
      FROM app.empresa_whatsapp_instances i
      LEFT JOIN vendas.conversas c ON c.evolution_instance = i.evolution_instance
     GROUP BY i.id
     ORDER BY i.empresa_id, conversas DESC
  `)
  return rows
}

async function medirQuarentena(client) {
  if (!(await existeRelacao(client, 'app.webhook_quarentena'))) {
    return { indisponivel: 'app.webhook_quarentena ainda nao existe (migration 060 nao aplicada)' }
  }
  const { rows } = await client.query(`
    SELECT COUNT(*)::int                                        AS registros,
           COUNT(*) FILTER (WHERE resolvida_em IS NULL)::int     AS abertas,
           -- Uma LINHA por instancia+motivo, mas o contador diz quantos webhooks bateram.
           -- Sem ele, "2 pendencias" esconde que sao milhares de mensagens nao atendidas.
           COALESCE(SUM(ocorrencias) FILTER (WHERE resolvida_em IS NULL), 0)::bigint AS ocorrencias_abertas,
           COUNT(*) FILTER (WHERE resolvida_em IS NULL
                              AND motivo = 'sem_instancia')::int AS abertas_sem_instancia,
           COUNT(*) FILTER (WHERE resolvida_em IS NULL
                              AND motivo = 'instancia_desconhecida')::int AS abertas_instancia_desconhecida,
           COUNT(*) FILTER (WHERE resolvida_em IS NULL
                              AND motivo = 'erro_resolucao')::int AS abertas_erro_resolucao
      FROM app.webhook_quarentena
  `)
  return rows[0]
}

/**
 * Volume das entidades operacionais que HOJE nao tem instancia. Nao e' risco de vazamento —
 * e' o tamanho do trabalho de cada fase seguinte, que e' o que o operador precisa para
 * decidir a ORDEM. Cada tabela e' checada antes de ser lida.
 */
async function medirVolumeOperacional(client) {
  const out = {}
  const contar = async (relacao, rotulo, sql) => {
    if (!(await existeRelacao(client, relacao))) {
      out[rotulo] = null
      return
    }
    const { rows } = await client.query(sql)
    out[rotulo] = rows[0].n
  }
  await contar('app.follow_ups', 'follow_ups_aguardando',
    `SELECT COUNT(*)::int AS n FROM app.follow_ups WHERE status = 'aguardando'`)
  await contar('app.agenda_eventos', 'agenda_eventos_futuros',
    `SELECT COUNT(*)::int AS n FROM app.agenda_eventos
      WHERE excluido_em IS NULL AND data_inicio > NOW()`)
  await contar('app.campanhas', 'campanhas_ativas',
    `SELECT COUNT(*)::int AS n FROM app.campanhas WHERE status = 'ativa'`)
  await contar('vendas.followup_auto_agendamentos', 'followup_auto_agendados',
    `SELECT COUNT(*)::int AS n FROM vendas.followup_auto_agendamentos WHERE status = 'agendado'`)
  await contar('prospectador.lead_disparos', 'lead_disparos_total',
    `SELECT COUNT(*)::int AS n FROM prospectador.lead_disparos`)
  return out
}

// ─── Orquestracao ──────────────────────────────────────────────────────────────────────────

async function coletar(client) {
  // SEQUENCIAL de proposito. Um unico client serializa as queries de qualquer forma, e em
  // serie o erro aponta exatamente qual medicao falhou — numa transacao que sera' descartada,
  // ganhar milissegundos nao vale perder o rastro.
  const empresas = await medirEmpresasEInstancias(client)
  const conversas = await medirConversas(client)
  const atribuibilidade = await medirAtribuibilidade(client)
  const porEmpresa = await medirPorEmpresa(client)
  const porInstancia = await medirPorInstancia(client)
  const quarentena = await medirQuarentena(client)
  const volume = await medirVolumeOperacional(client)

  const ativasSemConversa = porInstancia.filter((i) => i.ativo && i.conversas === 0).length
  const inativasComConversa = porInstancia.filter((i) => !i.ativo && i.conversas > 0).length
  const origemLegado = porInstancia.filter((i) => i.origem_vinculo === 'legado').length

  return {
    empresas,
    conversas,
    atribuibilidade,
    por_empresa: porEmpresa,
    por_instancia: porInstancia,
    quarentena,
    volume_operacional: volume,
    instancias: {
      total: empresas.instancias_total,
      ativas: empresas.instancias_ativas,
      ativas_sem_conversa: ativasSemConversa,
      inativas_com_conversa: inativasComConversa,
      origem_legado: origemLegado,
    },
  }
}

function imprimir(d, { mostrarNomes = false } = {}) {
  const L = (s = '') => console.log(s)
  const num = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'))

  L('')
  L('══════════════════════════════════════════════════════════════════════')
  L(' MEDICAO READ-ONLY — escopo por INSTANCIA de WhatsApp (Fase 0)')
  L(` ${new Date().toISOString()}`)
  L('══════════════════════════════════════════════════════════════════════')

  L('')
  L('TOTAIS GERAIS')
  L(`  Empresas com ao menos uma instancia ......... ${num(d.empresas.empresas_com_instancia)}`)
  L(`  Empresas com 2+ instancias ATIVAS ........... ${num(d.empresas.com_2_ou_mais_ativas)}   <= a pergunta central`)
  L(`  Empresas sem nenhuma instancia ativa ........ ${num(d.empresas.sem_nenhuma_ativa)}`)
  L(`  Maximo de instancias ativas numa empresa .... ${num(d.empresas.max_ativas_numa_empresa)}`)
  L(`  Instancias cadastradas (ativas) ............. ${num(d.instancias.total)} (${num(d.instancias.ativas)})`)
  L('')
  L(`  Conversas (total) ........................... ${num(d.conversas.total)}`)
  L(`  ├─ com evolution_instance gravada ........... ${num(d.conversas.com_instancia)}`)
  L(`  ├─ SEM evolution_instance ................... ${num(d.conversas.sem_instancia)}   <= a pergunta central`)
  L(`  ├─ instancia orfa (nome nao existe mais) .... ${num(d.conversas.instancia_orfa)}`)
  L(`  ├─ instancia de OUTRA empresa ............... ${num(d.conversas.instancia_de_outra_empresa)}`)
  L(`  └─ sem empresa_id ........................... ${num(d.conversas.sem_empresa)}`)

  L('')
  L('ATRIBUIBILIDADE DAS CONVERSAS SEM INSTANCIA')
  L('  (classificacao conservadora — 2+ instancias ativas = nao atribuivel)')
  L('')
  L(tabela(
    ['classificacao', 'conversas', 'significado'],
    [
      ['atribuivel', num(d.atribuibilidade.atribuivel), ROTULO_ATRIBUIBILIDADE.atribuivel],
      ['nao_atribuivel', num(d.atribuibilidade.nao_atribuivel), ROTULO_ATRIBUIBILIDADE.nao_atribuivel],
      ['sem_instancia_ativa', num(d.atribuibilidade.sem_instancia_ativa), ROTULO_ATRIBUIBILIDADE.sem_instancia_ativa],
      ['quarentena_analitica', num(d.atribuibilidade.quarentena_analitica), ROTULO_ATRIBUIBILIDADE.quarentena_analitica],
    ],
    ['e', 'd', 'e']
  ))

  const linhasEmpresa = d.por_empresa.slice(0, TOP_LINHAS)
  L('')
  L('POR EMPRESA (ids mascarados; ordenado por instancias ativas)')
  L('')
  L(tabela(
    ['empresa', 'inst', 'ativas', 'conversas', 'sem inst.', 'orfas', 'outra emp.'],
    linhasEmpresa.map((e) => [
      mascarar(e.empresa_id),
      num(e.instancias),
      num(e.ativas),
      num(e.conversas),
      num(e.sem_instancia),
      num(e.orfas),
      num(e.de_outra_empresa),
    ]),
    ['e', 'd', 'd', 'd', 'd', 'd', 'd']
  ))
  if (d.por_empresa.length > TOP_LINHAS) {
    L(`  … e mais ${d.por_empresa.length - TOP_LINHAS} empresa(s). Use --json para a lista completa.`)
  }

  const linhasInst = d.por_instancia.slice(0, TOP_LINHAS)
  L('')
  L(`POR INSTANCIA (conversas ligadas; "0" = sem uso)${mostrarNomes ? '' : '  —  use --nomes para ver os rotulos'}`)
  L('')
  L(tabela(
    ['instancia', 'empresa', 'ativa', 'canal', 'origem', 'conversas', 'ultima conversa'],
    linhasInst.map((i) => [
      mostrarNomes ? (i.nome || i.evolution_instance || mascarar(i.id, '(sem id)')) : mascarar(i.id, '(sem id)'),
      mascarar(i.empresa_id),
      i.ativo ? 'sim' : 'NAO',
      i.canal,
      i.origem_vinculo || '—',
      num(i.conversas),
      i.ultima_conversa ? new Date(i.ultima_conversa).toISOString().slice(0, 10) : '—',
    ]),
    ['e', 'e', 'e', 'e', 'e', 'd', 'e']
  ))
  if (d.por_instancia.length > TOP_LINHAS) {
    L(`  … e mais ${d.por_instancia.length - TOP_LINHAS} instancia(s). Use --json para a lista completa.`)
  }
  L('')
  L(`  Instancias ATIVAS sem nenhuma conversa ...... ${num(d.instancias.ativas_sem_conversa)}`)
  L(`  Instancias INATIVAS com conversas ........... ${num(d.instancias.inativas_com_conversa)}`)

  L('')
  L('QUARENTENA DE WEBHOOK')
  if (d.quarentena.indisponivel) {
    L(`  ${d.quarentena.indisponivel}`)
  } else {
    L(`  Pendencias abertas .......................... ${num(d.quarentena.abertas)} de ${num(d.quarentena.registros)}`)
    L(`  Webhooks barrados por elas (ocorrencias) .... ${num(d.quarentena.ocorrencias_abertas)}`)
    L(`  ├─ sem_instancia ............................ ${num(d.quarentena.abertas_sem_instancia)}`)
    L(`  ├─ instancia_desconhecida ................... ${num(d.quarentena.abertas_instancia_desconhecida)}`)
    L(`  └─ erro_resolucao ........................... ${num(d.quarentena.abertas_erro_resolucao)}`)
  }

  L('')
  L('VOLUME OPERACIONAL HOJE SEM INSTANCIA (tamanho das fases seguintes)')
  const v = d.volume_operacional
  L(`  Follow-ups aguardando ....................... ${num(v.follow_ups_aguardando)}`)
  L(`  Eventos de agenda futuros ................... ${num(v.agenda_eventos_futuros)}`)
  L(`  Campanhas ativas ............................ ${num(v.campanhas_ativas)}`)
  L(`  Follow-ups automaticos agendados ............ ${num(v.followup_auto_agendados)}`)
  L(`  Disparos registrados (JA tem instancia) ..... ${num(v.lead_disparos_total)}`)

  L('')
  L('ACHADOS')
  const icone = { critico: '[CRITICO]', alto: '[ALTO]   ', medio: '[MEDIO]  ', info: '[info]   ', ok: '[ok]     ' }
  for (const a of montarAchados(d)) {
    L(`  ${icone[a.nivel] || '[?]'} ${a.texto}`)
  }

  L('')
  L('LIMITES DESTA MEDICAO')
  L('  - Ela NAO corrige nenhum defeito: o envio continua podendo sair pela instancia errada,')
  L('    a precedencia de evolution_instance continua divergente e o teto diario continua por empresa.')
  L('  - Ela NAO cria o seletor por instancia, nem filtro, nem coluna, nem migration.')
  L('  - Conversa sem instancia nao tem dono PROVADO: o agrupamento por empresa acima e informativo.')
  L('  - Nada foi gravado: a sessao roda em READ ONLY e termina em ROLLBACK.')
  L('')
}

async function main(argv = process.argv.slice(2)) {
  const mostrarNomes = argv.includes('--nomes')
  const comoJson = argv.includes('--json')

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL nao definida. Passe explicitamente qual banco medir — este script nunca escolhe um sozinho.')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString: url,
    ssl: /railway|amazonaws|supabase|neon|render/i.test(url) ? { rejectUnauthorized: false } : undefined,
  })
  const client = await pool.connect()
  let dados
  try {
    // READ ONLY de verdade: o proprio Postgres recusa qualquer escrita nesta sessao.
    await client.query('BEGIN TRANSACTION READ ONLY')
    dados = await coletar(client)
    await client.query('ROLLBACK')
  } finally {
    client.release()
    await pool.end()
  }

  if (comoJson) {
    // Mesmo no JSON os ids saem mascarados, a menos que --nomes seja pedido.
    const seguro = {
      ...dados,
      por_empresa: dados.por_empresa.map((e) => ({ ...e, empresa_id: mascarar(e.empresa_id) })),
      por_instancia: dados.por_instancia.map((i) => ({
        ...i,
        id: mascarar(i.id, '(sem id)'),
        empresa_id: mascarar(i.empresa_id),
        ...(mostrarNomes ? {} : { nome: undefined, evolution_instance: undefined }),
      })),
      achados: montarAchados(dados),
    }
    console.log(JSON.stringify(seguro, null, 2))
    return
  }

  imprimir(dados, { mostrarNomes })
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\nFalhou:', e && e.message ? e.message : e)
    process.exit(1)
  })
}

module.exports = {
  mascarar,
  classificarAtribuibilidade,
  ROTULO_ATRIBUIBILIDADE,
  tabela,
  montarAchados,
  coletar,
  imprimir,
  main,
}
