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
let scoreSubmitted = false;  // tracks if score was submitted (prevents draw loop re-showing name input)

// "Only DOOM" ending — triggers at 1500 in normal mode
let doomEndingTimer = 0;
const DOOM_ENDING_DURATION = 240; // 4 seconds at 60fps
let doomEndingTriggered = false;

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
const modeSelectDiv = document.getElementById('mode-select');
const btnNormal = document.getElementById('btn-normal');
const btnDoom = document.getElementById('btn-doom');
const doomLockedMsg = document.getElementById('doom-locked');
const doomButtonsDiv = document.getElementById('doom-buttons');
const btnShotgun = document.getElementById('btn-shotgun');
const btnRage = document.getElementById('btn-rage');

// Images loader
const images = {};
const manifest = {
  bg: 'assets/images/bg.png',
  bg_hellgate: 'assets/images/bg_hellgate.png',
  bg_truehell: 'assets/images/bg_truehell.png',
  bg_hell: 'assets/images/bg_hell.png',
  bird: 'assets/images/bird.png',
  pipe: 'assets/images/pipe.png'
};
let imagesLoaded = 0;
const imagesTotal = Object.keys(manifest).length;

// Audio
let gameMusic = null;
let hellMusic = null;
let hellGateMusic = null;  // separate music for Hell's Gate (DOOM level 1)
let activeMusic = null;
let userInteracted = false;
let inHellMusic = false;
let inHellGateMusic = false;

