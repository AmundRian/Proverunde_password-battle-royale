import {
  RULES, NAMES_KEY, assertHostKey, createId, createToken, defaultMeta,
  getMeta, getPlayer, getPlayers, getRedis, resetGame, savePlayer, setMeta,
  validatePassword
} from "./_lib/game.js";

function send(res, status, body) { res.status(status).json(body); }
function fail(message, status = 400) { const e = new Error(message); e.statusCode = status; throw e; }
function cleanName(v) { return String(v || "").trim().replace(/\s+/g, " ").slice(0, 24); }
function hostKey(req, body) { return req.headers["x-host-key"] || body?.hostKey || ""; }
function normalizedPassword(v) { return String(v ?? "").normalize("NFKC").trim().toLocaleLowerCase("nb-NO"); }
function passwordLength(v) { return v == null ? null : [...String(v)].length; }
function clampSeconds(value) {
  const n = Number(value);
  return Math.max(10, Math.min(300, Number.isFinite(n) ? Math.round(n) : 60));
}

function publicState(meta, players) {
  const reveal = ["results", "game_over"].includes(meta.status);
  return {
    meta: { ...meta, lastRound: undefined, roundHistory: undefined },
    rules: RULES.slice(0, meta.round),
    totalRules: RULES.length,
    roundResults: reveal ? meta.lastRound : null,
    roundHistory: (meta.roundHistory || []).map(r => ({
      round: r.round, started: r.started, eliminated: r.eliminated, remaining: r.remaining,
      shortestPasswordLength: r.shortestPasswordLength
    })),
    players: players.map(p => ({
      id: p.id, name: p.name, alive: !!p.alive, hasSubmitted: !!p.submission,
      eliminatedRound: p.eliminatedRound ?? null,
      valid: reveal && p.submission ? !!p.valid : null,
      reason: reveal ? p.reason || null : null
    })).sort((a,b) => Number(b.alive)-Number(a.alive) || a.name.localeCompare(b.name,"nb"))
  };
}

function buildRoundResult(round, starters, finals) {
  const byId = new Map(finals.map(p => [p.id, p]));
  const players = starters.map(s => {
    const p = byId.get(s.id) || s;
    return {
      id: p.id, name: p.name, password: p.submission || null,
      passwordLength: passwordLength(p.submission), submitted: !!p.submission,
      survived: !!p.alive, reason: p.reason || null, failures: p.failures || [],
      submittedAt: p.submittedAt || null
    };
  }).sort((a,b) => {
    if (a.survived !== b.survived) return Number(b.survived)-Number(a.survived);
    if (a.submitted !== b.submitted) return Number(b.submitted)-Number(a.submitted);
    return (a.passwordLength ?? 9999) - (b.passwordLength ?? 9999) || (a.submittedAt ?? 0)-(b.submittedAt ?? 0);
  });
  players.forEach((p,i) => p.rank = i+1);
  const survivors = players.filter(p => p.survived && p.submitted);
  const shortest = survivors.length ? Math.min(...survivors.map(p => p.passwordLength)) : null;
  return {
    round, started: starters.length,
    submitted: players.filter(p => p.submitted).length,
    eliminated: players.filter(p => !p.survived).length,
    remaining: finals.filter(p => p.alive).length,
    shortestPasswordLength: shortest,
    players: players.map(({submittedAt,...rest}) => rest),
    closedAt: Date.now()
  };
}

