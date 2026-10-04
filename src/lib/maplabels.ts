/** Map lettering: seas and oceans, countries, mountain ranges (anchor points in lon/lat). */

/** [name, lon, lat, font size px, letter-spacing em] */
export const SEAS: [string, number, number, number, number][] = [
  ["NORTH ATLANTIC OCEAN", -24, 46, 14, 0.3],
  ["Norwegian Sea", 3, 68, 12, 0.18],
  ["North Sea", 3.5, 56.3, 12, 0.18],
  ["Baltic Sea", 19.5, 57.6, 11, 0.18],
  ["Bay of Biscay", -5.5, 45.2, 11, 0.16],
  ["Mediterranean Sea", 17.5, 34.6, 13, 0.18],
  ["Black Sea", 34.5, 43.2, 12, 0.18],
  ["Caspian Sea", 50.6, 41.6, 11, 0.16],
  ["Red Sea", 38.5, 20.5, 11, 0.16],
  ["Persian Gulf", 51.5, 26.8, 11, 0.16],
  ["Aegean Sea", 25, 38.6, 10, 0.14],
  ["Tyrrhenian Sea", 12, 39.8, 10, 0.14],
];

/** [NAME, lon, lat] */
export const COUNTRIES: [string, number, number][] = [
  ["FRANCE", 2.5, 46.6],
  ["SPAIN", -3.7, 39.8],
  ["GERMANY", 10.3, 51.1],
  ["ITALY", 12.9, 43.2],
  ["NORWAY", 9, 61.6],
  ["SWEDEN", 15.8, 63],
  ["FINLAND", 26.5, 63.2],
  ["POLAND", 19.3, 52.1],
  ["UKRAINE", 31.5, 49.2],
  ["TURKEY", 35, 39],
  ["GREECE", 22, 39.6],
  ["EGYPT", 29.5, 26.5],
  ["LIBYA", 17, 27.5],
  ["ALGERIA", 3, 28.5],
  ["MOROCCO", -6.5, 31.6],
  ["SAUDI ARABIA", 44.5, 24],
  ["IRAN", 54, 32.5],
  ["IRAQ", 43.4, 33.2],
  ["RUSSIA", 44, 57.5],
  ["ROMANIA", 25, 45.9],
  ["ICELAND", -18.6, 64.8],
  ["IRELAND", -8, 53.1],
  ["PORTUGAL", -8.1, 39.4],
  ["UNITED KINGDOM", -2.6, 54.4],
];

/** [name, lon1, lat1, lon2, lat2]: set along the line between the two points. */
export const RANGES: [string, number, number, number, number][] = [
  ["Alps", 7, 45.9, 13.5, 46.9],
  ["Pyrenees", -1.5, 42.9, 2.6, 42.5],
  ["Atlas Mountains", -8, 30.6, 0, 34.2],
  ["Caucasus", 40.5, 43.6, 47.5, 41.7],
  ["Zagros Mountains", 45.8, 34.5, 53.5, 28.6],
  ["Carpathians", 22.5, 49.2, 26.2, 46.2],
  ["Scandinavian Mountains", 11, 62, 17.5, 67.8],
  ["Taurus Mountains", 30.5, 37, 36.5, 37.7],
  ["Apennines", 11, 44.3, 15.6, 40.8],
];
