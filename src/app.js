import { rank, DRIFT_FLAG } from "./compute.js";

const FRANKFURTER = "https://api.frankfurter.dev/v1/latest?base=USD";
const FX_CACHE_KEY = "further.fx";
const HOME_KEY = "further.home";

const $ = (id) => document.getElementById(id);
const state = { data: null, ecb: null, ecbOrigin: null, home: null, result: null };

// ---------- formatting ----------
const flag = (iso2) =>
  /^[A-Z]{2}$/.test(iso2) ? String.fromCodePoint(...[...iso2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "🏳️";
const sig = (n) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(n);
const pct = (n) => `${n > 0 ? "+" : "−"}${Math.abs(Math.round(n * 100))}%`;
const date = (d) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : String(d);
function money(amount, code) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${code ?? ""}`.trim();
  }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pppLabel = (c) => (c.ppp.indicator === "PA.NUS.PRVT.PP" ? "household consumption PPP" : "GDP PPP");

// ---------- data loading ----------
// Rates to render with straight away: the last live copy if it is newer than the bundled snapshot.
async function loadStoredEcb() {
  const snap = await fetch("data/fx-snapshot.json").then((r) => r.json());
  try {
    const cached = JSON.parse(localStorage.getItem(FX_CACHE_KEY));
    if (cached?.rates && cached.date >= snap.date) return { ecb: cached, origin: "cached" };
  } catch {}
  return { ecb: snap, origin: "bundled" };
}

// Today's rates. Times out so a stalled request (blocked or slow network) can't hold anything up.
async function loadLiveEcb() {
  const res = await fetch(FRANKFURTER, { cache: "no-cache", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ecb = await res.json();
  if (!ecb?.rates) throw new Error("unexpected response");
  try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify(ecb)); } catch {}
  return ecb;
}

function guessHome(countries) {
  const fromUrl = new URLSearchParams(location.search).get("home");
  let saved = null;
  try { saved = localStorage.getItem(HOME_KEY); } catch {}
  const iso2s = (navigator.languages ?? [navigator.language]).map((l) => l.split("-")[1]?.toUpperCase()).filter(Boolean);
  const fromLang = iso2s.map((i2) => countries.find((c) => c.iso2 === i2)?.iso3).find(Boolean);
  return [fromUrl, saved, fromLang, "USA"].find((iso) => iso && countries.some((c) => c.iso3 === iso));
}

// ---------- rendering ----------
function renderSources() {
  const { data, ecb, ecbOrigin } = state;
  const hh = data.sources["PA.NUS.PRVT.PP"];
  const stored = { cached: "last fetched copy", bundled: "bundled snapshot" }[ecbOrigin];
  const originText =
    ecbOrigin === "live" ? "live" : state.liveStatus === "loading" ? `${stored}, fetching today's…` : `offline, ${stored}`;
  const years = state.data.countries.filter((c) => c.ppp).map((c) => c.ppp.year);
  const mode = [...new Set(years)].sort((a, b) => years.filter((y) => y === b).length - years.filter((y) => y === a).length)[0];
  $("sources").innerHTML = `
    <div><span class="dot ${ecbOrigin === "live" ? "ok" : "warn"}"></span>
      <strong>Exchange rates</strong> ECB via <a href="https://frankfurter.dev">Frankfurter</a> · ${date(ecb.date)} <span class="muted">· ${originText}</span></div>
    <div><span class="dot ok"></span>
      <strong>Price levels</strong> <a href="${hh.url}">World Bank PPP</a> · mostly ${mode} <span class="muted">· WDI updated ${date(hh.lastUpdated)}</span></div>`;
}

function renderHomeHint() {
  const h = state.result.home;
  if (!h) return;
  const c = h.country;
  $("home-hint").innerHTML = `Your baseline: prices in ${esc(c.name)} are ${Math.round(h.pli * 100)}% of US levels
    — PPP ${sig(c.ppp.value)} ${esc(c.currency ?? "LCU")}/intl$ (World Bank ${c.ppp.year}),
    ${sig(h.fx.value)} ${esc(c.currency ?? "LCU")}/US$ (${h.fx.live ? `ECB ${date(h.fx.date)}` : `World Bank annual ${h.fx.date}`}).`;
}

function card(row, homeCur, maxMult) {
  const c = row.country;
  const isHome = c.iso3 === state.home;
  const cur = c.currency ?? "LCU";
  // What 100 home-currency units buy there, valued at home prices.
  const worth = money(100 * row.multiplier, homeCur);
  // Bar: what your money is worth there; full width = the best value on the list, marker = home (1×).
  const width = Math.min(row.multiplier / maxMult, 1) * 100;
  const homePos = 100 / maxMult;
  // Tint strength: 0 (as dear as home or more) … 1 (cheapest on the list)
  const t = row.multiplier > 1 ? Math.min(Math.log(row.multiplier) / Math.log(maxMult), 1) : 0;
  const tags = [];
  if (isHome) tags.push(`<span class="tag tag-home">Home</span>`);
  if (!row.fx.live) tags.push(`<span class="tag tag-annual" title="ECB does not quote ${esc(cur)}; using the World Bank ${row.fx.date} annual average">Annual rate ${row.fx.date}</span>`);
  if (row.drift != null && Math.abs(row.drift) >= DRIFT_FLAG)
    tags.push(`<span class="tag tag-drift" title="${esc(cur)} has moved ${pct(row.drift)} against USD since the ${c.ppp.year} average. Local prices have likely adjusted since, which PPP does not show yet.">${esc(cur)} ${pct(row.drift)} since ${c.ppp.year}</span>`);
  if (c.ppp.indicator !== "PA.NUS.PRVT.PP") tags.push(`<span class="tag" title="Household consumption PPP for ${c.ppp.year} not published; using GDP PPP">GDP PPP</span>`);

  return `<li class="card${isHome ? " is-home" : ""}" style="--t:${t.toFixed(3)}" data-iso3="${c.iso3}">
    <details>
      <summary>
        <span class="rank">${row.rank}</span>
        <span class="flag" aria-hidden="true">${flag(c.iso2)}</span>
        <span class="name">${esc(c.name)}</span>
        <span class="mult"><b>${row.multiplier >= 10 ? Math.round(row.multiplier) : row.multiplier.toFixed(1)}×</b><small>as far</small></span>
        <span class="bar" aria-hidden="true"><i style="width:${width}%"></i><em style="left:${homePos}%"></em></span>
        <span class="equiv">${money(100, homeCur)} from home is worth <b>${worth}</b> there</span>
        ${tags.length ? `<span class="tags">${tags.join("")}</span>` : ""}
        <span class="src">
          <span>PPP <b class="ppp-val" data-raw="${c.ppp.value}">${sig(c.ppp.value)}</b> ${esc(cur)}/intl$ · World Bank ${c.ppp.year}</span>
          <span>FX <b>${sig(row.fx.value)}</b> ${esc(cur)}/US$ · ${row.fx.live ? `ECB ${date(row.fx.date)}` : `World Bank avg ${row.fx.date}`}</span>
        </span>
      </summary>
      <dl class="detail">
        <dt>Price level</dt><dd>${Math.round(row.ratio * 100)}% of home · ${Math.round(row.pli * 100)}% of US</dd>
        <dt>PPP factor</dt><dd>${sig(c.ppp.value)} ${esc(cur)} per international $ — ${pppLabel(c)}, ${c.ppp.year}.
          <a href="https://data.worldbank.org/indicator/${c.ppp.indicator}?locations=${c.iso2}">World Bank ${c.ppp.indicator}</a></dd>
        <dt>Exchange rate</dt><dd>${sig(row.fx.value)} ${esc(cur)} per US$ — ${row.fx.live
          ? `ECB reference rate, ${date(row.fx.date)}${row.fx.note ? ` (${esc(row.fx.note)})` : ""}`
          : `World Bank PA.NUS.FCRF annual average ${row.fx.date} (ECB does not quote ${esc(cur)})`}</dd>
        ${c.wbFx && row.fx.live ? `<dt>${c.wbFx.year} average</dt><dd>${sig(c.wbFx.value)} ${esc(cur)}/US$ (World Bank) → price level ${Math.round((c.ppp.value / c.wbFx.value) * 100)}% of US at that year's rate</dd>` : ""}
        <dt>Formula</dt><dd>(${sig(c.ppp.value)} ÷ ${sig(row.fx.value)}) ÷ ${sig(state.result.home.pli)} home level = ${row.ratio.toFixed(3)}</dd>
      </dl>
    </details>
  </li>`;
}

function render() {
  const { result } = state;
  const q = $("q").value.trim().toLowerCase();
  const region = $("region").value;
  const liveOnly = $("liveOnly").checked;
  const sort = $("sort").value;
  let rows = result.rows.filter(
    (r) =>
      (!q || r.country.name.toLowerCase().includes(q) || r.country.wbName.toLowerCase().includes(q)) &&
      (!region || r.country.region === region) &&
      (!liveOnly || r.fx.live || r.country.iso3 === state.home)
  );
  if (sort === "dear") rows = [...rows].reverse();
  if (sort === "name") rows = [...rows].sort((a, b) => a.country.name.localeCompare(b.country.name));
  const homeCur = result.home.country.currency ?? "USD";
  const maxMult = Math.max(2, result.rows[0]?.multiplier ?? 2);
  $("list").innerHTML = rows.map((r) => card(r, homeCur, maxMult)).join("");
  const cheaper = result.rows.filter((r) => r.ratio < 1).length;
  $("count").textContent = `${cheaper} of ${result.rows.length} countries are cheaper than ${result.home.country.name}` +
    (rows.length !== result.rows.length ? ` · showing ${rows.length}` : "");
}

function renderExcluded() {
  const ex = state.result.excluded;
  $("excluded").innerHTML = ex.length
    ? `<details><summary>${ex.length} countries not ranked — why?</summary><ul>${ex
        .map((e) => `<li>${flag(e.country.iso2)} <b>${esc(e.country.name)}</b>: ${esc(e.reason)}</li>`)
        .join("")}</ul></details>`
    : "";
}

function update() {
  state.result = rank(state.data.countries, state.home, state.ecb);
  renderHomeHint();
  render();
  renderExcluded();
}

// ---------- boot ----------
async function main() {
  // Render from bundled/cached data first; live rates replace them when (if) they arrive.
  const live = loadLiveEcb();
  live.catch(() => {}); // handled below; avoids an "unhandled rejection" if it fails early
  state.liveStatus = "loading";
  const [data, { ecb, origin }] = await Promise.all([fetch("data/countries.json").then((r) => r.json()), loadStoredEcb()]);
  Object.assign(state, { data, ecb, ecbOrigin: origin });

  // Only countries that can be ranked can be home.
  const rankable = new Set(rank(data.countries, "USA", ecb).rows.map((r) => r.country.iso3));
  const homes = data.countries.filter((c) => rankable.has(c.iso3)).sort((a, b) => a.name.localeCompare(b.name));
  $("home").innerHTML = homes.map((c) => `<option value="${c.iso3}">${flag(c.iso2)} ${esc(c.name)}</option>`).join("");
  const regions = [...new Set(homes.map((c) => c.region))].sort();
  $("region").insertAdjacentHTML("beforeend", regions.map((r) => `<option>${esc(r)}</option>`).join(""));

  state.home = guessHome(homes);
  $("home").value = state.home;
  $("home").addEventListener("change", (e) => {
    state.home = e.target.value;
    try { localStorage.setItem(HOME_KEY, state.home); } catch {}
    const url = new URL(location.href);
    url.searchParams.set("home", state.home);
    history.replaceState(null, "", url);
    update();
  });
  for (const id of ["q", "region", "sort", "liveOnly"]) $(id).addEventListener("input", render);

  renderSources();
  update();

  try {
    Object.assign(state, { ecb: await live, ecbOrigin: "live" });
    update();
  } catch (err) {
    console.warn("Live exchange rates unavailable, using stored rates:", err.message);
  }
  state.liveStatus = "done";
  renderSources();
}

main().catch((err) => {
  const msg = `Could not load data: ${esc(err.message)}`;
  $("home").innerHTML = `<option>Unavailable</option>`;
  $("home-hint").innerHTML = msg;
  $("list").innerHTML = `<li class="error">${msg}</li>`;
});
