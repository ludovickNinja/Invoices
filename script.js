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
  total_carats: 0.001,
  price_per_carat_usd: 1.0,
};

const monthLookup = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const diamondShapes = [
  "Round",
  "Princess",
  "Oval",
  "Cushion",
  "Emerald",
  "Pear",
  "Marquise",
  "Asscher",
  "Radiant",
  "Heart",
  "Baguette",
  "Trillion",
  "Stone",
  "SideBag",
];

const stoneShapeMap = {
  RD: "Round",
  RDS: "Round",
  RND: "Round",
  ROUND: "Round",
  PR: "Princess",
  PRINCESS: "Princess",
  OV: "Oval",
  OVAL: "Oval",
  EC: "Emerald",
  EM: "Emerald",
  EMR: "Emerald",
  EMERALD: "Emerald",
  PS: "Pear",
  PEAR: "Pear",
  MQ: "Marquise",
  MRQ: "Marquise",
  MARQUISE: "Marquise",
  BG: "Baguette",
  BAG: "Baguette",
  BAGUETTE: "Baguette",
  TP: "Trillion",
  TR: "Trillion",
  TRI: "Trillion",
  TRILLION: "Trillion",
};

const manufacturerAdapters = [
  {
    id: "star-forever",
    label: "Star Forever",
    detect: (rows) => findHeaderIndex(rows, ["PO NO.", "Style NO.", "Metal Weight.Gram"]) !== -1,
    parse: parseStarForever,
  },
  {
    id: "diatrends",
    label: "Diatrends",
    detect: (rows) => findHeaderIndex(rows, ["UID NO", "PO Number", "diamond pcs /per style"]) !== -1,
    parse: parseDiatrends,
  },
  {
    id: "indojewel",
    label: "Indojewel",
    detect: (rows) => findHeaderIndex(rows, ["Cust Po No", "Cust Style no", "JewelCode"]) !== -1,
    parse: parseIndojewel,
  },
  {
    id: "accent",
    label: "Accent",
    detect: (rows) => findHeaderIndex(rows, ["CUST style", "Accent Style", "PURE GOLD"]) !== -1,
    parse: parseAccent,
  },
  {
    id: "factory-a",
    label: "Factory A wide invoice",
    detect: (rows) => findHeaderIndex(rows, ["Barcode", "Design", "Stone Description"]) !== -1,
    parse: parseFactoryA,
  },
  {
    id: "factory-b",
    label: "Factory B tall invoice",
    detect: (rows) => findHeaderIndex(rows, ["Tag No.", "Style", "Karat / Colour"]) !== -1,
    parse: parseFactoryB,
  },
  {
    id: "factory-c-summary",
    label: "Factory C ring summary",
    detect: (rows) => findHeaderIndex(rows, ["UID", "PO", "PO Sent", "SKU"]) !== -1,
  },
  {
    id: "factory-c-stones",
    label: "Factory C stone detail",
    detect: (rows) => findHeaderIndex(rows, ["UID", "Shape", "Quality", "Carats", "Count", "USD/Ct"]) !== -1,
  },
];

const resultsBody = document.getElementById("resultsBody");
const invoiceFileInput = document.getElementById("invoiceFile");
const fileStatusElement = document.getElementById("fileStatus");
const totalLinesElement = document.getElementById("totalLines");
const matchLinesElement = document.getElementById("matchLines");
const flaggedLinesElement = document.getElementById("flaggedLines");

let dbByUid = new Map();
let dbLookupIndex = new Map();
const dbReady = init();

async function init() {
  const response = await fetch("mock_invoice_database.json");
  const db = await response.json();
  buildDbIndexes(db.rings || []);
}

invoiceFileInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  try {
    updateFileStatus(files, "processing");
    await dbReady;
    const lines = await normalizeCsvUploads(files);
    const comparisons = lines.map(compareLine);
    renderComparisons(comparisons);
    updateFileStatus(files, "complete");
  } catch (err) {
    updateFileStatus(files, "error");
    renderError(err.message);
  }
});

resultsBody.addEventListener("click", (event) => {
  const row = event.target.closest?.(".flag-summary-row");
  if (!row) return;

  toggleFlagDetails(row);
});

resultsBody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;

  const row = event.target.closest?.(".flag-summary-row");
  if (!row) return;

  event.preventDefault();
  toggleFlagDetails(row);
});

async function normalizeCsvUploads(files) {
  const parsedFiles = await Promise.all(
    files.map(async (file) => {
      const text = await file.text();
      const rows = parseCsv(text);
      const adapter = manufacturerAdapters.find((candidate) => candidate.detect(rows));
      return {
        name: file.name,
        rows,
        adapter,
      };
    })
  );

  const unsupported = parsedFiles.filter((file) => !file.adapter);
  if (unsupported.length) {
    throw new Error(`Unsupported manufacturer CSV format: ${unsupported.map((file) => file.name).join(", ")}`);
  }

  const lines = [];
  const factoryCSummaries = [];
  const factoryCStoneFiles = [];

  parsedFiles.forEach((file) => {
    if (file.adapter.id === "factory-c-summary") {
      factoryCSummaries.push(file);
      return;
    }

    if (file.adapter.id === "factory-c-stones") {
      factoryCStoneFiles.push(file);
      return;
    }

    lines.push(...file.adapter.parse(file.rows, file.name));
  });

  if (factoryCSummaries.length || factoryCStoneFiles.length) {
    if (!factoryCSummaries.length || !factoryCStoneFiles.length) {
      throw new Error("Factory C uploads require both the ring summary CSV and the stone detail CSV selected together.");
    }

    const stonesByUid = buildFactoryCStoneMap(factoryCStoneFiles);
    factoryCSummaries.forEach((file) => {
      lines.push(...parseFactoryCSummary(file.rows, stonesByUid, file.name));
    });
  }

  if (!lines.length) {
    throw new Error("No invoice lines found in the uploaded CSV file(s).");
  }

  return lines;
}

