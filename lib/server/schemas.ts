/**
 * FIX2 F-11 (staged) — server-side request-body schemas.
 *
 * Audit 2 found zod declared but effectively unused server-side:
 * 0 of 106 API routes validated bodies against a schema, so
 * field/type discipline varied route by route. This module starts
 * the uniform gate with the highest-risk POST surfaces (auth
 * credential changes, expense requests, salary issue, deposits).
 *
 * STAGED-ADOPTION RULE: routes safeParse for VALIDATION ONLY and
 * keep using their raw body afterwards. Schemas therefore declare
 * the fields each route actually reads, with permissive types
 * where the route's own parsers already accept several shapes
 * (money arrives as number or numeric string — parseMoneyAmount
 * handles both, so `moneyLike` accepts both). Unknown fields never
 * fail (zod strips, does not reject), and the routes' existing
 * semantic checks (status whitelists, money recomputation, FR
 * guards) remain the authority — a schema pass never weakens them,
 * it only guarantees the declared fields have sane types before
 * the hand-rolled logic runs.
 */
import { z } from 'zod'

/** Money as clients actually send it: number or numeric string. */
const moneyLike = z.union([z.number().finite(), z.string().min(1)])

const optStr = z.string().optional().nullable()
const optMoney = moneyLike.optional()

export function firstZodError(err: z.ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'Invalid request body.'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

/** Validation-only gate: ok, or the first issue as a client-safe message. */
export function validateBody(
  schema: z.ZodType,
  body: unknown
): { ok: true } | { ok: false; error: string } {
  const res = schema.safeParse(body)
  return res.success ? { ok: true } : { ok: false, error: firstZodError(res.error) }
}

// ── Auth ─────────────────────────────────────────────────────────

/** change-password: current password strictly required (F-01);
 *  the new password arrives as `newPassword` (legacy alias
 *  `password` accepted — the presence of one of them is enforced
 *  here, the policy itself is validatePasswordPolicy's job). */
export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.newPassword ?? d.password), {
    message: 'New password is required.',
    path: ['newPassword'],
  })

export const completeResetBodySchema = z.object({
  reqId: z.string().min(1, 'reqId is required'),
  newPassword: z.string().min(1, 'New password is required'),
})

// ── Expense requests ─────────────────────────────────────────────

export const expenseRequestCreateBodySchema = z.object({
  title: z.string().min(1, 'Title is required.'),
  amount: moneyLike,
  paid_amount: optMoney,
  branch_id: z.string().min(1, 'branch_id is required'),
  description: optStr,
  is_purchased: z.boolean().optional(),
  payment_method: z.string().optional(),
  account_holder_name: optStr,
  account_number: optStr,
  bank_name: optStr,
  bank_branch: optStr,
})

export const expenseRequestPatchBodySchema = z.object({
  action: z.enum(['pay', 'confirm', 'reject']).optional(),
  trx_id: optStr,
  admin_notes: optStr,
  title: z.string().optional(),
  description: optStr,
  amount: optMoney,
  paid_amount: optMoney,
  status: z.enum(['pending', 'approved', 'rejected', 'paid']).optional(),
})

// ── Salary issue ─────────────────────────────────────────────────

export const salaryIssueBodySchema = z.object({
  employee_id: z.string().min(1, 'employee_id is required'),
  ledger_head_id: z.string().min(1, 'ledger_head_id is required'),
  branch_id: optStr,
  basic_salary: optMoney,
  overtime_amount: optMoney,
  bonus_amount: optMoney,
  sales_commission: optMoney,
  tiffin_bill: optMoney,
  payment_proof_url: optStr,
  account: optStr,
})

// ── Deposits ─────────────────────────────────────────────────────

export const depositCreateBodySchema = z.object({
  deposit_date: z.string().min(1, 'deposit_date is required'),
  sales_from_date: z.string().min(1, 'sales_from_date is required'),
  sales_to_date: z.string().min(1, 'sales_to_date is required'),
  amount: moneyLike,
  khuchra_amount: optMoney,
  bank_account_name: z.string().min(1, 'bank_account_name is required'),
  branch_id: optStr,
  bank_account_number: optStr,
  deposit_slip_number: optStr,
  bank_transaction_id: optStr,
  deposited_by_name: optStr,
  slip_attachment_url: optStr,
  bank_statement_url: optStr,
  status: z.string().optional(),
  notes: optStr,
  // Shape/sum are validateBreakdown's job (route keeps it).
  daily_breakdown: z.unknown().optional(),
})
