'use strict'
// QUADRO DO DIA — APRESENTAÇÃO PURA das colunas, dos cards e do que cada movimento significa.
//
// Quem decide se um movimento vale é o BACKEND (`services/plano-dia.js` + a rota): a entrada em
// "Feito hoje" exige evidência, e é o servidor que procura a atividade registrada. Aqui só se
// traduz o veredito e se diz, ANTES do arraste, o que a coluna vai cobrar — mesmo contrato de
// `lib/site-rotulos.js` e `lib/lead-fila-trabalho.js`.
//
// ⚠️ A REGRA QUE GOVERNA O MÓDULO: a etapa do dia NÃO é o ciclo comercial. "Feito hoje" não é
// venda fechada, "Aguardando retorno" não é lead frio e tirar um card do dia não descarta o
// lead. Os rótulos existem para que ninguém leia o quadro como se fosse o funil.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/** As colunas, na ordem do trabalho. Espelha `ETAPAS` do backend (anti-drift no teste). */
const COLUNAS = [
  {
    chave: 'para_hoje',
    titulo: 'Para hoje',
    resumo: 'Leads que você escolheu trabalhar nesta data.',
    // O que o movimento NÃO faz. Está aqui porque é a dúvida real de quem arrasta um card pela
    // primeira vez num CRM: "isso muda alguma coisa para o cliente?".
    consequencia: 'Só planejamento — não assume lead de ninguém e não envia nada.',
    tom: 'neutro',
  },
  {
    chave: 'em_trabalho',
    titulo: 'Em trabalho',
    resumo: 'A próxima ação está sendo preparada ou executada.',
    consequencia: 'Só organização — nada é enviado e o funil do lead não muda.',
    tom: 'info',
  },
  {
    chave: 'aguardando_retorno',
    titulo: 'Aguardando retorno',
    resumo: 'A ação aconteceu e ficou algo para acompanhar.',
    consequencia: 'Para virar compromisso de verdade, registre o follow-up pelo fluxo oficial.',
    tom: 'warn',
  },
  {
    chave: 'feito',
    titulo: 'Feito hoje',
    resumo: 'A ação planejada para este lead foi registrada.',
    consequencia: 'Não significa venda fechada, e não descarta nem fecha o lead.',
    tom: 'ok',
  },
]

const CHAVES = COLUNAS.map((c) => c.chave)
const MS_DIA = 86400000
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']
const LIMITE_DIA_SUGERIDO = 8
const LIMITE_EM_TRABALHO = 3
const ORIGENS_INBOUND = new Set(['whatsapp', 'meta_form'])
const ORIGENS_OUTBOUND = new Set(['manual', 'automatico', 'instagram', 'linkedin', 'meta_ads'])

function coluna(chave) {
  return COLUNAS.find((c) => c.chave === chave) || null
}

function dataDoDia(dia) {
  const v = String(dia || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10) === v ? d : null
}

function formatarDiaISO(data) {
  return data.toISOString().slice(0, 10)
}

function formatarDataCurta(dia) {
  const partes = String(dia || '').split('-')
  if (partes.length !== 3) return ''
  return `${partes[2]}/${partes[1]}`
}

function somarDias(dia, quantidade) {
  const d = dataDoDia(dia)
  if (!d) return ''
  d.setUTCDate(d.getUTCDate() + Number(quantidade || 0))
  return formatarDiaISO(d)
}

/** Dias da semana operacional, sempre de segunda a domingo. */
function diasDaSemana(dia) {
  const base = dataDoDia(dia)
  if (!base) return []
  const diaSemana = base.getUTCDay()
  const voltaParaSegunda = diaSemana === 0 ? -6 : 1 - diaSemana
  const inicio = new Date(base.getTime() + voltaParaSegunda * MS_DIA)
  return Array.from({ length: 7 }, (_, i) => formatarDiaISO(new Date(inicio.getTime() + i * MS_DIA)))
}

