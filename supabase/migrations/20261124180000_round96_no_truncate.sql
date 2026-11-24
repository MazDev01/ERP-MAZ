/* รอบที่ 96 — ปิดสิทธิ์ล้างตารางของผู้ใช้ที่ล็อกอิน (เจอตอนทำหลังบ้านฝ่ายขาย 24 พ.ย. 2569)
   ⚠ ช่องนี้เปิดอยู่ตั้งแต่ตารางแรกของระบบ ไม่ใช่ของใหม่ในรอบที่ 95

   Supabase ตั้งค่าเริ่มต้นไว้ว่า ตารางใหม่ในสคีมา public ให้สิทธิ์ "ทุกอย่าง" กับ
   anon และ authenticated รวมถึง TRUNCATE ด้วย
   ด่าน RLS ที่เขียนกันไว้ทั้งระบบกันได้แค่ select/insert/update/delete
   **TRUNCATE ไม่ผ่านด่าน RLS เลย** ใครล็อกอินเข้ามาก็สั่งล้างทั้งตารางได้

   ลองจริงในธุรกรรมที่ย้อนกลับแล้ว: พนักงานทั่วไป (kamonchanok) สั่ง
   truncate table leave_types cascade ได้สำเร็จ และลามไปล้าง leave_requests
   กับ leave_entitlements ต่อ — ข้อมูลใบลาทั้งระบบหายได้ในคำสั่งเดียว

   รอบนี้จึงถอน TRUNCATE ออกจากทุกตาราง และถอน TRIGGER กับ REFERENCES ด้วย
   (สองอันนั้นให้ผู้ใช้แขวนทริกเกอร์ของตัวเองหรือผูกคีย์นอกไปที่ตารางคนอื่นได้ ไม่มีหน้าไหนใช้)
   ส่วน select/insert/update/delete คงไว้เหมือนเดิม ด่าน RLS เป็นคนคุมอยู่แล้ว
   service_role ไม่แตะ เพราะฝั่งเซิร์ฟเวอร์ใช้ทำงานที่ต้องข้ามด่าน */

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

/* ตารางที่จะสร้างทีหลังต้องไม่ได้สิทธิ์พวกนี้ติดมาด้วย ไม่งั้นรอบหน้าก็เปิดช่องใหม่อีก */
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
