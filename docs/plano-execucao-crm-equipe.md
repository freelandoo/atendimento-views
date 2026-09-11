# Plano de execução — CRM de atendimento em EQUIPE

> **Este é o documento de trabalho vivo.** Se você é uma IA (ou pessoa) retomando este projeto,
> **leia este arquivo primeiro e só depois os outros.** Ele diz o que já foi feito, o que vem
> agora, do que cada coisa depende e o que NÃO pode ser feito.
>
> **Protocolo de retomada** → §0.
> **Última atualização:** 2026-09-11, ao concluir **as 12 etapas**.

## Documentos deste projeto, em ordem de leitura

| # | Documento | Para que serve |
| --- | --- | --- |
| 1 | **este arquivo** | estado, etapas, subetapas, dependências, proibições |
| 2 | [especificacao-crm-equipe.md](especificacao-crm-equipe.md) | o **desenho**: modelo de dados, matriz de permissões, fluxos, casos extremos |
| 3 | [analise-qualificacao-lead-e-multiusuario.md](analise-qualificacao-lead-e-multiusuario.md) | a **porta de qualificação** do lead (pré-requisito da Etapa 3) |
| 4 | [AGENTS.md](../AGENTS.md) + [CLAUDE.md](../CLAUDE.md) | regras do repositório — **valem acima deste plano** |
| 5 | [PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md](PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md) | o que continua congelado (ver §7/Q4) |

---

# 0. Protocolo de retomada (leia isto antes de escrever código)

1. **Confira o estado real**, não o que este arquivo diz:
   ```bash
   cd backend
   ls sql/migrations | tail -8          # qual a última migration?
   npm test                              # baseline atual
   npm run typecheck
   ```
   **Baseline conhecido (2026-09-11, após as 12 etapas): backend 1867 testes, 1865 passam;
   frontend `node --test lib/*.test.js` 373/373; `tsc --noEmit` limpo dos dois lados.**
   As 2 falhas são `core.test.js` "motor de IA: generateAIResponse…" e "…disableFallback…": elas
   fazem **chamada real ao provedor de IA** e falham com `429`. É **ambiental, não regressão** —
   não tente consertar. Se falhar um número diferente de 2, **pare e investigue** antes de seguir.
2. **Registre a Fase 0** em [ai-task-start-log.md](ai-task-start-log.md) (obrigatório pelo
   CLAUDE.md) antes de analisar a fundo ou alterar código.
3. **Leia a etapa** que vai executar, aqui, inteira — inclusive "não faça" e "dependências".
4. **Uma etapa por vez.** Não misture etapas, e não misture refatoração com feature (proibição do
   AGENTS.md). Se a etapa tem subetapas, elas podem ser commits separados.
5. **Ao terminar**, atualize neste arquivo: o estado da etapa, o que mudou de verdade, e qualquer
   descoberta que contrarie o plano. **Contradição encontrada no código vence o plano** —
   corrija o plano, não o código.
6. **Comandos de validação reais deste repo:** `npm test`, `npm run typecheck` (quando tocar
   `.ts`/tipos), `npm run smoke:preco` (só precificação). **Não existem `npm run lint` nem
   `npm run build`** — não invente.

## ⚠️ Sobre escrita de arquivo neste ambiente

Havia uma nota de que escritas via shell (`node -e`, `sed -i`) não persistiam. **Verificado em
2026-09-11: `sed -i`, heredoc e `python` via shell PERSISTEM.** A nota era desatualizada. Ainda
assim, para arquivos grandes as ferramentas de edição dedicadas erram menos.

## ⚠️ Pendência do repositório, não resolvida de propósito

`docs/ai-decision-log.md` e `docs/ai-task-start-log.md` estão com **conflito de merge não
resolvido** (`UU`, marcadores `<<<<<<< Updated upstream` / `>>>>>>> Stashed changes` de um
`git stash pop` interrompido):

| Arquivo | Região conflitada |
| --- | --- |
| `docs/ai-decision-log.md` | linhas ~1888-2506 |
| `docs/ai-task-start-log.md` | região final do arquivo |

**Consequências práticas:**
- As entradas de Fase 0 deste projeto foram escritas **no topo**, fora da região conflitada.
- **As decisões de §1 NÃO foram gravadas em `ai-decision-log.md`** — escrever num arquivo em
  conflito é pedir para perder conteúdo no merge. Elas vivem aqui em §1 até o operador resolver.
- **Não rode `git add` nesses dois arquivos** sem resolver o conflito: isso marcaria o conflito
  como resolvido com os marcadores dentro.

---

# 1. Decisões ADOTADAS (aprovadas pelo operador em 2026-09-11)

O operador respondeu *"faça o recomendado"* às perguntas abertas dos dois documentos anteriores.
Portanto as recomendações abaixo **são as decisões do projeto**. Quem retomar não precisa
reabri-las — mas as que estão marcadas ⏳ **ainda precisam de confirmação pontual** porque
implicam mudança de comportamento observável.

## 1.1 Da especificação (A..J)

| # | Decisão | Adotado |
| --- | --- | --- |
| A | Papéis novos | **só `comercial`**. `manager`/`viewer`/`sdr`/`closer` não nascem sem ocupante |
| B | Concessões por usuário | **`usuarios_empresas.permissoes` JSONB, SOMENTE ADITIVAS**. Sem tabela `user_permissions`. Sem negações |
| C | `member` na Central de Mensagens | **mantém** ler/responder e ver todas, e **PERDE** ligar/desligar IA e apagar histórico. ✅ Confirmado em 2026-09-11; a medição provou que não existe nenhum `member` em produção (impacto zero) |
| D | Follow-ups | **visibilidade geral** na empresa, responsável sempre explícito |
| E | Instância criada por `comercial` | **nasce `ativo=false`** até o admin liberar (não toca o webhook). `modo_ia='analise'` fica como evolução futura |
| F | Agenda consolidada da equipe para `comercial` | **não por padrão**; liberável por concessão |
| G | Aposentar `/dashboard/*` legado | **fase própria, DEPOIS desta v1** |
| H | Medir produção antes da Etapa 3 | **sim**, script somente-leitura |
| I | Normalizar `vendas.conversas.historico` em tabela de mensagens | **não** |
| J | `vendas.conversas.numero UNIQUE GLOBAL` | **não resolver agora** |

