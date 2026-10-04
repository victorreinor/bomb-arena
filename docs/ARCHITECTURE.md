# Arquitetura

Este documento explica como as partes se encaixam. As decisões (o porquê) estão em `DECISIONS.md`; o que falta fazer está em `ROADMAP.md`.

## Visão geral

```
 navegador (apps/web)                     Cloudflare (apps/server)
 ┌──────────────────────────┐   input      ┌──────────────────────────────────┐
 │ teclado/gamepad/touch    │──(seq)──────▶│ Worker: /ws/<CÓDIGO>, limite/IP  │
 │ Predictor (próprio boneco)│             │   └─▶ Durable Object Room        │
 │ SnapshotBuffer (o resto) │◀── room ─────│       handleClientMessage        │
 │ render canvas + efeitos  │◀── state ────│       stepRoom a 30 Hz (engine)  │
 └──────────────────────────┘ (snapshot +  └──────────────────────────────────┘
                               acks)
                 packages/engine: o mesmo código nos dois lados
```

- Uma sala é um Durable Object, cujo nome é o código da sala (5 letras sem vogais). O estado vive só em memória e a sala some quando fica vazia.
- O servidor é autoritativo. O cliente manda só comandos e desenha o que o servidor diz, exceto o próprio boneco, que ele prevê com o mesmo código da engine.
- O modo local (dois jogadores no mesmo teclado ou treino contra bots) roda a engine direto no navegador, sem servidor.

## packages/engine

TypeScript puro, sem dependências. Determinístico: o mesmo estado e os mesmos comandos dão o mesmo resultado.

| Arquivo | Conteúdo |
|---|---|
| `types.ts` | `GameState`, `Player`, `Bomb`, `PowerUp`, `Input`; listas `POWERUP_KINDS`, `PET_KINDS`; `ABILITY_FIELDS` (item de habilidade → campo do jogador); `TILE` (com o caixote, `CRATE`) e `FLOOR` (chão especial de cada casa: gelo, lava, esteira por direção em `BELT_DIRS`, portal por par) |
| `constants.ts` | Todos os números ajustáveis: `TICK_RATE` 30, pavio, alcance, velocidades, pesos de drop, recargas dos pets |
| `maps.ts` | Mapas em ASCII de qualquer tamanho (`#` pedra, `+` tijolo, `o` tijolo sorteado por `softDensity`, `.` livre, dígitos = início; as vagas são os inícios, `mapSeats`; `=` caixote, `~` gelo, `*` lava, `^ > v <` esteira, `A`–`D` portais, cada letra duas vezes), `MAPS`, `MAP_IDS`, `SPAWN_ORDER` |
| `game.ts` | `createGame`, `step` (um tick), `stepPlayer`, `pickUp`, bombas (perfurante, de borracha, minas: `isBuried`, `bombAt` só vê as que bloqueiam, `groundBombAt` vê também as enterradas), explosões, chute/soco/luva, quique na cabeça, pets, vingança, sudden death, ranking |
| `room.ts` | Sala: membros, anfitrião, cor, pronto, vagas, bots, opções, série/placar, reconexão (10 s), `handleClientMessage`, `stepRoom`, `inputAcks`, `roomView` |
| `protocol.ts` | Mensagens `ClientMsg`/`ServerMsg`, `RoomView`, `toSnapshot`/`fromSnapshot` (com as mudanças do protocolo 2), `PROTOCOL_VERSION`, códigos de sala |
| `bot.ts` | Mapa de perigo (`dangerMap`, com a lava 2 s antes de explodir), decisão (`botInput`), caminhos (`explore`, que já desliza no gelo e atravessa portais, `stepPath`), níveis em `PROFILES` |
| `rng.ts` | mulberry32 (`nextRandom`, `randomSeed`) |
| `ratelimit.ts` | `TokenBucket` (limite de mensagens e de conexões) |

### Um tick (`step`)

0. Durante a contagem "Pronto… Já!" (`tick <= goTick`), o passo para aqui: ninguém anda e o relógio espera.
1. Cada jogador vivo roda `stepPlayer`: timers (invulnerabilidade, maldição, recarga do pet); se está no ar (salto) ou tonto, para aí; depois os botões (ação, bomba, pet) e o movimento (com deslize nas quinas; no gelo, sem virar enquanto desliza; andando contra um caixote, o empurrão), a esteira (`rideBelt`) e o portal (`takePortal`). Fantasmas andam pela borda (`stepGhost`).
2. Bombas andam (chutadas, voando, quicando; a de borracha volta quando bate; pelos portais), as esteiras levam bombas e itens (a cada `BELT_CARRY_TICKS`), minas enterradas em que um adversário pisou (ou em que uma bomba chutada bateu) disparam, as chamas queimam, a lava explode quando o ciclo volta a zero (`ventCycle`), o sudden death derruba blocos.
3. Pavios descontam; as bombas que zeram explodem em cadeia.
4. Para quem está no chão: fogo na casa tira o pet, depois o colete, senão elimina (com o crédito para o dono da chama, `Player.death`); em seguida `pickUp` pega o item da casa.
5. A caveira passa por contato; com um vivo ou nenhum, a partida termina.

