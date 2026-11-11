'use client';
let count=0;
const listeners=new Set<()=>void>();
export function socialNotificationCount(){return count;}
export function subscribeSocialNotifications(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function publishSocialNotifications(value:{account?:boolean;friends?:{status:string;incoming:boolean}[];invitations?:unknown[]}){
 const next=value.account?(value.friends?.filter(f=>f.status==='pending'&&f.incoming).length??0)+(value.invitations?.length??0):0;
 if(next===count)return;count=next;for(const listener of listeners)listener();
}
