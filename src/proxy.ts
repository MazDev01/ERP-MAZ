import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasBackend } from "@/lib/supabase/env";

/*
 * ต่ออายุ session ให้ทุกคำขอ (Next.js 16 เรียกไฟล์นี้ว่า proxy เดิมชื่อ middleware)
 *
 * token ของ Supabase มีอายุสั้นและต้องต่ออายุด้วยการเขียน cookie ใหม่
 * Server Component เขียน cookie ไม่ได้ ที่นี่จึงเป็นที่เดียวที่ต่ออายุได้จริง
 * ถ้าไม่ทำ ผู้ใช้จะหลุดออกจากระบบเองเมื่อเปิดทิ้งไว้สักพัก
 *
 * ที่นี่ไม่ตัดสินสิทธิ์ว่าใครเปิดหน้าไหนได้ — คู่มือ Next บอกเองว่า proxy
 * ไม่ใช่ที่สำหรับตรวจสิทธิ์จริง และกติกาของระบบนี้คือ RLS ในฐานข้อมูล
 * เป็นคนตัดสิน ที่นี่แค่พาคนที่ยังไม่เข้าระบบไปหน้าล็อกอินให้ไวขึ้นเท่านั้น
 */

/** หน้าที่เปิดได้โดยยังไม่เข้าระบบ */
const PUBLIC = ["/login", "/set-password", "/install", "/offline", "/review"];

const isPublic = (path: string) =>
  PUBLIC.some((x) => path === x || path.startsWith(`${x}/`));

export async function proxy(request: NextRequest) {
  /* ยังไม่ได้ต่อหลังบ้าน — ระบบเดินด้วยข้อมูลในเครื่องเหมือนเดิม ไม่ต้องยุ่งอะไร */
  if (!hasBackend) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });

  /* ต้องเป็น getUser ไม่ใช่ getSession — getUser ถามเซิร์ฟเวอร์จริงว่า token ยังใช้ได้
     ส่วน getSession อ่านจาก cookie ที่ผู้ใช้แก้เองได้ เชื่อไม่ได้ */
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  /*
   * ยังไม่บังคับให้ล็อกอินผ่านฐานข้อมูล จนกว่าหน้าล็อกอินจะต่อ Supabase จริง
   * (ตั้งค่า NEXT_PUBLIC_AUTH_BACKEND=1 เมื่อถึงตอนนั้น)
   *
   * ถ้าบังคับตั้งแต่ตอนนี้ เครื่องที่ตั้งค่าฐานข้อมูลไว้แล้วจะเข้าระบบไม่ได้เลย
   * เพราะหน้าล็อกอินยังสร้าง session ของ Supabase ไม่เป็น ทุกหน้าจะเด้งกลับหน้าล็อกอินวนอยู่อย่างนั้น
   * (เจอตอนเปิด dev หลังใส่ .env.local · 2 พ.ย. 2569)
   */
  if (process.env.NEXT_PUBLIC_AUTH_BACKEND !== "1") return response;

  if (!data.user && !isPublic(path)) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    return NextResponse.redirect(to);
  }

  /* บัญชีใหม่และบัญชีที่ฝ่ายบุคคลรีเซ็ตรหัส ต้องตั้งรหัสใหม่ก่อนใช้งาน
     ค่านี้มาจาก custom_access_token_hook ในฐานข้อมูล ใช้นำทางเท่านั้น */
  const app = (data.user?.app_metadata ?? {}) as { must_change?: boolean };
  if (data.user && app.must_change && path !== "/set-password") {
    const to = request.nextUrl.clone();
    to.pathname = "/set-password";
    return NextResponse.redirect(to);
  }

  return response;
}

export const config = {
  /*
   * ข้ามไฟล์นิ่ง รูป ไฟล์ของ PWA และเส้นทาง /api
   *
   * /api ต้องข้าม เพราะ Route Handler ตรวจสิทธิ์เองอยู่แล้ว และที่สำคัญกว่านั้น
   * /api/login เป็นเส้นทางของคนที่ยังไม่ล็อกอิน ถ้า proxy ดักไว้ด้วยจะถูกเด้งไป
   * หน้าล็อกอินตั้งแต่ยังไม่ทันตรวจรหัส แล้วเข้าระบบไม่ได้เลยทั้งระบบ
   * (เจอตอนทดสอบจริง 2 พ.ย. 2569)
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)",
  ],
};
