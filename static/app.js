// Renders GET /api/state into four panels. The server is the single source of truth.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = (path, body) => fetch('/api' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());

const TYPE_LABEL = {
  FAMILY_CLAIM: 'Claims to be family', AUTHORITY_CLAIM: 'Claims authority', URGENCY: 'Urgency',
  MONEY_REQUEST: 'Money request', UNUSUAL_PAYMENT: 'Unusual payment', SECRECY: 'Secrecy',
  CHANNEL_SWITCH: 'Unknown number excuse', CREDENTIAL_REQUEST: 'Credential request',
  DISTRESS_STORY: 'Distress story', CONTEXT_CONTRADICTION: 'Contradicts family wiki',
  PRESENCE_MISMATCH: 'Not on a call — live check',
};
const WEIGHTS = { FAMILY_CLAIM: 15, AUTHORITY_CLAIM: 25, URGENCY: 15, MONEY_REQUEST: 30, UNUSUAL_PAYMENT: 20,
  SECRECY: 20, CHANNEL_SWITCH: 20, CREDENTIAL_REQUEST: 30, DISTRESS_STORY: 10, CONTEXT_CONTRADICTION: 25, PRESENCE_MISMATCH: 30 };
const LEVEL_COLOR = { SAFE: 'var(--safe)', CAUTION: 'var(--caution)', ALERT: 'var(--alert)' };

let S = null, wikiPage = 'jihoon', lastWikiPageHighlight = 0, lastVerdict = null;

