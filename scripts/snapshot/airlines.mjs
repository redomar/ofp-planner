// Airline brands included in the snapshot. One brand = one public/data/airlines/<icao>.json.
//
// operators: ICAO prefixes of the callsigns flown under this brand (the first one is the
//            brand's own). A leg is attributed to the brand whose operator list holds its
//            callsign prefix.
// numericFn: when true, a purely numeric callsign ("EZY1114") is taken as the marketing
//            flight number ("1114"). ICAO Doc 8585 callsigns are built from the flight
//            number unless the airline uses alphanumeric callsigns, and the airlines below
//            that do (easyJet, Ryanair, BA, Wizz…) still file numeric callsigns as the
//            flight number when they're not swapped for ATC reasons. Set false where that's
//            known not to hold.
// colors:    brand colours (hex) from each airline's livery/brand guidelines; primary draws
//            the route line, secondary is trim. Approximate where the brand uses gradients.
// timetable: an optional public timetable source used to add flight numbers and STD/STA.

export const AIRLINES = [
  // ---- low-cost / leisure -------------------------------------------------------------
  { icao: "EZY", iata: "U2", name: "easyJet", callsign: "EASY", country: "GB", operators: ["EZY", "EJU", "EZS"], colors: ["#FF6600", "#FFFFFF"], numericFn: true },
  { icao: "RYR", iata: "FR", name: "Ryanair", callsign: "RYANAIR", country: "IE", operators: ["RYR", "RUK", "MAY", "LDM", "RYS"], colors: ["#073590", "#F1C933"], numericFn: true, timetable: "ryanair" },
  { icao: "WZZ", iata: "W6", name: "Wizz Air", callsign: "WIZZ AIR", country: "HU", operators: ["WZZ", "WUK", "WMT"], colors: ["#C6007E", "#2E2C7D"], numericFn: true },
  { icao: "VLG", iata: "VY", name: "Vueling", callsign: "VUELING", country: "ES", operators: ["VLG"], colors: ["#FFCC00", "#4D4D4F"], numericFn: true },
  { icao: "EXS", iata: "LS", name: "Jet2", callsign: "CHANNEX", country: "GB", operators: ["EXS"], colors: ["#E41E26", "#203A72"], numericFn: true },
  { icao: "TOM", iata: "BY", name: "TUI", callsign: "TOMSON", country: "GB", operators: ["TOM", "TUI", "JAF", "TFL", "BLX"], colors: ["#70CBF4", "#D40E14"], numericFn: true },
  { icao: "EWG", iata: "EW", name: "Eurowings", callsign: "EUROWINGS", country: "DE", operators: ["EWG", "EWE", "EWL"], colors: ["#A3195B", "#FFC800"], numericFn: true },
  { icao: "TRA", iata: "HV", name: "Transavia", callsign: "TRANSAVIA", country: "NL", operators: ["TRA", "TVF"], colors: ["#00D66C", "#203A79"], numericFn: true },
  { icao: "VOE", iata: "V7", name: "Volotea", callsign: "VOLOTEA", country: "ES", operators: ["VOE"], colors: ["#C2006B", "#24135F"], numericFn: true },
  { icao: "NOZ", iata: "DY", name: "Norwegian", callsign: "NORSHUTTLE", country: "NO", operators: ["NOZ", "NSZ", "IBK", "NAX"], colors: ["#D81939", "#003251"], numericFn: true },
  { icao: "PGT", iata: "PC", name: "Pegasus", callsign: "SUNTURK", country: "TR", operators: ["PGT"], colors: ["#FDB813", "#E31E24"], numericFn: true },
  { icao: "TKJ", iata: "VF", name: "AJet", callsign: "ANATOLIAN", country: "TR", operators: ["TKJ"], colors: ["#E30A17", "#1C1C1C"], numericFn: true },
  { icao: "SXS", iata: "XQ", name: "SunExpress", callsign: "SUNEXPRESS", country: "TR", operators: ["SXS"], colors: ["#F7A800", "#C8102E"], numericFn: true },
  { icao: "CFG", iata: "DE", name: "Condor", callsign: "CONDOR", country: "DE", operators: ["CFG", "CIB"], colors: ["#FDC300", "#1D1D1B"], numericFn: true },
  { icao: "CAI", iata: "XC", name: "Corendon", callsign: "CORENDON", country: "TR", operators: ["CAI", "CND", "CXI"], colors: ["#E3003A", "#002F6C"], numericFn: true },
  { icao: "TVS", iata: "QS", name: "Smartwings", callsign: "SKYTRAVEL", country: "CZ", operators: ["TVS", "TVP", "TVQ"], colors: ["#0A3D8F", "#E2001A"], numericFn: true },
  { icao: "ABY", iata: "G9", name: "Air Arabia", callsign: "ARABIA", country: "AE", operators: ["ABY", "MAC", "ABN"], colors: ["#E21A23", "#6D6E71"], numericFn: true },
  { icao: "FDB", iata: "FZ", name: "flydubai", callsign: "SKYDUBAI", country: "AE", operators: ["FDB"], colors: ["#003D73", "#F26E22"], numericFn: true },
  // ---- network carriers -----------------------------------------------------------------
  { icao: "BAW", iata: "BA", name: "British Airways", callsign: "SPEEDBIRD", country: "GB", operators: ["BAW", "CFE", "EFW"], colors: ["#075AAA", "#EB2226"], numericFn: true },
  { icao: "IBE", iata: "IB", name: "Iberia", callsign: "IBERIA", country: "ES", operators: ["IBE", "IBS"], colors: ["#D7192D", "#FFCC00"], numericFn: true },
  { icao: "EIN", iata: "EI", name: "Aer Lingus", callsign: "SHAMROCK", country: "IE", operators: ["EIN", "EUK"], colors: ["#006272", "#78BE20"], numericFn: true },
  { icao: "DLH", iata: "LH", name: "Lufthansa", callsign: "LUFTHANSA", country: "DE", operators: ["DLH", "CLH", "LHX", "DLA"], colors: ["#05164D", "#F9BA00"], numericFn: true },
  { icao: "SWR", iata: "LX", name: "SWISS", callsign: "SWISS", country: "CH", operators: ["SWR"], colors: ["#E2001A", "#1A1A1A"], numericFn: true },
  { icao: "AUA", iata: "OS", name: "Austrian", callsign: "AUSTRIAN", country: "AT", operators: ["AUA"], colors: ["#D81E05", "#1A1A1A"], numericFn: true },
  { icao: "BEL", iata: "SN", name: "Brussels Airlines", callsign: "BEELINE", country: "BE", operators: ["BEL"], colors: ["#00235F", "#E3003C"], numericFn: true },
  { icao: "KLM", iata: "KL", name: "KLM", callsign: "KLM", country: "NL", operators: ["KLM", "KLC"], colors: ["#00A1DE", "#003145"], numericFn: true },
  { icao: "AFR", iata: "AF", name: "Air France", callsign: "AIRFRANS", country: "FR", operators: ["AFR", "HOP"], colors: ["#002157", "#E40521"], numericFn: true },
  { icao: "SAS", iata: "SK", name: "SAS", callsign: "SCANDINAVIAN", country: "SE", operators: ["SAS", "SZS", "CIR"], colors: ["#000DB5", "#6E7681"], numericFn: true },
  { icao: "TAP", iata: "TP", name: "TAP Air Portugal", callsign: "AIR PORTUGAL", country: "PT", operators: ["TAP", "PGA"], colors: ["#ED1C24", "#00A651"], numericFn: true },
  { icao: "ITY", iata: "AZ", name: "ITA Airways", callsign: "ITARROW", country: "IT", operators: ["ITY"], colors: ["#00296B", "#B4975A"], numericFn: true },
  { icao: "AEE", iata: "A3", name: "Aegean", callsign: "AEGEAN", country: "GR", operators: ["AEE", "OAL"], colors: ["#1D3D7A", "#8FB8DE"], numericFn: true },
  { icao: "LOT", iata: "LO", name: "LOT Polish Airlines", callsign: "POLLOT", country: "PL", operators: ["LOT"], colors: ["#003D7D", "#9FA0A3"], numericFn: true },
  { icao: "FIN", iata: "AY", name: "Finnair", callsign: "FINNAIR", country: "FI", operators: ["FIN"], colors: ["#0B1560", "#B3B9D6"], numericFn: true },
  { icao: "BTI", iata: "BT", name: "airBaltic", callsign: "AIRBALTIC", country: "LV", operators: ["BTI"], colors: ["#BED600", "#1A1A1A"], numericFn: true },
  { icao: "ICE", iata: "FI", name: "Icelandair", callsign: "ICEAIR", country: "IS", operators: ["ICE"], colors: ["#0D2C6C", "#FFB71B"], numericFn: true },
  { icao: "AEA", iata: "UX", name: "Air Europa", callsign: "EUROPA", country: "ES", operators: ["AEA"], colors: ["#0A2C79", "#B5975A"], numericFn: true },
  { icao: "CTN", iata: "OU", name: "Croatia Airlines", callsign: "CROATIA", country: "HR", operators: ["CTN"], colors: ["#003F87", "#E30613"], numericFn: true },
  { icao: "ASL", iata: "JU", name: "Air Serbia", callsign: "AIR SERBIA", country: "RS", operators: ["ASL"], colors: ["#0D2D6C", "#C8102E"], numericFn: true },
  { icao: "LGL", iata: "LG", name: "Luxair", callsign: "LUXAIR", country: "LU", operators: ["LGL"], colors: ["#00A1DE", "#2B2A29"], numericFn: true },
  { icao: "KMM", iata: "KM", name: "KM Malta Airlines", callsign: "MALTA", country: "MT", operators: ["KMM"], colors: ["#D21034", "#1A1A1A"], numericFn: true },
  { icao: "LOG", iata: "LM", name: "Loganair", callsign: "LOGAN", country: "GB", operators: ["LOG"], colors: ["#003863", "#E4002B"], numericFn: true },
  { icao: "WIF", iata: "WF", name: "Widerøe", callsign: "WIDEROE", country: "NO", operators: ["WIF"], colors: ["#2B6FB0", "#7CC4E8"], numericFn: true },
  { icao: "IBB", iata: "NT", name: "Binter", callsign: "BINTER", country: "ES", operators: ["IBB"], colors: ["#00843D", "#004B87"], numericFn: true },
  // ---- Turkey, Middle East, North Africa --------------------------------------------------
  { icao: "THY", iata: "TK", name: "Turkish Airlines", callsign: "TURKISH", country: "TR", operators: ["THY"], colors: ["#C70A0C", "#1A1A1A"], numericFn: true },
  { icao: "UAE", iata: "EK", name: "Emirates", callsign: "EMIRATES", country: "AE", operators: ["UAE"], colors: ["#D71921", "#B79A5B"], numericFn: true },
  { icao: "QTR", iata: "QR", name: "Qatar Airways", callsign: "QATARI", country: "QA", operators: ["QTR"], colors: ["#5C0632", "#A7A9AC"], numericFn: true },
  { icao: "ETD", iata: "EY", name: "Etihad", callsign: "ETIHAD", country: "AE", operators: ["ETD"], colors: ["#BD8B13", "#4B4B4B"], numericFn: true },
  { icao: "GFA", iata: "GF", name: "Gulf Air", callsign: "GULF AIR", country: "BH", operators: ["GFA"], colors: ["#B48A3C", "#5C2D91"], numericFn: true },
  { icao: "OMA", iata: "WY", name: "Oman Air", callsign: "OMAN AIR", country: "OM", operators: ["OMA"], colors: ["#A7804F", "#00505C"], numericFn: true },
  { icao: "SVA", iata: "SV", name: "Saudia", callsign: "SAUDIA", country: "SA", operators: ["SVA"], colors: ["#006C35", "#C5A572"], numericFn: true },
  { icao: "RJA", iata: "RJ", name: "Royal Jordanian", callsign: "JORDANIAN", country: "JO", operators: ["RJA"], colors: ["#A4855C", "#1A1A1A"], numericFn: true },
  { icao: "MEA", iata: "ME", name: "Middle East Airlines", callsign: "CEDAR JET", country: "LB", operators: ["MEA"], colors: ["#00843D", "#C8102E"], numericFn: true },
  { icao: "ELY", iata: "LY", name: "El Al", callsign: "ELAL", country: "IL", operators: ["ELY"], colors: ["#0E2A72", "#8DA2C8"], numericFn: true },
  { icao: "MSR", iata: "MS", name: "EgyptAir", callsign: "EGYPTAIR", country: "EG", operators: ["MSR"], colors: ["#1F3463", "#C9A04B"], numericFn: true },
  { icao: "RAM", iata: "AT", name: "Royal Air Maroc", callsign: "ROYALAIR MAROC", country: "MA", operators: ["RAM"], colors: ["#C1272D", "#006233"], numericFn: true },
  { icao: "TAR", iata: "TU", name: "Tunisair", callsign: "TUNAIR", country: "TN", operators: ["TAR"], colors: ["#E3001B", "#1A1A1A"], numericFn: true },
  { icao: "DAH", iata: "AH", name: "Air Algérie", callsign: "AIR ALGERIE", country: "DZ", operators: ["DAH"], colors: ["#E2001A", "#006233"], numericFn: true },
];

/** ISO-2 countries treated as the Europe / EMEA short-haul region (both ends must be in it). */
export const REGION = new Set(
  (
    // Europe (incl. microstates, Faroe, Gibraltar, Svalbard) and the Atlantic islands via PT/ES
    "AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK " +
    // Caucasus and Turkey
    "AM AZ GE TR " +
    // Middle East
    "AE BH IL IQ IR JO KW LB OM PS QA SA SY YE " +
    // North Africa and Cape Verde
    "DZ EG LY MA TN EH CV"
  ).split(" "),
);

/** Bounding box (lat/lon) of the region, used to drop ADS-B points early. */
export const BBOX = { latMin: 10, latMax: 75, lonMin: -32, lonMax: 64 };

const byOp = new Map();
for (const a of AIRLINES) for (const op of a.operators) byOp.set(op, a);
/** Brand for a callsign's 3-letter operator prefix, or undefined. */
export const brandForOperator = (op) => byOp.get(op);
