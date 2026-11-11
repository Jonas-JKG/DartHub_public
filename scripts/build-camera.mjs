import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
if(!existsSync('packages/camera-engine/node_modules/esbuild'))execFileSync('npm',['ci','--prefix','packages/camera-engine','--include=dev','--no-audit','--no-fund'],{stdio:'inherit'});
execFileSync('npm',['run','build','--prefix','packages/camera-engine'],{stdio:'inherit',env:{...process.env,NODE_USE_ENV_PROXY:'1'}});