## 1.2 Da análise de qualificação (D1..D8)

| # | Decisão | Adotado |
| --- | --- | --- |
| D1 | Acervo de leads existente | **`qualificacao = 'legado'`** (opera, sem prova). Nunca `pendente`, que pararia a operação no deploy |
| D2 | Prazo de validade do `legado` | **não** na v1 |
| D3 | Lead `descartado` já em campanha | **sai da fila, permanece em Acompanhamento** |
| D4 | `POST /follow-ups/manual/iniciar` passa pela porta? | **não** na v1 — é ato humano explícito e auditado |
| D5 | = decisão C acima | idem |
| D6 | Papel `qualificador` | **não** |
| D7 | Aposentar `/dashboard/prospeccao/*` | **fase própria** (= G) |
| D8 | Medir produção antes da porta | **sim** (= H) |

---

# 2. Mapa das etapas

| Etapa | Objetivo | Estado | Entregue |
| :-: | --- | --- | --- |
| **1** | Fundação: papel por empresa + capacidades | ✅ | `acesso-capacidades.js` (PURO), `requireCapacidade`, migration `070` |
| **2** | Contas da empresa | ✅ | `/membros` (4 rotas), tela `contas-empresa`, `lib/capacidades.js` |
| **3** | **Qualificação do lead (a porta)** | ✅ | migration `071`, `lead-qualificacao.js`, **4 portas fechadas**, auto-aprovação removida |
| **3.0** | Medição de produção | ✅ | `medir:qualificacao-lead` — resultado em §4-bis |
| **4** | Ownership de lead + fila de livres | ✅ | migration `072`, claim atômico, histórico, 5 rotas |
| **5** | Abordagem manual `wa.me` | ✅ | migration `073`, 3 fatos distintos, `confirmado_por` |
| **6** | **Abrir o papel `comercial`** | ✅ | 15 mounts migrados + capacidade por rota nas escritas |
| **7** | Ownership de conversa | ✅ | migration `074`, recorte + "responder nunca é bloqueado" |
| **8** | Instâncias com responsável + contexto padrão | ✅ | migration `075`, padrão COPIADO na criação |
| **9** | Permissão de IA | ✅ | gate nas 2 rotas de IA; instância nasce inativa (decisão E) |
| **10** | Ligações e Follow-ups por responsável | ✅ | **sem migration** — os campos já existiam |
| **11** | Agenda em equipe | ✅ | migrations `076`/`077`, conflito **por pessoa**, backfill |
| **12** | Painel do admin, auditoria, dívidas | ✅ | `/equipe`, migration `078` (remove os `DEFAULT = PJ`) |

**Nenhuma etapa pendente.** O que ficou de fora está em §7 (fora de escopo declarado).

**Estado: tudo implementado e testado. NADA foi commitado nem publicado.**

O que muda em produção no próximo boot: as migrations `070`-`078` aplicam sozinhas
(`src/db/migrations.js`). Todas são aditivas; a `078` só remove `DEFAULT`s, sem mutar linha.

**Ordem sugerida para publicar:** subir tudo junto é o caminho natural (as etapas se apoiam), mas
se preferir fracionar, o corte seguro é **1-2 → 3-5 → 6-9 → 10-12**: a Etapa 6 é a que muda quem
alcança o quê, e vale observá-la isolada por alguns dias.

**Etapa de maior risco: 6.** Errar um mount abre ou fecha um módulo inteiro. Regra: **uma rota por
commit, com o caso negativo testado antes do merge.**

---

# 3. ✅ Etapa 1 — Fundação de autorização (CONCLUÍDA)

**Objetivo:** o papel que autoriza passa a ser o do **vínculo com a empresa**, não o global.
**Neutra em comportamento por construção:** nada consome a matriz ainda.

## O que foi feito

| Subetapa | Arquivo | O que |
| :-: | --- | --- |
| 1.1 | `backend/sql/migrations/070_papel_comercial.sql` **(novo)** | CHECK de `role` alargada com `comercial`; colunas `permissoes JSONB NOT NULL DEFAULT '{}'`, `criado_por`, `ultimo_acesso_em`; índice parcial `(empresa_id, role) WHERE ativo`. **Aditiva, nenhum `UPDATE` de dado** |
| 1.2 | `backend/src/services/acesso-capacidades.js` **(novo, PURO)** | dono do vocabulário: 4 papéis, **28 capacidades**, a matriz, `MOTIVOS`, `avaliarCapacidade`, `podeCapacidade`, `capacidadesDoVinculo`, `concedeveisPara` |
| 1.3 | `backend/src/db/empresas.js` | `usuarioPertenceAEmpresa` → **`buscarVinculoUsuarioEmpresa`** (devolve a linha, mesmo filtro `ativo = true`). Único chamador era o middleware |
| 1.4 | `backend/src/middleware/tenant.js` | `requireEmpresaAccess` publica `req.vinculoEmpresa`, `req.papelEmpresa`, `req.capacidades`. Novo `requireCapacidade(...)`, **sem consumidor** |
| 1.5 | `backend/src/domain-enums.js` | reexporta `PAPEIS_EMPRESA` do módulo puro (**não copia**) |
| 1.6 | `backend/test/acesso-capacidades.test.js` **(novo)** | 22 testes: matriz, caso negativo do `comercial`, superadmin, ausência de vínculo, concessões, 4 guardas de regressão |
| 1.7 | `backend/test/domain-enums.test.js` | anti-drift `PAPEIS_EMPRESA` × CHECK da `070` |

## Validação executada

```
node --test test/acesso-capacidades.test.js test/domain-enums.test.js   → 45/45 ✅
npm test          → 1635 testes, 1633 passam (2 falhas = 429 no provedor de IA, pré-existentes) ✅
npm run typecheck → limpo ✅
```

