// Renders GET /api/state into four panels. The server is the single source of truth.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = (path, body) => fetch('/api' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());

// Only touch the DOM when content changed, so entry animations don't replay on every poll.
Object.defineProperty(Element.prototype, 'html', {
  set(v) { if (this._h !== v) { this._h = v; this.innerHTML = v; } },
});

const TYPE_LABEL = {
  FAMILY_CLAIM: 'Claims to be family', AUTHORITY_CLAIM: 'Claims authority', URGENCY: 'Urgency',
  MONEY_REQUEST: 'Money request', UNUSUAL_PAYMENT: 'Unusual payment', SECRECY: 'Secrecy',
  CHANNEL_SWITCH: 'Unknown-number excuse', CREDENTIAL_REQUEST: 'Credential request',
  DISTRESS_STORY: 'Distress story', CONTEXT_CONTRADICTION: 'Contradicts family wiki',
  PRESENCE_MISMATCH: 'Live check: not on a call', GPS_MISMATCH: 'Live check: GPS mismatch', COMMUNITY_FLAG: 'Reported by neighbors',
};
const WEIGHTS = { FAMILY_CLAIM: 15, AUTHORITY_CLAIM: 25, URGENCY: 15, MONEY_REQUEST: 30, UNUSUAL_PAYMENT: 20,
  SECRECY: 20, CHANNEL_SWITCH: 20, CREDENTIAL_REQUEST: 30, DISTRESS_STORY: 10, CONTEXT_CONTRADICTION: 25, PRESENCE_MISMATCH: 30, GPS_MISMATCH: 25, COMMUNITY_FLAG: 20 };
