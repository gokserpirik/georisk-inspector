import { expect, test } from '@playwright/test'

const ROTTERDAM = { lat: 51.9244, lng: 4.4777 }

function parcelResponse(url) {
  const [minLng, minLat, maxLng, maxLat] = new URL(url).searchParams.get('bbox').split(',').map(Number)
  const lng = (minLng + maxLng) / 2
  const lat = (minLat + maxLat) / 2
  const ring = [[lng - 0.0001, lat - 0.0001], [lng + 0.0001, lat - 0.0001], [lng + 0.0001, lat + 0.0001], [lng - 0.0001, lat + 0.0001], [lng - 0.0001, lat - 0.0001]]
  return {
    type: 'FeatureCollection', numberMatched: 1,
    features: [{ type: 'Feature', properties: { kadastraleGemeenteCode: 'TEST', kadastraleGemeenteWaarde: 'Test municipality', sectie: 'A', perceelnummer: 1, kadastraleGrootteWaarde: 150 }, geometry: { type: 'Polygon', coordinates: [ring] } }],
  }
}

async function mockServices(page, { offline = false, onParcel, municipality } = {}) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === 'http://127.0.0.1:4179') return route.continue()
    if (url.hostname.endsWith('tile.openstreetmap.org')) return route.fulfill({ status: 204 })
    if (url.hostname === 'api.pdok.nl' && url.pathname.endsWith('/suggest')) {
      return route.fulfill({ json: { response: { docs: [{ id: 'amsterdam', weergavenaam: 'Amsterdam, Noord-Holland', type: 'woonplaats' }, { id: 'utrecht', weergavenaam: 'Utrecht, Utrecht', type: 'woonplaats' }] } } })
    }
    if (url.hostname === 'api.pdok.nl' && url.pathname.endsWith('/lookup')) {
      const isUtrecht = url.searchParams.get('id') === 'utrecht'
      return route.fulfill({ json: { response: { docs: [{ weergavenaam: isUtrecht ? 'Utrecht, Utrecht' : 'Amsterdam, Noord-Holland', centroide_ll: isUtrecht ? 'POINT(5.1214 52.0907)' : 'POINT(4.9045 52.3734)' }] } } })
    }
    if (url.hostname === 'service.pdok.nl' && url.pathname.includes('/kadastralekaart/')) {
      if (offline) return route.abort('failed')
      if (onParcel) await onParcel(route)
      const response = parcelResponse(url.href)
      if (municipality) response.features[0].properties.kadastraleGemeenteWaarde = municipality
      return route.fulfill({ json: response }).catch(() => {})
    }
    if (url.hostname === 'service.pdok.nl' && url.pathname.includes('/ahn/wms/')) {
      if (offline) return route.abort('failed')
      return route.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { value_list: '1.2' }, geometry: null }] } })
    }
    // No external request, including 3D rasters, is allowed to escape the fixture.
    return route.abort('failed')
  })
}

test('keyboard search selects a suggestion and updates the inspected parcel', async ({ page }) => {
  await mockServices(page)
  await page.goto('/')
  const search = page.getByRole('combobox', { name: 'Search address, place or parcel' })
  await search.fill('Amsterdam')
  await expect(page.getByRole('option')).toHaveCount(2)
  await search.press('ArrowDown')
  await search.press('ArrowDown')
  await expect(page.getByRole('option', { name: /Utrecht/ })).toHaveAttribute('aria-selected', 'true')
  await search.press('Enter')
  await expect(page).toHaveURL(/lat=52\.0907.*lng=5\.1214/)
  await expect(page.locator('.drawer')).toContainText('52.09070, 5.12140')
  await expect(page.locator('.drawer')).toContainText('Confirmed: click lies within this parcel.')
})

test('offline parcel and elevation requests do not produce an overall risk score', async ({ page }) => {
  await mockServices(page, { offline: true })
  await page.goto(`/?lat=${ROTTERDAM.lat}&lng=${ROTTERDAM.lng}`)
  await expect(page.locator('.map-badge')).toContainText('Offline / Fallback Mode')
  await expect(page.locator('.drawer')).toContainText('Parcel data unavailable')
  await expect(page.locator('.drawer')).toContainText('Elevation unavailable; elevation-dependent scores and the overall index are withheld.')
  await expect(page.locator('.drawer')).toContainText('Unavailable')
  await expect(page.getByRole('button', { name: '3D slice' })).toBeDisabled()
})

