# BeforeUClick — v0.18.2 Patch Notes

## Theme

**MVP QA / Cleanup Release**

v0.18.2 is a correctness, organisation and performance pass over the v0.18.1 panel candidate. It does not introduce a new detection algorithm and deliberately avoids arbitrary scoring retuning before corpus-based calibration.

## Fixed — raw message body could be treated as headers

Raw-source pages can contain both Internet headers and the message body. The parser now:

- isolates the RFC-style header block;
- stops at the header/body blank separator;
- retains only the header block;
- returns an empty parse when a plausible header block cannot be isolated instead of falling back to the entire raw source.

Regression tests include body text containing fake `From:` / `Authentication-Results:` lines.

## Fixed — redirect-wrapper hostname lookalikes

Provider wrapper unwrapping now uses domain-boundary matching.

Accepted examples:

- `www.google.com/url?...`
- `*.safelinks.protection.outlook.com/?url=...`

Rejected lookalikes include:

- `evilgoogle.com/url?...`
- `safelinks.protection.outlook.com.evil.example/?url=...`

This prevents an attacker-controlled lookalike wrapper from making BeforeUClick analyse an attacker-supplied query parameter as if it were the real destination.

## Fixed — authentication alignment was too broad

SPF/DKIM alignment now compares PSL-derived registrable domains and is not broadened merely because two distinct domains belong to the same organisation reference.

Example: `microsoft.com` and `outlook.com` can both belong to Microsoft but are not the same SPF/DKIM alignment domain.

Reply-To identity consistency can still recognise sourced same-organisation relationships because that is a different question from authentication alignment.

## Fixed — exact authenticated domains were being collapsed

The authentication model now preserves exact SPF/DKIM domains such as:

- SPF mail-from: `mail.example.com`
- DKIM signing domain: `signing.example.com`

Alignment still uses the registrable domain (`example.com`) where appropriate.

## Fixed — coverage could look more complete than the source data

- Missing sender extraction now produces Limited sender coverage rather than Complete.
- Failed message-text extraction makes wording coverage Unavailable rather than allowing an empty wording result to look clean.

Missing information remains neutral rather than suspicious.

## Fixed — Outlook header-acquisition UI cleanup

The best-effort Outlook flow now cleans up both:

- a message-details dialog that BeforeUClick opened; and
- the More-actions menu when the expected **View message details** action cannot be found.

Provider DOM changes therefore leave less stray UI behind.

## Changed — Gmail-specific inbox preview moved

Moved:

```text
ui/inbox_preview.js
```

to:

```text
adapters/gmail/inbox_preview.js
```

because the feature depends on Gmail row selectors and belongs with provider-specific DOM logic.

## Changed — observer/performance behaviour

### Main content observer

- avoids timer work while BeforeUClick is idle and the manual trigger already exists;
- uses a 350 ms throttle while work is needed instead of continuously restarting a debounce;
- keeps automatic disengagement responsive when the user changes messages on highly dynamic webmail pages.

### Gmail inbox preview

- MutationObserver exists only while the optional feature is enabled;
- observer disconnects when the feature is disabled.

## Changed — inbox sender preview noise

The optional sender-only Gmail inbox preview is intentionally conservative:

- weak-only evidence → no badge;
- medium → Review sender;
- strong → Check sender;
- critical → High concern sender.

It remains disabled by default and is not a replacement for a full manual check.

## Changed — click-guard wording

The click-guard explanation no longer always says a link has a “strong concern”. This keeps the text accurate when the user chooses the optional setting that also guards Caution links.

## Cleanup

- removed dead floating-report helpers from older UI iterations;
- removed an unused automatic-link-highlight helper;
- removed duplicate drag-stop logic;
- refreshed stale comments in current modules;
- retained provider-specific/shared folder boundaries instead of introducing last-minute lazy loading complexity.

The three provider adapters together are small relative to the host webmail applications, so loading the current adapter set and routing at runtime remains an acceptable MVP trade-off.

## Tests

Added/extended regression coverage for:

- header/body boundary isolation;
- no unsafe raw-source fallback;
- redirect-wrapper boundary checks;
- strict authentication alignment;
- broader same-organisation Reply-To relationship;
- exact authenticated subdomain preservation;
- Outlook UI cleanup paths;
- coverage correctness;
- observer/inbox-preview cleanup and organisation.

The packaged build passes the complete retained regression suite, JavaScript syntax checking, manifest/HTML resource validation, duplicate top-level content-script declaration checks, and ZIP integrity testing.

## Not retuned

The current internal weights and breakpoints remain provisional. This QA pass fixes implementation correctness; it does **not** claim that false-positive/false-negative behaviour is calibrated. That requires representative legitimate/suspicious email testing.
