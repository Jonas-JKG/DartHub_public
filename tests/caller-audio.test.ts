import {it,expect,vi,afterEach} from 'vitest';
import {CallerAudio} from '../src/client/caller-audio';
class Media extends EventTarget{
 src='';volume=1;paused=true;allowed=true;played:string[]=[];failure:Error|null=null;
 play(){this.played.push(this.src);if(!this.allowed)return Promise.reject(new DOMException('Gesture required','NotAllowedError'));if(this.failure)return Promise.reject(this.failure);this.paused=false;return Promise.resolve();}
 pause(){this.paused=true;}
 end(){this.paused=true;this.dispatchEvent(new Event('ended'));}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const clip=(name:string)=>({src:'/audio/caller/'+name,text:name});
function setup(){const voice=new Media(),music=new Media(),error=vi.fn(),playing=vi.fn(),audio=new CallerAudio(voice as unknown as HTMLAudioElement,music as unknown as HTMLAudioElement,error,playing);return {voice,music,error,playing,audio};}
afterEach(()=>vi.unstubAllGlobals());
it('a gesture primes both channels without interrupting a running multi-part announcement',async()=>{
 const {voice,music,audio}=setup();audio.unlock();expect(voice.played).toEqual(['/audio/silence.wav']);expect(music.played).toEqual(['/audio/silence.wav']);
 audio.enqueue([clip('You_require.m4a'),clip('170.wav')]);expect(voice.src).toBe(clip('You_require.m4a').src);audio.unlock();expect(voice.src).toBe(clip('You_require.m4a').src);
 voice.end();await tick();expect(voice.src).toBe(clip('170.wav').src);voice.end();await tick();audio.unlock();expect(voice.played).toEqual(['/audio/silence.wav',clip('You_require.m4a').src,clip('170.wav').src]);audio.dispose();
});
it('blocked caller clips wait and retry in order on the next gesture without speech fallback or toggling',async()=>{
 const {voice,audio,error}=setup();voice.allowed=false;audio.enqueue([clip('You_require.m4a'),clip('170.wav')]);await tick();expect(error).toHaveBeenCalledWith('Zum Starten des Tons einmal klicken oder eine Taste drücken.');expect(voice.played).toHaveLength(1);
 audio.enqueue([clip('180.wav')]);await tick();expect(voice.played).toHaveLength(1);
 voice.allowed=true;audio.unlock();expect(voice.played.at(-1)).toBe(clip('You_require.m4a').src);await tick();expect(error).toHaveBeenLastCalledWith('');voice.end();await tick();expect(voice.src).toBe(clip('170.wav').src);voice.end();await tick();expect(voice.src).toBe(clip('180.wav').src);audio.dispose();
});
it('walk-on reports playing only after success and retries the requested song on a gesture',async()=>{
 const {music,audio,playing}=setup();music.allowed=false;audio.startMusic('/audio/walk-on/song.mp3');expect(playing).not.toHaveBeenCalledWith(true);await tick();expect(playing).toHaveBeenLastCalledWith(false);
 music.allowed=true;audio.unlock();await tick();expect(music.played).toEqual(['/audio/walk-on/song.mp3','/audio/walk-on/song.mp3']);expect(playing).toHaveBeenLastCalledWith(true);audio.dispose();
});
it('stopping or disposing cancels blocked playback rather than restarting it on a later gesture',async()=>{
 const {voice,music,audio,playing}=setup();voice.allowed=music.allowed=false;audio.startMusic('/audio/walk-on/song.mp3');audio.enqueue([clip('gameon.wav')]);await tick();audio.stopMusic();audio.stopVoice();voice.allowed=music.allowed=true;audio.unlock();await tick();
 expect(voice.played.filter(p=>p.endsWith('gameon.wav'))).toHaveLength(1);expect(music.played.filter(p=>p.endsWith('song.mp3'))).toHaveLength(1);expect(playing).not.toHaveBeenCalledWith(true);
 audio.dispose();const before=voice.played.length;audio.unlock();audio.enqueue([clip('180.wav')]);expect(voice.played).toHaveLength(before);
});
it('late music promises cannot mark a stopped or replaced song as playing',async()=>{
 const {music,audio,playing}=setup();let done!:()=>void;music.play=()=>new Promise<void>(resolve=>{done=resolve;});audio.startMusic('/old.mp3');audio.stopMusic();done();await tick();expect(playing).not.toHaveBeenCalledWith(true);audio.dispose();
});
it('a missing recording reports the problem without browser speech and lets the queue continue',async()=>{
 const {voice,audio,error}=setup();
 voice.failure=Error('network');audio.enqueue([clip('180.wav')]);await tick();expect(error).toHaveBeenCalledWith(expect.stringContaining('Caller-Aufnahme nicht verfügbar'));
 voice.failure=null;audio.enqueue([clip('170.wav')]);expect(voice.src).toBe(clip('170.wav').src);audio.dispose();
});
it('an interrupted Safari music start retries without changing the requested song',async()=>{
 const {music,audio,playing}=setup();music.failure=new DOMException('Playback interrupted','AbortError');audio.startMusic('/audio/walk-on/song.mp3');await tick();expect(playing).not.toHaveBeenCalledWith(true);
 music.failure=null;audio.unlock();await tick();expect(music.played).toEqual(['/audio/walk-on/song.mp3','/audio/walk-on/song.mp3']);expect(playing).toHaveBeenLastCalledWith(true);audio.dispose();
});
it('an involuntary pause resumes on a gesture while an explicit stop and natural ending stay stopped',async()=>{
 const {music,audio,playing}=setup();audio.startMusic('/song.mp3');await tick();music.pause();music.dispatchEvent(new Event('pause'));expect(playing).toHaveBeenLastCalledWith(false);audio.unlock();await tick();expect(music.played.filter(s=>s==='/song.mp3')).toHaveLength(2);
 music.end();audio.unlock();await tick();expect(music.played.filter(s=>s==='/song.mp3')).toHaveLength(2);
 audio.startMusic('/other.mp3');await tick();audio.stopMusic();music.dispatchEvent(new Event('pause'));audio.unlock();await tick();expect(music.played.filter(s=>s==='/other.mp3')).toHaveLength(1);audio.dispose();
});
it('a late rejection from an earlier Safari resume attempt cannot undo successful playback',async()=>{
 const {music,audio,playing,error}=setup();let fail!:(e:unknown)=>void;const normal=music.play.bind(music);music.play=vi.fn().mockImplementationOnce(()=>new Promise<void>((_resolve,reject)=>{fail=reject;})).mockImplementation(normal);
 audio.startMusic('/song.mp3');audio.unlock();await tick();expect(playing).toHaveBeenLastCalledWith(true);error.mockClear();fail(new DOMException('Old play interrupted','AbortError'));await tick();expect(playing).toHaveBeenLastCalledWith(true);expect(error).not.toHaveBeenCalled();audio.dispose();
});
