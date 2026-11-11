'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import ThemeSettings from './ThemeSettings';
import {ViewPreferences} from './DevicePreferences';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function GameSettings({children,toolbar=false}:{children:ReactNode;toolbar?:boolean}) {useLanguage();
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[open]);
  function show(){dialog.current?.showModal();setOpen(true);}
  function close(){dialog.current?.close();}
  return <>
    <button ref={trigger} className={toolbar?"game-settings-trigger in-toolbar":"game-settings-trigger"} aria-label={translateUi("Match-Einstellungen")} aria-haspopup="dialog" aria-expanded={open} onClick={show}><span aria-hidden="true">☰</span>  {translateUi("Einstellungen")}</button>
    <dialog ref={dialog} className="game-settings-dialog" aria-labelledby="game-settings-title" onClose={()=>{setOpen(false);trigger.current?.focus();}} onClick={event=>{
      if(event.target!==event.currentTarget)return;
      const bounds=event.currentTarget.getBoundingClientRect();
      if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)close();
    }}>
      <div className="game-settings-content">
        <header className="game-settings-header"><div><h2 id="game-settings-title">{translateUi("Einstellungen")}</h2></div><button autoFocus className="game-settings-close" aria-label={translateUi("Einstellungen schließen")} onClick={close}>✕</button></header>
        <div className="game-settings-body"><ThemeSettings/><ViewPreferences/>{children}</div>
      </div>
    </dialog>
  </>;
}
