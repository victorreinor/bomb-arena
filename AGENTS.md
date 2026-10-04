# AGENTS.md

As instruções para agentes de código deste repositório (Claude Code, Codex, Cursor, Gemini, Copilot e outros) estão em **[CLAUDE.md](CLAUDE.md)**. Leia esse arquivo inteiro antes de mudar qualquer coisa: as regras valem para qualquer agente, não só para o Claude. Ele é a fonte única, então não copie o conteúdo para cá.

Depois dele, conforme a tarefa:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): como o jogo funciona por dentro e as receitas para adicionar itens, mapas, pets e mensagens.
- [docs/DECISIONS.md](docs/DECISIONS.md): por que cada coisa foi feita do jeito que está.
- [docs/ROADMAP.md](docs/ROADMAP.md): o que está pronto e o que falta.

Resumo do essencial:

- Responda em português do Brasil; o código e os commits são em inglês.
- Antes de entregar, rode `bun run typecheck`, `bun run test` e `bun run build`.
- Faça commit, push ou deploy só quando o usuário pedir.
