-- ─── ลบ RPC รุ่นเก่าที่ยังค้างอยู่ ────────────────────────────────
/*
 * close_payrun / send_payroll ถูกเขียนใหม่ให้รับชุดค่าคอม+วันขาดงาน
 * แล้วคิดยอดซ้ำในฐานข้อมูลเพื่อเทียบกับที่หน้าจอส่งมา (round22)
 *
 * แต่รุ่นเก่า (ไม่มี p_commission/p_absent) ยังอยู่ในฐานข้อมูล
 * PostgREST เลือกฟังก์ชันตามชุดพารามิเตอร์ที่ส่งมา ใครก็เรียกรุ่นเก่าได้โดยตรง
 * แล้วปิดรอบด้วยยอดที่เบราว์เซอร์กรอกมาเองโดยไม่ถูกตรวจซ้ำ — ต้องเอาออก
 *
 * หน้าจอเรียกรุ่นใหม่เสมอ (src/lib/supabase/payrun.ts) ลบแล้วไม่กระทบอะไร
 */
drop function if exists public.close_payrun(text, text, jsonb, jsonb);
drop function if exists public.send_payroll(text, text, integer, numeric, numeric);
