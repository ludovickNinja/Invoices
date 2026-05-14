# Factory Invoice Formats

This document describes the **shape and conventions** of the Excel invoices we
receive from each factory partner. No real factory data, supplier names, prices
or PO numbers are checked into the repo; every example below is **synthetic /
fabricated** for illustration. The synthetic example files live in
`docs/factory_invoice_examples/`.

Use this document as the source-of-truth when wiring up any extraction
workflow that converts a factory Excel into the dashboard upload JSON
(see `docs/invoice_upload_json_spec.md`).

---

## Shared concepts

All factories invoice us **per PO**, with one row per UID / barcode. The
columns vary but always carry the same eight semantic concepts:

| Concept | Canonical field in our DB | Notes |
| --- | --- | --- |
| Unique identifier | `uid` | Barcode tag on the physical piece |
| Purchase order | `po` | One invoice usually covers one or many POs |
| PO sent date | `po_sent_date` | Anchors the market gold price; ISO `YYYY-MM-DD` |
| SKU | `sku` | Internal design code |
| Quantity | `quantity` | Pieces shipped on the line |
| Metal | `karat`, `color` | e.g. `14K` + `White Gold` |
| Metal weight | `gold_weight_g` | Grams, per piece |
| Spot gold price | `gold_price_usd_per_oz` | Market USD/oz on `po_sent_date` |
| Diamonds | `diamonds[]` | Array — one entry per shape/quality combo |
| Labour | `labour_cost_usd` | Per piece |
| Final cost | `final_cost_usd` | Per piece total (gold + diamonds + labour) |

The `diamonds` array is the important new piece: a single ring can mount
multiple shapes at multiple qualities (e.g. a `Cushion VS2 F` center stone
with `Round VS G` pavé), so a flat `stone_breakdown` text field is no longer
sufficient.

```json
"diamonds": [
  { "shape": "Cushion", "quality": "VS2 F", "carats": 1.00,  "count": 1,  "price_per_carat_usd": 820.00 },
  { "shape": "Round",   "quality": "VS G",  "carats": 0.006, "count": 24, "price_per_carat_usd": 690.00 }
]
```

`quality` is the combined clarity + colour grade as written on the cert
(e.g. `VS1 F`, `SI2 H`). Keep them in that order so we can split later if
needed.

---

## Factory A — "Wide table, per-piece prices"

**Delivery channel:** single `.xlsx` per PO emailed to the intake mailbox.
**Sheet:** the first sheet, named `Invoice` or sometimes the PO number.

**Header rows:** 5 rows of header metadata before the table starts. The
header block contains:

- Row 1: Factory letterhead text (ignored)
- Row 2: `Invoice #` and `Invoice Date`
- Row 3: `PO #` and `PO Date` ← this is `po_sent_date`
- Row 4: `Gold Rate (USD/oz)` ← this is `gold_price_usd_per_oz`
- Row 5: blank

**Table starts at row 6.** Columns observed:

| Excel column | Maps to |
| --- | --- |
| `Barcode` | `uid` |
| `Design` | `sku` |
| `Qty` | `quantity` |
| `Metal` (e.g. `14K WG`) | split into `karat` + `color` |
| `Gold Wt (g)` | `gold_weight_g` |
| `Stone Description` | Free-text — needs LLM parsing into `diamonds[]` |
| `Stone $/pc` | sum of per-piece diamond cost; we reconstruct `price_per_carat_usd` from cert breakdown |
| `Labour $/pc` | `labour_cost_usd` |
| `Total $/pc` | `final_cost_usd` |

Quirks:

- Metal is a single cell `14K WG` / `18K YG` / `22K YG` / `14K RG`. Split on
  space; second token is colour (`WG → White Gold`, `YG → Yellow Gold`,
  `RG → Rose Gold`).
- `Stone Description` is free-text but follows the pattern
  `1x 0.50ct Round VS1 F + 20x 0.01ct Round SI1 G`. The n8n extractor splits
  on ` + `, then on `x ` and ` ` to recover shape/quality/carats/count.
