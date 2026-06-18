# 🔧 SOLUÇÃO: Erro "sorry, too many clients already"

**Problema:** PostgreSQL rejeitando conexões com "too many clients already"  
**Causa Raiz:** Múltiplas réplicas abrindo conexões, watchers rodando duplicados  
**Data:** 2026-05-14

---

## 🎯 RAIZ DO PROBLEMA

### Cenário Atual no Railway
```
Railway App com 2-4 réplicas
    ↓
Cada réplica tem seu próprio Pool
    ↓
Cada réplica roda silenceWatcherTick a cada X segundos
    ↓
silenceWatcherTick faz pool.query() chamadas
    ↓
2-4 réplicas × 2 pool.query() = até 8 queries simultâneas
    ↓
PostgreSQL limit: ~10-15 conexões
    ↓
❌ "too many clients already"
```

### Por que max=2 não é suficiente
```
Cenário:
- Pool max: 2 conexões
- Réplicas: 3
- Cada réplica precisa de: 1-2 conexões
- Total: 3 réplicas × 2 = 6 conexões (OK)
- MAS: Se tiver spikes simultâneos + watchers + jobs:
  - watchers: 2 conexões
  - jobs: 2 conexões  
  - requisições HTTP: 2 conexões
  - Total: 6+ conexões
  - ❌ Limite PostgreSQL (~8-10) atingido
```

---

## ✅ SOLUÇÃO ESTRUTURADA

### 1. Reduzir Pool de Forma Inteligente

**Arquivo: `src/db.js`**

```javascript
// Railway PostgreSQL free tier: ~8 concurrent connections
// Production: ~15-20 (but shared with backup, internal jobs, etc)
// Rule of thumb: usar max 30% do limite total = 2-4 conexões

const POOL_CONFIG = {
  max: Number(process.env.PG_POOL_MAX || 2),    // 2 conexões MÁXIMO
  min: 0,                                         // Criar on-demand
  idleTimeoutMillis: 2000,                       // Fechar idle muito rápido (2s)
  connectionTimeoutMillis: 500,                  // Falhar rápido se sem disponível
  statement_timeout: 10000,                      // Cancelar query longa (10s)
  maxUses: 7500,                                 // Ciclar conexão a cada 7500 uses
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
}
```

### 2. Distribuir Watchers (Rodar em Apenas 1 Réplica)

**Problema:** Cada réplica roda seu próprio watcher  
**Solução:** Usar "leader election" simples

```javascript
// src/followup-auto.js - criar função helper

async function tentarAcquirirLiderancaWatcher() {
  try {
    const result = await pool.query(`
      INSERT INTO vendas.watcher_locks (chave, replica_id, locked_at, expires_at)
      VALUES ('silence-watcher', $1, NOW(), NOW() + INTERVAL '10 seconds')
      ON CONFLICT (chave) DO UPDATE
      SET replica_id = $1, locked_at = NOW(), expires_at = NOW() + INTERVAL '10 seconds'
      WHERE vendas.watcher_locks.expires_at < NOW()
      RETURNING replica_id
    `, [process.env.REPLICA_ID || 'replica-1'])
    
    return result.rows[0]?.replica_id === (process.env.REPLICA_ID || 'replica-1')
  } catch (e) {
    logger.warn('Erro ao adquirir liderança:', e.message)
    return false
  }
}

// No silenceWatcherTick:
async function silenceWatcherTick() {
  const ehLider = await tentarAcquirirLiderancaWatcher()
  if (!ehLider) {
    logger.debug('Não sou líder, pulando silenceWatcherTick')
    return
  }
  
  // ... resto da função normal ...
}
```

### 3. Criar Tabela de Locks

```sql
CREATE TABLE IF NOT EXISTS vendas.watcher_locks (
  chave TEXT PRIMARY KEY,
  replica_id TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watcher_locks_expires
ON vendas.watcher_locks(expires_at);
```

### 4. Centralizar Queries Grandes em Batch

**Problema:** `silenceWatcherTick()` faz 2 queries big  
**Solução:** Fazer tudo em UMA query única

```javascript
async function silenceWatcherTick() {
  // ANTES (2 queries):
  // 1. UPDATE conversas SET status = 'aguardando_handoff'
  // 2. SELECT conversas elegíveis

  // DEPOIS (1 query):
  const { rows } = await pool.query(`
    WITH update_result AS (
      UPDATE vendas.conversas c
      SET status = 'aguardando_handoff', atualizado_em = NOW()
      WHERE c.status = 'ativo' AND ... 
      RETURNING c.numero
    )
    SELECT c.*
    FROM vendas.conversas c
    WHERE c.numero IN (SELECT numero FROM update_result)
  `)
  
  return rows
}
```

### 5. Adicionar Circuit Breaker para Watchers

```javascript
let lastWatcherError = null
let watcherConsecutiveErrors = 0

async function silenceWatcherTick() {
  try {
    // ... código ...
    watcherConsecutiveErrors = 0
    lastWatcherError = null
  } catch (e) {
    watcherConsecutiveErrors++
    lastWatcherError = e
    
    // Se 5 erros consecutivos, parar o watcher por 1 minuto
    if (watcherConsecutiveErrors >= 5) {
      logger.error('Watcher falhou 5x, pausando por 1 minuto')
      clearInterval(silenceWatcherTimer)
      silenceWatcherTimer = null
      
      setTimeout(() => {
        iniciarSilenceWatcher()  // Reiniciar
      }, 60000)
      
      return
    }
    
    logger.error('Erro no silenceWatcherTick:', e.message)
  }
}
```

