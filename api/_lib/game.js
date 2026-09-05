import { Redis } from "@upstash/redis";
import crypto from "node:crypto";

// Practice game v2: separate namespace from both the wedding game and the old practice rules.
// Wedding game uses pbr:* and the previous practice version used pbr-practice:v1:*.
const PREFIX = "pbr-practice:v5:";
export const META_KEY = `${PREFIX}meta`;
export const PLAYERS_KEY = `${PREFIX}players`;
export const NAMES_KEY = `${PREFIX}names`;
export const WINNER_KEY = `${PREFIX}winner`;
export const VOTES_KEY = `${PREFIX}votes`;

export const RULES = [
  { id: "country", text: "Passordet ditt må inneholde navnet på et land. Norske og engelske skrivemåter godkjennes." },
  { id: "upper2number", text: "Passordet ditt må inneholde minst to store bokstaver og minst ett tall." },
  { id: "rubikColourDeadlySin", text: "Passordet ditt må inneholde en av fargene på en klassisk Rubiks kube. Passordet ditt må også inneholde en av de syv dødssyndene." },
  { id: "voteVowels", text: "Du må stemme på en annen deltaker. De to høyest stemte blant deltakerne som ellers ville gått videre blir eliminert. Passordet ditt må også ha ulikt antall vokaler og konsonanter." },
  { id: "primeMinister", text: "Passordet ditt må inneholde fornavnet på en av Norges statsministre." },
  { id: "maxOneA", text: "Passordet ditt kan kun inneholde én av bokstaven «a» (A/a)." },
  { id: "primeNumber", text: "Passordet ditt må inneholde minst ett primtall mellom 0 og 100. Merk: 1 er ikke et primtall." },
  { id: "walterEmoji", text: "Du må dytte Walter over målstreken før du leverer svaret ditt. Walter-oppgaven gjelder kun i runde 8 – du trenger ikke dytte Walter i senere runder. Passordet ditt må også inneholde minst tre emojier." },
  { id: "gCount", text: "Passordet ditt må avsluttes med et tall som er likt antall g-er (g/G) i passordet ditt." },
  { id: "eggTimer", text: "Før du får levere passordet ditt må du koke ett egg. Dra egget ned i kjelen. Ett sekund tilsvarer ett minutt. Stopp når du mener egget er smilende." },
  { id: "firstWins", text: "Den første deltakeren som leverer et gyldig passord, vinner prøverunden." }
];

