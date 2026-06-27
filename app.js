/* ===================== Badminton Mini League Ladder ===================== */

/* ---- Fixed rotation schedules, transcribed from the printed ladder sheet.
   Each entry is [pairAseat, pairAseat, pairBseat, pairBseat] using SEAT numbers
   1..N within a group. Seats map to actual players after assignment. ---- */
const SCHEDULES = {
  4: [
    [1, 2, 3, 4],
    [1, 4, 2, 3],
    [1, 3, 2, 4],
  ],
  5: [
    [1, 2, 3, 4], // 5 sits
    [5, 1, 2, 3], // 4 sits
    [5, 2, 1, 4], // 3 sits
    [5, 3, 2, 4], // 1 sits
    [5, 4, 1, 3], // 2 sits
  ],
  6: [
    [1, 5, 3, 6],
    [1, 4, 2, 5],
    [4, 6, 2, 3],
    [1, 6, 5, 3],
    [4, 2, 1, 3],
    [6, 2, 5, 4],
  ],
};
const GROUP_LABELS = "ABCDEFGHIJKLMNOP".split("");

/* ---- Persistent state ---- */
const store = {
  load() {
    try { return JSON.parse(localStorage.getItem("bl_state")) || {}; }
    catch { return {}; }
  },
  save(s) { localStorage.setItem("bl_state", JSON.stringify(s)); },
};

let state = Object.assign(
  {
    players: [],          // [{id, name}]
    courts: 3,
    groups: null,         // derived: [{label, seats:[playerId], scores:{gameIdx:{A:n,B:n}}}]
    assign: {},           // source of truth: { playerId: courtIndex }
    title: "Mini League Ladder",
    date: todayStr(),
  },
  store.load()
);

function persist() { store.save(state); }

/* ===================== Live session (shared scoring) ===================== */
// sessionId: the shared meet id (in the URL as ?s=ID). null = local-only.
// isJoiner: true when this device opened a share link (scoring-only view).
let sessionId = null;
let isJoiner = false;
let unsubscribe = null;     // tears down the live subscription

function shareUrl(id) {
  const u = new URL(location.href);
  u.search = "?s=" + id;
  u.hash = "";
  return u.href;
}

// Serialize the parts of state that make up a shared session.
function toSession() {
  return {
    meta: { title: state.title, date: state.date },
    courts: state.courts,
    players: state.players,
    assign: state.assign,
    scores: scoresAsMap(),
  };
}

// groups[].scores (keyed by court index) -> plain { court: { game: {A,B} } }
function scoresAsMap() {
  const m = {};
  (state.groups || []).forEach((g, ci) => { if (g.scores) m[ci] = g.scores; });
  return m;
}

// Apply an incoming session snapshot to local state.
// `live` = true means it arrived from a sync subscription while running; in that
// case we PATCH the DOM in place (so we never destroy the input the user is
// typing in and the keyboard stays up) instead of re-rendering everything.
function applySession(s, live) {
  if (!s) return;
  const structureChanged =
    JSON.stringify(state.players) !== JSON.stringify(s.players || []) ||
    JSON.stringify(state.assign) !== JSON.stringify(s.assign || {}) ||
    state.courts !== (s.courts ?? state.courts);

  state.title = s.meta?.title ?? state.title;
  state.date = s.meta?.date ?? state.date;
  state.courts = s.courts ?? state.courts;
  state.players = s.players || [];
  state.assign = s.assign || {};
  buildGroupsFromAssign();
  const sc = s.scores || {};
  (state.groups || []).forEach((g, ci) => { g.scores = sc[ci] || {}; });
  persist();

  // Full render only on first load or when the roster/courts actually changed.
  // A pure score update on the Play tab is patched in place below.
  if (!live || structureChanged || view !== "play") { render(); return; }
  patchScoresInPlace();
}

// Update score inputs + totals from current state WITHOUT rebuilding the DOM.
// Skips the input the user is actively editing so their typing/keyboard survive.
function patchScoresInPlace() {
  const active = document.activeElement;
  app.querySelectorAll("input[data-g]").forEach(inp => {
    if (inp === active) return; // never clobber the field being typed in
    const gi = +inp.dataset.group, game = +inp.dataset.g, side = inp.dataset.side;
    const v = state.groups[gi]?.scores?.[game]?.[side] ?? "";
    if (String(inp.value) !== String(v)) inp.value = v;
  });
  state.groups.forEach((_, gi) => updateTotalsUI(gi));
}

