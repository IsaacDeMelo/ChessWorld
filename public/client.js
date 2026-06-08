const socket = io();
const world = document.getElementById('game-world');
let players = {}, npcs = {}, barriers = [], sceneries = [];
let myId = null, myColor = '#888', mySkin = '', myName = '';
let availableSkins = {}, availableScenery = {};
let devMode = false, devTool = 'pointer';

// --- 8-BIT AUDIO ENGINE ---
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new AudioCtx(); return audioCtx; }
function playTone(freq, duration, type = 'square', vol = 0.15) {
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + duration);
    } catch {}
}
const SFX = {
    move()     { playTone(440, 0.08, 'square', 0.1); },
    capture()  { playTone(220, 0.1, 'square', 0.15); setTimeout(() => playTone(330, 0.15, 'square', 0.12), 80); },
    check()    { playTone(880, 0.08, 'square', 0.12); setTimeout(() => playTone(660, 0.12, 'square', 0.1), 100); },
    castle()   { playTone(523, 0.06, 'triangle', 0.12); setTimeout(() => playTone(659, 0.06, 'triangle', 0.1), 70); setTimeout(() => playTone(784, 0.1, 'triangle', 0.08), 140); },
    promote()  { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f, 0.1, 'square', 0.1), i * 80)); },
    victory()  { [523,659,784,1047,784,1047].forEach((f,i) => setTimeout(() => playTone(f, 0.15, 'square', 0.12), i * 120)); },
    defeat()   { [440,370,330,262].forEach((f,i) => setTimeout(() => playTone(f, 0.2, 'square', 0.1), i * 150)); },
    select()   { playTone(660, 0.05, 'square', 0.08); },
    invalid()  { playTone(150, 0.15, 'square', 0.1); },
    chat()     { playTone(800, 0.04, 'triangle', 0.06); },
    join()     { playTone(523, 0.06, 'triangle', 0.08); setTimeout(() => playTone(784, 0.1, 'triangle', 0.06), 80); },
    dialogue() { playTone(500, 0.04, 'triangle', 0.06); },
};

let bgmInterval = null;
const bgmNotes = [
    [262,0.2],[294,0.2],[330,0.2],[349,0.2],[392,0.3],[330,0.15],[294,0.3],
    [262,0.2],[330,0.2],[392,0.2],[523,0.3],[392,0.15],[330,0.3],
    [349,0.2],[392,0.2],[440,0.2],[523,0.3],[440,0.15],[392,0.2],[330,0.3],
    [294,0.2],[330,0.2],[392,0.2],[330,0.3],[294,0.15],[262,0.4],
];
function startBGM() {
    stopBGM(); let i = 0;
    function playNote() {
        if (i >= bgmNotes.length) i = 0;
        const [freq, dur] = bgmNotes[i];
        playTone(freq, dur * 0.9, 'triangle', 0.04);
        i++; bgmInterval = setTimeout(playNote, dur * 1000);
    }
    playNote();
}
function stopBGM() { if (bgmInterval) { clearTimeout(bgmInterval); bgmInterval = null; } }

if (socket.connected) document.getElementById('loading').classList.remove('active');

