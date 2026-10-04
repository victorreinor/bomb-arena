# Roadmap

Legenda: `[x]` feito · `[ ]` pendente. Atualizar a cada entrega.

## Fase 1 — Núcleo local
- [x] Engine determinística (`packages/engine`): grade 15x13, movimento com deslize em quinas, bombas, explosões em cadeia, blocos moles, flames com braços
- [x] Power-ups básicos: bomba+, fogo+, velocidade
- [x] Morte, vitória, empate
- [x] Mapa clássico (blocos moles aleatórios por seed)
- [x] Testes da engine (`bun test packages`)
- [x] Sprites originais geradas por script (`bun run sprites`): bomber x4 cores, blocos, bomba, power-ups
- [x] Cliente canvas + modo local 2 jogadores no mesmo teclado (`bun run dev`)
- [x] Conferido no navegador pelo usuário

## Fase 2 — Online + salas
- [x] `apps/server`: Cloudflare Worker + Durable Object `Room` (WebSocket, tick 30 Hz)
- [x] Protocolo cliente↔servidor (inputs → snapshots; lobby → `RoomView`)
- [x] Criar sala / entrar por código (5 letras) ou link `?sala=CODIGO` (o link abre uma tela de convite só com nome + "Entrar na sala"), até 4 jogadores
- [x] Lobby: escolher cor (única por sala), pronto, anfitrião escolhe mapa e inicia
- [x] Vagas da sala (2–4) escolhidas ao criar; o anfitrião pode mudar no lobby (nunca abaixo de quem já entrou)
- [x] Partida em andamento → entrante assiste e entra na próxima
- [x] Reconexão (10 s de tolerância; depois é eliminado/removido); anfitrião migra
- [x] Interpolação no cliente (buffer de snapshots)
- [x] 3 mapas novos: Campo Aberto (simples), Labirinto e Quadrantes (complexos); teste garante que todos são conectados
- [x] Efeitos sonoros (bomba, explosão, power-up, morte, vitória/derrota) e músicas distintas (lobby leve / batalha acelerada e sombria), sintetizados; botões separados para música (M) e efeitos (N), salvos no navegador
- [x] Teste e2e (`bun run e2e`) e fluxo de 3 abas verificado em Chrome headless
- [ ] **Deploy** Vercel + Cloudflare (precisa do seu login; passos no README)
- [ ] Predição de movimento no cliente (hoje o movimento espera o servidor: atraso ≈ ping)
- [ ] Placar da sessão / "melhor de N"
- [ ] Sair da sala explicitamente (hoje fechar a aba = desconexão com 10 s de tolerância)
- [ ] Limite de salas / proteção contra abuso (rate limit)
- [ ] Snapshots menores: mandar o mapa uma vez e depois só os tiles que mudaram, tirar `rng`/`nextBombId` (hoje ~2,7 KB por tick por cliente; o `rng` deixa prever drops) e parar de mandar estado durante a contagem do pódio
- [ ] Engine emitir os eventos (pegou item, chutou, morreu...) em vez de o cliente deduzir comparando estados; hoje pegar um item já no máximo não gera som/efeito
- [ ] Investigar o log "Uncaught Error: Network connection lost" do wrangler a cada entrada recusada (sala inexistente/cheia/código repetido). O cliente recebe o erro e o fechamento certos; testado: não é quem fecha nem falta de listeners.

## Correções
- [x] Botão de ação (Shift) não chegava ao servidor no modo online (soco, luva, arremesso e remota só funcionavam no modo local). Mensagens do cliente agora são tratadas na engine (`handleClientMessage`), com testes.

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
- [ ] Ovos escondidos em blocos específicos
- [ ] Definir roster e habilidades (inspirado nos Louies de SB3/SB4)
- [ ] Pet protege 1 hit; perda ao ser atingido

## Fase 5 — Mapas complexos
- [ ] Esteiras · [ ] Teletransportes · [ ] Gelo · [ ] Blocos móveis · [ ] Perigos

## Fase 6 — Extras
- [ ] Morte com "revenge" (jogador morto joga bombas das bordas)
- [ ] Sudden death (blocos caindo após X minutos)
- [x] Efeitos visuais de explosão (onda de choque, brilho, faíscas, fumaça, destroços, tremor de tela, clarão) e animação de morte
- [x] Fogo em pixel art no lugar dos retângulos: feixes com miolo estável e bordas tremulando, pontas arredondadas, esfria de branco a vermelho-escuro; bola de fogo no centro de cada bomba; clarão mais contido
- [ ] Mais faixas de música / controle de volume
- [ ] Opção para reduzir tremor/clarão (acessibilidade)
- [ ] Controles touch (mobile), com botão de Ação
- [ ] Suporte a controle/gamepad (direcional ou analógico para mover, um botão para bomba, outro para Ação)
- [ ] Contas/ranking (Supabase)
- [ ] Bots, replays
