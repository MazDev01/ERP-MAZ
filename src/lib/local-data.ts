"use client";

/*
 * ล้างข้อมูลที่แอปเก็บไว้ในเครื่อง (ตรวจระบบ 5 ต.ค. 2569 · SEC-002)
 *
 * ยังไม่มีหลังบ้าน ข้อมูลทั้งระบบจึงอยู่ในเบราว์เซอร์ของเครื่องนั้น
 * ออกจากระบบแล้วไม่ล้าง คนที่มาใช้เครื่องต่อเปิดดูเงินเดือนและทะเบียนพนักงานได้หมด
 *
 * แยกเป็นสองระดับ เพราะเครื่องส่วนตัวกับเครื่องที่ใช้ร่วมกันต้องการคนละอย่าง
 *   clearSession  — ลืมว่าใครล็อกอินอยู่ (ทำทุกครั้งที่ออกจากระบบ)
 *   clearAllLocal — ล้างข้อมูลทั้งหมดในเครื่องนี้ (ผู้ใช้ติ๊กเลือกเอง เพราะข้อมูลที่กรอกไว้จะหายด้วย)
 *
 * TODO: ต่อ backend แล้วข้อมูลงานจะอยู่ที่เซิร์ฟเวอร์ เหลือแค่ล้างโทเคนกับแคชของเครื่อง
 */

/** คีย์ที่บอกว่าใครกำลังใช้ระบบอยู่ — ไม่ใช่ข้อมูลงาน */
const SESSION_KEYS = [
  "maz-erp.role.v1",
  "maz-erp.staff-emp.v1",
  "maz-erp.ps-emp.v1",
  "maz-erp.remember-user.v1",
];

/** ข้อมูลของแอปทั้งหมดใช้สองคำนำหน้านี้ */
const PREFIXES = ["maz-erp.", "maz-hrm."];

export function clearSession() {
  try {
    for (const k of SESSION_KEYS) window.localStorage.removeItem(k);
  } catch {
    // เบราว์เซอร์ไม่ให้เข้าถึงที่เก็บข้อมูล — ไม่มีอะไรให้ล้างอยู่แล้ว
  }
}

/** ล้างทุกอย่างที่แอปเก็บไว้ในเครื่องนี้ รวมไฟล์โปรเจคและหน้าที่แคชไว้ใช้ตอนออฟไลน์ */
export async function clearAllLocal() {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (PREFIXES.some((p) => k.startsWith(p))) window.localStorage.removeItem(k);
    }
  } catch {
    // ข้ามไป ล้างส่วนอื่นต่อ
  }
  /* ไฟล์และรูปของโปรเจคอยู่ใน IndexedDB (ดู project-files.ts) */
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase("maz-project-files");
  } catch {
    // เบราว์เซอร์บางตัวลบไม่ได้ตอนยังมีแท็บอื่นเปิดค้าง — ไม่ถือว่าล้มเหลวทั้งหมด
  }
  /* หน้าที่ service worker เก็บไว้ให้เปิดตอนไม่มีเน็ต ก็เป็นข้อมูลของคนเดิม */
  try {
    if (typeof caches !== "undefined") {
      for (const name of await caches.keys()) await caches.delete(name);
    }
  } catch {
    // ไม่มีแคชก็ไม่ต้องทำอะไร
  }
}
