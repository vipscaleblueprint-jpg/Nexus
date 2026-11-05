/**
 * JOINMATCH
 * For each ID in mainRange, finds matches in matchRange, returns unique values from returnRange, joined by comma.
 *
 * @param {A1:A} mainRange The list of IDs to look up.
 * @param {A1:A} matchRange The range to match against.
 * @param {B1:B} returnRange The values to return.
 * @return A 1D array of joined strings.
 */

function JOINMATCH(mainRange, matchRange, returnRange) {
    // Flatten input ranges
    mainRange = mainRange.flat();
    matchRange = matchRange.flat();
    returnRange = returnRange.flat();

    return mainRange.map(id => {
        if (!id) return ""; // Skip blanks
        const matches = matchRange
            .map((val, i) => val === id ? returnRange[i] : "")
            .filter(val => val !== "");
        const uniqueMatches = [...new Set(matches)];
        return uniqueMatches.join(", ");
    });
}

/**
 * Watch the sheet changes and send the updated row
 */

function onEdit(e) {

    /**
    * Cannot change value to In Review or Checking if Deliverables is Empty
    */
    var sheet = e.source.getActiveSheet();
    var range = e.range;

    if (range.getColumn() === 9) {
        var newValue = range.getValue();
        var row = range.getRow();
        var colK = sheet.getRange(row, 11).getValue(); // Column K

        if ((newValue === "In Review" || newValue === "Checking") && colK === "") {
            SpreadsheetApp.getUi().alert(
                "You cannot set to 'In Review' or 'Checking' if Deliverables is empty."
            );
            range.setValue("In Progress");
        }
    }

    /**
    * Cascade On-Hold to subtasks when parent is set On-Hold,
    * and restore subtasks when parent leaves On-Hold
    */
    if (range.getColumn() === 9) {
        var newValue = range.getValue().toString().trim().toLowerCase();
        var oldValue = (e.oldValue || "").toString().trim().toLowerCase();

        var isNewOnHold = (newValue === "on-hold" || newValue === "on hold");
        var wasOnHold = (oldValue === "on-hold" || oldValue === "on hold");

        if (isNewOnHold) {
            cascadeOnHoldToSubtasks_(sheet, range.getRow());
        } else if (wasOnHold && !isNewOnHold) {
            cascadeRestoreSubtasksFromHold_(sheet, range.getRow(), range.getValue());
        }
    }

    // Cascade Close to subtasks when parent is set Closed,
    // and restore subtasks when parent leaves Closed
    if (range.getColumn() === 9) {
        var newValue = range.getValue().toString().trim().toLowerCase();
        var oldValue = (e.oldValue || "").toString().trim().toLowerCase();

        var isNewClosed = (newValue === "closed");
        var wasClosed = (oldValue === "closed");

        if (isNewClosed) {
            cascadeCloseToSubtasks_(sheet, range.getRow());
        } else if (wasClosed && !isNewClosed) {
            cascadeRestoreSubtasksFromClosed_(sheet, range.getRow(), range.getValue());
        }
    }

    /**
    * Cannot change value to Checking if it is not Urgent or Important
    */
    var sheet = e.source.getActiveSheet();
    var range = e.range;

    if (range.getColumn() === 9) { // Column I
        var newValue = range.getValue();
        var row = range.getRow();

        var colF = sheet.getRange(row, 6).getValue().toString().trim().toUpperCase(); // Column F
        var colH = sheet.getRange(row, 8).getValue().toString().trim().toUpperCase(); // Column H

        Logger.log("Priority (Col F): " + colF);
        Logger.log("Complexity (Col H): " + colH);
        Logger.log("New Value: " + newValue);

        if (newValue === "Checking" || newValue === "CHECKING") {
            if (!(
                (colF === "URGENT") ||
                (colH === "IMPORTANT")
            )) {
                SpreadsheetApp.getUi().alert(
                    "❌ You cannot set to 'Checking' unless:\n" +
                    "- Priority is 'URGENT' OR\n" +
                    "- Complexity is 'IMPORTANT'.\n\n" +
                    "The value has been changed to 'In Review'."
                );
                range.setValue("In Review");
            }
        }
    }


    /**
    * N8N Automation
    */
    try {
        const sheet = e.source.getActiveSheet();
        const sheetName = sheet.getName();

        // ✅ Only run on the "2025" or "Closed" sheets
        if (sheetName !== "2025" && sheetName !== "Closed") return;

        const range = e.range;
        const row = range.getRow();
        const col = range.getColumn();

        // ✅ Get headers and find "Status" and "Comment" column indices
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const statusColIndex = headers.indexOf("Status") + 1;
        const commentColIndex = 11; // Column K

        // ✅ Determine if this is a comment edit (Column K)
        const isCommentEdit = col === commentColIndex && row > 1;

        // ✅ Only proceed if edited cell is Status column OR Column K
        if (col !== statusColIndex && !isCommentEdit) return;
        if (row === 1) return; // Skip header row

        // ⏳ Wait 10 seconds before continuing
        Utilities.sleep(10000);

        // 📦 Get row data
        const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
        const data = {};
        headers.forEach((key, i) => data[key] = rowData[i]);

        // ✅ Add isComment flag if Column K was edited
        // ✅ Add isComment flag only if Column K value is a link
        if (isCommentEdit) {
            const colKValue = sheet.getRange(row, commentColIndex).getValue().toString().trim();
            const isLink = /^https?:\/\//i.test(colKValue);
            data.isComment = isLink ? true : false;
        }

        // 🛰️ Send webhook
        const url = "https://n8n.heysnaply.com/webhook/update-clickup-comment";
        const options = {
            method: "POST",
            contentType: "application/json",
            payload: JSON.stringify(data),
            muteHttpExceptions: true
        };

        const response = UrlFetchApp.fetch(url, options);
        Logger.log("Response Code: " + response.getResponseCode());
        Logger.log("Response Body: " + response.getContentText());

        // 📥 Update cache in hidden sheet (only for Status edits)
        if (!isCommentEdit) {
            const currentStatus = sheet.getRange(row, statusColIndex).getValue();
            const cacheSheetName = '_prevStatusCache';
            let cacheSheet = e.source.getSheetByName(cacheSheetName);
            if (!cacheSheet) {
                cacheSheet = e.source.insertSheet(cacheSheetName);
                cacheSheet.hideSheet();
            }

            if (cacheSheet.getMaxRows() < row) {
                cacheSheet.insertRowsAfter(cacheSheet.getMaxRows(), row - cacheSheet.getMaxRows());
            }

            cacheSheet.getRange(row, 1).setValue(currentStatus);
        }

    } catch (error) {
        Logger.log("❌ Error: " + error);
    }
}
/*
function watchAssignee(e) {
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  const allowedSheets = ['2025', '2026', 'Closed'];

  // Proceed only if the sheet name is in the allowed list
  if (!allowedSheets.includes(sheetName)) return;

  const range = e.range;

  // Check if the edited column is G (column 7)
  if (range.getColumn() === 7) {
    const rowIndex = range.getRow();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowData = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];

    // Build payload: header as key, row value as value
    const payload = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i].toLowerCase().replace(/\s+/g, '_');
      const value = rowData[i];
      payload[key] = value;
    }

    // Send POST request
    const url = "https://n8n.srv931715.hstgr.cloud/webhook/update-clickup/assignee";
    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload)
    };

    UrlFetchApp.fetch(url, options);
  }
} */




