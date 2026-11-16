"use client";

/*
 * บอกเซิร์ฟเวอร์ว่าใบใบหนึ่งเพิ่งเปลี่ยนสถานะ เพื่อให้ยิงแจ้งเตือนเข้าเครื่องของคนที่เกี่ยวข้อง
 *
 * หน้าจอบอกแค่ "ใบไหน" ไม่ได้บอกว่าจะส่งอะไรให้ใคร — เซิร์ฟเวอร์อ่านใบนั้นเองแล้วตัดสิน
 * (ดู src/lib/supabase/push.ts) ไม่งั้นช่องทางนี้จะกลายเป็นที่ส่งข้อความหาใครก็ได้
 *
 * ยิงแล้วไม่รอผล และไม่ทำให้การยื่น/อนุมัติล้มเหลว — ใบเข้าระบบแล้วถือว่าสำเร็จ
 * แจ้งเตือนไม่ออกเป็นเรื่องรอง หน้าจอของอีกฝ่ายยังเห็นใบอยู่ดีตอนเปิดแอป
 */

export type DocKind = "leave" | "ot" | "expense";

export function pingDoc(kind: DocKind, id: string | null | undefined) {
  if (!id) return;
  void fetch("/api/push/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id }),
    keepalive: true,
  }).catch(() => {
    /* ส่งไม่ถึงก็ไม่เป็นไร ไม่ขัดขวางงานที่ผู้ใช้เพิ่งทำสำเร็จ */
  });
}
