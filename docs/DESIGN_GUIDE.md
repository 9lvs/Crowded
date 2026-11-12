# Design guide

Crowded is black and white for now: minimal, Uber like, numbers first. The same tokens exist on
web (`web/css/tokens.css`) and iOS (`ios/Crowded/DesignSystem/Tokens.swift`,
`Typography.swift`). Change both to keep the two clients in step.

## Principles
- Crowd and line first. The pass suggestion is quiet and secondary.
- Every number shows its basis. "No recent data" instead of a stale number.
- Never use color alone for meaning. Crowd level is a word plus a 3 segment meter.
- One primary (solid) button per screen. Secondary actions are outlined.
- Hairline dividers instead of boxed cards. Generous whitespace.
- 44 pt minimum touch targets (we use 48). Dynamic Type everywhere. Reduce Motion respected.

## Change the accent color (bring color back)
The accent hook is used only for the active timer ring and can mark the verdict.
- Web: set `--accent` and `--accent-ink` in both theme blocks of `web/css/tokens.css`.
- iOS: set `Palette.accentLight` and `Palette.accentDark` in `Tokens.swift`.
Start with one hue, for example amber `#FFB84D` on dark and a deeper `#B86E00` on light for contrast.

## Change fonts
- Web: `--font-display` and `--font-body` in `tokens.css`, files in `web/fonts/`.
- iOS: the PostScript names in `CrowdedFont` (`Typography.swift`), files in
  `ios/Crowded/Resources/Fonts/`, and the file names in `UIAppFonts` in `ios/Config/Info.plist`.
Today: DM Sans for all text, Bricolage Grotesque only for big numbers. Both are SIL OFL 1.1.

## Change corner radius
- Web: `--radius-scale` (1 default, 0 square, 1.5 rounder).
- iOS: `Knobs.radiusScale` in `Tokens.swift`.

## Change density
- Web: `--density` (1 default, 0.85 tighter, 1.15 airier).
- iOS: `Knobs.density` in `Tokens.swift`.

## See every component at once
- Web: run with `?mock=1` and walk the screens.
- iOS: Settings > Component gallery (debug builds), or the SwiftUI previews in each component file.

## Motion
Same values on web and iOS (`Motion` in `Tokens.swift`).
- press 120 ms, screen 240 ms, sheet 300 ms, fade 160 ms.
- Every tappable control uses one press style: scale 0.97 and opacity 0.9 over the press time.
  Door zones use 0.98. With Reduce Motion on there is no scale, only the opacity change.
- iOS: `PressableStyle` (and the primary, secondary and chip styles, which share its effect).
- Haptics on iOS: light impact on primary actions, selection on chips and segments, the door
  keeps its own impact, success when a report or timer ends. Never two haptics on one tap.
- Numbers that change (wait minutes, headcount) use a numeric transition over the fade time.
- Screens use the system push with the left edge swipe back. Sheets use system presentation.
  No stagger animations on lists.
