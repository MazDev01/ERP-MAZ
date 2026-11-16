"use client";

import { signedIn, supabase } from "./client";

/*
 * จุดลงเวลา (work_areas) — จุดเดียวที่ระบบยอมให้กดเข้างาน
 *
 * ของเดิมหน้าตั้งค่าเก็บพิกัดไว้ใน localStorage ของเครื่องที่เปิดหน้าอยู่
 * แต่คนตัดสินว่า "อยู่ในพื้นที่ไหม" คือฟังก์ชัน clock_punch ในฐานข้อมูล
 * ซึ่งอ่านจากตาราง work_areas — สองที่นี้จึงไม่ตรงกัน
 * ผู้ดูแลย้ายหมุดแล้วพนักงานยังกดเข้างานไม่ได้ และไม่มีอะไรบอกว่าทำไม
 *
 * ตารางนี้ให้ทุกคนอ่านได้ (ต้องรู้ว่าต้องไปยืนตรงไหน) แต่แก้ได้เฉพาะฝ่ายบุคคล (RLS)
 */

export type RemoteArea = { id: string; name: string; lat: number; lng: number; radius: number; address: string };

export const AREA_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_right: "ต้องเป็นฝ่ายบุคคลจึงแก้จุดลงเวลาได้",
  no_area: "ยังไม่มีจุดลงเวลาในระบบ",
};

type Row = { id: string; name: string; lat: number; lng: number; radius_m: number; address: string | null };

/** จุดลงเวลาที่ใช้อยู่ — ไม่มีก็คืน null ให้หน้าจอใช้ค่าในเครื่องไปก่อน */
export async function fetchArea(): Promise<RemoteArea | null> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return null;
  const { data, error } = await sb
    .from("work_areas")
    .select("id, name, lat, lng, radius_m, address")
    .eq("active", true)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Row;
  return { id: r.id, name: r.name, lat: r.lat, lng: r.lng, radius: r.radius_m, address: r.address ?? "" };
}

export type AreaResult = { ok: true } | { ok: false; reason: string };

/**
 * ย้ายจุดลงเวลา — เขียนทับแถวที่ใช้อยู่ ไม่สร้างแถวใหม่
 * (ฐานข้อมูลมี unique index บน active จึงมีจุดที่ใช้อยู่ได้ทีละจุดเดียว)
 */
export async function saveAreaRemote(a: Omit<RemoteArea, "id">): Promise<AreaResult> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };

  const current = await fetchArea();
  const patch = { name: a.name, lat: a.lat, lng: a.lng, radius_m: Math.round(a.radius), address: a.address };

  const { data, error } = current
    ? await sb.from("work_areas").update(patch).eq("id", current.id).select("id")
    : await sb.from("work_areas").insert({ ...patch, active: true }).select("id");

  if (error) return { ok: false, reason: error.message };
  /* RLS ปฏิเสธเงียบ ๆ ด้วยการไม่คืนแถวกลับมา — ต้องถือว่าไม่สำเร็จ ไม่ใช่สำเร็จ */
  if (!data || data.length === 0) return { ok: false, reason: "no_right" };
  return { ok: true };
}
