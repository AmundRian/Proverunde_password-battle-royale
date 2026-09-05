import {
  RULES, NAMES_KEY, WINNER_KEY, VOTES_KEY, assertHostKey, createId, createToken, defaultMeta,
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
      reason: reveal ? p.reason || null : null,
      walterRound: p.walterRound ?? null,
      walterSteps: Number(p.walterSteps || 0),
      lives: Number.isFinite(Number(p.lives)) ? Number(p.lives) : 2
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
      survived: !!p.alive, valid: !!p.valid, reason: p.reason || null, failures: p.failures || [],
      submittedAt: p.submittedAt || null, lives: Number.isFinite(Number(p.lives)) ? Number(p.lives) : null
    };
  }).sort((a,b) => {
    if (a.survived !== b.survived) return Number(b.survived)-Number(a.survived);
    if (a.valid !== b.valid) return Number(b.valid)-Number(a.valid);
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
      const p = { id, name, token, alive: true, submission: null, valid: null, failures: [], reason: null, submittedAt: null, eliminatedRound: null, walterRound: null, walterSteps: 0, eggSeconds: null, lives: 2 };
      await savePlayer(redis, p);
      const players = await getPlayers(redis);
      return send(res, 200, { player: { id, name, token }, state: publicState(meta, players) });
    }

    if (body.action === "walter_step") {
      if (meta.status !== "round_open" || meta.round !== 8) fail("Walter-oppgaven gjelder bare i runde 8.", 409);
      const p = await getPlayer(redis, body.playerId);
      if (!p || p.token !== body.token) fail("Ugyldig spiller.", 401);
      if (!p.alive) fail("Du er allerede eliminert.", 409);
      const requested = Math.max(0, Math.min(25, Math.floor(Number(body.steps) || 0)));
      if (p.walterRound !== 8) { p.walterRound = 8; p.walterSteps = 0; }
      p.walterSteps = Math.max(Number(p.walterSteps || 0), requested);
      await savePlayer(redis, p);
      return send(res, 200, { ok: true, walterSteps: p.walterSteps });
    }

    if (body.action === "vote") {
      if (meta.status !== "round_open" || meta.round !== 4) fail("Avstemningen gjelder bare i runde 4.", 409);
      const voter = await getPlayer(redis, body.playerId);
      if (!voter || voter.token !== body.token) fail("Ugyldig spiller.", 401);
      if (!voter.alive) fail("Du er allerede eliminert.", 409);
      const targetId = String(body.targetId || "");
      const target = await getPlayer(redis, targetId);
      if (!target || !target.alive) fail("Denne deltakeren kan ikke stemmes på.", 409);
      if (target.id === voter.id) fail("Du kan ikke stemme på deg selv.", 409);
      await redis.hset(VOTES_KEY, { [voter.id]: target.id });
      return send(res, 200, { ok: true, targetId: target.id, targetName: target.name });
    }

    if (body.action === "submit") {
      if (meta.status !== "round_open") fail("Runden er ikke åpen.", 409);
      if (meta.deadline && Date.now() > meta.deadline) fail("Tiden er ute. Vent på at hosten avslutter runden.", 409);
      const p = await getPlayer(redis, body.playerId);
      if (!p || p.token !== body.token) fail("Ugyldig spiller.", 401);
      if (!p.alive) fail("Du er allerede eliminert.", 409);
      const password = String(body.password ?? "");
      if (!password) fail("Skriv inn et passord.");

      // Runde 8: Walter-status sendes sammen med selve innleveringen.
      // Dette gjør mobilklikk robuste selv om bakgrunnssynkronisering er treg.
      if (meta.round === 8) {
        const submittedWalterSteps = Math.max(0, Math.min(25, Math.floor(Number(body.walterSteps) || 0)));
        if (submittedWalterSteps >= 25) {
          p.walterRound = 8;
          p.walterSteps = 25;
        }
        if (!(p.walterRound === 8 && Number(p.walterSteps || 0) >= 25)) {
          fail("Du må dytte Walter over målstreken før du kan levere i runde 8.", 409);
        }
      }

      // Runde 10: egg-tiden sendes sammen med passordet. Vi avslører ikke
      // om tiden var riktig før runden avsluttes. Spilleren kan prøve på nytt
      // og erstatte innleveringen så lenge runden er åpen.
      if (meta.round === 10) {
        const eggSeconds = Number(body.eggSeconds);
        if (!Number.isFinite(eggSeconds) || eggSeconds < 0 || eggSeconds > 60) {
          fail("Du må koke egget og stoppe timeren før du kan levere i runde 10.", 409);
        }
        p.eggSeconds = Math.round(eggSeconds * 100) / 100;
      }

      p.submission = password;
      p.submittedAt = Date.now();
      p.valid = null; p.failures = []; p.reason = null;
      await savePlayer(redis, p);

      // Round 10 is a race: the first player to submit a password that follows
      // every active rule wins immediately. Invalid attempts remain spoiler-free
      // and may be replaced until someone wins or the host closes the round.
      if (meta.round === RULES.length) {
        const check = validatePassword(password, meta.round);
        if (check.valid) {
          const claim = await redis.set(WINNER_KEY, JSON.stringify({ id: p.id, name: p.name, submittedAt: p.submittedAt, password }), { nx: true });
          if (claim) {
            const before = await getPlayers(redis);
            const starters = before.filter(q => q.alive).map(q => ({ ...q }));
            for (const q of before.filter(q => q.alive)) {
              if (q.id === p.id) {
                q.valid = true; q.failures = []; q.reason = null;
              } else {
                q.alive = false;
                q.eliminatedRound = meta.round;
                q.valid = false;
                q.failures = [`${p.name} leverte et gyldig passord først.`];
                q.reason = q.failures[0];
              }
              await savePlayer(redis, q);
            }
            const finals = await getPlayers(redis);
            const result = buildRoundResult(meta.round, starters, finals);
            const history = [...(meta.roundHistory || []), result];
            meta = await setMeta(redis, {
              ...meta,
              status: "game_over",
              deadline: null,
              lastRound: result,
              roundHistory: history,
              winners: [p.name],
              winnerLength: passwordLength(password)
            });
            return send(res, 200, { ok: true, won: true, state: publicState(meta, finals) });
          } else {
            // Another valid submission won the atomic race. Make sure a late
            // overlapping request cannot accidentally overwrite the eliminated state.
            const winnerRaw = await redis.get(WINNER_KEY);
            const winner = typeof winnerRaw === "string" ? JSON.parse(winnerRaw) : winnerRaw;
            const current = await getPlayer(redis, p.id);
            if (winner?.id && current && winner.id !== current.id) {
              current.alive = false;
              current.eliminatedRound = meta.round;
              current.valid = false;
              current.failures = [`${winner.name} leverte et gyldig passord først.`];
              current.reason = current.failures[0];
              await savePlayer(redis, current);
            }
          }
        }
      }

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
      if (nextRound === 4) await redis.del(VOTES_KEY);
      for (const p of alive) {
        p.submission = null; p.submittedAt = null; p.valid = null; p.failures = []; p.reason = null; p.eggSeconds = null;
        // Runde 1–3 er treningsrunder med to liv. Fra runde 4 går alle
        // gjenværende spillere over til sudden death med ett liv.
        if (nextRound === 1 && !Number.isFinite(Number(p.lives))) p.lives = 2;
        if (nextRound === 4) p.lives = 1;
        if (nextRound === 8) { p.walterRound = 8; p.walterSteps = 0; }
        await savePlayer(redis, p);
      }
      if (nextRound === RULES.length) await redis.del(WINNER_KEY);
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
      const votesRaw = meta.round === 4 ? (await redis.hgetall(VOTES_KEY) || {}) : {};
      const votes = Object.fromEntries(Object.entries(votesRaw).map(([voterId, target]) => [voterId, String(target)]));

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
          if (meta.round === 4 && !votes[p.id]) {
            failures.push("Du avga ikke en stemme på en annen deltaker i runde 4.");
          }
          if (meta.round === 8 && !(p.walterRound === 8 && Number(p.walterSteps || 0) >= 25)) {
            failures.push("Walter kom ikke over målstreken før passordet ble levert i runde 8.");
          }
          if (meta.round === 10) {
            const eggSeconds = Number(p.eggSeconds);
            if (!Number.isFinite(eggSeconds) || eggSeconds < 6 || eggSeconds > 8) {
              failures.push("Egget ble ikke stoppet innenfor riktig tidsvindu for et smilende egg.");
            }
          }
          const first = firstByPassword.get(normalizedPassword(p.submission));
          if (first && first.id !== p.id) {
            failures.push(`Samme passord: ${first.name} leverte dette passordet først.`);
          }
          reason = failures[0] || null;
        }

        p.valid = failures.length === 0;
        p.failures = failures;
        p.reason = reason;

        if (!p.valid) {
          if (meta.round <= 3) {
            const currentLives = Math.max(1, Number(p.lives || 2));
            p.lives = currentLives - 1;
            if (p.lives <= 0) {
              p.alive = false;
              p.eliminatedRound = meta.round;
              p.reason = `${reason || "Regelen ble ikke oppfylt."} Du mistet ditt siste liv.`;
            } else {
              p.alive = true;
              p.reason = `${reason || "Regelen ble ikke oppfylt."} Du mistet ett liv, men er fortsatt med.`;
            }
          } else {
            p.lives = 0;
            p.alive = false;
            p.eliminatedRound = meta.round;
          }
        }
        await savePlayer(redis, p);
      }

      // Runde 4: passordene vurderes først. Deretter elimineres de to høyest
      // stemte blant spillerne som ellers ville gått videre. Stemmer på spillere
      // som allerede røk på passordkravet teller derfor ikke i utslagsdelen.
      if (meta.round === 4) {
        const afterPassword = await getPlayers(redis);
        const eligible = afterPassword.filter(p => p.alive);
        const eligibleIds = new Set(eligible.map(p => p.id));
        const starterById = new Map(starters.map(p => [p.id, p]));
        const voteDetails = new Map(eligible.map(p => [p.id, []]));
        for (const [voterId, targetId] of Object.entries(votes)) {
          if (!eligibleIds.has(targetId)) continue;
          const voter = starterById.get(voterId);
          if (!voter) continue;
          voteDetails.get(targetId)?.push(voter.name);
        }

        const scored = eligible
          .map(p => ({ p, voters: voteDetails.get(p.id) || [] }))
          .sort((a,b) => b.voters.length - a.voters.length || a.p.name.localeCompare(b.p.name, "nb"));

        // Opptil to elimineres, og med minst to kvalifiserte spillere blir det
        // alltid to. Ved stemmelikhet på grensen trekkes tilfeldig mellom de som
        // står likt, slik at avstemningen fortsatt får nøyaktig to plasser.
        const chosen = [];
        let i = 0;
        while (chosen.length < 2 && i < scored.length) {
          const count = scored[i].voters.length;
          const tied = [];
          while (i < scored.length && scored[i].voters.length === count) tied.push(scored[i++]);
          const remainingSlots = 2 - chosen.length;
          if (tied.length <= remainingSlots) {
            chosen.push(...tied);
          } else {
            const pool = [...tied];
            while (chosen.length < 2 && pool.length) {
              const pick = Math.floor(Math.random() * pool.length);
              chosen.push(pool.splice(pick, 1)[0]);
            }
          }
        }

        for (const entry of chosen) {
          const p = entry.p;
          p.alive = false;
          p.lives = 0;
          p.eliminatedRound = 4;
          p.valid = false;
          p.failures = [...(p.failures || []), `Stemmet ut med ${entry.voters.length} stemme${entry.voters.length === 1 ? "" : "r"}.`];
          p.reason = entry.voters.length
            ? `Stemmet ut med ${entry.voters.length} stemme${entry.voters.length === 1 ? "" : "r"}: ${entry.voters.join(", ")}.`
            : "Stemmet ut etter stemmelikhet med 0 stemmer. Ingen stemte direkte på deg.";
          await savePlayer(redis, p);
        }
      }

      const finals = await getPlayers(redis);
      const result = buildRoundResult(meta.round, starters, finals);
      const history = [...(meta.roundHistory || []), result];
      const alive = finals.filter(p => p.alive && p.submission);
      const lastRound = meta.round >= RULES.length;
      let winners = [], winnerLength = null;
      if (lastRound && alive.length) {
        const first = [...alive].sort((a,b) => (a.submittedAt || Infinity) - (b.submittedAt || Infinity))[0];
        if (first) {
          winners = [first.name];
          winnerLength = passwordLength(first.submission);
        }
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
