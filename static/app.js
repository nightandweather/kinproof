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


const involves = (e, m) => e.owner === m || (e.involves || []).includes(m);
const dayLabel = (iso) => { const d = new Date(iso + 'T00:00'); return `${DOW[(d.getDay() + 6) % 7]} ${d.getMonth() + 1}/${d.getDate()}`; };
const sortEv = (a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99'));

function renderMySched() {
  for (const m of Object.keys(S.members)) {
    const el = $('mysched-' + m);
    if (!el) continue;
    const evs = S.events.filter((e) => involves(e, m)).sort(sortEv);
    el.html = evs.length ? `<div class="h">📅 My week</div>` + evs.map((e) =>
      `<div class="it"><span class="dot bg-${e.owner}"></span><span class="d">${dayLabel(e.date)}</span><span>${esc(e.title)}${e.time ? ' · ' + esc(e.time) : ''}</span></div>`).join('') : '';
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

function renderWiki() {
  // calendar
  const days = [...Array(7)].map((_, i) => { const d = new Date(WEEK_START); d.setDate(d.getDate() + i); return d; });
  $('cal-title').textContent = `Nov ${days[0].getDate()} – ${days[6].getDate()}, 2026`;
  S.events.forEach((e) => flagNew(e.id, seenEvents, newEvents));
  $('calendar').html = days.map((d, i) => {
    const iso = `2026-11-${String(d.getDate()).padStart(2, '0')}`;
    const evs = S.events.filter((e) => e.date === iso).map((e) =>
      `<div class="ev o-${e.owner} ${newEvents.has(e.id) ? 'new' : ''} ${e.done ? 'done' : ''} ${calWho !== 'all' && !involves(e, calWho) ? 'dim' : ''}" title="confirmed by ${esc((e.confirmed_by || []).join(', '))}">
        ${esc(e.title)}<span class="tm">${esc(e.time || 'all day')}${(e.confirmed_by || []).length > 1 ? ' · ✓✓' : ''}</span></div>`).join('');
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
  const sel = $('replay-select');
  const opts = '<option value="">Replay…</option>' + S.recordings.map((r) => `<option>${r}</option>`).join('');
  if (sel.dataset.v !== opts) { sel.innerHTML = opts; sel.dataset.v = opts; }
  $('btn-call').textContent = STT.running && callListening ? '🔴 Listening… (stop)' : '📞 Start live call';
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

// Grandma speaks a plan -> voice note into the inbox -> same ingest pipeline as chats.
let planBuf = [];
$('btn-voice-plan').onclick = async () => {
  const btn = $('btn-voice-plan');
  if (STT.running) {
    STT.stop();
    btn.textContent = '🎤';
    if (planBuf.length) await api('/inbox', { member: 'grandma', source: 'voice', text: 'User: ' + planBuf.join(' ') });
    planBuf = [];
    return;
  }
  planBuf = [];
  btn.textContent = '⏹';
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
poll();
