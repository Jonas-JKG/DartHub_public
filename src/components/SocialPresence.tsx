'use client';
import {useEffect} from 'react';
import {useAccountAccess} from './AccessBoundary';
import {useAccountDataCache} from './AccountDataCache';
import {publishSocialNotifications} from '../client/social-notifications';
export default function SocialPresence(){const signedIn=useAccountAccess(),cache=useAccountDataCache();useEffect(()=>{if(!signedIn)return;let stopped=false,running=false;async function refresh(){if(stopped||running||document.visibilityState!=='visible')return;running=true;try{const r=await fetch('/api/friends',{cache:'no-store'});if(r.ok&&!stopped){const data=await r.json();cache?.entries.set('/api/friends',data);publishSocialNotifications(data);}void fetch('/api/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'heartbeat'})}).catch(()=>{});}catch{}finally{running=false;}}void refresh();const timer=setInterval(()=>void refresh(),20000);window.addEventListener('focus',refresh);return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',refresh);};},[signedIn,cache]);return null;}
