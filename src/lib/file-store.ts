"use client";

/*
 * ที่เก็บไฟล์แนบของเครื่อง (ตรวจระบบ 5 ต.ค. 2569 — ปุ่ม "เปิด" ของเทมเพลตกดไม่ได้)
 *
 * ยังไม่มีที่เก็บไฟล์ของระบบ เดิมกล่องแนบไฟล์จึงจำแค่ชื่อกับขนาด เปิดไฟล์กลับมาดูไม่ได้เลย
 * ไฟล์จริงเก็บลง IndexedDB ของเครื่อง (localStorage เก็บไฟล์ไม่ได้) แล้วอ้างถึงด้วยรหัสไฟล์
 * เบราว์เซอร์ที่ปิดที่เก็บข้อมูลหรือโหมดส่วนตัวจะเก็บไม่ได้ — ยังแนบได้แต่เปิดย้อนหลังไม่ได้
 *
 * ใช้คนละฐานกับไฟล์ของโปรเจค (project-files.ts) เพราะอันนั้นเป็นคลังไฟล์ของโปรเจคเดียว
 * ส่วนอันนี้เป็นไฟล์แนบทั่วไปที่อ้างด้วยรหัส — เทมเพลตข้อเสนอ ใบเบิก งานที่ส่ง ฯลฯ
 *
 * TODO: ต่อ backend แล้วอัปโหลดขึ้น storage จริงแล้วเก็บแค่ที่อยู่ไฟล์
 */

const DB = "maz-files";
const STORE = "files";

type Saved = { id: string; name: string; type: string; size: number; at: number; blob: Blob };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no-idb"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb"));
  });
}

/** เก็บไฟล์ไว้ในเครื่อง คืน true ถ้าเก็บได้จริง */
export async function putFile(id: string, file: File): Promise<boolean> {
  try {
    const db = await open();
    const rec: Saved = { id, name: file.name, type: file.type, size: file.size, at: Date.now(), blob: file };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** อ่านไฟล์กลับมา — ไม่มีก็คืน null (เครื่องอื่นหรือล้างข้อมูลไปแล้ว) */
export async function getFile(id: string): Promise<Saved | null> {
  try {
    const db = await open();
    const rec = await new Promise<Saved | null>((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as Saved) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return rec;
  } catch {
    return null;
  }
}

export async function removeStoredFile(id: string) {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    db.close();
  } catch {
    // เปิดที่เก็บไม่ได้ ก็ไม่มีไฟล์ค้างอยู่แล้ว
  }
}

/**
 * เปิดไฟล์ที่เก็บไว้ในแท็บใหม่ (PDF และรูปเปิดดูได้เลย ชนิดอื่นเบราว์เซอร์จะดาวน์โหลดให้)
 * คืนข้อความบอกเหตุเมื่อเปิดไม่ได้ เพื่อให้หน้าจอแจ้งผู้ใช้
 */
export async function openStoredFile(id: string): Promise<string | null> {
  const rec = await getFile(id);
  if (!rec) return "ไม่พบไฟล์ในเครื่องนี้ — ไฟล์ถูกอัปโหลดจากเครื่องอื่น หรือถูกล้างไปแล้ว";
  const url = URL.createObjectURL(rec.blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    /* เบราว์เซอร์บล็อกป๊อปอัป — ดาวน์โหลดแทนเพื่อให้ยังได้ไฟล์ */
    const a = document.createElement("a");
    a.href = url;
    a.download = rec.name;
    a.click();
  }
  /* ปล่อยที่อยู่ชั่วคราวหลังจากแท็บใหม่โหลดเสร็จ */
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return null;
}
