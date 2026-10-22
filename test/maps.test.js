const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validateMap,endpoint,overlaps,clamp} = require('../world-maps');

test('map dimensions and repeat scale must be usable',()=>{
    assert.throws(()=>validateMap({name:'Casa',width:191,height:480}));
    assert.throws(()=>validateMap({name:'Casa',width:640,height:480,background:{tileSize:0}}));
    const map=validateMap({name:'Casa',width:640,height:480,spawn:{x:999,y:-4},background:{mode:'single',url:'/house.png'}});
    assert.equal(map.background.mode,'single');
    assert.deepEqual(map.spawn,{x:592,y:0});
});

test('both portal rectangles must fit fully inside their maps',()=>{
    const map={id:'house',width:640,height:480};
    assert.deepEqual(endpoint(map,{x:576,y:416}),{mapId:'house',x:576,y:416,w:64,h:64});
    assert.throws(()=>endpoint(map,{x:600,y:416}));
    assert.throws(()=>endpoint(map,{x:NaN,y:0}));
    assert.throws(()=>endpoint(map,{x:0,y:0,w:20}));
});

test('single images can have dimensions independent of map boundaries',()=>{
    const map=validateMap({name:'Casa',width:640,height:480,background:{mode:'single',fitMap:false,width:320,height:240}});
    assert.equal(map.width,640);
    assert.equal(map.background.width,320);
    assert.equal(map.background.height,240);
    assert.equal(map.background.fitMap,false);
    assert.throws(()=>validateMap({...map,background:{...map.background,width:0}}));
});

test('portal arrival latch clears only after the entire character leaves',()=>{
    const portal={x:100,y:100,w:64,h:64};
    assert.equal(overlaps({x:100,y:100},portal),true);
    assert.equal(overlaps({x:60,y:100},portal),true);
    assert.equal(overlaps({x:52,y:100},portal),false);
    assert.equal(overlaps({x:164,y:100},portal),false);
    assert.equal(clamp(1000,640),592);
});
