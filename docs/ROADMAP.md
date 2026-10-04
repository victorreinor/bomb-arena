# Roadmap

Legenda: `[x]` feito · `[ ]` pendente. Atualizar a cada entrega.

## Próximos passos (análise de 04/10/2026, em ordem de prioridade)
Tamanho: P pequeno · M médio · G grande. 🖥️ = mexe na engine ou no protocolo: publicar o servidor antes do push.

**Próxima rodada: sensação de jogo e celular**
- [x] Contagem "PRONTO?… JÁ!" de 2 s no início da partida (online e local): ninguém anda, o relógio espera, e a predição já alinha o relógio nesse tempo; som de largada no "JÁ!"
- [x] Marcador "VOCÊ" sobre o próprio boneco (J1/J2 no modo de dois no mesmo teclado) durante a contagem e 2 s depois; embaixo dos pés quando o boneco começa na fileira de cima
- [x] Bomba pulsando mais rápido no último segundo e mais ainda no último meio segundo
- [x] Partida no celular, em pé e deitado: em pé, jogadores numa linha só (seu card com contorno), tabuleiro de borda a borda e controles embaixo; deitado, jogadores e direcional à esquerda, tabuleiro com a altura toda, relógio e botões à direita. O tabuleiro sempre pega o maior tamanho que cabe. Som, ajustes e "Sair" num menu ⚙️ durante a partida (os botões flutuantes cobriam o relógio e o Sair). Treino contra bots ganhou botão de sair
- [x] Botão "⟳ Deitar" / "⛶ Tela cheia" na partida: tela cheia e trava na horizontal mesmo com a rotação automática desligada (Android)
- [x] "Deitar" no iPhone, que não deixa travar a tela: o jogo gira dentro da página (funciona com o bloqueio de rotação ligado; "⟲ Em pé" volta). Uma dica única ensina a segurar e a instalar na tela inicial para tirar as barras do Safari
- [x] Tela parada durante a partida: sem rolar, sem zoom (pinça ou toque duplo), sem "puxar para recarregar", sem seleção de texto ou lupa ao segurar os botões no iPhone. Fora da partida: toque duplo não dá zoom, campos com 16 px (o iPhone dava zoom ao digitar) e o texto não aumenta sozinho deitado
- [x] Instalar na tela inicial (PWA: manifesto, ícones gerados pelo `bun run sprites`): abre em tela cheia, como um app. Sem service worker por enquanto (nada fica em cache, então nunca roda versão velha)
- [x] Confirmado e corrigido: trocar de aba ou de app segurando uma direção deixava o boneco andando no servidor (os quadros param com a aba escondida e o comando "parado" não saía). Agora sai na hora em que a aba some
- [x] Indicador de conexão (📶 ms, verde/amarelo/vermelho) na partida e no lobby, medido por ping a cada 2 s

**Depois: social**
- [x] Quem explodiu quem no pódio: "Ana explodiu Bia · Caio se explodiu · Dani foi esmagado" e 💥 com o número de abates de cada um (a chama guarda de quem é a bomba)
- [ ] Mais estatísticas no pódio (itens pegos, bombas plantadas) — P 🖥️
- [x] Anfitrião tira uma pessoa da sala no lobby (✕ ao lado do nome); ela volta ao início com o aviso. Pode voltar pelo código (não há banimento)
- [ ] Emotes rápidos: 4 reações fixas (😂 😡 👍 GG) num balão sobre o boneco, sem chat livre (nada a moderar) — M 🖥️
- [ ] Replay do final: no pódio, rever os últimos ~5 s em câmera lenta, com os snapshots que o cliente já recebeu (sem mudar o servidor) — M

