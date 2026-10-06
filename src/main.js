import "./style.css";
import walterImage from "./walter.png";

const app = document.querySelector("#app");
const hostMode = new URLSearchParams(location.search).get("host") === "1";
document.body.classList.toggle("participant-mode", !hostMode);
document.body.classList.toggle("host-mode", hostMode);

let state = null;
let error = "";
let player = JSON.parse(localStorage.getItem("pbrPracticePlayer") || "null");
let lastOwnPassword = localStorage.getItem("pbrPracticeLastPasswordV12") || "";
let copiedPassword = localStorage.getItem("pbrPracticeCopiedPasswordV12") || "";
let hostKey = sessionStorage.getItem("pbrPracticeHostKey") || "";
let refreshSequence = 0;
let appliedRefreshSequence = 0;
let resultOverlayUntil = 0;
let resultOverlayKey = "";
let roundIntroKey = "";
let roundIntroUntil = 0;
let participantRoundDeadline = 0;
let discardNextInputRestore = false;

// V9 migration: old field/storage identities are retired completely.
// This prevents a mobile browser from restoring text from earlier builds.
localStorage.removeItem("pbrPracticeLastPassword");
localStorage.removeItem("pbrPracticeCopiedPassword");
localStorage.removeItem("pbrPracticeLastPasswordV8");
localStorage.removeItem("pbrPracticeCopiedPasswordV8");
localStorage.removeItem("pbrPracticeLastPasswordV9");
localStorage.removeItem("pbrPracticeCopiedPasswordV9");
localStorage.removeItem("pbrPracticeLastPasswordV10");
localStorage.removeItem("pbrPracticeCopiedPasswordV10");
localStorage.removeItem("pbrPracticeLastPasswordV11");
localStorage.removeItem("pbrPracticeCopiedPasswordV11");
document.documentElement.dataset.practiceBuild = "v21-reaction-registered";

const SESSION_STORAGE_KEY = "pbrPracticeSessionId";

function clearOldPracticeSession() {
  // Clear only this practice game's browser cache. Wedding-game storage is untouched.
  localStorage.removeItem("pbrPracticePlayer");
  localStorage.removeItem("pbrPracticeLastPassword");
  localStorage.removeItem("pbrPracticeCopiedPassword");
  localStorage.removeItem("pbrPracticeLastPasswordV12");
  localStorage.removeItem("pbrPracticeCopiedPasswordV12");

  // Walter/egg keys include the old player id, so remove every practice key
  // in those two namespaces when a completely new game session is detected.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i) || "";
    if (key.startsWith("pbrPracticeWalter:") || key.startsWith("pbrPracticeEgg:") || key.startsWith("pbrPracticeVote:")) {
      localStorage.removeItem(key);
    }
  }

  player = null;
  lastOwnPassword = "";
  copiedPassword = "";
}

