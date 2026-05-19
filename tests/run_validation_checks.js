const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const downloadsDir = "c:/Users/pnoory/Downloads";

const expectedRealFixtures = [
  { needle: "10-08 SF Shipment", expectedCount: 8 },
  { needle: "10-04 DIA Shipment", expectedCount: 12 },
  { needle: "Indo 5-11 Shipment", expectedCount: 6 },
  { needle: "Accent 11-06 Shipment", expectedCount: 62 },
];

const assertions = [];

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

async function main() {
  const app = loadApp();
  await app.dbReady;

  const realFiles = findRealFixtureFiles();
  const parsedLines = [];
  const start = process.hrtime.bigint();

  for (const fixture of realFiles) {
    const lines = await app.normalizeCsvUploads([fixture.file]);
    parsedLines.push(...lines);
    assertEqual(lines.length, fixture.expectedCount, `${fixture.file.name} parsed line count`);
  }

  if (realFiles.length === expectedRealFixtures.length) {
    const results = parsedLines.map(app.compareLine);
    assertEqual(parsedLines.length, 88, "all real fixtures total parsed lines");
    assertEqual(results.filter((result) => result.status === "match").length, 88, "seeded real fixtures match");
    assertEqual(results.filter((result) => result.status !== "match").length, 0, "seeded real fixtures flagged count");

    const shapeTotalLine = cloneLine(
      parsedLines.find((line) => line.__compareOptions?.diamondCompareMode === "shape-total" && line.diamonds.length)
    );
    shapeTotalLine.diamonds[0].total_carats = Number((shapeTotalLine.diamonds[0].total_carats + 0.01).toFixed(6));
    const shapeTotalResult = app.compareLine(shapeTotalLine);
    assertEqual(shapeTotalResult.status, "flagged", "shape-total diamond mutation status");
    assertIncludes(shapeTotalResult.notes.join(" | "), "total carats", "shape-total diamond mutation catches carats");

    const shapeQualityLine = cloneLine(
      parsedLines.find((line) => line.__compareOptions?.diamondCompareMode === "shape-quality-total" && line.diamonds.length)
    );
    shapeQualityLine.diamonds[0].price_per_carat_usd += 10;
    const shapeQualityResult = app.compareLine(shapeQualityLine);
    assertEqual(shapeQualityResult.status, "flagged", "shape-quality diamond mutation status");
    assertIncludes(shapeQualityResult.notes.join(" | "), "price_per_carat_usd", "shape-quality diamond mutation catches PPC");
  } else {
    assertions.push(`SKIP real fixture matching: found ${realFiles.length}/${expectedRealFixtures.length} source CSVs`);
  }

  const mismatchFile = makeRepoFile("docs/test_uploads/star_forever_mismatch_test.csv");
  const mismatchLines = await app.normalizeCsvUploads([mismatchFile]);
  const mismatchResults = mismatchLines.map(app.compareLine);
  const mismatchByUid = new Map(mismatchResults.map((result) => [result.line.uid, result]));
  assertEqual(mismatchLines.length, 8, "mixed Star Forever fixture line count");
  assertEqual(mismatchResults.filter((result) => result.status === "match").length, 4, "mixed Star Forever fixture matched count");
  assertEqual(mismatchResults.filter((result) => result.status === "flagged").length, 4, "mixed Star Forever fixture flagged count");

  const quantityMismatch = mismatchByUid.get("WB618675");
  assertEqual(quantityMismatch.status, "flagged", "Star Forever quantity/price mismatch status");
  assertIncludes(quantityMismatch.notes.join(" | "), "quantity", "mismatch catches quantity");
  assertIncludes(quantityMismatch.notes.join(" | "), "gold_weight_g", "mismatch catches gold weight");
  assertIncludes(quantityMismatch.notes.join(" | "), "labour_cost_usd", "mismatch catches labour");
  assertIncludes(quantityMismatch.notes.join(" | "), "final_cost_usd", "mismatch catches final price");
  assertIncludes(quantityMismatch.notes.join(" | "), "diamonds total carats", "mismatch catches diamond total");

  assertEqual(mismatchByUid.get("WB628076").status, "match", "Star Forever fixture keeps accurate zero-stone row matched");
  assertEqual(mismatchByUid.get("WB631389").status, "match", "Star Forever fixture keeps accurate yellow-gold row matched");
  assertEqual(mismatchByUid.get("WB632241").status, "match", "Star Forever fixture keeps accurate two-tone row matched");
  assertEqual(mismatchByUid.get("WB632738").status, "match", "Star Forever fixture keeps accurate platinum row matched");

  assertIncludes(mismatchByUid.get("WB628398").notes.join(" | "), "color", "mismatch catches metal color drift");
  assertIncludes(mismatchByUid.get("WB628398").notes.join(" | "), "final_cost_usd", "mismatch catches final price drift");
  assertIncludes(mismatchByUid.get("WB630752").notes.join(" | "), "sku", "mismatch catches style drift");
  assertIncludes(mismatchByUid.get("WB630752").notes.join(" | "), "gold_weight_g", "mismatch catches second gold weight drift");
  assertIncludes(mismatchByUid.get("WB633603").notes.join(" | "), "diamonds count", "mismatch catches diamond count drift");
  assertIncludes(mismatchByUid.get("WB633603").notes.join(" | "), "diamonds total carats", "mismatch catches second diamond total drift");

  await assertRejects(
    () => app.normalizeCsvUploads([{ name: "unsupported.csv", text: async () => "A,B\n1,2" }]),
    "Unsupported manufacturer CSV format",
    "unsupported CSV rejection"
  );

  const db = JSON.parse(fs.readFileSync(path.join(repoRoot, "mock_invoice_database.json"), "utf8"));
  const reference = db.rings.find((ring) => ring.uid === "WB618675");
  app.buildDbIndexes(db.rings);
  const alternateMatchLine = {
    ...reference,
    uid: "not-the-reference-key",
    __alternateMatchKeys: [reference.uid],
    __compareFields: ["po"],
    __compareOptions: { diamondCompareMode: "aggregate" },
  };
  assertEqual(app.compareLine(alternateMatchLine).status, "match", "alternate lookup key can match a unique reference");

  app.buildDbIndexes([
    { uid: "A1", po: "PO-DUP", sku: "SKU-A", diamonds: [] },
    { uid: "A2", po: "PO-DUP", sku: "SKU-B", diamonds: [] },
  ]);
  const ambiguous = app.compareLine({ uid: "missing", __alternateMatchKeys: ["PO-DUP"], __compareFields: [] });
  assertEqual(ambiguous.status, "flagged", "ambiguous fallback status");
  assertIncludes(ambiguous.notes.join(" | "), "Ambiguous keys", "ambiguous fallback note");
  app.buildDbIndexes(db.rings);

  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert(elapsedMs < 2000, `validation checks complete under 2s (${elapsedMs.toFixed(1)}ms)`);

  console.log(assertions.join("\n"));
}

