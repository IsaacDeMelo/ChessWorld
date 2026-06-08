const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '')}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.static('public'));

class Database {
    constructor() {
        this.path = path.join(__dirname, 'data/db.json');
        const dir = path.dirname(this.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this.data = this.load();
        this.defaults();
        this.save();
    }
    load() {
        if (!fs.existsSync(this.path)) return {};
        try { return JSON.parse(fs.readFileSync(this.path, 'utf8')); } catch { return {}; }
    }
    save() { fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2)); }
    defaults() {
        const d = this.data;
        if (!d.players) d.players = [];
        if (!d.objects) d.objects = [];
        if (!d.skins) d.skins = [];
        if (!d.npcs) d.npcs = [];
        if (!d.sceneryTemplates) d.sceneryTemplates = [];
        if (!d.sceneryMap) d.sceneryMap = [];
        if (!d.pieceSprites) d.pieceSprites = {};
        if (!d.spriteSheets) d.spriteSheets = {};
        d.npcs.forEach(n => {
            if (!n.dir) n.dir = 'down';
            if (!Array.isArray(n.dialogues)) {
                n.dialogues = [{ text: n.dialogue || '...', responses: [{ text: 'Fechar', action: 'close' }] }];
            }
            if (n.isBot && n.dialogues.every(d => !d.responses || d.responses.every(r => r.action !== 'duel'))) {
                n.dialogues.forEach(d => {
                    if (!d.responses) d.responses = [];
                    if (!d.responses.some(r => r.action === 'duel')) {
                        d.responses.push({ text: 'Desafiar (Bot)', action: 'duel' });
                    }
                });
            }
        });
    }
    loginOrRegister(username, color, skin) {
        let p = this.data.players.find(p => p.username === username);
        if (!p) {
            p = { username, xp: 0, level: 1, x: 100, y: 100, color: color || '#888', skin: skin || '' };
            this.data.players.push(p);
        } else {
            if (color) p.color = color;
            if (skin) p.skin = skin;
        }
        this.save();
        return p;
    }
}

const db = new Database();

app.get('/api/data', (_, res) => {
    res.json({ skins: db.data.skins, scenery: db.data.sceneryTemplates });
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Sem arquivo' });
    const type = req.body.type;
    const name = (req.body.name ? String(req.body.name) : `Img_${Date.now()}`).substring(0, 50);
    const newItem = { id: Date.now().toString(), name, url: `/uploads/${req.file.filename}` };
    if (type === 'skin') db.data.skins.push(newItem);
    else db.data.sceneryTemplates.push(newItem);
    db.save();
    res.json({ success: true, item: newItem, type });
});

app.post('/api/skin/rename', (req, res) => {
    const { id, newName } = req.body;
    if (!id || !newName) return res.json({ success: false, error: 'Dados invalidos' });
    const skin = db.data.skins.find(s => s.id === id);
    if (!skin) return res.json({ success: false, error: 'Skin nao encontrada' });
    skin.name = newName.substring(0, 50);
    db.save();
    res.json({ success: true, skin });
});

app.post('/api/skin/delete', (req, res) => {
    const { id } = req.body;
    if (!id) return res.json({ success: false, error: 'ID invalido' });
    const idx = db.data.skins.findIndex(s => s.id === id);
    if (idx === -1) return res.json({ success: false, error: 'Skin nao encontrada' });
    db.data.skins.splice(idx, 1);
    db.save();
    res.json({ success: true });
});

// --- Chess Engine ---
const PIECE_VAL = { p: 10, n: 30, b: 30, r: 50, q: 90, k: 900 };

