'use strict'
// MEDICAO READ-ONLY da qualificacao do lead — Etapa 3.0 de `docs/plano-execucao-crm-equipe.md`.
//
// POR QUE ESTE SCRIPT EXISTE (e por que ele vem ANTES de qualquer codigo da Etapa 3)
// A Etapa 3 fecha as QUATRO portas de entrada na operacao comercial (campanha/ligacao, disparo
// manual de WhatsApp, disparo AUTOMATICO de WhatsApp e e-mail) exigindo que o lead tenha sido
// aprovado por uma pessoa. Hoje nenhuma delas verifica isso — `STATUS_RODAVEL`
// (services/rodar-leads.js) aceita `aguardando` de proposito, e `db/campanhas.js` nem le
// `p.status`. O risco declarado no plano (§5, "Risco maximo do projeto") e' simples: se o acervo
// existente nao entrar como `legado`, a regra nova PARA a operacao no dia do deploy — o modo
// Automatico do Banco de Leads zera e a fila da Central de Ligacoes encolhe.
//
// Este script responde, com numeros reais, as perguntas que decidem aquela etapa:
//   1. Quantos leads existem por `status`, por empresa? (quantos entrariam como `legado`)
//   2. Quantos estariam ELEGIVEIS ao disparo hoje, e quantos deles nunca foram triados?
//   3. Qual o volume DIARIO real de disparo (para saber o que a porta poderia zerar)?
//   4. Quantos leads ja estao dentro de campanha SEM nunca terem sido aprovados?
//   5. A curadoria (migration 055) foi usada? Quantas decisoes existem?
//   6. Quantos leads voltariam a `pendente` se a coluna nascesse sem carencia?
//
// O QUE ELE **NAO** FAZ (declarado, e e' proposital)
//   - nao cria a coluna `qualificacao` (isso e' a Etapa 3.1, migration 071);
//   - nao aprova, nao descarta e nao bloqueia lead algum;
//   - nao fecha porta nenhuma, nao mexe em configuracao e nao pausa worker;
//   - nao chama Evolution, Meta, Bright Data, provedor de e-mail nem IA.
// Ele MEDE. Nada mais.
//
// GARANTIAS DE SEGURANCA (mesmas de medir-escopo-instancia.js, pelo mesmo motivo)
//   - Roda inteiro dentro de `BEGIN TRANSACTION READ ONLY` e termina em `ROLLBACK`. O proprio
//     Postgres recusa escrita nesta sessao, entao a garantia nao depende de alguem ter lido o
//     SQL com atencao. Nao existe INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE aqui — nem
//     temp table, nem `SELECT INTO`, nem `FOR UPDATE`. Ha guarda de regressao em
//     `test/medir-qualificacao-lead.test.js` que le este fonte e falha se algum aparecer.
//   - Imprime SOMENTE contagens agregadas e ids MASCARADOS (8 primeiros caracteres). Nenhum
//     telefone, e-mail, JID, nome de lead, endereco, mensagem, token ou credencial sai daqui.
//     O prefixo mascarado basta para achar a empresa no painel.
//   - Nenhuma chamada externa e nenhuma dependencia nova (`pg` ja e' dependencia do projeto).
//   - O script NUNCA escolhe banco sozinho: usa exatamente a `DATABASE_URL` que voce passar.
//
// REGRA DE NEGOCIO QUE ELE RESPEITA — status de coleta nao e' prova de triagem
// `prospectador.prospects.status` mistura QUATRO eixos: qualificacao (`aguardando|aprovado|
// rejeitado`), estado de coleta (`coletado|contato_encontrado`), fato comercial (`enviado|
// respondeu|fechado`) e compliance (`nao_contatar`). Um lead `enviado` JA FOI abordado e **nao
// tem mais registro de qualificacao** — `enviado` sobrescreveu `aprovado`. Por isso este script
// NAO tenta deduzir "quem estava aprovado": ele conta quem tem PROVA de triagem (decisao
// registrada em `prospectador.curadoria_decisoes`) separado de quem nao tem. Deduzir aprovacao
// retroativa a partir de `status` seria inventar a prova que a Etapa 3 existe para exigir.
//
// Uso:
//   npm run medir:qualificacao-lead
//   DATABASE_URL=<url> node scripts/medir-qualificacao-lead.js
//   DATABASE_URL=<url> node scripts/medir-qualificacao-lead.js --json

const { Pool } = require('pg')

