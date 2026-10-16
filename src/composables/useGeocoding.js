const LOCATIESERVER = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1'

// Locations relevant to this tool: addresses, places and cadastral parcels.
const SUGGEST_FQ = 'type:(adres OR woonplaats OR perceel)'

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

/** Parse a WKT `POINT(lng lat)` (PDOK `centroide_ll` / `geometrie_ll`). */
function parseWktPoint(wkt) {
  if (typeof wkt !== 'string') return null
  const m = /POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt)
  if (!m) return null
  const lng = Number(m[1])
  const lat = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/**
 * PDOK Locatieserver autocomplete. Returns lightweight suggestions
 * ({ id, label, type }) — geometry is fetched on selection via lookupPlace().
 */
export async function suggestPlaces(query, signal) {
  const url =
    `${LOCATIESERVER}/suggest?q=${encodeURIComponent(query)}` +
    `&fq=${encodeURIComponent(SUGGEST_FQ)}&rows=7`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const data = await res.json()
  const docs = data?.response?.docs ?? []
  return docs.map((d) => ({
    id: d.id,
    type: d.type ?? '',
    label: d.weergavenaam || d.id,
  }))
}

/** Resolve a Locatieserver id to a navigable coordinate via centroide_ll. */
export async function lookupPlace(id, signal) {
  const url = `${LOCATIESERVER}/lookup?id=${encodeURIComponent(id)}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`)
  const data = await res.json()
  const doc = data?.response?.docs?.[0]
  if (!doc) throw new Error('No match found')
  const point = parseWktPoint(doc.centroide_ll) || parseWktPoint(doc.geometrie_ll)
  if (!point) throw new Error('No coordinates for this result')
  return {
    lat: point.lat,
    lng: point.lng,
    label: doc.weergavenaam || id,
    type: doc.type ?? '',
  }
}
