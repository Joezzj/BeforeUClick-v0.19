# BeforeUClick v0.18.2 — QA Audit

Date: 15 September 2026

## Audit objective

Review the panel-candidate codebase for correctness, redundancy, organisation, performance, privacy regressions and presentation-readiness without inventing a new detection algorithm or arbitrarily retuning uncalibrated evidence weights.

## Findings fixed

### High-value correctness fixes

1. **Raw header/body boundary** — fixed. Raw-message body content can no longer be retained/parsed as Internet headers after the first RFC header/body separator; unsafe whole-source fallback was removed.
2. **Redirect-wrapper hostname boundaries** — fixed. Google and Outlook wrapper detection no longer accepts lookalike suffix/substring hosts.
3. **Authentication alignment semantics** — fixed. SPF/DKIM uses registrable-domain alignment, not broad company ownership.
4. **Exact authentication detail preservation** — fixed. Exact SPF/DKIM domains are retained for inspection while alignment uses comparable registrable domains.
5. **Coverage-source mismatch** — fixed. Missing sender/text source data can no longer be presented as complete clean coverage.

### UI/provider cleanup

6. **Outlook message-details cleanup** — improved so menus/dialogs opened by the prototype are not intentionally left behind on acquisition failure.
7. **Gmail inbox preview placement** — moved into the Gmail adapter because it is provider-DOM-specific.
8. **Inbox preview over-warning** — weak sender-only evidence no longer creates a prominent warning badge.
9. **Click-guard wording** — made accurate for both default strong-only and optional caution/high modes.

### Performance / maintainability

10. **Main MutationObserver** — changed from continuously reset debounce behaviour to low-work idle handling plus a small throttle when engaged.
11. **Inbox-preview observer** — only runs while the opt-in feature is enabled.
12. **Dead UI code** — several unused helper functions and one unused automatic-highlight helper removed.
13. **Stale comments** — current modules/documentation cleaned where old prototype-version wording was misleading.

## Static/security checks

The audit checked for:

- `innerHTML`, `outerHTML`, `insertAdjacentHTML`;
- `eval`, `new Function`, `document.write`;
- `fetch`, XMLHttpRequest, WebSocket, `sendBeacon`;
- local/session storage or cookie use for message content;
- missing manifest/HTML resource paths;
- duplicate top-level lexical/function declarations across ordered content scripts.

No message-analysis network primitive or unsafe HTML/eval path is present in the current extension code. Local storage use remains limited to settings/known senders and aggregate daily counters.

## Architecture conclusion

The current hybrid provider structure remains appropriate for the three-platform MVP:

- provider-specific DOM acquisition/extraction stays in `adapters/<provider>/`;
- repeated URL/domain/header/scoring/evaluation logic stays shared;
- `provider_router.js` selects the active provider.

Loading the three small provider adapter sets on supported webmail pages is acceptable for the panel candidate. Adding dynamic per-provider script injection now would increase lifecycle/error complexity for little practical gain.

## Scoring conclusion

The scoring/evidence code passed structural QA, but the numerical model remains **provisional and uncalibrated**.

The audit deliberately did not change rules merely because they “look high” or “look low”. Examples that still require empirical testing include:

- long/complex legitimate marketing URLs reaching Review;
- HTTP or punycode sensitivity;
- strong wording forcing a minimum visible state;
- authentication failure combinations;
- visible breakpoints at 20 / 35 / 60.

The correct next step is a representative legitimate/suspicious corpus and false-alarm review, not a larger formula.

## Remaining live validation

Automated tests cannot prove that current third-party webmail DOM selectors still match production interfaces. Before the panel, manually verify:

- Gmail current-message extraction + expanded details + link mapping;
- Outlook current-message extraction + View message details acquisition;
- Yahoo current-message extraction + raw-message path;
- Stop checking / changing message disengages contextual UI;
- per-link badges stay anchored during scroll;
- one ordinary legitimate email and one synthetic/suspicious email per provider where practical.

Outlook ordinary message checking was previously live-confirmed after the v0.15.5 hotfix. Yahoo has a runtime DOM mock but still benefits from a real-account check.

## Panel-readiness assessment

The MVP implementation is sufficiently organised to freeze major feature development. Remaining work should be live QA, screenshots/evidence, and scoring calibration notes. Optional AI should be presented as future/optional capability rather than a dependency of the deterministic MVP.
