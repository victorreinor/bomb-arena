# Bomb Arena

Jogo online de até 4 jogadores inspirado nos Super Bomberman 1–4 do SNES. Arte e áudio são originais, gerados por código. Está em produção:

- **Cliente:** https://bomb-arena-ten.vercel.app (Vercel publica sozinha a cada push na `master`)
- **Servidor:** `wss://bomb-arena-server.bombarena.workers.dev` (Cloudflare Worker + Durable Objects, publicado à mão)
- **Repositório:** github.com/victorreinor/bomb-arena

Leia também: `docs/ARCHITECTURE.md` (como funciona por dentro), `docs/DECISIONS.md` (por que foi feito assim) e `docs/ROADMAP.md` (o que está feito e o que falta).

## Idioma

- Fale com o usuário em **português do Brasil**. Textos da interface e os documentos em `docs/` também são em pt-BR.
- Código, comentários, nomes e mensagens de commit são em **inglês**.

## Comandos

Use Bun (`bun install`) e o Node do `.nvmrc` (24.21.0). Rode tudo a partir da raiz.

| Comando | O que faz |
|---|---|
| `bun run dev:all` | Servidor (wrangler, :8787) e cliente (Vite, :5173) juntos |
| `bun run dev` / `bun run dev:server` | Só o cliente / só o servidor |
| `bun run test` | Testes da engine, das salas e da predição do cliente (rodam em menos de 1 s) |
| `bun run typecheck` | `tsc` na engine, no cliente e no servidor |
| `bun run build` | Build de produção do cliente (é o que a Vercel roda) |
| `bun run e2e [ws://localhost:8787]` | Teste ponta a ponta contra um servidor rodando |
| `bun run bench:bots [seção…]` | Benchmark dos bots (~1,5 min): quanto cada nível erra, se defende e ataca, contra as metas em `tools/bot-bench.ts` |
| `bun run sprites` | Gera de novo os PNGs em `apps/web/public/sprites` e as figuras do README em `.github/readme` |
| `cd apps/server && bunx wrangler deploy` | Publica o servidor (quem roda é o usuário, veja abaixo) |

O cliente se conecta a `ws://<host>:8787`, a menos que `VITE_SERVER_URL` esteja definida (na Vercel ela aponta para o Worker). Atalhos que só valem no modo local: `?itens=todos`, `?pet=runner|jumper|pusher|kicker`, `?vinganca=1` e `?tempo=<segundos>`.

## Estrutura

- `packages/engine`: regras do jogo, salas, protocolo e bots, em TypeScript puro e determinístico. Servidor e cliente rodam o mesmo código.
- `apps/server`: o Worker roteia `/ws/<CÓDIGO>` para um Durable Object `Room` (uma sala por objeto), que roda o loop de 30 Hz.
- `apps/web`: React 19 + Vite + Canvas 2D. O React cuida das telas e do HUD; o jogo é desenhado num loop de `requestAnimationFrame`.
- `tools`: o gerador de sprites (`make-sprites.ts` com `bomber-art.ts`, `pet-art.ts`, `tile-art.ts` e `png.ts`), o `e2e.ts` e o `bot-bench.ts` (benchmark dos bots).
- `docs`: o roadmap, as decisões, a arquitetura e `sprites-feitas.html` (as três propostas de boneco; a escolhida foi a "Clássico").
- `.github/readme`: as figuras do README. As sprites ampliadas saem do `bun run sprites`; o `gameplay.gif` é a gravação de uma partida contra bots, refeita à mão quando o visual mudar muito.

## Regras que não podem quebrar

1. **A engine é pura e determinística.** Nada de DOM, rede, `Math.random()` ou `Date.now()` dentro das regras. O acaso vem de `state.rng` (mulberry32, `nextRandom`). O estado é JSON serializável.
2. **O servidor manda.** O cliente envia só comandos (`input`); o servidor simula e manda snapshots. O cliente só prevê o **próprio** boneco, e prevê rodando a mesma `stepPlayer`/`pickUp` da engine (`apps/web/src/game/predict.ts`). Nunca crie regra de jogo só no cliente.
3. **A lógica de sala fica na engine** (`packages/engine/src/room.ts`: `handleClientMessage`, `stepRoom`, `roomView`), onde dá para testar sem rede. O Durable Object só liga sockets a essas funções, controla os limites de mensagens e decide o que transmitir.
4. **Protocolo compatível nos dois sentidos.** Campo novo entra opcional, e cliente novo com servidor antigo precisa continuar funcionando, mesmo que perdendo o recurso novo (exemplo: sem `acks`, o cliente não prevê). Mexeu no protocolo? O servidor é publicado **antes** do push do cliente.
5. **Efeitos, sons e vibração são só do cliente.** Saem da diferença entre dois estados (`diffGame` em `game/events.ts`), e a engine nunca os lê. Pose de ação do boneco também é deduzida assim.
6. **O formato das folhas de sprite mora em `apps/web/src/game/sprites.ts`.** O gerador em `tools/` importa esse arquivo; não copie tamanhos nem ordens de quadros para outro lugar. Mexeu na arte? Rode `bun run sprites` e faça commit dos PNGs gerados.
7. **Algumas listas são exaustivas:** `POWERUP_KINDS`, `PET_KINDS` (`packages/engine/src/types.ts`), `MAP_IDS` (`packages/engine/src/maps.ts`) e `TILE_THEMES` (`apps/web/src/game/sprites.ts`). Para adicionar um item, um pet, um mapa ou um cenário, inclua-o na lista e rode `bun run typecheck`: os `Record<...>` que faltam viram erro e mostram tudo o que precisa ser preenchido (nomes, ícones, sons, arte, cenário). As receitas completas estão em `docs/ARCHITECTURE.md`.