const LEVEL_COLOR = { SAFE: 'var(--safe)', CAUTION: 'var(--caution)', ALERT: 'var(--alert)' };
const NOTE_LABEL = { reminder: 'Family schedule', alert: 'Alert', approval: 'Family wiki', info: 'Kinproof', photo: 'Home robot' };
const SRC_BADGE = { chatgpt: 'ChatGPT', claude: 'Claude', voice: 'Voice', local: 'Local AI' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_START = new Date(2026, 10, 9); // Mon 9 Nov 2026 (demo "today")

let calWho = 'all', script = 'scam', prompterOpen = false, prompterBase = 0;
const dismissed = new Set();
let S = null, wikiPage = 'dad', lastWikiPageHighlight = 0, lastVerdict;
const seenEvents = new Set(), newEvents = new Set(), seenLines = new Set(), newLines = new Set();

function flagNew(id, seen, fresh) {
  if (seen.has(id)) return;
  seen.add(id);
  if (S._primed) { fresh.add(id); setTimeout(() => fresh.delete(id), 2500); }
}

// ---------- utterance queue: keep order, one at a time ----------
const queue = [];
let draining = false;
async function sendUtterance(text) {
  if (!text) return;
  queue.push(text);
  if (draining) return;
  draining = true;
  while (queue.length) await api('/call/utterance', { text: queue.shift() });
  draining = false;
}

function renderSteps() {
  const c = S.call;
  const synced = S.ingest_log.some((l) => l.includes('synced'));
  const approved = S.events.length > 0 || S.ingest_log.some((l) => l.includes('wiki/'));
  const calling = c.active || c.transcript.length > 0;
  const confirmed = !!c.verdict;
  const done = { 1: synced, 2: approved, 3: calling && (c.level !== 'SAFE' || confirmed), 4: confirmed };
  const active = !synced ? 1 : !approved ? 2 : !confirmed ? 3 : 4;
  document.querySelectorAll('.step').forEach((el) => {
    const n = +el.dataset.step;
    el.className = 'step' + (done[n] ? ' done' : n === active ? ' active' : '');
  });
  if (c.verdict !== lastVerdict) {
    if (c.verdict === 'blocked' && lastVerdict !== undefined) { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
    lastVerdict = c.verdict;
  }
}

function botCard(kind, title, body, ts, extra = '') {
  return `<div class="bot"><div class="pf">K</div><div class="col"><div class="name">Kinproof</div>
    <div class="card ${kind}"><div class="card-top">${esc(title)}</div><div class="card-body">${body}</div>${extra}</div>
    <div class="t">${esc(ts || '')}</div></div></div>`;
}

function renderCall() {
  const c = S.call;
  const live = c.active || c.transcript.length;
  $('call-card').className = 'call ' + (live ? c.level : 'idle');
  $('caller').textContent = c.active ? `Incoming · ${c.caller}` : (c.transcript.length ? `Call ended · ${c.caller}` : 'No active call');
  $('caller-avatar').textContent = c.verdict === 'blocked' ? '✕' : c.verdict === 'verified' ? '✓' : '?';
  $('claimed').innerHTML = c.claimed ? `Claims to be <b>${c.claimed === 'authority' ? 'an authority' : esc(S.members[c.claimed].name_en)}</b>` : (c.active ? 'Listening…' : '');
  $('score').textContent = c.score;
  $('score').style.color = live ? LEVEL_COLOR[c.level] : '';
  const arc = $('gauge-arc');
  arc.style.strokeDashoffset = 169.6 * (1 - c.score / 100);
  arc.style.stroke = LEVEL_COLOR[c.level];
  $('level').textContent = c.level;
  $('level').className = 'level-pill ' + c.level;
  $('busy').textContent = c.busy ? 'analyzing' : '';

  const v = $('verdict');
  const who = c.claimed && S.members[c.claimed] ? S.members[c.claimed].name_en : '';
  if (c.verdict === 'blocked') { v.className = 'verdict blocked'; v.textContent = `This is NOT ${who}. Call blocked.`; }
  else if (c.verdict === 'verified') { v.className = 'verdict verified'; v.textContent = `Verified: it's really ${who}`; }
  else if (c.degraded) { v.className = 'verdict degraded'; v.textContent = '⚠ Guardian degraded, family alerted'; }
  else v.className = 'verdict hidden';

  const tr = $('transcript');
  const before = tr._h;
  tr.html = c.transcript.map((u) => `<div class="msg"><div class="pf">?</div><div class="b">${esc(u.text)}</div><div class="t">${u.t.toFixed(1)}s</div></div>`).join('');
  if (tr._h !== before) tr.lastElementChild?.scrollIntoView({ block: 'nearest' });

  $('signals').html = c.signals.map((s) => {
    const cls = s.by === 'code' ? 'code' : (s.type === 'CONTEXT_CONTRADICTION' ? 'wiki' : '');
    const wq = s.wiki_quote ? `<div class="wq">📚 wiki/${esc(s.wiki_page)}.md, “${esc(s.wiki_quote)}”</div>` : '';
    return `<div class="chip ${cls}"><span class="pts">+${WEIGHTS[s.type] ?? ''}${s.by === 'code' ? ' · code' : ''}</span>
      <div class="type">${esc(TYPE_LABEL[s.type] || s.type)}</div>
      <div class="q">“${esc(s.quote)}”</div><div class="en">${esc(s.quote_en)}</div>${wq}</div>`;
  }).join('');
  $('dropped').textContent = c.dropped.length ? `${c.dropped.length} model claim(s) dropped, evidence not found in source` : '';
}

function renderPeople() {
  for (const m of Object.keys(S.members)) {
    const feed = $('feed-' + m);
    if (feed) feed.html = S.notifications.filter((n) => n.member === m && n.kind !== 'confirm_request').slice().reverse()
      .map((n) => botCard(n.kind, NOTE_LABEL[n.kind] || n.kind, esc(n.text) + (n.photos ? `<div class="photos">${n.photos.map((src, i) =>
        `<figure><img src="${src}" alt="${i ? 'after' : 'before'}"><figcaption>${i ? 'After' : 'Before'}</figcaption><span class="cam">simulated cam</span></figure>`).join('')}</div>` : ''), n.ts)).join('');
    const ap = $('approvals-' + m);
    if (ap) ap.html = S.approvals.filter((a) => a.member === m).map((a) => {
      const p = a.payload;
      const what = a.kind === 'fact'
        ? `<b>${esc(p.text)}</b><div class="card-src">→ wiki/${esc(p.about)}.md</div>`
        : `<b>${esc(p.title)}</b><br>${esc(p.date)} ${esc(p.time || '')}<div class="card-src">→ remind ${p.notify.map((n) => esc(S.members[n.member]?.name_en || n.member)).join(', ')}</div>`;
      const body = `${what}<div class="card-src">from your ${esc(SRC_BADGE[a.source] || a.source)} chat: “${esc(p.source_quote)}”</div>`;
      const btns = `<div class="card-btns"><button class="share" data-appr="${a.id}" data-d="approve">Share with family</button>
        <button data-appr="${a.id}" data-d="reject">Keep private</button></div>`;
      return botCard('ask', a.kind === 'fact' ? 'Share this fact?' : 'Add to family schedule?', body, '', btns);
    }).join('');
  }
  // SMS / app notifications on Grandma's phone
  $('msgs-grandma').html = (S.messages || []).filter((m) => m.member === 'grandma').slice(0, 4).map((m) =>
    `<div class="sms ${m.risk}"><div class="from"><span>📩 ${esc(m.sender)}</span><span>${esc(m.ts)}</span></div><div class="body">${esc(m.text)}</div>
     <span class="verdict">${m.risk === 'high' ? '⚠ ' + esc(m.reasons.join(' · ')) : m.risk === 'watch' ? '👀 ' + esc(m.reasons.join(' · ')) : '✓ OK'}</span>${m.held ? ' <span class="verdict">🏦 hold requested</span>' : ''}</div>`).join('');

  // one-tap 112 report offer (family confirms; never automatic)
  const reported = (k) => (S.reports || []).some((r) => r.kind === k);
  const offers = [];
  if (S.call.verdict === 'blocked' && !reported('scam')) {
    const q = S.call.signals.filter((s) => s.by !== 'code').length;
    offers.push(botCard('report', '🚨 Report to 112?', `<b>Voice-phishing evidence pack ready</b><div class="pack">📞 ${esc(S.call.caller)} · 🕐 ${esc(S.call.transcript.length ? 'today' : '')} · 💬 ${q} verified quotes · 🧠 reasons attached</div>`, '',
      `<div class="card-btns"><button class="r112" data-report="scam">Report to 112</button><button data-dismiss="scam">Not now</button></div>`));
  }
  if (S.call.verdict === 'blocked' && !S.call.shared) {
    offers.push(botCard('ask', '👥 Warn nearby families?', `<b>Share this scam pattern with ${S.community.families} Kinproof families in ${esc(S.community.area)}</b><div class="pack">pattern + masked number only · no names, no recording</div>`, '',
      `<div class="card-btns"><button class="share" data-share="1">Share pattern</button><button data-dismiss="share">Not now</button></div>`));
  }
  if ((S.drone || {}).event === 'wander' && !reported('wander')) {
    offers.push(botCard('report', '🚨 Grandma out alone at night', `<b>Ask 112 for help finding her?</b><div class="pack">📍 drone live location attached</div>`, '',
      `<div class="card-btns"><button class="r112" data-report="wander">Request 112</button><button data-dismiss="wander">She's OK</button></div>`));
  }
  for (const msg of (S.messages || []).filter((x) => x.risk === 'high' && ['transfer', 'payment'].includes(x.kind) && !x.held)) {
    offers.push(botCard('report', '💸 Hold this transfer?', `<b>${msg.amount.toLocaleString()}원 left Grandma's account</b><div class="pack">${esc(msg.reasons.join(' · '))} · ${esc(msg.sender)}</div>`, '',
      `<div class="card-btns"><button class="r112" data-hold="${msg.id}">Ask bank to hold</button><button data-dismiss="hold">Not now</button></div>`));
  }
  for (const m of ['mom', 'dad']) {
    const el = $('offers-' + m);
    if (el) el.html = dismissed.has(S.call.caller + m) ? '' : offers.join('');
  }
  const room = $('feed-mom')?.closest('.room');
  document.querySelectorAll('.room').forEach((r) => { if (r._n !== r.scrollHeight) { r._n = r.scrollHeight; } });

  for (const m of ['jihoon', 'dad']) {
    const v = S.members[m], el = $('presence-label-' + m);
    if (el) el.innerHTML = (v.on_call ? '📞 On a call' : '📵 Not on a call') + (v.dnd && !v.on_call ? `<span class="dnd">🔕 ${esc(v.status || 'At work')} · Do Not Disturb</span>` : '');
  }
  const c = S.call;
  const claimed = c.claimed && S.members[c.claimed] && c.claimed !== 'grandma' ? c.claimed : null;
  const req = c.confirm_requested && claimed && !c.verdict;
  const box = $('confirm-box');
  if (claimed && box.parentElement.id !== 'p-' + claimed) $('p-' + claimed)?.appendChild(box);
  box.className = 'confirm' + (req ? '' : ' hidden');
  if (req) $('confirm-text').textContent = `Someone claiming to be you is on the phone with Grandma right now.`;
}


const EV_EMOJI = [[/병원|MRI|진료/, '🏥'], [/방문|댁/, '🏠'], [/저녁|밥|식사|점심/, '🍽'], [/회의/, '👨‍👩‍👦'], [/약/, '💊']];
const evEmoji = (e) => e.emoji || (EV_EMOJI.find(([re]) => re.test(e.title)) || [, '📌'])[1];
const involves = (e, m) => e.owner === m || (e.involves || []).includes(m);
const dayLabel = (iso) => { const d = new Date(iso + 'T00:00'); return `${DOW[(d.getDay() + 6) % 7]} ${d.getMonth() + 1}/${d.getDate()}`; };
const sortEv = (a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99'));

function renderMySched() {
  for (const m of Object.keys(S.members)) {
    const el = $('mysched-' + m);
    if (!el) continue;
    const all = S.events.filter((e) => involves(e, m)).sort(sortEv);
    if (m === 'grandma' && (S.call.active || S.call.transcript.length)) { el.html = ''; continue; }   // the call owns the screen
    const evs = all.slice(0, 3);
    const more = all.length > 3 ? `<div class="it" style="color:var(--faint)">+${all.length - 3} more this week</div>` : '';
    el.html = evs.length ? `<div class="h">📅 My week</div>` + evs.map((e) =>
      `<div class="it"><span class="dot bg-${e.owner}"></span><span class="d">${dayLabel(e.date)}</span><span>${evEmoji(e)} ${esc(e.title)}${e.time ? ' · ' + esc(e.time) : ''}</span></div>`).join('') + more : '';
  }
}

function renderAgenda() {
  const evs = S.events.filter((e) => calWho === 'all' || involves(e, calWho)).sort(sortEv);
  document.querySelectorAll('#cal-filter button').forEach((b) => b.classList.toggle('on', b.dataset.who === calWho));
  $('agenda').html = evs.map((e) => {
    const people = [e.owner, ...(e.involves || [])].filter((v, i, a) => a.indexOf(v) === i).map((m) => S.members[m]?.name_en || m).join(' + ');
    const ck = (e.confirmed_by || []).length ? `<span class="ck">✓ ${esc(e.confirmed_by.join(', '))}</span>` : '';
    return `<div class="ag"><div class="when bg-${e.owner}">${dayLabel(e.date)}<small>${esc(e.time || 'all day')}</small></div>
      <div class="what"><b>${esc(e.title)}</b><span class="who">${esc(people)}</span></div>${ck}</div>`;
  }).join('') || `<div class="dropped" style="color:var(--faint)">No events yet, sync a family member's AI chat.</div>`;
}

function renderPrompter() {
  const box = $('prompter');
  const lines = (S.scripts || {})[script] || [];
  box.classList.toggle('hidden', !prompterOpen || !lines.length);
  if (!prompterOpen) return;
  document.querySelectorAll('[data-script]').forEach((b) => b.classList.toggle('on', b.dataset.script === script));
  $('prompter-title').textContent = { scam: 'Scammer as Dad', scam_teen: 'Scammer as Ji-hoon (15)', real_dad: 'The real Dad' }[script] || script;
  const said = Math.max(0, S.call.transcript.length - prompterBase);
  $('prompter-lines').html = lines.map((l, i) => `<div class="pl ${i < said ? 'done' : i === said ? 'now' : ''}">${esc(l)}</div>`).join('')
    + (said >= lines.length ? '<div class="pl now">Done, press End call and save it</div>' : '');
}


function renderIdCheck() {
  const c = S.call, el = $('idcheck');
  const m = c.claimed && S.members[c.claimed] ? c.claimed : null;
  if (!m || m === 'grandma') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const who = S.members[m].name_en;
  const types = new Set(c.signals.map((s) => s.type));
  const row = (st, icon, label, detail) => `<div class="ck ${st}"><span class="ic">${icon}</span>${label}<span class="dt">${detail}</span></div>`;
  const onCall = S.members[m].on_call;
  const rows = [
    row('neutral', '🎙', `Voice sounds like ${who}`, 'not trusted, clones sound the same'),
    row(onCall ? 'ok' : 'bad', onCall ? '✓' : '✗', `${who}'s phone is on a call`, onCall ? 'yes' : 'no, not calling anyone'),
    c.claimed_location
      ? row(types.has('GPS_MISMATCH') ? 'bad' : 'ok', types.has('GPS_MISMATCH') ? '✗' : '✓', 'Location matches GPS', `says ${esc(c.claimed_location)} · GPS ${esc(S.members[m].gps)}`)
      : row('', '–', 'Location matches GPS', `GPS ${esc(S.members[m].gps)}`),
    row(types.has('CONTEXT_CONTRADICTION') ? 'bad' : 'ok', types.has('CONTEXT_CONTRADICTION') ? '✗' : '✓', 'Story matches family wiki', types.has('CONTEXT_CONTRADICTION') ? 'contradiction' : 'consistent'),
    c.verdict ? row(c.verdict === 'verified' ? 'ok' : 'bad', c.verdict === 'verified' ? '✓' : '✗', `${who} confirmed`, c.verdict === 'verified' ? "“It's me”" : '“Not me”')
      : row(c.confirm_requested ? 'wait' : '', c.confirm_requested ? '…' : '–', `${who} confirmed`, c.confirm_requested ? 'asked, waiting' : 'not needed'),
  ];
  const bad = rows.filter((r) => r.includes('ck bad')).length;
  const verdict = c.verdict === 'blocked' || bad >= 2 ? `<div class="idverdict bad">✗ Not ${who}</div>`
    : c.verdict === 'verified' || (bad === 0 && onCall) ? `<div class="idverdict ok">✓ This is really ${who}</div>` : '';
  el.html = `<div class="ttl">Is this really ${who}?</div>${rows.join('')}${verdict}`;
}

let yardTimer = null, robotTimer = null;
// 34평 (84㎡) 3-room apartment, viewBox 380x190
const ZONES = { 'front door': [48, 168] };
const ROBOT_AT = { docked: [176, 150], start: [176, 150], water: [96, 62], pills: [214, 92], deliver: [268, 132], taken: [268, 132], no_answer: [268, 132] };
let homeMode = 'in';
function renderOutside() {
  const d = S.drone || { event: 'patrol' };
  const ev = d.event;
  // drone flies a patrol loop; on an event it hovers over the target
  const target = ev === 'stranger' ? [96, 120] : ev === 'wander' ? [318, 52] : null;
  const droneEl = target
    ? `<g transform="translate(${target[0] - 10},${target[1] - 34})"><text font-size="18">🚁</text></g><circle class="scan" cx="${target[0]}" cy="${target[1]}" r="8" fill="${ev === 'stranger' ? '#f03e3e' : '#fab005'}"/>`
    : `<text font-size="18">🚁<animateMotion dur="9s" repeatCount="indefinite" path="M60,40 L330,40 L330,165 L60,165 Z"/></text>`;
  const person = ev === 'stranger' ? `<text x="88" y="128" font-size="15">🕵</text><text x="106" y="140" font-size="9.5" font-weight="800" fill="#c92a2a">loitering 5 min</text>`
    : ev === 'wander' ? `<text x="310" y="60" font-size="15">👵</text><path d="M120 118 Q 200 110 310 56" stroke="#fab005" stroke-width="2" stroke-dasharray="4 4" fill="none"/><text x="230" y="80" font-size="9.5" font-weight="800" fill="#e67700">23:40 alone → bus stop</text>`
    : ev === 'home' ? `<text x="112" y="118" font-size="13">👵✓</text>` : '';
  const st = { patrol: '🚁 Patrolling the complex', stranger: '⚠ Stranger at 101동 entrance, photo sent to Mom & Dad', wander: '⚠ Grandma out alone at night, drone following, family has live location', home: '✓ Grandma back home' }[ev] || '';
  $('yard').html = `<svg viewBox="0 0 380 190" preserveAspectRatio="xMidYMid meet" font-family="inherit">
    <rect x="6" y="6" width="368" height="178" rx="12" fill="#e9f5e1" stroke="#8ce99a" stroke-width="2"/>
    <rect x="6" y="176" width="368" height="8" fill="#ced4da"/><text x="300" y="172" font-size="9" fill="#868e96">road · 정문</text>
    <rect x="70" y="70" width="70" height="44" rx="4" fill="#fff" stroke="#adb5bd" stroke-width="2"/><text x="84" y="96" font-size="11" font-weight="800">101동 👵</text>
    <rect x="160" y="70" width="70" height="44" rx="4" fill="#fff" stroke="#dee2e6"/><text x="178" y="96" font-size="10" fill="#868e96">102동</text>
    <rect x="250" y="100" width="70" height="44" rx="4" fill="#fff" stroke="#dee2e6"/><text x="268" y="126" font-size="10" fill="#868e96">103동</text>
    <rect x="86" y="114" width="24" height="8" fill="#ffd8a8"/><text x="70" y="134" font-size="8.5" fill="#868e96">entrance</text>
    <rect x="160" y="130" width="70" height="30" rx="4" fill="#f1f3f5"/><text x="172" y="149" font-size="9" fill="#868e96">🅿 parking</text>
    <circle cx="44" cy="40" r="16" fill="#b2f2bb"/><text x="30" y="66" font-size="8.5" fill="#868e96">playground</text>
    <rect x="300" y="30" width="56" height="14" rx="4" fill="#fff3bf"/><text x="304" y="40" font-size="8.5" fill="#868e96">🚏 bus stop</text>
    ${person}${droneEl}
  </svg><div class="yard-status">${st}</div>`;
}

function renderYard() {
  if (view !== 'hub') return;
  document.querySelectorAll('[data-homemode]').forEach((b) => b.classList.toggle('on', b.dataset.homemode === homeMode));
  $('home-in-btns').classList.toggle('hidden', homeMode !== 'in');
  $('home-out-btns').classList.toggle('hidden', homeMode !== 'out');
  if (homeMode === 'out') { renderOutside(); return; }
  const p = S.perimeter || {}, r = S.robot || { stage: 'docked' };
  const [zx, zy] = ZONES[p.zone] || ZONES['front door'];
  const person = p.zone ? `<g><circle class="scan" cx="${zx}" cy="${zy}" r="6" fill="${p.known === false ? '#f03e3e' : '#fab005'}"/>
    <circle cx="${zx}" cy="${zy}" r="6" fill="${p.known === false ? '#f03e3e' : '#fab005'}"/><text x="${zx + 9}" y="${zy + 4}" font-size="10" font-weight="700" fill="#c92a2a">${p.known === false ? 'unknown' : 'someone'}</text></g>` : '';
  const sp = (S.spill || {}).stage || 'none';
  const [rx, ry] = ['detect', 'cleaning'].includes(sp) ? [60, 70] : (ROBOT_AT[r.stage] || ROBOT_AT.docked);
  const carry = ['pills', 'deliver', 'taken', 'no_answer'].includes(r.stage) ? '🥤💊' : r.stage === 'water' ? '🥤' : '';
  const spillSt = { detect: '📸 Water on kitchen floor, fall risk', cleaning: '🧽 Mopping…', done: '✓ Floor dry, photos sent to Mom' }[sp];
  const robotSt0 = { docked: '🤖 Robot charging', start: '🤖 Medicine time, to the kitchen', water: '🤖 Got water', pills: `🤖 Got today's ${r.med}`,
    deliver: '🤖 Delivered, “약 드셨어요?”', taken: `✓ Grandma took ${r.med}`, no_answer: '⚠ No answer, Mom alerted' }[r.stage] || '';
  const robotSt = spillSt && sp !== 'done' ? spillSt : robotSt0;
  const doorSt = p.status === 'docked' ? '' : p.status === 'dispatched' ? ' · 🚪 door camera checking…' : p.known ? ' · ✓ family at the door' : ' · ⚠ stranger at the door, Mom alerted';
  const washing = (S.ingest_log || []).some((l) => l.includes('washer'));
  const home = S.home || { bath: {}, lights: {}, speaker: '' };
  const bath = home.bath || {};
  const bathLevel = bath.status === 'ready' ? 1 : bath.status === 'filling' ? Math.min(0.95, (Date.now() / 1000 - (bath.since || 0)) / 8) : 0;
  const ROOM_BOX = { 주방: [6, 6, 130, 80], 작은방1: [136, 6, 96, 80], 안방: [232, 6, 88, 80], 거실: [136, 86, 238, 98], 작은방2: [6, 86, 70, 62] };
  const lightsOff = Object.entries(ROOM_BOX).filter(([r]) => home.lights && home.lights[r] === false).map(([, [x, y, w, h]]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#343a40" opacity=".28"/>`).join('');
  $('yard').html = `<svg viewBox="0 0 380 190" preserveAspectRatio="xMidYMid meet" font-family="inherit">
    <rect x="6" y="6" width="368" height="178" rx="10" fill="#f8f9fa" stroke="#868e96" stroke-width="3"/>
    <!-- rooms -->
    <rect x="6" y="6" width="130" height="80" fill="#fff4e6" stroke="#ced4da"/><text x="14" y="22" font-size="10" fill="#868e96">주방·식탁 🚰</text>
    <rect x="136" y="6" width="96" height="80" fill="#fff" stroke="#ced4da"/><text x="144" y="22" font-size="10" fill="#868e96">작은방 1</text>
    <rect x="232" y="6" width="142" height="80" fill="#fff" stroke="#ced4da"/><text x="240" y="22" font-size="10" fill="#868e96">안방</text>
    <rect x="320" y="6" width="54" height="42" fill="#e7f5ff" stroke="#ced4da"/><text x="326" y="22" font-size="9" fill="#868e96">욕실</text>
    <rect x="326" y="28" width="42" height="16" rx="5" fill="#fff" stroke="#74c0fc"/>
    <rect x="328" y="${44 - bathLevel * 14}" width="38" height="${bathLevel * 14}" rx="3" fill="#74c0fc"><title>bath</title></rect>
    <text x="330" y="40" font-size="9">${bath.status === 'ready' ? '🛁 ' + bath.temp + '°' : bath.status === 'filling' ? '💧' + bath.temp + '°' : '🛁'}</text>
    <rect x="136" y="86" width="238" height="98" fill="#fff" stroke="#ced4da"/><text x="300" y="104" font-size="10" fill="#868e96">거실</text>
    <rect x="6" y="86" width="70" height="62" fill="#fff" stroke="#ced4da"/><text x="14" y="102" font-size="10" fill="#868e96">작은방 2</text>
    <rect x="76" y="86" width="60" height="44" fill="#e7f5ff" stroke="#ced4da"/><text x="82" y="102" font-size="9" fill="#868e96">욕실</text>
    <rect x="6" y="148" width="80" height="36" fill="#f1f3f5" stroke="#ced4da"/><text x="14" y="163" font-size="10" fill="#868e96">현관 🚪</text>
    <rect x="136" y="184" width="238" height="0" stroke="#74c0fc" stroke-width="6"/><text x="320" y="178" font-size="9" fill="#4dabf7">베란다 ${washing ? '🧺✓' : '🧺'}</text>
    <rect x="200" y="84" width="28" height="12" rx="3" fill="#ffe8cc"/><text x="203" y="94" font-size="8">💊</text>
    ${lightsOff}
    ${['detect', 'cleaning'].includes(sp) ? `<ellipse cx="44" cy="72" rx="${sp === 'cleaning' ? 8 : 14}" ry="${sp === 'cleaning' ? 4 : 7}" fill="#74c0fc" opacity=".8"/><text x="22" y="62" font-size="9" font-weight="800" fill="#1c7ed6">💧 wet floor</text>` : ''}
    <text x="150" y="176" font-size="15">🔊</text>${home.speaker ? `<g><rect x="166" y="158" width="${Math.min(200, home.speaker.length * 7 + 14)}" height="20" rx="8" fill="#191919"/><text x="173" y="172" font-size="9.5" fill="#fff">${esc(home.speaker.slice(0, 26))}${home.speaker.length > 26 ? '…' : ''}</text></g>` : ''}
    <!-- grandma on sofa -->
    <rect x="252" y="140" width="56" height="14" rx="4" fill="#ffd8a8"/><text x="268" y="138" font-size="20">👵</text>
    <g class="robot" style="transform:translate(${rx - 176}px,${ry - 150}px)"><text x="166" y="158" font-size="18">🤖</text><text x="184" y="146" font-size="10">${carry}</text></g>
    ${person}
  </svg><div class="yard-status">${robotSt}${doorSt}${bath.status === 'filling' ? ' · 🛁 filling…' : ''}</div>`;
}

function renderWiki() {
  // calendar
  const days = [...Array(7)].map((_, i) => { const d = new Date(WEEK_START); d.setDate(d.getDate() + i); return d; });
  $('cal-title').textContent = `Nov ${days[0].getDate()} – ${days[6].getDate()}, 2026`;
  S.events.forEach((e) => flagNew(e.id, seenEvents, newEvents));
  $('calendar').html = days.map((d, i) => {
    const iso = `2026-11-${String(d.getDate()).padStart(2, '0')}`;
    const evs = S.events.filter((e) => e.date === iso).map((e) =>
      `<div class="ev o-${e.owner} ${newEvents.has(e.id) ? 'new' : ''} ${e.done ? 'done' : ''} ${calWho !== 'all' && !involves(e, calWho) ? 'dim' : ''}" title="confirmed by ${esc((e.confirmed_by || []).join(', '))}">
        ${evEmoji(e)} ${esc(e.title)}<span class="tm">${esc(e.time || 'all day')}${(e.confirmed_by || []).length > 1 ? ' · ✓✓' : ''}</span></div>`).join('');
    return `<div class="day ${i === 0 ? 'today' : ''} ${i === 5 ? 'sat' : ''} ${i === 6 ? 'sun' : ''}">
      <div class="day-h">${DOW[i]}</div><div class="day-n">${d.getDate()}</div>${evs}</div>`;
  }).join('');

  // wiki page
  const pages = Object.keys(S.wiki);
  const hl = S.wiki_highlights;
  if (hl.length > lastWikiPageHighlight) { wikiPage = hl[hl.length - 1].page; lastWikiPageHighlight = hl.length; }
  if (!pages.includes(wikiPage)) wikiPage = pages[0];
  $('wiki-tabs').html = pages.map((p) => `<button class="${p === wikiPage ? 'on' : ''}" data-page="${p}">${p}.md</button>`).join('');
  const lines = (S.wiki[wikiPage] || '').split('\n').filter((l) => l.trim());
  $('wiki-body').html = lines.map((raw) => {
    const m = raw.match(/<!--\s*src:\s*([^·]+?)\s*·\s*(.*?)-->/);
    let text = esc(raw.replace(/<!--.*?-->/, '').trim());
    for (const h of hl.filter((h) => h.page === wikiPage)) {
      const q = esc(h.quote.replace(/^[-\s]+/, ''));
      if (q && text.includes(q)) text = text.split(q).join(`<mark>${q}</mark>`);
    }
    if (text.startsWith('# ')) return `<div class="md-h">${text.slice(2)}</div>`;
    const key = wikiPage + raw;
    flagNew(key, seenLines, newLines);
    let badge = '';
    if (m) {
      const src = (m[1].match(/(chatgpt|claude|voice|local)/) || [])[1];
      badge = `<span class="srcb ${src || ''}">${SRC_BADGE[src] || 'chat'} · ${esc(m[2].trim())}</span>`;
    }
    return `<div class="md-li ${newLines.has(key) ? 'new' : ''}">${text.replace(/^- /, '')}${badge}</div>`;
  }).join('');
  $('log').html = S.ingest_log.slice(0, 14).map(esc).join('<br>');
}

function render() {
  if (!S) return;
  renderSteps();
  $('mode').textContent = S.mode.toUpperCase();
  $('mode').className = 'badge' + (S.mode === 'replay' ? ' replay' : '');
  renderCall();
  renderPeople();
  renderWiki();
  renderMySched();
  renderAgenda();
  renderPrompter();
  renderHub();
  renderIdCheck();
  renderYard();
  renderMap();
  renderCommunity();
  renderOnboarding();
  renderReason();
  renderTopics();
  const sel = $('replay-select');
  const opts = '<option value="">Replay…</option>' + S.recordings.map((r) => `<option>${r}</option>`).join('');
  if (sel.dataset.v !== opts) { sel.innerHTML = opts; sel.dataset.v = opts; }
  S._primed = true;
}

async function poll() {
  try { const prev = S && S._primed; S = await api('/state'); S._primed = prev; render(); } catch (e) { console.error(e); }
  setTimeout(poll, 600);
}

// ---------- actions ----------
let callListening = false;
$('btn-call').onclick = async () => {
  if (STT.running) { STT.stop(); callListening = false; return; }
  script = S.members.dad.on_call ? 'real_dad' : 'scam';
  await api('/call/start', { caller: script === 'scam' ? '010-****-7741' : '010-****-2231' });
  prompterBase = 0; prompterOpen = true;
  callListening = true;
  STT.start({ onFinal: sendUtterance, onInterim: (t) => ($('interim').textContent = t) });
};
$('btn-end').onclick = async () => {
  STT.stop(); callListening = false;
  // no prompt(): it is blocked in some embedded browsers. Blocked / impersonated calls save as "scam", others as "real".
  const c = S && S.call;
  const name = c && c.transcript.length ? (c.verdict === 'blocked' || (c.claimed && S.members[c.claimed] && !S.members[c.claimed].on_call) ? 'scam' : 'real') : null;
  await api('/call/end', { save_as: name || null });
};
$('btn-reset').onclick = async () => {
  STT.stop(); callListening = false; lastWikiPageHighlight = 0;
  seenEvents.clear(); seenLines.clear();
  await api('/reset', {});
};
document.addEventListener('click', (e) => { const b = e.target.closest('[data-presence]'); if (b) api('/presence', { member: b.dataset.presence, on_call: !S.members[b.dataset.presence].on_call }); });
$('btn-its-me').onclick = () => api('/call/confirm', { member: S.call.claimed, is_me: true });
$('btn-not-me').onclick = () => api('/call/confirm', { member: S.call.claimed, is_me: false });

// Grandma just talks: plans go straight to the family schedule, questions get answered out loud.
let planBuf = [];
$('btn-voice-plan').onclick = async () => {
  const btn = $('btn-voice-plan');
  if (STT.running && !callListening) {
    STT.stop();
    const text = planBuf.join(' ').trim();
    planBuf = [];
    if (!text) { btn.className = 'bigmic'; btn.textContent = '🎤 할머니, 말로 하세요'; return; }
    btn.className = 'bigmic think'; btn.textContent = '…생각 중';
    const r = await api('/voice', { member: 'grandma', text });
    btn.className = 'bigmic'; btn.textContent = '🎤 할머니, 말로 하세요';
    if (r.reply) STT.say(r.reply);
    return;
  }
  if (STT.running) return;
  planBuf = [];
  btn.className = 'bigmic rec'; btn.textContent = '⏹ 다 말했어요';
  STT.start({ onFinal: (t) => planBuf.push(t), onInterim: (t) => ($('interim').textContent = t) });
};

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.sync) await api('/sync/' + t.dataset.sync, {});
  if (t.dataset.appr) await api('/approvals/' + t.dataset.appr, { decision: t.dataset.d });
  if (t.dataset.page) { wikiPage = t.dataset.page; render(); }
  if (t.dataset.done) await api(`/events/${t.dataset.done}/done`, {});
  if (t.dataset.who) { calWho = t.dataset.who; render(); }
  if (t.dataset.script) { script = t.dataset.script; prompterBase = S.call.transcript.length; prompterOpen = true; render(); }
  if (t.id === 'prompter-close') { prompterOpen = false; render(); }
});

// ---------- replay: recorded utterances, original timing, same server path ----------
let replayAudio = null;
async function replay(name) {
  const rec = await api('/recordings/' + name);
  await api('/call/start', { caller: rec.caller });
  if (replayAudio) { replayAudio.pause(); replayAudio = null; }
  if (rec.audio) { replayAudio = new Audio(rec.audio); replayAudio.play().catch((e) => console.warn('audio blocked', e)); }
  const t0 = performance.now();
  for (const u of rec.utterances) {
    const wait = u.t * 1000 - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await sendUtterance(u.text);
  }
}
$('replay-select').onchange = (e) => { if (e.target.value) replay(e.target.value); e.target.value = ''; };
const qp = new URLSearchParams(location.search).get('replay');
if (qp) setTimeout(() => replay(qp), 800);

if (!STT.supported) console.warn('Web Speech not supported: use Chrome');
STT.say = () => {};   // no TTS: the presenter speaks; machine voices would be picked up by the mic
// ---------- Family hub (layout from the iPad sketch) ----------
let view = 'demo', hubMe = 'mom', todoMode = 'todo';
const MEMBER_COLOR = { grandma: '#ff922b', mom: '#f06595', jihoon: '#339af0', dad: '#495057' };
function renderChores() {
  const all = S.chores || [];
  const ids = Object.keys(S.members);
  const counts = ids.map((m) => [m, all.filter((c) => c.member === m).length]);
  const total = all.length || 1;
  const bar = `<div class="share">${counts.map(([m, n]) => `<i style="width:${(n / total) * 100}%;background:${MEMBER_COLOR[m] || '#adb5bd'}"></i>`).join('')}</div>
    <div class="share-legend">${counts.map(([m, n]) => `<span>${S.members[m].emoji} <b>${n}</b></span>`).join('')}<span style="margin-left:auto">family share this week</span></div>`;
  const mine = all.filter((c) => c.member === hubMe);
  $('hub-todos').html = bar + (mine.map((c) => `<div class="todo chore ${c.done ? 'done' : ''}" data-chore="${c.id}"><span class="box">${c.done ? '✓' : ''}</span>
    <span class="tx">${c.emoji || '🧹'} ${esc(c.title)}</span><span class="days">${esc(c.days)}</span></div>`).join('') || '<div class="empty" style="color:var(--faint)">No chores assigned.</div>');
}
const AV_BG = { grandma: '#fff4e6', mom: '#fff0f6', jihoon: '#e7f5ff' };

function myTodos(m) {
  const items = [];
  for (const e of S.events) if (e.owner === m) items.push({ id: 'e:' + e.id, text: e.title, when: `${dayLabel(e.date)} ${e.time || ''}`, done: e.done, sort: e.date + (e.time || '99') });
  for (const n of S.notifications) if (n.member === m && n.kind === 'reminder') {
    const ev = S.events.find((e) => e.id === n.event);
    items.push({ id: 'n:' + n.id, text: n.text, when: ev ? `${dayLabel(ev.date)} ${ev.time || ''}` : '', done: n.done, sort: ev ? ev.date + (ev.time || '99') : 'z' });
  }
  return items.sort((a, b) => a.sort.localeCompare(b.sort));
}

function renderCallbar() {
  const c = S.call, el = $('hub-callbar');
  if (!c.active) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.className = 'callbar ' + c.level;
  const g = S.members.grandma.name_en;
  const claim = c.claimed ? `<small>claims to be ${esc(c.claimed === 'authority' ? 'an authority' : S.members[c.claimed]?.name_en || c.claimed)}</small>` : '<small>identifying…</small>';
  const last = c.transcript.slice(-2).map((u) => `<div>“${esc(u.text)}”</div>`).join('') || '<div>Transcribing…</div>';
  const vt = c.verdict ? `<div class="verdict-tag ${c.verdict === 'verified' ? 'ok' : ''}">${c.verdict === 'verified' ? '✓ verified' : '✕ blocked'}</div>` : '';
  el.html = `<div class="ph">📞</div><div><div class="who">${c.active ? `${esc(g)} is on a call with ${esc(c.caller)}` : `Call ended · ${esc(c.caller)}`}${claim}</div>
    <div class="lines">${last}</div>${(c.explain || [])[0] ? `<div class="why">🧠 ${esc(c.explain[0])}</div>` : ''}</div><div class="risk"><b>${c.score}</b><span>${c.level}</span>${vt}</div>`;
}

function renderHub() {
  if (view !== 'hub') return;
  renderCallbar();
  renderTimetable();
  const days = [...Array(7)].map((_, i) => { const d = new Date(WEEK_START); d.setDate(d.getDate() + i); return d; });
  $('hub-cal-title').textContent = `Nov ${days[0].getDate()} – ${days[6].getDate()}, 2026`;
  const c = S.call;
  $('hub-calendar').html = days.map((d, i) => {
    const iso = `2026-11-${String(d.getDate()).padStart(2, '0')}`;
    let evs = S.events.filter((e) => e.date === iso).sort(sortEv).map((e) => {
      const people = [e.owner, ...(e.involves || [])].filter((v, k, a) => a.indexOf(v) === k).map((m) => S.members[m]?.emoji || '').join(' ');
      const conf = (e.confirmed_by || []).map((w) => `<span>✓ ${esc(w)}</span>`).join('');
      const fresh = !e.seed ? '<span>✨ new from AI chat</span>' : '';
      return `<div class="hev o-${e.owner} ${e.seed ? 'seed' : 'synced'} ${window.__justEvent === e.id ? 'just' : ''}"><b>${evEmoji(e)} ${esc(e.title)}</b><div class="m">${esc(e.time || 'all day')} · ${people}</div><div class="badges">${fresh}${conf}</div></div>`;
    }).join('');
    if (i === 0 && c.verdict) {
      evs = `<div class="hev ${c.verdict === 'blocked' ? 'incident' : 'verified'}"><b>${c.verdict === 'blocked' ? '🚫 Scam call blocked' : '✅ Call verified'}</b>
        <div class="m">to Grandma · claimed ${esc(S.members[c.claimed]?.name_en || '')} · risk ${c.score}</div></div>` + evs;
    }
    return `<div class="hday ${i === 0 ? 'today' : ''} ${i === 5 ? 'sat' : ''} ${i === 6 ? 'sun' : ''}">
      <div class="hday-h"><span class="dow">${DOW[i]}</span>${i === 0 ? '<span class="tag-today">TODAY</span>' : ''}<span class="n">${d.getDate()}</span></div>${evs}</div>`;
  }).join('');

  $('hub-me').html = Object.entries(S.members).map(([m, v]) => `<button data-me="${m}" class="${m === hubMe ? 'on' : ''}">${v.emoji} ${esc(v.name_en)}</button>`).join('');
  document.querySelectorAll('[data-todomode]').forEach((b) => b.classList.toggle('on', b.dataset.todomode === todoMode));
  if (todoMode === 'chores') { renderChores(); }
  const todos = todoMode === 'chores' ? (S.chores || []).filter((c) => c.member === hubMe).map((c) => ({ done: c.done })) : myTodos(hubMe);
  if (todoMode !== 'chores') $('hub-todos').html = todos.map((t) => `<div class="todo ${t.done ? 'done' : ''}" data-todo="${t.id}"><span class="box">${t.done ? '✓' : ''}</span>
    <span class="tx">${esc(t.text)}<span class="when">${esc(t.when)}</span></span></div>`).join('') || '<div class="empty" style="color:var(--faint)">Nothing yet, sync an AI chat.</div>';

  $('hub-people').html = Object.entries(S.members).map(([m, v]) => {
    const claimedNow = c.active && c.claimed === m && !v.on_call;
    const st = m === 'grandma' && c.active ? `<span class="st ${c.level === 'ALERT' ? 'alert' : 'on'}">📞 on a call · risk ${c.score}</span>`
      : claimedNow ? '<span class="st alert">⚠ being impersonated</span>'
      : v.on_call ? '<span class="st on">📞 on a call</span>'
      : v.dnd ? `<span class="st dnd">🔕 ${esc(v.status || 'at work')}</span>` : `<span class="st">🏠 ${esc(v.status || 'available')}</span>`;
    return `<div class="person"><div class="av" style="background:${AV_BG[m] || '#f1f3f5'}">${v.emoji}</div>
      <div class="nm">${esc(v.name_en)}</div><div class="gps">📍 ${esc(v.gps || ', ')}</div>${st}</div>`;
  }).join('') + `<div class="person add" data-add-member="1"><span class="plus">＋</span>Add family</div>`;

  const done = todos.filter((t) => t.done).length, total = todos.length;
  const off = 282.7 * (1 - (total ? done / total : 0));
  $('hub-progress').html = `<div class="ring"><svg viewBox="0 0 104 104"><circle class="track" cx="52" cy="52" r="45"/>
    <circle class="arc" cx="52" cy="52" r="45" style="stroke-dashoffset:${off}"/></svg><div class="num">${done}/${total}</div></div>
    <div class="prog-tx"><b>${total - done} left</b><span>${todoMode === 'chores' ? 'chores' : 'to-dos'}</span></div>`;

  $('hub-log').html = S.ingest_log.slice(0, 60).map((l) => {
    const m = l.match(/^(\S+)\s+\[(\w+)\]\s+(.*)$/);
    return m ? `<div class="ln"><span class="ts">${m[1]}</span><span class="tg ${m[2]}">[${m[2]}]</span>${esc(m[3])}</div>` : `<div class="ln">${esc(l)}</div>`;
  }).join('');
}

function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  document.querySelector('.stage').scrollTop = 0;
  document.querySelector('.stage').classList.toggle('hidden', v !== 'demo');
  $('hub').classList.toggle('hidden', v !== 'hub');
  $('mapview').classList.toggle('hidden', v !== 'map');
  if (v === 'map' && lmap) setTimeout(() => lmap.invalidateSize(), 60);
  $('wikiview').classList.toggle('hidden', v !== 'wiki');
  $('communityview').classList.toggle('hidden', v !== 'community');
  render();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-view],[data-me],[data-todo],[data-add-member],[data-todomode],[data-chore]');
  if (!b) return;
  if (b.dataset.view) setView(b.dataset.view);
  if (b.dataset.me) { hubMe = b.dataset.me; render(); }
  if (b.dataset.todomode) { todoMode = b.dataset.todomode; render(); }
  if (b.dataset.chore) await api(`/chores/${b.dataset.chore}/done`, {});
  if (b.dataset.addMember) {
    const ask = (q, d) => { try { return prompt(q, d); } catch (_) { return d; } };
    const name_en = ask('Name (English)', 'Uncle');
    if (!name_en) return;
    const name = ask('이름 (한국어)', '삼촌') || name_en;
    const emoji = ask('Emoji', '🧔') || '🙂';
    const gps = ask('Location (GPS)', '서울 마포구') || '';
    await api('/members', { name_en, name, emoji, gps });
  }
  if (b.dataset.todo) {
    const [kind, id] = b.dataset.todo.split(':');
    await api(kind === 'e' ? `/events/${id}/done` : `/notifications/${id}/done`, {});
  }
});

