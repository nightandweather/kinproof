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
  PRESENCE_MISMATCH: 'Live check: not on a call',
};
const WEIGHTS = { FAMILY_CLAIM: 15, AUTHORITY_CLAIM: 25, URGENCY: 15, MONEY_REQUEST: 30, UNUSUAL_PAYMENT: 20,
  SECRECY: 20, CHANNEL_SWITCH: 20, CREDENTIAL_REQUEST: 30, DISTRESS_STORY: 10, CONTEXT_CONTRADICTION: 25, PRESENCE_MISMATCH: 30 };
const LEVEL_COLOR = { SAFE: 'var(--safe)', CAUTION: 'var(--caution)', ALERT: 'var(--alert)' };
const NOTE_LABEL = { reminder: 'Family schedule', alert: 'Alert', approval: 'Family wiki', info: 'Verified' };
const SRC_BADGE = { chatgpt: 'ChatGPT', claude: 'Claude', voice: 'Voice', local: 'Local AI' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_START = new Date(2026, 10, 9); // Mon 9 Nov 2026 (demo "today")

let calWho = 'all', script = 'scam', prompterOpen = false, prompterBase = 0;
let S = null, wikiPage = 'jihoon', lastWikiPageHighlight = 0, lastVerdict;
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
  else if (c.degraded) { v.className = 'verdict degraded'; v.textContent = '⚠ Guardian degraded — family alerted'; }
  else v.className = 'verdict hidden';

  const tr = $('transcript');
  const before = tr._h;
  tr.html = c.transcript.map((u) => `<div class="msg"><div class="pf">?</div><div class="b">${esc(u.text)}</div><div class="t">${u.t.toFixed(1)}s</div></div>`).join('');
  if (tr._h !== before) tr.lastElementChild?.scrollIntoView({ block: 'nearest' });

  $('signals').html = c.signals.map((s) => {
    const cls = s.by === 'code' ? 'code' : (s.type === 'CONTEXT_CONTRADICTION' ? 'wiki' : '');
    const wq = s.wiki_quote ? `<div class="wq">📚 wiki/${esc(s.wiki_page)}.md — “${esc(s.wiki_quote)}”</div>` : '';
    return `<div class="chip ${cls}"><span class="pts">+${WEIGHTS[s.type] ?? ''}${s.by === 'code' ? ' · code' : ''}</span>
      <div class="type">${esc(TYPE_LABEL[s.type] || s.type)}</div>
      <div class="q">“${esc(s.quote)}”</div><div class="en">${esc(s.quote_en)}</div>${wq}</div>`;
  }).join('');
  $('dropped').textContent = c.dropped.length ? `${c.dropped.length} model claim(s) dropped — evidence not found in source` : '';
}

function renderPeople() {
  for (const m of Object.keys(S.members)) {
    const feed = $('feed-' + m);
    if (feed) feed.html = S.notifications.filter((n) => n.member === m && n.kind !== 'confirm_request').slice().reverse()
      .map((n) => botCard(n.kind, NOTE_LABEL[n.kind] || n.kind, esc(n.text), n.ts)).join('');
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
  const room = $('feed-mom')?.closest('.room');
  document.querySelectorAll('.room').forEach((r) => { if (r._n !== r.scrollHeight) { r._n = r.scrollHeight; } });

  const jh = S.members.jihoon;
  $('presence-label').textContent = jh.on_call ? '📞 On a call' : '📵 Not on a call';
  const c = S.call;
  const req = c.confirm_requested && c.claimed === 'jihoon' && !c.verdict;
  $('confirm-box').className = 'confirm' + (req ? '' : ' hidden');
  if (req) $('confirm-text').textContent = 'Someone claiming to be you is on the phone with Grandma right now.';
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
    const evs = S.events.filter((e) => involves(e, m)).sort(sortEv);
    el.html = evs.length ? `<div class="h">📅 My week</div>` + evs.map((e) =>
      `<div class="it"><span class="dot bg-${e.owner}"></span><span class="d">${dayLabel(e.date)}</span><span>${evEmoji(e)} ${esc(e.title)}${e.time ? ' · ' + esc(e.time) : ''}</span></div>`).join('') : '';
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
  }).join('') || `<div class="dropped" style="color:var(--faint)">No events yet — sync a family member's AI chat.</div>`;
}