function parseStarForever(rows, fileName) {
  const headerIndex = findHeaderIndex(rows, ["PO NO.", "Style NO.", "Metal Weight.Gram"]);
  const header = rows[headerIndex];
  const get = makeRowGetter(header);
  const invoiceDate = parseInvoiceDate(valueAfterLabel(findRowWithLabel(rows, "Invoicing Date"), "Invoicing Date"));

  return rows
    .slice(headerIndex + 1)
    .filter((row) => !isBlankRow(row) && get(row, "PO NO.") && !/^total$/i.test(get(row, "PO NO.")))
    .map((row) => {
      const poNo = cleanText(get(row, "PO NO."));
      const style = cleanSku(get(row, "Style NO."));
      const metal = parseMetalCode(get(row, "Metal"));
      const stoneCount = firstPresent(parseNumber(get(row, "Total Stone Qty(pcs)")), parseNumber(get(row, "Stone Qty(pcs)")));
      const stoneWeight = firstPresent(parseNumber(get(row, "Total Stone Wt.(ct)")), parseNumber(get(row, "SF Dia. Wt.(ct)")), parseNumber(get(row, "Customer Dia. Wt.(ct)")));
      const stoneCost = parseNumber(get(row, "SF Stone Cost"));

      return {
        uid: poNo,
        po: poNo,
        po_sent_date: invoiceDate,
        sku: style,
        quantity: parseNumber(get(row, "Qty")),
        karat: metal.karat,
        color: metal.color,
        gold_weight_g: parseNumber(get(row, "Metal Weight.Gram")),
        gold_price_usd_per_oz: "",
        diamonds: buildAggregateDiamond(stoneCount, stoneWeight, stoneCost),
        labour_cost_usd: parseNumber(get(row, "Total Labor Chart")),
        final_cost_usd: firstPresent(parseNumber(get(row, "Price")), parseNumber(get(row, "Total Price"))),
        __sourceFile: fileName,
        __alternateMatchKeys: [style],
        __compareFields: ["po", "sku", "quantity", "karat", "color", "gold_weight_g", "labour_cost_usd", "final_cost_usd"],
        __compareOptions: {
          diamondCompareMode: "aggregate",
          skipDiamondPricePerCarat: true,
        },
      };
    });
}

function parseDiatrends(rows, fileName) {
  const headerIndex = findHeaderIndex(rows, ["UID NO", "PO Number", "diamond pcs /per style"]);
  const header = rows[headerIndex];
  const get = makeRowGetter(header);
  const invoiceDate = parseInvoiceDate(valueAfterLabel(findRowWithLabel(rows, "Date"), "Date"));

  return rows
    .slice(headerIndex + 1)
    .filter((row) => !isBlankRow(row) && get(row, "UID NO") && !/^total$/i.test(get(row, "UID NO")))
    .map((row) => {
      const uid = cleanText(get(row, "UID NO"));
      const po = cleanText(get(row, "PO Number"));
      const sku = cleanSku(firstPresent(get(row, "SKU NO"), get(row, "DesignNo")));
      const karat = normalizeKarat(get(row, "KT"), get(row, "Metal Colour"));
      const diamonds = parseDiatrendsDiamonds(row, get);

      return {
        uid,
        po,
        po_sent_date: invoiceDate,
        sku,
        quantity: firstPresent(parseNumber(get(row, "Qnty In Pcs")), parseNumber(get(row, "Qnty"))),
        karat,
        color: toGoldColor(get(row, "Metal Colour")),
        gold_weight_g: parseNumber(get(row, "Gross wt Gms.")),
        gold_price_usd_per_oz: "",
        diamonds,
        labour_cost_usd: "",
        final_cost_usd: parseNumber(get(row, "Value Per pc US$")),
        __sourceFile: fileName,
        __alternateMatchKeys: [po, sku, get(row, "DesignNo"), get(row, "W O NO")],
        __compareFields: ["po", "sku", "quantity", "karat", "color", "gold_weight_g", "final_cost_usd"],
        __compareOptions: {
          diamondCompareMode: "shape-total",
          skipDiamondPricePerCarat: true,
        },
      };
    });
}

function parseDiatrendsDiamonds(row, get) {
  const diamonds = [];

  for (let i = 1; i <= 5; i += 1) {
    const shape = normalizeStoneShape(get(row, `type${i}`));
    const count = parseNumber(get(row, `pcs${i}`));
    const totalCarats = parseNumber(get(row, `cts${i}`));

    if (!shape && count === "" && totalCarats === "") continue;

    diamonds.push({
      shape: shape || "Stone",
      quality: "",
      count,
      carats: perStoneCarats(totalCarats, count),
      total_carats: totalCarats,
    });
  }

  return diamonds;
}