### 6. Melhorar pool.connect() com Timeout

```javascript
// src/db.js - adicionar helper

async function withClientTimeout(fn, timeoutMs = 5000) {
  const client = await pool.connect()
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Client operation timeout')), timeoutMs)
  )
  
  try {
    return await Promise.race([fn(client), timeoutPromise])
  } finally {
    client.release()
  }
}

// Uso:
await withClientTimeout(async (client) => {
  await client.query('BEGIN')
  // ... operações ...
  await client.query('COMMIT')
})
```

---

## 📋 MUDANÇAS NECESSÁRIAS

### 1. `src/db.js`
- [x] Reduzir `max` para 2
- [x] Adicionar `maxUses: 7500`
- [x] Reduzir `idleTimeoutMillis` para 2000ms
- [x] Reduzir `connectionTimeoutMillis` para 500ms
- [x] Adicionar `ssl` config
- [ ] Adicionar `withClientTimeout` helper

### 2. `src/followup-auto.js`
- [ ] Implementar leader election para silenceWatcher
- [ ] Consolidar 2 queries em 1
- [ ] Adicionar circuit breaker

### 3. Schema SQL (migrations)
- [ ] Criar tabela `vendas.watcher_locks`
- [ ] Criar índice em `expires_at`

### 4. `src/agent.js`
- [ ] Validar se jobs estão usando pool corretamente
- [ ] Adicionar timeout para operações lentas

### 5. Configuração Railway
- [ ] Set `REPLICA_ID` (ex: "replica-1", "replica-2")
- [ ] Set `PG_POOL_MAX=2` (explícito)
- [ ] Set `PG_IDLE_TIMEOUT=2000`

---

## 🧪 TESTE ANTES/DEPOIS

### Teste 1: Verificar Conexões Ativas
```sql
-- No psql do Railway:
SELECT COUNT(*) as conexoes_ativas
FROM pg_stat_activity
WHERE usename = 'seu_usuario';

-- Antes: 6-10+ conexões
-- Depois: 2-4 conexões máximo
```

### Teste 2: Verificar Watchers Rodando
```bash
# Nos logs:
grep -i "Não sou líder\|lider" /railway-logs.txt

# Esperado: Apenas 1 réplica sendo líder
# Replica 1: "Sou líder, executando silenceWatcher"
# Replica 2: "Não sou líder, pulando silenceWatcherTick"
# Replica 3: "Não sou líder, pulando silenceWatcherTick"
```

### Teste 3: Verificar Erros de Conexão
```bash
# Nos logs:
grep "too many clients\|FATAL" /railway-logs.txt

# Esperado: NENHUM

grep "Connection timeout\|circuit breaker" /railway-logs.txt

# Esperado: Pode haver 1-2, mas não cascata
```

---

## 🚀 ROLL-OUT (Low Risk)

### Fase 1: Apenas Reduzir Pool (5 min)
1. Set `PG_POOL_MAX=2` no Railway
2. Restart app
3. Monitorar logs por 10 min

### Fase 2: Adicionar Leader Election (2h)
1. Deploy migration para criar `watcher_locks`
2. Update `followup-auto.js`
3. Set `REPLICA_ID` env var em cada réplica
4. Deploy
5. Monitorar que apenas 1 watcher roda

### Fase 3: Consolidar Queries (1h)
1. Update `silenceWatcherTick()` para 1 query
2. Deploy
3. Monitorar performance

---

## 📊 EXPECTED IMPROVEMENTS

| Métrica | Antes | Depois | Melhoria |
|---------|-------|--------|----------|
| Conexões ativas | 8-12 | 2-4 | ✅ 66% redução |
| "too many clients" | Frequente | 0 | ✅ Eliminado |
| Watchers rodando | 3 (duplicado) | 1 | ✅ 66% redução |
| Queries/tick | 2 | 1 | ✅ 50% redução |
| Latência de queries | 50ms | 20ms | ✅ 60% melhoria |
| CPU PostgreSQL | Alto | Normal | ✅ Reduzido |

---

## 🔍 MONITORAMENTO CONTÍNUO

```sql
-- Query para monitorar saúde do pool
SELECT
  count(*) as total_connections,
  count(CASE WHEN state = 'active' THEN 1 END) as active,
  count(CASE WHEN state = 'idle' THEN 1 END) as idle,
  extract(epoch from (now() - query_start))::int as longest_running_sec
FROM pg_stat_activity
WHERE datname = 'seu_banco'
GROUP BY datname;
```

Executar a cada 5 min. Alertar se:
- `total_connections` > 5
- `active` > 3
- `longest_running_sec` > 15

---

**Status:** 📋 Planejado  
**Implementação:** Começar com Fase 1 (reduzir pool max)  
**Risco:** Baixo (pool só fica menor, sem múltiplas pools)

