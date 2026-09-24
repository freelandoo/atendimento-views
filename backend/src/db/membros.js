'use strict'
// Membros da EMPRESA — acesso a dados. CRM em equipe, Etapa 2.
// Ver docs/plano-execucao-crm-equipe.md §4 e docs/especificacao-crm-equipe.md §5.1.
//
// O DEFEITO QUE ESTA CAMADA CORRIGE
// Não existia como adicionar uma segunda pessoa a uma empresa pelo produto.
// `createUsuarioPorAdmin` (src/db/usuarios.js) cria a linha em `app.usuarios` e **não cria
// vínculo em `app.usuarios_empresas`** — o usuário nascia sem acesso a empresa alguma e
// `requireEmpresaAccess` respondia 403 em tudo. A única forma de montar uma equipe era `INSERT`
// manual no banco.
//
// AS QUATRO REGRAS QUE NÃO SE NEGOCIAM AQUI
//  1. **O papel GLOBAL do novo membro é sempre `user`.** `admin`/`superadmin` globais NÃO são
//     criados por esta rota. Quem autoriza dentro da empresa é `usuarios_empresas.role` (Etapa 1);
//     conceder papel global aqui devolveria o defeito que a Etapa 1 corrigiu — papel global valendo
//     dentro de qualquer empresa.
//  2. **E-mail que já existe REUSA o usuário e só acrescenta o vínculo.** Nunca se altera senha,
//     nome ou papel global de um usuário que já existe: ele pode servir outra empresa, e mexer nele
//     a partir daqui seria escrever no tenant do vizinho. Se já houver vínculo, é 409.
//  3. **`owner` é protegido:** não é desativado nem rebaixado por esta rota, e ninguém mexe no
//     próprio vínculo (nem para desativar, nem para trocar de papel). Sem isso, um gestor
//     desativaria o dono, ou alguém se trancaria fora da própria empresa.
//  4. **Toda escrita vira linha em `app.auditoria_eventos`**, SEM senha e SEM hash.
//
// Papel e capacidade NÃO são comparados com literal aqui: quem decide é o módulo PURO
// `services/acesso-capacidades.js` (guarda de regressão em test/acesso-capacidades.test.js).

const { pool } = require('../db')
const { hashPassword } = require('../auth')
const {
  PAPEIS, papelConhecido, capacidadeConhecida, concedeveisPara, papelExigeEquipe,
} = require('../services/acesso-capacidades')
// Regra ÚNICA de senha e de idade, compartilhada com o link de convite.
const CM = require('../services/cadastro-membro')
const { diaOperacional } = require('../services/plano-dia')
const { logger } = require('../logger')
// Os tres donos do trabalho que fica PRESO quando alguem perde o acesso. Importados, nunca
// reimplementados: cada um e' o dono do proprio historico (migrations 072, 074 e 062), e um
// UPDATE solto aqui apagaria a autoria sem deixar rastro.
const LR = require('./lead-responsavel')
const CR = require('./conversa-responsavel')
const FU = require('./follow-ups')
// A entrada na equipe no cadastro passa pelo MESMO caminho do modal (rebalanceamento incluso).
const EQ = require('./equipes-comerciais')

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

// ─── Validação de entrada ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Desde 2026-09-23 a senha de membro segue `services/cadastro-membro.js` (8+, letra e número).
const SENHA_MIN = CM.SENHA_MIN

function normalizarEmail(v) {
  return String(v == null ? '' : v).trim().toLowerCase()
}

/**
 * Saneia `permissoes` recebido de payload.
 *
 * SOMENTE ADITIVO e por LISTA FECHADA: só entram chaves que são capacidade conhecida E que o
 * papel ainda não tem. Aceitar `false` gravaria uma negação que o avaliador ignora — a linha
 * pareceria dizer algo que o sistema não faz. Conceder algo que o papel já inclui inflaria a
 * coluna com ruído e faria a tela mostrar concessão onde não houve decisão.
 */
