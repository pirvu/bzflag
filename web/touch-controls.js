// Touch controls for phones and tablets: an on screen stick, fire / jump /
// flag buttons, optional steering by tilting the device, and a pad for the
// menus. The stick, the tilt and the buttons drive the game's joystick
// (src/platform/TouchJoystick.cxx); the menu pad sends key presses.
//
// On by default on touch screens. ?touch=1 forces it on, ?touch=0 off.

(function() {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var wanted = params.get('touch');
  var coarse = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (wanted === '0' || (wanted !== '1' && !coarse)) return;

  // Joystick buttons, bound in bzflag.cxx (bindTouchButtons)
  var BUTTON = { fire: 1 << 0, jump: 1 << 1, drop: 1 << 2, score: 1 << 3, start: 1 << 4 };

  var STICK_RADIUS = 60;     // px of finger travel for full speed
  var TILT_FULL = 20;        // degrees of tilt for full speed
  var TILT_DEAD = 3;         // degrees ignored around the calibrated rest
  var MIN_PRESS_MS = 120;    // shortest press the game gets to see

  var css = [
    '#bzt-root { position: fixed; inset: 0; z-index: 5; pointer-events: none; display: none;',
    '  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '#bzt-root.on { display: block; }',
    '#bzt-root .bzt-hit { pointer-events: auto; touch-action: none; }',
    '#bzt-stick-zone { position: absolute; left: 0; bottom: 0; width: 45%; height: 65%; }',
    '#bzt-stick-base { position: absolute; width: 132px; height: 132px; margin: -66px 0 0 -66px;',
    '  border-radius: 50%; border: 2px solid rgba(255,255,255,.35); background: rgba(0,0,0,.18); }',
    '#bzt-knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px;',
    '  border-radius: 50%; background: rgba(255,255,255,.45); }',
    '#bzt-stick-zone.idle #bzt-stick-base { opacity: .4; }',
    '.bzt-btn { position: absolute; display: flex; align-items: center; justify-content: center;',
    '  border-radius: 50%; border: 2px solid rgba(255,255,255,.4); background: rgba(0,0,0,.25);',
    '  color: rgba(255,255,255,.9); font-size: 13px; font-weight: 700; letter-spacing: .04em; }',
    '.bzt-btn.down { background: rgba(255,255,255,.35); }',
    '#bzt-fire { right: calc(24px + env(safe-area-inset-right)); bottom: calc(28px + env(safe-area-inset-bottom));',
    '  width: 96px; height: 96px; font-size: 16px; border-color: rgba(255,120,110,.7); }',
    '#bzt-jump { right: calc(132px + env(safe-area-inset-right)); bottom: calc(24px + env(safe-area-inset-bottom)); width: 64px; height: 64px; }',
    '#bzt-drop { right: calc(40px + env(safe-area-inset-right)); bottom: calc(136px + env(safe-area-inset-bottom)); width: 60px; height: 60px; }',
    '#bzt-start { left: 50%; top: 62%; transform: translate(-50%, -50%); width: 150px; height: 60px; border-radius: 30px;',
    '  font-size: 18px; border-color: rgba(120,220,140,.8); background: rgba(0,0,0,.4); display: none; }',
    '#bzt-root.waiting #bzt-start { display: flex; }',
    '#bzt-root.menu #bzt-start { display: none; }',
    '#bzt-top { position: absolute; top: calc(8px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right));',
    '  display: flex; gap: 8px; }',
    '#bzt-top .bzt-btn { position: static; width: 44px; height: 44px; border-radius: 10px; font-size: 18px; }',
    '#bzt-top .bzt-btn.small { font-size: 11px; }',
    '#bzt-tilt.active { border-color: #4a9eff; color: #4a9eff; }',
    '#bzt-pad { position: absolute; right: calc(16px + env(safe-area-inset-right)); bottom: calc(16px + env(safe-area-inset-bottom));',
    '  display: none; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(2, 56px); gap: 8px; }',
    '#bzt-root.menu #bzt-pad { display: grid; }',
    '#bzt-root.menu #bzt-stick-zone, #bzt-root.menu #bzt-fire, #bzt-root.menu #bzt-jump, #bzt-root.menu #bzt-drop { display: none; }',
    '#bzt-pad .bzt-btn { position: static; width: 56px; height: 56px; border-radius: 12px; font-size: 20px; }',
    '#bzt-toast { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px;',
    '  background: rgba(0,0,0,.6); color: #fff; font-size: 14px; display: none; text-align: center; max-width: 80%; }',
    '#bzt-rotate { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); padding: 10px 16px;',
    '  border-radius: 10px; background: rgba(0,0,0,.6); color: #fff; font-size: 15px; display: none; }',
    '@media (orientation: portrait) { #bzt-root:not(.dismissed) #bzt-rotate { display: block; } }',
  ].join('\n');

  var html = [
    '<div id="bzt-stick-zone" class="bzt-hit idle"><div id="bzt-stick-base"><div id="bzt-knob"></div></div></div>',
    '<div id="bzt-fire" class="bzt-btn bzt-hit" data-button="fire">FIRE</div>',
    '<div id="bzt-jump" class="bzt-btn bzt-hit" data-button="jump">JUMP</div>',
    '<div id="bzt-drop" class="bzt-btn bzt-hit" data-button="drop">FLAG</div>',
    '<div id="bzt-start" class="bzt-btn bzt-hit" data-button="start">START</div>',
    '<div id="bzt-top">',
    '  <div id="bzt-score" class="bzt-btn bzt-hit small" data-button="score" title="Score">SCORE</div>',
    '  <div id="bzt-tilt" class="bzt-btn bzt-hit small" title="Steer by tilting">TILT</div>',
    '  <div id="bzt-full" class="bzt-btn bzt-hit" title="Full screen">&#x26F6;</div>',
    '  <div id="bzt-menu" class="bzt-btn bzt-hit" title="Menu">&#x2630;</div>',
    '</div>',
    '<div id="bzt-pad">',
    '  <div class="bzt-btn bzt-hit" data-key="Escape" style="font-size:12px">BACK</div>',
    '  <div class="bzt-btn bzt-hit" data-key="ArrowUp">&#x25B2;</div>',
    '  <div class="bzt-btn bzt-hit" data-key="Enter" style="font-size:13px">OK</div>',
    '  <div class="bzt-btn bzt-hit" data-key="ArrowLeft">&#x25C0;</div>',
    '  <div class="bzt-btn bzt-hit" data-key="ArrowDown">&#x25BC;</div>',
    '  <div class="bzt-btn bzt-hit" data-key="ArrowRight">&#x25B6;</div>',
    '</div>',
    '<div id="bzt-toast"></div>',
    '<div id="bzt-rotate">Turn your phone sideways</div>',
  ].join('');

  var root, zone, base, knob, toast;
  var stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  var tilt = { on: false, ready: false, beta0: 0, gamma0: 0, beta: 0, gamma: 0, x: 0, y: 0 };
  var buttons = 0;
  var sent = { x: NaN, y: NaN, buttons: -1 };
  var enabled = false;

  function api(name) {
    var M = window.Module;
    return M && typeof M[name] === 'function' ? M[name] : null;
  }

  function showToast(text, ms) {
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function() { toast.style.display = 'none'; }, ms || 2500);
  }

  // ---- on screen stick ----

  function placeBase(x, y) {
    var r = zone.getBoundingClientRect();
    base.style.left = (x - r.left) + 'px';
    base.style.top = (y - r.top) + 'px';
  }

  // where the stick waits: right of the radar, above the bottom edge
  function restBase() {
    var r = zone.getBoundingClientRect();
    placeBase(r.left + Math.min(200, r.width * 0.6), r.bottom - 100);
    knob.style.transform = '';
  }

  function stickMove(e) {
    var dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    stick.x = dx / STICK_RADIUS;
    stick.y = dy / STICK_RADIUS;
  }

  function stickEnd(e) {
    if (e.pointerId !== stick.id) return;
    stick.id = null;
    stick.x = stick.y = 0;
    zone.classList.add('idle');
    restBase();
  }

  function setupStick() {
    zone.addEventListener('pointerdown', function(e) {
      if (stick.id !== null) return;
      e.preventDefault();
      stick.id = e.pointerId;
      stick.ox = e.clientX;
      stick.oy = e.clientY;
      zone.setPointerCapture(e.pointerId);
      zone.classList.remove('idle');
      placeBase(e.clientX, e.clientY);
      stickMove(e);
    });
    zone.addEventListener('pointermove', function(e) {
      if (e.pointerId === stick.id) stickMove(e);
    });
    zone.addEventListener('pointerup', stickEnd);
    zone.addEventListener('pointercancel', stickEnd);
    window.addEventListener('resize', function() { if (stick.id === null) restBase(); });
    restBase();
  }

  // ---- buttons ----

  function setupButtons() {
    root.querySelectorAll('[data-button]').forEach(function(el) {
      var bit = BUTTON[el.dataset.button];
      var held = {};
      var pressedAt = 0;
      function release(e) {
        if (!held[e.pointerId]) return;
        delete held[e.pointerId];
        if (Object.keys(held).length) return;
        // the game polls the buttons once a frame: keep a quick tap down long
        // enough for it to be seen
        var wait = MIN_PRESS_MS - (performance.now() - pressedAt);
        setTimeout(function() {
          if (Object.keys(held).length) return;
          buttons &= ~bit;
          el.classList.remove('down');
        }, Math.max(0, wait));
      }
      el.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        held[e.pointerId] = true;
        pressedAt = performance.now();
        buttons |= bit;
        el.classList.add('down');
        if (bit === BUTTON.fire && navigator.vibrate) navigator.vibrate(12);
      });
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    });
  }

  // ---- menu pad: real key presses, the menus are keyboard driven ----

  var KEYCODES = { Escape: 27, Enter: 13, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

  function sendKey(key, type) {
    var ev = new KeyboardEvent(type, { key: key, code: key, bubbles: true, cancelable: true });
    // SDL falls back to keyCode for keys its code table does not know
    Object.defineProperty(ev, 'keyCode', { get: function() { return KEYCODES[key]; } });
    Object.defineProperty(ev, 'which', { get: function() { return KEYCODES[key]; } });
    window.dispatchEvent(ev);
  }

  function tapKey(key) {
    sendKey(key, 'keydown');
    setTimeout(function() { sendKey(key, 'keyup'); }, 60);
  }

  function menuOpen() {
    var active = api('_bzf_menu_active');
    return !!active && active() !== 0;
  }

  function setupMenu() {
    // opens the menu, and inside it goes back one level, like Escape
    root.querySelector('#bzt-menu').addEventListener('pointerdown', function(e) {
      e.preventDefault();
      tapKey('Escape');
    });
    root.querySelectorAll('[data-key]').forEach(function(el) {
      el.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        el.classList.add('down');
        tapKey(el.dataset.key);
        setTimeout(function() { el.classList.remove('down'); }, 120);
      });
    });
  }

  // ---- tilt steering ----

  function angleDiff(a, b) {
    var d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function shapeTilt(deg) {
    var sign = deg < 0 ? -1 : 1;
    var mag = Math.abs(deg);
    if (mag < TILT_DEAD) return 0;
    return sign * Math.min(1, (mag - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
  }

  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return typeof window.orientation === 'number' ? window.orientation : 0;
  }

  // Turns the device tilt into joystick axes for the current screen
  // rotation: x > 0 steers right, y < 0 drives forward (top edge of the
  // screen tilted away from the player).
  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    tilt.beta = e.beta;
    tilt.gamma = e.gamma;
    if (!tilt.ready) {
      tilt.beta0 = e.beta;
      tilt.gamma0 = e.gamma;
      tilt.ready = true;
    }
    var db = angleDiff(e.beta, tilt.beta0);
    var dg = angleDiff(e.gamma, tilt.gamma0);
    var x, y;
    switch ((screenAngle() + 360) % 360) {
      case 90: x = db; y = -dg; break;
      case 270: x = -db; y = dg; break;
      case 180: x = -dg; y = -db; break;
      default: x = dg; y = db; break;
    }
    tilt.x = shapeTilt(x);
    tilt.y = shapeTilt(y);
  }

  function setTilt(on) {
    var btn = root.querySelector('#bzt-tilt');
    tilt.on = on;
    tilt.ready = false;
    tilt.x = tilt.y = 0;
    btn.classList.toggle('active', on);
    if (on) {
      window.addEventListener('deviceorientation', onOrientation);
      showToast('Tilt steering on. Hold the phone the way you like, that is the rest position.');
    } else {
      window.removeEventListener('deviceorientation', onOrientation);
    }
    try { localStorage.setItem('bzflag-touch-tilt', on ? '1' : '0'); } catch (e) {}
  }

  function setupTilt() {
    var btn = root.querySelector('#bzt-tilt');
    if (!('DeviceOrientationEvent' in window)) {
      btn.style.display = 'none';
      return;
    }
    btn.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      if (tilt.on) { setTilt(false); return; }
      askSensors(true);
    });
    // turn it back on if it was on last time; iOS only asks from a tap, so
    // there it stays off until TILT is tapped again
    var saved = null;
    try { saved = localStorage.getItem('bzflag-touch-tilt'); } catch (e) {}
    if (saved === '1') askSensors(false);
  }

  // Safari and recent Chrome want permission for the motion sensors
  function askSensors(fromTap) {
    var D = window.DeviceOrientationEvent;
    if (typeof D.requestPermission !== 'function') {
      setTilt(true);
      return;
    }
    D.requestPermission().then(function(state) {
      if (state === 'granted') setTilt(true);
      else if (fromTap) showToast('Motion sensors are blocked for this site.');
    }).catch(function() {
      if (fromTap) showToast('Motion sensors are not available.');
    });
  }

  // ---- full screen ----

  function setupFullscreen() {
    var btn = root.querySelector('#bzt-full');
    var el = document.documentElement;
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) {
      btn.style.display = 'none';
      return;
    }
    btn.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      Promise.resolve(req.call(el)).then(function() {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function() {});
      }).catch(function() {});
    });
  }

  // ---- feeding the game ----

  function gameVisible() {
    var canvas = document.getElementById('canvas');
    var loading = document.getElementById('loading');
    if (!canvas || canvas.offsetParent === null) return false;
    return !(loading && getComputedStyle(loading).display !== 'none');
  }

  function tick() {
    requestAnimationFrame(tick);

    var enable = api('_bzf_touch_enable');
    var visible = gameVisible() && !!enable;
    if (visible !== root.classList.contains('on')) {
      root.classList.toggle('on', visible);
      // the layout only has a size once it is shown
      if (visible && stick.id === null) restBase();
    }
    if (!visible) return;
    if (!enabled) {
      enable(1);
      enabled = true;
    }

    // in a menu the pad replaces the driving controls, and nothing is held
    var menu = menuOpen();
    if (menu !== root.classList.contains('menu')) {
      root.classList.toggle('menu', menu);
      buttons = 0;
      root.querySelectorAll('[data-button].down').forEach(function(el) { el.classList.remove('down'); });
    }

    var waiting = api('_bzf_waiting_to_start');
    root.classList.toggle('waiting', !!waiting && waiting() !== 0);

    // the stick wins while it is touched
    var x = stick.id !== null ? stick.x : (tilt.on ? tilt.x : 0);
    var y = stick.id !== null ? stick.y : (tilt.on ? tilt.y : 0);
    if (menu) x = y = 0;
    if (x !== sent.x || y !== sent.y) {
      api('_bzf_touch_axes')(x, y);
      sent.x = x;
      sent.y = y;
    }
    var b = menu ? 0 : buttons;
    if (b !== sent.buttons) {
      api('_bzf_touch_buttons')(b);
      sent.buttons = b;
    }
  }

  function init() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.id = 'bzt-root';
    root.innerHTML = html;
    document.body.appendChild(root);
    zone = root.querySelector('#bzt-stick-zone');
    base = root.querySelector('#bzt-stick-base');
    knob = root.querySelector('#bzt-knob');
    toast = root.querySelector('#bzt-toast');

    root.querySelector('#bzt-rotate').addEventListener('click', function() { root.classList.add('dismissed'); });
    root.querySelector('#bzt-rotate').classList.add('bzt-hit');

    setupStick();
    setupButtons();
    setupMenu();
    setupTilt();
    setupFullscreen();

    // Touches must not turn into emulated mouse events: the game would
    // switch to mouse steering and drive towards wherever the finger was.
    function noMouse(e) {
      if (!enabled || !e.target) return;
      if (e.target.id === 'canvas' || (e.target.closest && e.target.closest('#bzt-root'))) e.preventDefault();
    }
    document.addEventListener('touchstart', noMouse, { passive: false });
    document.addEventListener('touchend', noMouse, { passive: false });

    requestAnimationFrame(tick);
  }

  window.BZTouch = { sendKey: tapKey };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
