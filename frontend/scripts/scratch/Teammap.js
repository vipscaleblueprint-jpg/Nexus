/**
 * UPWORK TIME TRACKER (no sidebar)
 * START -> red cell: UPWORK ACTIVE (since 9:16 PM · 0h 07m 23s)  (self-updating formula)
 * STOP  -> green cell: AVAILABLE UPWORK
 */

var SHEET_NAME = ""; // Blank = first sheet tab
var STATUS_ROW = 1;
var STATUS_COL = 1;

var SUPABASE_URL = "https://rryztbuirxbbvmmraggv.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyeXp0YnVpcnhiYnZtbXJhZ2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNzMzNzYsImV4cCI6MjEwMTc0OTM3Nn0.rI2OVTiQ--VGGkRHDEPsLtSURvXS35fags8ejAA69bw";
var TABLE_NAME = "upwork_status";
var USE_SUPABASE = false;

// ---------- helpers ----------
function getSheet() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error("Cannot access the active spreadsheet.");
    if (!SHEET_NAME || SHEET_NAME.trim() === "") return ss.getSheets()[0];
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');
    return sheet;
}
function getStatusCell() { return getSheet().getRange(STATUS_ROW, STATUS_COL); }
function getTrackerProperties() { return PropertiesService.getScriptProperties(); }

function parseTimestamp(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}
function pad(v) { return v < 10 ? "0" + v : String(v); }
function formatDuration(totalSeconds) {
    var t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return pad(Math.floor(t / 3600)) + ":" + pad(Math.floor((t % 3600) / 60)) + ":" + pad(t % 60);
}
function jsonResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

// Self-updating formula: UPWORK ACTIVE (since 9:16 PM · 0h 07m 23s)
function buildTimerFormula(startDate) {
    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    var p = Utilities.formatDate(startDate, tz, "yyyy,M,d,H,m,s").split(",");
    var start = "DATE(" + p[0] + "," + p[1] + "," + p[2] + ")+TIME(" + p[3] + "," + p[4] + "," + p[5] + ")";
    return '=LET(s,' + start + ',t,MAX(0,INT(ROUND((NOW()-s)*86400,2))),' +
        '"UPWORK ACTIVE (since "&TEXT(s,"h:mm AM/PM")&" · "&INT(t/3600)&"h "&TEXT(MOD(INT(t/60),60),"00")&"m "&TEXT(MOD(t,60),"00")&"s)")';
}

function styleCell(cell, bg) {
    cell.setBackground(bg).setFontColor("#FFFFFF").setFontWeight("bold")
        .setFontSize(12).setHorizontalAlignment("center").setVerticalAlignment("middle");
}

// ---------- web app ----------
function doPost(e) {
    try {
        if (!e || !e.postData || !e.postData.contents) throw new Error("Missing POST request body.");
        var body = JSON.parse(e.postData.contents);
        var status = String(body.status || "").toUpperCase();

        if (status === "START") {
            var startedAt = parseTimestamp(body.started_at) || new Date();
            setStarted(startedAt);
            if (USE_SUPABASE) logToSupabase("START", startedAt.toISOString(), null, null);
            return jsonResponse({ ok: true, status: "START", started_at: startedAt.toISOString() });
        }

        if (status === "STOP") {
            var stoppedAt = parseTimestamp(body.stopped_at) || new Date();
            var startISO = getTrackerProperties().getProperty("UPWORK_STARTED_AT");
            var durationS = setStopped(stoppedAt, body.duration_s);
            if (USE_SUPABASE) logToSupabase("STOP", startISO, stoppedAt.toISOString(), durationS);
            return jsonResponse({ ok: true, status: "STOP", stopped_at: stoppedAt.toISOString(), duration_s: durationS });
        }

        return jsonResponse({ ok: false, error: "Unknown status: " + status });
    } catch (err) {
        Logger.log("doPost error: " + err);
        return jsonResponse({ ok: false, error: String(err) });
    }
}

function doGet() {
    try {
        var props = getTrackerProperties();
        return jsonResponse({
            ok: true,
            message: "Upwork Tracker Web App is running",
            sheet_name: getSheet().getName(),
            current_cell_value: getStatusCell().getDisplayValue(),
            active: props.getProperty("UPWORK_ACTIVE") === "true",
            started_at: props.getProperty("UPWORK_STARTED_AT"),
            stopped_at: props.getProperty("UPWORK_STOPPED_AT")
        });
    } catch (err) {
        return jsonResponse({ ok: false, error: String(err) });
    }
}