// Espelham as constantes do codigo de producao. Duplicadas aqui DE PROPOSITO: importar
// services/rodar-leads.js traria pool, Evolution e worker para dentro de um script que promete
// nao falar com nada. O teste confere que estas listas nao divergiram do fonte de producao.
const STATUS_RODAVEL = ['coletado', 'contato_encontrado', 'aguardando', 'aprovado']
const STATUS_TRIAGEM_PENDENTE = ['coletado', 'contato_encontrado', 'aguardando']
const TOP_LINHAS = 20

// ─── Apresentacao (funcoes PURAS — testadas em test/medir-qualificacao-lead.test.js) ───────

/** Mascara um UUID para o prefixo identificavel. Ausencia vira rotulo explicito, nunca ''. */
function mascarar(valor, rotuloVazio = '(sem empresa)') {
  if (valor == null || valor === '') return rotuloVazio
  const s = String(valor)
  return s.length <= 8 ? s : `${s.slice(0, 8)}…`
}

/** Tabela de largura fixa, sem dependencia. `linhas` = array de arrays de string. */
function tabela(cabecalho, linhas) {
  const todas = [cabecalho, ...linhas].map((l) => l.map((c) => String(c == null ? '' : c)))
  const larguras = cabecalho.map((_, i) => Math.max(...todas.map((l) => (l[i] || '').length)))
  const linha = (l) => l.map((c, i) => (i === 0 ? c.padEnd(larguras[i]) : c.padStart(larguras[i]))).join('  ')
  const separador = larguras.map((w) => '-'.repeat(w)).join('  ')
  return [linha(todas[0]), separador, ...todas.slice(1).map(linha)].join('\n')
}

/**
 * A decisao que este script existe para informar: com que valor a coluna `qualificacao` deve
 * nascer para cada faixa do acervo.
 *
 * `legado` NAO e' "aprovado": e' a ausencia de prova, NOMEADA — mesmo vocabulario de
 * `origem_vinculo = 'legado'` (migration 061). Ele opera, e aparece rotulado na tela.
 */
function destinoNaCarencia(status) {
  if (status === 'rejeitado' || status === 'nao_contatar') return 'descartado'
  // Todo o resto (inclusive quem ja foi abordado: enviado/respondeu/fechado) entra como
  // `legado`: ja operava antes da regra, e parar de atende-lo seria pior que a falta de prova.
  return 'legado'
}

/**
 * Quanto a porta poderia custar POR DIA se o acervo entrasse como `pendente` em vez de
 * `legado`. E' a traducao do risco em numero: 0 significa "a porta nao muda nada hoje".
 */
function impactoDiario({ disparosPorDia, elegiveisSemProva, elegiveisTotal }) {
  if (!elegiveisTotal) return { perderia_tudo: elegiveisSemProva > 0, fracao_sem_prova: 0, disparos_dia: disparosPorDia }
  return {
    perderia_tudo: elegiveisSemProva === elegiveisTotal,
    fracao_sem_prova: Number((elegiveisSemProva / elegiveisTotal).toFixed(4)),
    disparos_dia: disparosPorDia,
  }
}

// ─── Coleta (somente SELECT) ───────────────────────────────────────────────────────────────

