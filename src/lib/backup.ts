/*
 * สำรองข้อมูลและนำกลับเข้ามา (ผู้ใช้สั่ง 7 ต.ค. 2569)
 *
 * ระบบยังไม่มี backend ทุกอย่างอยู่ใน localStorage ของเครื่องเดียว
 * ล้างข้อมูลเบราว์เซอร์ เปลี่ยนเครื่อง หรือเปิดโหมดส่วนตัว = งานที่กรอกไว้หายหมด
 * หน้าข้อมูลตัวอย่างจึงมีปุ่มดาวน์โหลดไฟล์สำรอง และนำไฟล์นั้นกลับเข้ามาทีหลัง
 *
 * เก็บเฉพาะคีย์ของระบบนี้ (maz-erp.* และ maz-hrm.*) ไม่แตะคีย์ของเว็บอื่นในเครื่อง
 * ไฟล์แนบที่อัปโหลดไว้ (เก็บใน IndexedDB) ไม่รวมมาด้วย — ไฟล์สำรองจะใหญ่เกินไป
 */

/** คีย์ที่ถือว่าเป็นข้อมูลของระบบนี้ */
const PREFIX = ["maz-erp.", "maz-hrm."];

/** รุ่นของรูปแบบไฟล์สำรอง — ขึ้นรุ่นเมื่อโครงไฟล์เปลี่ยนจนของเก่าอ่านไม่ได้ */
const FORMAT = 1;

export type Backup = {
  format: number;
  app: "ERP MAZ";
  /** เวลาที่สำรอง (ISO) — ใช้บอกผู้ใช้ว่าไฟล์นี้เก่าแค่ไหน */
  at: string;
  data: Record<string, string>;
};

function ours(key: string) {
  return PREFIX.some((p) => key.startsWith(p));
}

/** อ่านข้อมูลทั้งหมดของระบบนี้จากเครื่อง */
export function collectBackup(): Backup {
  const data: Record<string, string> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !ours(k)) continue;
      const v = window.localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
  } catch {
    /* โหมดส่วนตัวอ่านไม่ได้ — คืนเท่าที่ได้ */
  }
  return { format: FORMAT, app: "ERP MAZ", at: new Date().toISOString(), data };
}

/** ชื่อไฟล์สำรอง — มีวันเวลาให้เรียงดูง่ายว่าไฟล์ไหนใหม่กว่า */
export function backupFileName(at = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `erp-maz-สำรองข้อมูล-${at.getFullYear() + 543}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}.json`;
}

/** สั่งดาวน์โหลดไฟล์สำรอง — คืนจำนวนรายการที่สำรองได้ */
export function downloadBackup(): number {
  const backup = collectBackup();
  const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* ปล่อยทีหลัง — ปล่อยทันทีบางเบราว์เซอร์จะดาวน์โหลดไม่ทัน */
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return Object.keys(backup.data).length;
}

/** ตรวจว่าไฟล์ที่เลือกมาเป็นไฟล์สำรองของระบบนี้จริง */
export function readBackup(text: string): { ok: true; backup: Backup } | { ok: false; why: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, why: "ไฟล์นี้อ่านไม่ออก — ต้องเป็นไฟล์สำรองที่ดาวน์โหลดจากระบบนี้" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, why: "ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบนี้" };
  const b = parsed as Partial<Backup>;
  if (b.app !== "ERP MAZ") return { ok: false, why: "ไฟล์นี้ไม่ใช่ไฟล์สำรองของ ERP MAZ" };
  if (typeof b.format !== "number" || b.format > FORMAT)
    return { ok: false, why: "ไฟล์สำรองนี้มาจากระบบรุ่นใหม่กว่า — อัปเดตระบบก่อนแล้วลองใหม่" };
  if (!b.data || typeof b.data !== "object") return { ok: false, why: "ไฟล์สำรองนี้ไม่มีข้อมูลข้างใน" };
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.data)) {
    if (ours(k) && typeof v === "string") data[k] = v;
  }
  if (!Object.keys(data).length) return { ok: false, why: "ไฟล์สำรองนี้ไม่มีข้อมูลของระบบนี้" };
  return { ok: true, backup: { format: b.format, app: "ERP MAZ", at: String(b.at ?? ""), data } };
}

/**
 * เขียนข้อมูลจากไฟล์สำรองทับของเดิม — คืนจำนวนรายการที่นำกลับเข้ามา
 * ลบคีย์ของระบบที่มีอยู่ก่อนทั้งหมด เพื่อให้ผลลัพธ์เท่ากับตอนที่สำรองไว้เป๊ะ ๆ
 * ไม่งั้นของที่สร้างหลังสำรองจะค้างปนอยู่ จนตัวเลขไม่ตรงกับไฟล์
 */
export function applyBackup(backup: Backup): number {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && ours(k)) keys.push(k);
  }
  for (const k of keys) window.localStorage.removeItem(k);
  for (const [k, v] of Object.entries(backup.data)) window.localStorage.setItem(k, v);
  return Object.keys(backup.data).length;
}

/** วันเวลาที่สำรองไว้ อ่านเป็นภาษาคน */
export function backupWhen(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "ไม่ทราบวันที่";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear() + 543} ${p(d.getHours())}:${p(d.getMinutes())} น.`;
}
