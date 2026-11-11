'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import { boardHit, hitPosition, sectors, type Hit } from '../domain/scoring';
// Warped Autodarts frames place the outer double at one third of the image width.
// A 510-unit image therefore aligns its 170-unit radius with our board geometry.
const center=220;
function point(r:number,a:number){return [center+Math.sin(a)*r,center-Math.cos(a)*r];}
function ring(inner:number,outer:number,index:number) {
  const a=(index-.5)*Math.PI/10,b=(index+.5)*Math.PI/10;
  const p=point(outer,a),q=point(outer,b),u=point(inner,b),v=point(inner,a);
  return `M ${p} A ${outer} ${outer} 0 0 1 ${q} L ${u} A ${inner} ${inner} 0 0 0 ${v} Z`;
}
const staticBoard=<>
    {sectors.map((n,i)=><g key={n}>
      {[{r:[15.9,99],m:1},{r:[99,107],m:3},{r:[107,162],m:1},{r:[162,170],m:2}].map(({r,m},j)=><path key={j} data-field={`${m===3?'T':m===2?'D':'S'}${n}`} d={ring(r[0],r[1],i)} fill={m===1?(i%2?'#f0e5cb':'#252b29'):(i%2?'#087c58':'#bc414a')} stroke="#b7c1b8" strokeWidth=".7"/>)}
      <text x={point(195,i*Math.PI/10)[0]} y={point(195,i*Math.PI/10)[1]} fill="#f6f5eb" textAnchor="middle" dominantBaseline="middle" fontSize="19" fontWeight="700">{n}</text>
    </g>)}
    {<><circle cx={center} cy={center} r="15.9" fill="#087c58" stroke="#c4cebf" strokeWidth=".7" data-field="25"/>
    <circle cx={center} cy={center} r="6.35" fill="#bc414a" stroke="#c4cebf" strokeWidth=".7" data-field="Bull"/></>}

</>;
export default function Dartboard({hits,enabled,onHit,bull=false,image,onImageError}:{hits:{hit:Hit;label:string;color?:string}[];enabled:boolean;onHit:(hit:Hit)=>void;bull?:boolean;image?:string|null;onImageError?:()=>void}) {useLanguage();
  return <svg className={'dartboard '+(enabled?'interactive':'')} viewBox="0 0 440 440" role="img" aria-label={bull?translateUi("Dartscheibe zum Ausbullen"):translateUi("Dartscheibe zur Treffer-Eingabe")} onClick={e=>{
    if(!enabled)return;
    const svg=e.currentTarget,matrix=svg.getScreenCTM();if(!matrix)return;
    const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const local=p.matrixTransform(matrix.inverse());
    onHit(boardHit((local.x-center)/170,(local.y-center)/170));
  }}>
    {image?<><defs><clipPath id="camera-board-clip"><circle cx={center} cy={center} r="216"/></clipPath></defs><image data-camera-image="true" href={image} x="-35" y="-35" width="510" height="510" preserveAspectRatio="xMidYMid slice" clipPath="url(#camera-board-clip)" onError={onImageError}/></>:<circle cx={center} cy={center} r="216" fill="#142c26"/>}
    {!image&&staticBoard}
    {hits.map(({hit,label,color},i)=>{const h=hitPosition(hit);return <g key={i} pointerEvents="none" data-marker={label}>
      <circle cx={center+h.x*170} cy={center+h.y*170} r="3.5" fill={color??'#4fe0a0'} stroke="#fff" strokeWidth="1"/>
      <text x={center+h.x*170+7} y={center+h.y*170-6} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="900" fill="#fff" stroke="#10261f" strokeWidth="2" paintOrder="stroke">{label}</text>
    </g>;})}
  </svg>;
}
