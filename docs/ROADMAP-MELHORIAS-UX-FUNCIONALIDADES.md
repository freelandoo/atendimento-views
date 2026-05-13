# Roadmap UX visual e funcionalidades — Dashboard PJ Codeworks

Plano complementar ao [ROADMAP-MELHORIAS-TECNICAS.md](./ROADMAP-MELHORIAS-TECNICAS.md). Foco em **interface**, **fluxos do operador** e **pequenas features** que aumentam produtividade sem obrigar mudança grande no backend (alguns itens podem exigir novos endpoints).

---

## 1. Coesão visual e polimento

| Item | Onde | Descrição |
|------|------|-----------|
| Design tokens | `dashboard/css/dashboard.css` | Centralizar cores, raios, espaçamentos em `:root` (ex.: `--radius-card`, `--space-section`) para evitar drift entre páginas. |
| Estados vazios/erro/carregando | `conversas.js`, `perfil-lead.js`, `visao-geral.js`, `analytics.js` | Ilustração ou mensagem consistente; skeleton na lista de conversas e no perfil durante fetch. |
| `prefers-reduced-motion` | CSS global | Respeitar usuário com redução de movimento (animar só o essencial). |
| Hierarquia tipográfica | Todas as páginas | Revisar tamanhos de título de card vs corpo; limitar largura de texto longo (coach, Gamma) para legibilidade. |
| Modo escuro opcional | CSS + `localStorage` | Toggle que alterna classe no `body`; persistir preferência. |

---

## 2. Conversas (`conversas.html` / `conversas.js`)

| Item | Descrição |
|------|-----------|
| **Toasts** | Substituir `alert()` por área de notificação não bloqueante (sucesso/erro de follow-up e lote). |
| **Busca / filtro local** | Campo texto que filtra linhas visíveis por número ou estágio (client-side sobre a página atual). |
| **Ordenação** | Controles “mais recente / mais antigo” se a API passar a aceitar `ordenar`/`direcao` na lista operacional (hoje `dashboard/data` já suporta em parte — alinhar UI). |
| **Preview da última mensagem** | Trecho curto da última bolha (exige `historico` resumido na API ou novo campo `ultima_preview` — avaliar tamanho). |
| **Confirmação em ações destrutivas** | Se no futuro houver “arquivar” ou reset, usar modal de confirmação. |
| **Atalhos de teclado** | Ex.: `r` atualizar lista (com guard para não digitar em input). |

---

## 3. Modal de follow-up e lote

| Item | Descrição |
|------|-----------|
| Foco preso no modal | Tab cycle dentro do modal até fechar; retorno de foco ao botão que abriu. |
| **Rascunho do modal** | Opcional: `sessionStorage` por `numero` para não perder texto ao clicar fora por engano. |
| Resumo do lote | Antes de enviar, mostrar “N contatos selecionados” + lista colapsável. |
| Progresso | Para lote grande, barra ou contador “3/15” em vez de só texto no status. |

---

## 4. Perfil do lead (`perfil-lead.html` / `perfil-lead.js`)

| Item | Descrição |
|------|-----------|
| **Salvar funil sem remontar tudo** | Após `PATCH`, atualizar só blocos “Funil” + badges em vez de re-render completo (preserva scroll e texto do coach se já gerado). |
| **Confirmação antes de salvar** | Modal leve “Confirmar alteração de venda fechada?” quando mudar checkbox de fechado. |
| **Undo** | Toast com “Desfazer” seria ideal com endpoint reverso ou snapshot — pode ficar fase 2. |
| **Copiar número** | Botão explícito “Copiar E.164” além do JID. |
| **Timeline** | Filtro “só cliente / só agente” no histórico sanitizado para leitura longa. |

---

## 5. Configuração (`configuracao.html`)

| Item | Descrição |
|------|-----------|
| Indicador “chave salva” | Ícone ou texto quando `sessionStorage` tem valor (sem mostrar o segredo). |
| Teste de chave | Botão “Testar” que chama um GET leve (`/dashboard/conversa-detalhe` com número de teste ou endpoint `HEAD` dedicado) e mostra 401 vs 200. |
| Agrupar cards | Accordion ou âncoras no topo (“Atualização”, “Segurança”, “Follow-up”) para página longa. |

---

## 6. Analytics e visão geral

| Item | Descrição |
|------|-----------|
| Link direto para perfil | Na tabela/gráfico, clicar no número abre `perfil-lead.html?numero=…` (paridade com Conversas). |
| Exportação contextual | Tooltip explicando colunas do CSV; opção de filtro refletida no nome do arquivo. |
| Metas visuais | Linha de meta no gráfico (se houver meta comercial configurável — pode ser só UI com constante). |

---

## 7. Acessibilidade e mobile

| Item | Descrição |
|------|-----------|
| Contraste | Revisar badges e `texto2` em fundo `cinza` (WCAG AA onde possível). |
| Área de toque | Botões em `.lead-meta` com altura mínima ~44px em breakpoints pequenos. |
| `aria-live` | Já existe em partes; estender para toasts e erros de rede. |

---

## 8. Funcionalidades com impacto médio (backend opcional)

| Item | Backend |
|------|---------|
| Paginação na lista de conversas | `dashboard/data` já tem `limit`/`offset` — expor na UI “Carregar mais”. |
| Filtro por estágio na lista | Query `estagio` já existe na API — seletor na toolbar de Conversas. |
| Notas internas por lead | Nova tabela `vendas.notas_operador` + GET/POST; card no perfil. |
| Tags coloridas | Coluna JSON ou tabela de tags; filtro na lista. |

---

## Priorização sugerida (UX)

1. Toasts + acessibilidade do modal de follow-up.  
2. Busca local + filtro de estágio na lista de conversas.  
3. Skeletons e estados de erro consistentes.  
4. Tokens CSS + modo escuro (se desejado).  
5. Notas internas / preview de última mensagem (dependem mais de API/DB).

---

## Arquivos principais tocados (quando implementar)

- `dashboard/css/dashboard.css`  
- `dashboard/js/conversas.js`, `configuracao.js`, `perfil-lead.js`, `core.js`  
- `conversas.html`, `perfil-lead.html`, `configuracao.html`  
- Opcionalmente `index.js` para previews, notas ou paginação explícita na resposta da lista.
