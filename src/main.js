import "./style.css";
import walterImage from "./walter.png";

const app = document.querySelector("#app");
const hostMode = new URLSearchParams(location.search).get("host") === "1";

let state = null;
let error = "";
let player = JSON.parse(localStorage.getItem("pbrPracticePlayer") || "null");
let lastOwnPassword = localStorage.getItem("pbrPracticeLastPassword") || "";
let copiedPassword = localStorage.getItem("pbrPracticeCopiedPassword") || "";
let hostKey = sessionStorage.getItem("pbrPracticeHostKey") || "";
let refreshSequence = 0;
let appliedRefreshSequence = 0;
let walterSyncPromise = Promise.resolve();

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
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
    headers: {
      "Content-Type": "application/json",
      ...(hostKey ? { "X-Host-Key": hostKey } : {})
    },
    body: JSON.stringify(body)
  } : {});

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Feil (${res.status})`);
  return data;
}

function me() {
  return state?.players?.find(p => p.id === player?.id) || null;
}

function secondsLeft() {
  return state?.meta?.deadline
    ? Math.max(0, Math.ceil((state.meta.deadline - Date.now()) / 1000))
    : null;
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
  return `<div class="walter-challenge ${done ? "done" : ""}">
    <div class="walter-copy">
      <strong>${done ? "Walter er over målstreken! 🏁" : "Dytt Walter over målstreken"}</strong>
      <span id="walter-count">${steps} / 25 trykk</span>
    </div>
    <div class="walter-track" aria-label="Walter-bane med 25 intervaller">
      <div class="walter-finish" aria-hidden="true"></div>
      <button id="walter-button" class="walter-dog" type="button" style="left:${left}%" ${done ? "disabled" : ""} aria-label="Dytt Walter ett steg frem">
        <img id="walter-image" src="${walterImage}" alt="Walter" draggable="false">
      </button>
    </div>
    <div id="walter-message" class="walter-message">${done ? "✓ Nå kan du levere passordet ditt." : "Trykk på Walter. Hvert trykk flytter ham ett av 25 steg."}</div>
  </div>`;
}

function updateWalterDom(steps, animate = true) {
  const safe = Math.max(0, Math.min(25, Number(steps) || 0));
  setWalterLocalSteps(safe);
  const left = 5 + (safe / 25) * 89;
  const button = document.querySelector("#walter-button");
  const image = document.querySelector("#walter-image");
  const count = document.querySelector("#walter-count");
  const message = document.querySelector("#walter-message");
  const challenge = document.querySelector(".walter-challenge");
  if (button) {
    button.style.left = `${left}%`;
    button.disabled = safe >= 25;
  }
  if (count) count.textContent = `${safe} / 25 trykk`;
  if (message) message.textContent = safe >= 25 ? "✓ Nå kan du levere passordet ditt." : "Trykk på Walter. Hvert trykk flytter ham ett av 25 steg.";
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

async function refresh() {
  const seq = ++refreshSequence;
  try {
    const nextState = await api();
    if (seq < appliedRefreshSequence) return;
    appliedRefreshSequence = seq;

    const changed = JSON.stringify(nextState) !== JSON.stringify(state);
    const hadError = Boolean(error);
    state = nextState;
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

function rulesHtml() {
  if (!state?.rules?.length) {
    return `<p class="muted">Reglene kommer når hosten starter prøverunden.</p>`;
  }
  return `<ol class="rules">
    ${state.rules.map((r, i) => `<li><span>${i + 1}</span><div>${esc(r.text)}</div></li>`).join("")}
  </ol>`;
}

function playerStatusText(p) {
  if (!p.alive) return `Ute${p.eliminatedRound ? ` · runde ${p.eliminatedRound}` : ""}`;
  if (state?.meta?.status === "round_open") return p.hasSubmitted ? "Levert" : "Venter";
  if (state?.meta?.status === "results") return "Videre";
  if (state?.meta?.status === "game_over") return "Finalist";
  return "Klar";
}

function playersHtml() {
  const players = state?.players || [];
  if (!players.length) return `<p class="muted">Ingen deltakere ennå.</p>`;

  return `<div class="players">
    ${players.map(p => `<div class="player ${p.alive ? "alive" : "dead"}">
      <div class="player-main">
        <strong>${esc(p.name)}</strong>
        <small>${esc(playerStatusText(p))}</small>
      </div>
      <div class="dot" title="${p.alive ? "Med" : "Eliminert"}"></div>
    </div>`).join("")}
  </div>`;
}

function resultsHtml() {
  const r = state?.roundResults;
  if (!r) return "";

  return `<section class="card results-card">
    <div class="card-title">
      <h2>Passordrangering · runde ${r.round}</h2>
      <span>${r.remaining} videre</span>
    </div>
    <p class="muted tiny">Passordene vises først når runden er avsluttet. Trykk <b>Kopier</b> hvis du vil bruke et annet passord som utgangspunkt i neste runde.</p>
    <div class="result-list">
      ${r.players.map(p => `<div class="result-row ${p.survived ? "survived" : "eliminated"}">
        <div class="rank">#${p.rank}</div>
        <div class="who"><strong>${esc(p.name)}</strong><small>${p.survived ? "Videre" : "Eliminert"}</small></div>
        <code>${p.password ? esc(p.password) : "—"}</code>
        <span class="length">${p.passwordLength ?? "—"} tegn</span>
        ${p.password ? `<button type="button" class="secondary copy-btn" data-copy="${encodeURIComponent(p.password)}">Kopier</button>` : ""}
        ${!p.survived && p.reason ? `<div class="reason">${esc(p.reason)}</div>` : ""}
      </div>`).join("")}
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
          <input name="name" maxlength="24" placeholder="Ditt navn" autocomplete="off" required>
        </label>
        <button>Join</button>
      </form>
    </section>`;
  }

  if (state.meta.status === "round_open" && self.alive) {
    const starter = copiedPassword || lastOwnPassword || "";
    const walterDone = state.meta.round !== 7 || walterSteps() >= 25;
    return `<section class="card accent play-card">
      <div class="submit-head">
        <h2>Submit your password</h2>
        <div class="countdown" id="timer">${secondsLeft() ?? "—"}s</div>
      </div>
      <form id="submit-form">
        <label>Password
          <input
            class="password-input"
            name="password"
            maxlength="200"
            value="${esc(starter)}"
            autocomplete="off"
            spellcheck="false"
            required
            placeholder="Bygg et passord som følger alle reglene">
        </label>
        ${walterHtml()}
        <button type="submit" ${secondsLeft() === 0 || !walterDone ? "disabled" : ""}>Submit / replace</button>
      </form>
      ${self.hasSubmitted ? `<div class="feedback good">✓ Passordet er lagret. Resultatet vises når runden avsluttes.</div>` : ""}
      <p class="muted tiny">Passordet fra forrige runde er forhåndsutfylt. Du kan endre og sende inn på nytt helt til tiden går ut.</p>
    </section>`;
  }

  if (state.meta.status === "round_open" && !self.alive) {
    return `<section class="card danger"><h2>Eliminert</h2><p>Du er ute av prøverunden, men kan fortsatt følge med.</p></section>`;
  }

  if (state.meta.status === "results") {
    return `<section class="card ${self.alive ? "winner" : "danger"}">
      <h2>${self.alive ? `✓ Du gikk videre fra runde ${state.meta.round}` : `✕ Du ble eliminert i runde ${state.meta.round}`}</h2>
      <p>${self.alive ? "Se rundens passord nedenfor. Neste runde starter med ditt eget eller et kopiert passord." : "Dette er bare trening – hovedleken starter helt på nytt."}</p>
      ${copiedPassword ? `<div class="feedback good">Neste runde starter med det kopierte passordet: <code>${esc(copiedPassword)}</code></div>` : ""}
    </section>`;
  }

  if (state.meta.status === "game_over") {
    return `<section class="card winner finish">
      <h2>Prøverunden er over 🎉</h2>
      <p>Nå kjenner du flyten: skriv → send → vent → se resultat → eventuelt kopier.</p>
      ${state.meta.winners?.length ? `<div class="winner-box">Vinner av prøverunden: <b>${esc(state.meta.winners.join(" & "))}</b> 🎉</div>` : ""}
    </section>`;
  }

  return `<section class="card accent"><h2>You're in</h2><p>Du er med som <strong>${esc(self.name)}</strong>. Vent på at hosten starter.</p></section>`;
}

