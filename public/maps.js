let currentMap = {id:'main',name:'Casa inicial',width:640,height:480,background:{color:'#1a3a2a',mode:'repeat',tileSize:256},spawn:{x:100,y:100}};
let mapPortals = [], mapCatalog = [], mapTransitioning = false, blockedPortalId = null;
let placingPortal = false, editorMode = 'map', editingPortal = null, editorSourceMapId = null;
const mapEl = id => document.getElementById(id);
const mapNumber = id => Number(mapEl(id).value);
const insidePortal = (player, portal) => player.x < portal.x+portal.w && player.x+48 > portal.x && player.y < portal.y+portal.h && player.y+48 > portal.y;

function paintMapBackground(element,map,scale=1) {
    const bg=map.background || {};
    element.style.backgroundColor=bg.color || '#1a3a2a';
    element.style.backgroundImage=bg.url ? `url(${JSON.stringify(bg.url)})` : 'none';
    element.style.backgroundRepeat=bg.mode==='single'?'no-repeat':'repeat';
    element.style.backgroundSize=bg.mode==='single'?(bg.fitMap!==false?'100% 100%':`${(bg.width||map.width)*scale}px ${(bg.height||map.height)*scale}px`):`${(bg.tileSize||256)*scale}px ${(bg.tileSize||256)*scale}px`;
    element.style.backgroundPosition='0 0';
}
function applyWorldMap(map) {
    currentMap=map;
    currentZoneId=map.id;
    world.style.width=map.width+'px';world.style.height=map.height+'px';
    paintMapBackground(world,map);
    mapEl('dev-bg-tile').value=map.background?.tileSize||256;
    mapEl('current-map-name').textContent=map.name;
}
function loadWorldSnapshot(data) {
    clearWorld();
    closeDialogueBar();
    closeModal('modal-receive');closeModal('modal-send');
    clearDevSelection();
    applyWorldMap(data.map);
    Object.values(data.players || {}).forEach(p=>{players[p.id]=new Entity(p,'player');});
    barriers=data.barriers||[];barriers.forEach(drawBarrier);
    walls=data.walls||[];walls.forEach(drawWall);
    (data.npcs||[]).forEach(drawNpc);
    (data.sceneries||[]).forEach(drawScenery);
    db_cache_npcs_sceneries.sceneries=data.sceneries||[];
    areaBackgrounds=data.areaBackgrounds||[];areaBackgrounds.forEach(drawAreaBackground);
    mapPortals=data.portals||[];blockedPortalId=data.arrivalPortalId||null;renderPortals();
    const me=players[myId];
    if(me) {camX=-me.x+innerWidth/2-24;camY=-me.y+innerHeight/2-24;world.style.transform=`translate(${camX}px,${camY}px)`;}
    for(const key in keys) keys[key]=false;
    mapTransitioning=false;document.body.classList.remove('map-transferring');
    mapEl('world-battle-result')?.remove();
}
async function mapRequest(event,data) {
    return new Promise((resolve,reject)=>{
        socket.timeout(15000).emit(event,data,(error,result)=>{
            if(error) return reject(new Error('O servidor não respondeu. Tente novamente.'));
            if(!result?.success) return reject(new Error(result?.error||'Não foi possível concluir.'));
            resolve(result);
        });
    });
}
async function enterPortal(portal) {
    if(mapTransitioning || arena.state || arena.ending || devMode) return;
    const me=players[myId];if(!me) return;
    mapTransitioning=true;document.body.classList.add('map-transferring');
    socket.emit('move',{x:me.x,y:me.y,dir:me.dir,isMoving:false});
    for(const key in keys) keys[key]=false;
    try {await mapRequest('portal_enter',{id:portal.id});}
    catch(error) {blockedPortalId=portal.id;toast(error.message,'error');}
    finally {mapTransitioning=false;document.body.classList.remove('map-transferring');}
}
function checkPortalEntry(player) {
    if(devMode || mapTransitioning || arena.state) return;
    if(blockedPortalId && !mapPortals.some(p=>p.id===blockedPortalId&&insidePortal(player,p))) blockedPortalId=null;
    const portal=mapPortals.find(p=>p.id!==blockedPortalId&&insidePortal(player,p));
    if(portal) enterPortal(portal);
}
function renderPortals() {
    world.querySelectorAll('.world-portal').forEach(el=>el.remove());
    const list=mapEl('dev-portal-list');list.replaceChildren();
    for(const portal of mapPortals) {
        const button=document.createElement('button');button.className='world-portal';button.dataset.id=portal.id;
        Object.assign(button.style,{left:portal.x+'px',top:portal.y+'px',width:portal.w+'px',height:portal.h+'px'});
        const label=document.createElement('span');label.textContent=portal.name;button.appendChild(label);
        const destination=mapCatalog.find(map=>map.id===portal.destination.mapId);
        button.setAttribute('aria-label',`${portal.name}: ir para ${destination?.name||'outro mapa'}`);
        button.addEventListener('mousedown',e=>e.stopPropagation());
        button.addEventListener('click',e=>{e.stopPropagation();if(devMode&&isAdmin) openPortalEditor(portal);else enterPortal(portal);});
        world.appendChild(button);
        const row=document.createElement('div');row.className='portal-list-item';
        const edit=document.createElement('button');edit.className='dev-tool-btn';edit.textContent=`↔ ${portal.name}`;edit.onclick=()=>openPortalEditor(portal);
        const remove=document.createElement('button');remove.className='dev-tool-btn';remove.textContent='×';remove.setAttribute('aria-label',`Excluir ${portal.name} e o portal de volta`);
        remove.onclick=async()=>{
            if(!confirm('Excluir este portal e o portal de volta?')) return;
            try {await mapRequest('portal_delete',{pairId:portal.pairId});toast('Os dois portais foram excluídos.','success');}
            catch(error){toast(error.message,'error');}
        };
        row.append(edit,remove);list.appendChild(row);
    }
}
socket.on('world_error',data=>toast(data.error,'error'));
socket.on('portals_updated',portals=>{mapPortals=portals;renderPortals();});
socket.on('map_updated',map=>{
    if(map.id!==currentZoneId)return;
    applyWorldMap(map);
    const me=players[myId];if(me){me.x=Math.max(0,Math.min(me.x,map.width-48));me.y=Math.max(0,Math.min(me.y,map.height-48));me.updatePos();}
});
async function refreshMapCatalog(){
    const response=await fetch('/api/maps');
    if(!response.ok)throw new Error('Não foi possível carregar os mapas.');
    mapCatalog=(await response.json()).maps;
    return mapCatalog;
}
socket.on('maps_changed',()=>refreshMapCatalog().catch(()=>{}));
socket.on('login_success',()=>refreshMapCatalog().then(renderPortals).catch(()=>{}));