function renderSteps() {
  const c = S.call;
  const synced = S.ingest_log.some((l) => l.includes('synced'));
  const approved = S.events.length > 0 || S.ingest_log.some((l) => l.includes('wiki/'));
  const calling = c.active || c.transcript.length > 0;
  const confirmed = !!c.verdict;
  const state = { 1: synced, 2: approved, 3: calling && (c.level !== 'SAFE' || confirmed), 4: confirmed };
  const active = !synced ? 1 : !approved ? 2 : !confirmed ? 3 : 4;
  document.querySelectorAll('.step').forEach((el) => {
    const n = +el.dataset.step;
    el.className = 'step' + (state[n] ? ' done' : n === active ? ' active' : '');
  });
  if (c.verdict !== lastVerdict) {
    if (c.verdict === 'blocked') { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
    lastVerdict = c.verdict;
  }
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

// ---------- render ----------
function render() {
  if (!S) return;
  const c = S.call;
  renderSteps();
  $('mode').textContent = S.mode.toUpperCase();
  $('mode').className = 'badge' + (S.mode === 'replay' ? ' replay' : '');

  // call card
  const card = $('call-card');
  card.className = 'call ' + (c.active || c.transcript.length ? c.level : 'idle');
  $('caller').textContent = c.active ? `📞 Incoming · ${c.caller}` : (c.transcript.length ? `Call ended · ${c.caller}` : 'No active call');
  $('claimed').textContent = c.claimed ? `Caller claims to be: ${c.claimed === 'authority' ? 'an authority' : S.members[c.claimed].name_en}` : '';
  $('score').textContent = c.score;
  $('level').textContent = c.busy ? c.level + ' · analyzing…' : c.level;
  $('level').style.color = LEVEL_COLOR[c.level];
  $('bar-fill').style.width = c.score + '%';
  $('bar-fill').style.background = LEVEL_COLOR[c.level];

  const v = $('verdict');
  if (c.verdict === 'blocked') { v.className = 'verdict blocked'; v.textContent = `❌ This is NOT ${S.members[c.claimed].name_en}. Call blocked.`; }
  else if (c.verdict === 'verified') { v.className = 'verdict verified'; v.textContent = `✅ Verified: really ${S.members[c.claimed].name_en}`; }
  else if (c.degraded) { v.className = 'verdict degraded'; v.textContent = '⚠ Guardian degraded — family alerted'; }
  else v.className = 'verdict hidden';

  const tr = $('transcript');
  const trHtml = c.transcript.map((u) => `<div class="utt"><span class="t">${u.t.toFixed(1)}s</span>${esc(u.text)}</div>`).join('');
  if (tr.dataset.n != c.transcript.length) { tr.innerHTML = trHtml; tr.scrollTop = 1e9; tr.dataset.n = c.transcript.length; }

  $('signals').innerHTML = c.signals.map((s) => {
    const cls = s.by === 'code' ? 'code' : (s.type === 'CONTEXT_CONTRADICTION' ? 'wiki' : '');
    const wq = s.wiki_quote ? `<div class="wq">📚 wiki/${esc(s.wiki_page)}.md: “${esc(s.wiki_quote)}”</div>` : '';
    return `<div class="chip ${cls}"><span class="pts">+${WEIGHTS[s.type] ?? ''}${s.by === 'code' ? ' · code' : ''}</span>
      <div class="type">${esc(TYPE_LABEL[s.type] || s.type)}</div>
      <div class="q">“${esc(s.quote)}”</div><div class="en">${esc(s.quote_en)}</div>${wq}</div>`;
  }).join('');
  $('dropped').textContent = c.dropped.length ? `${c.dropped.length} model claim(s) dropped: evidence not found in source` : '';

  // feeds + approvals
  for (const m of Object.keys(S.members)) {
    const feed = $('feed-' + m);
    if (feed) feed.innerHTML = S.notifications.filter((n) => n.member === m && n.kind !== 'confirm_request')
      .map((n) => `<div class="note ${n.kind}"><span class="ts">${n.ts}</span> ${esc(n.text)}</div>`).join('');
    const ap = $('approvals-' + m);
    if (ap) ap.innerHTML = S.approvals.filter((a) => a.member === m).map((a) => {
      const p = a.payload;
      const body = a.kind === 'fact' ? `${esc(p.text)} <span class="src">→ wiki/${esc(p.about)}.md</span>`
        : `${esc(p.title)} · ${esc(p.date)} ${esc(p.time || '')} <span class="src">→ notify ${p.notify.map((n) => n.member).join(', ')}</span>`;
      return `<div class="appr"><div class="k">${a.kind === 'fact' ? 'SHARE FACT?' : 'ADD TO FAMILY SCHEDULE?'}</div>
        <div>${body}</div><div class="src">from your ${esc(a.source)} chat: “${esc(p.source_quote)}”</div>
        <div class="btns"><button class="ok small" data-appr="${a.id}" data-d="approve">Share</button>
        <button class="ghost small" data-appr="${a.id}" data-d="reject">Keep private</button></div></div>`;
    }).join('');
  }

  // Ji-hoon presence + confirm
  const jh = S.members.jihoon;
  $('presence-label').textContent = jh.on_call ? '📞 On a call' : '📵 Not on a call';
  const req = c.confirm_requested && c.claimed === 'jihoon' && !c.verdict;
  $('confirm-box').className = 'confirm' + (req ? '' : ' hidden');
  if (req) $('confirm-text').textContent = `Someone claiming to be you is calling Grandma right now. Is this you?`;

  // wiki
  const pages = Object.keys(S.wiki);
  const hl = S.wiki_highlights;
  if (hl.length > lastWikiPageHighlight) { wikiPage = hl[hl.length - 1].page; lastWikiPageHighlight = hl.length; }
  if (!pages.includes(wikiPage)) wikiPage = pages[0];
  $('wiki-tabs').innerHTML = pages.map((p) => `<button class="${p === wikiPage ? 'on' : ''}" data-page="${p}">${p}.md</button>`).join('');
  let body = esc(S.wiki[wikiPage] || '').replace(/&lt;!--(.*?)--&gt;/g, '<span class="src">↳$1</span>');
  for (const h of hl.filter((h) => h.page === wikiPage)) body = body.split(esc(h.quote)).join(`<mark>${esc(h.quote)}</mark>`);
  $('wiki-body').innerHTML = body;

  $('events').innerHTML = S.events.map((e) => `<div class="ev ${e.done ? 'done' : ''}"><div><b>${esc(e.title)}</b><br>
    <span class="ts">${esc(e.date)} ${esc(e.time || '')} · ${esc(S.members[e.owner]?.name_en || e.owner)}</span></div>
    ${e.done ? '' : `<button class="small ghost" data-done="${e.id}">done</button>`}</div>`).join('') || '<div class="dropped">No events yet</div>';
  $('log').innerHTML = S.ingest_log.slice(0, 12).map(esc).join('<br>');

  const sel = $('replay-select');
  const opts = '<option value="">Replay…</option>' + S.recordings.map((r) => `<option>${r}</option>`).join('');
  if (sel.dataset.v !== opts) { sel.innerHTML = opts; sel.dataset.v = opts; }
  $('btn-call').textContent = STT.running ? '🔴 Listening… (stop)' : '📞 Start live call';
}

async function poll() {
  try { S = await api('/state'); render(); } catch (e) { console.warn(e); }
  setTimeout(poll, 600);
}

// ---------- actions ----------
$('btn-call').onclick = async () => {
  if (STT.running) { STT.stop(); return; }
  await api('/call/start', { caller: '010-****-7741' });
  STT.start({ onFinal: sendUtterance, onInterim: (t) => ($('interim').textContent = t) });
};
$('btn-end').onclick = async () => {
  STT.stop();
  const name = S && S.call.transcript.length ? prompt('Save this call for replay as (blank = don\'t save):', 'scam') : null;
  await api('/call/end', { save_as: name || null });
};
$('btn-reset').onclick = async () => { STT.stop(); lastWikiPageHighlight = 0; await api('/reset', {}); };

$('btn-presence').onclick = () => api('/presence', { member: 'jihoon', on_call: !S.members.jihoon.on_call });
$('btn-its-me').onclick = () => api('/call/confirm', { member: 'jihoon', is_me: true });
$('btn-not-me').onclick = () => api('/call/confirm', { member: 'jihoon', is_me: false });

// Grandma speaks a plan -> voice note into the inbox -> same ingest pipeline as chats.
let planBuf = [];
$('btn-voice-plan').onclick = async () => {
  const btn = $('btn-voice-plan');
  if (STT.running) {
    STT.stop();
    btn.textContent = '🎤 Tell Kinproof a plan';
    if (planBuf.length) await api('/inbox', { member: 'grandma', source: 'voice', text: 'User: ' + planBuf.join(' ') });
    planBuf = [];
    return;
  }
  planBuf = [];
  btn.textContent = '⏹ Done speaking';
  STT.start({ onFinal: (t) => planBuf.push(t), onInterim: (t) => ($('interim').textContent = t) });
};

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.sync) await api('/sync/' + t.dataset.sync, {});
  if (t.dataset.appr) await api('/approvals/' + t.dataset.appr, { decision: t.dataset.d });
  if (t.dataset.page) { wikiPage = t.dataset.page; render(); }
  if (t.dataset.done) await api(`/events/${t.dataset.done}/done`, {});
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

poll();
