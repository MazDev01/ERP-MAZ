"use client";

/*
 * ค่าตั้งส่วนตัวและร่างที่ยังไม่ยืนยัน — เก็บที่ระบบ (รอบที่ 155)
 *
 * ของเดิมอยู่ใน localStorage ของเบราว์เซอร์ที่เปิด เปลี่ยนเครื่องแล้วหายทั้งชุด
 * ร่างโปรเจคใหม่ของฝ่ายโครงการหายด้วย ซึ่งเป็นงานที่พิมพ์ไปแล้วจริง ๆ
 *
 * ตารางเก็บเป็นคู่ "คีย์ → ค่า" รายคน คีย์คือชื่อชุดข้อมูลเดิมที่ใช้ใน localStorage
 * จึงย้ายได้โดยไม่ต้องเปลี่ยนรูปข้อมูลของหน้าจอ
 */

import { signedIn, supabase } from "./client";

/** ค่าตั้งทั้งชุดของคนที่ล็อกอิน — null คือยังอ่านไม่ได้ (ยังไม่ล็อกอินหรือยิงไม่ผ่าน) */
export async function fetchPrefs(): Promise<Record<string, unknown> | null> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return null;
  const got = await sb.rpc("prefs_all");
  if (got.error) return null;
  return (got.data as Record<string, unknown> | null) ?? {};
}

/** บันทึกค่าตั้งหนึ่งชุด — คืน false เมื่อบันทึกไม่ได้ หน้าจอยังใช้ค่าในเครื่องต่อได้ */
export async function savePref(key: string, value: unknown): Promise<boolean> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return false;
  const got = await sb.rpc("pref_set", { p_key: key, p_value: value ?? null });
  return !got.error && got.data === true;
}
