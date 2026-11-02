"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasBackend } from "./env";

/*
 * ตัวต่อฐานข้อมูลฝั่งเบราว์เซอร์
 *
 * เก็บ session ไว้ใน cookie (ไม่ใช่ localStorage) เพราะฝั่งเซิร์ฟเวอร์ต้องอ่านได้ด้วย
 * ตอนวาดหน้าแรกและตอน proxy.ts ตรวจสิทธิ์ — createBrowserClient ของ @supabase/ssr
 * จัดการให้อยู่แล้ว ไม่ต้องตั้งเอง
 *
 * สร้างครั้งเดียวแล้วใช้ซ้ำ เปิดหลายตัวจะแย่งกันต่ออายุ token
 */
let cached: ReturnType<typeof createBrowserClient> | null = null;

/** ตัวต่อฐานข้อมูลของแท็บนี้ — คืน null เมื่อยังไม่ได้ตั้งค่าหลังบ้าน */
export function supabase() {
  if (!hasBackend) return null;
  cached ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}

/*
 * ล็อกอินอยู่หรือยัง — อ่านจาก cookie ของเบราว์เซอร์ ไม่ยิงถามเซิร์ฟเวอร์
 *
 * มีไว้ให้ทุกตัวอ่านข้อมูลถามก่อนยิง เพราะสโตร์บางตัวทำงานทุกหน้า
 * รวมถึงหน้าล็อกอินที่ยังไม่มี session — ยิงไปก็ได้ 401 เปล่า ๆ และคอนโซลรุงรัง
 *
 * นี่เป็นแค่การกันคำขอที่รู้อยู่แล้วว่าไม่ผ่าน ไม่ใช่การตรวจสิทธิ์
 * สิทธิ์จริงตัดสินที่ฐานข้อมูล (RLS) เสมอ
 */
export async function signedIn(): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { data } = await sb.auth.getSession();
  return Boolean(data.session);
}
