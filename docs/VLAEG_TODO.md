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
## Slice 1 — Documentação VLAEG e CLAUDE.md ✅
## Slice 2 — Banco Multiempresa ✅ (migrations, schema app, empresa_id)
## Slice 3 — Auth JWT + Tenant Isolation ✅ (requireAuth, requireEmpresaAccess, seed admin)
## Slice 4 — APIs REST Multiempresa ✅ (empresas, contextos, whatsapp, conversas, relatorios)
## Slice 5 — Provider IA Multi-provider ✅ (OpenAI principal, Anthropic fallback, funções de domínio)
## Slice 6 — Gerador de Contexto 2 via IA ✅ (POST gerar-plano, versionamento)
## Slice 7 — Agente com Contexto Dinâmico ✅ (getContextoAtivoEmpresa, inject via flags)
## Slice 8 — Memória e Relatórios ✅ (resumo-conversa.js, relatorio.js, endpoints)
## Slice 9 — WhatsApp por Empresa ✅ (resolver tenant por Evolution instance, salvarConversa+empresa_id)
## Slice 10 — Frontend Next.js ✅ (apps/web/, App Router, dashboard completo)
## Slice 11 — Testes e Segurança ✅ (9/9 testes multitenant passando)
## Slice 12 — Deploy Railway + Vercel ✅ (railway.toml, vercel.json, docs atualizados)

---

## Slice 13 — Deploy Vercel ⬜ 👤
- [ ] Conectar repositório GitHub ao Vercel
- [ ] Definir Root Directory como `apps/web/`
- [ ] Configurar variável `NEXT_PUBLIC_API_URL` com URL Railway do backend
- [ ] Fazer deploy
- [ ] Testar frontend em produção

---

## Slice 14 — Testes Finais ⬜
- [ ] Rodar `npm test` com banco real
- [ ] Smoke test de precificação
- [ ] Teste E2E: cadastro empresa → contexto → ativar agente → mensagem WhatsApp

---

## Slice 15 — Documentação Final ⬜
- [ ] Atualizar CLAUDE.md com estado final
- [ ] Criar README final
- [ ] Encerrar protocolo VLAEG

---

## Bloqueios Atuais

| Item | Depende de | Status |
|------|-----------|--------|
| Deploy Railway efetivo | Railway project ID + token na CLI | 👤 Usuário |
| Deploy Vercel | Conta Vercel + GitHub conectado | 👤 Usuário |
| Evolution URL em produção | Serviço Evolution no Railway | 👤 Usuário |
| OPENAI_API_KEY / ANTHROPIC_KEY | Usuário | 👤 Usuário |
