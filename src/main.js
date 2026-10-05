import "./style.css";
import jervImage from "./jerv.webp";
import maurpinnsvinImage from "./maurpinnsvin.webp";
import leopardImage from "./leopard.webp";
import sommerfuglImage from "./sommerfugl.webp";
import nebbdyrImage from "./nebbdyr.webp";
import moteBilde1 from "./motebilde1.webp";
import moteBilde2 from "./motebilde2.webp";
import walterImage from "./walter.webp";
import timelineMoon from "./timeline_moon.webp";
import timeline2017 from "./timeline_2017.webp";
import timelineFirstMeeting from "./timeline_first_meeting.webp";
import timeline2023 from "./timeline_2023.webp";
import timelineWalterPuppy from "./timeline_walter_puppy.webp";
import timelineEngagement from "./timeline_engagement.webp";

const app = document.querySelector("#app");
const params = new URLSearchParams(location.search);
const hostMode = params.get("host") === "1";
const previewRound = hostMode ? Number(params.get("previewRound") || 0) : 0;
const storageKey = "pbr-player-v1";
const hostStorageKey = "pbr-host-key-v1";
const gameSessionStorageKey = "pbr-game-session-v1";

const pokemonHintNames = new Set([
  "tiva", "johan", "eskil", "vivi", "sissel", "erik", "arne", "hildekari", "stig"
]);

let state = null;
let player = readJson(localStorage.getItem(storageKey));
let hostKey = localStorage.getItem(hostStorageKey) || "";
let knownGameSessionId = localStorage.getItem(gameSessionStorageKey) || "";
let lastError = "";
let lastSubmit = null;
let polling = null;
let timelineMessage = "";
let resultOverlayKey = "";
let resultOverlayUntil = 0;
let resultOverlayTimer = null;
let roundIntroKey = "";
let roundIntroUntil = 0;
let participantRoundDeadline = 0;
let winnerOverlayKey = "";
let winnerOverlayStartsAt = 0;
let winnerOverlayUntil = 0;
let winnerOverlayTimer = null;
let winnerOverlayEndTimer = null;

function readJson(v) {
  try { return JSON.parse(v); } catch { return null; }
}

function clearStoredPlayerForNewGame() {
  // Only clear participant state. HOST_KEY is deliberately preserved.
  localStorage.removeItem(storageKey);
  player = null;
  lastSubmit = null;
}

function reconcileGameSession(nextState) {
  const serverSessionId = String(nextState?.meta?.sessionId || "");
  if (!serverSessionId) return;

  // One-time migration for browsers that already contain a player from the
  // pre-sessionId version. Keep that player only if it still exists server-side.
  if (!knownGameSessionId) {
    const localPlayerStillExists = Boolean(
      player?.id && nextState?.players?.some(p => p.id === player.id)
    );
    if (player && !localPlayerStillExists) clearStoredPlayerForNewGame();
    knownGameSessionId = serverSessionId;
    localStorage.setItem(gameSessionStorageKey, serverSessionId);
    return;
  }

  // A different id means the host performed a full reset. Remove the old
  // participant session/password so the new wedding game starts cleanly.
  if (knownGameSessionId !== serverSessionId) {
    clearStoredPlayerForNewGame();
    knownGameSessionId = serverSessionId;
    localStorage.setItem(gameSessionStorageKey, serverSessionId);
  }
}