document.body.insertAdjacentHTML('beforeend',`
<div id="map-editor" role="dialog" aria-modal="true" aria-labelledby="map-editor-title">
 <form class="map-editor-card" id="map-editor-form">
  <div class="map-editor-header"><h2 id="map-editor-title">Mapas</h2><button type="button" id="map-editor-close" aria-label="Fechar editor">×</button></div>
  <div class="map-editor-grid">
   <div>
    <div id="portal-source-fields">
     <label>Nome do portal<input id="portal-name" maxlength="40" value="Portal"></label>
     <h3 id="portal-source-title">Portal neste mapa</h3>
     <div class="map-field-row"><label>X<input id="portal-source-x" type="number" min="0" step="1" value="100"></label><label>Y<input id="portal-source-y" type="number" min="0" step="1" value="100"></label></div>
     <div class="map-field-row"><label>Largura do portal<input id="portal-width" type="number" min="48" value="64"></label><label>Altura do portal<input id="portal-height" type="number" min="48" value="64"></label></div>
    </div>
    <label id="map-picker-label"><span id="map-picker-title">Mapa de destino</span><select id="map-editor-picker"></select></label>
    <fieldset id="map-config-fields" style="border:0;padding:0;margin:0;">
     <label>Nome do mapa<input id="map-config-name" maxlength="60" required></label>
     <div class="map-field-row"><label>Largura (px)<input id="map-config-width" type="number" min="192" max="20000" value="1280" required></label><label>Altura (px)<input id="map-config-height" type="number" min="192" max="20000" value="960" required></label></div>
     <label>Fundo<select id="map-config-mode"><option value="repeat">Imagem repetida (tiles)</option><option value="single">Imagem única (interior)</option></select></label>
     <div id="map-image-size-fields">
      <label style="flex-direction:row;align-items:center;"><input id="map-config-fit" type="checkbox" checked style="width:auto;"> Ajustar imagem ao tamanho do mapa</label>
      <div class="map-field-row"><label>Largura da imagem (px)<input id="map-config-image-width" type="number" min="8" max="40000" value="1280"></label><label>Altura da imagem (px)<input id="map-config-image-height" type="number" min="8" max="40000" value="960"></label></div>
     </div>
     <label>Imagem de fundo (URL)<input id="map-config-url" placeholder="/uploads/imagem.png ou https://..."></label>
     <label>Ou envie uma imagem<input id="map-config-file" type="file" accept="image/*"></label>
     <div class="map-field-row"><label>Tamanho da repetição (px)<input id="map-config-tile" type="number" min="8" max="4096" value="256"></label><label>Cor de fundo<input id="map-config-color" type="color" value="#1a3a2a"></label></div>
     <h3>Entrada inicial do mapa</h3>
     <div class="map-field-row"><label>X<input id="map-spawn-x" type="number" min="0" value="100"></label><label>Y<input id="map-spawn-y" type="number" min="0" value="100"></label></div>
    </fieldset>
    <p id="map-config-lock-note" class="map-editor-hint" hidden>Este mapa já existe. Para alterar seu fundo ou tamanho, abra DEV → CONFIGURAR MAPAS e selecione-o.</p>
   </div>
   <div>
    <h3 id="map-preview-title">Chegada e portal de volta</h3>
    <p class="map-editor-hint" id="map-preview-hint">Clique na prévia ou informe as coordenadas. O portal de volta será criado exatamente neste ponto.</p>
    <div id="portal-destination-fields" class="map-field-row"><label>Chegada X<input id="portal-destination-x" type="number" min="0" value="100"></label><label>Chegada Y<input id="portal-destination-y" type="number" min="0" value="100"></label></div>
    <div class="map-preview-container"><div id="map-destination-preview" role="img" aria-label="Prévia do mapa de destino"><div class="map-preview-marker"></div></div></div>
    <p class="map-editor-hint" id="map-preview-size"></p>
    <p class="map-editor-hint" id="map-portal-explanation">Ida e volta automáticas. Para usar, saia do editor e caminhe até o portal. Ao chegar, afaste-se do portal antes de voltar.</p>
   </div>
  </div>
  <div id="map-editor-error" role="alert"></div>
  <div class="map-editor-actions"><button type="button" id="map-editor-visit">Visitar mapa</button><button type="button" id="map-editor-cancel">Cancelar</button><button type="submit" class="primary" id="map-editor-save">Salvar</button></div>
 </form>
</div>`);