function syncPracticeSession(nextState) {
  const sessionId = String(nextState?.meta?.sessionId || "");
  if (!sessionId) return;
  const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY) || "";

  if (storedSessionId !== sessionId) {
    clearOldPracticeSession();
    // A full host reset starts a genuinely new game. Do not restore whatever
    // text happened to be focused in the old session (for example a nickname).
    if (!hostMode) discardNextInputRestore = true;
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function teamSizeFromNickname(name) {
  const value = String(name || "").trim();
  const explicit = value.match(/\(\s*([2-6])\s*\)\s*$/);
  if (explicit) return Number(explicit[1]);
  const parts = value
    .split(/\s*(?:&|\/|\+|,|\bog\b|\band\b)\s*/iu)
    .map(part => part.trim())
    .filter(Boolean);
  return Math.max(1, Math.min(6, parts.length));
}

function teamHintHtml(name = "") {
  const size = teamSizeFromNickname(name);
  return size > 1 ? `👥 Lag på ${size} · +${size - 1} tegn` : "";
}

function statusText(s) {
  return ({
    lobby: "Lobby",
    round_open: "Runde pågår",
    results: "Mellom runder",
    game_over: "Prøverunden er ferdig"
  })[s] || s;
}

async function api(body = null) {
  const res = await fetch("/api/game", body ? {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(hostKey ? { "X-Host-Key": hostKey } : {})
    },
    body: JSON.stringify(body)
  } : { cache: "no-store" });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Feil (${res.status})`);
  return data;
}

function me() {
  return state?.players?.find(p => p.id === player?.id) || null;
}

function currentRoundKey(nextState = state) {
  return `${nextState?.meta?.sessionId || "session"}:${nextState?.meta?.round || 0}`;
}

function armRoundIntro(previousStatus, previousRound, nextState) {
  if (hostMode || previousStatus == null || nextState?.meta?.status !== "round_open") return;
  if (previousStatus === "round_open" && previousRound === nextState.meta.round) return;
  const key = currentRoundKey(nextState);
  if (key === roundIntroKey) return;
  roundIntroKey = key;
  roundIntroUntil = Date.now() + 2000;
  participantRoundDeadline = roundIntroUntil + Number(nextState?.meta?.roundSeconds || 60) * 1000;
  setTimeout(() => {
    if (currentRoundKey() === key && state?.meta?.status === "round_open") render();
  }, 2050);
}

function roundIntroActive() {
  return !hostMode && state?.meta?.status === "round_open" && currentRoundKey() === roundIntroKey && Date.now() < roundIntroUntil;
}

function roundStartOverlayHtml() {
  if (!roundIntroActive()) return "";
  return `<div class="round-start-overlay" role="status" aria-live="assertive">
    <div>Runde ${state.meta.round}/${state.totalRules}</div>
  </div>`;
}

function secondsLeft() {
  if (!state?.meta?.deadline) return null;
  const full = Number(state?.meta?.roundSeconds || 60);
  if (roundIntroActive()) return full;
  if (!hostMode && currentRoundKey() === roundIntroKey && participantRoundDeadline) {
    return Math.max(0, Math.ceil((participantRoundDeadline - Date.now()) / 1000));
  }
  return Math.min(full, Math.max(0, Math.ceil((state.meta.deadline - Date.now()) / 1000)));
}

function walterStorageKey() {
  return player?.id ? `pbrPracticeWalter:${player.id}:7` : "";
}

function walterSteps() {
  const self = me();
  const server = self?.walterRound === 7 ? Number(self?.walterSteps || 0) : 0;
  const key = walterStorageKey();
  const local = key ? Number(localStorage.getItem(key) || 0) : 0;
  return Math.max(0, Math.min(25, Math.max(server, local)));
}

function setWalterLocalSteps(steps) {
  const key = walterStorageKey();
  if (key) localStorage.setItem(key, String(Math.max(0, Math.min(25, Number(steps) || 0))));
}

function walterHtml() {
  if (state?.meta?.status !== "round_open" || state?.meta?.round !== 7 || !me()?.alive) return "";
  const steps = walterSteps();
  const left = 5 + (steps / 25) * 89;
  const done = steps >= 25;
  const progress = Math.max(0, Math.min(100, (steps / 25) * 100));
  const stepTicks = Array.from({ length: 25 }, (_, i) => `<i class="${i < steps ? "hit" : ""}"></i>`).join("");
  return `<div class="walter-challenge ${done ? "done" : ""}">
    <div class="walter-copy">
      <div>
        <strong>${done ? "Walter er over målstreken! 🏁" : "Dytt Walter over målstreken"}</strong>
        <small>Kun i runde 7 · 25 trykk totalt</small>
      </div>
      <span id="walter-count">${steps} / 25 trykk</span>
    </div>
    <div class="walter-track" aria-label="Walter-bane med 25 intervaller">
      <div class="walter-progress" id="walter-progress" style="width:${progress}%" aria-hidden="true"></div>
      <div class="walter-step-grid" aria-hidden="true">${stepTicks}</div>
      <div class="walter-start-label" aria-hidden="true">Start</div>
      <div class="walter-finish-label" aria-hidden="true">Mål</div>
      <div class="walter-finish" aria-hidden="true"></div>
      <button id="walter-button" class="walter-dog" type="button" style="left:${left}%" ${done ? "disabled" : ""} aria-label="Dytt Walter ett steg frem">
        <span class="walter-shadow" aria-hidden="true"></span>
        <img id="walter-image" src="${walterImage}" alt="Walter" draggable="false">
      </button>
    </div>
    <div id="walter-message" class="walter-message">${done ? "✓ Walter er i mål! Nå kan du endre passordet ditt, legge til minst tre emojier og deretter levere." : "Trykk på Walter. Hvert trykk flytter ham ett av 25 steg."}</div>
  </div>`;
}

function updateWalterDom(steps, animate = true) {
  const safe = Math.max(0, Math.min(25, Number(steps) || 0));
  setWalterLocalSteps(safe);
  const left = 5 + (safe / 25) * 89;
  const button = document.querySelector("#walter-button");
  const progress = document.querySelector("#walter-progress");
  const image = document.querySelector("#walter-image");
  const count = document.querySelector("#walter-count");
  const message = document.querySelector("#walter-message");
  const challenge = document.querySelector(".walter-challenge");
  if (button) {
    button.style.left = `${left}%`;
    button.disabled = safe >= 25;
  }
  if (count) count.textContent = `${safe} / 25 trykk`;
  if (progress) progress.style.width = `${(safe / 25) * 100}%`;
  document.querySelectorAll(".walter-step-grid i").forEach((tick, index) => {
    tick.classList.toggle("hit", index < safe);
  });
  if (message) message.textContent = safe >= 25 ? "✓ Walter er i mål! Nå kan du endre passordet ditt, legge til minst tre emojier og deretter levere." : "Trykk på Walter. Hvert trykk flytter ham ett av 25 steg.";
  if (challenge) challenge.classList.toggle("done", safe >= 25);
  const submitButton = document.querySelector("#submit-form button[type='submit'], #submit-form button:not([type])");
  if (submitButton && state?.meta?.round === 7) submitButton.disabled = safe < 25 || secondsLeft() === 0;
  if (animate && image) {
    image.classList.remove("walter-hop");
    void image.offsetWidth;
    image.classList.add("walter-hop");
    setTimeout(() => image.classList.remove("walter-hop"), 420);
  }
}

function voteStorageKey() {
  return player?.id ? `pbrPracticeVote:${player.id}:4` : "";
}

function selectedVoteId() {
  const key = voteStorageKey();
  return key ? (localStorage.getItem(key) || "") : "";
}

function setSelectedVoteId(targetId) {
  const key = voteStorageKey();
  if (key) localStorage.setItem(key, String(targetId || ""));
}

function lifeHtml(self) {
  if (!self?.alive || state?.meta?.status !== "round_open") return "";
  const lives = Math.max(1, Number(self.lives ?? 2));
  const hearts = lives >= 2 ? "❤️❤️" : "❤️🖤";
  return `<div class="life-info ${lives >= 2 ? "training" : "sudden"} compact-life-info">
    <div class="life-hearts">${hearts}</div>
    <div><strong>${lives} liv igjen</strong></div>
  </div>`;
}

function currentRoundSelfResult() {
  const self = me();
  if (!self) return null;
  return (state?.roundResults?.players || []).find(p => p.id === self.id) || null;
}

function resultOverlayHtml() {
  if (hostMode || state?.meta?.status !== "results") return "";
  if (!resultOverlayUntil || Date.now() >= resultOverlayUntil) return "";

  const result = currentRoundSelfResult();
  if (!result) return "";

  const lives = Math.max(0, Number(me()?.lives ?? (result.survived ? 1 : 0)));
  const hearts = lives >= 2 ? "❤️❤️" : lives === 1 ? "❤️🖤" : "🖤🖤";
  const failureText = (result.failures || [])
    .map(f => `<div class="result-overlay-reason">❌ ${esc(f)}</div>`)
    .join("");
  const lostLife = result.survived && result.valid === false;

  if (lostLife) {
    return `<div class="round-result-overlay life-hit">
      <div class="round-result-burst">💔</div>
      <div class="round-result-kicker">RUNDE ${state.meta.round}</div>
      <h2>DU MISTET ETT LIV</h2>
      <p class="round-result-sub">Men du er fortsatt med!</p>
      ${failureText}
      <div class="round-result-hearts">${hearts}</div>
      <small>${lives} liv igjen</small>
    </div>`;
  }

  if (result.survived) {
    return `<div class="round-result-overlay survived">
      <div class="round-result-burst">✓</div>
      <div class="round-result-kicker">RUNDE ${state.meta.round}</div>
      <h2>DU ER VIDERE!</h2>
      <p class="round-result-sub">Passordet ditt bestod runden.</p>
      <div class="round-result-hearts">${hearts}</div>
      <small>${lives} liv igjen</small>
    </div>`;
  }

  return `<div class="round-result-overlay eliminated">
    <div class="round-result-burst">✕</div>
    <div class="round-result-kicker">RUNDE ${state.meta.round}</div>
    <h2>DU ER ELIMINERT</h2>
    <p class="round-result-sub">Du er ute av prøverunden.</p>
    ${failureText || `<div class="result-overlay-reason">${esc(me()?.reason || "Rundens krav ble ikke oppfylt.")}</div>`}
    <div class="round-result-hearts">🖤🖤</div>
  </div>`;
}

function armResultOverlay(previousStatus, nextState) {
  if (hostMode) return;
  if (previousStatus !== "round_open" || nextState?.meta?.status !== "results") return;
  const key = `${nextState?.meta?.sessionId || "session"}:${nextState?.meta?.round || 0}`;
  if (key === resultOverlayKey) return;
  resultOverlayKey = key;
  resultOverlayUntil = Date.now() + 4000;
  setTimeout(() => {
    if (state?.meta?.status === "results" && Date.now() >= resultOverlayUntil) render();
  }, 4100);
}

function voteHtml() {
  if (state?.meta?.status !== "round_open" || state?.meta?.round !== 9 || !me()?.alive) return "";
  const self = me();
  const selected = selectedVoteId();
  const candidates = (state?.players || []).filter(p => p.alive && p.id !== self.id);
  if (!candidates.length) {
    return `<div class="vote-challenge"><div class="vote-head"><strong>☠️ Avstemning</strong><span>Ingen andre å stemme på</span></div></div>`;
  }
  return `<div class="vote-challenge">
    <div class="vote-head"><div><strong>☠️ Stem ut en deltaker</strong><small>Velg én annen spiller. Du kan endre stemmen frem til runden avsluttes.</small></div><span>${selected ? "Stemme valgt" : "Velg én"}</span></div>
    <div class="vote-table">
      ${candidates.map(c => `<button type="button" class="vote-row ${selected === c.id ? "selected" : ""}" data-vote-id="${esc(c.id)}">
        <span class="vote-name">${esc(c.name)}</span><span class="vote-skull">${selected === c.id ? "☠️" : "○"}</span>
      </button>`).join("")}
    </div>
    <p class="vote-note">Først vurderes passordene. Deretter ryker de to høyest stemte blant spillerne som ellers ville gått videre.</p>
  </div>`;
}

function eggStorageKey() {
  return player?.id ? `pbrPracticeEgg:${player.id}:10` : "";
}

function getEggState() {
  const key = eggStorageKey();
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (!parsed || !Number.isFinite(Number(parsed.startedAt))) return null;
    return {
      startedAt: Number(parsed.startedAt),
      stoppedElapsedMs: parsed.stoppedElapsedMs == null ? null : Number(parsed.stoppedElapsedMs)
    };
  } catch {
    return null;
  }
}

function saveEggState(value) {
  const key = eggStorageKey();
  if (!key) return;
  if (!value) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

function eggElapsedMs() {
  const egg = getEggState();
  if (!egg) return null;
  if (Number.isFinite(egg.stoppedElapsedMs)) return Math.max(0, egg.stoppedElapsedMs);
  return Math.max(0, Date.now() - egg.startedAt);
}

function formatEggTime(ms) {
  if (!Number.isFinite(Number(ms))) return "0.00";
  return (Math.max(0, Number(ms)) / 1000).toFixed(2);
}

function startEggTimer() {
  saveEggState({ startedAt: Date.now(), stoppedElapsedMs: null });
  render();
}

function stopEggTimer() {
  const egg = getEggState();
  if (!egg || Number.isFinite(egg.stoppedElapsedMs)) return;
  saveEggState({ ...egg, stoppedElapsedMs: Date.now() - egg.startedAt });
  render();
}

function resetEggTimer() {
  saveEggState(null);
  render();
}

function eggHtml() {
  if (state?.meta?.status !== "round_open" || state?.meta?.round !== 10 || !me()?.alive) return "";
  const egg = getEggState();
  const elapsed = eggElapsedMs();
  const stopped = egg && Number.isFinite(egg.stoppedElapsedMs);

  if (!egg) {
    return `<div class="egg-challenge" id="egg-challenge">
      <div class="egg-title"><strong>Kok et smilende egg 🥚</strong><span>1 sekund = 1 minutt</span></div>
      <p class="egg-instruction">Dra egget ned i kjelen. Timeren starter idet egget treffer vannet.</p>
      <div class="egg-kitchen" id="egg-kitchen">
        <button type="button" class="egg-drag" id="egg-drag" aria-label="Dra egget til kjelen"><span>🥚</span></button>
        <div class="egg-arrow" aria-hidden="true">↓</div>
        <div class="pot-wrap" id="egg-pot" aria-label="Kjele med kokende vann">
          <div class="pot-steam"><i></i><i></i><i></i></div>
          <div class="pot-rim"></div>
          <div class="pot-water"><span></span><span></span><span></span></div>
          <div class="pot-body"><div class="pot-handle"></div></div>
        </div>
      </div>
      <div class="egg-hint">Hold fingeren på egget og dra det ned i kjelen.</div>
    </div>`;
  }

  return `<div class="egg-challenge cooking ${stopped ? "stopped" : ""}" id="egg-challenge">
    <div class="egg-title"><strong>${stopped ? "Timeren er stoppet" : "Egget koker…"}</strong><span>1 sekund = 1 minutt</span></div>
    <div class="cooking-scene">
      <div class="pot-wrap pot-active" aria-hidden="true">
        <div class="pot-steam"><i></i><i></i><i></i></div>
        <div class="pot-rim"></div>
        <div class="pot-water"><span></span><span></span><span></span><b>🥚</b></div>
        <div class="pot-body"><div class="pot-handle"></div></div>
      </div>
      <div class="egg-clock"><small>TID</small><strong id="egg-timer">${formatEggTime(elapsed)}</strong><span>sekunder</span></div>
    </div>
    <div class="egg-actions">
      <button type="button" class="secondary" id="egg-stop" ${stopped ? "disabled" : ""}>Stopp</button>
      <button type="button" class="secondary" id="egg-retry">Prøv på nytt</button>
      <button type="button" class="egg-confirm" id="egg-confirm">Jeg stopper tiden her</button>
    </div>
    <p class="egg-note">Når du velger «Jeg stopper tiden her», sendes passordet automatisk inn. Resultatet vises først når runden avsluttes.</p>
  </div>`;
}

/*
  IMPORTANT TYPING FIX
  --------------------
  The old practice version captured the text field BEFORE waiting for the API.
  If the player typed while that request was in flight, those new characters
  were replaced by the older captured value when the page re-rendered.

  We now capture the field immediately before the synchronous DOM redraw,
  exactly like the wedding game. This preserves every character and the cursor.
*/
function captureInputState() {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;

  return {
    id: el.id || "",
    name: el.name || "",
    value: el.value,
    selectionStart: el.selectionStart,
    selectionEnd: el.selectionEnd
  };
}

function restoreInputState(saved) {
  if (!saved) return;
  const candidates = [...document.querySelectorAll("input, textarea")];
  const el = candidates.find(candidate =>
    (saved.id && candidate.id === saved.id) ||
    (saved.name && candidate.name === saved.name)
  );
  if (!el) return;

  el.value = saved.value;
  el.focus({ preventScroll: true });
  if (typeof saved.selectionStart === "number" && typeof el.setSelectionRange === "function") {
    try {
      el.setSelectionRange(saved.selectionStart, saved.selectionEnd ?? saved.selectionStart);
    } catch {}
  }
}

function syncLastOwnPasswordFromState(nextState) {
  if (!player?.id || nextState?.meta?.status !== "results") return;
  const mine = (nextState?.roundResults?.players || []).find(p => p.id === player.id);
  const submitted = typeof mine?.password === "string" ? mine.password : "";
  if (!submitted) return;
  lastOwnPassword = submitted;
  localStorage.setItem("pbrPracticeLastPasswordV12", submitted);
}

async function refresh() {
  const seq = ++refreshSequence;
  try {
    const nextState = await api();
    if (seq < appliedRefreshSequence) return;
    appliedRefreshSequence = seq;

    // A host reset creates a new sessionId. As soon as a participant's phone
    // sees it, remove cached password/player/minigame data from the old test.
    syncPracticeSession(nextState);
    syncLastOwnPasswordFromState(nextState);

    const changed = JSON.stringify(nextState) !== JSON.stringify(state);
    const hadError = Boolean(error);
    const previousStatus = state?.meta?.status ?? null;
    const previousRound = state?.meta?.round ?? null;
    armResultOverlay(previousStatus, nextState);
    armRoundIntro(previousStatus, previousRound, nextState);
    state = nextState;
    armReactionIntro(nextState);
    error = "";

    // Don't rebuild the page every two seconds when nothing changed.
    // This also makes typing feel much calmer on phones and slower networks.
    if (changed || hadError || !app.innerHTML) render();
  } catch (e) {
    if (seq < appliedRefreshSequence) return;
    appliedRefreshSequence = seq;
    const nextError = e.message;
    const changed = nextError !== error;
    error = nextError;
    if (changed || !state) render();
  }
}


let reactionIntroKey = "";
let reactionIntroUntil = 0;

function isReactionRound(nextState = state) {
  return nextState?.meta?.status === "round_open" && nextState?.rules?.[nextState.rules.length - 1]?.id === "reaction";
}

function reactionMatchFor(playerId, nextState = state) {
  return (nextState?.meta?.reaction?.matches || []).find(m => m.leftId === playerId || m.rightId === playerId) || null;
}

function reactionByeFor(playerId, nextState = state) {
  return (nextState?.meta?.reaction?.byes || []).find(b => b.id === playerId) || null;
}

function reactionOpponent(match, playerId) {
  if (!match) return null;
  if (match.leftId === playerId) return { id: match.rightId, name: match.rightName, emoji: match.rightEmoji };
  if (match.rightId === playerId) return { id: match.leftId, name: match.leftName, emoji: match.leftEmoji };
  return null;
}

function reactionSide(match, playerId) {
  if (!match) return null;
  if (match.leftId === playerId) return "left";
  if (match.rightId === playerId) return "right";
  return null;
}

function reactionHearts(lives) {
  const n = Math.max(0, Math.min(2, Number(lives || 0)));
  return "❤️".repeat(n) + "🖤".repeat(2 - n);
}

function armReactionIntro(nextState = state) {
  if (hostMode || !player?.id || !isReactionRound(nextState)) return;
  const match = reactionMatchFor(player.id, nextState);
  if (!match) return;
  const key = `${nextState?.meta?.sessionId || "session"}:${match.id}`;
  if (key === reactionIntroKey) return;
  reactionIntroKey = key;
  reactionIntroUntil = Date.now() + 3000;
  setTimeout(() => {
    if (reactionIntroKey === key && Date.now() >= reactionIntroUntil) render();
  }, 3050);
}

function reactionIntroHtml() {
  if (hostMode || Date.now() >= reactionIntroUntil || !player?.id) return "";
  const match = reactionMatchFor(player.id);
  const opponent = reactionOpponent(match, player.id);
  if (!match || !opponent) return "";
  return `<div class="reaction-opponent-overlay" role="status" aria-live="assertive">
    <div class="reaction-opponent-label">DIN MOTSTANDER DENNE RUNDEN ER</div>
    <div class="reaction-opponent-name">${esc(opponent.name)} <span>${esc(opponent.emoji || "⚡")}</span></div>
  </div>`;
}

function formatReactionMs(value, early = false) {
  if (early) return "FOR TIDLIG";
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)} ms` : "—";
}

