'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import {useState,type ComponentProps} from 'react';
export default function PasswordInput({visibilityLabel=translateUi("Passwort"),...props}:Omit<ComponentProps<'input'>,'type'> & {visibilityLabel?:string}){useLanguage();
 const [visible,setVisible]=useState(false);
 return <span className="password-input"><input {...props} type={visible?'text':'password'}/><button type="button" className="password-eye" aria-label={translateUi(visible?'{0} verbergen':'{0} anzeigen',visibilityLabel)} aria-pressed={visible} disabled={props.disabled} onClick={()=>setVisible(!visible)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible&&<path d="m3 3 18 18"/>}</svg></button></span>;
}
