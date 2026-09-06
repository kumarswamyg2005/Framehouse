# Design

## Subject

Two audiences, two surfaces — this is the core design decision.

The **workspace** (admin + team member) is a judging tool. Photographers cull on dark surfaces so nothing biases perceived exposure. Dark, dense, keyboard-driven, information-forward.

The **client gallery** is a print-viewing surface. Light, generous, near-zero chrome. The customer sees photos and almost nothing else. Switching surfaces signals "you have left the tool, this is your gallery."

Vernacular borrowed from the darkroom and the contact sheet: frame numbers, selection marks, the loupe.

## Surfaces

**Revised.** There were two surfaces. There are now three, and the difference between them is temperature, because temperature is what tells you which room you are standing in.

**Darkroom — warm dark.** The entry page and sign-in. A darkroom is warm; this is the room you stand in before the work starts.

- `--dr-ground: #15110F`   warm near-black
- `--dr-raised: #1E1815`   panels
- `--dr-line: #302722`     1px separators
- `--dr-ink: #EDE7DF`      warm bone
- `--dr-ink-dim: #9C9089`

**Workspace — cool neutral dark.** The tool. This one is not a mood: **you cannot judge exposure or white balance against a warm ground.** Every serious editor is neutral grey for the same reason. If the tool and the marketing page shared a palette, one of them would be wrong.

- `--ink: #12161C`        cool slate, not tinted black
- `--ink-raised: #1A2029` panels
- `--ink-line: #2A3340`   1px separators
- `--bone: #E8E6E1`       primary text
- `--bone-dim: #8B93A0`   secondary
- `--safelight: #C4553B`  selection mark and focus only — one accent, one job
- `--ok: #6E8F6B`         upload success

**Paper — warm light.** The client gallery. Prints are looked at on paper, and bone beats pure white.

- `--paper: #F4F1EA`
- `--paper-shade: #E6E1D6`
- `--graphite: #1A1815`
- `--graphite-dim: #6B655C`

Component CSS keeps using the generic `--ink` / `--bone` names; each surface remaps those to its own values, so one stylesheet serves all three. The surface classes are **global, never CSS-module** — a module class is hashed at build time, so `body:has(.gallerySurface)` would silently never match.

## Type

**Revised.** Instrument Serif was the wrong display face: single weight, high contrast, and thin rather than authoritative at size.

- Display: **Fraunces**. Variable across optical size, weight, `SOFT` (rounding) and `WONK` (irregularity), so one family gives two voices — `voiceQuiet` (`SOFT 0, WONK 0, opsz 36`) inside the tool, `voiceDisplay` (`SOFT 24, WONK 1, opsz 110`) on the entry page and gallery titles. It is drawn from 1970s phototypesetting, which is the same era the rest of this vocabulary comes from.
- UI/body: **Instrument Sans**. More drawn quality than Inter without giving up the neutrality dense UI needs.
- Frame numbers and literal copyable values only: **JetBrains Mono**, 400. Justified because film edges carry stenciled frame counters; do not use mono for any other label.

Scale: 12 / 14 / 16 / 20 / 28 / 44, plus two display steps (`--display-1`, `--display-2`) for the entry page and gallery titles only. Sentence case everywhere. No all-caps.

## Layout

Contact sheet is the organizing metaphor for the admin review screen.

```
┌────────────────────────────────────────────────────┐
│ Arjun & Priya Wedding                 1,250 frames │  ← serif, 44px
│ 600 selected · Draft                    [ Publish ]│  ← 14px, dim
├────────────────────────────────────────────────────┤
│ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐  │
│ │      ││ ✓    ││      ││ ✓    ││      ││      │  │
│ │      ││      ││      ││      ││      ││      │  │
│ └──────┘└──────┘└──────┘└──────┘└──────┘└──────┘  │
│  001     002     003     004     005     006       │  ← mono, under frame
└────────────────────────────────────────────────────┘
```

- Grid: fixed 4px gutter, no rounded corners on thumbnails, no drop shadows. Photos butt against each other like a real contact sheet. Container is what has generous margin.
- Selection: a `--safelight` 3px inset border + a small filled square in the top-left corner. This is the only place the accent appears. No checkbox chrome.
- Hover: thumbnail lifts opacity from 0.88 → 1.0. That is all. No scale, no shadow, no card lift.
- Keyboard: arrow keys move focus, `space` toggles selection, `shift+click` range-selects. Show the shortcut hints inline once, bottom-left, dismissible.

