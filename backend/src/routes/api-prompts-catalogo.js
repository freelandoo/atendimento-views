'use strict'
// Catálogo (somente leitura) de tudo que o agente fala automaticamente:
//  - PROMPTS (prompts/*.md): a "cabeça" da IA por etapa + o GATILHO que dispara cada um.
//  - SAUDAÇÕES e GATILHOS DA AGENDA (services/mensagens-automaticas): textos fixos por empresa.
// Tudo usa {{empresa}}, substituído em runtime pelo nome da empresa/instância.
// JWT + admin. Não edita nada aqui (edição de prompts: agente PJ; de mensagens: contexto).
const { Router } = require('express')
const fs = require('fs')
const path = require('path')
const { requireAuth, requireRole } = require('../middleware/tenant')
const { logger } = require('../logger')
const mensagensSvc = require('../services/mensagens-automaticas')

const router = Router({ mergeParams: true })
const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts')

// Metadados de cada prompt: título amigável + GATILHO (o que faz o agente usá-lo).
const PROMPT_META = {
  'system-core.md': { titulo: 'Núcleo do agente', gatilho: 'Base de TODA resposta do agente no WhatsApp (regras gerais, identidade, tom).' },
  'system-primeiro-contato.md': { titulo: 'Etapa: Primeiro contato', gatilho: 'Disparado quando o lead manda a 1ª mensagem (estágio primeiro_contato).' },
  'system-diagnostico.md': { titulo: 'Etapa: Diagnóstico', gatilho: 'Disparado no estágio de diagnóstico/qualificação do lead.' },
  'system-proposta.md': { titulo: 'Etapa: Proposta', gatilho: 'Disparado quando o agente apresenta valor/proposta e oferta reunião.' },
  'system-objecao.md': { titulo: 'Etapa: Objeção', gatilho: 'Disparado quando o lead levanta objeção (preço, “já tenho”, etc.).' },
  'system-fechamento.md': { titulo: 'Etapa: Fechamento', gatilho: 'Disparado na confirmação de reunião / fechamento.' },
  'tom-referencia.md': { titulo: 'Tom de referência (few-shot)', gatilho: 'Anexado a TODOS os prompts de etapa como exemplos de tom (bons e anti-padrões).' },
  'empresa.md': { titulo: 'Conhecimento autorizado', gatilho: 'Fonte de fatos da empresa que o agente pode citar (links, serviços).' },
  'agent-base.md': { titulo: 'Prompt-base do agente', gatilho: 'Identidade e regras base reutilizadas na montagem dos prompts.' },
  'followup.md': { titulo: 'Follow-up automático', gatilho: 'Disparado pelo worker de follow-up para reengajar lead parado.' },
  'followup_timing.md': { titulo: 'Timing do follow-up', gatilho: 'Decide QUANDO e como direcionar o follow-up automático.' },
  'classificador-intencao.md': { titulo: 'Classificador de intenção', gatilho: 'Roda a cada mensagem do lead para extrair intenção/contexto (interno).' },
  'lead-coach.md': { titulo: 'Coach interno', gatilho: 'Gera dicas para o operador no dashboard (o lead NUNCA vê).' },
}

const GRUPO_LABEL = {
  saudacoes: { titulo: 'Saudações automáticas', gatilho: 'Aberturas/handoff fixos do agente por etapa do funil.' },
  gatilhos_agenda: { titulo: 'Gatilhos da agenda', gatilho: 'Lembretes e remarcação disparados por eventos da agenda (reunião marcada).' },
}

router.use(requireAuth, requireRole('admin'))

// GET /api/prompts-catalogo — prompts (.md) + mensagens automáticas, com gatilhos.
router.get('/', async (_req, res) => {
  try {
    let arquivos = []
    try { arquivos = fs.readdirSync(PROMPTS_DIR).filter((f) => f.endsWith('.md')) } catch { arquivos = [] }
    const prompts = arquivos.map((arquivo) => {
      let conteudo = ''
      try { conteudo = fs.readFileSync(path.join(PROMPTS_DIR, arquivo), 'utf8') } catch { conteudo = '' }
      const meta = PROMPT_META[arquivo] || { titulo: arquivo.replace(/\.md$/, ''), gatilho: 'Prompt do agente.' }
      return {
        arquivo,
        titulo: meta.titulo,
        gatilho: meta.gatilho,
        usa_empresa: /\{\{\s*empresa\s*\}\}/i.test(conteudo),
        chars: conteudo.length,
        conteudo,
      }
    })
    const mensagens = Object.keys(mensagensSvc.GRUPOS).map((grupo) => ({
      grupo,
      titulo: (GRUPO_LABEL[grupo] || {}).titulo || grupo,
      gatilho: (GRUPO_LABEL[grupo] || {}).gatilho || '',
      itens: mensagensSvc.GRUPOS[grupo].etapas.map((e) => ({ chave: e.chave, label: e.label, texto: e.default })),
    }))
    return res.json({
      ok: true,
      data: {
        prompts,
        mensagens,
        observacao: 'Todos os textos usam {{empresa}}, substituído em runtime pelo nome da empresa/instância. Defina EMPRESA_NOME_PADRAO com a marca para o fallback.',
      },
    })
  } catch (err) {
    logger.error({ err: err.message }, 'prompts-catalogo')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao montar catálogo.' } })
  }
})

module.exports = router