function renderPrompter() {
  const box = $('prompter');
  const lines = (S.scripts || {})[script] || [];
  box.classList.toggle('hidden', !prompterOpen || !lines.length);
  if (!prompterOpen) return;
  document.querySelectorAll('[data-script]').forEach((b) => b.classList.toggle('on', b.dataset.script === script));
  $('prompter-title').textContent = script === 'scam' ? 'Read as the scammer' : 'Read as the real Ji-hoon';
  const said = Math.max(0, S.call.transcript.length - prompterBase);
  $('prompter-lines').html = lines.map((l, i) => `<div class="pl ${i < said ? 'done' : i === said ? 'now' : ''}">${esc(l)}</div>`).join('')
    + (said >= lines.length ? '<div class="pl now">Done — press End call and save it</div>' : '');
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
    row(onCall ? 'ok' : 'bad', onCall ? '✓' : '✗', `${who}'s phone is on a call`, onCall ? 'yes' : 'no — not calling anyone'),
    c.claimed_location
      ? row(types.has('GPS_MISMATCH') ? 'bad' : 'ok', types.has('GPS_MISMATCH') ? '✗' : '✓', 'Location matches GPS', `says ${esc(c.claimed_location)} · GPS ${esc(S.members[m].gps)}`)
      : row('', '–', 'Location matches GPS', `GPS ${esc(S.members[m].gps)}`),
    row(types.has('CONTEXT_CONTRADICTION') ? 'bad' : 'ok', types.has('CONTEXT_CONTRADICTION') ? '✗' : '✓', 'Story matches family wiki', types.has('CONTEXT_CONTRADICTION') ? 'contradiction' : 'consistent'),
    c.verdict ? row(c.verdict === 'verified' ? 'ok' : 'bad', c.verdict === 'verified' ? '✓' : '✗', `${who} confirmed`, c.verdict === 'verified' ? "“It's me”" : '“Not me”')
      : row(c.confirm_requested ? 'wait' : '', c.confirm_requested ? '…' : '–', `${who} confirmed`, c.confirm_requested ? 'asked — waiting' : 'not needed'),
  ];
  const bad = rows.filter((r) => r.includes('ck bad')).length;
  const verdict = c.verdict === 'blocked' || bad >= 2 ? `<div class="idverdict bad">✗ Not ${who}</div>`
    : c.verdict === 'verified' || (bad === 0 && onCall) ? `<div class="idverdict ok">✓ This is really ${who}</div>` : '';
  el.html = `<div class="ttl">Is this really ${who}?</div>${rows.join('')}${verdict}`;
}