function parseIndojewel(rows, fileName) {
  const headerIndex = findHeaderIndex(rows, ["Cust Po No", "Cust Style no", "JewelCode"]);
  const header = rows[headerIndex];
  const get = makeRowGetter(header);
  const invoiceDate = parseInvoiceDate(valueAfterLabel(findRowWithLabel(rows, "Date"), "Date"));
  const lines = [];
  let currentLine = null;

  rows.slice(headerIndex + 1).forEach((row) => {
    if (isBlankRow(row)) return;

    const serialNo = get(row, "Sr.No.");
    const shape = normalizeStoneShape(get(row, "Stone Shape"));

    if (serialNo) {
      const po = cleanText(get(row, "Cust Po No"));
      const sku = cleanSku(firstPresent(get(row, "Cust Style no"), get(row, "Dsg Cd")));
      const uid = cleanText(firstPresent(get(row, "JewelCode"), po, sku));
      currentLine = {
        uid,
        po,
        po_sent_date: invoiceDate,
        sku,
        quantity: parseNumber(get(row, "Order Qty")),
        karat: normalizeKarat(get(row, "Kt")),
        color: toGoldColor(get(row, "Col")),
        gold_weight_g: firstPresent(parseNumber(get(row, "Net Wt")), parseNumber(get(row, "Gross Wt"))),
        gold_price_usd_per_oz: "",
        diamonds: [],
        labour_cost_usd: parseNumber(get(row, "Total Labor")),
        final_cost_usd: firstPresent(parseNumber(get(row, "Unit Price")), parseNumber(get(row, "Final Value"))),
        __sourceFile: fileName,
        __alternateMatchKeys: [po, sku, get(row, "Dsg Cd"), get(row, "Old Dsg Cd")],
        __compareFields: ["po", "sku", "quantity", "karat", "color", "gold_weight_g", "labour_cost_usd", "final_cost_usd"],
        __compareOptions: {
          diamondCompareMode: "shape-quality-total",
        },
      };
      lines.push(currentLine);
    }

    if (shape && currentLine) {
      currentLine.diamonds.push(parseIndojewelDiamond(row, get, shape));
    }
  });

  return lines;
}

function parseIndojewelDiamond(row, get, shape) {
  const count = parseNumber(get(row, "No Of Stone"));
  const totalCarats = parseNumber(get(row, "Stone WT"));

  return {
    shape,
    quality: normalizeStoneQuality(firstPresent(get(row, "Cust Stone Qlty"), get(row, "System Stone Qlty"))),
    carats: firstPresent(parseNumber(get(row, "Calculated AverangeWt per Stone")), perStoneCarats(totalCarats, count)),
    count,
    total_carats: totalCarats,
    price_per_carat_usd: parseNumber(get(row, "Stone PPC")),
  };
}

function parseAccent(rows, fileName) {
  const headerIndex = findHeaderIndex(rows, ["CUST style", "Accent Style", "PURE GOLD"]);
  const invoiceDate = parseInvoiceDate(valueAfterLabel(findRowWithLabel(rows, "DATE"), "DATE"));
  const lines = [];
  let currentLine = null;

  rows.slice(headerIndex + 1).forEach((row) => {
    if (isBlankRow(row) || /^no\.?\/line no\.?$/i.test(cleanText(row[1]))) return;

    const lineNo = parseNumber(row[0]);
    const isMainRow = lineNo !== "" && cleanText(row[1]);
    const shape = normalizeStoneShape(row[9]);

    if (isMainRow) {
      const orderNo = parseAccentOrder(row[1]);
      const customerStyle = cleanSku(row[2]);
      const accentStyle = cleanSku(row[3]);
      const metal = parseMetalCode(row[5]);

      currentLine = {
        uid: firstPresent(customerStyle, accentStyle, orderNo),
        po: orderNo,
        po_sent_date: invoiceDate,
        sku: firstPresent(customerStyle, accentStyle),
        quantity: parseNumber(row[6]),
        karat: metal.karat,
        color: metal.color,
        gold_weight_g: firstPresent(parseNumber(row[17]), parseNumber(row[14])),
        gold_price_usd_per_oz: "",
        diamonds: [],
        labour_cost_usd: "",
        final_cost_usd: "",
        __sourceFile: fileName,
        __alternateMatchKeys: [orderNo, accentStyle],
        __compareFields: ["po", "sku", "quantity", "karat", "color", "gold_weight_g"],
        __compareOptions: {
          diamondCompareMode: "shape-total",
          skipDiamondPricePerCarat: true,
        },
      };
      lines.push(currentLine);
    }

    if (shape && currentLine) {
      currentLine.diamonds.push({
        shape,
        quality: cleanText(row[8]),
        count: parseNumber(row[10]),
        carats: perStoneCarats(parseNumber(row[11]), parseNumber(row[10])),
        total_carats: parseNumber(row[11]),
        price_per_carat_usd: parseNumber(row[12]),
      });
    }
  });

  return lines;
}

