# Changelog

## 0.2.0-beta.1

Prototype beta. Not for purchase, insurance, engineering design, or safety decisions.

### Added

- Optional 3D parcel slice: BAG building footprints and AHN DTM/DSM terrain, loaded on
  demand from PDOK. Missing raster samples are treated as missing, not extrapolated.
- AHN elevation overlay toggle and RD New (EPSG:28992) coordinate readout.
- Optional nature-areas overlay from the public IPO/Risicokaart WMS.
- Playwright browser tests for search, offline fallback, mobile layout, overlays, 3D,
  and stale-response handling.

### Changed

- Risk index now withholds elevation-dependent scores and the overall score when AHN
  elevation is unavailable, instead of substituting a mock value.
- Parcel lookup is paginated and withholds approximate matches when the result limit is
  reached.

### Removed

- Fixed-value valuation, depreciation chart, and the associated loss model. There is no
  defensible valuation or loss model in this app.

### Known limitations

- The Heuristic Risk Index is not actuarial or regulatory. Flood polygons are fictional
  Rotterdam-area demos; subsidence is an elevation proxy; fire is a constant. It has not
  been calibrated or validated for any location.
- The browser suite passed in a prior environment but timed out twice locally; it was not
  a release gate for this beta.
- Browser coverage is Chromium only. Physical devices and screen readers were not tested.