async function startSharing() {
  if (!assignValidity().ok) { toast("Finish assigning courts first"); return; }
  buildGroupsFromAssign();
  sessionId = Sync.newSessionId();
  await Sync.create(sessionId, toSession());
  // reflect the id in the URL without reloading
  history.replaceState(null, "", shareUrl(sessionId));
  await subscribe();
  toast(Sync.mode === "firebase" ? "Live session created" : "Local session (test mode)");
  render();
}

async function subscribe() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  unsubscribe = await Sync.join(sessionId, s => applySession(s, true));
}

// Called when a device opens ?s=ID — pull the session and go live on Play tab.
async function joinSession(id) {
  sessionId = id;
  isJoiner = true;
  view = "play";
  const existing = await Sync.get(id);
  if (!existing) { toast("Session not found — ask the host for a new link"); return; }
  applySession(existing);
  await subscribe();
}

// Write a single score field; merges remotely so concurrent editors don't clash.
async function pushScore(court, game, side, value) {
  if (!sessionId) return;             // local-only mode: nothing to push
  try { await Sync.setScore(sessionId, court, game, side, value); }
  catch (e) { toast("Sync error: " + e.message); }
}
function todayStr() {
  const d = new Date();
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function uid() { return Math.random().toString(36).slice(2, 9); }

// Parse a pasted roster into clean names. Handles:
//  - a "Confirmed Attendees:" (or similar) header anywhere at the start
//  - numbered lists whether multi-line OR collapsed onto ONE line:
//      "1. Gaurav 2. Jordan Hart 3. Pari ..."  (paste often loses newlines)
//  - bullets, newline- or comma-separated entries
//  - trailing/!double whitespace, duplicates (case-insensitive)
function parseNames(raw, existing = []) {
  let text = String(raw).replace(/\r/g, " ");

  // Drop a leading header like "Confirmed Attendees:" (keep what's after the colon).
  text = text.replace(/^\s*[A-Za-z][A-Za-z ]*?attendees?\s*:?/i, "");
  // Generic: if it still starts with "Word(s):" before the first number, drop that too.
  text = text.replace(/^\s*[A-Za-z][\w ]*:\s*(?=\d)/, "");

  let parts;
  if (/\d+\s*[.)]/.test(text)) {
    // Numbered list (possibly all on one line): split on each "<n>." / "<n>)" marker.
    parts = text.split(/\s*\d+\s*[.)]\s*/);
  } else {
    // No numbering: fall back to newline / comma / bullet separators.
    parts = text.split(/[\n,;•]+/);
  }

  const seen = new Set(existing.map(s => s.trim().toLowerCase()));
  const out = [];
  parts.forEach(p => {
    const name = p.replace(/^[\s•\-*]+/, "").trim().replace(/\s+/g, " ");
    if (!name) return;
    if (/attendees?:?$/i.test(name)) return;        // stray header remnant
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); out.push(name);
  });
  return out;
}
function byId(id) { return state.players.find(p => p.id === id); }
function nameOf(id) { const p = byId(id); return p ? p.name : "—"; }

/* ===================== Group / schedule logic ===================== */

function scheduleFor(group) { return SCHEDULES[group.seats.length] || []; }

// seats that sit out a given game
function sittersFor(group, game) {
  const playing = new Set(game);
  const out = [];
  for (let s = 1; s <= group.seats.length; s++) if (!playing.has(s)) out.push(s);
  return out;
}

// Compute each seat's total = sum of points their pair scored across games played
function computeTotals(group) {
  const sched = scheduleFor(group);
  const totals = group.seats.map(() => 0);
  sched.forEach((game, gi) => {
    const sc = group.scores[gi];
    if (!sc) return;
    const [a1, a2, b1, b2] = game;
    const A = num(sc.A), B = num(sc.B);
    [a1, a2].forEach(seat => totals[seat - 1] += A);
    [b1, b2].forEach(seat => totals[seat - 1] += B);
  });
  return totals;
}

function rankings(totals) {
  // higher total = better; ties share rank (standard competition ranking)
  const order = totals.map((t, i) => ({ i, t })).sort((a, b) => b.t - a.t);
  const ranks = totals.map(() => 0);
  let lastT = null, lastRank = 0;
  order.forEach((o, pos) => {
    const rank = (o.t === lastT) ? lastRank : pos + 1;
    ranks[o.i] = rank; lastT = o.t; lastRank = rank;
  });
  return ranks;
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

/* ===================== Rendering ===================== */

const app = document.getElementById("app");
let view = "players";

document.querySelectorAll(".tab").forEach(t =>
  t.addEventListener("click", () => setView(t.dataset.view)));

function setView(v) {
  // Joiners (people who opened a share link) only get the Play tab.
  if (isJoiner) v = "play";
  view = v;
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.view === v));
  render();
}

