-- ─── ปิดสิทธิ์เรียกฟังก์ชันที่ไม่ได้มีไว้ให้ผู้ใช้เรียก ───────────
/*
 * Postgres ให้สิทธิ์เรียกฟังก์ชันใหม่กับ PUBLIC โดยอัตโนมัติ
 * ฟังก์ชันของระบบจึงถูกเรียกได้จากเบราว์เซอร์ของใครก็ได้ รวมถึงคนที่ยังไม่ล็อกอิน
 *
 * ที่เจอจริงตอนไล่ยิงทดสอบ 18 พ.ย. 2569:
 *   push_fire / push_retry  — ใครก็สั่งให้ฐานข้อมูลยิง HTTP ออกไปรัว ๆ ได้
 *   push_done               — ใครก็ปิดคิวแจ้งเตือนทิ้งได้ ผู้อนุมัติจะไม่ได้รับแจ้งเตือนเลย
 *   ทั้งสามตัวเรียกได้แม้แต่ตอนยังไม่ล็อกอิน
 *
 * ที่นี่ตัดสิทธิ์ทุกฟังก์ชันในสกีมา public ออกจาก public/anon ก่อน
 * แล้วคืนให้เฉพาะตัวที่หน้าจอเรียกจริง และคืนให้ "ผู้ล็อกอินแล้ว" เท่านั้น
 * ตัวที่ฟังก์ชันอื่นเรียกต่อภายใน ไม่ต้องมีสิทธิ์ เพราะ security definer รันในสิทธิ์เจ้าของอยู่แล้ว
 */
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

/* คืนสิทธิ์เฉพาะที่หน้าจอเรียกเอง — ผู้ที่ล็อกอินแล้วเท่านั้น
   ตัวฟังก์ชันเองยังตรวจบทบาทซ้ำข้างใน (not_hr / not_ceo) เหมือนเดิม
   ไล่ตามชื่อ ไม่ต้องพิมพ์ชนิดพารามิเตอร์ให้ผิด และครอบทุกรุ่นของชื่อนั้น */
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'my_employee_id', 'my_roles', 'has_role',
         'clock_punch', 'decide_request', 'undo_decision',
         'file_claim', 'withdraw_claim',
         'close_period', 'reopen_period',
         'send_payroll', 'decide_payroll', 'close_payrun', 'reopen_payrun',
         'publish_slips', 'unpublish_slips', 'payroll_lines',
         'hr_fill_punch', 'hr_add_punch', 'hr_remove_punch', 'hr_record_leave',
         'log_setting'
       )
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;

  /*
   * หน้าเข้าสู่ระบบเรียกสองตัวนี้ตอนยังไม่มี session
   * (นับครั้งที่รหัสผิด / ล้างตัวนับเมื่อเข้าได้) ทั้งคู่ไม่คืนข้อมูลของใครออกมา
   */
  for f in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('register_login_failure', 'register_login_success')
  loop
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

/* push_fire / push_done / push_retry ไม่คืนสิทธิ์ให้ใคร — เรียกจากกุญแจระบบและ pg_cron เท่านั้น */
