# Guia visual PJ Codeworks

Este projeto deve seguir uma UI operacional, clara e proprietaria da PJ Codeworks. A marca parte do logo: azul vivo, preto absoluto nos elementos de marca, muito branco e uma sensacao de precisao tecnica.

## Principios

- Priorize clareza operacional: dashboards, filtros, tabelas e acoes devem ser densos, escaneaveis e previsiveis.
- Use o azul PJ como cor de acao e foco. Verde fica apenas para estados positivos; amarelo para alerta; vermelho para erro.
- Evite telas com cara de landing page dentro do dashboard. A primeira dobra deve mostrar a ferramenta funcionando.
- Use cards apenas para blocos funcionais, listas repetidas e modais. Nao coloque cards dentro de cards.
- Mantenha cantos discretos, de 6px a 8px, para preservar uma aparencia tecnica e madura.
- Texto deve ser curto, util e orientado a decisao. Evite explicar a interface dentro da interface quando o proprio controle ja comunica a acao.

## Tokens de marca

- Azul principal: `#0f66f5`
- Azul escuro: `#0746b8`
- Azul claro de apoio: `#e9f1ff`
- Preto da marca: `#050608`
- Fundo: `#f5f7fb`
- Superficie: `#ffffff`
- Linhas: `#d9e1ee`
- Texto principal: `#111827`
- Texto secundario: `#667085`

No CSS, use sempre as variaveis em `dashboard/css/dashboard.css` antes de criar novas cores.

## Estrutura de pagina

1. Header com logo real da PJ Codeworks, area da pagina atual e status quando fizer sentido.
2. Navegacao horizontal logo abaixo, com a secao ativa em azul: Central, Conversas, Analises, Diagnostico IA, Configuracao.
3. A entrada do produto e sempre operacional: a Central deve mostrar primeiro filas de trabalho, prioridades e acoes rapidas.
4. Paginas secundarias existem para investigacao: Conversas aprofunda a lista, Analises mede performance, Diagnostico IA revisa gargalos.
5. Perfil do lead e pagina de decisao: identidade e acoes no topo, proxima decisao/funil antes de historico e IA.
6. Rodape discreto apenas para status de atualizacao, quando necessario.

## Arquitetura de UX

- Central: mostrar "o que fazer agora", nao apenas indicadores. Prioridade: falha de resposta, handoff, fila de preco, preco divergente e lead aguardando resposta.
- Conversas: lista completa, filtros e paginacao. Nao competir com a Central; serve para busca e varredura operacional.
- Perfil: concentrar contexto e decisao de um unico lead. A primeira dobra deve responder: quem e, qual o estado, qual a proxima acao.
- Analises: manter como area de gestao. Graficos e exportacao nao devem ocupar espaco da rotina do operador na Central.
- Configuracao: agrupar por finalidade, nao por ordem historica de implementacao.

## Componentes

- Botoes primarios: fundo azul, texto branco, raio 6px.
- Botoes secundarios: fundo branco, borda neutra, hover em azul claro.
- Badges: formato pill, fundo azul claro para informacao; cores semanticas para status.
- Campos: fundo `--painel`, borda `--linha`, foco azul com outline visivel.
- Tabelas: cabecalho fixo quando houver rolagem, linhas finas, fonte mono para dados operacionais.
- Modais: fundo branco, borda neutra, backdrop escuro translúcido, acoes alinhadas no fim.

## Checklist antes de criar ou alterar uma tela

- A pagina usa o logo em `/dashboard/assets/pj-codeworks-logo.png` no header?
- A acao principal aparece sem rolagem desnecessaria?
- O azul PJ esta reservado para acao, foco ou destaque real?
- Ha contraste suficiente em textos, badges e botoes?
- Os controles cabem no mobile sem texto quebrado de forma estranha?
- A tela parece parte do dashboard existente, e nao uma peca isolada?
- As novas classes reutilizam os tokens e componentes existentes antes de inventar variacoes?
