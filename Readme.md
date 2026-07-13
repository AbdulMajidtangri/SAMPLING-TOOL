# Non-Statistical Audit Sampling Tool

Desktop app for guided non-statistical audit sampling (ISA 530 / ISA 230 oriented).

## Run

```bash
npm install
npm run dev
```

## Flow

1. Upload ledger (Excel / CSV)
2. Choose worksheet
3. Confirm auto-detected headers & column mapping (fix only if wrong)
4. Confirm transaction count and coverage value
5. Record audit objective and choose Path A or Path B
6. Confirm sample size
7. Select items (random, systematic, haphazard, block)
8. Record testing results
9. Print / export working paper
