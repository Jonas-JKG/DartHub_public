import {build} from 'esbuild';
import {readFile,writeFile,mkdir,cp,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),out=root+'../../public/camera-engine/',meta=JSON.parse(await readFile(root+'upstream.json','utf8'));
await mkdir(out,{recursive:true});
for(const [name,hash] of Object.entries({...meta.models,...meta.reference})){
 const reference=name.endsWith('.jpg'),folder=reference?'reference':'models';
 let bytes;try{bytes=await readFile(root+folder+'/'+name);}catch{throw Error('Bundled camera asset missing: '+folder+'/'+name+'. Restore it from this repository.');}
 if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Bundled camera asset checksum mismatch: '+folder+'/'+name);await mkdir(out+folder,{recursive:true});await writeFile(out+folder+'/'+name,bytes);
}
await cp(root+'node_modules/@litertjs/core/wasm',out+'wasm',{recursive:true});
await build({entryPoints:[root+'entry.ts'],outfile:out+'engine.js',bundle:true,format:'esm',target:'es2022',minify:true,legalComments:'eof'});
await cp(root+'index.html',out+'index.html');await cp(root+'LICENSE',out+'LICENSE.txt');
// Complete corresponding source of this standalone AGPL camera program, including its model weights.
const entries=[];
async function walk(dir,relative=''){for(const name of (await readdir(dir)).sort()){if(['node_modules','.cache'].includes(name))continue;const path=relative+name,s=await stat(dir+name);if(s.isDirectory())await walk(dir+name+'/',path+'/');else entries.push([path,await readFile(dir+name)]);}}
await walk(root);
const parts=[];for(const [name,bytes] of entries){const h=Buffer.alloc(512),put=(v,start,size)=>h.write(String(v),start,size,'utf8');put(name,0,100);put('0000644',100,8);put('0000000',108,8);put('0000000',116,8);put(bytes.length.toString(8).padStart(11,'0'),124,12);put('00000000000',136,12);h.fill(32,148,156);put('0',156,1);put('ustar\0',257,6);put('00',263,2);put(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148,8);parts.push(h,bytes,Buffer.alloc((512-bytes.length%512)%512));}parts.push(Buffer.alloc(1024));await writeFile(out+'source.tar.gz',gzipSync(Buffer.concat(parts)));
