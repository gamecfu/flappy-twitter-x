// Firebase setup (browser modules via CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';

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
const db = getFirestore(app, 'flappy-twitter-x'); // named database (not the default)

// Sign in anonymously so Firestore rules that require auth will allow writes
const auth = getAuth(app);
signInAnonymously(auth).then(()=>console.log('Signed in anonymously')).catch(e=>console.warn('Anonymous auth failed', e));

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
const gravity = 0.32;

// Fixed timestep: game logic always runs at 60 ticks/sec
const FIXED_DT = 1000 / 60;    // ~16.67ms per tick
let accumulator = 0;

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

// --- Level System ---
const levels = [
  { name: 'Level 1 — Easy',       threshold: 0,   speed: 1.8, spawnRate: 100, gap: 155, pointMultiplier: 1 },
  { name: 'Level 2 — Normal',     threshold: 5,   speed: 2.2, spawnRate: 90,  gap: 145, pointMultiplier: 2 },
  { name: 'Level 3 — Hard',       threshold: 15,  speed: 2.7, spawnRate: 78,  gap: 135, pointMultiplier: 3 },
  { name: 'Level 4 — Very Hard',  threshold: 30,  speed: 3.2, spawnRate: 65,  gap: 125, pointMultiplier: 4 },
  { name: 'Level 5 — Insane',     threshold: 50,  speed: 3.7, spawnRate: 54,  gap: 115, pointMultiplier: 5 },
  { name: 'Level 6 — Impossible', threshold: 80,  speed: 4.3, spawnRate: 44,  gap: 105, pointMultiplier: 7 },
];

let currentLevel = 0;
let pipesCleared = 0;          // raw pipes passed (for determining level)
let levelUpTimer = 0;          // frames to show the level-up banner

// --- Lives System ---
const MAX_LIVES = 3;
let lives = MAX_LIVES;
let invincibleTimer = 0;       // frames remaining of invincibility (~60 = 1 sec at 60fps)
const INVINCIBLE_DURATION = 60;  // 1 second at ~60 fps
const BLUE_HEART_INVINCIBLE = 300; // 5 seconds invincibility when losing a blue heart
const SHIELD_ORB_DURATION = 180; // 3 seconds shield from orb pickup
const EXTRA_LIFE_TIMEOUT = 900;    // 15 seconds at ~60 fps
const MAX_BLUE_HEARTS = 3;         // 3 blue hearts triggers overcharge

// --- Orb System ---
let orbs = [];
let orbSpawnTimer = 0;
const ORB_SPAWN_INTERVAL = 200; // frames between orb spawn attempts (~3.3 sec, more frequent)
const ORB_RADIUS = 12;
let orbPickupTimer = 0;        // frames to show pickup flash
let orbPickupText = '';        // text to flash on pickup
let extraLifeTimers = [];      // countdown timers for each extra life above MAX_LIVES
let overcharged = false;       // true when player has 3 blue hearts
let overchargeFlame = 0;       // animation tick for fire aura

function isOvercharged(){ return lives >= MAX_LIVES + MAX_BLUE_HEARTS; }

function spawnOrb(){
  const type = Math.random() < 0.65 ? 'life' : 'shield'; // red orbs appear more often (65%)
  // place orb in the gap of a random upcoming pipe, or at a random y if no pipes
  let y;
  const visiblePipes = pipes.filter(p => p.x > W * 0.4);
  if(visiblePipes.length > 0){
    const p = visiblePipes[Math.floor(Math.random() * visiblePipes.length)];
    y = p.top + p.gap / 2; // center of the gap
  } else {
    y = Math.random() * (H - 160) + 80;
  }
  orbs.push({ x: W + 20, y, type, r: ORB_RADIUS });
}

function getCurrentLevel() {
  let lvl = 0;
  for (let i = levels.length - 1; i >= 0; i--) {
    if (pipesCleared >= levels[i].threshold) { lvl = i; break; }
  }
  return lvl;
}

function getLevelConfig() { return levels[currentLevel]; }

