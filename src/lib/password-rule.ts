/*
 * กติกาความยาว/ความซับซ้อนของรหัสผ่าน — ที่เดียวทั้งระบบ
 * ใช้ทั้งหน้าตั้งรหัสผ่านใหม่ และแท็บความปลอดภัยในหน้าโปรไฟล์
 *
 * ครบ 5 ข้อตาม SRS (เจ้าของยืนยันข้อที่ 5 เมื่อ 27 พ.ย. 2569 ว่าคือ "ต้องมีอักขระพิเศษ")
 * ฝั่งเซิร์ฟเวอร์ตรวจชุดเดียวกันนี้ซ้ำอีกชั้น (api/accounts/password) — ห้ามแก้ที่เดียว
 */

export const PASSWORD_MIN = 8;

export const PASSWORD_HINT =
  "อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ";

/** อักขระพิเศษที่นับ — เครื่องหมายบนแป้นพิมพ์ทั่วไป ไม่รวมช่องว่าง */
export const PASSWORD_SYMBOLS = /[!-/:-@[-`{-~]/;

export type PasswordCheck = { key: string; label: string; pass: boolean };

export function checkPassword(value: string): PasswordCheck[] {
  return [
    { key: "len", label: `ยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`, pass: value.length >= PASSWORD_MIN },
    { key: "upper", label: "มีตัวพิมพ์ใหญ่", pass: /[A-Z]/.test(value) },
    { key: "lower", label: "มีตัวพิมพ์เล็ก", pass: /[a-z]/.test(value) },
    { key: "digit", label: "มีตัวเลข", pass: /\d/.test(value) },
    { key: "symbol", label: "มีอักขระพิเศษ เช่น ! @ # $ %", pass: PASSWORD_SYMBOLS.test(value) },
  ];
}

export function passwordOk(value: string) {
  return checkPassword(value).every((c) => c.pass);
}
