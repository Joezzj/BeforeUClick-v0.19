// content.js
// Coordinates extraction, header/authentication intelligence, analysis, scoring and the explicit manual-check session for v0.18.
// No email content or analysis result is intentionally transmitted or stored.

let bucLastReport = null;
let bucLastMessageKey = "";
let bucCheckEngaged = false;

/** Returns whether BeforeUClick is currently engaged with one manually checked message. */
function bucIsCheckEngaged() {
    return bucCheckEngaged === true;
}

/**
 * Ends the current manual-check session.
 * Removes report UI, link badges/highlights/popovers and click-guard state,
 * then forgets the in-memory report so reopening the toolbar popup returns to Ready to check.
 */
function bucDisengageCurrentCheck({ removePanel = true } = {}) {
    bucCheckEngaged = false;
    bucLastReport = null;
    bucLastMessageKey = "";

    if (typeof bucSetLinkInteractionEngaged === "function") {
        bucSetLinkInteractionEngaged(false);
    }
    if (typeof bucSetClickGuardEngaged === "function") {
        bucSetClickGuardEngaged(false);
    }
    if (typeof bucCloseLinkInfoPopover === "function") {
        bucCloseLinkInfoPopover();
    }
    if (typeof bucCloseClickGuard === "function") {
        bucCloseClickGuard();
    }
    if (typeof bucResetLinkRegistry === "function") {
        bucResetLinkRegistry();
    } else if (typeof bucClearLinkHighlights === "function") {
        bucClearLinkHighlights();
    }

    if (removePanel) {
        document.getElementById("beforeuclick-panel")?.remove();
    }

    return { ok: true, engaged: false };
}

/** Creates a small non-cryptographic fingerprint used only to identify the current rendered message. */
function bucSimpleFingerprint(value) {
    let hash = 0;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return String(hash);
}

/** Builds the temporary key used to decide whether the popup report still belongs to the open message. */
function bucGetMessageKey(context, metadata) {
    if (!context) return "";

    const id = context.root?.getAttribute("data-legacy-message-id") ||
        context.root?.getAttribute("data-message-id") ||
        context.body?.getAttribute("data-legacy-message-id") ||
        context.body?.getAttribute("data-message-id");

    if (id) return id;

    const bodySample = bucExtractCurrentMessageText(context).slice(0, 500);
    const recipients = [
        ...(metadata?.recipients?.to || []),
        ...(metadata?.recipients?.cc || []),
        ...(metadata?.recipients?.bcc || [])
    ].join(",");

    return bucSimpleFingerprint(
        `${metadata?.sender || ""}|${recipients}|${metadata?.date || ""}|${metadata?.subject || ""}|${bodySample}`
    );
}

/** Creates a consistent module result for partial-result handling, debug output and score evidence. */
function bucModuleResult(status, score = 0, warnings = [], details = null, evidence = []) {
    return { status, score, warnings, details, evidence };
}