`stepPlayer` e `pickUp` são exportadas porque o cliente as usa para prever o próprio boneco. Qualquer mudança nelas vale para os dois lados automaticamente.

### Sala (`room.ts`)

`RoomState` guarda membros (`Member`, com `bot: BotLevel | null`), anfitrião, opções (mapa, vagas, vingança, melhor de N, tempo), placar, o jogo em andamento (`game`) e os comandos atuais de cada jogador (`inputs`, com `seq` e `since`). `stepRoom` remove quem passou dos 10 s desconectado, pede comandos aos bots, roda `step`, apaga os botões (eles valem um tick só) e, no fim da partida, conta pontos e volta ao lobby após 10 s de pódio. Quem entra com a partida em andamento assiste e joga a próxima (`inGame: false`).

## apps/server

- `index.ts`: o Worker. Aceita só `/ws/<CÓDIGO>?pid=&name=&create=1&max=`, limita conexões por IP (por instância) e encaminha ao Durable Object do código.
- `room.ts`: a classe `Room`. Usa WebSockets simples (sem hibernação, porque o loop precisa ficar vivo) e um loop de passo fixo de 33 ms que recupera até 5 ticks atrasados. Por conexão, aplica limite de 40 msg/s com rajada de 80 e mensagens de no máximo 512 bytes. O que transmite:
  - `room` (`RoomView`) quando algo visível do lobby muda;
  - `state` a cada tick com partida (montado pelo `SnapshotStream` da engine, que guarda o que já foi enviado): o snapshot sem `rng`/`nextBombId` e sem o dono de cada chama, `tiles` só quando o tabuleiro muda ou alguém chega, `acks` só dos jogadores cujo comando mudou e, durante o pódio, 1 por segundo. Quem conectou com `v=2` recebe jogadores e bombas só com o que mudou desde o snapshot anterior (`changes`: por jogador, os campos que mudaram ou `null`; por bomba, pelo id, os campos que mudaram ou a bomba inteira se é nova), e tudo completo uma vez por segundo, quando alguém chega e a cada rodada. Quem não mandou `v` recebe tudo completo. Cada forma só é montada se alguém precisa dela.
- Fechar conexão: o servidor manda `error` e espera 1 s para o cliente desligar (`hangUp`); se ele não desligar, fecha. Quando o cliente fecha, o workerd responde sozinho (flag `web_socket_auto_reply_to_close` no `wrangler.toml`). Fechar primeiro faz o workerd logar "Network connection lost", e sem resposta o navegador nunca dá a conexão por fechada.
- Responde `ping` com `pong` na hora, sem passar pela engine (o cliente mede a ida e volta). Quem deixa de ser membro com a conexão aberta (tirado pelo anfitrião) recebe o erro `removed` antes de ser desligado.
- `wrangler.toml`: binding `ROOM` e migração SQLite (a única opção de DO no plano grátis).

## apps/web

### Telas

`App.tsx` alterna entre `Home` (criar sala, entrar por código ou link `?sala=`, treinar contra bots, jogo local), `Lobby` (jogadores, cor, bots, carrossel de mapas `MapPicker`, opções), `OnlineGame` e `LocalGame`. As duas telas de partida desenham dentro de `game/GameFrame.tsx`: no computador, título, jogadores, tabuleiro e dicas de teclas; no celular, uma tela inteira em pé ou deitada, com o tabuleiro no maior tamanho que cabe (só CSS, por container queries), os controles de toque, o botão de girar/tela cheia (`screenMode.ts`) e o menu ⚙️ com som, ajustes e "Sair". O layout em si (áreas da grade em pé e deitado) está em `styles.css`, seção "phones"; textos só de teclado ou só de celular usam as classes `desktop-only` e `phone-only`. `net/useRoom.ts` abre o WebSocket (dizendo a versão do protocolo, `v`), reconecta com espera crescente, desliga sozinho quando recebe `error` e entrega `room`, o `SnapshotBuffer` e `send`. O id do jogador é por aba (`sessionStorage`).

### Um quadro da partida online (`OnlineGame.tsx`)

