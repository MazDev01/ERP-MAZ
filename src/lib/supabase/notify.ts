"use client";

import { signedIn, supabase } from "./client";
import { loadPeople, myId } from "./people";

/*
 * การแจ้งเตือน — เก็บแค่สองอย่างในฐานข้อมูล
 *   อ่านแล้วหรือยัง (notification_reads) และตั้งค่าว่าจะเตือนเรื่องไหนอย่างไร (notify_settings)
 *
 * เนื้อหาการแจ้งเตือนไม่ได้เก็บ เพราะคำนวณสดจากสถานะจริงทุกครั้ง (ใบที่รออนุมัติ
 * ใบที่ถูกตีกลับ ฯลฯ) เรื่องที่จบแล้วรายการจึงหายเอง ไม่ต้องไล่ลบ
 *
 * ของเดิมเก็บในเครื่อง เปิดอีกเครื่องแล้วกระดิ่งแดงอีกรอบทั้งที่อ่านไปแล้ว
 * และตั้งค่าเตือนที่มือถือแล้วคอมไม่รู้เรื่อง
 *
 * บัญชีที่ไม่ใช่พนักงาน (ผู้บริหาร) ไม่มีแถวให้ผูก จึงยังเก็บในเครื่องเหมือนเดิม
 */

/** ตอนนี้เก็บลงฐานข้อมูลได้ไหม — ต้องล็อกอินและเป็นพนักงานในทะเบียน */
async function mine(): Promise<string | null> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return null;
  await loadPeople();
  return myId();
}

/** รายการที่อ่านแล้วของคนนี้ */
export async function fetchReadKeys(): Promise<string[] | null> {
  const sb = supabase();
  const id = await mine();
  if (!sb || !id) return null;

  const { data, error } = await sb
    .from("notification_reads")
    .select("key")
    .eq("employee_id", id)
    .limit(2000);
  if (error || !data) return null;
  return (data as { key: string }[]).map((r) => r.key);
}

/** ทำเครื่องหมายว่าอ่านแล้ว — กดซ้ำก็ไม่เป็นไร (คีย์ซ้ำทับของเดิม) */
export async function markReadRemote(keys: string[]): Promise<boolean> {
  const sb = supabase();
  const id = await mine();
  if (!sb || !id || !keys.length) return false;

  const { error } = await sb
    .from("notification_reads")
    .upsert(
      keys.map((key) => ({ employee_id: id, key, read_at: new Date().toISOString() })),
      { onConflict: "employee_id,key" },
    );
  return !error;
}

/** ตั้งค่าการแจ้งเตือนของคนนี้ — null คือยังไม่เคยบันทึก (ใช้ค่าตั้งต้น) */
export async function fetchNotifySettings(): Promise<Record<string, unknown> | null> {
  const sb = supabase();
  const id = await mine();
  if (!sb || !id) return null;

  const { data, error } = await sb
    .from("notify_settings")
    .select("data")
    .eq("employee_id", id)
    .maybeSingle();
  if (error || !data) return null;

  const blob = (data as { data?: unknown }).data;
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return null;
  const out = blob as Record<string, unknown>;
  return Object.keys(out).length ? out : null;
}

export async function saveNotifySettingsRemote(next: unknown): Promise<boolean> {
  const sb = supabase();
  const id = await mine();
  if (!sb || !id) return false;

  const { error } = await sb
    .from("notify_settings")
    .upsert({ employee_id: id, data: next, updated_at: new Date().toISOString() });
  return !error;
}
