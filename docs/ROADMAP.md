# Roadmap

Legenda: `[x]` feito · `[ ]` pendente. Atualizar a cada entrega.

## Próximos passos (análise de 04/10/2026, em ordem de prioridade)
Tamanho: P pequeno · M médio · G grande. 🖥️ = mexe na engine ou no protocolo: publicar o servidor antes do push.

**Próxima rodada: sensação de jogo e celular**
- [ ] Contagem "Pronto… Já!" de ~2 s no início da partida antes de liberar os controles (dá tempo de achar o boneco e de a predição alinhar o relógio antes do primeiro passo) — M 🖥️
- [ ] Marcador do próprio boneco ("você"/setinha nos primeiros segundos) e número de cada jogador sobre o boneco (ajuda no celular e para daltônicos) — P
- [ ] Bomba pulsando mais rápido conforme o pavio acaba (hoje pulsa sempre no mesmo ritmo) — P
- [x] Partida no celular, em pé e deitado: em pé, jogadores numa linha só (seu card com contorno), tabuleiro de borda a borda e controles embaixo; deitado, jogadores e direcional à esquerda, tabuleiro com a altura toda, relógio e botões à direita. O tabuleiro sempre pega o maior tamanho que cabe. Som, ajustes e "Sair" num menu ⚙️ durante a partida (os botões flutuantes cobriam o relógio e o Sair). Treino contra bots ganhou botão de sair
- [x] Botão "⟳ Deitar" / "⛶ Tela cheia" na partida: tela cheia e trava na horizontal mesmo com a rotação automática desligada (Android)
- [x] "Deitar" no iPhone, que não deixa travar a tela: o jogo gira dentro da página (funciona com o bloqueio de rotação ligado; "⟲ Em pé" volta). Uma dica única ensina a segurar e a instalar na tela inicial para tirar as barras do Safari
- [x] Tela parada durante a partida: sem rolar, sem zoom (pinça ou toque duplo), sem "puxar para recarregar", sem seleção de texto ou lupa ao segurar os botões no iPhone. Fora da partida: toque duplo não dá zoom, campos com 16 px (o iPhone dava zoom ao digitar) e o texto não aumenta sozinho deitado
- [x] Instalar na tela inicial (PWA: manifesto, ícones gerados pelo `bun run sprites`): abre em tela cheia, como um app. Sem service worker por enquanto (nada fica em cache, então nunca roda versão velha)
- [ ] Conferir: trocar de aba ou de app segurando uma direção talvez deixe o boneco andando no servidor (o teclado zera no `blur`, mas o loop para com a aba escondida e o comando "parado" pode não sair); se confirmar, mandar o comando parado ao esconder a aba — P
- [ ] Indicador de conexão no HUD (ping; amarelo/vermelho quando piora), para saber se uma travada é a rede — P

**Depois: social**
- [ ] Quem matou quem: "fulano explodiu beltrano" e estatísticas no pódio (abates, itens pegos). Fazer junto com o item da dívida técnica "a engine registrar quem fez cada ação" — M 🖥️
- [ ] Anfitrião remover uma pessoa da sala (hoje só remove bots; com o link circulando pode entrar alguém indesejado) — P 🖥️
- [ ] Emotes rápidos: 4 reações fixas (😂 😡 👍 GG) num balão sobre o boneco, sem chat livre (nada a moderar) — M 🖥️
- [ ] Replay do final: no pódio, rever os últimos ~5 s em câmera lenta, com os snapshots que o cliente já recebeu (sem mudar o servidor) — M

**Depois: conteúdo**
- [ ] Batalha em duplas (2 contra 2, pessoas ou bots), com fogo amigo opcional — M 🖥️
- [ ] Bombas novas, uma por vez pela receita de item: perfurante (atravessa vários tijolos), de borracha (quica nas paredes), mina (fica invisível) — P–M cada 🖥️
- [ ] Começar a Fase 5 por um mapa só: esteiras (ou teletransportes), com cenário próprio — M–G 🖥️

**Quando der: proteção**
- [ ] Testes para `predict.ts` e `snapshots.ts` (o código mais delicado do cliente; roda com `bun test`, sem navegador) — P–M
- [ ] CI no GitHub Actions: typecheck, testes e build a cada push, antes de a Vercel publicar — P
- [ ] Aviso de erros em produção (Sentry ou similar, plano grátis; conferir limites antes) — P

