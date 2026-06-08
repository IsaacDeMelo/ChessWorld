# ChessWorld

Mundo virtual multiplayer com xadrez em tempo real.

## Como rodar

```bash
npm install
npm start
```

O servidor inicia na porta 3000. Acesse `http://localhost:3000`.

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
