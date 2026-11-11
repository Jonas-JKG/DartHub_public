'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';
import Link from 'next/link';
export default function Welcome({next='/'}:{next?:string}){useLanguage();return <main className="access-screen welcome-screen"><strong className="welcome-brand">DART<span className="mint">BRACKET</span></strong><h1>{translateUi("Anmeldung erforderlich")}</h1><p>{translateUi("Melde dich an, um Turniere und Training zu öffnen.")}</p><Link href={'/login?next='+encodeURIComponent(next)} className="button primary">{translateUi("Anmelden oder registrieren")}</Link><p className="muted">{translateUi("Zuschauer verwenden den Zuschauerlink des Turniers.")}</p></main>;}