function loadAudio(){
  // Normal background music
  const candidates = ['assets/audio/bg.mp3','assets/audio/chip - (64 Kbps).mp3'];
  let idx = 0;
  function tryNext(){
    if(idx >= candidates.length) return;
    const src = candidates[idx++];
    const a = new Audio();
    a.src = src;
    a.loop = true;
    a.volume = 0.5;
    a.muted = true;
    a.play().catch(()=>{});
    a.oncanplaythrough = () => { gameMusic = a; activeMusic = a; };
    a.onerror = () => { tryNext(); };
  }
  tryNext();

  // Hell music (True Hell / Level 7)
  const hellCandidates = ['assets/audio/hell.mp3','assets/audio/hell.ogg'];
  let hi = 0;
  function tryHell(){
    if(hi >= hellCandidates.length) return;
    const src = hellCandidates[hi++];
    const a = new Audio();
    a.preload = 'auto';
    a.src = src;
    a.loop = true;
    a.volume = 0.6;
    a.muted = true;
    a.addEventListener('canplaythrough', () => { hellMusic = a; }, { once: true });
    a.onerror = () => { tryHell(); };
    a.load();
  }
  tryHell();

  // Hell's Gate music (DOOM level 1)
  const gateCandidates = ['assets/audio/hellgate.mp3','assets/audio/hellgate.ogg'];
  let gi = 0;
  function tryGate(){
    if(gi >= gateCandidates.length) return;
    const src = gateCandidates[gi++];
    const a = new Audio();
    a.preload = 'auto';
    a.src = src;
    a.loop = true;
    a.volume = 0.6;
    a.muted = true;
    a.addEventListener('canplaythrough', () => { hellGateMusic = a; }, { once: true });
    a.onerror = () => { tryGate(); };
    a.load();
  }
  tryGate();
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
const gravity = 0.26;

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
const normalLevels = [
  { name: 'Level 1 — Easy',       threshold: 0,    speed: 1.4, spawnRate: 130, gap: 180, pointMultiplier: 1 },
  { name: 'Level 2 — Normal',     threshold: 50,   speed: 1.7, spawnRate: 118, gap: 170, pointMultiplier: 2 },
  { name: 'Level 3 — Hard',       threshold: 130,  speed: 2.1, spawnRate: 105, gap: 158, pointMultiplier: 3 },
  { name: 'Level 4 — Very Hard',  threshold: 200,  speed: 2.5, spawnRate: 90,  gap: 148, pointMultiplier: 4 },
  { name: 'Level 5 — Insane',     threshold: 300,  speed: 2.9, spawnRate: 78,  gap: 138, pointMultiplier: 5 },
  { name: 'Level 6 — Impossible', threshold: 800,  speed: 3.3, spawnRate: 64,  gap: 125, pointMultiplier: 7 },
  { name: 'Level 7 — HELL 🔥',    threshold: 1000, speed: 3.8, spawnRate: 52,  gap: 115, pointMultiplier: 10, hell: true },
];

const doomLevels = [
  { name: "Hell's Gate 💀",  threshold: 0,   speed: 3.0, spawnRate: 58, gap: 155, pointMultiplier: 8,  hell: true, hellGate: true },
  { name: 'True Hell 🔥💀',  threshold: 1000, speed: 4.2, spawnRate: 44, gap: 138, pointMultiplier: 15, hell: true },
];

let levels = normalLevels;
let isDoomMode = false;
let doomUnlocked = localStorage.getItem('doomUnlocked') === 'true';
let showModeSelect = false;  // whether to show mode selection screen
let waitingForStart = true;  // game hasn't started yet (show start/mode screen)

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
const OVERCHARGE_SHIELD_DURATION = 540; // 9 seconds shield when overcharged
const EXTRA_LIFE_TIMEOUT = 1500;    // 25 seconds at ~60 fps
const MAX_BLUE_HEARTS = 3;         // 3 blue hearts triggers overcharge

// --- Beam System (overcharge ability) ---
let beams = [];                    // active beam projectiles
let beamCooldown = 0;              // frames until beam can fire again
const BEAM_COOLDOWN = 300;         // 5 seconds at 60fps
const BEAM_SPEED = 8;
const BEAM_LENGTH = 60;
const BEAM_WIDTH = 8;

// --- Orb System ---
let orbs = [];
let orbSpawnTimer = 0;
const ORB_SPAWN_INTERVAL = 200; // frames between orb spawn attempts (~3.3 sec)
const DOOM_ORB_SPAWN_INTERVAL = 120; // faster orb spawns in DOOM mode (~2 sec)
const ORB_RADIUS = 12;
const BASE_ORB_CHANCE = 0.70;  // 70% base chance to spawn an orb
let orbSpawnChance = BASE_ORB_CHANCE; // escalates by 5% each miss
let orbPickupTimer = 0;        // frames to show pickup flash
let orbPickupText = '';        // text to flash on pickup
let extraLifeTimers = [];      // countdown timers for each extra life above MAX_LIVES
let overcharged = false;       // true when player has 3 blue hearts
let overchargeFlame = 0;       // animation tick for fire aura
let overchargeEndTimer = 0;    // frames until overcharge deactivates after a hit (3s = 180)
const OVERCHARGE_WIND_DOWN = 180; // 3 seconds grace period
let overchargeForced = false;  // true = keep overcharge active even below threshold

// --- DOOM-specific Systems ---
// Shotgun (DOOM weapon — requires ammo)
let shotgunProjectiles = [];
let shotgunCooldown = 0;
const SHOTGUN_COOLDOWN = 60;       // 1 second at 60fps
const SHOTGUN_SPEED = 10;
const SHOTGUN_LENGTH = 25;
const SHOTGUN_WIDTH = 6;
let shotgunAmmo = 3;               // start with 3 ammo
const SHOTGUN_START_AMMO = 3;
const AMMO_PER_PICKUP = 6;         // each green orb gives 6 ammo
const MAX_AMMO = 24;               // maximum ammo the player can carry
let shotgunBlasts = [];            // blast animations [{x,y,timer,maxTimer}]

// --- Scaling System (every 5000 score) ---
let lastScaleTier = 0;             // tracks which 5000-tier we last applied
let scoreMultiplier = 1;           // doubles every 5000 score
let ammoChancePenalty = 0;         // cumulative ammo chance reduction (0.05 per tier)

// Rage ability (DOOM only — costs 1 heart, gives points + 3s shield)
let rageCooldown = 0;
const RAGE_COOLDOWN = 60;          // 1 second cooldown to prevent spam
const RAGE_SHIELD_DURATION = 180;  // 3 seconds shield
const RAGE_POINT_BONUS = 100;      // flat bonus points from rage

// True Rage (3 blue hearts in DOOM → lose 2, clear pipes 1s, +3000 pts)
let trueRageTimer = 0;
const TRUE_RAGE_DURATION = 60;     // 1 second
let trueRageFlash = 0;

// Black orb slowdown (DOOM only — replaces blue shield orb)
let slowTimer = 0;
const SLOW_DURATION = 180;         // 3 seconds
const SLOW_FACTOR = 0.4;           // speed multiplier when slowed

function isOvercharged(){ if(isDoomMode) return false; return overchargeForced || lives >= MAX_LIVES + MAX_BLUE_HEARTS; }

function fireBeam(){
  if(!overcharged || beamCooldown > 0 || !running) return;
  beams.push({ x: player.x + player.r, y: player.y });
  beamCooldown = BEAM_COOLDOWN;
}

function fireShotgun(){
  if(!isDoomMode || shotgunCooldown > 0 || !running) return;
  if(shotgunAmmo <= 0) return; // no ammo
  shotgunAmmo--;
  shotgunProjectiles.push({ x: player.x + player.r, y: player.y });
  // Muzzle blast animation at player position
  shotgunBlasts.push({ x: player.x + player.r + 10, y: player.y, timer: 18, maxTimer: 18 });
  shotgunCooldown = SHOTGUN_COOLDOWN;
}

function activateRage(){
  if(!isDoomMode || !running || rageCooldown > 0) return;
  if(lives <= 1) return; // can't rage with only 1 heart left (would die)
  lives--;
  // remove an extra life timer if we had blue hearts
  if(lives >= MAX_LIVES && extraLifeTimers.length > 0) extraLifeTimers.pop();
  else if(lives < MAX_LIVES){ /* lost a red heart */ }
  score += RAGE_POINT_BONUS * scoreMultiplier;
  invincibleTimer = RAGE_SHIELD_DURATION;
  rageCooldown = RAGE_COOLDOWN;
  orbPickupText = '🔥 RAGE! +' + (RAGE_POINT_BONUS * scoreMultiplier) + ' pts';
  orbPickupTimer = 90;
}

function triggerTrueRage(){
  if(!isDoomMode || trueRageTimer > 0) return;
  // Consume 2 blue hearts, keep 1
  let blueToRemove = 2;
  while(blueToRemove > 0 && extraLifeTimers.length > 0){
    extraLifeTimers.pop();
    lives--;
    blueToRemove--;
  }
  // Clear all pipes
  pipes = [];
  trueRageTimer = TRUE_RAGE_DURATION;
  trueRageFlash = 0;
  score += 3000 * scoreMultiplier;
  orbPickupText = '💀 TRUE RAGE! +' + (3000 * scoreMultiplier) + ' pts 💀';
  orbPickupTimer = 120;
}

function spawnOrb(){
  let type;
  if(isDoomMode){
    // Ammo chance reduced by 5% for every 5000-score tier
    const ammoReduction = ammoChancePenalty;
    if(currentLevel >= 1){
      // True Hell: only black orbs and green ammo orbs (65% base - penalty)
      const ammoChance = Math.max(0.10, 0.65 - ammoReduction);
      type = Math.random() < ammoChance ? 'ammo' : 'slow';
    } else {
      // Hell's Gate: red 10%, ammo (75% base - penalty), black rest
      const ammoChance = Math.max(0.10, 0.75 - ammoReduction);
      const r = Math.random();
      if(r < 0.10) type = 'life';
      else if(r < 0.10 + ammoChance) type = 'ammo';
      else type = 'slow';
    }
  } else {
    type = Math.random() < 0.50 ? 'life' : 'shield'; // red orbs 50% chance
  }
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
    if (score >= levels[i].threshold) { lvl = i; break; }
  }
  // Check if player unlocked DOOM (reached level 7 in normal mode)
  if(!isDoomMode && lvl === normalLevels.length - 1 && normalLevels[lvl].hell && !doomUnlocked){
    doomUnlocked = true;
    localStorage.setItem('doomUnlocked', 'true');
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
  // If overcharged — special handling: lose a blue heart, start wind-down
  if(overcharged && lives > MAX_LIVES){
    lives--;
    if(extraLifeTimers.length > 0) extraLifeTimers.pop();
    // Start 3-second grace period if not already winding down
    if(overchargeEndTimer <= 0){
      overchargeForced = true;
      overchargeEndTimer = OVERCHARGE_WIND_DOWN;
    }
    invincibleTimer = BLUE_HEART_INVINCIBLE;
    player.vy = -5;
    return;
  }

  // Normal (non-overcharge) death
  const losingBlueHeart = lives > MAX_LIVES;
  lives--;
  if(losingBlueHeart && extraLifeTimers.length > 0){
    extraLifeTimers.pop();
  }
  if(lives <= 0){
    running = false;
    gameOver = true;
    finalScore = score;
    pauseBackgroundMusic();
    doomButtonsDiv.classList.add('hidden');
  } else {
    invincibleTimer = losingBlueHeart ? BLUE_HEART_INVINCIBLE : INVINCIBLE_DURATION;
    player.vy = -5;
  }
}

function reset(){
  player.y = H/2; player.vy = 0; pipes = []; score = 0; tick = 0;
  running = true; gameOver = false; showLeaderboard = false; scoreSubmitted = false;
  doomEndingTimer = 0; doomEndingTriggered = false;
  currentLevel = 0; pipesCleared = 0; levelUpTimer = 0;
  lives = MAX_LIVES; invincibleTimer = 0;
  orbs = []; orbSpawnTimer = 0; orbPickupTimer = 0; orbPickupText = '';
  orbSpawnChance = BASE_ORB_CHANCE;
  extraLifeTimers = []; overcharged = false; overchargeFlame = 0;
  overchargeEndTimer = 0; overchargeForced = false;
  beams = []; beamCooldown = 0;
  shotgunProjectiles = []; shotgunCooldown = 0;
  shotgunAmmo = isDoomMode ? SHOTGUN_START_AMMO : 0;
  shotgunBlasts = [];
  rageCooldown = 0; trueRageTimer = 0; trueRageFlash = 0;
  slowTimer = 0;
  lastScaleTier = 0; scoreMultiplier = 1; ammoChancePenalty = 0;
  accumulator = 0; last = 0;
  nameInputDiv.classList.add('hidden');
  leaderboardDiv.classList.add('hidden');
}

function pauseBackgroundMusic(){
  if(activeMusic){
    try{ activeMusic.pause(); activeMusic.currentTime = 0; }catch(e){}
  }
  if(gameMusic){ try{ gameMusic.pause(); }catch(e){} }
  if(hellMusic){ try{ hellMusic.pause(); }catch(e){} }
  if(hellGateMusic){ try{ hellGateMusic.pause(); }catch(e){} }
  inHellMusic = false;
  inHellGateMusic = false;
}

function resumeBackgroundMusic(){
  // No music during the "Only DOOM from now on" black screen
  if(doomEndingTriggered) return;
  const cfg = getLevelConfig();
  if(cfg.hellGate){
    if(hellGateMusic) switchToHellGateMusic();
    else if(hellMusic) switchToHellMusic(); // fallback
    else if(gameMusic){ activeMusic = gameMusic; try{ activeMusic.muted = false; activeMusic.play().catch(()=>{}); }catch(e){} }
    return;
  }
  if(cfg.hell){
    if(hellMusic) switchToHellMusic();
    else if(gameMusic){ activeMusic = gameMusic; try{ activeMusic.muted = false; activeMusic.play().catch(()=>{}); }catch(e){} }
    return;
  }
  if(gameMusic){
    activeMusic = gameMusic;
    try{ activeMusic.muted = false; activeMusic.play().catch(()=>{}); }catch(e){}
  }
}

function stopAllMusic(){
  if(gameMusic){ try{ gameMusic.pause(); }catch(e){} }
  if(hellMusic){ try{ hellMusic.pause(); }catch(e){} }
  if(hellGateMusic){ try{ hellGateMusic.pause(); }catch(e){} }
  inHellMusic = false;
  inHellGateMusic = false;
}

function switchToHellGateMusic(){
  if(inHellGateMusic) return;
  stopAllMusic();
  if(hellGateMusic){
    activeMusic = hellGateMusic;
    try{ hellGateMusic.muted = false; hellGateMusic.currentTime = 0; hellGateMusic.play().catch(()=>{}); }catch(e){}
    inHellGateMusic = true;
  } else if(hellMusic){
    // Fallback to hell music if hellgate music not available
    switchToHellMusic();
  }
}

function switchToHellMusic(){
  if(inHellMusic) return;
  stopAllMusic();
  if(hellMusic){
    activeMusic = hellMusic;
    try{ hellMusic.muted = false; hellMusic.currentTime = 0; hellMusic.play().catch(()=>{}); }catch(e){}
    inHellMusic = true;
  }
}

function switchToNormalMusic(){
  if(!inHellMusic && !inHellGateMusic) return;
  stopAllMusic();
  if(gameMusic){
    activeMusic = gameMusic;
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

  // DOOM timers
  if(slowTimer > 0) slowTimer--;
  if(rageCooldown > 0) rageCooldown--;
  if(shotgunCooldown > 0) shotgunCooldown--;
  if(trueRageTimer > 0){ trueRageTimer--; trueRageFlash++; }
  else trueRageFlash = 0;

  // Update overcharge state
  overcharged = isOvercharged();
  if(overcharged) overchargeFlame++;
  else overchargeFlame = 0;

  // True rage is now manual — triggered by R key or rage button, not auto

  // Overcharge wind-down timer
  if(overchargeEndTimer > 0){
    overchargeEndTimer--;
    if(overchargeEndTimer <= 0){
      overchargeForced = false; // grace period over
    }
  }

  // Tick down extra life timers (blue hearts expire after 25s) — paused during overcharge
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
  const effectiveSpeed = (slowTimer > 0) ? cfg.speed * SLOW_FACTOR : cfg.speed;

  // --- Scaling: every 5000 score doubles points, reduces ammo chance by 5% ---
  const currentTier = Math.floor(score / 5000);
  if(currentTier > lastScaleTier){
    const tiersGained = currentTier - lastScaleTier;
    for(let t = 0; t < tiersGained; t++){
      scoreMultiplier *= 2;
      ammoChancePenalty += 0.05;
    }
    lastScaleTier = currentTier;
  }

  // Don't spawn pipes during true rage
  if(tick % cfg.spawnRate === 0 && trueRageTimer <= 0) spawnPipe();
  tick++;

  // check for level-up
  const newLevel = getCurrentLevel();
  if(newLevel !== currentLevel){
    const oldCfg = levels[currentLevel];
    currentLevel = newLevel;
    levelUpTimer = 120;
    const newCfg = levels[currentLevel];
    // Switch music when entering or leaving hell/hellGate
    if(userInteracted){
      if(newCfg.hellGate && !oldCfg.hellGate) switchToHellGateMusic();
      else if(newCfg.hell && !newCfg.hellGate && !(oldCfg.hell && !oldCfg.hellGate)) switchToHellMusic();
      else if(!newCfg.hell && oldCfg.hell) switchToNormalMusic();
    }
  }
  if(levelUpTimer > 0) levelUpTimer--;

  for(let i=pipes.length-1;i>=0;i--){
    const p = pipes[i];
    p.x -= effectiveSpeed;
    if(p.x + 40 < 0) pipes.splice(i,1);

    // score (5x during overcharge)
    if(!p.passed && p.x + 40 < player.x){
      p.passed = true; pipesCleared++;
      score += cfg.pointMultiplier * (overcharged ? 5 : 1) * scoreMultiplier;
      // Normal mode: end the game at 1500 with a special message
      if(!isDoomMode && score >= 1500 && !doomEndingTriggered){
        doomEndingTriggered = true;
        doomEndingTimer = DOOM_ENDING_DURATION;
        running = false;
        pauseBackgroundMusic();
        doomButtonsDiv.classList.add('hidden');
      }
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
  const orbInterval = isDoomMode ? DOOM_ORB_SPAWN_INTERVAL : ORB_SPAWN_INTERVAL;
  orbSpawnTimer++;
  if(orbSpawnTimer >= orbInterval){
    orbSpawnTimer = 0;
    if(Math.random() < orbSpawnChance){
      spawnOrb();
      orbSpawnChance = BASE_ORB_CHANCE; // reset to base after spawning
    } else {
      orbSpawnChance = Math.min(orbSpawnChance + 0.05, 1.0); // +5% each miss
    }
  }

  for(let i = orbs.length - 1; i >= 0; i--){
    const o = orbs[i];
    o.x -= effectiveSpeed; // move with pipe speed (affected by slow)
    if(o.x + o.r < 0){ orbs.splice(i, 1); continue; }

    // check player collision with orb
    const dx = player.x - o.x, dy = player.y - o.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if(dist < player.r + o.r){
      // pickup!
      if(o.type === 'life'){
        if(overcharged){
          // Red orb does nothing during overcharge
          orbPickupText = 'Overcharged!';
        } else {
          lives = Math.min(lives + 1, MAX_LIVES + MAX_BLUE_HEARTS);
          extraLifeTimers.push(EXTRA_LIFE_TIMEOUT);
          // Reset ALL existing blue heart timers on red orb pickup
          for(let t = 0; t < extraLifeTimers.length; t++){
            extraLifeTimers[t] = EXTRA_LIFE_TIMEOUT;
          }
          if(!isDoomMode && lives >= MAX_LIVES + MAX_BLUE_HEARTS){
            orbPickupText = '⚡ OVERCHARGE! ⚡';
          } else {
            orbPickupText = '+1 Life! (25s)';
          }
        }
      } else if(o.type === 'ammo'){
        // Green ammo orb: +6 shotgun ammo (uncapped at 50k score, otherwise capped at MAX_AMMO)
        const prev = shotgunAmmo;
        const effectiveMax = score >= 50000 ? Infinity : MAX_AMMO;
        shotgunAmmo = Math.min(shotgunAmmo + AMMO_PER_PICKUP, effectiveMax);
        const gained = shotgunAmmo - prev;
        orbPickupText = gained > 0 ? `🟢 +${gained} Ammo!` : '🟢 Ammo Full!';
      } else if(o.type === 'slow'){
        // DOOM black orb: slows player for 3 seconds
        slowTimer = SLOW_DURATION;
        orbPickupText = '⬛ SLOWED! 3s';
      } else {
        // Shield orb: 9s during overcharge, 3s normally
        invincibleTimer = overcharged ? OVERCHARGE_SHIELD_DURATION : SHIELD_ORB_DURATION;
        orbPickupText = overcharged ? 'Shield 9s!' : 'Shield 3s!';
      }
      orbPickupTimer = 90;
      orbs.splice(i, 1);
    }
  }
  if(orbPickupTimer > 0) orbPickupTimer--;

  // --- Beam update ---
  if(beamCooldown > 0) beamCooldown--;
  for(let i = beams.length - 1; i >= 0; i--){
    const b = beams[i];
    b.x += BEAM_SPEED;
    if(b.x > W + BEAM_LENGTH){ beams.splice(i, 1); continue; }
    // Check beam vs pipes
    for(let j = pipes.length - 1; j >= 0; j--){
      const p = pipes[j];
      if(b.x + BEAM_LENGTH > p.x && b.x < p.x + 40){
        // Beam hits this pipe — destroy it
        pipes.splice(j, 1);
        // Don't remove beam so it can pierce through multiple pipes
      }
    }
  }

  // --- Shotgun update (DOOM only) ---
  // Update blast animations
  for(let i = shotgunBlasts.length - 1; i >= 0; i--){
    shotgunBlasts[i].timer--;
    if(shotgunBlasts[i].timer <= 0) shotgunBlasts.splice(i, 1);
  }
  for(let i = shotgunProjectiles.length - 1; i >= 0; i--){
    const s = shotgunProjectiles[i];
    s.x += SHOTGUN_SPEED;
    if(s.x > W + SHOTGUN_LENGTH){ shotgunProjectiles.splice(i, 1); continue; }
    // Splash damage: on first pipe hit, explode and destroy all pipes within blast radius
    const SPLASH_RADIUS = 80;
    let hitPipe = false;
    for(let j = pipes.length - 1; j >= 0; j--){
      const p = pipes[j];
      if(s.x + SHOTGUN_LENGTH > p.x && s.x < p.x + 40){
        hitPipe = true;
        // Explosion at impact point
        const explosionX = s.x + SHOTGUN_LENGTH;
        const explosionY = s.y;
        shotgunBlasts.push({ x: explosionX, y: explosionY, timer: 24, maxTimer: 24 });
        // Destroy all pipes within splash radius
        for(let k = pipes.length - 1; k >= 0; k--){
          const pk = pipes[k];
          const pCenterX = pk.x + 20;
          const pCenterY = pk.top + pk.gap / 2;
          const dx = pCenterX - explosionX;
          const dy = pCenterY - explosionY;
          if(Math.sqrt(dx*dx + dy*dy) < SPLASH_RADIUS){
            pipes.splice(k, 1);
            // Extra small blast on each splashed pipe
            shotgunBlasts.push({ x: pCenterX, y: pCenterY, timer: 16, maxTimer: 16 });
          }
        }
        // Gain a heart on successful hit
        if(lives < MAX_LIVES + MAX_BLUE_HEARTS){
          lives++;
          if(lives > MAX_LIVES) extraLifeTimers.push(EXTRA_LIFE_TIMEOUT);
          orbPickupText = '🔫 +1 ❤️';
          orbPickupTimer = 60;
        }
        break;
      }
    }
    if(hitPipe){
      shotgunProjectiles.splice(i, 1); // slug consumed after explosion
    }
  }
}

function draw(){
  ctx.clearRect(0,0,W,H);

  // background (use image if available)
  const hellMode = getLevelConfig().hell;
  const isTrueHell = isDoomMode && currentLevel >= 1; // True Hell = DOOM level 2+
  const isHellGate = isDoomMode && getLevelConfig().hellGate;

  // Pick the right background image for the current level
  const bgImg = isTrueHell ? (images.bg_truehell || images.bg)
              : isHellGate  ? (images.bg_hellgate || images.bg)
              : hellMode     ? (images.bg_hell || images.bg)
              : images.bg;

  if(bgImg){
    try{
      if(isTrueHell){ ctx.save(); ctx.filter = 'invert(1)'; }
      ctx.drawImage(bgImg, 0, 0, W, H);
      if(isTrueHell){
        ctx.restore();
        // True Hell: bright red overlay on top of inverted bg
        ctx.fillStyle = 'rgba(255, 0, 0, 0.45)';
        ctx.fillRect(0, 0, W, H);
      } else if(isHellGate){
        // Hell's Gate: clear background (no tint)
      } else if(hellMode){
        ctx.fillStyle = 'rgba(180, 0, 0, 0.35)';
        ctx.fillRect(0, 0, W, H);
      }
    }catch(e){
      ctx.fillStyle = isTrueHell ? '#cc0000' : (isHellGate ? '#87ceeb' : (hellMode ? '#4a0000' : '#87ceeb'));
      ctx.fillRect(0,0,W,H);
    }
  } else {
    ctx.fillStyle = isTrueHell ? '#cc0000' : (isHellGate ? '#87ceeb' : (hellMode ? '#4a0000' : '#87ceeb'));
    ctx.fillRect(0,0,W,H);
  }

  // True Rage: screen flash effect
  if(trueRageTimer > 0 && running){
    const flashAlpha = (trueRageTimer > TRUE_RAGE_DURATION - 30) ? 0.4 * ((TRUE_RAGE_DURATION - trueRageTimer + 30) / 60) : 0.05 + Math.sin(trueRageFlash * 0.1) * 0.05;
    ctx.fillStyle = 'rgba(255, 50, 0, ' + flashAlpha + ')';
    ctx.fillRect(0, 0, W, H);
  }

  // Slow effect: blue-gray vignette
  if(slowTimer > 0 && running){
    ctx.fillStyle = 'rgba(30, 30, 60, 0.25)';
    ctx.fillRect(0, 0, W, H);
  }

  // pipes (use image if available)
  const pipeW = 40;
  const pipeColor = hellMode ? '#8b0000' : '#2e8b57';
  if(images.pipe){
    for(const p of pipes){
      const bottomH = H - (p.top + p.gap);
      // bottom pipe
      try{
        if(isTrueHell){ ctx.save(); ctx.filter = 'invert(1)'; }
        else if(hellMode){ ctx.save(); ctx.filter = 'hue-rotate(-70deg) saturate(2)'; }
        ctx.drawImage(images.pipe, 0, 0, images.pipe.width || images.pipe.naturalWidth, images.pipe.height || images.pipe.naturalHeight, p.x, p.top + p.gap, pipeW, bottomH);
        if(hellMode || isTrueHell) ctx.restore();
      }catch(e){
        ctx.fillStyle = pipeColor;
        ctx.fillRect(p.x, p.top + p.gap, pipeW, bottomH);
      }
      // top pipe (flipped vertically)
      try{
        ctx.save();
        if(isTrueHell) ctx.filter = 'invert(1)';
        else if(hellMode) ctx.filter = 'hue-rotate(-70deg) saturate(2)';
        ctx.translate(p.x + pipeW/2, p.top);
        ctx.scale(1, -1);
        ctx.drawImage(images.pipe, 0, 0, images.pipe.width || images.pipe.naturalWidth, images.pipe.height || images.pipe.naturalHeight, -pipeW/2, 0, pipeW, p.top);
        ctx.restore();
      }catch(e){
        ctx.fillStyle = pipeColor;
        ctx.fillRect(p.x, 0, pipeW, p.top);
      }
    }
  } else {
    ctx.fillStyle = pipeColor;
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
    if(o.type === 'life') ctx.shadowColor = '#ff5555';
    else if(o.type === 'slow') ctx.shadowColor = '#333333';
    else if(o.type === 'ammo') ctx.shadowColor = '#33ff55';
    else ctx.shadowColor = '#55ccff';
    // outer circle
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    const grad = ctx.createRadialGradient(o.x, o.y, 2, o.x, o.y, o.r);
    if(o.type === 'life'){
      grad.addColorStop(0, '#ffaaaa');
      grad.addColorStop(1, '#e74c3c');
    } else if(o.type === 'slow'){
      grad.addColorStop(0, '#555555');
      grad.addColorStop(1, '#111111');
    } else if(o.type === 'ammo'){
      grad.addColorStop(0, '#aaffbb');
      grad.addColorStop(1, '#22aa44');
    } else {
      grad.addColorStop(0, '#aaeeff');
      grad.addColorStop(1, '#2eaadc');
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = o.type === 'slow' ? '#666' : (o.type === 'ammo' ? '#33ff55' : '#fff');
    ctx.lineWidth = 2;
    ctx.stroke();
    // icon
    ctx.shadowBlur = 0;
    ctx.fillStyle = o.type === 'slow' ? '#999' : '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if(o.type === 'life') ctx.fillText('♥', o.x, o.y);
    else if(o.type === 'slow') ctx.fillText('⬛', o.x, o.y);
    else if(o.type === 'ammo') ctx.fillText('🟢', o.x, o.y);
    else ctx.fillText('✦', o.x, o.y);
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

    // --- Draw Shotgun Model (DOOM mode only) ---
    if(isDoomMode){
      ctx.save();
      const sx = player.x + player.r * 0.4;  // slightly right of center
      const sy = player.y + player.r * 0.15;  // slightly below center
      // Barrel
      ctx.fillStyle = '#555';
      ctx.fillRect(sx, sy - 2, 22, 4);  // main barrel
      // Barrel tip / muzzle
      ctx.fillStyle = '#333';
      ctx.fillRect(sx + 20, sy - 3, 4, 6);
      // Receiver body
      ctx.fillStyle = '#666';
      ctx.fillRect(sx - 4, sy - 3, 10, 6);
      // Pump grip
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(sx + 8, sy + 2, 8, 3);
      // Stock
      ctx.fillStyle = '#6B4400';
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy - 3);
      ctx.lineTo(sx - 12, sy + 5);
      ctx.lineTo(sx - 8, sy + 6);
      ctx.lineTo(sx - 2, sy + 3);
      ctx.closePath();
      ctx.fill();
      // Barrel shine highlight
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(sx + 2, sy - 2, 16, 1.5);
      ctx.restore();
    }
  }

  // --- Draw Beams ---
  for(const b of beams){
    ctx.save();
    const beamGrad = ctx.createLinearGradient(b.x, b.y, b.x + BEAM_LENGTH, b.y);
    beamGrad.addColorStop(0, 'rgba(255,240,100,0.9)');
    beamGrad.addColorStop(0.5, 'rgba(255,180,0,0.8)');
    beamGrad.addColorStop(1, 'rgba(255,80,0,0.5)');
    ctx.fillStyle = beamGrad;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#ff9900';
    ctx.fillRect(b.x, b.y - BEAM_WIDTH/2, BEAM_LENGTH, BEAM_WIDTH);
    // bright core
    ctx.fillStyle = 'rgba(255,255,200,0.9)';
    ctx.fillRect(b.x, b.y - BEAM_WIDTH/4, BEAM_LENGTH * 0.8, BEAM_WIDTH/2);
    ctx.restore();
  }

  // --- Draw Shotgun Slugs ---
  for(const s of shotgunProjectiles){
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff4400';
    // metallic slug
    const slugGrad = ctx.createLinearGradient(s.x, s.y - SHOTGUN_WIDTH/2, s.x, s.y + SHOTGUN_WIDTH/2);
    slugGrad.addColorStop(0, '#ccc');
    slugGrad.addColorStop(0.3, '#fff');
    slugGrad.addColorStop(0.7, '#aaa');
    slugGrad.addColorStop(1, '#666');
    ctx.fillStyle = slugGrad;
    ctx.fillRect(s.x, s.y - SHOTGUN_WIDTH/2, SHOTGUN_LENGTH, SHOTGUN_WIDTH);
    // muzzle flash trail
    ctx.fillStyle = 'rgba(255,100,0,0.5)';
    ctx.fillRect(s.x - 8, s.y - SHOTGUN_WIDTH/3, 10, SHOTGUN_WIDTH * 0.66);
    ctx.restore();
  }

  // --- Draw Shotgun Blast Animations ---
  for(const bl of shotgunBlasts){
    ctx.save();
    const progress = 1 - (bl.timer / bl.maxTimer);
    const radius = 12 + progress * 30;
    const alpha = 1 - progress;
    // Outer fireball
    ctx.globalAlpha = alpha * 0.7;
    ctx.beginPath();
    ctx.arc(bl.x, bl.y, radius, 0, Math.PI * 2);
    const blastGrad = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, radius);
    blastGrad.addColorStop(0, '#ffffff');
    blastGrad.addColorStop(0.2, '#ffee55');
    blastGrad.addColorStop(0.5, '#ff6600');
    blastGrad.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = blastGrad;
    ctx.fill();
    // Inner flash
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(bl.x, bl.y, radius * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    // Sparks
    for(let sp = 0; sp < 6; sp++){
      const angle = (sp / 6) * Math.PI * 2 + progress * 2;
      const sparkDist = radius * (0.6 + progress * 0.8);
      const sx = bl.x + Math.cos(angle) * sparkDist;
      const sy = bl.y + Math.sin(angle) * sparkDist;
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, 2 + (1 - progress) * 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffcc00';
      ctx.fill();
    }
    ctx.restore();
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

  // Overcharge banner (normal mode only)
  if(overcharged && running && !isDoomMode){
    ctx.fillStyle = '#ff9900';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('⚡ OVERCHARGE ×3 ⚡', W - 190, 54);
    // Beam cooldown indicator
    if(beamCooldown > 0){
      const cdSec = Math.ceil(beamCooldown / 60);
      ctx.fillStyle = '#cc6600';
      ctx.font = '12px sans-serif';
      ctx.fillText('Beam: ' + cdSec + 's', W - 190, 68);
    } else {
      ctx.fillStyle = '#ffe033';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('Beam READY [F/Tap×2]', W - 190, 68);
    }
  }

  // DOOM HUD: Shotgun & Rage indicators
  if(isDoomMode && running){
    let hudY = 54;
    // Shotgun cooldown + ammo
    if(shotgunAmmo <= 0){
      ctx.fillStyle = '#666';
      ctx.font = '12px sans-serif';
      ctx.fillText('🔫 No Ammo', W - 190, hudY);
    } else if(shotgunCooldown > 0){
      const cdSec = Math.ceil(shotgunCooldown / 60);
      ctx.fillStyle = '#999';
      ctx.font = '12px sans-serif';
      ctx.fillText('🔫 Shotgun: ' + cdSec + 's (' + shotgunAmmo + ')', W - 190, hudY);
    } else {
      ctx.fillStyle = '#ff6633';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('🔫 Shotgun READY [E] (' + shotgunAmmo + ')', W - 190, hudY);
    }
    hudY += 14;
    // Rage cooldown
    if(rageCooldown > 0){
      const cdSec = Math.ceil(rageCooldown / 60);
      ctx.fillStyle = '#999';
      ctx.font = '12px sans-serif';
      ctx.fillText('🔥 Rage: ' + cdSec + 's', W - 190, hudY);
    } else if(lives > 1){
      ctx.fillStyle = '#ff3333';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('🔥 Rage READY [F]', W - 190, hudY);
    } else {
      ctx.fillStyle = '#666';
      ctx.font = '12px sans-serif';
      ctx.fillText('🔥 Rage (need 2+ ❤️)', W - 190, hudY);
    }
    hudY += 14;
    // True Rage active or ready
    if(trueRageTimer > 0){
      const secs = Math.ceil(trueRageTimer / 60);
      ctx.fillStyle = '#ff4400';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('💀 TRUE RAGE: ' + secs + 's', W - 190, hudY);
    } else if(lives >= MAX_LIVES + MAX_BLUE_HEARTS){
      ctx.fillStyle = '#ff4400';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('💀 TRUE RAGE READY [R]', W - 190, hudY);
    }
    // Slow active
    if(slowTimer > 0){
      const secs = Math.ceil(slowTimer / 60);
      ctx.fillStyle = '#8888cc';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('⬛ SLOWED: ' + secs + 's', 12, 88);
    }
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
  ctx.fillStyle = isDoomMode ? '#ff4444' : '#333';
  ctx.fillText((isDoomMode ? '💀 ' : '') + lvl.name + '  (×' + lvl.pointMultiplier + ')', 12, 52);

  // DOOM mode indicator
  if(isDoomMode){
    ctx.fillStyle = '#ff3333';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('🔥 DOOM MODE 🔥', 12, 70);
  }

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
  if(gameOver && !scoreSubmitted){
    finalScoreSpan.textContent = finalScore;
    nameInputDiv.classList.remove('hidden');
    playerNameInput.focus();
  } else if(!gameOver) {
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

  // DOOM intro countdown
  if(doomIntroTimer > 0){
    while(accumulator >= FIXED_DT){
      doomIntroTimer--;
      accumulator -= FIXED_DT;
      if(doomIntroTimer <= 0){
        doomIntroTimer = 0;
        waitingForStart = false;
        reset();
        break;
      }
    }
    // Draw doom intro
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    // Fade text in
    const progress = 1 - (doomIntroTimer / DOOM_INTRO_DURATION);
    const textAlpha = Math.min(1, progress * 2); // fade in during first half
    const fadeOut = doomIntroTimer < 60 ? doomIntroTimer / 60 : 1; // fade out last second
    ctx.save();
    ctx.globalAlpha = textAlpha * fadeOut;
    ctx.fillStyle = '#cc0000';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("You're our last hope.", W/2, H/2 - 24);
    ctx.fillStyle = '#ff3333';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('They fear you.', W/2, H/2 + 20);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    requestAnimationFrame(loop);
    return;
  }

  // "Only DOOM from now on" ending screen
  if(doomEndingTimer > 0){
    while(accumulator >= FIXED_DT){
      doomEndingTimer--;
      accumulator -= FIXED_DT;
      if(doomEndingTimer <= 0){
        doomEndingTimer = 0;
        gameOver = true;
        finalScore = score;
        break;
      }
    }
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    // Fade red text in
    const progress = 1 - (doomEndingTimer / DOOM_ENDING_DURATION);
    const textAlpha = Math.min(1, progress * 3); // fast fade in
    ctx.save();
    ctx.globalAlpha = textAlpha;
    ctx.fillStyle = '#cc0000';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Only DOOM from now on.', W/2, H/2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    requestAnimationFrame(loop);
    return;
  }

  // Run fixed-step updates until we've consumed the accumulated time
  while(accumulator >= FIXED_DT){
    update();
    accumulator -= FIXED_DT;
  }

  draw();
  requestAnimationFrame(loop);
}

function flap(){
  player.vy = -5.2;
}

window.addEventListener('keydown', e => {
  if(!userInteracted){ userInteracted = true; if(activeMusic){ try{ activeMusic.muted = false; activeMusic.play().catch(()=>{}); }catch(e){} } }
  if(e.code === 'Space'){
    if(waitingForStart) return; // mode select is open, ignore space
    if(running) {
      flap();
    } else if(!gameOver && !showLeaderboard) {
      showModeSelectScreen();
    }
  }
  if(e.code === 'KeyF' && running){
    if(isDoomMode) activateRage();
    else fireBeam();
  }
  if(e.code === 'KeyR' && running){
    if(isDoomMode && lives >= MAX_LIVES + MAX_BLUE_HEARTS) triggerTrueRage();
  }
  if(e.code === 'KeyE' && running){
    if(isDoomMode) fireShotgun();
    else fireBeam();
  }
});

let lastTapTime = 0;
canvas.addEventListener('pointerdown', (ev) => { 
  if(!userInteracted){ userInteracted = true; if(activeMusic){ try{ activeMusic.muted = false; activeMusic.play().catch(()=>{}); }catch(e){} } }
  if(waitingForStart) return; // mode select is open
  const now = performance.now();
  if(running){
    if(now - lastTapTime < 300){
      // Double-tap
      if(isDoomMode) fireShotgun();
      else if(overcharged) fireBeam();
    } else {
      flap();
    }
    lastTapTime = now;
  } else if(!gameOver && !showLeaderboard) {
    showModeSelectScreen();
  }
});

submitBtn.addEventListener('click', async () => {
  const name = playerNameInput.value.trim();
  console.log('Submit clicked', {name, finalScore});
  if(!name) return;
  submitBtn.disabled = true;
  scoreSubmitted = true;
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

function showModeSelectScreen(){
  waitingForStart = true;
  running = false;
  pauseBackgroundMusic();
  doomButtonsDiv.classList.add('hidden'); // hide DOOM buttons on mode select
  // Update DOOM button visibility
  if(doomUnlocked){
    btnDoom.classList.remove('hidden');
    btnDoom.style.display = 'block';
    doomLockedMsg.style.display = 'none';
  } else {
    btnDoom.classList.add('hidden');
    btnDoom.style.display = 'none';
    doomLockedMsg.style.display = 'block';
  }
  modeSelectDiv.classList.remove('hidden');
}

let doomIntroTimer = 0;
const DOOM_INTRO_DURATION = 240; // 4 seconds at 60fps

function startGame(doom){
  isDoomMode = doom;
  levels = doom ? doomLevels : normalLevels;
  modeSelectDiv.classList.add('hidden');
  // Show/hide DOOM mobile buttons
  if(doom) doomButtonsDiv.classList.remove('hidden');
  else doomButtonsDiv.classList.add('hidden');

  if(doom){
    // Show DOOM intro screen before starting
    waitingForStart = true;
    doomIntroTimer = DOOM_INTRO_DURATION;
    // Don't call reset yet — the intro loop will handle it
  } else {
    waitingForStart = false;
    reset();
  }
}

btnNormal.addEventListener('click', () => startGame(false));
btnDoom.addEventListener('click', () => { if(doomUnlocked) startGame(true); });

// DOOM mobile buttons
btnShotgun.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if(isDoomMode && running) fireShotgun();
});
btnRage.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if(isDoomMode && running){
    // If player has 3 blue hearts, rage button triggers true rage instead
    if(lives >= MAX_LIVES + MAX_BLUE_HEARTS) triggerTrueRage();
    else activateRage();
  }
});

closeBtn.addEventListener('click', () => {
  leaderboardDiv.classList.add('hidden');
  showLeaderboard = false;
  showModeSelectScreen();
});

// resume music automatically when player restarts (if they've already interacted)
const originalReset = reset;
reset = function(){
  originalReset();
  if(userInteracted) resumeBackgroundMusic();
};

// Start after attempting to load images. If any fail, loader still calls the callback.
loadAudio();
loadImages(() => {
  console.log('Image load complete', images, 'music:', !!gameMusic);
  // Show mode select on initial load
  showModeSelectScreen();
  requestAnimationFrame(loop);
});
