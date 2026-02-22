const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Images loader
const images = {};
const manifest = {
  bg: 'assets/images/bg.png',
  bird: 'assets/images/bird.png',
  pipe: 'assets/images/pipe.png'
};
let imagesLoaded = 0;
const imagesTotal = Object.keys(manifest).length;

// Audio
let gameMusic = null;
let userInteracted = false;

function loadAudio(){
  const candidates = ['assets/audio/bg.mp3','assets/audio/chip - (64 Kbps).mp3'];
  let idx = 0;
  function tryNext(){
    if(idx >= candidates.length) return;
    const src = candidates[idx++];
    const a = new Audio();
    a.src = src;
    a.loop = true;
    a.volume = 0.5;
    // try muted autoplay (browsers usually allow muted)
    a.muted = true;
    a.play().catch(()=>{});
    a.oncanplaythrough = () => { gameMusic = a; };
    a.onerror = () => { tryNext(); };
  }
  tryNext();
}

function loadImages(cb){
  for(const k in manifest){
    const img = new Image();
    img.onload = () => { images[k] = img; imagesLoaded++; if(imagesLoaded === imagesTotal) cb(); };
    img.onerror = () => { console.warn('Failed to load', manifest[k]); imagesLoaded++; if(imagesLoaded === imagesTotal) cb(); };
    img.src = manifest[k];
  }
}

let last = 0;
const gravity = 0.45;

const player = {
  x: 80,
  y: H/2,
  r: 14,
  vy: 0
};

let pipes = [];
let tick = 0;
let score = 0;
let running = true;

function spawnPipe(){
  const gap = 140;
  const top = Math.random()*(H-240)+60;
  pipes.push({x: W+20, top, gap});
}

function reset(){
  player.y = H/2; player.vy = 0; pipes = []; score = 0; tick = 0; running = true;
}

function pauseBackgroundMusic(){
  if(gameMusic){
    try{ gameMusic.pause(); gameMusic.currentTime = 0; }catch(e){}
  }
}

function resumeBackgroundMusic(){
  if(gameMusic){
    try{ gameMusic.muted = false; gameMusic.play().catch(()=>{}); }catch(e){}
  }
}

function update(dt){
  if(!running) return;
  player.vy += gravity;
  player.y += player.vy;

  if(player.y+player.r > H){ player.y = H-player.r; player.vy = 0; running = false; }
  if(player.y-player.r < 0){ player.y = player.r; player.vy = 0; }

  if(tick % 90 === 0) spawnPipe();
  tick++;

  for(let i=pipes.length-1;i>=0;i--){
    const p = pipes[i];
    p.x -= 2.6;
    if(p.x + 40 < 0) pipes.splice(i,1);

    // score
    if(!p.passed && p.x + 40 < player.x){ p.passed = true; score++; }

    // collision
    const inX = player.x + player.r > p.x && player.x - player.r < p.x + 40;
    if(inX){
      if(player.y - player.r < p.top || player.y + player.r > p.top + p.gap) {
        running = false;
        pauseBackgroundMusic();
      }
    }
  }
}

function draw(){
  ctx.clearRect(0,0,W,H);

  // background (use image if available)
  if(images.bg){
    try{ ctx.drawImage(images.bg, 0, 0, W, H); }catch(e){ ctx.fillStyle = '#87ceeb'; ctx.fillRect(0,0,W,H); }
  } else {
    ctx.fillStyle = '#87ceeb';
    ctx.fillRect(0,0,W,H);
  }

  // pipes (use image if available)
  const pipeW = 40;
  if(images.pipe){
    for(const p of pipes){
      const bottomH = H - (p.top + p.gap);
      // bottom pipe
      try{
        ctx.drawImage(images.pipe, 0, 0, images.pipe.width || images.pipe.naturalWidth, images.pipe.height || images.pipe.naturalHeight, p.x, p.top + p.gap, pipeW, bottomH);
      }catch(e){
        ctx.fillStyle = '#2e8b57';
        ctx.fillRect(p.x, p.top + p.gap, pipeW, bottomH);
      }
      // top pipe (flipped vertically)
      try{
        ctx.save();
        ctx.translate(p.x + pipeW/2, p.top);
        ctx.scale(1, -1);
        ctx.drawImage(images.pipe, 0, 0, images.pipe.width || images.pipe.naturalWidth, images.pipe.height || images.pipe.naturalHeight, -pipeW/2, 0, pipeW, p.top);
        ctx.restore();
      }catch(e){
        ctx.fillStyle = '#2e8b57';
        ctx.fillRect(p.x, 0, pipeW, p.top);
      }
    }
  } else {
    ctx.fillStyle = '#2e8b57';
    for(const p of pipes){
      ctx.fillRect(p.x, 0, pipeW, p.top);
      ctx.fillRect(p.x, p.top + p.gap, pipeW, H - (p.top + p.gap));
    }
  }

  // player (image or circle)
  if(images.bird){
    const w = player.r*2, h = player.r*2;
    ctx.drawImage(images.bird, player.x - w/2, player.y - h/2, w, h);
  } else {
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
    ctx.fill();
  }

  // HUD
  ctx.fillStyle = '#111';
  ctx.font = '22px sans-serif';
  ctx.fillText('Score: ' + score, 12, 28);
  if(!running){
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(W/2-140, H/2-60, 280, 120);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '24px sans-serif';
    ctx.fillText('Game Over', W/2, H/2-10);
    ctx.fillText('Click or Space to restart', W/2, H/2+28);
    ctx.textAlign = 'left';
  }
}

function loop(ts){
  const dt = (ts - last) / 16.67;
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function flap(){
  player.vy = -7.5;
}

window.addEventListener('keydown', e => {
  // user gesture — allow unmuting/playing music
  if(!userInteracted){ userInteracted = true; if(gameMusic){ try{ gameMusic.muted = false; gameMusic.play().catch(()=>{}); }catch(e){} } }
  if(e.code === 'Space'){ if(!running) reset(); flap(); }
});
canvas.addEventListener('pointerdown', () => { 
  if(!userInteracted){ userInteracted = true; if(gameMusic){ try{ gameMusic.muted = false; gameMusic.play().catch(()=>{}); }catch(e){} } }
  if(!running) reset(); flap();
});

// resume music automatically when player restarts (if they've already interacted)
const originalReset = reset;
reset = function(){
  originalReset();
  if(userInteracted) resumeBackgroundMusic();
};

// Start after attempting to load images. If any fail, loader still calls the callback.
// load audio then images
loadAudio();
loadImages(() => {
  console.log('Image load complete', images, 'music:', !!gameMusic);
  requestAnimationFrame(loop);
});