Client gallery:
- Full-bleed masonry, 2 columns mobile / 3 desktop, 24px gutter, `--paper` background.
- Header is one line: gallery title in Instrument Serif, photographer credit beneath in 14px. No nav bar, no logo lockup, no footer beyond a download hint.
- Lightbox: `--graphite` at 97% opacity, photo centered, frame counter bottom-center in mono, arrow-key nav, `esc` closes.

PIN gate:
- Centered, `--paper`. Six individual digit inputs, 56px tall, `--paper-shade` fill, auto-advance, paste-aware.
- Wrong PIN: inputs shake once (150ms, respects `prefers-reduced-motion`), message "That PIN doesn't match." Rate-limited: "Too many attempts. Try again in 12 minutes."

## Motion

**Revised twice.** Durations and curves are now tokens, so no component invents its own:

- `--dur-micro: 120ms` · `--dur-ui: 200ms` · `--dur-overlay: 260ms` · `--dur-exit: 160ms`
- `--ease-out` (quart) for entrances · `--ease-out-expo` for overlays · `--ease-in-out` for on-screen movement

Exits run at roughly 80% of the matching entrance — leaving should not be savoured. `ease-in` and `linear` are deliberately absent from the token set: `ease-in` starts slow and reads sluggish, `linear` reads mechanical. The one exception is the upload progress bar, where linear is correct because it is reporting a real rate.

Only `transform` and `opacity` are ever animated. Never `width`, `height`, `margin` or `padding` — those force layout.

The original rule — one orchestrated moment, no scroll-triggered reveals — was written for the tool and is kept there. It was wrong for the entry page and the client gallery, which are presentation surfaces and were reading as flat.

The rule now splits by surface.

**Workspace (the tool).** Unchanged, and deliberately so. Motion only answers a click: upload progress, selection toggle, loupe open. Nothing moves because you scrolled past it. A person culling 1,250 frames does not want the interface performing.

**Entry page and client gallery (presentation).** Motion is allowed to direct attention, under three constraints:

- It is a *camera move*, not decoration. Every reveal has somewhere it is taking the eye. If a sequence would read the same with the animation deleted, delete the animation.
- It is compositor-only — `transform` and `opacity`, driven by native `animation-timeline: view()`, never a scroll event listener. Target is 60fps on a mid-range Android under 4× CPU throttle.
- It is progressive enhancement. Content is visible and correct with no animation at all; the animation is applied inside `@supports (animation-timeline: view())`. A browser without it loses nothing but the choreography.

`prefers-reduced-motion` is a designed path, not a switched-off one: reveals resolve instantly to their final state, and the gallery unlock still reads as an arrival through opacity alone.

## Texture

The workspace and the gallery both carry a film grain overlay — an SVG `feTurbulence` at low opacity, fixed to the viewport, `pointer-events: none`.

This is not a decorative flourish borrowed from a trend. Grain is the native texture of the subject: it is what film actually looks like, it is what the darkroom vernacular in this design points at, and on large flat fields of `--ink` it does real work — it breaks up banding and stops the dark ground reading as dead black. It sits under the photographs and never over them.

## Scale, revised

The body scale is unchanged: 12 / 14 / 16 / 20 / 28 / 44.

The entry page and the gallery title get two display steps above it — `clamp()` between 44 and 128 — because a hero set at 44px is not a hero, and expressive display type is the single strongest lever a page like that has. Inside the tool, 44 remains the ceiling.

## Copy

- Empty upload state: "No photos yet. Drag them here, or choose files."
- Empty selection: "Select the frames you want the client to see."
- Publish confirm: "Publish 600 photos to a client gallery? You can unpublish anytime."
- Button says Publish → toast says Published.
- Errors state what happened and what to do. Never apologize.

## Quality floor

Responsive to 360px. Visible focus rings (`--safelight` 2px offset). `prefers-reduced-motion` honored as a designed path. All images have alt text from the original filename. Contrast ≥ 4.5:1 on all text.

Every asynchronous surface has a designed loading state — a skeleton that matches the shape of what is arriving, never a spinner and never a layout shift when the content lands.
