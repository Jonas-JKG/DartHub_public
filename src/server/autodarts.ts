import { trustedBoardImageUrl } from '../domain/board-image';
import { z } from 'zod';
export class AutodartsError extends Error {}
const tokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).max(1400)});
async function request(url:string,body?:unknown,access?:string) {
  let response:Response;
  try{response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(access?{Authorization:'Bearer '+access}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});}
  catch{throw new AutodartsError('Autodarts ist momentan nicht erreichbar. Du kannst weiter manuell spielen.');}
  if(!response.ok)throw new AutodartsError(response.status===401||response.status===403?'Autodarts hat die Anmeldung oder Verbindung abgelehnt. Bitte Zugangsdaten prüfen. Diese experimentelle Anbindung unterstützt noch nicht jeden Anmeldeweg.':'Die Autodarts-Schnittstelle hat die Anfrage abgelehnt. Bitte später erneut versuchen.');
  try{return await response.json() as unknown;}catch{throw new AutodartsError('Autodarts hat eine unbekannte Antwort gesendet.');}
}
export async function loginAutodarts(username:string,password:string) {
  const parsed=tokenSchema.safeParse(await request('https://api.autodarts.com/auth/v1/login',{username,password,client_id:'autodarts-play'}));
  if(!parsed.success)throw new AutodartsError('Der Autodarts-Anmeldeweg wird noch nicht unterstützt.');
  return parsed.data;
}
export async function refreshAutodarts(refreshToken:string) {
  const parsed=tokenSchema.safeParse(await request('https://api.autodarts.com/auth/v1/refresh',{refresh_token:refreshToken,client_id:'autodarts-play'}));
  if(!parsed.success)throw new AutodartsError('Bitte erneut bei Autodarts anmelden.');return parsed.data;
}
export async function listAutodartsBoards(access:string) {
  const raw=await request('https://api.autodarts.com/bs/v0/boards',undefined,access);
  const rows=Array.isArray(raw)?raw:raw&&typeof raw==='object'&&'boards' in raw?(raw as {boards:unknown}).boards:null;
  if(!Array.isArray(rows))throw new AutodartsError('Die Board-Liste hat ein unbekanntes Format. Die Verbindung muss mit deiner Autodarts-Version geprüft werden.');
  return rows.flatMap(v=>{const p=z.object({id:z.string().min(1).max(100),name:z.string().optional()}).safeParse(v);return p.success?[{id:p.data.id,name:p.data.name??'Meine Scheibe'}]:[];});
}
export async function autodartsTicket(access:string) {
  const p=z.object({code:z.string().min(1).max(2048)}).safeParse(await request('https://play.ws.autodarts.com/ms/v0/tickets',{},access));
  if(!p.success)throw new AutodartsError('Autodarts hat kein gültiges Verbindungsticket geliefert.');
  return 'wss://play.ws.autodarts.com/ms/v0/subscribe?code='+encodeURIComponent(p.data.code);
}

/** Bootstrap only: never derive scores from the count-only HTTP state. */
export async function autodartsBoardEmpty(access:string,boardId:string):Promise<boolean> {
  const raw=await request('https://api.autodarts.com/bs/v0/boards/'+encodeURIComponent(boardId)+'/state',undefined,access);
  const state=z.object({numThrows:z.number().int().min(0).max(3),connected:z.boolean().optional(),throws:z.array(z.unknown()).optional()}).safeParse(raw);
  return state.success&&state.data.connected!==false&&state.data.numThrows===0&&(!state.data.throws||state.data.throws.length===0);
}

export async function autodartsImage(access:string,boardId:string,cam:number) {
  const raw=await request('https://api.autodarts.com/bs/v0/boards/'+encodeURIComponent(boardId)+'/img/live?cam='+cam+'&warp=true',undefined,access);
  const url=trustedBoardImageUrl(raw&&typeof raw==='object'&&'url' in raw?raw.url:null);
  if(!url)throw new AutodartsError('Autodarts hat noch kein Scheibenbild bereitgestellt.');return url;
}
