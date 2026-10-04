# Bomb Arena

Jogo online de até 4 jogadores inspirado nos Super Bomberman do SNES. Arte e áudio 100% originais (gerados por código).

## Rodar localmente

```bash
bun install
bun run dev:server   # servidor de salas (Cloudflare Worker via wrangler) em :8787
bun run dev          # cliente (Vite) em :5173
```

Ou os dois de uma vez: `bun run dev:all`. Se a tela ficar em "Conectando…" / mostrar erro de conexão, o servidor (porta 8787) não está rodando.

Abra `http://localhost:5173` em várias abas: cada aba é um jogador. Controles: WASD/setas para mover, Espaço/Enter para bomba, Shift para a ação (soco, luva, detonar remota), E (ou /) para o poder do pet. Também funciona com controle (A bomba, B ação, Y pet) e, no celular, com os botões na tela. No modo local: `?itens=todos` começa com vários itens e pets, `?pet=runner|jumper|pusher|kicker` escolhe o pet, `?vinganca=1` liga o modo vingança, `?tempo=<segundos>` encurta o relógio para ver o sudden death. Na tela inicial, "Treinar contra bots" joga você contra 3 bots. M liga/desliga a música, N os efeitos sonoros.

Outros comandos: `bun test packages` (engine + salas), `bun run typecheck`, `bun run e2e` (smoke test contra o servidor local), `bun run sprites` (regenera os PNGs).

## Deploy (free tier)

1. **Servidor** — `cd apps/server && bunx wrangler login && bunx wrangler deploy`. Anote a URL `https://bomb-arena-server.<sub>.workers.dev`.
2. **Cliente** — importe o repositório na Vercel (raiz do repo; o `vercel.json` já configura o build) e defina a variável `VITE_SERVER_URL=wss://bomb-arena-server.<sub>.workers.dev`.

## Estrutura

- `packages/engine` — regras do jogo, salas e protocolo (TypeScript puro, testado)
- `apps/server` — Cloudflare Worker + Durable Object (uma sala = um objeto)
- `apps/web` — cliente React + canvas
- `docs/` — `ROADMAP.md` (o que falta) e `DECISIONS.md`
