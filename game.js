(() => {
  "use strict";

  const NPC_COLORS = [
    { head: "#c98f6b", body: "#ff2fb0" },
    { head: "#e8b98a", body: "#2ff7ff" },
    { head: "#8a7a95", body: "#9d2fff" },
    { head: "#d9a97c", body: "#39ff88" },
    { head: "#a08a70", body: "#ffe93f" },
    { head: "#6f6478", body: "#ff5e5e" },
  ];

  const GAMEOVER_MESSAGES = [
    "Za blisko!",
    "Przestrzeń osobista naruszona.",
    "Misja zachowania dystansu zakończona.",
    "Następnym razem wybierz większą łazienkę.",
    "Plotki już się rozchodzą…",
    "On patrzył. Wszyscy patrzyli.",
    "Bukovski by tego nie zrobił.",
  ];

  const EVENTS = {
    AWARIA: "awaria",
    SPRZATACZ: "sprzataczka",
    VIP: "vip",
    TLUM: "tlum",
  };

  const $ = (sel) => document.querySelector(sel);
  const rowEl = $("#row");
  const doorEl = $("#door");
  const hudScore = $("#hud-score");
  const hudBest = $("#hud-best");
  const hudLevel = $("#hud-level");
  const titleScreen = $("#title-screen");
  const gameoverScreen = $("#gameover-screen");
  const goMessage = $("#go-message");
  const goScore = $("#go-score");
  const goBest = $("#go-best");
  const eventBanner = $("#event-banner");
  const muteBtn = $("#mute-btn");
  const nickInput = $("#nick-input");
  const titleLeaderboard = $("#title-leaderboard");
  const goLeaderboard = $("#go-leaderboard");

  let audioCtx = null;
  let muted = false;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function beep({ freq = 440, duration = 0.12, type = "sine", start = 0, gain = 0.15, slideTo = null }) {
    if (muted) return;
    try {
      ensureAudio();
      const t0 = audioCtx.currentTime + start;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t0 + duration);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch (e) { /* audio unsupported, ignore */ }
  }

  const sfx = {
    door: () => beep({ freq: 320, duration: 0.1, type: "square", gain: 0.08 }),
    footstep: () => beep({ freq: 180 + Math.random() * 40, duration: 0.05, type: "square", gain: 0.05 }),
    honk: () => { beep({ freq: 500, duration: 0.08, type: "sawtooth", gain: 0.07 }); beep({ freq: 700, duration: 0.08, type: "sawtooth", start: 0.07, gain: 0.06 }); },
    slide: () => beep({ freq: 600, duration: 0.08, type: "triangle", gain: 0.08, slideTo: 900 }),
    gameover: () => { beep({ freq: 300, duration: 0.5, type: "sawtooth", gain: 0.12, slideTo: 60 }); },
    fanfare: () => {
      [523, 659, 784, 1047].forEach((f, i) => beep({ freq: f, duration: 0.18, type: "square", start: i * 0.12, gain: 0.1 }));
    },
    vip: () => { beep({ freq: 900, duration: 0.15, type: "sine", gain: 0.1 }); beep({ freq: 1200, duration: 0.15, type: "sine", start: 0.1, gain: 0.08 }); },
  };

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    muteBtn.textContent = muted ? "🔇" : "🔊";
  });

  const BEST_KEY = "ngsbdk_best_score";
  const getBest = () => Number(localStorage.getItem(BEST_KEY) || 0);
  const setBest = (v) => localStorage.setItem(BEST_KEY, String(v));

  const NICK_KEY = "ngsbdk_nick";
  const getNick = () => localStorage.getItem(NICK_KEY) || "";
  const setNick = (v) => localStorage.setItem(NICK_KEY, v);

  const LEADERBOARD_KEY = "ngsbdk_leaderboard";
  const LEADERBOARD_SIZE = 5;
  function getLeaderboard() {
    try {
      const raw = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }
  function addToLeaderboard(nick, score) {
    const list = getLeaderboard();
    list.push({ nick, score });
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, LEADERBOARD_SIZE);
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(trimmed));
    return trimmed;
  }
  function renderLeaderboard(el, { highlightScore = null, highlightNick = null } = {}) {
    if (!el) return;
    const list = getLeaderboard();
    if (!list.length) {
      el.innerHTML = "";
      return;
    }
    let usedHighlight = false;
    const rows = list.map((entry, i) => {
      const isHot = !usedHighlight && highlightScore != null && entry.score === highlightScore && entry.nick === highlightNick;
      if (isHot) usedHighlight = true;
      return `<li class="${isHot ? "hot" : ""}"><span class="rank">${i + 1}.</span><span class="lb-nick">${escapeHtml(entry.nick)}</span><span class="lb-score">${entry.score}</span></li>`;
    }).join("");
    el.innerHTML = `<div class="lb-title">🏅 Top ${LEADERBOARD_SIZE}</div><ol>${rows}</ol>`;
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function spawnIntervalFor(level) {
    return Math.max(600, 3000 - (level - 1) * 260);
  }

  function aggroChanceFor(level) {
    return Math.min(0.55, Math.max(0, (level - 2) * 0.13));
  }

  class Game {
    constructor() {
      this.slotCount = 5 + Math.floor(Math.random() * 5);
      this.slots = [];
      this.playerIndex = Math.floor(this.slotCount / 2);
      this.score = 0;
      this.level = 1;
      this.running = false;
      this.elapsed = 0;
      this.lastTs = 0;
      this.spawnTimer = null;
      this.spawnCount = 0;
      this.rushUntil = 0;
      this.raf = null;
      this.dodgesSinceLevel = 0;
      this.dodgesPerLevel = 6;
      this.maxSlots = 14;
      this.buildRow();
    }

    buildRow() {
      rowEl.innerHTML = "";
      this.slots = [];
      for (let i = 0; i < this.slotCount; i++) {
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.dataset.index = String(i);
        const urinal = document.createElement("div");
        urinal.className = "urinal";
        slot.appendChild(urinal);
        rowEl.appendChild(slot);
        this.slots.push({ el: slot, occupant: null, blocked: null });
      }
    }

    slotEl(i) { return this.slots[i].el; }

    makeAvatar({ isPlayer = false, isVip = false } = {}) {
      const avatar = document.createElement("div");
      avatar.className = "avatar" + (isPlayer ? " player" : "") + (isVip ? " vip" : "");
      const head = document.createElement("div");
      head.className = "head";
      const body = document.createElement("div");
      body.className = "body";
      if (!isPlayer && !isVip) {
        const c = NPC_COLORS[Math.floor(Math.random() * NPC_COLORS.length)];
        head.style.background = c.head;
        body.style.background = c.body;
      }
      avatar.appendChild(head);
      avatar.appendChild(body);
      if (isPlayer) {
        const label = document.createElement("div");
        label.className = "label";
        label.textContent = "TY";
        avatar.appendChild(label);
      }
      if (!isPlayer && Math.random() < 0.35) head.classList.add("looking");
      if (!isPlayer && !isVip && Math.random() < 0.25) {
        const phone = document.createElement("div");
        phone.className = "phone";
        avatar.appendChild(phone);
      }
      return avatar;
    }

    start() {
      this.running = true;
      titleScreen.classList.add("hidden");
      gameoverScreen.classList.add("hidden");
      this.buildRow();
      this.score = 0;
      this.level = 1;
      this.elapsed = 0;
      this.dodgesSinceLevel = 0;
      this.playerIndex = Math.floor(this.slotCount / 2);
      this.nick = (nickInput.value || "").trim().slice(0, 16) || "Bukovski";
      nickInput.value = this.nick;
      setNick(this.nick);
      hudBest.textContent = String(getBest());

      const playerAvatar = this.makeAvatar({ isPlayer: true });
      this.slots[this.playerIndex].occupant = { el: playerAvatar, isPlayer: true };
      this.slotEl(this.playerIndex).appendChild(playerAvatar);
      this.playerAvatar = playerAvatar;

      this.updateHud();
      this.lastTs = performance.now();
      this.tick();
      this.scheduleSpawn(1600);
      this.scheduleEvents();
    }

    updateHud() {
      hudScore.textContent = String(Math.floor(this.score));
      hudLevel.textContent = String(this.level);
    }

    tick() {
      if (!this.running) return;
      const now = performance.now();
      const dt = (now - this.lastTs) / 1000;
      this.lastTs = now;
      this.elapsed += dt;
      this.score += dt;
      this.updateHud();
      this.raf = requestAnimationFrame(() => this.tick());
    }

    scheduleSpawn(overrideMs) {
      if (!this.running) return;
      const base = spawnIntervalFor(this.level);
      const rushed = performance.now() < this.rushUntil ? base * 0.45 : base;
      const jitter = rushed * (0.8 + Math.random() * 0.4);
      const delay = overrideMs != null ? overrideMs : jitter;
      this.spawnTimer = setTimeout(() => {
        this.spawnNpc();
        this.scheduleSpawn();
      }, delay);
    }

    scheduleEvents() {
      if (!this.running) return;
      const delay = 9000 + Math.random() * 9000;
      setTimeout(() => {
        if (!this.running) return;
        this.triggerRandomEvent();
        this.scheduleEvents();
      }, delay);
    }

    triggerRandomEvent() {
      const roll = Math.random();
      if (roll < 0.35) this.eventAwaria();
      else if (roll < 0.6) this.eventSprzataczka();
      else this.eventTlum();
    }

    freeSlotIndices() {
      const out = [];
      this.slots.forEach((s, i) => { if (!s.occupant && !s.blocked) out.push(i); });
      return out;
    }

    showBanner(text, ms = 2200) {
      eventBanner.textContent = text;
      eventBanner.classList.remove("hidden");
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => eventBanner.classList.add("hidden"), ms);
    }

    eventAwaria() {
      const free = this.freeSlotIndices();
      if (!free.length) return;
      const i = free[Math.floor(Math.random() * free.length)];
      const slot = this.slots[i];
      slot.blocked = EVENTS.AWARIA;
      slot.el.classList.add("blocked");
      const tape = document.createElement("div");
      tape.className = "tape";
      tape.dataset.role = "blocker";
      slot.el.appendChild(tape);
      this.showBanner("🚧 Awaria! Jeden pisuar nieczynny.");
      setTimeout(() => this.clearBlock(i, EVENTS.AWARIA), 6000 + Math.random() * 3000);
    }

    eventSprzataczka() {
      const free = this.freeSlotIndices();
      if (!free.length) return;
      const i = free[Math.floor(Math.random() * free.length)];
      const slot = this.slots[i];
      slot.blocked = EVENTS.SPRZATACZ;
      slot.el.classList.add("blocked");
      const icon = document.createElement("div");
      icon.className = "cleaner-icon";
      icon.dataset.role = "blocker";
      icon.textContent = "🧹";
      slot.el.appendChild(icon);
      this.showBanner("🧹 Sprzątacz sprząta pisuar...");
      setTimeout(() => this.clearBlock(i, EVENTS.SPRZATACZ), 4000 + Math.random() * 2500);
    }

    clearBlock(i, type) {
      const slot = this.slots[i];
      if (slot.blocked !== type) return;
      slot.blocked = null;
      slot.el.classList.remove("blocked");
      const blocker = slot.el.querySelector('[data-role="blocker"]');
      if (blocker) blocker.remove();
    }

    eventTlum() {
      this.rushUntil = performance.now() + 7000;
      this.showBanner("🏉 Tłum po meczu! Trzymaj się!");
    }

    spawnNpc(forceVip = false) {
      if (!this.running) return;
      let free = this.freeSlotIndices();
      if (!free.length) return;
      this.spawnCount++;

      const isVip = forceVip || (this.level >= 3 && Math.random() < 0.12);
      let targetIndex;
      const adjacent = [this.playerIndex - 1, this.playerIndex + 1].filter((i) => free.includes(i));

      if (this.spawnCount <= 2) {
        const safe = free.filter((i) => !adjacent.includes(i));
        if (safe.length) free = safe;
        targetIndex = free[Math.floor(Math.random() * free.length)];
      } else {
        const chance = aggroChanceFor(this.level) + (isVip ? 0.3 : 0);
        if (adjacent.length && Math.random() < chance) {
          targetIndex = adjacent[Math.floor(Math.random() * adjacent.length)];
        } else {
          targetIndex = free[Math.floor(Math.random() * free.length)];
        }
      }

      const avatar = this.makeAvatar({ isVip });
      avatar.classList.add("entering");
      document.getElementById("app").appendChild(avatar);
      const doorRect = doorEl.getBoundingClientRect();
      avatar.style.position = "fixed";
      avatar.style.left = `${doorRect.left + doorRect.width / 2 - 27}px`;
      avatar.style.top = `${doorRect.top + doorRect.height}px`;
      avatar.style.transform = "translate(0,0)";
      avatar.style.zIndex = "60";

      sfx.door();
      if (isVip) sfx.vip(); else if (Math.random() < 0.4) sfx.honk();

      const targetSlotEl = this.slotEl(targetIndex);
      const walkMs = isVip ? 260 : 500 + Math.random() * 220;

      requestAnimationFrame(() => {
        const targetRect = targetSlotEl.getBoundingClientRect();
        avatar.style.transition = `left ${walkMs}ms ease-in-out, top ${walkMs}ms ease-in-out`;
        avatar.style.left = `${targetRect.left + targetRect.width / 2 - 27}px`;
        avatar.style.top = `${targetRect.bottom - 60}px`;
      });

      const footstepInt = setInterval(() => sfx.footstep(), 110);

      setTimeout(() => {
        clearInterval(footstepInt);
        avatar.style.position = "absolute";
        avatar.style.left = "50%";
        avatar.style.top = "auto";
        avatar.style.transition = "none";
        avatar.style.transform = "translate(-50%, 0)";
        avatar.classList.remove("entering");
        targetSlotEl.appendChild(avatar);

        this.slots[targetIndex].occupant = { el: avatar, isPlayer: false };
        this.score += 10;
        this.updateHud();

        if (this.isAdjacentToPlayer(targetIndex)) {
          this.gameOver();
        } else {
          this.registerDodge();
        }
      }, walkMs + 40);
    }

    isAdjacentToPlayer(index) {
      return Math.abs(index - this.playerIndex) === 1;
    }

    registerDodge() {
      this.dodgesSinceLevel++;
      if (this.dodgesSinceLevel >= this.dodgesPerLevel) {
        this.dodgesSinceLevel = 0;
        this.levelUp();
      }
    }

    levelUp() {
      this.level++;
      this.updateHud();
      if (this.slotCount < this.maxSlots) this.addUrinal();
      this.showBanner(`⬆️ Poziom ${this.level}! Łazienka się rozrasta.`);
    }

    addUrinal() {
      const slot = document.createElement("div");
      slot.className = "slot slot-new";
      slot.dataset.index = String(this.slotCount);
      const urinal = document.createElement("div");
      urinal.className = "urinal";
      slot.appendChild(urinal);
      rowEl.appendChild(slot);
      this.slots.push({ el: slot, occupant: null, blocked: null });
      this.slotCount++;
    }

    movePlayer(dir) {
      if (!this.running) return;
      const target = this.playerIndex + dir;
      if (target < 0 || target >= this.slotCount) return;
      const slot = this.slots[target];
      if (slot.occupant || slot.blocked) return;

      const fromEl = this.slotEl(this.playerIndex);
      const first = this.playerAvatar.getBoundingClientRect();

      this.slots[this.playerIndex].occupant = null;
      const toEl = this.slotEl(target);
      toEl.appendChild(this.playerAvatar);
      this.playerIndex = target;
      this.slots[target].occupant = { el: this.playerAvatar, isPlayer: true };

      const last = this.playerAvatar.getBoundingClientRect();
      const dx = first.left - last.left;
      this.playerAvatar.style.transition = "none";
      this.playerAvatar.style.transform = `translate(calc(-50% + ${dx}px), 0)`;
      this.playerAvatar.getBoundingClientRect();
      requestAnimationFrame(() => {
        this.playerAvatar.style.transition = "transform 150ms cubic-bezier(.2,.8,.3,1.4)";
        this.playerAvatar.style.transform = "translate(-50%, 0)";
      });
      sfx.slide();
      this.checkAdjacencyAfterMove();
    }

    checkAdjacencyAfterMove() {
      const left = this.slots[this.playerIndex - 1];
      const right = this.slots[this.playerIndex + 1];
      if ((left && left.occupant) || (right && right.occupant)) {
        this.gameOver();
      }
    }

    gameOver() {
      if (!this.running) return;
      this.running = false;
      clearTimeout(this.spawnTimer);
      cancelAnimationFrame(this.raf);
      sfx.gameover();

      const finalScore = Math.floor(this.score);
      const best = getBest();
      const isNewBest = finalScore > best;
      if (isNewBest) {
        setBest(finalScore);
        setTimeout(() => sfx.fanfare(), 400);
      }

      goMessage.textContent = GAMEOVER_MESSAGES[Math.floor(Math.random() * GAMEOVER_MESSAGES.length)];
      goScore.textContent = String(finalScore);
      goBest.classList.toggle("hidden", !isNewBest);
      hudBest.textContent = String(getBest());

      addToLeaderboard(this.nick, finalScore);
      renderLeaderboard(goLeaderboard, { highlightScore: finalScore, highlightNick: this.nick });

      setTimeout(() => gameoverScreen.classList.remove("hidden"), 350);
    }
  }

  let game = null;

  function startGame() {
    ensureAudio();
    game = new Game();
    game.start();
  }

  $("#start-btn").addEventListener("click", startGame);
  $("#retry-btn").addEventListener("click", startGame);

  window.addEventListener("keydown", (e) => {
    if (!game || !game.running) return;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") game.movePlayer(-1);
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") game.movePlayer(1);
  });

  $("#btn-left").addEventListener("click", () => game && game.movePlayer(-1));
  $("#btn-right").addEventListener("click", () => game && game.movePlayer(1));

  hudBest.textContent = String(getBest());
  nickInput.value = getNick();
  renderLeaderboard(titleLeaderboard);
})();
