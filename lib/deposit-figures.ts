/**
 * THE single "deposits" definition (closing diagnosis §D5 #5).
 *
 * Every surface that shows a deposits total — the admin
 * branch-accounts header, the admin financial summary and the
 * branch dashboard — uses exactly this figure:
 *
 *   deposits = Σ branch_cash_ledger.bank_deposits_out
 *              over the ledger days inside the stated window.
 *
 * The ledger column is the single source because it is what the
 * closing formula actually subtracts from the drawer, and it is
 * maintained by exactly one writer (lib/server/ledger-sync.ts).
 * It stays correct under the hybrid sync reality: deposits banked
 * after the lump-on-deposit_date fix contribute their full amount
 * on their deposit_date ledger row, older deposits contribute
 * their recorded per-day slices — both land in the same column.
 *
 * A DIFFERENT cut exists and is sometimes useful — the deposits
 * table's own total, Σ branch_bank_deposits.amount for approved,
 * not-reversed deposits attributed to their deposit_date ("banked
 * by deposit date"). It is NOT the deposits figure: it attributes
 * money to a different day and it counts amounts even when a
 * slice never reached the ledger (the known ৳11,627 SOTIBARI
 * slice, §D3-e). Wherever it is shown it must be labelled with
 * BANKED_BY_DEPOSIT_DATE_LABEL, never presented as "deposits".
 */

export const LEDGER_DEPOSITS_DEFINITION =
  'Deposits (ledger figure) = Σ branch_cash_ledger.bank_deposits_out over the ledger days in the window'

export const BANKED_BY_DEPOSIT_DATE_LABEL =
  'Banked by deposit date (different cut — deposits table: Σ approved, not-reversed branch_bank_deposits.amount attributed to deposit_date)'