async function coletar(client) {
  const q = (sql, params = []) => client.query(sql, params).then((r) => r.rows)

  // 1. Leads por empresa x status.
  const porEmpresaStatus = await q(
    `SELECT empresa_id, status, COUNT(*)::int AS n
       FROM prospectador.prospects
      GROUP BY empresa_id, status
      ORDER BY empresa_id NULLS FIRST, n DESC`
  )

  // 2. Total por status (visao global).
  const porStatus = await q(
    `SELECT status, COUNT(*)::int AS n
       FROM prospectador.prospects
      GROUP BY status ORDER BY n DESC`
  )

  // 3. Elegiveis ao disparo HOJE (as mesmas condicoes de services/rodar-leads.js:
  //    status rodavel + telefone + tem_whatsapp <> false + nao bloqueado).
  const elegiveis = await q(
    `SELECT empresa_id,
            COUNT(*)::int AS elegiveis,
            COUNT(*) FILTER (WHERE status = ANY($2))::int AS sem_triagem
       FROM prospectador.prospects
      WHERE status = ANY($1)
        AND NULLIF(BTRIM(COALESCE(telefone, '')), '') IS NOT NULL
        AND tem_whatsapp IS DISTINCT FROM false
        AND (bloqueado_ate IS NULL OR bloqueado_ate <= NOW())
      GROUP BY empresa_id
      ORDER BY elegiveis DESC`,
    [STATUS_RODAVEL, STATUS_TRIAGEM_PENDENTE]
  )

  // 4. Volume REAL de disparo: ultimos 30 dias, por dia. E' o numero que diz o que a porta
  //    poderia zerar. Conta so os que efetivamente sairam ou estao saindo.
  const disparos = await q(
    `SELECT COUNT(*)::int AS total_30d,
            COUNT(DISTINCT date_trunc('day', criado_em))::int AS dias_com_disparo,
            MAX(criado_em) AS ultimo
       FROM prospectador.lead_disparos
      WHERE criado_em >= NOW() - INTERVAL '30 days'
        AND status IN ('enviando', 'pendente_confirmacao', 'enviado')`
  )

  // 5. Disparos por status (mostra a maquina de estados de GERACAO que o plano descreve).
  const disparosPorStatus = await q(
    `SELECT status, COUNT(*)::int AS n
       FROM prospectador.lead_disparos
      WHERE criado_em >= NOW() - INTERVAL '90 days'
      GROUP BY status ORDER BY n DESC`
  )

  // 6. Configuracao do Banco de Leads por empresa (o modo Automatico e' o unico caminho que
  //    aborda sem humano — e por isso o mais afetado pela porta).
  const configBancoLeads = await q(
    `SELECT empresa_id, modo, auto_ativo, teto_diario, janela_inicio, janela_fim
       FROM app.banco_leads_config
      ORDER BY empresa_id`
  )

  // 7. Leads JA dentro de campanha (Central de Ligacoes) x status do prospect. Mostra quantos
  //    entraram na operacao sem nunca terem sido aprovados — o defeito C1/C2 medido.
  const emCampanha = await q(
    `SELECT p.status, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE cl.status NOT IN ('convertido', 'descartado'))::int AS na_fila
       FROM app.campanha_leads cl
       JOIN prospectador.prospects p ON p.id = cl.prospect_id
      GROUP BY p.status ORDER BY n DESC`
  )

  // 8. A curadoria foi usada? (unica fonte de PROVA de triagem humana hoje)
  const curadoria = await q(
    `SELECT COUNT(*)::int AS decisoes,
            COUNT(*) FILTER (WHERE decisao = 'aprovado')::int AS aprovados,
            COUNT(*) FILTER (WHERE decisao = 'descartado')::int AS descartados,
            COUNT(DISTINCT prospect_id)::int AS leads_distintos,
            MAX(criado_em) AS ultima
       FROM prospectador.curadoria_decisoes`
  )

  // 9. Sessoes de curadoria (mostra se a ferramenta chegou a ser aberta).
  const sessoes = await q(
    `SELECT status, COUNT(*)::int AS n FROM prospectador.curadoria_sessoes
      GROUP BY status ORDER BY n DESC`
  )

  // 10. Leads com PROVA de triagem (decisao registrada), por decisao.
  const comProva = await q(
    `SELECT COUNT(DISTINCT prospect_id)::int AS leads
       FROM prospectador.curadoria_decisoes WHERE decisao = 'aprovado'`
  )

  // 11. E-mail: quantos leads sao abordaveis por e-mail hoje sem nenhuma triagem.
  const emailAbordavel = await q(
    `SELECT COUNT(*)::int AS com_email,
            COUNT(*) FILTER (WHERE status = ANY($1))::int AS com_email_sem_triagem
       FROM prospectador.prospects
      WHERE NULLIF(BTRIM(COALESCE(email, '')), '') IS NOT NULL`,
    [STATUS_TRIAGEM_PENDENTE]
  )

  // 12. Empresas ativas (para dimensionar o tenant).
  const empresas = await q(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ativo)::int AS ativas FROM app.empresas`
  )

  // 13. Vinculos usuario x empresa por papel — o retrato do multiusuario ANTES da Etapa 2.
  const vinculos = await q(
    `SELECT role, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE ativo)::int AS ativos
       FROM app.usuarios_empresas GROUP BY role ORDER BY n DESC`
  )

  return {
    porEmpresaStatus, porStatus, elegiveis, disparos: disparos[0] || {}, disparosPorStatus,
    configBancoLeads, emCampanha, curadoria: curadoria[0] || {}, sessoes,
    comProva: comProva[0] || {}, emailAbordavel: emailAbordavel[0] || {},
    empresas: empresas[0] || {}, vinculos,
  }
}

// ─── Achados (PUROS — a leitura de negocio dos numeros) ─────────────────────────────────────

function montarAchados(d) {
  const achados = []
  const totalLeads = d.porStatus.reduce((s, r) => s + r.n, 0)
  const elegiveisTotal = d.elegiveis.reduce((s, r) => s + r.elegiveis, 0)
  const elegiveisSemProva = d.elegiveis.reduce((s, r) => s + r.sem_triagem, 0)
  const disparosDia = d.disparos.dias_com_disparo
    ? Number((d.disparos.total_30d / d.disparos.dias_com_disparo).toFixed(1))
    : 0

  const descartadosNaCarencia = d.porStatus
    .filter((r) => destinoNaCarencia(r.status) === 'descartado')
    .reduce((s, r) => s + r.n, 0)

  achados.push(`Acervo: ${totalLeads} leads. Na carencia, ${totalLeads - descartadosNaCarencia} nasceriam 'legado' e ${descartadosNaCarencia} 'descartado'.`)

  const impacto = impactoDiario({ disparosPorDia: disparosDia, elegiveisSemProva, elegiveisTotal })
  achados.push(`Elegiveis ao disparo hoje: ${elegiveisTotal}; sem prova de triagem: ${elegiveisSemProva} (${(impacto.fracao_sem_prova * 100).toFixed(1)}%).`)
  if (impacto.perderia_tudo && elegiveisTotal > 0) {
    achados.push('RISCO CONFIRMADO: sem a carencia `legado`, a fila de disparo iria a ZERO — 100% dos elegiveis nunca foram triados.')
  }

  achados.push(`Disparos efetivos em 30 dias: ${d.disparos.total_30d || 0} em ${d.disparos.dias_com_disparo || 0} dia(s) => ~${disparosDia}/dia.`)

  const autoAtivo = d.configBancoLeads.filter((c) => c.modo === 'automatico' && c.auto_ativo)
  achados.push(autoAtivo.length
    ? `Modo Automatico LIGADO em ${autoAtivo.length} empresa(s) — e' o caminho que aborda sem humano e o mais afetado pela porta.`
    : 'Modo Automatico DESLIGADO em todas as empresas — a porta nao interrompe nenhum disparo automatico hoje.')

  const emCampanhaTotal = d.emCampanha.reduce((s, r) => s + r.n, 0)
  const emCampanhaSemTriagem = d.emCampanha
    .filter((r) => STATUS_TRIAGEM_PENDENTE.includes(r.status))
    .reduce((s, r) => s + r.na_fila, 0)
  const emCampanhaDescartado = d.emCampanha
    .filter((r) => r.status === 'rejeitado' || r.status === 'nao_contatar')
    .reduce((s, r) => s + r.na_fila, 0)
  achados.push(`Campanhas: ${emCampanhaTotal} lead(s) vinculado(s); na fila da Central de Ligacoes, ${emCampanhaSemTriagem} sem triagem e ${emCampanhaDescartado} JA DESCARTADO(S).`)
  if (emCampanhaDescartado > 0) {
    achados.push('DEFEITO C1 MEDIDO: lead descartado esta na fila de ligacao. A 2a barreira em filaDeTrabalho (Etapa 3.4) e obrigatoria.')
  }

  achados.push(d.curadoria.decisoes
    ? `Curadoria: ${d.curadoria.decisoes} decisao(oes) (${d.curadoria.aprovados} aprovada(s)) sobre ${d.curadoria.leads_distintos} lead(s) — a unica prova de triagem que existe hoje.`
    : 'Curadoria NUNCA foi usada: nao existe uma unica prova de triagem humana no banco. A carencia `legado` nao e opcional.')

  achados.push(`E-mail: ${d.emailAbordavel.com_email || 0} lead(s) com e-mail; ${d.emailAbordavel.com_email_sem_triagem || 0} abordavel(is) hoje sem triagem.`)
  achados.push(`Tenant: ${d.empresas.ativas || 0} empresa(s) ativa(s) de ${d.empresas.total || 0}. Vinculos: ${d.vinculos.map((v) => `${v.role}=${v.ativos}`).join(', ') || 'nenhum'}.`)

  return achados
}