## Correção de escopo descoberta na leitura do código

A especificação (§8/Fase 1) dizia que `requireEmpresaAccess` "passa a barrar vínculo inativo".
**Ele já barrava:** `usuarioPertenceAEmpresa` já filtrava `ativo = true`. Não houve mudança de
comportamento aqui — só a linha do vínculo passou a ser preservada em vez de descartada.

## Guardas de regressão criadas (e o que cada uma protege)

| Guarda | Falha se… |
| --- | --- |
| módulo é PURO | `acesso-capacidades.js` ganhar `require(`, `pool`, `fetch(`, `axios` ou `process.env` |
| papel não se compara com literal | aparecer `papel === 'comercial'` (ou similar) em qualquer `src/**` fora do módulo dono |
| middleware resolve pelo vínculo | `tenant.js` perder `buscarVinculoUsuarioEmpresa`, `req.papelEmpresa`, `req.capacidades`, `PAPEL_PLATAFORMA` ou o `ACESSO_MAL_CONFIGURADO` |
| **`requireCapacidade` sem consumidor** | alguém usar `requireCapacidade(` → **é o sinal de que a Etapa 6 começou** |
| `usuarioPertenceAEmpresa` não volta | o nome reaparecer em `src/**` |

> **Quando a Etapa 6 começar, o teste "requireCapacidade nasce SEM consumidor" vai falhar de
> propósito.** Ao removê-lo, a suíte de autorização **por rota** (§6, subetapa 6.1) precisa
> existir no lugar dele. Não remova um sem criar o outro.

## Não foi feito nesta etapa (de propósito)

- Nenhuma rota trocou de gate. `requireRole('admin')` continua decidindo tudo.
- Nada escreve em `permissoes`, `criado_por` ou `ultimo_acesso_em`.
- O frontend não foi tocado.

---

# 4. ✅ Etapa 2 — Contas da empresa (CONCLUÍDA 2026-09-11)

**Objetivo:** resolver L3 — não existia como adicionar uma segunda pessoa a uma empresa pelo
produto. `createUsuarioPorAdmin` (`src/db/usuarios.js`) cria o usuário e **não cria vínculo**,
então ele nascia sem acesso a empresa alguma.

## O que foi feito

| Sub | Arquivo | O que |
| :-: | --- | --- |
| 2.1 | `backend/src/db/membros.js` **(novo)** | `criarMembro` (UMA transação: `app.usuarios` INSERT **ou reuso** + `app.usuarios_empresas` + `app.auditoria_eventos`), `listarMembros`, `obterMembro`, `atualizarMembro`, `registrarUltimoAcesso`, `sanearPermissoes` |
| 2.2 | `backend/src/routes/api-membros.js` **(novo)** + `index.js` | `GET /`, `GET /opcoes`, `POST /`, `PATCH /:vinculoId` em `/api/empresas/:empresaId/membros`. Gate no `router.use` |
| 2.3 | `backend/src/routes/api-auth.js` + `src/db/usuarios.js` | `/api/auth/me` devolve `papel_empresa` + `capacidades` por empresa (campos **aditivos**); `permissoes` **não** sai cru |
| 2.4 | `backend/src/middleware/tenant.js` | `ultimo_acesso_em` por vínculo: best-effort, **não aguardado**, no máximo 1×/hora |
| 2.5 | `frontend/app/dashboard/contas-empresa/page.tsx` **(nova)** + `lib/navegacao.js` | tela Configurações › Contas da empresa |
| 2.6 | `frontend/lib/capacidades.js` (+ `.d.ts`/`.test.js`) **(novo)** | **só traduz** o veredito da API |
| 2.7 | `backend/test/membros.test.js` **(novo)** | 23 testes, incluindo a **semente da suíte de autorização por rota** |
| 2.8 | `backend/test/acesso-capacidades.test.js` | a guarda "sem consumidor" foi **substituída** (abaixo) |
| 2.9 | `backend/package.json` | `test/acesso-capacidades.test.js`, `test/membros.test.js` e `test/medir-qualificacao-lead.test.js` entraram no `npm test` (a da Etapa 1 **não estava** — lacuna corrigida) |

## Validação executada

```
backend:  npm test              → 1692 testes, 1690 passam (as 2 de sempre: 429 no provedor de IA) ✅
backend:  npm run typecheck     → limpo ✅
frontend: node --test lib/*.test.js → 373/373 ✅
frontend: npx tsc --noEmit      → limpo ✅
```

## A guarda da Etapa 1 caiu — e o que entrou no lugar

Como previsto em §3, `requireCapacidade` ganhou o primeiro consumidor e o teste
"ETAPA 1: requireCapacidade nasce SEM consumidor" falhou. Ele **não foi apenas removido**: em seu
lugar entrou uma guarda mais forte —

> **"TODA rota autorizada por capacidade está coberta pela suíte de AUTORIZAÇÃO POR ROTA"**
> (`test/acesso-capacidades.test.js`): varre `src/**`, acha todo arquivo que chama
> `requireCapacidade(`, confere que está montado no `index.js` e **exige que o mount apareça na
> tabela `ROTAS_POR_CAPACIDADE` de `test/membros.test.js`**, que o exercita contra os 4 papéis.

É isto que serve a Etapa 6: uma rota não pode ser autorizada por capacidade sem ser exercitada
papel por papel. **Ao migrar cada rota na Etapa 6, acrescente a linha naquela tabela** — o teste
falha se você esquecer.

A tabela irmã `ROTAS_AINDA_ADMIN_GLOBAL` protege o outro lado: as 6 rotas não migradas precisam
continuar com `requireRole('admin')` **ou** já ter `requireCapacidade`. Uma rota não pode perder o
gate antigo antes de ganhar o novo.

**Verificado por mutação:** trocar a capacidade exigida na rota de membros faz o teste falhar
(conferido e revertido).

## Regras encarnadas, e onde estão travadas

