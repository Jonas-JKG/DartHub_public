import {boardHit,type Hit} from './scoring';
export type CameraTip={x:number;y:number;confidence:number};
export type CameraConfig={zoom:number;lens:number;model:'s_960'|'s_1280';camera:string;run:boolean;armed:boolean;profileRevision?:number};
export const defaultCameraConfig:CameraConfig={zoom:1,lens:0,model:'s_960',camera:'',run:true,armed:false};
export type CameraTiming={startedAt:number;phoneMs:number;inferenceMs:number;clockErrorMs?:number};
export type CameraDiagnostics={frameId:number;phoneMs:number;inferenceMs:number;fetchMs:number;fetchKind?:'claim'|'snapshot';leaseMs?:number;fetchServerMs?:number;saveMs:number;totalMs?:number;clockErrorMs?:number;serverAgeMs?:number;mode:'push'|'poll';recordedAt:number};
export type CameraObservation={frameId:number;located:boolean;tips:CameraTip[];emptyCycle?:number;emptyStable?:boolean;timing?:CameraTiming};
export type CameraDevice={id:string;name:string;status:string;error:string;updated_at:string;seq:number;generation?:number;image_seq?:number;image_revision?:number;delivery_version?:number;wakeTopic?:string;frame_received_at?:string;diagnostics?:CameraDiagnostics;frame_id?:number;observation?:{located:boolean;tips:CameraTip[];emptyCycle?:number;emptyStable?:boolean;imageRevision?:number;frames?:CameraObservation[]};image?:string;preview?:string;config:CameraConfig;config_version:number;actual?:{ms?:number;uploadMs?:number;imageMs?:number;backend?:string;preprocessing?:string;testStep?:number;zoomMode?:string;zoomMax?:number;cameras?:{deviceId:string;label:string}[]};busy?:boolean};
export function cameraHit(tip:CameraTip):Hit{const x=(tip.x-500000)*451/170/1000000,y=-(tip.y-500000)*451/170/1000000;const h=boardHit(x,y),radius=Math.hypot(x,y)*170;/* Measured camera geometry uses the physical 160/170 and 97/107mm rings. */if(h.number>0&&h.number<=20)h.multiplier=radius>=160?2:radius>=97&&radius<=107?3:1;return {...h,position:{x,y}};}
/** Tracking belongs to a physical board, never a player turn. Missing tips are not takeout.
 * Start/reconnect/calibration require two distinct, confidently empty frames. Never infer ordering
 * when a slow connection delivers multiple new darts together. Corrections remain authoritative.
 */
export class CameraCursor{
 get lastFrame(){return this.frame;}
 private cycle:number|null=null;private frame=-1;private known:CameraTip[]=[];private emptyAt=0;private ready=false;private candidate:CameraTip|null=null;private armedVisit:string|null=null;
 reset(){this.cycle=null;this.frame=-1;this.known=[];this.emptyAt=0;this.ready=false;this.candidate=null;this.armedVisit=null;}
 accept(frame:number,located:boolean,tips:CameraTip[],eligible:boolean,visit:string,now=Date.now(),cycle?:number,emptyStable=false):{hit?:Hit;index?:number;takeout?:string;status:string}{
  if(cycle!==undefined){if(this.cycle!==null&&cycle>this.cycle){this.cycle=cycle;const takeout=this.armedVisit??undefined;this.armedVisit=null;this.known=[];this.candidate=null;this.frame=-1;this.ready=true;if(takeout)return {takeout,status:'active'};}else this.cycle=cycle;}
  if(located&&!tips.length&&emptyStable){this.ready=true;this.emptyAt=now-501;}
  if(frame===this.frame)return {status:this.ready?'active':'empty'};this.frame=frame;
  if(!located){this.emptyAt=0;this.candidate=null;return {status:'aligning'};}
  if(!tips.length){if(!this.emptyAt){this.emptyAt=now;return {status:this.ready?'active':'empty'};}if(now-this.emptyAt<500)return {status:'empty'};const takeout=this.armedVisit??undefined;this.known=[];this.candidate=null;this.ready=true;this.armedVisit=null;return {status:'active',takeout};}
  this.emptyAt=0;if(!this.ready)return {status:'empty'};
  // Assign each visible tip at most once. Updating known positions absorbs ordinary model jitter;
  // filtering every tip by distance to a frozen first observation lost darts in tight groups.
  const visible=tips.filter(t=>t.confidence>=.8),used=new Set<number>(),matched=new Set<number>();
  const pairs=this.known.flatMap((k,i)=>visible.map((t,j)=>({i,j,d:Math.hypot(t.x-k.x,t.y-k.y)}))).filter(p=>p.d<12000).sort((a,b)=>a.d-b.d);
  for(const p of pairs)if(!matched.has(p.i)&&!used.has(p.j)){matched.add(p.i);used.add(p.j);this.known[p.i]=visible[p.j];}
  const fresh=visible.filter((_,i)=>!used.has(i));
  if(fresh.length>1){this.candidate=null;return {status:'ambiguous'};}
  if(!fresh.length){this.candidate=null;return {status:'active'};}
  const tip=fresh[0];if(!this.candidate||Math.hypot(tip.x-this.candidate.x,tip.y-this.candidate.y)>=9000){this.candidate=tip;return {status:'active'};}
  this.known.push(tip);this.candidate=null;const index=this.known.length-1;
  if(!eligible||index>2)return {status:'active'};this.armedVisit=visit;return {hit:cameraHit(tip),index,status:'active'};
 }
}

/** A saved camera name is unique within its owning account. */
export const normalizeCameraName=(name:string)=>name.normalize('NFC').replace(/\s+/gu,' ').trim();
export const cameraNameKey=(name:string)=>normalizeCameraName(name).toLowerCase();
/** Reuse the current device's name; new devices get the first available -N. */
export function uniqueCameraName(requested:string,devices:readonly {id:string;name:string}[],ownId?:string|null){
 let base=normalizeCameraName(requested);const used=new Set(devices.filter(d=>d.id!==ownId).map(d=>cameraNameKey(d.name)));
 if(!used.has(cameraNameKey(base)))return base;
 const numbered=base.match(/^(.*)-([0-9]+)$/u);let first=2;
 if(numbered&&used.has(cameraNameKey(numbered[1]))&&Number.isSafeInteger(Number(numbered[2]))&&Number(numbered[2])>=2&&Number(numbered[2])<Number.MAX_SAFE_INTEGER-devices.length-2){base=numbered[1];first=Number(numbered[2])+1;}
 for(let index=first;;index++){
  const suffix='-'+index;let prefix=base.slice(0,50-suffix.length).trimEnd();
  if(/[\uD800-\uDBFF]$/.test(prefix))prefix=prefix.slice(0,-1);
  const candidate=prefix+suffix;if(!used.has(cameraNameKey(candidate)))return candidate;
 }
}
