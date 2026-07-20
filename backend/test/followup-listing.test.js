'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { montarCallList } = require('../src/services/followup-listing')

test('fila humana inclui handoff imediato e prompt externo quando ha contexto', async () => {
  let consulta = ''
  const pool = {
    async query(sql) {
      consulta = String(sql)
      return {
        rows: [
          {
            numero: '551100000001@s.whatsapp.net', nome: 'Lead handoff', estagio: 'diagnostico',
            status: 'aguardando_handoff', agente_pausado: true, pronto_handoff: true,
            negocio: null, cidade: null, score_lead: 0, dias_silencio: 0,
            respondeu_alguma_vez: true, ultimo_texto_usuario: 'Quero falar com uma pessoa',
            pediu_preco: false, recebeu_proposta: false, followups_ignorados: 0,
            reuniao_pendente: false, recebeu_preview: false,
          },
          {
            numero: '551100000002@s.whatsapp.net', nome: 'Marcenaria Horizonte', estagio: 'diagnostico',
            status: 'ativo', agente_pausado: false, pronto_handoff: false,
            negocio: 'Marcenaria Horizonte', cidade: 'Santos', score_lead: 60,
            produto_sugerido: 'site institucional', complexidade: 'landing',
            dor_principal: 'receber pedidos no WhatsApp', contexto_prospeccao: { tem_site: false },
            dias_silencio: 1, respondeu_alguma_vez: true,
            ultimo_texto_usuario: 'Como ficaria um exemplo visual?',
            pediu_preco: false, recebeu_proposta: false, followups_ignorados: 0,
            reuniao_pendente: false, recebeu_preview: false,
          },
        ],
      }
    },
  }

  const lista = await montarCallList(pool, 'empresa-1', { limit: 20 })

  assert.equal(lista.length, 2)
  assert.equal(lista[0].acao_recomendada, 'assumir_conversa')
  assert.equal(lista[1].acao_recomendada, 'copiar_prompt_preview')
  assert.match(lista[1].prompt_preview, /Marcenaria Horizonte/)
  assert.match(consulta, /c\.status IN \('ativo', 'aguardando_handoff'\)/)
  assert.match(consulta, /e\.tipo = 'recebeu_preview'/)
})