function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`; el.textContent = msg;
    document.body.appendChild(el); setTimeout(() => el.remove(), 3000);
}
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('active'); }
function showModal(id) { const el = document.getElementById(id); if (el) el.classList.add('active'); }

function updateSkinPreview(selectEl, previewEl, scale) {
    const val = selectEl.value;
    if (val && availableSkins[val]) {
        previewEl.style.display = 'flex'; previewEl.innerHTML = '';
        const sprite = document.createElement('div');
        sprite.className = 'sprite-sheet';
        sprite.style.backgroundImage = `url(${availableSkins[val]})`;
        sprite.style.backgroundPosition = '0px 0px';
        if (scale) sprite.style.transform = `scale(${scale})`;
        previewEl.appendChild(sprite);
    } else { previewEl.style.display = 'none'; }
}

async function loadSkinsFromAPI() {
    try {
        const res = await fetch('/api/data');
        const data = await res.json();
        const skinSel = document.getElementById('skin-select');
        const npcSel = document.getElementById('npc-skin-select');
        (data.skins || []).forEach(s => {
            if (!s || !s.name || !s.url) return;
            availableSkins[s.name] = s.url;
            if (![...skinSel.options].some(o => o.value === s.name)) skinSel.innerHTML += `<option value="${s.name}">${s.name}</option>`;
            if (![...npcSel.options].some(o => o.value === s.name)) npcSel.innerHTML += `<option value="${s.name}">${s.name}</option>`;
        });
        (data.scenery || []).forEach(s => { if (s && s.name && s.url) availableScenery[s.name] = s.url; });
    } catch {}
}
loadSkinsFromAPI();

function nav(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

document.getElementById('btn-submit-skin').onclick = async () => {
    const file = document.getElementById('upload-skin-file').files[0];
    const name = document.getElementById('upload-skin-name').value.trim();
    if (!file || !name) return toast('Preencha nome e arquivo!', 'error');
    const fd = new FormData();
    fd.append('type', 'skin'); fd.append('name', name); fd.append('image', file);
    try {
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success) {
            availableSkins[data.item.name] = data.item.url;
            const opt = document.createElement('option');
            opt.value = data.item.name; opt.textContent = data.item.name;
            document.getElementById('skin-select').appendChild(opt);
            document.getElementById('npc-skin-select').appendChild(opt.cloneNode(true));
            toast('Skin enviada!', 'success'); nav('screen-main');
        } else toast(data.error || 'Erro', 'error');
    } catch { toast('Erro de conexao', 'error'); }
};

let skinManagerSkins = [];
async function openSkinManager() {
    try {
        const res = await fetch('/api/data');
        const data = await res.json();
        skinManagerSkins = data.skins || [];
    } catch { skinManagerSkins = []; }
    renderSkinManager();
    nav('screen-skin-manager');
}
function renderSkinManager() {
    const list = document.getElementById('skin-manager-list');
    list.innerHTML = '';
    if (skinManagerSkins.length === 0) {
        list.innerHTML = '<div style="color:#888;font-size:9px;text-align:center;padding:20px;">NENHUMA SKIN</div>';
        return;
    }
    skinManagerSkins.forEach((skin, i) => {
        const row = document.createElement('div');
        row.className = 'skin-manager-item';
        const preview = document.createElement('div');
        preview.className = 'skin-preview';
        if (availableSkins[skin.name]) {
            const spr = document.createElement('div');
            spr.className = 'sprite-sheet';
            spr.style.backgroundImage = `url(${availableSkins[skin.name]})`;
            spr.style.backgroundPosition = '0px 0px';
            preview.appendChild(spr);
        }
        const input = document.createElement('input');
        input.className = 'pixel-input';
        input.value = skin.name;
        input.maxLength = 30;
        const saveBtn = document.createElement('button');
        saveBtn.className = 'pixel-btn btn-success btn-sm';
        saveBtn.innerText = 'OK';
        saveBtn.onclick = async () => {
            const newName = input.value.trim();
            if (!newName) return toast('Nome vazio!', 'error');
            try {
                const res = await fetch('/api/skin/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: skin.id, newName })
                });
                const data = await res.json();
                if (data.success) {
                    const oldName = skin.name;
                    skin.name = newName;
                    if (availableSkins[oldName]) {
                        availableSkins[newName] = availableSkins[oldName];
                        delete availableSkins[oldName];
                    }
                    updateSkinSelects();
                    toast('Renomeada!', 'success');
                    renderSkinManager();
                } else toast(data.error || 'Erro', 'error');
            } catch { toast('Erro de conexao', 'error'); }
        };
        const delBtn = document.createElement('button');
        delBtn.className = 'pixel-btn btn-danger btn-sm';
        delBtn.innerText = 'X';
        delBtn.onclick = async () => {
            if (!confirm(`Deletar skin "${skin.name}"?`)) return;
            try {
                const res = await fetch('/api/skin/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: skin.id })
                });
                const data = await res.json();
                if (data.success) {
                    delete availableSkins[skin.name];
                    skinManagerSkins.splice(i, 1);
                    updateSkinSelects();
                    toast('Deletada!', 'success');
                    renderSkinManager();
                } else toast(data.error || 'Erro', 'error');
            } catch { toast('Erro de conexao', 'error'); }
        };
        row.appendChild(preview);
        row.appendChild(input);
        row.appendChild(saveBtn);
        row.appendChild(delBtn);
        list.appendChild(row);
    });
}
function updateSkinSelects() {
    const selectors = [document.getElementById('skin-select'), document.getElementById('npc-skin-select')];
    selectors.forEach(sel => {
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">SELECIONE UMA SKIN</option>';
        Object.keys(availableSkins).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            sel.appendChild(opt);
        });
        if (current && availableSkins[current]) sel.value = current;
    });
}

document.querySelectorAll('.color-opt').forEach(opt => {
    opt.onclick = () => {
        document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected'); myColor = opt.dataset.c;
    };
});
document.getElementById('skin-select').onchange = (e) => {
    mySkin = e.target.value;
    updateSkinPreview(e.target, document.getElementById('skin-preview-container'), 0.9);
};
document.getElementById('npc-skin-select').onchange = (e) => {
    updateSkinPreview(e.target, document.getElementById('npc-skin-preview'), 0.9);
};

document.getElementById('btn-login').onclick = () => {
    myName = document.getElementById('username').value.trim() || 'Convidado';
    if (!mySkin) return toast('Selecione uma skin primeiro!', 'error');
    socket.emit('login', { username: myName, color: myColor, skin: mySkin });
};
document.getElementById('username').onkeypress = (e) => { if (e.key === 'Enter') document.getElementById('btn-login').click(); };

function createVisualBody(skin, color, dir) {
    const el = document.createElement('div');
    if (skin && availableSkins[skin]) {
        el.className = 'sprite-sheet';
        el.style.backgroundImage = `url(${availableSkins[skin]})`;
        const row = { down: 0, left: 48, right: 96, up: 144 }[dir] || 0;
        el.style.backgroundPosition = `0px -${row}px`;
    } else {
        el.style.cssText = `width:48px;height:48px;background:${color||'#555'};position:relative;image-rendering:pixelated;box-shadow:2px 2px 0 rgba(0,0,0,0.4);`;
        const eyes = document.createElement('div');
        eyes.style.cssText = 'position:absolute;inset:0;display:flex;justify-content:center;gap:8px;padding-top:14px;';
        for (let i=0;i<2;i++) {
            const eye = document.createElement('div');
            eye.style.cssText = 'width:8px;height:10px;background:#fff;position:relative;';
            const pupil = document.createElement('div');
            pupil.style.cssText = 'width:4px;height:5px;background:#111;position:absolute;bottom:1px;' + (dir==='left'?'left:1px;':dir==='right'?'right:1px;':'left:2px;');
            eye.appendChild(pupil); eyes.appendChild(eye);
        }
        el.appendChild(eyes);
    }
    el.dataset.skin = skin || '';
    el.dataset.dir = dir || 'down';
    return el;
}

class Entity {
    constructor(data, type) {
        this.id = data.id; this.x = data.x; this.y = data.y;
        this.dir = data.dir || 'down'; this.isMoving = false;
        this.skin = data.skin; this.color = data.color || '#888';
        this.type = type; this.data = data;
        this.targetX = data.x; this.targetY = data.y;
        this.container = document.createElement('div');
        this.container.className = type === 'npc' ? 'npc-entity' : 'player-entity';
        this.visual = createVisualBody(this.skin, this.color, this.dir);
        this.container.appendChild(this.visual);
        this.nameTag = document.createElement('div');
        this.nameTag.className = 'player-name';
        this.nameTag.innerText = data.username || data.name;
        this.bubble = document.createElement('div');
        this.bubble.className = 'bubble';
        this.container.append(this.bubble, this.nameTag);
        if (type === 'player') {
            this.badge = document.createElement('div');
            this.badge.className = 'battle-badge'; this.badge.innerText = '*';
            this.badge.style.display = data.inBattle ? 'block' : 'none';
            this.container.appendChild(this.badge);
        }
        world.appendChild(this.container); this.updatePos();
    }
    updatePos() {
        this.container.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
        this.container.style.zIndex = Math.round(this.y) + 10;
    }
    lerpToTarget() {
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.5) {
            this.x = this.targetX; this.y = this.targetY;
        } else {
            const speed = 0.25;
            this.x += dx * speed;
            this.y += dy * speed;
        }
        this.updatePos();
    }
    setTarget(x, y) { this.targetX = x; this.targetY = y; }
    animateSprite() {
        if (!this.visual.classList || !this.visual.classList.contains('sprite-sheet')) return;
        const row = { down: 0, left: 48, right: 96, up: 144 }[this.dir] || 0;
        const col = this.isMoving ? (Math.floor(Date.now() / 150) % 4) * 48 : 0;
        this.visual.style.backgroundPosition = `-${col}px -${row}px`;
    }
    setDir(dir, isMoving) {
        if (this.dir !== dir || this.isMoving !== isMoving) {
            this.dir = dir; this.isMoving = isMoving;
            if (this.visual.classList && this.visual.classList.contains('sprite-sheet')) {
                this.animateSprite();
            } else {
                const newVis = createVisualBody(this.skin, this.color, this.dir);
                this.container.replaceChild(newVis, this.visual);
                this.visual = newVis;
            }
        }
    }
    chat(msg) {
        this.bubble.textContent = msg; this.bubble.style.display = 'block';
        if (this.chatTimer) clearTimeout(this.chatTimer);
        this.chatTimer = setTimeout(() => this.bubble.style.display = 'none', 4000);
    }
    remove() { this.container.remove(); }
}

function drawScenery(s) {
    const container = document.createElement('div');
    container.className = 'scenery-container'; container.dataset.id = s.id;
    container.style.left = s.x + 'px'; container.style.top = s.y + 'px';
    container.style.width = (s.w || 64) + 'px'; container.style.height = (s.h || 64) + 'px';
    container.style.zIndex = s.z || 1;
    const img = document.createElement('img'); img.src = s.url; img.loading = 'lazy';
    const handle = document.createElement('div'); handle.className = 'resize-handle';
    container.append(img, handle);
    container.addEventListener('contextmenu', (e) => {
        if (devMode) { e.preventDefault(); e.stopPropagation(); socket.emit('delete_scenery', s.id); }
    });
    if (devMode) setupSceneryInteractions(container, s);
    world.appendChild(container); sceneries.push(container);
}

// --- Dialogue Bar ---
let currentDialogueNpc = null, currentDialogueIndex = 0;

function openDialogueBar(npcEntity) {
    const npc = npcEntity.data;
    currentDialogueNpc = npcEntity; currentDialogueIndex = 0;
    showDialoguePage(npc, 0);
    document.getElementById('dialogue-bar').classList.add('active');
    SFX.dialogue();
}

function showDialoguePage(npc, pageIndex) {
    const dialogues = npc.dialogues || [{ text: npc.dialogue || '...', responses: [] }];
    if (pageIndex >= dialogues.length) { closeDialogueBar(); return; }
    currentDialogueIndex = pageIndex;
    const page = dialogues[pageIndex];
    const portrait = document.getElementById('dialogue-portrait');
    portrait.innerHTML = '';
    const sprite = createVisualBody(npc.skin, '#fff', 'down');
    portrait.appendChild(sprite);
    document.getElementById('dialogue-name').innerText = npc.name || 'NPC';
    document.getElementById('dialogue-text').innerText = page.text || '...';
    const responsesEl = document.getElementById('dialogue-responses');
    responsesEl.innerHTML = '';
    (page.responses || []).forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'dialogue-response-btn' + (r.action === 'duel' ? ' duel-btn' : '');
        btn.innerText = r.text;
        btn.onclick = () => handleDialogueResponse(npc, r);
        responsesEl.appendChild(btn);
    });
    if ((!page.responses || page.responses.length === 0) && dialogues.length > pageIndex + 1) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'dialogue-response-btn'; nextBtn.innerText = 'PROXIMO >';
        nextBtn.onclick = () => showDialoguePage(npc, pageIndex + 1);
        responsesEl.appendChild(nextBtn);
    }
    if (!page.responses || page.responses.length === 0) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'dialogue-response-btn'; closeBtn.innerText = 'FECHAR';
        closeBtn.onclick = () => closeDialogueBar();
        responsesEl.appendChild(closeBtn);
    }
}

function handleDialogueResponse(npc, response) {
    SFX.select();
    if (response.action === 'duel') {
        closeDialogueBar();
        if (npc.isBot) socket.emit('challenge_npc', npc.id);
    } else if (response.action === 'close') {
        closeDialogueBar();
    } else if (response.action === 'next') {
        showDialoguePage(npc, currentDialogueIndex + 1);
    } else {
        const dialogues = npc.dialogues || [];
        if (currentDialogueIndex + 1 < dialogues.length) showDialoguePage(npc, currentDialogueIndex + 1);
        else closeDialogueBar();
    }
}

function closeDialogueBar() {
    document.getElementById('dialogue-bar').classList.remove('active');
    currentDialogueNpc = null; currentDialogueIndex = 0;
}

function interactWith(target) {
    if (target.classList.contains('npc-entity')) {
        const id = Object.keys(npcs).find(k => npcs[k].container === target);
        if (id && npcs[id].data) openDialogueBar(npcs[id]);
    } else if (target.classList.contains('player-entity') && target !== players[myId]?.container) {
        const id = Object.keys(players).find(k => players[k].container === target);
        if (id && players[id].badge && players[id].badge.style.display !== 'block') {
            document.getElementById('target-name').innerText = players[id].nameTag.innerText;
            showModal('modal-send');
            document.getElementById('btn-send-challenge').onclick = () => {
                socket.emit('challenge_send', id); closeModal('modal-send');
            };
        }
    }
}

world.addEventListener('click', (e) => {
    if (devMode) return;
    if (e.target.closest('.bubble') || e.target.closest('#dialogue-bar')) return;
    const npcContainer = e.target.closest('.npc-entity');
    if (npcContainer) { interactWith(npcContainer); return; }
    const playerContainer = e.target.closest('.player-entity');
    if (playerContainer) interactWith(playerContainer);
});

document.getElementById('btn-action').addEventListener('touchstart', (e) => {
    e.preventDefault(); if (!myId || !players[myId]) return;
    const p = players[myId]; let closest = null, minDist = 90;
    const myCx = p.x + 24, myCy = p.y + 24;
    const check = (list) => {
        for (const id in list) {
            if (id === myId) continue;
            const obj = list[id];
            const dist = Math.hypot((obj.x||0)+24-myCx, (obj.y||0)+24-myCy);
            if (dist < minDist) { minDist = dist; closest = obj; }
        }
    };
    check(players); check(npcs);
    if (closest) interactWith(closest.container);
});

const keys = {};
let camX = 0, camY = 0;
document.onkeydown = (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') keys[e.key.toLowerCase()] = true; };
document.onkeyup = (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') keys[e.key.toLowerCase()] = false; };
const bindTouch = (id, key) => {
    const btn = document.getElementById(id);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); keys[key] = true; });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); keys[key] = false; });
};
bindTouch('btn-up', 'w'); bindTouch('btn-down', 's');
bindTouch('btn-left', 'a'); bindTouch('btn-right', 'd');

function checkCol(x, y) {
    return barriers.some(b => x < b.x + b.w && x + 48 > b.x && y < b.y + b.h && y + 48 > b.y);
}

function gameLoop() {
    requestAnimationFrame(gameLoop);
    for (const id in players) {
        if (id !== myId) players[id].lerpToTarget();
        players[id].animateSprite();
    }
    for (const id in npcs) npcs[id].animateSprite();
    if (!myId || !players[myId] || players[myId].badge?.style.display === 'block') return;
    const p = players[myId];
    let dx = 0, dy = 0;
    if (keys.w || keys.arrowup) { dy -= 5; p.setDir('up', true); }
    if (keys.s || keys.arrowdown) { dy += 5; p.setDir('down', true); }
    if (keys.a || keys.arrowleft) { dx -= 5; p.setDir('left', true); }
    if (keys.d || keys.arrowright) { dx += 5; p.setDir('right', true); }
    const moving = (dx !== 0 || dy !== 0);
    if (!moving) p.setDir(p.dir, false);
    if (moving) {
        let nx = p.x + dx, ny = p.y + dy;
        if (checkCol(nx, p.y)) nx = p.x;
        if (checkCol(p.x, ny)) ny = p.y;
        p.x = nx; p.y = ny; p.updatePos();
    }
    const now = Date.now();
    if (p.lastMove !== moving || p.lastDir !== p.dir || (moving && now - (p.lastEmitTime || 0) > 50)) {
        p.lastMove = moving; p.lastDir = p.dir; p.lastEmitTime = now;
        socket.emit('move', { x: p.x, y: p.y, dir: p.dir, isMoving: moving });
    }
    const tX = -p.x + window.innerWidth / 2 - 24;
    const tY = -p.y + window.innerHeight / 2 - 24;
    camX += (tX - camX) * 0.12; camY += (tY - camY) * 0.12;
    world.style.transform = `translate(${Math.round(camX)}px, ${Math.round(camY)}px)`;
}
requestAnimationFrame(gameLoop);

// ==========================================
// Chess Arena
// ==========================================
class ChessArena {
    constructor() {
        this.screen = document.getElementById('battle-screen');
        this.boardWrapper = document.getElementById('board-wrapper');
        this.boardEl = document.getElementById('chess-board');
        this.topSprite = document.getElementById('opp-sprite');
        this.botSprite = document.getElementById('my-sprite');
        this.topBubble = document.getElementById('opp-bubble');
        this.botBubble = document.getElementById('my-bubble');
        this.turnBadge = document.getElementById('turn-badge');
        this.mySide = null; this.state = null; this.selected = null;
        this.lastAnimatedMove = -1; this.bgmOn = true;
        this.pieces = { 'k': '\u265A', 'q': '\u265B', 'r': '\u265C', 'b': '\u265D', 'n': '\u265E', 'p': '\u265F' };
        document.getElementById('btn-forfeit').onclick = () => {
            if (confirm('Tem certeza que deseja desistir?')) socket.emit('battle_forfeit');
        };
        document.getElementById('btn-bgm').onclick = () => {
            this.bgmOn = !this.bgmOn;
            document.getElementById('btn-bgm').innerText = this.bgmOn ? 'MUSICA:ON' : 'MUSICA:OFF';
            if (this.bgmOn && globalBgmOn) startBGM(); else stopBGM();
        };
    }
    start(data) {
        this.mySide = data.mySide; this.lastAnimatedMove = -1;
        document.getElementById('opp-name').innerText = data.opp.name;
        document.getElementById('my-arena-name').innerText = myName;
        this.topSprite.innerHTML = ''; this.botSprite.innerHTML = '';
        this.topSprite.appendChild(createVisualBody(data.opp.skin, data.opp.color, 'down'));
        this.botSprite.appendChild(createVisualBody(mySkin, myColor, 'up'));
        this.screen.classList.add('active');
        this.updateBoard(data.state);
        if (this.bgmOn && globalBgmOn) startBGM();
    }
    getNotation(pieceType, toR, toC, isCapture) {
        const files = ['a','b','c','d','e','f','g','h'], ranks = ['8','7','6','5','4','3','2','1'];
        const p = pieceType === 'p' ? '' : pieceType.toUpperCase();
        return `${p}${isCapture ? 'x' : ''}${files[toC]}${ranks[toR]}`;
    }
    playGesture(side) {
        const box = side === this.mySide ? this.botSprite : this.topSprite;
        const visual = box.firstChild;
        if (visual && visual.classList && visual.classList.contains('sprite-sheet')) {
            const row = { down: 0, left: 48, right: 96, up: 144 }[visual.dataset.dir];
            visual.style.backgroundPosition = `-48px -${row}px`;
            setTimeout(() => visual.style.backgroundPosition = `0px -${row}px`, 300);
        }
    }
    showSpeechBubble(side, text) {
        const b = side === this.mySide ? this.botBubble : this.topBubble;
        b.innerHTML = `<span>${text}</span>`;
        b.classList.add(side === this.mySide ? 'right' : 'left');
        b.classList.add('show');
        setTimeout(() => b.classList.remove('show'), 2500);
    }
    playDeathAnim(cell, action) {
        if (!cell || !action.capturedType) return;
        const fp = document.createElement('div');
        fp.className = 'piece fly-off';
        fp.style.color = action.capturedColor === 'w' ? '#FFF' : '#000';
        fp.innerText = this.pieces[action.capturedType]; fp.style.position = 'absolute';
        const dirX = (Math.random()-0.5)*400, dirY = (Math.random()-0.5)*400-100, rot = (Math.random()-0.5)*720;
        fp.style.setProperty('--dx', `${dirX}px`); fp.style.setProperty('--dy', `${dirY}px`);
        fp.style.setProperty('--rot', `${rot}deg`);
        cell.appendChild(fp); setTimeout(() => fp.remove(), 600);
    }
    triggerAnimeEffect(cell, a) {
        if (!cell) return;
        if (a.isCapture) {
            const flash = document.getElementById('flash-screen');
            flash.classList.remove('anim-flash'); void flash.offsetWidth; flash.classList.add('anim-flash');
            if (['r','q','k'].includes(a.attackerType)) {
                this.boardWrapper.classList.remove('anim-shake'); void this.boardWrapper.offsetWidth;
                this.boardWrapper.classList.add('anim-shake');
            }
            const vfx = document.createElement('div');
            const vc = { n:'knight', b:'bishop', r:'rook', q:'queen', k:'queen', p:'pawn' }[a.attackerType] || 'pawn';
            vfx.className = `vfx vfx-${vc}`; cell.appendChild(vfx); setTimeout(() => vfx.remove(), 600);
        }
        if (a.isPromotion) cell.classList.add('vfx-promotion');
    }
    findKing(color) {
        for (let r=0;r<8;r++) for (let c=0;c<8;c++)
            if (this.state.board[r][c] && this.state.board[r][c].t==='k' && this.state.board[r][c].c===color) return {r,c};
        return null;
    }
    isClearPath(fr,fc,tr,tc) {
        const rD=Math.sign(tr-fr),cD=Math.sign(tc-fc);
        let r=fr+rD,c=fc+cD;
        while(r!==tr||c!==tc){if(this.state.board[r][c])return false;r+=rD;c+=cD;}
        return true;
    }
    isSquareAttackedBy(r,c,ac) {
        for(let fr=0;fr<8;fr++) for(let fc=0;fc<8;fc++){
            const p=this.state.board[fr][fc]; if(!p||p.c!==ac)continue;
            const dr=r-fr,dc=c-fc;
            if(p.t==='p'){const d=p.c==='w'?-1:1;if(dr===d&&Math.abs(dc)===1)return true;}
            else if(p.t==='n'){if((Math.abs(dr)===2&&Math.abs(dc)===1)||(Math.abs(dr)===1&&Math.abs(dc)===2))return true;}
            else if(p.t==='k'){if(Math.abs(dr)<=1&&Math.abs(dc)<=1)return true;}
            else if(p.t==='r'){if((dr===0||dc===0)&&this.isClearPath(fr,fc,r,c))return true;}
            else if(p.t==='b'){if(Math.abs(dr)===Math.abs(dc)&&this.isClearPath(fr,fc,r,c))return true;}
            else if(p.t==='q'){if((dr===0||dc===0||Math.abs(dr)===Math.abs(dc))&&this.isClearPath(fr,fc,r,c))return true;}
        }
        return false;
    }
    isKingInCheck(color) {
        const k=this.findKing(color); if(!k)return false;
        return this.isSquareAttackedBy(k.r,k.c,color==='w'?'b':'w');
    }
    isRawValidMove(piece,fr,fc,tr,tc) {
        const dr=tr-fr,dc=tc-fc;
        if(dr===0&&dc===0)return false;
        const target=this.state.board[tr][tc];
        if(target&&target.c===piece.c)return false;
        if(piece.t==='p'){
            const dir=piece.c==='w'?-1:1,sr=piece.c==='w'?6:1;
            if(dc===0&&!target){if(dr===dir)return true;if(dr===dir*2&&fr===sr&&!this.state.board[fr+dir][fc])return true;}
            if(Math.abs(dc)===1&&dr===dir){if(target)return true;if(this.state.enPassantTarget&&this.state.enPassantTarget.r===tr&&this.state.enPassantTarget.c===tc)return true;}
            return false;
        }
        if(piece.t==='r')return(dr===0||dc===0)&&this.isClearPath(fr,fc,tr,tc);
        if(piece.t==='b')return Math.abs(dr)===Math.abs(dc)&&this.isClearPath(fr,fc,tr,tc);
        if(piece.t==='q')return(dr===0||dc===0||Math.abs(dr)===Math.abs(dc))&&this.isClearPath(fr,fc,tr,tc);
        if(piece.t==='n')return(Math.abs(dr)===2&&Math.abs(dc)===1)||(Math.abs(dr)===1&&Math.abs(dc)===2);
        if(piece.t==='k'){
            if(Math.abs(dr)<=1&&Math.abs(dc)<=1)return true;
            if(dr===0&&Math.abs(dc)===2){
                const color=piece.c,row=color==='w'?7:0;
                if(fr!==row)return false;
                const rights=this.state.castlingRights[color],enemy=color==='w'?'b':'w';
                if(dc===2&&rights.k)return!this.state.board[row][5]&&!this.state.board[row][6]&&!this.isSquareAttackedBy(row,4,enemy)&&!this.isSquareAttackedBy(row,5,enemy)&&!this.isSquareAttackedBy(row,6,enemy);
                if(dc===-2&&rights.q)return!this.state.board[row][1]&&!this.state.board[row][2]&&!this.state.board[row][3]&&!this.isSquareAttackedBy(row,4,enemy)&&!this.isSquareAttackedBy(row,3,enemy)&&!this.isSquareAttackedBy(row,2,enemy);
            }
            return false;
        }
        return false;
    }
    wouldLeaveInCheck(piece,fr,fc,tr,tc) {
        const target=this.state.board[tr][tc];
        const ep=piece.t==='p'&&this.state.enPassantTarget&&tr===this.state.enPassantTarget.r&&tc===this.state.enPassantTarget.c&&!target;
        let epCap=null;
        if(ep){const epr=piece.c==='w'?tr+1:tr-1;epCap=this.state.board[epr][tc];this.state.board[epr][tc]=null;}
        this.state.board[tr][tc]=piece;this.state.board[fr][fc]=null;
        const inC=this.isKingInCheck(piece.c);
        this.state.board[fr][fc]=piece;this.state.board[tr][tc]=target;
        if(ep){const epr=piece.c==='w'?tr+1:tr-1;this.state.board[epr][tc]=epCap;}
        return inC;
    }
    getValidMoves(r,c) {
        const moves=[],piece=this.state.board[r][c];
        if(!piece||piece.c!==this.mySide)return moves;
        for(let tr=0;tr<8;tr++) for(let tc=0;tc<8;tc++)
            if(this.isRawValidMove(piece,r,c,tr,tc)&&!this.wouldLeaveInCheck(piece,r,c,tr,tc)){
                let isCap=!!this.state.board[tr][tc];
                if(piece.t==='p'&&this.state.enPassantTarget&&tr===this.state.enPassantTarget.r&&tc===this.state.enPassantTarget.c)isCap=true;
                moves.push({r:tr,c:tc,isCapture:isCap});
            }
        return moves;
    }
    showValidMoves(r,c) {
        this.boardEl.querySelectorAll('.cell').forEach(c=>c.classList.remove('valid-move','valid-capture'));
        this.getValidMoves(r,c).forEach(m=>{
            const cell=this.boardEl.querySelector(`.cell[data-r="${m.r}"][data-c="${m.c}"]`);
            if(cell)cell.classList.add(m.isCapture?'valid-capture':'valid-move');
        });
    }
    clearValidMoves(){this.boardEl.querySelectorAll('.cell').forEach(c=>c.classList.remove('valid-move','valid-capture'));}
    updateBoard(state) {
        const isNewMove=state.lastAction&&state.lastAction.moveCount>this.lastAnimatedMove;
        this.state=state;this.boardEl.innerHTML='';
        const flip=this.mySide==='b';
        for(let vr=0;vr<8;vr++) for(let vc=0;vc<8;vc++){
            const r=flip?7-vr:vr,c=flip?7-vc:vc,p=state.board[r][c];
            const cell=document.createElement('div');
            cell.className=`cell ${(vr+vc)%2===0?'light':'dark'}`;
            cell.dataset.r=r;cell.dataset.c=c;
            if(this.selected&&this.selected.r===r&&this.selected.c===c)cell.classList.add('selected');
            if(p){const pEl=document.createElement('div');pEl.className='piece';pEl.style.color=p.c==='w'?'#FFF':'#000';pEl.innerText=this.pieces[p.t];cell.appendChild(pEl);}
            cell.onclick=()=>this.onClick(r,c,p);
            this.boardEl.appendChild(cell);
        }
        if(this.turnBadge){
            const isMyTurn=state.turn===this.mySide;
            this.turnBadge.innerText=isMyTurn?'SUA VEZ':'VEZ DO OPONENTE';
            this.turnBadge.className=isMyTurn?'turn-badge my-turn':'turn-badge';
        }
        if(isNewMove){
            const a=state.lastAction;this.lastAnimatedMove=a.moveCount;
            const toCell=this.boardEl.querySelector(`.cell[data-r="${a.to.r}"][data-c="${a.to.c}"]`);
            const pieceEl=toCell?toCell.querySelector('.piece'):null;
            if(pieceEl){
                const fvr=flip?7-a.from.r:a.from.r,fvc=flip?7-a.from.c:a.from.c;
                const tvr=flip?7-a.to.r:a.to.r,tvc=flip?7-a.to.c:a.to.c;
                const cr=toCell.getBoundingClientRect();
                pieceEl.style.transition='none';
                pieceEl.style.transform=`translate(${(fvc-tvc)*cr.width}px,${(fvr-tvr)*cr.height}px)`;
                void pieceEl.offsetWidth;
                pieceEl.style.transition='transform 0.2s steps(4)';
                pieceEl.style.transform='translate(0px,0px)';
            }
            if(a.isCapture){this.playDeathAnim(toCell,a);SFX.capture();}
            else if(a.isCastle)SFX.castle();
            else if(a.isPromotion)SFX.promote();
            else SFX.move();
            setTimeout(()=>this.triggerAnimeEffect(toCell,a),150);
            if(a.inCheck)setTimeout(()=>SFX.check(),200);
            const notation=this.getNotation(a.attackerType,a.to.r,a.to.c,a.isCapture);
            this.playGesture(a.side);this.showSpeechBubble(a.side,notation);
        }
    }
    onClick(r,c,piece) {
        if(this.state.turn!==this.mySide)return;
        if(this.selected){
            const valid=this.getValidMoves(this.selected.r,this.selected.c).find(m=>m.r===r&&m.c===c);
            if(valid){socket.emit('chess_move',{from:{r:this.selected.r,c:this.selected.c},to:{r,c}});this.selected=null;this.clearValidMoves();}
            else if(piece&&piece.c===this.mySide){this.selected={r,c};this.showValidMoves(r,c);SFX.select();}
            else{this.selected=null;this.clearValidMoves();SFX.invalid();}
        }else if(piece&&piece.c===this.mySide){this.selected={r,c};this.showValidMoves(r,c);SFX.select();}
    }
    close(){this.screen.classList.remove('active');this.state=null;this.selected=null;stopBGM();}
}

const arena = new ChessArena();

// ==========================================
// Dev Mode
// ==========================================
const devPanel = document.getElementById('dev-panel');
const devToolBtns = document.querySelectorAll('.dev-tool-btn');
let devSelectedObj = null, devSelectedType = null;

document.getElementById('btn-dev-toggle').onclick = () => {
    devMode = !devMode;
    document.body.classList.toggle('dev-mode', devMode);
    devPanel.style.display = devMode ? 'block' : 'none';
    if (devMode) setDevTool('pointer');
    else { clearDevSelection(); document.body.classList.remove('dev-pointer','dev-barrier'); }
};

let globalBgmOn = true;
document.getElementById('btn-bgm-toggle').onclick = () => {
    globalBgmOn = !globalBgmOn;
    document.getElementById('btn-bgm-toggle').innerText = globalBgmOn ? 'SOM:ON' : 'SOM:OFF';
    if (!globalBgmOn) stopBGM();
};

function setDevTool(tool) {
    devTool = tool;
    devToolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    document.body.classList.remove('dev-pointer', 'dev-barrier');
    if (tool === 'pointer') document.body.classList.add('dev-pointer');
    else if (tool === 'barrier') document.body.classList.add('dev-barrier');
    document.getElementById('dev-scenery-tools').style.display = tool === 'scenery' ? 'block' : 'none';
    if (tool !== 'pointer') clearDevSelection();
}

devToolBtns.forEach(b => b.onclick = () => setDevTool(b.dataset.tool));

function clearDevSelection() {
    devSelectedObj = null; devSelectedType = null;
    document.getElementById('dev-props').style.display = 'none';
    document.getElementById('dev-props-content').innerHTML = '';
    document.querySelectorAll('.dev-selected-outline').forEach(e => e.classList.remove('dev-selected-outline'));
}

function selectDevObject(obj, type, data) {
    clearDevSelection();
    devSelectedObj = obj; devSelectedType = type;
    const propsPanel = document.getElementById('dev-props');
    const propsContent = document.getElementById('dev-props-content');
    propsPanel.style.display = 'block';
    let html = '';
    if (type === 'scenery') {
        html = `<div class="dev-prop-row"><span class="dev-prop-label">X</span><input type="number" id="prop-x" value="${Math.round(data.x||0)}"></div>
        <div class="dev-prop-row"><span class="dev-prop-label">Y</span><input type="number" id="prop-y" value="${Math.round(data.y||0)}"></div>
        <div class="dev-prop-row"><span class="dev-prop-label">L</span><input type="number" id="prop-w" value="${Math.round(data.w||64)}"></div>
        <div class="dev-prop-row"><span class="dev-prop-label">A</span><input type="number" id="prop-h" value="${Math.round(data.h||64)}"></div>
        <div class="dev-prop-row"><span class="dev-prop-label">Z</span><input type="number" id="prop-z" value="${data.z||1}"></div>`;
    } else if (type === 'barrier') {
        html = `<div class="dev-prop-row"><span class="dev-prop-label">X</span><input type="number" id="prop-x" value="${Math.round(data.x||0)}"></div>
        <div class="dev-prop-row"><span class="dev-prop-label">Y</span><input type="number" id="prop-y" value="${Math.round(data.y||0)}"></div>
        <div class="dev-prop-row"><span class="dev-prop-label">L</span><input type="number" id="prop-w" value="${Math.round(data.w||64)}"></div>
        <div class="dev-prop-row"><span class="dev-prop-label">A</span><input type="number" id="prop-h" value="${Math.round(data.h||64)}"></div>`;
    } else if (type === 'npc') {
        html = `<div class="dev-prop-row"><span class="dev-prop-label">NOME</span><input type="text" id="prop-name" value="${data.name||''}"></div>
        <div class="dev-prop-row"><span class="dev-prop-label">DIR</span><select id="prop-dir" class="pixel-input">
            <option value="down"${(data.dir==='down')?' selected':''}>BAIXO</option>
            <option value="up"${(data.dir==='up')?' selected':''}>CIMA</option>
            <option value="left"${(data.dir==='left')?' selected':''}>ESQ</option>
            <option value="right"${(data.dir==='right')?' selected':''}>DIR</option>
        </select></div>
        <div class="dev-prop-row"><span class="dev-prop-label">SKIN</span><select id="prop-skin" class="pixel-input"><option value="">---</option></select></div>`;
    }
    propsContent.innerHTML = html;
    if (type === 'npc') {
        const sel = document.getElementById('prop-skin');
        Object.keys(availableSkins).forEach(name => {
            const opt = document.createElement('option'); opt.value = name; opt.textContent = name;
            if (name === data.skin) opt.selected = true; sel.appendChild(opt);
        });
    }
    document.getElementById('btn-props-apply').onclick = () => applyDevProps(type, data);
    document.getElementById('btn-props-delete').onclick = () => {
        if (type === 'scenery') socket.emit('delete_scenery', data.id);
        else if (type === 'barrier') socket.emit('delete_barrier', data.id);
        else if (type === 'npc') socket.emit('delete_npc', data.id);
        clearDevSelection();
    };
}

function applyDevProps(type, data) {
    if (type === 'scenery') {
        const update = { id: data.id, x: parseInt(document.getElementById('prop-x').value)||0, y: parseInt(document.getElementById('prop-y').value)||0,
            w: parseInt(document.getElementById('prop-w').value)||64, h: parseInt(document.getElementById('prop-h').value)||64, z: parseInt(document.getElementById('prop-z').value)||1 };
        socket.emit('update_scenery', update);
    } else if (type === 'barrier') {
        const update = { id: data.id, x: parseInt(document.getElementById('prop-x').value)||0, y: parseInt(document.getElementById('prop-y').value)||0,
            w: parseInt(document.getElementById('prop-w').value)||64, h: parseInt(document.getElementById('prop-h').value)||64 };
        socket.emit('update_barrier', update);
    } else if (type === 'npc') {
        const update = { id: data.id, name: document.getElementById('prop-name').value,
            dir: document.getElementById('prop-dir').value, skin: document.getElementById('prop-skin').value };
        socket.emit('update_npc', update);
    }
    toast('Aplicado!', 'success');
}

// Dev click handlers
let startX, startY, tempBox;
world.onmousedown = (e) => {
    if (e.target.closest('#dev-panel') || e.target.closest('#ui-layer') || e.target.closest('#dialogue-bar')) return;
    if (!devMode || e.button !== 0) return;

    if (devTool === 'pointer') {
        const sceneryEl = e.target.closest('.scenery-container');
        if (sceneryEl) {
            const sid = sceneryEl.dataset.id;
            const sData = (db_cache_npcs_sceneries.sceneries || []).find(s => s.id === sid) || { id: sid, x: parseInt(sceneryEl.style.left), y: parseInt(sceneryEl.style.top), w: parseInt(sceneryEl.style.width), h: parseInt(sceneryEl.style.height) };
            selectDevObject(sceneryEl, 'scenery', sData);
            setupDrag(sceneryEl, sData, 'scenery');
            return;
        }
        const barrierEl = e.target.closest('.barrier');
        if (barrierEl) {
            const bid = barrierEl.dataset.id;
            const bData = (barriers || []).find(b => b.id === bid) || { id: bid, x: parseInt(barrierEl.style.left), y: parseInt(barrierEl.style.top), w: parseInt(barrierEl.style.width), h: parseInt(barrierEl.style.height) };
            selectDevObject(barrierEl, 'barrier', bData);
            setupDrag(barrierEl, bData, 'barrier');
            return;
        }
        const npcEl = e.target.closest('.npc-entity');
        if (npcEl) {
            const nid = Object.keys(npcs).find(k => npcs[k].container === npcEl);
            if (nid) { selectDevObject(npcEl, 'npc', npcs[nid].data); setupDrag(npcEl, npcs[nid].data, 'npc'); }
            return;
        }
        clearDevSelection();
        return;
    }

    if (e.target.closest('.player-entity, .npc-entity, .bubble, .resize-handle')) return;

    const rect = world.getBoundingClientRect();
    startX = e.clientX - rect.left; startY = e.clientY - rect.top;

    if (devTool === 'barrier') {
        tempBox = document.createElement('div'); tempBox.className = 'barrier';
        world.appendChild(tempBox);
    } else if (devTool === 'npc') {
        showModal('modal-npc');
    } else if (devTool === 'scenery') {
        const url = document.getElementById('dev-scenery-select').value;
        const w = parseInt(document.getElementById('sce-w').value) || 64;
        const h = parseInt(document.getElementById('sce-h').value) || 64;
        const z = parseInt(document.getElementById('sce-z').value) || 1;
        if (url) socket.emit('place_scenery', { x: startX, y: startY, url, w, h, z });
    }
};

function setupDrag(el, data, type) {
    let isDragging = false, sX, sY, sL, sT;
    el.onmousedown = (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        if (!devMode || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        isDragging = true; sX = e.clientX; sY = e.clientY;
        sL = parseInt(el.style.left || el.style.transform?.match(/translate\((.+?)px/)?.[1] || 0);
        sT = parseInt(el.style.top || el.style.transform?.match(/, (.+?)px\)/)?.[1] || 0);
        const onMove = (ev) => {
            if (!isDragging) return;
            const nx = sL + ev.clientX - sX, ny = sT + ev.clientY - sY;
            if (type === 'npc') el.style.transform = `translate(${nx}px, ${ny}px)`;
            else { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }
        };
        const onUp = (ev) => {
            isDragging = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const nx = sL + ev.clientX - sX, ny = sT + ev.clientY - sY;
            if (type === 'scenery') socket.emit('update_scenery', { id: data.id, x: nx, y: ny });
            else if (type === 'barrier') socket.emit('update_barrier', { id: data.id, x: nx, y: ny });
            else if (type === 'npc') socket.emit('update_npc', { id: data.id, x: nx, y: ny });
            data.x = nx; data.y = ny;
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };
}

world.onmousemove = (e) => {
    if (!tempBox || devTool !== 'barrier') return;
    const rect = world.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const w = cx - startX, h = cy - startY;
    tempBox.style.left = (w < 0 ? cx : startX) + 'px';
    tempBox.style.top = (h < 0 ? cy : startY) + 'px';
    tempBox.style.width = Math.abs(w) + 'px';
    tempBox.style.height = Math.abs(h) + 'px';
};

world.onmouseup = () => {
    if (!tempBox || devTool !== 'barrier') return;
    if (parseInt(tempBox.style.width) > 10) {
        socket.emit('create_barrier', {
            x: parseInt(tempBox.style.left), y: parseInt(tempBox.style.top),
            w: parseInt(tempBox.style.width), h: parseInt(tempBox.style.height)
        });
    }
    tempBox.remove(); tempBox = null;
};

function setupSceneryInteractions(el, s) {
    const handle = el.querySelector('.resize-handle');
    let isResizing = false, sX, sY, sW, sH;
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); isResizing = true;
        sX = e.clientX; sY = e.clientY;
        sW = parseInt(el.style.width); sH = parseInt(el.style.height);
        const onMove = (ev) => { if (!isResizing) return; el.style.width = Math.max(20, sW+ev.clientX-sX)+'px'; el.style.height = Math.max(20, sH+ev.clientY-sY)+'px'; };
        const onUp = () => { isResizing = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
            socket.emit('update_scenery', { id: s.id, w: parseInt(el.style.width), h: parseInt(el.style.height) }); };
        window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    });
}

// NPC Creation
document.getElementById('npc-isbot').onchange = (e) => {
    document.getElementById('npc-botlevel').style.display = e.target.checked ? 'block' : 'none';
};

let npcDialogueList = [{ text: '', responses: [] }];
const dialogueEditor = document.getElementById('npc-dialogue-editor');

function renderNpcDialogueEditor() {
    dialogueEditor.innerHTML = '';
    npcDialogueList.forEach((d, i) => {
        const entry = document.createElement('div'); entry.className = 'dev-dialogue-entry';
        entry.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-family:'Press Start 2P',monospace;font-size:7px;color:#888;">DIALOGO ${i+1}</span>
            <button class="pixel-btn btn-danger btn-sm" onclick="removeNpcDialogue(${i})" style="padding:3px 6px;font-size:6px;">X</button>
        </div>
        <textarea class="pixel-input" placeholder="TEXTO DO NPC..." onchange="npcDialogueList[${i}].text=this.value">${d.text||''}</textarea>
        <div class="dev-npc-dialogue-list" id="npc-resp-${i}"></div>
        <button class="pixel-btn btn-secondary btn-sm" onclick="addNpcResponse(${i})" style="margin-top:4px;">+ RESPOSTA</button>`;
        dialogueEditor.appendChild(entry);
        const respList = entry.querySelector(`#npc-resp-${i}`);
        (d.responses || []).forEach((r, ri) => {
            const row = document.createElement('div'); row.className = 'dev-response-row';
            row.innerHTML = `<input type="text" class="pixel-input" placeholder="TEXTO" value="${r.text||''}" onchange="npcDialogueList[${i}].responses[${ri}].text=this.value" style="flex:1;">
                <select class="pixel-input" onchange="npcDialogueList[${i}].responses[${ri}].action=this.value" style="width:80px;flex:none;">
                    <option value="none"${r.action==='none'?' selected':''}>NADA</option>
                    <option value="duel"${r.action==='duel'?' selected':''}>DUELO</option>
                    <option value="next"${r.action==='next'?' selected':''}>PROXIMO</option>
                    <option value="close"${r.action==='close'?' selected':''}>FECHAR</option>
                </select>
                <button class="pixel-btn btn-danger btn-sm" onclick="removeNpcResponse(${i},${ri})" style="padding:3px 6px;font-size:6px;">X</button>`;
            respList.appendChild(row);
        });
    });
}
window.removeNpcDialogue = (i) => { npcDialogueList.splice(i, 1); renderNpcDialogueEditor(); };
window.addNpcResponse = (i) => { if (!npcDialogueList[i].responses) npcDialogueList[i].responses = []; npcDialogueList[i].responses.push({ text: '', action: 'none' }); renderNpcDialogueEditor(); };
window.removeNpcResponse = (i, ri) => { npcDialogueList[i].responses.splice(ri, 1); renderNpcDialogueEditor(); };
document.getElementById('btn-add-dialogue').onclick = () => { npcDialogueList.push({ text: '', responses: [] }); renderNpcDialogueEditor(); };
renderNpcDialogueEditor();

