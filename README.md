# BeforeUClick — v0.18.2 MVP QA

BeforeUClick is a local-first browser extension that helps a user inspect an opened webmail message before following a link or acting on a request. It is explainable decision support, not an automatic phishing classifier and not a guarantee that a message is safe or malicious.

v0.18.2 is the completed engineering/QA pass over the v0.18.1 panel candidate. It keeps the same MVP direction and five-state UI while correcting several implementation issues, reducing unnecessary observer work, cleaning provider-specific organisation, and adding regression coverage for the fixes.

## MVP status

The original deterministic MVP functions are represented in this build:

- manual **Check this email** trigger;
- current-message extraction;
- sender / recipient / subject / date metadata;
- Reply-To and richer authentication/header information where exposed;
- SPF / DKIM / DMARC interpretation from provider-visible/raw header information;
- local link extraction and actual-destination display;
- local URL/domain/reference checks;
- wording-pattern checks;
- partial-module results when a check cannot complete;
- contextual per-link status chips and details;
- click guard for stronger link concerns;
- full inspection report;
- Gmail / Outlook Web / Yahoo Mail provider adapters;
- local-only deterministic analysis for the MVP.

Optional AI is **not required by the MVP** and remains future/optional work for explanation or additional context.

## Five visible assessment states

The ordinary UI does not show the internal numeric evidence score. It uses:

1. `✓ No obvious concerns`
2. `? Unknown`
3. `△ Review`
4. `⚠ Caution`
5. `! High concern`

Current internal ranges are provisional calibration aids:

- 0–9: No obvious concerns
- 10–19: Unknown
- 20–34: Review
- 35–59: Caution
- 60–100: High concern

Evidence strength can enforce a minimum state. Strong evidence can require at least Caution; critical evidence can require High concern. `Check complete` is an operation/status message, not a risk state.

The score remains an internal evidence weight and **is not a probability**.

## Component assessment + overall assessment

BeforeUClick evaluates at two levels.

### Component level

Separate user-facing assessments are built for:

- **Sender & identity**
- **Authentication**
- **Links**
- **Wording**

Each individual link also receives its own local assessment. A suspicious destination therefore does not make every other link appear suspicious, and harmless links do not average down a stronger link concern.

### Overall level

The overall result combines the underlying evidence rather than averaging component labels. Strong/critical evidence and limited cross-signal combinations can carry through to the overall assessment.

## Coverage is separate from concern

Missing information is not treated as either reassurance or suspicion.

Components can report:

- Complete
- Partial
- Limited
- Unavailable

v0.18.2 tightens this rule: a sender check is no longer described as complete when the sender address was not actually extracted, and wording coverage becomes unavailable if message-text extraction itself failed.

This keeps these situations distinct:

- “the check completed and found no obvious concern”; and
- “BeforeUClick could not obtain enough information to complete that check.”

## Weak-evidence caps

Repeated weak observations are deliberately capped so minor characteristics do not stack indefinitely.

Current provisional caps are:

- weak identity contribution: 8;
- weak URL-shape contribution: 8 per link;
- weak wording contribution: 6.

These are simple explainable controls, not a classifier. The values still require empirical calibration against a representative legitimate/suspicious test corpus.

## Header/authentication architecture

Provider-specific acquisition remains separate while interpretation is shared:

```text
adapters/
├── gmail/headers.js
├── outlook/headers.js
└── yahoo/headers.js
            ↓
analysis/headers/
├── parser.js
├── alignment.js
├── authentication.js
└── evidence.js
```

Provider folders handle how a particular webmail UI exposes information. Shared analysis handles repeated RFC-header/SPF/DKIM/DMARC logic.

Where available, the model can interpret:

- From / To / CC / BCC;
- Reply-To;
- Return-Path;
- Message-ID;
- Received path;
- Authentication-Results;
- Received-SPF;
- DKIM-Signature;
- ARC-Authentication-Results;
- SPF result and mail-from domain;
- DKIM result, exact signing domain and selector;
- DMARC result;
- From↔SPF alignment;
- From↔DKIM alignment;
- Reply-To / Return-Path relationships.

Authentication alignment is based on the PSL-derived registrable domain. It is **not broadened merely because two different domains belong to the same referenced company**. For example, ownership of both `microsoft.com` and `outlook.com` does not make them the same SPF/DKIM alignment domain. Reply-To identity relationships may still use the broader sourced organisation relationship because that is an identity-consistency question rather than an authentication-alignment result.

Authentication-Results are only score-bearing when their authserv-id plausibly belongs to the receiving provider. This is a defensive heuristic, not cryptographic verification of the header itself.

## v0.18.2 QA corrections

The full audit found and fixed several meaningful issues.

### Raw-header/body boundary

Raw-message views can contain both Internet headers and the email body. Earlier v0.18 parsing could retain too much source text and, in edge cases, interpret body lines such as `From:` or `Authentication-Results:` as headers.

v0.18.2:

- isolates the RFC-style header block;
- stops at the first header/body separator;
- does not fall back to treating the full raw-message body as a header block when isolation fails;
- stores only the extracted header block in the active report.

### Redirect unwrapping domain boundaries

Known Google redirect and Outlook Safe Links wrappers are locally unwrapped so the extension can inspect the real destination. Domain matching is now boundary-safe: lookalikes such as `evilgoogle.com` or `safelinks.protection.outlook.com.evil.example` are **not** treated as trusted provider wrappers.