function rotuloDiaCurto(dia, hoje) {
  if (!dia) return ''
  if (dia === hoje) return 'Hoje'
  if (hoje && dia === somarDias(hoje, -1)) return 'Ontem'
  if (hoje && dia === somarDias(hoje, 1)) return 'Amanhã'
  const d = dataDoDia(dia)
  if (!d) return ''
  return `${DIAS_CURTOS[d.getUTCDay()]} ${formatarDataCurta(dia)}`
}

function rotuloSemana(dias) {
  const lista = Array.isArray(dias) ? dias.filter(Boolean) : []
  if (!lista.length) return ''
  return `Semana de ${formatarDataCurta(lista[0])} a ${formatarDataCurta(lista[lista.length - 1])}`
}

/**
 * Normaliza o resumo da faixa. Dia sem linha no banco vira contagem zero, para a tela poder
 * manter a semana estável e não "sumir" botão quando não há cards.
 */
function resumoDoPeriodo(linhas, dias) {
  const porDia = new Map()
  for (const linha of Array.isArray(linhas) ? linhas : []) {
    if (linha && linha.dia) porDia.set(linha.dia, linha)
  }
  return (Array.isArray(dias) ? dias : []).map((dia) => {
    const linha = porDia.get(dia) || {}
    const total = Number(linha.total || 0)
    const feitos = Number(linha.feitos || 0)
    const abertos = Number(linha.abertos || Math.max(0, total - feitos))
    return {
      dia,
      total,
      feitos,
      abertos,
      para_hoje: Number(linha.para_hoje || 0),
      em_trabalho: Number(linha.em_trabalho || 0),
      aguardando_retorno: Number(linha.aguardando_retorno || 0),
    }
  })
}

/** Distribui os cards nas colunas, preservando a ordem que o servidor mandou. */
function montarColunas(itens) {
  const lista = Array.isArray(itens) ? itens : []
  return COLUNAS.map((c) => ({
    ...c,
    cards: lista.filter((i) => i && i.etapa === c.chave),
  }))
}

/**
 * O que a coluna de destino vai COBRAR, dito antes do arraste.
 *
 * `exigeEvidencia` é só um aviso da tela: quem verifica é o servidor, que procura a atividade
 * registrada e devolve 422 quando não há nem atividade nem nota. Repetir a checagem aqui criaria
 * uma segunda régua, mais frouxa — e seria ela que o operador acreditaria.
 */
function aoMoverPara(chave) {
  const c = coluna(chave)
  if (!c) return { ok: false, motivo: 'Coluna desconhecida.', exigeEvidencia: false }
  return {
    ok: true,
    motivo: '',
    titulo: c.titulo,
    consequencia: c.consequencia,
    exigeEvidencia: chave === 'feito',
  }
}

/**
 * Como um card concluído é LIDO. Autodeclaração nunca aparece como evidência — mesma disciplina
 * da abordagem manual (`wa.me`), onde abrir o link não prova que a mensagem saiu.
 */
