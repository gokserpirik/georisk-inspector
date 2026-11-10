---
name: GeoRisk Inspector
description: A quiet workspace for inspecting a Dutch parcel beside its live map.
colors:
  accent: "#8c533b"
  accent-soft: "#f2e8e1"
  risk-high: "#a33d42"
  risk-medium: "#9d681a"
  risk-low: "#40745b"
  ground: "#f5f3ef"
  surface: "#fbfaf8"
  ink: "#292824"
  secondary-ink: "#696760"
  border: "#dcd8d0"
typography:
  headline:
    fontFamily: "Figtree, sans-serif"
    fontSize: "27px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Figtree, sans-serif"
    fontSize: "19px"
    fontWeight: 800
    lineHeight: 1.2
  body:
    fontFamily: "Figtree, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Figtree, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    letterSpacing: "0.075em"
rounded:
  control: "7px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
components:
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  search-field:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "42px"
---

# Design System: GeoRisk Inspector

## Overview

**Creative North Star: "The quiet inspection desk"**

A compact, warm-neutral workspace keeps the selected parcel legible while the geographic context has room to breathe. It interprets Astryx Neutral patterns in Vue without importing React components or illustrative place listings.

**Key Characteristics:** fine dividers instead of repeated cards; compact Figtree hierarchy; one modest selection accent; explicit semantic colors for risk and service states.

## Colors

The field is pale stone, the inspection surface is light, and ink remains warm rather than bluish. The accent identifies selection and interaction. High, medium, and low risk retain distinct semantic colors; a green service dot changes to amber when parcel data is unavailable.

**The Evidence Rule.** Color cannot imply a validated hazard conclusion where the underlying value is a proxy or demonstration.

## Typography

Self-hosted Figtree is used throughout. The heading is compact and strong; the selected parcel name is the next level; labels are small and tracked; long caveats use a readable body line-height. Measurements and coordinates use tabular numerals.

## Layout

The application fills the viewport. A 72px header sits above a 29rem-or-37vw inspection panel and a flexible live map. The panel introduction and footer stay fixed while parcel details scroll independently. At 800px and below, List and Map become separate views with a persistent bottom switch; selection and mounted map state persist across switches. Spacing follows a 4px-based scale.

## Elevation & Depth

Dividers separate records on the inspection surface. Only floating map controls and search suggestions use small offset, blurred shadows to remain legible over map imagery.

## Shapes

Controls use small corners. Section content is unboxed and divided by single fine rules; risk bars are slim and functional rather than ornamental.

## Components

### Buttons

Quiet surface buttons use a fine border; hover changes the border and text to the accent. Pressed map toggles use dark ink fill. Disabled actions lose emphasis and every keyboard focus has a visible accent outline.

### Inputs / Fields

The search field is a single 42px-high control with an integrated search icon, warm border, and accent focus ring. Suggestions form one scrollable list of divider-separated rows with a clear active state.

### Navigation

The mobile List/Map switch uses two equal touch targets; the active view receives a soft accent fill and explicit `aria-current` state.

### Inspection rows

Parcel identity leads; cadastral attributes, elevation, prototype factors, methodology, and chart follow as separate divider-led sections. Semantic badges and explanatory copy distinguish measured, inferred, unavailable, and fictional content.

## Do's and Don'ts

### Do:
- **Do** keep the real map as the large spatial work area.
- **Do** label fictional overlays and prototype scores near the data they qualify.
- **Do** preserve selection and map state when switching mobile views.

### Don't:
- **Don't** turn each metric into a floating card.
- **Don't** import Astryx React components into the Vue application.
- **Don't** present unvalidated proxy scores as safety or actuarial findings.
