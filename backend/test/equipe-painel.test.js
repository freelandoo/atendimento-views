'use strict'
// Painel da EQUIPE + remoção dos DEFAULT = PJ (CRM em equipe, Etapa 12).

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ')
const semSqlComment = (src) => src.replace(/^\s*--[^\n]*$/gm, ' ')

const rotaEquipe = fonte(path.join('src', 'routes', 'api-equipe.js'))
const mig078 = fonte(path.join('sql', 'migrations', '078_remover_default_pj.sql'))
const indexJs = fonte('index.js')

// ─── O painel ────────────────────────────────────────────────────────────────────────────

test('o painel da equipe NAO tem SQL proprio de contagem — reusa cada modulo', () => {
  // Reescrever as consultas aqui criaria uma segunda definicao de "quantos leads o vendedor X
  // tem", e as duas divergiriam no primeiro ajuste.
  const src = semComentarios(rotaEquipe)
  for (const proibido of ['FROM prospectador.prospects', 'FROM vendas.conversas', 'FROM app.follow_ups', 'FROM app.ligacoes']) {
    assert.ok(!src.includes(proibido), `api-equipe.js nao pode consultar diretamente: ${proibido}`)
  }
  for (const reuso of ['LR.contagemPorResponsavel', 'CR.contagemPorResponsavel', 'FU.contagemPorResponsavel', 'LIG.contagemPorUsuario']) {
    assert.ok(rotaEquipe.includes(reuso), `o painel precisa reusar ${reuso}`)
  }
})

test('a UNICA consulta propria do painel e a de auditoria, e ela e estreita', () => {
  // A migration 047 declara que a auditoria "NAO deve ser fonte de dashboards". O que a rota
  // devolve e' a lista das ultimas acoes de UMA pessoa — rastreabilidade, nao metrica.
  const src = semComentarios(rotaEquipe)
  const selects = [...src.matchAll(/FROM\s+([a-z_]+\.[a-z_]+)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(selects)], ['app.auditoria_eventos'])
  const i = rotaEquipe.indexOf("'/:usuarioId/atividade'")
  const bloco = rotaEquipe.slice(i, i + 1400)
  assert.ok(/ORDER BY a\.ocorrido_em DESC/.test(bloco), 'cronologica inversa, nao agregada')
  assert.ok(/LIMIT \$3/.test(bloco))
  assert.ok(!/COUNT\(|GROUP BY|SUM\(/.test(bloco), 'a auditoria nao pode virar metrica agregada')
})

test('o painel exige MEMBROS_GERENCIAR, nao uma capacidade nova', () => {
  // Quem gerencia as contas e' quem responde pela distribuicao do trabalho. Uma capacidade
  // `equipe_ver` separada produziria uma terceira resposta para a mesma pergunta.
  for (const linha of rotaEquipe.split('\n').filter((l) => l.includes('router.get('))) {
    assert.ok(linha.includes('requireCapacidade(CAP.MEMBROS_GERENCIAR)'), `rota sem gate: ${linha.trim().slice(0, 80)}`)
    const iEmpresa = linha.indexOf('requireEmpresaAccess')
    const iCap = linha.indexOf('requireCapacidade')
    assert.ok(iEmpresa > 0 && iEmpresa < iCap, 'ordem errada dos middlewares')
  }
  assert.ok(indexJs.includes("'/api/empresas/:empresaId/equipe'"), 'o mount do painel sumiu')
})

test('o trabalho SEM DONO e uma linha propria do painel', () => {
  // E' justamente o que o admin precisa ver para redistribuir; sem ele a soma das linhas nao
  // fecharia com o total.
  assert.ok(rotaEquipe.includes('sem_responsavel'))
  assert.ok(rotaEquipe.includes("nome: 'Sem responsável'"))
})

test('quem foi DESATIVADO continua aparecendo, com aviso de carga', () => {
  // Politica de desativacao (§6.1 da especificacao): o trabalho nao some junto com o acesso, e
  // redistribuir e' acao explicita do admin.
  assert.ok(rotaEquipe.includes('inativos_com_carga'))
  // `ativo` precisa cobrir os DOIS niveis (vinculo e conta na plataforma).
  assert.ok(/m\.ativo !== false && m\.usuario_ativo !== false/.test(rotaEquipe),
    'mostrar "ativo" para quem tem a conta desativada mandaria o admin procurar no lugar errado')
})

// ─── Etapa 12.3: os DEFAULT = PJ ─────────────────────────────────────────────────────────

test('a 078 remove o DEFAULT das 6 tabelas e NAO muta dado', () => {
  const sql = semSqlComment(mig078)
  assert.ok(/DROP DEFAULT/.test(sql))
  for (const t of ['prospects', 'conversas', 'lead_profiles', 'followup_envios', 'analises_pos_conversa', 'ai_logs']) {
    assert.ok(sql.includes(`'${t}'`), `a 078 precisa cobrir ${t}`)
  }
  assert.ok(!/\bUPDATE\s+/i.test(sql), 'nao pode mutar linha: corrigir retroativamente e backfill')
  assert.ok(!/SET NOT NULL/i.test(sql), 'NOT NULL derrubaria o boot com as linhas antigas')
})

test('os DOIS INSERTs que dependiam do DEFAULT passaram a informar empresa_id', () => {
  // Sem isto, remover o DEFAULT faria a linha nascer NULA e sumir dos paineis por empresa.
  const dbCrud = fonte(path.join('src', 'db-crud.js'))
  const iFe = dbCrud.indexOf('INSERT INTO vendas.followup_envios')
  const blocoFe = dbCrud.slice(iFe, iFe + 700)
  assert.ok(/empresa_id\)/.test(blocoFe), 'followup_envios precisa informar empresa_id')
  assert.ok(/SELECT c\.empresa_id FROM vendas\.conversas c WHERE c\.numero = \$1/.test(blocoFe),
    'a empresa precisa vir da CONVERSA, dentro do SQL (padrao da migration 058)')

  const learning = fonte(path.join('src', 'learning.js'))
  const iAn = learning.indexOf('INSERT INTO vendas.analises_pos_conversa')
  const blocoAn = learning.slice(iAn, iAn + 900)
  assert.ok(/empresa_id\)/.test(blocoAn), 'analises_pos_conversa precisa informar empresa_id')
  assert.ok(/SELECT c\.empresa_id FROM vendas\.conversas c WHERE c\.numero = \$1/.test(blocoAn))
})

