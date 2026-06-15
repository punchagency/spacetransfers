export const normalizeRegion = (region: string | undefined | null): "West" | "Midwest" | "South" | "Northeast" | null => {
  if (!region) return null;
  const r = String(region).trim().toLowerCase();
  if (!r) return null;
  if (["west", "westcoast", "west-coast", "west coast"].includes(r)) return "West";
  if (["midwest", "mid-west", "mid west"].includes(r)) return "Midwest";
  if (["northeast", "north-east", "north east"].includes(r)) return "Northeast";
  if (["south", "south-east", "southeast", "southwest", "south-west"].includes(r)) return "South";
  return null;
};

export const getRegionFromState = (
  state: string | undefined | null
): "West" | "Midwest" | "South" | "Northeast" | null => {
  if (!state) return null;
  const s = state.trim().toUpperCase();
  if (!s) return null;

  const west      = ["WA","OR","CA","NV","ID","MT","WY","UT","AZ","NM","CO","AK","HI"];
  const midwest   = ["ND","SD","NE","KS","MN","IA","MO","WI","IL","MI","IN","OH"];
  const south     = ["TX","OK","AR","LA","MS","AL","TN","KY","WV","VA","NC","SC","GA","FL","MD","DC","DE"];
  const northeast = ["PA","NY","VT","ME","NH","MA","RI","CT","NJ"];

  if (west.includes(s))      return "West";
  if (midwest.includes(s))   return "Midwest";
  if (south.includes(s))     return "South";
  if (northeast.includes(s)) return "Northeast";
  return null; // Not a recognised US state code — no region assigned
};

const STATE_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  AL: { lat: 32.806671, lon: -86.79113 },
  AK: { lat: 61.370716, lon: -152.404419 },
  AZ: { lat: 33.729759, lon: -111.431221 },
  AR: { lat: 34.969704, lon: -92.373123 },
  CA: { lat: 36.116203, lon: -119.681564 },
  CO: { lat: 39.059811, lon: -105.311104 },
  CT: { lat: 41.597782, lon: -72.755371 },
  DE: { lat: 39.318523, lon: -75.507141 },
  DC: { lat: 38.897438, lon: -77.026817 },
  FL: { lat: 27.766279, lon: -81.686783 },
  GA: { lat: 33.040619, lon: -83.643074 },
  HI: { lat: 21.094318, lon: -157.498337 },
  ID: { lat: 44.240459, lon: -114.478828 },
  IL: { lat: 40.349457, lon: -88.986137 },
  IN: { lat: 39.849426, lon: -86.258278 },
  IA: { lat: 42.011539, lon: -93.210526 },
  KS: { lat: 38.5266, lon: -96.726486 },
  KY: { lat: 37.66814, lon: -84.670067 },
  LA: { lat: 31.169546, lon: -91.867805 },
  ME: { lat: 44.693947, lon: -69.381927 },
  MD: { lat: 39.063946, lon: -76.802101 },
  MA: { lat: 42.230171, lon: -71.530106 },
  MI: { lat: 43.326618, lon: -84.536095 },
  MN: { lat: 45.694454, lon: -93.900192 },
  MS: { lat: 32.741646, lon: -89.678696 },
  MO: { lat: 38.456085, lon: -92.288368 },
  MT: { lat: 46.921925, lon: -110.454353 },
  NE: { lat: 41.12537, lon: -98.268082 },
  NV: { lat: 38.313515, lon: -117.055374 },
  NH: { lat: 43.452492, lon: -71.563896 },
  NJ: { lat: 40.298904, lon: -74.521011 },
  NM: { lat: 34.840515, lon: -106.248482 },
  NY: { lat: 42.165726, lon: -74.948051 },
  NC: { lat: 35.630066, lon: -79.806419 },
  ND: { lat: 47.528912, lon: -99.784012 },
  OH: { lat: 40.388783, lon: -82.764915 },
  OK: { lat: 35.565342, lon: -96.928917 },
  OR: { lat: 44.572021, lon: -122.070938 },
  PA: { lat: 40.590752, lon: -77.209755 },
  RI: { lat: 41.680893, lon: -71.51178 },
  SC: { lat: 33.856892, lon: -80.945007 },
  SD: { lat: 44.299782, lon: -99.438828 },
  TN: { lat: 35.747845, lon: -86.692345 },
  TX: { lat: 31.054487, lon: -97.563461 },
  UT: { lat: 40.150032, lon: -111.862434 },
  VT: { lat: 44.045876, lon: -72.710686 },
  VA: { lat: 37.769337, lon: -78.169968 },
  WA: { lat: 47.400902, lon: -121.490494 },
  WV: { lat: 38.491226, lon: -80.954453 },
  WI: { lat: 44.268543, lon: -89.616508 },
  WY: { lat: 42.755966, lon: -107.30249 }
};

export const getLatLngFromState = (state: string | undefined | null): { lat: number; lon: number } | null => {
  if (!state) return null;
  const s = String(state).trim().toUpperCase();
  return STATE_CENTROIDS[s] || null;
};

export const haversineMiles = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
};

// Geographic centers of each service region (used for coordinate-based assignment)
export const REGION_CENTROIDS: Record<"West" | "Midwest" | "South" | "Northeast", { lat: number; lon: number }> = {
  West:      { lat: 39.0,  lon: -115.5 },
  Midwest:   { lat: 41.5,  lon: -91.5  },
  South:     { lat: 33.0,  lon: -87.0  },
  Northeast: { lat: 42.5,  lon: -72.5  },
};

/**
 * Derive a service region from coordinates using nearest-centroid (haversine).
 * More accurate than state-name matching when the state code is unavailable.
 */
export const getRegionFromCoords = (
  lat: number,
  lng: number
): "West" | "Midwest" | "South" | "Northeast" => {
  const regions = Object.keys(REGION_CENTROIDS) as Array<"West" | "Midwest" | "South" | "Northeast">;
  let closest = regions[0];
  let minDist = Infinity;
  for (const r of regions) {
    const d = haversineMiles({ lat, lon: lng }, REGION_CENTROIDS[r]);
    if (d < minDist) { minDist = d; closest = r; }
  }
  return closest;
};
