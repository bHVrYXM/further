// Country (ISO 3166 alpha-3) → the currency the World Bank's LCU figures are in.
// Where that currency is quoted by the ECB, or legally/de facto fixed to one that is,
// `anchor` + `factor` turn today's ECB rate (per USD) into LCU per USD.

const CODES = `
ABW AWG AFG AFN AGO AOA ALB ALL AND EUR ARE AED ARG ARS ARM AMD ASM USD ATG XCD AUS AUD AUT EUR AZE AZN
BDI BIF BEL EUR BEN XOF BFA XOF BGD BDT BGR BGN BHR BHD BHS BSD BIH BAM BLR BYN BLZ BZD BMU BMD BOL BOB
BRA BRL BRB BBD BRN BND BTN BTN BWA BWP CAF XAF CAN CAD CHE CHF CHI GBP CHL CLP CHN CNY CIV XOF CMR XAF
COD CDF COG XAF COL COP COM KMF CPV CVE CRI CRC CUB CUP CUW ANG CYM KYD CYP EUR CZE CZK DEU EUR DJI DJF
DMA XCD DNK DKK DOM DOP DZA DZD ECU USD EGY EGP ERI ERN ESP EUR EST EUR ETH ETB FIN EUR FJI FJD FRA EUR
FRO DKK FSM USD GAB XAF GBR GBP GEO GEL GHA GHS GIB GIP GIN GNF GMB GMD GNB XOF GNQ XAF GRC EUR GRD XCD
GRL DKK GTM GTQ GUM USD GUY GYD HKG HKD HND HNL HRV EUR HTI HTG HUN HUF IDN IDR IMN GBP IND INR IRL EUR
IRN IRR IRQ IQD ISL ISK ISR ILS ITA EUR JAM JMD JOR JOD JPN JPY KAZ KZT KEN KES KGZ KGS KHM KHR KIR AUD
KNA XCD KOR KRW KWT KWD LAO LAK LBN LBP LBR LRD LBY LYD LCA XCD LIE CHF LKA LKR LSO LSL LTU EUR LUX EUR
LVA EUR MAC MOP MAF EUR MAR MAD MCO EUR MDA MDL MDG MGA MDV MVR MEX MXN MHL USD MKD MKD MLI XOF MLT EUR
MMR MMK MNE EUR MNG MNT MNP USD MOZ MZN MRT MRU MUS MUR MWI MWK MYS MYR NAM NAD NCL XPF NER XOF NGA NGN
NIC NIO NLD EUR NOR NOK NPL NPR NRU AUD NZL NZD OMN OMR PAK PKR PAN PAB PER PEN PHL PHP PLW USD PNG PGK
POL PLN PRI USD PRK KPW PRT EUR PRY PYG PSE ILS PYF XPF QAT QAR ROU RON RUS RUB RWA RWF SAU SAR SDN SDG
SEN XOF SGP SGD SLB SBD SLE SLE SLV USD SMR EUR SOM SOS SRB RSD SSD SSP STP STN SUR SRD SVK EUR SVN EUR
SWE SEK SWZ SZL SXM ANG SYC SCR SYR SYP TCA USD TCD XAF TGO XOF THA THB TJK TJS TKM TMT TLS USD TON TOP
TTO TTD TUN TND TUR TRY TUV AUD TZA TZS UGA UGX UKR UAH URY UYU USA USD UZB UZS VCT XCD VEN VES VGB USD
VIR USD VNM VND VUT VUV WSM WST XKX EUR YEM YER ZAF ZAR ZMB ZMW ZWE ZWG
`.trim().split(/\s+/);

// Currencies the ECB publishes (Frankfurter, base USD) map to themselves.
const ECB = "AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDN IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY ZAR".split(" ");

