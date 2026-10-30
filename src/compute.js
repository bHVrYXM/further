// Pure ranking logic, shared by the browser app and scripts/verify.mjs.
// No DOM, no fetch — so it runs unchanged in a service worker or Node.

// Sanity bounds for a price level (PPP ÷ market rate, US = 1). Anything outside
// is a data artefact (redenominations, official rates far from the street rate).
export const PLI_MIN = 0.12;
export const PLI_MAX = 3;
// A fallback (annual) exchange rate is only usable if it is from the same year
// as the PPP figure, or one year off at most.
export const MAX_FALLBACK_YEAR_GAP = 1;
// Flag countries whose currency moved this much vs USD since the PPP year.
export const DRIFT_FLAG = 0.1;

// Local currency units per USD for a country, from today's ECB rates (base USD)
// when the currency is covered, otherwise from the World Bank annual average.
export function fxFor(country, ecb) {
  const s = country.fx;
  if (s.kind === "ecb" && ecb) {
    const anchor = s.anchor === "USD" ? 1 : ecb.rates[s.anchor];
    if (anchor != null) {
      return {
        value: anchor * s.factor,
        live: true,
        source: "ECB via Frankfurter",
        date: ecb.date,
        note: s.note,
      };
    }
  }
  if (country.wbFx) {
    return {
      value: country.wbFx.value,
      live: false,
      source: "World Bank PA.NUS.FCRF (annual average)",
      date: country.wbFx.year,
      note: null,
    };
  }
  return null;
}

// Price level index vs the United States for one country, or a reason it is excluded.
export function priceLevel(country, ecb) {
  if (!country.ppp) return { excluded: "No World Bank PPP data" };
  const fx = fxFor(country, ecb);
  if (!fx) return { excluded: "No exchange rate available" };
  if (!fx.live && Math.abs(Number(fx.date) - Number(country.ppp.year)) > MAX_FALLBACK_YEAR_GAP) {
    return {
      excluded: `Latest exchange rate (${fx.date}) does not match PPP year (${country.ppp.year})`,
      fx,
    };
  }
  const pli = country.ppp.value / fx.value;
  if (!(pli >= PLI_MIN && pli <= PLI_MAX)) {
    return { excluded: `Implausible price level (${pli.toFixed(2)}× US) — official rate likely unrepresentative`, fx, pli };
  }
  // How far the currency has moved vs USD since the PPP reference year.
  let drift = null;
  if (fx.live && country.wbFx && country.wbFx.year === country.ppp.year) {
    drift = fx.value / country.wbFx.value - 1;
  }
  return { pli, fx, drift };
}

// Rank every destination against a home country. ratio < 1 means cheaper than home.
export function rank(countries, homeIso3, ecb) {
  const levels = new Map(countries.map((c) => [c.iso3, priceLevel(c, ecb)]));
  const home = levels.get(homeIso3);
  if (!home || home.excluded) return { home: null, rows: [], excluded: [] };
  const rows = [];
  const excluded = [];
  for (const c of countries) {
    const l = levels.get(c.iso3);
    if (l.excluded) {
      if (c.ppp) excluded.push({ country: c, reason: l.excluded });
      continue;
    }
    const ratio = l.pli / home.pli;
    rows.push({ country: c, ...l, ratio, multiplier: 1 / ratio });
  }
  rows.sort((a, b) => a.ratio - b.ratio);
  rows.forEach((r, i) => (r.rank = i + 1));
  excluded.sort((a, b) => a.country.name.localeCompare(b.country.name));
  return { home: { country: countries.find((c) => c.iso3 === homeIso3), ...home }, rows, excluded };
}
