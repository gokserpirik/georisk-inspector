const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

// Risk model covers the Netherlands only (RD New projection, PDOK, Bodemkaart).
export const NL_BBOX = { minLat: 50.75, maxLat: 53.7, minLng: 3.2, maxLng: 7.22 }

export function isInNetherlands(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= NL_BBOX.minLat &&
    lat <= NL_BBOX.maxLat &&
    lng >= NL_BBOX.minLng &&
    lng <= NL_BBOX.maxLng
  )
}

/** Parse a "lat, lng" string. Returns { lat, lng } or null. */
export function parseLatLng(input) {
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export async function searchPlaces(query, signal) {
  const res = await fetch(
    `${NOMINATIM_URL}?format=jsonv2&limit=5&countrycodes=nl&q=${encodeURIComponent(query)}`,
    { signal, headers: { Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const items = await res.json()
  return items.map((it) => ({
    label: it.display_name,
    lat: Number(it.lat),
    lng: Number(it.lon),
  }))
}