// ---------- START ----------
function setStarted(startedAt) {
    var startDate = parseTimestamp(startedAt) || new Date();
    var startISO = startDate.toISOString();

    getTrackerProperties().setProperties({
        UPWORK_ACTIVE: "true",
        UPWORK_STARTED_AT: startISO,
        UPWORK_STOPPED_AT: "",
        UPWORK_LAST_DURATION: "0"
    });

    var cell = getStatusCell();
    styleCell(cell, "#FF0000");
    cell.setFormula(buildTimerFormula(startDate)); // self-updating, no sidebar needed
    SpreadsheetApp.flush();
    return startISO;
}

// ---------- STOP ----------
function setStopped(stoppedAt, durationS) {
    var props = getTrackerProperties();
    var stopDate = parseTimestamp(stoppedAt) || new Date();
    var startDate = parseTimestamp(props.getProperty("UPWORK_STARTED_AT"));

    var supplied = durationS !== null && durationS !== undefined && durationS !== "";
    var duration;
    if (supplied && isFinite(Number(durationS))) {
        duration = Math.max(0, Math.floor(Number(durationS)));
    } else if (startDate) {
        duration = Math.max(0, Math.floor((stopDate.getTime() - startDate.getTime()) / 1000));
    } else {
        duration = 0;
    }

    props.setProperties({
        UPWORK_ACTIVE: "false",
        UPWORK_STOPPED_AT: stopDate.toISOString(),
        UPWORK_LAST_DURATION: String(duration)
    });

    var cell = getStatusCell();
    styleCell(cell, "#00AA00");
    cell.setValue("AVAILABLE UPWORK");
    SpreadsheetApp.flush();
    return duration;
}

// ---------- menu ----------
function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu("Upwork Tracker")
        .addItem("Manual START (test)", "manualStart")
        .addItem("Manual STOP (test)", "manualStop")
        .addItem("Show current sheet name", "showSheetName")
        .addItem("Show Web App URL", "showWebAppUrl")
        .addToUi();
}
function manualStart() {
    setStarted(new Date());
    SpreadsheetApp.getActiveSpreadsheet().toast("Tracking started", "Upwork Tracker", 4);
}
function manualStop() {
    setStopped(new Date(), null);
    SpreadsheetApp.getActiveSpreadsheet().toast("Tracking stopped", "Upwork Tracker", 4);
}
function showSheetName() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    SpreadsheetApp.getUi().alert("Sheet Names",
        "Active sheet: " + ss.getActiveSheet().getName() +
        "\nAll tabs: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", ") +
        "\nTracker sheet: " + getSheet().getName(),
        SpreadsheetApp.getUi().ButtonSet.OK);
}
function showWebAppUrl() {
    SpreadsheetApp.getUi().alert("Web App URL",
        "Copy this URL into your Python config:\n\n" + ScriptApp.getService().getUrl(),
        SpreadsheetApp.getUi().ButtonSet.OK);
}

// ---------- optional Supabase ----------
function logToSupabase(status, startedAt, stoppedAt, durationS) {
    try {
        var payload = { status: status };
        if (startedAt) payload.started_at = startedAt;
        if (stoppedAt) payload.stopped_at = stoppedAt;
        if (durationS != null) payload.duration_s = durationS;
        var r = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/" + TABLE_NAME, {
            method: "post",
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: "Bearer " + SUPABASE_ANON_KEY,
                "Content-Type": "application/json",
                Prefer: "return=minimal"
            },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });
        Logger.log("Supabase HTTP status: " + r.getResponseCode());
    } catch (err) {
        Logger.log("Supabase error: " + err);
    }
}





const CONFIG = {
    SHEET_NAME: 'Tasks',                      // your tab name
    HEADER_CELL: 'A1',                        // top-left cell of the merged row 1 banner
    HEADER_RANGE: 'A1:N1',                    // whole banner, for colouring
    NAME_ROW: 2,                              // row with HanChePau, Shemuel, Nyrry...
    FIRST_DATA_ROW: 4,                        // first task row
    STATUS_COLUMNS: [2, 4, 6, 8, 10, 12, 14], // B, D, F, H, J, L, N
    TRIGGER_VALUE: 'UPWORK ACTIVE',           // used by columns D-N
    NAMED_PATTERN: /^UPWORK\s*\|\s*(.+)$/i,   // "UPWORK | HANNAH" -> HANNAH
    IDLE_TEXT: 'UPWORK AVAILABLE',
    ACTIVE_BG: '#cc0000',                     // red   = Upwork in use
    IDLE_BG: '#0b8043',                       // green = Upwork available
    FONT_COLOR: '#ffffff',
};

