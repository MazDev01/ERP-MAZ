"use client";

/*
 * ยื่นใบแทนคนที่ยังไม่มีบัญชีเข้าระบบ (หน้า /hr/file-for)
 *
 * คนที่ยังไม่มีบัญชี — เด็กฝึกงาน ช่างหน้างาน คนที่เพิ่งเข้าใหม่ — ส่งใบลา/ใบโอทีเป็นกระดาษ
 * ถ้าไม่มีทางกรอกเข้าระบบ ใบพวกนี้จะไม่เข้าสายอนุมัติและไม่ถูกคิดในเงินเดือน
 *
 * กติกาคุมอยู่ที่ฐานข้อมูล (can_file_for) — กรอกแทนได้เฉพาะคนที่ยังไม่มีบัญชีเท่านั้น
 * หน้าจอนี้แค่ไม่แสดงชื่อคนที่มีบัญชีให้เลือก ของจริงฐานข้อมูลปฏิเสธเองอีกชั้น
 */

import { signedIn, supabase } from "./client";
import { loadPeople, myId, nameById, peopleNow, type Person } from "./people";

/*
 * หน้าเพิ่งเปิด session ของเบราว์เซอร์ยังกู้คืนไม่เสร็จ — ถามฐานข้อมูลตอนนั้นได้คำตอบว่าง
 * ถ้าเชื่อคำตอบว่างนั้น หน้าจะว่างค้างไปตลอดจนกว่าจะโหลดใหม่ (เจอจริงมาแล้วในหน้าฝ่ายบุคคล)
 */
async function afterSignIn(): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if (await signedIn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** พนักงานที่ยังไม่มีบัญชีเข้าระบบ — เรียงตามรหัสพนักงานเหมือนทะเบียน */
export async function fetchNoAccount(): Promise<Person[]> {
  const sb = supabase();
  if (!sb) return [];
  if (!(await afterSignIn())) return [];
  await loadPeople();
  const { data, error } = await sb.from("user_accounts").select("employee_id");
  /* อ่านทะเบียนบัญชีไม่ได้ = ไม่รู้ว่าใครมีบัญชี ต้องไม่เดาว่า "ไม่มีใครมี"
     ไม่งั้นจะเสนอให้ยื่นแทนคนที่ล็อกอินเองได้ */
  if (error) return [];
  const has = new Set(((data ?? []) as { employee_id: string | null }[]).map((r) => r.employee_id));
  return peopleNow().filter((p) => !has.has(p.id));
}

export type FiledDoc = {
  kind: "leave" | "ot";
  no: string;
  who: string;
  what: string;
  status: string;
  at: string;
};

const STATUS: Record<string, string> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก",
};

/** ใบที่ "ฉัน" กรอกแทนคนอื่นไว้ — กรอกเสร็จแล้วต้องตามผลได้ ไม่ใช่หายไปในคิวของผู้อนุมัติ */
export async function fetchFiledByMe(): Promise<FiledDoc[]> {
  const sb = supabase();
  if (!sb) return [];
  if (!(await afterSignIn())) return [];
  await loadPeople();
  const me = myId();
  if (!me) return [];

  const [lv, ot] = await Promise.all([
    sb
      .from("leave_requests")
      .select("no, employee_id, leave_type, from_date, to_date, days, status, submitted_at")
      .eq("filed_by", me)
      .neq("employee_id", me)
      .order("submitted_at", { ascending: false }),
    sb
      .from("ot_requests")
      .select("no, employee_id, work_date, hours, status, submitted_at")
      .eq("filed_by", me)
      .neq("employee_id", me)
      .order("submitted_at", { ascending: false }),
  ]);

  type LvRow = {
    no: string; employee_id: string; leave_type: string;
    from_date: string; to_date: string; days: number; status: string; submitted_at: string;
  };
  type OtRow = {
    no: string; employee_id: string; work_date: string;
    hours: number; status: string; submitted_at: string;
  };

  const rows: FiledDoc[] = [
    ...(((lv.data ?? []) as unknown as LvRow[]).map((r) => ({
      kind: "leave" as const,
      no: r.no,
      who: nameById(r.employee_id),
      what: `${r.leave_type} ${r.from_date === r.to_date ? r.from_date : `${r.from_date} – ${r.to_date}`} · ${r.days} วัน`,
      status: STATUS[r.status] ?? r.status,
      at: r.submitted_at,
    }))),
    ...(((ot.data ?? []) as unknown as OtRow[]).map((r) => ({
      kind: "ot" as const,
      no: r.no,
      who: nameById(r.employee_id),
      what: `${r.work_date} · ${r.hours} ชั่วโมง`,
      status: STATUS[r.status] ?? r.status,
      at: r.submitted_at,
    }))),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
