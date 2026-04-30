function dmsToDec(deg, min, sec, hemi) {
  const d = parseFloat(deg);
  if (!Number.isFinite(d)) return NaN;
  const m = parseFloat(min);
  const sm = Number.isFinite(m) ? m : 0;
  const secVal = parseFloat(sec);
  const s = Number.isFinite(secVal) ? secVal : 0;
  let v = d + sm / 60 + s / 3600;
  const h = String(hemi || "").toUpperCase();
  if (h === "S" || h === "W") v = -v;
  return v;
}

function normalizeCoordinateText(raw) {
  return String(raw || "")
    .trim()
    .replace(/Â°/g, "°")
    .replace(/\u00b0/g, "°")
    .replace(/[â€²’′]/g, "'")
    .replace(/[â€³”“″]/g, '"')
    .replace(/\s+/g, " ");
}

/**
 * Parse latitude/longitude from free text.
 * Supports: "44.43, 26.10" (lat, lon), "45°05'59.3\"N 24°22'56.2\"E", or two decimal numbers.
 */
function parseLatLon(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = normalizeCoordinateText(raw);
  if (!s) return null;

  const dms = s.match(
    /([\d.]+)[^0-9A-Za-z]+([\d.]+)[^0-9A-Za-z]+([\d.]+)?[^0-9A-Za-z]*([NSns])\s+([\d.]+)[^0-9A-Za-z]+([\d.]+)[^0-9A-Za-z]+([\d.]+)?[^0-9A-Za-z]*([EWew])/,
  );
  if (dms) {
    const lat = dmsToDec(dms[1], dms[2], dms[3] || "0", dms[4]);
    const lon = dmsToDec(dms[5], dms[6], dms[7] || "0", dms[8]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  const commaDec = s.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (commaDec) {
    const a = parseFloat(commaDec[1]);
    const b = parseFloat(commaDec[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      return { lat: a, lon: b };
    }
  }

  const nums = s.match(/-?\d+(?:\.\d+)?/g);
  if (nums && nums.length >= 2) {
    const a = parseFloat(nums[0]);
    const b = parseFloat(nums[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      return { lat: a, lon: b };
    }
  }

  return null;
}

module.exports = { parseLatLon };