**Depois: conteúdo**
- [x] Mapas para 2 jogadores (x1): Duelo (11×9, apertado) e Confronto (13×11, meio-termo), com cenários reaproveitados; com mais de 2 na sala o mapa aparece com "só 2 jogadores" e a partida não começa
- [ ] Batalha em duplas (2 contra 2, pessoas ou bots), com fogo amigo opcional — M 🖥️
- [x] Bombas novas, como itens: **perfurante** (permanente; a explosão atravessa os tijolos e quebra todos no alcance), **de borracha** (permanente; chutada, quica no que encontra e volta, com som e efeito próprios; para em quem estiver no caminho) e **mina** (uso único, até 3; a próxima bomba se enterra em 1 s, some para os outros, não bloqueia a passagem e explode quando um adversário pisa nela ou em 10 s; o dono a vê clarinha). Cada uma com aparência própria no `bomb.png`, ícone, legenda e testes; os bots enxergam a explosão perfurante e não veem as minas enterradas dos outros
- [x] Fase 5 inteira, um mapa por mecânica, cada um com cenário próprio: Linha de Montagem (esteiras), Portais, Lago Congelado (gelo), Armazém (caixotes que se empurram) e Vulcão (fendas de lava). Detalhes na seção da Fase 5
- [ ] Bots empurrarem caixotes de propósito (hoje os tratam como parede) — P 🖥️
- [ ] Balancear com playtests a velocidade das esteiras, o ciclo da lava (5 s) e o tempo para empurrar um caixote — P 🖥️
- [ ] Monstros na arena, como os bichos e tanques dos mapas dos Super Bomberman do SNES: uns só atrapalham, outros soltam fogo. Opção da sala (sem / poucos / muitos) e, depois, mapas com monstros próprios. Começar por um tipo só; os tipos estão na seção "Monstros" mais abaixo — M–G 🖥️

**Quando der: proteção**
- [x] Testes para `predict.ts` e `snapshots.ts` (`apps/web/test`, `bun run test`): rede simulada com a sala da engine como servidor; confere resposta imediata, correções de no máximo um tick de caminhada, bomba e item uma vez só, contagem, servidor sem `acks`, conexão parada, reserva de 1 a 3 ticks e interpolação
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
- [ ] Limite global de salas/conexões (precisaria de estado compartilhado entre instâncias). Avaliado em 04/10/2026: não vale agora. Seria um Durable Object central (mais um ponto que pode cair e mais requisições na cota), e no plano grátis estourar a cota só para o jogo até o dia seguinte, sem cobrança
- [x] Snapshots menores: o tabuleiro só vai quando muda (ou chega alguém), sem `rng`/`nextBombId`, e 1 por segundo durante o pódio
- [x] Encolher também os dados dos jogadores e das bombas: no protocolo 2 (o cliente avisa com `v=2`) vai só o que mudou, completo uma vez por segundo. Numa partida de 4, o snapshot caiu de ~2,7 KB para ~650 bytes (−76%; uma hora de jogo no 4G passa de ~290 MB para ~70 MB). Cliente antigo continua recebendo tudo completo
- [x] Pegar item já no máximo agora tem som e efeito: o `diffGame` vê o item sumir da casa onde o boneco está (sem fogo nem bloco caindo ali). Resolvido sem a engine emitir eventos, que continuam saindo da diferença entre estados; caveira em quem já está amaldiçoado também avisa a maldição nova
- [x] Log "Uncaught Error: Network connection lost" do wrangler: aparece sempre que o servidor fecha a conexão antes do cliente. Agora o cliente desliga sozinho ao receber o erro e o servidor só fecha depois de 1 s, se o cliente não fechou. De quebra, o servidor passou a responder ao fechamento do cliente: sem isso o navegador ficava esperando e a tela de "Sala não encontrada" só aparecia porque o servidor fechava primeiro

## Correções
- [x] Botão de ação (Shift) não chegava ao servidor no modo online (soco, luva, arremesso e remota só funcionavam no modo local). Mensagens do cliente agora são tratadas na engine (`handleClientMessage`), com testes.
- [x] O boneco dava um "pulo" no primeiro passo da partida: agora o relógio se alinha com o servidor antes de você se mexer, e a predição começa de onde o boneco estava desenhado
- [x] O item só sumia (com som e efeito) um tempo depois de você passar por cima: agora a predição pega o item no quadro em que o boneco entra na casa
- [x] Bot com bomba remota ficava parado em cima dela até o pavio de segurança (10 s) acabar, e morria: ele tratava a própria remota como "pode explodir a qualquer momento" e não achava rota de fuga. Agora conta o pavio de verdade das próprias remotas e as detona quando está fora do alcance

