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
3. Headers & column mapping (suggest / confirm; flexible client headers)  
4. Planning inputs (objective, assertion, test type, sampling unit, error definition, …)  
5. Method recommendation + approval/override, sample size rationale, sampling-risk acknowledgement  
6. Generate sample on the active population  
7. Testing results  
8. Working paper (sign-off, lock, amendment control tied to file-assembly deadline)

## Sample size guidance

- Population ≤ 30 + high / very high risk → **60–70%** of population (default 60%), rounded up  
- Population > 30 → firm coverage % by risk (ceil); auditor may increase; reduce needs rationale + reviewer approval  

Sample size is always confirmed **before** item selection. No statistical confidence levels are calculated.