1. Lê os controles (`combineInputs`: teclado, gamepad, touch). Se mudou, ou se o relógio ainda não está alinhado (a cada 250 ms), envia `input` com um `seq` novo (`Predictor.record`).
2. `buffer.sample(now)` dá o estado interpolado da reprodução (alguns ticks no passado) e o snapshot mais novo.
3. `buffer.takePlayed()` entrega os snapshots que a reprodução acabou de alcançar; `diffGame(anterior, atual)` vira eventos; `PredictedView.withoutOwn` tira os que já tocamos pela predição; os eventos vão para som (`sfx.ts`), partículas (`effects.ts`) e vibração (`haptics.ts`).
4. `Predictor.predict` refaz o próprio boneco a partir do snapshot mais novo; `PredictedView.apply` põe o boneco previsto, as bombas recém-plantadas e esconde os itens já pegos no estado da reprodução, gerando os eventos locais (bomba plantada, item pego) na hora.
5. `render` desenha; o HUD do React só atualiza quando algo visível muda (`hudKey`).

### Reserva de reprodução (`snapshots.ts`)

`SnapshotBuffer` remonta cada snapshot sobre o anterior (o tabuleiro e, no protocolo 2, as mudanças de jogadores e bombas; até um snapshot velho demais para mostrar serve de base para o seguinte), guarda até 30 e reproduz `delay` ticks atrás do mais novo, interpolando posições (`lerpState`/`lerpPlayer`: andar, bombas deslizando, arcos de voo). O `delay` se ajusta entre 1 e 3 ticks: mede o atraso de cada snapshot contra a agenda de ticks do servidor e cobre o percentil 90.

### Predição (`predict.ts`)

- O servidor responde, por jogador, `[seq, tick]`: qual comando está valendo e desde que tick. Isso dá a diferença entre o relógio local e os ticks do servidor (`offset`, média móvel).
- `Predictor.replay` clona o snapshot mais novo e reaplica nele os comandos ainda não confirmados, cada um no tick em que vai chegar ao servidor, usando `stepPlayer` e `pickUp`. O resultado fica em cache até mudar o tick inteiro, chegar snapshot ou sair comando novo. Também devolve as bombas do jogador e os itens pegos (`taken`, `reaching`).
- `PredictedView` suaviza correções (~80 ms; acima de 1,5 casa, pula), parte de onde o boneco estava desenhado quando a predição liga e mantém escondidos os itens pegos até a reprodução alcançar.
- Sem `acks` (servidor antigo) ou fora da partida, não há predição e tudo vem da reprodução.

### Desenho, efeitos e som

- `render.ts`: escala 3x, tabuleiro com o cenário do mapa (`mapInfo(id).theme`) e os chãos especiais (gelo, crateras de lava e caixotes na imagem do tabuleiro; esteiras, portais e o brilho da lava a cada quadro), sombras, itens, bombas, chamas (`fire.ts`, procedurais), bonecos com pet em duas camadas (corpo atrás, cabeça na frente), poses de ação, fantasmas e efeitos.
- `effects.ts`: partículas, ondas de choque, tremor e clarão a partir dos eventos; "reduzir tremor e clarão" no painel ⚙️.
- `audio.ts`: todo o som é sintetizado com Web Audio (músicas e efeitos, sem arquivos), com volume e mudo por canal salvos no navegador. `sfx.ts` traduz eventos em efeitos; `musicFor` escolhe a música pelo estado.
- `haptics.ts`: padrões de vibração por evento (`navigator.vibrate`), com opção de desligar.
- `settings.ts`: preferências de conforto salvas no navegador (vibração, reduzir movimento).

## Pipeline de arte (`tools/`)

`bun run sprites` gera os PNGs em `apps/web/public/sprites` (commitados):

| PNG | Gerado por | Formato (em `sprites.ts`) |
|---|---|---|
| `tiles-<tema>.png` (garden, snow, temple, factory, assembly, space, ice, warehouse, volcano) | `tile-art.ts` | 8 células 16x16: `TILE_SHEET` |
| `floor.png` | `floor-art.ts` | linha 0: `FLOOR_CELLS` (gelo, lava fria e quente, caixote) e `BELT_FRAMES` da esteira indo para a direita (girada para as outras); depois uma linha por par de portal (`PORTAL_COLORS`), `PORTAL_FRAMES` colunas |
| `bomber-<cor>.png` | `bomber-art.ts` | 16x24, linhas `BOMBER_VIEWS`, colunas `BOMBER_FRAMES` |
| `bomber-emotes-<cor>.png` | `bomber-art.ts` | `BOMBER_EMOTES` (pódio) |
| `pets.png` | `pet-art.ts` | células 20x20, uma linha por `PET_KINDS`, colunas `petColumn` |
| `powerups.png`, `favicon.png` | `make-sprites.ts` | 16x16, ordem de `POWERUP_KINDS` |
| `bomb.png` | `make-sprites.ts` | 16x16, uma linha por `BOMB_LOOKS` (comum, perfurante, borracha, mina; `bombLook` escolhe), `BOMB_PULSE_FRAMES` colunas |
| `icon-180/192/512.png` | `make-sprites.ts` | ícones do app instalado (iOS e `public/manifest.webmanifest`) |