function closeMapEditor(){mapEl('map-editor').classList.remove('active');mapEl('btn-edit-maps').focus();}
mapEl('map-editor-close').onclick=closeMapEditor;mapEl('map-editor-cancel').onclick=closeMapEditor;
mapEl('map-editor').addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeMapEditor();}
    if(event.key==='Tab'){
        const focusable=[...mapEl('map-editor').querySelectorAll('input,select,button')].filter(el=>!el.disabled&&el.getClientRects().length);
        const first=focusable[0],last=focusable.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
});
function setMapForm(map){
    mapEl('map-config-name').value=map.name;mapEl('map-config-width').value=map.width;mapEl('map-config-height').value=map.height;
    mapEl('map-config-url').value=map.background?.url||'';mapEl('map-config-mode').value=map.background?.mode||'repeat';
    mapEl('map-config-tile').value=map.background?.tileSize||256;mapEl('map-config-color').value=map.background?.color||'#1a3a2a';
    mapEl('map-config-fit').checked=map.background?.fitMap!==false;
    mapEl('map-config-image-width').value=map.background?.width||map.width;mapEl('map-config-image-height').value=map.background?.height||map.height;
    mapEl('map-spawn-x').value=map.spawn?.x??100;mapEl('map-spawn-y').value=map.spawn?.y??100;
    mapEl('map-config-file').value='';
}
function readMapForm(){return {
    name:mapEl('map-config-name').value,width:mapNumber('map-config-width'),height:mapNumber('map-config-height'),
    background:{url:mapEl('map-config-url').value,mode:mapEl('map-config-mode').value,tileSize:mapNumber('map-config-tile'),color:mapEl('map-config-color').value,fitMap:mapEl('map-config-fit').checked,width:mapNumber('map-config-image-width'),height:mapNumber('map-config-image-height')},
    spawn:{x:mapNumber('map-spawn-x'),y:mapNumber('map-spawn-y')}
};}
function updateMapPreview(){
    const map=readMapForm();if(!(map.width>0&&map.height>0))return;
    const preview=mapEl('map-destination-preview');
    const width=Math.max(30,Math.min(preview.parentElement.clientWidth-24,340*map.width/map.height));
    const scale=width/map.width;
    preview.style.width=width+'px';preview.style.height=(map.height*scale)+'px';
    paintMapBackground(preview,map,scale);
    const isPortal=editorMode==='portal';
    const x=mapNumber(isPortal?'portal-destination-x':'map-spawn-x'),y=mapNumber(isPortal?'portal-destination-y':'map-spawn-y');
    Object.assign(preview.firstChild.style,{left:(x*scale)+'px',top:(y*scale)+'px',width:((isPortal?mapNumber('portal-width'):48)*scale)+'px',height:((isPortal?mapNumber('portal-height'):48)*scale)+'px'});
    mapEl('map-preview-size').textContent=`${map.width} × ${map.height} px · ${map.background.mode==='single'?(map.background.fitMap?'Imagem única ajustada ao mapa':`Imagem de ${map.background.width} × ${map.background.height} px`):'Repetição a cada '+map.background.tileSize+' px'}`;
    mapEl('map-config-tile').disabled=mapEl('map-config-fields').disabled||map.background.mode==='single';
    mapEl('map-image-size-fields').hidden=map.background.mode!=='single';
    for(const id of ['map-config-image-width','map-config-image-height']) mapEl(id).disabled=mapEl('map-config-fields').disabled||map.background.fitMap;
}
function chooseEditorMap(){
    const id=mapEl('map-editor-picker').value;
    const map=mapCatalog.find(map=>map.id===id);
    setMapForm(map||{name:'Novo mapa',width:1280,height:960,spawn:{x:100,y:100}});
    mapEl('map-config-fields').disabled=editorMode==='portal'&&!!map;
    mapEl('map-config-lock-note').hidden=!mapEl('map-config-fields').disabled;
    mapEl('map-editor-visit').hidden=editorMode==='portal'||!map;
    updateMapPreview();
}
async function openWorldEditor(mode,portal,point){
    if(!isAdmin)return;
    try {await refreshMapCatalog();}catch(error){toast(error.message,'error');return;}
    editorMode=mode;editingPortal=portal||null;editorSourceMapId=currentZoneId;
    const isPortal=mode==='portal';
    mapEl('map-editor-title').textContent=isPortal?(portal?'Editar ligação de ida e volta':'Criar portal de ida e volta'):'Configurar mapas';
    mapEl('map-picker-title').textContent=isPortal?'Mapa de destino':'Mapa para configurar';
    mapEl('portal-source-fields').hidden=!isPortal;mapEl('portal-destination-fields').hidden=!isPortal;
    mapEl('map-portal-explanation').hidden=!isPortal;
    mapEl('map-preview-title').textContent=isPortal?'Chegada e portal de volta':'Prévia e entrada inicial';
    mapEl('map-preview-hint').textContent=isPortal?'Clique na prévia ou informe as coordenadas. O portal de volta será criado exatamente neste ponto.':'Clique na prévia para definir a posição inicial de quem entra neste mapa.';
    mapEl('map-editor-save').textContent=isPortal?'Salvar portais de ida e volta':'Salvar mapa';
    mapEl('map-editor-error').textContent='';
    mapEl('portal-source-title').textContent=`Saída em ${currentMap.name}`;
    mapEl('portal-name').value=portal?.name||'Portal';
    mapEl('portal-source-x').value=Math.round(portal?.x??point?.x??100);mapEl('portal-source-y').value=Math.round(portal?.y??point?.y??100);
    mapEl('portal-width').value=portal?.w||64;mapEl('portal-height').value=portal?.h||64;
    const picker=mapEl('map-editor-picker');picker.replaceChildren();
    picker.appendChild(new Option('+ Criar novo mapa','__new__'));
    mapCatalog.filter(map=>!isPortal||map.id!==currentZoneId).forEach(map=>picker.appendChild(new Option(map.name,map.id)));
    picker.value=isPortal?(portal?.destination.mapId||'__new__'):currentZoneId;
    chooseEditorMap();
    mapEl('portal-destination-x').value=portal?.destination.x??100;mapEl('portal-destination-y').value=portal?.destination.y??100;
    mapEl('map-editor').classList.add('active');updateMapPreview();
    for(const key in keys)keys[key]=false;
    const me=players[myId];
    if(me){me.setDir(me.dir,false);me.lastMove=false;socket.emit('move',{x:me.x,y:me.y,dir:me.dir,isMoving:false});}
    mapEl(isPortal?'portal-name':'map-config-name').focus();
}
function openPortalEditor(portal){return openWorldEditor('portal',portal);}
mapEl('btn-edit-maps').onclick=()=>openWorldEditor('map');
mapEl('map-editor-picker').onchange=chooseEditorMap;
mapEl('map-editor-form').addEventListener('input',updateMapPreview);
mapEl('map-editor-form').addEventListener('change',updateMapPreview);
window.addEventListener('resize',()=>{if(mapEl('map-editor').classList.contains('active'))updateMapPreview();});
mapEl('map-destination-preview').addEventListener('pointerdown',event=>{
    event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();const map=readMapForm();
    const isPortal=editorMode==='portal',w=isPortal?mapNumber('portal-width'):48,h=isPortal?mapNumber('portal-height'):48;
    mapEl(isPortal?'portal-destination-x':'map-spawn-x').value=Math.max(0,Math.min(Math.round((event.clientX-rect.left)/rect.width*map.width-w/2),map.width-w));
    mapEl(isPortal?'portal-destination-y':'map-spawn-y').value=Math.max(0,Math.min(Math.round((event.clientY-rect.top)/rect.height*map.height-h/2),map.height-h));
    updateMapPreview();
});
let backgroundUploading=false;
mapEl('map-config-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    backgroundUploading=true;mapEl('map-editor-save').disabled=true;
    try {
        const body=new FormData();body.append('image',file);body.append('type','map_background');
        const response=await fetch('/api/upload',{method:'POST',body});const result=await response.json();
        if(!result.success)throw new Error(result.error||'Falha no envio.');
        mapEl('map-config-url').value=result.item.url;updateMapPreview();
    }catch(error){mapEl('map-editor-error').textContent=error.message;}
    finally{backgroundUploading=false;mapEl('map-editor-save').disabled=false;}
};
mapEl('map-editor-form').onsubmit=async event=>{
    event.preventDefault();if(backgroundUploading)return;
    const button=mapEl('map-editor-save');button.disabled=true;mapEl('map-editor-error').textContent='';
    try {
        if(currentZoneId!==editorSourceMapId)throw new Error('O mapa mudou. Feche e reabra o editor.');
        const selected=mapEl('map-editor-picker').value;
        if(editorMode==='portal'){
            await mapRequest('portal_save',{
                pairId:editingPortal?.pairId,name:mapEl('portal-name').value,
                source:{x:mapNumber('portal-source-x'),y:mapNumber('portal-source-y'),w:mapNumber('portal-width'),h:mapNumber('portal-height')},
                destinationMapId:selected==='__new__'?undefined:selected,newMap:selected==='__new__'?readMapForm():undefined,
                destination:{x:mapNumber('portal-destination-x'),y:mapNumber('portal-destination-y'),w:mapNumber('portal-width'),h:mapNumber('portal-height')}
            });
            toast('Portais de ida e volta salvos!','success');
        }else{
            await mapRequest('map_save',{...readMapForm(),id:selected==='__new__'?undefined:selected});
            toast('Mapa salvo!','success');
        }
        await refreshMapCatalog();closeMapEditor();
    }catch(error){mapEl('map-editor-error').textContent=error.message;}
    finally{button.disabled=false;}
};
mapEl('map-editor-visit').onclick=async()=>{
    try{await mapRequest('map_visit',{mapId:mapEl('map-editor-picker').value});closeMapEditor();}
    catch(error){mapEl('map-editor-error').textContent=error.message;}
};
mapEl('btn-create-portal').onclick=()=>{
    placingPortal=true;document.body.classList.add('placing-portal');
    mapEl('btn-create-portal').textContent='CLIQUE NO CHÃO (ESC CANCELA)';
    toast('Clique no chão para posicionar o portal.','info');
};
function cancelPortalPlacement(){placingPortal=false;document.body.classList.remove('placing-portal');mapEl('btn-create-portal').textContent='CRIAR PORTAL DE IDA E VOLTA';}
world.addEventListener('pointerdown',event=>{
    if(!placingPortal||!isAdmin||!devMode)return;
    event.preventDefault();event.stopImmediatePropagation();
    const rect=world.getBoundingClientRect();
    const point={x:Math.max(0,Math.min(Math.round(event.clientX-rect.left-32),currentMap.width-64)),y:Math.max(0,Math.min(Math.round(event.clientY-rect.top-32),currentMap.height-64))};
    cancelPortalPlacement();openWorldEditor('portal',null,point);
},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')cancelPortalPlacement();});

mapEl('dev-bg-tile').addEventListener('change',()=>{
    const tileSize=Number(mapEl('dev-bg-tile').value);
    if(!Number.isInteger(tileSize)||tileSize<8||tileSize>4096){toast('Use um tamanho de 8 a 4096 pixels.','error');return;}
    if(currentMap.background?.mode==='single'){toast('Para dimensionar a imagem única, abra CONFIGURAR MAPAS.','info');return;}
    const url=currentMap.background?.url;
    if(url)socket.emit('create_global_background',{url,tileSize});
});
