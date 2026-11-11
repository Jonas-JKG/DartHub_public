import type { Clip } from '../domain/caller';
const blocked=(error:unknown)=>!!error&&typeof error==='object'&&'name' in error&&error.name==='NotAllowedError';
/** Separate voice/music channels; blocked autoplay waits for a user gesture. */
export class CallerAudio{
  private queue:Clip[]=[];
  private running=false;
  private generation=0;
  private disposed=false;
  private voiceBlocked=false;
  private voicePrimed=false;
  private musicPrimed=false;
  private musicBlocked=false;
  private musicRequested=false;
  private musicGeneration=0;
  private musicAttempt=0;
  private cancelCurrent:(()=>void)|null=null;
  constructor(private voice:HTMLAudioElement,private music:HTMLAudioElement,private onError:(message:string)=>void,private onMusicPlaying:(playing:boolean)=>void=()=>{}){
    music.addEventListener('pause',this.musicPaused);music.addEventListener('ended',this.musicEnded);
  }
  private musicPaused=()=>{if(this.disposed||!this.musicRequested)return;this.musicBlocked=true;this.onMusicPlaying(false);};
  private musicEnded=()=>{this.musicRequested=false;this.musicBlocked=false;this.onMusicPlaying(false);};
  /** Call synchronously inside the gesture. Never replace a running announcement. */
  unlock(){
    if(this.disposed)return;
    if(this.voiceBlocked){this.voiceBlocked=false;void this.pump();}
    else if(!this.running&&!this.voicePrimed){this.voicePrimed=true;this.voice.src='/audio/silence.wav';void this.voice.play().catch(()=>{this.voicePrimed=false;});}
    if(this.musicRequested&&(this.musicBlocked||this.music.paused&&!this.music.ended)){this.musicBlocked=false;this.playMusic();}
    else if(!this.musicRequested&&!this.musicPrimed){this.musicPrimed=true;this.music.src='/audio/silence.wav';void this.music.play().catch(()=>{this.musicPrimed=false;});}
  }
  volume(caller:number,music:number){this.voice.volume=caller;this.music.volume=music;}
  enqueue(clips:Clip[]){if(this.disposed)return;this.queue.push(...clips);void this.pump();}
  private async pump(){
    if(this.running||this.voiceBlocked||this.disposed)return;this.running=true;const generation=this.generation;
    try{while(this.queue.length&&generation===this.generation&&!this.disposed){const clip=this.queue[0];try{
      if(!clip.src)throw Error('missing');await this.file(clip.src);
    }catch(error){
      if(generation!==this.generation||this.disposed)return;
      if(blocked(error)){this.voiceBlocked=true;this.onError('Zum Starten des Tons einmal klicken oder eine Taste drücken.');return;}
      this.onError('Caller-Aufnahme nicht verfügbar. Bitte das installierte Audio-Paket prüfen.');
    }
    if(generation!==this.generation||this.disposed)return;this.queue.shift();}}
    finally{this.running=false;if(this.queue.length&&!this.voiceBlocked&&!this.disposed)void this.pump();}
  }
  private file(src:string){return new Promise<void>((resolve,reject)=>{
    let settled=false;const finish=(error?:unknown)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve();};
    const ended=()=>finish(),failed=()=>finish(Error('audio'));
    const cleanup=()=>{this.voice.removeEventListener('ended',ended);this.voice.removeEventListener('error',failed);this.cancelCurrent=null;};
    this.cancelCurrent=()=>finish();this.voice.addEventListener('ended',ended);this.voice.addEventListener('error',failed);this.voice.src=src;void this.voice.play().then(()=>{if(!settled){this.voicePrimed=true;this.onError('');}},error=>finish(error));
  });}
  startMusic(src:string){if(this.disposed)return;this.musicGeneration++;this.musicRequested=true;this.musicBlocked=false;this.music.src=src;this.onMusicPlaying(false);this.playMusic();}
  private playMusic(){
    const generation=this.musicGeneration,attempt=++this.musicAttempt;
    void this.music.play().then(()=>{if(this.disposed||generation!==this.musicGeneration||attempt!==this.musicAttempt)return;this.musicPrimed=true;this.musicBlocked=false;this.onMusicPlaying(true);this.onError('');},error=>{
      if(this.disposed||generation!==this.musicGeneration||attempt!==this.musicAttempt)return;
      this.onMusicPlaying(false);this.musicBlocked=blocked(error)||error?.name==='AbortError';
      this.onError(this.musicBlocked?'Zum Starten des Tons einmal klicken oder eine Taste drücken.':'Der Walk-on konnte nicht starten. Bitte Walk-on erneut starten.');
    });
  }
  stopMusic(){this.musicGeneration++;this.musicRequested=false;this.musicBlocked=false;this.music.pause();this.onMusicPlaying(false);}
  stopVoice(){this.generation++;this.queue=[];this.voiceBlocked=false;this.voice.pause();this.cancelCurrent?.();}
  dispose(){this.disposed=true;this.music.removeEventListener('pause',this.musicPaused);this.music.removeEventListener('ended',this.musicEnded);this.stopVoice();this.stopMusic();}
}
