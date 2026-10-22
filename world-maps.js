const { randomUUID } = require('node:crypto');

const WORLD_COLLECTIONS = new Set(['npcs', 'scenery_map', 'barriers', 'walls', 'area_backgrounds', 'global_background']);
const room = id => `map:${id}`;
const clamp = (value, max) => Math.max(0, Math.min(value, max - 48));
function validateMap(input) {
    const { name, width, height } = input || {};
    if (typeof name !== 'string' || !name.trim()) throw new Error('Dê um nome ao mapa.');
    if (![width, height].every(n => Number.isInteger(n) && n >= 192 && n <= 20000)) throw new Error('O tamanho do mapa deve ser de 192 a 20000 pixels.');
    const bg = input.background || {};
    const background = {
        url: typeof bg.url === 'string' ? bg.url.trim() : '',
        mode: bg.mode === 'single' ? 'single' : 'repeat',
        tileSize: Number.isInteger(bg.tileSize) ? bg.tileSize : 256,
        fitMap: bg.fitMap !== false,
        width: bg.width ?? width,
        height: bg.height ?? height,
        color: /^#[\da-f]{6}$/i.test(bg.color) ? bg.color : '#1a3a2a'
    };
    if (background.tileSize < 8 || background.tileSize > 4096) throw new Error('O tamanho da repetição deve ser de 8 a 4096 pixels.');
    if (![background.width,background.height].every(n=>Number.isInteger(n)&&n>=8&&n<=40000)) throw new Error('O tamanho da imagem deve ser de 8 a 40000 pixels.');
    return { name: name.trim().slice(0, 60), width, height, background,
        spawn: { x: clamp(Number.isFinite(input.spawn?.x) ? input.spawn.x : 100, width), y: clamp(Number.isFinite(input.spawn?.y) ? input.spawn.y : 100, height) } };
}
function endpoint(map, input) {
    const { x, y } = input || {};
    const w = input?.w ?? 64, h = input?.h ?? 64;
    if (![x, y, w, h].every(Number.isFinite) || w < 48 || h < 48 || x < 0 || y < 0 || x + w > map.width || y + h > map.height) throw new Error('O portal inteiro deve ficar dentro dos limites do mapa (mínimo 48 × 48).');
    return { mapId: map.id, x, y, w, h };
}
function overlaps(player, portal) {
    return player.x < portal.x + portal.w && player.x + 48 > portal.x && player.y < portal.y + portal.h && player.y + 48 > portal.y;
}

