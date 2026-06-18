# 🧠 Arquitetura de Respostas Dinâmicas da IA

**Data:** 2026-05-14  
**Propósito:** Explicar e evoluir o sistema de respostas para ser 100% contextual e sem hardcoding

---

## 📋 PARTE 1: Estado Atual (Problemas)

### Como Funciona Agora

```
Lead envia mensagem
    ↓
Webhook recebe (/webhook)
    ↓
salvarConversa() — armazena no banco
    ↓
enfileirarJobRespostaWebhook() — coloca em fila
    ↓
processarRespostaWebhookDebounced() — processa job
    ↓
gerarEEnviarRespostaWhatsapp()
    ├─ Busca histórico da conversa
    ├─ Monta "prompt do sistema" (rígido, em arquivo .md)
    ├─ Monta "prompt do usuário" (contexto atual)
    └─ Chama Claude/OpenAI
        ↓
    Recebe resposta em texto
        ↓
    Valida contra guardrails (rígidos)
        ↓
    Envia para WhatsApp
```

### Problemas com Essa Abordagem

| Problema | Impacto | Exemplo |
|----------|---------|---------|
| **Prompts em arquivos .md estáticos** | Mudanças requerem restart | Novo padrão de resposta → esperar deploy |
| **Guardrails hardcoded** | Novo tipo de validação = código novo | Precisa checar "Victor"? Vai para production |
| **Estrutura rígida de resposta** | IA responde sempre do mesmo jeito | Lead quer conversa natural, recebe template |
| **Sem feedback em tempo real** | Erros não corrigem sozinhos | Resposta ruim → precisa dar deploy novamente |
| **Decisões pré-definidas** | IA não decide nada | "Sempre ofereça horário" sem analisar contexto |
| **Lógica de negócio acoplada** | Mudança em regra = mudança de código | Preço mudou → precisa alterar prompt |
| **Sem aprendizado** | Mesmos erros repetem | Lead não entendeu → mesma resposta |

---

## 🎯 PARTE 2: Arquitetura Melhorada (Solução)

### Conceito: "Resposta Dinâmica por Raciocínio Estruturado"

A IA **não segue um template** — ela:
1. **Analisa o contexto** completamente
2. **Decide qual a melhor ação** naquele momento
3. **Gera resposta adaptada** para aquele lead específico
4. **Aprende com feedback** para melhorar

```
Lead envia mensagem
    ↓
┌─────────────────────────────────────────────┐
│ FASE 1: ANÁLISE INTELIGENTE (Claude)        │
├─────────────────────────────────────────────┤
│ Input:                                      │
│  - Mensagem do lead                         │
│  - Histórico completo da conversa           │
│  - Contexto da empresa (regras de negócio)  │
│  - Estágio atual do lead                    │
│  - Feedback anterior (se houver)            │
│                                             │
│ Saída JSON estruturado:                     │
│  {                                          │
│    "analise": {                             │
│      "intencao": "pergunta_preco",          │
│      "sentimento": "neutro",                │
│      "contexto": {...},                     │
│      "stage_atual": "diagnostico",          │
│      "dados_faltando": ["orçamento"]        │
│    },                                       │
│    "decisoes": {                            │
│      "oferecer_horario": false,             │
│      "prioridade_collect": "orcamento",     │
│      "tom_resposta": "consultivo",          │
│      "proximo_passo": "aprofundar_dor"      │
│    },                                       │
│    "restricoes": {                          │
│      "nao_mencionar": ["Victor"],           │
│      "nao_prometer": ["primeiro lugar google"]  │
│    }                                        │
│  }                                          │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ FASE 2: VALIDAÇÃO (Guardrails Dinâmicos)   │
├─────────────────────────────────────────────┤
│ Sistema valida as decisões da IA            │
│ contra CONTEXTO e HISTÓRICO, não templates  │
│                                             │
│ Exemplo:                                    │
│  "oferecer_horario: false" ✅               │
│   → porque lead ainda não falou de problema │
│  "tom_consultivo" ✅                        │
│   → porque lead é novo (stage: primeiro)    │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ FASE 3: GERAÇÃO (Resposta Contextual)      │
├─────────────────────────────────────────────┤
│ Input: JSON de análise + decisões           │
│ Prompt: "Você é vendedor consultivo.        │
│          Lead é novo e quer saber sobre     │
│          preço. Ele não mencionou problema. │
│          Aprofunde a dor, não ofereça       │
│          horário ainda. Responda natural."  │
│                                             │
│ Output: Resposta ÚNICA, contextual          │
│ "Ótima pergunta! Antes de falar preço,     │
│  me entendo melhor: qual é o maior          │
│  problema que um site poderia resolver      │
│  para o seu negócio?"                       │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ FASE 4: VALIDAÇÃO FINAL (Guardrails)       │
├─────────────────────────────────────────────┤
│ Checklist:                                  │
│  ✅ Menciona Victor? Não                    │
│  ✅ Promete ranking? Não                    │
│  ✅ Usa termos internos? Não                │
│  ✅ Oferece horário sem validar? Não       │
│  ✅ Faz sentido com contexto? Sim           │
│  ✅ Tom apropriado? Sim                     │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ FASE 5: ENVIO + FEEDBACK                    │
├─────────────────────────────────────────────┤
│ Envia resposta                              │
│ Registra:                                   │
│  - Resposta gerada                          │
│  - Análise que gerou ela                    │
│  - Decisões tomadas                         │
│  - Timestamp                                │
│                                             │
│ Aguarda resposta do lead                    │
│ Sistema aprende:                            │
│  "Lead recebeu 'aprofundar dor'            │
│   e respondeu bem → reforçar essa tática"   │
└─────────────────────────────────────────────┘
    ↓
Envia para WhatsApp
```

