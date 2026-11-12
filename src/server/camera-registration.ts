import {uniqueCameraName} from '../domain/camera';
import {rpc,DatabaseError} from './repositories/supabase';
/** The unique index from 028 arbitrates simultaneous registrations. Re-read the
 * account's names after a collision, rather than rejecting a valid new camera. */
export async function registerCamera(hash:string,device:string,data:{name:string;producer:string}){
 for(let attempt=0;attempt<4;attempt++){
  const list=await rpc('camera_transport',{p_hash:hash,p_operation:'list'}) as {allowed:boolean;devices:{id:string;name:string}[]};
  if(!list.allowed)throw new DatabaseError('Kameraerkennung ist für dieses Konto nicht freigeschaltet.','42501');
  const name=uniqueCameraName(data.name,list.devices,device);
  try{return await rpc('camera_transport',{p_hash:hash,p_operation:'register',p_device:device,p_data:{...data,name}});}
  catch(e){if(!(e instanceof DatabaseError)||e.code!=='23505'||!e.message.includes('camera_owner_name_unique')||attempt===3)throw e;}
 }
}
