import type {CameraDevice} from '../domain/camera';
type Binding={context:'tournament'|'dartdeck';id:string;match:string;player:string;visit:string};
type Reply=CameraDevice&{_timing?:{requestMs:number}};
type Request=(body:unknown)=>Promise<Reply>;
/** A valid lease can serve snapshots while its full authorization renews in the background.
 * Changing players, an invalidated connection or an almost expired lease must claim first.
 */
export class CameraLease{
 private valid=false;private key='';private at=0;private fast=false;private stopped=false;
 private renewing:Promise<unknown>|null=null;private claiming:Promise<Reply>|null=null;
 lastRenewMs:number|undefined;
 constructor(private device:string,readonly controller:string,private request:Request,private now=()=>Date.now(),private onClaim?:(data:Reply)=>void){}
 get supportsFastReads(){return this.fast;}
 invalidate(disableFast=false){this.valid=false;this.at=0;if(disableFast)this.fast=false;}
 private bindingKey(b:Binding){return [b.context,b.id,b.match,b.player].join(':');}
 private claim(b:Binding,previewRevision:number){return this.request({operation:'claim',device:this.device,controller:this.controller,previewRevision,binding:b});}
 private adopt(d:Reply,key:string){if(this.stopped)return;this.valid=true;this.key=key;this.at=this.now();this.fast=typeof d.image_revision==='number'||d.delivery_version===1;this.lastRenewMs=d._timing?.requestMs;this.onClaim?.(d);}
 async read(b:Binding,previewRevision:number){if(this.stopped)throw new DOMException('Camera disconnected','AbortError');const key=this.bindingKey(b);
  if(!this.valid||!this.fast||key!==this.key||this.now()-this.at>=9000){
   // A previous renewal must finish before rebinding; otherwise its late response could
   // restore the previous player's image binding. close() waits for this write too.
   await this.renewing;if(this.stopped)throw new DOMException('Camera disconnected','AbortError');
   const work=this.claim(b,previewRevision);this.claiming=work;
   try{const data=await work;this.adopt(data,key);return {data,kind:'claim' as const};}finally{if(this.claiming===work)this.claiming=null;}
  }
  if(this.now()-this.at>=4000&&!this.renewing){const work=this.claim(b,previewRevision).then(d=>this.adopt(d,key)).catch(e=>{if(e&&[401,403,409].includes(e.status))this.invalidate();});this.renewing=work;void work.finally(()=>{if(this.renewing===work)this.renewing=null;});}
  return {data:await this.request({operation:'snapshot',device:this.device,controller:this.controller}),kind:'snapshot' as const};
 }
 async close(){this.stopped=true;await Promise.allSettled([this.claiming,this.renewing]);try{await this.request({operation:'release',device:this.device,controller:this.controller});}catch{}}
}
