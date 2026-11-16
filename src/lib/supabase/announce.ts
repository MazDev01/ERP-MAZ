"use client";

import { signedIn, supabase } from "./client";
import type { Level } from "../notifications";
import type { Role } from "../role";

/*
 * ประกาศจากฝ่ายบุคคลถึงพนักงาน
 *
 * เรื่องที่ระบบคำนวณเองไม่ได้ — ปิดบริษัทวันศุกร์ ย้ายออฟฟิศ อบรมพรุ่งนี้เก้าโมง
 * ของเดิมมีตารางรออยู่ในฐานข้อมูลแต่ไม่มีหน้าจอ จึงไม่มีใครใช้ได้เลย
 *
 * ใครเห็นอะไรเป็นเรื่องของ RLS: ประกาศที่ยังไม่หมดอายุ และตรงกับบทบาทของคนอ่าน
 * (roles ว่าง = ถึงทุกคน) ส่วนคนโพสต์/ลบต้องเป็นฝ่ายบุคคล
 */

export type Announce = {
  id: string;
  title: string;
  detail: string;
  level: Level;
  /** บทบาทที่ได้รับ — ว่างคือทุกคน */
  roles: Role[];
  from: string;
  until: string;
};

type Row = {
  id: string;
  title: string;
  detail: string;
  level: string;
  roles: string[] | null;
  from_at: string;
  until_at: string | null;
};

/* ฐานข้อมูลเก็บระดับเป็น info/warn/late ส่วนหน้าจอใช้ info/soon/late */
const toLevel = (v: string): Level => (v === "late" ? "late" : v === "warn" ? "soon" : "info");
const fromLevel = (v: Level) => (v === "late" ? "late" : v === "soon" ? "warn" : "info");

export const ANNOUNCE_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_right: "ต้องเป็นฝ่ายบุคคลจึงประกาศได้",
  no_title: "ต้องมีหัวข้อประกาศ",
};

function toAnnounce(r: Row): Announce {
  return {
    id: r.id,
    title: r.title,
    detail: r.detail,
    level: toLevel(r.level),
    roles: (r.roles ?? []) as Role[],
    from: r.from_at,
    until: r.until_at ?? "",
  };
}

/** ประกาศที่คนนี้เห็นได้ (RLS คัดให้แล้ว) */
export async function fetchAnnounces(): Promise<Announce[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const { data, error } = await sb
    .from("announcements")
    .select("id, title, detail, level, roles, from_at, until_at")
    .order("from_at", { ascending: false })
    .limit(100);
  if (error || !data) return [];
  return (data as Row[]).map(toAnnounce);
}

/**
 * ทุกประกาศรวมของที่หมดอายุแล้ว — หน้าจัดการของฝ่ายบุคคลใช้
 * (นโยบายจัดการเป็น for all จึงครอบ select ให้ฝ่ายบุคคลเห็นทั้งหมด)
 */
export async function fetchAllAnnounces(): Promise<Announce[]> {
  return fetchAnnounces();
}

export type AnnounceResult = { ok: true } | { ok: false; reason: string };

export async function postAnnounce(input: {
  title: string;
  detail: string;
  level: Level;
  roles: Role[];
  until: string;
}): Promise<AnnounceResult> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  if (!input.title.trim()) return { ok: false, reason: "no_title" };

  const { data, error } = await sb
    .from("announcements")
    .insert({
      title: input.title.trim(),
      detail: input.detail.trim(),
      level: fromLevel(input.level),
      roles: input.roles,
      /* วันที่สิ้นสุดนับถึงสิ้นวันนั้น ไม่ใช่เที่ยงคืนตอนต้นวัน */
      until_at: input.until ? `${input.until}T23:59:59+07:00` : null,
    })
    .select("id");
  if (error) return { ok: false, reason: error.message };
  if (!data || data.length === 0) return { ok: false, reason: "no_right" };
  return { ok: true };
}

/** เอาประกาศออก — ฝ่ายบุคคลเท่านั้น (RLS) */
export async function removeAnnounce(id: string): Promise<AnnounceResult> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const { error } = await sb.from("announcements").delete().eq("id", id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}