function hostView() {
  if (!hostKey) {
    return `<section class="card host-login">
      <div class="card-title"><h2>Host controls</h2><span>låst</span></div>
      <form id="host-login">
        <label>HOST_KEY
          <input name="key" type="password" autocomplete="off" required>
        </label>
        <button>Åpne hostkontrollene</button>
      </form>
    </section>`;
  }

  const alive = state?.players?.filter(p => p.alive).length || 0;
  const round = state?.meta?.round || 0;

  return `<section class="card host-card">
    <div class="card-title"><h2>Host controls</h2><span>${alive} aktive</span></div>
    ${["lobby", "results"].includes(state.meta.status) && round < state.totalRules ? `<div class="host-start">
      <label>Rundetid (sek)
        <input id="round-seconds" type="number" min="10" max="300" value="${state.meta.roundSeconds || 60}">
      </label>
      <button id="start-round">${round === 0 ? "Start prøverunden" : "Start neste runde"}</button>
    </div>` : ""}
    ${state.meta.status === "round_open" ? `<button id="close-round">Avslutt runden nå</button>` : ""}
    <button id="reset" class="danger-button">Nullstill prøverunden</button>
  </section>`;
}

function render() {
  // Capture HERE, after any API wait has already finished.
  const inputState = captureInputState();

  if (!state) {
    app.innerHTML = `<main>
      <header>
        <div><div class="eyebrow">TRYGG PRØVERUNDE</div><h1>Password<br>Battle Royale</h1></div>
      </header>
      <div class="card"><p>${esc(error || "Laster…")}</p></div>
    </main>`;
    restoreInputState(inputState);
    return;
  }

  const aliveCount = state.players.filter(p => p.alive).length;
  const total = state.players.length;
  const meta = state.meta;

  app.innerHTML = `<main>
    <header>
      <div>
        <div class="eyebrow">TRYGG PRØVERUNDE</div>
        <h1>Password<br>Battle Royale</h1>
        <p class="lede">Kort trening før bryllupsleken.</p>
      </div>
      <div class="status-block">
        <span>${statusText(meta.status)}</span>
        <strong>${meta.round ? `Round ${meta.round}/${state.totalRules}` : `${total} spiller${total === 1 ? "" : "e"}`}</strong>
        ${meta.status === "round_open"
          ? `<small id="header-countdown">${secondsLeft()}s igjen</small>`
          : `<small>${aliveCount} med</small>`}
      </div>
    </header>

    ${error ? `<div class="notice bad">${esc(error)}</div>` : ""}

    <section class="grid">
      <div>
        <section class="card rules-card">
          <div class="card-title"><h2>Active rules</h2><span>${meta.round}/${state.totalRules}</span></div>
          ${rulesHtml()}
        </section>

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

    <footer>Prøverunden bruker egne Redis-nøkler og påvirker ikke bryllupsleken.</footer>
  </main>`;

  bind();
  restoreInputState(inputState);
}