function reactionViewHtml(self) {
  const bye = reactionByeFor(self.id);
  if (bye) {
    return `<section class="card winner reaction-bye-card">
      <h2>🎟️ Frirunde</h2>
      <p>Det var oddetall spillere, og du ble tilfeldig trukket til frirunde. Du er videre fra reaksjonstesten.</p>
      ${lifeHtml(self)}
    </section>`;
  }

  const match = reactionMatchFor(self.id);
  if (!match) return `<section class="card"><h2>⚡ Reaksjonsduell</h2><p>Venter på motstander…</p></section>`;
  const side = reactionSide(match, self.id);
  const otherSide = side === "left" ? "right" : "left";
  const opponent = reactionOpponent(match, self.id);
  const myLives = Number(match[`${side}Lives`] || 0);
  const oppLives = Number(match[`${otherSide}Lives`] || 0);
  const myReady = Boolean(match[`${side}Ready`]);
  const oppReady = Boolean(match[`${otherSide}Ready`]);
  const myReaction = match[`${side}ReactionMs`];
  const oppReaction = match[`${otherSide}ReactionMs`];
  const myEarly = Boolean(match[`${side}Early`]);
  const oppEarly = Boolean(match[`${otherSide}Early`]);

  if (match.finished) {
    if (match.winnerId === self.id) {
      return `<section class="card winner final-result-card reaction-finished-card">
        <h2>🏆 DU VANT DUELLEN</h2>
        <p>Du eliminerte <strong>${esc(opponent?.name || "motstanderen")}</strong> og er videre.</p>
        <div class="reaction-final-hearts">${reactionHearts(myLives)}</div>
      </section>`;
    }
    return `<section class="card danger final-result-card reaction-finished-card">
      <h2>💔 DU ER ELIMINERT</h2>
      <p>Du er eliminert fra leken av <strong>${esc(opponent?.name || "motstanderen")} ${esc(opponent?.emoji || "")}</strong>.</p>
    </section>`;
  }

  if (match.phase === "ready") {
    return `<section class="card accent reaction-card">
      <div class="reaction-versus">
        <div><small>Deg</small><strong>${esc(self.name)}</strong><span>${reactionHearts(myLives)}</span></div>
        <b>VS</b>
        <div><small>Motstander</small><strong>${esc(opponent?.name || "—")} ${esc(opponent?.emoji || "")}</strong><span>${reactionHearts(oppLives)}</span></div>
      </div>
      <div class="reaction-rules-short">
        <strong>Når skjermen blir grønn: trykk så raskt du kan.</strong>
        <span>Ikke trykk før. Taperen av hvert forsøk mister ett liv.</span>
      </div>
      <button id="reaction-ready" type="button" ${myReady ? "disabled" : ""}>${myReady ? "Du er klar ✓" : (Number(match.attempt || 1) > 1 ? "Klar for neste" : "Jeg er klar")}</button>
      <p class="reaction-ready-status">${myReady ? (oppReady ? "Begge er klare…" : `Venter på ${esc(opponent?.name || "motstanderen")}…`) : (oppReady ? `${esc(opponent?.name || "Motstanderen")} er klar.` : "Begge må trykke klar før forsøket starter.")}</p>
    </section>`;
  }

  if (match.phase === "armed") {
    const green = Number(match.signalAt || 0) > 0 && Date.now() >= Number(match.signalAt);
    const alreadyTapped = match[`${side}TapAt`] != null;
    return `<section class="card accent reaction-card reaction-live-card">
      <div class="reaction-versus compact">
        <div><strong>${esc(self.name)}</strong><span>${reactionHearts(myLives)}</span></div>
        <b>VS</b>
        <div><strong>${esc(opponent?.name || "—")}</strong><span>${reactionHearts(oppLives)}</span></div>
      </div>
      <button id="reaction-pad" class="reaction-pad ${alreadyTapped ? "registered" : (green ? "go" : "wait")}" type="button" ${alreadyTapped ? "disabled" : ""}>
        <span>${alreadyTapped ? "REGISTRERT" : (green ? "TRYKK!" : "GJØR DEG KLAR…")}</span>
      </button>
      <p class="reaction-live-note">${alreadyTapped ? `Venter på ${esc(opponent?.name || "motstanderen")}…` : "Vent på grønt signal."}</p>
    </section>`;
  }

  if (match.phase === "result") {
    const iWon = match.lastWinnerId === self.id;
    return `<section class="card ${iWon ? "winner" : "danger"} reaction-card reaction-result-card">
      <h2>${iWon ? "⚡ Du vant forsøket!" : "💔 Du tapte forsøket"}</h2>
      <div class="reaction-times">
        <div><small>Din reaksjonstid</small><strong>${formatReactionMs(myReaction, myEarly)}</strong></div>
        <div><small>${esc(opponent?.name || "Motstander")}</small><strong>${formatReactionMs(oppReaction, oppEarly)}</strong></div>
      </div>
      <div class="reaction-score"><span>${esc(self.name)} ${reactionHearts(myLives)}</span><b>VS</b><span>${reactionHearts(oppLives)} ${esc(opponent?.name || "")}</span></div>
      <p>${iWon ? `${esc(opponent?.name || "Motstanderen")} mistet ett liv.` : "Du mistet ett liv."}</p>
      <button id="reaction-ready" type="button" ${myReady ? "disabled" : ""}>${myReady ? "Klar ✓" : "Klar for neste"}</button>
      <p class="reaction-ready-status">${myReady ? `Venter på ${esc(opponent?.name || "motstanderen")}…` : "Neste forsøk starter først når begge er klare."}</p>
    </section>`;
  }

  return `<section class="card"><h2>⚡ Reaksjonsduell</h2><p>Synkroniserer kampen…</p></section>`;
}

