import {db,DatabaseError} from './repositories/supabase';
export class EmailVerificationRequired extends Error {constructor(){super('Bitte bestätige zuerst deine E-Mail-Adresse. Fordere dafür eine neue Bestätigungsmail an.');}}
export type EmailUser={id:string;email?:string;email_confirmed_at?:string;confirmation_sent_at?:string;user_metadata?:Record<string,unknown>};
/** Call ONLY after getUser(accessToken) succeeded against Supabase Auth. */
export function hasEmailProofInValidatedToken(accessToken:string,email?:string){
 try{
  const payload=JSON.parse(Buffer.from(accessToken.split('.')[1],'base64url').toString('utf8'));
  if(email&&payload.email?.trim().toLowerCase()!==email.trim().toLowerCase())return false;
  return Array.isArray(payload.amr)&&payload.amr.some((entry:{method?:string}|string)=>{
   const method=typeof entry==='string'?entry:entry?.method;
   return method==='magiclink'||method==='recovery'||method==='otp'&&!payload.phone;
  });
 }catch{return false;}
}

export async function requireVerifiedEmail(user:EmailUser,emailProof=false){
 if(!user.email||!user.email_confirmed_at)throw new EmailVerificationRequired();
 if(emailProof)return;
 const {data,error}=await db().from('managers').select('email_verified_at,email_verified_address,email_verification_version,email_verification_required').eq('id',user.id).maybeSingle();
 if(error)throw new DatabaseError(error.message,error.code);
 if(data?.email_verification_version!==1||!data.email_verified_at||data.email_verified_address!==user.email.trim().toLowerCase()||data.email_verification_required)throw new EmailVerificationRequired();
}
export async function recordVerifiedEmail(user:EmailUser,ensureProfile=false){
 if(ensureProfile){
  const name=typeof user.user_metadata?.name==='string'?user.user_metadata.name.trim().slice(0,80):user.email!.split('@')[0];
  const {error}=await db().from('managers').upsert({id:user.id,email:user.email!.trim().toLowerCase(),name:name||'Spieler',approved:true},{onConflict:'id',ignoreDuplicates:true});
  if(error)throw new DatabaseError(error.message,error.code);
 }
 const {error}=await db().from('managers').update({email:user.email!.trim().toLowerCase(),email_verified_at:new Date().toISOString(),email_verified_address:user.email!.trim().toLowerCase(),email_verification_version:1,email_verification_required:false}).eq('id',user.id);
 if(error)throw new DatabaseError(error.message,error.code);
}
