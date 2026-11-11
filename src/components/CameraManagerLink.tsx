'use client';
import {translate as t,useLanguage} from '../i18n/locale';
/** A remote controller only: it never starts a second producer or claims the match lease. */
export default function CameraManagerLink({device}:{device?:string}){useLanguage();const href='/camera-device?manager=1'+(device?'&device='+encodeURIComponent(device):'');return <a className="text-button" href={href} target="_blank" rel="noopener noreferrer" onClick={e=>{const manager=window.open(href,'dartbracket-camera-manager','popup,width=1080,height=820,resizable=yes,scrollbars=yes');if(manager){manager.opener=null;e.preventDefault();manager.focus();}}}>{t('Kameramanager öffnen')} ↗</a>;}