$('btn-motion').onclick = async () => {
  const zone = 'front door';
  await api('/perimeter', { zone });
  clearTimeout(yardTimer);
  yardTimer = setTimeout(async () => {
    await api('/perimeter', { zone, known: false });
    yardTimer = setTimeout(() => api('/perimeter/dock', {}), 6000);
  }, 2200);
};

// ---------- family map (admin view, consent-gated) ----------
const PLACES = { '송파': [520, 250], '분당': [470, 400], '판교': [380, 380], '강남': [400, 250], '부산': null };
function placeXY(gps) { for (const [k, xy] of Object.entries(PLACES)) if (xy && gps.includes(k)) return xy; return [300, 200]; }
let lmap = null, lmarkers = {};
function renderMap() {
  if (view !== 'map') return;
  const ms = S.members, ids = Object.keys(ms);
  const agreed = ids.filter((m) => ms[m].share_location);
  const admin = ms.dad ? 'dad' : ids[0];
  $('map-viewer').textContent = `viewing as ${ms[admin].name_en} (family admin)`;
  $('map-count').textContent = `${agreed.length}/${ids.length} consented`;
  const unlocked = agreed.length === ids.length;
  const lock = unlocked ? '' : `<div class="lock">🔒 Map locked<span>Waiting for: ${ids.filter((m) => !ms[m].share_location).map((m) => esc(ms[m].name_en)).join(', ')}</span></div>`;

  if (window.L) {
    if (!lmap) {
      lmap = L.map('leaflet', { zoomControl: true, attributionControl: true }).setView([37.45, 127.08], 11);
      lmap.attributionControl.setPrefix('Leaflet');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(lmap);
      setTimeout(() => lmap.invalidateSize(), 50);
    }
    for (const m of ids) {
      const v = ms[m];
      if (!unlocked || v.lat == null) { if (lmarkers[m]) { lmarkers[m].remove(); delete lmarkers[m]; } continue; }
      const tip = `${esc(v.name_en)}${v.on_call ? ' · 📞 on a call' : ''}<small>${esc(v.gps || '')}</small>`;
      if (!lmarkers[m]) {
        lmarkers[m] = L.marker([v.lat, v.lng], { icon: L.divIcon({ className: `kp-pin ${m}`, html: v.emoji, iconSize: [40, 40] }) })
          .addTo(lmap).bindTooltip(tip, { permanent: true, direction: 'right', offset: [18, 0], className: 'kp-tip' });
      } else lmarkers[m].setTooltipContent(tip);
    }
    if (unlocked && Object.keys(lmarkers).length && !lmap._kpFit) {
      lmap.fitBounds(L.latLngBounds(Object.values(lmarkers).map((mk) => mk.getLatLng())).pad(0.25));
      lmap._kpFit = true;
    }
    if (!unlocked) lmap._kpFit = false;
    $('map').html = lock;
  } else {
    $('map').html = `<div class="lock" style="background:#eef3f7">🗺 Map tiles need internet<span>${ids.map((m) => `${esc(ms[m].emoji)} ${esc(ms[m].name_en)} · ${esc(ms[m].gps || '')}`).join('<br>')}</span></div>` + lock;
  }
  $('consent').html = ids.map((m) => `<div class="cs"><div class="av">${ms[m].emoji}</div><div><div class="nm">${esc(ms[m].name_en)}</div>
    <div class="rl">${esc(ms[m].role || '')}</div></div><button class="switch ${ms[m].share_location ? 'on' : ''}" data-consent="${m}" aria-label="share location"></button></div>`).join('');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-consent]');
  if (b) await api('/consent', { member: b.dataset.consent, share: !S.members[b.dataset.consent].share_location });
});

