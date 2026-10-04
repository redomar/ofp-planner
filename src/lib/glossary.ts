/** One-line explanations for every label with a dotted underline. What it is, then why it matters. */
export const GLOSSARY = {
  out: "OUT: off-block, when the aircraft pushes back from the gate. Compare with the scheduled departure (STD), which is a gate time.",
  off: "OFF: wheels-up. Usually 10–25 minutes after OUT at a busy airport, depending on taxi and queue.",
  on: "ON: touchdown. Airlines don't publish it; the typical value comes from tracking data.",
  in: "IN: on-block at the arrival gate. Compare with the scheduled arrival (STA), which is a gate time.",
  scheduled: "Published timetable times (STD / STA). They are gate times, so they line up with OUT and IN, not with take-off and landing.",
  typical: "Median of real tracked flights in the snapshot period. Shows how the flight usually runs against its schedule.",
  callsign: "ATC callsign as filed. easyJet and others use alphanumeric callsigns (EJU54LH) that differ from the flight number, to avoid similar-sounding callsigns on frequency.",
  types: "ICAO aircraft type designators seen or scheduled on this flight, most common first. A20N = A320neo, A21N = A321neo, B38M = 737 MAX 8.",
  days: "Days of the week this flight operates in the snapshot period.",
  block: "Gate-to-gate time. Scheduled when the timetable has both times; observed from tracking otherwise; estimated from distance as a last resort.",
  distance: "Great-circle distance between the airports in nautical miles. The flown route is usually 5–15% longer.",
  weekly: "Departures per week on this route across the selected airlines.",
  std: "Scheduled time of departure (gate), UTC.",
  sta: "Scheduled time of arrival (gate), UTC.",
} as const;