function spawnPipe(){
  const cfg = getLevelConfig();
  const gap = cfg.gap;
  const top = Math.random()*(H - gap - 120) + 60;
  pipes.push({x: W+20, top, gap});
}

function loseLife(){
  // Check if we're losing a blue (extra) heart
  const losingBlueHeart = lives > MAX_LIVES;
  lives--;
  // Remove the newest extra life timer if we had one
  if(losingBlueHeart && extraLifeTimers.length > 0){
    extraLifeTimers.pop();
  }
  if(lives <= 0){
    // truly dead
    running = false;
    gameOver = true;
    finalScore = score;
    pauseBackgroundMusic();
  } else {
    // grant invincibility: 5s for blue heart, 1s for normal
    invincibleTimer = losingBlueHeart ? BLUE_HEART_INVINCIBLE : INVINCIBLE_DURATION;
    player.vy = -5; // small bounce up so they don't instantly die again
  }
}

function reset(){
  player.y = H/2; player.vy = 0; pipes = []; score = 0; tick = 0;
  running = true; gameOver = false; showLeaderboard = false;
  currentLevel = 0; pipesCleared = 0; levelUpTimer = 0;
  lives = MAX_LIVES; invincibleTimer = 0;
  orbs = []; orbSpawnTimer = 0; orbPickupTimer = 0; orbPickupText = '';
  extraLifeTimers = []; overcharged = false; overchargeFlame = 0;
  accumulator = 0; last = 0;
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
      timestamp: serverTimestamp()
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
  leaderboard.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.name}: ${entry.score}`;
    scoresList.appendChild(li);
  });
}
function update(){
  if(!running) return;
  player.vy += gravity;
  player.y += player.vy;

  // decrement invincibility
  if(invincibleTimer > 0) invincibleTimer--;

  // Update overcharge state
  overcharged = isOvercharged();
  if(overcharged) overchargeFlame++;
  else overchargeFlame = 0;

  // Tick down extra life timers (blue hearts expire after 15s) — paused during overcharge
  if(!overcharged){
    for(let i = extraLifeTimers.length - 1; i >= 0; i--){
      extraLifeTimers[i]--;
      if(extraLifeTimers[i] <= 0){
        extraLifeTimers.splice(i, 1);
        lives = Math.max(lives - 1, MAX_LIVES); // remove one extra life, don't go below base
      }
    }
  }

  if(player.y+player.r > H){
    player.y = H - player.r; player.vy = 0;
    if(invincibleTimer <= 0) loseLife();
  }
  if(player.y-player.r < 0){ player.y = player.r; player.vy = 0; }

  const cfg = getLevelConfig();
  if(tick % cfg.spawnRate === 0) spawnPipe();
  tick++;

  // check for level-up
  const newLevel = getCurrentLevel();
  if(newLevel !== currentLevel){ currentLevel = newLevel; levelUpTimer = 120; }
  if(levelUpTimer > 0) levelUpTimer--;

  for(let i=pipes.length-1;i>=0;i--){
    const p = pipes[i];
    p.x -= cfg.speed;
    if(p.x + 40 < 0) pipes.splice(i,1);

    // score (3x during overcharge)
    if(!p.passed && p.x + 40 < player.x){
      p.passed = true; pipesCleared++;
      score += cfg.pointMultiplier * (overcharged ? 3 : 1);
    }

    // collision (skip if invincible)
    if(invincibleTimer <= 0){
      const inX = player.x + player.r > p.x && player.x - player.r < p.x + 40;
      if(inX){
        if(player.y - player.r < p.top || player.y + player.r > p.top + p.gap) {
          loseLife();
          break; // stop checking more pipes this frame
        }
      }
    }
  }

  // --- Orb spawning & movement ---
  orbSpawnTimer++;
  if(orbSpawnTimer >= ORB_SPAWN_INTERVAL){
    orbSpawnTimer = 0;
    if(Math.random() < 0.7) spawnOrb(); // 70% chance each interval
  }

  for(let i = orbs.length - 1; i >= 0; i--){
    const o = orbs[i];
    o.x -= cfg.speed; // move with pipe speed
    if(o.x + o.r < 0){ orbs.splice(i, 1); continue; }

    // check player collision with orb
    const dx = player.x - o.x, dy = player.y - o.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if(dist < player.r + o.r){
      // pickup!
      if(o.type === 'life'){
        lives = Math.min(lives + 1, MAX_LIVES + MAX_BLUE_HEARTS); // allow up to 6 lives
        extraLifeTimers.push(EXTRA_LIFE_TIMEOUT); // 15s countdown
        if(lives >= MAX_LIVES + MAX_BLUE_HEARTS){
          orbPickupText = '⚡ OVERCHARGE! ⚡';
        } else {
          orbPickupText = '+1 Life! (15s)';
        }
      } else {
        invincibleTimer = SHIELD_ORB_DURATION;
        orbPickupText = 'Shield 3s!';
      }
      orbPickupTimer = 90;
      orbs.splice(i, 1);
    }
  }
  if(orbPickupTimer > 0) orbPickupTimer--;
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

  // --- Draw Orbs ---
  for(const o of orbs){
    ctx.save();
    // glow
    ctx.shadowBlur = 14;
    ctx.shadowColor = o.type === 'life' ? '#ff5555' : '#55ccff';
    // outer circle
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    const grad = ctx.createRadialGradient(o.x, o.y, 2, o.x, o.y, o.r);
    if(o.type === 'life'){
      grad.addColorStop(0, '#ffaaaa');
      grad.addColorStop(1, '#e74c3c');
    } else {
      grad.addColorStop(0, '#aaeeff');
      grad.addColorStop(1, '#2eaadc');
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // icon
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.type === 'life' ? '♥' : '✦', o.x, o.y);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // --- Overcharge fire aura ---
  if(overcharged && running){
    ctx.save();
    const t = overchargeFlame;
    // Draw multiple flame particles around the player
    for(let f = 0; f < 10; f++){
      const angle = (f / 10) * Math.PI * 2 + t * 0.08;
      const flicker = Math.sin(t * 0.15 + f * 1.3) * 4;
      const dist = player.r + 8 + flicker;
      const fx = player.x + Math.cos(angle) * dist;
      const fy = player.y + Math.sin(angle) * dist + Math.sin(t * 0.2 + f) * 3;
      const size = 5 + Math.sin(t * 0.12 + f * 0.7) * 3;
      const alpha = 0.5 + Math.sin(t * 0.18 + f) * 0.3;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(fx, fy, size, 0, Math.PI * 2);
      // gradient from yellow core to orange/red
      const flameGrad = ctx.createRadialGradient(fx, fy, 0, fx, fy, size);
      flameGrad.addColorStop(0, '#fff7a0');
      flameGrad.addColorStop(0.4, '#ffe033');
      flameGrad.addColorStop(1, '#ff6600');
      ctx.fillStyle = flameGrad;
      ctx.fill();
    }
    // outer glow ring
    ctx.globalAlpha = 0.2 + Math.sin(t * 0.1) * 0.1;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r + 16, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffe033';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ff9900';
    ctx.stroke();
    ctx.restore();
  }

  // player (image or circle) — blink when invincible
  const showPlayer = invincibleTimer <= 0 || Math.floor(invincibleTimer / 6) % 2 === 0;
  if(showPlayer){
    if(invincibleTimer > 0){ ctx.save(); ctx.globalAlpha = 0.55; }
    if(images.bird){
      const w = player.r*2, h = player.r*2;
      ctx.drawImage(images.bird, player.x - w/2, player.y - h/2, w, h);
      ctx.strokeStyle = overcharged ? '#ffe033' : (invincibleTimer > 0 ? '#00cfff' : '#222');
      ctx.lineWidth = overcharged ? 3 : 2.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
      ctx.stroke();
    } else {
      ctx.fillStyle = overcharged ? '#ffe033' : (invincibleTimer > 0 ? '#88eeff' : '#ffcc00');
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = overcharged ? '#ff9900' : (invincibleTimer > 0 ? '#00cfff' : '#222');
      ctx.lineWidth = overcharged ? 3 : 2.5;
      ctx.stroke();
    }
    if(invincibleTimer > 0){ ctx.restore(); }
  }

  // HUD
  ctx.fillStyle = '#111';
  ctx.font = '22px sans-serif';
  ctx.fillText('Score: ' + score, 12, 28);

  // Lives (hearts) — top-right
  const totalHearts = Math.max(lives, MAX_LIVES);
  ctx.font = '22px sans-serif';
  for(let i = 0; i < totalHearts; i++){
    const xPos = W - 40 * (totalHearts - i);
    if(i < lives){
      if(i >= MAX_LIVES){
        // Extra (blue) heart
        ctx.fillStyle = '#2eaadc';
        ctx.fillText('💙', xPos, 28);
        // Show timer under blue heart (hidden during overcharge since they don't decay)
        if(!overcharged){
          const timerIdx = i - MAX_LIVES;
          if(timerIdx < extraLifeTimers.length){
            const secs = Math.ceil(extraLifeTimers[timerIdx] / 60);
            ctx.fillStyle = '#2eaadc';
            ctx.font = '11px sans-serif';
            ctx.fillText(secs + 's', xPos + 4, 44);
            ctx.font = '22px sans-serif';
          }
        }
      } else {
        // Normal red heart
        ctx.fillStyle = '#e74c3c';
        ctx.fillText('❤️', xPos, 28);
      }
    } else {
      ctx.fillStyle = '#555';
      ctx.fillText('🖤', xPos, 28);
    }
  }

  // Overcharge banner
  if(overcharged && running){
    ctx.fillStyle = '#ff9900';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('⚡ OVERCHARGE ×3 ⚡', W - 190, 54);
  }

  // Invincibility countdown text
  if(invincibleTimer > 0 && running && !overcharged){
    const secs = Math.ceil(invincibleTimer / 60);
    ctx.fillStyle = '#00cfff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('Shield: ' + secs + 's', W - 110, 54);
  }

  // Orb pickup flash
  if(orbPickupTimer > 0 && running){
    const alpha = Math.min(1, orbPickupTimer / 30);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(orbPickupText, W/2, H/2 - 60);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // Level indicator
  const lvl = getLevelConfig();
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#333';
  ctx.fillText(lvl.name + '  (×' + lvl.pointMultiplier + ')', 12, 52);

  // Level-up banner
  if(levelUpTimer > 0 && running){
    const alpha = Math.min(1, levelUpTimer / 30);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(W/2 - 160, H/2 - 36, 320, 72);
    ctx.fillStyle = '#ffe066';
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(lvl.name, W/2, H/2 + 4);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('Points ×' + lvl.pointMultiplier + '  |  Speed ↑', W/2, H/2 + 28);
    ctx.textAlign = 'left';
    ctx.restore();
  }

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
  if(last === 0) last = ts;         // first frame — no huge delta
  let elapsed = ts - last;
  last = ts;
  // Clamp to avoid spiral-of-death on tab-switch or lag spikes
  if(elapsed > 200) elapsed = 200;
  accumulator += elapsed;

  // Run fixed-step updates until we've consumed the accumulated time
  while(accumulator >= FIXED_DT){
    update();
    accumulator -= FIXED_DT;
  }

  draw();
  requestAnimationFrame(loop);
}

function flap(){
  player.vy = -6.0;
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
  submitBtn.disabled = true;
  nameInputDiv.classList.add('hidden');

  // Submit to Firestore then fetch updated leaderboard
  const ok = await submitScore(name, finalScore);
  if(ok) console.log('Score submitted to Firestore');
  else console.warn('Firestore submit failed');

  await fetchLeaderboard();
  populateLeaderboard();
  leaderboardDiv.classList.remove('hidden');
  showLeaderboard = true;
  submitBtn.disabled = false;
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