// Based on the FN-sambandet country overview, plus English country names and common variants.
// Matching is case-insensitive and ignores spaces, hyphens and Norwegian diacritics.
const COUNTRY_NAMES = [
  "United Kingdom of Great Britain and Northern Ireland", "Democratic Republic of Sao Tome and Principe", "Democratic Socialist Republic of Sri Lanka", "Federal Democratic Republic of Ethiopia",
  "People's Democratic Republic of Algeria", "Democratic People's Republic of Korea", "Federal Democratic Republic of Nepal", "Independent State of Papua New Guinea",
  "Korea, Democratic People's Republic of", "Congo, The Democratic Republic of the", "Den demokratiske republikken Kongo", "Democratic Republic of Timor-Leste",
  "Republic of Bosnia and Herzegovina", "Bolivarian Republic of Venezuela", "Den sentralafrikanske republikk", "Venezuela, Bolivarian Republic of",
  "Democratic Republic of the Congo", "Islamic Republic of Afghanistan", "Lao People's Democratic Republic", "Republic of the Marshall Islands",
  "Saint Vincent and the Grenadines", "Bolivia, Plurinational State of", "Federated States of Micronesia", "Islamic Republic of Mauritania",
  "Micronesia, Federated States of", "People's Republic of Bangladesh", "Plurinational State of Bolivia", "Principality of Liechtenstein",
  "Republic of Trinidad and Tobago", "Federative Republic of Brazil", "Republic of Equatorial Guinea", "Socialist Republic of Viet Nam",
  "De forente arabiske emirater", "Islamic Republic of Pakistan", "Saint Vincent og Grenadinene", "Commonwealth of the Bahamas",
  "Den dominikanske republikk", "Eastern Republic of Uruguay", "Federal Republic of Germany", "Federal Republic of Nigeria",
  "Federal Republic of Somalia", "Hashemite Kingdom of Jordan", "Republic of North Macedonia", "Republic of the Philippines",
  "Tanzania, United Republic of", "United Republic of Tanzania", "Holy See (Vatican City State)", "Independent State of Samoa",
  "Kingdom of the Netherlands", "Central African Republic", "Commonwealth of Dominica", "Grand Duchy of Luxembourg",
  "Palestinian Territories", "People's Republic of China", "Republic of Guinea-Bissau", "Iran, Islamic Republic of",
  "Islamic Republic of Iran", "Principality of Andorra", "Republic of Côte d'Ivoire", "Republic of Sierra Leone",
  "Republic of South Africa", "Taiwan, Province of China", "United States of America", "Bosnia and Herzegovina",
  "Kingdom of Saudi Arabia", "Principality of Monaco", "Republic of Azerbaijan", "Republic of El Salvador",
  "Republic of Kazakhstan", "Republic of Madagascar", "Republic of Mozambique", "Republic of Seychelles",
  "Republic of South Sudan", "Republic of Tajikistan", "Republic of Uzbekistan", "Arab Republic of Egypt",
  "Republic of Cabo Verde", "Republic of Costa Rica", "Republic of Guatemala", "Republic of Indonesia",
  "Republic of Lithuania", "Republic of Mauritius", "Republic of Nicaragua", "Republic of San Marino",
  "Republic of Singapore", "Republic of the Gambia", "St. Vincent & Grenadines", "the State of Palestine",
  "United Mexican States", "Portuguese Republic", "Republic of Botswana", "Republic of Bulgaria",
  "Republic of Cameroon", "Republic of Colombia", "Republic of Djibouti", "Republic of Honduras",
  "Republic of Kiribati", "Republic of Maldives", "Republic of Paraguay", "Republic of Slovenia",
  "Republic of Suriname", "Republic of the Congo", "Republic of the Niger", "Republic of the Sudan",
  "Republic of Zimbabwe", "Saint Kitts and Nevis", "Sao Tome and Principe", "São Tomé and Príncipe",
  "Swiss Confederation", "Syrian Arab Republic", "United Arab Emirates", "Antigua and Barbuda",
  "Argentine Republic", "Bosnia-Hercegovina", "Bosnia & Herzegovina", "Dominican Republic",
  "Kingdom of Cambodia", "Kingdom of Eswatini", "Kingdom of Thailand", "Moldova, Republic of",
  "Republic of Albania", "Republic of Armenia", "Republic of Austria", "Republic of Belarus",
  "Republic of Burundi", "Republic of Croatia", "Republic of Ecuador", "Republic of Estonia",
  "Republic of Finland", "Republic of Iceland", "Republic of Liberia", "Republic of Moldova",
  "Republic of Myanmar", "Republic of Namibia", "Republic of Senegal", "Republic of Tunisia",
  "Republic of Türkiye", "Republic of Vanuatu", "Russian Federation", "Saint Kitts og Nevis",
  "São Tomé og Príncipe", "the State of Eritrea", "Trinidad and Tobago", "Union of the Comoros",
  "Antigua og Barbuda", "Brunei Darussalam", "Congo - Brazzaville", "Ekvatorial-Guinea",
  "Equatorial Guinea", "Gabonese Republic", "Hellenic Republic", "Kingdom of Bahrain",
  "Kingdom of Belgium", "Kingdom of Denmark", "Kingdom of Lesotho", "Kingdom of Morocco",
  "Lebanese Republic", "Palestine, State of", "Republic of Angola", "Republic of Cyprus",
  "Republic of Guinea", "Republic of Guyana", "Republic of Latvia", "Republic of Malawi",
  "Republic of Panama", "Republic of Poland", "Republic of Serbia", "Republic of Uganda",
  "Republic of Zambia", "Republikken Kongo", "Rwandese Republic", "State of Palestine",
  "Togolese Republic", "Trinidad og Tobago", "Elfenbenskysten", "Italian Republic",
  "Kingdom of Bhutan", "Kingdom of Norway", "Kingdom of Sweden", "Korea, Republic of",
  "Marshall Islands", "Republic of Benin", "Republic of Chile", "Republic of Ghana",
  "Republic of Haiti", "Republic of India", "Republic of Kenya", "Republic of Malta",
  "Republic of Nauru", "Republic of Palau", "Republic of Yemen", "São Tomé & Príncipe",
  "Sultanate of Oman", "Antigua & Barbuda", "French Republic", "Kingdom of Spain",
  "Kingdom of Tonga", "Kyrgyz Republic", "North Macedonia", "Papua New Guinea",
  "Republic of Chad", "Republic of Cuba", "Republic of Fiji", "Republic of Iraq",
  "Republic of Mali", "Republic of Peru", "Slovak Republic", "Solomon Islands",
  "Trinidad & Tobago", "Congo - Kinshasa", "Czech Republic", "Hviterussland",
  "Liechtenstein", "Marshalløyene", "Nord-Makedonia", "Papua Ny-Guinea",
  "State of Israel", "State of Kuwait", "Storbritannia", "United Kingdom",
  "Vatikanstaten", "Western Sahara", "Aserbajdsjan", "Great Britain",
  "Guinea Bissau", "Guinea-Bissau", "Myanmar (Burma)", "Salomonøyene",
  "State of Qatar", "St. Kitts & Nevis", "Tadsjikistan", "Turkmenistan",
  "United States", "Afghanistan", "Burkina Faso", "Cook Islands",
  "Cote d'Ivoire", "Côte d'Ivoire", "Côte d’Ivoire", "Filippinene",
  "Kirgisistan", "Netherlands", "Philippines", "Saudi Arabia",
  "Saudi-Arabia", "Seychellene", "Sierra Leone", "South Africa",
  "Switzerland", "Vatican City", "Azerbaijan", "Bangladesh",
  "El Salvador", "Ivory Coast", "Kasakhstan", "Kazakhstan",
  "Kyrgyzstan", "Luxembourg", "Madagascar", "Madagaskar",
  "Mauritania", "Micronesia", "Mikronesia", "Montenegro",
  "Mozambique", "New Zealand", "North Korea", "Saint Lucia",
  "Seychelles", "South Korea", "South Sudan", "Tajikistan",
  "The Bahamas", "Timor-Leste", "Usbekistan", "Uzbekistan",
  "Vest-Sahara", "Argentina", "Australia", "Cabo Verde",
  "Cape Verde", "Cookøyene", "Costa Rica", "East Timor",
  "Frankrike", "Guatemala", "Indonesia", "Kambodsja",
  "Kapp Verde", "Lithuania", "Maldivene", "Mauritius",
  "Nederland", "Nicaragua", "Nord-Korea", "Østerrike",
  "Palestina", "Palestine", "San Marino", "Singapore",
  "Sør-Afrika", "The Gambia", "Venezuela", "Barbados",
  "Botswana", "Bulgaria", "Cambodia", "Cameroon",
  "Colombia", "Djibouti", "Dominica", "Eswatini",
  "Ethiopia", "Honduras", "Kiribati", "Komorene",
  "Malaysia", "Maldives", "Mongolia", "Mosambik",
  "Øst-Timor", "Pakistan", "Paraguay", "Portugal",
  "Russland", "Slovakia", "Slovenia", "Sør-Korea",
  "Sør-Sudan", "Sri Lanka", "Suriname", "Tanzania",
  "Thailand", "Tsjekkia", "Tyskland", "Zimbabwe",
  "Albania", "Algeria", "Algerie", "Andorra",
  "Armenia", "Austria", "Bahamas", "Bahrain",
  "Belarus", "Belgium", "Bolivia", "Burundi",
  "Comoros", "Croatia", "Czechia", "Danmark",
  "Denmark", "DR Congo", "Ecuador", "Eritrea",
  "Estland", "Estonia", "Etiopia", "Finland",
  "Georgia", "Germany", "Grenada", "Hungary",
  "Iceland", "Ireland", "Jamaica", "Kamerun",
  "Kroatia", "Lebanon", "Lesotho", "Libanon",
  "Liberia", "Litauen", "Marokko", "Moldova",
  "Morocco", "Myanmar", "Namibia", "Nigeria",
  "Romania", "Senegal", "Somalia", "St. Lucia",
  "Surinam", "Sverige", "Tunisia", "Türkiye",
  "Ukraina", "Ukraine", "Uruguay", "Vanuatu",
  "Viet Nam", "Vietnam", "Angola", "Belgia",
  "Belize", "Bhutan", "Brasil", "Brazil",
  "Brunei", "Canada", "Cyprus", "France",
  "Gambia", "Greece", "Guinea", "Guyana",
  "Hellas", "Irland", "Island", "Israel",
  "Italia", "Jordan", "Kosovo", "Kuwait",
  "Kypros", "Latvia", "Malawi", "Mexico",
  "Monaco", "Norway", "Panama", "Poland",
  "Russia", "Rwanda", "Serbia", "Spania",
  "Sveits", "Sweden", "Taiwan", "Turkey",
  "Tuvalu", "Tyrkia", "Uganda", "Ungarn",
  "Zambia", "Benin", "Burma", "Chile",
  "China", "Congo", "Egypt", "Gabon",
  "Ghana", "Haiti", "India", "Italy",
  "Japan", "Jemen", "Kenya", "Kongo",
  "Libya", "Malta", "Nauru", "Nepal",
  "Niger", "Norge", "Palau", "Polen",
  "Qatar", "Samoa", "Spain", "Sudan",
  "Syria", "Tonga", "Tsjad", "Yemen",
  "Chad", "Cuba", "Fiji", "Irak",
  "Iran", "Iraq", "Kina", "Laos",
  "Mali", "Niue", "Oman", "Peru",
  "Togo", "USA"
];

