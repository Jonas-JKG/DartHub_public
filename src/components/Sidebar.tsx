'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import Link from 'next/link';
import {useAccountAccess} from './AccessBoundary';
import {useSyncExternalStore} from 'react';
import {socialNotificationCount,subscribeSocialNotifications} from '../client/social-notifications';
import {usePathname} from 'next/navigation';
export default function Sidebar({showManagers=false}:{showManagers?:boolean}){useLanguage();
 const signedIn=useAccountAccess();
 const path=usePathname(),unread=useSyncExternalStore(subscribeSocialNotifications,socialNotificationCount,()=>0);
 const section=path==='/'?'home':path==='/camera-device'?'camera':path==='/settings'?'settings':path.startsWith('/friends')?'friends':(path.startsWith('/minigames')||path.startsWith('/dartdeck'))?'minigames':path.startsWith('/training')?'training':path==='/managers'?'managers':path==='/turnier'||path==='/live'||path.startsWith('/tournaments/')||path.startsWith('/admin')?'tournaments':null;
 const links=[{id:'home',href:'/',label:translateUi("Startseite"),icon:'home'},{id:'tournaments',href:'/turnier',label:translateUi("Turnier"),icon:'trophy'},{id:'training',href:'/training',label:translateUi("Training"),icon:'graduation'},{id:'minigames',href:'/minigames',label:'Minigames',icon:'games'},{id:'settings',href:'/settings',label:translateUi("Einstellungen"),icon:'settings'},{id:'camera',href:'/camera-device',label:translateUi('Kamera'),icon:'camera'},{id:'friends',href:'/friends',label:translateUi("Freunde"),icon:'users'},...(showManagers?[{id:'managers',href:'/managers',label:translateUi("Spielerverwaltung"),icon:'manage'}]:[])];
 if(!signedIn)return null;
 return <aside className={'sidebar'+(showManagers?' has-managers':'')}>
  <Link href="/" className="brand"><svg width="34" height="34" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="15" stroke="currentColor" strokeWidth="2"/><circle cx="20" cy="20" r="9" stroke="currentColor" strokeWidth="2"/><circle cx="20" cy="20" r="3" fill="currentColor"/><path d="m20 20 14-14m-1 1 1-5 4 4-5 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg><span>DART<span className="mint">BRACKET</span></span></Link>
  <div className="side-label">{translateUi("MENÜ")}</div>
  <nav aria-label={translateUi("Hauptnavigation")}>{links.map(link=>link.id==='camera'?<a key={link.id} href={link.href} className={section===link.id?'active':undefined} aria-current={section===link.id?'page':undefined}><span aria-hidden="true" className="nav-icon"><NavIcon name={link.icon}/></span>{link.label}</a>:<Link key={link.id} href={link.href} className={section===link.id?'active':undefined} aria-current={section===link.id?'page':undefined}><span aria-hidden="true" className="nav-icon"><NavIcon name={link.icon}/></span>{link.label}{link.id==='friends'&&unread>0&&<b className="notification-count" aria-label={unread+translateUi(" offene Anfragen oder Einladungen")}>{unread>99?'99+':unread}</b>}</Link>)}</nav>

 </aside>;
}

function NavIcon({name}:{name:string}){useLanguage();return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name==='camera'?<><rect x="3" y="6" width="18" height="15" rx="3"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/></>:name==='games'?<><path d="M8 7h8a5 5 0 0 1 5 4l1 7a2 2 0 0 1-3 2l-4-3H9l-4 3a2 2 0 0 1-3-2l1-7a5 5 0 0 1 5-4Z M6 12h5 M8.5 9.5v5"/><circle cx="16" cy="11" r=".8"/><circle cx="18" cy="14" r=".8"/></>:name==='cards'?<><rect x="8" y="3" width="13" height="18" rx="2"/><path d="M5 5 2 7l4 14 M12 8h5 M12 12h5 M12 16h2"/></>:name==='trophy'?<><path d="M8 3h8v6a4 4 0 0 1-8 0Z M8 5H4v2a4 4 0 0 0 4 4 M16 5h4v2a4 4 0 0 1-4 4 M12 13v7 M8 21h8"/></>:name==='graduation'?<><path d="m2 9 10-5 10 5-10 5Z M6 11v6q6 4 12 0v-6 M22 9v7"/></>:name==='users'||name==='manage'?<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3 M16 4a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 5v2"/>{name==='manage'&&<path d="M18 12v5 M15.5 14.5h5"/>}</>:name==='settings'?<><circle cx="12" cy="12" r="3"/><path d="M9.7 3h4.6l.6 2.4 2 .9 2.2-.7 2.3 4-1.7 1.7v1.4l1.7 1.7-2.3 4-2.2-.7-2 .9-.6 2.4H9.7l-.6-2.4-2-.9-2.2.7-2.3-4 1.7-1.7v-1.4L2.6 9.6l2.3-4 2.2.7 2-.9L9.7 3Z"/></>:<path d="m3 11 9-8 9 8 M5 10v11h5v-7h4v7h5V10"/>}</svg>;}
