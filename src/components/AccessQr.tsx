'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import {useEffect,useState} from 'react';
export default function AccessQr({url,label}:{url:string;label:string}){useLanguage();
 const [image,setImage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true;setImage('');import('qrcode').then(q=>q.toDataURL(url,{width:600,margin:2,errorCorrectionLevel:'M'})).then(value=>{if(active)setImage(value);}).catch(()=>{if(active)setError('QR-Code konnte nicht erzeugt werden.');});return()=>{active=false;};},[url]);
 return <div className="form">{image&&<img className="qr" src={image} width={220} height={220} alt={label}/>}<input readOnly aria-label={label+' Link'} value={url} onFocus={e=>e.target.select()}/>{image&&<a className="button ghost" href={image} download="dartbracket-zugang.png">{translateUi("QR-Code herunterladen")}</a>}{translateUi(error)&&<p role="alert">{translateUi(error)}</p>}</div>;
}
