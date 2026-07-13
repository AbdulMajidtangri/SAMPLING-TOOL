# Non-Statistical Audit Sampling Tool

Desktop Electron + React app aligned with the project brief (ISA 530 / ISA 230 oriented).

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
3. Confirm auto header + column mapping (hard stops if required fields missing)  
4. Confirm population (resolve Debit+Credit conflicts; exclude rows with reason)  
5. Audit objective / sampling unit / engagement details + Path A or B  
6. Confirm sample size (overrides documented; below-floor needs reviewer approval)  
7. Select items (random / systematic / haphazard / block)  
8. Testing + evaluation  
9. Printable working paper (config snapshot + data hash + untested remainder)

Sample size is always confirmed **before** item selection.
