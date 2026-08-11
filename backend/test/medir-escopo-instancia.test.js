'use strict'
// Testes do script de MEDICAO read-only do escopo por instancia (Fase 0).
//
// O teste mais importante aqui NAO e' de comportamento: e' a GUARDA DE REGRESSAO que le o
// fonte do script e falha se qualquer verbo de escrita aparecer nele. O script promete
// "read-only" no cabecalho e roda contra PRODUCAO; uma promessa dessas precisa de algo que
// quebre o build quando alguem a violar, e nao de um revisor atento.
//
// Nao ha conexao com banco em nenhum destes testes.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const CAMINHO = path.join(__dirname, '..', 'scripts', 'medir-escopo-instancia.js')
const FONTE = fs.readFileSync(CAMINHO, 'utf8')

const {
  mascarar,
  classificarAtribuibilidade,
  tabela,
  montarAchados,
} = require('../scripts/medir-escopo-instancia')

/**
 * Remove comentarios de linha e de bloco.
 *
 * Necessario porque o proprio cabecalho do script CITA os verbos proibidos ao declarar que
 * nao os usa. Sem tirar comentario, a guarda acusaria a documentacao dela mesma.
 */
function semComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
}

test('GUARDA: o script nao contem nenhuma operacao de escrita', () => {
  const codigo = semComentarios(FONTE)
  const proibidos = [
    [/\bINSERT\s+INTO\b/i, 'INSERT INTO'],
    [/\bUPDATE\s+[a-z_"]/i, 'UPDATE <tabela>'],
    [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
    [/\bALTER\s+(TABLE|SCHEMA|INDEX|SEQUENCE)\b/i, 'ALTER'],
    [/\bCREATE\s+(TABLE|INDEX|TEMP|TEMPORARY|SCHEMA|VIEW|EXTENSION)\b/i, 'CREATE'],
    [/\bDROP\s+(TABLE|INDEX|COLUMN|SCHEMA|CONSTRAINT)\b/i, 'DROP'],
    [/\bTRUNCATE\b/i, 'TRUNCATE'],
    [/\bGRANT\b|\bREVOKE\b/i, 'GRANT/REVOKE'],
    [/\bSELECT\b[\s\S]{0,400}?\bINTO\s+[a-z_"]/i, 'SELECT ... INTO'],
    [/\bCOPY\s+[a-z_"]+\s+FROM\b/i, 'COPY ... FROM'],
    [/\bnextval\s*\(|\bsetval\s*\(/i, 'nextval/setval'],
    [/\bFOR\s+UPDATE\b|\bFOR\s+NO\s+KEY\s+UPDATE\b/i, 'SELECT ... FOR UPDATE'],
  ]
  for (const [re, rotulo] of proibidos) {
    assert.equal(
      re.test(codigo),
      false,
      `medir-escopo-instancia.js passou a conter "${rotulo}". Este script roda contra producao e precisa continuar sendo somente leitura.`
    )
  }
})

test('GUARDA: a sessao e aberta em READ ONLY e termina em ROLLBACK', () => {
  assert.match(FONTE, /BEGIN TRANSACTION READ ONLY/)
  assert.match(FONTE, /client\.query\('ROLLBACK'\)/)
  // COMMIT nao pode aparecer: numa transacao read-only ele seria inofensivo, mas sinalizaria
  // que alguem passou a pensar neste script como algo que conclui trabalho.
  assert.equal(/client\.query\(\s*['"]COMMIT/i.test(FONTE), false, 'o script nao deve dar COMMIT')
})

test('GUARDA: o script nao faz chamada externa nem envia mensagem', () => {
  const codigo = semComentarios(FONTE)
  // A palavra "whatsapp" aparece legitimamente em nomes de tabela/coluna
  // (`app.empresa_whatsapp_instances`), entao o que se proibe e' o MODULO de transporte e
  // qualquer cliente HTTP — nao o substantivo.
  for (const proibido of ['axios', 'node-fetch', 'enviarMensagem', 'EVOLUTION_URL', "require('../src/whatsapp", "require('./whatsapp"]) {
    assert.equal(
      codigo.includes(proibido),
      false,
      `medir-escopo-instancia.js passou a referenciar "${proibido}". A medicao nao fala com servico externo nem dispara nada.`
    )
  }
})

test('GUARDA: nenhuma dependencia nova — so `pg`', () => {
  const requires = [...FONTE.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  for (const dep of requires) {
    const interno = dep.startsWith('.') || dep.startsWith('node:')
    assert.ok(
      interno || dep === 'pg',
      `medir-escopo-instancia.js passou a exigir "${dep}". A Fase 0 nao pode introduzir dependencia.`
    )
  }
})

test('mascarar reduz o id ao prefixo e nomeia a ausencia', () => {
  assert.equal(mascarar('00000000-0000-0000-0000-000000000001'), '00000000…')
  assert.equal(mascarar(null), '(sem empresa)')
  assert.equal(mascarar(''), '(sem empresa)')
  assert.equal(mascarar(undefined, '(sem id)'), '(sem id)')
  // Nunca devolve o UUID inteiro, que e' o ponto do mascaramento.
  assert.equal(mascarar('abcdefgh-ijkl').includes('ijkl'), false)
})

test('classificarAtribuibilidade: conversa que ja tem instancia', () => {
  assert.equal(
    classificarAtribuibilidade({ temInstancia: true, empresaId: 'e1', ativasNaEmpresa: 5 }),
    'ja_atribuida'
  )
})

test('classificarAtribuibilidade: empresa com UMA instancia ativa e atribuivel', () => {
  assert.equal(
    classificarAtribuibilidade({ temInstancia: false, empresaId: 'e1', ativasNaEmpresa: 1 }),
    'atribuivel'
  )
})

test('classificarAtribuibilidade: 2+ instancias ativas NUNCA e atribuivel', () => {
  // E o coracao da regra: escolher uma instancia aqui repetiria, agora de forma permanente,
  // o defeito do fallback "instancia mais recentemente atualizada".
  for (const n of [2, 3, 10]) {
    assert.equal(
      classificarAtribuibilidade({ temInstancia: false, empresaId: 'e1', ativasNaEmpresa: n }),
      'nao_atribuivel'
    )
  }
})

test('classificarAtribuibilidade: sem empresa vira quarentena analitica, nunca a PJ', () => {
  assert.equal(
    classificarAtribuibilidade({ temInstancia: false, empresaId: null, ativasNaEmpresa: 1 }),
    'quarentena_analitica'
  )
})

test('classificarAtribuibilidade: empresa sem instancia ativa tem rotulo proprio', () => {
  assert.equal(
    classificarAtribuibilidade({ temInstancia: false, empresaId: 'e1', ativasNaEmpresa: 0 }),
    'sem_instancia_ativa'
  )
  // Ausencia de contagem nao pode ser lida como "uma".
  assert.equal(
    classificarAtribuibilidade({ temInstancia: false, empresaId: 'e1', ativasNaEmpresa: null }),
    'sem_instancia_ativa'
  )
})

test('tabela alinha colunas e nunca deixa celula vazia sem rotulo', () => {
  const saida = tabela(['a', 'bbbb'], [['x', 1], [null, 22]], ['e', 'd'])
  const linhas = saida.split('\n')
  assert.equal(linhas.length, 4) // cabecalho + separador + 2 linhas
  assert.match(linhas[1], /─/)
  assert.match(linhas[3], /—/) // null virou travessao, nao string vazia
  assert.equal(/\s$/.test(linhas[2]), false) // sem espaco sobrando no fim
})

function dadosBase(over = {}) {
  return {
    empresas: { com_2_ou_mais_ativas: 0, empresas_com_instancia: 1 },
    conversas: {
      total: 100, sem_instancia: 0, instancia_orfa: 0,
      instancia_de_outra_empresa: 0, sem_empresa: 0, pj_sem_prova_de_instancia: 0,
    },
    atribuibilidade: { atribuivel: 0, nao_atribuivel: 0 },
    instancias: { ativas_sem_conversa: 0, inativas_com_conversa: 0, origem_legado: 0 },
    quarentena: { abertas: 0 },
    ...over,
  }
}

test('montarAchados: ambiente limpo devolve so o veredito ok', () => {
  const achados = montarAchados(dadosBase())
  assert.ok(achados.every((a) => a.nivel === 'ok' || a.nivel === 'info'))
  assert.ok(achados.some((a) => /Nenhuma empresa opera com 2\+/.test(a.texto)))
})

test('montarAchados: multi-instancia vira achado ALTO', () => {
  const achados = montarAchados(dadosBase({ empresas: { com_2_ou_mais_ativas: 3 } }))
  assert.ok(achados.some((a) => a.nivel === 'alto' && /2\+ instancias ativas/.test(a.texto)))
})

test('montarAchados: instancia de outra empresa e CRITICO', () => {
  const achados = montarAchados(dadosBase({
    conversas: { ...dadosBase().conversas, instancia_de_outra_empresa: 4 },
  }))
  assert.ok(achados.some((a) => a.nivel === 'critico'))
})

test('montarAchados: conversas nao atribuiveis sao reportadas como bloqueio de backfill', () => {
  const achados = montarAchados(dadosBase({
    conversas: { ...dadosBase().conversas, sem_instancia: 30 },
    atribuibilidade: { atribuivel: 10, nao_atribuivel: 20 },
  }))
  assert.ok(achados.some((a) => /NAO podem ser atribuidas por backfill/.test(a.texto)))
  assert.ok(achados.some((a) => /seguramente atribuiveis/.test(a.texto)))
})

test('montarAchados: quarentena aberta aparece como risco alto', () => {
  const achados = montarAchados(dadosBase({ quarentena: { abertas: 2 } }))
  assert.ok(achados.some((a) => a.nivel === 'alto' && /webhook_quarentena/.test(a.texto)))
})
