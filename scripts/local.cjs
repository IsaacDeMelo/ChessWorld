// Start a persistent local MongoDB and the application together.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {MongoClient} = require('mongodb');
const root = path.resolve(__dirname,'..');
const port = Number(process.env.LOCAL_MONGO_PORT || 27019);
const uri = `mongodb://127.0.0.1:${port}`;
let mongo, server, stopping = false;

async function ping() {
    const client = new MongoClient(uri,{serverSelectionTimeoutMS:500});
    try { await client.connect(); await client.db('admin').command({ping:1}); return true; }
    catch {return false;}
    finally {await client.close();}
}
function binary() {
    if(process.env.MONGOD_BIN)return process.env.MONGOD_BIN;
    const cache=path.join(os.homedir(),'.cache','mongodb-binaries');
    const entries=fs.existsSync(cache)?fs.readdirSync(cache):[];
    const cached=entries.find(name=>process.platform==='win32'?/^mongod.*\.exe$/.test(name):/^mongod[^.]*$/.test(name));
    return cached?path.join(cache,cached):'mongod';
}
async function stop(code=0) {
    if(stopping)return;
    stopping=true;
    server?.kill();
    if(mongo) {
        const client=new MongoClient(uri,{serverSelectionTimeoutMS:1000});
        try {await client.connect();await client.db('admin').command({shutdown:1});}
        catch {} finally {await client.close();}
    }
    process.exit(code);
}
async function main() {
    if(!await ping()) {
        const data=path.join(root,'data','local-mongo');
        fs.mkdirSync(data,{recursive:true});
        mongo=spawn(binary(),['--dbpath',data,'--port',String(port),'--bind_ip','127.0.0.1','--logpath',path.join(data,'mongod.log'),'--logappend'],{windowsHide:true,stdio:'ignore'});
        let launchError;
        mongo.on('error',error=>{launchError=error;});
        const deadline=Date.now()+60000;
        while(!await ping()) {
            if(launchError)throw new Error('MongoDB não encontrado. Instale o MongoDB ou indique seu executável em MONGOD_BIN.');
            if(mongo.exitCode!==null)throw new Error('MongoDB não iniciou. Confira data/local-mongo/mongod.log.');
            if(Date.now()>deadline)throw new Error('MongoDB demorou para iniciar. Confira data/local-mongo/mongod.log.');
            await new Promise(resolve=>setTimeout(resolve,200));
        }
    }
    const client=new MongoClient(uri);
    try {
        await client.connect();
        const db=client.db(process.env.DB_NAME||'chessworld');
        if(!(await db.listCollections().toArray()).length) {
            const seed=JSON.parse(fs.readFileSync(path.join(root,'data','db.json'),'utf8'));
            for(const [key,name] of Object.entries({skins:'skins',npcs:'npcs',objects:'barriers',sceneryTemplates:'scenery_templates',sceneryMap:'scenery_map'})) {
                if(seed[key]?.length)await db.collection(name).insertMany(seed[key]);
            }
        }
    } finally {await client.close();}
    console.log(`Banco local persistente: ${uri} (data/local-mongo)`);
    server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,MONGO_URI:uri},stdio:'inherit',windowsHide:true});
    server.on('exit',code=>{if(!stopping)stop(code||0);});
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
main().catch(error=>{console.error(error.message);stop(1);});