function loadApp() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          addEventListener() {},
          textContent: "",
          innerHTML: "",
        });
      }
      return elements.get(id);
    },
  };
  const fetch = async () => ({
    json: async () => JSON.parse(fs.readFileSync(path.join(repoRoot, "mock_invoice_database.json"), "utf8")),
  });
  const script = fs.readFileSync(path.join(repoRoot, "script.js"), "utf8");
  const context = { document, fetch, console, require, process };

  vm.runInNewContext(
    `${script}
      globalThis.__app = {
        dbReady,
        normalizeCsvUploads,
        compareLine,
        buildDbIndexes
      };
    `,
    context
  );

  return context.__app;
}

function findRealFixtureFiles() {
  if (!fs.existsSync(downloadsDir)) return [];

  const names = fs.readdirSync(downloadsDir);
  return expectedRealFixtures
    .map((fixture) => {
      const name = names.find((candidate) => candidate.includes(fixture.needle) && candidate.endsWith(".csv"));
      if (!name) return null;
      return {
        ...fixture,
        file: {
          name,
          text: async () => fs.readFileSync(path.join(downloadsDir, name), "utf8"),
        },
      };
    })
    .filter(Boolean);
}

function makeRepoFile(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return {
    name: path.basename(fullPath),
    text: async () => fs.readFileSync(fullPath, "utf8"),
  };
}

function cloneLine(line) {
  if (!line) throw new Error("Missing parsed line for mutation test");
  return JSON.parse(JSON.stringify(line));
}

function assert(condition, label) {
  if (!condition) throw new Error(`FAIL ${label}`);
  assertions.push(`PASS ${label}`);
}

function assertEqual(actual, expected, label) {
  assert(Object.is(actual, expected), `${label}: expected ${expected}, got ${actual}`);
}

function assertIncludes(text, expected, label) {
  assert(text.includes(expected), `${label}: expected to include "${expected}"`);
}

async function assertRejects(fn, messagePart, label) {
  try {
    await fn();
  } catch (err) {
    assertIncludes(err.message, messagePart, label);
    return;
  }

  throw new Error(`FAIL ${label}: expected rejection`);
}