function parseFactoryA(rows, fileName) {
  const poRow = findRowWithLabel(rows, "PO #");
  const goldRow = findRowWithLabel(rows, "Gold Rate (USD/oz)");
  const headerIndex = findHeaderIndex(rows, ["Barcode", "Design", "Stone Description"]);
  const header = rows[headerIndex];
  const get = makeRowGetter(header);

  const po = valueAfterLabel(poRow, "PO #");
  const poSentDate = valueAfterLabel(poRow, "PO Date");
  const goldPrice = parseNumber(valueAfterLabel(goldRow, "Gold Rate (USD/oz)"));

  return rows
    .slice(headerIndex + 1)
    .filter((row) => !isBlankRow(row) && get(row, "Barcode"))
    .map((row) => {
      const metal = parseCompactMetal(get(row, "Metal"));

      return {
        uid: get(row, "Barcode"),
        po,
        po_sent_date: poSentDate,
        sku: get(row, "Design"),
        quantity: parseNumber(get(row, "Qty")),
        karat: metal.karat,
        color: metal.color,
        gold_weight_g: parseNumber(get(row, "Gold Wt (g)")),
        gold_price_usd_per_oz: goldPrice,
        diamonds: parseStoneDescription(get(row, "Stone Description")),
        labour_cost_usd: parseNumber(get(row, "Labour $/pc")),
        final_cost_usd: parseNumber(get(row, "Total $/pc")),
        __sourceFile: fileName,
        __compareOptions: {
          skipDiamondPricePerCarat: true,
        },
      };
    });
}

function parseFactoryB(rows, fileName) {
  const dateRow = findRowWithLabel(rows, "Date");
  const poRow = findRowWithLabel(rows, "Reference PO");
  const headerIndex = findHeaderIndex(rows, ["Tag No.", "Style", "Karat / Colour"]);
  const header = rows[headerIndex];
  const get = makeRowGetter(header);

  const po = valueAfterLabel(poRow, "Reference PO");
  const poSentDate = valueAfterLabel(dateRow, "Date");
  const goldPrice = parseNumber(valueAfterLabel(poRow, "Gold Spot (USD/Oz)"));
  const lines = [];
  let currentLine = null;

  rows.slice(headerIndex + 1).forEach((row) => {
    if (isBlankRow(row)) return;

    const style = get(row, "Style");
    const shape = get(row, "Shape");

    if (style) {
      const metal = parseSlashMetal(get(row, "Karat / Colour"));
      currentLine = {
        uid: get(row, "Tag No."),
        po,
        po_sent_date: poSentDate,
        sku: style,
        quantity: parseNumber(get(row, "Pcs")),
        karat: metal.karat,
        color: metal.color,
        gold_weight_g: parseNumber(get(row, "Wt (g)")),
        gold_price_usd_per_oz: goldPrice,
        diamonds: [],
        labour_cost_usd: parseNumber(get(row, "Making $/pc")),
        final_cost_usd: parseNumber(get(row, "Total $/pc")),
        __sourceFile: fileName,
      };
      lines.push(currentLine);
    }

    if (shape && currentLine) {
      currentLine.diamonds.push({
        shape,
        quality: parseSlashQuality(get(row, "Clarity/Color")),
        carats: parseNumber(get(row, "Ct")),
        count: parseNumber(get(row, "Pcs (stones)")),
        price_per_carat_usd: parseNumber(get(row, "$/Ct")),
      });
    }
  });

  return lines;
}

function buildFactoryCStoneMap(files) {
  const stonesByUid = new Map();

  files.forEach((file) => {
    const headerIndex = findHeaderIndex(file.rows, ["UID", "Shape", "Quality", "Carats", "Count", "USD/Ct"]);
    const header = file.rows[headerIndex];
    const get = makeRowGetter(header);

    file.rows
      .slice(headerIndex + 1)
      .filter((row) => !isBlankRow(row) && get(row, "UID"))
      .forEach((row) => {
        const uid = get(row, "UID");
        const stones = stonesByUid.get(uid) || [];
        stones.push({
          shape: get(row, "Shape"),
          quality: get(row, "Quality"),
          carats: parseNumber(get(row, "Carats")),
          count: parseNumber(get(row, "Count")),
          price_per_carat_usd: parseNumber(get(row, "USD/Ct")),
        });
        stonesByUid.set(uid, stones);
      });
  });

  return stonesByUid;
}

function parseFactoryCSummary(rows, stonesByUid, fileName) {
  const headerIndex = findHeaderIndex(rows, ["UID", "PO", "PO Sent", "SKU"]);
  const header = rows[headerIndex];
  const get = makeRowGetter(header);

  return rows
    .slice(headerIndex + 1)
    .filter((row) => !isBlankRow(row) && get(row, "UID"))
    .map((row) => {
      const uid = get(row, "UID");

      return {
        uid,
        po: get(row, "PO"),
        po_sent_date: get(row, "PO Sent"),
        sku: get(row, "SKU"),
        quantity: parseNumber(get(row, "Quantity")),
        karat: get(row, "Karat"),
        color: get(row, "Color"),
        gold_weight_g: parseNumber(get(row, "Gold Weight (g)")),
        gold_price_usd_per_oz: parseNumber(get(row, "Gold Spot (USD/Oz)")),
        diamonds: stonesByUid.get(uid) || [],
        labour_cost_usd: parseNumber(get(row, "Labour (USD)")),
        final_cost_usd: parseNumber(get(row, "Final (USD)")),
        __sourceFile: fileName,
      };
    });
}