function sanearPermissoes(entrada, papel) {
  if (entrada == null) return {}
  if (typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw erro('permissoes deve ser um objeto { capacidade: true }.')
  }
  const concedeveis = new Set(concedeveisPara(papel))
  const saida = {}
  for (const [chave, valor] of Object.entries(entrada)) {
    if (valor !== true) {
      // Recusa explícita em vez de silêncio: `permissoes: { x: false }` é quase sempre alguém
      // tentando NEGAR, e negar não existe neste modelo. Falhar alto evita a expectativa errada.
      throw erro(`permissoes.${chave}: só o valor true é aceito — concessão é somente aditiva. Para negar, troque o papel.`)
    }
    if (!capacidadeConhecida(chave)) throw erro(`Capacidade desconhecida: ${chave}`)
    if (!concedeveis.has(chave)) {
      throw erro(`A capacidade ${chave} já está incluída no papel ${papel} — não há o que conceder.`)
    }
    saida[chave] = true
  }
  return saida
}

function validarPapel(papel) {
  if (!papelConhecido(papel)) {
    throw erro(`Papel inválido. Use um de: ${PAPEIS.join(', ')}.`)
  }
  return papel
}

// ─── Leitura ─────────────────────────────────────────────────────────────────────────────

// Nunca seleciona `password_hash`. A senha não sai desta camada por caminho algum.
const COLS_MEMBRO = `
  ue.id, ue.usuario_id, ue.role, ue.ativo, ue.permissoes, ue.criado_em, ue.criado_por,
  ue.ultimo_acesso_em, u.nome, u.email, u.ativo AS usuario_ativo, u.ultimo_login_em`

async function listarMembros(empresaId) {
  const { rows } = await pool.query(
    `SELECT ${COLS_MEMBRO}
       FROM app.usuarios_empresas ue
       JOIN app.usuarios u ON u.id = ue.usuario_id
      WHERE ue.empresa_id = $1
      ORDER BY ue.ativo DESC, u.nome ASC`,
    [empresaId]
  )
  return rows
}

async function obterMembro(empresaId, vinculoId) {
  const { rows } = await pool.query(
    `SELECT ${COLS_MEMBRO}
       FROM app.usuarios_empresas ue
       JOIN app.usuarios u ON u.id = ue.usuario_id
      WHERE ue.empresa_id = $1 AND ue.id = $2::uuid
      LIMIT 1`,
    [empresaId, vinculoId]
  )
  return rows[0] || null
}

// ─── Auditoria ───────────────────────────────────────────────────────────────────────────