test('mobile map and search remain usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockServices(page)
  await page.goto('/')
  const map = page.locator('.leaflet-container')
  await expect(map).toBeVisible()
  await expect(page.getByText('Flood overlays are fictional. The selected parcel is outlined in red.')).toBeVisible()
  await expect.poll(async () => (await map.boundingBox())?.height).toBeGreaterThan(300)
  expect((await page.getByRole('combobox').boundingBox()).width).toBeGreaterThan(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('external parcel properties are rendered as text in the map popup', async ({ page }) => {
  const municipality = '<img src=x onerror="window.popupInjected=1">'
  await mockServices(page, { municipality })
  await page.goto('/')
  await expect(page.locator('.drawer')).toContainText(municipality)
  const parcel = page.locator('.leaflet-overlay-pane path[stroke="#e63946"]').last()
  await expect(parcel).toBeVisible()
  // The map marker sits at the polygon centre, so dispatch on the actual SVG path.
  await parcel.dispatchEvent('click')
  const popup = page.locator('.leaflet-popup-content')
  await expect(popup).toContainText(municipality)
  await expect(popup.locator('img')).toHaveCount(0)
  expect(await page.evaluate(() => window.popupInjected)).toBeUndefined()
})

test('nature-area overlay is optional, warns on tile failures, and does not change risk scoring', async ({ page }) => {
  const natureRequests = []
  page.on('request', (request) => {
    if (request.url().includes('servicespub.risicokaart.nl')) natureRequests.push(request.url())
  })
  await mockServices(page)
  await page.goto('/')
  await expect(page.locator('.drawer')).toContainText('Overall (Σ wᵢ·sᵢ)')
  const score = await page.locator('.drawer .metric-row').filter({ hasText: 'Overall (Σ wᵢ·sᵢ)' }).innerText()
  const toggle = page.getByRole('button', { name: 'Show nature areas' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(natureRequests).toHaveLength(0)
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Hide nature areas' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#nature-area-note')).toContainText('An unshaded area is not necessarily safe.')
  await expect.poll(() => natureRequests.length).toBeGreaterThan(0)
  await expect(page.locator('.map-layer-error')).toContainText('Some map tiles failed to load')
  expect(await page.locator('.drawer .metric-row').filter({ hasText: 'Overall (Σ wᵢ·sᵢ)' }).innerText()).toBe(score)
  await page.getByRole('button', { name: 'Hide nature areas' }).click()
  await expect(page.locator('#nature-area-note')).toHaveCount(0)
})

test('enabling nature areas does not let the map zoom beyond its base tiles', async ({ page }) => {
  await mockServices(page)
  await page.goto('/')
  await expect(page.locator('.drawer')).toContainText('Confirmed: click lies within this parcel.')
  await page.getByRole('button', { name: 'Show nature areas' }).click()
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  for (let i = 0; i < 8; i++) {
    await zoomIn.dispatchEvent('click')
    await page.waitForTimeout(300)
  }
  await expect(zoomIn).toBeDisabled()
  const baseTiles = await page.locator('img.leaflet-tile').evaluateAll((images) => images.map((image) => image.src).filter((url) => url.includes('tile.openstreetmap.org')))
  expect(baseTiles.length).toBeGreaterThan(0)
  expect(baseTiles.every((url) => Number(new URL(url).pathname.split('/')[1]) <= 19)).toBe(true)
})

test('3D view opens and closes, and reports unavailable 3D data', async ({ page }) => {
  await mockServices(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '3D slice' })).toBeEnabled()
  await page.getByRole('button', { name: '3D slice' }).click()
  await expect(page).toHaveURL(/view=3d/)
  await expect(page.getByText('3D parcel slice')).toBeVisible()
  await expect(page.locator('.slice-state.error-state')).toBeVisible()
  await page.getByRole('button', { name: 'Close 3D view' }).click()
  await expect(page.getByText('3D parcel slice')).toHaveCount(0)
  await expect(page).not.toHaveURL(/view=3d/)
})

test('3D errors and close control stay within the mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockServices(page)
  await page.goto('/')
  const toggle = page.getByRole('button', { name: '3D slice' })
  await expect(toggle).toBeEnabled()
  await toggle.click()
  const error = page.locator('.slice-state.error-state')
  await expect(error).toBeVisible()
  const box = await error.boundingBox()
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(844)
  await page.getByRole('button', { name: 'Close 3D view' }).click()
  await expect(page.getByText('3D parcel slice')).toHaveCount(0)
})

test('a delayed earlier parcel cannot overwrite a newer selection', async ({ page }) => {
  let release
  const delayed = new Promise((resolve) => { release = resolve })
  let calls = 0
  await mockServices(page, { onParcel: async () => { if (++calls === 2) await delayed } })
  await page.goto('/')
  await expect(page.locator('.drawer')).toContainText('51.92440, 4.47770')
  const search = page.getByRole('combobox')
  await search.fill('52.1, 4.4')
  await search.press('Enter')
  await expect.poll(() => calls).toBe(2)
  await search.fill('52.2, 4.5')
  await search.press('Enter')
  await expect(page.locator('.drawer')).toContainText('52.20000, 4.50000')
  release()
  await expect(page.locator('.drawer')).toContainText('52.20000, 4.50000')
  await expect(page.locator('.drawer')).not.toContainText('52.10000, 4.40000')
})