| Regra | Onde | Travada por |
| --- | --- | --- |
| Papel **global** do novo membro é sempre `user` | `db/membros.js`, INSERT com `'user'` literal | guarda lê o fonte |
| E-mail existente ⇒ **só acrescenta vínculo** (nunca muda senha, nome ou papel global) | `criarMembro` | — |
| Já é membro ⇒ **409 `MEMBRO_JA_EXISTE`**, nunca um 2º vínculo | `ON CONFLICT` 23505 | — |
| `owner` não é rebaixado nem desativado aqui | `OWNER_PROTEGIDO` | guarda |
| Ninguém altera o **próprio** vínculo | `AUTO_ALTERACAO` | guarda |
| **Não existe exclusão de membro** — desativar revoga acesso e preserva histórico | sem `router.delete` | guarda |
| Senha/hash **nunca** saem da camada | `COLS_MEMBRO` | guarda **por linha** (não por `;`: este projeto omite ponto-e-vírgula em JS, e `[^;]*` atravessaria o arquivo) |
| Auditoria sem e-mail, senha ou hash | `contexto` JSONB | guarda lê os blocos `contexto:` |
| Concessão **somente aditiva**; `false` é **recusado com 400**, não ignorado | `sanearPermissoes` | 4 testes |
| Conceder o que o papel já inclui ⇒ **400** | idem | teste |
| Trocar de papel **descarta** concessão que o papel novo passou a incluir | `sanearPermissoesExistentes` | teste |
| O front **não tem** a matriz papel×capacidade | `frontend/lib/capacidades.js` | guarda lê o fonte |

## Decisões tomadas durante a execução (não estavam no plano)

1. **`GET /membros/opcoes`** foi criada para a tela montar o formulário sem conhecer a matriz. Sem
   ela, o front teria de saber o que é concedível por papel — exatamente a duplicação que a guarda
   proíbe.
2. **`sanearPermissoes` RECUSA `false`** em vez de ignorar. `permissoes: {x: false}` é quase sempre
   alguém tentando NEGAR; falhar alto evita a expectativa de que a negação valha.
3. **A auditoria é gravada DENTRO da transação** do vínculo — ao contrário do padrão "auditoria
   nunca derruba a ação principal" usado em telemetria. Aqui a linha **é parte do fato** (quem
   adicionou quem à empresa), e um vínculo sem autoria é o que esta etapa existe para evitar.
4. **`/dashboard/contas-empresa` é rota nova**, e o teste de `navegacao.test.js` que enumera as
   rotas foi atualizado deliberadamente — é a função daquela guarda: forçar a atualização
   consciente em vez de deixar uma rota aparecer sozinha.
5. **`minRole: 'admin'` no item de menu é PROVISÓRIO**, e está comentado como tal no fonte: o
   backend já autoriza por capacidade sobre o papel do **vínculo**, e a árvore do menu ainda filtra
   pelo papel **global**. Converter a árvore é a Etapa 6.3. Os dois concordam para admin/owner da
   própria empresa, e o gate que vale é o do servidor.

## Não foi feito (de propósito)

- Convite por e-mail: a senha inicial é definida pelo admin e entregue por fora.
- Transferência de `owner`.
- **Nenhuma outra rota trocou de gate** — as 6 da operação seguem `requireRole('admin')`.

---

# 4-bis. ✅ Etapa 3.0 — Medição de produção (CONCLUÍDA, autorizada pelo operador)

**Executada em 2026-09-11** contra o banco de produção, em `BEGIN TRANSACTION READ ONLY` +
`ROLLBACK`, sem PII. **Nada foi gravado.**

```bash
DATABASE_URL=<proxy público do Railway> npm run medir:qualificacao-lead
```

- Script: `backend/scripts/medir-qualificacao-lead.js` (somente leitura).
- Guardas: `backend/test/medir-qualificacao-lead.test.js` (12 testes; falha se qualquer verbo de
  escrita, chamada externa, dependência nova, URL de banco embutida ou coluna de PII aparecer no
  fonte, e se `STATUS_RODAVEL` divergir do de produção).
- **Credencial:** a versionada em `.claude/settings.json` **não autentica** (porta 14878). A que
  funciona é a senha de `backend/.env` no **proxy público, porta 53678**. A linha do
  `settings.json` continua sendo dívida a remover do git.

## O retrato real

| Medida | Valor |
| --- | --- |
| Leads no acervo | **4.430** |
| … que nasceriam `legado` | **4.268** |
| … que nasceriam `descartado` | **162** |
| Elegíveis ao disparo hoje | **3.535** |
| … **sem nenhuma prova de triagem** | **2.748 (77,7%)** |
| Disparos efetivos nos últimos 30 dias | **0**, em 0 dia |
| Modo Automático do Banco de Leads | **DESLIGADO** em todas as empresas |
| Leads vinculados a campanha | **1.417** |
| … na fila da Central de Ligações **sem triagem** | **1.031** |
| … na fila da Central de Ligações **JÁ DESCARTADOS** | **54** |
| Decisões de curadoria já tomadas | **3** (última em 2026-08-05) |
| Leads com e-mail abordáveis hoje sem triagem | **316** de 344 |
| Empresas ativas | **2** |
| Vínculos `usuarios_empresas` | **owner = 2. Nenhum `admin`, nenhum `member`, nenhum outro** |

## Cinco conclusões que alteram o plano

**1. O risco máximo do projeto CAIU de alto para baixo.** O plano supunha que fechar a porta
poderia zerar o volume diário de disparo. **O volume diário já é zero há mais de 30 dias**, e o
modo Automático está desligado em todas as empresas. A Etapa 3 **não interrompe nenhum disparo em
andamento** — ela impede disparos futuros de leads não triados. A carência `legado` continua
sendo obrigatória (77,7% dos elegíveis não têm prova), mas o custo de errar caiu muito.

**2. O defeito C1 está ativo em produção, agora.** **54 leads já descartados estão na fila da
Central de Ligações**, junto com 1.031 nunca triados. Não é risco teórico: é um operador podendo
ligar, hoje, para alguém que já foi recusado. **A 2ª barreira em `filaDeTrabalho` (subetapa 3.4)
não é defesa em profundidade — é correção de um defeito medido.**