// Fixed pegs. EUR conversion rates are legal (euro changeover / CFA franc / ERM);
// USD and other pegs are long-standing currency-board or central-bank pegs.
const PEGS = {
  USD: { anchor: "USD", factor: 1 },
  PAB: { anchor: "USD", factor: 1, note: "Balboa is at par with the US dollar" },
  BMD: { anchor: "USD", factor: 1, note: "Pegged 1:1 to USD" },
  BSD: { anchor: "USD", factor: 1, note: "Pegged 1:1 to USD" },
  BBD: { anchor: "USD", factor: 2, note: "Pegged at 2 per USD" },
  BZD: { anchor: "USD", factor: 2, note: "Pegged at 2 per USD" },
  XCD: { anchor: "USD", factor: 2.7, note: "Pegged at 2.70 per USD" },
  AWG: { anchor: "USD", factor: 1.79, note: "Pegged at 1.79 per USD" },
  ANG: { anchor: "USD", factor: 1.79, note: "Pegged at 1.79 per USD" },
  KYD: { anchor: "USD", factor: 0.8333, note: "Pegged at 1.20 USD" },
  AED: { anchor: "USD", factor: 3.6725, note: "Pegged at 3.6725 per USD" },
  SAR: { anchor: "USD", factor: 3.75, note: "Pegged at 3.75 per USD" },
  QAR: { anchor: "USD", factor: 3.64, note: "Pegged at 3.64 per USD" },
  OMR: { anchor: "USD", factor: 0.3845, note: "Pegged at 0.3845 per USD" },
  BHD: { anchor: "USD", factor: 0.376, note: "Pegged at 0.376 per USD" },
  JOD: { anchor: "USD", factor: 0.709, note: "Pegged at 0.709 per USD" },
  DJF: { anchor: "USD", factor: 177.721, note: "Pegged at 177.721 per USD" },
  BGN: { anchor: "EUR", factor: 1.95583, note: "Lev figures converted at the fixed euro rate 1.95583" },
  BAM: { anchor: "EUR", factor: 1.95583, note: "Pegged at 1.95583 per EUR" },
  XOF: { anchor: "EUR", factor: 655.957, note: "CFA franc fixed at 655.957 per EUR" },
  XAF: { anchor: "EUR", factor: 655.957, note: "CFA franc fixed at 655.957 per EUR" },
  XPF: { anchor: "EUR", factor: 119.33174, note: "CFP franc fixed at 119.33 per EUR" },
  KMF: { anchor: "EUR", factor: 491.96775, note: "Fixed at 491.97 per EUR" },
  CVE: { anchor: "EUR", factor: 110.265, note: "Pegged at 110.265 per EUR" },
  STN: { anchor: "EUR", factor: 24.5, note: "Pegged at 24.5 per EUR" },
  LSL: { anchor: "ZAR", factor: 1, note: "At par with the rand" },
  NAD: { anchor: "ZAR", factor: 1, note: "At par with the rand" },
  SZL: { anchor: "ZAR", factor: 1, note: "At par with the rand" },
  BTN: { anchor: "INR", factor: 1, note: "At par with the Indian rupee" },
  NPR: { anchor: "INR", factor: 1.6, note: "Pegged at 1.6 per INR" },
  BND: { anchor: "SGD", factor: 1, note: "At par with the Singapore dollar" },
  MOP: { anchor: "HKD", factor: 1.03, note: "Pegged at 1.03 per HKD" },
};

// Country-level exceptions to the currency mapping above.
const OVERRIDES = {
  // World Bank publishes Liberia's PPP in USD (the economy is largely dollarised),
  // while its annual exchange rate series is in Liberian dollars.
  LBR: { code: "USD", anchor: "USD", factor: 1, note: "World Bank PPP for Liberia is stated in USD", skipCheck: true },
};

export const CURRENCY = {};
for (let i = 0; i < CODES.length; i += 2) {
  const [iso3, code] = [CODES[i], CODES[i + 1]];
  const live = ECB.includes(code) ? { anchor: code, factor: 1 } : PEGS[code];
  CURRENCY[iso3] = { code, ...live, ...OVERRIDES[iso3] };
}
