# Equipes por Nicho — análise de impacto (2026-09-18)

> **Status: ANÁLISE. Nenhuma linha de código foi escrita.** Pelo `CLAUDE.md`, mudança
> estrutural (schema + recorte em 4 módulos) espera confirmação. Este documento existe para
> a decisão ser tomada com os conflitos à vista.

## 1. A decisão, como o operador registrou

- Cada pessoa em **no máximo uma equipe ativa** por vez.
- Cada equipe com **um nicho** (por enquanto).
- O recorte por nicho é **OBRIGATÓRIO**, não filtro visual: Banco de Leads, Central de
  Ligações, Follow-ups e Minha Operação se orientam pelo nicho da equipe.
- **Missão é sempre por equipe** (equipe, nicho, participantes, período, meta, recompensa).
- O **ranking exibido é o GERAL da operação**, mesmo quando a missão é de uma equipe.
- Remover pessoa da equipe **devolve os leads dela para livres**, como ação explícita do
  dono/admin, com a tela avisando o número antes.

## 2. O que JÁ existe e não deve ser reinventado

| Peça | Onde | Observação |
|---|---|---|
| Catálogo de nichos | `app.nichos` (migration **038**) | Por empresa, `uq_nichos_empresa_nome` case-insensitive. `app.campanhas.nicho_id` já referencia. |
| Devolver lead para livres | `definirResponsavel(..., destinoId: null)` em `src/db/lead-responsavel.js` | `responsavel_id = NULL` **já é** a fila de livres (migration 072). Histórico append-only em `app.lead_responsavel_historico`. |
| Recorte de leads | `sqlEscopo` / `sqlAlcance` em `services/lead-responsavel.js` | O nicho entra como **terceiro eixo**, com `AND`. |
| Missão | `app.missoes` (migration **085**) | Publicada é **IMUTÁVEL**; "quem alcançou" é **derivado** de `app.vendas`, não persistido. |
| Ranking geral | `rankingDoMes` + `GET /comissao/ranking` | Já é por empresa, por faturamento pago originado, **sem expor comissão alheia** (decisão D4). |
| Vínculo pessoa↔empresa | `app.usuarios_empresas` | Papel e concessões vivem aqui. Equipe é outra coisa e **não deve virar papel**. |

## 3. O CONFLITO CENTRAL: o lead não sabe em que nicho está

`prospectador.prospects` **não tem `nicho_id`**. Tem `nicho` **TEXTO LIVRE**, que nasce do
termo digitado na Aquisição (`prospecting.js:1108`) e é **sobrescrito a cada recoleta**
(`nicho = EXCLUDED.nicho`, linha 1190).

Consequência direta: um recorte obrigatório que case por nome vai deixar leads de fora **em
silêncio**. "Energia Solar", "energia solar", "energia solar residencial" e "instalação de
energia solar" são quatro nichos diferentes para o banco e o mesmo negócio para a pessoa.
E o pior desfecho não é o erro visível — é o vendedor abrir o Banco de Leads e ver menos
carteira do que tem, sem nada explicando por quê.

**O cabeçalho da própria migration 038 previu isto:** *"o catálogo casa por NOME; `nicho_id`
nos leads é migração futura"*. O recorte obrigatório é o que torna essa fase futura
inadiável — ela é **pré-requisito**, não detalhe de implementação.

## 4. O risco que mais preocupa: repetir o defeito recém-corrigido

Em 2026-09-12 o Banco de Leads abria **vazio** para todo comercial, porque `sqlEscopo` usava
`meus` como padrão e nenhum lead tinha responsável. A correção foi o padrão "meus + livres".

Um recorte obrigatório por nicho reintroduz exatamente essa classe de defeito por outro
caminho: equipe de Energia Solar + nenhum lead aprovado desse nicho = **tela vazia**. A
diferença entre "isto está quebrado" e "sua equipe trabalha Energia Solar e ainda não há
leads desse nicho na carteira" é inteiramente o **estado vazio explicativo** — e ele é
requisito, não polimento.

Vale para os quatro módulos, e a Central de Ligações já parte de uma fila estreita: ela exige
`qualificacao = 'aprovado'`, e o `AGENTS.md` declara que ela fica vazia até alguém triar.
Nicho por cima disso estreita de novo.

## 5. Missão: o índice único vira o ponto de atrito

`missoes_uma_ativa_por_empresa_uk` (085) é `UNIQUE (empresa_id) WHERE status = 'ativa'`.
Missão por equipe exige `(empresa_id, equipe_id)`. É **alterar índice existente** — aditivo em
efeito (alarga o que é aceito), mas muda o significado de "a missão ativa", termo que a Etapa 1
e a Minha Operação já usam.

