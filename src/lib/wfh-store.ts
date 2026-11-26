"use client";

import { useSyncExternalStore } from "react";
import { hasBackend } from "./supabase/env";
import { fetchWfh, sbWfhCancel, sbWfhNotice, type WfhNotice } from "./supabase/wfh";
import { optionsOf } from "./options";
import { todayIso } from "./format";

/*
 * แจ้งทำงานที่บ้านช่วงฉุกเฉิน (รอบที่ 127)
 *
 * ไม่มีขั้นอนุมัติ — กดแจ้งแล้วมีผลทันที (ฝ่ายบุคคลยืนยัน 25 พ.ย. 2569)
 * โหมดไม่มีฐานข้อมูลเก็บไว้ในหน่วยความจำของแท็บ พอรีเฟรชก็หาย
 * เพราะเป็นข้อมูลที่ต้องถึงฝ่ายบุคคลจริง เก็บในเครื่องแล้วไม่มีประโยชน์
 */

const EMPTY: WfhNotice[] = [];
let cache: WfhNotice[] = EMPTY;
let loaded = false;
let loading = false;
let version = 0;
const listeners = new Set<() => void>();

function bump() {
  version += 1;
  for (const l of listeners) l();
}

function load() {
  if (!hasBackend || loaded || loading) return;
  loading = true;
  void fetchWfh()
    .then((rows) => {
      cache = rows;
      loaded = true;
    })
    .finally(() => {
      loading = false;
      bump();
    });
}

/** สั่งอ่านใหม่ — ใช้หลังกดแจ้งหรือถอน */
export function refreshWfh() {
  loaded = false;
  load();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  load();
  return () => listeners.delete(onChange);
}

const snapshot = () => {
  load();
  return cache;
};
const server = () => EMPTY;

/** รายการที่ผู้ใช้คนนี้เห็น — พนักงานได้ของตัวเอง ฝ่ายบุคคลได้ของทุกคน (ฐานข้อมูลคัดให้) */
export function useWfh() {
  void useSyncExternalStore(subscribe, () => version, () => 0);
  return useSyncExternalStore(subscribe, snapshot, server);
}

/** เหตุผลที่เลือกได้ — ผู้ดูแลระบบเพิ่มได้ที่หน้าตัวเลือกในรายการ */
export function wfhReasons(): string[] {
  const list = optionsOf("wfh");
  return list.length ? list : ["ไฟดับ", "อินเทอร์เน็ตล่ม", "น้ำท่วม", "เหตุสุดวิสัยอื่น ๆ"];
}

export type WfhResult = { ok: true } | { ok: false; message: string };

const SAY: Record<string, string> = {
  no_account: "บัญชีนี้ยังไม่ผูกกับทะเบียนพนักงาน แจ้งฝ่ายบุคคลก่อน",
  bad_date: "แจ้งได้เฉพาะวันนี้กับเมื่อวาน",
  need_reason: "เลือกเหตุผลก่อน",
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  not_found: "ไม่มีรายการของวันนั้น",
};

/** แจ้งทำงานที่บ้าน — วันนี้เป็นค่าตั้งต้น */
export async function noticeWfh(reason: string, note = "", date = todayIso()): Promise<WfhResult> {
  if (!reason.trim()) return { ok: false, message: SAY.need_reason };
  if (!hasBackend) {
    cache = [
      { empId: "me", date, reason: reason.trim(), note: note.trim() },
      ...cache.filter((x) => x.date !== date),
    ];
    bump();
    return { ok: true };
  }
  const res = await sbWfhNotice(date, reason.trim(), note.trim());
  if (res.ok) refreshWfh();
  return res.ok ? { ok: true } : { ok: false, message: SAY[res.reason] ?? "แจ้งไม่สำเร็จ ลองใหม่อีกครั้ง" };
}

/** ถอนที่แจ้งไว้ */
export async function cancelWfh(date = todayIso()): Promise<WfhResult> {
  if (!hasBackend) {
    cache = cache.filter((x) => x.date !== date);
    bump();
    return { ok: true };
  }
  const res = await sbWfhCancel(date);
  if (res.ok) refreshWfh();
  return res.ok ? { ok: true } : { ok: false, message: SAY[res.reason] ?? "ถอนไม่สำเร็จ ลองใหม่อีกครั้ง" };
}
