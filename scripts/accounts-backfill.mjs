import { PrismaClient } from "@prisma/client";
import { seedFiscal, seedChartOfAccounts, seedBankCandidates } from "../lib/server/accounting/seed.ts";
import { buildClosingLines, postForSource } from "../lib/server/accounting/events.ts";
import { postEvent } from "../lib/server/accounting/post.ts";
import { storeOpeningPosition } from "../lib/server/accounting/opening.ts";
import { trialBalance, classReconciliation, unpostedSources, taka } from "../lib/server/accounting/reports.ts";
const prisma = new PrismaClient();
const out = { steps: {} };
async function auditRow(action, entityTable, entityId, newValue) {
  await prisma.auditLog.create({
    data: {
      actor_id: null,
      actor_name: "Accounts A1 backfill (system)",
      actor_role: "system",
      action,
      event_type: "create",
      table_name: entityTable,
      entity_table: entityTable,
      entity_id: entityId,
      record_id: null,
      new_value: newValue ?? null
    }
  });
}
async function backfillClass(label, rows, run) {
  let created = 0;
  let already = 0;
  let skipped = 0;
  for (const row of rows) {
    const res = await run(row);
    if (res === null) skipped++;
    else if (res.created) created++;
    else already++;
  }
  out.steps[label] = { total: rows.length, created, already, skipped };
  console.error(`[backfill] ${label}: total ${rows.length}, created ${created}, already ${already}, skipped ${skipped}`);
}
async function main() {
  out.before = {
    journal_entries: await prisma.journalEntry.count(),
    journal_lines: await prisma.journalLine.count(),
    chart_accounts: await prisma.chartAccount.count(),
    bank_accounts: await prisma.bankAccount.count(),
    opening_positions: await prisma.openingPosition.count(),
    audit_logs: await prisma.auditLog.count()
  };
  out.steps.fiscal = await seedFiscal(prisma);
  const coa = await seedChartOfAccounts(prisma);
  out.steps.coa_created = coa.created;
  out.steps.coa_existing = coa.existing;
  const banks = await seedBankCandidates(prisma);
  out.steps.bank_candidates_created = banks.created;
  out.steps.bank_candidates_existing = banks.existing;
  if (coa.created.length || banks.created.length) {
    await auditRow("accounts.seed", "chart_accounts", null, {
      coa_created: coa.created,
      bank_candidates_created: banks.created
    });
  }
  const closings = await prisma.branchCashLedger.findMany({ orderBy: { ledger_date: "asc" } });
  await backfillClass("closings", closings, async (row) => {
    const lines = buildClosingLines(row);
    if (lines.length === 0) return null;
    return postEvent(prisma, {
      source_table: "branch_cash_ledger",
      source_id: row.id,
      event_type: "closing",
      entry_date: row.ledger_date.toISOString().slice(0, 10),
      memo: `Daily closing \u2014 ${row.ledger_date.toISOString().slice(0, 10)}`,
      lines
    });
  });
  const viaSource = (table) => async (row) => postForSource(prisma, table, row.id);
  await backfillClass("branch_expenses", await prisma.branchCashExpense.findMany(), viaSource("branch_cash_expenses"));
  await backfillClass("company_expenses", await prisma.companyExpense.findMany(), viaSource("company_expenses"));
  await backfillClass("salaries", await prisma.salaryPayment.findMany(), viaSource("salary_payments"));
  await backfillClass("expense_requests", await prisma.employeeExpenseRequest.findMany(), viaSource("employee_expense_requests"));
  await backfillClass("deposits", await prisma.branchBankDeposit.findMany(), viaSource("branch_bank_deposits"));
  await backfillClass("chalans", await prisma.productChalan.findMany(), viaSource("product_chalans"));
  const journalCreated = await prisma.journalEntry.count() - out.before.journal_entries;
  await auditRow("accounts.backfill", "journal_entries", null, {
    entries_created_this_run: journalCreated,
    steps: out.steps
  });
  const existingDraft = await prisma.openingPosition.findFirst({ where: { status: "draft" } });
  if (!existingDraft) {
    const { position_id, computation } = await storeOpeningPosition(prisma);
    out.steps.opening_position = {
      stored: position_id,
      status: "draft",
      totals: {
        debits: taka(Math.round(computation.totals.debits * 100)),
        credits: taka(Math.round(computation.totals.credits * 100)),
        equity: taka(Math.round(computation.totals.equity * 100))
      },
      lines: computation.lines.map((l) => `${l.side} ${l.amount.toFixed(2)} \u2014 ${l.label}`),
      flags: computation.flags.map((f) => f.code)
    };
    await auditRow("accounts.opening_computed", "opening_positions", position_id, {
      status: "draft",
      equity: computation.totals.equity,
      flags: computation.flags.map((f) => f.code)
    });
  } else {
    out.steps.opening_position = { stored: null, reason: "a DRAFT already exists", id: existingDraft.id };
  }
  const tb = await trialBalance(prisma);
  out.trial_balance = {
    entries: tb.entry_count,
    total_debit: taka(tb.total_debit),
    total_credit: taka(tb.total_credit),
    difference: taka(tb.difference),
    balanced: tb.balanced,
    non_zero_accounts: tb.rows.filter((r) => r.debit !== 0 || r.credit !== 0).map((r) => `${r.code} ${r.name}: Dr ${taka(r.debit)} / Cr ${taka(r.credit)} / Bal ${taka(r.balance)}`)
  };
  out.reconciliation = (await classReconciliation(prisma)).map((r) => ({
    cls: r.cls,
    source: taka(r.source_total),
    journal: taka(r.journal_total),
    match: r.match,
    ...r.note ? { note: r.note } : {}
  }));
  out.unposted = await unpostedSources(prisma);
  out.after = {
    journal_entries: await prisma.journalEntry.count(),
    journal_lines: await prisma.journalLine.count(),
    chart_accounts: await prisma.chartAccount.count(),
    bank_accounts: await prisma.bankAccount.count(),
    opening_positions: await prisma.openingPosition.count(),
    audit_logs: await prisma.auditLog.count()
  };
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
