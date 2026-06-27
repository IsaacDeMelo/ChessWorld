const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const PORT = process.env.PORT || 3000;
const MONGO_URI = 'mongodb+srv://kingkongdev2005_db_user:yYtXsbfrRLoIWq4O@cluster0.raovnbb.mongodb.net/chessworld?retryWrites=true&w=majority';
const DB_NAME = 'chessworld';

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '')}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// JSON limit setado para suportar upload do Tileset Base64 gigante
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

app.get('/favicon.ico', (_, res) => res.status(204).end());

let db;
let crazyModeEnabled = false;

const DEFAULT_BOARD_COLOR = '#8b6d4a';
const DEFAULT_PIECE_TYPE = 'classic';
const DEFAULT_MUSIC = 'classic';

async function connectDB() {
    const client = new MongoClient(MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        family: 4
    });

    await client.connect();

    db = client.db(DB_NAME);

    console.log('MongoDB conectado:', DB_NAME);

    await db.collection('players').createIndex({
        username: 1
    }, {
        unique: true
    });
}

app.get('/api/data', async (_, res) => {
    const [skins, sceneryTemplates, globalBg, areaBgs, piecePacks] = await Promise.all([
        db.collection('skins').find().toArray(),
        db.collection('scenery_templates').find().toArray(),
        db.collection('global_background').findOne({}),
        db.collection('area_backgrounds').find().toArray(),
        db.collection('piece_packs').find().toArray()
    ]);
    res.json({ skins, scenery: sceneryTemplates, globalBackground: globalBg, areaBackgrounds: areaBgs, piecePacks });
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Sem arquivo' });
    const type = req.body.type;
    const name = (req.body.name ? String(req.body.name) : `Img_${Date.now()}`).substring(0, 50);
    const item = { name, url: `/uploads/${req.file.filename}` };
    try {
        if (type === 'skin') await db.collection('skins').insertOne(item);
        else await db.collection('scenery_templates').insertOne(item);
        res.json({ success: true, item, type });
    } catch (e) { res.json({ success: false, error: 'Erro ao salvar no banco: ' + e.message }); }
});

app.post('/api/skin/rename', async (req, res) => {
    const { id, newName } = req.body;
    if (!id || !newName) return res.json({ success: false, error: 'Dados invalidos' });
    const { ObjectId } = require('mongodb');
    let query; try { query = { _id: new ObjectId(id) }; } catch { query = { id }; }
    const result = await db.collection('skins').findOneAndUpdate( query, { $set: { name: newName.substring(0, 50) } }, { returnDocument: 'after' } );
    if (!result) return res.json({ success: false, error: 'Skin nao encontrada' });
    res.json({ success: true, skin: result });
});

app.post('/api/skin/delete', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.json({ success: false, error: 'ID invalido' });
    const { ObjectId } = require('mongodb');
    let query; try { query = { _id: new ObjectId(id) }; } catch { query = { id }; }
    const result = await db.collection('skins').deleteOne(query);
    if (result.deletedCount === 0) return res.json({ success: false, error: 'Skin nao encontrada' });
    res.json({ success: true });
});

app.get('/api/backgrounds', async (_, res) => {
    const [globalBg, areaBgs] = await Promise.all([ db.collection('global_background').findOne({}), db.collection('area_backgrounds').find().toArray() ]);
    res.json({ global: globalBg, areas: areaBgs });
});

app.post('/api/background/global', async (req, res) => {
    const { url, tileSize } = req.body;
    if (!url) return res.json({ success: false, error: 'URL obrigatoria' });
    await db.collection('global_background').deleteMany({});
    await db.collection('global_background').insertOne({ url, tileSize: tileSize || 256, updatedAt: new Date() });
    io.emit('global_background_update', { url, tileSize: tileSize || 256 });
    res.json({ success: true });
});

