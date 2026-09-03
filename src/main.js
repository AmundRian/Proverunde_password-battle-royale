import "./style.css";

const app = document.querySelector("#app");
const hostMode = new URLSearchParams(location.search).get("host") === "1";
let state = null;
let error = "";
let player = JSON.parse(localStorage.getItem("pbrPracticePlayer") || "null");
let lastOwnPassword = localStorage.getItem("pbrPracticeLastPassword") || "";
let copiedPassword = localStorage.getItem("pbrPracticeCopiedPassword") || "";
let hostKey = sessionStorage.getItem("pbrPracticeHostKey") || "";

function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function statusText(s) { return ({lobby:"Lobby",round_open:"Runde pågår",results:"Mellom runder",game_over:"Prøverunden er ferdig"})[s] || s; }

async function api(body=null) {
  const res = await fetch("/api/game", body ? { method:"POST", headers:{"Content-Type":"application/json", ...(hostKey?{"X-Host-Key":hostKey}:{})}, body:JSON.stringify(body)} : {});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `Feil (${res.status})`);
  return data;
}

function me() { return state?.players?.find(p => p.id === player?.id) || null; }
function secondsLeft() { return state?.meta?.deadline ? Math.max(0, Math.ceil((state.meta.deadline-Date.now())/1000)) : null; }

async function refresh() {
  try { state = await api(); error=""; render(); } catch(e) { error=e.message; render(); }
}

function rulesHtml() {
  if (!state?.rules?.length) return `<p class="muted">Reglene kommer når hosten starter prøverunden.</p>`;
  return `<ol class="rules">${state.rules.map((r,i)=>`<li><span>${i+1}</span><div>${esc(r.text)}</div></li>`).join("")}</ol>`;
}

function resultsHtml() {
  const r = state?.roundResults;
  if (!r) return "";
  return `<section class="card results-card">
    <div class="section-head"><div><div class="eyebrow">Resultat runde ${r.round}</div><h2>Se svarene – og lær kopiering</h2></div><span class="pill">${r.remaining} videre</span></div>
    <p class="muted">Passordene vises først når runden er avsluttet. Trykk <b>Kopier</b> hvis du vil bruke et annet passord som utgangspunkt i neste runde.</p>
    <div class="result-list">
      ${r.players.map(p=>`<div class="result-row ${p.survived?'survived':'eliminated'}">
        <div class="rank">#${p.rank}</div>
        <div class="who"><strong>${esc(p.name)}</strong><small>${p.survived?'Videre':'Eliminert'}</small></div>
        <code>${p.password ? esc(p.password) : '—'}</code>
        <span class="length">${p.passwordLength ?? '—'} tegn</span>
        ${p.password ? `<button class="secondary copy-btn" data-copy="${encodeURIComponent(p.password)}">Kopier</button>` : ''}
        ${!p.survived && p.reason ? `<div class="reason">${esc(p.reason)}</div>` : ''}
      </div>`).join("")}
    </div>
  </section>`;
}

function playerView() {
  const self = me();
  if (!player || !self) {
    if (state?.meta?.status !== "lobby") return `<section class="card"><h2>Prøverunden har startet</h2><p>Oppdater siden eller be hosten nullstille prøverunden.</p></section>`;
    return `<section class="card join-card"><div class="eyebrow">Steg 1</div><h2>Skriv inn kallenavn</h2><form id="join-form"><label>Kallenavn<input name="name" maxlength="24" placeholder="Ditt navn" autocomplete="off" required></label><button>Join prøverunden</button></form></section>`;
  }

  if (state.meta.status === "round_open" && self.alive) {
    const starter = copiedPassword || lastOwnPassword || "";
    return `<section class="card play-card"><div class="section-head"><div><div class="eyebrow">Runde ${state.meta.round}</div><h2>Bygg videre på passordet</h2></div><div class="timer" id="timer">${secondsLeft() ?? ''} s</div></div>
      <form id="submit-form"><label>Passord<input name="password" value="${esc(starter)}" autocomplete="off" spellcheck="false" required></label><button>Send inn</button></form>
      ${self.hasSubmitted ? `<div class="notice">Passordet er sendt inn. Du får først vite resultatet når runden er avsluttet.</div>` : ''}
    </section>`;
  }

  if (state.meta.status === "round_open" && !self.alive) return `<section class="card"><h2>Du er ute av prøverunden</h2><p class="muted">Du kan fortsatt følge med på resultatene.</p></section>`;
  if (state.meta.status === "results") return `<section class="card"><h2>${self.alive?'Du er videre ✅':'Du er eliminert ❌'}</h2><p>${self.alive?'Vent på neste runde.':'Dette er bare trening – hovedleken starter helt på nytt.'}</p>${copiedPassword?`<div class="notice">Neste runde starter med det kopierte passordet: <code>${esc(copiedPassword)}</code></div>`:''}</section>${resultsHtml()}`;
  if (state.meta.status === "game_over") return `<section class="card finish"><div class="eyebrow">Ferdig</div><h2>Prøverunden er over 🎉</h2><p>Nå kjenner du flyten: skriv → send → vent → se resultat → eventuelt kopier.</p>${state.meta.winners?.length?`<div class="winner">Korteste sluttpassord: <b>${esc(state.meta.winners.join(' & '))}</b> (${state.meta.winnerLength} tegn)</div>`:''}</section>${resultsHtml()}`;
  return `<section class="card"><h2>Du er med</h2><p>Vent på at hosten starter første runde.</p></section>`;
}

