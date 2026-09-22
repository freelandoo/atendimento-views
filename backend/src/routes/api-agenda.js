'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP, podeCapacidade } = require('../services/acesso-capacidades')
const {
  listarEventos,
  obterEvento,
  criarEvento,
  atualizarEvento,
  removerEvento,
} = require('../services/agenda-multiempresa')
// REUSA a lista de `db/follow-ups.js` em vez de escrever a mesma consulta de novo: e' a mesma
// pergunta ("quem da empresa pode receber um trabalho?"), e duas consultas divergentes fariam o
// vendedor aparecer num seletor e sumir do outro.
const { listarResponsaveis } = require('../db/follow-ups')
// Grade de horarios (PURA) + leitura da agenda do BOT. A rota e' quem junta as duas agendas:
// os modulos nao se conhecem, e e' de proposito — um decide, o outro le.
const slots = require('../services/agenda-slots')
const { ocupacaoDoBot } = require('../services/agenda-espelho')
const { utcParaDataLocalEmTimezone } = require('../date-utils')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

const TIMEZONE = 'America/Sao_Paulo'

// Converte dia (AAAA-MM-DD) + hora (HH:MM) no instante real, no fuso da operacao. Injetada no
// modulo puro de slots: fuso e' I/O de calendario, e deixa-lo la' tornaria o modulo dependente
// de Intl e mais dificil de testar.
function paraInstante(dia, hhmm) {
  const [year, month, day] = String(dia).split('-').map(Number)
  const [hour, minute] = String(hhmm).split(':').map(Number)
  return utcParaDataLocalEmTimezone({ year, month, day, hour, minute }, TIMEZONE)
}

// Instante -> 'HH:MM' no fuso da operacao. Injetada na grade pelo mesmo motivo de `paraInstante`:
// o modulo de slots e' PURO e nao conhece fuso. Serve para o horario de PREPARO dizer de qual
// reuniao ele e' a folga — "Preparo da reuniao das 16:00" em vez de um "Ocupado" sem dono.
const HORA_LOCAL = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit',
})
function formatarHora(instante) {
  return HORA_LOCAL.format(instante)
}

function diaSeguinte(iso) {
  const d = new Date(`${iso}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function hojeIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function tratarErro(res, err, fallbackCode, contexto) {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${contexto}:`, err.message)
  return res.status(status).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message },
  })
}

// GET /responsaveis — quem pode conduzir um compromisso. So' para quem ve a agenda da equipe:
// para os demais o unico responsavel possivel e' a propria pessoa, e um seletor com os colegas
// prometeria uma marcacao que o POST recusa com 403.
//
// Declarada ANTES de `/:id` de proposito: depois dela, "responsaveis" seria lido como id de evento.
router.get('/responsaveis', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.AGENDA_VER_EQUIPE), async (req, res) => {
  try {
    return res.json({ ok: true, data: { itens: await listarResponsaveis(pool, req.empresa.id) } })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_RESPONSAVEIS_FAILED', 'GET agenda/responsaveis')
  }
})

