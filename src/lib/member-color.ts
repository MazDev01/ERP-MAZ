/*
 * สีประจำตัวของคนในทีม (รอบที่ 129 · Requirement รอบ 11 "ปฏิทินคิวงานแยกสีรายคน")
 *
 * สีมาจากรหัสพนักงาน ไม่ใช่ลำดับในรายการ คนเดิมจึงได้สีเดิมทุกหน้าและทุกเดือน
 * แม้ทีมจะมีคนเข้าออก (ถ้าผูกกับลำดับ พอมีคนลาออกสีจะสลับกันทั้งทีม)
 *
 * ชุดสีเลี่ยงแดงของแบรนด์ (#C8102E) เพราะแดงใช้เป็นสีเน้นของระบบอยู่แล้ว
 */

export const MEMBER_COLORS = [
  "#2563EB", // น้ำเงิน
  "#059669", // เขียว
  "#D97706", // ส้ม
  "#7C3AED", // ม่วง
  "#0891B2", // ฟ้าอมเขียว
  "#DB2777", // บานเย็น
  "#65A30D", // เขียวมะนาว
  "#B45309", // น้ำตาล
  "#4F46E5", // น้ำเงินม่วง
  "#0D9488", // เขียวน้ำทะเล
] as const;

/** สีประจำตัวของคนนี้ — รหัสเดียวกันได้สีเดิมเสมอ */
export function memberColor(id: string): string {
  if (!id) return MEMBER_COLORS[0];
  let n = 0;
  for (let i = 0; i < id.length; i += 1) n = (n * 31 + id.charCodeAt(i)) % 100000;
  return MEMBER_COLORS[n % MEMBER_COLORS.length];
}

/** สีพื้นอ่อนของคนนี้ สำหรับแถบในปฏิทิน */
export function memberTint(id: string, pct = 12): string {
  return `color-mix(in srgb, ${memberColor(id)} ${pct}%, transparent)`;
}