function renderOnboarding() {
  const ms = S.members, ids = Object.keys(ms);
  const ready = ids.filter((m) => ms[m].consented).length;
  for (const m of ids) {
    const ob = $('onboard-' + m);
    if (!ob) continue;
    ob.classList.toggle('hidden', !!ms[m].consented);
  }
  const all = ready === ids.length;
  const btn = $('btn-call');
  btn.disabled = !all && !STT.running;
  btn.title = all ? '' : `Waiting for family consent (${ready}/${ids.length})`;
  btn.textContent = STT.running && callListening ? '🔴 Listening… (stop)' : all ? '📞 Start live call' : `🔒 ${ready}/${ids.length} family agreed`;
}

function renderReason() {
  const c = S.call;
  const ex = c.explain || [];
  const el = $('reason');
  if (!el) return;
  el.html = ex[0] ? `<div class="reason-wrap"><div class="pf">K</div><div class="reason">${esc(ex[0])}<small>${esc(ex[1] || '')}</small></div></div>` : '';
}

function renderTopics() {
  for (const m of ['mom', 'jihoon', 'dad']) {
    const el = $('private-' + m);
    if (!el) continue;
    const mine = (S.private_topics || []).filter((p) => p.member === m);
    el.html = mine.length ? `<div class="sys">Kept private from your chat, only labels, never content</div>` + mine.map((p) =>
      `<div class="pt"><span>🔒</span><span class="lb">${esc(p.topic)}<small>${m === 'dad' ? 'only you can see this' : p.shared ? 'Dad can see this label' : 'only you can see this'}</small></span>
       ${m === 'dad' ? '' : `<button class="${p.shared ? 'on' : ''}" data-topic="${p.id}">${p.shared ? 'Shared' : 'Share label with Dad'}</button>`}</div>`).join('') : '';
  }
  const shared = (S.private_topics || []).filter((p) => p.shared);
  $('topics-dad').html = `<div class="mysched"><div class="h">💭 Shared worries (opt-in by each person)</div>` + (shared.length
    ? shared.map((p) => `<div class="it"><span class="dot bg-${p.member}"></span><span class="d">${esc(S.members[p.member]?.name_en || p.member)}</span><span>${esc(p.topic)}</span></div>`).join('')
    : `<div class="it" style="color:var(--faint)">Nobody has shared a worry. Chats stay private.</div>`) + '</div>';
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-onboard],[data-topic]');
  if (!b) return;
  if (b.dataset.onboard) await api('/consent', { member: b.dataset.onboard, share: true, onboarding: true });
  if (b.dataset.topic) await api(`/topics/${b.dataset.topic}/share`, {});
});

