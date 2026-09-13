# Dependency security

## Audit baseline

The dependency audit was refreshed with:

```bash
npm audit --json
```

Safe in-range dependency updates (`npm update`) reduced the report from 17 vulnerabilities (2 low, 6 moderate, 9 high) to 3 vulnerabilities (2 moderate, 1 high). Tests, lint, coverage, and the production build must pass after these updates. No `npm audit fix --force` was used.

The current measured coverage baseline is 81.34% statements, 64.47% branches, 80% functions, and 82.87% lines. CI publishes the report without enforcing a threshold yet; add a non-regressing threshold once the baseline is stable across CI runners.

Remaining findings include one direct high-severity vulnerability and no transitive high-severity vulnerabilities:

| Package | Relationship | Severity | Status |
| --- | --- | --- | --- |
| `xlsx@0.18.5` | direct production dependency | high | No npm registry fix is available. Findings are prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9). Replace or source a maintained SheetJS release in a separately tested change. Until then, exports must use application-generated data, not attacker-supplied workbook structures. |
| `react-router-dom@6.30.3` | direct production dependency | moderate | npm proposes React Router 7, a semver-major migration. Upgrade separately with routing regression tests. |
| `react-router` | transitive through `react-router-dom` | moderate | Resolved by the same React Router 7 migration. |

CI runs `npm audit --audit-level=high` as a non-blocking report because the remaining high finding in `xlsx` has no registry fix. ZeePOS explicitly accepts this temporary risk only for application-generated export data; importing or processing untrusted workbooks is not permitted. The follow-up is to replace `xlsx` with a maintained workbook library (or a maintained SheetJS distribution), add export parity and malicious-workbook regression tests, remove `xlsx`, then make the high-severity audit gate blocking. New findings remain visible in every CI run.

Static migration tests validate SQL text and frontend/API invariants only. They are not live Supabase runtime tests and do not replace staging migration and smoke testing.
