-- ─── ฟังก์ชันภายใน ห้ามเรียกจากเบราว์เซอร์ ───────────────────────
/*
 * ไล่ตรวจทั้ง backend 18 พ.ย. 2569 แล้วพบว่ายังมีฟังก์ชัน "ของภายใน"
 * ที่เปิดให้เรียกจากเบราว์เซอร์ได้ ทั้งที่ไม่มีการตรวจว่าใครเรียก
 *
 *   void_pay_approval       — ล้างลายเซ็นอนุมัติยอดของ CEO ทิ้งได้ ใครก็เรียกได้
 *                             (ของจริงให้ reopen_period / reopen_payrun เรียกต่อเท่านั้น)
 *   register_login_failure  — นับครั้งที่รหัสผิด เรียกรัว ๆ ห้าครั้งก็ระงับบัญชีคนอื่นได้
 *   register_login_success  — ล้างตัวนับทิ้ง ทำให้ด่านกันเดารหัสไม่มีผล
 *                             (หน้าเข้าสู่ระบบเรียกสองตัวนี้ด้วยกุญแจระบบฝั่งเซิร์ฟเวอร์อยู่แล้ว)
 *   next_doc_no             — ออกเลขที่เอกสาร ใช้ภายในตอนสร้างใบเท่านั้น
 *   ทริกเกอร์ทั้งหมด         — ฐานข้อมูลเรียกเอง ไม่ต้องให้ใครเรียกตรง ๆ
 *
 * ทริกเกอร์ยังทำงานตามปกติ เพราะ PostgreSQL ตรวจสิทธิ์ตอนสร้างทริกเกอร์ ไม่ใช่ตอนยิง
 */
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'void_pay_approval', 'next_doc_no',
         'register_login_failure', 'register_login_success',
         'guard_leave_request', 'guard_ot_request',
         'lock_leave_edit', 'lock_ot_edit',
         'stamp_claim_no', 'stamp_leave_no', 'stamp_ot_no',
         'touch_settings', 'notify_push_hook'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
