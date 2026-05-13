# VLAEG TODO — Slices e Status

---

## Legenda
- ✅ Concluído
- 🔄 Em andamento
- ⬜ Pendente
- 🔴 Bloqueado
- 👤 Depende do usuário

---

## Slice 0 — Auditoria Inicial ✅
- [x] Auditar estrutura de pastas
- [x] Auditar package.json, scripts, dependências
- [x] Auditar src/* (cada arquivo)
- [x] Auditar banco (sql/init.sql)
- [x] Auditar docker-compose, Dockerfile
- [x] Auditar prompts, knowledge, logs

---

## Slice 1 — Documentação VLAEG e CLAUDE.md ✅
- [x] Criar CLAUDE.md
- [x] Criar docs/VLAEG_EXECUTION_LOG.md
- [x] Criar docs/VLAEG_ENVIRONMENT.md
- [x] Criar docs/VLAEG_DECISIONS.md
- [x] Criar docs/VLAEG_TODO.md
- [x] Criar docs/VLAEG_SECRETS_CHECKLIST.md
- [x] Criar docs/VLAEG_DEPLOY_LOG.md
- [x] Salvar memória de projeto
- [x] Commit e push

---

## Slice 2 — Railway Setup 🔄
- [ ] Autenticar Railway CLI com token
- [ ] Criar projeto Railway (ou linkar existente)
- [ ] Criar serviço PostgreSQL no Railway
- [ ] Criar serviço Redis no Railway
- [ ] Criar serviço Evolution API no Railway
- [ ] Criar serviço Backend Node.js no Railway
- [ ] Configurar variáveis de ambiente no Railway
- [ ] Configurar domínio público para backend
- [ ] Testar healthcheck

---

## Slice 3 — Banco Multiempresa ⬜
- [ ] Criar migration: tabela `empresas`
- [ ] Criar migration: tabela `empresa_usuarios`
- [ ] Criar migration: tabela `empresa_whatsapp`
- [ ] Criar migration: tabela `contextos_empresa`
- [ ] Criar migration: tabela `contexto_versoes`
- [ ] Adicionar coluna `empresa_id` em: conversas, lead_profiles, followup_envios, analises_pos_conversa, ai_logs
- [ ] Criar seed: PJ Codeworks como empresa_id=1
- [ ] Criar script de migration segura (sem dropar dados)
- [ ] Testar migration local

---

## Slice 4 — Usuários, Empresas e Tenant Isolation ⬜
- [ ] Criar `src/auth.js` (JWT: login, refresh, verify)
- [ ] Criar `src/middleware/tenant.js` (injetar empresa_id no req)
- [ ] Criar `src/routes/empresas.js` (CRUD empresas)
- [ ] Criar `src/routes/auth.js` (login, registro, refresh)
- [ ] Criar `src/db/empresas.js` (queries empresas)
- [ ] Proteger todas as rotas sensíveis com middleware auth
- [ ] Garantir isolamento: toda query filtra empresa_id
- [ ] Testes de isolamento entre empresas

---

## Slice 5 — APIs REST de Empresas e Contextos ⬜
- [ ] GET /api/empresas
- [ ] POST /api/empresas
- [ ] GET /api/empresas/:id
- [ ] PUT /api/empresas/:id
- [ ] POST /api/empresas/:id/selecionar
- [ ] GET /api/empresas/:id/contextos
- [ ] POST /api/empresas/:id/contextos
- [ ] GET /api/empresas/:id/contextos/versoes
- [ ] GET /api/empresas/:id/contextos/versoes/:versaoId
- [ ] PUT /api/empresas/:id/contextos/versoes/:versaoId
- [ ] POST /api/empresas/:id/contextos/versoes/:versaoId/ativar
- [ ] GET /api/empresas/:id/whatsapp
- [ ] POST /api/empresas/:id/whatsapp
- [ ] POST /api/empresas/:id/whatsapp/testar

---

## Slice 6 — Provider OpenAI Atualizado ⬜
- [ ] Atualizar `ai-provider.js` — OpenAI como default
- [ ] Implementar `generateContextPlan(contextoRaw)` → Contexto 2 JSON
- [ ] Implementar `extractLeadData(historico)` → perfil estruturado
- [ ] Implementar `generateAgentReply(contexto2, historico, mensagem)` → resposta
- [ ] Implementar `summarizeConversation(historico)` → resumo
- [ ] Implementar `generateReport(dados)` → relatório
- [ ] Fallback para Anthropic em falha
- [ ] Parsing JSON com retry (uma tentativa)
- [ ] Logging via ai_logs com empresa_id

---

## Slice 7 — Gerador de Contexto 2 ⬜
- [ ] Definir schema JSON do Contexto 2
- [ ] Criar prompt para gerar Contexto 2 a partir de texto bruto
- [ ] Criar endpoint POST /api/empresas/:id/contextos/:cId/gerar-plano
- [ ] Validar JSON gerado (campos obrigatórios)
- [ ] Salvar como nova versão (não ativar automaticamente)
- [ ] Testar com exemplo real da PJ Codeworks

---

## Slice 8 — Agente com Contexto 2 Dinâmico ⬜
- [ ] Modificar `agent.js` para carregar Contexto 2 por empresa
- [ ] Modificar `prompts.js` para suportar override por empresa_id
- [ ] Garantir que agente da empresa A não usa contexto da empresa B
- [ ] Testar resposta com Contexto 2 ativo vs inativo
- [ ] Fallback: se empresa não tem Contexto 2 ativo, usar prompts padrão

---

## Slice 9 — Memória e Relatórios ⬜
- [ ] Criar endpoint GET /api/empresas/:id/relatorios/resumo
- [ ] Criar endpoint POST /api/empresas/:id/relatorios/gerar
- [ ] Implementar summarizeConversation por empresa
- [ ] Criar tabela relatorios_gerados
- [ ] Testar geração de relatório

---

## Slice 10 — WhatsApp por Empresa ⬜
- [ ] Criar tabela empresa_whatsapp
- [ ] Criar endpoint GET /api/empresas/:id/whatsapp
- [ ] Criar endpoint POST /api/empresas/:id/whatsapp (criar instância)
- [ ] Criar endpoint GET /api/empresas/:id/whatsapp/qr (retornar QR Code)
- [ ] Modificar webhook-handler para rotear por instância → empresa
- [ ] Testar com duas instâncias simultâneas

---

## Slice 11 — Frontend Next.js ⬜
- [ ] Criar apps/web/ com Next.js App Router
- [ ] Configurar TypeScript, Tailwind, shadcn/ui
- [ ] Implementar layout base (sidebar + topbar)
- [ ] Tela: Login
- [ ] Tela: Onboarding (criar empresa)
- [ ] Tela: Dashboard / Visão Geral
- [ ] Tela: Empresas (lista + CRUD)
- [ ] Tela: Contexto da empresa (editor Contexto 2)
- [ ] Tela: WhatsApp (conectar instância + QR Code)
- [ ] Tela: Conversas (lista + histórico)
- [ ] Tela: Perfil do Lead
- [ ] Tela: Relatórios
- [ ] Tela: Configurações
- [ ] Loading states, empty states, error states
- [ ] Responsivo (mobile-first)

---

## Slice 12 — Deploy Railway ⬜
- [ ] Configurar railway.toml
- [ ] Configurar healthcheck endpoint (/health)
- [ ] Configurar variáveis de ambiente no Railway
- [ ] Fazer primeiro deploy
- [ ] Verificar logs
- [ ] Testar endpoints principais
- [ ] Configurar domínio público

---

## Slice 13 — Deploy Vercel ⬜ 👤
- [ ] Receber VERCEL_TOKEN do usuário
- [ ] Criar projeto Vercel
- [ ] Configurar variáveis de ambiente
- [ ] Conectar ao repositório GitHub
- [ ] Fazer primeiro deploy
- [ ] Testar frontend em produção
- [ ] Configurar domínio

---

## Slice 14 — Testes Finais ⬜
- [ ] Rodar npm test
- [ ] Smoke test de precificação
- [ ] Teste E2E: cadastro de empresa → configurar contexto → ativar agente → enviar mensagem
- [ ] Verificar isolamento entre duas empresas
- [ ] Verificar logs sem secrets expostos

---

## Slice 15 — Documentação Final ⬜
- [ ] Atualizar CLAUDE.md com estado final
- [ ] Atualizar VLAEG_DEPLOY_LOG.md com URLs reais (sem secrets)
- [ ] Criar README final
- [ ] Encerrar protocolo VLAEG

---

## Bloqueios Atuais

| Item | Depende de | Status |
|------|-----------|--------|
| Deploy Railway | Railway projeto ID | ⏳ Configurando |
| Evolution URL | Endereço Evolution em produção | 👤 Usuário |
| OPENAI_API_KEY | User | 👤 Usuário |
| ANTHROPIC_KEY | User | 👤 Usuário |
| Admin email/senha | User | 👤 Usuário |
| VERCEL_TOKEN | User (Slice 13) | ⏳ Mais tarde |