// ─── Impressao ─────────────────────────────────────────────────────────────────────────────

function imprimir(d) {
  const L = (s = '') => console.log(s)
  L()
  L('════ MEDICAO READ-ONLY — qualificacao do lead (Etapa 3.0) ════')
  L('Somente leitura. Nada foi gravado.')
  L()

  L('── Leads por status (global) ──')
  L(tabela(['status', 'leads', 'na carencia'],
    d.porStatus.map((r) => [r.status, r.n, destinoNaCarencia(r.status)])))
  L()

  L('── Leads por empresa x status ──')
  L(tabela(['empresa', 'status', 'leads'],
    d.porEmpresaStatus.slice(0, TOP_LINHAS).map((r) => [mascarar(r.empresa_id), r.status, r.n])))
  if (d.porEmpresaStatus.length > TOP_LINHAS) L(`  (+${d.porEmpresaStatus.length - TOP_LINHAS} linha(s) nao exibida(s))`)
  L()

  L('── Elegiveis ao disparo HOJE (regra de rodar-leads.js) ──')
  L(tabela(['empresa', 'elegiveis', 'sem triagem'],
    d.elegiveis.slice(0, TOP_LINHAS).map((r) => [mascarar(r.empresa_id), r.elegiveis, r.sem_triagem])))
  L()

  L('── Disparos (lead_disparos) ──')
  L(`  efetivos em 30 dias: ${d.disparos.total_30d || 0} em ${d.disparos.dias_com_disparo || 0} dia(s)`)
  L(`  ultimo: ${d.disparos.ultimo ? new Date(d.disparos.ultimo).toISOString() : '(nenhum)'}`)
  L(tabela(['status (90d)', 'n'], d.disparosPorStatus.map((r) => [r.status, r.n])))
  L()

  L('── Configuracao do Banco de Leads ──')
  L(tabela(['empresa', 'modo', 'auto', 'teto', 'janela'],
    d.configBancoLeads.map((c) => [
      mascarar(c.empresa_id), c.modo, c.auto_ativo ? 'SIM' : 'nao', c.teto_diario,
      `${c.janela_inicio}-${c.janela_fim}`,
    ])))
  L()

  L('── Leads em campanha (Central de Ligacoes) x status do prospect ──')
  L(tabela(['status prospect', 'vinculados', 'na fila'],
    d.emCampanha.map((r) => [r.status, r.n, r.na_fila])))
  L()

  L('── Curadoria (a unica prova de triagem existente) ──')
  L(`  decisoes: ${d.curadoria.decisoes || 0} (aprovadas: ${d.curadoria.aprovados || 0}, descartadas: ${d.curadoria.descartados || 0})`)
  L(`  leads distintos decididos: ${d.curadoria.leads_distintos || 0}`)
  L(`  leads com PROVA de aprovacao: ${d.comProva.leads || 0}`)
  L(`  ultima decisao: ${d.curadoria.ultima ? new Date(d.curadoria.ultima).toISOString() : '(nenhuma)'}`)
  L(tabela(['sessoes', 'n'], d.sessoes.map((r) => [r.status, r.n])))
  L()

  L('── Identidade e acesso (retrato antes da Etapa 2) ──')
  L(tabela(['papel no vinculo', 'total', 'ativos'], d.vinculos.map((v) => [v.role, v.n, v.ativos])))
  L()

  L('════ ACHADOS ════')
  for (const a of montarAchados(d)) L(`  • ${a}`)
  L()
  L('  - Nada foi gravado: a sessao roda em READ ONLY e termina em ROLLBACK.')
  L()
}

