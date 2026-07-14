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

## Flow (matches brief §6)

1. Upload ledger  
2. Choose worksheet  
3. Headers & column mapping (suggest / confirm; flexible client headers)  
4. Clean population (flag totals, opening/closing, zeros/negatives, duplicates; exclude with reason)  
5. Planning inputs (objective, assertion, test type, sampling unit, error definition, …)  
6. Separate high-value items for specific testing  
7. Stratification as population **design** (not a method)  
8. Method recommendation + approval/override, residual sample size rationale, sampling-risk acknowledgement  
9. Generate sample on **residual** population only  
10. Testing results  
11. Working paper (sign-off, lock, amendment control tied to file-assembly deadline)

## Sample size guidance

- Residual ≤ 30 + high / very high risk → **60–70%** of residual (default 60%), rounded up  
- Residual > 30 → firm coverage % by risk (ceil); auditor may increase; reduce needs rationale + reviewer approval  

Sample size is always confirmed **before** item selection. No statistical confidence levels are calculated.
