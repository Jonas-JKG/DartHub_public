import {effectFiles,victorySoundDuration,type SoundEffect} from '../domain/sound-effects';
/** Effects have their own players: the voice queue never waits for a chime. */
export class SoundEffectsAudio {
 private hit:HTMLAudioElement;
 private win:HTMLAudioElement;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private disposed=false;
 private warm:HTMLAudioElement[]=[];
 constructor(private onBlocked:()=>void){
  this.hit=new Audio();this.win=new Audio();
  this.hit.preload=this.win.preload='auto';
  this.hit.dataset.audioChannel='effects';this.win.dataset.audioChannel='victory';
  this.warm=[...new Set(Object.values(effectFiles))].map(file=>{const audio=new Audio('/audio/effects/'+file);audio.preload='auto';audio.load();return audio;});
 }
 volume(value:number){this.hit.volume=this.win.volume=value;}
 unlock(){
  for(const player of [this.hit,this.win]){if(!player.paused)continue;player.src='/audio/silence.wav';void player.play().catch(()=>{});}
 }
 play(effect:SoundEffect){
  if(this.disposed)return;
  const victory=effect==='leg-win'||effect==='match-win',player=victory?this.win:this.hit;
  if(victory&&this.timer)clearTimeout(this.timer);
  player.pause();if(victory)player.loop=effect==='match-win';player.src='/audio/effects/'+effectFiles[effect];
  void player.play().catch(error=>{if(!this.disposed&&error?.name==='NotAllowedError')this.onBlocked();});
  if(victory)this.timer=setTimeout(()=>{player.pause();player.loop=false;this.timer=undefined;},effect==='match-win'?victorySoundDuration.match:victorySoundDuration.leg);
 }
 stopVictory(){this.win.pause();this.win.loop=false;if(this.timer)clearTimeout(this.timer);this.timer=undefined;}
 stop(){this.hit.pause();this.stopVictory();}
 dispose(){this.disposed=true;this.stop();this.hit.removeAttribute('src');this.win.removeAttribute('src');for(const audio of this.warm){audio.removeAttribute('src');audio.load();}this.warm=[];}
}
