import { adminSupabase, serverSupabase } from "@/lib/supabase/server";

/*
 * สำรองข้อมูลจริงจากฐานข้อมูล (รอบที่ 159)
 *
 * ของเดิมหน้า "ข้อมูลตัวอย่าง" มีแต่ปุ่มสำรอง localStorage ของเครื่องที่เปิดอยู่
 * ตั้งแต่ข้อมูลจริงย้ายขึ้นคลาวด์ ไฟล์นั้นจึงไม่ใช่การสำรองงานของบริษัทเลย
 * ถ้าเข้าใจผิดว่ามีไฟล์สำรองอยู่แล้ว วันที่ข้อมูลหายจะไม่มีอะไรให้กู้
 *
 * ทางนี้อ่านตารางงานทั้งหมดด้วยกุญแจของระบบ แล้วส่งกลับเป็นไฟล์ JSON ก้อนเดียว
 * ใครเรียกได้: ฝ่ายบุคคลและผู้บริหารเท่านั้น — ถามฐานข้อมูลด้วยสิทธิ์ของคนเรียกเอง
 * ไม่เชื่อค่าที่ส่งมาจากหน้าจอ
 *
 * ไม่รวม: รหัสผ่าน (อยู่ในระบบยืนยันตัวตนของ Supabase ไม่ได้อยู่ในตารางพวกนี้)
 * ตัวไฟล์แนบ (อยู่ในถัง — ไฟล์จะใหญ่เกินจะใส่มา เก็บแต่ที่อยู่ไฟล์ไว้ให้)
 * และค่ากุญแจของระบบ (hook_config)
 */

/** ตารางที่สำรอง — ระบุชื่อตรง ๆ ไม่กวาดทั้ง schema เพื่อไม่ให้ของใหม่หลุดมาโดยไม่ได้ตรวจ */
const TABLES = [
  /* ทะเบียนคนและบัญชีเข้าระบบ */
  "employees", "user_accounts", "salary_steps", "work_hours",
  /* เวลาทำงานและคำขอ */
  "punches", "time_edits", "time_reviews", "wfh_notices",
  "leave_requests", "leave_entitlements", "leave_types", "leave_clash_ok",
  "ot_requests", "expense_claims", "expense_fuel_rows", "expense_income_rows", "expense_other_rows",
  /* เงินเดือน */
  "pay_periods", "pay_approvals", "pay_adjusts", "pay_extras", "pay_reopens",
  "payruns", "payslips", "payslip_lines", "payslip_reads",
  /* งานขาย */
  "customers", "customer_activities", "customer_changes",
  "presales_requests", "presales_rounds", "presales_notes", "presales_templates", "proposal_templates",
  "quotations", "quotation_revisions", "deals", "deal_contracts", "deal_contract_docs", "deal_installments",
  "followup_cols", "followup_cards", "followup_moves",
  /* โครงการ */
  "projects", "project_tasks", "project_acts", "project_chat", "project_docs",
  "project_drafts", "project_inbox", "project_transfers",
  "pm_events", "pm_event_edits", "task_asks", "task_reviews", "task_talks",
  "review_rounds", "review_comments", "review_files",
  /* บัญชี */
  "invoices", "invoice_collections", "payments", "receipts", "wht_rows",
  "billing_requests", "bill_scans", "job_orders", "ad_contents", "ad_runs",
  /* ของระบบ */
  "system_settings", "approval_routes", "approval_routes_pos", "expense_kind_routes",
  "holidays", "work_areas", "doc_counters", "announcements",
  "attachments", "lead_files", "notify_settings", "user_prefs",
  "setting_log", "audit_log",
] as const;

/** กันไฟล์บวมเกินจนดาวน์โหลดไม่สำเร็จ — ตารางที่โตเกินนี้จะบอกไว้ในไฟล์ว่าตัดมาเท่าไร */
const MAX_ROWS = 20_000;

export async function GET() {
  const sb = await serverSupabase();
  if (!sb) return Response.json({ ok: false, reason: "no_backend" }, { status: 503 });

  /* ด่านเดียวที่เชื่อถือได้: ถามฐานข้อมูลด้วยสิทธิ์ของคนเรียก */
  const [hr, ceo] = await Promise.all([
    sb.rpc("has_role", { r: "hr" }),
    sb.rpc("has_role", { r: "ceo" }),
  ]);
  if (hr.data !== true && ceo.data !== true) {
    return Response.json({ ok: false, reason: "not_allowed" }, { status: 403 });
  }

  const admin = adminSupabase();
  if (!admin) return Response.json({ ok: false, reason: "no_backend" }, { status: 503 });

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const trouble: string[] = [];
  for (const name of TABLES) {
    const { data, error } = await admin.from(name).select("*").limit(MAX_ROWS);
    if (error) {
      /* ตารางที่อ่านไม่ได้ต้องบอกไว้ในไฟล์ ไม่ใช่เงียบแล้วให้คนเข้าใจว่าสำรองครบ */
      trouble.push(`${name}: ${error.message}`);
      continue;
    }
    tables[name] = data ?? [];
    counts[name] = (data ?? []).length;
  }

  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  return Response.json(
    {
      ok: true,
      app: "ERP MAZ",
      kind: "database",
      format: 1,
      at: new Date().toISOString(),
      rows,
      counts,
      trouble,
      note: "ไฟล์นี้คือข้อมูลในฐานข้อมูล ไม่รวมตัวไฟล์แนบในถังและรหัสผ่าน",
      tables,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
