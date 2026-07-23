Non-Statistical Audit Sampling Tool

A professional audit sampling system that digitizes the traditional Excel-based non-statistical sampling process used by audit firms. The tool guides auditors through ledger upload, data preparation, sample size determination, transaction selection, testing documentation, and working paper generation while preserving professional judgment and complying with auditing standards.

Overview

The Non-Statistical Audit Sampling Tool is designed to replace manual audit sampling spreadsheets with a structured and reproducible workflow.

Instead of calculating samples manually in Excel, auditors can upload their client ledger, configure the sampling process, document professional judgments, perform transaction selection, record testing results, and automatically generate a complete audit working paper.

The system supports non-statistical audit sampling only and is designed around the principles of ISA 530 and ISA 230.

Important

This tool assists auditors in performing audit sampling.
It does not replace professional judgment, make audit conclusions, or perform statistical sampling.

1. **Sampling Workspace** — all auditor work in one place (upload, mapping, data quality, audit info, sample size, selection)
2. **Working Paper** — preview, print/export, and sign-off of the selected items only (no testing conclusion or evaluation)

The project aims to:

Digitize manual audit sampling.
Reduce spreadsheet errors.
Standardize audit sampling across engagements.
Improve audit documentation.
Produce review-ready working papers.
Ensure every audit decision is traceable.
Keep auditors in control of every judgment.
Key Features
Ledger Processing
Upload Excel ledger files.
Multiple worksheet support.
Automatic header detection.
Automatic data range detection.
Intelligent column mapping.
Header synonym recognition.
Case-insensitive matching.
Common spelling correction.
Auditor confirmation before processing.
Flexible Ledger Support

1. Ledger upload (worksheet + file)
2. Headers & column mapping (confidence + required confirmation)
3. Data quality (flags, Debit/Credit resolution, population confirm)
4. Audit information + Path A / Path B
5. Sample size confirmation (hard stop before item selection)
6. Selection method (exact confirmed size)
7. Selected items review → Preview working paper

Different column orders
Different header names
Additional client-specific columns
Report title rows
Multiple date columns
Repeated headers
Various debit/credit formats

No fixed Excel template is required.

Sample Size Determination

The system separates:

Sample Size Determination

from

Transaction Selection

This follows ISA 530 principles.

Two independent sample-size approaches are available.

Path A — Risk Score Model

Professional judgment based.

Considers:

Audit Risk
Expected Error
Other Audit Evidence

Produces a recommended sample size using the firm's configured methodology.

Path B — Value Coverage Model

Coverage-based approach.

The system calculates:

Total population value
Required coverage percentage
Minimum coverage requirement
Suggested sample size
Minimum transaction floor

The suggested sample size is confirmed by the auditor before selection begins.

Non-Statistical Selection Methods

After confirming sample size, the auditor may select:

Random Selection
Systematic Selection
Haphazard (Manual) Selection
Block Selection

Each method records all information necessary for reproducibility.

Working Paper Generation

The system automatically generates a professional audit working paper including:

Audit objective
Sampling unit
Population information
Sample-size rationale
Selection method
Selected transactions
Testing results
Exceptions identified
Auditor conclusion
Reviewer section
Untested remainder (where applicable)
Audit Documentation

The system records:

Auditor decisions
Sample-size overrides
Selection method changes
Configuration snapshot
Reasons for manual adjustments
Working paper history
Data Quality Checks

The system performs basic validation before sampling, including:

Required column verification
Numeric amount validation
Header confirmation
Duplicate detection
Repeated header detection
Zero-value warnings
Debit/Credit inconsistencies
Coverage calculation validation

These checks help prevent obvious sampling errors but do not perform full population validation or reconciliation.

Project Workflow
Upload Ledger
        │
        ▼
Select Worksheet
        │
        ▼
Confirm Header Row
        │
        ▼
Confirm Data Range
        │
        ▼
Map Ledger Columns
        │
        ▼
Confirm Population
        │
        ▼
Record Audit Objective
        │
        ▼
Choose Sample Size Method
        │
        ▼
Calculate Sample Size
        │
        ▼
Auditor Confirmation
        │
        ▼
Select Transactions
        │
        ▼
Perform Audit Testing
        │
        ▼
Evaluate Results
        │
        ▼
Generate Working Paper
Design Principles

The project follows several important principles:

Auditor judgment is never replaced.
Sample size is always determined before selection.
Every manual override is documented.
Every important action is traceable.
Different client ledger formats are supported.
Reproducibility is maintained for every selection.
Working papers remain understandable for reviewers.
Compliance

The tool is designed around the concepts of:

ISA 530 — Audit Sampling
ISA 230 — Audit Documentation

It supports professional non-statistical audit sampling while maintaining documentation expected during audit reviews.

Current Scope

This version includes:

Non-statistical sampling
Risk-based sample sizing
Value coverage sample sizing
Intelligent ledger mapping
Four selection methods
Working paper generation
Override documentation
Configuration snapshots
Audit trail
Not Included

The current version does not include:

Statistical sampling
Confidence level calculations
Probability-based sampling risk
Population reconciliation
Full data cleansing
Automatic audit conclusions
AI-generated audit opinions
Success Criteria

The project is considered successful when:

Auditors can complete the entire sampling process digitally.
Different ledger formats are handled without requiring template changes.
Sample size is always confirmed before selection.
Every override is documented.
Working papers are suitable for review and printing.
The generated documentation is understandable by another experienced auditor.
Future Enhancements

Potential future improvements include:

Statistical sampling module
Materiality integration
Multi-user collaboration
Cloud storage
Review dashboards
Audit analytics
Firm-specific templates
ERP integrations
Digital sign-offs
AI-assisted anomaly detection
Project Status

Current Status: In Development

The project is actively being designed and implemented with a focus on professional audit workflows, usability, reproducibility, and compliance with international auditing standards.

License

This project is intended for educational and professional audit software development purposes. Licensing terms will be defined upon public release.
