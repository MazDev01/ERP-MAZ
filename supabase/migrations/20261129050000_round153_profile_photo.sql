/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 153 · รูปโปรไฟล์เก็บในระบบจริง (เลิกเก็บในเครื่อง)

   ของเดิมรูปโปรไฟล์เก็บเป็น data URL ใน localStorage แยกตามบทบาท
   ย้ายเครื่องหรือล้างเบราว์เซอร์แล้วรูปหาย และคนอื่นไม่เคยเห็นรูปของเราเลย
   ทั้งที่ทั้งระบบใช้รูปคนเต็มไปหมด (แชทโปรเจค ผู้รับงาน รายชื่อทีม ใบอนุมัติ)

   ที่เก็บของจริงมีอยู่แล้วตั้งแต่รอบที่ 1 — ถัง avatars (ถังปิด เปิดด้วยลิงก์ชั่วคราว)
   กับช่อง employees.photo_path แต่ไม่เคยมีใครเขียนลงไป รอบนี้ต่อให้ครบ
     · ทุกคนในระบบอ่านรูปของเพื่อนร่วมงานได้ (เดิมอ่านได้แค่ของตัวเองกับฝ่ายบุคคล)
     · เขียนได้เฉพาะเจ้าของรูป และฝ่ายบุคคล (ตั้งรูปให้ตอนรับเข้า)
   ไฟล์ยังอยู่หลังการล็อกอินเหมือนเดิม ไม่เปิดเป็นถังสาธารณะ
   ═══════════════════════════════════════════════════════════════════ */

/* รูปคนในบริษัทใช้ทั่วทั้งระบบ — อ่านได้ทุกคนที่ล็อกอิน (เขียนยังเป็นของเจ้าของ) */
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

/* ฝ่ายบุคคลตั้งรูปให้พนักงานได้ด้วย — ตอนรับเข้าทำงานคนใหม่ยังไม่มีบัญชีใช้เอง */
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = public.my_employee_id()::text or public.has_role('hr'))
  );

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = public.my_employee_id()::text or public.has_role('hr'))
  )
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = public.my_employee_id()::text or public.has_role('hr'))
  );

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = public.my_employee_id()::text or public.has_role('hr'))
  );

/**
 * บันทึกที่อยู่รูปของตัวเอง — ส่งค่าว่างคือเอารูปออก
 * ฝ่ายบุคคลตั้งให้คนอื่นได้ผ่าน photo_set_for ด้านล่าง
 * ไม่ให้เขียนช่องนี้ตรง ๆ เพราะต้องกันไม่ให้ชี้ไปไฟล์ของคนอื่น
 */
create or replace function public.photo_set(p_path text)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me uuid := public.my_employee_id();
  v_path text := trim(coalesce(p_path, ''));
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  /* รูปของใครต้องอยู่ในโฟลเดอร์ของคนนั้น ตามกติกาของถัง */
  if v_path <> '' and split_part(v_path, '/', 1) <> v_me::text then
    return jsonb_build_object('ok', false, 'reason', 'bad_path');
  end if;
  update public.employees set photo_path = v_path where id = v_me;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.photo_set(text) to authenticated;

/** ฝ่ายบุคคลตั้งรูปให้พนักงานคนหนึ่ง — อ้างด้วยรหัสพนักงานแบบที่หน้าจอใช้ */
create or replace function public.photo_set_for(p_emp text, p_path text)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_path text := trim(coalesce(p_path, ''));
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  select id into v_id from public.employees where emp_no = p_emp;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_path <> '' and split_part(v_path, '/', 1) <> v_id::text then
    return jsonb_build_object('ok', false, 'reason', 'bad_path');
  end if;
  update public.employees set photo_path = v_path where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.photo_set_for(text, text) to authenticated;

/**
 * ที่อยู่รูปของทุกคนที่มีรูป — หน้าจอเอาไปขอลิงก์ชั่วคราวทีเดียวทั้งชุด
 * คืนเป็นรหัสพนักงาน (emp_no) เพราะทั้งระบบอ้างคนด้วยรหัสนี้
 */
create or replace function public.photo_list()
  returns table (emp_no text, path text)
language sql stable security definer set search_path = ''
as $$
  select e.emp_no, e.photo_path
    from public.employees e
   where coalesce(e.photo_path, '') <> ''
$$;

grant execute on function public.photo_list() to authenticated;

notify pgrst, 'reload schema';