app.post('/api/background/area', async (req, res) => {
    const { x, y, w, h, url, z } = req.body;
    if (!url || typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') return res.json({ success: false, error: 'Dados invalidos' });
    const area = { id: 'bg_' + Date.now(), x, y, w, h, url, z: z || 0, createdAt: new Date() };
    await db.collection('area_backgrounds').insertOne(area); io.emit('area_background_added', area); res.json({ success: true, area });
});

app.post('/api/background/area/delete', async (req, res) => {
    const { id } = req.body; if (!id) return res.json({ success: false, error: 'ID invalido' });
    await db.collection('area_backgrounds').deleteOne({ id }); io.emit('area_background_deleted', id); res.json({ success: true });
});

app.post('/api/background/area/update', async (req, res) => {
    const { id, x, y, w, h, url, z } = req.body;
    if (!id) return res.json({ success: false, error: 'ID invalido' });
    const update = {}; if (typeof x === 'number') update.x = x; if (typeof y === 'number') update.y = y; if (typeof w === 'number') update.w = w; if (typeof h === 'number') update.h = h; if (url) update.url = url; if (typeof z === 'number') update.z = z;
    await db.collection('area_backgrounds').updateOne({ id }, { $set: update });
    io.emit('area_background_updated', { id, ...update }); res.json({ success: true });
});

// === Sistema de Inventário ===
app.post('/api/inventory/add', async (req, res) => {
    const { username, itemId, qty } = req.body;
    if (!username || !itemId) return res.json({ success: false, error: 'Dados invalidos' });
    await db.collection('players').updateOne({ username }, { $push: { inventory: { itemId, qty: qty || 1, addedAt: new Date() } } });
    res.json({ success: true });
});

app.get('/api/inventory/:username', async (req, res) => {
    const player = await db.collection('players').findOne({ username: req.params.username });
    res.json({ inventory: player?.inventory || [] });
});

// === Rota antiga e Nova do Tileset de Peças ===
app.get('/api/piece-packs', async (_, res) => { const packs = await db.collection('piece_packs').find().toArray(); res.json({ packs }); });

app.post('/api/piece-packs', upload.array('pieces', 12), async (req, res) => {
    const files = req.files; if (!files || files.length !== 12) return res.json({ success: false, error: 'Envie exatamente 12 imagens' });
    const name = (req.body.name ? String(req.body.name) : `Pack_${Date.now()}`).substring(0, 50);
    const pieces = {}; const order = ['k','q','r','b','n','p'];
    files.forEach((f, i) => { const color = i < 6 ? 'w' : 'b'; const type = order[i % 6]; pieces[`${color}_${type}`] = `/uploads/${f.filename}`; });
    const pack = { name, pieces, createdAt: new Date() };
    await db.collection('piece_packs').insertOne(pack); io.emit('piece_pack_added', pack); res.json({ success: true, pack });
});

app.post('/api/piece-packs/tileset', async (req, res) => {
    const { name, slices } = req.body;
    if (!name || !slices || slices.length !== 12) return res.json({ success: false, error: 'Dados inválidos' });
    const packName = name.substring(0, 50); const pieces = {}; const order = ['k','q','r','b','n','p'];
    try {
        for(let i = 0; i < 12; i++) {
            const color = i < 6 ? 'w' : 'b'; const type = order[i % 6];
            const base64Data = slices[i].replace(/^data:image\/\w+;base64,/, "");
            const filename = `${Date.now()}_${color}_${type}.png`;
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, base64Data, 'base64');
            pieces[`${color}_${type}`] = `/uploads/${filename}`;
        }
        const pack = { name: packName, pieces, createdAt: new Date() };
        await db.collection('piece_packs').insertOne(pack);
        io.emit('piece_pack_added', pack);
        res.json({ success: true, pack });
    } catch (e) { res.json({ success: false, error: 'Erro ao salvar o Tileset' }); }
});

app.post('/api/piece-packs/delete', async (req, res) => {
    const { id } = req.body; if (!id) return res.json({ success: false, error: 'ID invalido' });
    const { ObjectId } = require('mongodb'); let query; try { query = { _id: new ObjectId(id) }; } catch { query = { id }; }
    await db.collection('piece_packs').deleteOne(query); io.emit('piece_pack_deleted', id); res.json({ success: true });
});

app.get('/api/crazy-mode', async (_, res) => { res.json({ enabled: crazyModeEnabled }); });
app.post('/api/crazy-mode/toggle', async (req, res) => {
    const { enabled } = req.body; if (typeof enabled !== 'boolean') return res.json({ success: false, error: 'Valor invalido' });
    crazyModeEnabled = enabled; io.emit('crazy_mode_update', { enabled: crazyModeEnabled }); res.json({ success: true, enabled: crazyModeEnabled });
});

