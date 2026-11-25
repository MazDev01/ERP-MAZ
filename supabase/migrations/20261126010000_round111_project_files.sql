/* รอบที่ 111 — ไฟล์และรูปของโปรเจคขึ้นที่เก็บไฟล์จริง

   หน้าโปรเจคใหม่ให้แนบไฟล์กับรูปได้ แต่ตัวไฟล์อยู่ใน IndexedDB ของเครื่องที่แนบ
   ตาราง project_docs เก็บแค่ชื่อกับรหัสไฟล์ในเครื่อง (file_id) ทีมบนเครื่องอื่น
   จึงเห็นชื่อไฟล์แต่เปิดดูไม่ได้ — ปัญหาเดียวกับใบรับรองแพทย์ที่แก้ไปแล้วในรอบที่ 21
   (ผู้ใช้สั่ง 25 พ.ย. 2569)

   ใช้ถัง "docs" และตาราง attachments ชุดเดิม เพิ่มชนิดเจ้าของเอกสาร 'project'
   ที่อยู่ไฟล์: project/<รหัสโปรเจค>/<เวลา>-<ชื่อไฟล์>
   project_docs เพิ่มคอลัมน์ path ชี้ไปที่ไฟล์ในถัง — แถวเก่าที่มีแต่ file_id ยังอ่านได้ */

/* ─── ชนิดเจ้าของเอกสารเพิ่ม 'project' ───────────────────────────── */
alter table public.attachments drop constraint if exists attachments_owner_kind_check;
alter table public.attachments add constraint attachments_owner_kind_check
  check (owner_kind in ('leave', 'expense', 'employee', 'ot', 'payroll', 'project'));

/* ─── ที่อยู่ไฟล์ในถัง ───────────────────────────────────────────── */
alter table public.project_docs add column if not exists path text;

/* ─── ใครเห็นไฟล์ของโปรเจคได้ ─────────────────────────────────────
   คนที่เห็นตัวโปรเจคได้ก็เปิดไฟล์ของโปรเจคได้ — ฝ่ายโครงการ หัวหน้า
   และคนที่ถูกมอบหมายงานในโปรเจคนั้น */
create or replace function public.can_see_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects p where p.id = p_project)
     and (public.has_role('pm') or public.has_role('gm') or public.has_role('ceo')
          or exists (
            select 1 from public.project_tasks t
             where t.project_id = p_project
               and public.my_employee_id()::text = any (t.whos)))
$$;

revoke all on function public.can_see_project(uuid) from public, anon;
grant execute on function public.can_see_project(uuid) to authenticated;

/* ─── can_see_doc รู้จักโปรเจคแล้ว ─────────────────────────────────
   เขียนทั้งฟังก์ชันใหม่ เพราะ sql function แก้ทีละกิ่งไม่ได้
   กิ่งอื่นคงเดิมทุกตัว (ลา โอที เบิกค่าใช้จ่าย พนักงาน เงินเดือน) */
create or replace function public.can_see_doc(p_kind text, p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
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
    else false
  end;
$$;

/* ─── ถัง docs รับที่อยู่ที่ขึ้นต้นด้วย project/ ด้วย ─────────────
   เงื่อนไขอื่นคงเดิม — อัปโหลดได้เฉพาะเข้าเอกสารที่ตัวเองมีสิทธิ์เห็น */
drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'docs'
    and split_part(name, '/', 1) in ('leave', 'ot', 'expense', 'employee', 'payroll', 'project')
    and public.doc_owner_of(name) is not null
    and public.can_see_doc(split_part(name, '/', 1), public.doc_owner_of(name))
  );

/* ลบไฟล์ของโปรเจคได้เฉพาะคนที่อัปโหลดเอง กับฝ่ายบุคคล (กติกาเดิมของถัง)
   ฝ่ายโครงการลบไฟล์ของคนอื่นไม่ได้ — ไฟล์ส่งมอบเป็นหลักฐานของงาน */

/* ─── ตารางไฟล์แนบรู้จักเจ้าของชนิดโปรเจคด้วย ──────────────────────
   นโยบายเดิมไล่ชนิดเอกสารทีละกิ่งในเงื่อนไขเดียว เพิ่มชนิดใหม่จึงต้องเขียนทั้งนโยบาย
   กิ่งเดิมคงไว้ทุกตัว เพิ่มเฉพาะกิ่ง project ที่ให้คนซึ่งเห็นโปรเจคนั้นอ่านและแนบได้
   ลบยังเป็นของคนที่อัปโหลดเองกับฝ่ายบุคคลเท่านั้น (ไม่แตะ att_delete) */
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
  );

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
    )
  );