// First names from regjeringen.no's timeline of Norwegian prime ministers from 1814 to today.
const PRIME_MINISTER_FIRST_NAMES = ["Peder", "Mathias", "Severin", "Frederik", "Georg", "Otto", "Christian", "Johan", "Emil", "Johannes", "Francis", "Jørgen", "Gunnar", "Wollert", "Jens", "Abraham", "Ivar", "Christopher", "Einar", "Oscar", "John", "Per", "Trygve", "Lars", "Odvar", "Gro", "Kåre", "Jan", "Thorbjørn", "Kjell", "Erna", "Jonas"];

function normalizeForMatch(value) {
  return String(value ?? "")
    .toLocaleLowerCase("nb-NO")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]/g, "");
}

const COUNTRY_KEYS = [...new Set(COUNTRY_NAMES.map(normalizeForMatch).filter(Boolean))];
const PRIME_MINISTER_KEYS = [...new Set(PRIME_MINISTER_FIRST_NAMES.map(normalizeForMatch).filter(Boolean))];

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
    // A fresh sessionId is created for every full host reset. The browser uses
    // this to know when locally cached passwords/progress belong to an old game.
    sessionId: crypto.randomBytes(12).toString("hex"),
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
  let meta = await redis.get(META_KEY);
  if (!meta) {
    meta = defaultMeta();
    await redis.set(META_KEY, meta);
    return meta;
  }

  // One-time migration for a live v4 game created before sessionId existed.
  if (!meta.sessionId) {
    meta = { ...meta, sessionId: crypto.randomBytes(12).toString("hex") };
    await redis.set(META_KEY, meta);
  }
  return meta;
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
  await Promise.all([redis.del(META_KEY), redis.del(PLAYERS_KEY), redis.del(NAMES_KEY), redis.del(WINNER_KEY), redis.del(VOTES_KEY)]);
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

