import {createClient} from '@supabase/supabase-js';
export function watchCamera(topic:string|undefined,wake:()=>void,connected:(value:boolean)=>void,event='changed'){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!topic||!url||!key){connected(false);return()=>{};}
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});let live=true,last=0;const channel=db.channel(topic).on('broadcast',{event},()=>{if(live&&performance.now()-last>=100){last=performance.now();wake();}}).subscribe(s=>{if(live){connected(s==='SUBSCRIBED');if(s==='SUBSCRIBED')wake();}});
 return()=>{live=false;void db.removeChannel(channel);};}