export default async function handler(req, res) {
  try {
    const redis = getRedis();
    if (req.method === "GET") {
      const [meta, players] = await Promise.all([getMeta(redis), getPlayers(redis)]);
      return send(res, 200, publicState(meta, players));
    }
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let meta = await getMeta(redis);

    if (body.action === "join") {
      if (meta.status !== "lobby") fail("Prøverunden har allerede startet.", 409);
      const name = cleanName(body.name);
      if (name.length < 2) fail("Skriv inn et kallenavn med minst 2 tegn.");
      const key = name.toLocaleLowerCase("nb-NO");
      const id = createId(), token = createToken();
      const claimed = await redis.hsetnx(NAMES_KEY, key, id);
      if (!claimed) fail("Dette kallenavnet er allerede i bruk.", 409);
      const p = { id, name, token, alive: true, submission: null, valid: null, failures: [], reason: null, submittedAt: null, eliminatedRound: null };
      await savePlayer(redis, p);
      const players = await getPlayers(redis);
      return send(res, 200, { player: { id, name, token }, state: publicState(meta, players) });
    }

    if (body.action === "submit") {
      if (meta.status !== "round_open") fail("Runden er ikke åpen.", 409);
      if (meta.deadline && Date.now() > meta.deadline) fail("Tiden er ute. Vent på at hosten avslutter runden.", 409);
      const p = await getPlayer(redis, body.playerId);
      if (!p || p.token !== body.token) fail("Ugyldig spiller.", 401);
      if (!p.alive) fail("Du er allerede eliminert.", 409);
      const password = String(body.password ?? "");
      if (!password) fail("Skriv inn et passord.");
      p.submission = password;
      p.submittedAt = Date.now();
      p.valid = null; p.failures = []; p.reason = null;
      await savePlayer(redis, p);
      // Neutral response: no spoiler before the host closes the round.
      return send(res, 200, { ok: true });
    }

    if (["start_round","close_round","reset"].includes(body.action)) assertHostKey(hostKey(req, body));

    if (body.action === "reset") {
      meta = await resetGame(redis);
      return send(res, 200, { ok: true, meta });
    }

    if (body.action === "start_round") {
      if (!['lobby','results'].includes(meta.status)) fail("Kan ikke starte en ny runde nå.", 409);
      const nextRound = meta.status === "lobby" ? 1 : meta.round + 1;
      if (nextRound > RULES.length) fail("Alle prøverundene er allerede gjennomført.", 409);
      const players = await getPlayers(redis);
      const alive = players.filter(p => p.alive);
      if (!alive.length) fail("Ingen spillere er igjen.", 409);
      for (const p of alive) {
        p.submission = null; p.submittedAt = null; p.valid = null; p.failures = []; p.reason = null;
        await savePlayer(redis, p);
      }
      const seconds = clampSeconds(body.roundSeconds ?? meta.roundSeconds);
      meta = await setMeta(redis, {
        ...meta, status: "round_open", round: nextRound, roundSeconds: seconds,
        deadline: Date.now() + seconds*1000, winners: [], winnerLength: null, lastRound: null
      });
      return send(res, 200, { ok: true, meta });
    }

    if (body.action === "close_round") {
      if (meta.status !== "round_open") fail("Runden er ikke åpen.", 409);
      const players = await getPlayers(redis);
      const starters = players.filter(p => p.alive).map(p => ({...p}));
      const active = players.filter(p => p.alive);

      // Determine the first submitter for each complete password (case-insensitive).
      const ordered = active.filter(p => p.submission).sort((a,b) => (a.submittedAt||0)-(b.submittedAt||0));
      const firstByPassword = new Map();
      for (const p of ordered) {
        const key = normalizedPassword(p.submission);
        if (!firstByPassword.has(key)) firstByPassword.set(key, p);
      }

      for (const p of active) {
        let failures = [];
        let reason = null;
        if (!p.submission) {
          failures = ["Ingen passord ble levert."];
          reason = failures[0];
        } else {
          const check = validatePassword(p.submission, meta.round);
          failures = [...check.failures];
          const first = firstByPassword.get(normalizedPassword(p.submission));
          if (first && first.id !== p.id) {
            failures.push(`Samme passord: ${first.name} leverte dette passordet først.`);
          }
          reason = failures[0] || null;
        }
        p.valid = failures.length === 0;
        p.failures = failures;
        p.reason = reason;
        if (!p.valid) { p.alive = false; p.eliminatedRound = meta.round; }
        await savePlayer(redis, p);
      }

      const finals = await getPlayers(redis);
      const result = buildRoundResult(meta.round, starters, finals);
      const history = [...(meta.roundHistory || []), result];
      const alive = finals.filter(p => p.alive && p.submission);
      const lastRound = meta.round >= RULES.length;
      let winners = [], winnerLength = null;
      if (lastRound && alive.length) {
        winnerLength = Math.min(...alive.map(p => passwordLength(p.submission)));
        winners = alive.filter(p => passwordLength(p.submission) === winnerLength).map(p => p.name);
      }
      meta = await setMeta(redis, {
        ...meta, status: lastRound ? "game_over" : "results", deadline: null,
        lastRound: result, roundHistory: history, winners, winnerLength
      });
      return send(res, 200, { ok: true, state: publicState(meta, finals) });
    }

    fail("Ukjent handling.", 400);
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || "Ukjent feil" });
  }
}