function bind() {
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

  document.querySelector("#submit-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") || "");
    try {
      if (state?.meta?.round === 7) {
        if (walterSteps() < 25) throw new Error("Du må dytte Walter over målstreken før du kan levere i runde 7.");
        await walterSyncPromise;
        await api({ action: "walter_step", playerId: player.id, token: player.token, steps: 25 });
      }
      const response = await api({ action: "submit", playerId: player.id, token: player.token, password });
      lastOwnPassword = password;
      copiedPassword = "";
      localStorage.setItem("pbrPracticeLastPassword", password);
      localStorage.removeItem("pbrPracticeCopiedPassword");
      error = "";
      if (response?.state) state = response.state;
      await refresh();
    } catch (x) {
      error = x.message;
      render();
    }
  });

  document.querySelector("#walter-button")?.addEventListener("click", () => {
    const current = walterSteps();
    if (current >= 25) return;
    const next = current + 1;
    updateWalterDom(next, true);
    walterSyncPromise = walterSyncPromise
      .catch(() => {})
      .then(() => api({ action: "walter_step", playerId: player.id, token: player.token, steps: next }))
      .then(data => {
        if (data?.walterSteps != null && Number(data.walterSteps) > walterSteps()) updateWalterDom(Number(data.walterSteps), false);
      })
      .catch(err => {
        error = `Walter kunne ikke synkroniseres akkurat nå: ${err.message}`;
      });
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
      if (walterStorageKey()) localStorage.removeItem(walterStorageKey());
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
    localStorage.setItem("pbrPracticeCopiedPassword", copiedPassword);
    btn.textContent = "Valgt til neste runde ✓";
  }));
}

function tick() {
  const s = secondsLeft();
  const timer = document.querySelector("#timer");
  const headerTimer = document.querySelector("#header-countdown");
  if (timer) timer.textContent = `${s ?? 0}s`;
  if (headerTimer) headerTimer.textContent = `${s ?? 0}s igjen`;
  const submitButton = document.querySelector("#submit-form button[type='submit'], #submit-form button:not([type])");
  if (submitButton) {
    if (s === 0) submitButton.setAttribute("disabled", "");
    else if (state?.meta?.round === 7) submitButton.disabled = walterSteps() < 25;
  }
}

setInterval(refresh, 2000);
setInterval(tick, 250);
refresh();
