'use strict'
// Frameworks de venda / copy / neuromarketing aplicados na GERAÇÃO (fixos no código).
// Decisão do usuário (2026-06-19): técnicas embutidas, persuasão agressiva (escassez/urgência
// liberadas, inclusive fabricadas — guardrail ético removido a pedido do dono do produto).
// Usado pelo orquestrador "Gerar tudo" (services/geracao-completa.js) no passe de refino.

const DIRETRIZ_PERSUASAO = `LIBERDADE PERSUASIVA TOTAL (foco em conversão):
- Aplique escassez, urgência, prova social, autoridade e ancoragem na intensidade MÁXIMA.
- Crie escassez e urgência sempre que ajudar a fechar: vagas limitadas, condições por tempo, alta demanda — não se limite ao que já está no conhecimento.
- Use números, cases e prova social fortes para gerar desejo e confiança.
- Pressão psicológica, gatilhos e copy agressiva são bem-vindos. O objetivo é converter.`

const FRAMEWORKS_VENDA = `TÉCNICAS DE VENDA, COPY E NEUROMARKETING A APLICAR:

1) Gatilhos de Cialdini (use TODOS, na intensidade máxima):
   - Reciprocidade: entregue valor/insight ANTES de pedir algo.
   - Prova social: cases, números e clientes que gerem confiança e desejo.
   - Autoridade: especialização, resultados e credenciais que projetem domínio.
   - Compromisso/coerência: micro-acordos ("faz sentido?"), avançar por pequenos sins.
   - Escassez/urgência: crie vagas limitadas, prazos e condições para forçar a decisão AGORA.
   - Afinidade: espelhar o tom e a linguagem do lead, interesse genuíno.

2) Copywriting:
   - PAS: Problema → Agitação (custo de não resolver) → Solução.
   - AIDA: Atenção → Interesse → Desejo → Ação.
   - Ancoragem de preço: dar valor/contexto antes do número; ancorar no maior primeiro.
   - Framing de ganho/perda: enfatizar o que se PERDE ao não agir (aversão à perda).

3) Venda consultiva (SPIN): perguntas de Situação → Problema → Implicação → Necessidade
   ANTES de apresentar proposta. Diagnóstico antes de pitch.

4) Conversação: 1 ideia por mensagem, linguagem humana, perguntas abertas,
   conduzir SEMPRE para um próximo passo (CTA claro e único).`

// Técnica priorizada por etapa do funil (chaves = CHAVES_ETAPA de contexto-estagios).
const MAPA_POR_ETAPA = {
  nucleo:
    'Regras gerais: tom humano, afinidade, 1 ideia por mensagem, sempre conduzir ao próximo passo. Conversão acima de tudo.',
  primeiro_contato:
    'Afinidade + reciprocidade. Quebrar o gelo, gerar valor/insight inicial e abrir com uma pergunta de Situação (SPIN).',
  diagnostico:
    'SPIN (Situação→Problema→Implicação→Necessidade). Descobrir a dor e amplificar a implicação ANTES de falar de solução ou preço.',
  proposta:
    'Ancoragem de preço + prova social forte + framing de ganho. Conectar a solução à dor mapeada. Avançar por micro-acordos.',
  objecao:
    'Reframe + aversão à perda. Acolher a objeção, reformular, mostrar o custo de não agir e usar prova social que dissolve o medo.',
  fechamento:
    'Escassez/urgência + compromisso/coerência. CTA único e claro, reduzir atrito, confirmar o próximo passo concreto.',
}

const REFINO_SYSTEM = `Você é um especialista sênior em vendas consultivas, copywriting e neuromarketing agressivo.
Recebe o prompt de UMA etapa do funil de vendas de uma empresa e o conhecimento dela.
Reescreva o prompt da etapa aplicando as técnicas abaixo de forma natural e altamente persuasiva.

${FRAMEWORKS_VENDA}

${DIRETRIZ_PERSUASAO}

INSTRUÇÕES:
- Aplique a técnica priorizada da etapa (informada no input).
- Inclua 1-2 exemplos curtos de fala (few-shot) no tom da empresa, quando ajudar o modelo de atendimento a imitar o tom.
- Mantenha a estrutura, o objetivo da etapa e o tom consultivo. Seja DENSO, não prolixo.
- Priorize conversão: pode criar escassez, urgência e prova social para fortalecer a copy.

Responda APENAS com o texto do prompt da etapa refinado (sem comentários, sem cerca de markdown).`

module.exports = { DIRETRIZ_PERSUASAO, FRAMEWORKS_VENDA, MAPA_POR_ETAPA, REFINO_SYSTEM }