function compareLine(line) {
  const match = findDbRecord(line);

  if (!match.record) {
    const keys = [line.uid, ...(line.__alternateMatchKeys || [])].map(cleanText).filter(Boolean);
    const triedLabel = keys.length ? ` Tried: ${uniqueValues(keys).join(", ")}` : "";
    const ambiguousLabel = match.ambiguousKeys?.length ? ` Ambiguous keys: ${match.ambiguousKeys.join(", ")}` : "";
    return { line, status: "flagged", notes: [`No unique reference record found.${triedLabel}${ambiguousLabel}`] };
  }

  const notes = [];
  const fields = line.__compareFields || scalarFields;

  for (const field of fields) {
    if (!isScalarMatch(field, line[field], match.record[field])) {
      notes.push(`${field}: invoice '${formatValue(line[field])}' vs db '${formatValue(match.record[field])}'`);
    }
  }

  const diamondNotes = compareDiamonds(line.diamonds || [], match.record.diamonds || [], line.__compareOptions || {});
  notes.push(...diamondNotes);

  return {
    line,
    status: notes.length === 0 ? "match" : "flagged",
    notes,
  };
}

function findDbRecord(line) {
  const keys = uniqueValues([line.uid, ...(line.__alternateMatchKeys || [])].map(cleanText).filter(Boolean));
  const ambiguousKeys = [];

  for (const key of keys) {
    const record = dbByUid.get(key);
    if (record) return { record, key };

    const indexedRecords = uniqueRecords(dbLookupIndex.get(normalizeLookupKey(key)) || []);
    if (indexedRecords.length === 1) return { record: indexedRecords[0], key };
    if (indexedRecords.length > 1) ambiguousKeys.push(key);
  }

  return { record: null, key: "", ambiguousKeys };
}

function buildDbIndexes(records) {
  dbByUid = new Map();
  dbLookupIndex = new Map();

  records.forEach((record) => {
    const uid = cleanText(record.uid);
    if (uid) dbByUid.set(uid, dbByUid.has(uid) ? null : record);

    ["uid", "po", "sku"].forEach((field) => {
      addDbLookupValue(record[field], record);
    });
  });
}

function addDbLookupValue(value, record) {
  const key = normalizeLookupKey(value);
  if (!key) return;

  const records = dbLookupIndex.get(key) || [];
  records.push(record);
  dbLookupIndex.set(key, records);
}

function normalizeLookupKey(value) {
  return cleanText(value).toLowerCase();
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

function compareDiamonds(invoiceDiamonds, dbDiamonds, options = {}) {
  if (options.diamondCompareMode === "aggregate") {
    return compareDiamondAggregate(invoiceDiamonds, dbDiamonds);
  }

  if (options.diamondCompareMode === "shape-total") {
    return compareDiamondGroups(invoiceDiamonds, dbDiamonds, ["shape"], options);
  }

  if (options.diamondCompareMode === "shape-quality-total") {
    return compareDiamondGroups(invoiceDiamonds, dbDiamonds, ["shape", "quality"], options);
  }

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
      if (field === "price_per_carat_usd" && options.skipDiamondPricePerCarat) return;

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

function compareDiamondAggregate(invoiceDiamonds, dbDiamonds) {
  const notes = [];
  const invoice = summarizeDiamonds(invoiceDiamonds);
  const db = summarizeDiamonds(dbDiamonds);

  if (!isScalarMatch("count", invoice.count, db.count)) {
    notes.push(`diamonds count: invoice '${formatValue(invoice.count)}' vs db '${formatValue(db.count)}'`);
  }

  if (!isScalarMatch("total_carats", invoice.total_carats, db.total_carats)) {
    notes.push(`diamonds total carats: invoice '${formatValue(invoice.total_carats)}' vs db '${formatValue(db.total_carats)}'`);
  }

  return notes;
}

function compareDiamondGroups(invoiceDiamonds, dbDiamonds, keyFields, options) {
  const notes = [];
  const invoiceGroups = groupDiamonds(invoiceDiamonds, keyFields);
  const dbGroups = groupDiamonds(dbDiamonds, keyFields);

  invoiceGroups.forEach((invoice, key) => {
    const db = dbGroups.get(key);

    if (!db) {
      notes.push(`diamond ${invoice.label}: no db match`);
      return;
    }

    if (!isScalarMatch("count", invoice.count, db.count)) {
      notes.push(`diamond ${invoice.label} count: invoice '${formatValue(invoice.count)}' vs db '${formatValue(db.count)}'`);
    }

    if (!isScalarMatch("total_carats", invoice.total_carats, db.total_carats)) {
      notes.push(`diamond ${invoice.label} total carats: invoice '${formatValue(invoice.total_carats)}' vs db '${formatValue(db.total_carats)}'`);
    }

    if (!options.skipDiamondPricePerCarat && invoice.price_per_carat_usd !== "" && db.price_per_carat_usd !== "") {
      if (!isScalarMatch("price_per_carat_usd", invoice.price_per_carat_usd, db.price_per_carat_usd)) {
        notes.push(
          `diamond ${invoice.label} price_per_carat_usd: invoice '${formatValue(invoice.price_per_carat_usd)}' vs db '${formatValue(db.price_per_carat_usd)}'`
        );
      }
    }
  });

  dbGroups.forEach((db, key) => {
    if (!invoiceGroups.has(key)) notes.push(`db diamond missing on invoice: ${db.label}`);
  });

  return notes;
}

function groupDiamonds(diamonds, keyFields) {
  const groups = new Map();

  diamonds.forEach((diamond) => {
    const key = keyFields.map((field) => cleanText(diamond[field]).toLowerCase()).join("|");
    const label = keyFields.map((field) => cleanText(diamond[field])).filter(Boolean).join(" ") || "stones";
    const existing = groups.get(key) || {
      label,
      count: 0,
      total_carats: 0,
      price_per_carat_usd: "",
      hasCount: false,
      hasCarats: false,
    };
    const count = toNumberOrNull(diamond.count);
    const totalCarats = toNumberOrNull(getDiamondTotalCarats(diamond));

    if (count != null) {
      existing.count += count;
      existing.hasCount = true;
    }

    if (totalCarats != null) {
      existing.total_carats += totalCarats;
      existing.hasCarats = true;
    }

    if (existing.price_per_carat_usd === "" && diamond.price_per_carat_usd !== "") {
      existing.price_per_carat_usd = diamond.price_per_carat_usd;
    }

    groups.set(key, existing);
  });

  groups.forEach((group) => {
    if (!group.hasCount) group.count = "";
    if (!group.hasCarats) group.total_carats = "";
  });

  return groups;
}

function summarizeDiamonds(diamonds) {
  let count = 0;
  let totalCarats = 0;
  let hasCount = false;
  let hasCarats = false;

  diamonds.forEach((diamond) => {
    const diamondCount = toNumberOrNull(diamond.count);
    const diamondCarats = toNumberOrNull(getDiamondTotalCarats(diamond));

    if (diamondCount != null) {
      count += diamondCount;
      hasCount = true;
    }

    if (diamondCarats != null) {
      totalCarats += diamondCarats;
      hasCarats = true;
    }
  });

  return {
    count: hasCount ? count : "",
    total_carats: hasCarats ? Number(totalCarats.toFixed(6)) : "",
  };
}

function getDiamondTotalCarats(diamond) {
  if (diamond.total_carats !== "" && diamond.total_carats != null) return diamond.total_carats;

  const carats = toNumberOrNull(diamond.carats);
  const count = toNumberOrNull(diamond.count);
  if (carats == null) return "";
  return count == null ? carats : Number((carats * count).toFixed(6));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cleanText(cell));
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cleanText(cell));
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cleanText(cell));
    rows.push(row);
  }

  return rows;
}