function seloConclusao(item) {
  const tipo = item && item.conclusao_tipo
  if (tipo === 'atividade_registrada') {
    const acao = String(item.conclusao_acao || '').trim()
    const rotulos = {
      lead_reuniao_agendada: 'Reunião',
      lead_ligacao_realizada: 'Ligação',
      lead_follow_up_criado: 'Follow-up',
      lead_proposta_enviada: 'Proposta',
      abordagem_manual_declarada: 'Mensagem',
    }
    const rotulo = rotulos[acao] || 'Ação registrada'
    return { rotulo, dica: `O sistema encontrou ${rotulo.toLowerCase()} registrada hoje.`, prova: true, classe: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
  }
  if (tipo === 'autodeclarada') {
    return { rotulo: 'Autodeclarado', dica: 'Sem registro automático: o que consta é o que você escreveu.', prova: false, classe: 'border-amber-200 bg-amber-50 text-amber-800' }
  }
  return null
}

/** Por onde o lead entrou no dia. `escolha_manual` não vira selo: é o caso normal. */
function seloOrigemEntrada(origem) {
  if (origem === 'sugestao_vencidos') return { rotulo: 'Retorno vencido', dica: 'Sugerido: há follow-up seu com prazo vencido.' }
  if (origem === 'sugestao_agenda') return { rotulo: 'Compromisso hoje', dica: 'Sugerido: há compromisso seu na agenda de hoje.' }
  return null
}

/** Horário do card, quando existir. Sem agendamento não se inventa prazo. */
function horarioDoCard(item, formatar) {
  const quando = item && item.proximo_agendamento
  if (!quando) return ''
  return typeof formatar === 'function' ? formatar(quando) : String(quando)
}

function dataValida(iso) {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function quandoCurto(iso, agora = new Date()) {
  const d = dataValida(iso)
  if (!d) return ''
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1)
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1)
  if (mesmoDia(d, agora)) return `hoje ${hora}`
  if (mesmoDia(d, amanha)) return `amanhã ${hora}`
  if (mesmoDia(d, ontem)) return `ontem ${hora}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`
}

function resumoFollowUpCard(item, agora = new Date()) {
  if (!item || !item.follow_up_id) return null
  const quando = quandoCurto(item.follow_up_agendado_para, agora)
  const data = dataValida(item.follow_up_agendado_para)
  const atrasado = !!data && data < new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
  const vencido = !!data && !atrasado && data.getTime() < agora.getTime()
  const futuro = !!data && data.getTime() >= agora.getTime()
  const rotulo = quando ? `Follow-up: ${quando}` : 'Follow-up'
  return {
    rotulo,
    vencido,
    atrasado,
    futuro,
    dica: quando ? 'Abrir follow-up registrado para este lead.' : 'Há follow-up aberto para este lead.',
    classe: atrasado
      ? 'text-estado-danger'
      : vencido
        ? 'text-amber-700'
        : 'text-brand',
  }
}

/** O resumo do dia. Conta CARDS, nunca mistura com contagem de carteira ou de funil. */
function resumoDoDia(itens) {
  const lista = Array.isArray(itens) ? itens : []
  const porColuna = {}
  for (const c of CHAVES) porColuna[c] = 0
  for (const i of lista) if (porColuna[i?.etapa] !== undefined) porColuna[i.etapa] += 1
  const total = lista.length
  const feitos = porColuna.feito
  return {
    total,
    porColuna,
    // "3 de 8" é a única frase honesta: o quadro mede o plano do dia, não a carteira.
    texto: total === 0
      ? 'Nenhum lead no plano de hoje.'
      : `${feitos} de ${total} ${total === 1 ? 'lead trabalhado' : 'leads trabalhados'} hoje.`,
  }
}

/**
 * Capacidade sugerida do plano diário. É só leitura/UX: não bloqueia o operador e não altera
 * regra de negócio. O objetivo é reduzir troca de contexto antes do dia virar uma lista infinita.
 */
function capacidadeDoDia(itens, limiteDia = LIMITE_DIA_SUGERIDO, limiteEmTrabalho = LIMITE_EM_TRABALHO) {
  const resumo = resumoDoDia(itens)
  const total = resumo.total
  const feitos = Number(resumo.porColuna.feito || 0)
  const abertos = Math.max(0, total - feitos)
  const emTrabalho = Number(resumo.porColuna.em_trabalho || 0)
  const vagas = Math.max(0, limiteDia - abertos)
  const passouLimiteDia = abertos > limiteDia
  const passouLimiteTrabalho = emTrabalho > limiteEmTrabalho
  const classe = passouLimiteDia || passouLimiteTrabalho
    ? 'border-estado-warn/40 bg-amber-50 text-amber-900'
    : 'border-line bg-surface-2 text-ink-2'
  const texto = passouLimiteDia
    ? `${abertos} em aberto para ${limiteDia} vagas sugeridas`
    : `${vagas} ${vagas === 1 ? 'vaga livre' : 'vagas livres'} no plano sugerido`
  const alerta = passouLimiteTrabalho
    ? `${emTrabalho} em trabalho ao mesmo tempo; tente fechar antes de puxar mais.`
    : ''
  return {
    limiteDia,
    limiteEmTrabalho,
    total,
    feitos,
    abertos,
    emTrabalho,
    vagas,
    passouLimiteDia,
    passouLimiteTrabalho,
    texto,
    alerta,
    classe,
  }
}