// ─── main ──────────────────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  const comoJson = argv.includes('--json')

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL nao definida. Passe explicitamente qual banco medir — este script nunca escolhe um sozinho.')
    process.exit(1)
  }

  // ⚠️ DIVIDA DECLARADA (pre-existente, nao criada aqui): `rejectUnauthorized: false` e' o que os
  // dois scripts irmaos (`medir-isolamento-empresa.js`, `medir-escopo-instancia.js`) ja fazem para
  // alcancar o proxy PUBLICO do Railway, que apresenta certificado nao verificavel pela cadeia
  // padrao. Isso abre espaco teorico para MITM no caminho. Mantido aqui por CONSISTENCIA — tres
  // scripts com politicas de TLS diferentes seria pior —, e porque o que trafega sao contagens
  // agregadas sem PII. A correcao certa (instalar a CA do Railway no trust store, ou usar
  // `sslmode=verify-full` com a CA baixada) vale para os TRES e e' tarefa propria, registrada em
  // docs/plano-execucao-crm-equipe.md. NAO copie este trecho para codigo de producao:
  // `src/db.js` deliberadamente nao desativa verificacao.
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
    console.log(JSON.stringify({
      ...dados,
      porEmpresaStatus: dados.porEmpresaStatus.map((r) => ({ ...r, empresa_id: mascarar(r.empresa_id) })),
      elegiveis: dados.elegiveis.map((r) => ({ ...r, empresa_id: mascarar(r.empresa_id) })),
      configBancoLeads: dados.configBancoLeads.map((r) => ({ ...r, empresa_id: mascarar(r.empresa_id) })),
      achados: montarAchados(dados),
    }, null, 2))
    return
  }

  imprimir(dados)
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\nFalhou:', e && e.message ? e.message : e)
    process.exit(1)
  })
}

module.exports = {
  mascarar, tabela, destinoNaCarencia, impactoDiario, montarAchados,
  STATUS_RODAVEL, STATUS_TRIAGEM_PENDENTE,
}
