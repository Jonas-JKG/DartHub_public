export class AutodartsRequestError extends Error {constructor(message:string,public status:number){super(message);}}
/** Some WebSocket implementations deliver JSON as binary. Decode in arrival order. */
export async function decodeAutodartsMessage(raw:unknown):Promise<unknown|null>{
 try{
  let text:string;
  if(typeof raw==='string'){if(raw.length>100000)return null;text=raw;}
  else if(raw instanceof ArrayBuffer){if(raw.byteLength>100000)return null;text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}
  else if(typeof Blob!=='undefined'&&raw instanceof Blob){if(raw.size>100000)return null;text=await raw.text();}
  else return null;
  return JSON.parse(text);
 }catch{return null;}
}
/** Retry only the explicit, temporary saved-token lease conflict. Never repeat a login. */
export async function autodartsRequest(body:unknown,headers:Record<string,string>,onWait:()=>void=()=>{}){
 for(let attempt=0;;attempt++){
  const response=await fetch('/api/autodarts',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),data=await response.json();
  if((!body||typeof body!=='object'||!('operation' in body)||body.operation!=='login')&&response.status===409&&typeof data.retryAfter==='number'&&data.retryAfter>0&&attempt<4){onWait();await new Promise(resolve=>setTimeout(resolve,Math.min(2000,data.retryAfter*1000)));continue;}
  if(!response.ok||data.error)throw new AutodartsRequestError(data.error??'Verbindung fehlgeschlagen.',response.status);return data;
 }
}
