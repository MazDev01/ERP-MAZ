"use client";

import { signedIn, supabase } from "./client";

/*
 * ค่าตั้งค่าที่ฐานข้อมูลต้องใช้เอง — ประเภทการลา · สายอนุมัติ · วันหยุดบริษัท
 *
 * หน้าตั้งค่าเก็บทุกอย่างเป็นก้อนเดียวใน system_settings.data ซึ่งพอสำหรับหน้าจอ
 * แต่ฝั่งฐานข้อมูลตัดสินใจเองในหลายเรื่อง และอ่านจากตารางของมันเอง ไม่ใช่จากก้อนนั้น
 *   leave_types      ใบลาอ้างอิงรหัสประเภทลาเป็น foreign key
 *   approval_routes  file_leave / file_ot / file_claim ใช้หาว่าใบนี้ต้องขึ้นใคร
 *   holidays         สูตรเงินเดือน (workdays_in) ใช้นับวันทำงานในเดือน
 *
 * ถ้าไม่เขียนลงตารางพวกนี้ด้วย ผู้ดูแลแก้บนจอแล้วเห็นว่าเปลี่ยน แต่ระบบยังทำตามของเก่า
 * — โรคเดียวกับจุดลงเวลาที่เจอเมื่อ 16 พ.ย. 2569
 *
 * ทุกตารางนี้ RLS ให้ทุกคนอ่าน แก้ได้เฉพาะฝ่ายบุคคล
 */

export type SyncResult = { ok: true } | { ok: false; reason: string };

const NO_DB: SyncResult = { ok: false, reason: "ยังไม่ได้ต่อฐานข้อมูล" };

async function db() {
  const sb = supabase();
  return sb && (await signedIn()) ? sb : null;
}

/* ── ประเภทการลา ────────────────────────────────────────────────── */

export type LeaveTypeIn = {
  code: string;
  days: number;
  off?: boolean;
  /* กติกาวันลาตามอายุงานและก้อนสิทธิ์ร่วม (รอบที่ 126) */
  perYear?: number;
  maxDays?: number;
  fromProbat?: boolean;
  pool?: string;
};

/**
 * ประเภทการลาที่ใช้ได้ + จำนวนวันตั้งต้นของแต่ละประเภท
 *
 * ประเภทที่เอาออกจากหน้าจอจะถูก "ปิดใช้งาน" ไม่ใช่ลบ เพราะใบลาเก่าอ้างรหัสนี้อยู่
 * ลบทิ้งแล้วใบลาที่อนุมัติไปแล้วจะเสียการอ้างอิง (foreign key)
 */
export async function syncLeaveTypes(list: LeaveTypeIn[]): Promise<SyncResult> {
  const sb = await db();
  if (!sb) return NO_DB;

  const keep = list.filter((t) => t.code.trim() && !t.off);
  for (let i = 0; i < keep.length; i++) {
    const t = keep[i];
    const { error } = await sb
      .from("leave_types")
      .upsert(
        {
          code: t.code,
          label: t.code,
          default_days: Math.round(t.days),
          active: true,
          sort: i + 1,
          per_year: t.perYear ?? 0,
          max_days: t.maxDays ?? null,
          from_probat: t.fromProbat ?? false,
          pool: t.pool ?? null,
        },
        { onConflict: "code" },
      );
    if (error) return { ok: false, reason: error.message };
  }

  const codes = keep.map((t) => t.code);
  const { data: all } = await sb.from("leave_types").select("code, active");
  for (const row of (all ?? []) as { code: string; active: boolean }[]) {
    if (row.active && !codes.includes(row.code)) {
      const { error } = await sb.from("leave_types").update({ active: false }).eq("code", row.code);
      if (error) return { ok: false, reason: error.message };
    }
  }
  return { ok: true };
}

/* ── สายอนุมัติ ─────────────────────────────────────────────────── */

export type RouteRow = { kind: "leave" | "ot" | "expense"; from: string; approver: string };

