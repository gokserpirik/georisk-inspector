import { expect, test } from '@playwright/test'

test('opt-in PDOK flood collections and small spatial queries are reachable with browser CORS', async ({ page }) => {
  test.skip(process.env.PDOK_LIVE_SMOKE !== '1', 'Set PDOK_LIVE_SMOKE=1 to contact the public PDOK service')
  test.setTimeout(45_000)
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const endpoints = [
      'https://api.pdok.nl/rws/overstromingen-gevarengebied/ogc/v1/collections/hazard_area',
      'https://api.pdok.nl/rws/overstromingen-risicogebied/ogc/v2/collections/risk_zone',
    ]
    return Promise.all(endpoints.map(async (endpoint) => {
      const url = `${endpoint}/items?f=json&bbox=4.4776,51.9243,4.4778,51.9245&limit=2`
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      const body = await response.json()
      return { status: response.status, type: body.type, features: Array.isArray(body.features) }
    }))
  })
  expect(results).toEqual([
    { status: 200, type: 'FeatureCollection', features: true },
    { status: 200, type: 'FeatureCollection', features: true },
  ])
})

test('opt-in IPO nature-area WMS image is available to the browser', async ({ page }) => {
  test.skip(process.env.PDOK_LIVE_SMOKE !== '1', 'Set PDOK_LIVE_SMOKE=1 to contact public mapping services')
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const params = new URLSearchParams({ service: 'WMS', version: '1.1.1', request: 'GetMap', layers: 'ISOR_RK:isor_brandbaar_natuurgebied', styles: '', format: 'image/png', transparent: 'true', srs: 'EPSG:4326', bbox: '5.8,52.1,5.81,52.11', width: '256', height: '256' })
    const response = await fetch(`https://servicespub.risicokaart.nl/geoserver/ISOR_RK/wms?${params}`, { signal: AbortSignal.timeout(20_000) })
    return { status: response.status, contentType: response.headers.get('content-type') }
  })
  expect(result.status).toBe(200)
  expect(result.contentType).toMatch(/^image\/png/i)
})
