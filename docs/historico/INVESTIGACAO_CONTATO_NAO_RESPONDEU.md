# 🔍 Investigação: Por que a mensagem não chegou no contato

**Data:** 2026-05-14  
**Status:** 🐛 BUG ENCONTRADO E CORRIGIDO

---

## 🚨 BUG CRÍTICO ENCONTRADO

### Arquivo: `src/webhook-handler.js` (Linhas 84-97)

**Problema:** Variável `chaveEvt` referenciada antes de ser definida

```javascript
// ❌ ANTES (ERRADO)
const chaveEvtPreMedia = construirChaveIdempotenciaWebhookMensagem(msg)  // Linha 84
if (!(await webhookMensagemDeveSerProcessada(chaveEvtPreMedia, numero))) {
  webhookLog.info({ dedupe_key: chaveEvt }, '...')  // ❌ chaveEvt NÃO EXISTE AQUI!
  return
}

// Depois de muitos passos...
const chaveEvt = construirChaveIdempotenciaWebhookMensagem(msg)  // Linha 93 - AGORA define!
```

**Impacto:**
- Erro no logger ao tentar registrar `chaveEvt` indefinido
- Pode estar lançando exceção silenciosa que cancela o processamento
- Webhook recebido mas não processado = **contato não recebe resposta**

**Solução aplicada:**
✅ Linhas consolidadas, `chaveEvt` definido ANTES do primeiro check

---

## 📊 Fluxo de processamento do webhook

```
1. Webhook chega em /webhook
   ↓
2. Valida autenticação (secret)
   ↓
3. Extrai evento (deve ser 'messages.upsert')
   ↓
4. Extrai JID remoto (conversa 1:1)
   ↓
5. Verifica se é operador autorizado → se sim, processa comando e retorna
   ↓
6. Verifica se é 'fromMe' (mensagem nossa) → se sim, processa intervenção e retorna
   ↓
7. ⚠️ [BUG ESTAVA AQUI] Verifica duplicata com chaveEvt
   ↓
8. Extrai texto/mídia da mensagem
   ↓
9. Salva conversa no banco
   ↓
10. Cancela followups pendentes
    ↓
11. Valida se pode gerar resposta automática
    ↓
12. Enfileira job 'webhook_resposta' na fila
    ↓
13. jobWorker processa: reivindicaProximoJob() → processarRespostaWebhookDebounced()
    ↓
14. Gera resposta com Claude (gerarEEnviarRespostaWhatsapp)
    ↓
15. Envia para Evolution API com payload: { number, text }
    ↓
16. ✅ Contato recebe resposta
```

---

## 🔍 Possíveis pontos de falha (além do bug corrigido)

### 1. **JID em formato @lid (sem número de telefone)**
   - **Localização:** `webhook-handler.js:61-65`
   - **Sintoma:** Aviso no log sobre @lid sem remoteJidAlt
   - **Causa:** Evolution API retorna JID com @lid ao invés de número do WhatsApp
   - **Check:** Ver se contato tem `@lid` no remoteJid
   - **Solução:** Aguardar Evolution API atualizar ou integrar suporte a @lid

### 2. **Validação `podeGerarRespostaAutomatica` retorna false**
   - **Localização:** `agent.js:223-229`
   - **Função:** Verifica se última mensagem no histórico é do lead (real)
   - **Possíveis causas:**
     - Histórico vazio
     - Última mensagem é do operador (fromMe=true)
     - Mensagem marcada como sistema/interna
     - Texto vazio
   - **Check:** SELECT historico FROM vendas.conversas WHERE numero = '[NUMBER]'

### 3. **Job enfileirado mas não processado**
   - **Localização:** `agent.js:298-319`
   - **Causa possível:** jobWorker parado ou error não capturado
   - **Check:** SELECT * FROM vendas.job_queue WHERE tipo='webhook_resposta' AND status != 'completed'

### 4. **Falha ao enviar pela Evolution API**
   - **Localização:** `src/whatsapp.js`
   - **Última correção:** Payload mudado de `{ number, textMessage }` para `{ number, text }`
   - **Causa possível:** Número inválido, API key expirada, instância deletada
   - **Check:** Logs de Evolution (erro HTTP 400, 401, 403, 404, 5xx)

---

## ✅ Como verificar o status do contato

### No Railway (banco de dados):

```sql
-- 1. Listar contatos recentes que não receberam resposta
SELECT numero, nome, estagio, status, criado_em, atualizado_em
FROM vendas.conversas
WHERE criado_em > NOW() - INTERVAL '24 hours'
ORDER BY criado_em DESC;

-- 2. Verificar se há jobs pendentes
SELECT id, tipo, dedupe_key, payload, status, attempts, available_at
FROM vendas.job_queue
WHERE tipo = 'webhook_resposta' AND status IN ('pending', 'processing')
ORDER BY criado_em DESC;

-- 3. Verificar erros de resposta registrados
SELECT numero, erro_codigo, erro_detalhe, tentativas, criado_em
FROM vendas.response_failures
WHERE criado_em > NOW() - INTERVAL '24 hours'
ORDER BY criado_em DESC;

-- 4. Ver histórico do contato específico (substitua NUMERO)
SELECT numero, historico, estagio, agente_pausado
FROM vendas.conversas
WHERE numero = '55XXXXXXXXXXX';

-- 5. Verificar se há @lid no JID
SELECT numero, historico 
FROM vendas.conversas
WHERE numero LIKE '%@lid%' OR numero LIKE '%sid%'
LIMIT 10;
```

### Nos logs (Railway ou local):

```bash
# 1. Procurar por "chaveEvt" (erro de variável)
grep -i "chaveEvt" /var/log/app.log

# 2. Procurar por "Webhook ignorado"
grep "Webhook ignorado" /var/log/app.log

# 3. Procurar por "Resposta automatica bloqueada"
grep "bloqueada" /var/log/app.log

# 4. Procurar por erros de Evolution
grep -i "evolution\|erro\|error" /var/log/app.log | tail -50
```

---

## 🛠️ Ações recomendadas

### Imediato (🔴 CRÍTICO):
1. ✅ **Aplicar fix da variável `chaveEvt`** ← JÁ FEITO
2. 📋 **Verificar logs no Railway** para confirmar que o erro foi resolvido
3. 📊 **Testar com novo contato** para validar fluxo

### Curto prazo (🟡 IMPORTANTE):
4. Consolidar lógica de duplicata (linhas 84-97 estavam redundantes)
5. Adicionar melhor tratamento de erros no webhook
6. Adicionar testes de ponta a ponta (webhook → resposta)

### Médio prazo (🟢 MELHORIAS):
7. Suporte a JID em formato @lid (Evolution API)
8. Dashboard para monitorar jobs pendentes
9. Alertas automáticos para falhas de webhook

---

## 📌 Resumo

**Problema identificado:** Variável `chaveEvt` referenciada antes de ser definida no webhook-handler.js

**Causa:** Refatoração anterior deixou resíduo de código duplicado

**Impacto:** Webhook pode estar lançando erro ao verificar duplicata, bloqueando processamento

**Solução:** ✅ Código consolidado na linha 84-91

**Próximo passo:** Verificar logs no Railway para confirmar que novos webhooks estão sendo processados corretamente

---

**Commit:** Pendente (aguardando validação em produção)
