# 🔧 Passo 1: Executar Migration — Guia Prático

**Status:** Pronto para executar  
**Tempo:** 5 minutos  
**Objetivo:** Criar 3 tabelas no banco Railway

---

## Opção 1: Via Railway CLI (Recomendado)

### 1️⃣ Verificar se Railway CLI está instalado
```bash
railway --version
```

**Se retornar versão (ex: "0.9.1"):** Pule para o Passo 2️⃣  
**Se retornar "comando não encontrado":** Instale com:
```bash
npm install -g @railway/cli
```

### 2️⃣ Conectar ao Railway
```bash
railway connect
```

Isso abrirá um navegador para fazer login. Após autenticar:
- Selecione seu projeto `pjcodeworks-agent`
- Selecione seu ambiente
- A variável `DATABASE_URL` será carregada automaticamente ✅

### 3️⃣ Executar a Migration
```bash
# Dentro do diretório do projeto
psql "$DATABASE_URL" < sql/migracao_analise_estruturada.sql
```

**Esperado:**
```
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE TRIGGER
```

---

## Opção 2: Via Credenciais Manuais

Se a Railway CLI não funcionar, configure manualmente:

### 1️⃣ Obter DATABASE_URL do Railway

1. Acesse: https://railway.app
2. Selecione seu projeto `pjcodeworks-agent`
3. Vá em "Variables" (ou "Deployments")
4. Procure por `DATABASE_URL` ou clique em "PostgreSQL"
5. Copie o valor completo (começa com `postgresql://`)

### 2️⃣ Exportar variável no terminal
```bash
export DATABASE_URL="postgresql://user:password@host:port/database"
```

Substitua pelos valores reais que você copiou.

### 3️⃣ Executar Migration
```bash
psql "$DATABASE_URL" < sql/migracao_analise_estruturada.sql
```

---

## Opção 3: Via Railway Web Console (Se acima não funcionar)

### 1️⃣ Acessar console do PostgreSQL

1. Acesse: https://railway.app
2. Projeto: `pjcodeworks-agent`
3. Plugin: `PostgreSQL`
4. Aba: "Connect" → "Database GUI" ou "SQL Client"

### 2️⃣ Copiar todo o conteúdo do arquivo
```bash
cat sql/migracao_analise_estruturada.sql
```

### 3️⃣ Cole no console do Railway

1. Abra o SQL editor no Railway
2. Cole o conteúdo completo
3. Execute ("Run" ou "Execute Query")
4. Aguarde completar ✅

---

## ✅ Validar: As Tabelas Foram Criadas?

Após executar, valide com:

```bash
psql "$DATABASE_URL" -c "
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema='vendas' 
  AND table_name LIKE 'ai_%'
  ORDER BY table_name;
"
```

**Esperado:**
```
        table_name         
---------------------------
 ai_analise_estruturada
 ai_guardrail_logs
 ai_padroes_sucesso
(3 rows)
```

---

## 🔍 Se Algo Deu Errado

### Erro: "permission denied"
- Você não tem permissão no banco
- Solução: Verifique se DATABASE_URL está correta e o usuário tem privilégios

### Erro: "relation already exists"
- As tabelas já foram criadas anteriormente
- **Isso é NORMAL** (migration usa `IF NOT EXISTS`)
- Continue para o Passo 2

### Erro: "could not connect to server"
- DATABASE_URL incorreta ou banco offline
- Solução: Verifique em Railway se PostgreSQL está rodando

### Erro: "syntax error"
- Arquivo SQL corrompido
- Solução: Redownload do `sql/migracao_analise_estruturada.sql`

---

## 📊 O Que Foi Criado

Se tudo passou ✅, você agora tem:

### Tabela 1: `vendas.ai_analise_estruturada`
```
Armazena análises estruturadas de cada resposta da IA
- 13 colunas (id, numero, análise_json, decisões_json, etc)
- 3 índices para queries rápidas
- Trigger para atualizar timestamp
```

### Tabela 2: `vendas.ai_padroes_sucesso`
```
Rastreia padrões de resposta que funcionaram bem
- 10 colunas (intencao, estagio, acao, taxa_sucesso, etc)
- 2 índices para busca rápida
- Único por (intencao, estagio, acao, tom)
```

### Tabela 3: `vendas.ai_guardrail_logs`
```
Log de guardrails acionados (validações)
- 6 colunas (numero, tipo_guardrail, severidade, etc)
- 2 índices para análise
```

---

## ✨ Próximo Passo

Assim que validar que as 3 tabelas foram criadas:

👉 **Passar para Passo 2:** Modificar `chamarClaude()` em `index.monolith.js`

---

## 📞 Precisa de Ajuda?

Se ficou preso:

1. **Verificar status do PostgreSQL no Railway:**
   - https://railway.app → seu projeto → PostgreSQL
   - Está "Deployed"? Se não, clique "Deploy"

2. **Testar conexão manualmente:**
   ```bash
   psql postgresql://user:pass@host:port/database -c "SELECT 1"
   ```

3. **Pedir ajuda mostrando:**
   - Erro exato que recebeu
   - Versão do psql: `psql --version`
   - Database URL está correta? (nunca compartilhe a senha)

---

## 🎯 Checklist Passo 1

- [ ] Railway CLI instalado (ou credenciais manuais)
- [ ] DATABASE_URL configurada
- [ ] Migration executada sem erros
- [ ] ✅ Validação: 3 tabelas criadas
  - [ ] ai_analise_estruturada
  - [ ] ai_guardrail_logs
  - [ ] ai_padroes_sucesso

**Quando todos estiverem marcados ✅, avance para Passo 2**