## Documentação
- [x] `CLAUDE.md` (guia para agentes de IA: comandos, regras, fluxo de trabalho, armadilhas), `AGENTS.md` apontando para ele e `docs/ARCHITECTURE.md` (como funciona por dentro e receitas)
- [x] README de vitrine: título com o boneco andando e o sapo pulando, GIF de uma partida contra bots, o que tem no jogo, a arquitetura com diagrama e as tecnologias. As figuras saem do `bun run sprites` (`.github/readme`); descrição e tópicos do repositório no GitHub. "Bomb Arena" virou o nome oficial também no código (pacotes `@bomb-arena/*`)

## Dívida técnica (da revisão de código; nenhuma urgente)
- [ ] Uma só mensagem `settings` para as opções do lobby (hoje uma por opção) — fazer quando entrar a próxima opção
- [ ] Modo local rodando pela lógica de sala (bots, série e nomes iguais ao online) — fazer se o modo local ganhar opções de sala
- [ ] Separar no tipo os campos que o servidor não envia (`rng`, `nextBombId`). A predição já saiu e contorna isso recalculando `nextBombId` pelas bombas; fazer quando o protocolo mudar de novo
- [ ] A engine registrar quem fez cada ação (chute, soco, arremesso, bomba plantada), por exemplo `Player.action = { kind, tick }`. Hoje o cliente deduz pela posição para escolher a pose do boneco; com o registro, a pose sai do estado. (Os abates já são creditados: cada chama guarda o dono da bomba.) Muda o protocolo: publicar o servidor junto
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
- [x] Esteiras (Linha de Montagem): levam quem pisa a 2 casas/s (andar contra é lento), e bombas e itens uma casa a cada meio segundo; não empurram ninguém através de parede
- [x] Teletransportes (Portais): três pares; entrou num, sai no meio do outro; bomba chutada ou levada pela esteira também passa; ninguém põe bomba em cima de um portal
- [x] Gelo (Lago Congelado): andando no gelo não dá para virar nem parar até bater em algo ou sair dele; parado, dá para sair em qualquer direção
- [x] Blocos móveis (Armazém): caixotes que não queimam e seguram explosões; quem anda contra um, alinhado, por um instante, o empurra uma casa (se do outro lado estiver livre)
- [x] Perigos (Vulcão): fendas de lava em cruz que cospem fogo juntas a cada 5 s, brilhando antes; queimam itens, detonam bombas e matam ("caiu na lava")
- [x] Bots entendem cada uma: planejam o caminho deslizando no gelo e atravessando portais, saem da lava antes de ela explodir e, com remota em cima de esteira, só detonam se a esteira não os levar para a explosão
- [x] Predição do próprio boneco funciona em todas (o caixote empurrado anda na tela junto com você)
- [ ] Mais perigos (espinhos que sobem, buracos, trampolins) e as mecânicas em mapas para 2

## Monstros na arena
Bichos controlados pelo jogo, com arte e nomes próprios (nada copiado do SNES). Morrem com uma explosão e podem soltar um item ao morrer.
- [ ] Andarilho: anda ao acaso pelos corredores e só atrapalha: fecha a passagem e deixa tonto por 1 s quem encostar (o mesmo tonto da bomba que cai na cabeça)
- [ ] Caçador: anda atrás do jogador mais perto, e encostar nele custa uma vida (o pet ou o colete salvam, como no fogo)
- [ ] Atirador: tanque que para, mira por um instante (com aviso na tela) e solta uma chama em linha reta, que também acende bombas e quebra tijolos
- [ ] Estátua: fica parada e cospe fogo de tempos em tempos numa direção fixa, com aviso antes; uma explosão a derruba
- [ ] Opção da sala "Monstros: sem / poucos / muitos", que vale em qualquer mapa e no treino contra bots
- [ ] Mapas com monstros próprios, um por cenário (exemplo: estátuas no Templo, tanques na Fábrica)
- [ ] Bots fugindo dos monstros e da mira dos atiradores
- Por dentro: regra na engine (`state.monsters`, acaso vindo de `state.rng`), lista exaustiva `MONSTER_KINDS` para o typecheck apontar o que falta, campo opcional no snapshot (cliente antigo só não vê os monstros), folha de sprite própria e a predição tratando o monstro como obstáculo

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
- [ ] Bots usarem pets e itens especiais (chutar, socar). A remota eles já usam: detonam quando estão fora do alcance
- [ ] Replays (a engine é determinística: dá para gravar só seed + entradas)