let yardTimer = null, robotTimer = null;
const ZONES = { 'front gate': [40, 165], 'back fence': [330, 14], 'garden': [352, 150] };
const ROBOT_AT = { docked: [150, 112], start: [150, 112], water: [118, 60], pills: [236, 58], deliver: [212, 112], taken: [212, 112], no_answer: [212, 112] };
function renderYard() {
  if (view !== 'hub') return;
  const p = S.perimeter || {}, r = S.robot || { stage: 'docked' };
  const [zx, zy] = ZONES[p.zone] || [30, 30];
  const flying = p.status !== 'docked';
  const person = p.zone ? `<g><circle class="scan" cx="${zx}" cy="${zy}" r="6" fill="${p.known === false ? '#f03e3e' : '#fab005'}"/>
    <circle cx="${zx}" cy="${zy}" r="6" fill="${p.known === false ? '#f03e3e' : '#fab005'}"/><text x="${zx + 9}" y="${zy + 4}" font-size="10" font-weight="700" fill="#343a40">${p.known === false ? 'unknown' : 'motion'}</text></g>` : '';
  const dx = flying ? zx - 30 : 0, dy = flying ? zy - 30 - 16 : 0;
  const [rx, ry] = ROBOT_AT[r.stage] || ROBOT_AT.docked;
  const carry = ['pills', 'deliver', 'taken', 'no_answer'].includes(r.stage) ? '🥤💊' : r.stage === 'water' ? '🥤' : '';
  const robotSt = { docked: '🤖 Robot charging', start: '🤖 Medicine time — heading to kitchen', water: '🤖 Got water', pills: `🤖 Got today's ${r.med}`,
    deliver: '🤖 Delivered — “약 드셨어요?”', taken: `✓ Grandma took ${r.med}`, no_answer: '⚠ No answer — Mom alerted' }[r.stage] || '';
  const droneSt = p.status === 'docked' ? '' : p.status === 'dispatched' ? ` · 🚁 flying to ${p.zone}` : p.known ? ` · ✓ family at ${p.zone}` : ` · ⚠ unknown person at ${p.zone}`;
  $('yard').html = `<svg viewBox="0 0 380 190" preserveAspectRatio="xMidYMid meet">
    <rect x="6" y="6" width="368" height="178" rx="14" fill="#e9f5e1" stroke="#8ce99a" stroke-width="3" stroke-dasharray="8 6"/>
    <rect x="24" y="160" width="36" height="10" rx="3" fill="#ced4da"/><text x="22" y="155" font-size="9" fill="#495057">gate</text>
    <circle cx="352" cy="150" r="14" fill="#b2f2bb"/><text x="336" y="178" font-size="9" fill="#495057">garden</text>
    <rect x="90" y="34" width="190" height="112" rx="8" fill="#fff" stroke="#adb5bd" stroke-width="2"/>
    <line x1="185" y1="34" x2="185" y2="88" stroke="#dee2e6" stroke-width="2"/><line x1="90" y1="88" x2="280" y2="88" stroke="#dee2e6" stroke-width="2"/>
    <text x="98" y="48" font-size="9.5" fill="#868e96">kitchen 🚰</text><text x="196" y="48" font-size="9.5" fill="#868e96">medicine 💊</text>
    <text x="98" y="140" font-size="9.5" fill="#868e96">living room</text>
    <text x="230" y="128" font-size="20">👵</text><rect x="222" y="132" width="44" height="8" rx="3" fill="#ffd8a8"/>
    <g class="robot" style="transform:translate(${rx - 150}px,${ry - 112}px)"><text x="140" y="120" font-size="18">🤖</text><text x="158" y="108" font-size="10">${carry}</text></g>
    ${person}
    <g class="drone" style="transform:translate(${dx}px,${dy}px)"><text x="20" y="36" font-size="18">🚁</text></g>
  </svg><div class="yard-status">${robotSt}${droneSt}</div>`;
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
  script = S.members.jihoon.on_call ? 'real_jihoon' : 'scam';
  await api('/call/start', { caller: script === 'scam' ? '010-****-7741' : '010-****-2231' });
  prompterBase = 0; prompterOpen = true;
  callListening = true;
  STT.start({ onFinal: sendUtterance, onInterim: (t) => ($('interim').textContent = t) });
};
$('btn-end').onclick = async () => {
  STT.stop(); callListening = false;
  const name = S && S.call.transcript.length ? prompt('Save this call for replay as (blank = don\'t save):', 'scam') : null;
  await api('/call/end', { save_as: name || null });
};
$('btn-reset').onclick = async () => {
  STT.stop(); callListening = false; lastWikiPageHighlight = 0;
  seenEvents.clear(); seenLines.clear();
  await api('/reset', {});
};
$('btn-presence').onclick = () => api('/presence', { member: 'jihoon', on_call: !S.members.jihoon.on_call });
$('btn-its-me').onclick = () => api('/call/confirm', { member: 'jihoon', is_me: true });
$('btn-not-me').onclick = () => api('/call/confirm', { member: 'jihoon', is_me: false });

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
async function replay(name) {
  const rec = await api('/recordings/' + name);
  await api('/call/start', { caller: rec.caller });
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
// ---------- Family hub (layout from the iPad sketch) ----------
let view = 'demo', hubMe = 'mom';
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
  if (!c.active && !c.transcript.length) { el.classList.add('hidden'); return; }
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
  const days = [...Array(7)].map((_, i) => { const d = new Date(WEEK_START); d.setDate(d.getDate() + i); return d; });
  $('hub-cal-title').textContent = `Nov ${days[0].getDate()} – ${days[6].getDate()}, 2026`;
  const c = S.call;
  $('hub-calendar').html = days.map((d, i) => {
    const iso = `2026-11-${String(d.getDate()).padStart(2, '0')}`;
    let evs = S.events.filter((e) => e.date === iso).sort(sortEv).map((e) => {
      const people = [e.owner, ...(e.involves || [])].filter((v, k, a) => a.indexOf(v) === k).map((m) => S.members[m]?.emoji || '').join(' ');
      const conf = (e.confirmed_by || []).map((w) => `<span>✓ ${esc(w)}</span>`).join('');
      const fresh = !e.seed ? '<span>✨ new from AI chat</span>' : '';
      return `<div class="hev o-${e.owner} ${e.seed ? 'seed' : 'synced'}"><b>${evEmoji(e)} ${esc(e.title)}</b><div class="m">${esc(e.time || 'all day')} · ${people}</div><div class="badges">${fresh}${conf}</div></div>`;
    }).join('');
    if (i === 0 && c.verdict) {
      evs = `<div class="hev ${c.verdict === 'blocked' ? 'incident' : 'verified'}"><b>${c.verdict === 'blocked' ? '🚫 Scam call blocked' : '✅ Call verified'}</b>
        <div class="m">to Grandma · claimed ${esc(S.members[c.claimed]?.name_en || '')} · risk ${c.score}</div></div>` + evs;
    }
    return `<div class="hday ${i === 0 ? 'today' : ''} ${i === 5 ? 'sat' : ''} ${i === 6 ? 'sun' : ''}">
      <div class="hday-h"><span class="dow">${DOW[i]}</span>${i === 0 ? '<span class="tag-today">TODAY</span>' : ''}<span class="n">${d.getDate()}</span></div>${evs}</div>`;
  }).join('');

  $('hub-me').html = Object.entries(S.members).map(([m, v]) => `<button data-me="${m}" class="${m === hubMe ? 'on' : ''}">${v.emoji} ${esc(v.name_en)}</button>`).join('');
  const todos = myTodos(hubMe);
  $('hub-todos').html = todos.map((t) => `<div class="todo ${t.done ? 'done' : ''}" data-todo="${t.id}"><span class="box">${t.done ? '✓' : ''}</span>
    <span class="tx">${esc(t.text)}<span class="when">${esc(t.when)}</span></span></div>`).join('') || '<div class="empty" style="color:var(--faint)">Nothing yet — sync an AI chat.</div>';

  $('hub-people').html = Object.entries(S.members).map(([m, v]) => {
    const claimedNow = c.active && c.claimed === m && !v.on_call;
    const st = m === 'grandma' && c.active ? `<span class="st ${c.level === 'ALERT' ? 'alert' : 'on'}">📞 on a call · risk ${c.score}</span>`
      : claimedNow ? '<span class="st alert">⚠ being impersonated</span>'
      : `<span class="st ${v.on_call ? 'on' : ''}">${v.on_call ? '📞 on a call' : '📵 not on a call'}</span>`;
    return `<div class="person"><div class="av" style="background:${AV_BG[m] || '#f1f3f5'}">${v.emoji}</div>
      <div class="nm">${esc(v.name_en)}</div><div class="gps">📍 ${esc(v.gps || '—')}</div>${st}</div>`;
  }).join('') + `<div class="person add" data-add-member="1"><span class="plus">＋</span>Add family</div>`;

  const done = todos.filter((t) => t.done).length, total = todos.length;
  const off = 282.7 * (1 - (total ? done / total : 0));
  $('hub-progress').html = `<div class="ring"><svg viewBox="0 0 104 104"><circle class="track" cx="52" cy="52" r="45"/>
    <circle class="arc" cx="52" cy="52" r="45" style="stroke-dashoffset:${off}"/></svg><div class="num">${done}/${total}</div></div>
    <div class="prog-tx"><b>${total - done} left</b></div>`;

  $('hub-log').html = S.ingest_log.slice(0, 60).map((l) => {
    const m = l.match(/^(\S+)\s+\[(\w+)\]\s+(.*)$/);
    return m ? `<div class="ln"><span class="ts">${m[1]}</span><span class="tg ${m[2]}">[${m[2]}]</span>${esc(m[3])}</div>` : `<div class="ln">${esc(l)}</div>`;
  }).join('');
}