**3. Q1 está respondida por evidência: não existe nenhum `member`.** Os únicos vínculos são
2 `owner`. Portanto a perda de `conversa_gerenciar_ia` e `conversa_apagar_historico` pelo `member`
**não afeta ninguém** — a decisão C do plano vira compatibilidade preventiva, não mitigação de
impacto real. ✅ **Q1 encerrada.**

**4. O multi-tenant NÃO é hipotético.** A segunda empresa (`f5f47737…`) tem **3.294 leads — mais
que a PJ Codeworks (782)** — e é a única com `app.banco_leads_config`. Todo recorte por
`empresa_id` das próximas etapas tem consequência real, e testar com duas empresas nos testes de
isolamento deixou de ser exercício acadêmico.

**5. A curadoria foi usada 3 vezes e há 1 sessão ATIVA aberta** (desde 2026-08-05). A ferramenta
de triagem existe, funciona e está praticamente sem uso — o que confirma por que `aprovado` nunca
significou nada operacionalmente. A sessão presa não é defeito (o índice único parcial permite uma
por operador), mas deve ser encerrada antes da Etapa 3.6 para a tela não abrir numa sessão velha.

## Dívidas registradas aqui (não são desta etapa)

| Dívida | Onde |
| --- | --- |
| Credencial de produção versionada no git, já obsoleta | `.claude/settings.json` |
| `rejectUnauthorized: false` nos **3** scripts de medição (proxy do Railway) | `scripts/medir-*.js` — corrigir nos três juntos, instalando a CA ou usando `sslmode=verify-full` |
| `test/acesso-capacidades.test.js` não estava no `npm test` | corrigido nesta entrada (junto com o teste novo) |

---

# 5. ✅ Etapas 3 a 12 — o que foi entregue

Todas concluídas em 2026-09-11. Abaixo, o que cada uma mudou e **as decisões que só apareceram na
execução** — é isso que outra IA precisa saber antes de mexer nestes módulos.

## ✅ Etapa 3 — Qualificação do lead (a porta)

| Onde | O quê |
| --- | --- |
| migration `071` | `prospects.qualificacao` (`pendente\|aprovado\|descartado\|legado`) + `qualificado_em/por` + 2 índices parciais |
| `services/lead-qualificacao.js` **(PURO)** | dono do vocabulário; `avaliarAbordagem`, `sqlAbordavel`, `sqlNaoDescartado` |
| **as 4 portas** | `db/campanhas.js` (entrada + 2ª barreira na fila) · `rodar-leads.js` (3 pontos) · `banco-leads-auto.js` · `email-outreach.js` |
| coletores | `prospecting.js` e `social-capture.js` gravam `'pendente'` **explicitamente** |
| `prospecting.js` | **auto-aprovação REMOVIDA** de `processarFluxoCompleto` |
| curadoria e rotas | gravam os **dois eixos** na mesma instrução + auditoria |

**Por que uma coluna nova e não reusar `status`:** `rodar-leads` grava `status='enviado'` ao
abordar — **`enviado` sobrescreve `aprovado`**. Uma regra "só entra quem está aprovado" expulsaria
da operação justamente quem já foi contatado.

**`legado` é a carência**, e ela não é opcional: 77,7% dos 3.535 leads elegíveis em produção não
têm prova de triagem (§4-bis). Sem o `DEFAULT 'legado'` a operação pararia no boot.

**A 2ª barreira é mais FROUXA que a porta, de propósito:** a fila exige apenas "não descartado".
Exigir aprovação ali tiraria 1.031 leads da Central de Ligações de uma vez.

## ✅ Etapa 4 — Ownership de lead

migration `072` (`responsavel_id`, `responsavel_desde`, `app.lead_responsavel_historico`) +
`services/lead-responsavel.js` (PURO) + `db/lead-responsavel.js` + 5 rotas no Banco de Leads.

- **`responsavel_id = NULL` é a fila de livres** — estado de primeira classe, não erro.
- **Claim atômico**: `UPDATE ... WHERE responsavel_id IS NULL RETURNING`. Dois vendedores no mesmo
  segundo: um ganha, o outro recebe **409 com o nome de quem ganhou**.
- **1:1, não N:N.** `lead_assignments` foi recusada: permitir vários responsáveis modelaria o
  problema que o ownership existe para impedir.
- **Nenhum backfill de responsável** — todo lead nasce livre, que é o estado correto.
- O histórico é tabela própria (não `auditoria_eventos`) porque a migration `047` declara que a
  auditoria **não deve ser fonte de dashboards**, e "quantos leads o vendedor X teve" é gestão.

## ✅ Etapa 5 — Abordagem manual `wa.me`

migration `073` (`canal`, `confirmado_por`, `confirmado_em`; `evolution_instance` deixa de ser
obrigatória) + `services/abordagem-manual.js` (PURO) + `db/abordagem-manual.js` + 3 rotas.

**TRÊS fatos distintos, e a separação É a feature:** preparar (read-only) → **abrir** o WhatsApp
→ **declarar** que enviou. `confirmado_por='provider'` é a Evolution confirmando;
`'operador'` é declaração humana, e **não é prova**.

- **Dois bugs reais foram pegos pelos testes** ao escrever esta etapa: `+1 415 555 2671` (11
  dígitos com DDI) virava `5514155552671` — abordagem para o número errado, em outro país; e
  `montarRascunho(null)` quebrava (`lead = {}` não protege contra `null`).
- O rascunho é **determinístico**: nenhuma IA no caminho. Guarda de regressão impede.
- Disparo manual **nunca** conta para o teto anti-ban da Evolution.
- **Nenhum job pode gravar `confirmado_por='operador'`** — guarda varre `src/**`.

## ✅ Etapa 6 — Abrir o papel `comercial` *(a de risco alto)*

**15 mounts** trocaram `requireRole('admin')` por `requireCapacidade`. `requireRole` continua no
que é de **plataforma** (`/api/llm`, `/api/webhook-quarentena`, `/api/admin`).

