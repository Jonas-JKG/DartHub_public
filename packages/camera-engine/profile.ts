// SPDX-License-Identifier: AGPL-3.0-only
// Host adapter for the pinned upstream benchmark and validation, not a substitute inference model.
import {createOnboardingHarness} from './src/client/lib/onboardingHarness';
import {runOnboarding,rungsFrom,REFERENCE_BOARDS,type ChosenSettings} from './src/client/lib/onboarding';
import type {Camera} from './src/client/vision/camera';
export async function deviceProfile(camera:Camera,video:HTMLVideoElement,deviceId:string,model:string,revision:number,progress:(step:number)=>void,active:()=>boolean):Promise<ChosenSettings>{
 const key='camera-profile:a455d7:v2:'+navigator.userAgent+':'+deviceId+':'+model+':'+revision;
 try{const s=JSON.parse(localStorage.getItem(key)??'null');if(s&&s.model===model&&['forceCpuMotion','forceCpuPreprocessing','forceCpuInference'].every(k=>typeof s[k]==='boolean'))return s;}catch{}
 const check=()=>{if(!active())throw new DOMException('Camera setup cancelled','AbortError');};
 let opened=0;const harness=await createOnboardingHarness(()=>{}, {video,maximumShortSide:()=>camera.maximumShortSide(),ensureInputSize:async size=>{check();if(opened!==size){await camera.start(deviceId,size);opened=size;}check();}});
 // Onboarding catches unsupported paths internally. Guard every measurement to avoid restarting
 // the camera after Stop; the harness is always disposed before the runtime loads its own model.
 for(const name of ['prepareCamera','loadRunner','runCamera','runBoard','motionPass'] as const){const fn=harness[name].bind(harness) as (...args:any[])=>Promise<any>;(harness as any)[name]=async(...args:any[])=>{check();const r=await fn(...args);check();return r;};}
 try{await harness.prepareCamera(model);const result=await runOnboarding(harness,e=>{check();if(e.kind==='stage')progress(['motion','model960','model1280','validation'].indexOf(e.outcome.stage)+1);},{model,forceCpuMotion:false,forceCpuPreprocessing:false,forceCpuInference:false});check();if(!result.ok)throw Error('Gerätetest fehlgeschlagen');
  // Respect the resolution chosen remotely, and use the measured pairing for that resolution.
  const stage=result.stages.find(s=>s.stage===(model==='s_1280'?'model1280':'model960')),combo=stage?.matrix?.selected;
  const settings={...result.settings,model,...(model!==result.settings.model&&combo?{forceCpuPreprocessing:combo.startsWith('cpu-'),forceCpuInference:combo.endsWith('-cpu')}:{})};
  let verified=false;for(const rung of rungsFrom(settings)){Object.assign(settings,rung.patch);try{await harness.loadRunner(model,settings.forceCpuInference);let valid=true;for(const board of REFERENCE_BOARDS){const {counts}=await harness.runBoard(board,settings.forceCpuPreprocessing);if(!counts||counts.boardKeypoints<board.minimumBoardKeypoints||counts.tipKeypoints!==board.tipKeypoints){valid=false;break;}}if(valid){verified=true;break;}}catch{check();}}check();if(!verified)throw Error('Modelltest fehlgeschlagen');try{localStorage.setItem(key,JSON.stringify(settings));}catch{}return settings;
 }finally{await harness.dispose();camera.stop();}
}