function render() {
  document.getElementById("dateLabel").textContent = state.date;
  if (view === "players") return renderPlayers();
  if (view === "setup") return renderSetup();
  if (view === "play") return renderPlay();
  if (view === "sheet") return renderSheet();
}

/* ---------- Players ---------- */
function renderPlayers() {
  app.innerHTML = `
    <div class="card">
      <h2>Roster <span class="count">(${state.players.length})</span></h2>
      <textarea id="nameInput" class="field" rows="2" placeholder="Add a name, or paste a whole list…" autocomplete="off"></textarea>
      <div class="row" style="margin-top:8px">
        <button id="addBtn" class="btn">Add</button>
        <span class="help" style="margin:0">Paste a numbered list — numbering &amp; the "Confirmed Attendees:" header are stripped automatically. Enter adds; Shift+Enter for a new line.</span>
      </div>
      <div id="playersList" class="players-list"></div>
      ${state.players.length ? `
      <div class="row spread" style="margin-top:14px">
        <button id="clearBtn" class="btn ghost">Clear all</button>
        <button id="toCourts" class="btn secondary">Next: Courts →</button>
      </div>` : ""}
    </div>`;

  const list = document.getElementById("playersList");
  list.innerHTML = state.players.map(p =>
    `<span class="pill">${escapeHtml(p.name)}<button data-del="${p.id}" aria-label="remove">×</button></span>`
  ).join("") || `<p class="empty">No players yet. Add some above.</p>`;

  const input = document.getElementById("nameInput");
  const add = () => {
    const raw = input.value;
    if (!raw.trim()) return;
    const names = parseNames(raw, state.players.map(p => p.name));
    names.forEach(name => state.players.push({ id: uid(), name }));
    input.value = "";
    persist(); renderPlayers();
    if (names.length) toast(`Added ${names.length} player${names.length > 1 ? "s" : ""}`);
    document.getElementById("nameInput").focus();
  };
  document.getElementById("addBtn").onclick = add;
  // Enter adds; Shift+Enter inserts a newline (so multi-line typing still works)
  input.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } };
  input.focus();

  list.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    state.players = state.players.filter(p => p.id !== b.dataset.del);
    // invalidate groups if roster changed
    state.groups = null; persist(); renderPlayers();
  });
  const clear = document.getElementById("clearBtn");
  if (clear) clear.onclick = () => {
    if (confirm("Remove all players?")) { state.players = []; state.groups = null; persist(); renderPlayers(); }
  };
  const next = document.getElementById("toCourts");
  if (next) next.onclick = () => setView("setup");
}

/* ---------- Courts (manual assignment via buttons) ---------- */

function groupSizeOk(size) { return size >= 4 && size <= 6; }

// Count players currently assigned to each court (0-based court index).
function courtCounts() {
  const counts = Array.from({ length: state.courts }, () => 0);
  Object.values(state.assign).forEach(c => { if (c >= 0 && c < state.courts) counts[c]++; });
  return counts;
}

function unassignedPlayers() {
  return state.players.filter(p => state.assign[p.id] === undefined || state.assign[p.id] === null);
}

// Players ordered by court allocation: each assigned court (in order) preceded by a
// header row, then any unassigned players last. Within a court, keep roster order.
function orderedAssignList() {
  const counts = courtCounts();
  const rows = [];
  for (let ci = 0; ci < state.courts; ci++) {
    const inCourt = state.players.filter(p => state.assign[p.id] === ci);
    if (!inCourt.length) continue;
    const ok = groupSizeOk(counts[ci]);
    rows.push({ header: `Court ${ci + 1} · ${counts[ci]} player${counts[ci] !== 1 ? "s" : ""}${ok ? " ✓" : " (needs 4–6)"}`, headOk: ok });
    inCourt.forEach(p => rows.push(p));
  }
  const un = unassignedPlayers();
  if (un.length) {
    rows.push({ header: `Unassigned · ${un.length}`, headOk: false });
    un.forEach(p => rows.push(p));
  }
  return rows;
}