class WorldMaps {
    constructor(db, io, engine) { this.db = db; this.io = io; this.engine = engine; }
    scopedDatabase(mapId) {
        return { collection: name => {
            const collection = this.db.collection(name);
            if (!WORLD_COLLECTIONS.has(name)) return collection;
            const filter = query => ({ ...query, mapId });
            return {
                find: (query = {}) => collection.find(filter(query)),
                findOne: (query = {}) => collection.findOne(filter(query)),
                insertOne: data => collection.insertOne(Object.assign(data, { mapId })),
                updateOne: (query, update, options) => collection.updateOne(filter(query), update, options),
                deleteOne: query => collection.deleteOne(filter(query)),
                deleteMany: query => collection.deleteMany(filter(query))
            };
        }};
    }
    async initialize() {
        for (const name of WORLD_COLLECTIONS) {
            await this.db.collection(name).updateMany({ mapId: { $exists: false } }, { $set: { mapId: 'main' } });
        }
        await this.db.collection('maps').createIndex({ id: 1 }, { unique: true });
        if (!await this.get('main')) {
            const objects = (await Promise.all(['scenery_map','barriers','walls','npcs','area_backgrounds'].map(name => this.db.collection(name).find({mapId:'main'}).toArray()))).flat();
            const bg = await this.db.collection('global_background').findOne({mapId:'main'});
            await this.db.collection('maps').insertOne({ id:'main', ...validateMap({name:'Casa inicial', width:Math.min(20000,Math.max(640,...objects.map(o=>Math.ceil((o.x||0)+(o.w||48)+64)))), height:Math.min(20000,Math.max(480,...objects.map(o=>Math.ceil((o.y||0)+(o.h||48)+64)))), background:bg || {}, spawn:{x:100,y:100} }) });
        }
    }
    get(id) { return this.db.collection('maps').findOne({id}); }
    async create(input) {
        const map = { id: randomUUID(), ...validateMap(input) };
        await this.db.collection('maps').insertOne(map);
        return map;
    }
    async snapshot(mapId) {
        const map = await this.get(mapId);
        if (!map) throw new Error('Mapa não encontrado.');
        const db = this.scopedDatabase(mapId);
        const [npcs, sceneries, barriers, walls, areaBackgrounds, portals] = await Promise.all([
            ...['npcs','scenery_map','barriers','walls','area_backgrounds'].map(name=>db.collection(name).find().toArray()),
            this.portalsFor(mapId)
        ]);
        const zone = this.engine.zones[mapId] ||= {players:{}};
        Object.assign(zone,{map,npcs,sceneries,barriers,walls,portals});
        return { zoneId:mapId, map, players:Object.values(zone.players), npcs, sceneries, barriers, walls, areaBackgrounds, portals };
    }
    async portalsFor(mapId) {
        const pairs = await this.db.collection('portals').find({'ends.mapId':mapId}).toArray();
        return pairs.flatMap(pair=>pair.ends.flatMap((end,side)=>end.mapId === mapId ? [{ id:`${pair.id}:${side}`, pairId:pair.id, name:pair.name, ...end, destination:pair.ends[1-side] }] : []));
    }
    async emitPortals(mapIds) {
        await Promise.all([...new Set(mapIds)].map(async id=>{
            const portals=await this.portalsFor(id);
            if (this.engine.zones[id]) this.engine.zones[id].portals=portals;
            this.io.to(room(id)).emit('portals_updated',portals);
        }));
    }
    async setBackground(mapId, data) {
        const previous=await this.get(mapId);
        if (!previous) throw new Error('Mapa não encontrado.');
        const background=validateMap({...previous,background:{...previous.background,...data}}).background;
        await this.db.collection('maps').updateOne({id:mapId},{$set:{background}});
        const map={...previous,background};
        if(this.engine.zones[mapId]) this.engine.zones[mapId].map=map;
        this.io.to(room(mapId)).emit('map_updated',map);
    }
    async savePlayer(player) {
        await this.db.collection('players').updateOne({username:player.username},{$set:{zoneId:player.zoneId,x:player.x,y:player.y}});
    }
    async transfer(socket, mapId, position, arrivalPortalId = null) {
        const p = this.engine.players[socket.id];
        if (!p || p.inBattle || p.endingUntil > Date.now()) throw new Error('Termine a partida antes de trocar de mapa.');
        const snapshot = await this.snapshot(mapId);
        const oldMap = p.zoneId;
        socket.to(room(oldMap)).emit('player_left',socket.id);
        await socket.leave(room(oldMap));
        p.x = clamp(position?.x ?? snapshot.map.spawn.x,snapshot.map.width);
        p.y = clamp(position?.y ?? snapshot.map.spawn.y,snapshot.map.height);
        p.isMoving = false;
        p.arrivalPortalId = arrivalPortalId;
        this.engine.joinZone(socket.id,mapId);
        await socket.join(room(mapId));
        await this.savePlayer(p);
        socket.emit('zone_snapshot',{...snapshot,players:Object.values(this.engine.zones[mapId].players),arrivalPortalId});
        socket.to(room(mapId)).emit('player_joined',p);
    }
    register(socket) {
        const run = (event, action) => socket.on(event, async (data, ack) => {
            try {
                if (!this.engine.players[socket.id]) throw new Error('Entre no jogo primeiro.');
                const value = await action(data || {});
                if (typeof ack === 'function') ack({success:true,...value});
            } catch (error) {
                if (typeof ack === 'function') ack({success:false,error:error.message});
                else socket.emit('world_error',{error:error.message});
            }
        });
        const admin = () => {
            if (!this.engine.players[socket.id]?.isAdmin) throw new Error('Abra o editor com uma conta administradora.');
        };
        run('map_save',async data=>{
            admin();
            let map;
            if (data.id) {
                const previous = await this.get(data.id);
                if (!previous) throw new Error('Mapa não encontrado.');
                map = {id:data.id,...validateMap(data)};
                const portals = await this.portalsFor(data.id);
                for (const p of portals) endpoint(map,p);
                // A reduction must not cut away existing world objects.
                const world = this.scopedDatabase(data.id);
                for (const name of ['barriers','walls','npcs','scenery_map','area_backgrounds']) {
                    const items = await world.collection(name).find().toArray();
                    if (items.some(o=>o.x < 0 || o.y < 0 || o.x+(o.w||48)>map.width || o.y+(o.h||48)>map.height)) throw new Error('O novo tamanho deixaria objetos fora do mapa. Mova-os antes de reduzir o mapa.');
                }
                await this.db.collection('maps').updateOne({id:data.id},{$set:map});
            } else map = await this.create(data);
            const zone = this.engine.zones[map.id];
            if (zone) zone.map=map;
            if (zone) for (const p of Object.values(zone.players)) {
                p.x=clamp(p.x,map.width);p.y=clamp(p.y,map.height);
                await this.savePlayer(p);
                this.io.to(room(map.id)).emit('player_moved',{id:p.id,x:p.x,y:p.y,dir:p.dir,isMoving:false});
            }
            this.io.to(room(map.id)).emit('map_updated',map);
            this.io.emit('maps_changed');
            return {map};
        });
        run('map_visit',async ({mapId})=>{admin();await this.transfer(socket,mapId);});
        run('portal_save',async data=>{
            admin();
            const sourceMapId = this.engine.players[socket.id].zoneId;
            const source = await this.get(sourceMapId);
            const from = endpoint(source,data.source);
            const existing = data.pairId ? await this.db.collection('portals').findOne({id:data.pairId,'ends.mapId':sourceMapId}) : null;
            if (data.pairId && !existing) throw new Error('Portal não encontrado neste mapa.');
            const destination = data.newMap ? {id:randomUUID(),...validateMap(data.newMap)} : await this.get(data.destinationMapId);
            if (!destination) throw new Error('Escolha o mapa de destino.');
            const to = endpoint(destination,data.destination);
            if (source.id === destination.id) throw new Error('Escolha outro mapa para o destino.');
            for (const end of [from,to]) {
                const barriers=await this.db.collection('barriers').find({mapId:end.mapId}).toArray();
                if(barriers.some(barrier=>overlaps(end,barrier))) throw new Error('A chegada do portal está dentro de uma barreira. Escolha um ponto livre.');
            }
            const pair = {id:existing?.id || randomUUID(),name:String(data.name||'Portal').slice(0,40),ends:[from,to]};
            if (data.newMap) await this.db.collection('maps').insertOne(destination);
            try {
                if (existing) await this.db.collection('portals').replaceOne({id:pair.id},pair);
                else await this.db.collection('portals').insertOne(pair);
            } catch (error) {
                if (data.newMap) await this.db.collection('maps').deleteOne({id:destination.id});
                throw error;
            }
            await this.emitPortals([...pair.ends,...(existing?.ends||[])].map(p=>p.mapId));
            this.io.emit('maps_changed');
            return {pair,map:destination};
        });
        run('portal_delete',async ({pairId})=>{
            admin();
            const pair = await this.db.collection('portals').findOne({id:pairId,'ends.mapId':this.engine.players[socket.id].zoneId});
            if (!pair) throw new Error('Portal não encontrado.');
            await this.db.collection('portals').deleteOne({id:pairId});
            await this.emitPortals(pair.ends.map(p=>p.mapId));
        });
        run('portal_enter',async ({id})=>{
            const p = this.engine.players[socket.id];
            if (p.transferring) return;
            p.transferring=true;
            try {
                const portals=await this.portalsFor(p.zoneId);
                const portal=portals.find(portal=>portal.id===id);
                if (!portal) throw new Error('Portal não encontrado neste mapa.');
                if (p.arrivalPortalId === id && overlaps(p,portal)) return;
                if (!overlaps(p,portal) && Math.hypot(p.x-portal.x,p.y-portal.y)>100) throw new Error('Aproxime-se do portal para atravessar.');
                const otherSide=portal.id.endsWith(':0') ? 1 : 0;
                await this.transfer(socket,portal.destination.mapId,portal.destination,`${portal.pairId}:${otherSide}`);
            } finally {p.transferring=false;}
        });
    }
}
module.exports = {WorldMaps,room,clamp,validateMap,endpoint,overlaps,WORLD_COLLECTIONS};