Duas perguntas que a mudança abre e que o código não pode responder sozinho:

1. **Quem não está em equipe vê qual missão?** Nenhuma, ou a missão sem equipe (a atual)?
2. **A métrica da missão passa a ser recortada por nicho?** A missão mede
   `faturamento_pago_originado`; o faturamento vem de venda, a venda vem de lead, e o lead tem
   nicho. Se um membro da equipe de Energia Solar vender para um lead de outro nicho, **conta
   para a missão?** Se contar, o nicho da missão é rótulo. Se não contar, é preciso rastrear o
   nicho do lead até a venda — e `app.vendas` hoje não guarda nicho.

## 6. Devolver leads na remoção — o que o texto não fecha

- **Quais leads?** O registro diz "os leads em andamento dela naquele nicho". Se a pessoa só
  trabalhou aquele nicho, é tudo. O recorte precisa ser explícito na tela **e** na contagem do
  aviso, senão o número prometido e o número devolvido divergem.
- **Lead com reunião marcada também volta?** Devolver um lead com reunião amanhã deixa o
  compromisso sem dono — `app.agenda_eventos.responsavel_id` continua apontando para quem saiu.
  Excluí-los do lote é defensável; incluí-los sem tratar a agenda não é.
- **Transacional e auditado.** `app.lead_responsavel_historico` é append-only: cada lead
  devolvido tem de gerar sua linha, tudo numa transação. Devolução parcial silenciosa seria
  pior que falha.
- **Não é automático.** O operador foi explícito: ação do dono/admin, com aviso. Um worker que
  devolvesse leads sozinho seria a automação que ele recusou.

## 7. As quatro decisões — RESOLVIDAS pelo operador em 2026-09-18

**D1 — `prospects.nicho_id`, com backfill.** O recorte casa por **id**, não por nome. É a
"migração futura" que a 038 previu, e ela vira pré-requisito. `prospects.nicho` continua
existindo como texto de auditoria (mesmo contrato de `site` × `link_original` na 056). O
backfill **simula por padrão** e o lead que não casar fica **`NULL` e visível para revisão** —
nunca adivinhado. Casar por nome foi recusado porque variação de grafia tiraria o lead do
recorte em silêncio.

**D2 — Quem não está em equipe NÃO é recortado.** Mantém o comportamento de hoje (meus +
livres). O recorte só existe onde alguém o definiu — a mesma disciplina de "não se inventa
dono" que governa instância de envio, quarentena de webhook e ownership. Bloquear criaria um
segundo lockout como o aceite do termo, parando todo comercial no dia do deploy.

**D3 — O nicho da missão é RÓTULO; a métrica não é recortada.** A missão pertence à equipe e
usa os participantes dela, mas mede todo o faturamento pago originado por eles no período.
`app.vendas` **não** ganha nicho. Recortar exigiria rastrear o nicho do lead até a venda, e a
métrica única de `app.missoes` (CHECK fechada, 085) continua intacta.

**D4 — Lead com compromisso marcado NÃO é devolvido.** Devolvê-lo deixaria a reunião com
responsável que saiu da equipe. O aviso da tela separa os dois números: *"X voltam para
livres, Y ficam por terem compromisso marcado"*. Prometer um número e devolver outro seria
pior que a fricção.

## 8. O que isso fixa como escopo da implementação

Pré-requisito (fase própria, antes do recorte):
- migration `prospects.nicho_id` + índice; `npm run backfill:prospects-nicho` (simula por
  padrão, keyset em lotes, sem chamada paga, relatório sem PII);
- a recoleta **não pode sobrescrever** `nicho_id` — mesma disciplina de `telefone_origem` e
  `qualificacao`, que a recoleta preserva.

Depois:
- `app.equipes` + vínculo pessoa↔equipe (índice único parcial: uma ativa por pessoa, no padrão
  de `comissao_planos` e `missoes`);
- terceiro eixo no recorte (`AND`), com **estado vazio explicativo obrigatório** nos 4 módulos;
- `app.missoes.equipe_id` + troca de `missoes_uma_ativa_por_empresa_uk` para
  `(empresa_id, equipe_id)`;
- devolução em lote, transacional, com linha em `app.lead_responsavel_historico` por lead.

**Fora de escopo:** Agenda, ranking da missão (o operador escolheu destacar o geral), equipe
multi-nicho, pessoa em mais de uma equipe.