test('os dois INSERTs corrigidos NAO caem na PJ quando a conversa nao existe', () => {
  // Conversa inexistente => NULL. Inventar dono e' o defeito que a 058 teve de desfazer.
  for (const rel of [path.join('src', 'db-crud.js'), path.join('src', 'learning.js')]) {
    const src = fonte(rel)
    const alvo = rel.includes('learning') ? 'INSERT INTO vendas.analises_pos_conversa' : 'INSERT INTO vendas.followup_envios'
    const i = src.indexOf(alvo)
    const bloco = semSqlComment(src.slice(i, i + 900))
    assert.ok(!/COALESCE\([^)]*00000000-0000-0000-0000-000000000001/.test(bloco),
      `${rel}: nenhum fallback para a PJ neste INSERT`)
  }
})

test('a 078 NAO remove o fallback da PJ no CODIGO — isso e dívida separada e declarada', () => {
  // `COALESCE($n, PJ)` em db-crud.js/historico-envio.js e o PJ_EMPRESA_ID de api-conversas.js sao
  // decisao de produto sobre conversa ORFA, documentada no AGENTS.md. Removê-los junto misturaria
  // duas mudancas de comportamento num diff so'.
  assert.ok(fonte(path.join('src', 'db-crud.js')).includes('00000000-0000-0000-0000-000000000001'),
    'o fallback da aplicacao continua existindo (dívida separada)')
  // E a migration precisa DIZER isso, para ninguem achar que o tema foi encerrado.
  assert.ok(/N[AÃ]O remove o fallback da PJ no C[OÓ]DIGO/i.test(mig078),
    'a migration precisa declarar o que ela nao faz')
})

test('todo INSERT nas 6 tabelas informa empresa_id (a auditoria que a 078 exigiu)', () => {
  // E' a guarda que impede o DEFAULT de ser "reintroduzido na pratica" por um INSERT novo que
  // esqueca a coluna — agora sem rede de seguranca, a linha nasceria NULA.
  const alvos = [
    ['prospectador.prospects', ['src/prospecting.js', 'src/routes/api-banco-leads.js', 'src/services/social-capture.js']],
    ['vendas.conversas', ['src/db-crud.js', 'src/services/followup-manual.js', 'src/services/historico-envio.js']],
    ['vendas.followup_envios', ['src/db-crud.js', 'src/services/followup-manual.js']],
    ['vendas.analises_pos_conversa', ['src/learning.js']],
    ['vendas.ai_logs', ['src/ai-provider.js']],
  ]
  for (const [tabela, arquivos] of alvos) {
    for (const rel of arquivos) {
      const src = fonte(rel.replace(/\//g, path.sep))
      let i = src.indexOf(`INSERT INTO ${tabela}`)
      while (i >= 0) {
        const bloco = src.slice(i, i + 800)
        assert.ok(/empresa_id/.test(bloco),
          `${rel}: um INSERT em ${tabela} nao informa empresa_id — sem o DEFAULT, a linha nasceria NULA`)
        i = src.indexOf(`INSERT INTO ${tabela}`, i + 1)
      }
    }
  }
})
