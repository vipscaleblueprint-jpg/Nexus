// ============================================================
// FillNexusLinks.gs — Notes for Today
// Fills and auto-heals "Nexus Task Link" from "Clickup Task Link" by asking Nexus.
// ============================================================

const NEXUS_LINKS_URL = "https://nexus.server.vipscaleph.com/api/webhooks/sheets/nexus-links";
const NEXUS_LINK_SHEETS = ["2025", "Recurring", "Closed"];

/**
 * Normal 5-minute scheduled trigger:
 * 1. Fills blank rows (tasks just added to ClickUp).
 * 2. Self-heals active tasks: checks if any existing Nexus link was deleted/re-created in Nexus.
 */
function fillNexusLinks() {
    syncNexusLinks(false);
}

/**
 * Manual Full Refresh:
 * Select "refreshAllNexusLinks" from the Apps Script toolbar and click "Run".
 * Re-validates ALL rows across all tabs and overwrites any outdated/dead Nexus links.
 */
function refreshAllNexusLinks() {
    Logger.log("Starting full refresh of all Nexus links across all tabs...");
    syncNexusLinks(true);
    Logger.log("Full refresh completed.");
}

function syncNexusLinks(forceRefreshAll) {
    const key = PropertiesService.getScriptProperties().getProperty("NEXUS_API_KEY");
    if (!key) throw new Error("Add NEXUS_API_KEY in Project Settings → Script properties");
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    NEXUS_LINK_SHEETS.forEach(name => {
        const sheet = ss.getSheetByName(name);
        if (!sheet || sheet.getLastRow() < 2) return;
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const cuCol = headers.indexOf("Clickup Task Link") + 1;
        const nxCol = headers.indexOf("Nexus Task Link") + 1;
        if (!cuCol || !nxCol) { Logger.log(`${name}: missing a link column`); return; }

        const rows = sheet.getLastRow() - 1;
        const cu = sheet.getRange(2, cuCol, rows, 1).getDisplayValues();
        const nx = sheet.getRange(2, nxCol, rows, 1).getDisplayValues();

        // If forceRefreshAll is true: query all rows with a ClickUp link.
        // Otherwise: query blank rows + check active "2025" tab to catch re-created/deleted tasks.
        const shouldCheckRow = (r, i) => {
            const hasCu = Boolean(r[0] && r[0].trim());
            if (!hasCu) return false;
            if (forceRefreshAll) return true;
            const isBlank = !nx[i][0] || !nx[i][0].trim();
            // On regular runs, always check blanks, plus active "2025" tasks to keep them synchronized
            return isBlank || name === "2025";
        };

        const targetLinks = [...new Set(cu.map((r, i) => shouldCheckRow(r, i) ? r[0].trim() : null).filter(Boolean))];
        if (!targetLinks.length) return;

        const found = {};
        for (let i = 0; i < targetLinks.length; i += 500) {
            const batch = targetLinks.slice(i, i + 500);
            const res = UrlFetchApp.fetch(NEXUS_LINKS_URL, {
                method: "post",
                contentType: "application/json",
                muteHttpExceptions: true,
                headers: { "x-api-key": key },
                payload: JSON.stringify({ clickup_links: batch })
            });
            if (res.getResponseCode() !== 200) {
                Logger.log(`${name}: ${res.getContentText()}`);
                return;
            }
            Object.assign(found, JSON.parse(res.getContentText()).links);
        }

        let filled = 0;
        let updated = 0;

        cu.forEach((r, i) => {
            const freshLink = found[r[0].trim()];
            if (!freshLink) return;

            const currentLink = (nx[i][0] || "").trim();
            const row = i + 2;

            // Rows can be re-sorted mid-run: confirm row still holds this ClickUp task
            if (sheet.getRange(row, cuCol).getDisplayValue().trim() !== r[0].trim()) return;

            if (!currentLink) {
                sheet.getRange(row, nxCol).setValue(freshLink);
                filled++;
            } else if (currentLink !== freshLink) {
                // Self-healing: if the task was deleted and re-created in Nexus, update to the live link!
                sheet.getRange(row, nxCol).setValue(freshLink);
                Logger.log(`[${name}] Row ${row}: Updated outdated link (${currentLink}) -> (${freshLink})`);
                updated++;
            }
        });

        Logger.log(`${name}: filled ${filled} new link(s), self-healed/updated ${updated} link(s).`);
    });
}

function installNexusLinkTrigger() {
    ScriptApp.getProjectTriggers()
        .filter(t => t.getHandlerFunction() === "fillNexusLinks")
        .forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger("fillNexusLinks").timeBased().everyMinutes(5).create();
}