function reactionHostHtml() {
  const reaction = state?.meta?.reaction;
  if (!reaction) return "";
  const matches = (reaction.matches || []).map(m => {
    const stateText = m.finished ? "FERDIG" : (m.phase === "armed" ? "REAKSJON" : (m.phase === "result" ? "RESULTAT" : "KLAR"));
    return `<div class="reaction-host-match"><span>${esc(m.leftName)} ${reactionHearts(m.leftLives)}</span><b>${stateText}</b><span>${reactionHearts(m.rightLives)} ${esc(m.rightName)}</span></div>`;
  }).join("");
  const byes = (reaction.byes || []).map(b => `<div class="reaction-host-bye">🎟️ ${esc(b.name)} har frirunde</div>`).join("");
  return `<div class="reaction-host-panel"><strong>⚡ Reaksjonsdueller</strong>${matches}${byes}</div>`;
}

function updateReactionPad() {
  if (!isReactionRound() || !player?.id) return;
  const match = reactionMatchFor(player.id);
  const pad = document.querySelector("#reaction-pad");
  if (!(pad instanceof HTMLElement) || !match || match.phase !== "armed") return;
  const side = reactionSide(match, player.id);
  if (match[`${side}TapAt`] != null) return;
  const go = Number(match.signalAt || 0) > 0 && Date.now() >= Number(match.signalAt);
  pad.classList.toggle("go", go);
  pad.classList.toggle("wait", !go);
  const label = pad.querySelector("span");
  if (label) label.textContent = go ? "TRYKK!" : "GJØR DEG KLAR…";
}

function rulesHtml() {
  if (!state?.rules?.length) {
    return `<p class="muted">Reglene kommer når hosten starter prøverunden.</p>`;
  }
  const latestIndex = state.rules.length - 1;
  const oldRules = state.rules.slice(0, latestIndex);
  const latest = state.rules[latestIndex];
  if (latest?.id === "reaction") {
    return `<div class="rules-summary"><strong>Reaksjonsduell</strong><span>Passordreglene er satt på pause i denne testrunden.</span></div>
      <div class="rules-section-label new-rule-label">NY REGEL</div>
      <ol class="rules active-rules-list latest-only"><li class="latest-rule"><span>${latestIndex + 1}</span><div>${esc(latest.text)}</div></li></ol>`;
  }
  return `<div class="rules-summary"><strong>${state.rules.length} regel${state.rules.length === 1 ? "" : "er"} gjelder i denne runden</strong><span>Alle tidligere regler gjelder fortsatt.</span></div>
    ${oldRules.length ? `<div class="rules-section-label old-rules-label">Regler du fortsatt må følge</div><ol class="rules active-rules-list old-rules-list">${oldRules.map((r, i) => `<li><span>${i + 1}</span><div>${esc(r.text)}</div></li>`).join("")}</ol>` : ""}
    <div class="rules-section-label new-rule-label">NY REGEL</div>
    <ol class="rules active-rules-list latest-only"><li class="latest-rule"><span>${latestIndex + 1}</span><div>${esc(latest.text)}</div></li></ol>`;
}

