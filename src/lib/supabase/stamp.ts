/*
 * timestamptz ของฐานข้อมูล → "yyyy-mm-dd hh:mm" เวลาไทย
 *
 * ทุกหน้าในระบบถือว่าข้อความรูปนี้เป็นเวลาไทยแล้ว (เหมือน bkkStamp ใน format.ts)
 * แปลงที่ชั้นนี้ครั้งเดียว หน้าจอจึงไม่ต้องรู้ว่าฐานข้อมูลเก็บเป็น UTC
 */
export function stamp(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const th = new Date(new Date(v).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const p = (n: number) => `${n}`.padStart(2, "0");
  return `${th.getFullYear()}-${p(th.getMonth() + 1)}-${p(th.getDate())} ${p(th.getHours())}:${p(th.getMinutes())}`;
}