function sortMultiColumns() {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("2025");
    if (!sheet) {
        Logger.log("Sheet named '2025' not found!");
        return;
    }
    var lastRow = sheet.getRange("A:A").getLastRow();
    if (lastRow <= 2) {
        Logger.log("No data to sort!");
        return;
    }
    if (sheet.getFilter()) {
        sheet.getFilter().remove();
    }
    sortWithParentGrouping("2025");
    Logger.log("Sorted '2025' rows 3 to " + lastRow + " with parent/subtask grouping.");

    var recSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Recurring");
    if (recSheet) {
        if (recSheet.getFilter()) {
            recSheet.getFilter().remove();
        }
        sortWithParentGrouping("Recurring");
        Logger.log("Sorted 'Recurring' with parent/subtask grouping.");
    }
}

function runScheduledTasks() {
    sortMultiColumns();
    moveClosedRows();
    moveRecurringRows();
    cascadeReopenSubtasksInClosed_();
    moveUpdatedClosedRows();
    moveUpdatedRecurringRows();
    cascadeOnHoldSweep_("2025");
    cascadeOnHoldSweep_("Recurring");
    previewDuplicates();
    moveDuplicatesToDeletedTab();
    sortWithParentGrouping("2025");
    sortWithParentGrouping("Recurring");
}

function createTimeTrigger() {
    // Delete existing triggers for this function
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === "runScheduledTasks") {
            ScriptApp.deleteTrigger(triggers[i]);
        }
    }

    // Create new time-based trigger to run every 30 minutes
    ScriptApp.newTrigger("runScheduledTasks")
        .timeBased()
        .everyMinutes(15)
        .create();
}


// 2025 -> Closed (status set to Closed)
function moveClosedRows() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sourceSheet = ss.getSheetByName("2025");
    var targetSheet = ss.getSheetByName("Closed");
    if (!sourceSheet || !targetSheet) { Logger.log("Sheet not found!"); return; }

    var lastRow = sourceSheet.getLastRow();
    var lastCol = sourceSheet.getLastColumn();
    if (lastRow < 2) { Logger.log("No data to process."); return; }

    var sourceHeaders = sourceSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var targetHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
    var statusCol = sourceHeaders.indexOf("Status");

    var data = sourceSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var rowsToMove = [];
    var removedIdx = [];

    for (var i = 0; i < data.length; i++) {
        var status = (data[i][statusCol] || "").toString().trim().toLowerCase();
        if (status === "closed") {
            rowsToMove.push(mapRowToHeaders_(sourceHeaders, data[i], targetHeaders));
            removedIdx.push(i);
        }
    }
    if (rowsToMove.length === 0) { Logger.log("No rows to move."); return; }

    targetSheet.insertRows(2, rowsToMove.length);
    targetSheet.getRange(2, 1, rowsToMove.length, targetHeaders.length).setValues(rowsToMove);

    for (var j = removedIdx.length - 1; j >= 0; j--) sourceSheet.deleteRow(removedIdx[j] + 2);
    Logger.log("Moved " + rowsToMove.length + " rows to 'Closed' at row 2.");
}

