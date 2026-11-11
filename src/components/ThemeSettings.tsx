'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import {useEffect,useState} from 'react';
export default function ThemeSettings(){useLanguage();const [dark,setDark]=useState(false);useEffect(()=>setDark(document.documentElement.dataset.theme==='dark'),[]);return <label className="preference-check"><input type="checkbox" checked={dark} onChange={e=>{setDark(e.target.checked);document.documentElement.dataset.theme=e.target.checked?'dark':'light';try{localStorage.setItem('theme',e.target.checked?'dark':'light');}catch{}}}/>  {translateUi("Dark Mode")}</label>;}