// GET /disponibilidade?data=&dias=&hora_inicio=&hora_fim=&duracao=
//
// Os horarios LIVRES por dia, para a tela oferecer slot em vez de pedir data e hora digitadas.
// Read-only: nao cria evento, nao grava nada e nao chama IA.
//
// Le as DUAS agendas de proposito. A da tela (`app.agenda_eventos`) tem os compromissos do
// operador; a do bot (`vendas.agenda_eventos`) tem as reunioes marcadas pelo WhatsApp, que nao
// existem na primeira. Mostrar so' uma ofereceria horario que a outra ja' ocupou — que e' o
// defeito que esta entrega inteira existe para corrigir, na direcao inversa do espelho.
//
// Declarada ANTES de `/:id`: depois dela, "disponibilidade" seria lido como id de evento.
router.get('/disponibilidade', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const dataInicial = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.data || '')) ? req.query.data : hojeIso()
    const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 7, 1), 31)
    const duracaoMin = Math.min(Math.max(parseInt(req.query.duracao, 10) || slots.GRADE_PADRAO.duracaoMin, 5), 480)
    const grade = slots.gerarGrade({
      horaInicio: req.query.hora_inicio || slots.GRADE_PADRAO.horaInicio,
      horaFim: req.query.hora_fim || slots.GRADE_PADRAO.horaFim,
      duracaoMin,
    })
    if (!grade.length) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'Janela de horário inválida.' } })
    }

    // Mesmo recorte de GET /: quem nao ve a equipe enxerga a propria agenda + os eventos da
    // EMPRESA (bloqueios e feriados, que valem para todos). Trocar um parametro de query nao
    // pode virar acesso a agenda alheia.
    const podeVerEquipe = podeCapacidade({
      papel: req.papelEmpresa,
      permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
      papelPlataforma: req.usuario?.role,
    }, CAP.AGENDA_VER_EQUIPE)
    const responsavelId = podeVerEquipe ? (req.query.responsavel_id || null) : (req.usuario?.id || null)

    let fim = dataInicial
    for (let i = 1; i < dias; i += 1) fim = diaSeguinte(fim)

    const daTela = await listarEventos(pool, {
      empresaId: req.empresa.id, inicio: dataInicial, fim, responsavelId,
    })
    const daAgendaBot = await ocupacaoDoBot(pool, {
      empresaId: req.empresa.id,
      dataInicio: paraInstante(dataInicial, '00:00'),
      dataFim: paraInstante(diaSeguinte(fim), '00:00'),
    })

    const ocupantes = [
      // Cancelado e concluido NAO ocupam: o horario de uma reuniao desmarcada esta livre, e
      // esconde-lo faria o operador procurar vaga que ja existe.
      ...daTela.eventos.filter((e) => ['pendente', 'confirmado', 'bloqueado'].includes(e.status)),
      ...daAgendaBot.map((e) => ({ ...e, __origem: 'bot', tipo: 'reuniao' })),
    ]

    const agora = new Date()
    const out = []
    let dia = dataInicial
    for (let i = 0; i < dias; i += 1) {
      const horarios = slots.marcarDisponibilidade({
        data: dia,
        candidatos: grade,
        eventos: ocupantes,
        duracaoMin,
        paraInstante,
        agora,
        bufferReuniaoMin: slots.REUNIAO_BUFFER_MINUTOS,
        formatarHora,
      })
      out.push({
        data: dia,
        data_br: `${dia.slice(8, 10)}/${dia.slice(5, 7)}`,
        horarios,
        livres: horarios.filter((h) => h.livre).length,
      })
      dia = diaSeguinte(dia)
    }

    return res.json({
      ok: true,
      data: { dias: out, grade: { duracao_min: duracaoMin, total_por_dia: grade.length } },
      // A tela DECLARA o recorte: recortar em silencio faria o vendedor achar que a agenda
      // da equipe sumiu.
      meta: { escopo: responsavelId ? 'responsavel' : 'equipe', pode_ver_equipe: podeVerEquipe },
    })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_DISPONIBILIDADE_FAILED', 'GET agenda/disponibilidade')
  }
})

// POST /bloqueios — cria um bloqueio (feriado, almoco, reuniao interna), opcionalmente repetido.
//
// Rota PROPRIA e nao um `POST /` com `tipo: 'bloqueio'`, por tres razoes de negocio:
//   1. o bloqueio e' da EMPRESA — nasce SEM responsavel, e o POST comum usa quem esta criando
//      como dono por default (o que o tornaria bloqueio de uma pessoa so');
//   2. ele repete, e o POST comum cria um evento por chamada;
//   3. ele exige a capacidade de gerir a agenda da equipe: bloquear a agenda da empresa inteira
//      nao e' a mesma decisao que marcar o proprio compromisso.
router.post('/bloqueios', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.AGENDA_VER_EQUIPE), async (req, res) => {
  try {
    const corpo = req.body || {}
    const data = String(corpo.data || '').trim()
    const horaInicio = String(corpo.hora_inicio || '').trim()
    const horaFim = String(corpo.hora_fim || '').trim()
    const iniMin = slots.minutosDeHora(horaInicio)
    const fimMin = slots.minutosDeHora(horaFim)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || iniMin == null || fimMin == null || fimMin <= iniMin) {
      return res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION', message: 'Informe data, hora inicial e hora final (a final precisa ser maior).' },
      })
    }

    const expansao = slots.expandirRecorrencia({
      dataInicial: data,
      tipo: corpo.recorrencia || slots.RECORRENCIA.NENHUMA,
      ate: corpo.repetir_ate || null,
      diasSemana: corpo.dias_semana || [],
    })
    if (!expansao.ok) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: expansao.erro } })
    }

    const titulo = String(corpo.titulo || '').trim().slice(0, 160) || 'Horário bloqueado'
    const criados = []
    const falhas = []
    for (const dia of expansao.datas) {
      try {
        const ev = await criarEvento(pool, {
          empresaId: req.empresa.id,
          criadoPor: req.usuario?.id || null,
          // NULO de proposito: bloqueio sem dono e' o da EMPRESA, e e' o unico que conflita com
          // a agenda de todo mundo (ver existeConflito). Um bloqueio com responsavel valeria so'
          // para uma pessoa — e nao atravessaria o espelho para o bot.
          responsavelId: null,
          titulo,
          descricao: String(corpo.descricao || '').slice(0, 2000),
          tipo: 'bloqueio',
          status: 'bloqueado',
          prioridade: 'alta',
          data_inicio: paraInstante(dia, horaInicio),
          data_fim: paraInstante(dia, horaFim),
        })
        criados.push(ev)
      } catch (err) {
        // Uma data que falha nao pode derrubar as outras: um feriado prolongado viraria "nenhum
        // dia bloqueado" por causa de um unico conflito. O relatorio devolve o que ficou de fora.
        falhas.push({ data: dia, motivo: err.message })
      }
    }

    if (!criados.length) {
      return res.status(409).json({
        ok: false,
        error: { code: 'BLOQUEIO_NENHUM_CRIADO', message: 'Nenhum horário pôde ser bloqueado.' },
        data: { falhas },
      })
    }
    return res.status(201).json({
      ok: true,
      data: {
        criados: criados.length,
        eventos: criados,
        falhas,
        // `false` aqui e informacao de verdade: o bloqueio vale na tela e o bot AINDA vai
        // oferecer o horario. A tela precisa poder dizer isso em vez de fingir sucesso total.
        vale_para_bot: criados.every((e) => e.vale_para_bot),
        truncado: Boolean(expansao.truncado),
      },
    })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_BLOQUEIO_FAILED', 'POST agenda/bloqueios')
  }
})