$('btn-med').onclick = async () => {
  clearTimeout(robotTimer);
  const seq = [['start', 0], ['water', 1500], ['pills', 1700], ['deliver', 1700], ['taken', 3200], ['docked', 5000]];
  let i = 0;
  const next = async () => {
    if (i >= seq.length) return;
    const [stage] = seq[i++];
    await api('/robot', { stage, med: '혈압약' });
    if (stage === 'taken') STT.say('혈압약 드신 거 확인했어요. 엄마에게 알려드릴게요.');
    if (i < seq.length) robotTimer = setTimeout(next, seq[i][1]);
  };
  next();
};

// ---------- Story mode: "a day with the Kim family" ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (_) {} await sleep(300); } return false; }
const SHOW_CAPTIONS = new URLSearchParams(location.search).get('cap') !== '0';
function caption(time, text) {
  const el = $('caption');
  if (!SHOW_CAPTIONS) { el.classList.add('hidden'); return; }
  if (!text) { el.classList.add('hidden'); document.body.classList.remove('has-cap'); return; }
  document.body.classList.add('has-cap');
  $('cap-time').textContent = time || ''; $('cap-text').textContent = text;
  el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}
const PACED = new URLSearchParams(location.search).get('rec') === '1' && new URLSearchParams(location.search).get('auto') !== '1';
let advance = null;
document.addEventListener('keydown', (e) => {
  if (!advance) return;
  if (['ArrowRight', 'Space', 'Enter', 'PageDown'].includes(e.code)) { e.preventDefault(); const a = advance; advance = null; a(); }
});
function beat(ms) {
  // scene-level pause: presenter presses → / Space to continue (min 600ms so a double press can't skip two scenes)
  if (!PACED || ms < 1500) return sleep(ms);
  return sleep(600).then(() => new Promise((r) => { advance = r; }));
}
function slide(html) {
  const el = $('slide');
  if (!html) { el.classList.add('hidden'); return; }
  el.innerHTML = html; el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}
