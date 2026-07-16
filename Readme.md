# Non-Statistical Audit Sampling Tool

Desktop Electron + React app aligned with the project brief (ISA 530 / ISA 230 / ICAP).

## Run

```bash
npm install
npm run dev
```

## Test

```bash
npm test
```

## Two-screen flow

The app has **only two main screens**:

1. **Sampling Workspace** — all auditor work in one place (upload, mapping, data quality, audit info, sample size, selection, testing, evaluation)
2. **Working Paper** — preview, print/export, and sign-off only (no recalculation or selection)

Top navigation: `Sampling Workspace | Working Paper`

## Workspace sections (Screen 1)

1. Ledger upload (worksheet + file)
2. Headers & column mapping (confidence + required confirmation)
3. Data quality (flags, Debit/Credit resolution, population confirm)
4. Audit information + Path A / Path B
5. Sample size confirmation (hard stop before item selection)
6. Selection method (exact confirmed size)
7. Testing results & evaluation → Preview working paper

## Sample size — two paths

- **Path A (risk matrix):** risk + expected error + other evidence → firm matrix size (capped at population).
- **Path B (value coverage):** monetary tier % → suggested item count via provisional sizing (not final selection). Selection method still chooses *which* items.

No statistical confidence levels are calculated.