**Para depois, se fizer sentido**
- [ ] Salas públicas / "partida rápida" (só vale com desconhecidos jogando; precisa de um diretório de salas, outro Durable Object) — G 🖥️
- [ ] Escolher as teclas e mudar tamanho/posição dos botões de toque (modo canhoto) — P

Também na fila, já listados nas fases abaixo: bots usarem pets e itens especiais (Fase 6), balancear drops e pets com playtests (Fases 3 e 4), contas/ranking com Supabase (Fase 6).

## Fase 1 — Núcleo local
- [x] Engine determinística (`packages/engine`): grade 15x13, movimento com deslize em quinas, bombas, explosões em cadeia, blocos moles, flames com braços
- [x] Power-ups básicos: bomba+, fogo+, velocidade
- [x] Morte, vitória, empate
- [x] Mapa clássico (blocos moles aleatórios por seed)
- [x] Testes da engine (`bun test packages`)
- [x] Sprites originais geradas por script (`bun run sprites`): bomber x4 cores, blocos, bomba, power-ups
- [x] Boneco novo (estilo "Clássico" escolhido entre três propostas): 16x24, com braços, luvas e botas, e poses de andar, chutar, socar, arremessar, carregar, plantar, montado, tonto e atingido; pódio redesenhado
- [x] Um cenário por mapa, com profundidade (face de cima, face da frente, sombra no chão) e variações de chão: Clássico no Jardim, Campo Aberto na Neve, Labirinto no Templo, Quadrantes na Fábrica; a prévia do lobby e os destroços seguem o cenário
- [x] Animações na interface: carrossel de mapas deslizando para o lado certo, botões que afundam ao clicar, telas e cartões entrando suavemente, jogadores e estados do lobby com animação; tudo respeita "reduzir movimento"
- [x] Cliente canvas + modo local 2 jogadores no mesmo teclado (`bun run dev`)
- [x] Conferido no navegador pelo usuário