/** Runs the complete manual BeforeUClick pipeline against the selected supported webmail message. */
async function analyseCurrentEmail({ showPanel = true, recordScan = true } = {}) {
    // A new explicit check replaces any previous engaged message/session.
    bucDisengageCurrentCheck({ removePanel: true });

    const context = bucFindCurrentMessage();

    if (!context) {
        if (showPanel) {
            showBeforeUClickStatus(`Open an email in ${bucSupportedProviderLabel()}, then click “Check this email”.`, true);
        }
        return {
            ok: false,
            error: "No opened message could be detected on this supported webmail page."
        };
    }

    const modules = {};
    let metadata = {};
    let messageText = "";
    let links = [];
    let wordingMatches = [];
    let senderResult = { score: 0, warnings: [], evidence: [] };
    let metadataResult = { score: 0, warnings: [], evidence: [] };
    let authentication = null;
    let authenticationResult = { score: 0, warnings: [], evidence: [], model: null };
    let headerAcquisition = { status: "unavailable", source: "none", rawHeaders: "", limitations: [] };
    let bodyIdentityResult = { score: 0, warnings: [], evidence: [], addresses: [] };
    let wordingResult = { score: 0, matches: [] };
    let preferences = { ...BUC_DEFAULT_PREFERENCES, knownSenders: [] };
    const overallWarnings = [];

    // Start every manual check with a clean visual state.
    bucClearLinkHighlights();

    // Load local-only preferences once per manual check.
    try {
        preferences = await bucGetPreferences();
        bucSetClickGuardMode(preferences.clickGuardMode);
        bucSetLinkInfoMode(preferences.linkInfoMode);
        bucSetUiPreferences(preferences);
    } catch (_error) {
        preferences = { ...BUC_DEFAULT_PREFERENCES, knownSenders: [] };
        bucSetClickGuardMode(preferences.clickGuardMode);
        bucSetLinkInfoMode(preferences.linkInfoMode);
        bucSetUiPreferences(preferences);
    }

    // Extraction module. Provider adapters may reveal local message-detail metadata where supported.
    try {
        const expandedDetails = await bucEnsureProviderDetailsVisible(context);
        messageText = bucExtractCurrentMessageText(context);
        metadata = bucExtractProviderMetadata(context);

        modules.extraction = bucModuleResult(
            "ok",
            0,
            [],
            {
                textLength: messageText.length,
                detailsExpandedByPrototype: expandedDetails,
                unavailable: metadata.unavailable || []
            }
        );
    } catch (error) {
        modules.extraction = bucModuleResult("error", 0, ["Message extraction failed."], String(error));
        metadata = {
            sender: "",
            senderName: "",
            recipients: { to: [], cc: [], bcc: [] },
            subject: "",
            date: "",
            replyTo: "",
            mailedBy: "",
            signedBy: "",
            unavailable: ["metadata"]
        };
    }

    // Provider-specific Internet-header acquisition + shared authentication interpretation.
    // This is intentionally separate from visible-message extraction: providers obtain the data,
    // while one common parser/alignment/evidence path handles SPF/DKIM/DMARC consistently.
    try {
        headerAcquisition = await bucAcquireProviderHeaders(context, metadata);
        authentication = bucBuildAuthenticationModel(headerAcquisition, metadata, context.provider || "");
        metadata = bucMergeMetadataFromAuthentication(metadata, authentication);
        authenticationResult = analyseAuthentication(authentication);

        modules.authentication = bucModuleResult(
            headerAcquisition.status === "full" ? "ok" : "partial",
            authenticationResult.score,
            authenticationResult.warnings,
            {
                acquisitionStatus: headerAcquisition.status,
                source: headerAcquisition.source,
                rawHeaderCount: authentication.rawHeaderCount || 0,
                spf: authentication.spf,
                dkim: authentication.dkim,
                dmarc: authentication.dmarc,
                arc: authentication.arc,
                alignment: authentication.alignment,
                limitations: authentication.limitations || []
            },
            authenticationResult.evidence || []
        );
        overallWarnings.push(...authenticationResult.warnings);
    } catch (error) {
        authentication = bucBuildAuthenticationModel(
            { provider: context.provider || "", status: "unavailable", source: "none", rawHeaders: "", limitations: ["Header/authentication analysis failed."] },
            metadata,
            context.provider || ""
        );
        authenticationResult = { score: 0, warnings: [], evidence: [], model: authentication };
        modules.authentication = bucModuleResult("error", 0, ["Header/authentication analysis could not be completed."], String(error));
    }

    // Sender analysis. Evidence is kept separate from presentation text for later score changes.
    try {
        senderResult = analyseSender(metadata.sender, metadata.senderName, {
            knownSender: bucIsKnownSender(metadata.sender, preferences)
        });
        modules.sender = bucModuleResult(
            "ok",
            senderResult.score,
            senderResult.warnings,
            null,
            senderResult.evidence || []
        );
        overallWarnings.push(...senderResult.warnings);
    } catch (error) {
        modules.sender = bucModuleResult("error", 0, ["Sender analysis could not be completed."], String(error));
    }

    // Metadata consistency analysis. When full provider-trusted SPF/DKIM results are available,
    // avoid scoring the same mailed-by/signed-by relationship twice through the older summary fields.
    try {
        const metadataForConsistency = {
            ...metadata,
            mailedBy: authentication?.spf?.providerTrusted ? "" : metadata.mailedBy,
            signedBy: authentication?.dkim?.some(item => item.providerTrusted) ? "" : metadata.signedBy
        };
        metadataResult = analyseMetadata(metadataForConsistency);
        modules.metadata = bucModuleResult(
            "ok",
            metadataResult.score,
            metadataResult.warnings,
            null,
            metadataResult.evidence || []
        );
        overallWarnings.push(...metadataResult.warnings);
    } catch (error) {
        modules.metadata = bucModuleResult("error", 0, ["Metadata analysis could not be completed."], String(error));
    }

    // Body identity analysis. This checks contact addresses written inside the current message
    // and remains deliberately low-weight because legitimate messages can mention third parties.
    try {
        bodyIdentityResult = analyseBodyIdentity(messageText);
        modules.bodyIdentity = bucModuleResult(
            "ok",
            bodyIdentityResult.score,
            bodyIdentityResult.warnings,
            { addresses: bodyIdentityResult.addresses || [] },
            bodyIdentityResult.evidence || []
        );
        overallWarnings.push(...bodyIdentityResult.warnings);
    } catch (error) {
        modules.bodyIdentity = bucModuleResult("error", 0, ["Body contact-address analysis could not be completed."], String(error));
    }

    // Wording analysis. Subject is included because phishing language often appears there.
    try {
        const wordingInput = [metadata.subject, messageText].filter(Boolean).join("\n\n");
        wordingResult = checkWording(wordingInput);
        wordingMatches = wordingResult.matches;
        modules.wording = bucModuleResult(
            "ok",
            wordingResult.score,
            wordingMatches.map(match => `Wording pattern: ${match.label}`),
            null,
            wordingMatches.map(match => ({
                code: match.id,
                category: "wording",
                source: "wording",
                strength: match.strength || "weak",
                evidenceClass: match.evidenceClass || "WORDING_WEAK",
                points: match.score,
                text: match.label,
                matchedPhrases: match.matchedPhrases || []
            }))
        );
        overallWarnings.push(...modules.wording.warnings);
    } catch (error) {
        modules.wording = bucModuleResult("error", 0, ["Wording analysis could not be completed."], String(error));
    }

    // Link analysis. Each result preserves the exact provider DOM element mapping created by shared link extraction.
    try {
        const rawLinks = bucExtractProviderLinks(context);
        links = rawLinks.map(link => {
            const displayValue = link.text || link.altText || "";
            const risk = calculateLinkRisk(displayValue, link.url);
            return {
                ...link,
                score: risk.score,
                rawScore: risk.rawScore ?? risk.score,
                weakRawScore: risk.weakRawScore ?? 0,
                weakAppliedScore: risk.weakAppliedScore ?? 0,
                weakCap: risk.weakCap ?? BUC_SCORING_MODEL.weakLinkCap,
                warnings: risk.warnings.map(warning => warning.text),
                warningDetails: risk.warnings,
                domain: risk.domain,
                reference: risk.reference
            };
        });

        // Make the same analysed records available to highlighting and the click guard.
        bucSetAnalysedLinkResults(links);

        const highestLinkScore = links.length ? Math.max(...links.map(link => link.score)) : 0;
        modules.links = bucModuleResult(
            "ok",
            Math.min(highestLinkScore, BUC_SCORING_MODEL.linkCap),
            links.flatMap(link => link.warnings),
            {
                highestRawLinkScore: highestLinkScore,
                totalLinks: links.length
            },
            links.flatMap(link => link.warningDetails || [])
        );
        overallWarnings.push(...modules.links.warnings);
    } catch (error) {
        modules.links = bucModuleResult("error", 0, ["Link analysis could not be completed."], String(error));
    }

    // Scoring happens after the modules finish, so changing weights does not require rewriting extraction logic.
    let scoring;
    try {
        const scoringMetadataResult = {
            ...metadataResult,
            evidence: [
                ...(metadataResult.evidence || []),
                ...(authenticationResult.evidence || [])
            ]
        };
        scoring = scoreBeforeUClickEvidence({
            senderResult,
            metadataResult: scoringMetadataResult,
            bodyIdentityResult,
            wordingResult,
            links
        });
        modules.scoring = bucModuleResult(
            "ok",
            scoring.score,
            scoring.combinationEvidence.map(item => item.text),
            {
                moduleScores: scoring.moduleScores,
                caps: scoring.caps,
                linkSummary: scoring.linkSummary
            },
            scoring.evidence
        );
    } catch (error) {
        scoring = {
            score: BUC_SCORING_MODEL.baseUncertaintyScore,
            level: bucScoreLevel(BUC_SCORING_MODEL.baseUncertaintyScore),
            baseScore: BUC_SCORING_MODEL.baseUncertaintyScore,
            concernScore: 0,
            reassuranceAdjustment: 0,
            moduleScores: {
                baseline: BUC_SCORING_MODEL.baseUncertaintyScore,
                identity: 0,
                links: 0,
                wording: 0,
                combinations: 0,
                reassurance: 0
            },
            caps: {
                identity: BUC_SCORING_MODEL.identityCap,
                links: BUC_SCORING_MODEL.linkCap,
                wording: BUC_SCORING_MODEL.wordingCap,
                combinations: BUC_SCORING_MODEL.combinationCap,
                reassurance: BUC_SCORING_MODEL.reassuranceCap
            },
            linkSummary: { highestLinkScore: 0, multiLinkBonus: 0, suspiciousLinkCount: 0 },
            combinationEvidence: [],
            reassuringEvidence: [],
            concerningEvidence: [],
            evidence: [],
            criticalOverrideApplied: false
        };
        modules.scoring = bucModuleResult("error", 0, ["Evidence scoring could not be completed."], String(error));
    }

    // Build five-state component assessments for presentation. The numeric score remains
    // available internally for diagnostics/calibration but is not the ordinary user-facing result.
    let evaluation;
    try {
        evaluation = bucBuildEvaluationSummary({
            scoring,
            modules,
            metadata,
            senderResult,
            metadataResult,
            bodyIdentityResult,
            authenticationResult,
            headerAcquisition,
            wordingResult,
            links
        });

        const linkAssessments = new Map(
            (evaluation.components?.links?.items || []).map(item => [item.linkId, item])
        );
        links.forEach(link => {
            if (link?.id && linkAssessments.has(link.id)) link.assessment = linkAssessments.get(link.id);
        });

        // Refresh contextual link consumers after the component assessment is attached.
        bucSetAnalysedLinkResults(links);
    } catch (error) {
        evaluation = {
            overall: scoring.level || bucScoreLevel(scoring.score),
            coverage: { key: "partial", label: "Partial", note: "Component assessment summary could not be completed." },
            components: {},
            primaryReasons: [],
            scoreVisibleToUser: false,
            scoreMeaning: "Internal evidence weight only; not a probability."
        };
        modules.evaluation = bucModuleResult("error", 0, ["Component evaluation summary could not be completed."], String(error));
    }

    if (!modules.evaluation) {
        modules.evaluation = bucModuleResult("ok", 0, [], {
            coverage: evaluation.coverage,
            overall: evaluation.overall,
            components: Object.fromEntries(Object.entries(evaluation.components || {}).map(([key, value]) => [key, {
                assessment: value.assessment,
                coverage: value.coverage
            }]))
        });
    }

    // Partial results: module errors do not prevent the rest of the report from being returned.
    const moduleErrors = Object.entries(modules)
        .filter(([, result]) => result.status === "error")
        .map(([name]) => name);

    if (moduleErrors.length) {
        overallWarnings.push(`Partial result: ${moduleErrors.join(", ")} module(s) could not be completed.`);
    }

    const messageKey = bucGetMessageKey(context, metadata);
    const linkTypeCounts = links.reduce((counts, link) => {
        counts[link.type] = (counts[link.type] || 0) + 1;
        return counts;
    }, {});

    const debug = {
        provider: context.providerName || "Webmail",
        providerStatus: context.providerStatus || "unknown",
        messageSelection: context.selectionEvidence || {},
        extractedTextLength: messageText.length,
        metadataUnavailable: metadata.unavailable || [],
        headerAcquisition: {
            status: headerAcquisition.status,
            source: headerAcquisition.source,
            rawHeaderCount: authentication?.rawHeaderCount || 0,
            limitations: authentication?.limitations || []
        },
        totalLinks: links.length,
        linkTypeCounts,
        moduleStatus: Object.fromEntries(Object.entries(modules).map(([name, result]) => [name, result.status])),
        scoreBreakdown: scoring.moduleScores,
        visibleAssessment: evaluation.overall,
        coverage: evaluation.coverage
    };

    bucLastReport = {
        ok: true,
        analysedAt: new Date().toISOString(),
        provider: context.providerName || "Webmail",
        providerKey: context.provider || "unknown",
        providerStatus: context.providerStatus || "unknown",
        messageKey,
        score: scoring.score,
        level: evaluation.overall || scoring.level,
        scoring,
        evaluation,
        metadata,
        authentication,
        headerAcquisition: {
            provider: headerAcquisition.provider || context.provider || "",
            status: headerAcquisition.status || "unavailable",
            source: headerAcquisition.source || "none",
            limitations: headerAcquisition.limitations || []
        },
        unavailableChecks: [
            ...(metadata.unavailable || []),
            ...((authentication?.limitations || []).map(item => `Authentication/header: ${item}`))
        ],
        warnings: overallWarnings,
        links,
        wordingMatches,
        modules,
        debug
    };
    bucLastMessageKey = messageKey;

    // Contextual UI only becomes active after a successful explicit manual check.
    bucCheckEngaged = true;
    if (typeof bucSetLinkInteractionEngaged === "function") {
        bucSetLinkInteractionEngaged(true);
    }
    if (typeof bucSetClickGuardEngaged === "function") {
        bucSetClickGuardEngaged(true);
    }

    bucApplyLinkHighlightMode(links, preferences.highlightMode || "concerns");

    // Record only explicit user-triggered checks. Internal refreshes must not inflate counters.
    if (recordScan) {
        try {
            chrome.runtime.sendMessage({
                type: "BUC_RECORD_SCAN",
                verdictKey: evaluation.overall?.key || scoring.level?.key || "unknown"
            });
        } catch (_error) {
            // Aggregate stats are optional and must never block the analysis result.
        }
    }

    if (showPanel) {
        renderReport(bucLastReport);
    }

    return bucLastReport;
}