## Como trabalhar com o usuário

- **Commit, push e deploy só quando o usuário pedir, e cada pedido vale uma vez.** Ao terminar uma tarefa, relate e pergunte se ele quer o commit e o push.
- **Commits:** Conventional Commits em inglês (`feat(engine): …`, `fix(web): …`, `docs: …`, `chore(tools): …`). O corpo explica o porquê. Código e docs vão em commits separados, como no histórico. A mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Deploy:** o push na `master` publica o cliente. O servidor quem publica é o usuário: quando `packages/engine` ou `apps/server` mudarem de um jeito que afete o servidor, mande para ele o comando `cd apps/server && bunx wrangler deploy` e lembre a ordem (servidor primeiro, depois o push). Mudança só no cliente não precisa disso.
- **Toda entrega atualiza `docs/ROADMAP.md`** (marcar `[x]`, criar itens novos) e, se houve decisão de projeto, **`docs/DECISIONS.md`**. Os dois em pt-BR.
- **Antes de entregar:** `bun run typecheck`, `bun run test` e `bun run build`. Mudança de jogo ou de visual se confere no navegador. Bug na engine se reproduz primeiro com um teste.
- **Servidores do usuário:** ele costuma deixar `bun run dev:all` rodando (5173 e 8787). Não derrube esses processos. Para conferir algo, suba um Vite seu em outra porta (`cd apps/web && bunx vite --port 5174`), aponte para o servidor 8787 que já está rodando e encerre só o que você abriu.
- **Sem arquivos soltos no repositório:** capturas de tela, simulações e scripts de teste vão para um diretório temporário fora do repo.
- **Só free tier.** Ainda não há banco de dados; o Supabase fica para contas e ranking (Fase 6). Antes de propor um serviço novo, confira o limite gratuito dele.
- **Nada de marca registrada:** não use "Bomberman" no nome público nem sprites ou sons oficiais da Hudson/Konami.
- Quando a mudança for grande ou tiver mais de um caminho, apresente um plano curto e espere o "pode seguir".

## Estilo de código

- TypeScript `strict`, ESM e Bun workspaces (`@bomb-arena/engine` é importado direto do código-fonte, sem build).
- Funções e constantes exportadas levam JSDoc curto (`/** … */`) explicando o que fazem e o porquê. Constantes ajustáveis têm nome e unidade no comentário (ticks, casas, ms) e ficam em `constants.ts` ou no topo do arquivo; nada de números mágicos.
- Comentários são poucos e explicam a intenção, não repetem o código. Imite o arquivo ao redor.
- Prefira estender o que já existe (`blastCells`, `solidFor`, `canPlaceAt`, `lerpPlayer`, `combineInputs`…) a criar cópias parecidas.
- Os testes ficam em `packages/engine/test/*.test.ts` e usam os helpers de `test/helpers.ts`: `makeGame` (mapa em ASCII), `corridor`, `testBomb`, `testFlame`, `run`, `send`, `startedMatch`, `pastCountdown` (partidas iniciadas pela sala começam com 2 s de "Pronto… Já!" em que ninguém anda) e `FLAWLESS` (um bot sem erros: nenhum nível joga sem errar, então teste da mecânica dos bots usa esse perfil, e não um nível). No cliente, só a predição e a reserva de reprodução têm testes (`apps/web/test`), com uma rede simulada (`loopback.ts`: a sala da engine faz de servidor, com atraso de ida e de volta); o resto se confere no navegador.
- No React, o estado do jogo fica fora do React (refs e o loop de frames). O HUD só atualiza quando algo visível muda (`hudKey`).
- O CSS fica todo em `apps/web/src/styles.css`. Animações respeitam `prefers-reduced-motion` e a classe `.reduce-motion` do `:root` (painel ⚙️).

## Armadilhas conhecidas