## Fase 2 — Online + salas
- [x] `apps/server`: Cloudflare Worker + Durable Object `Room` (WebSocket, tick 30 Hz)
- [x] Protocolo cliente↔servidor (inputs → snapshots; lobby → `RoomView`)
- [x] Criar sala / entrar por código (5 letras) ou link `?sala=CODIGO` (o link abre uma tela de convite só com nome + "Entrar na sala"), até 4 jogadores
- [x] Lobby: escolher cor (única por sala), pronto, anfitrião escolhe mapa e inicia
- [x] Vagas da sala (2–4) escolhidas ao criar; o anfitrião pode mudar no lobby (nunca abaixo de quem já entrou)
- [x] Escolha do mapa em carrossel (◀ ▶, setas do teclado, bolinhas) com prévia desenhada (pilares, tijolos, pontos de início) e informações
- [x] Lobby em duas colunas (jogadores/cor | mapa/opções), opções em linhas compactas e botão de iniciar fixo: cabe sem rolar no desktop
- [x] Partida em andamento → entrante assiste e entra na próxima
- [x] Reconexão (10 s de tolerância; depois é eliminado/removido); anfitrião migra
- [x] Interpolação no cliente (buffer de snapshots)
- [x] 3 mapas novos: Campo Aberto (simples), Labirinto e Quadrantes (complexos); teste garante que todos são conectados
- [x] Efeitos sonoros (bomba, explosão, power-up, morte, vitória/derrota) e músicas distintas (lobby leve / batalha acelerada e sombria), sintetizados; botões separados para música (M) e efeitos (N), salvos no navegador
- [x] Teste e2e (`bun run e2e`) e fluxo de 3 abas verificado em Chrome headless
- [x] **Deploy**: cliente na Vercel (https://bomb-arena-ten.vercel.app, publica a cada push na `master`) e servidor na Cloudflare (`wss://bomb-arena-server.bombarena.workers.dev`, publicado com `bunx wrangler deploy`)
- [x] Predição de movimento no cliente: o próprio boneco anda, planta bomba e usa o pet na hora (antes esperava a ida e volta ao servidor, ~140 ms do Brasil); correções do servidor são suavizadas
- [x] Reserva de reprodução que se ajusta à rede (1 a 3 ticks, antes 2 fixos) e vibração no celular (toque nos botões, bomba, item, golpe, morte; dá para desligar no ⚙️)
- [x] Placar da sessão (🏆 por jogador) e série "melhor de 3 / 5" escolhida pelo anfitrião, com campeão anunciado
- [x] Sair da sala na hora (lobby e partida), sem esperar os 10 s de reconexão; o servidor encerra a conexão de quem sai
- [x] Proteção contra abuso: limite de mensagens por conexão (40/s, corta quem insiste) e de conexões por IP no Worker (por instância)
- [ ] Limite global de salas/conexões (precisaria de estado compartilhado entre instâncias)
- [x] Snapshots menores: o tabuleiro só vai quando muda (ou chega alguém), sem `rng`/`nextBombId`, e 1 por segundo durante o pódio
- [ ] Encolher também os dados dos jogadores (campos estáticos mandados a cada tick)
- [ ] Engine emitir os eventos (pegou item, chutou, morreu...) em vez de o cliente deduzir comparando estados; hoje pegar um item já no máximo não gera som/efeito
- [ ] Investigar o log "Uncaught Error: Network connection lost" do wrangler a cada entrada recusada (sala inexistente/cheia/código repetido). O cliente recebe o erro e o fechamento certos; testado: não é quem fecha nem falta de listeners.

## Correções
- [x] Botão de ação (Shift) não chegava ao servidor no modo online (soco, luva, arremesso e remota só funcionavam no modo local). Mensagens do cliente agora são tratadas na engine (`handleClientMessage`), com testes.
- [x] O boneco dava um "pulo" no primeiro passo da partida: agora o relógio se alinha com o servidor antes de você se mexer, e a predição começa de onde o boneco estava desenhado
- [x] O item só sumia (com som e efeito) um tempo depois de você passar por cima: agora a predição pega o item no quadro em que o boneco entra na casa

## Documentação
- [x] `CLAUDE.md` (guia para agentes de IA: comandos, regras, fluxo de trabalho, armadilhas), `AGENTS.md` apontando para ele e `docs/ARCHITECTURE.md` (como funciona por dentro e receitas)

## Dívida técnica (da revisão de código; nenhuma urgente)
- [ ] Uma só mensagem `settings` para as opções do lobby (hoje uma por opção) — fazer quando entrar a próxima opção
- [ ] Modo local rodando pela lógica de sala (bots, série e nomes iguais ao online) — fazer se o modo local ganhar opções de sala
- [ ] Separar no tipo os campos que o servidor não envia (`rng`, `nextBombId`). A predição já saiu e contorna isso recalculando `nextBombId` pelas bombas; fazer quando o protocolo mudar de novo
- [ ] A engine registrar quem fez cada ação (chute, soco, arremesso, bomba plantada), por exemplo `Player.action = { kind, tick }`. Hoje o cliente deduz pela posição para escolher a pose do boneco; com o registro, a pose sai do estado e dá para creditar abates ("fulano explodiu beltrano"). Muda o protocolo: publicar o servidor junto
- [ ] (opcional) Esconder `?itens=todos`, `?pet=`, `?vinganca=`, `?tempo=` em produção — só afetam o modo local
- [ ] (descartado: ganho irrelevante) gravar volume só ao soltar o slider; contador de versão dos tiles no servidor

## Fase 3 — Power-ups avançados
- [x] Chutar bomba (desliza até bater; explode ao entrar em fogo)
- [x] Socar bomba (Ação/Shift de frente para a bomba: voa 3 casas, dá a volta na arena)
- [x] Luva: Ação sobre a bomba para pegar, Ação/Bomba para arremessar; bomba na mão continua com o pavio
- [x] Bomba remota (Ação detona a mais antiga; pavio de segurança de 10 s)
- [x] Atravessar bombas · [x] Atravessar blocos (só os de tijolo)
- [x] Colete (absorve 1 golpe + 2,5 s de invulnerabilidade)
- [x] Caveira: 6 maldições (lento, acelerado, sem bombas, bombas automáticas, controles invertidos, alcance mínimo), 15 s, contagia por contato
- [x] Bomba em linha (uso único, empilha até 3) · [x] Bomba de poder (1ª bomba de cada leva com alcance máximo)
- [x] Sprites dos itens, ícones no placar, legenda "Itens e controles" no lobby, atalho `?itens=todos` no modo local
- [x] Efeitos (partículas, ondas de choque, brilho, tremor, rastros) e sons para chute, arremesso/pouso, luva, colete, caveira, itens caindo/sendo pegos
- [x] Pódio no fim da partida (1º feliz com coroa; 2º-4º chorando; empates dividem a colocação)
- [ ] Balancear as chances de drop com playtests

## Fase 4 — Pets/montarias
- [x] Ovo como item que sai dos blocos; montado, o jogador deixa os próximos ovos no chão
- [x] 4 pets com poder na tecla própria (E / "/"): Corredor (dispara até bater), Saltador (pula 2 casas, imune ao fogo no ar), Empurrador (empurra tijolo 1 casa), Chutador (chute forte, sem precisar do item)
- [x] Pet aguenta 1 golpe (antes do colete) e foge; jogador fica 2,5 s invulnerável
- [x] Sprites originais dos pets, ícone no placar, legenda no lobby, efeitos e sons; atalho `?itens=todos&pet=<tipo>` no modo local
- [x] Pets redesenhados como bichos de verdade (ema, sapo, tatu, jumento, com sela na cor do item), em duas camadas: o corpo atrás do boneco e a cabeça na frente
- [ ] Balancear recargas e a chance do ovo com playtests

## Fase 5 — Mapas complexos
- [ ] Esteiras · [ ] Teletransportes · [ ] Gelo · [ ] Blocos móveis · [ ] Perigos

## Fase 6 — Extras
- [x] Modo vingança (opção da sala, anfitrião liga): o morto vira fantasma na borda, anda por ela e joga bombas 3 casas para dentro (1 por vez, recarga de 2 s); atalho `?vinganca=1` no modo local
- [ ] Vingança com volta: quem acerta um vivo com a bomba de fantasma volta para a arena (opcional)
- [x] Tempo de partida (2, 3, 5 min ou sem limite) e sudden death: blocos de pedra caem em espiral, esmagam quem estiver embaixo (pet/colete não salvam), com alarme, música acelerada e efeitos
- [x] Efeitos visuais de explosão (onda de choque, brilho, faíscas, fumaça, destroços, tremor de tela, clarão) e animação de morte
- [x] Fogo em pixel art no lugar dos retângulos: feixes com miolo estável e bordas tremulando, pontas arredondadas, esfria de branco a vermelho-escuro; bola de fogo no centro de cada bomba; clarão mais contido
- [x] Mais músicas (2º tema de batalha por mapa, versão acelerada no sudden death) e volume de música/efeitos no painel ⚙️
- [x] "Reduzir tremor e clarão" no painel ⚙️ (segue o "reduzir movimento" do sistema por padrão)
- [x] Controles touch no celular: direcional + Bomba/Ação/Pet
- [x] Gamepad (mapeamento padrão): direcional/analógico, A bomba, B/X ação, Y/RB pet; no modo local, controle 1 = J1, controle 2 = J2
- [ ] Contas/ranking (Supabase)
- [x] Bots: fogem do perigo (inclusive reações em cadeia), quebram tijolos, pegam itens e caçam; o anfitrião adiciona/remove na sala; "Treinar contra bots" na tela inicial; como fantasmas no modo vingança também jogam
- [x] Bot "travado" indo e voltando: depois de se proteger da própria bomba, voltava pela área da explosão (e fugia de novo); também alternava entre dois pontos de bomba sem rota de fuga. Corrigido, com testes
- [x] Bot "dançando" entre duas casas nos casos que sobravam: alvo que mudava conforme os inimigos se mexiam (agora escolhe uma presa e fica nela uns segundos; para quando já está colado), horizonte de busca que andava com o bot, e controles invertidos da caveira (agora compensa)
- [x] Bomba arremessada/socada que cai na cabeça de alguém (bot ou pessoa) quica para a casa seguinte, estilo SNES, e deixa a pessoa tonta por 1 s (gira, estrelinhas, som de "bonk"; quem carregava bomba na luva a deixa cair). Antes prendia o jogador dentro da bomba até explodir
- [x] Bots com nível Fácil/Normal/Difícil: tempo para notar a bomba dos outros, de quanto em quanto tempo repensam o objetivo, hesitação antes de plantar, pânico momentâneo, margem de segurança ao fugir e vontade de caçar. O anfitrião escolhe ao adicionar e troca clicando no nível; "Treinar contra bots" também escolhe
- [ ] Ajustar os números dos níveis jogando (estão em `PROFILES` em `packages/engine/src/bot.ts`)
- [ ] Bots usarem pets e itens especiais (chutar, socar, remota)
- [ ] Replays (a engine é determinística: dá para gravar só seed + entradas)