async function grandmaVoiceScene() {
  const said = '수요일 오후 3시에 내과 가서 감기약 타 올 거야';
  const el = $('gm-said');
  setView('demo');
  caption('10:10', "My mother doesn't do apps. She just talks.");
  el.innerHTML = `<span class="mic">🎤 Grandma says</span>${esc(said)}<small>“I'm going to the clinic Wednesday at 3 to get cold medicine.”</small>`;
  el.classList.remove('hidden');
  const before = new Set(S.events.map((e) => e.id));
  await api('/voice', { member: 'grandma', text: said });
  await waitFor(() => S.events.some((e) => !before.has(e.id)), 20000);
  caption('10:10', 'Kinproof understands her, puts it on the family calendar, and tells my wife and me.');
  await beat(4000);
  el.classList.add('hidden');
  setView('hub'); calMode = 'week';
  window.__justEvent = S.events.find((e) => !before.has(e.id))?.id;
  caption('10:11', 'There it is. Wednesday, 3pm. Nobody had to type anything.');
  await beat(4000);
  window.__justEvent = null;
}
let storyRunning = false;
async function story() {
  if (storyRunning) return; storyRunning = true;
  const B = $('btn-story'); B.textContent = '■ Playing…';
  try {
    setView('demo');
    await api('/reset', {}); seenEvents.clear(); seenLines.clear(); lastWikiPageHighlight = 0;
    caption('', "Hi, I'm Kanghoun. This is Kinproof. It makes sure a caller is really your family, before anyone sends money.");
    slide(`<div class="s-logo">K</div><h1>Kinproof</h1><h2>Family security for the age of voice cloning.<br>It checks that a caller is really your family before anyone sends money.</h2>`);
    await beat(5500);
    caption('', 'Last year, Koreans lost 1.26 trillion won to voice phishing. That\'s up 47 percent.');
    slide(`<h2>Voice phishing in Korea, 2025</h2><div class="stats">
      <div class="stat"><b>₩1.26T</b><span>lost to voice phishing</span></div>
      <div class="stat"><b>+47%</b><span>vs. the year before</span></div>
      <div class="stat"><b>₩53.8M</b><span>lost per victim</span></div></div>
      <div class="src">Police data via National Assembly analysis</div>`);
    await beat(6000);
    caption('', 'Older people are hit the hardest. Phone numbers leak, voices get cloned, and a parent living alone is the easiest target.');
    slide(`<h2>Older adults are hit hardest</h2><div class="stats">
      <div class="stat"><b>$7.75B</b><span>lost by people 60+ in the US, 2025</span></div>
      <div class="stat"><b>+59%</b><span>in one year</span></div></div>
      <h2>Phone numbers leak. Voices get cloned.<br>And the parent who lives alone is the easiest target.</h2>
      <div class="src">FBI IC3 2025 Elder Fraud data</div>`);
    await beat(6500);
    slide('');
    caption('', "This is my family. My mother lives alone. My wife is a nurse. My son is 15. I write code in Pangyo."); await beat(3800);
    caption('08:50', 'We all install Kinproof. It only turns on when everyone says yes.');
    for (const m of ['grandma', 'dad', 'mom', 'jihoon']) { await beat(450); await api('/consent', { member: m, share: true, onboarding: true }); }
    await beat(1500);

    setView('hub'); homeMode = 'in';
    caption('09:00', "9am. The robot brings my mother her blood pressure pills and a glass of water.");
    $('btn-med').click(); await beat(6500);
    caption('10:40', 'Water on the kitchen floor. The robot warns her, wipes it up, and sends my wife a photo.');
    $('btn-spill').click(); await beat(5600);

    setView('demo');
    const syncAndShare = async (m, sample, line) => {
      caption(line[0], line[1]);
      await api('/sync/' + sample, {});
      await waitFor(() => S.approvals.some((a) => a.member === m), 30000); await beat(900);
      for (const a of S.approvals.filter((a) => a.member === m)) { await api('/approvals/' + a.id, { decision: 'approve' }); await beat(200); }
      await beat(1600);   // → to the next scene
    };
    await syncAndShare('mom', 'mom_chatgpt', ['09:20', "My wife tells ChatGPT about my mother's MRI on Thursday. The date gets shared. Her job stress doesn't."]);
    await syncAndShare('dad', 'dad_chatgpt', ['09:30', "My ChatGPT knows I'm in Pangyo all week. That gets shared. My stock losses don't."]);
    await syncAndShare('jihoon', 'jihoon_claude', ['09:35', "Ji-hoon's hagwon schedule gets shared. His crush stays private."]);

    await grandmaVoiceScene();
    setView('demo');

    caption('11:02', '11am. “Mom, it\'s Jun-ho. My phone broke…”');
    await api('/presence', { member: 'dad', on_call: false });
    // If a voice-clone recording exists, play it (the scammer IS the clone). Otherwise the presenter reads the lines live.
    const clone = ['scam_clone'].find((r) => S.recordings.includes(r));
    if (clone) {
      replay(clone);
      await waitFor(() => S.call.transcript.length >= 1, 30000);
      caption('11:02', 'That\'s my voice. Cloned in one minute.');
    } else {
      script = 'scam'; prompterBase = 0; prompterOpen = true;
      await api('/call/start', { caller: '010-****-7741' });
      callListening = true;
      STT.start({ onFinal: sendUtterance, onInterim: (t) => ($('interim').textContent = t) });
      caption('11:02', 'Read the Korean lines on screen, as the scammer.');
      await waitFor(() => S.call.transcript.length >= 1, 60000);
      caption('11:02', 'Someone is calling my mother with my voice.');
    }
    await waitFor(() => S.call.confirm_requested, 60000);
    caption('11:02', "I'm in a meeting. My phone is on silent and not on any call. So Kinproof asks me directly: is this you?");
    await waitFor(() => S.call.signals.some((s) => s.type === 'GPS_MISMATCH'), 60000);
    caption('11:03', 'He says he\'s in Busan. My phone is in Pangyo.');
    const lines = (S.scripts || {}).scam || [];
    await waitFor(() => S.call.transcript.length >= lines.length || (S.call.level === 'ALERT' && S.call.transcript.length >= 5), 60000);
    await beat(1500);
    if (!clone) { STT.stop(); callListening = false; prompterOpen = false; $('interim').textContent = ''; }
    caption('11:03', 'I tap Not me. The call is blocked. My wife sees why, and can report it to 112 in one tap.');
    await api('/call/confirm', { member: 'dad', is_me: false }); await beat(3800);

    setView('hub');
    caption('11:05', 'Everything the family needs, on one screen. Every decision is logged.'); await beat(4000);


    caption('', "Kinproof. A voice isn't proof anymore. Family is."); await beat(3500);
  } finally {
    caption('', ''); slide(''); storyRunning = false; B.textContent = '▶ Story mode';
  }
}
$('btn-story').onclick = story;