document.getElementById('btn-create-npc').onclick = () => {
    socket.emit('create_npc', {
        x: startX, y: startY,
        name: document.getElementById('npc-name').value || 'NPC',
        skin: document.getElementById('npc-skin-select').value,
        dir: document.getElementById('npc-dir-select').value || 'down',
        dialogues: npcDialogueList.filter(d => d.text),
        isBot: document.getElementById('npc-isbot').checked,
        botLevel: parseInt(document.getElementById('npc-botlevel').value)
    });
    closeModal('modal-npc');
    npcDialogueList = [{ text: '', responses: [] }]; renderNpcDialogueEditor();
};

document.getElementById('btn-dev-upload-scenery').onclick = async () => {
    const file = document.getElementById('dev-scenery-file').files[0];
    if (!file) return toast('Escolha uma imagem!', 'error');
    const fd = new FormData(); fd.append('type', 'scenery'); fd.append('name', file.name); fd.append('image', file);
    try {
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success) {
            availableScenery[data.item.name] = data.item.url;
            const sel = document.getElementById('dev-scenery-select');
            sel.innerHTML += `<option value="${data.item.url}">${data.item.name}</option>`;
            sel.value = data.item.url; toast('Cenario carregado!', 'success');
        }
    } catch { toast('Erro no upload', 'error'); }
};

