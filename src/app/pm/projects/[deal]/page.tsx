import { redirect } from "next/navigation";

/*
 * ลิงก์เก่ารูปแบบ /pm/projects/<เลขดีล> — ส่งต่อไปที่ /pm/projects?deal=<เลขดีล>
 * ให้รายละเอียดโปรเจคมีที่อยู่เดียว (หน้าโฟลเดอร์ = หน้าแรก · ?deal= = หน้าหลังคลิกเข้าไป)
 * Next รุ่นนี้ส่ง params มาเป็น Promise ต้อง await ก่อนใช้
 */
export default async function Page({ params }: { params: Promise<{ deal: string }> }) {
  const { deal } = await params;
  redirect(`/pm/projects?deal=${encodeURIComponent(decodeURIComponent(deal))}`);
}