const PROP_START_PREFIX = 'START_';

/** Run once: installs the 1-minute timer that keeps the elapsed time ticking. */
function setup() {
    ScriptApp.getProjectTriggers()
        .filter(t => t.getHandlerFunction() === 'refreshBanner')
        .forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('refreshBanner').timeBased().everyMinutes(1).create();
    refreshBanner();
}

/** Simple trigger: fires whenever someone edits the sheet. */
function onEdit(e) {
    if (!e || e.range.getSheet().getName() !== CONFIG.SHEET_NAME) return;
    const r = e.range;
    const touchesStatus = CONFIG.STATUS_COLUMNS.some(
        c => c >= r.getColumn() && c <= r.getLastColumn()
    );
    if (touchesStatus && r.getLastRow() >= CONFIG.FIRST_DATA_ROW) refreshBanner();
}

/** Returns the names on Upwork in one cell (handles multi-select dropdowns). */
function upworkNamesInCell_(value, columnName) {
    const names = [];
    String(value).split(',').forEach(part => {
        const p = part.trim();
        if (!p) return;
        if (p.toUpperCase() === CONFIG.TRIGGER_VALUE) {
            names.push(columnName);
        } else {
            const m = p.match(CONFIG.NAMED_PATTERN);
            if (m && m[1].trim().toUpperCase() !== 'ACTIVE') names.push(m[1].trim().toUpperCase());
        }
    });
    return names;
}

/** Scans every Status column, then updates row 1 text + colour. */
function refreshBanner() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return;
    try {
        const sheet = getSheet_();
        const props = PropertiesService.getScriptProperties();
        const stored = props.getProperties();
        const now = new Date();
        const tz = Session.getScriptTimeZone();
        const lastRow = Math.max(sheet.getLastRow(), CONFIG.FIRST_DATA_ROW);
        const numRows = lastRow - CONFIG.FIRST_DATA_ROW + 1;

        const activeKeys = new Set();
        const earliestByName = new Map(); // keeps column order

        CONFIG.STATUS_COLUMNS.forEach(col => {
            const values = sheet.getRange(CONFIG.FIRST_DATA_ROW, col, numRows, 1).getValues();
            const columnName = String(sheet.getRange(CONFIG.NAME_ROW, col - 1).getDisplayValue()).trim().toUpperCase() || 'COL ' + col;

            values.forEach((row, i) => {
                upworkNamesInCell_(row[0], columnName).forEach(name => {
                    const key = `${PROP_START_PREFIX}${col}_${CONFIG.FIRST_DATA_ROW + i}_${name}`;
                    activeKeys.add(key);
                    let start = stored[key] ? new Date(Number(stored[key])) : null;
                    if (!start) {
                        start = now;
                        props.setProperty(key, String(now.getTime()));
                    }
                    const prev = earliestByName.get(name);
                    if (!prev || start < prev) earliestByName.set(name, start);
                });
            });
        });

        // Forget start times for cells no longer on Upwork
        Object.keys(stored)
            .filter(k => k.startsWith(PROP_START_PREFIX) && !activeKeys.has(k))
            .forEach(k => props.deleteProperty(k));

        const lines = [];
        earliestByName.forEach((start, name) => {
            const since = Utilities.formatDate(start, tz, 'h:mm a');
            lines.push(`${name} - UPWORK ACTIVE (since ${since} · ${formatElapsed_(now - start)})`);
        });

        const header = sheet.getRange(CONFIG.HEADER_CELL);
        const banner = sheet.getRange(CONFIG.HEADER_RANGE);

        if (lines.length) {
            header.setValue(lines.join('  |  '));
            banner.setBackground(CONFIG.ACTIVE_BG).setFontColor(CONFIG.FONT_COLOR);
        } else {
            header.setValue(CONFIG.IDLE_TEXT);
            banner.setBackground(CONFIG.IDLE_BG).setFontColor(CONFIG.FONT_COLOR);
        }
    } finally {
        lock.releaseLock();
    }
}

