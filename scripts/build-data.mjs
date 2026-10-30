// Builds data/countries.json from the World Bank API, plus data/fx-snapshot.json
// (an offline fallback for the ECB rates). Run: node scripts/build-data.mjs
import { writeFile } from "node:fs/promises";
import { CURRENCY } from "./currencies.mjs";

const WB = "https://api.worldbank.org/v2";

// Everyday names for World Bank's formal country names.
const NAMES = {
  BHS: "Bahamas", BRN: "Brunei", CIV: "Côte d'Ivoire", COD: "DR Congo", COG: "Congo", EGY: "Egypt",
  FSM: "Micronesia", GMB: "The Gambia", HKG: "Hong Kong", IRN: "Iran", KGZ: "Kyrgyzstan", KOR: "South Korea",
  LAO: "Laos", MAC: "Macao", NRU: "Nauru", PRI: "Puerto Rico", PRK: "North Korea", RUS: "Russia",
  SOM: "Somalia", SVK: "Slovakia", SYR: "Syria", TUR: "Türkiye", VEN: "Venezuela", VNM: "Vietnam",
  YEM: "Yemen", PSE: "Palestine", KNA: "Saint Kitts and Nevis", LCA: "Saint Lucia",
  VCT: "Saint Vincent and the Grenadines", MAF: "Saint Martin", VIR: "US Virgin Islands",
};
const HH = "PA.NUS.PRVT.PP"; // PPP, household final consumption (LCU per intl $)
const GDP = "PA.NUS.PPP"; // PPP, GDP (LCU per intl $)
const FX = "PA.NUS.FCRF"; // official exchange rate, LCU per USD, annual average

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Latest non-empty value per country, plus every yearly value since `from`.
async function indicator(id, from = null) {
  const range = from ? `date=${from}:2100&per_page=20000` : "mrnev=1&per_page=1000";
  const [meta, rows] = await json(`${WB}/country/all/indicator/${id}?format=json&${range}`);
  const byIso = new Map();
  const years = new Map();
  for (const r of rows) {
    if (r.value == null) continue;
    const v = { value: r.value, year: r.date };
    const prev = byIso.get(r.countryiso3code);
    if (!prev || Number(r.date) > Number(prev.year)) byIso.set(r.countryiso3code, v);
    if (!years.has(r.countryiso3code)) years.set(r.countryiso3code, new Map());
    years.get(r.countryiso3code).set(r.date, v);
  }
  return { lastUpdated: meta.lastupdated, name: rows[0].indicator.value, byIso, years };
}

const [[, countryRows], hh, gdp, fx, ecb] = await Promise.all([
  json(`${WB}/country?format=json&per_page=400`),
  indicator(HH),
  indicator(GDP),
  indicator(FX, 2005),
  json("https://api.frankfurter.dev/v1/latest?base=USD"),
]);

const problems = [];
const countries = [];
for (const c of countryRows) {
  if (c.region.id === "NA") continue; // aggregates like "World", "Euro area"
  const h = hh.byIso.get(c.id);
  const g = gdp.byIso.get(c.id);
  // Prefer household consumption PPP (closest to what a traveller buys) unless
  // the GDP series has a more recent year.
  let ppp = null;
  if (h && (!g || Number(h.year) >= Number(g.year))) ppp = { ...h, indicator: HH };
  else if (g) ppp = { ...g, indicator: GDP };

  const map = CURRENCY[c.id];
  // Annual exchange rate from the PPP reference year, so the two are comparable.
  const wbFx = (ppp && fx.years.get(c.id)?.get(ppp.year)) ?? fx.byIso.get(c.id) ?? null;
  let fxSource = { kind: "wb" };
  if (map?.anchor) {
    fxSource = { kind: "ecb", anchor: map.anchor, factor: map.factor ?? 1, note: map.note ?? null };
    // Guard against mapping mistakes: today's implied rate must be within reach of
    // the World Bank's annual average, unless the mapping explains why not.
    const anchorRate = map.anchor === "USD" ? 1 : ecb.rates[map.anchor];
    if (anchorRate == null) problems.push(`${c.id}: ECB has no ${map.anchor}`);
    else if (wbFx && !map.skipCheck) {
      const r = (anchorRate * fxSource.factor) / wbFx.value;
      if (r < 0.6 || r > 1.6) problems.push(`${c.id}: today's ${map.code} rate is ${r.toFixed(2)}× the WB ${wbFx.year} average — check mapping`);
    }
  }

  countries.push({
    iso3: c.id,
    iso2: c.iso2Code,
    name: NAMES[c.id] ?? c.name,
    wbName: c.name,
    region: c.region.value.trim(),
    currency: map?.code ?? null,
    ppp,
    wbFx,
    fx: fxSource,
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const out = {
  sources: {
    [HH]: { name: hh.name, lastUpdated: hh.lastUpdated, url: `https://data.worldbank.org/indicator/${HH}` },
    [GDP]: { name: gdp.name, lastUpdated: gdp.lastUpdated, url: `https://data.worldbank.org/indicator/${GDP}` },
    [FX]: { name: fx.name, lastUpdated: fx.lastUpdated, url: `https://data.worldbank.org/indicator/${FX}` },
  },
  countries,
};
await writeFile(new URL("../data/countries.json", import.meta.url), JSON.stringify(out, null, 1));
await writeFile(new URL("../data/fx-snapshot.json", import.meta.url), JSON.stringify(ecb));
const live = countries.filter((c) => c.fx.kind === "ecb").length;
console.log(`${countries.length} countries, ${countries.filter((c) => c.ppp).length} with PPP, ${live} on ECB rates (snapshot ${ecb.date})`);
