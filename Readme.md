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
5. Reconcile to control total (explanation + reviewer if difference)  
6. Planning inputs (objective, assertion, test type, sampling unit, error definition, …)  
7. Separate high-value items for specific testing  
8. Stratification as population **design** (not a method)  
9. Method recommendation + approval/override, residual sample size rationale, sampling-risk acknowledgement  
10. Generate sample on **residual** population only  
11. Testing results  
12. Working paper (sign-off, lock, amendment control tied to file-assembly deadline)

## Sample size guidance

- Residual ≤ 30 + high / very high risk → **60–70%** of residual (default 60%), rounded up  
- Residual > 30 → firm coverage % by risk (ceil); auditor may increase; reduce needs rationale + reviewer approval  

Sample size is always confirmed **before** item selection. No statistical confidence levels are calculated.