/**
 * O aviso das pendências de dias anteriores. **Nunca move nada**: devolve o texto da prévia, e
 * o replanejamento continua sendo um clique do operador. Pendência não some à meia-noite.
 */
function avisoPendentes(pendentes) {
  const n = Array.isArray(pendentes) ? pendentes.length : 0
  if (!n) return null
  return {
    total: n,
    texto: `${n} ${n === 1 ? 'lead ficou' : 'leads ficaram'} em aberto em dias anteriores.`,
    acaoContinuar: 'Continuar hoje',
    acaoTrazerTudo: n === 1 ? 'Trazer para hoje' : `Trazer os ${n}`,
    dicaContinuar: 'Traz os cards abertos preservando Para hoje, Em trabalho e Aguardando retorno.',
    dicaTrazerTudo: 'Traz todos os cards abertos para Para hoje, como uma lista nova.',
  }
}

/** Rótulo do dia exibido. Hoje é dito por extenso; outro dia mostra a data. */
function rotuloDia(dia, hoje) {
  if (!dia) return ''
  if (dia === hoje) return 'Hoje'
  const [a, m, d] = String(dia).split('-')
  return `${d}/${m}/${a}`
}

/**
 * Nichos presentes nos candidatos de planejamento, com contagem — para o seletor "separar por
 * nicho" do modal. Não busca nada: é um agrupamento sobre os candidatos que a rota do Quadro
 * já entregou para a tela.
 */
function opcoesNicho(candidatos) {
  return opcoesCampoCarteira(candidatos, 'nicho')
}

function valorCategoria(c) {
  return String(c?.categoria_perfil || c?.categoria || c?.classificacao_url || '').trim()
}

function valorPais(c) {
  return String(c?.pais || c?.country || '').trim().toUpperCase()
}

function valorRegiao(c) {
  return String(c?.regiao || c?.regiao_comercial || c?.estado || c?.uf || c?.bairro || '').trim()
}

function valorCampoCarteira(c, campo) {
  if (campo === 'categoria') return valorCategoria(c)
  if (campo === 'pais') return valorPais(c)
  if (campo === 'regiao') return valorRegiao(c)
  return String(c?.[campo] || '').trim()
}

function opcoesCampoCarteira(candidatos, campo) {
  const contagem = new Map()
  for (const c of Array.isArray(candidatos) ? candidatos : []) {
    const valor = valorCampoCarteira(c, campo)
    if (!valor) continue
    contagem.set(valor, (contagem.get(valor) || 0) + 1)
  }
  return Array.from(contagem, ([valor, total]) => ({ valor, total }))
    .sort((a, b) => b.total - a.total || a.valor.localeCompare(b.valor, 'pt-BR'))
}

function opcoesCidade(candidatos) {
  return opcoesCampoCarteira(candidatos, 'cidade')
}

function opcoesRegiao(candidatos) {
  return opcoesCampoCarteira(candidatos, 'regiao')
}

function opcoesCategoria(candidatos) {
  return opcoesCampoCarteira(candidatos, 'categoria')
}

function opcoesPais(candidatos) {
  return opcoesCampoCarteira(candidatos, 'pais')
}