function esc(v) {
  return String(v ?? "").replace(/[&<>'"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[c]));
}

function inferTeamSize(name) {
  const text = String(name || "").trim();
  const explicit = text.match(/\(([2-6])\)\s*$/);
  if (explicit) return Number(explicit[1]);
  const parts = text
    .split(/\s+(?:og|and)\s+|\s*[&/+;,]\s*/iu)
    .map(part => part.trim())
    .filter(Boolean);
  return Math.max(1, Math.min(6, parts.length >= 2 ? parts.length : 1));
}

function teamHintHtml(name) {
  const size = inferTeamSize(name);
  return size > 1 ? `👥 Lag på ${size} · +${size - 1} tegn` : "";
}

function normalizedNickname(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("nb-NO")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function hasPokemonHint() {
  const name = selfState()?.name || player?.name || "";
  return pokemonHintNames.has(normalizedNickname(name));
}

function currentNickname() {
  return selfState()?.name || player?.name || "";
}

function questionThemeClass() {
  if (hostMode) return "";
  const name = normalizedNickname(currentNickname());
  if (name === "siri") return "theme-siri";
  if (name === "marius") return "theme-marius";
  if (name === "marie") return "theme-marie";
  return "";
}

function specialThemeIntroHtml() {
  const theme = questionThemeClass();
  if (theme === "theme-siri") {
    return `<div class="theme-banner siri-banner">💍 Brudemodus aktivert · egne regler fortjener litt ekstra kjærlighet 💗</div>`;
  }
  if (theme === "theme-marius") {
    return `<div class="theme-banner marius-banner">🤡 Marius-modus aktivert · stygt tema til en stygg fyr</div>`;
  }
  if (theme === "theme-marie") {
    return `<div class="theme-banner marie-banner">🌸⚡ Marie-mode · neon, sakura og hovedkarakter-energi ✨</div>`;
  }
  return "";
}

function mariusBetweenRoundsHtml() {
  if (hostMode || normalizedNickname(currentNickname()) !== "marius") return "";
  if (!["results", "game_over"].includes(state?.meta?.status)) return "";

  const messages = [
    "Stygg font til en stygg fyr. Akkurat som bestilt.",
    "Marius, du overlevde. Estetikken gjorde ikke.",
    "Passordet ditt er heldigvis penere enn temaet ditt.",
    "Selv Comic Sans synes dette begynner å bli stygt.",
    "Sterk innsats, Marius. Svakt visuelt uttrykk.",
    "Du er fortsatt med, din stygge rakker.",
    "Pokémonene ba om å slippe å se dette temaet.",
    "Det blir ikke penere, Marius. Bare vanskeligere.",
    "Brad Pitt har ikke godkjent dette designet.",
    "Du er fortsatt med. Nå gjenstår bare siste hinder for både deg og dette grusomme temaet.",
    "Finale! Mot alle odds overlevde både du og dette grusomme temaet."
  ];
  const index = Math.max(0, Math.min(messages.length - 1, (state?.meta?.round || 1) - 1));
  return `<div class="card marius-roast"><strong>💩 Marius-melding:</strong> ${esc(messages[index])}</div>`;
}

function marieBetweenRoundsHtml() {
  if (hostMode || normalizedNickname(currentNickname()) !== "marie") return "";
  if (!["results", "game_over"].includes(state?.meta?.status)) return "";

  const messages = [
    "Siri og Amund er skikkelig heldige som har Marie som venn. 🌸",
    "Marie har ekte hovedkarakter-energi. ✨",
    "Vennskapsnivå: legendarisk. Siri og Amund godkjenner. 💖",
    "Marie-route unlocked: lojal, morsom og helt rå som venn. ⚡",
    "Sakura-bonus: Marie gjør bryllupsgjengen bedre bare ved å være der. 🌸",
    "Siri + Amund + Marie = elite friendship arc. 💫",
    "Marie, du er den typen venn brudeparet håper å beholde i alle sesonger. 💗",
    "Neonstatus: Marie skinner fortsatt sterkere enn bakgrunnen. ✨",
    "Siri og Amund setter enormt stor pris på deg, Marie. 🌸",
    "Marie er fortsatt med — akkurat som en ekte protagonist. ⚡",
    "Final arc nærmer seg. Marie har allerede vunnet vennskapskategorien. 💖",
    "Nesten mål: Siri og Amund sender vennskapsbuff til Marie. 🌸✨",
    "Finale! Uansett resultat er Marie S-tier venn av brudeparet. 💗"
  ];
  const index = Math.max(0, Math.min(messages.length - 1, (state?.meta?.round || 1) - 1));
  return `<div class="card marie-message"><strong>🌸 Marie-melding:</strong> ${esc(messages[index])}</div>`;
}

async function copyText(value) {
  const text = String(value ?? "");
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

function statusText(status) {
  return ({
    lobby: "Lobby",
    round_open: "Round open",
    results: "Round results",
    game_over: "Game over"
  })[status] || status;
}

async function api(body = null) {
  const options = body ? {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(hostKey ? { "X-Host-Key": hostKey } : {})
    },
    body: JSON.stringify(body)
  } : {
    method: "GET",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache"
    }
  };

  const url = body ? "/api/game" : `/api/game?_=${Date.now()}`;
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function refresh() {
  try {
    const previousRound = state?.meta?.round ?? null;
    const previousStatus = state?.meta?.status ?? null;

    const nextState = await api();
    reconcileGameSession(nextState);
    armResultOverlay(previousStatus, nextState);
    armWinnerOverlay(previousStatus, nextState);
    armRoundIntro(previousStatus, previousRound, nextState);
    const changed = JSON.stringify(nextState) !== JSON.stringify(state);

    if (
      previousRound !== null &&
      (nextState?.meta?.round !== previousRound ||
        (previousStatus === "round_open" && nextState?.meta?.status !== "round_open"))
    ) {
      lastSubmit = null;
    }

    state = nextState;
    lastError = "";
    if (changed) render();
  } catch (error) {
    const message = error.message;
    const changed = message !== lastError;
    lastError = message;
    if (changed || !state) render();
  }
}

function eggStorageKey() {
  return player?.id ? `pbrWeddingEgg:${player.id}:12` : "";
}

function getEggState() {
  const key = eggStorageKey();
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (!parsed || !Number.isFinite(Number(parsed.startedAt))) return null;
    return { startedAt: Number(parsed.startedAt), stoppedElapsedMs: parsed.stoppedElapsedMs == null ? null : Number(parsed.stoppedElapsedMs) };
  } catch { return null; }
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

function startEggTimer() { saveEggState({ startedAt: Date.now(), stoppedElapsedMs: null }); render(); }
function stopEggTimer() {
  const egg = getEggState();
  if (!egg || Number.isFinite(egg.stoppedElapsedMs)) return;
  saveEggState({ ...egg, stoppedElapsedMs: Date.now() - egg.startedAt });
  render();
}
function resetEggTimer() { saveEggState(null); render(); }

function eggHtml() {
  if (hostMode || state?.meta?.status !== "round_open" || state?.meta?.round !== 12 || !selfState()?.alive) return "";
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
      <button type="button" class="egg-confirm" id="egg-confirm">Jeg stopper tiden her – lever passord</button>
    </div>
    <p class="egg-note">Når du velger «Jeg stopper tiden her – lever passord», sendes passordet automatisk inn. Resultatet vises først når runden avsluttes.</p>
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

function fitPasswordInput(input) {
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

function updatePasswordPreview(input) {
  if (!(input instanceof HTMLInputElement)) return;
  fitPasswordInput(input);
  const preview = document.querySelector("#password-full-preview");
  if (!(preview instanceof HTMLElement)) return;
  const value = String(input.value || "");
  preview.textContent = value;
  const overflows = input.scrollWidth > input.clientWidth + 2;
  preview.classList.toggle("visible", Boolean(value) && overflows);
}

function setupPasswordInputAutoFit() {
  const input = document.querySelector("#password-input");
  if (!(input instanceof HTMLInputElement)) return;
  const resize = () => updatePasswordPreview(input);
  input.addEventListener("input", resize);
  window.addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(resize);
}

function selfState() {
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

const timelineCards = [
  { id: "moon", src: timelineMoon, caption: "Månelandingen" },
  { id: "2017", src: timeline2017, caption: "2017" },
  { id: "first_meeting", src: timelineFirstMeeting, caption: "Første gang Siri og Amund møttes" },
  { id: "2023", src: timeline2023, caption: "2023" },
  { id: "engagement", src: timelineEngagement, caption: "Forlovelsen" },
  { id: "walter_puppy", src: timelineWalterPuppy, caption: "Siri og Amund fikk Walter" }
];

function shuffledTimelineIds() {
  const ids = timelineCards.map(card => card.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const correct = ["moon", "2017", "first_meeting", "2023", "engagement", "walter_puppy"];
  if (ids.every((id, index) => id === correct[index])) [ids[0], ids[1]] = [ids[1], ids[0]];
  return ids;
}

function timelineOrder() {
  if (!player) return timelineCards.map(card => card.id);
  const validIds = new Set(timelineCards.map(card => card.id));
  let order = Array.isArray(player.timelineOrder) ? player.timelineOrder.filter(id => validIds.has(id)) : [];
  if (order.length !== timelineCards.length || new Set(order).size !== timelineCards.length) {
    order = shuffledTimelineIds();
    player = { ...player, timelineOrder: order };
    localStorage.setItem(storageKey, JSON.stringify(player));
  }
  return order;
}

function saveTimelineOrderFromDom() {
  if (!player) return;
  const order = [...document.querySelectorAll(".timeline-card")].map(card => card.dataset.timelineId).filter(Boolean);
  if (order.length !== timelineCards.length) return;
  player = { ...player, timelineOrder: order };
  localStorage.setItem(storageKey, JSON.stringify(player));
}

function timelineRuleHtml() {
  if (hostMode || state?.meta?.status !== "round_open" || state?.meta?.round !== 7) return "";
  const self = selfState();
  if (!self?.alive) return "";
  if (self.timelineSolved) {
    return `<div class="timeline-unlocked">
      <div class="timeline-lock open" aria-hidden="true">🔓</div>
      <div><small>HEMMELIG ORD LÅST OPP</small><strong>NOLDUS</strong><p>Passordet ditt må inneholde ordet «noldus».</p></div>
    </div>`;
  }

  const byId = new Map(timelineCards.map(card => [card.id, card]));
  return `<div class="timeline-game">
    <div class="timeline-game-head"><strong>Sett hendelsene i riktig rekkefølge</strong></div>
    <div class="timeline-list" id="timeline-list">
      ${timelineOrder().map((id, index) => {
        const card = byId.get(id);
        return `<article class="timeline-card" data-timeline-id="${esc(card.id)}" draggable="true">
          <div class="timeline-position">${index + 1}</div>
          <img src="${card.src}" alt="${esc(card.caption)}" draggable="false">
          <div class="timeline-caption"><strong>${esc(card.caption)}</strong></div>
          <div class="timeline-move-controls" aria-label="Flytt ${esc(card.caption)}">
            <button class="timeline-move timeline-move-up" type="button" aria-label="Flytt ${esc(card.caption)} opp" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="timeline-move timeline-move-down" type="button" aria-label="Flytt ${esc(card.caption)} ned" ${index === timelineCards.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </article>`;
      }).join("")}
    </div>
    <button type="button" id="check-timeline" class="timeline-check">Sjekk tidslinje</button>
    <div class="timeline-feedback ${timelineMessage ? "show" : ""}" id="timeline-feedback">${esc(timelineMessage)}</div>
  </div>`;
}

function starsHtml(stars) {
  const count = Math.max(0, Number(stars || 0));
  if (!count) return "";
  if (count <= 4) return `<span class="star-badge" title="${count} stjerne${count === 1 ? "" : "r"}">${"⭐".repeat(count)}</span>`;
  return `<span class="star-badge" title="${count} stjerner">⭐×${count}</span>`;
}

function lifeInfoHtml(self) {
  if (!self?.alive || state?.meta?.status !== "round_open") return "";

  const round = Number(state?.meta?.round || 0);
  if (round >= state.totalRules) {
    return `<div class="life-info sudden final-life compact-life-info">
      <div class="life-hearts">❤️</div>
      <div><strong>1 liv igjen</strong></div>
    </div>`;
  }

  const lives = Math.max(1, Number(self.lives ?? 2));
  const hearts = lives >= 2 ? "❤️❤️" : "❤️🖤";

  return `<div class="life-info ${lives >= 2 ? "training" : "sudden"} compact-life-info">
    <div class="life-hearts">${hearts}</div>
    <div><strong>${lives} liv igjen</strong></div>
  </div>`;
}

function resultOverlayHtml() {
  if (hostMode || state?.meta?.status !== "results") return "";
  if (!resultOverlayUntil || Date.now() >= resultOverlayUntil) return "";

  const result = currentRoundSelfResult();
  if (!result) return "";

  const lives = Math.max(0, Number(selfState()?.lives ?? (result.survived ? 1 : 0)));
  const hearts = lives >= 2 ? "❤️❤️" : (lives === 1 ? "❤️🖤" : "🖤🖤");
  const failureText = (result.failures || [])
    .map(f => `<div class="result-overlay-reason">❌ <strong>${esc(f.rule)}:</strong> ${esc(f.text)}</div>`)
    .join("");

  if (result.survived && result.lostLife) {
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
      <p class="round-result-sub">${result.starAwarded ? "⭐ Du fikk også en Short King-stjerne!" : "Passordet ditt bestod runden."}</p>
      <div class="round-result-hearts">${hearts}</div>
      <small>${lives} liv igjen</small>
    </div>`;
  }

  return `<div class="round-result-overlay eliminated">
    <div class="round-result-burst">✕</div>
    <div class="round-result-kicker">RUNDE ${state.meta.round}</div>
    <h2>DU ER ELIMINERT</h2>
    <p class="round-result-sub">Siste liv er brukt.</p>
    ${failureText || `<div class="result-overlay-reason">${esc(selfState()?.reason || "Passordet oppfylte ikke rundens krav.")}</div>`}
    <div class="round-result-hearts">🖤🖤</div>
  </div>`;
}

function armResultOverlay(previousStatus, nextState) {
  if (hostMode) return;
  const nextStatus = nextState?.meta?.status;
  if (previousStatus !== "round_open" || nextStatus !== "results") return;

  const key = `${nextState?.meta?.sessionId || "session"}:${nextState?.meta?.round || 0}`;
  if (key === resultOverlayKey) return;

  resultOverlayKey = key;
  resultOverlayUntil = Date.now() + 4000;

  if (resultOverlayTimer) clearTimeout(resultOverlayTimer);
  resultOverlayTimer = setTimeout(() => {
    resultOverlayUntil = 0;
    if (state?.meta?.status === "results") render();
  }, 4050);
}

function armWinnerOverlay(previousStatus, nextState) {
  if (hostMode || previousStatus === "game_over" || nextState?.meta?.status !== "game_over") return;
  const key = `${nextState?.meta?.sessionId || "session"}:game-over`;
  if (key === winnerOverlayKey) return;

  winnerOverlayKey = key;
  // Finalen skal feires umiddelbart når hosten avslutter spillet.
  // Vinner-overlayet har høyere prioritet enn ordinær rundefeedback.
  const delay = 0;
  winnerOverlayStartsAt = Date.now();
  winnerOverlayUntil = winnerOverlayStartsAt + 5000;

  if (winnerOverlayTimer) clearTimeout(winnerOverlayTimer);
  if (winnerOverlayEndTimer) clearTimeout(winnerOverlayEndTimer);

  winnerOverlayTimer = setTimeout(() => {
    if (state?.meta?.status === "game_over") render();
  }, delay + 25);

  winnerOverlayEndTimer = setTimeout(() => {
    winnerOverlayStartsAt = 0;
    winnerOverlayUntil = 0;
    if (state?.meta?.status === "game_over") render();
  }, delay + 5050);
}

function winnerCelebrationHtml() {
  const now = Date.now();
  if (hostMode || state?.meta?.status !== "game_over" || !winnerOverlayUntil || now < winnerOverlayStartsAt || now >= winnerOverlayUntil) return "";
  const winners = state.meta.winners || [];
  const kings = state.meta.shortKings || [];
  if (!winners.length && !kings.length) return "";
  const same = winners.length && kings.length && winners.length === kings.length && winners.every(name => kings.includes(name));
  const confetti = Array.from({length: 32}, (_, i) => `<i style="--x:${(i*37)%100}%;--d:${(i%7)*.13}s;--drift:${((i*53)%61)-30}px">${i%3===0 ? "♥" : i%3===1 ? "★" : "✦"}</i>`).join("");
  return `<div class="winner-celebration-overlay" role="status" aria-live="assertive">
    <div class="winner-confetti" aria-hidden="true">${confetti}</div>
    <div class="winner-celebration-content">
      ${same ? `<div class="winner-title">🏆 DOUBLE CROWN ⭐</div><div class="winner-name">${winners.map(esc).join(" & ")}</div><div class="winner-subtitle">VINNER AV PASSORDET TIL SIRIS HJERTE · THE SHORT KING</div>` : `
        ${winners.length ? `<div class="winner-title">🏆 VINNER</div><div class="winner-name">${winners.map(esc).join(" & ")}</div><div class="winner-subtitle">PASSORDET TIL SIRIS HJERTE</div>` : ""}
        ${kings.length ? `<div class="winner-divider"></div><div class="winner-title short">⭐ THE SHORT KING</div><div class="winner-name short">${kings.map(esc).join(" & ")}</div>` : ""}`}
    </div>
  </div>`;
}

function shortKingFinalHtml() {
  if (state?.meta?.status !== "game_over") return "";
  const kings = state.meta.shortKings || [];
  if (!kings.length) return "";
  const winners = state.meta.winners || [];
  const same = kings.length === winners.length && kings.every(name => winners.includes(name));
  return `<div class="short-king-final ${same ? "double-crown" : ""}">
    <span>${same ? "👑⭐" : "⭐"}</span>
    <div><small>${same ? "DOUBLE CROWN" : "THE SHORT KING"}</small><strong>${kings.map(esc).join(" & ")}</strong><p>${state.meta.shortKingStars || 0} stjerne${Number(state.meta.shortKingStars || 0) === 1 ? "" : "r"}</p></div>
  </div>`;
}

function finalAwardsCardHtml() {
  if (state?.meta?.status !== "game_over") return "";
  const winners = state.meta.winners || [];
  const kings = state.meta.shortKings || [];
  if (!winners.length && !kings.length) return "";
  const same = winners.length && kings.length && winners.length === kings.length && winners.every(name => kings.includes(name));

  if (same) {
    return `<section class="final-awards-card double-crown-card" aria-label="Sluttresultat">
      <div class="final-awards-kicker">SLUTTRESULTAT</div>
      <div class="final-awards-icon">🏆 ⭐</div>
      <div class="final-awards-label">DOUBLE CROWN</div>
      <div class="final-awards-name">${winners.map(esc).join(" & ")}</div>
      <div class="final-awards-caption">Vinner av Passordet til Siris hjerte · THE SHORT KING</div>
    </section>`;
  }

  return `<section class="final-awards-card" aria-label="Sluttresultat">
    <div class="final-awards-kicker">SLUTTRESULTAT</div>
    ${winners.length ? `<div class="final-awards-section"><div class="final-awards-icon">🏆</div><div class="final-awards-label">VINNER AV PASSORDET TIL SIRIS HJERTE</div><div class="final-awards-name">${winners.map(esc).join(" & ")}</div></div>` : ""}
    ${winners.length && kings.length ? `<div class="final-awards-rule"></div>` : ""}
    ${kings.length ? `<div class="final-awards-section"><div class="final-awards-icon">⭐</div><div class="final-awards-label">THE SHORT KING</div><div class="final-awards-name short">${kings.map(esc).join(" & ")}</div></div>` : ""}
  </section>`;
}

function animalRuleImagesHtml() {
  const animals = [
    { src: jervImage, label: "Dyr 1" },
    { src: maurpinnsvinImage, label: "Dyr 2" },
    { src: leopardImage, label: "Dyr 3" },
    { src: sommerfuglImage, label: "Dyr 4" },
    { src: nebbdyrImage, label: "Dyr 5" }
  ];

  return `<div class="animal-rule-gallery" aria-label="Fem dyrebilder til regel 6">
    ${animals.map((animal, index) => `
      <figure class="animal-rule-image">
        <img src="${animal.src}" alt="${animal.label} i regel 6" loading="eager">
        <figcaption>${index + 1}</figcaption>
      </figure>
    `).join("")}
  </div>`;
}

function meetingRuleImagesHtml() {
  const images = [
    { src: moteBilde1, label: "Person 1" },
    { src: moteBilde2, label: "Person 2" }
  ];
  return `<div class="meeting-rule-gallery" aria-label="To bilder til regel 8">
    ${images.map((image, index) => `
      <figure class="meeting-rule-image">
        <img src="${image.src}" alt="${image.label} i regel 8" loading="eager">
        <figcaption>${index + 1}</figcaption>
      </figure>
    `).join("")}
  </div>`;
}

function walterBonesHtml(count) {
  const safe = Math.max(0, Math.min(999, Number(count) || 0));
  if (!safe) return "";
  const shown = Math.min(safe, 18);
  return `${"🦴".repeat(shown)}${safe > shown ? ` <span class="walter-more">+${safe - shown}</span>` : ""}`;
}

function walterFeedState() {
  const self = selfState();
  const fedThisRound = Boolean(self && self.walterFeedRound === state?.meta?.round);
  const count = fedThisRound ? Number(self?.walterFeedCount || 0) : 0;
  return { self, count };
}

// Runde 9 bruker den kompakte Walter-presentasjonen.
// Fra og med runde 10 vises Walter kompakt under passordfeltet.
function walterRoundEightRuleHtml() {
  if (hostMode || state?.meta?.status !== "round_open" || state?.meta?.round !== 9) return "";
  const { self, count } = walterFeedState();
  if (!self?.alive) return "";
  const status = count > 0 ? `Walter er matet ${walterBonesHtml(count)}` : "";

  return `<div class="walter-interaction walter-inline walter-rule8-compact ${count > 0 ? "fed" : "hungry"}">
    <button id="feed-walter" class="walter-inline-button" type="button" aria-label="Mat Walter">
      <img src="${walterImage}" alt="Walter" draggable="false">
    </button>
    <div id="walter-feed-status" class="walter-inline-status" aria-live="polite" ${status ? "" : "hidden"}>${status}</div>
  </div>`;
}

function walterInlineHtml() {
  if (hostMode || state?.meta?.status !== "round_open" || (state?.meta?.round || 0) < 10) return "";
  const { self, count } = walterFeedState();
  if (!self?.alive) return "";
  const status = count > 0 ? `Walter er matet ${walterBonesHtml(count)}` : "";

  return `<div class="walter-interaction walter-inline ${count > 0 ? "fed" : "hungry"}">
    <button id="feed-walter" class="walter-inline-button" type="button" aria-label="Mat Walter">
      <img src="${walterImage}" alt="Walter" draggable="false">
    </button>
    <div id="walter-feed-status" class="walter-inline-status" aria-live="polite" ${status ? "" : "hidden"}>${status}</div>
  </div>`;
}

function rulesHtml() {
  const rules = state?.rules || [];
  if (!rules.length) {
    return `<p class="muted">Reglene kommer når hosten starter leken.</p>`;
  }

  const currentRound = Number(state?.meta?.round || rules.length);
  const latestNumber = rules.length;

  const renderRule = (r, number, isLatest) => {
    const hint = r.id === "pokemon" && !hostMode && hasPokemonHint()
      ? `<details class="rule-hint">
          <summary>Hint til oss over 50 år</summary>
          <div>Du kan bruke ett av disse alternativene: <strong>Mew</strong>, <strong>Muk</strong> eller <strong>Ekans</strong>.</div>
        </details>`
      : "";

    const media = r.id === "animals"
      ? animalRuleImagesHtml()
      : (r.id === "meeting_year" ? meetingRuleImagesHtml() : "");

    // The timeline mini-game is only interactive in round 7.
    const timeline = r.id === "timeline" && currentRound === 7
      ? timelineRuleHtml()
      : "";

    const timelineText = r.id === "timeline" && currentRound > 7
      ? "Passordet ditt må fortsatt inneholde det hemmelige ordet du låste opp i regel 7."
      : r.text;

    // Walter's large rule card is shown in his introduction round.
    // From later rounds the small Walter control sits by the password field.
    const walter = r.id === "walter" && currentRound === 9
      ? walterRoundEightRuleHtml()
      : "";

    const withMedia = r.id === "animals" ||
      r.id === "meeting_year" ||
      Boolean(timeline) ||
      Boolean(walter);

    return `<li class="${withMedia ? "rule-with-images " : ""}${isLatest ? "latest-rule" : ""}">
      <span>${number}</span>
      <div>${esc(timelineText)}${media}${timeline}${hint}${walter}</div>
    </li>`;
  };

  const oldRules = rules.slice(0, -1);
  const latestRule = rules[rules.length - 1];

  return `
    <div class="rules-summary">
      <strong>${rules.length} regel${rules.length === 1 ? "" : "er"} gjelder i denne runden</strong>
      <span>Alle tidligere regler gjelder fortsatt.</span>
    </div>

    ${oldRules.length ? `
      <div class="rules-section-label old-rules-label">Regler du fortsatt må følge</div>
      <ol class="rules active-rules-list old-rules-list">
        ${oldRules.map((r, i) => renderRule(r, i + 1, false)).join("")}
      </ol>
    ` : ""}

    <div class="rules-section-label new-rule-label">NY REGEL</div>
    <ol class="rules active-rules-list latest-only">
      ${renderRule(latestRule, latestNumber, true)}
    </ol>
  `;
}

function playerStatusText(p) {
  const status = state?.meta?.status;

  if (!p.alive) {
    return `Eliminated${p.eliminatedRound ? ` · round ${p.eliminatedRound}` : ""}`;
  }

  if (status === "results") return p.lostLifeRound === state?.meta?.round ? `Mistet liv · ${Math.max(1, Number(p.lives || 1))} igjen` : "Videre";
  if (status === "game_over") return "Finalist";
  if (status === "round_open") return p.hasSubmitted ? "Submitted" : "Waiting";
  return "Ready";
}

function playersHtml() {
  const players = state?.players || [];
  if (!players.length) return `<p class="muted">No players yet.</p>`;

  return `<div class="players">
    ${players.map(p => `
      <div class="player ${p.alive ? "alive" : "dead"}">
        <div class="player-main">
          <strong>${esc(p.name)} ${Number(p.teamSize || 1) > 1 ? `<span class="team-badge">👥 ${p.teamSize}</span>` : ""} ${["results", "game_over"].includes(state?.meta?.status) ? starsHtml(p.stars) : ""}</strong>
          <small>${esc(playerStatusText(p))}</small>
        </div>
        <div class="dot" title="${p.alive ? "Alive" : "Eliminated"}"></div>
      </div>
    `).join("")}
  </div>`;
}

function currentRoundSelfResult() {
  const self = selfState();
  if (!self || !state?.roundResults?.players) return null;
  return state.roundResults.players.find(p => p.id === self.id) || null;
}

function rankedResultPlayers(players = []) {
  const ranked = players.map(p => ({
    ...p,
    passwordLength: p.passwordLength ?? (p.password ? [...String(p.password)].length : null)
  })).sort((a, b) => {
    // Surviving players always rank above players eliminated in this round.
    if (a.survived !== b.survived) return Number(b.survived) - Number(a.survived);
    if (a.submitted !== b.submitted) return Number(b.submitted) - Number(a.submitted);
    if (!a.submitted) return a.name.localeCompare(b.name, "nb");
    return a.passwordLength - b.passwordLength || a.name.localeCompare(b.name, "nb");
  });

  let previousKey = null;
  let previousRank = 0;
  return ranked.map((p, index) => {
    if (!p.submitted) return { ...p, displayRank: null };
    const key = `${p.survived ? "alive" : "dead"}|${p.passwordLength}`;
    if (key !== previousKey) {
      previousRank = index + 1;
      previousKey = key;
    }
    return { ...p, displayRank: previousRank };
  });
}

function playerPanel() {
  const self = selfState();
  const status = state?.meta?.status;

  if (status === "lobby") {
    if (self && player) {
      return `<div class="card accent">
        <h2>You're in</h2>
        <p>Joined as <strong>${esc(self.name)}</strong>. Wait for the host to start.</p>
        <button id="forget-player" class="secondary">Use another browser/name</button>
      </div>`;
    }

    return `<div class="card accent">
      <h2>Join the game</h2>
      <form id="join-form">
        <label>Nickname
          <input id="nickname-input" name="name" maxlength="48" autocomplete="nickname" required placeholder="Ditt navn eller lagnavn">
        </label>
        <div id="team-hint" class="team-hint" aria-live="polite"></div>
        <button>Join</button>
      </form>
    </div>`;
  }

  if (!player || !self) {
    return `<div class="card">
      <h2>Ikke koblet til som deltaker</h2>
      <p class="muted">Denne nettleseren finner ikke deltakerregistreringen din. Last inn siden på nytt. Hvis navnet ditt fortsatt står i spillerlisten, be hosten gjøre en full reset før dere tester på nytt.</p>
    </div>`;
  }

  if (status === "round_open") {
    if (!self.alive) {
      return `<div class="card danger">
        <h2>Eliminated</h2>
        <p>Du er ute av spillet, men kan fortsatt følge de neste rundene.</p>
      </div>`;
    }

    const time = secondsLeft();
    const previousPassword = player?.lastPassword || "";

    return `<div class="card accent">
      ${lifeInfoHtml(self)}
      <div class="submit-head submit-head-compact">
        <div id="countdown" class="countdown">${time ?? "—"}s</div>
      </div>

      <form id="submit-form">
        ${state.meta.round === 12 ? eggHtml() : ""}
        <div class="password-entry-row ${state.meta.round >= 10 ? "with-walter" : ""}">
          <label>Password
            <input
              id="password-input"
              class="password-input"
              name="password"
              maxlength="200"
              autocomplete="off"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              required
              value="${esc(previousPassword)}">
          </label>
          <div id="password-full-preview" class="password-full-preview" aria-live="polite"></div>
          ${walterInlineHtml()}
        </div>
        ${state.meta.round === 12 ? "" : `<button ${time === 0 || roundIntroActive() || (state.meta.round === 7 && !self.timelineSolved) ? "disabled" : ""}>${state.meta.round === 17 ? "Lever finalepassord" : "Lever passord"}</button>`}
      </form>

      ${lastSubmit ? `<div class="feedback good">✓ Passordet er lagret. Resultatet vises når runden avsluttes.</div>` : ""}

    </div>`;
  }

  if (status === "results") {
    const result = currentRoundSelfResult();

    if (result?.survived) {
      if (result.lostLife) {
        const lives = Math.max(1, Number(self.lives ?? 1));
        return `<div class="card life-lost"><h2>💔 Du mistet ett liv – men er videre</h2><p>Passordet brøt en regel denne runden. Du har <strong>${lives} liv</strong> igjen.</p></div>`;
      }
      return `<div class="card winner">
        <h2>✓ Du gikk videre fra runde ${state.meta.round}${result.starAwarded ? " ⭐" : ""}</h2>
        <p>${result.starAwarded ? "Du hadde et av rundens korteste gyldige passord og fikk en stjerne. " : ""}Se rundens svar nedenfor. Når neste runde starter, ligger ditt forrige passord klart i feltet.</p>
      </div>`;
    }

    const failures = result?.failures || [];
    return `<div class="card danger">
      <h2>✕ Du ble eliminert i runde ${state.meta.round}</h2>
      ${failures.length
        ? `<p>${failures.map(f => `❌ <strong>${esc(f.rule)}:</strong> ${esc(f.text)}`).join("<br>")}</p>`
        : `<p>${esc(self.reason || "Better luck next game.")}</p>`}
    </div>`;
  }

  if (status === "game_over") {
    const winners = state.meta.winners || [];
    const won = winners.includes(self.name);
    const result = currentRoundSelfResult();

    if (won) {
      const winningLength = state.meta.winningPasswordLength;
      return `<div class="card winner">
        <h2>🏆 Du vant!</h2>
        <p>Du kom gjennom alle reglene${winningLength ? ` med et vinnende passord på <strong>${winningLength} tegn</strong>` : ""}${state.meta.winningStars != null ? ` · ${state.meta.winningStars} ⭐` : ""}.</p>
      </div>`;
    }

    if (self.alive && state.meta.round >= state.totalRules) {
      const winningLength = state.meta.winningPasswordLength;
      return `<div class="card">
        <h2>Du fullførte alle rundene!</h2>
        <p>${winningLength ? `Vinneren hadde det korteste gyldige passordet på <strong>${winningLength} tegn</strong>.` : "Spillet er ferdig."}</p>
      </div>`;
    }

    if (!self.alive && result && !result.survived) {
      return `<div class="card danger">
        <h2>Game over</h2>
        <p>Du ble eliminert i runde ${state.meta.round}.</p>
      </div>`;
    }

    return `<div class="card">
      <h2>Game over</h2>
      <p>Thanks for playing.</p>
    </div>`;
  }

  return "";
}

function roundResultsHtml() {
  const result = state?.roundResults;
  if (!result) return "";

  const rankedPlayers = rankedResultPlayers(result.players || []);
  const finalRound = result.round >= state.totalRules && state.meta.status === "game_over";
  const winners = new Set(state.meta.winners || []);

  return `<div class="card">
    <div class="card-title">
      <h2>Passordrangering · runde ${result.round}</h2>
      <span>${result.remaining} videre</span>
    </div>

    ${result.starRecipients?.length ? `<div class="star-award"><span>⭐</span><div><strong>Kortest denne runden</strong><small>${result.starRecipients.map(p => `${esc(p.name)} · ${p.passwordLength} tegn`).join(" & ")}</small></div></div>` : ""}
    ${result.rpsSummary ? `<div class="rps-summary">
      <strong>Stein · saks · papir</strong>
      <div class="rps-counts">
        ${result.rpsSummary.counts.map(item => `<span class="${result.rpsSummary.leaders.some(x => x.id === item.id) ? "leader" : ""}">${esc(item.label)}: ${item.count}</span>`).join("")}
      </div>
      <small>${result.rpsSummary.leaders.length ? `Videre: ${result.rpsSummary.leaders.map(x => esc(x.label)).join(" og ")}` : "Ingen gruppeutfall"}</small>
    </div>` : ""}

    <div class="players">
      ${rankedPlayers.map(p => {
        const isWinner = finalRound && winners.has(p.name);
        const gotStar = Boolean(p.starAwarded);
        const rankText = p.displayRank ? `#${p.displayRank}` : "—";
        const lengthText = p.passwordLength != null ? `${p.passwordLength} tegn${Number(p.teamPenalty || 0) > 0 ? ` (${p.rawPasswordLength} + ${p.teamPenalty} lag)` : ""}` : "Ingen innsending";
        const resultText = isWinner
          ? "🏆 Vinner"
          : p.lostLife
            ? "❤️ Mistet ett liv"
            : gotStar
              ? "⭐ Kortest"
              : (p.survived ? (finalRound ? "✓ Fullførte" : "✓ Videre") : "✕ Ute");
        const resultColor = isWinner || gotStar ? "#ffe797" : (p.lostLife ? "#ffcf89" : (p.survived ? "#aaf1bd" : "#ffc1d0"));

        return `<div class="player ${p.survived ? "alive" : "dead"} ${gotStar ? "shortest" : ""}" style="align-items:flex-start;">
          <div style="min-width:44px;font-weight:800;font-size:1.05rem;">${rankText}</div>
          <div class="player-main" style="gap:4px;min-width:0;">
            <strong>${esc(p.name)} ${starsHtml(p.stars)} <small style="font-weight:600;">· ${esc(lengthText)}</small></strong>
            <div class="password-result-line">
              <small class="mono password-result">${p.password ? esc(p.password) : "Ingen innsending"}</small>
              ${p.password ? `<button type="button" class="secondary copy-button" data-copy-player="${esc(p.id)}">Kopier</button>` : ""}
            </div>
            ${hostMode && !p.survived && p.failures?.length
              ? `<small style="white-space:normal;">
                  ${p.failures.map(f => `${esc(f.rule)}: ${esc(f.text)}`).join("<br>")}
                </small>`
              : ""}
          </div>
          <strong style="white-space:nowrap;color:${resultColor};">${resultText}</strong>
        </div>`;
      }).join("")}
    </div>

    ${finalRound && state.meta.winningPasswordLength != null
      ? `<p class="muted tiny"><strong>Vinnerkriterium:</strong> Korteste gyldige finalepassord vinner. Ved lik lengde rangeres flest stjerner høyere; fortsatt likt gir delt seier.</p>`
      : ""}
  </div>`;
}

function overallRankingHtml() {
  if (!["results", "game_over"].includes(state?.meta?.status)) return "";
  const rows = state?.leaderboard || [];
  if (!rows.length) return "";

  return `<div class="card overall-ranking">
    <div class="card-title">
      <h2>Samlet rangering</h2>
      <span>${rows.length} spillere</span>
    </div>
    <div class="players">
      ${rows.map(p => {
        const status = p.alive
          ? (state.meta.status === "game_over" ? "Fullførte" : "Videre")
          : `Ute i runde ${p.eliminatedRound ?? "—"}`;
        const length = p.passwordLength != null ? `${p.passwordLength} tegn${Number(p.teamPenalty || 0) > 0 ? ` (${p.rawPasswordLength} + ${p.teamPenalty} lag)` : ""}` : "Ingen innsending";
        return `<div class="player leaderboard-row ${p.alive ? "alive" : "dead"}">
          <div class="leaderboard-rank">#${p.rank}</div>
          <div class="player-main">
            <strong>${esc(p.name)} ${starsHtml(p.stars)}</strong>
            <small>${esc(status)} · ${esc(length)}</small>
          </div>
          <div class="dot"></div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function statRowsHtml(items) {
  return `<div class="players">
    ${items.map(([label, value]) => `
      <div class="player">
        <div class="player-main"><strong>${esc(label)}</strong></div>
        <strong>${esc(value)}</strong>
      </div>
    `).join("")}
  </div>`;
}

function hostStatsHtml() {
  if (!hostMode) return "";

  const status = state?.meta?.status;

  if (status === "round_open") {
    const active = state.players.filter(p => p.alive);
    const submitted = active.filter(p => p.hasSubmitted).length;
    const walterFed = state.meta.round >= 9
      ? active.filter(p => p.walterFeedRound === state.meta.round && Number(p.walterFeedCount || 0) > 0).length
      : null;

    const liveRows = [
      ["Spillere i runden", active.length],
      ["Har levert", submitted],
      ["Venter på innsending", active.length - submitted]
    ];
    if (walterFed != null) liveRows.push(["Har matet Walter", walterFed]);

    return `<div class="card">
      <div class="eyebrow">LIVE ROUND STATS</div>
      <h2 style="margin:.35rem 0 14px;">Round ${state.meta.round}</h2>
      ${statRowsHtml(liveRows)}
      <p class="muted tiny">Ingen får vite om passordet er godkjent før runden avsluttes.</p>
    </div>`;
  }

  const result = state?.roundResults;
  const history = state?.roundHistory || [];

  let html = "";

  if (result) {
    const eliminatedPlayers = result.players.filter(p => !p.survived);

    html += `<div class="card">
      <div class="eyebrow">ROUND STATISTICS</div>
      <h2 style="margin:.35rem 0 14px;">Round ${result.round}</h2>

      ${statRowsHtml([
        ["Spillere ved start", result.started],
        ["Leverte passord", result.submitted],
        ["Eliminert", result.eliminated],
        ["Videre", result.remaining],
        ["Korteste innsendte passord", result.shortestPasswordLength != null ? `${result.shortestPasswordLength} tegn` : "—"]
      ])}
      ${result.starRecipients?.length ? `<div class="star-award"><span>⭐</span><div><strong>Stjerne denne runden</strong><small>${result.starRecipients.map(p => `${esc(p.name)} · ${p.passwordLength} tegn`).join(" & ")}</small></div></div>` : ""}


      <div style="height:14px;"></div>
      <h2 style="margin-bottom:10px;">Regelbrudd</h2>

      ${result.failureCounts?.length
        ? `<div class="players">
            ${result.failureCounts.map(f => `
              <div class="player" style="align-items:flex-start;">
                <div class="player-main">
                  <strong>${esc(f.rule)}</strong>
                  <small style="white-space:normal;">${esc(f.text)}</small>
                </div>
                <strong>${f.count}</strong>
              </div>
            `).join("")}
          </div>
          <p class="muted tiny">Én deltaker kan ha brutt flere regler, så summen av regelbrudd kan være høyere enn antall eliminerte.</p>`
        : `<p class="muted">Ingen regelbrudd i denne runden.</p>`}

      <div style="height:8px;"></div>
      <h2 style="margin-bottom:10px;">Eliminert denne runden</h2>

      ${eliminatedPlayers.length
        ? `<div class="players">
            ${eliminatedPlayers.map(p => `
              <div class="player dead" style="align-items:flex-start;opacity:1;">
                <div class="player-main">
                  <strong>${esc(p.name)}</strong>
                  <small class="mono" style="white-space:normal;overflow-wrap:anywhere;">${p.password ? esc(p.password) : "Ingen innsending"}</small>
                  <small style="white-space:normal;">
                    ${(p.failures || []).map(f => `${esc(f.rule)}: ${esc(f.text)}`).join("<br>")}
                  </small>
                </div>
              </div>
            `).join("")}
          </div>`
        : `<p class="muted">Ingen ble eliminert.</p>`}
    </div>`;
  }

  if (history.length) {
    html += `<div class="card">
      <div class="eyebrow">ROUND HISTORY</div>
      <h2 style="margin:.35rem 0 14px;">Oversikt</h2>
      <div class="players">
        ${history.map(r => `
          <div class="player">
            <div class="player-main">
              <strong>Runde ${r.round}</strong>
              <small>${r.eliminated} eliminert · ${r.remaining} videre${r.shortestPasswordLength != null ? ` · kortest ${r.shortestPasswordLength} tegn` : ""}</small>
            </div>
            <strong>${r.submitted}/${r.started}</strong>
          </div>
        `).join("")}
      </div>
      <p class="muted tiny">Tallet til høyre viser antall innsendte passord / spillere ved rundestart.</p>
    </div>`;
  }

  return html;
}

function hostPanel() {
  if (!hostMode) return "";

  const meta = state?.meta || {};

  return `<div class="card host">
    <div class="eyebrow">HOST CONTROLS</div>
    ${meta.status === "round_open" ? `<div class="host-ready-indicator"><strong>${state.players.filter(p => p.alive && p.hasSubmitted).length}/${state.players.filter(p => p.alive).length}</strong><span>har levert</span></div>` : ""}

    <label>Host key
      <input id="host-key" type="password" value="${esc(hostKey)}" placeholder="Same as HOST_KEY in Vercel">
    </label>

    ${meta.status === "lobby"
      ? `<label>Rundetid for runde 1 (sekunder)
          <input id="timer-value" type="number" min="10" max="600" value="${meta.roundSeconds || 60}">
        </label>
        <div class="actions">
          <button data-host-action="start">Start game</button>
        </div>`
      : ""}

    ${meta.status === "round_open"
      ? `<div class="actions"><button data-host-action="close_round">Close round now</button></div>`
      : ""}

    ${meta.status === "results"
      ? `<label>Rundetid for runde ${Math.min((meta.round || 0) + 1, state.totalRules)} (sekunder)
          <input id="timer-value" type="number" min="10" max="600" value="${meta.roundSeconds || 60}">
        </label>
        <div class="actions"><button data-host-action="next_round">Start next round</button></div>`
      : ""}

    <div class="actions">
      <button class="danger-button" data-host-action="reset">Reset entire game</button>
    </div>

    <p class="muted tiny">Player link: <span class="mono">${esc(location.origin + location.pathname)}</span></p>
  </div>

  ${hostStatsHtml()}`;
}

function hostPreviewHtml() {
  if (!hostMode || ![15, 16, 17].includes(previewRound)) return "";

  if (previewRound === 15) {
    return `<main class="host-preview-shell">
      <div class="host-preview-banner">TESTVISNING · PÅVIRKER IKKE SPILLET</div>
      <header>
        <div><h1>Regel 15</h1></div>
        <div class="status-block"><span>Testvisning</span><strong>Round 15/17</strong><small>kun forhåndsvisning</small></div>
      </header>
      <section class="card rules-card">
        <div class="card-title"><h2>Regler</h2><span>15/17</span></div>
        <ol class="rules preview-rules">
          <li><span>15</span><div>Passordet ditt må inneholde nøyaktig ett av ordene «stein», «saks» eller «papir». Engelske varianter godkjennes også. Når runden avsluttes, går gruppen eller gruppene med flest valg videre; grupper med færre valg blir eliminert. Hvis alle tre er like store, går alle videre.</div></li>
        </ol>
      </section>
      <section class="card accent play-card">
        <div class="submit-head"><h2>Submit your password</h2><div class="countdown">60s</div></div>
        <label>Password<input class="password-input" value="" readonly></label>
        <button type="button" disabled>Submit / replace</button>
        <p class="muted tiny">Dette er bare en visuell test. Ingen data sendes eller lagres.</p>
      </section>
      <div class="preview-links"><a href="?host=1&previewRound=16">Se regel 16 →</a><a href="?host=1">← Til vanlig host-side</a></div>
    </main>`;
  }

  if (previewRound === 16) {
    return `<main class="host-preview-shell">
      <div class="host-preview-banner">TESTVISNING · PÅVIRKER IKKE SPILLET</div>
      <header>
        <div><h1>Regel 16</h1></div>
        <div class="status-block"><span>Testvisning</span><strong>Round 16/17</strong><small>kun forhåndsvisning</small></div>
      </header>
      <section class="card rules-card">
        <div class="card-title"><h2>Regler</h2><span>16/17</span></div>
        <ol class="rules preview-rules">
          <li><span>16</span><div>Siri og Amund lurer på hvor de skal dra på bryllupsreise. Passordet ditt må inneholde navnet på et land som har et flagg med kun to farger.</div></li>
        </ol>
      </section>
      <section class="card accent play-card">
        <div class="submit-head"><h2>Submit your password</h2><div class="countdown">60s</div></div>
        <label>Password<input class="password-input" value="" readonly></label>
        <button type="button" disabled>Submit / replace</button>
        <p class="muted tiny">Dette er bare en visuell test. Ingen data sendes eller lagres.</p>
      </section>
      <div class="preview-links"><a href="?host=1&previewRound=15">← Se regel 15</a><a href="?host=1&previewRound=17">Se finalen →</a></div>
    </main>`;
  }

  return `<main class="host-preview-shell">
    <div class="host-preview-banner">TESTVISNING · PÅVIRKER IKKE SPILLET</div>
    <header>
      <div><h1>Finale</h1></div>
      <div class="status-block"><span>Testvisning</span><strong>Round 17/17</strong><small>siste revisjon</small></div>
    </header>
    <section class="card rules-card">
      <div class="card-title"><h2>Finalerunden</h2><span>17/17</span></div>
      <div class="final-preview-copy">
        <strong>Siste sjanse til å optimalisere passordet ditt.</strong>
        <p>Passordet må fortsatt oppfylle alle tidligere regler. Når hosten avslutter runden, vinner den eller de som har kortest gyldige passord. Ved lik lengde avgjør flest stjerner. Er det fortsatt likt, deler de seieren.</p>
      </div>
    </section>
    <section class="card accent play-card">
      <div class="submit-head"><h2>Siste revisjon</h2><div class="countdown">60s</div></div>
      <label>Password<input class="password-input" value="" readonly></label>
      <button type="button" disabled>Lever finalepassord</button>
      <p class="muted tiny">Dette er bare en visuell test. Ingen data sendes eller lagres.</p>
    </section>
    <section class="card preview-awards">
      <div class="preview-award">🏆 <div><small>Vinneren av</small><strong>Passordet til Siris hjerte</strong></div></div>
      <div class="preview-award">⭐ <div><small>Egen sluttkåring</small><strong>THE SHORT KING</strong></div></div>
    </section>
    <div class="preview-links"><a href="?host=1&previewRound=16">← Se regel 16</a><a href="?host=1">Til vanlig host-side →</a></div>
  </main>`;
}

function render() {
  const inputState = captureInputState();

  if (hostMode && [15, 16, 17].includes(previewRound)) {
    app.innerHTML = hostPreviewHtml();
    return;
  }

  if (!state) {
    app.innerHTML = `<main>
      <header>
        <div>
          
          <h1>Passordet til<br>Siris hjerte</h1>
        </div>
      </header>
      <div class="card"><p>${lastError ? esc(lastError) : "Loading game…"}</p></div>
    </main>`;

    restoreInputState(inputState);
    return;
  }

  const meta = state.meta;
  const aliveCount = state.players.filter(p => p.alive).length;
  const total = state.players.length;
  const time = secondsLeft();

  document.body.classList.toggle("participant-mode", !hostMode);
  document.body.classList.toggle("host-mode", hostMode);
  document.body.classList.toggle("participant-mode", !hostMode);
  document.body.classList.toggle("player-theme-marie", !hostMode && normalizedNickname(currentNickname()) === "marie");

  const winnerText = meta.status === "game_over"
    ? ((meta.winners || []).length
      ? `Vinner${meta.winners.length > 1 ? "e" : ""}: ${meta.winners.map(esc).join(", ")}${meta.winningPasswordLength != null ? ` · ${meta.winningPasswordLength} tegn` : ""}`
      : "Ingen vinner")
    : null;

  app.innerHTML = `<main>
    <header>
      <div>
        
        <h1>Passordet til<br>Siris hjerte</h1>
      </div>

      <div class="status-block">
        <span>${statusText(meta.status)}</span>
        <strong>${meta.round ? `Runde ${meta.round} av ${state.totalRules}` : `${total} player${total === 1 ? "" : "s"}`}</strong>
        ${meta.status === "round_open"
          ? `<small id="header-countdown">${time}s left</small>`
          : `<small>${aliveCount} alive</small>`}
      </div>
    </header>

    ${lastError ? `<div class="notice bad">${esc(lastError)}</div>` : ""}
    ${meta.status === "game_over" ? finalAwardsCardHtml() : (winnerText ? `<div class="hero-winner">🏆 ${winnerText}</div>` : "")}
    ${resultOverlayHtml()}
    ${winnerCelebrationHtml()}
    ${roundStartOverlayHtml()}

    <section class="grid">
      <div>
        ${hostMode || meta.status !== "results" ? `<div class="card rules-card ${questionThemeClass()}">
          <div class="card-title">
            <h2>Regler</h2>
            <span>${meta.round}/${state.totalRules}</span>
          </div>
          ${specialThemeIntroHtml()}
          ${rulesHtml()}
        </div>` : ""}

        ${playerPanel()}
        ${mariusBetweenRoundsHtml()}
        ${marieBetweenRoundsHtml()}
        ${roundResultsHtml()}
        ${overallRankingHtml()}
      </div>

      <aside>
        <div class="card players-card">
          <div class="card-title">
            <h2 class="players-heading">Players</h2>
            <span>${aliveCount}/${total}</span>
          </div>
          ${playersHtml()}
        </div>

        ${hostPanel()}
      </aside>
    </section>

  </main>`;

  bindEvents();
  restoreInputState(inputState);
}

function bindEvents() {
  setupPasswordInputAutoFit();

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
    lastError = "";

    const name = new FormData(e.currentTarget).get("name");

    try {
      const data = await api({ action: "join", name });
      player = data.player;
      localStorage.setItem(storageKey, JSON.stringify(player));
      state = data.state;
      render();
    } catch (err) {
      lastError = err.message;
      render();
    }
  });

  document.querySelector("#feed-walter")?.addEventListener("click", async e => {
    const button = e.currentTarget;
    if (!player || button.disabled) return;
    lastError = "";
    button.disabled = true;

    try {
      const data = await api({
        action: "feed_walter",
        playerId: player.id,
        playerToken: player.token
      });

      const self = selfState();
      if (self) {
        self.walterFeedRound = data.walterFeedRound;
        self.walterFeedCount = data.walterFeedCount;
      }

      const card = button.closest(".walter-interaction, .walter-feed-card");
      const image = button.querySelector("img");
      const status = card?.querySelector("#walter-feed-status");
      card?.classList.remove("hungry");
      card?.classList.add("fed");

      if (status) {
        status.hidden = false;
        status.innerHTML = `Walter er matet ${walterBonesHtml(data.walterFeedCount)}`;
      }

      image?.classList.remove("walter-jump");
      void image?.offsetWidth;
      image?.classList.add("walter-jump");
      setTimeout(() => image?.classList.remove("walter-jump"), 900);
    } catch (err) {
      lastError = err.message;
      render();
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });

  const timelineList = document.querySelector("#timeline-list");
  if (timelineList) {
    let draggedId = null;
    let pointerId = null;

    const refreshTimelineNumbers = () => {
      [...timelineList.querySelectorAll(".timeline-card")].forEach((card, index) => {
        const pos = card.querySelector(".timeline-position");
        if (pos) pos.textContent = String(index + 1);
      });
      saveTimelineOrderFromDom();
    };

    timelineList.querySelectorAll(".timeline-card").forEach(card => {
      card.addEventListener("dragstart", e => {
        draggedId = card.dataset.timelineId;
        card.classList.add("dragging");
        e.dataTransfer?.setData("text/plain", draggedId || "");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        draggedId = null;
        refreshTimelineNumbers();
      });
      card.addEventListener("dragover", e => e.preventDefault());
      card.addEventListener("drop", e => {
        e.preventDefault();
        const source = timelineList.querySelector(`[data-timeline-id="${draggedId}"]`);
        if (!source || source === card) return;
        const rect = card.getBoundingClientRect();
        timelineList.insertBefore(source, e.clientY > rect.top + rect.height / 2 ? card.nextSibling : card);
        refreshTimelineNumbers();
      });
    });

    const refreshTimelineControls = () => {
      const cards = [...timelineList.querySelectorAll(".timeline-card")];
      cards.forEach((card, index) => {
        const up = card.querySelector(".timeline-move-up");
        const down = card.querySelector(".timeline-move-down");
        if (up) up.disabled = index === 0;
        if (down) down.disabled = index === cards.length - 1;
      });
    };

    timelineList.querySelectorAll(".timeline-move").forEach(button => {
      button.addEventListener("click", e => {
        const card = e.currentTarget.closest(".timeline-card");
        if (!card) return;
        const moveUp = e.currentTarget.classList.contains("timeline-move-up");
        const sibling = moveUp ? card.previousElementSibling : card.nextElementSibling;
        if (!sibling) return;

        card.classList.add("timeline-moving");
        if (moveUp) timelineList.insertBefore(card, sibling);
        else timelineList.insertBefore(sibling, card);

        refreshTimelineNumbers();
        refreshTimelineControls();
        e.currentTarget.focus({ preventScroll: true });
        setTimeout(() => card.classList.remove("timeline-moving"), 180);
      });
    });

    // Keep desktop drag-and-drop, but the arrow buttons are the primary mobile control.
    timelineList.addEventListener("dragend", refreshTimelineControls);
    refreshTimelineControls();

  }

  document.querySelector("#check-timeline")?.addEventListener("click", async e => {
    if (!player) return;
    const button = e.currentTarget;
    button.disabled = true;
    timelineMessage = "";
    try {
      const order = [...document.querySelectorAll(".timeline-card")].map(card => card.dataset.timelineId);
      const data = await api({ action: "solve_timeline", playerId: player.id, playerToken: player.token, order });
      if (!data.solved) {
        timelineMessage = "Ikke helt riktig ennå – prøv igjen.";
        const feedback = document.querySelector("#timeline-feedback");
        if (feedback) { feedback.textContent = timelineMessage; feedback.classList.add("show", "wrong"); }
        return;
      }
      const self = selfState();
      if (self) self.timelineSolved = true;
      timelineMessage = "";
      const list = document.querySelector("#timeline-list");
      list?.classList.add("solved");
      setTimeout(() => render(), 520);
    } catch (err) {
      lastError = err.message;
      render();
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });

  // Runde 12: samme mobilvennlige Pointer Events-flyt som i prøverunden.
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
      const rect = pot?.getBoundingClientRect();
      const hit = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
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
  const eggStopButton = document.querySelector("#egg-stop");
  if (eggStopButton) {
    // Mobil: stopp straks fingeren treffer knappen. Et vanlig `click` kan bli
    // forsinket eller gå tapt dersom polling/render bytter DOM-node midt i trykket.
    eggStopButton.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      stopEggTimer();
    });
    // PC, tastatur og fallback. stopEggTimer() er idempotent, så et eventuelt
    // etterfølgende click kan ikke endre den allerede lagrede stopptiden.
    eggStopButton.addEventListener("click", e => {
      e.preventDefault();
      stopEggTimer();
    });
  }
  document.querySelector("#egg-retry")?.addEventListener("click", resetEggTimer);
  document.querySelector("#egg-confirm")?.addEventListener("click", async e => {
    const button = e.currentTarget;
    if (!player || button.disabled) return;
    lastError = "";
    try {
      let egg = getEggState();
      if (!egg) throw new Error("Dra egget ned i kjelen først.");
      let elapsed = eggElapsedMs();
      if (!Number.isFinite(elapsed)) throw new Error("Timeren er ikke startet.");
      if (!Number.isFinite(egg.stoppedElapsedMs)) { egg = { ...egg, stoppedElapsedMs: elapsed }; saveEggState(egg); }
      const input = document.querySelector("#password-input");
      const password = String(input?.value || "");
      if (!password) throw new Error("Skriv inn et passord før du stopper egg-tiden.");
      button.disabled = true;
      lastSubmit = await api({ action: "submit", playerId: player.id, playerToken: player.token, password, eggSeconds: Math.round((elapsed/1000)*100)/100 });
      player = { ...player, lastPassword: password }; localStorage.setItem(storageKey, JSON.stringify(player));
      await refresh();
    } catch (err) { lastError = err.message; render(); } finally { if (button.isConnected) button.disabled = false; }
  });

  document.querySelector("#submit-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    lastError = "";

    const password = String(new FormData(e.currentTarget).get("password") || "");

    try {
      if (state?.meta?.round === 12) throw new Error("I runde 12 leverer du ved å koke egget og velge «Jeg stopper tiden her – lever passord».");
      lastSubmit = await api({
        action: "submit",
        playerId: player.id,
        playerToken: player.token,
        password
      });

      player = { ...player, lastPassword: password };
      localStorage.setItem(storageKey, JSON.stringify(player));

      await refresh();
    } catch (err) {
      lastError = err.message;
      render();
    }
  });

  document.querySelector("#forget-player")?.addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    player = null;
    lastSubmit = null;
    render();
  });

  document.querySelector("#host-key")?.addEventListener("input", e => {
    hostKey = e.target.value;
    localStorage.setItem(hostStorageKey, hostKey);
  });

  document.querySelectorAll("[data-host-action]").forEach(button => {
    button.addEventListener("click", async () => {
      lastError = "";
      const action = button.dataset.hostAction;

      if (action === "reset" && !confirm("Reset the whole game and remove every player?")) return;

      try {
        if (action === "set_timer" || action === "start" || action === "next_round") {
          const seconds = Number(document.querySelector("#timer-value")?.value || state?.meta?.roundSeconds || 60);
          const data = await api({ action, seconds });
          state = data.state;
        } else {
          const data = await api({ action });
          state = data.state;
        }

        lastSubmit = null;
        render();
      } catch (err) {
        lastError = err.message;
        render();
      }
    });
  });


  document.querySelectorAll("[data-copy-player]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.copyPlayer;
      const resultPlayer = state?.roundResults?.players?.find(p => p.id === id);
      if (!resultPlayer?.password) return;

      // Copy to the clipboard AND make this the player's starting password next round.
      // If the player does not click a copy button, their own previous password remains the default.
      await copyText(resultPlayer.password);

      if (!hostMode && player) {
        player = { ...player, lastPassword: resultPlayer.password };
        localStorage.setItem(storageKey, JSON.stringify(player));
      }

      const original = button.textContent;
      button.textContent = hostMode ? "Kopiert ✓" : "Valgt til neste runde ✓";
      setTimeout(() => {
        if (button.isConnected) button.textContent = original;
      }, 1800);
    });
  });
}

function tick() {
  const startOverlay = document.querySelector(".round-start-overlay");
  if (startOverlay && !roundIntroActive()) {
    startOverlay.remove();
    render();
    return;
  }
  if (!state?.meta?.deadline) return;

  const s = secondsLeft();
  const a = document.querySelector("#countdown");
  const b = document.querySelector("#header-countdown");
  const eggTimer = document.querySelector("#egg-timer");
  if (eggTimer) eggTimer.textContent = formatEggTime(eggElapsedMs());

  if (a) a.textContent = `${s}s`;
  if (b) b.textContent = `${s}s left`;
  if (s === 0) document.querySelector("#submit-form button")?.setAttribute("disabled", "");
}

refresh();
polling = setInterval(refresh, 2000);
setInterval(tick, 250);
window.addEventListener("resize", () => {
  const input = document.querySelector("#password-input");
  if (input) fitPasswordInput(input);
});
window.addEventListener("beforeunload", () => clearInterval(polling));