---

## 💡 PARTE 3: Implementação Prática

### Passo 1: Schema JSON de Análise

```javascript
// Resposta da IA é SEMPRE um JSON estruturado
const respostaIA = await claude.messages.create({
  model: 'claude-opus-4-7',
  max_tokens: 2000,
  system: `Você é um agente de vendas. 
    Sempre responda em JSON com esta estrutura:
    {
      "analise": {
        "intencao": "string",
        "sentimento": "string",
        "dados_extraidos": {...},
        "stage_recomendado": "string"
      },
      "decisoes": {
        "acao_principal": "string",
        "tom": "string",
        "inclui_pergunta": boolean,
        "inclui_oferta_horario": boolean
      },
      "restricoes": {
        "palavras_proibidas": [],
        "promessas_proibidas": []
      },
      "resposta": "string (a mensagem final em português natural)"
    }`,
  
  messages: [{
    role: 'user',
    content: `
      Lead: "${mensagem}"
      
      Contexto:
      - Histórico: ${JSON.stringify(historico)}
      - Stage: ${estagio}
      - Empresa: PJ Codeworks (sites, marketing digital, automação)
      - Restrições: Nunca mencione Victor, nunca prometa ranking Google
      
      Analise completamente e responda em JSON.
    `
  }]
})

const resultado = JSON.parse(respostaIA.content[0].text)
```

### Passo 2: Validação Inteligente de Guardrails

```javascript
// Em vez de checklist rígido, validação baseada em contexto
async function validarGuardrailsInteligentes(resultado, contexto) {
  const problemas = []
  
  // 1. Palavras proibidas (dinâmicas, do JSON)
  const palavrasProibidas = resultado.restricoes.palavras_proibidas || ['victor']
  for (const palavra of palavrasProibidas) {
    if (resultado.resposta.toLowerCase().includes(palavra.toLowerCase())) {
      problemas.push(`Mencionou "${palavra}" (proibido)`)
    }
  }
  
  // 2. Contexto: ofertar horário apenas se lead já falou de problema
  if (resultado.decisoes.inclui_oferta_horario && !contexto.lead_falou_de_problema) {
    problemas.push('Ofereceu horário sem lead ter falado de problema')
  }
  
  // 3. Contexto: preço em projeto sob medida é arriscado
  if (contexto.projeto_sob_medida && resultado.resposta.match(/\d+.*reais|R\$/)) {
    problemas.push('Mencionou preço em projeto sob medida (dinâmico)')
  }
  
  // 4. Tom apropriado para stage
  const tomPermitido = {
    'primeiro_contato': ['acolhedor', 'consultivo'],
    'diagnostico': ['investigativo', 'consultivo'],
    'proposta': ['convincente', 'profissional'],
    'fechamento': ['urgente', 'convincente']
  }
  
  if (!tomPermitido[contexto.stage]?.includes(resultado.decisoes.tom)) {
    problemas.push(`Tom "${resultado.decisoes.tom}" incomum para stage "${contexto.stage}"`)
  }
  
  return {
    valido: problemas.length === 0,
    problemas,
    resultado
  }
}
```

### Passo 3: Armazenar Análise + Feedback