function starCountText(count) {
  const n = Math.max(0, Number(count || 0));
  if (!n) return "";
  if (n <= 5) return "⭐".repeat(n);
  return `⭐×${n}`;
}

function shortKingData() {
  const players = state?.players || [];
  const maxStars = players.length ? Math.max(0, ...players.map(p => Number(p.stars || 0))) : 0;
  const winners = maxStars > 0 ? players.filter(p => Number(p.stars || 0) === maxStars) : [];
  return { maxStars, winners };
}

function shortKingInfoHtml() {
  return `<div class="short-king-info">
    <span class="star-icon">⭐</span>
    <div class="short-king-copy">
      <strong>Kortest gir stjerne</strong>
      <span class="short-king-description">Korteste gyldige passord hver runde får en stjerne. Flest stjerner til slutt blir THE SHORT KING.</span>
    </div>
  </div>`;
}

function practiceFailureLabel(text) {
  const value = String(text || "");
  const exactIndex = (state?.rules || []).findIndex(r => r.text === value);
  if (exactIndex >= 0) return `Regel ${exactIndex + 1}`;
  if (value.includes("stemme") || value.includes("Stemmet ut")) return "Regel 9";
  if (value.includes("Walter")) return "Regel 7";
  if (value.includes("Egget")) return "Regel 10";
  if (value.startsWith("Samme passord:")) return "Duplikatregel";
  if (value === "Ingen passord ble levert.") return "Ingen innsending";
  return "Regel";
}

function practiceFailuresHtml(failures) {
  const list = Array.isArray(failures) ? failures.filter(Boolean) : [];
  if (!list.length) return "";
  return `<div class="failure-list">${list.map(f => `<div class="failure-item">❌ <strong>${esc(practiceFailureLabel(f))}:</strong> ${esc(f)}</div>`).join("")}</div>`;
}

function playerStatusText(p) {
  if (!p.alive) return `Ute${p.eliminatedRound ? ` · runde ${p.eliminatedRound}` : ""}`;
  if (isReactionRound()) {
    if (reactionByeFor(p.id)) return "Frirunde";
    const match = reactionMatchFor(p.id);
    return match?.finished ? "Duell ferdig" : "Reaksjonsduell";
  }
  if (state?.meta?.status === "round_open") return p.hasSubmitted ? "Levert" : "Venter";
  if (state?.meta?.status === "results") return "Videre";
  if (state?.meta?.status === "game_over") return "Finalist";
  return "Klar";
}

function playersHtml() {
  const players = state?.players || [];
  if (!players.length) return `<p class="muted">Ingen deltakere ennå.</p>`;

  const resultById = new Map((state?.roundResults?.players || []).map(r => [r.id, r]));
  return `<div class="players">
    ${players.map(p => {
      const roundResult = resultById.get(p.id);
      const colourClass = state?.meta?.status === "results" && roundResult?.rank === 1 && roundResult?.valid
        ? "leader"
        : (p.alive ? "alive" : "dead");
      return `<div class="player ${colourClass}">
        <div class="player-main">
          <strong class="player-name-line"><span>${esc(p.name)}</span>${["results","game_over"].includes(state?.meta?.status) && Number(p.stars || 0) > 0 ? `<span class="nickname-stars" title="${Number(p.stars || 0)} stjerne${Number(p.stars || 0) === 1 ? "" : "r"}">${starCountText(p.stars)}</span>` : ""}</strong>
          <small>${roundResult?.rank === 1 && roundResult?.valid && state?.meta?.status === "results" ? "1. plass · " : ""}${esc(playerStatusText(p))}${state?.meta?.round && p.alive ? ` · ${Number(p.lives || 0) >= 2 ? "❤️❤️" : "❤️🖤"}` : ""}</small>
        </div>
        <div class="dot" title="${roundResult?.rank === 1 && roundResult?.valid ? "Førsteplass" : (p.alive ? "Med" : "Eliminert")}"></div>
      </div>`;
    }).join("")}
  </div>`;
}

