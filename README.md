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
