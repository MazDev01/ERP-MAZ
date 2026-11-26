"use client";

/*
 * ไฟล์ผลงานขึ้น Google Drive (รอบที่ 131 · Requirement รอบ 9, 11)
 *
 * ไฟล์ผลงานเป็น ZIP 1–10 GB ซึ่งที่เก็บไฟล์ของระบบรับไม่ได้ (เพดาน 10 MB ต่อไฟล์)
 * เบราว์เซอร์จึงยิงไฟล์ขึ้น Drive เองโดยตรงผ่าน "รอบอัปโหลดต่อเนื่อง" ที่เซิร์ฟเวอร์ขอมาให้
 * เซิร์ฟเวอร์ของเราไม่แตะตัวไฟล์เลย — กุญแจของ Google อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น
 *
 * ยังไม่ได้กุญแจจาก Google (เจ้าของสั่ง 27 พ.ย. 2569 ว่าเตรียมโครงไว้รอ)
 * ทุกฟังก์ชันจะตอบ no_keys หน้าจอต้องถอยไปใช้ที่เก็บไฟล์ของระบบตามเดิม
 */

export type DriveUp =
  | { ok: true; id: string; name: string; url: string; size: string }
  | { ok: false; reason: "no_keys" | "bad_keys" | "no_account" | "failed"; message: string };

const SAY: Record<string, string> = {
  no_keys: "ยังไม่ได้ตั้งกุญแจ Google Drive — เก็บไฟล์ไว้ที่ระบบตามเดิม",
  bad_keys: "กุญแจ Google Drive ใช้ไม่ได้ ให้ผู้ดูแลระบบตรวจอีกครั้ง",
  no_account: "ต้องเข้าสู่ระบบก่อน",
  failed: "อัปโหลดขึ้น Google Drive ไม่สำเร็จ",
};

type DriveFail = "no_keys" | "bad_keys" | "no_account" | "failed";

const no = (reason: DriveFail): DriveUp => ({
  ok: false,
  reason,
  message: SAY[reason] ?? SAY.failed,
});

/** ถามเซิร์ฟเวอร์ว่าพร้อมใช้ Drive แล้วหรือยัง (ยังไม่มีกุญแจ = ยังไม่พร้อม) */
export async function driveReady(): Promise<boolean> {
  try {
    const res = await fetch("/api/drive/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "__probe__", size: 0 }),
    });
    if (res.ok) return true;
    const out = (await res.json()) as { reason?: string };
    return out.reason !== "no_keys";
  } catch {
    return false;
  }
}

/**
 * อัปไฟล์ก้อนใหญ่ขึ้น Drive — คืนลิงก์ที่เปิดดูได้
 * onProgress บอกเป็นสัดส่วน 0–1 สำหรับแถบความคืบหน้า
 */
export async function uploadToDrive(file: File, onProgress?: (p: number) => void): Promise<DriveUp> {
  let session: Response;
  try {
    session = await fetch("/api/drive/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
    });
  } catch {
    return no("failed");
  }
  if (!session.ok) {
    const out = (await session.json().catch(() => ({}))) as { reason?: string };
    if (out.reason === "no_keys") return no("no_keys");
    if (out.reason === "bad_keys" || out.reason === "drive_refused") return no("bad_keys");
    if (out.reason === "no_account") return no("no_account");
    return no("failed");
  }
  const { uploadUrl } = (await session.json()) as { uploadUrl: string };

  /* ยิงไฟล์ขึ้น Drive ตรง ๆ — ใช้ XHR เพราะต้องรู้ความคืบหน้าของก้อนใหญ่ */
  const id = await new Promise<string | null>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        const out = JSON.parse(xhr.responseText) as { id?: string };
        resolve(out.id ?? null);
      } catch {
        resolve(null);
      }
    };
    xhr.onerror = () => resolve(null);
    xhr.send(file);
  });
  if (!id) return no("failed");

  /* เปิดสิทธิ์ให้เปิดดูได้ แล้วขอลิงก์ */
  const link = await fetch("/api/drive/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId: id }),
  }).catch(() => null);
  if (!link || !link.ok) return no("failed");
  const out = (await link.json()) as { id: string; name: string; url: string; size?: string };
  return { ok: true, id: out.id, name: out.name, url: out.url, size: out.size ?? "" };
}
