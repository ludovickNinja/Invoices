# n8n: Factory Invoice Intake

This folder ships an importable n8n workflow that watches a folder for factory
invoice Excel files, runs them through Claude to extract a canonical JSON, and
writes both:

- A `*-canonical.json` payload — ready to upload to the Invoice Validation
  Dashboard (the `index.html` in this repo).
- A `invoice-dashboard-*.xlsx` flattened workbook — for humans who want to
  eyeball the parsed result.

## File

- `invoice_intake_workflow.json` — import via **n8n → Workflows → Import from
  File**.

## Folder layout assumed on the n8n host

```
/data/invoices/incoming   ← factories drop .xlsx files here
/data/invoices/processed  ← canonical .json + dashboard .xlsx land here
/data/invoices/archive    ← original source files moved here after processing
```

Adjust the `Watch invoices folder`, `Write canonical JSON`, `Save Excel to disk`
and `Archive source invoice` nodes if your paths differ. Swap the local-file
trigger for **Google Drive Trigger / Dropbox Trigger / OneDrive Trigger** if
intake is cloud-based.

## Credentials

The `Claude: extract to canonical JSON` node uses an **Anthropic API**
credential. Create one under **Credentials → New → Anthropic API** and select
it in the node (replace the `REPLACE_WITH_ANTHROPIC_CREDENTIAL_ID` placeholder
on first run — n8n will prompt you).

Model in use: `claude-sonnet-4-6`. Bump to `claude-opus-4-7` if you find
extraction quality insufficient on Factory A's free-text stone descriptions.

## How it works

1. **Watch invoices folder** — fires on every new file landing in
   `/data/invoices/incoming`.
2. **Only .xlsx** — skip lock files / temp files.
3. **Read Excel binary → Parse Excel → rows** — load the workbook as raw rows
   (no header inference) so we don't lose Factory A's metadata block.
4. **Detect factory layout** — scans the first ~12 rows for known anchor
   strings (`Aurelia`, `Reference PO:`, `Ring Summary` …) and tags the run as
   factory `A`, `B`, `C` or `UNKNOWN`.
5. **Claude: extract to canonical JSON** — sends the rows + factory tag to
   Claude with a strict schema prompt. The system message describes each
   factory's quirks (`14K WG → 14K + White Gold`, etc.) so the model can
   normalise without per-factory branching in n8n.
6. **Parse + validate canonical** — JSON-parses the LLM output, surfaces
   errors loudly if the model returned non-JSON.
7. Two outputs:
   - **Write canonical JSON** — the file you drop into the dashboard.
   - **Flatten for Excel → Write dashboard Excel → Save Excel to disk** — a
     human-readable workbook of the same data.
8. **Archive source invoice** — `mv` the original `.xlsx` into
   `/data/invoices/archive/`.

## Extending

- Add a new factory? Add an anchor string to the `Detect factory layout`
  Code node and a bullet under "Rules" in the LLM prompt — no new nodes
  needed.
- Need to push to the dashboard automatically? Append an HTTP Request node
  POSTing the canonical JSON to the dashboard's upload endpoint (currently
  the dashboard is static / drag-and-drop only, so this is a future hook).
- Want to gate on Azure DB validation before approving the line? Add an
  HTTP Request node hitting your Azure-fronting API between
  `Parse + validate canonical` and `Write canonical JSON`, then branch on
  the response.

## Synthetic examples for testing

Drop any of the CSVs in `docs/factory_invoice_examples/` into a workbook,
save as `.xlsx`, and place it in `/data/invoices/incoming` to smoke-test
the workflow end-to-end. No real factory data is checked into this repo.
