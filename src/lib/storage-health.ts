"use client";

/*
 * บันทึกลงเครื่องไม่สำเร็จต้องบอกผู้ใช้ (ตรวจระบบ 5 ต.ค. 2569 · BUG-003)
 *
 * เดิมที่เก็บข้อมูลทุกตัวจับ error แล้วเงียบ — พื้นที่เต็มหรือเปิดโหมดส่วนตัว
 * หน้าจอยังขึ้นว่าบันทึกแล้ว แต่พอรีเฟรชข้อมูลหายหมด ผู้ใช้ไม่มีทางรู้
 * ไฟล์นี้เก็บสถานะว่า "เขียนลงเครื่องไม่ผ่าน" ไว้ที่เดียว แล้วแถบเตือนบนแอปอ่านไปแสดง
 *
 * TODO: ต่อ backend แล้วเปลี่ยนเป็นแจ้งว่าซิงก์ขึ้นเซิร์ฟเวอร์ไม่สำเร็จแทน
 */

import { useSyncExternalStore } from "react";

export type StorageTrouble = {
  /** เหตุที่เขียนไม่ผ่าน — เต็ม = พื้นที่หมด · ปิดกั้น = เบราว์เซอร์ไม่ให้เก็บ (โหมดส่วนตัว) */
  kind: "full" | "blocked";
  /** เวลาที่เจอครั้งล่าสุด (ms) — ใช้เป็นคีย์ให้แถบเตือนขึ้นใหม่เมื่อเกิดซ้ำ */
  at: number;
};

let trouble: StorageTrouble | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** ที่เก็บข้อมูลเรียกตัวนี้เมื่อเขียนลง localStorage ไม่สำเร็จ */
export function reportStorageError(error: unknown) {
  /* QuotaExceededError ของแต่ละเบราว์เซอร์ชื่อไม่เหมือนกัน เช็คทั้งชื่อและรหัส */
  const name = error instanceof Error ? error.name : "";
  const quota =
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    (error as { code?: number } | null)?.code === 22;
  trouble = { kind: quota ? "full" : "blocked", at: Date.now() };
  notify();
}

/** ผู้ใช้กดปิดแถบเตือน หรือบันทึกผ่านแล้ว */
export function clearStorageTrouble() {
  if (!trouble) return;
  trouble = null;
  notify();
}

export function subscribeStorageHealth(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useStorageTrouble() {
  return useSyncExternalStore(
    subscribeStorageHealth,
    () => trouble,
    () => null,
  );
}

/** ข้อความที่ขึ้นบนแถบเตือน — บอกสิ่งที่ผู้ใช้ทำได้ ไม่ใช่ชื่อ error */
export function troubleText(t: StorageTrouble) {
  return t.kind === "full"
    ? "บันทึกลงเครื่องไม่สำเร็จ พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม — ข้อมูลที่เพิ่งกรอกจะหายเมื่อปิดหน้า ให้ล้างข้อมูลเว็บไซต์เก่าหรือลบรูปที่อัปโหลดไว้ก่อน"
    : "บันทึกลงเครื่องไม่สำเร็จ เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูล (เช่น โหมดไม่ระบุตัวตน) — ข้อมูลที่เพิ่งกรอกจะหายเมื่อปิดหน้า";
}
