# Invoices

## Testing discrepancy detection

The local `mock_invoice_database.json` is the reference database used by the
browser app. If you seed it from the exact same CSV you upload, the rows should
match by design; that only proves parsing and matching are wired correctly.

To test red-flag behavior, upload:

`docs/test_uploads/star_forever_mismatch_test.csv`

That file uses all seeded Star Forever keys and mixes accurate rows with
deliberately changed rows. It covers quantity, metal color, SKU, gold weight,
labour, final price, diamond count, and diamond total carat conflicts. The app
should leave the accurate rows matched and flag the changed rows with expandable
field-level mismatch notes.

Run the automated smoke checks with:

```bash
node tests/run_validation_checks.js
```

## Order source and job bags

Each reference record in `mock_invoice_database.json` carries a `source`
code (`111`, `123`, `558`, `559`, …). It is never read from the uploaded
invoice; the dashboard joins it onto a line once the UID resolves against the
reference DB and shows it in the **Source** column.

Use the **Source** dropdown in the Line Review header to narrow the table to
one code. The three metric cards and the **Print Job-Bags** button both follow
the filtered view, so filtering to `558` and printing yields one job bag per
`558` line only. Job bags open in a new window sized for print, one card per
line (UID, source, PO, metal, stone breakdown, status), and trigger the browser
print dialog automatically.
