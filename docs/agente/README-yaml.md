# Export YAML (Claude Agent)

Arquivo gerado: [`claude-agent.yaml`](claude-agent.yaml) — mesmo conteúdo de sistema que em [`prompt-completo-claude-agent.md`](prompt-completo-claude-agent.md) (a partir de `Voce e o assistente`), no formato próximo ao do Agent no Claude (nome, modelo, `system`, tools).

## Regenerar após editar o prompt

No PowerShell, na raiz do repositório:

```powershell
$py = @'
import pathlib
p = pathlib.Path("docs/agente/prompt-completo-claude-agent.md")
t = p.read_text(encoding="utf-8").splitlines()
i = next(j for j, l in enumerate(t) if l.startswith("Voce e o assistente"))
body = "\n".join(t[i:])
ind = "\n".join("  " + l for l in body.split("\n"))
y = """# Gerado a partir de prompt-completo-claude-agent.md — regenere com o comando em docs/agente/README-yaml.md

name: \"Agente de Vendas PJ Codeworks\"
description: >-
  Assistente de vendas consultivo da PJ Codeworks para atendimento de leads via WhatsApp.
model:
  id: claude-sonnet-4-6
  speed: standard
mcp_servers: []
tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: true
      permission_policy:
        type: always_allow
    configs: []
skills: []
metadata:
  fonte: docs/agente/prompt-completo-claude-agent.md
system: |-
""" + ind + "\n"
pathlib.Path("docs/agente/claude-agent.yaml").write_text(y, encoding="utf-8")
print("OK", len(y))
'@
Set-Content -Path docs\agente\_tmp_gen_yaml.py -Value $py -Encoding utf8
python docs\agente\_tmp_gen_yaml.py
Remove-Item docs\agente\_tmp_gen_yaml.py
```

Depois importe ou cole o YAML no produto que aceitar (estrutura pode precisar de pequenos ajustes conforme a API do Claude).
