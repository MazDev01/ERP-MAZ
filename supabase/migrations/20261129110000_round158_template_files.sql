/*
 * รอบที่ 158 — ไฟล์เทมเพลตของทีมก่อนการขาย เก็บที่ระบบ ไม่ใช่ที่เครื่องคนอัป
 *
 * ของเดิมแถวเทมเพลตอยู่ในฐานข้อมูล (รอบที่ 109) แต่ตัวไฟล์อยู่ใน IndexedDB
 * ของเครื่องที่อัปโหลด เพื่อนร่วมทีมเปิดหน้าคลังแล้วเห็นชื่อไฟล์ ปุ่ม "เปิด" กดไม่ได้
 * คลังเป็นของทีม ไฟล์จึงต้องอยู่ที่ระบบเหมือนแถว
 *
 * ที่อยู่ไฟล์: template/<รหัสเทมเพลต>/<เวลา>-<ชื่อไฟล์> ในถัง docs เดิม
 * ใครเห็นงานขายอ่านได้ · อัปได้เฉพาะทีมก่อนการขาย ผู้จัดการทั่วไป และผู้บริหาร
 * (ชุดเดียวกับที่แก้แถวเทมเพลตได้อยู่แล้ว)
 */

alter table public.presales_templates
  add column if not exists path text;

/* ประเภทเอกสารใหม่สำหรับทะเบียนไฟล์ */
alter table public.attachments
  drop constraint if exists attachments_owner_kind_check;
alter table public.attachments
  add constraint attachments_owner_kind_check check (
    owner_kind = any (array['leave', 'expense', 'employee', 'ot', 'payroll', 'project', 'lead', 'template'])
  );

/** แก้คลังเทมเพลตได้ไหม — ชุดเดียวกับนโยบายของตาราง presales_templates */
create or replace function public.can_edit_template()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('ps') or public.has_role('gm') or public.has_role('ceo')
$$;

revoke all on function public.can_edit_template() from public;
grant execute on function public.can_edit_template() to authenticated;

/* ── ใครเห็น/แก้ไฟล์ของเอกสารประเภทนี้ ── */
create or replace function public.can_see_doc(p_kind text, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'leave' then exists (
      select 1 from public.leave_requests r
       where r.id = p_owner
         and (r.employee_id = public.my_employee_id()
              or r.approver_role = any (public.my_roles())
              or public.has_role('hr')))
    when 'ot' then exists (
      select 1 from public.ot_requests r
       where r.id = p_owner
         and (r.employee_id = public.my_employee_id()
              or r.approver_role = any (public.my_roles())
              or public.has_role('hr')))
    when 'expense' then exists (
      select 1 from public.expense_claims c
       where c.id = p_owner
         and (c.employee_id = public.my_employee_id()
              or c.approver_role = any (public.my_roles())
              or public.has_role('hr')))
    when 'employee' then p_owner = public.my_employee_id() or public.has_role('hr')
    when 'payroll' then public.has_role('hr') or public.has_role('ceo')
    when 'project' then public.can_see_project(p_owner)
    /* ไฟล์ของผู้สนใจ — ใครเห็นงานขายก็เปิดได้ */
    when 'lead' then public.can_see_sales()
                     and exists (select 1 from public.customers c where c.id = p_owner)
    /*
     * ไฟล์เทมเพลตของคลังก่อนการขาย (รอบที่ 158)
     * อ่าน = ใครเห็นงานขาย · ส่วนการเขียนคุมที่นโยบายของถังและทะเบียนไฟล์
     */
    when 'template' then public.can_see_sales()
                         and exists (select 1 from public.presales_templates t where t.id = p_owner)
    else false
  end;
$$;

/* ── ถัง docs: รับโฟลเดอร์ template เพิ่ม ── */
drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'docs'
    and (
      (split_part(name, '/', 1) = 'proposal' and (public.has_role('ceo') or public.has_role('hr')))
      or (split_part(name, '/', 1) = 'bill' and public.has_role('acc'))
      /* ไฟล์เทมเพลตอัปได้เฉพาะคนที่แก้คลังได้ */
      or (split_part(name, '/', 1) = 'template'
          and public.can_edit_template()
          and public.doc_owner_of(name) is not null
          and exists (select 1 from public.presales_templates t where t.id = public.doc_owner_of(name)))
      or (split_part(name, '/', 1) = any (array['leave', 'ot', 'expense', 'employee', 'payroll', 'project', 'lead'])
          and public.doc_owner_of(name) is not null
          and public.can_see_doc(split_part(name, '/', 1), public.doc_owner_of(name)))
    )
  );

