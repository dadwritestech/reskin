---
name: Windows 95
title: in the style of Windows 95
mode: light
colors:
  canvas: "#088888"
  surface: "#c0c0c0"
  surface-2: "#dfdfdf"
  ink: "#000000"
  ink-muted: "#2b2b2b"
  accent: "#000080"
  on-accent: "#ffffff"
  link: "#0000aa"
  link-visited: "#551a8b"
  hairline: "#808080"
  focus: "#000000"
type:
  family: "'MS Sans Serif', 'Microsoft Sans Serif', Tahoma, Geneva, Verdana, sans-serif"
  display: "'MS Sans Serif', 'Microsoft Sans Serif', Tahoma, Geneva, Verdana, sans-serif"
  mono: "'Fixedsys', 'Courier New', monospace"
  size: 13px
  leading: 1.4
  heading-weight: 700
  heading-tracking: 0
  scale: 1.2
space:
  unit: 2px
  gutter: 12px
  measure: 900px
radius:
  sm: 0px
  md: 0px
  lg: 0px
  pill: 0px
shadow:
  card: "inset -1px -1px #0a0a0a, inset 1px 1px #ffffff, inset -2px -2px #808080, inset 2px 2px #dfdfdf"
motion:
  quick: 0ms
  easing: "linear"
---

A 1995 desktop. Teal desktop canvas; the page content lives in a grey (#c0c0c0) window
(the body element) with the classic 2px bevel: light top-left, dark bottom-right (use the
card shadow token). The first heading or top bar becomes a navy title bar with white
bold text. Buttons and inputs are bevelled too: inputs sunken (invert the bevel), buttons
raised. Zero radius everywhere, no transitions, no gradients, no soft shadows.
Links are plain blue and underlined. Tables look like list views with grey header cells.

Credit: tokens are my own, from memory of the Windows 95 UI; no reference file used.