function renderSetup() {
  const n = state.players.length;
  const counts = courtCounts();
  const courtBtns = (id) => Array.from({ length: state.courts }, (_, ci) =>
    `<button class="court-btn ${state.assign[id] === ci ? "on" : ""}" data-assign="${id}" data-court="${ci}">${ci + 1}</button>`
  ).join("");

  app.innerHTML = `
    <div class="card">
      <h2>Assign courts</h2>
      <p class="muted">${n} players. Tap a court number next to each name.</p>
      <div class="row" style="margin:10px 0">
        <label class="muted" style="min-width:120px">Number of courts</label>
        <select id="courtsSel" class="field" style="max-width:120px">
          ${[1,2,3,4,5,6,7,8].map(c => `<option value="${c}" ${c===state.courts?"selected":""}>${c}</option>`).join("")}
        </select>
      </div>
      <div class="court-tally">
        ${counts.map((cnt, ci) => {
          const ok = groupSizeOk(cnt);
          return `<span class="tally ${ok ? "ok" : (cnt === 0 ? "" : "bad")}">Court ${ci+1}: <b>${cnt}</b>${ok ? " ✓" : ""}</span>`;
        }).join("")}
        ${unassignedPlayers().length ? `<span class="tally bad">Unassigned: <b>${unassignedPlayers().length}</b></span>` : ""}
      </div>
      <div class="row wrap" style="margin-top:8px">
        <button id="autoAssign" class="btn secondary sm">Auto-fill evenly</button>
        <button id="clearAssign" class="btn ghost sm">Clear assignments</button>
      </div>
    </div>

    ${n < 1 ? `<div class="card"><p class="empty">Add players first on the Players tab.</p></div>` : `
    <div class="card">
      <div class="assign-list">
        ${orderedAssignList().map(p => `
          ${p.header !== undefined ? `<div class="assign-head ${p.headOk ? "ok" : ""}">${p.header}</div>` : `
          <div class="assign-row">
            <span class="assign-name">${escapeHtml(p.name)}</span>
            <span class="court-btns">${courtBtns(p.id)}</span>
          </div>`}`).join("")}
      </div>
    </div>`}

    ${assignValidity().ok
      ? `<button class="btn block" id="toPlay">Start scoring →</button>`
      : `<p class="empty">${assignValidity().msg}</p>`}`;

  document.getElementById("courtsSel").onchange = e => {
    state.courts = parseInt(e.target.value, 10);
    // drop assignments pointing at courts that no longer exist
    Object.keys(state.assign).forEach(id => { if (state.assign[id] >= state.courts) delete state.assign[id]; });
    state.groups = null; persist(); renderSetup();
  };

  app.querySelectorAll("[data-assign]").forEach(b => b.onclick = () => {
    const id = b.dataset.assign, ci = +b.dataset.court;
    state.assign[id] = (state.assign[id] === ci) ? undefined : ci; // tap again to unassign
    if (state.assign[id] === undefined) delete state.assign[id];
    state.groups = null; persist(); renderSetup();
  });

  const auto = document.getElementById("autoAssign");
  if (auto) auto.onclick = () => { autoFill(); state.groups = null; persist(); renderSetup(); };
  const clr = document.getElementById("clearAssign");
  if (clr) clr.onclick = () => { state.assign = {}; state.groups = null; persist(); renderSetup(); };

  const tp = document.getElementById("toPlay");
  if (tp) tp.onclick = () => { buildGroupsFromAssign(); setView("play"); };
}

// Spread players across courts as evenly as possible, in roster order.
function autoFill() {
  state.assign = {};
  state.players.forEach((p, i) => { state.assign[p.id] = i % state.courts; });
}

// Validate the manual assignment: everyone placed, every court 4–6.
function assignValidity() {
  if (!state.players.length) return { ok: false, msg: "Add players first." };
  if (unassignedPlayers().length)
    return { ok: false, msg: `Assign all ${state.players.length} players to a court to continue.` };
  const counts = courtCounts();
  const bad = counts.map((c, i) => ({ c, i })).filter(x => !groupSizeOk(x.c));
  if (bad.length)
    return { ok: false, msg: `Each court needs 4–6 players. Fix: ${bad.map(x => `Court ${x.i+1} has ${x.c}`).join(", ")}.` };
  return { ok: true };
}

// Build the derived groups from the assignment map (called when starting scoring).
function buildGroupsFromAssign() {
  const prev = state.groups || [];
  state.groups = Array.from({ length: state.courts }, (_, ci) => {
    const seats = state.players.filter(p => state.assign[p.id] === ci).map(p => p.id);
    // preserve existing scores if this court's exact lineup is unchanged
    const old = prev[ci];
    const same = old && old.seats.length === seats.length && old.seats.every((s, i) => s === seats[i]);
    return { label: GROUP_LABELS[ci], seats, scores: same ? old.scores : {} };
  });
  persist();
}

