# Design QA

## Comparison target

- Source visual truth: `/Users/yapil/0/kkal/design-reference-option-2.png`
- Source pixels: 853 × 1844 (approximately 2.187× a 390 × 844 CSS viewport)
- Implementation: `http://localhost:4173/`
- Implementation evidence: Codex in-app Browser tab 1, browser-rendered inline captures at 390 × 844 and 320 × 700 CSS px, device scale factor 1
- State: light theme, current day, populated chat, one automatically logged meal
- Density normalization: source was reviewed at original resolution and compared by viewport proportion against the 390 × 844 CSS implementation. Browser chrome and device framing were excluded.

## Full-view comparison evidence

The implementation preserves the selected direction's hierarchy: compact brand/date/actions header, prominent calories and remainder, overall progress, three macro modules, a quiet weight/steps/dynamics utility row, assistant/journal header, continuous chat feed, context chips, and fixed composer. The user-requested behavior change is visible in the receipt as `Добавлено в журнал`; there is no redundant `Добавить` action.

## Focused region comparison evidence

- Summary: checked at 390 px and 320 px. All metrics remain visible, and the 320 px layout has no document-level horizontal overflow.
- Chat receipt: checked with a persisted meal entry. It shows logged status, nutrition, `Исправить`, and `Отменить`.
- Composer: checked as a fixed bottom region with selected meal context, attachment, voice, and send controls. Selecting a meal chip leaves the message text unchanged.
- Header: checked at 390 px with `kkal` visible and at 320 px with the wordmark hidden to preserve controls.

## Findings

No actionable P0, P1, or P2 differences remain.

- Accepted product deviation: the generated source includes a generic food photograph. Existing journal entries do not persist a suitable dish thumbnail, so the implementation keeps the receipt data-led instead of displaying invented imagery.
- Accepted behavior deviation: the source's `Добавить` button was replaced with a saved-state indicator and edit/undo actions, as explicitly requested.
- P3: very long assistant replies may benefit from a later compact/collapsed treatment.

## Required fidelity surfaces

- Fonts and typography: system sans stack, hierarchy and wrapping visually align with the target; body copy remains readable at 14–16 px.
- Spacing and layout rhythm: major regions, macro grid, utility row, chat spacing, chips, and composer match the target proportions; no overflow at 320 px.
- Colors and visual tokens: warm neutral base, graphite text, coral primary accent, and restrained green/amber/blue macro colors are implemented as reusable CSS variables.
- Image quality and asset fidelity: the existing brand asset is used directly. Standard UI symbols use local Phosphor icon fonts. No placeholder or fabricated food image is shown.
- Copy and content: Russian labels match the product; the logged state clearly communicates immediate journal persistence.

## Interaction verification

- Opened and returned from the journal.
- Expanded the 14-day dynamics panel.
- Changed the meal context chip without altering the message text.
- Checked 390 × 844 and 320 × 700 responsive layouts.
- Checked browser console: no errors or warnings.

## Comparison history

1. Initial 320 px capture found 7 px horizontal overflow in the top bar.
2. Reduced narrow-header dimensions and gaps; post-fix measurement is `scrollWidth = innerWidth = 320`.
3. Restored the `kkal` wordmark at 390 px while retaining the compact logo-only header below 350 px; post-fix measurement is `scrollWidth = innerWidth = 390`.

## Follow-up polish

- Consider collapsing exceptionally long historical assistant messages after three lines.

final result: passed