/* ── ทะเบียนไฟล์: แถวของเทมเพลต ── */
drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments
  for insert to authenticated
  with check (
    uploaded_by = public.my_employee_id()
    and path like (owner_kind || '/' || owner_id::text || '/%')
    and path not like '%..%'
    and (
      public.has_role('hr')
      or (owner_kind = 'employee' and owner_id = public.my_employee_id())
      or (owner_kind = 'leave' and exists (
            select 1 from public.leave_requests r where r.id = owner_id and r.employee_id = public.my_employee_id()))
      or (owner_kind = 'ot' and exists (
            select 1 from public.ot_requests o where o.id = owner_id and o.employee_id = public.my_employee_id()))
      or (owner_kind = 'expense' and exists (
            select 1 from public.expense_claims c where c.id = owner_id and c.employee_id = public.my_employee_id()))
      or (owner_kind = 'project' and public.can_see_project(owner_id))
      or (owner_kind = 'lead' and public.can_edit_sales())
      /* เทมเพลต — คนที่แก้คลังได้เท่านั้น */
      or (owner_kind = 'template' and public.can_edit_template()
          and exists (select 1 from public.presales_templates t where t.id = owner_id))
    )
  );

drop policy if exists att_read on public.attachments;
create policy att_read on public.attachments
  for select to authenticated
  using (
    public.has_role('hr')
    or uploaded_by = public.my_employee_id()
    or (owner_kind = 'employee' and owner_id = public.my_employee_id())
    or (owner_kind = 'leave' and exists (select 1 from public.leave_requests r where r.id = owner_id))
    or (owner_kind = 'expense' and exists (select 1 from public.expense_claims c where c.id = owner_id))
    or (owner_kind = 'project' and public.can_see_project(owner_id))
    or (owner_kind = 'lead' and public.can_see_sales())
    or (owner_kind = 'template' and public.can_see_sales())
  );

/*
 * ถังปฏิเสธการอัปไฟล์เทมเพลตทั้งที่เงื่อนไขเป็นจริงตอนทดลองใน psql (ไล่หา 27 พ.ย. 2569)
 * เหตุคือเงื่อนไขของนโยบายไปอ่านตาราง presales_templates ตรง ๆ ในบริบทของบริการถัง
 * ซึ่งอ่านไม่ได้เหมือนตอนเรียกผ่าน PostgREST — ย้ายไปไว้ในฟังก์ชัน security definer
 * (บทเรียนเดียวกับ leave_clash_count รอบที่ 148: นโยบายต้องไม่พึ่งการอ่านที่ติดสิทธิ์)
 */
create or replace function public.template_upload_ok(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_template()
     and public.doc_owner_of(p_path) is not null
     and exists (select 1 from public.presales_templates t where t.id = public.doc_owner_of(p_path))
$$;

revoke all on function public.template_upload_ok(text) from public;
grant execute on function public.template_upload_ok(text) to authenticated;

drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'docs'
    and (
      (split_part(name, '/', 1) = 'proposal' and (public.has_role('ceo') or public.has_role('hr')))
      or (split_part(name, '/', 1) = 'bill' and public.has_role('acc'))
      or (split_part(name, '/', 1) = 'template' and public.template_upload_ok(name))
      or (split_part(name, '/', 1) = any (array['leave', 'ot', 'expense', 'employee', 'payroll', 'project', 'lead'])
          and public.doc_owner_of(name) is not null
          and public.can_see_doc(split_part(name, '/', 1), public.doc_owner_of(name)))
    )
  );

/** แถวทะเบียนไฟล์ของเทมเพลตก็ต้องไม่พึ่งการอ่านที่ติดสิทธิ์เช่นกัน */
create or replace function public.template_row_ok(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_template()
     and exists (select 1 from public.presales_templates t where t.id = p_id)
$$;

revoke all on function public.template_row_ok(uuid) from public;
grant execute on function public.template_row_ok(uuid) to authenticated;

drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments
  for insert to authenticated
  with check (
    uploaded_by = public.my_employee_id()
    and path like (owner_kind || '/' || owner_id::text || '/%')
    and path not like '%..%'
    and (
      public.has_role('hr')
      or (owner_kind = 'employee' and owner_id = public.my_employee_id())
      or (owner_kind = 'leave' and exists (
            select 1 from public.leave_requests r where r.id = owner_id and r.employee_id = public.my_employee_id()))
      or (owner_kind = 'ot' and exists (
            select 1 from public.ot_requests o where o.id = owner_id and o.employee_id = public.my_employee_id()))
      or (owner_kind = 'expense' and exists (
            select 1 from public.expense_claims c where c.id = owner_id and c.employee_id = public.my_employee_id()))
      or (owner_kind = 'project' and public.can_see_project(owner_id))
      or (owner_kind = 'lead' and public.can_edit_sales())
      or (owner_kind = 'template' and public.template_row_ok(owner_id))
    )
  );
