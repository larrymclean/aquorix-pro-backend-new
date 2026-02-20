# AQUORIX Internal Policy — VIKING Currency Policy

Document: VIKING-CURRENCY-001
Repository: aquorix-backend
Path: docs/policies/VIKING_CURRENCY_POLICY.md

Author: Larry McLean (Product Owner)
Advisors: ChatGPT (Lead), Grok / Claude / Windsurf (Overwatch)
Created: 2026-02-20
Version: 1.0.0
Status: LOCKED (Internal / Execution Phase)

Change Log (append-only):
- 2026-02-20 - v1.0.0 (Larry / Team Overwatch):
  - Adopt “operator home currency” charging for VIKING.
  - Allow optional customer-local FX estimate (display-only).
  - Defer multi-currency charging/settlement to PATHFINDER.

## Policy

1) Charge Currency (VIKING)
- All Stripe charges MUST be processed in the operator’s default currency.
- Source of truth: aquorix.diveoperators.default_currency
- Jordan operators default to: JOD

2) Display Currency (Optional UX)
- UI MAY display an estimated amount in the customer’s detected currency.
- This estimate is display-only and MUST NOT change the charge currency.
- UI MUST disclose: “Estimated conversion. Final charge is in operator currency.”

3) Explicit Non-Goals (VIKING)
- No multi-currency charging.
- No FX rate storage required for business logic.
- No multi-currency reconciliation/settlement logic.

4) Payment Status Enum Mapping (VIKING)
- unpaid = not paid yet (includes in-checkout and all in-progress states)
- paid = webhook-confirmed success only
- deposit_paid = partial payment (if enabled)
- settled_elsewhere = cash / bank transfer / POS outside Stripe
- waived / comped = operator override
