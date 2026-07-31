# Pendência Arquitetural — Integração entre Central de Ligações e Central de Mensagens

## Status

**Não implementar nesta fase.**

Esta pendência deve permanecer registrada até que a Central de Ligações
seja considerada validada funcionalmente.

## Motivo

Durante a validação foi identificado que existe uma discussão
arquitetural maior envolvendo Banco de Leads, Central de Ligações,
Central de Mensagens, identidade canônica, multi-tenant, normalização de
telefones e integração entre módulos.

Esses temas extrapolam o objetivo atual da validação.

## Decisão

Nesta fase focar apenas na validação completa da Central de Ligações.

## Gatilho

Quando a Central de Ligações for considerada validada, revisar
obrigatoriamente esta pendência antes de iniciar qualquer integração com
a Central de Mensagens.

## Checklist Futuro

- Revisar análises arquiteturais.
- Definir identidade canônica.
- Revisar estratégia multi-tenant.
- Unificar normalização de telefones.
- Definir contrato Ligações ↔ Mensagens.
- Só então implementar a integração.

## Instrução para IA

Quando o projeto entrar na fase de integração entre Ligações e
Mensagens, interrompa a implementação inicialmente e recupere esta
documentação para revisar toda a arquitetura antes de gerar código.
