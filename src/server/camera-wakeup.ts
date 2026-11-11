import {db} from './repositories/supabase';
import {rateKey} from './security';
/** Capability topics carry only wake-ups, never tips, images, sessions or scores.
 * A wake-up cannot authorize anything: recipients fetch through the existing session/lease checks.
 */
const period=120000;
export function cameraWakeTopic(id:string,now=Date.now()){return 'camera-wake:'+rateKey('camera-wakeup:v1:'+id+':'+Math.floor(now/period));}
export async function wakeCamera(id:string,event='changed'){const now=Date.now();await Promise.allSettled([now,now-period].map(async time=>{const client=db(),channel=client.channel(cameraWakeTopic(id,time));try{await channel.httpSend(event,{}, {timeout:1500});}finally{await client.removeChannel(channel);}}));}