- O boneco é montado com carimbos ASCII (cabeça por direção, tronco, braços e pernas por pose), cada um com contorno próprio. Quadros virados para a esquerda são os da direita espelhados na hora de desenhar.
- Os pets são formas sombreadas em camadas; os cenários usam `THEME_COLORS` (também usadas nos destroços) e `nextRandom`, então o resultado é sempre igual.
- `png.ts` tem `Img`, `fromAscii`, `hex`, `mix`, `shade`, `lighten` e um codificador PNG próprio (sem dependências).
- Qualquer PNG pode ser trocado por arte feita à mão, desde que mantenha o formato.

## Receitas

**Novo item (power-up)**
1. `POWERUP_KINDS` em `packages/engine/src/types.ts` e peso em `POWERUP_WEIGHTS` (`constants.ts`). Se for uma habilidade liga/desliga, basta o campo no `Player` e a entrada em `ABILITY_FIELDS`; se não, o efeito vai em `applyPowerUp` (`game.ts`).
2. `bun run typecheck` aponta o resto: `ITEM_INFO` (`apps/web/src/game/items.ts`) e `ICONS` (`tools/make-sprites.ts`).
3. `bun run sprites`, testes em `packages/engine/test/`, publicar o servidor (as regras mudaram).
4. Se for um tipo de bomba: a marca no `Bomb` (posta em `newBomb`), a aparência em `BOMB_LOOKS`/`bombLook` (`sprites.ts`) e o desenho em `bombFrame` (`make-sprites.ts`); o alcance que os bots esperam sai de `blastCells`.

**Novo mapa**
1. `MapDef` em `packages/engine/src/maps.ts` (o `build` faz a borda, os pilares e os bolsões de início, em qualquer tamanho e com os cantos de início que você escolher), entrada em `MAPS` e `MAP_IDS`. Os testes conferem a borda, os inícios nos cantos e que o mapa é todo conectado; o número de inícios é o de vagas.
2. `MAP_INFO` em `apps/web/src/game/mapInfo.ts` (nível, descrição, música, cenário). Publicar o servidor.

**Novo cenário**: `TILE_THEMES` e `THEME_COLORS` em `apps/web/src/game/sprites.ts`, um `TileSet` em `tools/tile-art.ts`, `bun run sprites`.

**Novo chão especial**
1. Um código em `FLOOR` (`types.ts`) e o caractere dele em `floorCode` (`game.ts`) e na documentação de `MapDef.rows`.
2. A regra: se mexe em quem anda, dentro de `stepPlayer` (assim a predição acerta sozinha); se mexe em bombas, itens ou no tempo, em `step`. Se depende do tempo, uma função do `tick` (como `ventCycle`) evita guardar estado.
3. Os bots: perigo em `dangerMap`; mudança de caminho em `stepPath`.
4. O desenho em `drawFloor` (`sprites.ts`) e `floor-art.ts`; parado vai para a imagem do tabuleiro (`stillFloor` em `render.ts`), animado é desenhado a cada quadro. Eventos e sons em `events.ts`.
5. Testes em `packages/engine/test/floors.test.ts`, um mapa que use a mecânica e publicar o servidor.

**Novo pet**: `PET_KINDS`, `PET_COOLDOWN_TICKS` e o poder em `usePet` (`game.ts`); depois `PET_INFO`, `PET_SOUND` e o desenho em `tools/pet-art.ts` (o typecheck aponta cada um).

**Nova mensagem ou opção de sala**
1. Variante em `ClientMsg` (`protocol.ts`), campo opcional em `RoomView` se o lobby precisar mostrar.
2. Função em `room.ts` que valida (quem pode, valores aceitos) e o `case` em `handleClientMessage`.
3. Teste em `packages/engine/test/messages.test.ts` ou `room.test.ts`; interface no `Lobby.tsx`.
4. Publicar o servidor antes do push do cliente.

## Verificação

- `bun run test`: regras, salas, mensagens, pets, vingança, sudden death, série e bots (`packages/engine/test`, helpers em `test/helpers.ts`), mais a predição e a reserva de reprodução do cliente (`apps/web/test`). Os testes do cliente rodam o quadro do `OnlineGame` (sem desenho) contra uma sala da engine numa rede simulada (`loopback.ts`, com atraso de ida, de volta e snapshots atrasados) e conferem o que o jogador veria: o boneco responde na hora, nunca fica mais de um tick de caminhada longe do servidor e termina exatamente onde o servidor diz; bombas e itens aparecem e somem uma vez só.
- `bun run e2e`: abre conexões reais contra o servidor local (criar, entrar, cheio, iniciar, comandos e `acks`, bots, sair).
- No navegador: `bun run dev:all` e várias abas (cada aba é um jogador). Para simular rede ruim, use o throttling do DevTools.