class ChessGame {
    constructor(id, p1Id, p2Id, isBot = false, botLevel = 1) {
        this.id = id;
        this.p1Id = p1Id;
        this.p2Id = p2Id;
        this.isBot = isBot;
        this.botLevel = botLevel;
        this.turn = 'w';
        this.status = 'active';
        this.winner = null;
        this.lastAction = null;
        this.moveCount = 0;
        this.castlingRights = { w: { k: true, q: true }, b: { k: true, q: true } };
        this.enPassantTarget = null;
        this.board = this.initBoard();
    }
    initBoard() {
        const row = (c) => [
            { t: 'r', c }, { t: 'n', c }, { t: 'b', c }, { t: 'q', c },
            { t: 'k', c }, { t: 'b', c }, { t: 'n', c }, { t: 'r', c }
        ];
        const p = (c) => Array(8).fill(null).map(() => ({ t: 'p', c }));
        const e = () => Array(8).fill(null);
        return [row('b'), p('b'), e(), e(), e(), e(), p('w'), row('w')];
    }
    findKing(color) {
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (this.board[r][c] && this.board[r][c].t === 'k' && this.board[r][c].c === color)
                    return { r, c };
        return null;
    }
    isClearPath(fr, fc, tr, tc) {
        const rDir = Math.sign(tr - fr), cDir = Math.sign(tc - fc);
        let r = fr + rDir, c = fc + cDir;
        while (r !== tr || c !== tc) {
            if (this.board[r][c]) return false;
            r += rDir; c += cDir;
        }
        return true;
    }
    isSquareAttackedBy(r, c, attackerColor) {
        for (let fr = 0; fr < 8; fr++) {
            for (let fc = 0; fc < 8; fc++) {
                const p = this.board[fr][fc];
                if (!p || p.c !== attackerColor) continue;
                const dr = r - fr, dc = c - fc;
                if (p.t === 'p') { const dir = p.c === 'w' ? -1 : 1; if (dr === dir && Math.abs(dc) === 1) return true; }
                else if (p.t === 'n') { if ((Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2)) return true; }
                else if (p.t === 'k') { if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) return true; }
                else if (p.t === 'r') { if ((dr === 0 || dc === 0) && this.isClearPath(fr, fc, r, c)) return true; }
                else if (p.t === 'b') { if (Math.abs(dr) === Math.abs(dc) && this.isClearPath(fr, fc, r, c)) return true; }
                else if (p.t === 'q') { if ((dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc)) && this.isClearPath(fr, fc, r, c)) return true; }
            }
        }
        return false;
    }
    isKingInCheck(color) {
        const king = this.findKing(color);
        if (!king) return false;
        return this.isSquareAttackedBy(king.r, king.c, color === 'w' ? 'b' : 'w');
    }
    isRawValidMove(piece, fr, fc, tr, tc) {
        const dr = tr - fr, dc = tc - fc;
        if (dr === 0 && dc === 0) return false;
        const target = this.board[tr][tc];
        if (target && target.c === piece.c) return false;
        if (piece.t === 'p') {
            const dir = piece.c === 'w' ? -1 : 1;
            const startRow = piece.c === 'w' ? 6 : 1;
            if (dc === 0 && !target) {
                if (dr === dir) return true;
                if (dr === dir * 2 && fr === startRow && !this.board[fr + dir][fc]) return true;
            }
            if (Math.abs(dc) === 1 && dr === dir) {
                if (target) return true;
                if (this.enPassantTarget && this.enPassantTarget.r === tr && this.enPassantTarget.c === tc) return true;
            }
            return false;
        }
        if (piece.t === 'r') return (dr === 0 || dc === 0) && this.isClearPath(fr, fc, tr, tc);
        if (piece.t === 'b') return Math.abs(dr) === Math.abs(dc) && this.isClearPath(fr, fc, tr, tc);
        if (piece.t === 'q') return (dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc)) && this.isClearPath(fr, fc, tr, tc);
        if (piece.t === 'n') return (Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2);
        if (piece.t === 'k') {
            if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) return true;
            if (dr === 0 && Math.abs(dc) === 2) {
                const color = piece.c, row = color === 'w' ? 7 : 0;
                if (fr !== row) return false;
                const rights = this.castlingRights[color], enemy = color === 'w' ? 'b' : 'w';
                if (dc === 2 && rights.k) {
                    return !this.board[row][5] && !this.board[row][6] &&
                        !this.isSquareAttackedBy(row, 4, enemy) && !this.isSquareAttackedBy(row, 5, enemy) && !this.isSquareAttackedBy(row, 6, enemy);
                }
                if (dc === -2 && rights.q) {
                    return !this.board[row][1] && !this.board[row][2] && !this.board[row][3] &&
                        !this.isSquareAttackedBy(row, 4, enemy) && !this.isSquareAttackedBy(row, 3, enemy) && !this.isSquareAttackedBy(row, 2, enemy);
                }
            }
            return false;
        }
        return false;
    }
    wouldLeaveInCheck(piece, fr, fc, tr, tc) {
        const target = this.board[tr][tc];
        const capturedEnPassant = piece.t === 'p' && this.enPassantTarget &&
            tr === this.enPassantTarget.r && tc === this.enPassantTarget.c && !target;
        let enPassantCaptured = null;
        if (capturedEnPassant) {
            const epRow = piece.c === 'w' ? tr + 1 : tr - 1;
            enPassantCaptured = this.board[epRow][tc];
            this.board[epRow][tc] = null;
        }
        this.board[tr][tc] = piece; this.board[fr][fc] = null;
        const inCheck = this.isKingInCheck(piece.c);
        this.board[fr][fc] = piece; this.board[tr][tc] = target;
        if (capturedEnPassant) { const epRow = piece.c === 'w' ? tr + 1 : tr - 1; this.board[epRow][tc] = enPassantCaptured; }
        return inCheck;
    }
    isValidMove(piece, fr, fc, tr, tc) {
        return this.isRawValidMove(piece, fr, fc, tr, tc) && !this.wouldLeaveInCheck(piece, fr, fc, tr, tc);
    }
    move(socketId, from, to) {
        if (this.status !== 'active') return false;
        const color = socketId === this.p1Id ? 'w' : (socketId === this.p2Id ? 'b' : null);
        if (color !== this.turn) return false;
        const piece = this.board[from.r][from.c];
        if (!piece || piece.c !== color) return false;
        if (!this.isValidMove(piece, from.r, from.c, to.r, to.c)) return false;
        const target = this.board[to.r][to.c];
        let isCapture = !!target, capturedType = target ? target.t : null, capturedColor = target ? target.c : null;
        if (piece.t === 'p' && this.enPassantTarget && to.r === this.enPassantTarget.r && to.c === this.enPassantTarget.c && !target) {
            const epRow = color === 'w' ? to.r + 1 : to.r - 1;
            const epPiece = this.board[epRow][to.c];
            if (epPiece) { this.board[epRow][to.c] = null; isCapture = true; capturedType = epPiece.t; capturedColor = epPiece.c; }
        }
        this.enPassantTarget = null;
        if (piece.t === 'p' && Math.abs(to.r - from.r) === 2) this.enPassantTarget = { r: (from.r + to.r) / 2, c: from.c };
        if (piece.t === 'k' && Math.abs(to.c - from.c) === 2) {
            const row = to.r;
            if (to.c === 6) { this.board[row][5] = this.board[row][7]; this.board[row][7] = null; }
            else if (to.c === 2) { this.board[row][3] = this.board[row][0]; this.board[row][0] = null; }
        }
        this.board[to.r][to.c] = piece; this.board[from.r][from.c] = null;
        const isCastle = piece.t === 'k' && Math.abs(to.c - from.c) === 2;
        if (piece.t === 'k') { this.castlingRights[color].k = false; this.castlingRights[color].q = false; }
        if (piece.t === 'r') { if (from.c === 0) this.castlingRights[color].q = false; if (from.c === 7) this.castlingRights[color].k = false; }
        if (capturedType === 'r') {
            const enemy = color === 'w' ? 'b' : 'w';
            if (to.r === (enemy === 'w' ? 7 : 0)) { if (to.c === 0) this.castlingRights[enemy].q = false; if (to.c === 7) this.castlingRights[enemy].k = false; }
        }
        const attackerType = piece.t;
        let isPromotion = false;
        if (piece.t === 'p' && (to.r === 0 || to.r === 7)) { piece.t = 'q'; isPromotion = true; }
        this.moveCount++;
        const enemy = color === 'w' ? 'b' : 'w';
        if (capturedType === 'k') { this.status = color + '_wins'; this.winner = socketId; }
        else {
            const enemyInCheck = this.isKingInCheck(enemy);
            const enemyHasLegal = this.hasAnyLegalMoves(enemy);
            if (enemyInCheck && !enemyHasLegal) { this.status = color + '_wins'; this.winner = socketId; }
            else if (!enemyInCheck && !enemyHasLegal) { this.status = 'stalemate'; }
            else { this.turn = enemy; }
        }
        this.lastAction = { from, to, isCapture, capturedType, capturedColor, attackerType, isPromotion, isCastle, moveCount: this.moveCount, side: color, inCheck: this.status === 'active' ? this.isKingInCheck(enemy) : false };
        return true;
    }
    getLegalMoves(fr, fc) {
        const moves = [], piece = this.board[fr][fc];
        if (!piece) return moves;
        for (let tr = 0; tr < 8; tr++)
            for (let tc = 0; tc < 8; tc++)
                if (this.isValidMove(piece, fr, fc, tr, tc)) {
                    let score = 0;
                    if (this.board[tr][tc]) score = PIECE_VAL[this.board[tr][tc].t];
                    else if (piece.t === 'p' && this.enPassantTarget && tr === this.enPassantTarget.r && tc === this.enPassantTarget.c) score = PIECE_VAL['p'];
                    moves.push({ from: { r: fr, c: fc }, to: { r: tr, c: tc }, score });
                }
        return moves;
    }
    hasAnyLegalMoves(color) {
        for (let fr = 0; fr < 8; fr++)
            for (let fc = 0; fc < 8; fc++) {
                const p = this.board[fr][fc];
                if (p && p.c === color && this.getLegalMoves(fr, fc).length > 0) return true;
            }
        return false;
    }
    getAllMoves(color) {
        const moves = [];
        for (let fr = 0; fr < 8; fr++)
            for (let fc = 0; fc < 8; fc++) {
                const p = this.board[fr][fc];
                if (p && p.c === color) moves.push(...this.getLegalMoves(fr, fc));
            }
        return moves;
    }
    boardToFEN() {
        const pieceMap = { k:'K', q:'Q', r:'R', b:'B', n:'N', p:'P' };
        let fen = '';
        for (let r = 0; r < 8; r++) {
            let empty = 0;
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p) {
                    if (empty > 0) { fen += empty; empty = 0; }
                    fen += p.c === 'w' ? pieceMap[p.t] : pieceMap[p.t].toLowerCase();
                } else { empty++; }
            }
            if (empty > 0) fen += empty;
            if (r < 7) fen += '/';
        }
        fen += ` ${this.turn} `;
        const cr = this.castlingRights;
        let castling = '';
        if (cr.w.k) castling += 'K'; if (cr.w.q) castling += 'Q';
        if (cr.b.k) castling += 'k'; if (cr.b.q) castling += 'q';
        fen += castling || '-';
        fen += ' ';
        if (this.enPassantTarget) {
            const files = 'abcdefgh';
            fen += files[this.enPassantTarget.c] + (8 - this.enPassantTarget.r);
        } else { fen += '-'; }
        fen += ` 0 ${this.moveCount}`;
        return fen;
    }

    async makeBotMove() {
        if (this.status !== 'active' || this.turn !== 'b') return;
        const moves = this.getAllMoves('b');
        if (moves.length === 0) return;

        if (this.botLevel >= 3) {
            try {
                const fen = this.boardToFEN();
                let moveUCI = null;

                // 1) Lichess Cloud Eval (free, millions of positions)
                try {
                    const r = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`);
                    if (r.ok) {
                        const d = await r.json();
                        if (d.pvs && d.pvs[0] && d.pvs[0].moves) {
                            moveUCI = d.pvs[0].moves.split(' ')[0];
                        }
                    }
                } catch (_) {}

                // 2) stockfish.online fallback
                if (!moveUCI) {
                    try {
                        const r = await fetch(`https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(fen)}&depth=${this.botLevel >= 4 ? 14 : 10}`);
                        if (r.ok) {
                            const d = await r.json();
                            if (d.success && d.bestmove) {
                                const m = d.bestmove.match(/bestmove\s+(\S+)/);
                                if (m) moveUCI = m[1];
                            }
                        }
                    } catch (_) {}
                }

                if (moveUCI) {
                    const files = 'abcdefgh';
                    const from = { r: 8 - parseInt(moveUCI[1]), c: files.indexOf(moveUCI[0]) };
                    const to = { r: 8 - parseInt(moveUCI[3]), c: files.indexOf(moveUCI[2]) };
                    const promo = moveUCI.length > 4 ? moveUCI[4] : null;
                    const piece = this.board[from.r][from.c];
                    if (piece && piece.c === 'b' && this.isValidMove(piece, from.r, from.c, to.r, to.c)) {
                        if (promo && piece.t === 'p') piece.t = promo;
                        this.move(this.p2Id, from, to);
                        return;
                    }
                }
            } catch (e) {
                console.log('Bot API fallback:', e.message);
            }
        }

        let chosen;
        if (this.botLevel === 1) chosen = moves[Math.floor(Math.random() * moves.length)];
        else if (this.botLevel === 2) {
            const captures = moves.filter(m => m.score > 0);
            chosen = captures.length > 0 ? captures[Math.floor(Math.random() * captures.length)] : moves[Math.floor(Math.random() * moves.length)];
        } else {
            moves.sort((a, b) => b.score - a.score);
            chosen = moves[0].score > 0 ? moves[0] : moves[Math.floor(Math.random() * moves.length)];
        }
        this.move(this.p2Id, chosen.from, chosen.to);
    }
}

class GameEngine {
    constructor() { this.players = {}; this.battles = {}; this.challenges = {}; this.bCounter = 0; }
    addPlayer(id, data) {
        const p = db.loginOrRegister(data.username, data.color, data.skin);
        this.players[id] = { id, ...p, inBattle: false, battleId: null, dir: 'down', isMoving: false };
    }
    removePlayer(id) {
        if (this.players[id] && this.players[id].battleId) this.endBattle(this.players[id].battleId, id);
        delete this.players[id];
    }
    acceptChallenge(fromId, toId, isBot = false, botLevel = 1) {
        if (!this.players[fromId] || this.players[fromId].inBattle) return null;
        if (!isBot && (!this.players[toId] || this.players[toId].inBattle)) return null;
        const bid = 'b_' + (++this.bCounter);
        const battle = new ChessGame(bid, fromId, toId, isBot, botLevel);
        this.battles[bid] = battle;
        this.players[fromId].inBattle = true; this.players[fromId].battleId = bid;
        if (!isBot) { this.players[toId].inBattle = true; this.players[toId].battleId = bid; }
        return battle;
    }
    endBattle(bid, loserId) {
        const b = this.battles[bid]; if (!b) return null;
        const winnerId = loserId === null ? null : (loserId === b.p1Id ? b.p2Id : b.p1Id);
        if (this.players[b.p1Id]) { this.players[b.p1Id].inBattle = false; this.players[b.p1Id].battleId = null; }
        if (!b.isBot && this.players[b.p2Id]) { this.players[b.p2Id].inBattle = false; this.players[b.p2Id].battleId = null; }
        delete this.battles[bid];
        return winnerId;
    }
}

const engine = new GameEngine();

io.on('connection', (socket) => {
    socket.on('login', (data) => {
        if (!data || typeof data.username !== 'string') return;
        const username = data.username.trim().substring(0, 12) || 'Convidado';
        const color = typeof data.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '#888';
        let skin = typeof data.skin === 'string' ? data.skin.substring(0, 50) : '';
        if (!skin && db.data.skins.length > 0) skin = db.data.skins[0].name;
        engine.addPlayer(socket.id, { username, color, skin });
        socket.emit('login_success', {
            user: engine.players[socket.id],
            players: engine.players,
            barriers: db.data.objects,
            npcs: db.data.npcs,
            sceneries: db.data.sceneryMap || [],
            sceneryTemplates: db.data.sceneryTemplates || [],
            skins: db.data.skins
        });
        socket.broadcast.emit('player_joined', engine.players[socket.id]);
    });

    socket.on('move', (d) => {
        if (!d) return;
        const p = engine.players[socket.id];
        if (!p || p.inBattle) return;
        if (typeof d.x !== 'number' || typeof d.y !== 'number') return;
        if (!['up', 'down', 'left', 'right'].includes(d.dir)) return;
        p.x = d.x; p.y = d.y; p.dir = d.dir; p.isMoving = !!d.isMoving;
        io.emit('player_moved', { id: socket.id, x: d.x, y: d.y, dir: d.dir, isMoving: d.isMoving });
    });

    socket.on('chat_msg', (msg) => {
        if (typeof msg !== 'string') return;
        msg = msg.trim().substring(0, 200);
        if (!msg) return;
        io.emit('chat_bubble', { id: socket.id, msg });
    });

    // --- Barriers ---
    socket.on('create_barrier', (data) => {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        if (typeof data.w !== 'number' || typeof data.h !== 'number') return;
        if (data.w < 5 || data.h < 5 || data.w > 2000 || data.h > 2000) return;
        data.id = 'b_' + Date.now();
        db.data.objects.push(data); db.save();
        io.emit('new_barrier', data);
    });
    socket.on('delete_barrier', (id) => {
        if (typeof id !== 'string') return;
        db.data.objects = db.data.objects.filter(b => b.id !== id); db.save();
        io.emit('barrier_deleted', id);
    });
    socket.on('update_barrier', (data) => {
        if (!data || !data.id) return;
        const b = db.data.objects.find(item => item.id === data.id);
        if (b) {
            if (typeof data.x === 'number') b.x = data.x;
            if (typeof data.y === 'number') b.y = data.y;
            if (typeof data.w === 'number') b.w = data.w;
            if (typeof data.h === 'number') b.h = data.h;
            db.save();
            io.emit('barrier_updated', b);
        }
    });

    // --- NPCs ---
    socket.on('create_npc', (data) => {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        data.id = 'npc_' + Date.now();
        data.name = String(data.name || 'NPC').substring(0, 30);
        data.skin = String(data.skin || '').substring(0, 50);
        data.dir = ['up', 'down', 'left', 'right'].includes(data.dir) ? data.dir : 'down';
        if (!Array.isArray(data.dialogues) || data.dialogues.length === 0) {
            data.dialogues = [{ text: String(data.dialogue || '...').substring(0, 200), responses: [] }];
        }
        data.dialogues.forEach(d => {
            d.text = String(d.text || '...').substring(0, 200);
            if (!Array.isArray(d.responses)) d.responses = [];
            d.responses.forEach(r => {
                r.text = String(r.text || '').substring(0, 100);
                if (!['duel', 'close', 'next', 'none'].includes(r.action)) r.action = 'none';
            });
        });
        delete data.dialogue;
        db.data.npcs.push(data); db.save();
        io.emit('new_npc', data);
    });
    socket.on('delete_npc', (id) => {
        if (typeof id !== 'string') return;
        db.data.npcs = db.data.npcs.filter(n => n.id !== id); db.save();
        io.emit('npc_deleted', id);
    });
    socket.on('update_npc', (data) => {
        if (!data || !data.id) return;
        const npc = db.data.npcs.find(n => n.id === data.id);
        if (npc) {
            if (typeof data.x === 'number') npc.x = data.x;
            if (typeof data.y === 'number') npc.y = data.y;
            if (typeof data.name === 'string') npc.name = data.name.substring(0, 30);
            if (typeof data.skin === 'string') npc.skin = data.skin.substring(0, 50);
            if (['up', 'down', 'left', 'right'].includes(data.dir)) npc.dir = data.dir;
            if (Array.isArray(data.dialogues)) npc.dialogues = data.dialogues;
            db.save();
            io.emit('npc_updated', npc);
        }
    });

    // --- Scenery ---
    socket.on('place_scenery', (data) => {
        if (!data) return;
        data.id = 'sce_' + Date.now();
        if (!db.data.sceneryMap) db.data.sceneryMap = [];
        db.data.sceneryMap.push(data); db.save();
        io.emit('new_scenery', data);
    });
    socket.on('delete_scenery', (id) => {
        if (typeof id !== 'string' || !db.data.sceneryMap) return;
        db.data.sceneryMap = db.data.sceneryMap.filter(s => s.id !== id); db.save();
        io.emit('scenery_deleted', id);
    });
    socket.on('update_scenery', (data) => {
        if (!data || !db.data.sceneryMap) return;
        const s = db.data.sceneryMap.find(item => item.id === data.id);
        if (s) {
            if (typeof data.w === 'number') s.w = data.w;
            if (typeof data.h === 'number') s.h = data.h;
            if (typeof data.x === 'number') s.x = data.x;
            if (typeof data.y === 'number') s.y = data.y;
            if (typeof data.z === 'number') s.z = data.z;
            db.save();
            io.emit('scenery_updated', s);
        }
    });

    // --- Challenges & Battle ---
    socket.on('challenge_send', (toId) => {
        if (typeof toId !== 'string' || !engine.players[socket.id] || !engine.players[toId]) return;
        if (engine.players[socket.id].inBattle || engine.players[toId].inBattle) return;
        engine.challenges[socket.id] = toId;
        io.to(toId).emit('challenge_received', { challengeId: socket.id, fromName: engine.players[socket.id].username });
    });
    socket.on('challenge_respond', (data) => {
        if (!data || typeof data.challengeId !== 'string') return;
        if (data.accept && engine.challenges[data.challengeId]) {
            const battle = engine.acceptChallenge(data.challengeId, socket.id);
            if (battle) {
                const p1 = engine.players[battle.p1Id], p2 = engine.players[battle.p2Id];
                io.to(battle.p1Id).emit('battle_start', { mySide: 'w', opp: { name: p2.username, skin: p2.skin, color: p2.color }, state: battle });
                io.to(battle.p2Id).emit('battle_start', { mySide: 'b', opp: { name: p1.username, skin: p1.skin, color: p1.color }, state: battle });
                io.emit('player_in_battle', { p1Id: battle.p1Id, p2Id: battle.p2Id });
            }
        }
        delete engine.challenges[data.challengeId];
    });
    socket.on('challenge_npc', (npcId) => {
        if (typeof npcId !== 'string') return;
        const npc = db.data.npcs.find(n => n.id === npcId);
        if (npc && npc.isBot) {
            const battle = engine.acceptChallenge(socket.id, npc.id, true, npc.botLevel);
            if (battle) {
                socket.emit('battle_start', { mySide: 'w', opp: { name: npc.name, skin: npc.skin, color: '#f44336' }, state: battle });
                io.emit('player_in_battle', { p1Id: socket.id, p2Id: null });
            }
        }
    });
    socket.on('chess_move', (data) => {
        if (!data) return;
        const p = engine.players[socket.id];
        if (!p || !p.battleId) return;
        const b = engine.battles[p.battleId];
        if (!b || !data.from || !data.to) return;
        const { from, to } = data;
        if (from.r < 0 || from.r > 7 || from.c < 0 || from.c > 7) return;
        if (to.r < 0 || to.r > 7 || to.c < 0 || to.c > 7) return;
        if (b.move(socket.id, from, to)) {
            io.to(b.p1Id).emit('chess_update', b);
            if (!b.isBot) io.to(b.p2Id).emit('chess_update', b);
            if (b.status === 'active' && b.isBot) {
                const battleId = b.id;
                setTimeout(async () => {
                    const bRef = engine.battles[battleId];
                    if (!bRef || bRef.status !== 'active') return;
                    await bRef.makeBotMove();
                    io.to(bRef.p1Id).emit('chess_update', bRef);
                    if (bRef.status !== 'active') handleBattleEnd(bRef);
                }, 800);
            } else if (b.status !== 'active') handleBattleEnd(b);
        }
    });
    socket.on('battle_forfeit', () => {
        const p = engine.players[socket.id];
        if (!p || !p.battleId) return;
        const b = engine.battles[p.battleId];
        if (!b) { p.inBattle = false; p.battleId = null; return; }
        const winnerId = engine.endBattle(b.id, socket.id);
        if (winnerId && !b.isBot) io.to(winnerId).emit('battle_end', { winner: true });
        socket.emit('battle_end', { winner: false });
        io.emit('player_left_battle', { p1Id: b.p1Id, p2Id: b.isBot ? null : b.p2Id });
    });
    socket.on('disconnect', () => {
        const p = engine.players[socket.id];
        if (p && p.battleId) {
            const b = engine.battles[p.battleId];
            if (b) {
                const winnerId = engine.endBattle(p.battleId, socket.id);
                if (winnerId && !b.isBot) io.to(winnerId).emit('battle_end', { winner: true });
                io.emit('player_left_battle', { p1Id: b.p1Id, p2Id: b.isBot ? null : b.p2Id });
            } else { p.inBattle = false; p.battleId = null; }
        }
        engine.removePlayer(socket.id);
        io.emit('player_left', socket.id);
    });
    function handleBattleEnd(b) {
        const isStalemate = b.status === 'stalemate';
        const loserId = isStalemate ? null : (b.winner === b.p1Id ? b.p2Id : b.p1Id);
        if (loserId) engine.endBattle(b.id, loserId); else engine.endBattle(b.id, null);
        io.to(b.p1Id).emit('battle_end', { winner: isStalemate ? null : b.winner === b.p1Id, stalemate: isStalemate });
        if (!b.isBot) io.to(b.p2Id).emit('battle_end', { winner: isStalemate ? null : b.winner === b.p2Id, stalemate: isStalemate });
        io.emit('player_left_battle', { p1Id: b.p1Id, p2Id: b.isBot ? null : b.p2Id });
    }
});

http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
