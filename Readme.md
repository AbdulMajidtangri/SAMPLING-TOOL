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

## Flow

1. Upload ledger  
2. Choose worksheet  
3. Headers & column mapping (required confirmation; editable data range; hard-stop mapping errors)  
4. Confirm population (count & coverage value; Debit/Credit resolution; exclusions with reason)  
5. Planning inputs (objective, assertion, test type, sampling unit, error definition, Path A/B)  
6. Method recommendation + approval/override, sample size rationale, sampling-risk acknowledgement  
7. Generate sample on the active population  
8. Testing results (Path B coverage review / untested remainder; §20 removal forces re-selection)  
9. Working paper (mapping summary, confirmed count/value, config snapshot JSON, sign-off / lock / amendment)

## Sample size — two paths

- **Path A (risk matrix):** risk + expected error + other evidence → firm matrix size. For ≤30 high-risk populations, also apply **60–70%** count coverage (default 60%) and take the higher result.
- **Path B (value coverage):** monetary tier % of population value → suggested item count. Selection method still chooses *which* items. Blocked when total coverage value is zero. After selection, coverage vs required is reviewed (§13.8); shortfalls need size increase / re-run or documented acceptance.

Auditor picks the path at Planning. Sample size is confirmed before item selection. No statistical confidence levels are calculated.