function drawBarrier(b) {
    const div = document.createElement('div'); div.className = 'barrier'; div.dataset.id = b.id;
    div.style.left = b.x+'px'; div.style.top = b.y+'px';
    div.style.width = b.w+'px'; div.style.height = b.h+'px';
    div.addEventListener('contextmenu', (e) => { if (devMode) { e.preventDefault(); socket.emit('delete_barrier', b.id); } });
    world.appendChild(div);
}

function drawNpc(n) {
    const npc = new Entity(n, 'npc');
    npc.container.addEventListener('contextmenu', (e) => { if (devMode) { e.preventDefault(); socket.emit('delete_npc', n.id); } });
    npcs[n.id] = npc;
}

let db_cache_npcs_sceneries = { sceneries: [] };

document.getElementById('chat-input').onkeypress = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
        socket.emit('chat_msg', e.target.value); e.target.value = ''; e.target.blur();
    }
};

// ==========================================
// Socket Handlers
// ==========================================
socket.on('connect', () => {
    const s = document.getElementById('connection-status');
    s.classList.remove('disconnected'); s.style.display = 'none';
});
socket.on('disconnect', () => {
    const s = document.getElementById('connection-status');
    s.textContent = 'DESCONECTADO...'; s.className = 'disconnected'; s.style.display = 'block';
});
socket.on('reconnect', () => toast('Reconectado!', 'success'));

