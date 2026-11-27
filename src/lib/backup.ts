/*
 * สำรองค่าที่เก็บอยู่ในเครื่องนี้ และนำกลับเข้ามา (ผู้ใช้สั่ง 7 ต.ค. 2569)
 *
 * ⚠️ ไฟล์นี้ไม่ใช่การสำรองงานของบริษัท (แก้รอบที่ 159)
 * ข้อมูลจริงอยู่ในฐานข้อมูลบนคลาวด์แล้ว — สำรองของจริงที่ /api/backup
 * ที่นี่เหลือแค่ของที่อยู่ในเครื่องจริง ๆ เช่นร่างที่ยังไม่ได้ส่ง และค่าที่จำไว้ให้สะดวก
 *
 * เก็บเฉพาะคีย์ของระบบนี้ (maz-erp.* และ maz-hrm.*) ไม่แตะคีย์ของเว็บอื่นในเครื่อง
 * ไฟล์แนบที่อัปโหลดไว้ (เก็บใน IndexedDB) ไม่รวมมาด้วย — ไฟล์สำรองจะใหญ่เกินไป
 */

/** คีย์ที่ถือว่าเป็นข้อมูลของระบบนี้ */
const PREFIX = ["maz-erp.", "maz-hrm."];

/*
 * คีย์ที่ฐานข้อมูลเป็นเจ้าของ — ไม่สำรองและไม่เขียนทับ (รอบที่ 159)
 *
 * ค่าในเครื่องของคีย์พวกนี้เป็นแค่สำเนาไว้เปิดแอปครั้งถัดไปให้ไว
 * ถ้าเอาไฟล์เก่ามาทับ ค่าเก่าจะถูกดันขึ้นฐานข้อมูล (ดู user-prefs.ts) ทับของจริงที่ใหม่กว่า
 * หรือถูกฐานข้อมูลทับกลับทันทีจนผู้ใช้เข้าใจว่า "กู้คืนแล้วไม่เห็นเปลี่ยน"
 */
const CLOUD_KEYS = [
  "maz-erp.system-settings.v3",  /* ตั้งค่าระบบ รวมเมนูที่ปิดไว้ (รอบที่ 156) */
  "maz-erp.dashboard-cards.v1",
  "maz-erp.botnav.v1",
  "maz-erp.pipeline-cols.v1",
  "maz-erp.pm-project-new.v1",
  "maz-erp.menu-access.v1",      /* คีย์เก่าก่อนย้ายเข้าตั้งค่าระบบ */
];

function fromCloud(key: string) {
  return CLOUD_KEYS.includes(key);
}

/** รุ่นของรูปแบบไฟล์สำรอง — ขึ้นรุ่นเมื่อโครงไฟล์เปลี่ยนจนของเก่าอ่านไม่ได้ */
const FORMAT = 1;

export type Backup = {
  format: number;
  app: "ERP MAZ";
  /** เวลาที่สำรอง (ISO) — ใช้บอกผู้ใช้ว่าไฟล์นี้เก่าแค่ไหน */
  at: string;
  data: Record<string, string>;
};

/** ผลของการนำไฟล์สำรองกลับเข้ามา — skipped = คีย์ที่ข้ามเพราะฐานข้อมูลเป็นเจ้าของ */
export type RestoreResult = { restored: number; skipped: number };

function ours(key: string) {
  return PREFIX.some((p) => key.startsWith(p));
}

/** อ่านข้อมูลทั้งหมดของระบบนี้จากเครื่อง */
export function collectBackup(): Backup {
  const data: Record<string, string> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      /* ค่าที่ฐานข้อมูลเป็นเจ้าของไม่ต้องสำรอง — ของจริงอยู่บนคลาวด์ */
      if (!k || !ours(k) || fromCloud(k)) continue;
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
    /* ไฟล์เก่าที่สำรองไว้ก่อนรอบที่ 159 มีคีย์ของคลาวด์ปนมา — คัดออกตั้งแต่ตอนอ่านไฟล์ */
    if (ours(k) && !fromCloud(k) && typeof v === "string") data[k] = v;
  }
  if (!Object.keys(data).length) return { ok: false, why: "ไฟล์สำรองนี้ไม่มีข้อมูลของระบบนี้" };
  return { ok: true, backup: { format: b.format, app: "ERP MAZ", at: String(b.at ?? ""), data } };
}

/**
 * เขียนข้อมูลจากไฟล์สำรองทับของเดิม — คืนจำนวนรายการที่นำกลับเข้ามา
 * ลบคีย์ของระบบที่มีอยู่ก่อนทั้งหมด เพื่อให้ผลลัพธ์เท่ากับตอนที่สำรองไว้เป๊ะ ๆ
 * ไม่งั้นของที่สร้างหลังสำรองจะค้างปนอยู่ จนตัวเลขไม่ตรงกับไฟล์
 */
export function applyBackup(backup: Backup): RestoreResult {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    /* ไม่ล้างคีย์ของคลาวด์ — ล้างแล้วแอปจะไปดึงมาใหม่อยู่ดี และระหว่างนั้นหน้าจอว่างเปล่า */
    if (k && ours(k) && !fromCloud(k)) keys.push(k);
  }
  for (const k of keys) window.localStorage.removeItem(k);
  let restored = 0;
  let skipped = 0;
  for (const [k, v] of Object.entries(backup.data)) {
    if (fromCloud(k)) {
      skipped += 1;
      continue;
    }
    window.localStorage.setItem(k, v);
    restored += 1;
  }
  return { restored, skipped };
}

/** วันเวลาที่สำรองไว้ อ่านเป็นภาษาคน */
export function backupWhen(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "ไม่ทราบวันที่";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear() + 543} ${p(d.getHours())}:${p(d.getMinutes())} น.`;
}
