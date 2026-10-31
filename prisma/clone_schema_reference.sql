-- Anchor ERP clone — reference DDL generated from prisma/schema.prisma.
-- Proven to apply cleanly (0 errors, all 64 tables) on PostgreSQL 17.5
-- via the PGlite full-load verification (see build report, Phase 2/6).
-- At cutover, `prisma migrate` with the project toolchain (Prisma 6)
-- remains the canonical path; this file is the human-reviewable twin,
-- usable directly in the Neon SQL editor if preferred.
-- branch_cash_ledger.expected_closing_cash is a GENERATED column;
-- cash_difference / difference_status are maintained by application
-- code (lib/server/ledger-sync.ts cashDifferencePatch), the
-- trigger-equivalent of the old recalculate_cash_difference().
CREATE TABLE "auth_users" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT,
  "legacy_bcrypt_hash" TEXT,
  "email_confirmed_at" TIMESTAMPTZ,
  "last_sign_in_at" TIMESTAMPTZ,
  "raw_user_meta_data" JSONB,
  "raw_app_meta_data" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_auth_users_email" ON "auth_users" ("email");

CREATE TABLE "auth_identities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_id" TEXT,
  "identity_data" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "activity_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "action" TEXT NOT NULL,
  "details" JSONB,
  "ip_address" TEXT,
  "device_info" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "admin_users" (
  "id" UUID NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "bonus_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID,
  "profile_id" UUID,
  "salary_payment_id" UUID,
  "amount" NUMERIC(15, 2) NOT NULL,
  "reason" TEXT,
  "log_date" DATE NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "address" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "geofence_radius_meters" INTEGER,
  "radius_meters" INTEGER,
  "is_active" BOOLEAN,
  "created_by" UUID,
  "code" TEXT,
  "city" TEXT,
  "phone" TEXT,
  "manager_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_branches_code" ON "branches" ("code");

CREATE TABLE "branch_audit_trail" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID,
  "branch_name" TEXT,
  "table_name" TEXT NOT NULL,
  "record_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "performed_by" UUID,
  "performed_by_name" TEXT,
  "old_value" JSONB,
  "new_value" JSONB,
  "notes" TEXT,
  "ip_address" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branch_bank_deposits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "branch_name" TEXT,
  "manager_id" UUID NOT NULL,
  "manager_name" TEXT,
  "deposit_date" DATE NOT NULL,
  "sales_from_date" DATE,
  "sales_to_date" DATE,
  "amount" NUMERIC(15, 2) NOT NULL,
  "bank_account_name" TEXT NOT NULL,
  "bank_account_number" TEXT,
  "deposit_slip_number" TEXT,
  "bank_transaction_id" TEXT,
  "deposited_by_name" TEXT,
  "slip_attachment_url" TEXT,
  "bank_statement_url" TEXT,
  "notes" TEXT,
  "daily_breakdown" JSONB,
  "khuchra_amount" NUMERIC(15, 2) DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "submitted_at" TIMESTAMPTZ,
  "reviewed_by" UUID,
  "reviewed_by_name" TEXT,
  "reviewed_at" TIMESTAMPTZ,
  "rejection_reason" TEXT,
  "is_reversed" BOOLEAN NOT NULL DEFAULT false,
  "reversal_note" TEXT,
  "reversed_by" UUID,
  "reversed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branch_bundle_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "branch_name" TEXT,
  "manager_id" UUID NOT NULL,
  "manager_name" TEXT,
  "bundle_10_count" INTEGER NOT NULL DEFAULT 0,
  "bundle_20_count" INTEGER NOT NULL DEFAULT 0,
  "bundle_50_count" INTEGER NOT NULL DEFAULT 0,
  "bundle_100_count" INTEGER NOT NULL DEFAULT 0,
  "total_amount" NUMERIC(15, 2) NOT NULL,
  "urgency" TEXT NOT NULL DEFAULT 'normal',
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "task_id" UUID,
  "processed_by" UUID,
  "processed_by_name" TEXT,
  "processed_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "admin_notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branch_cash_expenses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "branch_name" TEXT,
  "manager_id" UUID NOT NULL,
  "manager_name" TEXT,
  "expense_date" DATE NOT NULL DEFAULT now(),
  "category" TEXT NOT NULL DEFAULT 'general',
  "description" TEXT NOT NULL,
  "amount" NUMERIC(15, 2) NOT NULL,
  "paid_amount" NUMERIC(15, 2) DEFAULT 0,
  "due_amount" NUMERIC(15, 2) DEFAULT 0,
  "ledger_head_id" UUID,
  "receipt_url" TEXT,
  "recipient_account" TEXT,
  "notes" TEXT,
  "rent_month" TEXT,
  "rent_year" INTEGER,
  "billing_month" TEXT,
  "billing_year" INTEGER,
  "salary_payment_id" UUID,
  "expense_request_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branch_cash_ledger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "ledger_date" DATE NOT NULL,
  "opening_cash" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "cash_sales" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "bkash_sales" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "nagad_sales" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "rocket_sales" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "card_sales" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "bank_transfer_sales" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "other_cash_in" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "cash_expenses" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "bank_deposits_out" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "khuchra_amount" NUMERIC(15, 2) DEFAULT 0,
  "expected_closing_cash" NUMERIC(15,2) GENERATED ALWAYS AS (opening_cash + cash_sales + other_cash_in - cash_expenses - bank_deposits_out) STORED,
  "actual_cash" NUMERIC(15, 2),
  "cash_difference" NUMERIC(15, 2),
  "difference_status" TEXT,
  "difference_notes" TEXT,
  "is_closed" BOOLEAN NOT NULL DEFAULT false,
  "closed_by" UUID,
  "closed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_branch_cash_ledger_branch_id_ledger_date" ON "branch_cash_ledger" ("branch_id", "ledger_date");

CREATE TABLE "branch_financial_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "report_month" TEXT NOT NULL,
  "amount" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by" UUID,
  "created_by_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_branch_financial_reports_branch_id_report_month" ON "branch_financial_reports" ("branch_id", "report_month");

CREATE TABLE "branch_manager_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "assigned_by" UUID,
  "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_branch_manager_assignments_employee_id_branch_id" ON "branch_manager_assignments" ("employee_id", "branch_id");

CREATE TABLE "branch_performance_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID,
  "branch_name" TEXT NOT NULL,
  "report_month" DATE NOT NULL,
  "total_sales" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "total_profit" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "total_loss" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by" UUID,
  "created_by_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_branch_performance_reports_branch_id_report_month" ON "branch_performance_reports" ("branch_id", "report_month");

CREATE TABLE "branch_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "user_id" UUID,
  "amount" NUMERIC(12, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "account" TEXT NOT NULL,
  "trx_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branch_transfers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "old_branch_id" UUID,
  "old_branch_name" TEXT,
  "new_branch_id" UUID NOT NULL,
  "new_branch_name" TEXT NOT NULL,
  "join_date" DATE NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "company_expenses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purpose" TEXT NOT NULL,
  "amount" NUMERIC(15, 2) DEFAULT 0,
  "total_amount" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "paid_amount" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "due_amount" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "branch_id" UUID,
  "branch_name" TEXT,
  "is_all_branches" BOOLEAN DEFAULT false,
  "expense_kind" TEXT NOT NULL DEFAULT 'operating',
  "description" TEXT,
  "created_by" UUID,
  "created_by_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "developer_payment_methods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "method_type" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "employee_expense_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "employee_name" TEXT,
  "branch_id" UUID,
  "branch_name" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "amount" NUMERIC(15, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "is_purchased" BOOLEAN NOT NULL DEFAULT false,
  "invoice_url" TEXT,
  "payment_method" TEXT NOT NULL DEFAULT 'bkash',
  "account_holder_name" TEXT,
  "account_number" TEXT,
  "bank_name" TEXT,
  "bank_branch" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "admin_notes" TEXT,
  "trx_id" TEXT,
  "paid_amount" NUMERIC(15, 2) DEFAULT 0,
  "due_amount" NUMERIC(15, 2) DEFAULT 0,
  "paid_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "employee_positions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID,
  "profile_id" UUID,
  "position_id" UUID,
  "branch_id" UUID,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  "updated_at" TIMESTAMPTZ,
  PRIMARY KEY ("id")
);

CREATE TABLE "employee_salary_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "bank_name" TEXT NOT NULL,
  "account_name" TEXT NOT NULL,
  "account_number" TEXT NOT NULL,
  "routing_number" TEXT,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "house_rent_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "bank_name" TEXT NOT NULL,
  "account_name" TEXT NOT NULL,
  "account_number" TEXT NOT NULL,
  "routing_number" TEXT,
  "rent_amount" NUMERIC(15, 2) DEFAULT 0,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "invoice_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "created_by" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "amount" NUMERIC(15, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "ledger_heads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code_number" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "ledger_type" TEXT NOT NULL DEFAULT 'All',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "reference_creation_date" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_ledger_heads_code_number" ON "ledger_heads" ("code_number");

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "is_read" BOOLEAN,
  "action_url" TEXT,
  "type" TEXT NOT NULL DEFAULT 'general',
  "is_admin_only" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "overtime_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID,
  "profile_id" UUID,
  "salary_payment_id" UUID,
  "amount" NUMERIC(15, 2) NOT NULL,
  "reason" TEXT,
  "log_date" DATE NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "password_reset_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "otp_code" TEXT,
  "otp_expires_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "payment_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "invoice_title" TEXT NOT NULL,
  "invoice_number" TEXT NOT NULL,
  "description" TEXT,
  "amount" NUMERIC(15, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "invoice_file_url" TEXT NOT NULL,
  "payment_method" TEXT NOT NULL,
  "payment_details" JSONB DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "transaction_id" TEXT,
  "payment_screenshot_url" TEXT,
  "admin_notes" TEXT,
  "rejection_reason" TEXT,
  "account_name" TEXT,
  "mobile_number" TEXT,
  "bank_name" TEXT,
  "account_number" TEXT,
  "routing_number" TEXT,
  "branch_name" TEXT,
  "swift_code" TEXT,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "positions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_positions_name" ON "positions" ("name");

CREATE TABLE "position_transfers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "old_position_id" UUID,
  "old_position_name" TEXT,
  "new_position_id" UUID NOT NULL,
  "new_position_name" TEXT NOT NULL,
  "join_date" DATE NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "product_chalans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID,
  "branch_name" TEXT NOT NULL,
  "chalan_ref" TEXT,
  "items" JSONB NOT NULL DEFAULT '[]',
  "total_amount" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "total_cost" NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by" UUID,
  "created_by_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "profiles" (
  "id" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "email" TEXT,
  "employee_id" TEXT,
  "phone_number" TEXT,
  "country" TEXT,
  "address" TEXT,
  "whatsapp_number" TEXT,
  "branch" TEXT,
  "branch_id" UUID,
  "position" TEXT,
  "position_id" UUID,
  "role" TEXT NOT NULL DEFAULT 'employee',
  "profile_type" TEXT NOT NULL DEFAULT 'partner',
  "verification_status" TEXT NOT NULL DEFAULT 'pending',
  "rejection_reason" TEXT,
  "profile_photo_url" TEXT,
  "account" JSONB,
  "bank_info" JSONB,
  "salary" NUMERIC(15, 2),
  "security_question" TEXT,
  "security_answer" TEXT,
  "is_2fa_enabled" BOOLEAN NOT NULL DEFAULT false,
  "is_banned" BOOLEAN NOT NULL DEFAULT false,
  "is_branch_manager" BOOLEAN NOT NULL DEFAULT false,
  "last_login" TIMESTAMPTZ,
  "is_active" BOOLEAN,
  "face_enrolled" BOOLEAN,
  "face_descriptor" JSONB,
  "facial_id" TEXT,
  "photo_url" TEXT,
  "phone" TEXT,
  "nid" TEXT,
  "nid_front_url" TEXT,
  "nid_back_url" TEXT,
  "webauthn_challenge" TEXT,
  "webauthn_current_challenge" TEXT,
  "fingerprint_enrolled" BOOLEAN,
  "requires_face_reverification" BOOLEAN,
  "face_reset_at" TIMESTAMPTZ,
  "face_reset_by" UUID,
  "first_verified_at" TIMESTAMPTZ,
  "first_verified_latitude" DOUBLE PRECISION,
  "first_verified_longitude" DOUBLE PRECISION,
  "last_known_latitude" DOUBLE PRECISION,
  "last_known_longitude" DOUBLE PRECISION,
  "last_location_updated_at" TIMESTAMPTZ,
  "registration_step" TEXT,
  "kyc_status" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "registration_otps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "otp_code" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_registration_otps_email" ON "registration_otps" ("email");

CREATE TABLE "salary_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "amount" NUMERIC(15, 2) NOT NULL,
  "total_salary" NUMERIC(15, 2) DEFAULT 0,
  "base_salary_at_time" NUMERIC(15, 2),
  "overtime_amount" NUMERIC(15, 2) DEFAULT 0,
  "bonus_amount" NUMERIC(15, 2) DEFAULT 0,
  "sales_commission" NUMERIC(15, 2) DEFAULT 0,
  "tiffin_bill" NUMERIC(15, 2) DEFAULT 0,
  "ledger_head_id" UUID,
  "transaction_id" TEXT,
  "payment_proof_url" TEXT,
  "branch_id" UUID,
  "account" TEXT,
  "notes" TEXT,
  "payment_date" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "system_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("key")
);

CREATE TABLE "tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assigned_to_id" UUID,
  "assigned_to" UUID,
  "assigned_to_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "deadline" TIMESTAMPTZ,
  "note" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "task_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "assignee_id" UUID NOT NULL,
  "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "status" TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "payment_request_id" UUID,
  "reference_number" TEXT,
  "transaction_id" TEXT,
  "amount" NUMERIC(15, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "payment_method" TEXT,
  "type" TEXT,
  "status" TEXT,
  "gateway_response" JSONB,
  "completed_at" TIMESTAMPTZ DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_transactions_reference_number" ON "transactions" ("reference_number");
CREATE UNIQUE INDEX "uq_transactions_transaction_id" ON "transactions" ("transaction_id");

CREATE TABLE "user_2fa_otps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "otp_code" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "attempts" INTEGER DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_user_2fa_otps_user_id" ON "user_2fa_otps" ("user_id");

CREATE TABLE "utility_meters" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "meter_number" TEXT NOT NULL,
  "account_number" TEXT,
  "meter_type" TEXT NOT NULL,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "verification_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "phone_number" TEXT,
  "country" TEXT,
  "address" TEXT,
  "district" TEXT,
  "profile_photo_url" TEXT,
  "profile_type" TEXT NOT NULL DEFAULT 'employee',
  "nid_front_url" TEXT NOT NULL,
  "nid_back_url" TEXT NOT NULL,
  "selfie_url" TEXT,
  "bank_account" TEXT,
  "bank_account_number" TEXT,
  "bank_name" TEXT,
  "account_holder_name" TEXT,
  "branch" TEXT,
  "branch_name" TEXT,
  "routing_code" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "rejection_reason" TEXT,
  "admin_notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "attendance_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "check_in_time" TIMESTAMPTZ NOT NULL,
  "check_out_time" TIMESTAMPTZ,
  "check_in_lat" DOUBLE PRECISION NOT NULL,
  "check_in_lng" DOUBLE PRECISION NOT NULL,
  "check_out_lat" DOUBLE PRECISION,
  "check_out_lng" DOUBLE PRECISION,
  "face_match_score" DOUBLE PRECISION,
  "face_verified" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'present',
  "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
  "approved_overtime_minutes" INTEGER,
  "overtime_approval_status" TEXT DEFAULT 'auto',
  "overtime_approval_note" TEXT,
  "is_holiday_duty" BOOLEAN DEFAULT false,
  "is_manual_override" BOOLEAN NOT NULL DEFAULT false,
  "override_reason" TEXT,
  "approval_status" TEXT NOT NULL DEFAULT 'pending',
  "approved_by" UUID,
  "approved_at" TIMESTAMPTZ,
  "approval_note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "attendance_breaks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "attendance_id" UUID,
  "break_type" TEXT NOT NULL,
  "out_time" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expected_duration_minutes" INTEGER NOT NULL DEFAULT 30,
  "return_time" TIMESTAMPTZ,
  "actual_duration_minutes" INTEGER,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "approved_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_id" UUID,
  "actor_role" TEXT,
  "action" TEXT NOT NULL,
  "table_name" TEXT NOT NULL,
  "record_id" UUID NOT NULL,
  "old_value" JSONB,
  "new_value" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branch_announcements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branch_duty_hours_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "work_start_time" TIME NOT NULL DEFAULT '09:00:00'::time,
  "work_end_time" TIME NOT NULL DEFAULT '17:00:00'::time,
  "late_grace_minutes" INTEGER NOT NULL DEFAULT 15,
  "overtime_after_minutes" INTEGER NOT NULL DEFAULT 0,
  "half_day_hours" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
  "overtime_slot_minutes" INTEGER DEFAULT 15,
  "holiday_overtime_multiplier" NUMERIC(4, 2),
  "require_overtime_approval" BOOLEAN DEFAULT false,
  "changed_by" UUID,
  "change_reason" TEXT,
  "effective_from" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "effective_to" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "branch_settings" (
  "branch_id" UUID NOT NULL,
  "work_start_time" TIME NOT NULL DEFAULT '09:00:00'::time,
  "work_end_time" TIME NOT NULL DEFAULT '18:00:00'::time,
  "late_grace_minutes" INTEGER NOT NULL DEFAULT 15,
  "overtime_after_minutes" INTEGER NOT NULL DEFAULT 30,
  "half_day_hours" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
  "overtime_slot_minutes" INTEGER DEFAULT 15,
  "holiday_overtime_multiplier" NUMERIC(4, 2) DEFAULT 2.00,
  "require_overtime_approval" BOOLEAN DEFAULT false,
  "daily_snack_allowance" NUMERIC(15, 2),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("branch_id")
);

CREATE TABLE "branch_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "task_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_branch_tasks_branch_id_task_key" ON "branch_tasks" ("branch_id", "task_key");

CREATE TABLE "company_profile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL DEFAULT 'Anchor Fashion',
  "logo_url" TEXT,
  "address" TEXT NOT NULL DEFAULT 'Headquarters, Dhaka, Bangladesh',
  "default_work_start_time" TIME NOT NULL DEFAULT '09:00:00'::time,
  "default_work_end_time" TIME NOT NULL DEFAULT '18:00:00'::time,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "correction_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "record_id" UUID,
  "date" DATE NOT NULL,
  "type" TEXT NOT NULL,
  "original_time" TIMESTAMPTZ,
  "requested_time" TIMESTAMPTZ NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewer_note" TEXT,
  "reviewed_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "employee_shifts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "shift_id" UUID,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "leave_balances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "leave_type_id" UUID,
  "year" INTEGER NOT NULL,
  "allocated_days" INTEGER NOT NULL,
  "used_days" NUMERIC(5, 1) DEFAULT 0,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_leave_balances_user_id_leave_type_id_year" ON "leave_balances" ("user_id", "leave_type_id", "year");

CREATE TABLE "leave_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "type" TEXT,
  "leave_type_id" UUID,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "approved_by" UUID,
  "approved_at" TIMESTAMPTZ,
  "reviewer_note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "leave_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "default_days_per_year" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_leave_types_code" ON "leave_types" ("code");

CREATE TABLE "off_day_overtime_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "branch_id" UUID,
  "requested_date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "approved_by" UUID,
  "approved_at" TIMESTAMPTZ,
  "reviewer_note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "otp_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "is_used" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "payroll_sheets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "month_year" TEXT NOT NULL,
  "total_payable_days" NUMERIC(5, 1) NOT NULL,
  "gross_salary" NUMERIC(10, 2) NOT NULL,
  "deductions" NUMERIC(10, 2) DEFAULT 0,
  "net_payable" NUMERIC(10, 2) NOT NULL,
  "status" TEXT DEFAULT 'draft',
  "created_at" TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_payroll_sheets_user_id_month_year" ON "payroll_sheets" ("user_id", "month_year");

CREATE TABLE "public_holidays" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "holiday_date" DATE NOT NULL,
  "is_recurring" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_public_holidays_holiday_date" ON "public_holidays" ("holiday_date");

CREATE TABLE "salary_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "base_salary" NUMERIC(10, 2) NOT NULL,
  "house_rent_allowance" NUMERIC(10, 2) DEFAULT 0,
  "medical_allowance" NUMERIC(10, 2) DEFAULT 0,
  "transport_allowance" NUMERIC(10, 2) DEFAULT 0,
  "overtime_rate_per_hour" NUMERIC(15, 2),
  "holiday_overtime_multiplier" NUMERIC(4, 2),
  "created_at" TIMESTAMPTZ DEFAULT now(),
  "updated_at" TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_salary_settings_user_id" ON "salary_settings" ("user_id");

CREATE TABLE "shifts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID,
  "name" TEXT NOT NULL,
  "start_time" TIME NOT NULL,
  "end_time" TIME NOT NULL,
  "grace_period_minutes" INTEGER DEFAULT 15,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "showroom_daily_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "date" DATE NOT NULL DEFAULT now(),
  "tasks_state" JSONB NOT NULL DEFAULT '{}',
  "completed_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_showroom_daily_tasks_branch_id_date" ON "showroom_daily_tasks" ("branch_id", "date");

CREATE TABLE "showroom_task_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "date" DATE NOT NULL DEFAULT now(),
  "task_key" TEXT NOT NULL,
  "employee_id" UUID NOT NULL,
  "employee_name" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "complaint_id" TEXT,
  "branch_id" UUID NOT NULL,
  "ticket_datetime" TIMESTAMPTZ NOT NULL,
  "customer_name" TEXT NOT NULL,
  "mobile_number" TEXT NOT NULL,
  "invoice_no" TEXT,
  "product_details" TEXT,
  "complaint_type" TEXT,
  "complaint_details" TEXT,
  "employee_name" TEXT,
  "priority" TEXT DEFAULT 'Medium',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "action_taken" TEXT,
  "remarks" TEXT,
  "follow_up_date" DATE,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_tickets_complaint_id" ON "tickets" ("complaint_id");

CREATE TABLE "webauthn_credentials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "credential_id" TEXT NOT NULL,
  "public_key" BYTEA NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "device_type" TEXT NOT NULL DEFAULT 'singleDevice',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_webauthn_credentials_credential_id" ON "webauthn_credentials" ("credential_id");
