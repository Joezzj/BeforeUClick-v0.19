// popup.js
// v0.18 team-UI toolbar popup with shared header/authentication intelligence. Detailed evidence stays in-context or in the full report.

const checkButton = document.getElementById("checkButton");
const checkAgainButton = document.getElementById("checkAgainButton");
const stopCheckingButton = document.getElementById("stopCheckingButton");
const openOptionsButton = document.getElementById("openOptionsButton");
const viewFullReportButton = document.getElementById("viewFullReportButton");
const toggleReasonsButton = document.getElementById("toggleReasonsButton");

const startScreen = document.getElementById("startScreen");
const resultScreen = document.getElementById("resultScreen");
const errorMessage = document.getElementById("errorMessage");
const riskCard = document.getElementById("riskCard");
const resultIcon = document.getElementById("resultIcon");
const riskLevel = document.getElementById("riskLevel");
const riskMessage = document.getElementById("riskMessage");
const resultContext = document.getElementById("resultContext");
const attentionCard = document.getElementById("attentionCard");
const attentionLabel = document.getElementById("attentionLabel");
const reasonsList = document.getElementById("reasonsList");
const linkHint = document.getElementById("linkHint");
const statScanned = document.getElementById("statScanned");
const statConcern = document.getElementById("statConcern");

const btnLabel = checkButton.querySelector(".btn-label");
const btnArrow = checkButton.querySelector(".btn-arrow");
const btnLoading = checkButton.querySelector(".btn-loading");

let currentReport = null;
const BUC_POPUP_MIN_CHECK_MS = 320;

function bucPopupWait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function bucPopupLoadStats() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "BUC_GET_STATS" });
        if (!response?.ok) return;
        statScanned.textContent = String(response.stats?.scanned || 0);
        statConcern.textContent = String(response.stats?.concern || 0);
    } catch (_error) {}
}

function bucPopupSetScanning(isScanning) {
    checkButton.disabled = isScanning;
    btnLabel.classList.toggle("hidden", isScanning);
    btnArrow.classList.toggle("hidden", isScanning);
    btnLoading.classList.toggle("hidden", !isScanning);
}

function bucPopupShowError(message) {
    errorMessage.querySelector("span").textContent = message;
    errorMessage.classList.remove("hidden");
}

function bucPopupHideError() {
    errorMessage.classList.add("hidden");
}

async function bucPopupMessageActiveTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab.");
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, message, response => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(response);
        });
    });
}

function bucPopupRiskState(level) {
    if (level === "high") return "danger";
    if (level === "caution") return "caution";
    if (level === "review") return "review";
    if (level === "no-concerns") return "no-concerns";
    return "neutral";
}

function bucPopupLinkNeedsAttention(link) {
    const key = link?.assessment?.assessment?.key;
    if (key) return ["review", "caution", "high"].includes(key);
    const warnings = link?.warningDetails || [];
    return warnings.some(item => ["medium", "strong", "critical"].includes(item.strength));
}

function bucPopupUniqueReasons(report) {
    const evaluationReasons = report.evaluation?.primaryReasons || [];
    const primary = (report.scoring?.concerningEvidence || []).map(item => item.text).filter(Boolean);
    const fallback = report.warnings || [];
    return [...new Set([...evaluationReasons, ...primary, ...fallback])];
}

function bucPopupRenderReasons(report) {
    const reasons = bucPopupUniqueReasons(report).slice(0, 3);
    reasonsList.textContent = "";
    reasonsList.classList.add("hidden");
    toggleReasonsButton.setAttribute("aria-expanded", "false");

    if (!reasons.length) {
        attentionCard.classList.add("hidden");
        return;
    }

    reasons.forEach(reason => {
        const item = document.createElement("li");
        item.textContent = reason;
        reasonsList.appendChild(item);
    });

    const count = bucPopupUniqueReasons(report).length;
    attentionLabel.textContent = count === 1 ? "1 thing to review" : `${count} things to review`;
    attentionCard.classList.remove("hidden");
}