socket.on('login_success', (data) => {
    myId = data.user.id;
    (data.skins || []).forEach(s => {
        if (!s || !s.name || !s.url) return;
        availableSkins[s.name] = s.url;
        const skinSel = document.getElementById('skin-select');
        if (![...skinSel.options].some(o => o.value === s.name)) skinSel.innerHTML += `<option value="${s.name}">${s.name}</option>`;
        const npcSel = document.getElementById('npc-skin-select');
        if (![...npcSel.options].some(o => o.value === s.name)) npcSel.innerHTML += `<option value="${s.name}">${s.name}</option>`;
    });
    (data.sceneryTemplates || []).forEach(s => {
        availableScenery[s.name] = s.url;
        const sel = document.getElementById('dev-scenery-select');
        if (![...sel.options].some(o => o.value === s.url)) sel.innerHTML += `<option value="${s.url}">${s.name}</option>`;
    });
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('ui-layer').style.display = 'flex';
    world.style.display = 'block';
    document.getElementById('my-name').innerText = data.user.username;
    camX = -data.user.x + window.innerWidth / 2 - 24;
    camY = -data.user.y + window.innerHeight / 2 - 24;
    (data.barriers || []).forEach(b => { drawBarrier(b); barriers.push(b); });
    (data.sceneries || []).forEach(s => drawScenery(s));
    db_cache_npcs_sceneries.sceneries = data.sceneries || [];
    (data.npcs || []).forEach(n => drawNpc(n));
    for (const id in data.players) players[id] = new Entity(data.players[id], 'player');
    toast(`Bem-vindo, ${data.user.username}!`, 'success');
});

