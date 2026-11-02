"use client";

import { supabase } from "./client";
import { loadPeople, roleById } from "./people";
import type { PunchRecord, PunchType } from "../attendance";
import type { PunchGeo } from "../work-area";
import { ROLES, type Role } from "../role";

/*
 * การตอกบัตรจากฐานข้อมูล — แปลงไปเป็นรูปเดียวกับที่หน้าจอใช้อยู่เดิม (PunchRecord)
 *
 * ทำแบบนี้เพื่อให้ทุกหน้าที่อ่านการตอกบัตร (หน้าแรก ตารางเวลา แจ้งเตือน โอที
 * และสะพานฝ่ายบุคคล) ไม่ต้องแก้อะไรเลย เปลี่ยนแค่ "ที่มาของข้อมูล" ชั้นเดียว
 *
 * กติกาสำคัญ: เวลาที่ตอกมาจากนาฬิกาของฐานข้อมูล ไม่ใช่ของเครื่องผู้ใช้
 * (clock_punch ใช้ clock_timestamp()) เครื่องที่ตั้งเวลาเพี้ยนจึงโกงไม่ได้
 */

/** แถวในตาราง punches เท่าที่หน้าจอต้องใช้ */
type Row = {
  id: string;
  type: PunchType;
  at: string;
  note: string | null;
  lat: number | null;
  lng: number | null;
  acc: number | null;
  geo_status: PunchGeo["status"] | null;
  area_name: string | null;
  dist_m: number | null;
};

const COLS = "id, type, at, note, lat, lng, acc, geo_status, area_name, dist_m";

/** แถวฐานข้อมูล → PunchRecord ที่หน้าจอใช้ */
export function toRecord(row: Row): PunchRecord {
  const geo: PunchGeo | undefined = row.geo_status
    ? {
        status: row.geo_status,
        ...(row.lat !== null ? { lat: row.lat } : {}),
        ...(row.lng !== null ? { lng: row.lng } : {}),
        ...(row.acc !== null ? { acc: row.acc } : {}),
        ...(row.area_name ? { area: row.area_name } : {}),
        ...(row.dist_m !== null ? { dist: row.dist_m } : {}),
      }
    : undefined;
  return {
    id: row.id,
    type: row.type,
    at: new Date(row.at).toISOString(),
    note: row.note ?? "",
    ...(geo ? { geo } : {}),
  };
}

/**
 * การตอกบัตรของคนที่ล็อกอินอยู่ — RLS คัดให้แล้วว่าเห็นได้แค่ของตัวเอง
 * จึงไม่ต้องใส่เงื่อนไข employee_id ที่นี่ (ใส่ไปก็ไม่ผิด แต่ซ้ำซ้อน)
 */
export async function fetchMyPunches(): Promise<PunchRecord[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("punches")
    .select(COLS)
    .order("at", { ascending: true })
    .limit(2000);
  if (error || !data) return [];
  return (data as unknown as Row[]).map(toRecord);
}

/**
 * การตอกบัตรของทุกคนที่มีสิทธิ์เห็น — ฝ่ายบุคคลเห็นทุกคน คนอื่นเห็นแต่ของตัวเอง
 * (RLS punches_read คัดให้) แล้วหั่นเข้ารูป Record<Role, …> ที่สะพานฝ่ายบุคคลใช้อยู่
 *
 * ใครยังไม่ผูกบทบาท (พนักงานที่ไม่มีบัญชีเข้าระบบ) ก็ตกไป — เวลาทำงานของคนกลุ่มนั้น
 * ยังมาจากทะเบียนของฝ่ายบุคคลเหมือนเดิม
 */
export async function fetchAllPunches(): Promise<Record<Role, PunchRecord[]>> {
  const out = Object.fromEntries(
    ROLES.map((r) => [r.key, [] as PunchRecord[]]),
  ) as Record<Role, PunchRecord[]>;

  const sb = supabase();
  if (!sb) return out;
  await loadPeople();

  const { data, error } = await sb
    .from("punches")
    .select(COLS + ", employee_id")
    .order("at", { ascending: true })
    .limit(5000);
  if (error || !data) return out;

  for (const row of data as unknown as (Row & { employee_id: string })[]) {
    const role = roleById(row.employee_id);
    if (role && out[role]) out[role].push(toRecord(row));
  }
  return out;
}

export type PunchResult =
  | { ok: true; record: PunchRecord }
  | { ok: false; reason: string; dist?: number; area?: string; radius?: number };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ — ใช้คำเดียวกับที่หน้าจอใช้อยู่ */
export const PUNCH_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_account: "บัญชีนี้ยังไม่ผูกกับพนักงาน — แจ้งฝ่ายบุคคล",
  bad_type: "คำสั่งไม่ถูกต้อง",
  already_in: "เข้างานไว้แล้ววันนี้",
  not_in: "ยังไม่ได้เข้างานวันนี้ จึงออกงานไม่ได้",
  nogps: "ไม่ได้พิกัด — เปิด GPS แล้วลองใหม่",
  no_area: "ยังไม่ได้ตั้งพื้นที่ทำงาน — แจ้งฝ่ายบุคคล",
  outside: "อยู่นอกพื้นที่ทำงาน",
  weak: "สัญญาณ GPS ไม่แม่น ลองใหม่อีกครั้ง",
  closed: "รอบเวลานี้ปิดแล้ว",
};

/**
 * ตอกบัตรจริงที่ฐานข้อมูล — ฐานข้อมูลตรวจพื้นที่และลำดับเข้า/ออกซ้ำอีกชั้น
 * หน้าจอตรวจมาแล้วก็จริง แต่ของที่ส่งมาจากเบราว์เซอร์เชื่อไม่ได้ ชั้นนี้จึงต้องมี
 */
export async function sendPunch(
  type: PunchType,
  geo: PunchGeo | undefined,
  note: string,
): Promise<PunchResult> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };

  const { data, error } = await sb.rpc("clock_punch", {
    p_type: type,
    p_lat: geo?.lat ?? null,
    p_lng: geo?.lng ?? null,
    p_acc: geo?.acc ?? null,
    p_note: note ?? "",
  });
  if (error) return { ok: false, reason: error.message };

  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    punch?: Row;
    dist?: number;
    area?: string;
    radius?: number;
  };
  if (!res.ok || !res.punch) {
    return {
      ok: false,
      reason: res.reason ?? "unknown",
      ...(res.dist !== undefined ? { dist: res.dist } : {}),
      ...(res.area !== undefined ? { area: res.area } : {}),
      ...(res.radius !== undefined ? { radius: res.radius } : {}),
    };
  }
  return { ok: true, record: toRecord(res.punch) };
}
