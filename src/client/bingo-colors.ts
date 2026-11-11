/** Stable roster colors; numbered badges also distinguish players without color. */
export function bingoPlayerColor(index:number){const palette=['#e879f9','#38bdf8','#fbbf24','#4ade80','#fb7185','#c4b5fd','#2dd4bf','#fb923c'];return palette[index]??`hsl(${Math.round(index*137.508)%360} 75% 65%)`;}