**O mount não bastava.** Dentro de 4 routers há escritas que a matriz separa, e elas ganharam
capacidade **por rota**: `ROTEIRO_GERENCIAR` (7), `CAMPANHA_GERENCIAR` (6),
`LEAD_DISPARAR_LOTE` (7), `FOLLOWUP_CONFIG_EMPRESA` (2). Sem isso, montar `/roteiros` com
`ROTEIRO_LER` deixaria o comercial **criar** roteiro.

**Ordem dos middlewares importa:** `requireCapacidade` depende de `requireEmpresaAccess` e recusa
com **500 `ACESSO_MAL_CONFIGURADO`** se rodar antes — a rota cairia para todo mundo, inclusive o
admin. Há teste conferindo a ordem em cada mount.

**`/conversas` NÃO foi migrada aqui, deliberadamente:** sem o ownership da Etapa 7, o recorte não
existiria e o comercial veria a empresa inteira.

## ✅ Etapa 7 — Ownership de conversa

migration `074` + `services/conversa-responsavel.js` (PURO) + `db/conversa-responsavel.js` +
4 rotas.

**A regra oposta à do lead, e a mais importante daqui: RESPONDER nunca é bloqueado.** Travar a
resposta no meio de um atendimento deixa o **cliente** sem resposta porque o sistema decidiu que a
pessoa errada estava na tela. O ownership organiza e dá visibilidade; não bloqueia atendimento —
`avaliarResponder` devolve `{permitido: true, avisar}`.

- O padrão de quem não vê todas é **"minhas + NÃO ATRIBUÍDAS"**, nunca "só minhas": conversa que
  ninguém vê é cliente sem resposta.
- Corrige `operador_assumiu_em`, que registrava **quando** alguém assumiu e **nunca quem** — e o
  preserva com `COALESCE` (handoff antigo mantém o instante original).
- **Não toca `atualizado_em`** (reordenaria a Central) nem `modo_ia`/`agente_pausado` (decisões
  independentes).

## ✅ Etapa 8 — Instâncias com responsável + contexto padrão

migration `075` (`usuario_id`, `criado_por`, `empresas.contexto_padrao_id`) + os 3 pontos de
criação + 2 rotas + recorte na listagem.

**O contexto NUNCA esteve preso à primeira instância** — `app.empresa_contextos` sempre foi
entidade da empresa, compartilhável, com fluxo de transferência. O que faltava era um **padrão**.

**Ele é COPIADO na criação, nunca resolvido na resposta.** Compartilhar acoplaria duas instâncias
ao mesmo registro editável (editar o contexto de um vendedor mudaria como o número do outro
responde); resolver na resposta violaria *"atendimento é 100% por instância"*. `duplicarContexto`
já existia. **`buscarContexto2Ativo` não foi alterada**, com guarda.

`usuario_id` **não participa** da resolução de instância de envio nem do webhook — guardas em 3
arquivos. O provisionamento máquina-a-máquina deixa o responsável **nulo**, de propósito.

## ✅ Etapa 9 — Permissão de IA

**A permissão não é "a IA pode responder"** — isso já existia (`modo_ia`, migration `063`). O que
esta etapa controla é **quem pode LIGAR a IA**: `PATCH /modo-ia`, `PATCH /agente` e ativar a
instância. Bloqueado por padrão para `comercial` e `member`, liberável por **concessão aditiva**.

**Decisão E:** instância criada por quem não pode ligar a IA **nasce inativa**, com aviso na tela.
Instância inativa não responde — a regra vale sem tocar o webhook.

**Nenhum motor de IA foi alterado**, e há guarda em 6 arquivos. `DELETE /historico` ganhou
capacidade própria (destrutivo e irreversível).

## ✅ Etapa 10 — Ligações e Follow-ups por responsável · **sem migration**

Os campos já existiam e nunca foram usados para filtrar: `ligacoes.usuario_id` (migration `040`) e
`follow_ups.responsavel_id` (migration `062`, com índice pronto).

**A assimetria é deliberada:** ligação recorta por permissão (`LIGACAO_VER_TODAS`); **a fila de
Follow-ups tem visibilidade GERAL** (decisão D) e o filtro por responsável é conveniência de tela
— o filtro vem da **query**, nunca do usuário logado, senão seria recorte disfarçado.

Ligação antiga sem `usuario_id` **não entra no recorte de ninguém** (atribuí-la a quem olha seria
inventar autoria). O item 10.2 (`sou_eu` → modo Acompanhar) **já estava entregue**.

## ✅ Etapa 11 — Agenda em equipe

migrations `076` (`responsavel_id`, `prospect_id`) e `077` (`empresa_id` em 5 tabelas `vendas.*`)
+ `backfill:vendas-empresa`.

**O conflito de horário virou POR PESSOA.** Antes bloqueava a empresa inteira: a reunião de um
vendedor impediria os outros dois. Agora conflita com os eventos **daquela pessoa** *e* com os da
**empresa** (sem responsável) — o segundo termo não é detalhe: evento sem dono pode ser um
bloqueio (feriado, treinamento). **Sem responsável informado, o comportamento é idêntico ao de
antes.**

`responsavel_id` ≠ `criado_por`: quem marca e quem conduz podem ser pessoas diferentes.
**Sem backfill** — afirmar que o criador conduz inventaria responsabilidade.

**A agenda do BOT (`vendas.agenda_eventos`) não foi tocada** — unificar as duas é outro projeto.

## ✅ Etapa 12 — Painel do admin, auditoria e as dívidas

`GET /equipe` e `/equipe/:id/atividade`. **O painel não tem SQL próprio**: reusa as contagens de
cada módulo. A auditoria é consultável **por pessoa**, sem agregação — a migration `047` declara
que ela não deve ser fonte de dashboard.

**migration `078` remove os `DEFAULT = PJ`** das 6 tabelas. A auditoria exigida pelo plano
encontrou **dois INSERTs que dependiam do DEFAULT** (`vendas.followup_envios` em `db-crud.js` e
`vendas.analises_pos_conversa` em `learning.js`) — os dois foram corrigidos **no mesmo diff**,
resolvendo a empresa pela CONVERSA dentro do SQL (padrão da migration `058`). Conversa
inexistente ⇒ `NULL`, nunca PJ.