function containsCountry(value) {
  const normalized = normalizeForMatch(value);
  return COUNTRY_KEYS.some(country => normalized.includes(country));
}

function hasTwoUppercaseAndNumber(value) {
  const text = String(value ?? "");
  const uppercaseCount = (text.match(/\p{Lu}/gu) || []).length;
  return uppercaseCount >= 2 && /\d/u.test(text);
}

function containsRubikColour(value) {
  const normalized = normalizeForMatch(value);
  const colours = [
    "hvit", "white",
    "rød", "rod", "red",
    "blå", "bla", "blue",
    "grønn", "gronn", "green",
    "oransje", "orange",
    "gul", "yellow"
  ].map(normalizeForMatch);
  return colours.some(colour => normalized.includes(colour));
}

function containsDeadlySin(value) {
  const normalized = normalizeForMatch(value);
  // Sju dødssynder. Fasiten vises ikke i spillergrensesnittet.
  const sins = [
    "hovmod", "pride",
    "grådighet", "gradighet", "greed", "avarice",
    "utukt", "lust",
    "misunnelse", "envy",
    "fråtseri", "fratseri", "gluttony",
    "vrede", "wrath",
    "latskap", "sloth"
  ].map(normalizeForMatch);
  return sins.some(sin => normalized.includes(sin));
}