/** Checks whether the saved popup result still belongs to the currently selected supported message. */
function bucCurrentMessageMatchesLastReport() {
    if (!bucCheckEngaged || !bucLastReport) return false;

    try {
        const context = bucFindCurrentMessage();
        if (!context) return false;
        const metadata = bucExtractProviderMetadata(context);
        const currentKey = bucGetMessageKey(context, metadata);
        return Boolean(currentKey && currentKey === bucLastMessageKey);
    } catch (_error) {
        return false;
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type) return false;

    if (message.type === "ANALYSE_CURRENT_EMAIL") {
        analyseCurrentEmail({ showPanel: true })
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: String(error) }));
        return true;
    }

    if (message.type === "REANALYSE_CURRENT_EMAIL") {
        analyseCurrentEmail({ showPanel: false, recordScan: false })
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: String(error) }));
        return true;
    }

    if (message.type === "GET_LAST_REPORT") {
        sendResponse(bucCurrentMessageMatchesLastReport() ? bucLastReport : null);
        return false;
    }

    if (message.type === "STOP_CHECKING") {
        sendResponse(bucDisengageCurrentCheck({ removePanel: true }));
        return false;
    }

    if (message.type === "GET_CHECK_ENGAGEMENT") {
        sendResponse({ ok: true, engaged: bucIsCheckEngaged() });
        return false;
    }

    return false;
});

