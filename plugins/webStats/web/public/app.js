// webStats page: live log, history, player statistics and push notifications.

const $ = (sel, root = document) => root.querySelector(sel);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const TEAMS = {
  red: 'roșie', green: 'verde', blue: 'albastră', purple: 'mov', rogue: 'rogue',
  observer: 'observator', rabbit: 'iepure', hunter: 'vânător', admin: 'admin',
};

const nf = new Intl.NumberFormat('ro-RO');
const timeFmt = new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateFmt = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function playerKey(callsign, bzid) {
  if (bzid) return `bz:${bzid}`;
  return callsign ? `cs:${callsign.toLowerCase()}` : null;
}

function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}h ${min % 60}m` : `${Math.floor(h / 24)}z ${h % 24}h`;
}

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'acum';
  if (s < 3600) return `acum ${Math.floor(s / 60)} min`;
  if (s < 86400) return `acum ${Math.floor(s / 3600)} h`;
  return dateFmt.format(t);
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function who(callsign, bzid, team) {
  if (!callsign) return '<span class="muted">?</span>';
  if (callsign === 'SERVER') return '<span class="muted">SERVER</span>';
  const key = playerKey(callsign, bzid);
  const swatch = team ? `<span class="team ${esc(team)}" title="${esc(TEAMS[team] || team)}"></span>` : '';
  return `${swatch}<a href="#player/${encodeURIComponent(key)}">${esc(callsign)}</a>`;
}

function describe(ev) {
  switch (ev.type) {
    case 'join':
      return `${who(ev.callsign, ev.bzid, ev.team)} a intrat${ev.team && ev.team !== 'observer'
        ? ` în echipa ${esc(TEAMS[ev.team] || ev.team)}` : ev.team === 'observer' ? ' ca observator' : ''}`;
    case 'part':
      return `${who(ev.callsign, ev.bzid, ev.team)} a ieșit${ev.reason ? ` <span class="muted">(${esc(ev.reason)})</span>` : ''}`;
    case 'game-open':
      return `<span class="badge live">joc nou</span> ${who(ev.callsign, ev.bzid, ev.team)} a deschis un joc`;
    case 'game-empty':
      return '<span class="badge">gol</span> ultimul jucător a ieșit';
    case 'kill': {
      const victim = who(ev.victimCallsign, ev.victimBzid, ev.victimTeam);
      const flag = ev.flag ? ` <span class="muted">cu ${esc(ev.flag)}</span>` : '';
      if (ev.killerPid === ev.victimPid) return `${victim} s-a sinucis${flag}`;
      if (!ev.killerCallsign || ev.killerCallsign === 'SERVER') return `${victim} a murit`;
      const tk = ev.teamKill ? ' <span class="badge">coechipier</span>' : '';
      return `${who(ev.killerCallsign, ev.killerBzid, ev.killerTeam)} l-a distrus pe ${victim}${flag}${tk}`;
    }
    case 'capture':
      return `${who(ev.playerCallsign, ev.playerBzid, ev.playerTeam)} a capturat steagul echipei ${esc(TEAMS[ev.teamCapped] || ev.teamCapped)}`;
    case 'flag':
      return `${who(ev.playerCallsign, ev.playerBzid, ev.playerTeam)} a luat steagul <b>${esc(ev.flag)}</b>`;
    case 'chat': {
      const from = who(ev.fromCallsign, ev.fromBzid, ev.fromTeam);
      const scope = ev.kind === 'team' ? `<span class="kind">[${esc(TEAMS[ev.toTeam] || ev.toTeam)}]</span>`
        : ev.kind === 'admin' ? '<span class="kind">[admin]</span>'
          : ev.kind === 'private' ? `<span class="kind">→ ${esc(ev.toCallsign)}</span>` : '';
      return `${scope}${from}: ${esc(ev.message)}`;
    }
    case 'auth':
      return `${who(ev.playerCallsign, ev.playerBzid, ev.playerTeam)} s-a autentificat`;
    case 'server-start':
      return `<span class="badge">server</span> pornit: ${esc(ev.description || ev.server)}`;
    case 'server-stop':
      return '<span class="badge">server</span> oprit';
    case 'match-start':
      return `<span class="badge live">meci</span> a început (${duration(ev.duration * 1000)})`;
    case 'match-end':
      return '<span class="badge">meci</span> terminat';
    case 'log':
      return `<span class="srv">${esc(ev.message)}</span>`;
    default:
      return `<span class="muted">${esc(ev.type)}</span>`;
  }
}

function eventItem(ev, fresh = false) {
  const li = document.createElement('li');
  if (fresh) li.className = 'new';
  li.dataset.id = ev.id;
  li.dataset.day = new Date(ev.t).toDateString();
  li.innerHTML = `<time datetime="${new Date(ev.t).toISOString()}" title="${esc(dateFmt.format(ev.t))}">${timeFmt.format(ev.t)}</time>
    <div class="body">${describe(ev)}</div>`;
  return li;
}

function dayItem(t) {
  const li = document.createElement('li');
  li.className = 'day';
  li.textContent = dayFmt.format(t);
  li.dataset.dayHeader = new Date(t).toDateString();
  return li;
}

// Appends events (newest first) to a list, inserting day headers
function appendEvents(list, events) {
  for (const ev of events) {
    const day = new Date(ev.t).toDateString();
    const last = list.lastElementChild;
    if (!last || (last.dataset.day || last.dataset.dayHeader) !== day) list.append(dayItem(ev.t));
    list.append(eventItem(ev));
  }
}

function prependEvent(list, ev, max = 200) {
  const day = new Date(ev.t).toDateString();
  const first = list.firstElementChild;
  const item = eventItem(ev, true);
  if (first && first.dataset.dayHeader === day) first.after(item);
  else {
    list.prepend(item);
    list.prepend(dayItem(ev.t));
  }
  while (list.children.length > max) list.lastElementChild.remove();
}

// ---- live view ----

let liveTimer = null;
function scheduleLiveRefresh() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(loadLive, 400);
}

async function loadLive() {
  const data = await api('/api/live');
  const s = data.summary;
  $('#summary').innerHTML = [
    ['Online', data.online.filter((p) => p.team !== 'observer').length],
    ['Jucători', nf.format(s.players)],
    ['Jocuri', nf.format(s.sessions)],
    ['Omoruri', nf.format(s.kills)],
    ['Timp jucat', duration(s.playtime_ms)],
  ].map(([label, value]) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');

  $('#servers').innerHTML = data.servers.length ? data.servers.map((srv) => {
    const players = data.online.filter((p) => p.server === srv.name);
    const status = srv.running ? (players.length ? '' : '<span class="badge">gol</span>') : '<span class="badge">oprit</span>';
    return `<div class="server">
      <div><span class="server-name">${esc(srv.description || srv.name)}</span> ${status}</div>
      <div class="muted small">${esc(srv.name)}</div>
      <ul class="online">${players.map((p) => `<li><span>${who(p.callsign, p.key.startsWith('bz:') ? p.key.slice(3) : '', p.team)}</span>
        <span class="muted small">${duration(Date.now() - p.since)}</span></li>`).join('')}</ul>
    </div>`;
  }).join('') : '<p class="muted">Niciun server conectat încă.</p>';

  $('#sessions').innerHTML = data.sessions.length ? data.sessions.map((s) => {
    const open = !s.closed_at;
    const len = duration((s.closed_at || Date.now()) - s.opened_at);
    return `<li>
      <div>${open ? '<span class="badge live">în desfășurare</span> ' : ''}<b>${esc(s.opener)}</b> a deschis · ${ago(s.opened_at)}</div>
      <div class="muted small">${len} · max ${s.peak} jucători · ${s.players.map((p) => esc(p.callsign)).join(', ')}</div>
    </li>`;
  }).join('') : '<li class="muted">Încă nu s-a jucat nimic.</li>';
}

async function loadLiveLog() {
  const events = await api('/api/events?limit=60&types=' + encodeURIComponent(
    'join,part,game-open,game-empty,kill,capture,chat,server-start,server-stop,match-start,match-end'));
  const list = $('#live-log');
  list.innerHTML = '';
  appendEvents(list, events);
}

const REFRESH_TYPES = new Set(['join', 'part', 'game-open', 'game-empty', 'server-start', 'server-stop', 'kill']);

function connectStream() {
  const source = new EventSource('/api/stream');
  source.onopen = () => $('#live-dot').classList.add('on');
  source.onerror = () => $('#live-dot').classList.remove('on');
  source.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type !== 'log' && ev.type !== 'flag' && ev.type !== 'auth') prependEvent($('#live-log'), ev);
    if (REFRESH_TYPES.has(ev.type) && currentView === 'live') scheduleLiveRefresh();
  };
}

// ---- history ----

const logState = { before: null, loading: false, player: null };

async function loadHistory(reset) {
  if (logState.loading) return;
  logState.loading = true;
  const form = $('#log-filters');
  const params = new URLSearchParams({ limit: 100 });
  if (form.types.value) params.set('types', form.types.value);
  if (form.q.value.trim()) params.set('q', form.q.value.trim());
  if (logState.player) params.set('player', logState.player);
  if (!reset && logState.before) params.set('before', logState.before);
  try {
    const events = await api('/api/events?' + params);
    const list = $('#history-log');
    if (reset) list.innerHTML = '';
    appendEvents(list, events);
    if (reset && !events.length) list.innerHTML = '<li class="day muted">Nimic de afișat.</li>';
    logState.before = events.length ? events[events.length - 1].id : logState.before;
    $('#history-more').hidden = events.length < 100;
  } finally {
    logState.loading = false;
  }
}

function setHistoryPlayer(key, name) {
  logState.player = key;
  const chip = $('#player-filter');
  chip.hidden = !key;
  if (key) {
    chip.innerHTML = `${esc(name || key)} <button type="button" aria-label="Șterge filtrul">×</button>`;
    chip.querySelector('button').onclick = () => { location.hash = '#log'; };
  }
}

// ---- players ----

async function loadPlayers() {
  const form = $('#player-filters');
  const params = new URLSearchParams({ sort: form.sort.value });
  if (form.days.value) params.set('days', form.days.value);
  const players = await api('/api/players?' + params);
  $('#players').innerHTML = players.length ? players.map((p, i) => `<tr>
    <td class="muted">${i + 1}</td>
    <td><a href="#player/${encodeURIComponent(p.key)}">${esc(p.callsign)}</a>${p.bzid ? ' <span class="muted small" title="cont verificat">✓</span>' : ''}</td>
    <td class="n">${nf.format(p.kills)}</td>
    <td class="n">${nf.format(p.deaths)}</td>
    <td class="n">${p.ratio.toFixed(2)}</td>
    <td class="n hide-s">${nf.format(p.captures)}</td>
    <td class="n hide-s">${duration(p.playtime_ms)}</td>
    <td class="hide-s muted">${ago(p.last_seen)}</td>
  </tr>`).join('') : '<tr><td colspan="8" class="muted">Încă nu sunt jucători.</td></tr>';
}

function rankList(rows, label) {
  if (!rows.length) return '<p class="muted small">—</p>';
  return `<ul class="rank">${rows.map((r) => `<li><span>${label(r)}</span><span class="n">${nf.format(r.count)}</span></li>`).join('')}</ul>`;
}

function hoursChart(hours) {
  const counts = Array.from({ length: 24 }, (_, h) => hours.find((x) => x.hour === h)?.count || 0);
  const max = Math.max(1, ...counts);
  const W = 480, H = 140, pad = 18, bw = W / 24;
  const bars = counts.map((c, h) => {
    const bh = c ? Math.max(3, (H - pad - 4) * c / max) : 0;
    const x = h * bw + 2, y = H - pad - bh;
    const w = bw - 4;
    // bar with rounded top anchored to the baseline
    const r = Math.min(4, w / 2, bh);
    const path = bh ? `M${x},${H - pad} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${H - pad} Z` : '';
    return `<rect class="hit" x="${h * bw}" y="0" width="${bw}" height="${H - pad}" data-h="${h}" data-c="${c}"></rect>
      ${path ? `<path class="bar" d="${path}" data-h="${h}"></path>` : ''}
      ${h % 3 === 0 ? `<text class="axis" x="${h * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${h}</text>` : ''}`;
  }).join('');
  return `<div class="hours"><svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Intrări pe server după ora din zi">
    <line class="base" x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}"></line>${bars}</svg>
    <div class="tip" hidden></div></div>`;
}

function bindHoursTooltip(root) {
  const wrap = $('.hours', root);
  if (!wrap) return;
  const tip = $('.tip', wrap);
  wrap.addEventListener('pointermove', (e) => {
    const hit = e.target.closest('.hit');
    wrap.querySelectorAll('.bar.hover').forEach((b) => b.classList.remove('hover'));
    if (!hit) { tip.hidden = true; return; }
    const h = Number(hit.dataset.h);
    wrap.querySelector(`.bar[data-h="${h}"]`)?.classList.add('hover');
    const box = wrap.getBoundingClientRect();
    tip.hidden = false;
    tip.textContent = `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 · ${hit.dataset.c} intrări`;
    tip.style.left = `${Math.min(box.width - 70, Math.max(70, e.clientX - box.left))}px`;
    tip.style.top = `${e.clientY - box.top - 8}px`;
  });
  wrap.addEventListener('pointerleave', () => {
    tip.hidden = true;
    wrap.querySelectorAll('.bar.hover').forEach((b) => b.classList.remove('hover'));
  });
}

async function loadPlayer(key) {
  const root = $('#player');
  root.innerHTML = '<p class="muted">Se încarcă…</p>';
  let data;
  try {
    data = await api('/api/players/' + encodeURIComponent(key));
  } catch {
    root.innerHTML = '<div class="card"><p>Jucător necunoscut.</p></div>';
    return;
  }
  const p = data.player;
  const link = (r) => `<a href="#player/${encodeURIComponent(r.key)}">${esc(r.callsign || r.key)}</a>`;
  root.innerHTML = `
    <div class="card">
      <h1>${esc(p.callsign)} ${p.bzid ? '<span class="badge" title="cont BZFlag verificat">verificat</span>' : ''}</h1>
      <p class="muted small">Prima dată: ${dateFmt.format(p.first_seen)} · ultima dată: ${ago(p.last_seen)} ·
        <a href="#log?player=${encodeURIComponent(p.key)}">vezi istoricul</a></p>
      <div class="stats">
        ${[['Omoruri', nf.format(p.kills)], ['Morți', nf.format(p.deaths)], ['K/D', p.ratio.toFixed(2)],
    ['Capturi', nf.format(p.captures)], ['Timp jucat', duration(p.playtime_ms)], ['Intrări', nf.format(p.joins)],
    ['Jocuri deschise', nf.format(p.sessions_opened)], ['Coechipieri omorâți', nf.format(p.teamkills)],
    ['Sinucideri', nf.format(p.suicides)], ['Mesaje', nf.format(p.messages)]]
    .map(([l, v]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}
      </div>
    </div>
    <div class="grid">
      <div class="card"><h2>Victime preferate</h2>${rankList(data.victims, link)}</div>
      <div class="card"><h2>Nemesis</h2>${rankList(data.killers, link)}</div>
      <div class="card"><h2>Steaguri luate</h2>${rankList(data.flags, (r) => esc(r.flag))}</div>
      <div class="card"><h2>Omoruri pe steag</h2>${rankList(data.killFlags, (r) => esc(r.flag || 'fără steag'))}</div>
    </div>
    <div class="card"><h2>Când intră pe server (ora locală)</h2>${hoursChart(data.hours)}</div>
    <div class="card"><h2>Jocuri recente</h2><ul class="sessions">${data.sessions.map((s) => `<li>
      <div>${!s.closed_at ? '<span class="badge live">în desfășurare</span> ' : ''}${dateFmt.format(s.opened_at)}
        · deschis de <b>${esc(s.opener)}</b></div>
      <div class="muted small">${duration((s.closed_at || Date.now()) - s.opened_at)} · max ${s.peak} jucători</div>
    </li>`).join('') || '<li class="muted">—</li>'}</ul></div>`;
  bindHoursTooltip(root);
}

// ---- push notifications ----

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let swRegistration = null;

async function pushState() {
  const status = $('#push-status');
  const on = $('#push-on'), off = $('#push-off'), test = $('#push-test');
  if (!pushSupported || !swRegistration) {
    status.textContent = window.isSecureContext
      ? 'Browserul acesta nu suportă notificări push.'
      : 'Notificările au nevoie de HTTPS (sau localhost).';
    on.hidden = off.hidden = test.hidden = true;
    return;
  }
  const sub = await swRegistration.pushManager.getSubscription();
  if (Notification.permission === 'denied') {
    status.textContent = 'Notificările sunt blocate din setările browserului pentru acest site.';
    on.hidden = off.hidden = test.hidden = true;
    return;
  }
  status.textContent = sub ? 'Activate pe acest dispozitiv.' : 'Dezactivate pe acest dispozitiv.';
  on.hidden = !!sub;
  off.hidden = test.hidden = !sub;
}

async function pushSubscribe() {
  $('#push-on').disabled = true;
  try {
    if (await Notification.requestPermission() !== 'granted') return;
    const { key } = await api('/api/push/key');
    let sub = await swRegistration.pushManager.getSubscription();
    if (!sub) {
      sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await api('/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub),
    });
  } catch (err) {
    $('#push-status').textContent = `Nu s-a putut activa: ${err.message}`;
    return;
  } finally {
    $('#push-on').disabled = false;
  }
  await pushState();
}

async function pushUnsubscribe() {
  const sub = await swRegistration.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe();
  }
  await pushState();
}

async function pushTest() {
  const sub = await swRegistration.pushManager.getSubscription();
  if (!sub) return;
  try {
    await api('/api/push/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub),
    });
    $('#push-status').textContent = 'Test trimis. Ar trebui să apară o notificare.';
  } catch (err) {
    $('#push-status').textContent = `Testul a eșuat (${err.message}). Încearcă să dezactivezi și să activezi din nou.`;
  }
}

// ---- routing ----

let currentView = null;

async function route() {
  const hash = location.hash.slice(1) || 'live';
  const [pathPart, query] = hash.split('?');
  const [view, arg] = pathPart.split('/');
  const params = new URLSearchParams(query || '');
  const known = ['live', 'log', 'players', 'player', 'notify'];
  currentView = known.includes(view) ? view : 'live';

  for (const v of known) $(`#view-${v}`).hidden = v !== currentView;
  document.querySelectorAll('nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === currentView || (currentView === 'player' && a.dataset.tab === 'players'));
  });
  window.scrollTo(0, 0);

  try {
    if (currentView === 'live') await loadLive();
    if (currentView === 'log') {
      const player = params.get('player');
      setHistoryPlayer(player, player ? player.replace(/^(bz|cs):/, '') : null);
      if (player) {
        api('/api/players/' + encodeURIComponent(player))
          .then((d) => setHistoryPlayer(player, d.player.callsign)).catch(() => {});
      }
      await loadHistory(true);
    }
    if (currentView === 'players') await loadPlayers();
    if (currentView === 'player') await loadPlayer(decodeURIComponent(arg || ''));
    if (currentView === 'notify') await pushState();
  } catch (err) {
    console.error(err);
  }
}

let searchTimer;
$('#log-filters').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadHistory(true), 250);
});
$('#log-filters').addEventListener('submit', (e) => e.preventDefault());
$('#history-more').addEventListener('click', () => loadHistory(false));
$('#player-filters').addEventListener('change', loadPlayers);
$('#push-on').addEventListener('click', pushSubscribe);
$('#push-off').addEventListener('click', pushUnsubscribe);
$('#push-test').addEventListener('click', pushTest);
window.addEventListener('hashchange', route);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then((reg) => { swRegistration = reg; if (currentView === 'notify') pushState(); })
    .catch((err) => console.warn('service worker', err));
}

route();
loadLiveLog().catch(console.error);
connectStream();
setInterval(() => { if (currentView === 'live' && !document.hidden) loadLive().catch(() => {}); }, 60000);