function hostView() {
  if (!hostKey) return `<section class="card host-login"><div class="eyebrow">Host</div><h2>Åpne hostkontrollene</h2><form id="host-login"><label>HOST_KEY<input name="key" type="password" required></label><button>Åpne</button></form></section>`;
  const alive = state?.players?.filter(p=>p.alive).length || 0;
  const round = state?.meta?.round || 0;
  return `<section class="card host-card"><div class="section-head"><div><div class="eyebrow">Hostkontroll</div><h2>${statusText(state.meta.status)}</h2></div><span class="pill">${alive} aktive</span></div>
    ${['lobby','results'].includes(state.meta.status) && round < state.totalRules ? `<div class="host-start"><label>Rundetid (sek)<input id="round-seconds" type="number" min="10" max="300" value="${state.meta.roundSeconds || 60}"></label><button id="start-round">${round===0?'Start prøverunden':'Start neste runde'}</button></div>`:''}
    ${state.meta.status === 'round_open' ? `<button id="close-round">Avslutt runden nå</button>`:''}
    <button id="reset" class="danger">Nullstill prøverunden</button>
  </section>${resultsHtml()}`;
}

function render() {
  if (!state) { app.innerHTML = `<main class="shell"><h1>Prøverunde</h1><p>${esc(error || 'Laster…')}</p></main>`; return; }
  app.innerHTML = `<main class="shell">
    <header><div><div class="eyebrow practice">TRYGG PRØVERUNDE</div><h1>Passordleken – trening</h1><p class="lede">En kort test med enkle regler. Denne nettsiden er helt separat fra bryllupsleken.</p></div><div class="status"><span>${statusText(state.meta.status)}</span><strong>${state.meta.round}/${state.totalRules}</strong></div></header>
    ${error?`<div class="error">${esc(error)}</div>`:''}
    <div class="grid"><section class="card rules-card"><div class="section-head"><h2>Aktive regler</h2><span class="pill">kumulative</span></div>${rulesHtml()}</section><div>${hostMode?hostView():playerView()}</div></div>
    <footer>Prøverunden bruker egne data og påvirker ikke bryllupsleken.</footer>
  </main>`;
  bind();
}

function bind() {
  document.querySelector('#join-form')?.addEventListener('submit', async e=>{ e.preventDefault(); const name=new FormData(e.currentTarget).get('name'); try{ const d=await api({action:'join',name}); player=d.player; localStorage.setItem('pbrPracticePlayer',JSON.stringify(player)); state=d.state; render(); }catch(x){error=x.message;render();} });
  document.querySelector('#host-login')?.addEventListener('submit', e=>{ e.preventDefault(); hostKey=String(new FormData(e.currentTarget).get('key')||''); sessionStorage.setItem('pbrPracticeHostKey',hostKey); refresh(); });
  document.querySelector('#submit-form')?.addEventListener('submit', async e=>{ e.preventDefault(); const password=String(new FormData(e.currentTarget).get('password')||''); try{ await api({action:'submit',playerId:player.id,token:player.token,password}); lastOwnPassword=password; copiedPassword=''; localStorage.setItem('pbrPracticeLastPassword',password); localStorage.removeItem('pbrPracticeCopiedPassword'); await refresh(); }catch(x){error=x.message;render();} });
  document.querySelector('#start-round')?.addEventListener('click', async()=>{ try{ const roundSeconds=Number(document.querySelector('#round-seconds')?.value||60); await api({action:'start_round',roundSeconds}); await refresh(); }catch(x){error=x.message;render();} });
  document.querySelector('#close-round')?.addEventListener('click', async()=>{ try{ await api({action:'close_round'}); await refresh(); }catch(x){error=x.message;render();} });
  document.querySelector('#reset')?.addEventListener('click', async()=>{ if(!confirm('Nullstille hele prøverunden?')) return; try{await api({action:'reset'}); localStorage.removeItem('pbrPracticePlayer'); localStorage.removeItem('pbrPracticeLastPassword'); localStorage.removeItem('pbrPracticeCopiedPassword'); player=null; lastOwnPassword=''; copiedPassword=''; await refresh();}catch(x){error=x.message;render();} });
  document.querySelectorAll('.copy-btn').forEach(btn=>btn.addEventListener('click',()=>{ copiedPassword=decodeURIComponent(btn.dataset.copy||''); localStorage.setItem('pbrPracticeCopiedPassword',copiedPassword); btn.textContent='Kopiert ✓'; }));
}

setInterval(()=>{
  const timer=document.querySelector('#timer');
  if(timer) timer.textContent=`${secondsLeft() ?? 0} s`;
},250);
setInterval(refresh,2000);
refresh();