### Authentication-domain accuracy

SPF/DKIM alignment now uses the actual registrable-domain relationship rather than broad organisation ownership. The model also preserves exact authenticated subdomains (for example `signing.example.com`) for inspection while using their registrable domain only for alignment comparison.

### Outlook UI cleanup

If BeforeUClick opens Outlook's **More actions** or **View message details** UI as part of best-effort header acquisition, it now makes a stronger effort to close the UI again even when the expected header block cannot be captured.

### Provider-specific organisation

The optional Gmail inbox sender preview was moved from `ui/` to:

```text
adapters/gmail/inbox_preview.js
```

because its selectors/behaviour are Gmail-specific. Shared analysis/UI remains provider-neutral where practical.

### Observer/performance cleanup

The main mailbox MutationObserver no longer repeatedly resets a debounce timer on every host-page mutation. When idle and the manual trigger is already present, it does almost no follow-up work. During an engaged check it uses a small throttle so changing messages still gets detected even on continuously mutating webmail pages.

The optional Gmail inbox-preview observer now exists only while that opt-in feature is enabled and is disconnected again when disabled.

### Inbox-preview noise reduction

The optional Gmail sender-only inbox preview no longer turns weak sender observations into a high-style warning. It uses the same assessment vocabulary more conservatively:

- medium → Review sender;
- strong → Check sender / Caution-style cue;
- critical → High concern sender;
- weak-only → no inbox badge.

It remains **off by default** and does not scan message bodies, increment the manual-check counter, or replace a full email check.

### Cleanup/accessibility

- removed unused floating-report helper functions from older UI iterations;
- removed an unused automatic-highlight helper;
- removed duplicate drag-stop logic;
- cleaned several stale source comments;
- added/retained accessible labels on primary floating-panel controls;
- click-guard wording now remains accurate when a user opts to guard Caution as well as High/strong links.

## Provider notes

### Gmail

Gmail remains the primary adapter. Expanded visible metadata is used where available. Full raw-header parsing is supported when Show-original-style header content is exposed to the current extension context; otherwise authentication coverage is reported as partial/limited rather than guessed.

### Outlook Web

The read-message adapter, including `outlook.cloud.microsoft`, was previously live-confirmed by the project user. v0.18.x adds best-effort **View message details** acquisition. That richer acquisition path still needs a final live pass against the current Outlook DOM.

### Yahoo Mail

Yahoo uses the hardened read-message adapter and shared analysis pipeline. Raw-message parsing works when the raw source is exposed in the current document. The adapter has runtime-mock coverage, but the current live Yahoo UI/raw-message path still needs final validation.

## User-facing information design

The toolbar popup stays decision-first:

- overall state;
- concise explanation;
- number of links checked / needing attention;
- coverage;
- top reasons where applicable;
- link to the full report.

The full report contains:

- overall assessment;
- component assessments;
- sender/message details;
- authentication and Internet-header information;
- evidence/reasons;
- individual link assessments;
- wording matches;
- unavailable/not-exposed information;
- collapsed developer/evaluation diagnostics.

The internal numeric score is only shown in collapsed developer/calibration diagnostics.

## Privacy

The MVP remains local-first.

There is no `fetch`, XHR, WebSocket or `sendBeacon` path in the checking pipeline. Preferences, known-sender entries and aggregate daily counters can be stored in `chrome.storage.local`; active email analysis and captured raw headers remain in memory rather than being intentionally persisted.

## QA validation

v0.18.2 retains the historical regression suite and adds/extends checks for:

- raw-header/body isolation;
- rejection of unisolated body fragments as headers;
- safe Google/Outlook redirect-wrapper recognition;
- rejection of wrapper lookalike domains;
- strict authentication alignment versus broader organisation identity relationships;
- exact SPF/DKIM subdomain preservation;
- Outlook UI cleanup paths;
- five-state component/overall evaluation;
- coverage correctness when source extraction is missing;
- weak-evidence capping;
- hidden ordinary-user score;
- Gmail inbox-preview organisation/observer behaviour;
- message-change observer throttling;
- Gmail, Outlook and Yahoo header/authentication parsing examples.

All JavaScript files pass syntax checking and all retained automated regression tests pass in the packaged build.

See `QA_AUDIT.md` for the audit summary.

## Intentionally not changed in this QA pass

The following areas are deliberately **not presented as fully calibrated**:

- the exact internal evidence weights;
- visible-state score breakpoints;
- URL heuristic sensitivity;
- false-positive/false-negative rates;
- external live threat/reputation lookups.

Changing those without a representative corpus would replace engineering evidence with guesswork. The next evaluation phase should test legitimate, suspicious and synthetic messages and then tune only the rules that prove noisy or weak.

## Before the panel

The remaining priority is validation and presentation evidence rather than feature expansion:

1. live-check Gmail, Outlook and Yahoo with ordinary messages;
2. verify the current header-acquisition UI paths;
3. run several legitimate and suspicious/synthetic messages for visible-state sanity;
4. capture screenshots of the five-state UI, component report and per-link cards;
5. record any noisy rule as a calibration finding rather than rushing arbitrary weight changes;
6. present AI as optional future work, not a missing MVP dependency.