/* ---------- Play / scoring ---------- */
function renderPlay() {
  // (re)derive groups from the current court assignment
  if (assignValidity().ok) buildGroupsFromAssign();
  if (!state.groups || !state.groups.length || !assignValidity().ok) {
    app.innerHTML = `<div class="card"><p class="empty">Assign every player to a court (4–6 per court) on the <b>Courts</b> tab first.</p></div>`;
    return;
  }
  // First time the Play tab renders this session, start fully collapsed.
  if (!courtsCollapsedByDefault) {
    state.groups.forEach((_, gi) => collapsedCourts.add(gi));
    courtsCollapsedByDefault = true;
  }
  const collapseControls = state.groups.length > 1
    ? `<div class="row" style="justify-content:flex-end; gap:12px; margin:2px 2px 10px">
         <button id="expandAll" class="btn ghost sm">Expand all</button>
         <button id="collapseAll" class="btn ghost sm">Collapse all</button>
       </div>`
    : "";
  app.innerHTML = playShareBar() + collapseControls +
    state.groups.map((g, gi) => playGroupCard(g, gi)).join("") +
    (isJoiner ? "" : `<button class="btn block" id="toSheet">Review & finalize →</button>`);

  // wire score inputs — update locally AND push the single field to the session
  app.querySelectorAll("input[data-g]").forEach(inp => {
    inp.oninput = () => {
      const gi = +inp.dataset.group, game = +inp.dataset.g, side = inp.dataset.side;
      // clamp to 0–21 (a badminton game tops out at 21)
      if (inp.value !== "") {
        let v = Math.floor(Math.abs(parseInt(inp.value, 10)) || 0);
        if (v > 21) v = 21;
        if (String(v) !== inp.value) inp.value = v;
      }
      state.groups[gi].scores[game] = state.groups[gi].scores[game] || {};
      state.groups[gi].scores[game][side] = inp.value;
      persist();
      updateTotalsUI(gi);
      pushScore(gi, game, side, inp.value);
    };
  });

  // remember collapse state per court so live re-renders don't fight the user
  app.querySelectorAll("details.court-card").forEach(d => d.addEventListener("toggle", () => {
    const gi = +d.dataset.court;
    if (d.open) collapsedCourts.delete(gi); else collapsedCourts.add(gi);
  }));

  // expand/collapse all
  const exp = document.getElementById("expandAll"), col = document.getElementById("collapseAll");
  if (exp) exp.onclick = () => { collapsedCourts.clear(); renderPlay(); };
  if (col) col.onclick = () => { state.groups.forEach((_, gi) => collapsedCourts.add(gi)); renderPlay(); };

  const ts = document.getElementById("toSheet");
  if (ts) ts.onclick = () => setView("sheet");
  wireShareBar();
}

// Banner at the top of the Play tab: share link (host) or live indicator (joiner).
function playShareBar() {
  if (sessionId) {
    const url = shareUrl(sessionId);
    const tag = Sync.mode === "firebase"
      ? `<span class="live-dot"></span> Live · everyone with the link updates together`
      : `<span class="live-dot local"></span> Local test mode · syncs between tabs on this device`;
    return `
      <div class="card sharecard">
        <div class="muted" style="margin-bottom:6px">${tag}</div>
        ${isJoiner ? "" : `
        <label class="muted">Share this link so others can enter scores:</label>
        <div class="row" style="margin-top:6px">
          <input id="shareLink" class="field" readonly value="${escapeHtml(url)}" />
          <button id="copyShare" class="btn sm">Copy</button>
        </div>
        <div class="row wrap" style="margin-top:6px">
          <button id="shareSheet" class="btn secondary sm">Share…</button>
          <span class="help" style="margin:0">Session code: <code>${sessionId}</code></span>
        </div>`}
      </div>`;
  }
  if (isJoiner) return ""; // joiner with no session resolved yet
  return `
    <div class="card sharecard">
      <label class="muted">Let everyone enter scores from their own phone:</label>
      <button id="startShare" class="btn volt block" style="margin-top:8px">Start live scoring &amp; get share link</button>
      <p class="help">Creates a shared session and a link you can send to your group.</p>
    </div>`;
}

function wireShareBar() {
  const start = document.getElementById("startShare");
  if (start) start.onclick = startSharing;
  const copyBtn = document.getElementById("copyShare");
  if (copyBtn) copyBtn.onclick = () => copy(shareUrl(sessionId), "Link copied — send it to your group");
  const sh = document.getElementById("shareSheet");
  if (sh) sh.onclick = async () => {
    const url = shareUrl(sessionId);
    if (navigator.share) { try { await navigator.share({ title: state.title, text: "Enter badminton scores:", url }); } catch {} }
    else copy(url, "Link copied");
  };
}

// Remembers which court cards are collapsed (by court index) across re-renders,
// so a live sync update doesn't reopen a court someone closed.
const collapsedCourts = new Set();
// Play tab opens with every court collapsed; once the user touches a card we
// stop forcing it so their choices stick.
let courtsCollapsedByDefault = false;

