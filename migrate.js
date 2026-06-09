const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGO_URI = 'mongodb+srv://kingkongdev2005_db_user:yYtXsbfrRLoIWq4O@cluster0.raovnbb.mongodb.net/?appName=Cluster0';
const DB_NAME = 'chessworld';

async function migrate() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/db.json'), 'utf8'));

    if (data.players && data.players.length > 0) {
        await db.collection('players').deleteMany({});
        await db.collection('players').insertMany(data.players);
        console.log(`Migrated ${data.players.length} players`);
    }

    if (data.objects && data.objects.length > 0) {
        await db.collection('barriers').deleteMany({});
        await db.collection('barriers').insertMany(data.objects);
        console.log(`Migrated ${data.objects.length} barriers`);
    }

    if (data.skins && data.skins.length > 0) {
        await db.collection('skins').deleteMany({});
        await db.collection('skins').insertMany(data.skins);
        console.log(`Migrated ${data.skins.length} skins`);
    }

    if (data.npcs && data.npcs.length > 0) {
        await db.collection('npcs').deleteMany({});
        await db.collection('npcs').insertMany(data.npcs);
        console.log(`Migrated ${data.npcs.length} npcs`);
    }

    if (data.sceneryTemplates && data.sceneryTemplates.length > 0) {
        await db.collection('scenery_templates').deleteMany({});
        await db.collection('scenery_templates').insertMany(data.sceneryTemplates);
        console.log(`Migrated ${data.sceneryTemplates.length} scenery templates`);
    }

    if (data.sceneryMap && data.sceneryMap.length > 0) {
        await db.collection('scenery_map').deleteMany({});
        await db.collection('scenery_map').insertMany(data.sceneryMap);
        console.log(`Migrated ${data.sceneryMap.length} scenery map items`);
    }

    await db.collection('players').createIndex({ username: 1 }, { unique: true });

    console.log('Migration complete!');
    await client.close();
}

migrate().catch(console.error);
