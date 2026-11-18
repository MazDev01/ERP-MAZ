-- ─── คืนสิทธิ์ที่ตัดเกินไป เหลือกั้นเฉพาะของระบบ ─────────────────
/*
 * round32 ตัดสิทธิ์เรียกฟังก์ชันทั้งสกีมาแล้วคืนให้เฉพาะตัวที่หน้าจอเรียกเอง
 * แต่ลืมไปว่านโยบายความปลอดภัยของตาราง (RLS) ก็เรียกฟังก์ชันด้วย
 * และเรียกในสิทธิ์ของผู้ใช้คนนั้น ไม่ใช่สิทธิ์เจ้าของ
 * ตัดสิทธิ์ can_file_for / route_of / can_see_doc ไป = ยื่นใบลาและโอทีไม่ได้เลย
 * (เจอทันทีตอนไล่ทดสอบซ้ำ 18 พ.ย. 2569 — ยื่นใบแล้วขึ้น permission denied)
 *
 * กติกาใหม่ให้ง่ายและไม่พลาดอีก:
 *   ผู้ล็อกอินแล้ว  = เรียกได้ทุกตัว ยกเว้นของระบบ (ฟังก์ชันตัวนั้นตรวจบทบาทซ้ำอยู่แล้ว)
 *   ยังไม่ล็อกอิน   = เรียกได้เฉพาะสองตัวของหน้าเข้าสู่ระบบ
 *   ของระบบ        = push_fire / push_done / push_retry / notify_push_hook — ไม่มีใครเรียกได้
 */
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);

    if f.proname in ('push_fire', 'push_done', 'push_retry', 'notify_push_hook') then
      continue;
    end if;

    execute format('grant execute on function %s to authenticated', f.sig);

    if f.proname in ('register_login_failure', 'register_login_success') then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;
