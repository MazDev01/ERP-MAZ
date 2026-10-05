"use client";

/*
 * ไฟล์และรูปของโปรเจคใหม่ — ต้นแบบ dose-erp-maz/project-new.html
 *
 * เก็บไฟล์จริงไว้ใน IndexedDB ของเครื่อง เพราะ localStorage เก็บไฟล์ไม่ได้
 * เบราว์เซอร์ที่เปิดโหมดส่วนตัวหรือปิดที่เก็บข้อมูลจะเปิด IndexedDB ไม่ได้
 * กรณีนั้นยังเพิ่มไฟล์ได้ แต่ไฟล์อยู่แค่ในหน้านี้ หน้าจอจะบอกผู้ใช้ไว้
 *
 * TODO: ของจริงอัปโหลดขึ้นที่เก็บไฟล์ของระบบ แล้วบันทึกที่อยู่ไฟล์ลงตารางของโปรเจค
 */

const DB = "maz-project-files";
const STORE = "files";

export type ProjectFile = {
  id: string;
  name: string;
  /** ชนิดไฟล์ตามที่เบราว์เซอร์บอก — ว่าง = ไม่รู้ชนิด */
  type: string;
  size: number;
  /** เวลาที่เพิ่ม (ms) — เรียงใหม่สุดขึ้นก่อน */
  at: number;
  blob: Blob;
};

export const isImage = (f: ProjectFile) => f.type.startsWith("image/");

/** นามสกุลไฟล์สำหรับโชว์บนปกของไฟล์ที่ไม่ใช่รูป */
export function extOf(name: string) {
  const ext = name.split(".").pop() ?? "";
  return (ext && ext !== name ? ext : "ไฟล์").slice(0, 5).toUpperCase();
}

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no-idb"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb"));
  });
}

/** อ่านไฟล์ทั้งหมด ใหม่สุดขึ้นก่อน — เปิด IndexedDB ไม่ได้ก็คืนรายการว่าง */
export async function listFiles(): Promise<{ files: ProjectFile[]; ok: boolean }> {
  try {
    const db = await open();
    const files = await new Promise<ProjectFile[]>((resolve) => {
      const out: ProjectFile[] = [];
      const cursor = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          out.push(c.value as ProjectFile);
          c.continue();
        } else resolve(out.sort((a, b) => b.at - a.at));
      };
      cursor.onerror = () => resolve(out);
    });
    db.close();
    return { files, ok: true };
  } catch {
    return { files: [], ok: false };
  }
}

/** เก็บไฟล์ที่เลือกหรือถ่ายมา — คืนรายการที่เพิ่ม และบอกว่าเก็บถาวรได้ไหม */
export async function addFiles(list: FileList | File[]): Promise<{ added: ProjectFile[]; ok: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const added: ProjectFile[] = Array.from(list).map((f) => ({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    /* ถ่ายจากกล้องบางเครื่องไม่ส่งชื่อไฟล์มา ตั้งชื่อตามวันที่ให้ */
    name: f.name || `รูป-${today}.jpg`,
    type: f.type || "",
    size: f.size,
    at: Date.now(),
    blob: f,
  }));
  if (!added.length) return { added, ok: true };
  try {
    const db = await open();
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    for (const rec of added) store.put(rec);
    db.close();
    return { added, ok: true };
  } catch {
    return { added, ok: false };
  }
}

export async function removeFile(id: string) {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    db.close();
  } catch {
    // เปิด IndexedDB ไม่ได้ — ไฟล์อยู่แค่ในหน้านี้อยู่แล้ว เอาออกจากรายการก็พอ
  }
}