- Decimal separator is `.`; thousands separator is `,`.

See `docs/factory_invoice_examples/factory_A_invoice.csv` for a generated
example of what the parsed sheet looks like.

---

## Factory B — "Tall table, per-stone rows"

**Delivery channel:** `.xlsx` uploaded to a shared Dropbox folder. Multiple POs
per workbook, one sheet per PO.

**Header rows:** 3 rows.
- Row 1: `Supplier:` (ignored), `Date:` ← this is `po_sent_date`
- Row 2: `Reference PO:` ← `po`, `Gold Spot (USD/Oz):` ← `gold_price_usd_per_oz`
- Row 3: blank

**Table starts at row 4.** Each *physical piece* spans multiple rows: the
first row holds the ring summary; subsequent rows (left-padded UID) hold one
diamond each.

| Column | Maps to (on ring row) | Maps to (on diamond row) |
| --- | --- | --- |
| `Tag No.` | `uid` | (repeated or blank) |
| `Style` | `sku` | — |
| `Pcs` | `quantity` | — |
| `Karat / Colour` (e.g. `18K / Yellow`) | `karat` + `color` | — |
| `Wt (g)` | `gold_weight_g` | — |
| `Shape` | — | `diamonds[].shape` |
| `Clarity/Color` (e.g. `VVS2 / E`) | — | `diamonds[].quality` (joined with space) |
| `Ct` | — | `diamonds[].carats` |
| `Pcs (stones)` | — | `diamonds[].count` |
| `$/Ct` | — | `diamonds[].price_per_carat_usd` |
| `Making $/pc` | `labour_cost_usd` | — |
| `Total $/pc` | `final_cost_usd` | — |

Quirks:

- Empty `Style` / `Pcs` cells on diamond rows mean "this row belongs to the
  ring above". The n8n workflow forward-fills `uid` and groups.
- `Clarity/Color` is written `VVS2 / E`; we store it as `VVS2 E`.
- Some sheets list a `Side Stones Bag` line where `Shape = SideBag`; treat
  that count as a single bulk row in `diamonds[]`.

See `docs/factory_invoice_examples/factory_B_invoice.csv` for a generated
example.

---

## Factory C — "Two sheets per workbook"

**Delivery channel:** OneDrive sync. `.xlsx` with two sheets: `Ring Summary`
and `Stone Detail`. Joined by `UID`.

`Ring Summary` columns:

| Column | Maps to |
| --- | --- |
| `UID` | `uid` |
| `PO` | `po` |
| `PO Sent` | `po_sent_date` |
| `SKU` | `sku` |
| `Quantity` | `quantity` |
| `Karat` | `karat` |
| `Color` | `color` |
| `Gold Weight (g)` | `gold_weight_g` |
| `Gold Spot (USD/Oz)` | `gold_price_usd_per_oz` |
| `Labour (USD)` | `labour_cost_usd` |
| `Final (USD)` | `final_cost_usd` |

`Stone Detail` columns:

| Column | Maps to |
| --- | --- |
| `UID` | (join key) |
| `Shape` | `diamonds[].shape` |
| `Quality` (already pre-joined, e.g. `VS1 F`) | `diamonds[].quality` |
| `Carats` | `diamonds[].carats` |
| `Count` | `diamonds[].count` |
| `USD/Ct` | `diamonds[].price_per_carat_usd` |

This is the cleanest format and what we standardise the other two into.

See `docs/factory_invoice_examples/factory_C_ring_summary.csv` and
`docs/factory_invoice_examples/factory_C_stone_detail.csv`.

---

## Output contract

Whatever pipeline you build for extraction, the only thing the dashboard
cares about is the upload JSON. The full schema, required fields and
tolerances live in **`docs/invoice_upload_json_spec.md`** — treat that as
the authoritative target. The three factory layouts above describe the
input side; the spec describes the output side.