---

# 6. O que ficou FORA (declarado)

| Item | Por quê |
| --- | --- |
| Fallback da PJ no **código** (`COALESCE($n, PJ)`) | Decisão de produto sobre conversa órfã, documentada no AGENTS.md. A migration `078` removeu só o DEFAULT do banco; o do código é dívida própria |
| Aposentar `/dashboard/*` legado | Decisão G — 2ª identidade (`vendas.dashboard_users`), sem escopo de empresa, ainda aprova/rejeita prospect de qualquer tenant |
| Unificar as duas agendas | `vendas.agenda_eventos` × `app.agenda_eventos` — projeto próprio |
| `vendas.conversas.numero UNIQUE GLOBAL` | Decisão J. Duas empresas com o mesmo contato colidem — já era verdade antes |
| Normalizar `historico` em tabela de mensagens | Decisão I |
| Convite por e-mail, transferência de `owner`, transferência de ligação, distribuição automática | Fora de escopo desde a especificação |
| `rejectUnauthorized: false` nos 3 scripts de medição | Dívida pré-existente; corrigir vale para os três juntos |
| Credencial de produção versionada em `.claude/settings.json` | Obsoleta, mas ainda no git |


# 7. Perguntas que precisam do operador antes de certas etapas

**Nenhuma pergunta em aberto.** As duas que existiam foram encerradas em 2026-09-11.

| # | Pergunta | Trava qual etapa | Situação |
| :-: | --- | :-: | --- |
| ~~Q1~~ | `member` perde ligar/desligar IA e apagar histórico | — | ✅ **ENCERRADA** 2026-09-11. Operador: "siga como achar melhor" ⇒ adotada a perda. A medição (§4-bis) provou que **não existe nenhum `member` em produção** (só 2 `owner`), então o impacto é zero. A matriz da Etapa 1 já encarna isso |
| ~~Q2~~ | Autorizar a medição somente-leitura em produção | — | ✅ **ENCERRADA** 2026-09-11. Operador: "pode seguir". Executada; resultado em §4-bis |
| **Q3** | Qual dos contextos existentes é o **padrão da empresa**? | **8** | Decisão de uma linha, sua. Sem ela a instância nova continua nascendo sem contexto |
| **Q4** | Aposentar `/dashboard/*` legado (2ª identidade, sem escopo de empresa) | nenhuma | Fase própria depois da v1 (decisão G). Enquanto existir, `vendas.dashboard_users` é caminho paralelo que pode aprovar/rejeitar prospect de **qualquer** empresa |

---

# 8. Invariantes do projeto — **nunca** quebrar, em nenhuma etapa

Cada item abaixo é uma regra que este repositório **pagou para aprender**. A especificação inteira
foi desenhada para não reverter nenhuma.

1. **Webhook sem dono comprovado vai para quarentena.** Não existe empresa padrão para uma
   mensagem sem origem provada (migration `060`).
2. **Instância de envio: regra única, sem fallback.** Só sai mensagem por instância nomeada por
   vínculo provado, ativa, do canal certo e da mesma empresa. Nunca por `atualizado_em`, nunca por
   env, **nunca pelo usuário** (`services/instancia-envio.js`).
3. **Origem autorizada da instância.** Instância criada fora do produto **não** é adotada.
   `legado` é a ausência de prova, nomeada (migration `061`).
4. **Atendimento é 100% por instância.** Instância sem contexto linkado **não responde** — nunca
   cai no contexto "da empresa" (`contexto-empresa.js:548`).
5. **A empresa do lead vem da CONVERSA, dentro do SQL** — nunca de payload (migration `058`).
6. **Identidade do contato = `(empresa_id, telefone_digitos)`.** Sem FK para `vendas.conversas`:
   aquele `numero` é `UNIQUE GLOBAL` e não prova empresa (migrations `062`/`066`).
7. **Fato comprovado ≠ fato declarado.** `origem='operador'` é `NOT NULL`, **sem DEFAULT**, com
   CHECK de um único valor — para nenhum job poder gravá-lo (migration `066`).
8. **Coluna que é prova não tem `DEFAULT`.** Um DEFAULT autorizaria em silêncio qualquer INSERT
   futuro que esquecesse a coluna (migrations `061`/`066`).
9. **Regra de negócio no backend; o front só traduz o veredito**
   (`lib/site-rotulos.js`, `lib/pontuacao-indicador.js`).
10. **Um dono único por vocabulário**, em módulo PURO, com guarda de regressão lendo o fonte.
11. **Um painel de conversa só** (`ConversaPainel.tsx`). Não criar um segundo.
12. **Migration aditiva.** Mutação de dado é declarada no cabeçalho; correção histórica é script
    separado que **simula por padrão**.
13. **Nenhuma variável de ambiente nova sem documentar** em `AGENTS.md` + `.env.example`.
    *(Este projeto inteiro não cria nenhuma.)*
14. **Sem PII em log** — nem telefone, nem texto de mensagem, nem token, nem `ctwa_clid`.

---

# 9. Placar final

| | Previsto | Feito |
| --- | :-: | :-: |
| Etapas | 12 | **12** ✅ |
| Migrations | 9 | **9** (`070`-`078`), todas aditivas |
| Tabelas novas | 2 | **2** (históricos de responsável de lead e de conversa) |
| Papéis novos | 1 | **1** (`comercial`) |
| **Variáveis de ambiente novas** | **0** | **0** ✅ |
| **Regras de isolamento revertidas** | **0** | **0** ✅ |
| Rotas novas | ~10 | **~25** |
| Scripts novos | 1 | **2** (`medir:qualificacao-lead`, `backfill:vendas-empresa`) |
| Módulos PUROS novos | — | **6** |

## Módulos puros criados (o padrão do projeto)

`acesso-capacidades` · `lead-qualificacao` · `lead-responsavel` · `abordagem-manual` ·
`conversa-responsavel` · e no front, `lib/capacidades`.

