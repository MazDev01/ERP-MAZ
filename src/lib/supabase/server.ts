import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasBackend } from "./env";

/*
 * ตัวต่อฐานข้อมูลฝั่งเซิร์ฟเวอร์ — ใช้ใน Server Component และ Route Handler
 *
 * อ่าน session จาก cookie ของคำขอนั้น สิทธิ์จึงเป็นของผู้ใช้คนนั้นจริง ๆ
 * และ RLS ในฐานข้อมูลเป็นคนตัดสินว่าเห็นอะไรได้บ้าง ไม่ใช่โค้ดฝั่งนี้
 *
 * setAll ใน Server Component จะโยน error เพราะแก้ cookie ตอนวาดหน้าไม่ได้
 * ปล่อยผ่านได้ เพราะ proxy.ts ต่ออายุ session ให้ทุกคำขออยู่แล้ว
 */
export async function serverSupabase() {
  if (!hasBackend) return null;
  const jar = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, c.options);
        } catch {
          /* Server Component แก้ cookie ไม่ได้ — proxy.ts ต่ออายุให้แล้ว */
        }
      },
    },
  });
}

/*
 * ตัวต่อแบบไม่ผ่าน RLS — ใช้เฉพาะงานที่ต้องทำแทนระบบ เช่น
 * นับรหัสผ่านผิด สร้างบัญชีให้พนักงานใหม่ รีเซ็ตรหัสผ่าน
 *
 * กุญแจนี้ข้าม RLS ได้ทั้งหมด ห้ามหลุดไปฝั่งเบราว์เซอร์เด็ดขาด
 * ไฟล์นี้ import "server-only" ไว้ เผลอ import จากคอมโพเนนต์ฝั่ง client แล้ว build จะพัง
 */
export function adminSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!hasBackend || !key) return null;
  return createServerClient(SUPABASE_URL, key, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