function resultsHtml() {
  const r = state?.roundResults;
  if (!r) return "";

  const finalRound = r.round >= state.totalRules && state.meta.status === "game_over";
  const winners = new Set(state.meta.winners || []);

  return `<section class="card results-card">
    <div class="card-title">
      <h2>Passordrangering · runde ${r.round}</h2>
      <span>${r.remaining} videre</span>
    </div>
    ${r.starWinners?.length ? `<div class="star-award"><span>⭐</span><div><strong>Kortest denne runden</strong><small>${r.starWinners.map(w => `${esc(w.name)} · ${w.effectivePasswordLength ?? w.passwordLength} tegn`).join(" & ")}</small></div></div>` : ""}

    <div class="players wedding-result-list">
      ${r.players.map(p => {
        const isWinner = finalRound && winners.has(p.name);
        const gotStar = Boolean(p.starEarned);
        const lostLife = p.survived && p.valid === false;
        const rankText = p.rank ? `#${p.rank}` : "—";
        const lengthText = p.passwordLength != null
          ? `${p.effectivePasswordLength ?? p.passwordLength} tegn${Number(p.teamPenalty || 0) > 0 ? ` (${p.passwordLength} + ${p.teamPenalty} lag)` : ""}`
          : "Ingen innsending";
        const resultText = isWinner
          ? "🏆 Vinner"
          : lostLife
            ? "❤️ Mistet ett liv"
            : gotStar
              ? "⭐ Kortest"
              : (p.survived ? (finalRound ? "✓ Fullførte" : "✓ Videre") : "✕ Ute");
        const resultClass = isWinner || gotStar ? "result-gold" : (lostLife ? "result-life" : (p.survived ? "result-good" : "result-bad"));

        return `<div class="player ${p.survived ? "alive" : "dead"} ${gotStar ? "shortest" : ""} wedding-result-row">
          <div class="result-rank">${rankText}</div>
          <div class="player-main result-player-main">
            <strong>${esc(p.name)} ${Number(p.stars || 0) > 0 ? `<span class="nickname-stars">${starCountText(p.stars)}</span>` : ""} <small>· ${esc(lengthText)}</small></strong>
            <div class="password-result-line">
              <small class="mono password-result">${p.password ? esc(p.password) : "Ingen innsending"}</small>
              ${p.password ? `<button type="button" class="secondary copy-button copy-btn" data-copy="${encodeURIComponent(p.password)}">Kopier</button>` : ""}
            </div>
            ${hostMode && p.failures?.length ? `<small class="result-failures">${p.failures.map(f => esc(f)).join("<br>")}</small>` : ""}
          </div>
          <strong class="result-state ${resultClass}">${resultText}</strong>
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

function playerView() {
  const self = me();

  if (!player || !self) {
    if (state?.meta?.status !== "lobby") {
      return `<section class="card"><h2>Prøverunden har startet</h2><p>Oppdater siden eller be hosten nullstille prøverunden.</p></section>`;
    }
    return `<section class="card accent join-card">
      <h2>Join the game</h2>
      <form id="join-form">
        <label>Nickname
          <input id="nickname-input" name="name" maxlength="48" placeholder="Ditt navn" autocomplete="off" required>
          <small id="team-hint" class="team-hint" aria-live="polite"></small>
        </label>
        <button>Join</button>
      </form>
    </section>`;
  }

  if (isReactionRound() && self.alive) {
    return reactionViewHtml(self);
  }

  if (isReactionRound() && !self.alive) {
    return reactionViewHtml(self);
  }

  if (state.meta.status === "round_open" && self.alive) {
    const starter = copiedPassword || lastOwnPassword || "";
    const walterDone = state.meta.round !== 7 || walterSteps() >= 25;
    return `<section class="card rules-card participant-active-rules-card">
      <div class="card-title"><h2>Regler</h2><span class="round-progress-pill">${state.meta.round}/${state.totalRules}</span></div>
      ${rulesHtml()}
    </section>
    <section class="card accent play-card">
      ${lifeHtml(self)}
      ${shortKingInfoHtml()}
      <div class="submit-head compact-submit-head">
        <div class="countdown" id="timer">${secondsLeft() ?? "—"}s</div>
      </div>
      <form id="submit-form">
        <label>Password
          <input
            id="password-input"
            class="password-input"
            name="password"
            maxlength="200"
            value="${esc(starter)}"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            >
        </label>
        <div id="password-full-preview" class="password-full-preview" aria-live="polite"></div>
        ${voteHtml()}
        ${walterHtml()}
        ${eggHtml()}
        ${state.meta.round === 10 ? "" : `<button id="submit-password" type="button" ${secondsLeft() === 0 || !walterDone || roundIntroActive() ? "disabled" : ""}>Lever passord</button>`}
      </form>
      ${self.hasSubmitted ? `<div class="feedback good">✓ Passordet er lagret. Resultatet vises når runden avsluttes.</div>` : ""}

    </section>`;
  }

  if (state.meta.status === "round_open" && !self.alive) {
    return `<section class="card danger"><h2>Eliminert</h2><p>Du er ute av prøverunden, men kan fortsatt følge med.</p></section>`;
  }

  if (state.meta.status === "results") {
    const lifeLost = self.alive && self.valid === false;
    const myRoundResult = (state?.roundResults?.players || []).find(p => p.id === self.id);
    return `<section class="card ${self.alive ? "winner" : "danger"}">
      <h2>${lifeLost ? "❤️ Du mistet ett liv, men er fortsatt med!" : (self.alive ? `✓ Du gikk videre fra runde ${state.meta.round}` : `✕ Du ble eliminert i runde ${state.meta.round}`)}</h2>
      <p>${self.alive ? "Se rundens passord nedenfor. Neste runde starter med ditt eget eller et kopiert passord." : "Dette er bare trening – hovedleken starter helt på nytt."}</p>
      ${myRoundResult?.failures?.length ? practiceFailuresHtml(myRoundResult.failures) : ""}
      ${self.alive ? lifeHtml(self) : ""}
      ${copiedPassword ? `<div class="feedback good">Neste runde starter med det kopierte passordet: <code>${esc(copiedPassword)}</code></div>` : ""}
    </section>`;
  }

  if (state.meta.status === "game_over") {
    const winners = state.meta.winners || [];
    const won = winners.includes(self.name);
    const shortKing = shortKingData();
    const shortKingText = shortKing.winners.length
      ? `<div class="short-king-final"><span>⭐</span><div><small>THE SHORT KING${shortKing.winners.length > 1 ? "S" : ""}</small><strong>${esc(shortKing.winners.map(p => p.name).join(" & "))}</strong><p>${shortKing.maxStars} stjerne${shortKing.maxStars === 1 ? "" : "r"}</p></div></div>`
      : "";

    if (state?.rules?.[state.rules.length - 1]?.id === "reaction") {
      const match = reactionMatchFor(self.id);
      const bye = reactionByeFor(self.id);
      const opponent = reactionOpponent(match, self.id);
      if (bye && won) {
        return `<section class="card winner final-result-card"><h2>🎟️ Frirunde</h2><p>Du ble tilfeldig trukket til frirunde og gikk videre fra reaksjonstesten.</p>${shortKingText}</section>`;
      }
      if (match?.winnerId === self.id) {
        return `<section class="card winner final-result-card"><h2>🏆 DU VANT DUELLEN</h2><p>Du eliminerte <strong>${esc(opponent?.name || "motstanderen")}</strong> og gikk videre fra reaksjonstesten.</p>${shortKingText}</section>`;
      }
      if (match?.loserId === self.id) {
        return `<section class="card danger final-result-card"><h2>💔 DU ER ELIMINERT</h2><p>Du er eliminert fra leken av <strong>${esc(opponent?.name || "motstanderen")} ${esc(opponent?.emoji || "")}</strong>.</p>${shortKingText}</section>`;
      }
    }

    if (won) {
      return `<section class="card winner final-result-card">
        <h2>🏆 Du vant!</h2>
        <p>Du kom gjennom hele prøverunden${state.meta.winnerLength ? ` med et vinnende passord på <strong>${state.meta.winnerLength} tegn</strong>` : ""}.</p>
        ${shortKingText}
      </section>`;
    }

    if (self.alive) {
      return `<section class="card final-result-card">
        <h2>Du fullførte hele prøverunden!</h2>
        <p>${state.meta.winnerLength ? `Vinnerpassordet var på <strong>${state.meta.winnerLength} tegn</strong>.` : "Prøverunden er ferdig."}</p>
        ${shortKingText}
      </section>`;
    }

    return `<section class="card danger final-result-card">
      <h2>Game over</h2>
      <p>Prøverunden er ferdig. Du kan fortsatt se resultatene nedenfor.</p>
      ${shortKingText}
    </section>`;
  }

  return `<section class="card accent"><h2>You're in</h2><p>Du er med som <strong>${esc(self.name)}</strong>.</p>${Number(self.teamSize || 1) > 1 ? `<div class="team-badge">👥 Lag på ${self.teamSize} · +${Number(self.teamPenalty || self.teamSize - 1)} tegn</div>` : ""}</section>`;
}

function hostView() {
  if (!hostKey) {
    return `<section class="card host host-login">
      <div class="eyebrow">HOST CONTROLS</div>
      <h2 style="margin:.35rem 0 14px;">Låst</h2>
      <form id="host-login">
        <label>Host key
          <input name="key" type="password" autocomplete="off" required placeholder="Same as HOST_KEY in Vercel">
        </label>
        <div class="actions"><button>Åpne hostkontrollene</button></div>
      </form>
    </section>`;
  }

  const alive = state?.players?.filter(p => p.alive).length || 0;
  const round = state?.meta?.round || 0;

  return `<section class="card host host-card">
    <div class="eyebrow">HOST CONTROLS</div>
    <h2 style="margin:.35rem 0 14px;">Prøverunden</h2>
    ${state.meta.status === "round_open" && !isReactionRound() ? `<div class="host-ready-indicator"><strong>${state.players.filter(p => p.alive && p.hasSubmitted).length}/${alive}</strong><span>har levert</span></div>` : ""}
    ${isReactionRound() ? reactionHostHtml() : ""}
    ${["lobby", "results"].includes(state.meta.status) && round < state.totalRules ? `${round + 1 < state.totalRules ? `<label>Rundetid for runde ${Math.min(round + 1, state.totalRules)} (sekunder)
      <input id="round-seconds" type="number" min="10" max="300" value="${state.meta.roundSeconds || 60}">
    </label>` : `<div class="feedback good"><strong>Neste runde: REAKSJONSDUELL</strong><br>Deltakerne matches tilfeldig og tar med gjenværende liv.</div>`}
    <div class="actions"><button id="start-round">${round === 0 ? "Start game" : (round + 1 === state.totalRules ? "Start reaksjonsduell" : "Start next round")}</button></div>` : ""}
    ${state.meta.status === "round_open" && !isReactionRound() ? `<div class="actions"><button id="close-round">Close round now</button></div>` : ""}
    <div class="actions"><button id="reset" class="danger-button">Reset entire game</button></div>
    <p class="muted tiny">Player link: <span class="mono">${esc(location.origin + location.pathname)}</span></p>
  </section>`;
}

function fitParticipantPasswordInput(input) {
  if (!(input instanceof HTMLInputElement)) return;
  const maxPx = 20;
  const minPx = 16;
  input.style.fontSize = `${maxPx}px`;
  const available = Math.max(1, input.clientWidth - 16);
  const needed = Math.max(1, input.scrollWidth - 16);
  if (needed > available) {
    const fitted = Math.max(minPx, Math.min(maxPx, maxPx * available / needed));
    input.style.fontSize = `${fitted.toFixed(2)}px`;
  }
}

function setupParticipantPasswordDisplay() {
  const input = document.querySelector("#password-input");
  if (!(input instanceof HTMLInputElement)) return;
  const update = () => {
    fitParticipantPasswordInput(input);
    const preview = document.querySelector("#password-full-preview");
    if (!(preview instanceof HTMLElement)) return;
    const value = String(input.value || "");
    preview.textContent = value;
    const overflows = input.scrollWidth > input.clientWidth + 2;
    preview.classList.toggle("visible", Boolean(value) && overflows);
  };
  input.addEventListener("input", update);
  window.addEventListener("resize", update, { passive: true });
  requestAnimationFrame(update);
}