socket.on('player_joined', (p) => { players[p.id] = new Entity(p, 'player'); if (p.id !== myId) SFX.join(); });
socket.on('player_left', (id) => { if (players[id]) { players[id].remove(); delete players[id]; } });
socket.on('player_moved', (data) => {
    if (players[data.id] && data.id !== myId) {
        players[data.id].setTarget(data.x, data.y);
        players[data.id].setDir(data.dir, data.isMoving);
    }
});
socket.on('chat_bubble', (data) => {
    if (players[data.id]) players[data.id].chat(data.msg);
    if (data.id !== myId) SFX.chat();
});

socket.on('new_barrier', (b) => { drawBarrier(b); barriers.push(b); });
socket.on('barrier_deleted', (id) => {
    barriers = barriers.filter(b => b.id !== id);
    const el = document.querySelector(`.barrier[data-id="${id}"]`); if (el) el.remove();
});
socket.on('barrier_updated', (b) => {
    const el = document.querySelector(`.barrier[data-id="${b.id}"]`);
    if (el) { el.style.left=b.x+'px'; el.style.top=b.y+'px'; el.style.width=b.w+'px'; el.style.height=b.h+'px'; }
});
socket.on('new_npc', (n) => drawNpc(n));
socket.on('npc_deleted', (id) => { if (npcs[id]) { npcs[id].remove(); delete npcs[id]; } });
socket.on('npc_updated', (n) => {
    if (npcs[n.id]) {
        npcs[n.id].x = n.x; npcs[n.id].y = n.y; npcs[n.id].data = n;
        npcs[n.id].updatePos();
        npcs[n.id].nameTag.innerText = n.name;
        const newVis = createVisualBody(n.skin, n.color, n.dir);
        npcs[n.id].container.replaceChild(newVis, npcs[n.id].visual);
        npcs[n.id].visual = newVis;
    }
});
socket.on('npc_pos_updated', (n) => { if (npcs[n.id]) { npcs[n.id].x = n.x; npcs[n.id].y = n.y; npcs[n.id].updatePos(); } });
socket.on('new_scenery', (s) => { drawScenery(s); db_cache_npcs_sceneries.sceneries.push(s); });
socket.on('scenery_deleted', (id) => {
    const el = document.querySelector(`.scenery-container[data-id="${id}"]`); if (el) el.remove();
    db_cache_npcs_sceneries.sceneries = db_cache_npcs_sceneries.sceneries.filter(s => s.id !== id);
});
socket.on('scenery_updated', (s) => {
    const el = document.querySelector(`.scenery-container[data-id="${s.id}"]`);
    if (el) {
        if (s.w) el.style.width = s.w+'px'; if (s.h) el.style.height = s.h+'px';
        if (s.x) el.style.left = s.x+'px'; if (s.y) el.style.top = s.y+'px'; if (s.z) el.style.zIndex = s.z;
    }
    const idx = db_cache_npcs_sceneries.sceneries.findIndex(i => i.id === s.id);
    if (idx >= 0) Object.assign(db_cache_npcs_sceneries.sceneries[idx], s);
});

