'use client';
import DeviceAccounts from './DeviceAccounts';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import GameAudio from './GameAudio';
import AutodartsPanel from './AutodartsPanel';
import LanguagePreferences from './LanguagePreferences';
import ThemeSettings from './ThemeSettings';
import Sidebar from './Sidebar';
import AccountAuthButton from './AccountAuthButton';
import AccountUsername from './AccountUsername';
import AccountMailDiagnostics from './AccountMailDiagnostics';
import {ViewPreferences} from './DevicePreferences';
export default function PreferencesScreen(){useLanguage();const [account,setAccount]=useState(false);const [showManagers,setShowManagers]=useState(false);const [identity,setIdentity]=useState<{id:string;player:string;name:string;training?:boolean}|null>(null);useEffect(()=>{fetch('/api/app',{cache:'no-store'}).then(r=>r.json()).then(d=>{setAccount(d.session?.role==='owner'||!!d.session?.playerLocked);setShowManagers(!!d.accountsEnabled&&d.session?.role==='owner'&&!d.session.managerId);const id=d.session?.playingTournamentId??d.session?.tournamentId,player=d.session?.participantId;if(id&&player)setIdentity({id,player,training:!!d.session.trainingId,name:d.tournaments?.find((t:{id:string})=>t.id===id)?.participants.find((p:{id:string})=>p.id===player)?.name??translateUi("Spieler")});});},[]);return <div className="shell"><Sidebar showManagers={showManagers}/><div className="main-wrap"><header className="topbar"><span className="breadcrumb">DartHub <span>/</span>  {translateUi("Meine Einstellungen")}</span><AccountAuthButton/></header><main className="preferences-screen"><Link href={identity?(identity.training?'/training/':'/tournaments/')+identity.id:'/'} className="back">{translateUi("← Zur Übersicht")}</Link><h1>{translateUi("Meine Einstellungen")}</h1><p>{translateUi("Die Anzeige gilt auf diesem Gerät. Eine verknüpfte Autodarts-Scheibe gehört zu deinem Zugang und ist auch nach dem erneuten Anmelden verfügbar.")}</p><DeviceAccounts/><AccountUsername/>{showManagers&&<AccountMailDiagnostics/>}<LanguagePreferences/><ThemeSettings/><ViewPreferences/><GameAudio game={null} configure/>{identity||account?<AutodartsPanel scope={identity?identity.id+':'+identity.player:'account'} tournamentId={identity?.id??''} playerId={identity?.player} matchId="" imageActive={false} eligible={false} visitKey="" onHit={async()=>true} onTakeout={async()=>true}/>:<Link href="/login" className="button primary">{translateUi("Mit deinem Konto anmelden")}</Link>}</main></div></div>;}