function render() {
  // Capture HERE, after any API wait has already finished. A full game reset
  // deliberately discards the focused field so old names/passwords cannot
  // bleed into the new session.
  const inputState = discardNextInputRestore ? null : captureInputState();
  discardNextInputRestore = false;

  if (!state) {
    app.innerHTML = `<main>
      <header>
        <div><h1>Password<br>Battle Royale</h1></div>
      </header>
      <div class="card"><p>${esc(error || "Laster…")}</p></div>
    </main>`;
    restoreInputState(inputState);
    return;
  }

  const aliveCount = state.players.filter(p => p.alive).length;
  const total = state.players.length;
  const meta = state.meta;

  // Expose the current game phase to CSS as a robust mobile fallback.
  // The rules card is also omitted from the participant DOM during results,
  // but this ensures it cannot reappear on wider/landscape phones or tablets.
  const participantResultPhase = !hostMode && (
    meta.status === "results" ||
    (resultOverlayUntil > Date.now())
  );
  const participantActiveRound = !hostMode && meta.status === "round_open" && !participantResultPhase;

  document.body.dataset.gameStatus = meta.status || "";
  document.body.dataset.participantPhase = hostMode ? "host" : (participantActiveRound ? "active-round" : "not-active-round");
  document.body.classList.toggle("participant-between-rounds", !hostMode && !participantActiveRound);

  // Reaksjonsduellen rendres som en egen deltakerskjerm, uavhengig av den vanlige
  // grid/aside-layouten. Dette hindrer mobile CSS-regler fra å skjule eller flytte
  // duellen og gjør samme DOM tilgjengelig på PC og mobil.
  if (!hostMode && isReactionRound() && player?.id) {
    const self = me();
    app.innerHTML = `<main class="reaction-participant-main">
      ${error ? `<div class="notice bad">${esc(error)}</div>` : ""}
      ${reactionIntroHtml()}
      <div class="reaction-participant-shell">
        ${self ? reactionViewHtml(self) : `<section class="card"><h2>⚡ Reaksjonsduell</h2><p>Synkroniserer kampen…</p></section>`}
      </div>
    </main>`;
    bind();
    restoreInputState(inputState);
    return;
  }

  app.innerHTML = `<main>
    <header>
      <div>
        <h1>Password<br>Battle Royale</h1>
      </div>
      <div class="status-block">
        <span>${statusText(meta.status)}</span>
        <strong>${meta.round ? `Runde ${meta.round} av ${state.totalRules}` : `${total} spiller${total === 1 ? "" : "e"}`}</strong>
        ${meta.status === "round_open"
          ? `<small id="header-countdown">${secondsLeft()}s igjen</small>`
          : `<small>${aliveCount} med</small>`}
      </div>
    </header>

    ${error ? `<div class="notice bad">${esc(error)}</div>` : ""}
    ${meta.status === "game_over" && (meta.winners || []).length ? `<div class="hero-winner">🏆 Vinner${meta.winners.length > 1 ? "e" : ""}: ${meta.winners.map(esc).join(", ")}${meta.winnerLength ? ` · ${meta.winnerLength} tegn` : ""}</div>` : ""}
    ${resultOverlayHtml()}
    ${roundStartOverlayHtml()}
    ${reactionIntroHtml()}

    <section class="grid">
      <div>
        ${hostMode ? `<section class="card rules-card host-rules-card">
          <div class="card-title"><h2>Regler</h2><span class="round-progress-pill">${meta.round ? `${meta.round}/${state.totalRules}` : "Venter på start"}</span></div>
          ${rulesHtml()}
        </section>` : ""}

        ${hostMode ? "" : playerView()}
        ${resultsHtml()}
      </div>

      <aside>
        <section class="card players-card">
          <div class="card-title"><h2>Players</h2><span>${aliveCount}/${total}</span></div>
          ${playersHtml()}
        </section>
        ${hostMode ? hostView() : ""}
      </aside>
    </section>

  </main>`;

  // Final participant safeguard: between rounds, remove the rules card from
  // the DOM entirely. This is intentionally not viewport-dependent, so mobile,
  // landscape phones and tablets all behave exactly like desktop participants.
  if (!hostMode && !participantActiveRound) {
    document.querySelectorAll(".rules-card").forEach(el => el.remove());
  }

  bind();
  restoreInputState(inputState);
}