function containsPrimeMinisterFirstName(value) {
  const normalized = normalizeForMatch(value);
  return PRIME_MINISTER_KEYS.some(name => normalized.includes(name));
}

function hasMaxOneA(value) {
  const matches = String(value ?? "").match(/a/gi);
  return (matches?.length || 0) <= 1;
}

function hasUnequalVowelsAndConsonants(value) {
  const letters = [...String(value ?? "").toLocaleLowerCase("nb-NO")].filter(ch => /[a-zæøå]/u.test(ch));
  const vowels = new Set(["a", "e", "i", "o", "u", "y", "æ", "ø", "å"]);
  let vowelCount = 0;
  let consonantCount = 0;
  for (const ch of letters) {
    if (vowels.has(ch)) vowelCount += 1;
    else consonantCount += 1;
  }
  return vowelCount !== consonantCount;
}

const PRIMES_UNDER_100 = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]);

function containsPrimeNumber(value) {
  const runs = String(value ?? "").match(/\d+/g) || [];
  return runs.some(run => PRIMES_UNDER_100.has(Number(run)));
}

function countEmojis(value) {
  const text = String(value ?? "");
  // Count visible emoji grapheme clusters, so a family/ZWJ emoji counts as one.
  const segmenter = new Intl.Segmenter("nb", { granularity: "grapheme" });
  let count = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (/\p{Extended_Pictographic}/u.test(segment) || /\p{Regional_Indicator}{2}/u.test(segment) || /[0-9#*]\uFE0F?\u20E3/u.test(segment)) {
      count += 1;
    }
  }
  return count;
}

function containsAtLeastThreeEmojis(value) {
  return countEmojis(value) >= 3;
}

function hasMatchingGCountAtEnd(value) {
  const text = String(value ?? "");
  const match = text.match(/(\d+)$/u);
  if (!match) return false;
  const gCount = (text.match(/g/gi) || []).length;
  return Number(match[1]) === gCount;
}

// Runde 9 valideres server-side via egg-tiden, ikke via selve passordteksten.

export function validatePassword(password, activeCount) {
  const p = String(password ?? "");
  const failures = [];
  const active = RULES.slice(0, activeCount);
  for (const rule of active) {
    let ok = true;
    switch (rule.id) {
      case "country": ok = containsCountry(p); break;
      case "upper2number": ok = hasTwoUppercaseAndNumber(p); break;
      case "rubikColourDeadlySin": ok = containsRubikColour(p) && containsDeadlySin(p); break;
      case "voteVowels": ok = hasUnequalVowelsAndConsonants(p); break;
      case "primeMinister": ok = containsPrimeMinisterFirstName(p); break;
      case "maxOneA": ok = hasMaxOneA(p); break;
      case "primeNumber": ok = containsPrimeNumber(p); break;
      case "walterEmoji": ok = containsAtLeastThreeEmojis(p); break;
      case "gCount": ok = hasMatchingGCountAtEnd(p); break;
      case "eggTimer": ok = true; break;
      case "firstWins": ok = true; break;
      default: ok = true;
    }
    if (!ok) failures.push(rule.text);
  }
  return { valid: failures.length === 0, failures };
}