- Os snapshots não trazem `rng` nem `nextBombId`, e o tabuleiro (`tiles` e o chão especial, `floor`) só vem quando muda. Para o cliente que fala o protocolo 2 (`v=2` na conexão), jogadores e bombas vêm só com o que mudou (`changes`), completos uma vez por segundo. `fromSnapshot` remonta o estado com o último tabuleiro e o snapshot anterior. Cliente sem `v` recebe tudo completo, como antes.
- Os `acks` (`[seq, tick]` por jogador) só vêm quando mudam, e o cliente os acumula em `SnapshotBuffer.acks`. O `seq` começa em `Date.now()` para nunca ficar abaixo do de uma aba anterior.
- O Durable Object é criado fora da América do Sul (a Cloudflare não os hospeda lá), então a ida e volta a partir do Brasil leva ~140 ms. Por isso existem a predição e a reserva adaptável. Não "conserte" isso trocando de região.
- `bombAt` só devolve bombas que bloqueiam a casa: ignora as minas enterradas. Para saber se há qualquer bomba no chão (para não pôr outra em cima, por exemplo), use `groundBombAt`.
- A memória dos bots fica num `WeakMap` cuja chave é o `GameState`, e o dado aleatório deles é próprio: as escolhas dos bots não podem consumir `state.rng`. Para comparar níveis, rode `bun run bench:bots` e jogue contra eles; bot contra bot é só um indício.
- O workerd loga "Network connection lost" quando o servidor fecha uma conexão antes do cliente. Por isso o cliente desliga sozinho ao receber `error`, e o servidor só fecha depois de 1 s (`HANG_UP_GRACE_MS`). A resposta ao fechamento do cliente vem da flag `web_socket_auto_reply_to_close` do `wrangler.toml`: sem ela o navegador nunca dá a conexão por fechada. O `bun run e2e` ainda mostra o log, de propósito: o cliente dele não desliga sozinho, para testar o fechamento pelo servidor.
- Celular se confere emulando toque (`isMobile`/`hasTouch` no Puppeteer ou o modo dispositivo do DevTools): o layout do celular só liga com `pointer: coarse`, então uma janela estreita no computador não mostra ele. Teste em pé e deitado, e com a altura de um celular com a barra do navegador (~412x625).
- Captura de tela reduzida engana em pixel art (cores e contornos somem). Confira em tamanho real antes de concluir que a arte está errada.
- O teste que passa "à toa" já aconteceu: compare com o valor inicial, e não com zero (exemplo: `nextBombId`).

## Onde mexer

| Quero mudar… | Arquivo |
|---|---|
| Regras, física, explosões, itens, pets | `packages/engine/src/game.ts` (números em `constants.ts`) |
| Mapas | `packages/engine/src/maps.ts` + `apps/web/src/game/mapInfo.ts` |
| Chão especial (esteira, gelo, portal, lava) e caixotes | `packages/engine/src/game.ts` (seção "special floors"), `bot.ts` (`stepPath`, `dangerMap`), `apps/web/src/game/sprites.ts` (`drawFloor`), `tools/floor-art.ts` |
| Bots e níveis | `packages/engine/src/bot.ts` (`PROFILES`); mexeu, rode `bun run bench:bots` e compare com as metas (`TARGETS` em `tools/bot-bench.ts`) |
| Lobby, salas, série, mensagens | `packages/engine/src/room.ts` + `protocol.ts` |
| Loop do servidor, transmissão, limites | `apps/server/src/room.ts`, `apps/server/src/index.ts` |
| Partida online (rede, predição, buffer) | `apps/web/src/screens/OnlineGame.tsx`, `game/predict.ts`, `game/snapshots.ts`, `net/useRoom.ts` |
| Modo local e treino contra bots | `apps/web/src/game/LocalGame.tsx` |
| Desenho do tabuleiro e dos bonecos | `apps/web/src/game/render.ts`, `fire.ts`, `sprites.ts` |
| Partículas e tremor | `apps/web/src/game/effects.ts` |
| Sons, músicas e vibração | `apps/web/src/game/audio.ts` (síntese), `sfx.ts`, `haptics.ts` |
| Controles | `apps/web/src/game/input.ts` (teclado), `controls.ts` (gamepad, touch e combinação) |
| Telas | `apps/web/src/screens/` (`Home`, `Lobby`, `MapPicker`, `OnlineGame`) |
| Layout da partida (computador; celular em pé e deitado), menu ⚙️, tela cheia | `apps/web/src/game/GameFrame.tsx`, `screenMode.ts`, `styles.css` (seção "phones") |
| Arte | `tools/bomber-art.ts`, `tools/pet-art.ts`, `tools/tile-art.ts`, `tools/floor-art.ts`, `tools/make-sprites.ts` |
