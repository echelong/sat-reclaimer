# SAT//RECLAIMER — design system

One visual language across the public landing page (`/`) and the reclaim console
(`/app`). Everything here is plain CSS; there is no styling dependency, no utility
framework, and no animation library.

## Files

| File | Scope |
| --- | --- |
| `app/globals.css` | Tokens, reset, shared primitives (`.btn`, `.tag`, `.card`, `.bracket`, `.kicker`, `.reveal`, `.sr-only`), keyframes, and the global reduced-motion block |
| `app/landing.css` | Navigation, hero, steps, demo, comparison, trust, FAQ, footer, responsive |
| `app/console.css` | App bar and every `.cx-*` console surface |

All three are imported once from `app/layout.tsx`.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#080B12` | Page base |
| `--surface` / `--surface-2` / `--surface-3` | `#101522` → `#1A2334` | Panels, raised surfaces |
| `--line` / `--line-strong` | `#1D2740` / `#2B3A5E` | Hairlines and control outlines |
| `--text` / `--text-dim` / `--text-faint` | `#E8EEF7` / `#98A8C4` / `#7B8AA6` | Contrast ≈ 16:1 / 8.2:1 / 5.7:1 on `--bg` |
| `--cyan` | `#00F5FF` | Primary action, verified state, focus |
| `--purple` | `#A855F7` | Secondary accent, ambient light only |
| `--magenta` | `#FF2E88` | Destructive emphasis, strike-through, broadcast action |
| `--orange` | `#F7931A` | Bitcoin: the consolidated output, mainnet-critical values |
| `--ok` / `--warn` / `--danger` | `#3FE0A0` / `#FFB020` / `#FF5C6C` | State |

`--text-faint` matters: it carries 10–11px monospace labels, and its first value
(`#5F6F8E`) only reached 3.9:1, which fails WCAG AA at that size. It was raised to
5.7:1 rather than left as an aesthetic choice.

## Typography

Three families, loaded with `next/font/google` (self-hosted, preloaded, no runtime
request to Google):

- **Inter** — body copy, `--font-sans`
- **Space Grotesk** — display headings and section titles, `--font-display`
- **JetBrains Mono** — sat values, addresses, txids, labels, terminal text,
  `--font-mono`

The variables are declared on the `html` **element** selector, not in `:root`.
`:root` is a pseudo-class and scores 0,1,0, tying with the class `next/font`
applies to `<html>`; a `:root` declaration wins on source order and silently
disables all three fonts. Keeping the fallbacks one specificity level lower
(0,0,1) guarantees the loaded families win while still providing a sane stack.

Real money is always monospace: destinations, txids, fee amounts and sat totals
use `.mono` / `.num`, and the final-review txid is the largest cyan value on the
console page.

## Layout primitives

- `.wrap` — `min(1180px, 100% − 40px)`, centred
- `.section` — vertical rhythm via `clamp(72px, 11vh, 132px)`
- `.card` + `.bracket` — the recurring surface and its corner-bracket detail, which
  turns cyan on hover
- `.hairline` — the gradient divider

## Motion system

| Effect | Where | Implementation |
| --- | --- | --- |
| Hero canvas | `HeroVisualization.tsx` | Canvas 2D, one rAF loop, DPR capped at 2 |
| Headline strike → reveal | `.hero-dead` / `.hero-strike` / `.hero-live` | Pure CSS keyframes with delays; no JS |
| Scan front, convergence | `Demo.tsx` | Canvas 2D reading a shared clock ref |
| Terminal lines | `.demo-line` | `fade-up` on mount |
| Scroll reveals | `Reveal.tsx` | IntersectionObserver, one observer per element, unobserved after first hit |
| Counters | `Counter.tsx` | rAF, eased, starts on intersection |
| Traveling pulses | `.nav-progress`, `.hiw-grid::after`, `.hero-legend-arrow span` | CSS `transform` / `left` keyframes |
| Button sheen | `.hero-cta-main::after` | `transform: translateX` on hover |

Rules the system follows:

1. **Transform and opacity only.** Nothing animates a property that triggers
   layout, so there are no layout shifts.
2. **Loops pause.** The hero and demo canvases stop their `requestAnimationFrame`
   on `IntersectionObserver` exit and on `visibilitychange`, and every observer,
   listener and frame handle is released on unmount.
3. **Two frame loops maximum per route**, and the console route has none.
4. **Reduced motion is a first-class path**, not a disabled state — see below.
5. No animation is ever placed over a wallet confirmation, a destination address,
   a fee, or a txid.

## Accessibility

- `prefers-reduced-motion: reduce` collapses every CSS animation and transition to
  0.001 ms (so animated elements snap to their final, fully legible state), stops
  both canvases at a single settled frame, makes scroll reveals inert, and shows
  the demo in its completed state with a note instead of a replay button.
- Skip link on both routes; semantic `header` / `nav` / `main` / `footer` / `h1–h3`
  ordering; `aria-label` on every landmark.
- Focus is always visible: a 2px cyan `:focus-visible` outline.
- The hero and demo canvases are `aria-hidden` / `role="img"` with a text
  alternative; counts are exposed once via `.sr-only` so a screen reader never
  reads a transient number.
- The FAQ is native `<details name="faq">` — keyboard accessible, exclusive
  accordion behaviour, zero JavaScript, and it degrades to an expanded list.
- Nav has `aria-expanded` / `aria-controls` and closes on Escape.

## Contrast and responsive checks

Measured with headless Chromium at 1440 / 1280 / 834 / 390 / 320 px on both
routes: no horizontal overflow, no console errors, correct sticky navigation, and
all three font families loading. The only overflow found (a `.tag` at 320 px) was
fixed by allowing that one tag to wrap.
