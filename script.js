const scalarFields = [
  "po",
  "po_sent_date",
  "sku",
  "quantity",
  "karat",
  "color",
  "gold_weight_g",
  "gold_price_usd_per_oz",
  "labour_cost_usd",
  "final_cost_usd",
];

const numericTolerance = {
  gold_weight_g: 0.01,
  gold_price_usd_per_oz: 0.5,
  labour_cost_usd: 0.5,
  final_cost_usd: 1.0,
  carats: 0.001,
  price_per_carat_usd: 1.0,
};

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
  dbByUid = new Map(db.rings.map((ring) => [String(ring.uid).trim(), ring]));
}

invoiceFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    renderError(`Could not parse JSON: ${err.message}`);
    return;
  }

  const lines = Array.isArray(payload) ? payload : payload.lines || [];
  const comparisons = lines.map(compareLine);
  renderComparisons(comparisons);
});

function compareLine(line) {
  const uid = String(line.uid || "").trim();
  const dbRecord = dbByUid.get(uid);

  if (!dbRecord) {
    return { line, status: "flagged", notes: ["UID not found in database"] };
  }

  const notes = [];

  for (const field of scalarFields) {
    if (!isScalarMatch(field, line[field], dbRecord[field])) {
      notes.push(`${field}: invoice '${formatValue(line[field])}' vs db '${formatValue(dbRecord[field])}'`);
    }
  }

  const diamondNotes = compareDiamonds(line.diamonds || [], dbRecord.diamonds || []);
  notes.push(...diamondNotes);

  return {
    line,
    status: notes.length === 0 ? "match" : "flagged",
    notes,
  };
}

function isScalarMatch(field, a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && (typeof a !== "string" || a.trim() !== "")) {
    const tol = numericTolerance[field] ?? 0.0001;
    return Math.abs(numA - numB) <= tol;
  }

  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function compareDiamonds(invoiceDiamonds, dbDiamonds) {
  const notes = [];

  if (invoiceDiamonds.length !== dbDiamonds.length) {
    notes.push(`diamonds: invoice has ${invoiceDiamonds.length} entries vs db ${dbDiamonds.length}`);
  }

  const unmatched = [...dbDiamonds];
  invoiceDiamonds.forEach((invDia, idx) => {
    const matchIdx = unmatched.findIndex(
      (d) =>
        String(d.shape).toLowerCase() === String(invDia.shape || "").toLowerCase() &&
        String(d.quality).toLowerCase() === String(invDia.quality || "").toLowerCase()
    );

    if (matchIdx === -1) {
      notes.push(`diamond #${idx + 1}: no db match for ${invDia.shape || "?"} ${invDia.quality || "?"}`);
      return;
    }

    const dbDia = unmatched.splice(matchIdx, 1)[0];
    ["carats", "count", "price_per_carat_usd"].forEach((field) => {
      if (!isScalarMatch(field, invDia[field], dbDia[field])) {
        notes.push(
          `diamond ${invDia.shape}/${invDia.quality} ${field}: invoice '${formatValue(invDia[field])}' vs db '${formatValue(dbDia[field])}'`
        );
      }
    });
  });

  unmatched.forEach((d) => {
    notes.push(`db diamond missing on invoice: ${d.shape} ${d.quality}`);
  });

  return notes;
}

function formatValue(v) {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  return String(v);
}

function renderError(message) {
  totalLinesElement.textContent = "0";
  matchLinesElement.textContent = "0";
  flaggedLinesElement.textContent = "0";
  resultsBody.innerHTML = `<tr><td colspan="14" class="placeholder">${escapeCell(message)}</td></tr>`;
}

function renderComparisons(comparisons) {
  totalLinesElement.textContent = String(comparisons.length);
  const matchCount = comparisons.filter((c) => c.status === "match").length;
  matchLinesElement.textContent = String(matchCount);
  flaggedLinesElement.textContent = String(comparisons.length - matchCount);

  if (comparisons.length === 0) {
    resultsBody.innerHTML = `<tr><td colspan="14" class="placeholder">No lines found in file.</td></tr>`;
    return;
  }

  resultsBody.innerHTML = comparisons
    .map((result) => {
      const line = result.line;
      const statusLabel =
        result.status === "match"
          ? '<span class="status-pill status-ok">Matched</span>'
          : '<span class="status-pill status-bad">Red Flag</span>';
      const rowClass = result.status === "flagged" ? "row-flagged" : "";
      const notes = result.notes.length ? result.notes.join("; ") : "-";

      return `
        <tr class="${rowClass}">
          <td>${escapeCell(line.uid)}</td>
          <td>${escapeCell(line.po)}</td>
          <td>${escapeCell(line.po_sent_date)}</td>
          <td>${escapeCell(line.sku)}</td>
          <td>${escapeCell(line.quantity)}</td>
          <td>${escapeCell(line.karat)}</td>
          <td>${escapeCell(line.color)}</td>
          <td>${escapeCell(line.gold_weight_g)}</td>
          <td>${escapeCell(line.gold_price_usd_per_oz)}</td>
          <td class="diamond-cell">${formatDiamonds(line.diamonds)}</td>
          <td>${escapeCell(line.labour_cost_usd)}</td>
          <td>${escapeCell(line.final_cost_usd)}</td>
          <td>${statusLabel}</td>
          <td class="flag-notes">${escapeCell(notes)}</td>
        </tr>
      `;
    })
    .join("");
}

function formatDiamonds(diamonds) {
  if (!Array.isArray(diamonds) || diamonds.length === 0) return "-";
  return diamonds
    .map(
      (d) =>
        escapeCell(
          `${d.count ?? "?"}× ${d.shape ?? "?"} ${d.quality ?? "?"} @ ${d.carats ?? "?"}ct, $${d.price_per_carat_usd ?? "?"}/ct`
        )
    )
    .join("<br/>");
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
