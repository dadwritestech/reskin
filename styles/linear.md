---
name: Linear
title: in the style of Linear
mode: dark
colors:
  canvas: "#08090a"
  surface: "#0f1011"
  surface-2: "#161718"
  ink: "#f7f8f8"
  ink-muted: "#a3a8b1"
  accent: "#5e6ad2"
  on-accent: "#ffffff"
  link: "#9aa3ff"
  link-visited: "#b4a6f0"
  hairline: "#23252a"
  focus: "#828fff"
type:
  family: "Inter, 'SF Pro Text', system-ui, -apple-system, 'Segoe UI', sans-serif"
  display: "Inter, 'SF Pro Display', system-ui, -apple-system, 'Segoe UI', sans-serif"
  mono: "'Berkeley Mono', 'JetBrains Mono', ui-monospace, Consolas, monospace"
  size: 15px
  leading: 1.6
  heading-weight: 600
  heading-tracking: -0.022em
  scale: 1.25
space:
  unit: 4px
  gutter: 24px
  measure: 760px
radius:
  sm: 6px
  md: 8px
  lg: 12px
  pill: 999px
shadow:
  card: "0 0 0 1px #23252a, 0 8px 24px rgba(0,0,0,.35)"
motion:
  quick: 160ms
  easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)"
---

Quiet, dense, dark product UI. Near-black canvas, surfaces separated by 1px hairlines
rather than shadows, one indigo accent used sparingly (primary buttons, the active item,
focus). Type is a tight grotesk: headings with slightly negative tracking, medium weight,
never heavy. Lists read like an issue tracker: rows with hairline separators, muted
metadata in 12-13px grey, hover lifts the row background one step.
Hover changes colour, never position. No gradients on text, no glow.

Credit: tokens are my own reading; reference text from VoltAgent/awesome-design-md
(linear.app) and motion values measured in awesome-motion-md (linear).