// Short summary shown on a collapsed court header: games scored + current leader.
function courtSummary(g) {
  const sched = scheduleFor(g);
  let done = 0;
  sched.forEach((_, idx) => {
    const sc = g.scores[idx];
    if (sc && ((sc.A !== undefined && sc.A !== "") || (sc.B !== undefined && sc.B !== ""))) done++;
  });
  const totals = computeTotals(g);
  const ranks = rankings(totals);
  const leadIdx = ranks.indexOf(1);
  const leader = done && leadIdx >= 0 ? nameOf(g.seats[leadIdx]) : "—";
  return `${done}/${sched.length} games · leader: ${escapeHtml(leader)}`;
}

function playGroupCard(g, gi) {
  const sched = scheduleFor(g);
  const matches = sched.map((game, idx) => {
    const [a1, a2, b1, b2] = game;
    const sc = g.scores[idx] || {};
    const sitters = sittersFor(g, game).map(s => nameOf(g.seats[s-1]));
    return `
      <div class="match-row">
        <span class="match-g">G${idx+1}</span>
        <span class="pair a">${pairName(g,a1)} & ${pairName(g,a2)}</span>
        <input class="score-in" inputmode="numeric" type="number" min="0" max="21" data-group="${gi}" data-g="${idx}" data-side="A" value="${sc.A ?? ""}" placeholder="0" />
        <span class="vs">vs</span>
        <input class="score-in" inputmode="numeric" type="number" min="0" max="21" data-group="${gi}" data-g="${idx}" data-side="B" value="${sc.B ?? ""}" placeholder="0" />
        <span class="pair b">${pairName(g,b1)} & ${pairName(g,b2)}</span>
        ${sitters.length ? `<span class="sit">(${sitters.join(", ")} sit)</span>` : `<span class="sit"></span>`}
      </div>`;
  }).join("");

  const open = collapsedCourts.has(gi) ? "" : "open";
  return `
    <details class="card court-card" data-court="${gi}" ${open}>
      <summary class="court-summary">
        <span class="court-title"><h3>Group ${g.label} <span class="badge">Court ${gi+1}</span></h3></span>
        <span class="court-meta">${courtSummary(g)}</span>
        <span class="chev" aria-hidden="true">▾</span>
      </summary>
      <div class="court-body">
        ${matches}
        <div class="scroll-x" id="totals-${gi}" style="margin-top:12px">${totalsTable(g)}</div>
      </div>
    </details>`;
}

function pairName(g, seat) { return escapeHtml(nameOf(g.seats[seat-1])); }