Cada um é dono de um vocabulário, não tem banco/HTTP/IA, e tem guarda de regressão que falha se
alguém comparar seus valores com literal fora dele.

## Telas das Etapas 3-12 — entregues (2026-09-11)

O backend ficou pronto primeiro e as telas vieram depois, na mesma sessão. **Nenhuma tela
recalcula regra**: todas consomem o veredito que a API já resolveu, no mesmo contrato de
`lib/site-rotulos.js` e `lib/capacidades.js`.

| Etapa | Tela | O que ela passou a dizer |
| --- | --- | --- |
| 3 · 4 · 5 | `dashboard/banco-leads` | selo de qualificação (e `legado` **não** se passa por aprovado), coluna de responsável com assumir/devolver, recorte meus/livres/todos e o modal de abordagem `wa.me` com os **dois** botões separados |
| 3 | `dashboard/prospeccao` | "Marcar" virou **"Aprovar"**, e saiu o texto que dizia que o lead já podia ser disparado sem triagem |
| 7 | `dashboard/conversas` + `components/ConversaPainel` | recorte por atendente, coluna Atendente, cartão de responsável com assumir/devolver e o **aviso** acima do compositor — que nunca bloqueia a resposta |
| 8 | `components/InstanciasWhatsApp` | "número da empresa (compartilhado)" × responsável, seletor de responsável para quem gerencia, contexto padrão da empresa e o aviso de instância criada inativa |
| 9 | `components/ui/AlternadorModoIa` | prop `bloqueio`: controle **desabilitado com o motivo em texto**, nos dois níveis (padrão da empresa e exceção por conversa) + pausar/retomar agente e "Deletar histórico" |
| 10 | `dashboard/central-ligacoes` · `dashboard/follow-ups` | "só as suas" quando o servidor recortou o histórico; atalho **"Meus"** na fila (que é filtro de tela, não recorte de permissão) |
| 11 | `dashboard/agenda` | seletor de vendedor, responsável no formulário e "Compromisso da empresa" para o evento sem dono |
| 12 | `dashboard/equipe` **(nova)** | quem está com o quê, o trabalho **sem dono** como linha própria, aviso de inativo com carga e a linha do tempo de auditoria |

**Três decisões de tela que valem registro:**

1. **O painel de conversa avisa, nunca barra.** `avisoDeAtendimento` devolve `podeResponder: true`
   sempre, e há guarda de regressão que falha se alguém criar `podeResponder: false` ou uma função
   com nome de bloqueio. Travar a resposta deixaria o CLIENTE sem resposta.
2. **"Bloqueado" ≠ "ocupado".** `AlternadorModoIa` ganhou `bloqueio` em vez de reusar `ocupado`:
   um mostra "Atualizando…" (temporário), o outro mostra o motivo (permanente). Reusar faria a
   tela mentir sobre o que está acontecendo.
3. **O painel da equipe não é placar.** As quatro contagens medem coisas diferentes e não se
   somam; `ligacoes` fica fora da carga atual porque é acumulado. `lib/equipe-painel.js` tem
   guarda que falha se `ranking`, `produtividade`, `media(`, `percentual` ou `score` aparecerem.

**Uma mudança de backend nasceu do frontend:** a listagem de conversas devolvia `responsavel_id`
sem nome nenhum, e o painel só poderia dizer "outro atendente". Avisar sem dizer de quem não
resolve o problema real (dois atendentes sem saber um do outro), então `api-conversas.js` ganhou
`LEFT JOIN app.usuarios` nas duas consultas. **`GET /agenda/responsaveis`** também é nova, e
**reusa `listarResponsaveis` de `db/follow-ups.js`** — duas consultas divergentes fariam o mesmo
colega aparecer num seletor e sumir do outro.

## Testes

| Suíte | Testes |
| --- | :-: |
| `acesso-capacidades` | 22 |
| `membros` | 15 |
| `autorizacao-rotas` | 12 |
| `lead-qualificacao` | 23 |
| `lead-responsavel` | 23 |
| `abordagem-manual` | 25 |
| `conversa-responsavel` | 16 |
| `instancia-responsavel` | 16 |
| `permissao-ia` | 10 |
| `recorte-por-responsavel` | 13 |
| `agenda-equipe` | 19 |
| `equipe-painel` | 10 |
| `medir-qualificacao-lead` | 12 |
| `agenda-multiempresa` (ampliada) | +7 |
| `frontend/lib/capacidades` | 14 |
| `frontend/lib/lead-operacao` | 18 |
| `frontend/lib/conversa-operacao` | 12 |
| `frontend/lib/equipe-painel` | 11 |
| **Total acrescentado** | **+300** |

**Estado da suíte (2026-09-11, com as telas):** backend **1867/1869** · frontend **421/421** ·
`tsc --noEmit` limpo nos dois lados. As 2 falhas são as de sempre (`429` no provedor de IA em
`core.test.js`), ambientais — os dois testes fazem chamada real ao provedor.

## Dois defeitos REAIS encontrados pelos testes durante a execução

1. **Telefone internacional virava número brasileiro.** `+1 415 555 2671` (11 dígitos) recebia o
   prefixo `55` e virava `5514155552671` — uma abordagem para o número errado, em outro país. A
   causa: o ramo "local sem DDI" vinha antes do ramo internacional. Corrigido em
   `services/abordagem-manual.js` (um `+` no original prova que o DDI já está lá).
2. **`montarRascunho(null)` quebrava.** `lead = {}` como default de parâmetro **não** protege
   contra `null` — só contra `undefined`, e um lead nulo chega de qualquer camada que não achou a
   linha.

## Uma correção de guarda pré-existente

A guarda "a comparação de modo não é duplicada" (migration `063`) acusava **comentário** como se
fosse código, e o `//.*$` dela falhava silenciosamente em arquivos **CRLF** — em JS, `.` não casa
`\r`. Corrigida para `[^\n]*` e para ignorar comentários, **e verificada por mutação**: ela
continua pegando o defeito real.