// Best-effort DENTRO da transação do chamador: se a auditoria falhar, a operação inteira volta
// atrás. É o oposto do padrão "auditoria nunca derruba a ação principal" usado em telemetria —
// aqui a linha de auditoria É parte do fato (quem adicionou quem à empresa), e um vínculo sem
// registro de autoria é exatamente o que esta etapa existe para evitar.
async function auditar(client, { empresaId, usuarioId, acao, entidadeId, estadoAnterior, estadoNovo, contexto }) {
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
     VALUES ($1, $2, 'membro_empresa', $3, $4, $5, $6, $7::jsonb)`,
    [empresaId, usuarioId || null, entidadeId || null, acao,
      estadoAnterior || null, estadoNovo || null, JSON.stringify(contexto || {})]
  )
}

// ─── Escrita ─────────────────────────────────────────────────────────────────────────────

async function withTx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * Grava o vínculo pessoa↔empresa e a linha de auditoria dele, DENTRO da transação do chamador.
 *
 * Existe separado porque há DUAS portas de entrada — o cadastro direto (`criarMembro`) e o link
 * de convite (`db/membro-convites.js`) — e as duas precisam deixar o MESMO rastro: `criado_por`
 * gravado junto do vínculo (mesmo raciocínio de `origem_vinculo`, migration 061) e uma linha
 * `membro_adicionado` sem senha, sem hash e sem e-mail.
 *
 * @param {object} client  conexão com transação aberta
 * @param {object} p  { empresaId, usuario, role, permissoes, autorId, reusou, contextoExtra? }
 */
async function inserirVinculoEmTx(client, { empresaId, usuario, role, permissoes = {}, autorId = null, reusou = false, contextoExtra = {} }) {
  let vinculo
  try {
    const { rows } = await client.query(
      `INSERT INTO app.usuarios_empresas (usuario_id, empresa_id, role, permissoes, criado_por)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, usuario_id, role, ativo, permissoes, criado_em, criado_por`,
      [usuario.id, empresaId, role, JSON.stringify(permissoes), autorId || null]
    )
    vinculo = rows[0]
  } catch (e) {
    // UNIQUE (usuario_id, empresa_id): a pessoa já é membro. 409, e não um segundo vínculo.
    if (e && e.code === '23505') {
      throw erro('Esta pessoa já é membro desta empresa.', 409, 'MEMBRO_JA_EXISTE')
    }
    throw e
  }

  await auditar(client, {
    empresaId,
    usuarioId: autorId,
    acao: 'membro_adicionado',
    entidadeId: vinculo.id,
    estadoNovo: role,
    // Sem senha, sem hash, sem e-mail: o e-mail é dado de pessoa e o vínculo já aponta para o
    // usuário. `usuario_reusado` é o que importa auditar — diz se a conta nasceu aqui.
    contexto: {
      usuario_id: usuario.id,
      usuario_reusado: reusou,
      permissoes_concedidas: Object.keys(permissoes),
      ...contextoExtra,
    },
  })
  return vinculo
}

/**
 * Cria (ou reusa) o usuário e o vincula à empresa. Uma transação só.
 *
 * Conta NOVA exige data de nascimento (maior de 18) e a senha da regra única
 * (`services/cadastro-membro.js`: 8+ caracteres, letra e número). Conta REUSADA não é tocada
 * (regra 2), então nada disso é pedido para ela.
 *
 * Papel que exige equipe (`papelExigeEquipe`, hoje o comercial) entra JÁ na equipe, na mesma
 * transação — ninguém nasce comercial sem carteira para trabalhar.
 *
 * @param {string} empresaId
 * @param {object} dados  { nome, email, senha, data_nascimento, role, permissoes?, equipe_id? }
 * @param {string} autorId  quem está adicionando (req.usuario.id)
 */
async function criarMembro(empresaId, dados = {}, autorId = null, { hojeIso } = {}) {
  const nome = String(dados.nome == null ? '' : dados.nome).trim()
  const email = normalizarEmail(dados.email)
  const senha = String(dados.senha == null ? '' : dados.senha)
  const role = validarPapel(dados.role)
  const permissoes = sanearPermissoes(dados.permissoes, role)
  const equipeId = dados.equipe_id == null || dados.equipe_id === '' ? null : String(dados.equipe_id)

  if (nome.length < 2) throw erro('Nome obrigatório (mínimo 2 caracteres).')
  if (!EMAIL_RE.test(email)) throw erro('E-mail inválido.')
  if (equipeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(equipeId)) {
    throw erro('Equipe inválida.')
  }
  if (papelExigeEquipe(role) && !equipeId) {
    throw erro('Escolha a equipe: quem entra como comercial precisa começar numa equipe.', 400, 'EQUIPE_OBRIGATORIA')
  }

  return withTx(async (client) => {
    // Reuso: a mesma pessoa pode trabalhar em duas empresas. Nada do usuário existente é
    // alterado — nem senha, nem nome, nem papel global (regra 2).
    const { rows: achado } = await client.query(
      `SELECT id, nome, email, ativo FROM app.usuarios WHERE email = $1 LIMIT 1`,
      [email]
    )
    let usuario = achado[0] || null
    let reusou = true

    if (!usuario) {
      const problema = CM.problemaDaSenha(senha)
      if (problema) throw erro(problema, 400, 'SENHA_FRACA')
      const { data: dataNascimento } = CM.validarDataNascimento(dados.data_nascimento, hojeIso || diaOperacional())
      const password_hash = await hashPassword(senha)
      // `role` GLOBAL é sempre 'user' (regra 1). Não vem do payload de propósito.
      const { rows } = await client.query(
        `INSERT INTO app.usuarios (email, nome, password_hash, role, data_nascimento)
         VALUES ($1, $2, $3, 'user', $4::date)
         RETURNING id, nome, email, ativo`,
        [email, nome, password_hash, dataNascimento]
      )
      usuario = rows[0]
      reusou = false
    }

    const vinculo = await inserirVinculoEmTx(client, {
      empresaId, usuario, role, permissoes, autorId, reusou,
    })

    // Entra na equipe DEPOIS do vínculo (a equipe só aceita membro ativo da empresa) e na MESMA
    // transação: se a equipe recusar, a conta também não nasce.
    const equipe = equipeId
      ? await EQ.adicionarParticipanteEmTx(client, empresaId, equipeId, usuario.id, autorId)
      : null

    logger.info({ empresa_id: empresaId, papel: role, reusou, com_equipe: !!equipe }, '[membros] membro adicionado')
    return {
      ...vinculo,
      nome: usuario.nome,
      email: usuario.email,
      usuario_ativo: usuario.ativo,
      usuario_reusado: reusou,
      equipe: equipe ? { id: equipe.equipe_id, nome: equipe.equipe_nome } : null,
    }
  })
}

/** Motivo gravado no historico de cada item devolvido. Texto unico: a leitura e' a mesma nos 4. */
const MOTIVO_DESATIVACAO = 'Acesso do membro desativado na empresa.'

/**
 * Devolve para a fila TODO o trabalho que estava na mao de quem acabou de perder o acesso.
 *
 * ─── O DEFEITO QUE ISTO CORRIGE ───────────────────────────────────────────────
 * Desativar o vinculo revogava o acesso e **nao mexia em nada do que a pessoa tinha na mao**. O
 * comportamento estava ate' declarado no `AGENTS.md` ("desativar revoga acesso e nao redistribui"),
 * como se fosse escolha — mas medido em producao em 2026-09-22 ele produziu **184 leads
 * trabalhaveis presos numa pessoa desativada** e **7 follow-ups em aberto** em outras duas. Esse
 * trabalho fica INVISIVEL: o recorte do comercial e' "meus + livres", e lead de um colega
 * desativado nao e' nem uma coisa nem outra. Ninguem o ve, ninguem o trabalha, e ele continua
 * contando na carteira dela no painel de equipe e no calculo da proxima distribuicao.
 *
 * ─── A REGRA ──────────────────────────────────────────────────────────────────
 * **Devolve para a FILA, nunca redistribui para outra pessoa.** Escolher um substituto aqui seria
 * inventar dono — o mesmo erro que a quarentena de webhook (060) e a instancia de envio (Fase 2)
 * removeram de outros pontos do produto. A fila e' estado legitimo nos tres modulos, e quem decide
 * o proximo dono e' a equipe (rebalanceamento, "Puxar mais leads") ou uma pessoa.
 *
 * ─── O QUE ELA NAO FAZ, DE PROPOSITO ────────────────────────────────────────────
 *  1. **Nao desfaz nada na REATIVACAO.** Nao da' para saber quais itens eram dela sem recriar o
 *     estado de um instante passado, e devolver o lote errado seria pior que nao devolver: a
 *     carteira ja' pode ter sido trabalhada por outra pessoa nesse meio tempo. O historico de cada
 *     item diz de quem era — reatribuir e' ato humano.
 *  2. **Nao toca HISTORICO.** Ligacao realizada, follow-up concluido e venda continuam com a
 *     autoria de quem as fez. Quem sai perde o trabalho PENDENTE, nunca o que ja' aconteceu.
 *  3. **Nao apaga o vinculo nem o usuario.** Continua valendo "desativar em vez de excluir".
 *
 * Roda DENTRO da transacao do vinculo: se a desativacao voltar atras, a devolucao volta junto.
 * Metade feito aqui seria o pior dos mundos — pessoa com acesso e sem carteira, ou o inverso.
 */
async function devolverTrabalhoDoMembro(client, { empresaId, usuarioId, autorId } = {}) {
  const motivo = MOTIVO_DESATIVACAO

  // A pessoa sai das equipes ANTES de a carteira ser devolvida. A ordem importa: enquanto o
  // vinculo de equipe estiver aberto, ela conta como membro ativo e um rebalanceamento
  // concorrente poderia devolver para ela o que acabamos de tirar.
  const { rows: equipes } = await client.query(
    `UPDATE app.equipe_comercial_membros
        SET saiu_em = NOW(), removido_por = $3::uuid, motivo_saida = $4
      WHERE empresa_id = $1 AND usuario_id = $2::uuid AND saiu_em IS NULL
      RETURNING equipe_id`,
    [empresaId, usuarioId, autorId || null, motivo]
  )

  // `nichoId` ausente de proposito: aqui a pessoa perdeu a EMPRESA, nao uma equipe. Ver o
  // cabecalho de `liberarLeadsDoMembro`.
  const leads = await LR.liberarLeadsDoMembro(client, {
    empresaId, origemId: usuarioId, usuarioId: autorId, motivo,
  })
  const conversas = await CR.liberarConversasDoMembro(client, {
    empresaId, origemId: usuarioId, usuarioId: autorId, motivo,
  })
  const followUps = await FU.liberarFollowUpsDoMembro(client, {
    empresaId, origemId: usuarioId, usuarioId: autorId, motivo,
  })

  return {
    equipes_encerradas: equipes.length,
    leads_liberados: leads.liberados,
    leads_com_reuniao_futura: leads.com_reuniao_futura,
    leads_com_conversa_aberta: leads.com_conversa_aberta,
    conversas_liberadas: conversas.liberadas,
    follow_ups_liberados: followUps.liberados,
  }
}

/**
 * Atualiza papel, concessões e/ou ativo de um vínculo.
 * `patch` = { role?, permissoes?, ativo? }
 */
async function atualizarMembro(empresaId, vinculoId, patch = {}, autorId = null) {
  const temRole = patch.role !== undefined
  const temPermissoes = patch.permissoes !== undefined
  const temAtivo = patch.ativo !== undefined
  if (!temRole && !temPermissoes && !temAtivo) throw erro('Nada para atualizar.')
  if (temAtivo && typeof patch.ativo !== 'boolean') {
    // `Boolean('false')` é `true`: aceitar string aqui desativaria o oposto do pedido.
    throw erro('ativo deve ser booleano.')
  }

  return withTx(async (client) => {
    const { rows: atual } = await client.query(
      `SELECT id, usuario_id, role, ativo, permissoes FROM app.usuarios_empresas
        WHERE empresa_id = $1 AND id = $2::uuid FOR UPDATE`,
      [empresaId, vinculoId]
    )
    const vinculo = atual[0]
    if (!vinculo) throw erro('Membro não encontrado nesta empresa.', 404, 'NOT_FOUND')

    // Regra 3, parte 1: ninguém mexe no próprio vínculo. Impede trancar-se fora da empresa e
    // impede auto-promoção.
    if (autorId && String(vinculo.usuario_id) === String(autorId)) {
      throw erro('Você não pode alterar seu próprio acesso.', 409, 'AUTO_ALTERACAO')
    }
    // Regra 3, parte 2: o `owner` não é rebaixado nem desativado por esta rota. Trocar o dono da
    // empresa é outra operação, e não existe nesta etapa.
    if (vinculo.role === 'owner' && (temRole || temAtivo)) {
      throw erro('O dono da empresa não pode ser rebaixado nem desativado aqui.', 409, 'OWNER_PROTEGIDO')
    }

    const roleFinal = temRole ? validarPapel(patch.role) : vinculo.role
    // As concessões são saneadas contra o papel FINAL: mudar de papel pode tornar uma concessão
    // redundante, e mantê-la faria a tela mostrar concessão onde o papel já resolve.
    const permissoesFinal = temPermissoes
      ? sanearPermissoes(patch.permissoes, roleFinal)
      : sanearPermissoesExistentes(vinculo.permissoes, roleFinal)

    const { rows } = await client.query(
      `UPDATE app.usuarios_empresas
          SET role = $3, permissoes = $4::jsonb, ativo = $5
        WHERE empresa_id = $1 AND id = $2::uuid
        RETURNING id, usuario_id, role, ativo, permissoes, criado_em, criado_por, ultimo_acesso_em`,
      [empresaId, vinculoId, roleFinal, JSON.stringify(permissoesFinal),
        temAtivo ? patch.ativo : vinculo.ativo]
    )

    // ⚠️ So' na TRANSICAO real de ativo -> inativo (`IS DISTINCT FROM`, o mesmo cuidado de
    // `modo_ia` e da auditoria de membro). Repetir o PATCH com `ativo: false` numa pessoa ja'
    // desativada nao pode devolver nada: a carteira dela ja voltou para a fila e pode ter sido
    // assumida por outra pessoa nesse meio tempo — liberar de novo tiraria lead de quem esta
    // trabalhando. Reativar tambem nao desfaz nada (ver `devolverTrabalhoDoMembro`).
    const desativouAgora = temAtivo && patch.ativo === false && vinculo.ativo === true
    const devolucao = desativouAgora
      ? await devolverTrabalhoDoMembro(client, {
        empresaId, usuarioId: vinculo.usuario_id, autorId,
      })
      : null

    await auditar(client, {
      empresaId,
      usuarioId: autorId,
      acao: temAtivo && patch.ativo === false ? 'membro_desativado'
        : temAtivo && patch.ativo === true ? 'membro_reativado'
          : 'membro_atualizado',
      entidadeId: vinculoId,
      estadoAnterior: vinculo.role,
      estadoNovo: roleFinal,
      contexto: {
        usuario_id: vinculo.usuario_id,
        ativo_anterior: vinculo.ativo,
        ativo_novo: temAtivo ? patch.ativo : vinculo.ativo,
        permissoes_anteriores: Object.keys(vinculo.permissoes || {}),
        permissoes_novas: Object.keys(permissoesFinal),
        // O que foi devolvido entra na MESMA linha da desativacao: e' a resposta a "por que a
        // carteira dela zerou?", e separa-la em outro evento faria procurar em dois lugares.
        ...(devolucao ? { devolucao } : {}),
      },
    })

    // `devolucao` e' campo ADITIVO na resposta: quem nao desativou ninguem recebe `null`, e os
    // consumidores anteriores nao mudam. E' o que permite a tela DIZER o que aconteceu com o
    // trabalho em vez de a carteira sumir em silencio.
    return { ...rows[0], devolucao }
  })
}

/**
 * Reavalia concessões já gravadas contra um papel (possivelmente novo), descartando as que o
 * papel passou a incluir. Não lança: valor gravado antigo não deve impedir uma troca de papel.
 */
function sanearPermissoesExistentes(permissoes, papel) {
  const concedeveis = new Set(concedeveisPara(papel))
  const saida = {}
  for (const [chave, valor] of Object.entries(permissoes || {})) {
    if (valor === true && capacidadeConhecida(chave) && concedeveis.has(chave)) saida[chave] = true
  }
  return saida
}

/**
 * Marca o último acesso do vínculo. Best-effort e FORA de transação: é telemetria de uso, não
 * fato de negócio, e uma falha aqui nunca pode derrubar o request.
 *
 * Grava no máximo uma vez por hora para não transformar toda requisição autenticada em escrita.
 * NÃO toca `atualizado_em` de nada (a tabela não tem essa coluna, de propósito).
 */
async function registrarUltimoAcesso(vinculoId) {
  if (!vinculoId) return
  try {
    await pool.query(
      `UPDATE app.usuarios_empresas
          SET ultimo_acesso_em = NOW()
        WHERE id = $1::uuid
          AND (ultimo_acesso_em IS NULL OR ultimo_acesso_em < NOW() - INTERVAL '1 hour')`,
      [vinculoId]
    )
  } catch (e) {
    logger.warn({ err: e.message }, '[membros] falha ao registrar ultimo acesso (ignorada)')
  }
}

module.exports = {
  listarMembros,
  obterMembro,
  criarMembro,
  atualizarMembro,
  registrarUltimoAcesso,
  inserirVinculoEmTx,
  withTx,
  // exportados para teste (regras puras de entrada)
  // `__devolverTrabalhoDoMembro` nao e API publica: so' `atualizarMembro` a chama, e sempre
  // dentro da transacao do vinculo. Exposta para o teste poder exercitar a devolucao com um
  // client falso, sem banco.
  __devolverTrabalhoDoMembro: devolverTrabalhoDoMembro,
  sanearPermissoes,
  sanearPermissoesExistentes,
  normalizarEmail,
  SENHA_MIN,
}
