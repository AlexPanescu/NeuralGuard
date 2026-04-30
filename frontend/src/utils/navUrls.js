/** Google Maps / Waze deep links (lat, lon in WGS84). */
export function googleMapsUrl(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "#";
  return `https://www.google.com/maps/dir/?api=1&destination=${a},${b}`;
}

export function wazeNavigateUrl(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "#";
  return `https://waze.com/ul?ll=${encodeURIComponent(`${a},${b}`)}&navigate=yes`;
}
