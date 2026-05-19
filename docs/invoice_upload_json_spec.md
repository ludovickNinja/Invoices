# Invoice Upload JSON — Specification

The Invoice Validation Dashboard accepts **one JSON file per upload**. The file
represents the contents of a single factory invoice (one or more PO lines) and
is compared row-by-row against the reference data pulled from Azure.

If you are building the side workflow that converts factory Excels into this
format, conform to the contract below.

---

## 1. Top-level shape

```json
{
  "lines": [ /* one entry per UID / barcode on the invoice */ ]
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `lines` | array of `Line` | yes | Must be present even if empty. A bare top-level array (`[ ... ]`) is also accepted as a fallback. |

A `Line` represents one physical SKU/UID on the invoice. Each `Line` has the
fields below.

---

## 2. Line fields

| Field | Type | Required | Format / Constraint |
| --- | --- | --- | --- |
| `uid` | string | yes | Barcode tag as printed on the piece. Trimmed; case-sensitive. Must exist in the Azure reference DB or the line is flagged as `UID not found in database`. |
| `po` | string | yes | Purchase order number, e.g. `PO-47812`. |
| `po_sent_date` | string | yes | ISO `YYYY-MM-DD`. The day the PO was issued — this is the anchor day for `gold_price_usd_per_oz`. |
| `sku` | string | yes | Internal design code, e.g. `RNG-14K-WH-001`. |
| `quantity` | integer | yes | Pieces shipped on this line. |
| `karat` | string | yes | One of `14K`, `18K`, `22K`. |
| `color` | string | yes | One of `White Gold`, `Yellow Gold`, `Rose Gold`. |
| `gold_weight_g` | number | yes | Grams per piece. |
| `gold_price_usd_per_oz` | number | yes | **Spot market gold price per troy ounce in USD on `po_sent_date`.** This is the value the dashboard validates against the recorded market fix for that day. |
| `diamonds` | array of `Diamond` | yes | One entry per distinct shape + quality combination on the piece. May be `[]` for plain-metal pieces. |
| `labour_cost_usd` | number | yes | Labour cost per piece, USD. |
| `final_cost_usd` | number | yes | Final cost per piece, USD (gold + diamonds + labour). |

A `Diamond` entry has these fields — **all required**:

| Field | Type | Notes |
| --- | --- | --- |
| `shape` | string | `Round`, `Princess`, `Oval`, `Cushion`, `Emerald`, `Pear`, `Marquise`, `Asscher`, `Radiant`, `Heart`, or `SideBag` for bulk melee. |
| `quality` | string | Clarity + colour grade, space-separated, in that order. Examples: `VS1 F`, `VVS2 E`, `SI1 G`, `IF D`. |
| `carats` | number | Carats per stone (not the row total). |
| `count` | integer | Number of stones of this shape + quality on the piece. |
| `price_per_carat_usd` | number | USD per carat for this shape + quality. |

Why an array? One ring can carry multiple shapes at multiple qualities — for
example a `Cushion VS2 F` centre stone with `Round VS G` pavé. A single
free-text description can't represent that cleanly, so we model each
shape/quality bucket as its own entry.

---

## 3. Worked example

```json
{
  "lines": [
    {
      "uid": "RG-10001-A",
      "po": "PO-47812",
      "po_sent_date": "2026-02-12",
      "sku": "RNG-14K-WH-001",
      "quantity": 10,
      "karat": "14K",
      "color": "White Gold",
      "gold_weight_g": 2.85,
      "gold_price_usd_per_oz": 2018.40,
      "diamonds": [
        { "shape": "Round", "quality": "VS1 F", "carats": 0.50, "count": 1,  "price_per_carat_usd": 720.00 },
        { "shape": "Round", "quality": "SI1 G", "carats": 0.01, "count": 20, "price_per_carat_usd": 300.00 }
      ],
      "labour_cost_usd": 115.00,
      "final_cost_usd": 719.95
    }
  ]
}
```

See `sample_invoice_upload.json` for a multi-line file covering matched lines,
red-flagged mismatches, and an unknown UID.

---

## 4. Validation rules

After upload, every line must satisfy:

1. `uid` exists in the Azure reference DB.
2. Scalar fields match the reference within tolerance:
   - `gold_weight_g`: ±0.01 g
   - `gold_price_usd_per_oz`: ±0.50 USD (allows for intraday fix vs market open)
   - `labour_cost_usd`: ±0.50 USD
   - `final_cost_usd`: ±1.00 USD
   - All other scalars (`po`, `po_sent_date`, `sku`, `quantity`, `karat`, `color`) match exactly (case-insensitive for strings).
3. `diamonds[]` matches the reference array as a **set** keyed on
   `shape + quality`, with per-entry tolerances:
   - `carats`: ±0.001 ct
   - `count`: exact
   - `price_per_carat_usd`: ±1.00 USD
4. Any extra or missing diamond entry flags the line.

Anything failing the above is highlighted as a red-flag row. Open the row to see
the field-level delta for each value that drifted.

---

## 5. Authoring tips

- Numbers should be **numbers**, not strings. `"2.85"` will not match `2.85`
  with full precision.
- Use ISO dates: `2026-02-12`, not `02/12/2026`.
- Keep the clarity-then-colour order in `quality` (`VS1 F`, not `F VS1`) —
  the comparison normalises case but not order.
- For melee / side-stone bags, use `shape: "SideBag"` and treat the bag as
  one entry with the aggregate carats and a representative `quality`.
- Trim trailing whitespace from `uid` before emitting — the dashboard trims
  on its side, but other downstream consumers may not.
