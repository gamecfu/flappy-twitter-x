// Firebase setup (browser modules via CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCZdxP7LoP7FWbD8OQ36DgrP1BoBJen6T0",
  authDomain: "flappy-twitter-x.firebaseapp.com",
  projectId: "flappy-twitter-x",
  storageBucket: "flappy-twitter-x.firebasestorage.app",
  messagingSenderId: "205091803595",
  appId: "1:205091803595:web:29a9f5b0c9295bac26264e",
  measurementId: "G-QHB7SGZXD5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let leaderboard = [];
let showLeaderboard = false;
let gameOver = false;
let finalScore = 0;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

const nameInputDiv = document.getElementById('name-input');
const leaderboardDiv = document.getElementById('leaderboard');
const playerNameInput = document.getElementById('player-name');
const submitBtn = document.getElementById('submit-score');
const closeBtn = document.getElementById('close-leaderboard');
const finalScoreSpan = document.getElementById('final-score');
const scoresList = document.getElementById('scores-list');

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
  player.y = H/2; player.vy = 0; pipes = []; score = 0; tick = 0; running = true; gameOver = false; showLeaderboard = false;
  nameInputDiv.classList.add('hidden');
  leaderboardDiv.classList.add('hidden');
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
async function submitScore(name, score) {
  try {
    const docRef = await addDoc(collection(db, 'scores'), {
      name: name,
      score: score,
      timestamp: new Date().toISOString()
    });
    console.log('Score submitted, id=', docRef.id);
    return true;
  } catch (e) {
    console.error('Error submitting score:', e);
    return false;
  }
}

async function fetchLeaderboard() {
  try {
    const q = query(collection(db, 'scores'), orderBy('score', 'desc'), limit(10));
    const querySnapshot = await getDocs(q);
    leaderboard = [];
    querySnapshot.forEach((doc) => {
      leaderboard.push(doc.data());
    });
    console.log('Leaderboard fetched', leaderboard);
  } catch (e) {
    console.error('Error fetching leaderboard:', e);
    leaderboard = [{name: 'Offline', score: 0}];
  }
}

function populateLeaderboard() {
  scoresList.innerHTML = '';
  leaderboard.forEach((entry, index) => {
    const li = document.createElement('li');
    li.textContent = `${index+1}. ${entry.name}: ${entry.score}`;
    scoresList.appendChild(li);
  });
}
function update(dt){
  if(!running) return;
  player.vy += gravity;
  player.y += player.vy;

  if(player.y+player.r > H){ player.y = H-player.r; player.vy = 0; running = false; gameOver = true; finalScore = score; }
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
        gameOver = true;
        finalScore = score;
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
  if(!running && !gameOver && !showLeaderboard){
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(W/2-140, H/2-60, 280, 120);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '24px sans-serif';
    ctx.fillText('Game Over', W/2, H/2-10);
    ctx.fillText('Click or Space to restart', W/2, H/2+28);
    ctx.textAlign = 'left';
  }

  // Show overlays when game over or leaderboard visible
  if(gameOver){
    finalScoreSpan.textContent = finalScore;
    nameInputDiv.classList.remove('hidden');
    playerNameInput.focus();
  } else {
    nameInputDiv.classList.add('hidden');
  }
  if(showLeaderboard){
    leaderboardDiv.classList.remove('hidden');
  } else {
    leaderboardDiv.classList.add('hidden');
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
  if(e.code === 'Space'){
    if(running) {
      flap();
    } else {
      // allow restart even after gameOver / overlay shown
      reset();
    }
  }
});
canvas.addEventListener('pointerdown', () => { 
  if(!userInteracted){ userInteracted = true; if(gameMusic){ try{ gameMusic.muted = false; gameMusic.play().catch(()=>{}); }catch(e){} } }
  if(running) flap(); else reset();
});

submitBtn.addEventListener('click', async () => {
  const name = playerNameInput.value.trim();
  console.log('Submit clicked', {name, finalScore});
  if(!name) return;
  // disable button while we process UI; we'll re-enable immediately to avoid hangs
  submitBtn.disabled = true;
  // Save locally first so UI is responsive even if remote hangs
  try {
    const key = 'flappy_scores';
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ name, score: finalScore, timestamp: new Date().toISOString() });
    arr.sort((a,b) => b.score - a.score);
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 50)));
    console.log('Saved score locally (optimistic)');
  } catch(e){ console.error('Local save failed', e); }

  nameInputDiv.classList.add('hidden');
  // fetch remote leaderboard (may fallback inside) and merge local scores
  await fetchLeaderboard();
  // merge local scores into leaderboard for display
  try{
    const raw = localStorage.getItem('flappy_scores');
    if(raw){
      const local = JSON.parse(raw);
      const seen = new Set(leaderboard.map(e=>`${e.name}|${e.score}|${e.timestamp||''}`));
      for(const s of local){
        const key = `${s.name}|${s.score}|${s.timestamp||''}`;
        if(!seen.has(key)) leaderboard.push(s);
      }
      leaderboard.sort((a,b)=>b.score - a.score);
      leaderboard = leaderboard.slice(0,10);
    }
  }catch(e){ console.warn('Failed to merge local scores', e); }

  populateLeaderboard();
  leaderboardDiv.classList.remove('hidden');
  showLeaderboard = true;
  // re-enable button immediately; remote submit will run in background
  submitBtn.disabled = false;

  // Perform remote submit in background (don't await here to avoid UI hangs)
  submitScore(name, finalScore).then(ok => {
    if(ok) console.log('Remote submit succeeded');
    else console.warn('Remote submit returned false');
  }).catch(e => console.warn('Background submit error', e));
});

closeBtn.addEventListener('click', () => {
  leaderboardDiv.classList.add('hidden');
  showLeaderboard = false;
  reset();
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