// ---------- timetable: one day, hours down, family members across ----------
let calMode = 'week', ttDay = '2026-11-09';
const TT_START = 7, TT_END = 23, HOUR_PX = 38;
const hhmm = (s) => { const [h, m] = (s || '0:0').split(':').map(Number); return h + m / 60; };
function renderTimetable() {
  $('hub-calendar').classList.toggle('hidden', calMode !== 'week');
  $('hub-tt').classList.toggle('hidden', calMode !== 'day');
  document.querySelectorAll('[data-calmode]').forEach((b) => b.classList.toggle('on', b.dataset.calmode === calMode));
  if (calMode !== 'day') return;
  const ids = Object.keys(S.members);
  const days = [...Array(7)].map((_, i) => { const d = new Date(WEEK_START); d.setDate(d.getDate() + i); return d; });
  const dayBtns = days.map((d, i) => { const iso = `2026-11-${String(d.getDate()).padStart(2, '0')}`;
    return `<button data-ttday="${iso}" class="${iso === ttDay ? 'on' : ''} ${i === 0 ? 'today' : ''}">${DOW[i]} ${d.getDate()}</button>`; }).join('');
  const top = (h) => (Math.max(TT_START, Math.min(TT_END, h)) - TT_START) * HOUR_PX;
  const items = S.events.filter((e) => e.date === ttDay);
  // care moments the agent handled today
  const c = S.call;
  if (ttDay === '2026-11-09') {
    const rob = S.robot || {};
    if (['taken', 'docked'].includes(rob.stage) && rob.ts) items.push({ title: '💊 혈압약 복용 확인 (robot)', time: '09:00', owner: 'grandma', involves: ['mom'], kind: 'care' });
    if (c.verdict && c.started) { const d = new Date(c.started * 1000); items.push({ title: c.verdict === 'blocked' ? '🚫 사칭 전화 차단' : '✅ 지훈 통화 확인', time: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, owner: 'grandma', involves: c.claimed ? [c.claimed] : [], kind: c.verdict === 'blocked' ? 'incident' : 'care' }); }
  }
  const lanes = ids.map((m) => {
    const evs = items.filter((e) => e.time && involves(e, m)).map((e) => {
      const y = top(hhmm(e.time)), h = Math.max(30, HOUR_PX * (e.kind ? 0.8 : 1.2));
      const cls = e.kind || `o-${e.owner}`;
      return `<div class="tt-ev ${cls} ${e.owner !== m ? 'with' : ''}" style="top:${y}px;height:${h}px"><b>${e.kind ? '' : evEmoji(e) + ' '}${esc(e.title)}</b>${esc(e.time)}</div>`;
    }).join('');
    return `<div class="tt-lane" style="height:${(TT_END - TT_START) * HOUR_PX}px">${evs}</div>`;
  });
  const axis = [...Array(TT_END - TT_START + 1)].map((_, i) => `<div style="top:${i * HOUR_PX}px">${String(TT_START + i).padStart(2, '0')}:00</div>`).join('');
  const now = new Date(); const nowH = now.getHours() + now.getMinutes() / 60;
  const nowLine = ttDay === '2026-11-09' && nowH >= TT_START && nowH <= TT_END ? `<div class="tt-now" style="top:${top(nowH) + 28}px;grid-column:1/-1"></div>` : '';
  const allday = items.filter((e) => !e.time).map((e) => `${evEmoji(e)} ${esc(e.title)}`).join(' · ');
  $('hub-tt').html = `<div class="tt-days">${dayBtns}</div>${allday ? `<div class="tt-allday">All day: ${allday}</div>` : ''}
    <div class="tt-grid" style="--lanes:${ids.length};--hour:${HOUR_PX}px">
      <div class="tt-head"></div>${ids.map((m) => `<div class="tt-head">${S.members[m].emoji} ${esc(S.members[m].name_en)}</div>`).join('')}
      <div class="tt-axis" style="height:${(TT_END - TT_START) * HOUR_PX}px">${axis}</div>${lanes.join('')}${nowLine}</div>`;
  const grid = $('hub-tt').querySelector('.tt-grid');
  if (grid && grid.dataset.day !== ttDay) {
    grid.dataset.day = ttDay;
    const first = Math.min(...items.filter((e) => e.time).map((e) => hhmm(e.time)), 23);
    grid.scrollTop = Math.max(0, (first - TT_START) * HOUR_PX - 20);
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-calmode],[data-ttday]');
  if (!b) return;
  if (b.dataset.calmode) calMode = b.dataset.calmode;
  if (b.dataset.ttday) { ttDay = b.dataset.ttday; calMode = 'day'; }
  render();
});

