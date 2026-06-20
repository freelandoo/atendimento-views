# Handoff — Frontend da Captação (Instagram) por nicho/perfis

> Brief autossuficiente para uma sessão NOVA construir a tela de captação.
> O **backend já está pronto e testado** (726 testes ok). Falta só a tela.

## Objetivo
Reescrever `frontend/app/dashboard/captacao/page.tsx` (já existe com campos ANTIGOS de
"hashtag" — descartar) para o **modelo real**: coleta por **nicho+cidade (Google CSE)**
e/ou **lista de @perfis semente**, com **bola de neve** (related_accounts) e **seguir
link da bio**. Hashtag automática NÃO existe na conta Bright Data — não usar.

## Contexto técnico (já confirmado por teste real da API)
- Bright Data raspa **perfil de Instagram por @username/URL** (dataset `gd_l1vikfch901nx3by4`).
  Campos: `account, full_name, biography, external_url[], email_address, business_category_name,
  followers, is_business_account, related_accounts[{user_name,...}]`. **Não traz telefone.**
- Descoberta de perfis: **Google CSE** (`site:instagram.com <nicho> <cidade>`) + **related_accounts**.
- Contato (email/WhatsApp) sai do parse da bio + (opcional) seguir o link da bio.

## Padrões do frontend (seguir igual ao resto do dashboard)
- `'use client'`; `import { apiFetch, getEmpresaId } from '@/lib/api'`.
- `const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''`
- `const base = '/api/empresas/' + empresaId + '/captacao'`
- Tailwind; espelhar o estilo de `frontend/app/dashboard/prospeccao/page.tsx`.
- Validar no fim: `cd frontend && npm run typecheck` (precisa passar limpo).
- A página JÁ está no menu (Sidebar: item "Captação" → `/dashboard/captacao`).

## Contrato da API (tudo já implementado no backend)
Base: `/api/empresas/:empresaId/captacao` (Bearer token via apiFetch).

| Método | Rota | Body / Query | Retorno |
|---|---|---|---|
| GET | `/orcamento` | — | `{ teto_diario_global, consumido_hoje, restante_hoje, brightdata_configurado }` |
| GET | `/funil` | — | `{ abas:{entrada,coletados,em_andamento,descartados}, por_status }` |
| GET | `/campanhas` | — | lista de campanhas |
| POST | `/campanhas` | ver abaixo | campanha criada |
| PATCH | `/campanhas/:id` | campos parciais | campanha |
| DELETE | `/campanhas/:id` | — | `{ok}` |
| POST | `/coletar` | ver abaixo | `{ ...snapshot }` (202) |
| POST | `/processar` | — | `{ processados }` (forçar poll; o worker já roda sozinho) |
| GET | `/snapshots` | — | últimas coletas |
| GET | `/leads` | `?aba=entrada\|coletados\|em_andamento\|descartados&fonte=instagram` | leads |
| POST | `/leads/:id/status` | `{ status }` | `{id,status}` |
| GET | `/email/status` | — | `{ configurado }` |
| POST | `/leads/:id/email` | `{ assunto, corpo }` | resultado |

### POST /campanhas (e PATCH) — body
```json
{
  "fonte": "instagram",
  "nicho": "arquitetura de interiores",
  "cidade": "São Paulo",
  "perfis_semente": "@studioabc, @casadecor\nperfilxyz",
  "teto_diario": 50,
  "usar_cse": true,
  "usar_snowball": true,
  "seguir_link_bio": true,
  "ativo": true
}
```
`perfis_semente` aceita string (vírgula/linha/espaço) OU array. Precisa de **nicho OU ao
menos 1 perfil**. Campanha guarda toggles em `metadata_json`.

### POST /coletar — body (2 formas)
- Por campanha: `{ "campanha_id": "<uuid>" }`
- Ad-hoc: `{ "nicho","cidade","perfis","usar_cse","usar_snowball","seguir_link_bio","limite" }`

### Campos retornados
- **campanha**: `id, fonte, termo, nicho, cidade, teto_diario, ativo, ultima_coleta_em, metadata_json{perfis_semente[],usar_cse,usar_snowball,seguir_link_bio}`
- **lead** (`/leads`): `id, origem, external_ref, instagram_handle, nome, telefone, email, nicho, cidade, bio, link_bio, categoria_perfil, seguidores, site, status, created_at, updated_at`
- **status possíveis**: `coletado, contato_encontrado, aprovado, enviado, respondeu, rejeitado, nao_contatar`
- **abas**: entrada=`contato_encontrado`(+aguardando) · coletados=`coletado` · em_andamento=`aprovado/enviado/respondeu` · descartados=`rejeitado/nao_contatar`

## A tela deve ter
1. **Cards de orçamento**: teto/dia, consumido hoje, restante hoje. Banner de aviso se `brightdata_configurado=false`.
2. **Painel "Coletar agora" (ad-hoc)**: inputs **Nicho**, **Cidade**, **textarea de @perfis** (um por linha ou separados por vírgula), **toggles** (Usar Google CSE / Bola de neve / Seguir link da bio), **limite**; botão Coletar → `POST /coletar`.
3. **Campanhas salvas**: form de criação (mesmos campos + teto/dia + ativo) → `POST /campanhas`; lista com "Coletar agora" (`POST /coletar {campanha_id}`), editar (PATCH), excluir (DELETE).
4. **Funil em abas** (Entrada / Coletados / Em andamento / Descartados) com contadores do `/funil`; lista de leads via `/leads?aba=`. Cada lead mostra @handle, nome, nicho/cidade/categoria/seguidores, telefone, email, link da bio. Ações por lead:
   - "Aprovar p/ WhatsApp" (`status=aprovado`) — só se tiver telefone.
   - "Descartar" (`status=rejeitado`), "Não contatar" (`status=nao_contatar`).
   - (opcional) enviar e-mail (`/leads/:id/email`) se `/email/status.configurado`.
5. **Coletas recentes**: lista de `/snapshots` (fonte, etapa, status, termo, custo_registros, total_prospects).
6. Botão "Atualizar coletas" → `POST /processar` e recarrega.

## Importante
- Não inventar endpoints — usar só os da tabela acima.
- Lógica/regra fica no backend; a tela é só apresentação (regra do AGENTS.md).
- Reaproveitar o `<Field>`/`<Card>` helper já existente na página atual se ajudar.
- Ao terminar: `cd frontend && npm run typecheck` deve passar.
```
