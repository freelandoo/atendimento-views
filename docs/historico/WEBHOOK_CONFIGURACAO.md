# 🔗 Configuração de Webhook na Evolution API

**Data:** 2026-05-14  
**Status:** 📋 Investigação

---

## 📍 Estado Atual

### Webhook no Projeto
- ✅ **Endpoint registrado:** `POST /webhook` em `src/webhook-handler.js`
- ✅ **Validação de autenticação:** `webhookAutorizado(req)` verifica header `x-reprocess-secret`
- ✅ **Processamento:** Recebe eventos `messages.upsert` da Evolution API
- ✅ **Armazenamento:** Salva mensagens em `vendas.conversas`

### Webhook na Evolution API
- ❓ **URL do webhook:** Não encontrado em código - provavelmente configurado manualmente no painel Evolution

---

## ❓ Pergunta do Usuário

> "O webhook já está funcionando normal dentro do projeto railway? Ou existe algum webhook"

### Resposta

#### 1️⃣ **Webhook no Railway está pronto**
O backend já está preparado para receber webhooks:
```javascript
POST /webhook
Headers:
  x-reprocess-secret: [seu REPROCESS_SECRET]
  Content-Type: application/json

Body (exemplo):
{
  "event": "messages.upsert",
  "data": {
    "messages": [{
      "key": { "remoteJid": "55XXXXXXXXXXX@s.whatsapp.net" },
      "message": { "conversation": "Olá" }
    }]
  }
}
```

#### 2️⃣ **Webhook na Evolution precisa estar configurado**
Você precisa acessar o painel da Evolution API e:

1. Ir em: **Instances** → **sua-instancia** → **Settings** → **Webhooks**
2. Configurar URL para: `https://[seu-dominio-railway]/webhook`
3. Adicionar header: `x-reprocess-secret: [seu REPROCESS_SECRET]`

---

## 🔧 Como verificar se está funcionando

### 1. Verificar se o endpoint `/webhook` está respondendo

```bash
# Local
curl -X POST http://localhost:3000/webhook \
  -H "x-reprocess-secret: seu_secret" \
  -H "Content-Type: application/json" \
  -d '{"event":"messages.upsert","data":{"messages":[]}}'

# Em produção (Railway)
curl -X POST https://[seu-projeto-railway]/webhook \
  -H "x-reprocess-secret: seu_secret" \
  -H "Content-Type: application/json" \
  -d '{"event":"messages.upsert","data":{"messages":[]}}'
```

Resultado esperado:
```json
{ "ok": true }
```

### 2. Simular mensagem chegando

Use o script de teste (se existir):
```bash
node scripts/test-webhook.js
```

### 3. Verificar se mensagem foi salva no banco

```sql
SELECT numero, historico, criado_em
FROM vendas.conversas
WHERE criado_em > NOW() - INTERVAL '1 hour'
ORDER BY criado_em DESC
LIMIT 10;
```

### 4. Monitorar logs do Railway

```bash
railway logs --follow
# ou via web: railway.app → Logs
```

---

## 🐛 Possíveis Problemas

| Problema | Sintoma | Solução |
|----------|---------|---------|
| Webhook URL não configurado na Evolution | Nenhuma mensagem chega | Configurar URL em Evolution Dashboard |
| `x-reprocess-secret` inválido | Erro 401 no webhook | Usar mesmo valor do `.env` REPROCESS_SECRET |
| Webhook URL errada (HTTP em vez de HTTPS) | Erro de conexão | Usar HTTPS em produção |
| Evolution enviando para IP:porta errado | Webhook não recebido | Verificar URL em Evolution Settings |
| Domínio DNS não resolve | Erro de conexão | Aguardar propagação DNS ou usar IP direto |

---

## ✅ Checklist para Produção

- [ ] Webhook URL configurado em Evolution: `https://[seu-dominio]/webhook`
- [ ] `x-reprocess-secret` adicionado ao header de webhook na Evolution
- [ ] Valor de `x-reprocess-secret` é idêntico ao `.env` REPROCESS_SECRET (>= 8 caracteres)
- [ ] Teste com `curl` retorna `{ "ok": true }`
- [ ] Enviar mensagem de teste no WhatsApp e confirmar que chegou em `vendas.conversas`
- [ ] Verificar logs do Railway para erros relacionados a webhook
- [ ] Confirmar que a resposta automática foi enviada após mensagem chegar

---

## 🔍 Investigação Atual

1. **Código webhook:** ✅ Funcionando
2. **Configuração na Evolution:** ❓ Precisa confirmar
3. **Erro 403 no Teste de IA:** ✅ Corrigido
4. **Erro no webhook-handler.js:** ✅ Corrigido

**Próximo passo:** Verificar nos logs do Railway se webhooks estão sendo recebidos

---

**Referências:**
- Evolution API Docs: https://evolution-api.com/docs
- Webhook Security: verificar `REPROCESS_SECRET` no `.env`
- Logs do Railway: railway.app → seu projeto → Logs