/** Keeps the manual check trigger available as supported webmail apps change their DOM. */
function bucEnsureManualTrigger() {
    createManualTrigger(() => analyseCurrentEmail({ showPanel: true }));
}

bucEnsureManualTrigger();
bucInstallClickGuard();
bucInstallLinkInfoPopover();

// Supported webmail apps update without a full page reload. Keep the manual trigger available,
// but do not automatically analyse messages.
let bucObserverTimer = null;

/**
 * If the user navigates away from the checked message, end that session automatically.
 * The newly opened message is not analysed until the user presses Check this email again.
 */
function bucDisengageIfMessageChanged() {
    if (!bucCheckEngaged || !bucLastReport || !bucLastMessageKey) return;

    try {
        const context = bucFindCurrentMessage();
        if (!context) {
            bucDisengageCurrentCheck({ removePanel: true });
            return;
        }

        const metadata = bucExtractProviderMetadata(context);
        const currentKey = bucGetMessageKey(context, metadata);
        if (currentKey && currentKey !== bucLastMessageKey) {
            bucDisengageCurrentCheck({ removePanel: true });
        }
    } catch (_error) {
        // Provider DOM may be transient during navigation. Do not auto-analyse or guess.
    }
}

const bucObserver = new MutationObserver(() => {
    const triggerPresent = Boolean(document.getElementById("beforeuclick-check-button"));

    // During ordinary mailbox use, the fixed trigger is already present and no message is engaged.
    // Avoid continuously creating debounce timers for the host app's high-volume DOM mutations.
    if (!bucCheckEngaged && triggerPresent) return;

    // Throttle rather than endlessly re-debounce. Busy webmail pages can mutate many times per
    // second; this guarantees the message-change check still runs while keeping observer work small.
    if (bucObserverTimer) return;
    bucObserverTimer = setTimeout(() => {
        bucObserverTimer = null;
        bucEnsureManualTrigger();
        bucDisengageIfMessageChanged();
    }, 350);
});

bucObserver.observe(document.body, {
    childList: true,
    subtree: true
});