function bind() {
  // The participant password field must never show instructional placeholder text.
  // Remove the attribute at runtime too, so an old DOM fragment or browser restore
  // cannot bring an old instructional hint back.
  const passwordInput = document.querySelector("#password-input");
  if (passwordInput) {
    passwordInput.removeAttribute("placeholder");
    passwordInput.setAttribute("autocomplete", "off");
  }
  setupParticipantPasswordDisplay();

  document.querySelector("#reaction-ready")?.addEventListener("click", async e => {
    const button = e.currentTarget;
    if (button instanceof HTMLButtonElement) { button.disabled = true; button.textContent = "Klar ✓"; }
    try {
      const response = await api({ action: "reaction_ready", playerId: player.id, token: player.token });
      if (response?.state) state = response.state;
      error = "";
      render();
    } catch (x) { error = x.message; render(); }
  });

  const reactionPad = document.querySelector("#reaction-pad");
  if (reactionPad) {
    let tapped = false;
    const tap = async e => {
      if (tapped) return;
      tapped = true;
      e.preventDefault?.();
      reactionPad.setAttribute("disabled", "");
      reactionPad.classList.remove("go", "wait");
      reactionPad.classList.add("registered");
      const label = reactionPad.querySelector("span");
      if (label) label.textContent = "REGISTRERT";
      const liveNote = document.querySelector(".reaction-live-note");
      const matchNow = reactionMatchFor(player.id);
      const opponentNow = reactionOpponent(matchNow, player.id);
      if (liveNote) liveNote.textContent = `Trykket er registrert. Venter på ${opponentNow?.name || "motstanderen"}…`;
      if (navigator.vibrate) navigator.vibrate(35);
      try {
        const response = await api({ action: "reaction_tap", playerId: player.id, token: player.token });
        if (response?.state) state = response.state;
        error = "";
        render();
      } catch (x) { tapped = false; error = x.message; render(); }
    };
    if (window.PointerEvent) {
      reactionPad.addEventListener("pointerdown", tap, { passive: false });
    } else {
      reactionPad.addEventListener("touchstart", tap, { passive: false });
      reactionPad.addEventListener("mousedown", tap);
    }
    reactionPad.addEventListener("click", tap);
    reactionPad.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") tap(e); });
  }

  const nicknameInput = document.querySelector("#nickname-input");
  const teamHint = document.querySelector("#team-hint");
  const updateTeamHint = () => {
    if (!teamHint) return;
    const text = teamHintHtml(nicknameInput?.value || "");
    teamHint.textContent = text;
    teamHint.classList.toggle("show", Boolean(text));
  };
  nicknameInput?.addEventListener("input", updateTeamHint);
  updateTeamHint();

  document.querySelector("#join-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    try {
      const d = await api({ action: "join", name });
      player = d.player;
      localStorage.setItem("pbrPracticePlayer", JSON.stringify(player));
      state = d.state;
      error = "";
      render();
    } catch (x) {
      error = x.message;
      render();
    }
  });

  document.querySelector("#host-login")?.addEventListener("submit", async e => {
    e.preventDefault();
    hostKey = String(new FormData(e.currentTarget).get("key") || "");
    sessionStorage.setItem("pbrPracticeHostKey", hostKey);
    await refresh();
  });

  const submitParticipantPassword = async () => {
    const input = document.querySelector("#password-input");
    const password = String(input?.value || "");
    if (!password) throw new Error("Skriv inn et passord.");
    if (state?.meta?.round === 10) {
      throw new Error("I runde 10 leverer du ved å koke egget og velge «Jeg stopper tiden her».");
    }
    const walterRound = state?.meta?.round === 7;
    const completedWalterSteps = walterRound ? walterSteps() : 0;
    if (walterRound && completedWalterSteps < 25) {
      throw new Error("Du må dytte Walter over målstreken før du kan levere i runde 7.");
    }

    const response = await api({
      action: "submit",
      playerId: player.id,
      token: player.token,
      password,
      ...(walterRound ? { walterSteps: completedWalterSteps } : {})
    });

    // Persist immediately after the server confirms the submission. This is the
    // canonical starter password for the next round unless the player copies another.
    lastOwnPassword = password;
    copiedPassword = "";
    localStorage.setItem("pbrPracticeLastPasswordV12", password);
    localStorage.removeItem("pbrPracticeCopiedPasswordV12");
    error = "";
    if (response?.state) state = response.state;
    await refresh();
  };

  let submitInFlight = false;
  const runParticipantSubmit = async () => {
    const button = document.querySelector("#submit-password");
    if (submitInFlight || button?.disabled) return;
    submitInFlight = true;
    if (button) {
      button.disabled = true;
      button.textContent = "Sender…";
    }
    try {
      await submitParticipantPassword();
    } catch (x) {
      error = x.message;
      render();
    } finally {
      submitInFlight = false;
      const currentButton = document.querySelector("#submit-password");
      if (currentButton && secondsLeft() !== 0 && !(state?.meta?.round === 7 && walterSteps() < 25)) {
        currentButton.disabled = false;
        currentButton.textContent = "Lever passord";
      }
    }
  };

  // Mobile-safe primary path: tapping the visible button sends the live input value
  // directly. We do not depend on browser FormData or native form validation.
  document.querySelector("#submit-password")?.addEventListener("click", runParticipantSubmit);

  // Keyboard/Enter remains supported and calls the exact same submission path.
  document.querySelector("#submit-form")?.addEventListener("submit", e => {
    e.preventDefault();
    runParticipantSubmit();
  });

  document.querySelectorAll(".vote-row").forEach(btn => btn.addEventListener("click", async () => {
    const targetId = String(btn.dataset.voteId || "");
    if (!targetId) return;
    try {
      const response = await api({ action: "vote", playerId: player.id, token: player.token, targetId });
      setSelectedVoteId(response.targetId || targetId);
      error = "";
      render();
    } catch (x) {
      error = x.message;
      render();
    }
  }));

  document.querySelector("#walter-button")?.addEventListener("click", () => {
    const current = walterSteps();
    if (current >= 25) return;
    const next = current + 1;
    updateWalterDom(next, true);

    // Vi sender ikke lenger 25 nettverkskall etter hverandre.
    // Når Walter når målstreken synkroniseres 25/25 én gang.
    // Selve Submit sender også 25/25 atomisk sammen med passordet.
    if (next >= 25) {
      // Når Walter er i mål skal deltakeren få en tydelig mulighet til å
      // redigere passordet igjen (for eksempel legge til emoji) før levering.
      setTimeout(() => {
        const passwordInput = document.querySelector("#password-input");
        if (passwordInput) {
          passwordInput.scrollIntoView({ behavior: "smooth", block: "center" });
          try {
            passwordInput.focus({ preventScroll: true });
            const end = passwordInput.value.length;
            passwordInput.setSelectionRange(end, end);
          } catch {}
        }
      }, 450);

      api({ action: "walter_step", playerId: player.id, token: player.token, steps: 25 })
        .then(data => {
          if (data?.walterSteps != null) updateWalterDom(Number(data.walterSteps), false);
        })
        .catch(() => {
          // Ikke blokker brukeren her: Submit sender Walter-status på nytt.
        });
    }
  });

  // Runde 9: mobilvennlig dra-og-slipp med Pointer Events.
  const eggDrag = document.querySelector("#egg-drag");
  if (eggDrag) {
    let dragging = false;
    let startX = 0, startY = 0;
    eggDrag.addEventListener("pointerdown", e => {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      eggDrag.setPointerCapture?.(e.pointerId);
      eggDrag.classList.add("dragging");
      e.preventDefault();
    });
    eggDrag.addEventListener("pointermove", e => {
      if (!dragging) return;
      eggDrag.style.transform = `translate(${e.clientX - startX}px, ${e.clientY - startY}px) scale(1.08)`;
      e.preventDefault();
    });
    eggDrag.addEventListener("pointerup", e => {
      if (!dragging) return;
      dragging = false;
      eggDrag.releasePointerCapture?.(e.pointerId);
      const pot = document.querySelector("#egg-pot");
      const box = pot?.getBoundingClientRect();
      const hit = box && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
      eggDrag.classList.remove("dragging");
      eggDrag.style.transform = "";
      if (hit) startEggTimer();
    });
    eggDrag.addEventListener("pointercancel", () => {
      dragging = false;
      eggDrag.classList.remove("dragging");
      eggDrag.style.transform = "";
    });
  }

  document.querySelector("#egg-stop")?.addEventListener("click", stopEggTimer);
  document.querySelector("#egg-retry")?.addEventListener("click", resetEggTimer);
  document.querySelector("#egg-confirm")?.addEventListener("click", async () => {
    try {
      let egg = getEggState();
      if (!egg) throw new Error("Dra egget ned i kjelen først.");
      let elapsed = eggElapsedMs();
      if (!Number.isFinite(elapsed)) throw new Error("Timeren er ikke startet.");
      if (!Number.isFinite(egg.stoppedElapsedMs)) {
        egg = { ...egg, stoppedElapsedMs: elapsed };
        saveEggState(egg);
      }
      const passwordInput = document.querySelector("#password-input");
      const password = String(passwordInput?.value || "");
      if (!password) throw new Error("Skriv inn et passord før du stopper egg-tiden.");
      const response = await api({
        action: "submit",
        playerId: player.id,
        token: player.token,
        password,
        eggSeconds: Math.round((elapsed / 1000) * 100) / 100
      });
      lastOwnPassword = password;
      copiedPassword = "";
      localStorage.setItem("pbrPracticeLastPasswordV12", password);
      localStorage.removeItem("pbrPracticeCopiedPasswordV12");
      error = "";
      if (response?.state) state = response.state;
      await refresh();
    } catch (x) {
      error = x.message;
      render();
    }
  });

  document.querySelector("#start-round")?.addEventListener("click", async () => {
    try {
      const roundSeconds = Number(document.querySelector("#round-seconds")?.value || 60);
      await api({ action: "start_round", roundSeconds });
      error = "";
      await refresh();
    } catch (x) {
      error = x.message;
      render();
    }
  });

  document.querySelector("#close-round")?.addEventListener("click", async () => {
    try {
      await api({ action: "close_round" });
      error = "";
      await refresh();
    } catch (x) {
      error = x.message;
      render();
    }
  });

  document.querySelector("#reset")?.addEventListener("click", async () => {
    if (!confirm("Nullstille hele prøverunden?")) return;
    try {
      await api({ action: "reset" });
      localStorage.removeItem("pbrPracticePlayer");
      localStorage.removeItem("pbrPracticeLastPassword");
      localStorage.removeItem("pbrPracticeCopiedPassword");
      localStorage.removeItem("pbrPracticeLastPasswordV12");
      localStorage.removeItem("pbrPracticeCopiedPasswordV12");
      if (walterStorageKey()) localStorage.removeItem(walterStorageKey());
      if (eggStorageKey()) localStorage.removeItem(eggStorageKey());
      if (voteStorageKey()) localStorage.removeItem(voteStorageKey());
      player = null;
      lastOwnPassword = "";
      copiedPassword = "";
      error = "";
      await refresh();
    } catch (x) {
      error = x.message;
      render();
    }
  });

  document.querySelectorAll(".copy-btn").forEach(btn => btn.addEventListener("click", () => {
    copiedPassword = decodeURIComponent(btn.dataset.copy || "");
    localStorage.setItem("pbrPracticeCopiedPasswordV12", copiedPassword);
    btn.textContent = "Valgt til neste runde ✓";
  }));
}

function tick() {
  updateReactionPad();
  const startOverlay = document.querySelector(".round-start-overlay");
  if (startOverlay && !roundIntroActive()) {
    startOverlay.remove();
    render();
    return;
  }
  const s = secondsLeft();
  const timer = document.querySelector("#timer");
  const headerTimer = document.querySelector("#header-countdown");
  if (timer) timer.textContent = `${s ?? 0}s`;
  if (headerTimer) headerTimer.textContent = `${s ?? 0}s igjen`;
  const eggTimer = document.querySelector("#egg-timer");
  if (eggTimer) eggTimer.textContent = formatEggTime(eggElapsedMs());
  const submitButton = document.querySelector("#submit-form button[type='submit'], #submit-form button:not([type])");
  if (submitButton) {
    if (s === 0) submitButton.setAttribute("disabled", "");
    else if (state?.meta?.round === 7) submitButton.disabled = walterSteps() < 25;
  }
}

setInterval(() => { if (!isReactionRound()) refresh(); }, 2000);
setInterval(() => { if (isReactionRound()) refresh(); }, 350);
setInterval(tick, 25);
refresh();