function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  document.querySelector('.stage').classList.toggle('hidden', v !== 'demo');
  $('hub').classList.toggle('hidden', v !== 'hub');
  $('mapview').classList.toggle('hidden', v !== 'map');
  if (v === 'map' && lmap) setTimeout(() => lmap.invalidateSize(), 60);
  $('wikiview').classList.toggle('hidden', v !== 'wiki');
  render();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-view],[data-me],[data-todo],[data-add-member]');
  if (!b) return;
  if (b.dataset.view) setView(b.dataset.view);
  if (b.dataset.me) { hubMe = b.dataset.me; render(); }
  if (b.dataset.addMember) {
    const name_en = prompt('Name (English), e.g. Dad');
    if (!name_en) return;
    const name = prompt('이름 (한국어), e.g. 아빠', '') || name_en;
    const emoji = prompt('Emoji', '👨‍🦳') || '🙂';
    const gps = prompt('Location (GPS)', '서울') || '';
    await api('/members', { name_en, name, emoji, gps });
  }
  if (b.dataset.todo) {
    const [kind, id] = b.dataset.todo.split(':');
    await api(kind === 'e' ? `/events/${id}/done` : `/notifications/${id}/done`, {});
  }
});

$('btn-motion').onclick = async () => {
  const zones = Object.keys(ZONES);
  const zone = zones[Math.floor(Math.random() * zones.length)];
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
  for (const m of ['mom', 'jihoon']) {
    const el = $('private-' + m);
    if (!el) continue;
    const mine = (S.private_topics || []).filter((p) => p.member === m);
    el.html = mine.length ? `<div class="sys">Kept private from your chat — only labels, never content</div>` + mine.map((p) =>
      `<div class="pt"><span>🔒</span><span class="lb">${esc(p.topic)}<small>${p.shared ? 'Dad can see this label' : 'only you can see this'}</small></span>
       <button class="${p.shared ? 'on' : ''}" data-topic="${p.id}">${p.shared ? 'Shared' : 'Share label with Dad'}</button></div>`).join('') : '';
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

poll();