function totalsTable(g) {
  const totals = computeTotals(g);
  const ranks = rankings(totals);
  const rows = g.seats.map((id, i) => ({ name: nameOf(id), total: totals[i], rank: ranks[i] }))
    .sort((a, b) => a.rank - b.rank);
  return `
    <table>
      <thead><tr><th>Rank</th><th class="name">Player</th><th>Total</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr class="${r.rank===1?"rank-1":""}">
            <td>${r.rank}</td><td class="name">${escapeHtml(r.name)}</td>
            <td class="total-cell">${r.total}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function updateTotalsUI(gi) {
  const el = document.getElementById(`totals-${gi}`);
  if (el) el.innerHTML = totalsTable(state.groups[gi]);
  // keep the collapsed-card summary (games done · leader) in sync too
  const meta = app.querySelector(`details.court-card[data-court="${gi}"] .court-meta`);
  if (meta) meta.innerHTML = courtSummary(state.groups[gi]);
}

/* ---------- Finalize → PDF ---------- */

// How many games have at least one score entered, out of total.
function scoreProgress() {
  let done = 0, total = 0;
  (state.groups || []).forEach(g => {
    scheduleFor(g).forEach((_, idx) => {
      total++;
      const sc = g.scores[idx];
      if (sc && (sc.A !== undefined && sc.A !== "" || sc.B !== undefined && sc.B !== "")) done++;
    });
  });
  return { done, total };
}

function renderSheet() {
  if (!state.groups) {
    app.innerHTML = `<div class="card"><p class="empty">No groups yet. Go to <b>Courts</b>, assign players, then enter scores in <b>Play</b>.</p></div>`;
    return;
  }
  const { done, total } = scoreProgress();
  const complete = done === total;
  app.innerHTML = `
    <div class="card">
      <h2>Finalize & generate PDF</h2>
      <label class="muted">Title</label>
      <input id="docTitle" class="field" value="${escapeHtml(state.title)}" />
      <label class="muted" style="margin-top:8px;display:block">Date</label>
      <input id="docDate" class="field" value="${escapeHtml(state.date)}" />

      <p class="help" style="margin-top:12px">
        Scores entered: <b>${done} / ${total}</b> games.
        ${complete ? "✓ All games scored." : `<span style="color:var(--danger)">${total - done} game(s) still blank — blanks count as 0.</span>`}
      </p>

      <button id="finalizeBtn" class="btn block" style="margin-top:8px">
        Finalize score &amp; generate PDF
      </button>
      <p class="help">Opens a clean printable sheet, then your phone's <b>Save as PDF</b> dialog. Choose "Save as PDF" as the destination to download it.</p>

      <div class="row" style="margin-top:6px">
        <button id="previewBtn" class="btn ghost sm">Preview standings</button>
      </div>
      <div id="finalPreview"></div>
    </div>`;

  document.getElementById("docTitle").onchange = e => { state.title = e.target.value.trim() || "Mini League Ladder"; persist(); };
  document.getElementById("docDate").onchange = e => { state.date = e.target.value.trim(); persist(); };
  document.getElementById("finalizeBtn").onclick = finalizeAndPrint;
  document.getElementById("previewBtn").onclick = () => {
    const el = document.getElementById("finalPreview");
    el.innerHTML = el.innerHTML ? "" : standingsPreviewHtml();
  };
}

function standingsPreviewHtml() {
  return `<div style="margin-top:12px">` + buildPayload().groups.map(g => `
    <div class="group-head" style="margin-top:10px"><h3>Group ${g.label} · Court ${g.court}</h3></div>
    <table>
      <thead><tr><th>Rank</th><th class="name">Player</th><th>Total</th></tr></thead>
      <tbody>${g.players.slice().sort((a,b)=>a.ranking-b.ranking).map(p =>
        `<tr class="${p.ranking===1?"rank-1":""}"><td>${p.ranking}</td><td class="name">${escapeHtml(p.name)}</td><td class="total-cell">${p.total}</td></tr>`).join("")}
      </tbody>
    </table>`).join("") + `</div>`;
}

function buildPayload() {
  return {
    title: state.title || "Mini League Ladder",
    date: state.date,
    groups: (state.groups || []).map((g, gi) => {
      const sched = scheduleFor(g);
      const totals = computeTotals(g);
      const ranks = rankings(totals);
      return {
        label: g.label,
        court: gi + 1,
        players: g.seats.map((id, i) => ({
          seat: i + 1, name: nameOf(id), total: totals[i], ranking: ranks[i],
        })),
        games: sched.map((game, idx) => {
          const sc = g.scores[idx] || {};
          const [a1,a2,b1,b2] = game;
          return {
            game: idx + 1,
            teamA: [nameOf(g.seats[a1-1]), nameOf(g.seats[a2-1])],
            teamB: [nameOf(g.seats[b1-1]), nameOf(g.seats[b2-1])],
            scoreA: num(sc.A), scoreB: num(sc.B),
          };
        }),
      };
    }),
  };
}

// Build the printable HTML document and open the print/Save-as-PDF dialog.
function finalizeAndPrint() {
  const p = buildPayload();
  const html = printableHtml(p);
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0"; frame.style.bottom = "0";
  frame.style.width = "0"; frame.style.height = "0"; frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  // give the iframe a tick to lay out, then print
  frame.onload = () => {
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      // clean up after the dialog closes
      setTimeout(() => frame.remove(), 1500);
    }, 250);
  };
  toast('Choose "Save as PDF" in the dialog');
}

function printableHtml(p) {
  const MEDAL = { 1: "🏆", 2: "🥈", 3: "🥉" };
  const RANKCLASS = { 1: "gold", 2: "silver", 3: "bronze" };

  const groups = p.groups.map((g, i) => {
    const sorted = g.players.slice().sort((a, b) => a.ranking - b.ranking);
    const champ = sorted.find(pl => pl.ranking === 1);
    const standings = sorted.map(pl => {
      const medal = MEDAL[pl.ranking] || "";
      const cls = RANKCLASS[pl.ranking] || "";
      return `<tr class="${cls}">
        <td class="c rankcell">${medal ? `<span class="medal">${medal}</span>` : ""}${pl.ranking}</td>
        <td>${escapeHtml(pl.name)}</td>
        <td class="c b">${pl.total}</td></tr>`;
    }).join("");
    const games = g.games.map(m => {
      const aWin = m.scoreA > m.scoreB, bWin = m.scoreB > m.scoreA;
      return `<tr>
        <td class="c"><span class="gpill">G${m.game}</span></td>
        <td class="r ${aWin ? "wteam" : ""}">${escapeHtml(m.teamA[0])} &amp; ${escapeHtml(m.teamA[1])}</td>
        <td class="c b score">${m.scoreA} – ${m.scoreB}</td>
        <td class="${bWin ? "wteam" : ""}">${escapeHtml(m.teamB[0])} &amp; ${escapeHtml(m.teamB[1])}</td></tr>`;
    }).join("");
    return `
      <section class="grp grp-${i % 4}">
        <h2><span>Group ${g.label}</span><span class="court">Court ${g.court}</span></h2>
        ${champ ? `<div class="champ">🏆 Champion: <b>${escapeHtml(champ.name)}</b> <span class="cpts">${champ.total} pts</span></div>` : ""}
        <div class="cols">
          <table class="standings">
            <thead><tr><th>Rank</th><th>Player</th><th>Total</th></tr></thead>
            <tbody>${standings}</tbody>
          </table>
          <table class="games">
            <thead><tr><th>Game</th><th>Team A</th><th>Score</th><th>Team B</th></tr></thead>
            <tbody>${games}</tbody>
          </table>
        </div>
      </section>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(p.title)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    /* force background colours to print (browsers strip them by default) */
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; color:#161a2b; margin:0; }
    .head {
      display:flex; justify-content:space-between; align-items:center;
      background:linear-gradient(120deg,#1b1f3b 0%,#2563ff 60%,#13b5ff 100%);
      color:#fff; padding:14px 18px; border-radius:12px; margin-bottom:16px;
    }
    .head h1 { margin:0; font-size:23px; font-style:italic; letter-spacing:-.02em; }
    .head h1 .brand { color:#c6ff00; }
    .head .date { font-size:13px; background:rgba(255,255,255,.15); padding:6px 12px; border-radius:8px; }
    .grp { margin-bottom:16px; page-break-inside:avoid; border:1px solid #e2e6f2; border-radius:12px; overflow:hidden; }
    .grp h2 {
      font-size:15px; margin:0; color:#fff; padding:8px 14px;
      display:flex; justify-content:space-between; align-items:center;
    }
    .grp h2 .court { font-weight:normal; font-size:11px; text-transform:uppercase; letter-spacing:.05em;
                     background:rgba(255,255,255,.2); padding:3px 9px; border-radius:999px; }
    /* a different accent header per court */
    .grp-0 h2 { background:linear-gradient(90deg,#2563ff,#13b5ff); }
    .grp-1 h2 { background:linear-gradient(90deg,#7c3aed,#c026d3); }
    .grp-2 h2 { background:linear-gradient(90deg,#0d9488,#22c55e); }
    .grp-3 h2 { background:linear-gradient(90deg,#ea580c,#f59e0b); }
    .champ {
      background:linear-gradient(90deg,#fff7d6,#fde9a8); color:#7a5b00;
      font-size:12.5px; padding:6px 14px; border-bottom:1px solid #f0d98a;
    }
    .champ .cpts { float:right; font-weight:bold; }
    .cols { display:flex; gap:12px; align-items:flex-start; padding:12px 14px 14px; }
    .standings { width:44%; } .games { width:56%; }
    table { border-collapse:collapse; font-size:12px; width:100%; }
    th, td { border:1px solid #e2e6f2; padding:5px 7px; text-align:left; }
    th { background:#1b1f3b; color:#fff; font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
    td.c { text-align:center; } td.r { text-align:right; } td.b { font-weight:bold; }
    .rankcell { white-space:nowrap; font-weight:bold; }
    .medal { font-size:14px; margin-right:3px; }
    .score { color:#1b1f3b; }
    .wteam { font-weight:bold; color:#1b6b39; }
    tr.gold   td { background:#fff4c2; }
    tr.silver td { background:#eef1f6; }
    tr.bronze td { background:#fbe6d2; }
    .gpill { display:inline-block; background:#2563ff; color:#fff; font-weight:bold;
             font-size:10px; padding:2px 8px; border-radius:999px; }
    .foot { margin-top:12px; font-size:10px; color:#6b7280; text-align:center; }
    .foot b { color:#2563ff; }
  </style></head><body>
    <div class="head">
      <h1><span class="brand">Laddy</span> · ${escapeHtml(p.title)}</h1>
      <div class="date">${escapeHtml(p.date)}</div>
    </div>
    ${groups}
    <div class="foot"><b>Laddy</b> · 🏆 winner per court · Total = sum of points your pair scored across your games.</div>
  </body></html>`;
}

/* ---------- helpers ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function copy(text, msg) {
  navigator.clipboard?.writeText(text).then(() => toast(msg || "Copied"))
    .catch(() => { window.prompt("Copy:", text); });
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---- boot ---- */
(function boot() {
  const params = new URLSearchParams(location.search);
  const sid = params.get("s");
  if (sid) {
    // Opened via a share link: become a scoring-only joiner.
    document.body.classList.add("joiner");
    joinSession(sid).then(() => render());
    render(); // show "loading/play" frame immediately
  } else {
    render();
  }
})();

/* ---- service worker for installability/offline ---- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
