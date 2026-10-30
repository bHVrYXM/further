// Checks every figure the app shows against the live World Bank API.
// Run: node scripts/verify.mjs   (exit code 1 on any failure)
import { readFile } from "node:fs/promises";
import { rank } from "../src/compute.js";

const PPP_TOL = 1e-4; // ±0.01% — PPP factors must equal the World Bank value
const PLI_TOL = 1e-3; // ±0.1% — price levels recomputed independently
const WB = "https://api.worldbank.org/v2";

const data = JSON.parse(await readFile(new URL("../data/countries.json", import.meta.url)));
const ecb = await fetch("https://api.frankfurter.dev/v1/latest?base=USD").then((r) => r.json());

async function series(id, years) {
  const rows = (await fetch(`${WB}/country/all/indicator/${id}?format=json&date=${years}&per_page=20000`).then((r) => r.json()))[1];
  const m = new Map();
  for (const r of rows) if (r.value != null) m.set(`${r.countryiso3code}:${r.date}`, r.value);
  return m;
}
const live = {
  "PA.NUS.PRVT.PP": await series("PA.NUS.PRVT.PP", "2005:2100"),
  "PA.NUS.PPP": await series("PA.NUS.PPP", "2005:2100"),
  "PA.NUS.FCRF": await series("PA.NUS.FCRF", "2005:2100"),
};

const fails = [];
const display = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }); // same as the app
const rel = (a, b) => Math.abs(a / b - 1);

// 1. Every PPP factor in the snapshot, and as displayed, matches the World Bank.
let pppChecked = 0;
let worstPpp = 0;
for (const c of data.countries) {
  if (!c.ppp) continue;
  const wb = live[c.ppp.indicator].get(`${c.iso3}:${c.ppp.year}`);
  if (wb == null) { fails.push(`${c.iso3}: ${c.ppp.indicator} ${c.ppp.year} missing from live API`); continue; }
  const shown = Number(display.format(c.ppp.value).replace(/,/g, ""));
  const err = Math.max(rel(c.ppp.value, wb), rel(shown, wb));
  worstPpp = Math.max(worstPpp, err);
  pppChecked++;
  if (err > PPP_TOL) fails.push(`${c.iso3}: PPP ${shown} vs World Bank ${wb} (${(err * 100).toFixed(4)}%)`);
}

// 2. Price levels: recompute from raw API values + today's ECB rates, compare to the app's logic.
const { rows } = rank(data.countries, "USA", ecb);
let pliChecked = 0;
let worstPli = 0;
for (const r of rows) {
  const c = r.country;
  const ppp = live[c.ppp.indicator].get(`${c.iso3}:${c.ppp.year}`);
  let fx;
  if (r.fx.live) fx = (c.fx.anchor === "USD" ? 1 : ecb.rates[c.fx.anchor]) * c.fx.factor;
  else fx = live["PA.NUS.FCRF"].get(`${c.iso3}:${r.fx.date}`);
  if (ppp == null || fx == null) { fails.push(`${c.iso3}: cannot recompute (ppp ${ppp}, fx ${fx})`); continue; }
  const err = rel(r.pli, ppp / fx);
  worstPli = Math.max(worstPli, err);
  pliChecked++;
  if (err > PLI_TOL) fails.push(`${c.iso3}: price level ${r.pli} vs recomputed ${ppp / fx}`);
  // 3. Source and date are present for every number on the card.
  if (!c.ppp.year || !c.ppp.indicator || !r.fx.source || !r.fx.date) fails.push(`${c.iso3}: missing source/date`);
}

console.log(`PPP factors: ${pppChecked} checked, worst deviation ${(worstPpp * 100).toFixed(5)}% (tolerance ${PPP_TOL * 100}%)`);
console.log(`Price levels: ${pliChecked} checked, worst deviation ${(worstPli * 100).toFixed(5)}% (tolerance ${PLI_TOL * 100}%), ECB ${ecb.date}`);
if (fails.length) {
  console.error(`\n${fails.length} failure(s):\n` + fails.join("\n"));
  process.exit(1);
}
console.log("All checks passed.");
