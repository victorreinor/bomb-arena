# Bomb Arena

Jogo online de até 4 jogadores inspirado nos Super Bomberman do SNES. Arte e áudio são 100% originais, gerados por código.

**Jogue:** https://bomb-arena-ten.vercel.app. Crie uma sala e mande o link (ou o código de 5 letras) para os amigos, ou treine contra bots.

## Rodar localmente

```bash
bun install
bun run dev:server   # servidor de salas (Cloudflare Worker via wrangler) em :8787
bun run dev          # cliente (Vite) em :5173
```

Ou os dois de uma vez: `bun run dev:all`. Se a tela ficar em "Conectando…" ou mostrar erro de conexão, o servidor (porta 8787) não está rodando.

Abra `http://localhost:5173` em várias abas: cada aba é um jogador.

**Controles:**

| Ação | Teclado | Controle |
|---|---|---|
| Mover | WASD ou setas | direcional ou analógico |
| Bomba | Espaço ou Enter | A |
| Ação (soco, luva, detonar a remota) | Shift | B |
| Poder do pet | E ou / | Y |

No celular aparecem botões na tela. M liga e desliga a música, N os efeitos sonoros, e o ⚙️ tem volume, vibração e "reduzir movimento".

Na tela inicial, "Treinar contra bots" coloca você contra 3 bots (Fácil, Normal ou Difícil). Atalhos que só valem no modo local:

- `?itens=todos`: começa com vários itens e pets;
- `?pet=runner|jumper|pusher|kicker`: escolhe o pet;
- `?vinganca=1`: liga o modo vingança;
- `?tempo=<segundos>`: encurta o relógio para ver o sudden death.

## Comandos

| Comando | O que faz |
|---|---|
| `bun test packages` | Testes da engine e das salas |
| `bun run typecheck` | Checagem de tipos dos três pacotes |
| `bun run build` | Build do cliente |
| `bun run e2e [url]` | Teste ponta a ponta contra um servidor rodando (padrão: o local) |
| `bun run sprites` | Gera de novo os PNGs das sprites |

## Deploy (free tier)

1. **Servidor:** `cd apps/server && bunx wrangler login && bunx wrangler deploy`. Hoje ele está em `wss://bomb-arena-server.bombarena.workers.dev`.
2. **Cliente:** o repositório está ligado à Vercel, que publica a cada push na `master` (o `vercel.json` configura o build). A variável `VITE_SERVER_URL` aponta para o servidor.

Quando o protocolo muda, publique o servidor antes de fazer o push do cliente.

## Estrutura

- `packages/engine`: regras do jogo, salas, protocolo e bots (TypeScript puro, determinístico, testado)
- `apps/server`: Cloudflare Worker + Durable Object (uma sala = um objeto)
- `apps/web`: cliente em React + canvas
- `tools`: gerador de sprites e teste ponta a ponta
- `docs`: [ARCHITECTURE.md](docs/ARCHITECTURE.md) (como funciona), [DECISIONS.md](docs/DECISIONS.md) (por quê) e [ROADMAP.md](docs/ROADMAP.md) (o que falta)

Vai trabalhar no código com um agente de IA? As instruções estão em [CLAUDE.md](CLAUDE.md) (o [AGENTS.md](AGENTS.md) aponta para ele).