function origemBateFiltro(c, filtro) {
  const f = String(filtro || '').trim().toLowerCase()
  if (!f) return true
  const origem = String(c?.origem || '').trim().toLowerCase()
  if (f === 'inbound') return ORIGENS_INBOUND.has(origem)
  if (f === 'outbound') return ORIGENS_OUTBOUND.has(origem)
  if (f === 'places') return origem === 'manual' || origem === 'automatico'
  return origem === f
}

function icpChave(c) {
  return String(c?.icp_faixa || '').trim().toUpperCase()
}

function grupoRapidoBate(c, grupo) {
  if (!grupo) return true
  if (grupo === 'icp_a') return icpChave(c) === 'A'
  if (grupo === 'com_telefone') return !!String(c?.telefone || '').trim()
  if (grupo === 'sem_telefone') return !String(c?.telefone || '').trim()
  if (grupo === 'icp_pendente') return !icpChave(c)
  return true
}

function gruposPlanejamento(candidatos) {
  const lista = Array.isArray(candidatos) ? candidatos : []
  const defs = [
    {
      chave: 'icp_a',
      rotulo: 'ICP A',
      dica: 'Leads com melhor encaixe comercial já calculado.',
      selecionar: (c) => icpChave(c) === 'A',
    },
    {
      chave: 'com_telefone',
      rotulo: 'Com telefone',
      dica: 'Leads prontos para contato ou validação rápida.',
      selecionar: (c) => !!String(c?.telefone || '').trim(),
    },
    {
      chave: 'sem_telefone',
      rotulo: 'Completar cadastro',
      dica: 'Leads sem telefone: o trabalho do dia é completar dado, não tentar contato.',
      selecionar: (c) => !String(c?.telefone || '').trim(),
    },
    {
      chave: 'icp_pendente',
      rotulo: 'ICP pendente',
      dica: 'Leads ainda sem faixa ICP para revisar antes de priorizar.',
      selecionar: (c) => !icpChave(c),
    },
  ]
  return defs
    .map((g) => ({
      chave: g.chave,
      rotulo: g.rotulo,
      dica: g.dica,
      total: lista.filter(g.selecionar).length,
    }))
    .filter((g) => g.total > 0)
}