socket.on('challenge_received', (data) => {
    document.getElementById('challenger-name').innerText = data.fromName;
    showModal('modal-receive');
    document.getElementById('btn-accept').onclick = () => {
        socket.emit('challenge_respond', { challengeId: data.challengeId, accept: true }); closeModal('modal-receive');
    };
    document.getElementById('btn-decline').onclick = () => {
        socket.emit('challenge_respond', { challengeId: data.challengeId, accept: false }); closeModal('modal-receive');
    };
});
socket.on('player_in_battle', (data) => {
    if (players[data.p1Id] && players[data.p1Id].badge) players[data.p1Id].badge.style.display = 'block';
    if (players[data.p2Id] && players[data.p2Id].badge) players[data.p2Id].badge.style.display = 'block';
});
socket.on('player_left_battle', (data) => {
    if (players[data.p1Id] && players[data.p1Id].badge) players[data.p1Id].badge.style.display = 'none';
    if (players[data.p2Id] && players[data.p2Id].badge) players[data.p2Id].badge.style.display = 'none';
});
socket.on('battle_start', (data) => arena.start(data));
socket.on('chess_update', (state) => arena.updateBoard(state));
socket.on('battle_end', (data) => {
    setTimeout(() => {
        if (data.stalemate) toast('Empate!', 'info');
        else if (data.winner) { SFX.victory(); toast('Vitoria!', 'success'); }
        else { SFX.defeat(); toast('Derrota!', 'error'); }
        arena.close();
    }, 1500);
});
