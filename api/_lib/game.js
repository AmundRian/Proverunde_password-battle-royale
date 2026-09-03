import { Redis } from "@upstash/redis";
import crypto from "node:crypto";

// IMPORTANT: The practice game uses its own key namespace.
// Even if it is accidentally connected to the same Redis database as the wedding game,
// these keys do not overlap with the live game's pbr:* keys.
const PREFIX = "pbr-practice:v1:";
export const META_KEY = `${PREFIX}meta`;
export const PLAYERS_KEY = `${PREFIX}players`;
export const NAMES_KEY = `${PREFIX}names`;

export const RULES = [
  { id: "length4", text: "Passordet ditt må inneholde minst 4 tegn." },
  { id: "number", text: "Passordet ditt må inneholde minst ett tall." },
  { id: "uppercase", text: "Passordet ditt må inneholde minst én stor bokstav." },
  { id: "colour", text: "Passordet ditt må inneholde én av fargene rød, blå eller grønn. Norske og engelske navn godkjennes." },
  { id: "exclamation", text: "Passordet ditt må avsluttes med et utropstegn (!)." }
];

export function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    const error = new Error("Redis er ikke konfigurert. Koble en Upstash Redis-database til dette Vercel-prosjektet.");
    error.statusCode = 500;
    throw error;
  }
  return new Redis({ url, token });
}

export function defaultMeta() {
  return {
    status: "lobby",
    round: 0,
    roundSeconds: 60,
    deadline: null,
    winners: [],
    winnerLength: null,
    updatedAt: Date.now(),
    lastRound: null,
    roundHistory: []
  };
}

export async function getMeta(redis) {
  return (await redis.get(META_KEY)) || defaultMeta();
}

export async function setMeta(redis, meta) {
  meta.updatedAt = Date.now();
  await redis.set(META_KEY, meta);
  return meta;
}

export async function getPlayers(redis) {
  const raw = await redis.hgetall(PLAYERS_KEY);
  if (!raw) return [];
  return Object.values(raw).map(value => typeof value === "string" ? JSON.parse(value) : value);
}

export async function getPlayer(redis, id) {
  const value = await redis.hget(PLAYERS_KEY, id);
  if (!value) return null;
  return typeof value === "string" ? JSON.parse(value) : value;
}

export async function savePlayer(redis, player) {
  await redis.hset(PLAYERS_KEY, { [player.id]: JSON.stringify(player) });
  return player;
}

export async function resetGame(redis) {
  await Promise.all([redis.del(META_KEY), redis.del(PLAYERS_KEY), redis.del(NAMES_KEY)]);
  const meta = defaultMeta();
  await setMeta(redis, meta);
  return meta;
}

export function createId() { return crypto.randomBytes(10).toString("hex"); }
export function createToken() { return crypto.randomBytes(24).toString("hex"); }

export function assertHostKey(value) {
  const expected = process.env.HOST_KEY || "";
  if (!expected || !value || value !== expected) {
    const error = new Error("Feil host-nøkkel.");
    error.statusCode = 401;
    throw error;
  }
}

function hasUppercase(value) {
  return /[A-ZÆØÅ]/u.test(value);
}

function containsColour(value) {
  const lower = value.toLocaleLowerCase("nb-NO");
  return ["rød", "rod", "red", "blå", "bla", "blue", "grønn", "gronn", "green"]
    .some(word => lower.includes(word));
}

export function validatePassword(password, activeCount) {
  const p = String(password ?? "");
  const failures = [];
  const active = RULES.slice(0, activeCount);
  for (const rule of active) {
    let ok = true;
    switch (rule.id) {
      case "length4": ok = [...p].length >= 4; break;
      case "number": ok = /\d/.test(p); break;
      case "uppercase": ok = hasUppercase(p); break;
      case "colour": ok = containsColour(p); break;
      case "exclamation": ok = p.endsWith("!"); break;
      default: ok = true;
    }
    if (!ok) failures.push(rule.text);
  }
  return { valid: failures.length === 0, failures };
}
