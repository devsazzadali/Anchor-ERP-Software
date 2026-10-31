import { PrismaClient } from "@prisma/client";
import { reverseEntry } from "../lib/server/accounting/post.ts";
import { postForSource } from "../lib/server/accounting/events.ts";
import { branchCashExpenseStream } from "../lib/expense-streams.ts";
import { trialBalance, taka } from "../lib/server/accounting/reports.ts";
const prisma = new PrismaClient();
const TODAY = "2026-10-31";
const MEMO = "A1 build correction \u2014 credit leg moved from branch drawer to Head Office cash (ledger-sync law: only branch-stream rows move the drawer)";
async function tbLines() {
  const tb = await trialBalance(prisma);
  return tb.rows.filter((r) => ["1000", "1005", "5010"].includes(r.code)).map((r) => `${r.code}: Dr ${taka(r.debit)} / Cr ${taka(r.credit)}`);
}
async function main() {
  const out = { before: await tbLines(), reversed: 0, reposted: 0 };
  const targets = [];
  const salaryEntries = await prisma.journalEntry.findMany({
    where: { source_table: "salary_payments", event_type: "salary" }
  });
  for (const e of salaryEntries) targets.push({ table: "salary_payments", id: e.source_id, entryId: e.id });
  const bceEntries = await prisma.journalEntry.findMany({
    where: { source_table: "branch_cash_expenses", event_type: "branch_expense" }
  });
  for (const e of bceEntries) {
    const row = await prisma.branchCashExpense.findUnique({ where: { id: e.source_id } });
    if (row && branchCashExpenseStream(row) === "ledger-head") {
      targets.push({ table: "branch_cash_expenses", id: e.source_id, entryId: e.id });
    }
  }
  out.targets = targets.length;
  for (const t of targets) {
    const rev = await reverseEntry(prisma, t.entryId, { entry_date: TODAY, memo: MEMO });
    if (rev.created) out.reversed++;
    const re = await postForSource(prisma, t.table, t.id);
    if (re?.created) out.reposted++;
  }
  await prisma.auditLog.create({
    data: {
      actor_id: null,
      actor_name: "Accounts A1 correction (system)",
      actor_role: "system",
      action: "accounts.correction",
      event_type: "reverse",
      table_name: "journal_entries",
      entity_table: "journal_entries",
      entity_id: null,
      new_value: { reversed: out.reversed, reposted: out.reposted, memo: MEMO }
    }
  });
  out.after = await tbLines();
  const tb = await trialBalance(prisma);
  out.trial_balance = {
    entries: tb.entry_count,
    total_debit: taka(tb.total_debit),
    total_credit: taka(tb.total_credit),
    difference: taka(tb.difference),
    balanced: tb.balanced
  };
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
