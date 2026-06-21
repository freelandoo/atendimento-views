# Análise do Projeto — bugs, riscos e melhorias (2026-06-20)

Varredura após Entregas A e B. Classificado por severidade. "Bug" = comportamento
incorreto; "Risco" = correto hoje mas frágil; "Melhoria" = eficiência/UX.

## 🔴 Bugs / incompletudes

1. **`onboarding_completo` nunca vira `true`** — `marcarOnboardingCompleto()` existe em
   `src/db/usuarios.js` mas não é chamado em lugar nenhum. O wizard de onboarding depende
   desse flag. *Fix:* chamar após salvar instância (`api-whatsapp`) e contexto
   (`api-contextos`) com o `empresa_id` e o `usuario_id` da sessão.

2. **"Rodar" aplica a trava de 15d ANTES do disparo confirmar** —
   `POST /api/banco-leads/rodar` marca `rodado_em` e enfileira o job. Se o job
   (`prospeccao_completo`) falhar, os leads ficam 15 dias travados **sem terem sido
   contatados**. *Fix:* mover a marcação para o sucesso do job, ou resetar `rodado_em`
   quando o job falhar definitivamente (em `consumirJobsProspeccao`, ramo de falha
   terminal). Trade-off com corrida entre admins — manter a reserva, mas liberar em falha.

3. **A instância escolhida no "rodar" não é honrada no envio** — `instancia` vai no
   payload do job, mas `processarFluxoCompleto → agendarEnvios → enviarProspectsAprovados`
   usa a instância Evolution global. *Fix:* propagar `instancia` até o envio (gap conhecido
   de multi-instância por empresa, já registrado na memória do projeto).

## 🟠 Riscos

4. **Dualidade de autenticação** — o dashboard estático em `public/*.html` usa sessão
   legada (`dashboardAuth`), enquanto o SaaS usa JWT. O RBAC (papéis) só vale no Next.js +
   API JWT. Prospecção/banco no `/dashboard` legado ignoram papéis. *Recomendação:*
   aposentar o dashboard estático e unificar tudo no Next.js + JWT, ou colocar `/dashboard`
   atrás do JWT com `requireRole`.

5. **`JWT_SECRET`** — default `CHANGE_ME_IN_PRODUCTION`. Guard de boot só dispara com
   `NODE_ENV=production`. *Confirmar:* Railway seta `NODE_ENV=production` **e** `JWT_SECRET`.

6. **Armadilha boot SQL × migrations** — `sql/init.sql` roda a cada boot ANTES das
   migrations; `INSERT ... ON CONFLICT` nele quebra (42P10 → crash-loop 502) se uma
   migration mudar a constraint referenciada. Cuidado ao mexer em constraints de tabelas
   tocadas no init.

7. **Rate limiter em memória** (`src/rate-limit.js`) — não compartilha estado entre
   instâncias. Se o Railway escalar horizontalmente, o limite por IP fura. *Fix futuro:*
   backend Redis.

8. **`listEmpresasDoUsuario` para superadmin** retorna só as empresas vinculadas — o
   switcher de empresa não mostra todas. *Fix:* para `superadmin`, listar todas as
   `app.empresas` ativas.

## 🟡 Inconsistências menores

9. `POST /api/empresas` não preenche `criada_por` (só o signup preenche). Padronizar.
10. Signup não cria um `empresa_contextos` inicial, mas `POST /api/empresas` cria.
    Padronizar (criar contexto vazio no signup também) para o wizard ter o que editar.

## 🟢 Melhorias de eficiência / UX

11. **Banco de Leads**: paginação/virtualização (lista até 2000), busca textual, e mostrar
    **dias restantes da trava** (não só "na trava"). Botão "rodar" com **preview de quantos
    elegíveis** antes de confirmar.
12. **Índice composto** `prospectador.prospects (nicho, cidade, rodado_em)` para acelerar
    o filtro do banco quando crescer.
13. **Wizard de onboarding** real no Next.js (passos: contexto → conectar WhatsApp),
    guiado por `onboarding_completo`.
14. **Testes de integração com DB** — hoje os testes evitam o banco (mock/puro). Subir um
    Postgres efêmero no CI cobriria signup transacional, isolamento cross-tenant e a trava.
15. **Unificar frontend** — manter só o Next.js (`apps/web`) e descontinuar o dashboard
    estático reduz superfície de bug e confusão de auth.
16. **Observabilidade do "rodar"** — registrar evento (quem rodou, filtro, qtd, job) para
    auditoria entre admins, reaproveitando `prospect_events`.

## Próximos passos sugeridos (ordem)
1. Fix #1 (onboarding) e #2 (trava em falha) — baixo risco, alto valor.
2. Decidir #4 (aposentar dashboard legado) — destrava o RBAC de verdade.
3. Multi-instância (#3) — necessário pro disparo por bot funcionar de fato.
4. Import da planilha em prod (depende de `DATABASE_URL` do `grateful-nourishment`).
