const fieldsToCompare = [
  "po",
  "sku",
  "quantity",
  "karat",
  "color",
  "gold_weight",
  "gold_price",
  "stone_breakdown",
  "stone_prices",
  "labour_cost",
  "final_cost",
];

const resultsBody = document.getElementById("resultsBody");
const invoiceFileInput = document.getElementById("invoiceFile");
const totalLinesElement = document.getElementById("totalLines");
const matchLinesElement = document.getElementById("matchLines");
const flaggedLinesElement = document.getElementById("flaggedLines");

let dbByUid = new Map();

init();

async function init() {
  const response = await fetch("mock_invoice_database.json");
  const db = await response.json();
  dbByUid = new Map(db.rings.map((ring) => [ring.uid.trim(), ring]));
}

invoiceFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const csvText = await file.text();
  const rows = parseCsv(csvText);
  const comparisons = compareRows(rows);
  renderComparisons(comparisons);
});

function compareRows(rows) {
  return rows.map((row) => {
    const uid = (row.uid || "").trim();
    const dbRecord = dbByUid.get(uid);

    if (!dbRecord) {
      return {
        row,
        status: "flagged",
        notes: ["UID not found in database"],
      };
    }

    const mismatches = [];

    for (const field of fieldsToCompare) {
      if (!isValueMatch(row[field], dbRecord[field])) {
        mismatches.push(`${field}: invoice '${row[field] ?? ""}' vs db '${dbRecord[field] ?? ""}'`);
      }
    }

    return {
      row,
      status: mismatches.length === 0 ? "match" : "flagged",
      notes: mismatches,
    };
  });
}

function isValueMatch(a, b) {
  if (a == null && b == null) return true;

  const rawA = String(a ?? "").trim();
  const rawB = String(b ?? "").trim();

  const numericA = Number(rawA);
  const numericB = Number(rawB);

  if (!Number.isNaN(numericA) && !Number.isNaN(numericB)) {
    return Math.abs(numericA - numericB) < 0.0001;
  }

  return rawA.toLowerCase() === rawB.toLowerCase();
}

function renderComparisons(comparisons) {
  totalLinesElement.textContent = String(comparisons.length);

  const matchCount = comparisons.filter((result) => result.status === "match").length;
  const flaggedCount = comparisons.length - matchCount;

  matchLinesElement.textContent = String(matchCount);
  flaggedLinesElement.textContent = String(flaggedCount);

  if (comparisons.length === 0) {
    resultsBody.innerHTML = `<tr><td colspan="14" class="placeholder">No rows found in file.</td></tr>`;
    return;
  }

  resultsBody.innerHTML = comparisons
    .map((result) => {
      const row = result.row;
      const statusLabel =
        result.status === "match"
          ? '<span class="status-pill status-ok">Matched</span>'
          : '<span class="status-pill status-bad">Red Flag</span>';

      const notes = result.notes.length ? result.notes.join("; ") : "-";
      const rowClass = result.status === "flagged" ? "row-flagged" : "";

      return `
        <tr class="${rowClass}">
          <td>${escapeCell(row.uid)}</td>
          <td>${escapeCell(row.po)}</td>
          <td>${escapeCell(row.sku)}</td>
          <td>${escapeCell(row.quantity)}</td>
          <td>${escapeCell(row.karat)}</td>
          <td>${escapeCell(row.color)}</td>
          <td>${escapeCell(row.gold_weight)}</td>
          <td>${escapeCell(row.gold_price)}</td>
          <td>${escapeCell(row.stone_breakdown)}</td>
          <td>${escapeCell(row.stone_prices)}</td>
          <td>${escapeCell(row.labour_cost)}</td>
          <td>${escapeCell(row.final_cost)}</td>
          <td>${statusLabel}</td>
          <td class="flag-notes">${escapeCell(notes)}</td>
        </tr>
      `;
    })
    .join("");
}

function parseCsv(csv) {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] || "").trim();
    });
    return row;
  });
}

function splitCsvLine(line) {
  const output = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      output.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  output.push(current);
  return output;
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