function parseStoneDescription(description) {
  const text = cleanText(description);
  if (!text) return [];

  return text
    .split(/\s+\+\s+/)
    .map((part) => parseStonePart(part))
    .filter(Boolean);
}

function parseStonePart(part) {
  const match = cleanText(part).match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*ct\s+(.+)$/i);
  if (!match) return null;

  const [, count, carats, stoneText] = match;
  const shape = diamondShapes.find((candidate) => stoneText.toLowerCase().startsWith(candidate.toLowerCase()));
  if (!shape) return null;

  const quality = stoneText.slice(shape.length).trim();
  return {
    shape,
    quality,
    carats: parseNumber(carats),
    count: parseNumber(count),
  };
}

function findHeaderIndex(rows, requiredLabels) {
  return rows.findIndex((row) => requiredLabels.every((label) => rowIndexOf(row, label) !== -1));
}

function findRowWithLabel(rows, label) {
  return rows.find((row) => rowIndexOf(row, label) !== -1) || [];
}

function valueAfterLabel(row, label) {
  const index = rowIndexOf(row, label);
  if (index === -1) return "";

  for (let i = index + 1; i < row.length; i += 1) {
    const value = cleanText(row[i]);
    if (value) return value;
  }

  return "";
}

function makeRowGetter(header) {
  const headerIndex = makeHeaderIndex(header);

  return (row, label) => {
    const index = headerIndex.get(normalizeHeader(label));
    return index == null ? "" : cleanText(row[index]);
  };
}

function makeHeaderIndex(header) {
  const index = new Map();

  header.forEach((cell, idx) => {
    const key = normalizeHeader(cell);
    if (key && !index.has(key)) index.set(key, idx);
  });

  return index;
}

function rowIndexOf(row, label) {
  const target = normalizeHeader(label);
  return row.findIndex((cell) => normalizeHeader(cell) === target);
}

function normalizeHeader(value) {
  return cleanText(value)
    .replace(/:$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isBlankRow(row) {
  return row.every((cell) => !cleanText(cell));
}

function parseNumber(value) {
  const text = cleanText(value);
  if (!text) return "";

  const match = text.replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : "";
}

function parseInvoiceDate(value) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return `${isoMatch[1]}-${pad2(isoMatch[2])}-${pad2(isoMatch[3])}`;

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    return `${normalizeYear(slashMatch[3])}-${pad2(slashMatch[1])}-${pad2(slashMatch[2])}`;
  }

  const dayMonthMatch = text.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$/);
  if (dayMonthMatch) {
    const month = monthLookup[dayMonthMatch[2].toLowerCase()];
    if (month) return `${normalizeYear(dayMonthMatch[3])}-${month}-${pad2(dayMonthMatch[1])}`;
  }

  const monthDayMatch = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{2,4})$/);
  if (monthDayMatch) {
    const month = monthLookup[monthDayMatch[1].toLowerCase()];
    if (month) return `${normalizeYear(monthDayMatch[3])}-${month}-${pad2(monthDayMatch[2])}`;
  }

  return text;
}

