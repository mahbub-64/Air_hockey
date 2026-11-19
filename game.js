/**
 * ============================================================================
 * NEON AIR HOCKEY - ARCADE ENGINE
 * High-performance, responsive 2-player Air Hockey with 2D physics,
 * multi-touch, procedural Web Audio effects, AI, and Online P2P via PeerJS.
 * ============================================================================
 */

(function () {
  'use strict';

  // ==========================================================================
  // CONFIGURATION & CONSTANTS
  // ==========================================================================
  const CONFIG = {
    // Virtual Logical Canvas Resolution (640x1000, aspect-ratio 0.64)
    WIDTH: 640,
    HEIGHT: 1000,

    // Playable Table Boundaries
    TABLE_LEFT: 38,
    TABLE_RIGHT: 602,   // Playable width: 564px
    TABLE_TOP: 38,
    TABLE_BOTTOM: 962,  // Playable height: 924px
    CENTER_Y: 500,
    CORNER_RADIUS: 52,

    // Goal Opening Specs
    GOAL_WIDTH: 204,
    GOAL_LEFT: 218,     // 320 - 102
    GOAL_RIGHT: 422,    // 320 + 102
    GOAL_DEPTH: 44,
    GOAL_POST_RADIUS: 14,
    TARGET_SCORE: 7,

    // Striker & Puck Dimensions
    STRIKER_RADIUS: 36,
    STRIKER_MASS: 4.0,
    PUCK_RADIUS: 20,
    PUCK_MASS: 1.0,

    // Physics Engine Tuning
    MAX_PUCK_SPEED: 1650,
    MIN_PUCK_SPEED: 8,
    AIR_FRICTION: 0.9972,          // Per 1/60th second
    RESTITUTION_STRIKER: 1.28,     // Punchy elastic striker hit
    RESTITUTION_WALL: 0.95,        // Realistic bumper rebound
    RESTITUTION_POST: 0.92,        // Metal post ping rebound
    SUB_STEPS: 8,                  // Fix 1: 8 sub-steps per frame (~3px/step) to prevent tunneling
    MAX_FRAME_DELTA: 0.033,        // Clamp delta time to max ~30fps equivalent

    // Colors
    COLOR_P1: '#00f0ff',
    COLOR_P1_DARK: '#0088cc',
    COLOR_P2: '#ff0077',
    COLOR_P2_DARK: '#cc0055',
    COLOR_PUCK: '#ffe600',
    COLOR_PUCK_CORE: '#ffffff'
  };

  // ==========================================================================
  // PROCEDURAL WEB AUDIO SOUND SYSTEM (Zero External Files)
  // ==========================================================================
  class SoundSystem {
    constructor() {
      this.ctx = null;
      this.isMuted = localStorage.getItem('neon_airhockey_muted') === 'true';
      this.hasUserInteracted = false;
      this.masterGain = null;
    }

    init() {
      if (this.ctx) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.ctx = new AudioContext();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
        this.hasUserInteracted = true;
      } catch (e) {
        console.warn('Web Audio API not supported or blocked:', e);
      }
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    toggleMute() {
      this.isMuted = !this.isMuted;
      localStorage.setItem('neon_airhockey_muted', this.isMuted);
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
      }
      return this.isMuted;
    }

    // Puck hitting striker: Punchy plastic "clack" with dynamic pitch & noise pop
    playPuckHit(speed = 600) {
      if (this.isMuted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;
      const intensity = Math.min(Math.max(speed / 1200, 0.35), 1.0);

      // Tone Oscillator
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const baseFreq = 340 + intensity * 260; // 340Hz - 600Hz
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);

      gain.gain.setValueAtTime(0.4 * intensity, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.09);

      // Plastic snap transient (noise burst)
      try {
        const bufferSize = this.ctx.sampleRate * 0.025; // 25ms
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(1400 + intensity * 600, t);
        noiseFilter.Q.setValueAtTime(3.0, t);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.3 * intensity, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        noise.start(t);
      } catch (e) {
        // Fallback gracefully if buffer fails
      }
    }

    // Puck hitting wall bumper: deep rubbery thud
    playWallBounce(speed = 400) {
      if (this.isMuted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;
      const intensity = Math.min(Math.max(speed / 900, 0.25), 0.8);

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.07);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(350, t);

      gain.gain.setValueAtTime(0.35 * intensity, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.08);
    }

    // Puck hitting metal goal post: bright resonant bell ping
    playPostPing() {
      if (this.isMuted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1380, t);

      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.24);
    }

    // Stadium Goal Horn & Siren Celebration Fanfare
    playGoalHorn() {
      if (this.isMuted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;

      // Dual detuned sawtooth oscillators for heavy stadium foghorn buzz
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const hornFilter = this.ctx.createBiquadFilter();
      const hornGain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(220, t);
      osc2.frequency.setValueAtTime(224.5, t); // Chorus beating

      hornFilter.type = 'bandpass';
      hornFilter.frequency.setValueAtTime(480, t);
      hornFilter.Q.setValueAtTime(2.5, t);

      hornGain.gain.setValueAtTime(0, t);
      hornGain.gain.linearRampToValueAtTime(0.5, t + 0.08);
      hornGain.gain.setValueAtTime(0.5, t + 0.55);
      hornGain.gain.exponentialRampToValueAtTime(0.001, t + 0.95);

      osc1.connect(hornFilter);
      osc2.connect(hornFilter);
      hornFilter.connect(hornGain);
      hornGain.connect(this.masterGain);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.98);
      osc2.stop(t + 0.98);

      // Energetic rising arpeggio chime overlay
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const noteOsc = this.ctx.createOscillator();
        const noteGain = this.ctx.createGain();
        const noteTime = t + 0.15 + idx * 0.1;

        noteOsc.type = 'sine';
        noteOsc.frequency.setValueAtTime(freq, noteTime);

        noteGain.gain.setValueAtTime(0.25, noteTime);
        noteGain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.22);

        noteOsc.connect(noteGain);
        noteGain.connect(this.masterGain);
        noteOsc.start(noteTime);
        noteOsc.stop(noteTime + 0.25);
      });
    }

    // Victory Match Fanfare
    playWinFanfare() {
      if (this.isMuted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;
      const chords = [
        { freqs: [523.25, 659.25, 783.99], delay: 0.0, dur: 0.25 },  // C major
        { freqs: [587.33, 739.99, 880.00], delay: 0.25, dur: 0.25 }, // D major
        { freqs: [659.25, 830.61, 987.77], delay: 0.50, dur: 0.35 }, // E major
        { freqs: [1046.5, 1318.5, 1567.98], delay: 0.85, dur: 0.8 }  // High C celebration
      ];

      chords.forEach(chord => {
        chord.freqs.forEach(freq => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const start = t + chord.delay;

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, start);

          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.2, start + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, start + chord.dur);

          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(start);
          osc.stop(start + chord.dur + 0.05);
        });
      });
    }

    // UI Click Sound
    playButton() {
      if (this.isMuted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(820, t);
      osc.frequency.exponentialRampToValueAtTime(400, t + 0.04);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.05);
    }
  }

  // ==========================================================================
  // PARTICLE SYSTEM (Sparks, Goal Fireworks, Puck Motion Trail)
  // ==========================================================================
  class ParticleSystem {
    constructor() {
      this.particles = [];
      this.puckTrail = [];
      this.ambientAir = [];
      this.screenShake = 0;
      this.shakeAngle = 0;

      // Seed ambient air cushion particles (tiny floating motes)
      for (let i = 0; i < 40; i++) {
        this.ambientAir.push({
          x: CONFIG.TABLE_LEFT + Math.random() * (CONFIG.TABLE_RIGHT - CONFIG.TABLE_LEFT),
          y: CONFIG.TABLE_TOP + Math.random() * (CONFIG.TABLE_BOTTOM - CONFIG.TABLE_TOP),
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          r: 1 + Math.random() * 1.5,
          alpha: 0.15 + Math.random() * 0.25
        });
      }
    }

    // Spawn high-speed sparks on puck hits
    spawnHitSparks(x, y, normalX, normalY, color = '#ffe600', count = 12, speed = 300) {
      for (let i = 0; i < count; i++) {
        // Spread angle centered opposite or around collision normal
        const baseAngle = Math.atan2(normalY, normalX);
        const spread = (Math.random() - 0.5) * 1.4;
        const angle = baseAngle + spread;
        const mag = (0.5 + Math.random() * 0.9) * speed;

        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * mag,
          vy: Math.sin(angle) * mag,
          color: color,
          size: 2 + Math.random() * 3,
          alpha: 1.0,
          decay: 2.2 + Math.random() * 2.5,
          type: 'spark'
        });
      }
    }

    // Spawn massive celebration burst on goal
    spawnGoalCelebration(goalY, scorerColor) {
      this.screenShake = 14; // screen shake impulse
      const originX = CONFIG.WIDTH / 2;
      const count = 90;

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 150 + Math.random() * 550;
        const colors = [scorerColor, '#ffe600', '#ffffff', '#9d4edd'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        this.particles.push({
          x: originX + (Math.random() - 0.5) * (CONFIG.GOAL_WIDTH * 0.8),
          y: goalY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: color,
          size: 3 + Math.random() * 4,
          alpha: 1.0,
          decay: 0.8 + Math.random() * 1.2,
          gravity: (goalY < CONFIG.CENTER_Y ? 1 : -1) * 80,
          type: 'confetti'
        });
      }
    }

    triggerScreenShake(amount = 5) {
      this.screenShake = Math.max(this.screenShake, amount);
    }

    // Record puck trail snapshot
    recordPuckTrail(x, y, speed, lastHitter) {
      if (speed < 120) return; // Only show comet tail when traveling fast
      const color = lastHitter === 1 ? CONFIG.COLOR_P1 : (lastHitter === 2 ? CONFIG.COLOR_P2 : CONFIG.COLOR_PUCK);
      this.puckTrail.unshift({
        x: x,
        y: y,
        r: CONFIG.PUCK_RADIUS * Math.min(speed / 1000, 1.0),
        alpha: Math.min(speed / 1200, 0.75),
        color: color
      });

      if (this.puckTrail.length > 10) {
        this.puckTrail.pop();
      }
    }

    update(dt) {
      // Update particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.gravity) p.vy += p.gravity * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.alpha -= p.decay * dt;

        if (p.alpha <= 0) {
          this.particles.splice(i, 1);
        }
      }

      // Update puck trail decay
      for (let i = 0; i < this.puckTrail.length; i++) {
        this.puckTrail[i].alpha *= 0.88;
        this.puckTrail[i].r *= 0.94;
      }
      this.puckTrail = this.puckTrail.filter(t => t.alpha > 0.03);

      // Update ambient air motes
      for (const mote of this.ambientAir) {
        mote.x += mote.vx * dt;
        mote.y += mote.vy * dt;
        if (mote.x < CONFIG.TABLE_LEFT) mote.x = CONFIG.TABLE_RIGHT;
        if (mote.x > CONFIG.TABLE_RIGHT) mote.x = CONFIG.TABLE_LEFT;
        if (mote.y < CONFIG.TABLE_TOP) mote.y = CONFIG.TABLE_BOTTOM;
        if (mote.y > CONFIG.TABLE_BOTTOM) mote.y = CONFIG.TABLE_TOP;
      }

      // Decay screen shake
      if (this.screenShake > 0) {
        this.screenShake = Math.max(0, this.screenShake - dt * 28);
        this.shakeAngle = Math.random() * Math.PI * 2;
      }
    }

    draw(ctx) {
      ctx.save();

      // Draw ambient air cushion dust
      ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
      for (const mote of this.ambientAir) {
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw puck motion comet trail
      ctx.globalCompositeOperation = 'lighter';
      for (let i = this.puckTrail.length - 1; i >= 0; i--) {
        const t = this.puckTrail[i];
        ctx.save();
        ctx.globalAlpha = t.alpha;
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw spark and celebration particles
      for (const p of this.particles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = p.color;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    }
  }

  // ==========================================================================
  // INPUT CONTROLLER (Multi-Touch, Desktop Mouse & Keyboard WASD / Arrows)
  // ==========================================================================
  class InputController {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.game = game;

      // Touch tracking by touch identifier
      this.touchP1Id = null;
      this.touchP2Id = null;

      // Mouse tracking for Player 1
      this.isMouseDown = false;
      this.mousePos = { x: 320, y: 800 };
      this.isMouseActive = false;

      // Keyboard states
      this.keys = {};

      this.bindEvents();
    }

    bindEvents() {
      // Fix 2: Global mobile gesture & scroll lockouts (allows scrolling inside modal cards)
      document.addEventListener('touchmove', (e) => {
        if (e.target && !e.target.closest('.modal-card') && e.target.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }, { passive: false });

      document.addEventListener('gesturestart', (e) => e.preventDefault());
      document.addEventListener('gesturechange', (e) => e.preventDefault());
      document.addEventListener('gestureend', (e) => e.preventDefault());
      window.addEventListener('contextmenu', (e) => {
        if (e.target && e.target.tagName !== 'INPUT') e.preventDefault();
      });

      // Touch Events with { passive: false } to lock out gestures
      this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
      this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
      this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
      this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });

      // Mouse Events for Player 1 (Desktop)
      this.canvas.addEventListener('mouseenter', () => {
        this.isMouseActive = true;
      });

      this.canvas.addEventListener('mousedown', (e) => {
        this.game.sound.init();
        this.isMouseDown = true;
        this.isMouseActive = true;
        this.updateMousePos(e);
        this.game.dismissTouchHints();
      });

      this.canvas.addEventListener('mousemove', (e) => {
        this.isMouseActive = true;
        this.updateMousePos(e);
      });

      window.addEventListener('mousemove', (e) => {
        if (this.isMouseDown || this.isMouseActive) {
          this.updateMousePos(e);
        }
      });

      window.addEventListener('mouseup', () => {
        this.isMouseDown = false;
      });

      // Keyboard Events
      window.addEventListener('keydown', (e) => {
        this.game.sound.init();
        this.keys[e.code] = true;
        if (e.key) {
          this.keys[e.key] = true;
          this.keys[e.key.toLowerCase()] = true;
        }
        this.game.dismissTouchHints();

        // Pause shortcuts
        if (e.code === 'Space' || e.code === 'Escape') {
          e.preventDefault();
          this.game.togglePause();
        }
        // Mute shortcut
        if (e.code === 'KeyM' || (e.key && e.key.toLowerCase() === 'm')) {
          e.preventDefault();
          this.game.toggleSound();
        }
        // Reset round / puck shortcut
        if (e.code === 'KeyR' || (e.key && e.key.toLowerCase() === 'r')) {
          e.preventDefault();
          if (this.game.state === 'GAME_OVER') {
            this.game.startRematch();
          } else {
            this.game.resetPuckToCenter();
          }
        }
      });

      window.addEventListener('keyup', (e) => {
        this.keys[e.code] = false;
        if (e.key) {
          this.keys[e.key] = false;
          this.keys[e.key.toLowerCase()] = false;
        }
      });
    }

    getCanvasCoords(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = CONFIG.WIDTH / rect.width;
      const scaleY = CONFIG.HEIGHT / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    }

    updateMousePos(e) {
      const pos = this.getCanvasCoords(e.clientX, e.clientY);
      // Mouse is assigned to Player 1 (bottom half)
      this.mousePos.x = pos.x;
      this.mousePos.y = pos.y;
    }

    handleTouchStart(e) {
      e.preventDefault();
      this.game.sound.init();
      this.game.dismissTouchHints();

      const touches = e.changedTouches;
      for (let i = 0; i < touches.length; i++) {
        const touch = touches[i];
        const pos = this.getCanvasCoords(touch.clientX, touch.clientY);

        // Assign to Player 2 if in top half and not already occupied, and mode is not AI
        if (pos.y < CONFIG.CENTER_Y && this.touchP2Id === null && this.game.gameMode === '2player') {
          this.touchP2Id = touch.identifier;
          this.game.p2Striker.targetX = pos.x;
          this.game.p2Striker.targetY = pos.y;
        }
        // Assign to Player 1 if in bottom half and not already occupied
        else if (pos.y >= CONFIG.CENTER_Y && this.touchP1Id === null) {
          this.touchP1Id = touch.identifier;
          this.game.p1Striker.targetX = pos.x;
          this.game.p1Striker.targetY = pos.y;
        }
      }
    }

    handleTouchMove(e) {
      e.preventDefault();
      const touches = e.changedTouches;
      for (let i = 0; i < touches.length; i++) {
        const touch = touches[i];
        const pos = this.getCanvasCoords(touch.clientX, touch.clientY);

        if (touch.identifier === this.touchP2Id && this.game.gameMode === '2player') {
          this.game.p2Striker.targetX = pos.x;
          this.game.p2Striker.targetY = pos.y;
        } else if (touch.identifier === this.touchP1Id) {
          this.game.p1Striker.targetX = pos.x;
          this.game.p1Striker.targetY = pos.y;
        }
      }
    }

    handleTouchEnd(e) {
      e.preventDefault();
      const touches = e.changedTouches;
      for (let i = 0; i < touches.length; i++) {
        const touch = touches[i];
        if (touch.identifier === this.touchP2Id) {
          this.touchP2Id = null;
        }
        if (touch.identifier === this.touchP1Id) {
          this.touchP1Id = null;
        }
      }
    }

    update(dt) {
      // 1. Update Player 1 (Bottom)
      // Check Keyboard WASD first
      const p1KeyLeft = this.keys['KeyA'] || this.keys['a'] || false;
      const p1KeyRight = this.keys['KeyD'] || this.keys['d'] || false;
      const p1KeyUp = this.keys['KeyW'] || this.keys['w'] || false;
      const p1KeyDown = this.keys['KeyS'] || this.keys['s'] || false;
      const isP1KeyboardActive = p1KeyLeft || p1KeyRight || p1KeyUp || p1KeyDown;

      if (isP1KeyboardActive) {
        this.isMouseActive = false; // Keyboard overrides mouse
        const moveSpeed = 820 * dt;
        if (p1KeyLeft) this.game.p1Striker.targetX -= moveSpeed;
        if (p1KeyRight) this.game.p1Striker.targetX += moveSpeed;
        if (p1KeyUp) this.game.p1Striker.targetY -= moveSpeed;
        if (p1KeyDown) this.game.p1Striker.targetY += moveSpeed;
      } else if (this.touchP1Id !== null) {
        // Touch is actively updating targetX, targetY in touchMove
      } else if (this.isMouseDown || this.isMouseActive) {
        // Mouse follow smoothly (clamped to player 1's side)
        this.game.p1Striker.targetX = this.mousePos.x;
        this.game.p1Striker.targetY = Math.max(CONFIG.CENTER_Y + 40, this.mousePos.y);
      }

      // 2. Update Player 2 (Top) if in 2-Player Local Mode
      if (this.game.gameMode === '2player') {
        const p2KeyLeft = this.keys['ArrowLeft'] || this.keys['Left'] || false;
        const p2KeyRight = this.keys['ArrowRight'] || this.keys['Right'] || false;
        const p2KeyUp = this.keys['ArrowUp'] || this.keys['Up'] || false;
        const p2KeyDown = this.keys['ArrowDown'] || this.keys['Down'] || false;
        const isP2KeyboardActive = p2KeyLeft || p2KeyRight || p2KeyUp || p2KeyDown;

        if (isP2KeyboardActive) {
          const moveSpeed = 820 * dt;
          if (p2KeyLeft) this.game.p2Striker.targetX -= moveSpeed;
          if (p2KeyRight) this.game.p2Striker.targetX += moveSpeed;
          if (p2KeyUp) this.game.p2Striker.targetY -= moveSpeed;
          if (p2KeyDown) this.game.p2Striker.targetY += moveSpeed;
        }
      }
    }
  }

  // ==========================================================================
  // STRIKER CLASS (Mallet)
  // ==========================================================================
  class Striker {
    constructor(playerNumber, initialX, initialY) {
      this.player = playerNumber; // 1 (Bottom, Cyan) or 2 (Top, Pink)
      this.x = initialX;
      this.y = initialY;
      this.targetX = initialX;
      this.targetY = initialY;
      this.vx = 0;
      this.vy = 0;
      this.r = CONFIG.STRIKER_RADIUS;
      this.m = CONFIG.STRIKER_MASS;

      this.prevX = initialX;
      this.prevY = initialY;
    }

    reset(initialX, initialY) {
      this.x = initialX;
      this.y = initialY;
      this.targetX = initialX;
      this.targetY = initialY;
      this.prevX = initialX;
      this.prevY = initialY;
      this.vx = 0;
      this.vy = 0;
    }

    update(dt) {
      this.prevX = this.x;
      this.prevY = this.y;

      // Smooth interpolation towards target position
      const lerpFactor = Math.min(1.0, 32 * dt);
      this.x += (this.targetX - this.x) * lerpFactor;
      this.y += (this.targetY - this.y) * lerpFactor;

      // Enforce strict boundaries based on player half
      this.clampPosition();

      // Compute physical striker velocity for impulse transfer
      if (dt > 0.0001) {
        const instVx = (this.x - this.prevX) / dt;
        const instVy = (this.y - this.prevY) / dt;
        // Smooth velocity with exponential moving average
        this.vx = this.vx * 0.4 + instVx * 0.6;
        this.vy = this.vy * 0.4 + instVy * 0.6;
      }
    }

    clampPosition() {
      const minX = CONFIG.TABLE_LEFT + this.r;
      const maxX = CONFIG.TABLE_RIGHT - this.r;

      this.x = Math.max(minX, Math.min(maxX, this.x));
      this.targetX = Math.max(minX, Math.min(maxX, this.targetX));

      if (this.player === 2) {
        // Player 2 is strictly clamped to TOP half
        const minY = CONFIG.TABLE_TOP + this.r;
        const maxY = CONFIG.CENTER_Y - this.r - 2;
        this.y = Math.max(minY, Math.min(maxY, this.y));
        this.targetY = Math.max(minY, Math.min(maxY, this.targetY));

        // Corner rounding clamping (Top Corners)
        this.clampCorner(CONFIG.TABLE_LEFT + CONFIG.CORNER_RADIUS, CONFIG.TABLE_TOP + CONFIG.CORNER_RADIUS);
        this.clampCorner(CONFIG.TABLE_RIGHT - CONFIG.CORNER_RADIUS, CONFIG.TABLE_TOP + CONFIG.CORNER_RADIUS);
      } else {
        // Player 1 is strictly clamped to BOTTOM half
        const minY = CONFIG.CENTER_Y + this.r + 2;
        const maxY = CONFIG.TABLE_BOTTOM - this.r;
        this.y = Math.max(minY, Math.min(maxY, this.y));
        this.targetY = Math.max(minY, Math.min(maxY, this.targetY));

        // Corner rounding clamping (Bottom Corners)
        this.clampCorner(CONFIG.TABLE_LEFT + CONFIG.CORNER_RADIUS, CONFIG.TABLE_BOTTOM - CONFIG.CORNER_RADIUS);
        this.clampCorner(CONFIG.TABLE_RIGHT - CONFIG.CORNER_RADIUS, CONFIG.TABLE_BOTTOM - CONFIG.CORNER_RADIUS);
      }
    }

    clampCorner(cornerX, cornerY) {
      const isTop = this.player === 2;
      const inCornerX = (cornerX < CONFIG.WIDTH / 2) ? (this.x < cornerX) : (this.x > cornerX);
      const inCornerY = isTop ? (this.y < cornerY) : (this.y > cornerY);

      if (inCornerX && inCornerY) {
        const dx = this.x - cornerX;
        const dy = this.y - cornerY;
        const dist = Math.hypot(dx, dy);
        const maxDist = CONFIG.CORNER_RADIUS - this.r;
        if (dist > maxDist && dist > 0.001) {
          const angle = Math.atan2(dy, dx);
          this.x = cornerX + Math.cos(angle) * maxDist;
          this.y = cornerY + Math.sin(angle) * maxDist;
        }
      }
    }

    draw(ctx) {
      ctx.save();
      const isP1 = this.player === 1;
      const mainColor = isP1 ? CONFIG.COLOR_P1 : CONFIG.COLOR_P2;
      const darkColor = isP1 ? CONFIG.COLOR_P1_DARK : CONFIG.COLOR_P2_DARK;
      const glowColor = isP1 ? 'rgba(0, 240, 255, 0.5)' : 'rgba(255, 0, 119, 0.5)';

      // Outer Glow & Shadow
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 18;

      // 1. Outer Striker Bumper Base
      const gradBase = ctx.createRadialGradient(
        this.x - 6, this.y - 6, 4,
        this.x, this.y, this.r
      );
      gradBase.addColorStop(0, '#ffffff');
      gradBase.addColorStop(0.3, mainColor);
      gradBase.addColorStop(0.85, darkColor);
      gradBase.addColorStop(1, '#080812');

      ctx.fillStyle = gradBase;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();

      // 2. Beveled Metallic Rim Ring
      ctx.shadowBlur = 0;
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r - 2, 0, Math.PI * 2);
      ctx.stroke();

      // 3. Inner Ridge
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 0.65, 0, Math.PI * 2);
      ctx.fill();

      // 4. Center Handle Grip Knob
      const knobRadius = this.r * 0.42;
      const gradKnob = ctx.createRadialGradient(
        this.x - 4, this.y - 4, 2,
        this.x, this.y, knobRadius
      );
      gradKnob.addColorStop(0, '#ffffff');
      gradKnob.addColorStop(0.4, mainColor);
      gradKnob.addColorStop(1, darkColor);

      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 10;
      ctx.fillStyle = gradKnob;
      ctx.beginPath();
      ctx.arc(this.x, this.y, knobRadius, 0, Math.PI * 2);
      ctx.fill();

      // 5. Specular highlight dot
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(this.x - knobRadius * 0.35, this.y - knobRadius * 0.35, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ==========================================================================
  // PUCK CLASS
  // ==========================================================================
  class Puck {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.r = CONFIG.PUCK_RADIUS;
      this.m = CONFIG.PUCK_MASS;
      this.lastHitter = 0; // 0: None, 1: Player 1, 2: Player 2
      this.inGoal = false;
    }

    reset(servingPlayer = 0) {
      this.x = CONFIG.WIDTH / 2;
      this.y = CONFIG.CENTER_Y;
      this.vx = 0;
      this.vy = 0;
      this.inGoal = false;
      this.lastHitter = 0;

      // Gentle serve towards the scored-on player or slight drift
      if (servingPlayer === 1) {
        this.vy = 120; // Float down to Player 1
      } else if (servingPlayer === 2) {
        this.vy = -120; // Float up to Player 2
      } else {
        // Random slight vertical drift
        this.vy = (Math.random() > 0.5 ? 1 : -1) * 80;
      }
    }

    getSpeed() {
      return Math.hypot(this.vx, this.vy);
    }

    draw(ctx) {
      ctx.save();

      // Outer Neon Aura
      ctx.shadowColor = 'rgba(255, 230, 0, 0.85)';
      ctx.shadowBlur = 16;

      // 1. Glowing Puck Base
      const gradPuck = ctx.createRadialGradient(
        this.x - 3, this.y - 3, 2,
        this.x, this.y, this.r
      );
      gradPuck.addColorStop(0, '#ffffff');
      gradPuck.addColorStop(0.35, CONFIG.COLOR_PUCK);
      gradPuck.addColorStop(0.85, '#ff9900');
      gradPuck.addColorStop(1, '#b36b00');

      ctx.fillStyle = gradPuck;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();

      // 2. Inner Ring Detailing
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 0.6, 0, Math.PI * 2);
      ctx.stroke();

      // 3. Center Core Glow Dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ==========================================================================
  // AI OPPONENT (Smart, Fair, Reactive Arcade Bot)
  // ==========================================================================
  class AIController {
    constructor(striker, puck) {
      this.striker = striker;
      this.puck = puck;
      this.homeX = CONFIG.WIDTH / 2;
      this.homeY = 170; // Sweet defensive spot
      this.reactionTimer = 0;
      this.predictedTargetX = this.homeX;
      this.predictedTargetY = this.homeY;
      this.difficultySpeed = 680; // Smooth human-like max speed
    }

    update(dt) {
      this.reactionTimer += dt;

      // Re-evaluate target every 40ms to simulate human eye-tracking & reaction time
      if (this.reactionTimer > 0.04) {
        this.reactionTimer = 0;
        this.decideStrategy();
      }

      // Smoothly steer striker towards predicted target with realistic acceleration
      const dx = this.predictedTargetX - this.striker.targetX;
      const dy = this.predictedTargetY - this.striker.targetY;
      const dist = Math.hypot(dx, dy);

      if (dist > 2) {
        const step = Math.min(dist, this.difficultySpeed * dt);
        this.striker.targetX += (dx / dist) * step;
        this.striker.targetY += (dy / dist) * step;
      }
    }

    decideStrategy() {
      const puck = this.puck;
      const isPuckInTopHalf = puck.y < CONFIG.CENTER_Y;

      // 1. DEFENSE: Puck is in Player 1's half
      if (!isPuckInTopHalf) {
        // Track puck's X coordinate to block the goal lane, stay back
        const targetX = CONFIG.WIDTH / 2 + (puck.x - CONFIG.WIDTH / 2) * 0.55;
        this.predictedTargetX = Math.max(CONFIG.GOAL_LEFT + 20, Math.min(CONFIG.GOAL_RIGHT - 20, targetX));
        this.predictedTargetY = this.homeY;
        return;
      }

      // 2. OFFENSE / ATTACK: Puck is in Player 2's half!
      // Check if puck is behind the striker (danger zone near own goal)
      if (puck.y < this.striker.y) {
        // Do NOT push puck into own goal! Move around puck to corner
        if (puck.x < this.striker.x) {
          this.predictedTargetX = puck.x + 50;
        } else {
          this.predictedTargetX = puck.x - 50;
        }
        this.predictedTargetY = Math.max(CONFIG.TABLE_TOP + this.striker.r + 5, puck.y - 30);
        return;
      }

      // 3. SMASH HIT: Puck is in front of striker in top half!
      // Predict intercept position slightly behind puck to strike forward with angle
      const aimTargetGoalX = (puck.x < CONFIG.WIDTH / 2) ? (CONFIG.GOAL_RIGHT - 20) : (CONFIG.GOAL_LEFT + 20);
      const angleToGoal = Math.atan2(CONFIG.TABLE_BOTTOM - puck.y, aimTargetGoalX - puck.x);

      // Position striker behind puck along strike angle
      const offsetDist = this.striker.r + puck.r - 2;
      this.predictedTargetX = puck.x - Math.cos(angleToGoal) * offsetDist;
      this.predictedTargetY = puck.y - Math.sin(angleToGoal) * offsetDist;

      // Don't cross center line!
      this.predictedTargetY = Math.min(CONFIG.CENTER_Y - this.striker.r - 6, this.predictedTargetY);
    }
  }

  // ==========================================================================
  // PHYSICS ENGINE (Sub-stepping, Elastic Collisions, Goal Deflection & Detection)
  // ==========================================================================
  class PhysicsEngine {
    constructor(game) {
      this.game = game;
      this.puck = game.puck;
      this.p1 = game.p1Striker;
      this.p2 = game.p2Striker;
      this.sound = game.sound;
      this.particles = game.particles;

      // 4 Goal Posts (Left/Right of Top and Bottom goals)
      this.goalPosts = [
        { x: CONFIG.GOAL_LEFT, y: CONFIG.TABLE_TOP, r: CONFIG.GOAL_POST_RADIUS },
        { x: CONFIG.GOAL_RIGHT, y: CONFIG.TABLE_TOP, r: CONFIG.GOAL_POST_RADIUS },
        { x: CONFIG.GOAL_LEFT, y: CONFIG.TABLE_BOTTOM, r: CONFIG.GOAL_POST_RADIUS },
        { x: CONFIG.GOAL_RIGHT, y: CONFIG.TABLE_BOTTOM, r: CONFIG.GOAL_POST_RADIUS }
      ];
    }

    update(dt) {
      if (this.puck.inGoal) return;

      const subDt = dt / CONFIG.SUB_STEPS;
      for (let step = 0; step < CONFIG.SUB_STEPS; step++) {
        if (this.puck.inGoal) break;
        this.subStep(subDt);
      }
    }

    subStep(subDt) {
      if (this.puck.inGoal) return;

      const puck = this.puck;

      // 1. Advance Puck Position
      puck.x += puck.vx * subDt;
      puck.y += puck.vy * subDt;

      // 2. Air Cushion Surface Friction Damping
      const friction = Math.pow(CONFIG.AIR_FRICTION, subDt * 60);
      puck.vx *= friction;
      puck.vy *= friction;

      const speed = puck.getSpeed();
      if (speed < CONFIG.MIN_PUCK_SPEED && speed > 0.001) {
        puck.vx = 0;
        puck.vy = 0;
      }

      // Record puck comet trail
      this.particles.recordPuckTrail(puck.x, puck.y, speed, puck.lastHitter);

      // 3. Striker - Puck Elastic Collisions
      this.resolveStrikerPuckCollision(this.p1, 1);
      this.resolveStrikerPuckCollision(this.p2, 2);

      // 4. Goal Posts Collisions (Circle-Circle ping rebound)
      this.resolveGoalPostCollisions();

      // 5. Goal Pocket Entry & Boundary Collisions
      this.resolveGoalAndWalls();

      // 6. Hard Speed Clamping (Prevents wall clipping under any extreme force)
      const finalSpeed = puck.getSpeed();
      if (finalSpeed > CONFIG.MAX_PUCK_SPEED) {
        const factor = CONFIG.MAX_PUCK_SPEED / finalSpeed;
        puck.vx *= factor;
        puck.vy *= factor;
      }
    }

    // Elastic Collision between Striker and Puck with anti-tunneling & anti-pinning ejection
    resolveStrikerPuckCollision(striker, playerNum) {
      const puck = this.puck;
      const dx = puck.x - striker.x;
      const dy = puck.y - striker.y;
      const dist = Math.hypot(dx, dy);
      const minDist = puck.r + striker.r;

      if (dist < minDist) {
        // Normal collision unit vector (safely fallback if center-stacked)
        const nx = dist > 0.0001 ? dx / dist : 0;
        const ny = dist > 0.0001 ? dy / dist : (playerNum === 1 ? -1 : 1);

        // Positional correction: immediately push puck outside overlap
        const overlap = minDist - dist;
        puck.x += nx * overlap;
        puck.y += ny * overlap;

        // Relative velocity
        const rvx = puck.vx - striker.vx;
        const rvy = puck.vy - striker.vy;
        const velAlongNormal = rvx * nx + rvy * ny;

        if (velAlongNormal < 0) {
          const e = CONFIG.RESTITUTION_STRIKER;
          const impulse = -(1 + e) * velAlongNormal / (1 / puck.m + 1 / striker.m);

          puck.vx += (impulse / puck.m) * nx;
          puck.vy += (impulse / puck.m) * ny;

          // Striker swing boost: add striker forward velocity component for satisfying smash feel
          const strikerSpeed = Math.hypot(striker.vx, striker.vy);
          if (strikerSpeed > 30) {
            puck.vx += striker.vx * 0.45;
            puck.vy += striker.vy * 0.45;
          }

          puck.lastHitter = playerNum;

          // Audio & Particle FX
          const impactSpeed = Math.hypot(puck.vx, puck.vy);
          this.sound.playPuckHit(impactSpeed);
          const sparkColor = playerNum === 1 ? CONFIG.COLOR_P1 : CONFIG.COLOR_P2;
          this.particles.spawnHitSparks(puck.x, puck.y, nx, ny, sparkColor, 12, impactSpeed * 0.5);

          if (impactSpeed > 1000) {
            this.particles.triggerScreenShake(3);
          }
        } else {
          // Fix 1: ANTI-STICKING SAFEGUARD
          // If puck is pinned behind mallet or squeezed against cushion, eject outward
          const ejectSpeed = Math.max(380, Math.hypot(striker.vx, striker.vy) * 1.3);
          puck.vx = nx * ejectSpeed;
          puck.vy = ny * ejectSpeed;
          puck.lastHitter = playerNum;
        }

        // Keep puck clamped to table so it doesn't get pushed into cushions
        this.clampPuckToTable();
      }
    }

    clampPuckToTable() {
      const puck = this.puck;
      if (puck.inGoal) return;
      const minX = CONFIG.TABLE_LEFT + puck.r;
      const maxX = CONFIG.TABLE_RIGHT - puck.r;
      if (puck.x < minX) {
        puck.x = minX;
        puck.vx = Math.abs(puck.vx) * 0.8;
      } else if (puck.x > maxX) {
        puck.x = maxX;
        puck.vx = -Math.abs(puck.vx) * 0.8;
      }
      const inGoalMouth = puck.x >= CONFIG.GOAL_LEFT && puck.x <= CONFIG.GOAL_RIGHT;
      if (!inGoalMouth) {
        const minY = CONFIG.TABLE_TOP + puck.r;
        const maxY = CONFIG.TABLE_BOTTOM - puck.r;
        if (puck.y < minY) {
          puck.y = minY;
          puck.vy = Math.abs(puck.vy) * 0.8;
        } else if (puck.y > maxY) {
          puck.y = maxY;
          puck.vy = -Math.abs(puck.vy) * 0.8;
        }
      }
    }

    // Goal Post Collisions (Circle-Circle)
    resolveGoalPostCollisions() {
      const puck = this.puck;
      for (const post of this.goalPosts) {
        const dx = puck.x - post.x;
        const dy = puck.y - post.y;
        const dist = Math.hypot(dx, dy);
        const minDist = puck.r + post.r;

        if (dist < minDist && dist > 0.0001) {
          const nx = dx / dist;
          const ny = dy / dist;

          // Push out
          const overlap = minDist - dist;
          puck.x += nx * overlap;
          puck.y += ny * overlap;

          // Elastic bounce
          const vn = puck.vx * nx + puck.vy * ny;
          if (vn < 0) {
            puck.vx -= (1 + CONFIG.RESTITUTION_POST) * vn * nx;
            puck.vy -= (1 + CONFIG.RESTITUTION_POST) * vn * ny;

            this.sound.playPostPing();
            this.particles.spawnHitSparks(post.x, post.y, nx, ny, '#ffffff', 8, 250);
          }
        }
      }
    }

    // Table Walls, Rounded Corners, and Goal Mouth Entry
    resolveGoalAndWalls() {
      const puck = this.puck;

      // Check Top Goal Mouth
      const isTopGoalMouthX = puck.x >= CONFIG.GOAL_LEFT && puck.x <= CONFIG.GOAL_RIGHT;
      if (isTopGoalMouthX && puck.y - puck.r <= CONFIG.TABLE_TOP) {
        // Puck is entering / inside top goal cavity!
        // Sidewalls of goal cavity keep puck from flying sideways
        if (puck.x - puck.r < CONFIG.GOAL_LEFT) {
          puck.x = CONFIG.GOAL_LEFT + puck.r;
          puck.vx = Math.abs(puck.vx);
        }
        if (puck.x + puck.r > CONFIG.GOAL_RIGHT) {
          puck.x = CONFIG.GOAL_RIGHT - puck.r;
          puck.vx = -Math.abs(puck.vx);
        }

        // Crossed goal line threshold: PLAYER 1 SCORED!
        if (!puck.inGoal && puck.y <= CONFIG.TABLE_TOP - 16) {
          puck.inGoal = true;
          puck.vx = 0;
          puck.vy = 0;
          this.game.onGoalScored(1);
          return;
        }
      } else {
        // Top Wall Bumper Bounce (Left and Right of Goal Mouth)
        if (puck.y - puck.r < CONFIG.TABLE_TOP) {
          puck.y = CONFIG.TABLE_TOP + puck.r;
          puck.vy = Math.abs(puck.vy) * CONFIG.RESTITUTION_WALL;
          this.sound.playWallBounce(Math.abs(puck.vy));
          this.particles.spawnHitSparks(puck.x, CONFIG.TABLE_TOP, 0, 1, '#ffffff', 6, 200);
        }
      }

      // Check Bottom Goal Mouth
      const isBottomGoalMouthX = puck.x >= CONFIG.GOAL_LEFT && puck.x <= CONFIG.GOAL_RIGHT;
      if (isBottomGoalMouthX && puck.y + puck.r >= CONFIG.TABLE_BOTTOM) {
        // Puck is entering / inside bottom goal cavity!
        if (puck.x - puck.r < CONFIG.GOAL_LEFT) {
          puck.x = CONFIG.GOAL_LEFT + puck.r;
          puck.vx = Math.abs(puck.vx);
        }
        if (puck.x + puck.r > CONFIG.GOAL_RIGHT) {
          puck.x = CONFIG.GOAL_RIGHT - puck.r;
          puck.vx = -Math.abs(puck.vx);
        }

        // Crossed goal line threshold: PLAYER 2 SCORED!
        if (!puck.inGoal && puck.y >= CONFIG.TABLE_BOTTOM + 16) {
          puck.inGoal = true;
          puck.vx = 0;
          puck.vy = 0;
          this.game.onGoalScored(2);
          return;
        }
      } else {
        // Bottom Wall Bumper Bounce (Left and Right of Goal Mouth)
        if (puck.y + puck.r > CONFIG.TABLE_BOTTOM) {
          puck.y = CONFIG.TABLE_BOTTOM - puck.r;
          puck.vy = -Math.abs(puck.vy) * CONFIG.RESTITUTION_WALL;
          this.sound.playWallBounce(Math.abs(puck.vy));
          this.particles.spawnHitSparks(puck.x, CONFIG.TABLE_BOTTOM, 0, -1, '#ffffff', 6, 200);
        }
      }

      // Left Wall Bounce
      if (puck.x - puck.r < CONFIG.TABLE_LEFT) {
        puck.x = CONFIG.TABLE_LEFT + puck.r;
        puck.vx = Math.abs(puck.vx) * CONFIG.RESTITUTION_WALL;
        this.sound.playWallBounce(Math.abs(puck.vx));
        this.particles.spawnHitSparks(CONFIG.TABLE_LEFT, puck.y, 1, 0, '#ffffff', 6, 200);
      }

      // Right Wall Bounce
      if (puck.x + puck.r > CONFIG.TABLE_RIGHT) {
        puck.x = CONFIG.TABLE_RIGHT - puck.r;
        puck.vx = -Math.abs(puck.vx) * CONFIG.RESTITUTION_WALL;
        this.sound.playWallBounce(Math.abs(puck.vx));
        this.particles.spawnHitSparks(CONFIG.TABLE_RIGHT, puck.y, -1, 0, '#ffffff', 6, 200);
      }

      // Rounded Corners Bounce Check
      this.resolveCornerBounce(CONFIG.TABLE_LEFT + CONFIG.CORNER_RADIUS, CONFIG.TABLE_TOP + CONFIG.CORNER_RADIUS, true, true);
      this.resolveCornerBounce(CONFIG.TABLE_RIGHT - CONFIG.CORNER_RADIUS, CONFIG.TABLE_TOP + CONFIG.CORNER_RADIUS, false, true);
      this.resolveCornerBounce(CONFIG.TABLE_LEFT + CONFIG.CORNER_RADIUS, CONFIG.TABLE_BOTTOM - CONFIG.CORNER_RADIUS, true, false);
      this.resolveCornerBounce(CONFIG.TABLE_RIGHT - CONFIG.CORNER_RADIUS, CONFIG.TABLE_BOTTOM - CONFIG.CORNER_RADIUS, false, false);
    }

    resolveCornerBounce(cx, cy, isLeft, isTop) {
      const puck = this.puck;
      const inX = isLeft ? (puck.x < cx) : (puck.x > cx);
      const inY = isTop ? (puck.y < cy) : (puck.y > cy);

      if (inX && inY) {
        const dx = puck.x - cx;
        const dy = puck.y - cy;
        const dist = Math.hypot(dx, dy);
        const maxDist = CONFIG.CORNER_RADIUS - puck.r;

        if (dist > maxDist && dist > 0.001) {
          const nx = -dx / dist; // Inward normal
          const ny = -dy / dist;

          puck.x = cx - nx * maxDist;
          puck.y = cy - ny * maxDist;

          const vn = puck.vx * nx + puck.vy * ny;
          if (vn < 0) {
            puck.vx -= (1 + CONFIG.RESTITUTION_WALL) * vn * nx;
            puck.vy -= (1 + CONFIG.RESTITUTION_WALL) * vn * ny;
            this.sound.playWallBounce(Math.hypot(puck.vx, puck.vy));
          } else if (Math.hypot(puck.vx, puck.vy) < 60) {
            // Anti-corner-sticking nudge towards center table
            puck.vx += nx * 240;
            puck.vy += ny * 240;
          }
        }
      }
    }
  }

  // ==========================================================================
  // FIX 3: HiDPI Canvas Manager
  // Sets canvas physical pixel size to logical × devicePixelRatio so the game
  // is sharp on Retina and high-density mobile screens. All game logic keeps
  // using logical coordinates (CONFIG.WIDTH × CONFIG.HEIGHT).
  // ==========================================================================
  function setupHiDPICanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = CONFIG.WIDTH  * dpr;
    canvas.height = CONFIG.HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    // Scale every draw call up so we still use logical coords throughout
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
  }

  // Re-apply HiDPI scale on window resize (devicePixelRatio can change when
  // moving between monitors with different densities)
  function reapplyHiDPI(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = CONFIG.WIDTH  * dpr;
    canvas.height = CONFIG.HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  // ==========================================================================
  // TABLE RENDERER (Neon Markings, Scoreboard on Ice, Glow Lights)
  // ==========================================================================
  class TableRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.gridPatternCanvas = null;
      this.buildGridPattern();
    }

    // Pre-render air holes grid pattern to offscreen canvas for high fps
    buildGridPattern() {
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = 24;
      patternCanvas.height = 24;
      const pctx = patternCanvas.getContext('2d');

      pctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      pctx.beginPath();
      pctx.arc(12, 12, 1.2, 0, Math.PI * 2);
      pctx.fill();

      this.gridPatternCanvas = patternCanvas;
    }

    drawTable(p1Score, p2Score) {
      const ctx = this.ctx;

      // 1. Table Ice Base Background
      const iceGrad = ctx.createLinearGradient(0, 0, 0, CONFIG.HEIGHT);
      iceGrad.addColorStop(0, '#0c1024');
      iceGrad.addColorStop(0.5, '#080a18');
      iceGrad.addColorStop(1, '#0c1024');
      ctx.fillStyle = iceGrad;
      ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);

      // 2. Air Cushion Surface Holes Grid
      if (this.gridPatternCanvas) {
        ctx.fillStyle = ctx.createPattern(this.gridPatternCanvas, 'repeat');
        ctx.fillRect(CONFIG.TABLE_LEFT, CONFIG.TABLE_TOP, CONFIG.TABLE_RIGHT - CONFIG.TABLE_LEFT, CONFIG.TABLE_BOTTOM - CONFIG.TABLE_TOP);
      }

      // 3. Goal Pockets Depth (Dark cavity recesses)
      ctx.fillStyle = '#03040a';
      // Top Goal Pocket
      ctx.fillRect(CONFIG.GOAL_LEFT, CONFIG.TABLE_TOP - CONFIG.GOAL_DEPTH, CONFIG.GOAL_WIDTH, CONFIG.GOAL_DEPTH);
      // Bottom Goal Pocket
      ctx.fillRect(CONFIG.GOAL_LEFT, CONFIG.TABLE_BOTTOM, CONFIG.GOAL_WIDTH, CONFIG.GOAL_DEPTH);

      // Top Goal Pocket Neon Accent
      ctx.fillStyle = 'rgba(255, 0, 119, 0.25)';
      ctx.fillRect(CONFIG.GOAL_LEFT, CONFIG.TABLE_TOP - 6, CONFIG.GOAL_WIDTH, 6);
      // Bottom Goal Pocket Neon Accent
      ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
      ctx.fillRect(CONFIG.GOAL_LEFT, CONFIG.TABLE_BOTTOM, CONFIG.GOAL_WIDTH, 6);

      // 4. Center Line & Center Circle
      ctx.save();
      // Center Line
      ctx.strokeStyle = 'rgba(157, 78, 221, 0.45)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#9d4edd';
      ctx.shadowBlur = 8;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.moveTo(CONFIG.TABLE_LEFT + 2, CONFIG.CENTER_Y);
      ctx.lineTo(CONFIG.TABLE_RIGHT - 2, CONFIG.CENTER_Y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Center Circle
      ctx.strokeStyle = 'rgba(157, 78, 221, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CONFIG.WIDTH / 2, CONFIG.CENTER_Y, 78, 0, Math.PI * 2);
      ctx.stroke();

      // Center Dot
      ctx.fillStyle = '#9d4edd';
      ctx.beginPath();
      ctx.arc(CONFIG.WIDTH / 2, CONFIG.CENTER_Y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 5. Goal Crease Arcs & Face-off Markings
      ctx.save();
      // Top Crease Arc (Player 2, Pink)
      ctx.strokeStyle = 'rgba(255, 0, 119, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = CONFIG.COLOR_P2;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(CONFIG.WIDTH / 2, CONFIG.TABLE_TOP, 130, 0, Math.PI);
      ctx.stroke();

      // Bottom Crease Arc (Player 1, Cyan)
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
      ctx.shadowColor = CONFIG.COLOR_P1;
      ctx.beginPath();
      ctx.arc(CONFIG.WIDTH / 2, CONFIG.TABLE_BOTTOM, 130, Math.PI, 0);
      ctx.stroke();
      ctx.restore();

      // 6. Huge Glowing Arcade Scores on Ice Surface
      this.drawOnTableScore(p1Score, p2Score);

      // 7. Outer Cushions & Rounded Corner Rails
      this.drawCushionRails();
    }

    drawOnTableScore(p1Score, p2Score) {
      const ctx = this.ctx;
      ctx.save();
      ctx.font = '900 110px "Orbitron", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Player 2 Score (Top Half)
      ctx.fillStyle = 'rgba(255, 0, 119, 0.22)';
      ctx.shadowColor = CONFIG.COLOR_P2;
      ctx.shadowBlur = 15;
      ctx.fillText(p2Score.toString(), CONFIG.WIDTH / 2, CONFIG.CENTER_Y - 140);

      // Player 1 Score (Bottom Half)
      ctx.fillStyle = 'rgba(0, 240, 255, 0.22)';
      ctx.shadowColor = CONFIG.COLOR_P1;
      ctx.shadowBlur = 15;
      ctx.fillText(p1Score.toString(), CONFIG.WIDTH / 2, CONFIG.CENTER_Y + 140);

      ctx.restore();
    }

    drawCushionRails() {
      const ctx = this.ctx;
      ctx.save();

      const L = CONFIG.TABLE_LEFT;
      const R = CONFIG.TABLE_RIGHT;
      const T = CONFIG.TABLE_TOP;
      const B = CONFIG.TABLE_BOTTOM;
      const CR = CONFIG.CORNER_RADIUS;
      const GL = CONFIG.GOAL_LEFT;
      const GR = CONFIG.GOAL_RIGHT;

      // Heavy neon borders
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1. Player 2 Top Cushion Rails (Neon Pink)
      ctx.strokeStyle = CONFIG.COLOR_P2;
      ctx.shadowColor = CONFIG.COLOR_P2;
      ctx.shadowBlur = 12;

      // Top-Left Wall segment + corner
      ctx.beginPath();
      ctx.moveTo(GL, T);
      ctx.lineTo(L + CR, T);
      ctx.arcTo(L, T, L, T + CR, CR);
      ctx.lineTo(L, CONFIG.CENTER_Y);
      ctx.stroke();

      // Top-Right Wall segment + corner
      ctx.beginPath();
      ctx.moveTo(GR, T);
      ctx.lineTo(R - CR, T);
      ctx.arcTo(R, T, R, T + CR, CR);
      ctx.lineTo(R, CONFIG.CENTER_Y);
      ctx.stroke();

      // 2. Player 1 Bottom Cushion Rails (Neon Cyan)
      ctx.strokeStyle = CONFIG.COLOR_P1;
      ctx.shadowColor = CONFIG.COLOR_P1;
      ctx.shadowBlur = 12;

      // Bottom-Left Wall segment + corner
      ctx.beginPath();
      ctx.moveTo(L, CONFIG.CENTER_Y);
      ctx.lineTo(L, B - CR);
      ctx.arcTo(L, B, L + CR, B, CR);
      ctx.lineTo(GL, B);
      ctx.stroke();

      // Bottom-Right Wall segment + corner
      ctx.beginPath();
      ctx.moveTo(R, CONFIG.CENTER_Y);
      ctx.lineTo(R, B - CR);
      ctx.arcTo(R, B, R - CR, B, CR);
      ctx.lineTo(GR, B);
      ctx.stroke();

      // 3. Goal Posts Knobs (Metallic Rounded Stoppers)
      ctx.shadowBlur = 8;
      const posts = [
        { x: GL, y: T, color: CONFIG.COLOR_P2 },
        { x: GR, y: T, color: CONFIG.COLOR_P2 },
        { x: GL, y: B, color: CONFIG.COLOR_P1 },
        { x: GR, y: B, color: CONFIG.COLOR_P1 }
      ];

      for (const post of posts) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = post.color;
        ctx.beginPath();
        ctx.arc(post.x, post.y, CONFIG.GOAL_POST_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = post.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(post.x, post.y, CONFIG.GOAL_POST_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // ==========================================================================
  // NET MANAGER — PeerJS Serverless WebRTC Online Multiplayer
  // Architecture: Host runs full physics authoritatively and broadcasts game
  // state to guest. Guest sends its striker coordinates only. Guest renders
  // the table mirrored (their own paddle always at the bottom of their screen).
  // ==========================================================================
  class NetManager {
    constructor(game) {
      this.game = game;

      // PeerJS peer object
      this.peer = null;
      // Active data connection to the other player
      this.conn = null;

      // 'host' | 'guest' | null
      this.role = null;

      // The 4-char room code (= host's PeerJS peer ID suffix)
      this.roomCode = null;

      // Connection state
      this.netState = 'idle'; // 'idle' | 'creating' | 'waiting' | 'joining' | 'connected' | 'error'

      // Ping measurement
      this.ping = 0;
      this._pingInterval = null;
      this._pingSentAt = 0;

      // Host broadcast throttle: send puck state ~40Hz (every 25ms)
      this._lastBroadcast = 0;

      // Guest interpolation state
      this._interpPuck = { x: CONFIG.WIDTH / 2, y: CONFIG.CENTER_Y, vx: 0, vy: 0, t: 0 };
      this._interpPuckRemote = { x: CONFIG.WIDTH / 2, y: CONFIG.CENTER_Y, vx: 0, vy: 0 };

      // Peer ID prefix to namespace rooms (avoid collisions with other PeerJS apps)
      this.PEER_PREFIX = 'neonahockey-';
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _makeCode() {
      // 4 uppercase alphanum characters, avoiding ambiguous chars O/0/I/1
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
      return code;
    }

    _peerId(code) {
      return this.PEER_PREFIX + code.toUpperCase();
    }

    _createPeer(id) {
      const opts = { debug: 0 };
      return id ? new Peer(id, opts) : new Peer(opts);
    }

    // ── HOST: Create a room ───────────────────────────────────────────────────

    createRoom(onWaiting, onConnected, onError) {
      this.role = 'host';
      this.netState = 'creating';
      this.roomCode = this._makeCode();
      const peerId = this._peerId(this.roomCode);

      try {
        this.peer = this._createPeer(peerId);
      } catch (e) {
        onError('PeerJS not available. Check your internet connection.');
        return;
      }

      this.peer.on('open', () => {
        this.netState = 'waiting';
        onWaiting(this.roomCode);
      });

      this.peer.on('error', (err) => {
        const msg = err.type === 'unavailable-id'
          ? 'Room code conflict — please try again.'
          : `Connection error: ${err.type}`;
        this.netState = 'error';
        onError(msg);
      });

      this.peer.on('connection', (conn) => {
        if (this.conn) { conn.close(); return; } // reject second connection
        this.conn = conn;
        this._setupConn(conn, onConnected);
      });
    }

    // ── GUEST: Join a room ───────────────────────────────────────────────────

    joinRoom(code, onConnected, onError) {
      this.role = 'guest';
      this.netState = 'joining';
      this.roomCode = code.toUpperCase().trim();

      try {
        this.peer = this._createPeer(); // guest gets a random ID
      } catch (e) {
        onError('PeerJS not available. Check your internet connection.');
        return;
      }

      this.peer.on('open', () => {
        const targetId = this._peerId(this.roomCode);
        this.conn = this.peer.connect(targetId, { reliable: false, serialization: 'json' });
        this._setupConn(this.conn, onConnected);
      });

      this.peer.on('error', (err) => {
        const msg = err.type === 'peer-unavailable'
          ? `Room "${this.roomCode}" not found. Check the code and try again.`
          : `Connection error: ${err.type}`;
        this.netState = 'error';
        onError(msg);
      });
    }

    // ── Shared connection setup ───────────────────────────────────────────────

    _setupConn(conn, onConnected) {
      conn.on('open', () => {
        this.netState = 'connected';
        onConnected(this.role);
        this._startPing();
      });

      conn.on('data', (msg) => {
        this._onData(msg);
      });

      conn.on('close', () => {
        this.netState = 'idle';
        this.game.onNetDisconnected();
      });

      conn.on('error', () => {
        this.game.onNetDisconnected();
      });
    }

    // ── Incoming message dispatcher ──────────────────────────────────────────

    _onData(msg) {
      if (!msg || !msg.t) return;
      switch (msg.t) {
        // HOST → GUEST: authoritative game state snapshot
        case 'gs': this._onGameState(msg); break;
        // HOST → GUEST: goal scored (scorer = 1 or 2 from host's local perspective)
        case 'goal': this.game.onGoalScored(msg.scorer, true); break;
        // HOST → GUEST: match reset
        case 'reset': this.game.applyRemoteReset(msg); break;
        // HOST ↔ GUEST: ping/pong RTT measurement
        case 'ping': this._send({ t: 'pong', id: msg.id }); break;
        case 'pong': this.ping = Math.round((performance.now() - this._pingSentAt)); this.game.updatePingDisplay(this.ping); break;
        // GUEST → HOST: guest striker position (normalized 0–1)
        case 'striker': this.game.applyRemoteStriker(msg.nx, msg.ny); break;
      }
    }

    // ── HOST: apply incoming guest striker ───────────────────────────────────

    // (called by game.applyRemoteStriker which is defined in AirHockeyGame)

    // ── GUEST: apply incoming game state snapshot ─────────────────────────────

    _onGameState(msg) {
      // Store for interpolation
      this._interpPuckRemote = {
        x:  msg.px,
        y:  msg.py,
        vx: msg.pvx,
        vy: msg.pvy
      };
      this._interpPuck = {
        x:  this.game.puck.x,
        y:  this.game.puck.y,
        vx: this.game.puck.vx,
        vy: this.game.puck.vy,
        t:  0
      };
      // Scores (host perspective: p1 = host, p2 = guest)
      // Guest sees itself as Player 1 (bottom of screen), so invert
      this.game.applyRemoteScores(msg.s1, msg.s2);

      // Host p2Striker (opponent of guest) position: denormalize from host coordinates
      // The host sends p2 as top-half striker; guest renders it mirrored as the top striker
      if (msg.op) {
        // op = opponent striker in host coords
        this.game.applyRemoteOpponentStriker(msg.op.x, msg.op.y);
      }
    }

    // ── HOST: broadcast state to guest ───────────────────────────────────────

    broadcastGameState(now) {
      if (this.role !== 'host') return;
      if (!this.conn || this.netState !== 'connected') return;
      if (now - this._lastBroadcast < 25) return; // cap at 40Hz
      this._lastBroadcast = now;

      const puck = this.game.puck;
      const p2 = this.game.p2Striker; // host's local p2 is the guest's opponent (top)
      this._send({
        t: 'gs',
        px: puck.x,
        py: puck.y,
        pvx: puck.vx,
        pvy: puck.vy,
        s1: this.game.p1Score,
        s2: this.game.p2Score,
        // Send host's P2 striker position for guest to render at the top
        op: { x: p2.x, y: p2.y }
      });
    }

    // ── GUEST: send local striker to host ────────────────────────────────────

    sendStrikerPosition(x, y) {
      if (this.role !== 'guest') return;
      if (!this.conn || this.netState !== 'connected') return;
      // Normalize to [0,1] relative to guest's bottom half, so host can map back
      const nx = (x - CONFIG.TABLE_LEFT) / (CONFIG.TABLE_RIGHT - CONFIG.TABLE_LEFT);
      const ny = (y - CONFIG.CENTER_Y) / (CONFIG.TABLE_BOTTOM - CONFIG.CENTER_Y);
      this._send({ t: 'striker', nx, ny });
    }

    // ── HOST: broadcast goal event ────────────────────────────────────────────

    broadcastGoal(scorer) {
      if (this.role !== 'host') return;
      this._send({ t: 'goal', scorer });
    }

    // ── HOST: broadcast match reset ───────────────────────────────────────────

    broadcastReset(servingSide) {
      if (this.role !== 'host') return;
      this._send({ t: 'reset', serving: servingSide });
    }

    // ── Guest: interpolate puck for smooth rendering ──────────────────────────

    interpolatePuck(dt) {
      if (this.role !== 'guest') return;
      const alpha = 0.18; // interpolation speed (lower = smoother but laggier)
      const puck = this.game.puck;
      const remote = this._interpPuckRemote;

      // Map host coordinates to guest mirrored coordinates
      // Guest sees table flipped: host Y 38–962 maps to guest 962–38
      const mirrorY = CONFIG.HEIGHT - remote.y;
      const mirrorVy = -remote.vy;

      puck.x += (remote.x - puck.x) * alpha;
      puck.y += (mirrorY - puck.y) * alpha;
      puck.vx = remote.vx;
      puck.vy = mirrorVy;
    }

    // ── Ping ─────────────────────────────────────────────────────────────────

    _startPing() {
      this._pingInterval = setInterval(() => {
        if (this.netState !== 'connected') return;
        this._pingSentAt = performance.now();
        this._send({ t: 'ping', id: this._pingSentAt });
      }, 2000);
    }

    // ── Send helper ───────────────────────────────────────────────────────────

    _send(msg) {
      try {
        if (this.conn && this.conn.open) {
          this.conn.send(msg);
        }
      } catch (e) { /* ignore send errors on close */ }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    destroy() {
      if (this._pingInterval) clearInterval(this._pingInterval);
      this._pingInterval = null;
      if (this.conn) { try { this.conn.close(); } catch (e) {} }
      if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
      this.conn = null;
      this.peer = null;
      this.role = null;
      this.netState = 'idle';
    }
  }

  // ==========================================================================
  // GAME MASTER CONTROLLER (State Machine, Scoring, Modals & UI Binding)
  // ==========================================================================
  class AirHockeyGame {
    constructor() {
      // DOM Elements & Fix 3: HiDPI sharp rendering with devicePixelRatio
      this.canvas = document.getElementById('air-hockey-canvas');
      this.ctx = setupHiDPICanvas(this.canvas);
      this.container = document.getElementById('canvas-container');

      window.addEventListener('resize', () => {
        reapplyHiDPI(this.canvas, this.ctx);
      });

      // Top HUD Elements
      this.p1MiniScore = document.getElementById('p1-mini-score');
      this.p2MiniScore = document.getElementById('p2-mini-score');
      this.modeBtn = document.getElementById('mode-btn');
      this.modeLabel = document.getElementById('mode-label');
      this.soundBtn = document.getElementById('sound-btn');
      this.soundIcon = document.getElementById('sound-icon');
      this.helpBtn = document.getElementById('help-btn');
      this.pauseBtn = document.getElementById('pause-btn');
      this.pauseIcon = document.getElementById('pause-icon');

      // Touch Hints & Goal Banner
      this.topHint = document.getElementById('top-touch-hint');
      this.bottomHint = document.getElementById('bottom-touch-hint');
      this.goalBanner = document.getElementById('goal-banner');
      this.goalScorerText = document.getElementById('goal-scorer-text');

      // Modals
      this.pauseModal = document.getElementById('pause-modal');
      this.resumeBtn = document.getElementById('resume-btn');
      this.pauseRestartBtn = document.getElementById('pause-restart-btn');
      this.pauseModeBtn = document.getElementById('pause-mode-btn');
      this.modalP1Score = document.getElementById('modal-p1-score');
      this.modalP2Score = document.getElementById('modal-p2-score');

      this.gameoverModal = document.getElementById('gameover-modal');
      this.winnerTitle = document.getElementById('winner-title');
      this.finalP1Score = document.getElementById('final-p1-score');
      this.finalP2Score = document.getElementById('final-p2-score');
      this.finalP1Name = document.getElementById('final-p1-name');
      this.finalP2Name = document.getElementById('final-p2-name');
      this.rematchBtn = document.getElementById('rematch-btn');
      this.gameoverModeBtn = document.getElementById('gameover-mode-btn');

      this.helpModal = document.getElementById('help-modal');
      this.closeHelpBtn = document.getElementById('close-help-btn');

      // Footer Buttons
      this.resetRoundBtn = document.getElementById('reset-round-btn');
      this.newGameBtn = document.getElementById('new-game-btn');

      // Core Game States: 'MENU', 'PLAYING', 'GOAL_DELAY', 'PAUSED', 'GAME_OVER'
      // Start at MENU on launch so the Welcome / Mode Select screen displays first!
      this.state = 'MENU';
      this.gameMode = '2player'; // '2player' | 'ai' | 'online'
      this.p1Score = 0;
      this.p2Score = 0;
      this.targetScore = CONFIG.TARGET_SCORE;
      this.goalResetTimer = 0;
      this.hintsDismissed = false;

      // Subsystems
      this.sound = new SoundSystem();
      this.particles = new ParticleSystem();
      this.tableRenderer = new TableRenderer(this.canvas);

      // Entities
      this.p1Striker = new Striker(1, CONFIG.WIDTH / 2, 820);
      this.p2Striker = new Striker(2, CONFIG.WIDTH / 2, 180);
      this.puck = new Puck(CONFIG.WIDTH / 2, CONFIG.CENTER_Y);

      this.ai = new AIController(this.p2Striker, this.puck);
      this.physics = new PhysicsEngine(this);
      this.input = new InputController(this.canvas, this);

      // Online multiplayer
      this.net = new NetManager(this);

      // Timing Loop
      this.lastTime = performance.now();

      this.initUI();
      this.initOnlineUI();
      this.checkUrlRoomCode();
      this.updateHUD();
      this.startLoop();
    }

    initUI() {
      // Main Menu HUD button
      const menuBtn = document.getElementById('menu-btn');
      if (menuBtn) {
        menuBtn.addEventListener('click', () => {
          this.sound.init();
          this.sound.playButton();
          this.openMainMenu();
        });
      }

      // Main Menu Mode Buttons
      const menuBtn2p = document.getElementById('menu-btn-2p');
      if (menuBtn2p) {
        menuBtn2p.addEventListener('click', () => {
          this.selectModeAndStart('2player');
        });
      }

      const menuBtnAi = document.getElementById('menu-btn-ai');
      if (menuBtnAi) {
        menuBtnAi.addEventListener('click', () => {
          this.selectModeAndStart('ai');
        });
      }

      const menuBtnOnline = document.getElementById('menu-btn-online');
      if (menuBtnOnline) {
        menuBtnOnline.addEventListener('click', () => {
          this.sound.init();
          this.sound.playButton();
          const mainMenu = document.getElementById('main-menu-modal');
          if (mainMenu) mainMenu.classList.add('hidden');
          this.openOnlineLobby();
        });
      }

      const menuHelpBtn = document.getElementById('menu-help-btn');
      if (menuHelpBtn) {
        menuHelpBtn.addEventListener('click', () => {
          this.sound.init();
          this.sound.playButton();
          this.helpModal.classList.remove('hidden');
        });
      }

      const menuSoundBtn = document.getElementById('menu-sound-btn');
      if (menuSoundBtn) {
        menuSoundBtn.addEventListener('click', () => {
          this.sound.init();
          this.sound.playButton();
          this.toggleSound();
        });
      }

      // Return to Menu from Pause Modal
      const pauseMenuBtn = document.getElementById('pause-menu-btn');
      if (pauseMenuBtn) {
        pauseMenuBtn.addEventListener('click', () => {
          this.pauseModal.classList.add('hidden');
          this.openMainMenu();
        });
      }

      // Return to Menu from Game Over Modal
      const gameoverMenuBtn = document.getElementById('gameover-menu-btn');
      if (gameoverMenuBtn) {
        gameoverMenuBtn.addEventListener('click', () => {
          this.gameoverModal.classList.add('hidden');
          this.openMainMenu();
        });
      }

      // Disconnect Overlay Actions
      const dcMenuBtn = document.getElementById('dc-menu-btn');
      if (dcMenuBtn) {
        dcMenuBtn.addEventListener('click', () => {
          document.getElementById('dc-overlay').classList.add('hidden');
          this.openMainMenu();
        });
      }

      const dcRematchBtn = document.getElementById('dc-rematch-btn');
      if (dcRematchBtn) {
        dcRematchBtn.addEventListener('click', () => {
          this.sound.playButton();
          document.getElementById('dc-overlay').classList.add('hidden');
          this.openOnlineLobby();
        });
      }

      const dcLocalBtn = document.getElementById('dc-local-btn');
      if (dcLocalBtn) {
        dcLocalBtn.addEventListener('click', () => {
          document.getElementById('dc-overlay').classList.add('hidden');
          this.selectModeAndStart('2player');
        });
      }

      // Sound button
      this.soundBtn.addEventListener('click', () => {
        this.sound.init();
        this.toggleSound();
      });

      // Mode button (2-Player vs AI)
      this.modeBtn.addEventListener('click', () => {
        this.sound.init();
        this.sound.playButton();
        this.toggleGameMode();
      });

      // Pause button
      this.pauseBtn.addEventListener('click', () => {
        this.sound.init();
        this.sound.playButton();
        this.togglePause();
      });

      // Resume button in pause modal
      this.resumeBtn.addEventListener('click', () => {
        this.sound.playButton();
        this.togglePause();
      });

      // Restart match in pause modal
      this.pauseRestartBtn.addEventListener('click', () => {
        this.sound.playButton();
        this.pauseModal.classList.add('hidden');
        this.resetMatch();
        this.state = 'PLAYING';
        this.pauseIcon.textContent = '⏸️';
      });

      // Toggle AI in pause modal
      this.pauseModeBtn.addEventListener('click', () => {
        this.sound.playButton();
        if (this.gameMode === 'online') {
          this.leaveOnline();
          this.gameMode = '2player';
          this._applyModeLabel();
        } else {
          this.gameMode = this.gameMode === '2player' ? 'ai' : '2player';
          this._applyModeLabel();
        }
        this.pauseModeBtn.textContent = this._pauseModeBtnLabel();
      });

      // Help button
      this.helpBtn.addEventListener('click', () => {
        this.sound.init();
        this.sound.playButton();
        this.helpModal.classList.remove('hidden');
        if (this.state === 'PLAYING') {
          this.state = 'PAUSED';
          this.pauseIcon.textContent = '▶️';
        }
      });

      this.closeHelpBtn.addEventListener('click', () => {
        this.sound.playButton();
        this.helpModal.classList.add('hidden');
        if (this.state === 'PAUSED' && this.pauseModal.classList.contains('hidden') && document.getElementById('main-menu-modal').classList.contains('hidden')) {
          this.state = 'PLAYING';
          this.pauseIcon.textContent = '⏸️';
        }
      });

      // Rematch button in winner modal
      this.rematchBtn.addEventListener('click', () => {
        this.sound.playButton();
        this.startRematch();
      });

      // Toggle mode in game over modal
      this.gameoverModeBtn.addEventListener('click', () => {
        this.sound.playButton();
        this.toggleGameMode();
        this.startRematch();
      });

      // Footer actions
      this.resetRoundBtn.addEventListener('click', () => {
        this.sound.init();
        this.sound.playButton();
        this.resetPuckToCenter();
      });

      this.newGameBtn.addEventListener('click', () => {
        this.sound.init();
        this.sound.playButton();
        this.resetMatch();
      });

      // Sound icon initial check
      this.updateSoundIcon();
    }

    openMainMenu() {
      this.state = 'MENU';
      this.pauseIcon.textContent = '⏸️';
      this.pauseModal.classList.add('hidden');
      this.gameoverModal.classList.add('hidden');
      const onlineModal = document.getElementById('online-modal');
      if (onlineModal) onlineModal.classList.add('hidden');
      const dcOverlay = document.getElementById('dc-overlay');
      if (dcOverlay) dcOverlay.classList.add('hidden');
      this.goalBanner.classList.remove('show');
      const mainMenu = document.getElementById('main-menu-modal');
      if (mainMenu) mainMenu.classList.remove('hidden');
    }

    selectModeAndStart(mode) {
      this.sound.init();
      this.sound.playButton();
      this.gameMode = mode;
      this._applyModeLabel();
      const topHintText = document.getElementById('top-hint-text');
      if (topHintText) {
        topHintText.textContent = this.gameMode === '2player' ? 'PLAYER 2 (ARROW KEYS / TOUCH)' : 'COMPUTER AI';
      }
      const mainMenu = document.getElementById('main-menu-modal');
      if (mainMenu) mainMenu.classList.add('hidden');
      this.resetMatch();
      this.state = 'PLAYING';
      this.pauseIcon.textContent = '⏸️';
    }

    toggleSound() {
      const isMuted = this.sound.toggleMute();
      this.updateSoundIcon();
    }

    updateSoundIcon() {
      const icon = this.sound.isMuted ? '🔇' : '🔊';
      if (this.soundIcon) this.soundIcon.textContent = icon;
      if (this.soundBtn) this.soundBtn.setAttribute('title', this.sound.isMuted ? 'Unmute Sound' : 'Mute Sound');
      const menuSoundIcon = document.getElementById('menu-sound-icon');
      if (menuSoundIcon) menuSoundIcon.textContent = icon;
    }

    toggleGameMode() {
      // Cycle: 2player → ai → online → 2player
      if (this.gameMode === '2player') {
        this.gameMode = 'ai';
      } else if (this.gameMode === 'ai') {
        this.openOnlineLobby();
        return;
      } else if (this.gameMode === 'online') {
        this.leaveOnline();
        this.gameMode = '2player';
      }
      this._applyModeLabel();
      const topHintText = document.getElementById('top-hint-text');
      if (topHintText) {
        topHintText.textContent = this.gameMode === '2player' ? 'PLAYER 2 (ARROW KEYS / TOUCH)' : 'COMPUTER AI';
      }
    }

    _applyModeLabel() {
      const labels = { '2player': '2-PLAYER', 'ai': 'VS AI', 'online': '🌐 ONLINE' };
      this.modeLabel.textContent = labels[this.gameMode] || '2-PLAYER';
    }

    // ── ONLINE LOBBY ──────────────────────────────────────────────────────────

    openOnlineLobby() {
      this.state = 'PAUSED';
      this.pauseIcon.textContent = '▶️';
      document.getElementById('online-modal').classList.remove('hidden');
    }

    initOnlineUI() {
      const onlineModal = document.getElementById('online-modal');
      const createRoomBtn = document.getElementById('create-room-btn');
      const cancelHostBtn = document.getElementById('cancel-host-btn');
      const copyLinkBtn = document.getElementById('copy-link-btn');
      const joinRoomBtn = document.getElementById('join-room-btn');
      const cancelJoinBtn = document.getElementById('cancel-join-btn');
      const closeOnlineBtn = document.getElementById('close-online-btn');
      const joinCodeInput = document.getElementById('join-code-input');
      const tabCreate = document.getElementById('tab-create');
      const tabJoin = document.getElementById('tab-join');

      // Tab switcher
      tabCreate.addEventListener('click', () => {
        tabCreate.classList.add('active'); tabJoin.classList.remove('active');
        document.getElementById('panel-create').classList.remove('hidden');
        document.getElementById('panel-join').classList.add('hidden');
      });
      tabJoin.addEventListener('click', () => {
        tabJoin.classList.add('active'); tabCreate.classList.remove('active');
        document.getElementById('panel-join').classList.remove('hidden');
        document.getElementById('panel-create').classList.add('hidden');
      });

      // CREATE ROOM
      createRoomBtn.addEventListener('click', () => {
        this.sound.init();
        this.sound.playButton();
        createRoomBtn.disabled = true;
        createRoomBtn.textContent = 'CONNECTING…';

        this.net.createRoom(
          (code) => {
            // Show waiting state
            document.getElementById('create-idle-state').classList.add('hidden');
            document.getElementById('create-waiting-state').classList.remove('hidden');
            document.getElementById('room-code-text').textContent = code;
            const link = this._buildRoomLink(code);
            document.getElementById('room-link-input').value = link;
          },
          (role) => { this._onOnlineConnected(role); onlineModal.classList.add('hidden'); },
          (err) => {
            createRoomBtn.disabled = false;
            createRoomBtn.textContent = 'GENERATE ROOM CODE';
            this._showJoinStatus(err, 'error');
          }
        );
      });

      // CANCEL HOST
      cancelHostBtn.addEventListener('click', () => {
        this.net.destroy();
        document.getElementById('create-idle-state').classList.remove('hidden');
        document.getElementById('create-waiting-state').classList.add('hidden');
        document.getElementById('create-room-btn').disabled = false;
        document.getElementById('create-room-btn').textContent = 'GENERATE ROOM CODE';
      });

      // COPY LINK
      copyLinkBtn.addEventListener('click', () => {
        const link = document.getElementById('room-link-input').value;
        navigator.clipboard.writeText(link).catch(() => {});
        copyLinkBtn.textContent = '✅ COPIED!';
        copyLinkBtn.classList.add('copied');
        setTimeout(() => { copyLinkBtn.textContent = '📋 COPY'; copyLinkBtn.classList.remove('copied'); }, 2000);
      });

      // JOIN ROOM
      joinRoomBtn.addEventListener('click', () => {
        const code = joinCodeInput.value.trim().toUpperCase();
        if (code.length !== 4) {
          this._showJoinStatus('Enter a valid 4-character code.', 'error');
          return;
        }
        this.sound.init();
        this.sound.playButton();
        joinRoomBtn.disabled = true;
        this._showJoinStatus('Connecting to room ' + code + '…', 'connecting');

        this.net.joinRoom(
          code,
          (role) => { this._onOnlineConnected(role); onlineModal.classList.add('hidden'); },
          (err) => {
            joinRoomBtn.disabled = false;
            this._showJoinStatus(err, 'error');
          }
        );
      });

      joinCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinRoomBtn.click();
      });
      joinCodeInput.addEventListener('input', () => {
        joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      });

      // CANCEL JOIN
      cancelJoinBtn.addEventListener('click', () => {
        this.net.destroy();
        joinRoomBtn.disabled = false;
        document.getElementById('join-status-msg').classList.add('hidden');
      });

      // CLOSE (back to main menu)
      closeOnlineBtn.addEventListener('click', () => {
        this.net.destroy();
        onlineModal.classList.add('hidden');
        this._resetOnlineLobbyUI();
        this.openMainMenu();
      });
    }

    _buildRoomLink(code) {
      const url = new URL(window.location.href);
      url.searchParams.set('room', code);
      return url.toString();
    }

    _showJoinStatus(msg, type) {
      const el = document.getElementById('join-status-msg');
      el.textContent = msg;
      el.className = `join-status ${type}`;
      el.classList.remove('hidden');
    }

    _resetOnlineLobbyUI() {
      document.getElementById('create-idle-state').classList.remove('hidden');
      document.getElementById('create-waiting-state').classList.add('hidden');
      document.getElementById('create-room-btn').disabled = false;
      document.getElementById('create-room-btn').textContent = 'GENERATE ROOM CODE';
      document.getElementById('join-status-msg').classList.add('hidden');
      document.getElementById('join-room-btn').disabled = false;
      document.getElementById('join-code-input').value = '';
    }

    checkUrlRoomCode() {
      // Auto-open join dialog if URL contains ?room=CODE
      const params = new URLSearchParams(window.location.search);
      const code = params.get('room');
      if (code && code.length === 4) {
        const mainMenu = document.getElementById('main-menu-modal');
        if (mainMenu) mainMenu.classList.add('hidden');
        // Pre-fill and show join tab
        document.getElementById('join-code-input').value = code.toUpperCase();
        document.getElementById('tab-join').click();
        this.openOnlineLobby();
      }
    }

    _onOnlineConnected(role) {
      this.sound.playButton();
      this.gameMode = 'online';
      this._applyModeLabel();
      this.state = 'PLAYING';
      this.pauseIcon.textContent = '⏸️';
      this.resetMatch();

      // Update net status pill
      const pill = document.getElementById('net-status-pill');
      pill.classList.remove('hidden', 'connecting', 'error');
      pill.classList.add('connected');
      document.getElementById('net-status-text').textContent = role === 'host' ? 'HOST' : 'GUEST';
      document.getElementById('net-ping-text').textContent = '';

      // Update bottom hint to show online mode label
      const topHintText = document.getElementById('top-hint-text');
      const bottomHintText = document.getElementById('bottom-hint-text');
      if (topHintText) topHintText.textContent = role === 'host' ? 'OPPONENT (ONLINE)' : 'YOU (ONLINE)';
      if (bottomHintText) bottomHintText.textContent = role === 'guest' ? 'YOU (ONLINE)' : 'YOU (LOCAL)';

      this._resetOnlineLobbyUI();
    }

    updatePingDisplay(ms) {
      const pingEl = document.getElementById('net-ping-text');
      if (pingEl) pingEl.textContent = ms + 'ms';
    }

    leaveOnline() {
      this.net.destroy();
      document.getElementById('net-status-pill').classList.add('hidden');
      this.gameMode = '2player';
      this._applyModeLabel();
    }

    onNetDisconnected() {
      if (this.gameMode !== 'online') return;
      this.leaveOnline();
      this.state = 'PAUSED';
      const onlineModal = document.getElementById('online-modal');
      if (onlineModal) onlineModal.classList.add('hidden');
      const dcOverlay = document.getElementById('dc-overlay');
      if (dcOverlay) dcOverlay.classList.remove('hidden');
      // Show disconnect toast
      const toast = document.getElementById('dc-toast');
      if (toast) {
        document.getElementById('dc-toast-text').textContent = 'Opponent disconnected';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
      }
    }

    // ── ONLINE: apply state from host ─────────────────────────────────────────

    applyRemoteScores(hostP1, hostP2) {
      // Host P1 = host's local player = guest's opponent (top/p2 from guest's view)
      // Host P2 = guest's local player = guest's own score (bottom/p1 from guest's view)
      if (this.net.role !== 'guest') return;
      this.p1Score = hostP2; // guest's own score
      this.p2Score = hostP1; // opponent's score
      this.updateHUD();
    }

    applyRemoteOpponentStriker(hostX, hostY) {
      // Host sends its P2 striker (top striker). Guest renders it mirrored at top.
      if (this.net.role !== 'guest') return;
      // Mirror Y: host Y → guest sees it at top
      this.p2Striker.targetX = hostX;
      this.p2Striker.targetY = CONFIG.HEIGHT - hostY;
    }

    applyRemoteStriker(nx, ny) {
      // Host receives normalized guest striker, maps it to host's P2 (top) zone
      if (this.net.role !== 'host') return;
      // Guest sends coords as if they're in their bottom half [0,1]
      // Map to host's top half for P2
      const x = CONFIG.TABLE_LEFT + nx * (CONFIG.TABLE_RIGHT - CONFIG.TABLE_LEFT);
      // ny=0 → center line, ny=1 → bottom wall; mirror to top half for host's p2
      const y = CONFIG.CENTER_Y - ny * (CONFIG.CENTER_Y - CONFIG.TABLE_TOP);
      this.p2Striker.targetX = x;
      this.p2Striker.targetY = y;
    }

    applyRemoteReset(msg) {
      if (this.net.role !== 'guest') return;
      // Reset puck to center with mirrored serve
      const mirrorServe = msg.serving === 1 ? 2 : (msg.serving === 2 ? 1 : 0);
      this.puck.reset(mirrorServe);
      this.p1Striker.reset(CONFIG.WIDTH / 2, 820);
      this.p2Striker.reset(CONFIG.WIDTH / 2, 180);
      this.goalBanner.classList.remove('show');
      this.state = 'PLAYING';
    }

    togglePause() {
      if (this.state === 'GAME_OVER') return;

      if (this.state === 'PAUSED') {
        this.state = 'PLAYING';
        this.pauseModal.classList.add('hidden');
        this.pauseIcon.textContent = '⏸️';
      } else {
        this.state = 'PAUSED';
        this.modalP1Score.textContent = this.p1Score;
        this.modalP2Score.textContent = this.p2Score;
        this.pauseModeBtn.textContent = this._pauseModeBtnLabel();
        this.pauseModal.classList.remove('hidden');
        this.pauseIcon.textContent = '▶️';
      }
    }

    _pauseModeBtnLabel() {
      if (this.gameMode === 'online') return 'LEAVE ONLINE GAME';
      if (this.gameMode === 'ai') return 'SWITCH TO 2-PLAYER';
      return 'SWITCH TO VS AI';
    }

    dismissTouchHints() {
      if (!this.hintsDismissed) {
        this.hintsDismissed = true;
        if (this.topHint) this.topHint.classList.add('fade-out');
        if (this.bottomHint) this.bottomHint.classList.add('fade-out');
      }
    }

    updateHUD() {
      this.p1MiniScore.textContent = this.p1Score;
      this.p2MiniScore.textContent = this.p2Score;
    }

    onGoalScored(scorer, fromRemote = false) {
      // Prevent multiple score increments while already in celebration or game over
      if (this.state === 'GOAL_DELAY' || this.state === 'GAME_OVER') return;

      // In online host mode: broadcast the goal to guest before state changes
      if (this.gameMode === 'online' && this.net.role === 'host' && !fromRemote) {
        this.net.broadcastGoal(scorer);
      }

      this.state = 'GOAL_DELAY';
      this.goalResetTimer = 1.35; // 1.35s celebration delay

      if (scorer === 1) {
        this.p1Score++;
        this.goalScorerText.textContent = this.gameMode === 'online' && this.net.role === 'guest'
          ? 'YOU SCORE!' : 'PLAYER 1 SCORES!';
        this.goalScorerText.className = 'goal-scorer p1-score';
        this.particles.spawnGoalCelebration(CONFIG.TABLE_TOP, CONFIG.COLOR_P1);
      } else {
        this.p2Score++;
        let p2Name = this.gameMode === 'ai' ? 'COMPUTER'
          : (this.gameMode === 'online' && this.net.role === 'guest') ? 'OPPONENT' : 'PLAYER 2';
        this.goalScorerText.textContent = `${p2Name} SCORES!`;
        this.goalScorerText.className = 'goal-scorer p2-score';
        this.particles.spawnGoalCelebration(CONFIG.TABLE_BOTTOM, CONFIG.COLOR_P2);
      }

      this.updateHUD();
      this.sound.playGoalHorn();

      // Show animated goal banner
      this.goalBanner.classList.add('show');

      // Check Match Victory Condition (First to 7)
      if (this.p1Score >= this.targetScore || this.p2Score >= this.targetScore) {
        setTimeout(() => {
          this.triggerGameOver();
        }, 800);
      }
    }

    triggerGameOver() {
      this.state = 'GAME_OVER';
      this.goalBanner.classList.remove('show');
      this.sound.playWinFanfare();

      const p1Won = this.p1Score >= this.targetScore;
      let p2Label;
      if (this.gameMode === 'ai') p2Label = 'COMPUTER';
      else if (this.gameMode === 'online') p2Label = this.net.role === 'guest' ? 'OPPONENT' : 'PLAYER 2';
      else p2Label = 'PLAYER 2';

      this.winnerTitle.textContent = p1Won ? 'PLAYER 1 WINS!' : `${p2Label} WINS!`;
      this.winnerTitle.style.color = p1Won ? CONFIG.COLOR_P1 : CONFIG.COLOR_P2;

      this.finalP1Name.textContent = 'PLAYER 1';
      this.finalP2Name.textContent = p2Label;
      this.finalP1Score.textContent = this.p1Score;
      this.finalP2Score.textContent = this.p2Score;

      this.gameoverModal.classList.remove('hidden');
    }

    startRematch() {
      this.gameoverModal.classList.add('hidden');
      this.resetMatch();
      this.state = 'PLAYING';
    }

    resetMatch() {
      this.p1Score = 0;
      this.p2Score = 0;
      this.updateHUD();
      this.resetPositions();
      this.goalBanner.classList.remove('show');
    }

    resetPuckToCenter(servingSide = 0) {
      this.puck.reset(servingSide);
      this.p1Striker.reset(CONFIG.WIDTH / 2, 820);
      this.p2Striker.reset(CONFIG.WIDTH / 2, 180);
      this.goalBanner.classList.remove('show');
      // Broadcast reset to guest when acting as host
      if (this.gameMode === 'online' && this.net.role === 'host') {
        this.net.broadcastReset(servingSide);
      }
    }

    resetPositions() {
      this.resetPuckToCenter();
    }

    // ========================================================================
    // MAIN 60FPS RAF LOOP
    // ========================================================================
    startLoop() {
      const loop = (currentTime) => {
        let dt = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        // Clamp dt to avoid physics exploding if tab was in background
        if (dt > CONFIG.MAX_FRAME_DELTA) {
          dt = CONFIG.MAX_FRAME_DELTA;
        }

        this.update(dt);
        this.render();

        requestAnimationFrame(loop);
      };

      requestAnimationFrame(loop);
    }

    update(dt) {
      // 0. Main Menu State: Update strikers and particles, keep puck centered
      if (this.state === 'MENU') {
        this.input.update(dt);
        this.p1Striker.update(dt);
        this.p2Striker.update(dt);
        this.particles.update(dt);
        return;
      }

      // 1. Goal Delay State Transition
      if (this.state === 'GOAL_DELAY') {
        this.goalResetTimer -= dt;
        if (this.goalResetTimer <= 0) {
          this.goalBanner.classList.remove('show');
          if (this.state !== 'GAME_OVER') {
            this.state = 'PLAYING';
            // Serve puck towards the player who was scored on (conceded the goal)
            const scoredOnPlayer = this.puck.y < CONFIG.CENTER_Y ? 2 : 1;
            this.resetPuckToCenter(scoredOnPlayer);
          }
        }
      }

      // 2. Active Game Updates
      if (this.state === 'PLAYING') {
        // ── ONLINE: GUEST ─────────────────────────────────────────────────────
        if (this.gameMode === 'online' && this.net.role === 'guest') {
          // Guest only controls P1 (their local bottom striker)
          this.input.update(dt);
          this.p1Striker.update(dt);
          // Send local striker position to host
          this.net.sendStrikerPosition(this.p1Striker.x, this.p1Striker.y);
          // Apply server-received P2 (opponent) position
          this.p2Striker.update(dt);
          // Smooth-interpolate the puck received from host
          this.net.interpolatePuck(dt);

        // ── ONLINE: HOST ──────────────────────────────────────────────────────
        } else if (this.gameMode === 'online' && this.net.role === 'host') {
          // Host runs full physics + controls P1
          this.input.update(dt);
          // P2 is driven by remote guest striker (applied in applyRemoteStriker)
          this.p1Striker.update(dt);
          this.p2Striker.update(dt);
          this.physics.update(dt);
          // Broadcast authoritative state to guest
          this.net.broadcastGameState(performance.now());

        // ── LOCAL (2-Player or AI) ────────────────────────────────────────────
        } else {
          this.input.update(dt);
          if (this.gameMode === 'ai') {
            this.ai.update(dt);
          }
          this.p1Striker.update(dt);
          this.p2Striker.update(dt);
          this.physics.update(dt);
        }

      } else if (this.state === 'GOAL_DELAY') {
        // Allow smooth striker repositioning during goal celebration without running physics
        this.input.update(dt);
        if (this.gameMode === 'ai') {
          this.ai.update(dt);
        }
        this.p1Striker.update(dt);
        this.p2Striker.update(dt);
      }

      // Update Particle System and Screen Shake
      this.particles.update(dt);
    }

    render() {
      const ctx = this.ctx;
      const isGuest = this.gameMode === 'online' && this.net.role === 'guest';

      // Handle Screen Shake
      ctx.save();

      // GUEST: flip the entire canvas so the guest's own paddle (P1) is at the bottom
      if (isGuest) {
        ctx.translate(CONFIG.WIDTH, CONFIG.HEIGHT);
        ctx.scale(-1, -1);
      }

      if (this.particles.screenShake > 0) {
        const shakeMag = this.particles.screenShake;
        const sx = (Math.random() - 0.5) * shakeMag;
        const sy = (Math.random() - 0.5) * shakeMag;
        ctx.translate(sx, sy);
      }

      // 1. Draw Table Base, Markings, Cushions, and LED Scores
      // Guest scores: p1Score = their own (bottom), p2Score = opponent (top)
      const displayP1 = isGuest ? this.p1Score : this.p1Score;
      const displayP2 = isGuest ? this.p2Score : this.p2Score;
      this.tableRenderer.drawTable(displayP1, displayP2);

      // 2. Draw Strikers
      this.p2Striker.draw(ctx);
      this.p1Striker.draw(ctx);

      // 3. Draw Puck
      this.puck.draw(ctx);

      // 4. Draw Particles (Sparks, Goal Blast, Dust)
      this.particles.draw(ctx);

      ctx.restore();
    }
  }

  // ==========================================================================
  // BOOTSTRAP WHEN DOM IS READY
  // ==========================================================================
  window.addEventListener('DOMContentLoaded', () => {
    window.game = new AirHockeyGame();
  });

})();
