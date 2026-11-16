"use client";

import { signedIn, supabase } from "./client";
import type { SystemSettings } from "../system-settings";

/*
 * ตั้งค่าระบบจากฐานข้อมูล — เก็บเป็นก้อน jsonb ก้อนเดียวในตาราง system_settings
 *
 * ทำไมเป็นก้อนเดียว: ค่าพวกนี้ถูกอ่านพร้อมกันทั้งชุดทุกหน้า (เวลาทำงาน อัตรา วันหยุด
 * ตัวเลือกดรอปดาวน์ สายอนุมัติตามตำแหน่ง) และแก้ทีละหน้าโดยฝ่ายบุคคลคนเดียว
 * แยกเป็นตารางละช่องจะได้คำขอสิบกว่ารอบต่อการเปิดหนึ่งหน้า โดยไม่ได้อะไรกลับมา
 *
 * ใครแก้อะไรเก็บไว้ที่ setting_log — ตัวเลขอย่างอัตราประกันสังคมมีผลกับเงินของทุกคน
 * ต้องตรวจย้อนได้ว่าใครเปลี่ยนเมื่อไร จากค่าอะไรเป็นค่าอะไร
 */

export type SettingsDone = { ok: true } | { ok: false; reason: string };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ */
export const SETTINGS_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  not_hr: "แก้ตั้งค่าระบบได้เฉพาะฝ่ายบุคคล",
  empty: "ยังไม่มีค่าตั้งค่าในฐานข้อมูล",
};

/**
 * ค่าที่ตั้งไว้ในฐานข้อมูล — null คือยังไม่เคยบันทึก (ใช้ค่าตั้งต้นของระบบไปก่อน)
 * ทุกคนที่ล็อกอินอ่านได้ เพราะทุกหน้าต้องใช้เวลาทำงานและตัวเลือกดรอปดาวน์
 */
export async function fetchSettings(): Promise<Partial<SystemSettings> | null> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return null;

  const { data, error } = await sb
    .from("system_settings")
    .select("data")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return null;

  const blob = (data as { data?: unknown }).data;
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return null;
  const out = blob as Partial<SystemSettings>;
  return Object.keys(out).length ? out : null;
}

/**
 * บันทึกค่าตั้งค่าทั้งก้อน — ฝ่ายบุคคลเท่านั้น (RLS settings_write)
 * area กับ detail คือสิ่งที่ประวัติจะแสดง เช่น "อัตราและภาษี" · "ประกันสังคม 5% → 3%"
 */
export async function saveSettings(
  next: SystemSettings,
  log?: { area: string; detail: string },
): Promise<SettingsDone> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };

  const { error } = await sb
    .from("system_settings")
    .update({ data: next, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) {
    /* RLS ปฏิเสธจะไม่ส่ง error กลับมา แต่ไม่มีแถวถูกแก้ — ข้อความนี้ไว้ดักกรณีอื่น */
    return { ok: false, reason: error.message };
  }

  /*
   * ค่าก่อน-หลังถูกลงประวัติโดยทริกเกอร์ของฐานข้อมูลเองทุกครั้งที่อัปเดต (touch_settings)
   * ที่นี่เพิ่มแค่คำอธิบายของหน้าจอว่าแก้อะไร — เขียนตรงลงตารางประวัติไม่ได้ (เป็นตารางอ่านอย่างเดียว)
   * ประวัติพลาดไม่ทำให้ค่าที่บันทึกไปแล้วเป็นโมฆะ
   */
  if (log) await sb.rpc("log_setting", { p_area: log.area, p_detail: log.detail });
  return { ok: true };
}

/** แก้ค่าแล้วจริงไหม — ฝ่ายบุคคลเท่านั้นที่แก้ได้ คนอื่นจะไม่มีแถวถูกแก้ */
export async function canWriteSettings(): Promise<boolean> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return false;
  const { data } = await sb.rpc("has_role", { r: "hr" });
  return data === true;
}