function normalizeYear(year) {
  const text = String(year);
  if (text.length === 2) return Number(text) >= 70 ? `19${text}` : `20${text}`;
  return text;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseCompactMetal(value) {
  const [karat = "", colorCode = ""] = cleanText(value).split(/\s+/);
  const colorMap = {
    WG: "White Gold",
    YG: "Yellow Gold",
    RG: "Rose Gold",
  };

  return {
    karat,
    color: colorMap[colorCode.toUpperCase()] || toGoldColor(colorCode),
  };
}

function parseSlashMetal(value) {
  const [karat = "", color = ""] = cleanText(value)
    .split("/")
    .map((part) => part.trim());

  return {
    karat,
    color: toGoldColor(color),
  };
}

function parseMetalCode(value) {
  const text = cleanText(value).replace(/\(\?\)/g, "");
  if (!text) return { karat: "", color: "" };

  if (/pt|platinum|950/i.test(text)) {
    return { karat: "PT950", color: "Platinum" };
  }

  const karat = normalizeKarat(text);
  const colorText = text.replace(/^\d+\s*K?T?/i, "");

  return {
    karat,
    color: toGoldColor(colorText),
  };
}

function normalizeKarat(value, colorValue = "") {
  const text = cleanText(value);
  const color = cleanText(colorValue);

  if (/pt|platinum|950/i.test(text) || /pt|platinum/i.test(color)) return "PT950";

  const match = text.match(/(\d{2})/);
  return match ? `${match[1]}K` : text;
}

function parseSlashQuality(value) {
  return cleanText(value)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeStoneShape(value) {
  const text = cleanText(value);
  if (!text) return "";

  const upper = text.toUpperCase();
  return stoneShapeMap[upper] || diamondShapes.find((shape) => shape.toUpperCase() === upper) || text;
}

function normalizeStoneQuality(value) {
  const text = cleanText(value);
  if (!text) return "";

  const match = text.match(/(FL|IF|VVS1|VVS2|VS1|VS2|VS|SI1|SI2|SI|I1|I2|I3)[+\s/-]*([D-M])?/i);
  if (!match) return text;

  return [match[1].toUpperCase(), (match[2] || "").toUpperCase()].filter(Boolean).join(" ");
}

function toGoldColor(value) {
  const text = cleanText(value);
  if (!text) return "";

  if (/pt|platinum/i.test(text)) return "Platinum";

  const upper = text.toUpperCase();
  const wordColors = [];
  if (upper.includes("WHITE")) wordColors.push("White Gold");
  if (upper.includes("YELLOW")) wordColors.push("Yellow Gold");
  if (upper.includes("ROSE") || upper.includes("PINK")) wordColors.push("Rose Gold");
  if (wordColors.length) return uniqueValues(wordColors).join("/");

  const normalized = upper.replace(/\d|K|T|GOLD|\s+/g, "");
  const colors = [];
  if (/W/.test(normalized) || /WHITE/.test(normalized)) colors.push("White Gold");
  if (/Y/.test(normalized) || /YELLOW/.test(normalized)) colors.push("Yellow Gold");
  if (/R/.test(normalized) || /PINK/.test(normalized) || /ROSE/.test(normalized)) colors.push("Rose Gold");

  return uniqueValues(colors).join("/") || text;
}

function parseAccentOrder(value) {
  return cleanText(value).replace(/^crown\s+/i, "");
}

function cleanSku(value) {
  return cleanText(value).replace(/,+$/, "");
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstPresent(...values) {
  return values.find((value) => value !== "" && value != null) ?? "";
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueRecords(records) {
  return [...new Set(records)];
}

function toNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function perStoneCarats(totalCarats, count) {
  const total = toNumberOrNull(totalCarats);
  const stoneCount = toNumberOrNull(count);
  if (total == null || stoneCount == null || stoneCount === 0) return "";
  return Number((total / stoneCount).toFixed(6));
}

function buildAggregateDiamond(count, totalCarats, totalCost) {
  if (count === "" && totalCarats === "" && totalCost === "") return [];

  return [
    {
      shape: "Stone",
      quality: "",
      count,
      carats: perStoneCarats(totalCarats, count),
      total_carats: totalCarats,
      total_cost_usd: totalCost,
    },
  ];
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
  resultsBody.innerHTML = `<tr><td colspan="13" class="placeholder">${escapeCell(message)}</td></tr>`;
}

function updateFileStatus(files, state) {
  if (!fileStatusElement) return;

  const fileCount = files.length;
  const fileLabel = fileCount === 1 ? files[0].name : `${fileCount} files`;
  const stateLabel = {
    processing: "Processing",
    complete: "Loaded",
    error: "Failed",
  }[state];

  fileStatusElement.textContent = stateLabel ? `${stateLabel}: ${fileLabel}` : fileLabel;
}

function renderComparisons(comparisons) {
  totalLinesElement.textContent = String(comparisons.length);
  const matchCount = comparisons.filter((c) => c.status === "match").length;
  matchLinesElement.textContent = String(matchCount);
  flaggedLinesElement.textContent = String(comparisons.length - matchCount);

  if (comparisons.length === 0) {
    resultsBody.innerHTML = `<tr><td colspan="13" class="placeholder">No lines found in file.</td></tr>`;
    return;
  }

  resultsBody.innerHTML = comparisons
    .map((result, index) => {
      const line = result.line;
      const notes = Array.isArray(result.notes) ? result.notes : [];
      const isFlagged = result.status === "flagged";
      const detailId = `flag-detail-${index}`;
      const statusLabel = formatStatusLabel(result.status, notes);
      const rowClass = isFlagged ? "data-row row-flagged flag-summary-row" : "data-row";
      const rowAttributes = isFlagged
        ? `tabindex="0" role="button" aria-expanded="false" aria-controls="${detailId}" aria-label="Show ${formatConflictCount(
            notes.length
          )} for ${escapeCell(line.uid || line.po || `line ${index + 1}`)}"`
        : "";

      const summaryRow = `
        <tr class="${rowClass}" ${rowAttributes}>
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
          <td class="status-cell">${statusLabel}</td>
        </tr>
      `;

      if (!isFlagged) return summaryRow;

      return `
        ${summaryRow}
        <tr id="${detailId}" class="flag-detail-row" hidden>
          <td colspan="13">
            <div class="flag-detail-panel">
              <div class="flag-detail-header">
                <strong>Conflict Breakdown</strong>
                <span>${formatConflictCount(notes.length)}</span>
              </div>
              ${formatFlagNotes(notes)}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function toggleFlagDetails(row) {
  const detailId = row.getAttribute("aria-controls");
  if (!detailId) return;

  const detailRow = document.getElementById(detailId);
  if (!detailRow) return;

  const isExpanded = row.getAttribute("aria-expanded") === "true";
  if (!isExpanded) {
    resultsBody.querySelectorAll?.('.flag-summary-row[aria-expanded="true"]').forEach((openRow) => {
      if (openRow !== row) closeFlagDetails(openRow);
    });
  }

  row.setAttribute("aria-expanded", String(!isExpanded));
  detailRow.hidden = isExpanded;
}

function closeFlagDetails(row) {
  const detailId = row.getAttribute("aria-controls");
  const detailRow = detailId ? document.getElementById(detailId) : null;

  row.setAttribute("aria-expanded", "false");
  if (detailRow) detailRow.hidden = true;
}

function formatStatusLabel(status, notes) {
  if (status === "match") {
    return '<span class="status-pill status-ok">Matched</span>';
  }

  return `
    <div class="status-stack">
      <span class="status-pill status-bad">Red Flag</span>
      <span class="conflict-count">${formatConflictCount(notes.length)}</span>
      <span class="row-chevron" aria-hidden="true"></span>
    </div>
  `;
}

function formatConflictCount(count) {
  return count === 1 ? "1 conflict" : `${count} conflicts`;
}

function formatFlagNotes(notes) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return '<span class="flag-empty">-</span>';
  }

  return `<div class="flag-list">${notes.map(formatFlagNote).join("")}</div>`;
}

function formatFlagNote(note) {
  const parsed = parseComparisonNote(note);

  if (parsed) {
    return `
      <div class="flag-item">
        <div class="flag-field">${escapeCell(formatFieldLabel(parsed.field))}</div>
        <div class="flag-values">
          <span><em>Invoice</em>${escapeCell(parsed.invoice)}</span>
          <span><em>B2B</em>${escapeCell(parsed.reference)}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="flag-item flag-item-message">
      <div class="flag-field">${escapeCell(note)}</div>
    </div>
  `;
}

function parseComparisonNote(note) {
  const match = String(note || "").match(/^(.+?): invoice '([^']*)' vs db '([^']*)'$/);
  if (!match) return null;

  return {
    field: match[1],
    invoice: match[2],
    reference: match[3],
  };
}

function formatFieldLabel(field) {
  const labels = {
    po: "PO",
    po_sent_date: "Date",
    sku: "SKU",
    quantity: "Quantity",
    karat: "Karat",
    color: "Color",
    gold_weight_g: "Gold weight",
    gold_price_usd_per_oz: "Gold price",
    labour_cost_usd: "Labour",
    final_cost_usd: "Final price",
    "diamonds count": "Diamond count",
    "diamonds total carats": "Diamond total carats",
  };

  return labels[field] || field.replaceAll("_", " ");
}

function formatDiamonds(diamonds) {
  if (!Array.isArray(diamonds) || diamonds.length === 0) return "-";

  return diamonds
    .map((d) => {
      const total = d.total_carats === "" || d.total_carats == null ? "" : `, total ${d.total_carats}ct`;
      const perStone = d.carats === "" || d.carats == null ? "" : ` @ ${d.carats}ct`;
      const price = d.price_per_carat_usd == null || d.price_per_carat_usd === "" ? "" : `, $${d.price_per_carat_usd}/ct`;
      return escapeCell(`${d.count ?? "?"}x ${d.shape ?? "?"} ${d.quality ?? ""}${perStone}${total}${price}`);
    })
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
