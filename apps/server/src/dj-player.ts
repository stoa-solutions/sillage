// Hosted on HTTPS so YouTube receives the application's real origin/referrer.
// No token or private library data is present in this public player shell.
export const djPlayerHtml = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lecteur Recall DJ</title><link rel="stylesheet" href="/dj/player.css"></head><body><div id="player"></div><p id="hint" role="status">Ton prochain morceau arrive ici.</p><button id="play" hidden>Lancer l’écoute</button><script src="/dj/player.js" defer></script></body></html>`;
export const djPlayerCss = `*{box-sizing:border-box}body{overflow:hidden;margin:0;background:#14251e;color:#f8f6ee;font:14px system-ui;text-align:center}#player{width:100%;height:calc(100vh - 95px);min-height:200px;border:0}p{padding:0 12px}button{background:#e7f2b8;color:#14251e;border:0;border-radius:30px;padding:12px 24px;font:inherit;margin:0 0 12px;cursor:pointer}button[hidden]{display:none}.native #player{pointer-events:none}.native #hint,.native #play{display:none}`;
export const djPlayerJs = String.raw`(() => {
  const native = /(?:^|[?&])native=1(?:&|$)/.test(location.search || '');
  let player, ready=false, pending=null, parentOrigin=null, duckedVolume=null;
  if(native) document.documentElement?.classList.add('native');
  const hint=document.getElementById('hint');
  const play=document.getElementById('play');
  const emit=(event,extra={})=>{ if(parentOrigin) parent.postMessage({source:'recall-dj-player',event,...extra},parentOrigin); };
  const cue=(value)=>{
    if(!ready){pending=value;return;}
    hint.textContent='';play.hidden=true;
    if(value.autoplay) player.loadVideoById({videoId:value.id,startSeconds:Math.max(0,Number(value.start)||0)}); else player.cueVideoById({videoId:value.id,startSeconds:Math.max(0,Number(value.start)||0)});
  };
  window.addEventListener('message',(event)=>{
    if(event.source!==parent || !(/^chrome-extension:\/\/[a-p]{32}$/.test(event.origin) || /^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(event.origin) || (parent===window && event.origin===location.origin))) return;
    const value=event.data;
    if(!value || value.source!=='recall-dj' || !['hello','cue','play','pause','seek','volume','duck','restore'].includes(value.command)) return;
    parentOrigin=event.origin;
    if(value.command==='hello'){if(ready)emit('ready');return;}
    if(value.command==='cue' && /^[A-Za-z0-9_-]{11}$/.test(value.id)) cue(value);
    if(ready && value.command==='seek' && value.id===player.getVideoData()?.video_id && Number.isFinite(value.seconds)){
      player.seekTo(Math.max(0,value.seconds),true);
      emit('seeked',{id:value.id,request:value.request,elapsed:player.getCurrentTime()});
    }
    if(ready && value.command==='play') player.playVideo();
    if(ready && value.command==='pause') player.pauseVideo();
    if(ready && value.command==='duck'){if(duckedVolume===null)duckedVolume=player.getVolume();player.setVolume(Math.min(25,duckedVolume));}
    if(ready && value.command==='restore' && duckedVolume!==null){player.setVolume(duckedVolume);duckedVolume=null;}
    if(ready && value.command==='volume' && Number.isFinite(value.value))player.setVolume(Math.max(0,Math.min(100,value.value)));
  });
  setInterval(()=>{if(ready)emit('progress',{id:player.getVideoData()?.video_id,elapsed:player.getCurrentTime(),duration:player.getDuration()});},250);
  play.addEventListener('click',()=>{if(ready)player.playVideo();});
  window.onYouTubeIframeAPIReady=()=>{
    player=new YT.Player('player',{width:'100%',height:'250',playerVars:{playsinline:1,origin:location.origin,...(native?{controls:0,disablekb:1,fs:0,cc_load_policy:0,iv_load_policy:3}:{})},events:{
      onReady:()=>{ready=true;emit('ready');if(pending){cue(pending);pending=null;}},
      onStateChange:(e)=>{emit('state',{state:e.data,id:player.getVideoData()?.video_id});if(e.data===1){play.hidden=true;hint.textContent='';}},
      onAutoplayBlocked:()=>{play.hidden=false;hint.textContent='Clique pour démarrer la musique.';emit('blocked');},
      onError:(e)=>{hint.textContent='Ce morceau ne peut pas être lu ici. Essaie le suivant ou ouvre-le sur YouTube.';emit('error',{code:e.data,id:player.getVideoData()?.video_id});}
    }});
  };
  const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';document.head.append(script);
})();`;