function bucPopupDecisionText(levelKey, concernLinks, concerningEvidenceCount) {
    if (levelKey === "no-concerns") {
        return "No obvious concerns were found in the checks that completed. This is not a safety guarantee.";
    }
    if (levelKey === "unknown") {
        return "No strong warning was found, but there is not enough reassuring evidence to treat this email as known.";
    }
    if (levelKey === "review") {
        return concernLinks > 0
            ? (concernLinks === 1 ? "One link is worth reviewing before you continue." : `${concernLinks} links are worth reviewing before you continue.`)
            : "A few observations are worth reviewing before you act.";
    }
    if (levelKey === "high") {
        return "Strong evidence deserves attention before you continue.";
    }
    if (concernLinks > 0) {
        return concernLinks === 1
            ? "One link needs a closer look before you continue."
            : `${concernLinks} links need a closer look before you continue.`;
    }
    return concerningEvidenceCount === 1
        ? "We found one meaningful concern to check before you act."
        : "We found several meaningful concerns to check before you act.";
}

async function bucPopupShowReport(report) {
    if (!report?.ok) throw new Error(report?.error || "No report available.");
    currentReport = report;

    const level = report.evaluation?.overall || report.level || { key: "unknown", label: "UNKNOWN", icon: "?" };
    const links = report.links || [];
    const concernLinks = links.filter(bucPopupLinkNeedsAttention).length;
    const concerningEvidenceCount = (report.scoring?.concerningEvidence || []).length;

    riskCard.dataset.state = bucPopupRiskState(level.key);
    resultIcon.textContent = level.icon || "?";
    riskLevel.textContent = level.label || "Check complete";
    riskMessage.textContent = bucPopupDecisionText(level.key, concernLinks, concerningEvidenceCount);

    const provider = report.provider || report.debug?.provider || "Webmail";
    const linkText = links.length === 1 ? "1 link checked" : `${links.length} links checked`;
    const coverage = report.evaluation?.coverage?.label || "Partial";
    resultContext.textContent = `${provider} · ${linkText} · coverage ${coverage}${concernLinks ? ` · ${concernLinks === 1 ? "1 needs attention" : `${concernLinks} need attention`}` : ""}`;

    bucPopupRenderReasons(report);
    linkHint.classList.toggle("hidden", links.length === 0);

    startScreen.classList.add("hidden");
    resultScreen.classList.remove("hidden");
}

async function bucPopupRunCheck() {
    bucPopupHideError();
    bucPopupSetScanning(true);
    try {
        const [report] = await Promise.all([
            bucPopupMessageActiveTab({ type: "ANALYSE_CURRENT_EMAIL" }),
            bucPopupWait(BUC_POPUP_MIN_CHECK_MS)
        ]);
        await bucPopupShowReport(report);
        await bucPopupLoadStats();
    } catch (_error) {
        bucPopupShowError("Open an email in Gmail, Outlook, or Yahoo Mail, refresh the page if needed, then try again.");
    } finally {
        bucPopupSetScanning(false);
    }
}

checkButton.addEventListener("click", bucPopupRunCheck);
checkAgainButton.addEventListener("click", bucPopupRunCheck);

stopCheckingButton.addEventListener("click", async () => {
    bucPopupHideError();
    try {
        await bucPopupMessageActiveTab({ type: "STOP_CHECKING" });
    } catch (_error) {
        // If the source tab disappeared, the local popup can still return to its idle screen.
    }

    currentReport = null;
    resultScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    reasonsList.classList.add("hidden");
    toggleReasonsButton.setAttribute("aria-expanded", "false");
    bucPopupLoadStats();
});

openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

toggleReasonsButton.addEventListener("click", () => {
    const nowOpen = toggleReasonsButton.getAttribute("aria-expanded") !== "true";
    toggleReasonsButton.setAttribute("aria-expanded", nowOpen ? "true" : "false");
    reasonsList.classList.toggle("hidden", !nowOpen);
});

viewFullReportButton.addEventListener("click", async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !currentReport) throw new Error("No checked report.");
        await chrome.runtime.sendMessage({ type: "BUC_OPEN_FULL_REPORT_FROM_POPUP", sourceTab: tab.id });
    } catch (_error) {
        bucPopupShowError("Run a check in the open webmail tab before opening the full report.");
    }
});

bucPopupLoadStats();

(async function requestCurrentReport() {
    try {
        const report = await bucPopupMessageActiveTab({ type: "GET_LAST_REPORT" });
        if (report?.ok) await bucPopupShowReport(report);
    } catch (_error) {}
})();

(async function applyPopupAccessibility() {
    try {
        const preferences = await bucGetPreferences();
        bucApplyExtensionPagePreferences(preferences);
    } catch (_error) {}
})();