app.post('/api/register', async (req, res) => {
    const { username, password, skin, bio, pieceType, music, boardColor } = req.body;
    if (!username || !password) return res.json({ success: false, error: 'Usuario e senha obrigatorios' });
    const cleanUsername = username.trim().substring(0, 12);
    if (cleanUsername.length < 3) return res.json({ success: false, error: 'Nome deve ter 3-12 caracteres' });
    if (password.length < 4) return res.json({ success: false, error: 'Senha deve ter pelo menos 4 caracteres' });
    if (await db.collection('players').findOne({ username: cleanUsername })) return res.json({ success: false, error: 'Usuario ja existe' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const player = { username: cleanUsername, password: hashedPassword, skin: skin?.substring(0, 50) || '', bio: bio?.substring(0, 200) || '', pieceType: pieceType || DEFAULT_PIECE_TYPE, music: music || DEFAULT_MUSIC, boardColor: boardColor || DEFAULT_BOARD_COLOR, x: 100, y: 100, xp: 0, level: 1, wins: 0, losses: 0, createdAt: new Date() };
    await db.collection('players').insertOne(player); res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, error: 'Usuario e senha obrigatorios' });
    const player = await db.collection('players').findOne({ username: username.trim() });
    if (!player) return res.json({ success: false, error: 'Usuario nao encontrado' });
    let valid = false; const storedHash = player.password;
    if (storedHash && (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$'))) { valid = await bcrypt.compare(password, storedHash); } else {
        valid = password === storedHash; if (valid) { const newHash = await bcrypt.hash(password, 10); await db.collection('players').updateOne({ username: player.username }, { $set: { password: newHash } }); }
    }
    if (!valid) return res.json({ success: false, error: 'Senha incorreta' });
    res.json({ success: true, player: { username: player.username, skin: player.skin, bio: player.bio, pieceType: player.pieceType, music: player.music, boardColor: player.boardColor, x: player.x, y: player.y, xp: player.xp, level: player.level, wins: player.wins, losses: player.losses }});
});

// --- IA de NPCs (Aggro) ---
function runNpcAI() {
    setInterval(() => {
        for (const zoneId in engine.zones) {
            const zone = engine.zones[zoneId];
            zone.npcs.forEach(npc => {
                if (!npc.isAggro) return;

                const players = Object.values(zone.players);
                let closest = null;
                let minDist = npc.aggroRadius || 200; 

                players.forEach(p => {
                    const dist = Math.hypot(p.x - npc.x, p.y - npc.y);
                    if (dist < minDist) { minDist = dist; closest = p; }
                });

                if (closest) {
                    // Algoritmo de perseguição (vetor de direção)
                    const dx = closest.x - npc.x;
                    const dy = closest.y - npc.y;
                    const dist = Math.hypot(dx, dy);
                    
                    if (dist > 30) { // Se não colidiu ainda
                        const speed = 2;
                        npc.x += (dx / dist) * speed;
                        npc.y += (dy / dist) * speed;
                        
                        // Atualiza direção para animação
                        npc.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
                        
                        // Sincroniza posição para os clientes
                        for (const pid in zone.players) {
                            io.to(pid).emit('npc_moved', { id: npc.id, x: npc.x, y: npc.y, dir: npc.dir });
                        }
                    } else {
                        // Se colidiu ou chegou muito perto, inicia duelo (simulado)
                        // Poderia disparar evento de 'challenge_npc' aqui
                    }
                }
            });
        }
    }, 100);
}

// Inicia a IA
runNpcAI();
const PIECE_VAL = { p: 10, n: 30, b: 30, r: 50, q: 90, k: 900 };

class ChessGame {
    constructor(id, p1Id, p2Id, isBot = false, botLevel = 1, crazyMode = false) {
        this.id = id; this.p1Id = p1Id; this.p2Id = p2Id;
        this.isBot = isBot; this.botLevel = botLevel;
        this.crazyMode = crazyMode;
        this.turn = 'w'; this.status = 'active'; this.winner = null;
        this.lastAction = null; this.moveCount = 0;
        this.castlingRights = { w: { k: true, q: true }, b: { k: true, q: true } };
        this.enPassantTarget = null;
        this.board = this.initBoard();
    }
    initBoard() {
        const createPiece = (t, c) => ({ t, c, cd: 0 });
        const row = (c) => [ createPiece('r', c), createPiece('n', c), createPiece('b', c), createPiece('q', c), createPiece('k', c), createPiece('b', c), createPiece('n', c), createPiece('r', c) ];
        const p = (c) => Array(8).fill(null).map(() => createPiece('p', c));
        const e = () => Array(8).fill(null);
        return [row('b'), p('b'), e(), e(), e(), e(), p('w'), row('w')];
    }
    findKing(color) {
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
            if (this.board[r][c] && this.board[r][c].t === 'k' && this.board[r][c].c === color) return { r, c };
        return null;
    }
    isClearPath(fr, fc, tr, tc) {
        const rDir = Math.sign(tr - fr), cDir = Math.sign(tc - fc);
        let r = fr + rDir, c = fc + cDir;
        while (r !== tr || c !== tc) { if (this.board[r][c]) return false; r += rDir; c += cDir; }
        return true;
    }
    isSquareAttackedBy(r, c, attackerColor) {
        for (let fr = 0; fr < 8; fr++) {
            for (let fc = 0; fc < 8; fc++) {
                const p = this.board[fr][fc]; if (!p || p.c !== attackerColor) continue;
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
        const king = this.findKing(color); if (!king) return false;
        return this.isSquareAttackedBy(king.r, king.c, color === 'w' ? 'b' : 'w');
    }
    isRawValidMove(piece, fr, fc, tr, tc) {
        const dr = tr - fr, dc = tc - fc; if (dr === 0 && dc === 0) return false;
        const target = this.board[tr][tc]; if (target && target.c === piece.c) return false;
        if (piece.t === 'p') {
            const dir = piece.c === 'w' ? -1 : 1; const startRow = piece.c === 'w' ? 6 : 1;
            if (dc === 0 && !target) { if (dr === dir) return true; if (dr === dir * 2 && fr === startRow && !this.board[fr + dir][fc]) return true; }
            if (Math.abs(dc) === 1 && dr === dir) { if (target) return true; if (this.enPassantTarget && this.enPassantTarget.r === tr && this.enPassantTarget.c === tc) return true; }
            return false;
        }
        if (piece.t === 'r') return (dr === 0 || dc === 0) && this.isClearPath(fr, fc, tr, tc);
        if (piece.t === 'b') return Math.abs(dr) === Math.abs(dc) && this.isClearPath(fr, fc, tr, tc);
        if (piece.t === 'q') return (dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc)) && this.isClearPath(fr, fc, tr, tc);
        if (piece.t === 'n') return (Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2);
        if (piece.t === 'k') {
            if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) return true;
            if (dr === 0 && Math.abs(dc) === 2) {
                const color = piece.c, row = color === 'w' ? 7 : 0; if (fr !== row) return false;
                const rights = this.castlingRights[color], enemy = color === 'w' ? 'b' : 'w';
                if (dc === 2 && rights.k) { return !this.board[row][5] && !this.board[row][6] && !this.isSquareAttackedBy(row, 4, enemy) && !this.isSquareAttackedBy(row, 5, enemy) && !this.isSquareAttackedBy(row, 6, enemy); }
                if (dc === -2 && rights.q) { return !this.board[row][1] && !this.board[row][2] && !this.board[row][3] && !this.isSquareAttackedBy(row, 4, enemy) && !this.isSquareAttackedBy(row, 3, enemy) && !this.isSquareAttackedBy(row, 2, enemy); }
            }
            return false;
        }
        return false;
    }
    wouldLeaveInCheck(piece, fr, fc, tr, tc) {
        const target = this.board[tr][tc];
        const capturedEnPassant = piece.t === 'p' && this.enPassantTarget && tr === this.enPassantTarget.r && tc === this.enPassantTarget.c && !target;
        let enPassantCaptured = null;
        if (capturedEnPassant) { const epRow = piece.c === 'w' ? tr + 1 : tr - 1; enPassantCaptured = this.board[epRow][tc]; this.board[epRow][tc] = null; }
        this.board[tr][tc] = piece; this.board[fr][fc] = null;
        const inCheck = this.isKingInCheck(piece.c);
        this.board[fr][fc] = piece; this.board[tr][tc] = target;
        if (capturedEnPassant) { const epRow = piece.c === 'w' ? tr + 1 : tr - 1; this.board[epRow][tc] = enPassantCaptured; }
        return inCheck;
    }
    isValidMove(piece, fr, fc, tr, tc) {
        return this.isRawValidMove(piece, fr, fc, tr, tc) && !this.wouldLeaveInCheck(piece, fr, fc, tr, tc);
    }

    reduceCooldownsAndWalls(currentColor) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && p.c === currentColor && p.cd > 0) p.cd--;
            }
        }
    }

    usePower(socketId, from, to) {
        if (this.status !== 'active' || !this.crazyMode) return false;
        const color = socketId === this.p1Id ? 'w' : (socketId === this.p2Id ? 'b' : null);
        if (color !== this.turn) return false;

        const piece = this.board[from.r][from.c];
        if (!piece || piece.c !== color || piece.cd > 0) return false;

        let powerUsed = false;
        const dr = to.r - from.r, dc = to.c - from.c;
        const adr = Math.abs(dr), adc = Math.abs(dc);
        const target = this.board[to.r][to.c];

        if (piece.t === 'p') {
            // Pawn power: move 1 square diagonally forward without capturing
            const dir = color === 'w' ? -1 : 1;
            if (dr === dir && adc === 1 && !target) {
                this.board[to.r][to.c] = piece; this.board[from.r][from.c] = null;
                powerUsed = true;
            }
        } else if (piece.t === 'n') {
            // Knight power: move 1 square in any direction
            if (adr <= 1 && adc <= 1 && (adr + adc > 0) && !target) {
                this.board[to.r][to.c] = piece; this.board[from.r][from.c] = null;
                powerUsed = true;
            }
        } else if (piece.t === 'b') {
            // Bishop power: move like a knight (L-shape)
            if ((adr === 2 && adc === 1) || (adr === 1 && adc === 2)) {
                if (!target || target.c !== color) {
                    this.board[to.r][to.c] = piece; this.board[from.r][from.c] = null;
                    powerUsed = true;
                }
            }
        } else if (piece.t === 'r') {
            // Rook power: move 1 square diagonally
            if (adr === 1 && adc === 1) {
                if (!target || target.c !== color) {
                    this.board[to.r][to.c] = piece; this.board[from.r][from.c] = null;
                    powerUsed = true;
                }
            }
        } else if (piece.t === 'q') {
            // Queen power: move like a knight (L-shape)
            if ((adr === 2 && adc === 1) || (adr === 1 && adc === 2)) {
                if (!target || target.c !== color) {
                    this.board[to.r][to.c] = piece; this.board[from.r][from.c] = null;
                    powerUsed = true;
                }
            }
        } else if (piece.t === 'k') {
            // King power: move 2 squares in any direction (like a double-step)
            if (adr <= 2 && adc <= 2 && (adr + adc > 0) && !target) {
                if (adr <= 2 && adc <= 2) {
                    this.board[to.r][to.c] = piece; this.board[from.r][from.c] = null;
                    powerUsed = true;
                }
            }
        }

        if (powerUsed) {
            piece.cd = 4;
            this.moveCount++;
            const enemy = color === 'w' ? 'b' : 'w';
            this.turn = enemy;
            this.reduceCooldownsAndWalls(enemy);
            this.lastAction = { from, to, isCapture: false, isPower: true, powerType: piece.t, attackerType: piece.t, side: color, moveCount: this.moveCount, inCheck: false };
            return true;
        }
        return false;
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
            else { 
                this.turn = enemy; 
                if(this.crazyMode) this.reduceCooldownsAndWalls(enemy);
            }
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
        const cr = this.castlingRights; let castling = '';
        if (cr.w.k) castling += 'K'; if (cr.w.q) castling += 'Q';
        if (cr.b.k) castling += 'k'; if (cr.b.q) castling += 'q';
        fen += castling || '-'; fen += ' ';
        if (this.enPassantTarget) { const files = 'abcdefgh'; fen += files[this.enPassantTarget.c] + (8 - this.enPassantTarget.r); } else { fen += '-'; }
        fen += ` 0 ${this.moveCount}`; return fen;
    }
    async makeBotMove() {
        if (this.status !== 'active' || this.turn !== 'b') return;
        const moves = this.getAllMoves('b'); if (moves.length === 0) return;
        if (this.botLevel >= 3) {
            try {
                const fen = this.boardToFEN(); let moveUCI = null;
                try {
                    const r = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`);
                    if (r.ok) { const d = await r.json(); if (d.pvs && d.pvs[0] && d.pvs[0].moves) moveUCI = d.pvs[0].moves.split(' ')[0]; }
                } catch (_) {}
                if (!moveUCI) {
                    try {
                        const r = await fetch(`https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(fen)}&depth=${this.botLevel >= 4 ? 14 : 10}`);
                        if (r.ok) { const d = await r.json(); if (d.success && d.bestmove) { const m = d.bestmove.match(/bestmove\s+(\S+)/); if (m) moveUCI = m[1]; } }
                    } catch (_) {}
                }
                if (moveUCI) {
                    const files = 'abcdefgh'; const from = { r: 8 - parseInt(moveUCI[1]), c: files.indexOf(moveUCI[0]) }; const to = { r: 8 - parseInt(moveUCI[3]), c: files.indexOf(moveUCI[2]) }; const promo = moveUCI.length > 4 ? moveUCI[4] : null; const piece = this.board[from.r][from.c];
                    if (piece && piece.c === 'b' && this.isValidMove(piece, from.r, from.c, to.r, to.c)) { if (promo && piece.t === 'p') piece.t = promo; this.move(this.p2Id, from, to); return; }
                }
            } catch (e) { console.log('Bot API fallback:', e.message); }
        }
        let chosen;
        if (this.botLevel === 1) chosen = moves[Math.floor(Math.random() * moves.length)];
        else if (this.botLevel === 2) { const captures = moves.filter(m => m.score > 0); chosen = captures.length > 0 ? captures[Math.floor(Math.random() * captures.length)] : moves[Math.floor(Math.random() * moves.length)]; } 
        else { moves.sort((a, b) => b.score - a.score); chosen = moves[0].score > 0 ? moves[0] : moves[Math.floor(Math.random() * moves.length)]; }
        this.move(this.p2Id, chosen.from, chosen.to);
    }
}

class GameEngine {
    constructor() {
        this.zones = { 'main': { players: {}, npcs: [], sceneries: [], barriers: [], walls: [], areaBgs: [] } };
        this.players = {}; 
        this.battles = {}; this.challenges = {}; this.bCounter = 0;
    }

    joinZone(socketId, zoneId) {
        const player = this.players[socketId];
        if (!player) return;
        
        // Remove da zona antiga
        if (player.zoneId && this.zones[player.zoneId]) {
            delete this.zones[player.zoneId].players[socketId];
        }
        
        // Adiciona na nova
        player.zoneId = zoneId;
        if (!this.zones[zoneId]) {
            this.zones[zoneId] = { players: {}, npcs: [], sceneries: [], barriers: [], walls: [], areaBgs: [] };
        }
        this.zones[zoneId].players[socketId] = player;
    }

    addPlayer(id, data, zoneId = 'main') {
        this.players[id] = { id, ...data, inBattle: false, battleId: null, dir: 'down', isMoving: false, zoneId };
        this.joinZone(id, zoneId);
    }

    removePlayer(id) {
        const player = this.players[id];
        if (player) {
            if (player.battleId) this.endBattle(player.battleId, id);
            if (player.zoneId && this.zones[player.zoneId]) {
                delete this.zones[player.zoneId].players[id];
            }
            delete this.players[id];
        }
    }
    acceptChallenge(fromId, toId, isBot = false, botLevel = 1) {
        if (!this.players[fromId] || this.players[fromId].inBattle) return null;
        if (!isBot && (!this.players[toId] || this.players[toId].inBattle)) return null;
        const bid = 'b_' + (++this.bCounter);
        const battle = new ChessGame(bid, fromId, toId, isBot, botLevel, crazyModeEnabled);
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
        delete this.battles[bid]; return winnerId;
    }
}

const engine = new GameEngine();

io.on('connection', (socket) => {
    socket.on('login', async (data) => {
        if (!data || typeof data.username !== 'string' || typeof data.password !== 'string') return;
        const username = data.username.trim().substring(0, 12); const password = data.password;
        if (username.length < 3) return socket.emit('login_error', { error: 'Nome invalido' });
        const player = await db.collection('players').findOne({ username });
        if (!player) return socket.emit('login_error', { error: 'Usuario nao encontrado' });
        let valid = false; const storedHash = player.password;
        if (storedHash && (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$'))) { valid = await bcrypt.compare(password, storedHash); } else { valid = password === storedHash; if (valid) { const newHash = await bcrypt.hash(password, 10); await db.collection('players').updateOne({ username }, { $set: { password: newHash } }); } }
        if (!valid) return socket.emit('login_error', { error: 'Senha incorreta' });
        const skin = player.skin || ''; const color = player.boardColor || '#888';
        const isAdmin = player.username === 'Isaac';
        engine.addPlayer(socket.id, { username, color, skin, pieceType: player.pieceType || 'classic', x: player.x || 100, y: player.y || 100, isAdmin });
       const [npcs, sceneries, barriers, walls] = await Promise.all([
            db.collection('npcs').find().toArray(), 
            db.collection('scenery_map').find().toArray(), 
            db.collection('barriers').find().toArray(), 
            db.collection('walls').find().toArray()
        ]);
        
        socket.emit('login_success', { 
            zoneId: 'main', 
            user: engine.players[socket.id], 
            playerData: { 
                username: player.username, 
                skin: player.skin, 
                bio: player.bio, 
                pieceType: player.pieceType, 
                music: player.music, 
                boardColor: player.boardColor, 
                xp: player.xp, 
                level: player.level, 
                wins: player.wins, 
                losses: player.losses, 
                isAdmin 
            }, 
            players: engine.zones['main'].players, 
            barriers, 
            walls, 
            npcs, 
            sceneries 
        });
        
        socket.broadcast.emit('player_joined', { zoneId: 'main', player: engine.players[socket.id] });
    });

    socket.on('join_zone', (zoneId) => {
        engine.joinZone(socket.id, zoneId);
        const zoneData = engine.zones[zoneId];
        socket.emit('zone_snapshot', {
            zoneId,
            players: Object.values(zoneData.players),
            npcs: zoneData.npcs,
            sceneries: zoneData.sceneries,
            barriers: zoneData.barriers,
            walls: zoneData.walls
        });
    });


    socket.on('chat_msg', (msg) => {
        if (typeof msg !== 'string') return; msg = msg.trim().substring(0, 200); if (!msg) return;
        io.emit('chat_bubble', { id: socket.id, msg });
    });

    // CRUD Eventos Omitidos para poupar espaço visual no resumo, pois já estão contidos acima nas rotas. As respostas em real-time estão ativas.
    socket.on('create_barrier', async (data) => { if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return; data.id = 'b_' + Date.now(); await db.collection('barriers').insertOne(data); io.emit('new_barrier', data); });
    socket.on('delete_barrier', async (id) => { if (typeof id !== 'string') return; await db.collection('barriers').deleteOne({ id }); io.emit('barrier_deleted', id); });
    socket.on('update_barrier', async (data) => { if (!data || !data.id) return; const update = {}; if (typeof data.x === 'number') update.x = data.x; if (typeof data.y === 'number') update.y = data.y; if (typeof data.w === 'number') update.w = data.w; if (typeof data.h === 'number') update.h = data.h; await db.collection('barriers').updateOne({ id: data.id }, { $set: update }); io.emit('barrier_updated', { ...data, ...update }); });

    socket.on('create_wall', async (data) => { if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return; data.id = 'w_' + Date.now(); await db.collection('walls').insertOne(data); io.emit('new_wall', data); });
    socket.on('delete_wall', async (id) => { if (typeof id !== 'string') return; await db.collection('walls').deleteOne({ id }); io.emit('wall_deleted', id); });
    socket.on('update_wall', async (data) => { if (!data || !data.id) return; const update = {}; if (typeof data.x === 'number') update.x = data.x; if (typeof data.y === 'number') update.y = data.y; if (typeof data.w === 'number') update.w = data.w; if (typeof data.h === 'number') update.h = data.h; await db.collection('walls').updateOne({ id: data.id }, { $set: update }); io.emit('wall_updated', { ...data, ...update }); });

    socket.on('create_global_background', async (data) => { if (!data || !data.url) return; const tileSize = data.tileSize || 256; await db.collection('global_background').deleteMany({}); await db.collection('global_background').insertOne({ url: data.url, tileSize, updatedAt: new Date() }); io.emit('global_background_update', { url: data.url, tileSize }); });
    socket.on('create_area_background', async (data) => { if (!data || !data.url || typeof data.x !== 'number' || typeof data.y !== 'number' || typeof data.w !== 'number' || typeof data.h !== 'number') return; const area = { id: 'bg_' + Date.now(), x: data.x, y: data.y, w: data.w, h: data.h, url: data.url, z: data.z || 0, createdAt: new Date() }; await db.collection('area_backgrounds').insertOne(area); io.emit('area_background_added', area); });
    socket.on('delete_area_background', async (id) => { if (typeof id !== 'string') return; await db.collection('area_backgrounds').deleteOne({ id }); io.emit('area_background_deleted', id); });
    socket.on('update_area_background', async (data) => { if (!data || !data.id) return; const update = {}; if (typeof data.x === 'number') update.x = data.x; if (typeof data.y === 'number') update.y = data.y; if (typeof data.w === 'number') update.w = data.w; if (typeof data.h === 'number') update.h = data.h; if (data.url) update.url = data.url; if (typeof data.z === 'number') update.z = data.z; await db.collection('area_backgrounds').updateOne({ id: data.id }, { $set: update }); io.emit('area_background_updated', { id: data.id, ...update }); });

    socket.on('create_npc', async (data) => { if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return; data.id = 'npc_' + Date.now(); data.name = String(data.name || 'NPC').substring(0, 30); data.skin = String(data.skin || '').substring(0, 50); data.dir = ['up', 'down', 'left', 'right'].includes(data.dir) ? data.dir : 'down'; data.pieceType = String(data.pieceType || '').substring(0, 20); data.piecePack = String(data.piecePack || '').substring(0, 50); if (!Array.isArray(data.dialogues) || data.dialogues.length === 0) { data.dialogues = [{ text: String(data.dialogue || '...').substring(0, 200), responses: [] }]; } data.dialogues.forEach(d => { d.text = String(d.text || '...').substring(0, 200); if (!Array.isArray(d.responses)) d.responses = []; d.responses.forEach(r => { r.text = String(r.text || '').substring(0, 100); if (!['duel', 'close', 'next', 'none'].includes(r.action)) r.action = 'none'; }); }); delete data.dialogue; await db.collection('npcs').insertOne(data); io.emit('new_npc', data); });
    socket.on('delete_npc', async (id) => { if (typeof id !== 'string') return; await db.collection('npcs').deleteOne({ id }); io.emit('npc_deleted', id); });
    socket.on('update_npc', async (data) => { if (!data || !data.id) return; const update = {}; if (typeof data.x === 'number') update.x = data.x; if (typeof data.y === 'number') update.y = data.y; if (typeof data.name === 'string') update.name = data.name.substring(0, 30); if (typeof data.skin === 'string') update.skin = data.skin.substring(0, 50); if (typeof data.pieceType === 'string') update.pieceType = data.pieceType.substring(0, 20); if (typeof data.piecePack === 'string') update.piecePack = data.piecePack.substring(0, 50); if (typeof data.isBot === 'boolean') update.isBot = data.isBot; if (typeof data.botLevel === 'number') update.botLevel = data.botLevel; if (['up', 'down', 'left', 'right'].includes(data.dir)) update.dir = data.dir; if (Array.isArray(data.dialogues)) update.dialogues = data.dialogues; await db.collection('npcs').updateOne({ id: data.id }, { $set: update }); io.emit('npc_updated', { id: data.id, ...update }); });

    socket.on('place_scenery', async (data) => { if (!data) return; data.id = 'sce_' + Date.now(); await db.collection('scenery_map').insertOne(data); io.emit('new_scenery', data); });
    socket.on('delete_scenery', async (id) => { if (typeof id !== 'string') return; await db.collection('scenery_map').deleteOne({ id }); io.emit('scenery_deleted', id); });
    socket.on('update_scenery', async (data) => { if (!data || !data.id) return; const update = {}; if (typeof data.w === 'number') update.w = data.w; if (typeof data.h === 'number') update.h = data.h; if (typeof data.x === 'number') update.x = data.x; if (typeof data.y === 'number') update.y = data.y; if (typeof data.z === 'number') update.z = data.z; await db.collection('scenery_map').updateOne({ id: data.id }, { $set: update }); io.emit('scenery_updated', { id: data.id, ...update }); });

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
                io.to(battle.p1Id).emit('battle_start', { mySide: 'w', opp: { name: p2.username, skin: p2.skin, color: p2.color, pieceType: p2.pieceType || 'classic' }, state: battle });
                io.to(battle.p2Id).emit('battle_start', { mySide: 'b', opp: { name: p1.username, skin: p1.skin, color: p1.color, pieceType: p1.pieceType || 'classic' }, state: battle });
                io.emit('player_in_battle', { p1Id: battle.p1Id, p2Id: battle.p2Id });
            }
        }
        delete engine.challenges[data.challengeId];
    });
    socket.on('challenge_npc', (npcId) => {
        if (typeof npcId !== 'string') return;
        db.collection('npcs').findOne({ id: npcId }).then(npc => {
            if (npc && npc.isBot) {
                const battle = engine.acceptChallenge(socket.id, npc.id, true, npc.botLevel);
                if (battle) {
                    const npcPieceType = npc.piecePack ? 'pack:' + npc.piecePack : (npc.pieceType || 'classic');
                    socket.emit('battle_start', { mySide: 'w', opp: { name: npc.name, skin: npc.skin, color: '#f44336', pieceType: npcPieceType }, state: battle });
                    io.emit('player_in_battle', { p1Id: socket.id, p2Id: null });
                }
            }
        });
    });

    socket.on('chess_power', (data) => {
        const p = engine.players[socket.id];
        if (!p || !p.battleId) return;
        const b = engine.battles[p.battleId];
        if (!b || !data.from || !data.to) return;
        
        if (b.usePower(socket.id, data.from, data.to)) {
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

    socket.on('chess_move', (data) => {
        if (!data) return;
        const p = engine.players[socket.id]; if (!p || !p.battleId) return;
        const b = engine.battles[p.battleId]; if (!b || !data.from || !data.to) return;
        const { from, to } = data;
        if (from.r < 0 || from.r > 7 || from.c < 0 || from.c > 7 || to.r < 0 || to.r > 7 || to.c < 0 || to.c > 7) return;
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
        const p = engine.players[socket.id]; if (!p || !p.battleId) return;
        const b = engine.battles[p.battleId]; if (!b) { p.inBattle = false; p.battleId = null; return; }
        const winnerId = engine.endBattle(b.id, socket.id);
        if (winnerId && !b.isBot) io.to(winnerId).emit('battle_end', { winner: true });
        socket.emit('battle_end', { winner: false });
        io.emit('player_left_battle', { p1Id: b.p1Id, p2Id: b.isBot ? null : b.p2Id });
    });

    socket.on('disconnect', async () => {
        const p = engine.players[socket.id];
        if (p) {
            if (p.battleId) {
                const b = engine.battles[p.battleId];
                if (b) {
                    const winnerId = engine.endBattle(p.battleId, socket.id);
                    if (winnerId && !b.isBot) io.to(winnerId).emit('battle_end', { winner: true });
                    io.emit('player_left_battle', { p1Id: b.p1Id, p2Id: b.isBot ? null : b.p2Id });
                }
            }
            if (p.username) await db.collection('players').updateOne({ username: p.username }, { $set: { x: p.x, y: p.y } });
        }
        engine.removePlayer(socket.id); io.emit('player_left', socket.id);
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

connectDB().then(() => {
    http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
}).catch(err => {
    console.error('Erro ao conectar MongoDB:', err);
    process.exit(1);
});
