# ChessWorld

Mundo virtual multiplayer com xadrez em tempo real.

## Como rodar

```bash
npm install
npm start
```

O servidor inicia na porta 3000. Acesse `http://localhost:3000`.

Para desenvolvimento com MongoDB local persistente, execute `npm run local`.
Esse comando usa a porta 27019 e salva os dados em `data/local-mongo/` (ignorada
pelo Git). Requer o executavel `mongod` no PATH, em `MONGOD_BIN` ou no cache local
de binarios do MongoDB. Mapas, portais e contas permanecem salvos entre reinicios.

Para usar outro MongoDB, defina `MONGO_URI` antes de iniciar. Opcionalmente,
`DB_NAME` altera o nome do banco (padrao: `chessworld`). Exemplo no PowerShell:

```powershell
$env:MONGO_URI = 'mongodb://127.0.0.1:27018'
npm start
```

Execute `npm test` para verificar as regressoes do motor de xadrez.

## Mapas separados e portais

Com uma conta administradora (`MAGO` ou `Isaac`), abra **DEV → CONFIGURAR MAPAS**
para criar ou editar mapas, definir largura/altura em pixels e escolher o fundo:
imagem repetida com tamanho de tile configuravel, ou imagem unica ajustada ao mapa.
O editor aceita URL ou upload e permite escolher a entrada inicial numa previa.

Para conectar dois mapas, use **CRIAR PORTAL DE IDA E VOLTA** e clique no chao.
Escolha um mapa existente ou crie o destino no mesmo formulario, indique as
coordenadas de chegada (ou clique na previa) e salve. Os dois portais sao criados
juntos. Caminhe sobre o portal fora do modo DEV para atravessar; ao chegar, saia
da area do portal antes de voltar. No painel, edite uma ligacao ou exclua os dois
portais pelo botao de exclusao.

Jogadores, chat, NPCs, cenarios, barreiras e fundos de area pertencem ao seu mapa.
O mapa e a posicao do jogador sao salvos ao atravessar e ao desconectar. O mundo
anterior e migrado para **Casa inicial**, preservando seus objetos. Mapas e pares
de portais ficam nas colecoes `maps` e `portals` do MongoDB configurado.

Para desenvolvimento com auto-reload:

```bash
npm run dev
```

## Estrutura

```
server.js          - Servidor Express + Socket.io + engine de xadrez
public/
  index.html       - Interface do jogo
  client.js        - Logica do cliente
  uploads/         - Skins e cenarios uploadados
  skins/           - Skins padrao
data/
  db.json          - Persistencia de dados
```

## Funcionalidades

- Mundo 2D com movimentacao livre (WASD/setas)
- Sistema de chat com bolha de fala
- Xadrez multiplayer com todas as regras (roque, en passant, promocao)
- Bot com 3 niveis de dificuldade
- Sistema de skis customizadas (spritesheet 4x4)
- Painel de desenvolvimento para criar barreiras, NPCs e cenarios
- Suporte a mobile com controles touch
- VFX de captura com animacoes