$('btn-laundry').onclick = () => api('/laundry', {});

// single-phone mode: each family member opens their own phone on a real iPhone
(() => {
  const params = new URLSearchParams(location.search);
  const as = params.get('as') || (window.innerWidth < 600 ? 'dad' : null);
  if (!as) return;
  document.body.classList.add('solo');
  const el = document.getElementById('p-' + as);
  if (el) el.classList.add('me');
  document.querySelectorAll('[data-as]').forEach((a) => a.classList.toggle('on', a.dataset.as === as));
})();

async function sendAsk(m) {
  const input = $('ask-' + m), btn = document.querySelector(`[data-ask="${m}"]`);
  const text = input.value.trim();
  if (!text) return;
  btn.disabled = true; btn.textContent = '…';
  try { await api('/home', { member: m, text }); input.value = ''; } finally { btn.disabled = false; btn.textContent = '보내기'; }
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) sendAsk(b.dataset.ask); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('ask-') && !e.isComposing) sendAsk(e.target.id.slice(4)); });

$('btn-spill').onclick = async () => {
  await api('/spill', { stage: 'detect' });
  setTimeout(() => api('/spill', { stage: 'cleaning' }), 2600);
  setTimeout(() => api('/spill', { stage: 'done' }), 5600);
  setTimeout(() => api('/spill', { stage: 'none' }), 9000);
};

document.addEventListener('click', (e) => { const b = e.target.closest('[data-homemode]'); if (b) { homeMode = b.dataset.homemode; render(); } });
$('btn-stranger').onclick = async () => { await api('/drone', { event: 'stranger' }); setTimeout(() => api('/drone', { event: 'patrol' }), 9000); };
$('btn-wander').onclick = async () => { await api('/drone', { event: 'wander' }); setTimeout(() => api('/drone', { event: 'home' }), 7000); setTimeout(() => api('/drone', { event: 'patrol' }), 11000); };

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-report],[data-dismiss]');
  if (!b) return;
  const me = b.closest('.phone')?.id?.replace('p-', '') || 'mom';
  if (b.dataset.report) await api('/report', { member: me, kind: b.dataset.report });
  if (b.dataset.dismiss) { dismissed.add(S.call.caller + 'mom'); dismissed.add(S.call.caller + 'dad'); render(); }
});

const MSG_PRESETS = {
  smish: { sender: '+82 10-****-2290', text: '[국외발신] 고객님 택배가 주소 불일치로 보관 중입니다. 주소 확인: http://bit.ly/3kP0xQ' },
  transfer: { sender: '신한은행', text: '[Web발신] 신한 11/09 11:06 출금 3,000,000원 김민수 잔액 412,350원' },
  normal: { sender: '국민건강보험', text: '[국민건강보험] 김순자님 2026년 건강검진 대상자입니다. 가까운 검진기관에서 받으세요.' },
};
$('msg-select').onchange = async (e) => { const p = MSG_PRESETS[e.target.value]; e.target.value = ''; if (p) await api('/message', { member: 'grandma', ...p }); };
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-hold]');
  if (!b) return;
  const me = b.closest('.phone')?.id?.replace('p-', '') || 'dad';
  await api(`/message/${b.dataset.hold}/hold`, { member: me });
});

function renderCommunity() {
  if (view !== 'community') return;
  const c = S.community;
  $('com-area').textContent = c.area;
  const blockedToday = c.feed.filter((f) => /분 전|시간 전|방금|오늘/.test(f.ago)).length;
  $('com-stats').html = `<div class="com-stat"><b>${c.families}</b><span>families protected nearby</span></div>
    <div class="com-stat"><b>${blockedToday}</b><span>scams blocked today</span></div>
    <div class="com-stat"><b>${Object.keys(c.blocklist).length}</b><span>numbers on the shared blocklist</span></div>`;
  $('com-feed').html = c.feed.map((f) => `<div class="com-item ${f.mine ? 'mine' : ''}"><div class="ic">${/스미싱/.test(f.pattern) ? '📩' : /검찰|기관/.test(f.pattern) ? '🏛' : '📞'}</div>
    <div class="tx"><b>${esc(f.pattern)}</b><span>${esc(f.area)} · ${esc(f.ago)} · ${esc(f.number)}</span></div>
    <div class="n">${c.blocklist[f.number] ? c.blocklist[f.number] + ' families blocked' : ''}</div></div>`).join('');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-share]');
  if (!b) return;
  const me = b.closest('.phone')?.id?.replace('p-', '') || 'dad';
  await api('/community/share', { member: me });
});

// recording mode: open /?rec=1 — one click, 3-2-1, the story plays; the presenter only narrates.
(() => {
  if (new URLSearchParams(location.search).get('rec') !== '1') return;
  document.body.classList.add('rec');
  const gate = $('recgate');
  gate.classList.remove('hidden');
  const scene = new URLSearchParams(location.search).get('scene');
  const prepareScene = async () => {
    await api('/reset', {});
    for (const m of ['grandma', 'dad', 'mom', 'jihoon']) await api('/consent', { member: m, share: true, onboarding: true });
    for (const sm of ['mom_chatgpt', 'dad_chatgpt', 'jihoon_claude']) await api('/sync/' + sm, {});
    await waitFor(() => S.approvals.length >= 3, 40000); await sleep(1500);
    for (const a of S.approvals) await api('/approvals/' + a.id, { decision: 'approve' });
    await sleep(800);
  };
  const go = async () => {
    $('rg-start').style.display = 'none';
    if (scene === 'voice') { $('rg-count').textContent = '…'; await prepareScene(); }
    for (const n of [3, 2, 1]) { $('rg-count').textContent = n; await sleep(800); }
    gate.classList.add('hidden');
    if (scene === 'voice') { await grandmaVoiceScene(); caption('', ''); return; }
    story();
  };
  $('rg-start').onclick = go;   // the click also unlocks audio playback for the cloned call
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !gate.classList.contains('hidden')) { e.preventDefault(); go(); } });
})();

poll();
