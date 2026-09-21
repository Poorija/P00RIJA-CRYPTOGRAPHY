/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* P00RIJA Games — the About-logo easter egg.
 *
 * Eleven taps on the shield in the About tab open a small arcade: ten games,
 * each self-contained, each playable with touch (phone) and with mouse and
 * keyboard (desktop). Nothing here touches the crypto, the chat state or the
 * vault; the only thing stored is each game's best score, under its own
 * localStorage key. The whole module is inert until the eleventh tap.
 *
 * Every game gets a container and returns a cleanup function; the shell calls
 * it on Back, so timers, animation frames and listeners always come down.
 */
(() => {
  'use strict';

  const gT = (fa, en) => ((document.documentElement.lang || 'fa').toLowerCase().startsWith('fa') ? fa : en);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
  const bestScore = (key) => {
    try { return Number(localStorage.getItem(`poorija_game_${key}`)) || 0; } catch (_e) { return 0; }
  };
  /* ---- the leaderboard ------------------------------------------------
     One board per game, ten rows, the player's chosen name beside each score.
     Stored on this device only — the arcade never talks to the network. */
  const boardKey = (gameId) => `poorija_games_board_${gameId}`;
  const readBoard = (gameId) => {
    try { return JSON.parse(localStorage.getItem(boardKey(gameId)) || '[]') || []; } catch (_e) { return []; }
  };
  const writeBoard = (gameId, entries) => {
    try { localStorage.setItem(boardKey(gameId), JSON.stringify(entries.slice(0, 10))); } catch (_e) { /* private mode */ }
  };
  const playerName = () => {
    const field = document.getElementById('gamesPlayerName');
    const name = String(field?.value || '').trim();
    if (name) return name.slice(0, 24);
    try { return String(localStorage.getItem('poorija_games_player') || '').trim().slice(0, 24); } catch (_e) { return ''; }
  };
  const recordBoardEntry = (gameId, value, { higherWins = true } = {}) => {
    const entries = readBoard(gameId);
    entries.push({ name: playerName() || gT('بازیکن', 'Player'), value: Math.round(value), at: Date.now() });
    entries.sort((a, b) => (higherWins ? b.value - a.value : a.value - b.value));
    writeBoard(gameId, entries);
    return entries.findIndex((entry) => entry.at && entry.value === Math.round(value) && entry.name === (playerName() || gT('بازیکن', 'Player')));
  };
  const renderBoard = () => {
    const panel = $('[data-games-board-panel]');
    if (!panel || !activeGame) return;
    const entries = readBoard(activeGame.id);
    const mine = playerName();
    panel.innerHTML = entries.length ? `
      <div class="games-board-row games-board-head"><span>#</span><span>${esc(gT('نام', 'Name'))}</span><span>${esc(gT('امتیاز', 'Score'))}</span><span></span></div>
      ${entries.map((entry, index) => `
        <div class="games-board-row ${entry.name === mine ? 'is-mine' : ''}">
          <span>${index + 1}</span>
          <span>${esc(entry.name)}</span>
          <span>${esc(String(entry.value))}</span>
          <span>${esc(new Date(entry.at).toLocaleDateString())}</span>
        </div>`).join('')}`
      : `<div class="games-board-empty">${esc(gT('هنوز رکوردی ثبت نشده — اولین باش!', 'No records yet — be the first!'))}</div>`;
  };
  function toggleBoard() {
    const panel = $('[data-games-board-panel]');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderBoard();
  }
  const saveBest = (key, value, { higherWins = true } = {}) => {
    const current = bestScore(key);
    const better = higherWins ? value > current : (current === 0 || value < current);
    if (!better) return current;
    try { localStorage.setItem(`poorija_game_${key}`, String(value)); } catch (_e) { /* private mode */ }
    return value;
  };
  const vibrate = (ms) => { try { navigator.vibrate?.(ms); } catch (_e) { /* not supported */ } };
  const raf = (cb) => window.requestAnimationFrame(cb);

  /* ---------- the shell ------------------------------------------------ */
  const screenHtml = () => `
    <div class="games-backdrop" data-games-close></div>
    <section class="games-shell" role="dialog" aria-modal="true" aria-label="${esc(gT('بازی‌های پنهان', 'Hidden games'))}">
      <header class="games-head">
        <button type="button" class="games-btn games-back" data-games-back><i class="fas fa-arrow-right"></i><span>${esc(gT('بازگشت', 'Back'))}</span></button>
        <div class="games-title"><i class="fas fa-gamepad"></i><span>${esc(gT('اتاق بازی پنهان', 'The hidden arcade'))}</span></div>
        <div class="games-name-wrap">
          <label for="gamesPlayerName">${esc(gT('نام شما', 'Your name'))}</label>
          <input id="gamesPlayerName" type="text" maxlength="24" autocomplete="off" spellcheck="false" placeholder="${esc(gT('بازیکن', 'Player'))}">
        </div>
        <button type="button" class="games-btn" data-games-close-x><i class="fas fa-xmark"></i></button>
      </header>
      <div class="games-body">
        <div class="games-grid" data-games-grid></div>
        <div class="games-stage hidden" data-games-stage>
          <div class="games-stage-head">
            <button type="button" class="games-btn" data-games-exit><i class="fas fa-arrow-right"></i><span>${esc(gT('فهرست بازی‌ها', 'All games'))}</span></button>
            <div class="games-stage-name" data-games-name></div>
            <button type="button" class="games-btn" data-games-board><i class="fas fa-trophy"></i><span>${esc(gT('رکوردها', 'Records'))}</span></button>
            <button type="button" class="games-btn" data-games-restart><i class="fas fa-rotate"></i><span>${esc(gT('دوباره', 'Restart'))}</span></button>
          </div>
          <div class="games-score-row"><span data-games-score></span><span data-games-best></span></div>
          <div class="games-board hidden" data-games-board-panel></div>
          <div class="games-canvas-holder" data-games-holder></div>
          <div class="games-hint" data-games-hint></div>
        </div>
      </div>
    </section>`;

  const GAMES = [];
  const registerGame = (game) => GAMES.push(game);

  let shell = null;
  let activeCleanup = null;
  let activeGame = null;
  const $ = (sel) => shell?.querySelector(sel);

  function openGames() {
    if (shell) { shell.classList.remove('hidden'); return; }
    shell = document.createElement('div');
    shell.id = 'gamesScreen';
    shell.className = 'games-root hidden';
    shell.innerHTML = screenHtml();
    document.body.appendChild(shell);
    const grid = $('[data-games-grid]');
    GAMES.forEach((game, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'games-card';
      card.dataset.gameId = game.id;
      card.style.setProperty('--i', String(index));
      card.innerHTML = `
        <span class="games-card-icon"><i class="fas ${esc(game.icon)}"></i></span>
        <span class="games-card-name">${esc(gT(game.fa, game.en))}</span>
        <span class="games-card-best" data-best-for="${esc(game.id)}"></span>`;
      card.addEventListener('click', () => launchGame(game));
      grid.appendChild(card);
    });
    /* The name the leaderboard will remember. Kept on the device only. */
    const nameInput = $('#gamesPlayerName');
    try { nameInput.value = localStorage.getItem('poorija_games_player') || ''; } catch (_e) { /* private mode */ }
    nameInput?.addEventListener('change', () => {
      try { localStorage.setItem('poorija_games_player', nameInput.value.trim().slice(0, 24)); } catch (_e) { /* ignore */ }
    });
    shell.addEventListener('click', (event) => {
      if (event.target.closest('[data-games-close],[data-games-close-x]')) closeGames();
      /* The stage's "All games" button can only mean the grid. The header's
         Back is one step back: out of a running game to the grid, and from
         the grid itself out of the arcade — back on the About page the egg
         opened it from. Sitting dead on the main menu is what it did before. */
      if (event.target.closest('[data-games-exit]')) exitToGrid();
      else if (event.target.closest('[data-games-back]')) {
        if (activeGame) exitToGrid();
        else closeGames();
      }
      if (event.target.closest('[data-games-restart]') && activeGame) launchGame(activeGame);
      if (event.target.closest('[data-games-board]')) toggleBoard();
    });
    document.addEventListener('keydown', onShellKey, true);
    refreshBestLabels();
    shell.classList.remove('hidden');
  }
  function onShellKey(event) {
    if (!shell || shell.classList.contains('hidden')) return;
    if (event.key === 'Escape') { exitToGrid(); closeGames(); }
  }
  function closeGames() {
    exitToGrid();
    if (shell) shell.classList.add('hidden');
    document.removeEventListener('keydown', onShellKey, true);
  }
  function exitToGrid() {
    if (activeCleanup) { activeCleanup(); activeCleanup = null; }
    activeGame = null;
    $('[data-games-grid]')?.classList.remove('hidden');
    $('[data-games-stage]')?.classList.add('hidden');
  }
  function refreshBestLabels() {
    shell?.querySelectorAll('[data-best-for]').forEach((el) => {
      const value = bestScore(el.dataset.bestFor);
      el.textContent = value ? `${gT('رکورد', 'Best')}: ${value}` : '';
    });
  }
  function launchGame(game) {
    exitToGrid();
    activeGame = game;
    $('[data-games-grid]')?.classList.add('hidden');
    const stage = $('[data-games-stage]');
    stage?.classList.remove('hidden');
    $('[data-games-name]').textContent = gT(game.fa, game.en);
    $('[data-games-hint]').textContent = gT(game.hintFa || '', game.hintEn || '');
    $('[data-games-board-panel]')?.classList.add('hidden');
    const holder = $('[data-games-holder]');
    holder.innerHTML = '';
    setScore(0);
    setBest(bestScore(game.id));
    activeCleanup = game.launch(holder, {
      score: (value) => setScore(value),
      best: (value, opts) => {
        const saved = saveBest(game.id, value, opts);
        /* A personal best is also a leaderboard entry, under the name the
        player chose; anything less never touches the board. */
        if (saved === Math.round(value) && value > 0) recordBoardEntry(game.id, value, opts);
        setBest(saved);
        refreshBestLabels();
        return saved;
      },
      over: (message) => gameOverlay(message),
    }) || (() => {});
  }
  function setScore(value) { const el = $('[data-games-score]'); if (el) el.textContent = value ? `${gT('امتیاز', 'Score')}: ${value}` : ''; }
  function setBest(value) { const el = $('[data-games-best]'); if (el) el.textContent = value ? `${gT('رکورد', 'Best')}: ${value}` : ''; }
  function gameOverlay(message) {
    const holder = $('[data-games-holder]');
    if (!holder) return;
    /* Idempotent: a game whose loop keeps running after death used to spawn a
    fresh overlay every frame and freeze the page under DOM churn. The first
    overlay stays; the restart button on it is the way forward. */
    if (holder.querySelector('.games-over')) return;
    const over = document.createElement('div');
    over.className = 'games-over';
    over.innerHTML = `<span>${esc(message)}</span><button type="button" class="games-btn games-btn-primary" data-games-again>${esc(gT('یک‌بار دیگر', 'Play again'))}</button>`;
    over.querySelector('[data-games-again]').addEventListener('click', () => { if (activeGame) launchGame(activeGame); });
    holder.appendChild(over);
    vibrate(24);
  }

  /* ---------- shared helpers ------------------------------------------- */
  function makeCanvas(holder, aspect = 1) {
    const wrap = document.createElement('div');
    wrap.className = 'games-canvas-wrap';
    const canvas = document.createElement('canvas');
    /* The arcade fills the window now, so boards can be generous — capped so
    a wide desktop does not draw a board bigger than a hand can traverse. */
    const size = Math.min(Math.max(holder.clientWidth || 480, 360), 720);
    canvas.width = Math.round(size * (aspect >= 1 ? 1 : aspect));
    canvas.height = Math.round(canvas.width * (aspect >= 1 ? aspect : 1));
    wrap.appendChild(canvas);
    holder.appendChild(wrap);
    return canvas;
  }
  const ctx2d = (canvas) => canvas.getContext('2d');
  function loopWithCleanup(step) {
    let alive = true;
    let last = performance.now();
    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(64, now - last);
      last = now;
      step(dt, now);
      raf(tick);
    };
    raf(tick);
    const onHidden = () => { last = performance.now(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => { alive = false; document.removeEventListener('visibilitychange', onHidden); };
  }
  function onKeys(handlers) {
    const listener = (event) => {
      const fn = handlers[event.key];
      if (fn) { event.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', listener, { passive: false });
    return () => window.removeEventListener('keydown', listener);
  }
  function onSwipe(el, handlers) {
    let sx = 0; let sy = 0; let active = false;
    const start = (event) => {
      const touch = event.touches?.[0] || event;
      sx = touch.clientX; sy = touch.clientY; active = true;
    };
    const end = (event) => {
      if (!active) return;
      active = false;
      const touch = event.changedTouches?.[0] || event;
      const dx = touch.clientX - sx;
      const dy = touch.clientY - sy;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { handlers.tap?.(); return; }
      if (Math.abs(dx) > Math.abs(dy)) (dx > 0 ? handlers.right : handlers.left)?.();
      else (dy > 0 ? handlers.down : handlers.up)?.();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchend', end);
      el.removeEventListener('mousedown', start);
      el.removeEventListener('mouseup', end);
    };
  }
  function beep(freq = 440, ms = 90, type = 'square', gainValue = 0.04) {
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      gamesBeepCtx = gamesBeepCtx || new AudioCtor();
      const ctx = gamesBeepCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.value = gainValue;
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + ms / 1000);
    } catch (_e) { /* audio is a bonus, never a requirement */ }
  }
  let gamesBeepCtx = null;

  /* ---------- 1. Snake -------------------------------------------------- */
  registerGame({
    id: 'snake', fa: 'مار', en: 'Snake', icon: 'fa-worm',
    hintFa: 'کلیدهای جهت یا کشیدن انگشت — سیب را بخور، به خودت نزن.',
    hintEn: 'Arrow keys or swipe — eat the apples, avoid yourself.',
    launch(holder, api) {
      const canvas = makeCanvas(holder, 1);
      const ctx = ctx2d(canvas);
      const cells = 17;
      const cell = canvas.width / cells;
      let snake = [{ x: 8, y: 8 }];
      let dir = { x: 1, y: 0 };
      let pending = dir;
      let food = { x: 4, y: 4 };
      let score = 0;
      let speed = 130;
      let acc = 0;
      let stopLoop = () => {};
      const placeFood = () => {
        do { food = { x: Math.floor(Math.random() * cells), y: Math.floor(Math.random() * cells) }; }
        while (snake.some((s) => s.x === food.x && s.y === food.y));
      };
      const draw = (now = performance.now()) => {
        ctx.fillStyle = '#0a1122';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        /* Faint grid so the board reads as a board, not a void. */
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
        ctx.lineWidth = 1;
        for (let i = 1; i < cells; i += 1) {
          ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, canvas.height); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(canvas.width, i * cell); ctx.stroke();
        }
        /* The apple breathes. */
        const pulse = 1 + Math.sin(now / 220) * 0.14;
        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.arc((food.x + 0.5) * cell, (food.y + 0.5) * cell, cell * 0.36 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fca5a5';
        ctx.lineWidth = 2;
        ctx.stroke();
        snake.forEach((part, index) => {
          const inset = index === 0 ? 0.5 : 1.5;
          ctx.fillStyle = index === 0 ? '#34d399' : `rgba(16, 185, 129, ${Math.max(0.35, 1 - index / (cells * 1.6))})`;
          /* roundRect is absent on older Safari; the square is fine there. */
          const x = part.x * cell + inset;
          const y = part.y * cell + inset;
          const w = cell - inset * 2;
          const h = cell - inset * 2;
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, index === 0 ? 5 : 3);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, w, h);
          }
          if (index === 0) {
            /* Two eyes facing the direction of travel. */
            const ex = dir.x * cell * 0.16;
            const ey = dir.y * cell * 0.16;
            ctx.fillStyle = '#022c22';
            [[-0.18, 0.18], [0.18, -0.18]].forEach(([ox, oy]) => {
              ctx.beginPath();
              ctx.arc(part.x * cell + cell / 2 + ex + (dir.x ? 0 : ox * cell), part.y * cell + cell / 2 + ey + (dir.y ? 0 : oy * -cell), cell * 0.07, 0, Math.PI * 2);
              ctx.fill();
            });
          }
        });
      };
      const step = () => {
        dir = pending;
        const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
        if (head.x < 0 || head.y < 0 || head.x >= cells || head.y >= cells
          || snake.some((s) => s.x === head.x && s.y === head.y)) {
          beep(120, 220, 'sawtooth');
          stopLoop();
          api.best(score);
          api.over(`${gT('مار طول', 'Snake length')}: ${snake.length} · ${gT('امتیاز', 'score')}: ${score}`);
          return;
        }
        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) {
          score += 10; api.score(score);
          speed = Math.max(60, speed - 3);
          beep(660, 70);
          placeFood();
        } else snake.pop();
      };
      stopLoop = loopWithCleanup((dt, now) => {
        acc += dt;
        if (acc >= speed) { acc = 0; step(); }
        draw(now);
      });
      const turn = (x, y) => { if (x === -dir.x && y === -dir.y) return; pending = { x, y }; };
      const offKeys = onKeys({
        ArrowUp: () => turn(0, -1), ArrowDown: () => turn(0, 1), ArrowLeft: () => turn(-1, 0), ArrowRight: () => turn(1, 0),
      });
      const offSwipe = onSwipe(canvas, {
        up: () => turn(0, -1), down: () => turn(0, 1), left: () => turn(-1, 0), right: () => turn(1, 0),
      });
      return () => { stopLoop(); offKeys(); offSwipe(); };
    },
  });

  /* ---------- 2. 2048 --------------------------------------------------- */
  registerGame({
    id: 'g2048', fa: '۲۰۴۸', en: '2048', icon: 'fa-table-cells',
    hintFa: 'کلیدهای جهت یا کشیدن انگشت — خانه‌های هم‌ارزش را ادغام کن.',
    hintEn: 'Arrow keys or swipe — merge equal tiles.',
    launch(holder, api) {
      const wrap = document.createElement('div');
      wrap.className = 'games-2048';
      const grid = Array.from({ length: 4 }, () => Array(4).fill(0));
      let score = 0;
      const colors = { 2: '#7dd3fc', 4: '#38bdf8', 8: '#818cf8', 16: '#a78bfa', 32: '#c084fc', 64: '#e879f9', 128: '#fb7185', 256: '#f97316', 512: '#facc15', 1024: '#4ade80', 2048: '#f472b6' };
      let previous = Array.from({ length: 4 }, () => Array(4).fill(0));
      const render = () => {
        wrap.innerHTML = '';
        for (let r = 0; r < 4; r += 1) {
          for (let c = 0; c < 4; c += 1) {
            const cell = document.createElement('div');
            const value = grid[r][c];
            cell.className = `games-2048-cell ${value ? 'is-set' : ''}`;
            if (value) {
              cell.textContent = value;
              cell.style.background = colors[value] || '#f472b6';
              if (value > 512) cell.style.fontSize = '1.05rem';
              /* Only what changed this move pops — a whole-board pulse on
              every keystroke reads as noise, not feedback. */
              if (value !== previous[r][c]) cell.classList.add('is-pop');
            }
            wrap.appendChild(cell);
          }
        }
        previous = grid.map((row) => [...row]);
      };
      const addTile = () => {
        const free = [];
        for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) if (!grid[r][c]) free.push([r, c]);
        if (!free.length) return;
        const [r, c] = free[Math.floor(Math.random() * free.length)];
        grid[r][c] = Math.random() < 0.9 ? 2 : 4;
      };
      /* One accessor pair per direction: read a line, write a line — collapse
         and merge happen on the array, then it goes back the same way it came,
         which is what makes "left" and "right" (or "up"/"down") share logic. */
      const buildAccessors = (mode) => {
        if (mode === 'left') {
          return [
            (line) => [grid[line][0], grid[line][1], grid[line][2], grid[line][3]],
            (line, i, v) => { grid[line][i] = v; },
          ];
        } if (mode === 'right') {
          return [
            (line) => [grid[line][3], grid[line][2], grid[line][1], grid[line][0]],
            (line, i, v) => { grid[line][3 - i] = v; },
          ];
        } if (mode === 'up') {
          return [
            (line) => [grid[0][line], grid[1][line], grid[2][line], grid[3][line]],
            (line, i, v) => { grid[i][line] = v; },
          ];
        }
        return [
          (line) => [grid[3][line], grid[2][line], grid[1][line], grid[0][line]],
          (line, i, v) => { grid[3 - i][line] = v; },
        ];
      };
      const move = (mode) => {
        const [getter, setter] = buildAccessors(mode);
        let moved = false;
        for (let line = 0; line < 4; line += 1) {
          let values = getter(line).filter(Boolean);
          for (let i = 0; i < values.length - 1; i += 1) {
            if (values[i] === values[i + 1]) {
              values[i] *= 2; score += values[i]; api.score(score);
              values.splice(i + 1, 1);
              beep(280 + values[i], 45, 'triangle');
            }
          }
          while (values.length < 4) values.push(0);
          const before = JSON.stringify(getter(line));
          for (let i = 0; i < 4; i += 1) setter(line, i, values[i]);
          if (JSON.stringify(getter(line)) !== before) moved = true;
        }
        if (moved) { addTile(); render(); checkEnd(); }
      };
      const checkEnd = () => {
        const full = grid.every((row) => row.every(Boolean));
        if (!full) return;
        for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) {
          if (c < 3 && grid[r][c] === grid[r][c + 1]) return;
          if (r < 3 && grid[r][c] === grid[r + 1][c]) return;
        }
        api.best(score);
        api.over(`${gT('امتیاز', 'Score')}: ${score}`);
      };
      addTile(); addTile(); render();
      holder.appendChild(wrap);
      const offKeys = onKeys({
        ArrowLeft: () => move('left'), ArrowRight: () => move('right'), ArrowUp: () => move('up'), ArrowDown: () => move('down'),
      });
      const offSwipe = onSwipe(wrap, {
        left: () => move('left'), right: () => move('right'), up: () => move('up'), down: () => move('down'),
      });
      return () => { offKeys(); offSwipe(); };
    },
  });

  /* ---------- 3. Memory -------------------------------------------------- */
  registerGame({
    id: 'memory', fa: 'جفت‌یابی', en: 'Memory pairs', icon: 'fa-clone',
    hintFa: 'کارتی را برگردان و جفتش را پیدا کن.',
    hintEn: 'Flip a card and find its pair.',
    launch(holder, api) {
      const icons = ['🚀', '🔐', '🌟', '🎲', '🎧', '🍀', '⚡', '🧩'];
      const deck = [...icons, ...icons].map((icon, index) => ({ icon, id: index }))
        .sort(() => Math.random() - 0.5);
      const wrap = document.createElement('div');
      wrap.className = 'games-memory';
      let open = [];
      let matched = 0;
      let moves = 0;
      let lock = false;
      deck.forEach((card, index) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'games-memory-card';
        el.dataset.index = index;
        el.setAttribute('aria-label', gT('کارت', 'Card'));
        el.addEventListener('click', () => {
          if (lock || el.classList.contains('is-open') || el.classList.contains('is-done')) return;
          el.classList.add('is-open');
          el.textContent = card.icon;
          open.push({ el, icon: card.icon });
          beep(520, 40, 'sine');
          if (open.length === 2) {
            moves += 1; api.score(moves);
            lock = true;
            const [a, b] = open;
            if (a.icon === b.icon) {
              setTimeout(() => {
                a.el.classList.add('is-done'); b.el.classList.add('is-done');
                open = []; lock = false; matched += 1; beep(880, 90, 'sine');
                if (matched === icons.length) {
                  api.best(moves, { higherWins: false });
                  api.over(`${gT('همه جفت‌ها با', 'All pairs in')} ${moves} ${gT('حرکت', 'moves')}`);
                }
              }, 260);
            } else {
              setTimeout(() => {
                a.el.classList.remove('is-open'); b.el.classList.remove('is-open');
                a.el.textContent = ''; b.el.textContent = '';
                open = []; lock = false;
              }, 700);
            }
          }
        });
        wrap.appendChild(el);
      });
      holder.appendChild(wrap);
      return () => {};
    },
  });

  /* ---------- 4. Tic-tac-toe --------------------------------------------- */
  registerGame({
    id: 'tictactoe', fa: 'دوز', en: 'Tic-tac-toe', icon: 'fa-hashtag',
    hintFa: 'تو بازی با هوش مصنوعی — سه‌تایی ردیف کن.',
    hintEn: 'Play the AI — line up three.',
    launch(holder, api) {
      const wrap = document.createElement('div');
      wrap.className = 'games-ttt';
      const board = Array(9).fill('');
      const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
      const winner = (b) => {
        for (const [a, c, d] of lines) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
        return b.every(Boolean) ? 'draw' : '';
      };
      const minimax = (b, me) => {
        const w = winner(b);
        if (w === 'O') return { score: 1 };
        if (w === 'X') return { score: -1 };
        if (w === 'draw') return { score: 0 };
        const movesList = [];
        for (let i = 0; i < 9; i += 1) {
          if (b[i]) continue;
          b[i] = me;
          const result = minimax(b, me === 'O' ? 'X' : 'O').score;
          b[i] = '';
          movesList.push({ index: i, score: result });
        }
        return me === 'O'
          ? movesList.reduce((bestM, m) => (m.score > bestM.score ? m : bestM))
          : movesList.reduce((bestM, m) => (m.score < bestM.score ? m : bestM));
      };
      let wins = 0;
      const render = () => {
        wrap.innerHTML = '';
        board.forEach((value, index) => {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = `games-ttt-cell ${value === 'X' ? 'is-x' : ''} ${value === 'O' ? 'is-o' : ''}`;
          cell.textContent = value;
          cell.disabled = Boolean(value);
          cell.addEventListener('click', () => {
            if (board[index] || winner(board)) return;
            board[index] = 'X';
            beep(600, 50, 'sine');
            render();
            const w1 = winner(board);
            if (w1) return finish(w1);
            const ai = minimax(board.slice(), 'O');
            if (ai && board[ai.index] === '') board[ai.index] = 'O';
            beep(320, 50, 'sine');
            render();
            const w2 = winner(board);
            if (w2) finish(w2);
          });
          wrap.appendChild(cell);
        });
      };
      const finish = (w) => {
        if (w === 'X') { wins += 1; api.score(wins); api.best(wins); api.over(gT('بردی! هوش مصنوعی شکست خورد.', 'You beat the AI!')); }
        else if (w === 'O') api.over(gT('هوش مصنوعی برد.', 'The AI won.'));
        else api.over(gT('مساوی.', 'A draw.'));
      };
      render();
      holder.appendChild(wrap);
      return () => {};
    },
  });

  /* ---------- 5. Breakout ------------------------------------------------ */
  registerGame({
    id: 'breakout', fa: 'آجرشکن', en: 'Breakout', icon: 'fa-table-cells-large',
    hintFa: 'راکت را با موس، لمس یا کلیدهای چپ/راست حرکت بده.',
    hintEn: 'Move the paddle with mouse, touch or arrow keys.',
    launch(holder, api) {
      const canvas = makeCanvas(holder, 1.2);
      const ctx = ctx2d(canvas);
      const W = canvas.width; const H = canvas.height;
      const rows = 5; const cols = 7;
      const pad = W * 0.16; const padH = 12;
      let padX = W / 2;
      const bricks = [];
      const colors = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8'];
      for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) bricks.push({
        x: (c / cols) * W + 4, y: 40 + r * 24, w: W / cols - 8, h: 18, color: colors[r], alive: true,
      });
      const ball = { x: W / 2, y: H - 60, dx: 3, dy: -3.4, r: 7 };
      const trail = [];
      let score = 0;
      let keys = { left: false, right: false };
      let stopLoop = () => {};
      const draw = () => {
        ctx.fillStyle = '#0a1122';
        ctx.fillRect(0, 0, W, H);
        bricks.forEach((b) => {
          if (!b.alive) return;
          ctx.fillStyle = b.color;
          ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(b.x, b.y, b.w, 4);
        });
        /* The paddle reads as the thing you control: a soft glow under it. */
        ctx.save();
        ctx.shadowColor = 'rgba(226,232,240,0.55)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(padX - pad / 2, H - padH - 6, pad, padH);
        ctx.restore();
        /* A fading trail behind the ball. */
        trail.forEach((point, index) => {
          const alpha = (index + 1) / (trail.length + 1) * 0.35;
          ctx.beginPath();
          ctx.arc(point.x, point.y, ball.r * (0.4 + 0.5 * alpha), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(251, 191, 36, ${alpha})`;
          ctx.fill();
        });
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
      };
      const die = (message) => {
        beep(120, 260, 'sawtooth');
        stopLoop();
        api.best(score);
        api.over(message);
      };
      stopLoop = loopWithCleanup((dt) => {
        const steps = dt / 16.7;
        if (keys.left) padX -= 6 * steps;
        if (keys.right) padX += 6 * steps;
        padX = Math.max(pad / 2, Math.min(W - pad / 2, padX));
        ball.x += ball.dx * steps;
        ball.y += ball.dy * steps;
        trail.push({ x: ball.x, y: ball.y });
        if (trail.length > 10) trail.shift();
        if (ball.x < ball.r || ball.x > W - ball.r) { ball.dx *= -1; beep(240, 30); }
        if (ball.y < ball.r) { ball.dy *= -1; beep(240, 30); }
        if (ball.y > H - padH - 6 - ball.r && ball.y < H - 6
          && ball.x > padX - pad / 2 - ball.r && ball.x < padX + pad / 2 + ball.r && ball.dy > 0) {
          ball.dy = -Math.abs(ball.dy);
          ball.dx += ((ball.x - padX) / (pad / 2)) * 1.6;
          ball.dx = Math.max(-6, Math.min(6, ball.dx));
          beep(420, 40);
        }
        bricks.forEach((b) => {
          if (!b.alive) return;
          if (ball.x > b.x - ball.r && ball.x < b.x + b.w + ball.r
            && ball.y > b.y - ball.r && ball.y < b.y + b.h + ball.r) {
            b.alive = false;
            ball.dy *= -1;
            score += 10; api.score(score);
            beep(560 + Math.random() * 200, 45, 'triangle');
          }
        });
        if (bricks.every((b) => !b.alive)) {
          die(`${gT('همه آجرها خرد شد! امتیاز', 'All bricks cleared! Score')}: ${score}`);
          return;
        }
        if (ball.y > H + 20) {
          die(`${gT('توپ افتاد. امتیاز', 'Ball lost. Score')}: ${score}`);
          return;
        }
        draw();
      });
      const move = (clientX) => {
        const rect = canvas.getBoundingClientRect();
        padX = ((clientX - rect.left) / rect.width) * W;
      };
      const onMove = (event) => move(event.touches?.[0]?.clientX ?? event.clientX);
      const offKeys = onKeys({
        ArrowLeft: () => { keys.left = true; },
        ArrowRight: () => { keys.right = true; },
      });
      const keyUp = (event) => {
        if (event.key === 'ArrowLeft') keys.left = false;
        if (event.key === 'ArrowRight') keys.right = false;
      };
      window.addEventListener('keyup', keyUp);
      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('touchmove', (event) => { event.preventDefault(); onMove(event); }, { passive: false });
      draw();
      return () => { stopLoop(); offKeys(); window.removeEventListener('keyup', keyUp); };
    },
  });

  /* ---------- 6. Flappy --------------------------------------------------- */
  registerGame({
    id: 'flappy', fa: 'پرنده', en: 'Flappy', icon: 'fa-dove',
    hintFa: 'ضربه بزن یا Space تا پرنده بالا بماند.',
    hintEn: 'Tap or press Space to stay airborne.',
    launch(holder, api) {
      const canvas = makeCanvas(holder, 1.3);
      const ctx = ctx2d(canvas);
      const W = canvas.width; const H = canvas.height;
      const bird = { x: W * 0.28, y: H / 2, vy: 0, r: 12 };
      let pipes = [];
      const clouds = Array.from({ length: 4 }, (_, i) => ({
        x: Math.random() * W, y: 30 + Math.random() * H * 0.4, r: 18 + Math.random() * 22, speed: 0.25 + i * 0.08,
      }));
      let score = 0;
      let started = false;
      let dead = false;
      const gap = Math.max(120, H * 0.28);
      const spawn = () => pipes.push({
        x: W + 40,
        top: 40 + Math.random() * (H - gap - 120),
        passed: false,
        w: 52,
      });
      const flap = () => {
        if (dead) return;
        started = true;
        bird.vy = -5.4;
        beep(700, 45, 'sine');
      };
      const stopLoop = loopWithCleanup((dt, now) => {
        const steps = dt / 16.7;
        if (started && !dead) {
          bird.vy += 0.32 * steps;
          bird.y += bird.vy * steps;
          pipes.forEach((p) => { p.x -= 2.6 * steps; });
          pipes = pipes.filter((p) => p.x + p.w > -10);
          if (!pipes.length || pipes[pipes.length - 1].x < W - 160) spawn();
          pipes.forEach((p) => {
            if (!p.passed && p.x + p.w < bird.x - bird.r) {
              p.passed = true; score += 1; api.score(score); beep(880, 60, 'sine');
            }
            const hitX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + p.w;
            const hitY = bird.y - bird.r < p.top || bird.y + bird.r > p.top + gap;
            if (hitX && hitY) dead = true;
          });
          if (bird.y + bird.r > H || bird.y - bird.r < 0) dead = true;
          if (dead) {
            beep(120, 280, 'sawtooth');
            api.best(score);
            api.over(`${gT('امتیاز', 'Score')}: ${score}`);
            /* One frame more than needed: the crash is already drawn, the loop
            can come down and take its overlay-spawning cousins with it. */
            window.setTimeout(stopLoop, 0);
            return;
          }
        }
        ctx.fillStyle = '#0a1122';
        ctx.fillRect(0, 0, W, H);
        /* Slow clouds, so the still moment before the first tap moves too. */
        clouds.forEach((cloud) => {
          if (started && !dead) cloud.x -= cloud.speed * steps;
          if (cloud.x < -cloud.r * 2) cloud.x = W + cloud.r * 2;
          ctx.beginPath();
          ctx.arc(cloud.x, cloud.y, cloud.r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(148, 163, 184, 0.09)';
          ctx.fill();
        });
        ctx.fillStyle = '#34d399';
        pipes.forEach((p) => {
          ctx.fillRect(p.x, 0, p.w, p.top);
          ctx.fillRect(p.x, p.top + gap, p.w, H - p.top - gap);
          ctx.fillStyle = 'rgba(2, 6, 23, 0.25)';
          ctx.fillRect(p.x, p.top - 5, p.w, 5);
          ctx.fillRect(p.x, p.top + gap, p.w, 5);
          ctx.fillStyle = '#34d399';
        });
        /* The bird banks into its fall and flaps on the way up. */
        ctx.save();
        ctx.translate(bird.x, bird.y);
        ctx.rotate(Math.max(-0.45, Math.min(1.1, bird.vy / 9)));
        ctx.beginPath();
        ctx.arc(0, 0, bird.r, 0, Math.PI * 2);
        ctx.fillStyle = dead ? '#f87171' : '#fbbf24';
        ctx.fill();
        const wing = Math.sin(now / 90) * (bird.vy < 0 ? 4 : 1.5);
        ctx.beginPath();
        ctx.ellipse(-bird.r * 0.35, wing, bird.r * 0.55, bird.r * 0.32, -0.5, 0, Math.PI * 2);
        ctx.fillStyle = dead ? 'rgba(248,113,113,0.5)' : 'rgba(251,191,36,0.75)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bird.r * 0.4, -bird.r * 0.25, bird.r * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = '#022c22';
        ctx.fill();
        ctx.restore();
        if (!started) {
          ctx.fillStyle = 'rgba(226,232,240,0.85)';
          ctx.font = `${Math.round(W / 22)}px Vazirmatn, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(gT('برای شروع بزن', 'Tap to start'), W / 2, H * 0.3);
        }
      });
      const offKey = onKeys({ ' ': flap, Space: flap });
      const onTap = (event) => { event.preventDefault(); flap(); };
      canvas.addEventListener('mousedown', onTap);
      canvas.addEventListener('touchstart', onTap, { passive: false });
      return () => { stopLoop(); offKey(); };
    },
  });

  /* ---------- 7. Whack-a-mole -------------------------------------------- */
  registerGame({
    id: 'whack', fa: 'موش‌کوبی', en: 'Whack-a-mole', icon: 'fa-circle-dot',
    hintFa: '۳۰ ثانیه — هر جا موش سبز بیرون آمد، بزن!',
    hintEn: '30 seconds — hit the green moles as they pop out!',
    launch(holder, api) {
      const wrap = document.createElement('div');
      wrap.className = 'games-whack';
      const holes = [];
      let score = 0;
      let timeLeft = 30;
      const timer = document.createElement('div');
      timer.className = 'games-whack-timer';
      wrap.appendChild(timer);
      const field = document.createElement('div');
      field.className = 'games-whack-field';
      wrap.appendChild(field);
      for (let i = 0; i < 9; i += 1) {
        const hole = document.createElement('button');
        hole.type = 'button';
        hole.className = 'games-whack-hole';
        hole.innerHTML = '<span class="games-whack-mole"></span>';
        hole.addEventListener('click', () => {
          if (!hole.classList.contains('is-up')) return;
          hole.classList.remove('is-up');
          hole.classList.add('is-hit');
          setTimeout(() => hole.classList.remove('is-hit'), 180);
          score += 1; api.score(score);
          beep(640, 55, 'square');
        });
        field.appendChild(hole);
        holes.push(hole);
      }
      holder.appendChild(wrap);
      const popTimer = window.setInterval(() => {
        const hole = holes[Math.floor(Math.random() * holes.length)];
        if (hole.classList.contains('is-up')) return;
        hole.classList.add('is-up');
        setTimeout(() => hole.classList.remove('is-up'), 500 + Math.random() * 600);
      }, 520);
      const tickTimer = window.setInterval(() => {
        timeLeft -= 1;
        timer.textContent = `${gT('زمان', 'Time')}: ${timeLeft}`;
        if (timeLeft <= 0) {
          window.clearInterval(popTimer);
          window.clearInterval(tickTimer);
          holes.forEach((h) => h.classList.remove('is-up'));
          api.best(score);
          api.over(`${gT('امتیاز', 'Score')}: ${score}`);
        }
      }, 1000);
      timer.textContent = `${gT('زمان', 'Time')}: ${timeLeft}`;
      return () => { window.clearInterval(popTimer); window.clearInterval(tickTimer); };
    },
  });

  /* ---------- 8. Reaction -------------------------------------------------- */
  registerGame({
    id: 'reaction', fa: 'سرعت واکنش', en: 'Reaction', icon: 'fa-bolt',
    hintFa: 'وقتی سبز شد بزن — هرچه سریع‌تر بهتر.',
    hintEn: 'Tap when it turns green — the faster the better.',
    launch(holder, api) {
      const pad = document.createElement('button');
      pad.type = 'button';
      pad.className = 'games-reaction is-wait';
      pad.textContent = gT('برای شروع بزن', 'Tap to start');
      let state = 'idle';
      let startedAt = 0;
      let best = bestScore('reaction');
      let timeout = 0;
      const arm = () => {
        state = 'waiting';
        pad.className = 'games-reaction is-wait';
        pad.textContent = gT('صبر کن…', 'Wait…');
        timeout = window.setTimeout(() => {
          state = 'go';
          startedAt = performance.now();
          pad.className = 'games-reaction is-go';
          pad.textContent = gT('بزن!', 'TAP!');
          beep(880, 70, 'sine');
        }, 900 + Math.random() * 2600);
      };
      pad.addEventListener('click', () => {
        if (state === 'idle' || state === 'again') { arm(); return; }
        if (state === 'waiting') {
          window.clearTimeout(timeout);
          state = 'again';
          pad.className = 'games-reaction is-early';
          pad.textContent = gT('زود زدی! دوباره بزن.', 'Too soon — tap again.');
          beep(140, 180, 'sawtooth');
          return;
        }
        if (state === 'go') {
          const ms = Math.round(performance.now() - startedAt);
          state = 'again';
          pad.className = 'games-reaction';
          pad.textContent = `${ms} ${gT('میلی‌ثانیه — دوباره بزن', 'ms — tap to retry')}`;
          const saved = api.best(ms, { higherWins: false });
          best = saved || best;
          api.score(ms);
          beep(520, 90, 'sine');
          vibrate(16);
        }
      });
      holder.appendChild(pad);
      return () => window.clearTimeout(timeout);
    },
  });

  /* ---------- 9. Simon ----------------------------------------------------- */
  registerGame({
    id: 'simon', fa: 'تکرار الگو', en: 'Simon', icon: 'fa-music',
    hintFa: 'الگوی رنگ‌ها را از حفظ تکرار کن.',
    hintEn: 'Repeat the colour pattern from memory.',
    launch(holder, api) {
      const wrap = document.createElement('div');
      wrap.className = 'games-simon';
      const padsCfg = [
        { color: '#f87171', freq: 330 }, { color: '#4ade80', freq: 415 },
        { color: '#facc15', freq: 494 }, { color: '#38bdf8', freq: 622 },
      ];
      const pads = [];
      let sequence = [];
      let inputIndex = 0;
      let accepting = false;
      let timeouts = [];
      const flash = (index, ms = 380) => {
        pads[index].classList.add('is-lit');
        beep(padsCfg[index].freq, ms, 'sine', 0.06);
        timeouts.push(window.setTimeout(() => pads[index].classList.remove('is-lit'), ms));
      };
      const playSequence = () => {
        accepting = false;
        sequence.forEach((value, i) => {
          timeouts.push(window.setTimeout(() => flash(value), 620 * (i + 1)));
        });
        timeouts.push(window.setTimeout(() => {
          accepting = true;
          inputIndex = 0;
        }, 620 * (sequence.length + 1)));
      };
      const nextRound = () => {
        sequence.push(Math.floor(Math.random() * 4));
        api.score(sequence.length - 1);
        playSequence();
      };
      padsCfg.forEach((cfg, index) => {
        const pad = document.createElement('button');
        pad.type = 'button';
        pad.className = 'games-simon-pad';
        pad.style.background = cfg.color;
        pad.setAttribute('aria-label', String(index + 1));
        pad.addEventListener('click', () => {
          if (!accepting) return;
          flash(index, 220);
          if (sequence[inputIndex] === index) {
            inputIndex += 1;
            if (inputIndex === sequence.length) {
              accepting = false;
              timeouts.push(window.setTimeout(nextRound, 700));
            }
          } else {
            accepting = false;
            beep(110, 320, 'sawtooth');
            api.best(sequence.length - 1);
            api.over(`${gT('الگو رسید به', 'Pattern reached')}: ${sequence.length - 1}`);
          }
        });
        wrap.appendChild(pad);
        pads.push(pad);
      });
      holder.appendChild(wrap);
      timeouts.push(window.setTimeout(nextRound, 600));
      return () => timeouts.forEach(window.clearTimeout);
    },
  });

  /* ---------- 10. Minesweeper ---------------------------------------------- */
  registerGame({
    id: 'mines', fa: 'مین‌یاب', en: 'Minesweeper', icon: 'fa-bomb',
    hintFa: '۹×۹ با ۱۰ مین — روی خانه بزن؛ برای پرچم نگه دار (یا راست‌کلیک).',
    hintEn: '9×9 with 10 mines — tap to open; hold (or right-click) to flag.',
    launch(holder, api) {
      const N = 9; const MINES = 10;
      const wrap = document.createElement('div');
      wrap.className = 'games-mines';
      const cells = [];
      let opened = 0;
      let flags = 0;
      let over = false;
      const board = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ mine: false, open: false, flag: false, near: 0 })));
      const plant = () => {
        let placed = 0;
        while (placed < MINES) {
          const r = Math.floor(Math.random() * N); const c = Math.floor(Math.random() * N);
          if (board[r][c].mine) continue;
          board[r][c].mine = true; placed += 1;
        }
        for (let r = 0; r < N; r += 1) for (let c = 0; c < N; c += 1) {
          let near = 0;
          for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
            const rr = r + dr; const cc = c + dc;
            if (rr >= 0 && cc >= 0 && rr < N && cc < N && board[rr][cc].mine) near += 1;
          }
          board[r][c].near = near;
        }
      };
      const paint = (r, c) => {
        const el = cells[r * N + c];
        const cellData = board[r][c];
        el.className = `games-mines-cell ${cellData.open ? 'is-open' : ''} ${cellData.flag ? 'is-flag' : ''}`;
        el.textContent = cellData.flag ? '🚩' : (cellData.open ? (cellData.mine ? '💥' : (cellData.near || '')) : '');
        if (cellData.open && cellData.near) el.dataset.near = cellData.near;
      };
      const floodOpen = (r, c) => {
        if (r < 0 || c < 0 || r >= N || c >= N) return;
        const cellData = board[r][c];
        if (cellData.open || cellData.flag) return;
        cellData.open = true; opened += 1;
        paint(r, c);
        if (cellData.near === 0 && !cellData.mine) {
          for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) floodOpen(r + dr, c + dc);
        }
      };
      const finish = (won) => {
        over = true;
        if (won) { api.best(1); api.over(gT('همه مین‌ها پیدا شد! 🎉', 'All mines found! 🎉')); }
        else {
          board.forEach((row, r) => row.forEach((cellData, c) => { if (cellData.mine) { cellData.open = true; paint(r, c); } }));
          api.over(gT('روی مین رفتی!', 'You hit a mine!'));
        }
      };
      plant();
      for (let r = 0; r < N; r += 1) for (let c = 0; c < N; c += 1) {
        const el = document.createElement('button');
        el.type = 'button';
        cells.push(el);
        paint(r, c);
        let holdTimer = 0;
        let held = false;
        const open = () => {
          if (over) return;
          const cellData = board[r][c];
          if (cellData.flag || cellData.open) return;
          if (cellData.mine) { beep(110, 300, 'sawtooth'); finish(false); return; }
          beep(480, 35, 'sine');
          floodOpen(r, c);
          api.score(opened);
          if (opened === N * N - MINES) finish(true);
        };
        const flag = () => {
          if (over) return;
          const cellData = board[r][c];
          if (cellData.open) return;
          cellData.flag = !cellData.flag;
          flags += cellData.flag ? 1 : -1;
          beep(360, 40, 'square');
          paint(r, c);
        };
        el.addEventListener('contextmenu', (event) => { event.preventDefault(); flag(); });
        el.addEventListener('pointerdown', () => {
          held = false;
          holdTimer = window.setTimeout(() => { held = true; flag(); vibrate(14); }, 380);
        });
        const release = () => {
          window.clearTimeout(holdTimer);
          if (!held) open();
          held = false;
        };
        el.addEventListener('pointerup', release);
        el.addEventListener('pointerleave', () => window.clearTimeout(holdTimer));
        wrap.appendChild(el);
      }
      holder.appendChild(wrap);
      return () => {};
    },
  });

  /* ---------- the easter egg itself -------------------------------------- */
  function bindEasterEgg() {
    const logo = document.getElementById('aboutLogoEgg');
    if (!logo) return;
    let taps = 0;
    let resetTimer = 0;
    const pulse = () => {
      logo.classList.remove('is-egg-pulse');
      void logo.offsetWidth;
      logo.classList.add('is-egg-pulse');
    };
    const register = () => {
      taps += 1;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => { taps = 0; }, 6000);
      if (taps >= 11) {
        taps = 0;
        vibrate([18, 40, 18]);
        beep(523, 90, 'sine'); setTimeout(() => beep(784, 120, 'sine'), 110);
        openGames();
        return;
      }
      if (taps >= 6) pulse();
    };
    logo.addEventListener('click', register);
    logo.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); register(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindEasterEgg, { once: true });
  else bindEasterEgg();
})();