function formatElapsed_(ms) {
    const mins = Math.floor(ms / 60000);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function getSheet_() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) throw new Error(`Tab "${CONFIG.SHEET_NAME}" not found. Update CONFIG.SHEET_NAME.`);
    return sheet;
}

var NAMES_VALUE = "CHE, PAU, HAN";

/** Run once: makes moveTaskOnEdit run on every edit. */
function installMoverTrigger() {
    ScriptApp.getProjectTriggers()
        .filter(function (t) { return t.getHandlerFunction() === "moveTaskOnEdit"; })
        .forEach(function (t) { ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger("moveTaskOnEdit")
        .forSpreadsheet(SpreadsheetApp.getActive())
        .onEdit()
        .create();
    toast_("Task mover is on.");
}

function moveTaskOnEdit(e) {
    try {
        if (!e || !e.range) return;

        const range = e.range;
        const sheet = range.getSheet();
        const row = range.getRow();
        const col = range.getColumn();

        // Ignore header rows and multi-cell edits
        if (row < 4) return;
        if (range.getNumRows() > 1 || range.getNumColumns() > 1) return;

        // Status columns: D, F, H, J, L, N
        const statusColumns = [4, 6, 8, 10, 12, 14];
        if (!statusColumns.includes(col)) return;
        if (range.getValue() !== "To review") return;

        // Task is in the column left of the status column
        const taskCell = sheet.getRange(row, col - 1);
        const taskText = String(taskCell.getValue());
        if (taskText.trim() === "") return;

        // Column A settings
        const TARGET_COL = 1;   // Column A (HanChePau's Tasks)
        const DROPDOWN_COL = 2; // Column B (HanChePau's Status)
        const START_ROW = 4;    // First row where tasks can go

        // Make sure the sheet has rows to read
        let maxRows = sheet.getMaxRows();
        if (START_ROW > maxRows) {
            sheet.insertRowsAfter(maxRows, START_ROW - maxRows);
            maxRows = sheet.getMaxRows();
        }

        // Read all of column A from START_ROW down
        const numRows = maxRows - START_ROW + 1;
        const values = sheet
            .getRange(START_ROW, TARGET_COL, numRows, 1)
            .getValues()
            .map(function (r) { return String(r[0]); });

        // ── CASE 1: task already exists in column A ──────────────
        const existingIndex = values.indexOf(taskText);
        if (existingIndex !== -1) {
            const existingRow = START_ROW + existingIndex;

            setNames_(sheet, existingRow, DROPDOWN_COL);

            taskCell.clearContent();
            range.clearContent();

            SpreadsheetApp.flush();
            toast_("Already in row " + existingRow +
                ". Names updated and removed from the old column.");
            return;
        }

        // ── CASE 2: new task -> first empty row in column A ──────
        let targetRow = -1;
        for (let i = 0; i < values.length; i++) {
            if (values[i].trim() === "") {
                targetRow = START_ROW + i;
                break;
            }
        }

        // No empty row found: add one at the bottom
        if (targetRow === -1) {
            sheet.insertRowAfter(maxRows);
            targetRow = maxRows + 1;
        }

        const target = sheet.getRange(targetRow, TARGET_COL);

        // Put the task in column A (keeps links and text formatting)
        const rich = taskCell.getRichTextValue();
        if (rich) {
            target.setRichTextValue(rich);
        } else {
            target.setValue(taskText);
        }

        setNames_(sheet, targetRow, DROPDOWN_COL);

        taskCell.clearContent();
        range.clearContent();

        SpreadsheetApp.flush();
        toast_("Task moved to row " + targetRow + " in column A.");
        target.activate();

    } catch (err) {
        toast_("Move failed: " + err.message);
    }
}

function toast_(message) {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, "Task Mover", 5);
}

// Sets the names dropdown and warns if the value did not stick.
function setNames_(sheet, row, col) {
    const cell = sheet.getRange(row, col);
    cell.setValue(NAMES_VALUE);
    SpreadsheetApp.flush();

    const now = String(cell.getValue()).trim();
    if (now !== NAMES_VALUE) {
        toast_("Names dropdown did not accept \"" + NAMES_VALUE +
            "\". Check the names match the dropdown options.");
    }
}