/** ใบของบทบาทไหนขึ้นใคร — เขียนทับทั้งชุด เพราะเป็นตารางเล็กที่ต้องตรงกันทั้งหมด */
export async function syncRoutes(rows: RouteRow[]): Promise<SyncResult> {
  const sb = await db();
  if (!sb) return NO_DB;
  if (rows.length === 0) return { ok: true };

  const { error } = await sb.from("approval_routes").upsert(
    rows.map((r) => ({ kind: r.kind, from_role: r.from, approver_role: r.approver })),
    { onConflict: "kind,from_role" },
  );
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** ชั้นทับรายตำแหน่ง (รอบที่ 151) — ตำแหน่งไหนไม่มีแถว ใช้สายรายบทบาทแทน */
export type PosRouteRow = { kind: "leave" | "ot" | "expense"; posKey: string; approver: string };

/**
 * สายอนุมัติรายตำแหน่ง — ส่งทั้งชุด แถวที่หายไปคือที่ผู้ดูแลลบออก จึงลบในตารางด้วย
 * ฐานข้อมูลอ่านชั้นนี้ก่อนชั้นบทบาทเสมอ (route_of)
 */
export async function syncPosRoutes(rows: PosRouteRow[]): Promise<SyncResult> {
  const sb = await db();
  if (!sb) return NO_DB;

  if (rows.length) {
    const { error } = await sb.from("approval_routes_pos").upsert(
      rows.map((r) => ({ kind: r.kind, pos_key: r.posKey, approver_role: r.approver })),
      { onConflict: "kind,pos_key" },
    );
    if (error) return { ok: false, reason: error.message };
  }

  /* ลบชั้นทับที่ไม่มีแล้ว — ทำทีละประเภทเพื่อไม่ไปแตะประเภทที่ไม่ได้ส่งมา */
  for (const kind of ["leave", "ot", "expense"] as const) {
    const keep = rows.filter((r) => r.kind === kind).map((r) => r.posKey);
    let q = sb.from("approval_routes_pos").delete().eq("kind", kind);
    if (keep.length) q = q.not("pos_key", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
    const { error } = await q;
    if (error) return { ok: false, reason: error.message };
  }
  return { ok: true };
}

/* ── วันหยุดบริษัท ──────────────────────────────────────────────── */

/**
 * วันหยุดตามประกาศของบริษัท — สูตรเงินเดือนนับวันทำงานจากตารางนี้
 * ส่งมาทั้งชุด: วันที่หายไปจากชุดใหม่คือวันที่ผู้ดูแลลบออก จึงลบในตารางด้วย
 */
export async function syncHolidays(map: Record<string, string>): Promise<SyncResult> {
  const sb = await db();
  if (!sb) return NO_DB;

  const want = Object.entries(map).filter(([d, n]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && n.trim());
  if (want.length) {
    const { error } = await sb
      .from("holidays")
      .upsert(want.map(([on_date, name]) => ({ on_date, name })), { onConflict: "on_date" });
    if (error) return { ok: false, reason: error.message };
  }

  const dates = want.map(([d]) => d);
  const { data: all } = await sb.from("holidays").select("on_date");
  for (const row of (all ?? []) as { on_date: string }[]) {
    if (!dates.includes(row.on_date)) {
      const { error } = await sb.from("holidays").delete().eq("on_date", row.on_date);
      if (error) return { ok: false, reason: error.message };
    }
  }
  return { ok: true };
}

/** วันหยุดที่อยู่ในฐานข้อมูลตอนนี้ — หน้าตั้งค่าใช้ตรวจว่าตรงกับที่เห็นบนจอไหม */
export async function fetchHolidays(): Promise<Record<string, string>> {
  const sb = await db();
  if (!sb) return {};
  const { data } = await sb.from("holidays").select("on_date, name").order("on_date");
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { on_date: string; name: string }[]) out[r.on_date] = r.name;
  return out;
}
