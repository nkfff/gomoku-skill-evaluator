import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),manifest=JSON.parse(readFileSync(path.join(root,'offline-assets.json'),'utf8'));
for(const [name,expected] of Object.entries(manifest.files)){
 if(name.startsWith('/')||name.split('/').includes('..'))throw Error('Unsafe asset path');
 const bytes=readFileSync(path.join(root,name)),actual=createHash('sha256').update(bytes).digest('hex');if(actual!==expected)throw Error('Offline assets stale: '+name+'; regenerate the offline cache');
}
const model=JSON.parse(readFileSync(path.join(root,'models/model.json'),'utf8')),actual=createHash('sha256').update(readFileSync(path.join(root,'models',model.file))).digest('hex');if(actual!==model.sha256)throw Error('Model checksum mismatch');
if(model.shape.join(',')!=='1,4,15,15')throw Error('Model must be fixed batch one');
if(!readFileSync(path.join(root,'vendor/ort/LICENSE'),'utf8').includes('MIT License'))throw Error('Runtime license missing');
console.log('Offline assets and model SHA256 verified; inference needs no API server.');