function motivoPlanejamento(item, formatar) {
  const entrada = seloOrigemEntrada(item?.origem_entrada)
  if (entrada) return { rotulo: entrada.rotulo, dica: entrada.dica, classe: 'border-amber-200 bg-amber-50 text-amber-800' }
  const hora = horarioDoCard(item, formatar)
  if (hora) return { rotulo: `Agenda ${hora}`, dica: 'Há compromisso marcado para este lead.', classe: 'border-brand/20 bg-brand/5 text-brand' }
  if (icpChave(item) === 'A') return { rotulo: 'ICP A', dica: 'Bom encaixe comercial para priorizar no plano.', classe: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
  if (!String(item?.telefone || '').trim()) return { rotulo: 'Completar cadastro', dica: 'Sem telefone: primeiro passo é completar ou validar contato.', classe: 'border-amber-200 bg-amber-50 text-amber-800' }
  return { rotulo: 'Carteira', dica: 'Escolhido manualmente da sua carteira de planejamento.', classe: 'border-line bg-surface-3 text-ink-2' }
}

function sugestaoPlanoDoDia({ sugeridos, carteira, jaNoDia, limite } = {}) {
  const teto = Math.max(0, Number.isFinite(limite) ? Math.floor(limite) : LIMITE_DIA_SUGERIDO)
  const excluir = jaNoDia instanceof Set ? jaNoDia : new Set()
  const ids = []
  const origem = { esperando: 0, icpA: 0, comTelefone: 0, outros: 0 }
  const vistos = new Set()
  function add(id, tipo) {
    const v = String(id || '').trim()
    if (!v || vistos.has(v) || excluir.has(v) || ids.length >= teto) return
    vistos.add(v)
    ids.push(v)
    origem[tipo] += 1
  }
  for (const s of Array.isArray(sugeridos) ? sugeridos : []) add(s?.prospect_id, 'esperando')
  const lista = Array.isArray(carteira) ? carteira : []
  for (const l of lista) if (icpChave(l) === 'A' && String(l?.telefone || '').trim()) add(l.id, 'icpA')
  for (const l of lista) if (icpChave(l) === 'A') add(l.id, 'icpA')
  for (const l of lista) if (String(l?.telefone || '').trim()) add(l.id, 'comTelefone')
  for (const l of lista) add(l.id, 'outros')
  const partes = []
  if (origem.esperando) partes.push(`${origem.esperando} já esperando`)
  if (origem.icpA) partes.push(`${origem.icpA} ICP A`)
  if (origem.comTelefone) partes.push(`${origem.comTelefone} com telefone`)
  if (origem.outros) partes.push(`${origem.outros} da carteira`)
  return { ids, total: ids.length, partes, texto: partes.join(' · ') }
}

/**
 * Filtra os candidatos de planejamento por busca e por nicho/categoria/país/cidade/região,
 * excluindo quem já está no dia. `limite`, quando informado, recorta a lista exibida; sem ele
 * o planejamento mostra todo o recorte carregado, para o seletor de nicho/cidade não esconder
 * trabalho que já está disponível na carteira.
 */
function filtrarCarteira(candidatos, { busca, nicho, categoria, pais, cidade, regiao, grupo, origem, jaNoDia, limite } = {}) {
  const q = String(busca || '').trim().toLowerCase()
  const n = String(nicho || '').trim()
  const cat = String(categoria || '').trim()
  const ps = String(pais || '').trim().toUpperCase()
  const cid = String(cidade || '').trim()
  const reg = String(regiao || '').trim()
  const org = String(origem || '').trim()
  const excluir = jaNoDia instanceof Set ? jaNoDia : new Set()
  const teto = Number.isFinite(limite) && limite > 0 ? limite : null
  const base = (Array.isArray(candidatos) ? candidatos : []).filter((l) => l && !excluir.has(l.id))
  const porOrigem = org ? base.filter((l) => origemBateFiltro(l, org)) : base
  const porNicho = n ? porOrigem.filter((l) => String(l.nicho || '').trim() === n) : porOrigem
  const porCategoria = cat ? porNicho.filter((l) => valorCategoria(l) === cat) : porNicho
  const porPais = ps ? porCategoria.filter((l) => valorPais(l) === ps) : porCategoria
  const porCidade = cid ? porPais.filter((l) => String(l.cidade || '').trim() === cid) : porPais
  const porRegiao = reg ? porCidade.filter((l) => valorRegiao(l) === reg) : porCidade
  const porGrupo = grupo ? porRegiao.filter((l) => grupoRapidoBate(l, grupo)) : porRegiao
  const porBusca = q
    ? porGrupo.filter((l) => (
      String(l.nome || '').toLowerCase().includes(q)
      || String(l.telefone || '').includes(q)
      || String(l.instagram_handle || '').toLowerCase().includes(q)
      || String(l.nicho || '').toLowerCase().includes(q)
      || valorCategoria(l).toLowerCase().includes(q)
      || String(l.cidade || '').toLowerCase().includes(q)
      || valorPais(l).toLowerCase().includes(q)
    ))
    : porGrupo
  return teto ? porBusca.slice(0, teto) : porBusca
}

module.exports = {
  COLUNAS, CHAVES, coluna, montarColunas, aoMoverPara,
  seloConclusao, seloOrigemEntrada, horarioDoCard, resumoFollowUpCard, resumoDoDia, avisoPendentes, rotuloDia,
  capacidadeDoDia, somarDias, diasDaSemana, rotuloDiaCurto, rotuloSemana, resumoDoPeriodo,
  opcoesNicho, opcoesCidade, opcoesRegiao, opcoesCategoria, opcoesPais,
  origemBateFiltro, gruposPlanejamento, motivoPlanejamento, sugestaoPlanoDoDia, filtrarCarteira,
}