// GET /api/empresas/:empresaId/agenda?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&tipo=&status=
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    // CRM em equipe, Etapa 11: a agenda CONSOLIDADA da equipe e' leitura de gestao
    // (AGENDA_VER_EQUIPE). Quem nao tem ve a PROPRIA agenda + os eventos da EMPRESA (bloqueios,
    // feriados e todo evento anterior a migration 076, que nao tem responsavel).
    //
    // `?responsavel_id=` so' e' respeitado por quem pode ver a equipe: e' o filtro "agenda do
    // vendedor X" do admin. Para os demais, o recorte e' sempre o proprio — trocar um parametro
    // de query nao pode virar acesso a agenda alheia.
    const podeVerEquipe = podeCapacidade({
      papel: req.papelEmpresa,
      permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
      papelPlataforma: req.usuario?.role,
    }, CAP.AGENDA_VER_EQUIPE)
    const responsavelId = podeVerEquipe
      ? (req.query.responsavel_id || null)
      : (req.usuario?.id || null)

    const out = await listarEventos(pool, {
      empresaId: req.empresa.id,
      inicio: req.query.inicio,
      fim: req.query.fim,
      tipo: req.query.tipo || null,
      status: req.query.status || null,
      responsavelId,
    })
    return res.json({
      ok: true,
      data: out,
      // A tela precisa poder dizer "mostrando a sua agenda": recortar em silencio faria o
      // vendedor achar que a agenda da equipe sumiu.
      meta: { escopo: responsavelId ? 'responsavel' : 'equipe', pode_ver_equipe: podeVerEquipe },
    })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_LIST_FAILED', 'GET agenda')
  }
})

// GET /api/empresas/:empresaId/agenda/:id
router.get('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const evento = await obterEvento(pool, { empresaId: req.empresa.id, id: req.params.id })
    if (!evento) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Evento não encontrado.' } })
    return res.json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_GET_FAILED', 'GET agenda/:id')
  }
})

// POST /api/empresas/:empresaId/agenda
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    // `responsavel_id` no corpo = marcar PARA outra pessoa (o admin agenda para o vendedor, o SDR
    // para o closer). So' quem ve a agenda da equipe pode fazer isso — senao alguem marcaria
    // compromisso na agenda de um colega que nem consegue enxergar.
    const podeMarcarParaOutro = podeCapacidade({
      papel: req.papelEmpresa,
      permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
      papelPlataforma: req.usuario?.role,
    }, CAP.AGENDA_VER_EQUIPE)
    const corpo = req.body || {}
    if (corpo.responsavel_id && !podeMarcarParaOutro && String(corpo.responsavel_id) !== String(req.usuario?.id)) {
      return res.status(403).json({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Você não pode marcar compromisso na agenda de outra pessoa.' },
      })
    }
    const evento = await criarEvento(pool, {
      empresaId: req.empresa.id,
      criadoPor: req.usuario?.id || null,
      responsavelId: corpo.responsavel_id || null,
      prospectId: corpo.prospect_id || null,
      ...corpo,
    })
    return res.status(201).json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_CREATE_FAILED', 'POST agenda')
  }
})

// PATCH /api/empresas/:empresaId/agenda/:id
router.patch('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const evento = await atualizarEvento(pool, {
      empresaId: req.empresa.id,
      id: req.params.id,
      ...(req.body || {}),
    })
    return res.json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_UPDATE_FAILED', 'PATCH agenda/:id')
  }
})

// DELETE /api/empresas/:empresaId/agenda/:id
router.delete('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await removerEvento(pool, { empresaId: req.empresa.id, id: req.params.id })
    return res.json({ ok: true, data: out })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_DELETE_FAILED', 'DELETE agenda/:id')
  }
})

module.exports = router