```javascript
// Guardar não apenas a resposta, mas COMO foi gerada
await pool.query(`
  INSERT INTO vendas.ai_response_log (
    numero,
    mensagem_lead,
    analise_json,      -- JSON completo da análise
    decisoes_json,     -- Decisões tomadas
    resposta_enviada,
    validacao_resultado,
    feedback_score,    -- Lead gostou? (1-5)
    criado_em
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
`, [
  numero,
  mensagem,
  JSON.stringify(resultado.analise),
  JSON.stringify(resultado.decisoes),
  resultado.resposta,
  JSON.stringify(validacao),
  null  -- feedback vem depois
])
```

### Passo 4: Aprendizado Contínuo

```javascript
// Se lead respondeu bem, reforçar estratégia
async function registrarFeedback(numero, resposta_id, score) {
  if (score >= 4) {
    // Extrair o que funcionou
    const { analise, decisoes } = await buscarAnaliseDeResposta(resposta_id)
    
    // Armazenar como "padrão bem-sucedido"
    await pool.query(`
      INSERT INTO vendas.successful_patterns (
        intencao,
        stage,
        acao,
        tom,
        sucesso_count
      ) VALUES ($1, $2, $3, $4, 1)
      ON CONFLICT (intencao, stage, acao) 
      DO UPDATE SET sucesso_count = sucesso_count + 1
    `, [
      analise.intencao,
      analise.stage_recomendado,
      decisoes.acao_principal,
      decisoes.tom
    ])
  }
}
```

---

## 🎓 PARTE 4: Benefícios

| Benefício | Como Funciona |
|-----------|-------------|
| **Sem hardcoding** | Cada resposta é gerada pelo Claude baseada em contexto |
| **Aprende com tempo** | Padrões bem-sucedidos são reforçados |
| **Flexível em tempo real** | Lead muda de assunto? IA detecta e muda estratégia |
| **Guardrails inteligentes** | Validação não é "checklist", é contextual |
| **Rastreável** | Cada decisão está documentada em JSON |
| **Debugging fácil** | Se resposta foi ruim, vejo exatamente por quê |
| **A/B testing** | Posso comparar "tom consultivo" vs "tom urgente" |
| **Transferível entre provedores** | JSON é agnóstico — funciona com Claude, GPT, qualquer um |

---

## 🚀 PARTE 5: Roadmap de Implementação

### Fase 1: Hoje (Fundação)
- [ ] Criar schema JSON de análise
- [ ] Modificar prompt do Claude para retornar JSON estruturado
- [ ] Criar tabela `ai_response_log` para armazenar análises
- [ ] Implementar validação inteligente de guardrails

### Fase 2: Semana que vem (Aprendizado)
- [ ] Criar tabela `successful_patterns` para rastrear padrões bem-sucedidos
- [ ] Sistema de feedback (1-5 stars na resposta)
- [ ] Dashboard mostrando "padrões que funcionam"

### Fase 3: Médio prazo (Otimização)
- [ ] Sistema de "context enrichment" — adicionar mais dados automaticamente
- [ ] A/B testing automático de tons/estratégias
- [ ] Detecção de "padrões de erro" — o quê está falhando

### Fase 4: Longo prazo (Evolução)
- [ ] Fine-tuning do modelo com seus dados
- [ ] Sistema de "personality" — cada operador tem estilo único
- [ ] Integração com CRM externo para mais contexto

---

## 💬 PART 6: Exemplo Real Comparativo

### ANTES (Hardcoded)

```javascript
function gerarResposta(mensagem, estagio) {
  if (estagio === 'primeiro_contato' && mensagem.includes('preço')) {
    return "Ótimo! Nossos sites custam a partir de R$ 3.000..."  // Fixo
  }
  if (estagio === 'diagnostico' && mensagem.includes('como funciona')) {
    return "Temos 3 modelos: básico, profissional e premium..."  // Fixo
  }
  // ... 50 IFs mais
}
```

**Problema:** Lead pergunta "qual é o investimento para um ecommerce com automação?" e a IA responde o template de "primeira conversa", errado!

---

### DEPOIS (Dinâmico)

```javascript
// Claude analisa e responde especificamente:

Claude pensa:
  - Lead perguntou "investimento para ecommerce com automação"
  - Stage: diagnostico
  - Isso = projeto sob medida, não template
  - Lead já mencionou: ecommerce, automação (dados extraídos)
  - Não devo dar preço agora, preciso aprofundar escopo
  - Tom recomendado: investigativo (preciso saber se é customizado)
  - Pergunta chave: "Qual é o diferencial competitivo?"

Claude responde:
  "Entendi — ecommerce + automação é sempre personalizado!
   Antes de falar investimento, me ajuda com um detalhe:
   você quer automação do quê exatamente?
   (ex: carrinhos abandonados, follow-up, recomendações?)
   Porque a complexidade varia muito."
```

**Vantagem:** Resposta é única, contextual, sem template. A IA decidiu que "aprofundar escopo" era melhor que "dar preço".

---

## 🎯 CONCLUSÃO

A diferença é:

| Aspecto | Antes | Depois |
|--------|-------|--------|
| **Lógica** | IF/THEN rígido | Raciocínio contextual |
| **Flexibilidade** | Fixa (código) | Dinâmica (IA decide) |
| **Escalabilidade** | +1 padrão = +1 IF | Sem limite (IA generaliza) |
| **Aprendizado** | Manual | Automático (feedback) |
| **Ajustes** | Deploy requerido | Runtime (JSON config) |
| **Debugging** | "Por quê aquela resposta?" → investigação manual | "Por quê aquela resposta?" → JSON tem a análise completa |

**Está pronto para implementar?**