// 2025 -> Recurring (status set to Daily/Weekly/Monthly)
function moveRecurringRows() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sourceSheet = ss.getSheetByName("2025");
    var targetSheet = ss.getSheetByName("Recurring");
    if (!sourceSheet || !targetSheet) { Logger.log("Sheet not found!"); return; }

    var lastRow = sourceSheet.getLastRow();
    var lastCol = sourceSheet.getLastColumn();
    if (lastRow < 2) { Logger.log("No data to process."); return; }

    var sourceHeaders = sourceSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var targetHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
    var statusCol = sourceHeaders.indexOf("Status");

    var data = sourceSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var validStatuses = ["daily", "weekly", "monthly"];
    var rowsToMove = [];
    var removedIdx = [];

    for (var i = 0; i < data.length; i++) {
        var status = (data[i][statusCol] || "").toString().trim().toLowerCase();
        if (validStatuses.indexOf(status) > -1) {
            rowsToMove.push(mapRowToHeaders_(sourceHeaders, data[i], targetHeaders));
            removedIdx.push(i);
        }
    }
    if (rowsToMove.length === 0) { Logger.log("No rows to move."); return; }

    targetSheet.insertRows(2, rowsToMove.length);
    targetSheet.getRange(2, 1, rowsToMove.length, targetHeaders.length).setValues(rowsToMove);

    for (var j = removedIdx.length - 1; j >= 0; j--) sourceSheet.deleteRow(removedIdx[j] + 2);
    Logger.log("Moved " + rowsToMove.length + " rows to 'Recurring' at row 2.");
}

// Closed -> 2025 (task reopened)
function moveUpdatedClosedRows() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sourceSheet = ss.getSheetByName("Closed");
    var targetSheet = ss.getSheetByName("2025");
    if (!sourceSheet || !targetSheet) { Logger.log("Sheet not found!"); return; }

    var lastRow = sourceSheet.getLastRow();
    var lastCol = sourceSheet.getLastColumn();
    if (lastRow < 2) { Logger.log("No data to process."); return; }

    var sourceHeaders = sourceSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var targetHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
    var statusCol = sourceHeaders.indexOf("Status");

    var data = sourceSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var rowsToMove = [];
    var removedIdx = [];

    for (var i = 0; i < data.length; i++) {
        var status = data[i][statusCol] ? data[i][statusCol].toString().trim().toLowerCase() : "";
        // Only move rows with a real, non-closed status — skip blanks so old/untouched
        // rows in Closed don't get swept into 2025 by accident.
        if (status !== "" && status !== "closed") {
            rowsToMove.push(mapRowToHeaders_(sourceHeaders, data[i], targetHeaders));
            removedIdx.push(i);
        }
    }
    if (rowsToMove.length === 0) { Logger.log("No rows to move back."); return; }

    targetSheet.insertRows(2, rowsToMove.length);
    targetSheet.getRange(2, 1, rowsToMove.length, targetHeaders.length).setValues(rowsToMove);

    for (var j = removedIdx.length - 1; j >= 0; j--) sourceSheet.deleteRow(removedIdx[j] + 2);
    Logger.log("Moved " + rowsToMove.length + " rows back to '2025' at row 2.");
}

const SUPABASE_URL = "https://qiavwjheyschrfeaqply.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpYXZ3amhleXNjaHJmZWFxcGx5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzE3MzA3NCwiZXhwIjoyMDgyNzQ5MDc0fQ.6pFhthGxzoEbZaoyAb8pc8EhomXXm3AH1l0F2KXsIoc";

function syncTimeRecord() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Time Record");

    if (!sheet) {
        Logger.log("❌ Qick Tips sheet not found");
        return;
    }

    const data = sheet.getDataRange().getDisplayValues();
    const rows = data.slice(1);

    const records = rows
        .filter(row => row[0] && String(row[0]).trim() !== "")
        .map(row => ({
            id: String(row[0]).trim(),
            MA: String(row[1]).trim(),
            client: String(row[2]).trim(),
            date: String(row[3]).trim(),
            start: String(row[4]).trim(),
            end: String(row[5]).trim(),
            task: String(row[6]).trim(),
            description: String(row[7]).trim(),
            duration: String(row[8]).trim()
        }));


    if (records.length === 0) {
        Logger.log("⚠️ No data found in TimeRecord");
        return;
    }

    sendToSupabase("time_sheet", records, "id");
}


function sendToSupabase(table, records, conflictKey) {
    if (records.length === 0) {
        Logger.log(`⚠️ No data for ${table}`);
        return;
    }

    Logger.log(`📦 Syncing ${table}: ${JSON.stringify(records)}`);

    const response = UrlFetchApp.fetch(
        `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictKey}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Prefer": "resolution=merge-duplicates"
            },
            payload: JSON.stringify(records),
            muteHttpExceptions: true
        }
    );

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code === 200 || code === 201) {
        Logger.log(`✅ ${table} synced successfully`);
    } else {
        Logger.log(`❌ ERROR syncing ${table}: ${code}`);
        Logger.log(body);
    }
}

const TABS_TO_CHECK = [
    '2025',
    'Recurring',
    'Closed'
];

const KEY_HEADERS = ['Clickup Task Link'];
const AUDIT_TAB_NAME = 'Duplicate Audit';
const DELETED_TAB_NAME = 'Deleted';

/**
 * Finds the column index (1-based) for each header name in KEY_HEADERS,
 * by reading row 1 of the given sheet. Returns null if a header is
 * missing (so that tab gets skipped safely rather than mis-matching
 * the wrong column).
 */
function getKeyColumnIndexes_(sheet) {
    const lastCol = sheet.getLastColumn();
    const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const indexes = {};
    KEY_HEADERS.forEach(function (h) { indexes[h] = -1; });

    headerRow.forEach(function (val, i) {
        const clean = (val || '').toString().trim().toLowerCase();
        KEY_HEADERS.forEach(function (h) {
            if (clean === h.toLowerCase()) {
                indexes[h] = i + 1; // 1-based column index
            }
        });
    });

    const missing = KEY_HEADERS.filter(function (h) { return indexes[h] === -1; });
    if (missing.length > 0) {
        Logger.log('Skipping "' + sheet.getName() + '" — missing header(s): ' + missing.join(', '));
        return null;
    }
    return indexes;
}

/**
 * Scans one sheet and returns an array of duplicate-row info objects.
 * Keeps the FIRST occurrence of each key, flags every later row with
 * the same key as a duplicate to remove. Each result carries its own
 * header row alongside fullRow, so callers can copy by header name
 * instead of column position.
 */
function scanSheetForDuplicates_(sheet) {
    const cols = getKeyColumnIndexes_(sheet);
    if (!cols) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const linkCol = cols['Clickup Task Link'];
    const clientHeaderCol = getColIndexByHeader_(sheet, 'Client Name'); // for display only, not part of the match
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(function (h) { return (h || '').toString().trim(); });

    // Pull all data at once for speed
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const seen = {}; // key -> first row number (sheet row, 1-based)
    const duplicates = [];

    data.forEach(function (row, i) {
        const sheetRow = i + 2; // actual row number in the sheet
        const client = (row[clientHeaderCol - 1] || '').toString().trim();
        const link = (row[linkCol - 1] || '').toString().trim();

        // Skip rows with no task link — nothing reliable to compare
        if (!link) return;

        // Match is on the Clickup Task Link ALONE — if the same link shows
        // up more than once in this tab, it's a duplicate, regardless of
        // what's in Client Name.
        const key = link.toLowerCase();

        if (seen.hasOwnProperty(key)) {
            duplicates.push({
                tab: sheet.getName(),
                row: sheetRow,
                client: client,
                taskName: row[getColIndexByHeader_(sheet, 'Task Name') - 1] || '',
                link: link,
                keptRow: seen[key],
                fullRow: row,
                headers: headers
            });
        } else {
            seen[key] = sheetRow;
        }
    });

    return duplicates;
}

/**
 * Small helper to get a column index by header name (used for
 * grabbing "Task Name" for readability in the audit/log output).
 */
function getColIndexByHeader_(sheet, headerName) {
    const lastCol = sheet.getLastColumn();
    const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (let i = 0; i < headerRow.length; i++) {
        if ((headerRow[i] || '').toString().trim().toLowerCase() === headerName.toLowerCase()) {
            return i + 1;
        }
    }
    return 1; // fallback so callers don't crash
}

/**
 * STEP 1 — Run this first.
 * Scans all configured tabs and writes a report to the
 * "Duplicate Audit" tab. Makes NO changes to your actual data.
 */
function previewDuplicates() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let allDuplicates = [];

    TABS_TO_CHECK.forEach(function (tabName) {
        const sheet = ss.getSheetByName(tabName);
        if (!sheet) {
            Logger.log('Tab not found, skipping: ' + tabName);
            return;
        }
        const dups = scanSheetForDuplicates_(sheet);
        allDuplicates = allDuplicates.concat(dups);
    });

    // Build/reset the audit tab
    let auditSheet = ss.getSheetByName(AUDIT_TAB_NAME);
    if (auditSheet) {
        auditSheet.clear();
    } else {
        auditSheet = ss.insertSheet(AUDIT_TAB_NAME);
    }

    auditSheet.getRange(1, 1, 1, 6).setValues([[
        'Tab', 'Duplicate Row #', 'Kept Row #', 'Client Name', 'Task Name', 'Clickup Task Link'
    ]]).setFontWeight('bold');

    if (allDuplicates.length > 0) {
        const rows = allDuplicates.map(function (d) {
            return [d.tab, d.row, d.keptRow, d.client, d.taskName, d.link];
        });
        auditSheet.getRange(2, 1, rows.length, 6).setValues(rows);
    }

    auditSheet.autoResizeColumns(1, 6);

    const msg = allDuplicates.length + ' duplicate row(s) found across ' + TABS_TO_CHECK.length + ' tab(s). ' +
        'See the "' + AUDIT_TAB_NAME + '" tab for details. Run moveDuplicatesToDeletedTab() when ready to remove them.';
    Logger.log(msg);

    // Only show a UI alert when run manually (from the editor/menu) — a time
    // trigger has no UI and getUi() throws in that context.
    try {
        SpreadsheetApp.getUi().alert(msg);
    } catch (e) {
        // Running headlessly (time trigger) — Logger.log above already recorded it.
    }
}

/**
 * STEP 2 — Run this after reviewing the preview.
 * Moves duplicate rows (keeping the first/topmost occurrence of each
 * Clickup Task Link) out of the source tab and into the "Deleted" tab,
 * stamping each with today's date in the "Deleted Date" column.
 * Nothing is permanently lost — it's just relocated.
 *
 * Columns are matched by HEADER NAME between the source tab and the
 * Deleted tab, not by position — source and Deleted don't share the
 * same column order/count (e.g. Deleted has "Deleted Date" and
 * "Parent Task ID 2" that other tabs don't), so a positional copy
 * silently drops or misplaces columns like "Parent Task ID" and
 * "Pre-Hold Status". Any source header with no match in Deleted is
 * skipped; any Deleted column with no match in the source is left
 * blank for that row.
 */
function moveDuplicatesToDeletedTab() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const deletedSheet = ss.getSheetByName(DELETED_TAB_NAME);

    if (!deletedSheet) {
        Logger.log('Could not find a tab named "' + DELETED_TAB_NAME + '". Nothing was moved.');
        return;
    }

    const deletedHeaders = deletedSheet.getRange(1, 1, 1, deletedSheet.getLastColumn()).getValues()[0]
        .map(function (h) { return (h || '').toString().trim(); });
    const deletedDateCol = deletedHeaders.indexOf('Deleted Date'); // 0-based, -1 if missing

    let totalMoved = 0;
    const timestamp = new Date();

    TABS_TO_CHECK.forEach(function (tabName) {
        const sheet = ss.getSheetByName(tabName);
        if (!sheet) return;

        const dups = scanSheetForDuplicates_(sheet);
        if (dups.length === 0) return;

        const appendRows = dups.map(function (d) {
            const row = new Array(deletedHeaders.length).fill('');
            d.headers.forEach(function (header, i) {
                if (!header) return;
                const destCol = deletedHeaders.indexOf(header);
                if (destCol > -1) {
                    row[destCol] = d.fullRow[i];
                }
            });
            if (deletedDateCol > -1) {
                row[deletedDateCol] = timestamp;
            }
            return row;
        });

        const startRow = deletedSheet.getLastRow() + 1;
        deletedSheet.getRange(startRow, 1, appendRows.length, deletedHeaders.length).setValues(appendRows);

        // Remove rows from the source tab bottom-to-top so row numbers don't shift under us
        const rowsToRemove = dups.map(function (d) { return d.row; }).sort(function (a, b) { return b - a; });
        rowsToRemove.forEach(function (r) {
            sheet.deleteRow(r);
        });

        totalMoved += dups.length;
        Logger.log('Moved ' + dups.length + ' duplicate row(s) from "' + tabName + '" to "' + DELETED_TAB_NAME + '".');
    });

    const msg = totalMoved + ' duplicate row(s) moved into the "' + DELETED_TAB_NAME + '" tab.';
    Logger.log(msg);

    // Only show a UI alert when run manually (from the editor/menu) — a time
    // trigger has no UI and getUi() throws in that context.
    try {
        SpreadsheetApp.getUi().alert(msg);
    } catch (e) {
        // Running headlessly (time trigger) — Logger.log above already recorded it.
    }
}

function sortWithParentGrouping(sheetName) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 2) return;

    if (sheet.getFilter()) sheet.getFilter().remove();

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var parentIdCol = headers.indexOf("Parent Task ID"); // 0-based; -1 if missing

    var range = sheet.getRange(2, 1, lastRow - 1, lastCol); // data starts row 2
    var data = range.getValues();

    function extractTaskId(url) {
        if (!url) return "";
        var m = url.toString().match(/\/t\/([a-zA-Z0-9]+)/);
        return m ? m[1] : "";
    }

    var idToRow = {};
    data.forEach(function (row) {
        var id = extractTaskId(row[3]); // Column D: Clickup Task Link
        if (id) idToRow[id] = row;
    });

    var priorityRank = { "urgent": 4, "high": 3, "normal": 2, "a - low": 1 };
    function rankOf(row) {
        var p = (row[5] || "").toString().trim().toLowerCase(); // Column F: Priority
        return priorityRank.hasOwnProperty(p) ? priorityRank[p] : 0;
    }

    data.forEach(function (row) {
        var parentId = parentIdCol > -1 ? (row[parentIdCol] || "").toString().trim() : "";
        var isSubtask = !!(parentId && idToRow[parentId]);
        var effectiveRow = isSubtask ? idToRow[parentId] : row;

        row.__isSubtask = isSubtask;
        row.__rank = rankOf(effectiveRow);
        row.__groupId = isSubtask ? parentId : extractTaskId(row[3]);
    });

    var indexed = data.map(function (row, i) { return { row: row, origIndex: i }; });

    indexed.sort(function (a, b) {
        if (b.row.__rank !== a.row.__rank) return b.row.__rank - a.row.__rank;
        if (a.row.__groupId !== b.row.__groupId) return a.row.__groupId < b.row.__groupId ? -1 : 1;
        if (a.row.__isSubtask !== b.row.__isSubtask) return a.row.__isSubtask ? 1 : -1;
        return a.origIndex - b.origIndex;
    });

    var sortedData = indexed.map(function (item) { return item.row.slice(0, lastCol); });
    range.setValues(sortedData);
}

// Recurring -> 2025 (status no longer Daily/Weekly/Monthly)
function moveUpdatedRecurringRows() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sourceSheet = ss.getSheetByName("Recurring");
    var targetSheet = ss.getSheetByName("2025");
    if (!sourceSheet || !targetSheet) { Logger.log("Sheet not found!"); return; }

    var lastRow = sourceSheet.getLastRow();
    var lastCol = sourceSheet.getLastColumn();
    if (lastRow < 2) { Logger.log("No data to process."); return; }

    var sourceHeaders = sourceSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var targetHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
    var statusCol = sourceHeaders.indexOf("Status");

    var data = sourceSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var recurringStatuses = ["daily", "weekly", "monthly"];
    var rowsToMove = [];
    var removedIdx = [];

    for (var i = 0; i < data.length; i++) {
        var status = data[i][statusCol] ? data[i][statusCol].toString().trim().toLowerCase() : "";
        // Only move rows with a real status that's no longer Daily/Weekly/Monthly —
        // skip blanks so old/untouched rows in Recurring don't get swept into 2025 by accident.
        if (status !== "" && recurringStatuses.indexOf(status) === -1) {
            rowsToMove.push(mapRowToHeaders_(sourceHeaders, data[i], targetHeaders));
            removedIdx.push(i);
        }
    }
    if (rowsToMove.length === 0) { Logger.log("No rows to move back."); return; }

    targetSheet.insertRows(2, rowsToMove.length);
    targetSheet.getRange(2, 1, rowsToMove.length, targetHeaders.length).setValues(rowsToMove);

    for (var j = removedIdx.length - 1; j >= 0; j--) sourceSheet.deleteRow(removedIdx[j] + 2);
    Logger.log("Moved " + rowsToMove.length + " rows back to '2025' at row 2.");
}

function cascadeOnHoldToSubtasks_(sheet, parentRow) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var parentIdCol = headers.indexOf("Parent Task ID"); // 0-based
    var linkCol = 3; // Column D (Clickup Task Link), 0-based
    var statusCol = 9; // Column I (Status), 1-based
    var preHoldCol = headers.indexOf("Pre-Hold Status") + 1; // 1-based; 0 if missing
    if (preHoldCol === 0) {
        Logger.log("No 'Pre-Hold Status' column found — can't cascade On-Hold.");
        return;
    }

    if (parentIdCol === -1) {
        Logger.log("No 'Parent Task ID' column found — can't cascade On-Hold.");
        return;
    }

    var parentLink = sheet.getRange(parentRow, linkCol + 1).getValue().toString();
    var m = parentLink.match(/\/t\/([a-zA-Z0-9]+)/);
    var parentTaskId = m ? m[1] : "";
    if (!parentTaskId) return;

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (var i = 0; i < data.length; i++) {
        var rowParentId = (data[i][parentIdCol] || "").toString().trim();
        if (rowParentId === parentTaskId) {
            var sheetRow = i + 2;
            var currentStatus = sheet.getRange(sheetRow, statusCol).getValue();
            var existingPreHold = sheet.getRange(sheetRow, preHoldCol).getValue();

            // Only capture the "before" status the first time — don't overwrite
            // a saved status if this subtask was already on hold.
            if (!existingPreHold && currentStatus && currentStatus.toString().trim().toLowerCase() !== "on-hold" && currentStatus.toString().trim().toLowerCase() !== "on hold") {
                sheet.getRange(sheetRow, preHoldCol).setValue(currentStatus);
            }

            sheet.getRange(sheetRow, statusCol).setValue("On-Hold");
        }
    }
}

function cascadeRestoreSubtasksFromHold_(sheet, parentRow, fallbackStatus) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var parentIdCol = headers.indexOf("Parent Task ID"); // 0-based
    var linkCol = 3; // Column D (Clickup Task Link), 0-based
    var statusCol = 9; // Column I (Status), 1-based
    var preHoldCol = headers.indexOf("Pre-Hold Status") + 1; // 1-based; 0 if missing
    if (preHoldCol === 0) {
        Logger.log("No 'Pre-Hold Status' column found — can't restore from On-Hold.");
        return;
    }

    if (parentIdCol === -1) {
        Logger.log("No 'Parent Task ID' column found — can't restore from On-Hold.");
        return;
    }

    var parentLink = sheet.getRange(parentRow, linkCol + 1).getValue().toString();
    var m = parentLink.match(/\/t\/([a-zA-Z0-9]+)/);
    var parentTaskId = m ? m[1] : "";
    if (!parentTaskId) return;

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (var i = 0; i < data.length; i++) {
        var rowParentId = (data[i][parentIdCol] || "").toString().trim();
        if (rowParentId === parentTaskId) {
            var sheetRow = i + 2;
            var savedStatus = sheet.getRange(sheetRow, preHoldCol).getValue();

            if (savedStatus) {
                sheet.getRange(sheetRow, statusCol).setValue(savedStatus);
                sheet.getRange(sheetRow, preHoldCol).setValue(""); // clear it once restored
            } else if (fallbackStatus) {
                // No saved status (e.g. subtask was added while parent was already
                // on hold) — fall back to matching the parent's new status.
                sheet.getRange(sheetRow, statusCol).setValue(fallbackStatus);
            }
        }
    }
}

// Scheduled sweep: subtasks follow the parent when the parent is On-Hold or Checking,
// and go back to their saved status when the parent moves on.
function cascadeOnHoldSweep_(sheetName) {
    var CASCADE_STATUSES = ["on-hold", "checking"];

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) return;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(function (h) { return (h || "").toString().trim(); });
    var linkCol = headers.indexOf("Clickup Task Link");
    var parentIdCol = headers.indexOf("Parent Task ID");
    var statusCol = headers.indexOf("Status");
    var preHoldCol = headers.indexOf("Pre-Hold Status");
    if (linkCol === -1 || parentIdCol === -1 || statusCol === -1 || preHoldCol === -1) {
        Logger.log("Missing a required column in " + sheetName + " — can't run status sweep.");
        return;
    }

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    function extractTaskId(url) {
        var m = (url || "").toString().match(/\/t\/([a-zA-Z0-9]+)/);
        return m ? m[1] : "";
    }
    // Normalizes status text so "On Hold" and "on-hold" count as the same
    function key(s) {
        s = (s || "").toString().trim().toLowerCase();
        return s === "on hold" ? "on-hold" : s;
    }
    function isCascade(s) {
        return CASCADE_STATUSES.indexOf(key(s)) > -1;
    }

    var statusById = {};
    data.forEach(function (row) {
        var id = extractTaskId(row[linkCol]);
        if (id) statusById[id] = row[statusCol];
    });

    var count = 0;
    data.forEach(function (row, i) {
        var parentId = (row[parentIdCol] || "").toString().trim();
        if (!parentId || !statusById.hasOwnProperty(parentId)) return;

        var sheetRow = i + 2;
        var parentStatus = statusById[parentId];
        var own = row[statusCol];
        var saved = row[preHoldCol];

        if (isCascade(parentStatus)) {
            // Parent is On-Hold or Checking: match it (save the subtask's status first)
            if (key(own) === key(parentStatus)) return;
            if (!saved && own) sheet.getRange(sheetRow, preHoldCol + 1).setValue(own);
            sheet.getRange(sheetRow, statusCol + 1).setValue(parentStatus);
            count++;
        } else if (isCascade(own) && saved) {
            // Parent moved on: restore the saved status
            sheet.getRange(sheetRow, statusCol + 1).setValue(saved);
            sheet.getRange(sheetRow, preHoldCol + 1).setValue("");
            count++;
        }
    });

    if (count) Logger.log("Status sweep updated " + count + " subtask(s) in " + sheetName + ".");
}

// "Comments - Paul" (2025) and "Comments - Aish" (Closed) are the same
// field under different labels — without this alias, header-matching
// would treat them as unrelated and drop the value on every move.
var HEADER_ALIASES_ = [
    ['Comments - Paul', 'Comments - Aish']
];

function resolveAlias_(header) {
    var lower = header.toString().trim().toLowerCase();
    for (var i = 0; i < HEADER_ALIASES_.length; i++) {
        var a = HEADER_ALIASES_[i][0].toLowerCase();
        var b = HEADER_ALIASES_[i][1].toLowerCase();
        if (lower === a) return b;
        if (lower === b) return a;
    }
    return lower;
}

function mapRowToHeaders_(sourceHeaders, sourceRow, destHeaders) {
    var destRow = new Array(destHeaders.length).fill('');
    sourceHeaders.forEach(function (srcHeader, i) {
        if (!srcHeader) return;
        var srcLower = srcHeader.toString().trim().toLowerCase();
        var srcAlias = resolveAlias_(srcHeader);
        var destIndex = destHeaders.findIndex(function (h) {
            if (!h) return false;
            var hLower = h.toString().trim().toLowerCase();
            return hLower === srcLower || hLower === srcAlias;
        });
        if (destIndex > -1) destRow[destIndex] = sourceRow[i];
    });
    return destRow;
}

function cascadeCloseToSubtasks_(sheet, parentRow) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var parentIdCol = headers.indexOf("Parent Task ID"); // 0-based
    var linkCol = 3;   // Column D (Clickup Task Link), 0-based
    var statusCol = 9; // Column I (Status), 1-based
    var preCloseCol = headers.indexOf("Pre-Close Status") + 1; // 1-based; 0 if missing

    if (preCloseCol === 0) {
        Logger.log("No 'Pre-Close Status' column found — can't cascade Close.");
        return;
    }
    if (parentIdCol === -1) {
        Logger.log("No 'Parent Task ID' column found — can't cascade Close.");
        return;
    }

    var parentLink = sheet.getRange(parentRow, linkCol + 1).getValue().toString();
    var m = parentLink.match(/\/t\/([a-zA-Z0-9]+)/);
    var parentTaskId = m ? m[1] : "";
    if (!parentTaskId) return;

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (var i = 0; i < data.length; i++) {
        var rowParentId = (data[i][parentIdCol] || "").toString().trim();
        if (rowParentId === parentTaskId) {
            var sheetRow = i + 2;
            var currentStatus = sheet.getRange(sheetRow, statusCol).getValue();
            var existingPreClose = sheet.getRange(sheetRow, preCloseCol).getValue();

            // Remember the "before" status only the first time — don't overwrite
            // if this subtask was already saved/closed.
            if (!existingPreClose && currentStatus && currentStatus.toString().trim().toLowerCase() !== "closed") {
                sheet.getRange(sheetRow, preCloseCol).setValue(currentStatus);
            }

            sheet.getRange(sheetRow, statusCol).setValue("Closed");
        }
    }
}

function cascadeRestoreSubtasksFromClosed_(sheet, parentRow, fallbackStatus) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var parentIdCol = headers.indexOf("Parent Task ID"); // 0-based
    var linkCol = 3;   // Column D (Clickup Task Link), 0-based
    var statusCol = 9; // Column I (Status), 1-based
    var preCloseCol = headers.indexOf("Pre-Close Status") + 1; // 1-based; 0 if missing

    if (preCloseCol === 0) {
        Logger.log("No 'Pre-Close Status' column found — can't restore from Closed.");
        return;
    }
    if (parentIdCol === -1) {
        Logger.log("No 'Parent Task ID' column found — can't restore from Closed.");
        return;
    }

    var parentLink = sheet.getRange(parentRow, linkCol + 1).getValue().toString();
    var m = parentLink.match(/\/t\/([a-zA-Z0-9]+)/);
    var parentTaskId = m ? m[1] : "";
    if (!parentTaskId) return;

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (var i = 0; i < data.length; i++) {
        var rowParentId = (data[i][parentIdCol] || "").toString().trim();
        if (rowParentId === parentTaskId) {
            var sheetRow = i + 2;
            var savedStatus = sheet.getRange(sheetRow, preCloseCol).getValue();

            if (savedStatus) {
                sheet.getRange(sheetRow, statusCol).setValue(savedStatus);
                sheet.getRange(sheetRow, preCloseCol).setValue(""); // clear once restored
            } else if (fallbackStatus) {
                // No saved status (e.g. subtask added while parent was already closed)
                // — fall back to matching the parent's new status.
                sheet.getRange(sheetRow, statusCol).setValue(fallbackStatus);
            }
        }
    }
}

function cascadeReopenSubtasksInClosed_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Closed");
    if (!sheet) { Logger.log("Closed sheet not found."); return; }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) return;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var linkCol = headers.indexOf("Clickup Task Link");
    var parentIdCol = headers.indexOf("Parent Task ID");
    var statusCol = headers.indexOf("Status");
    var preCloseCol = headers.indexOf("Pre-Close Status");

    if (linkCol === -1 || parentIdCol === -1 || statusCol === -1 || preCloseCol === -1) {
        Logger.log("Missing a required column in Closed — can't cascade reopen.");
        return;
    }

    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    function extractTaskId(url) {
        if (!url) return "";
        var m = url.toString().match(/\/t\/([a-zA-Z0-9]+)/);
        return m ? m[1] : "";
    }

    // Map: parent task ID -> parent's current Status text (as-is, for use as fallback)
    var statusByTaskId = {};
    data.forEach(function (row) {
        var id = extractTaskId(row[linkCol]);
        if (id) statusByTaskId[id] = (row[statusCol] || "").toString();
    });

    var updates = [];

    for (var i = 0; i < data.length; i++) {
        var row = data[i];
        var parentId = (row[parentIdCol] || "").toString().trim();
        if (!parentId) continue; // not a subtask

        var parentStatusRaw = statusByTaskId[parentId];
        if (parentStatusRaw === undefined) continue; // parent isn't in Closed right now
        var parentStatus = parentStatusRaw.trim().toLowerCase();

        var ownStatus = (row[statusCol] || "").toString().trim().toLowerCase();

        // Only act on subtasks still marked Closed whose parent has already moved on
        if (ownStatus === "closed" && parentStatus !== "closed") {
            var sheetRow = i + 2;
            var savedStatus = row[preCloseCol];
            var restoreStatus = savedStatus ? savedStatus : parentStatusRaw; // fallback: match parent's new status
            updates.push({ row: sheetRow, status: restoreStatus, clear: !!savedStatus });
        }
    }

    updates.forEach(function (u) {
        sheet.getRange(u.row, statusCol + 1).setValue(u.status);
        if (u.clear) sheet.getRange(u.row, preCloseCol + 1).setValue("");
    });

    if (updates.length > 0) {
        Logger.log("Promoted " + updates.length + " subtask row(s) in Closed ahead of the sweep.");
    }
}

// Fills "Nexus Task Link" from "Clickup Task Link" by asking Nexus.
// Blank rows (task not in Nexus yet) are retried on the next run.
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

        const shouldCheckRow = (r, i) => {
            const hasCu = Boolean(r[0] && r[0].trim());
            if (!hasCu) return false;
            if (forceRefreshAll) return true;
            const isBlank = !nx[i][0] || !nx[i][0].trim();
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

            if (sheet.getRange(row, cuCol).getDisplayValue().trim() !== r[0].trim()) return;

            if (!currentLink) {
                sheet.getRange(row, nxCol).setValue(freshLink);
                filled++;
            } else if (currentLink !== freshLink) {
                sheet.getRange(row, nxCol).setValue(freshLink);
                Logger.log(`[${name}] Row ${row}: Updated outdated link (${currentLink}) -> (${freshLink})`);
                updated++;
            }
        });

        Logger.log(`${name}: filled ${filled} new link(s), self-healed/updated ${updated} link(s).`);
    });
}

function legacyFillNexusLinks() {
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
        const missing = [...new Set(cu.map((r, i) => (!nx[i][0] && r[0].trim()) ? r[0].trim() : null).filter(Boolean))];
        if (!missing.length) return;

        const found = {};
        for (let i = 0; i < missing.length; i += 500) {
            const res = UrlFetchApp.fetch(NEXUS_LINKS_URL, {
                method: "post", contentType: "application/json", muteHttpExceptions: true,
                headers: { "x-api-key": key },
                payload: JSON.stringify({ clickup_links: missing.slice(i, i + 500) })
            });
            if (res.getResponseCode() !== 200) { Logger.log(`${name}: ${res.getContentText()}`); return; }
            Object.assign(found, JSON.parse(res.getContentText()).links);
        }

        let filled = 0;
        cu.forEach((r, i) => {
            const link = found[r[0].trim()];
            if (nx[i][0] || !link) return;
            const row = i + 2;
            // Rows can be re-sorted by other scripts mid-run: only write if the row still holds that task.
            if (sheet.getRange(row, cuCol).getDisplayValue().trim() !== r[0].trim()) return;
            sheet.getRange(row, nxCol).setValue(link);
            filled++;
        });
        Logger.log(`${name}: filled ${filled} Nexus link(s)`);
    });
}

function installNexusLinkTrigger() {
    ScriptApp.getProjectTriggers()
        .filter(t => t.getHandlerFunction() === "fillNexusLinks")
        .forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger("fillNexusLinks").timeBased().everyMinutes(5).create();
}
