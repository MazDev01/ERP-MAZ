/* รอบที่ 115 — สองเรื่องเล็กที่เหลือ

   1. ไฟล์ Proposal และเอกสารของผู้สนใจ — ฝ่ายขายทำ Proposal เองแล้วแนบไว้ที่รายนั้น
      เดิมเก็บใน localStorage (maz-erp.lead-files.v1) และยังไม่มีหน้าจอให้แนบในสายนี้
      ไฟล์จริงขึ้นถัง "docs" ชุดเดียวกับที่อื่น (เพิ่มชนิดเจ้าของ 'lead')
      ลิงก์ (Google Drive, Canva) เก็บที่อยู่ไว้ ไม่ต้องอัปโหลด

   2. อ่านข้อความถึงไหนแล้ว — เก็บ "จำนวนข้อความของอีกฝ่ายที่อ่านแล้ว" ต่อสายต่อคน
      เดิมอยู่ในเครื่อง เปลี่ยนเครื่องแล้วจุดแดงขึ้นใหม่ทั้งหมด
      เก็บจำนวน ไม่ใช่เวลาล่าสุด เพราะเวลาละเอียดแค่ระดับนาที สองคนพิมพ์นาทีเดียวกันจะนับผิด */

/* ═══ 1 ไฟล์ของผู้สนใจ ════════════════════════════════════════════ */
create table if not exists public.lead_files (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  /* ไบต์ — ลิงก์เป็น 0 */
  size_bytes  bigint not null default 0 check (size_bytes >= 0),
  /* ลิงก์ภายนอก (Google Drive, Canva) — ไฟล์ที่อัปโหลดเองไม่มีค่านี้ */
  url         text,
  /* ที่อยู่ไฟล์ในถัง docs — ลิงก์ไม่มีค่านี้ */
  path        text,
  by_name     text not null default '',
  by_id       uuid references public.employees (id) on delete set null,
  created_at  timestamptz not null default now(),
  /* ต้องเป็นอย่างใดอย่างหนึ่ง — ลิงก์ หรือไฟล์ในถัง (หรือยังไม่มีทั้งคู่ = เก็บแค่ชื่อแบบเดิม) */
  constraint lead_files_one_place check (url is null or path is null)
);

create index if not exists lead_files_cus_idx on public.lead_files (customer_id, created_at desc);

alter table public.lead_files enable row level security;
revoke all on public.lead_files from public, anon;
grant select, insert, delete on public.lead_files to authenticated;

drop policy if exists lead_files_read  on public.lead_files;
drop policy if exists lead_files_write on public.lead_files;
drop policy if exists lead_files_drop  on public.lead_files;

create policy lead_files_read on public.lead_files
  for select to authenticated using (public.can_see_sales());
create policy lead_files_write on public.lead_files
  for insert to authenticated with check (public.can_edit_sales());
/* คนแนบเท่านั้นที่ลบได้ (และหัวหน้า/ผู้บริหาร) — เอกสารของคนอื่นห้ามลบแทน */
create policy lead_files_drop on public.lead_files
  for delete to authenticated
  using (by_id = public.my_employee_id() or public.has_role('gm') or public.has_role('ceo'));

/* ─── ถัง docs รับไฟล์ของผู้สนใจด้วย ─────────────────────────────
   can_see_doc เขียนใหม่ทั้งฟังก์ชันเพราะ sql function แก้ทีละกิ่งไม่ได้
   กิ่งอื่นคงเดิมทุกตัว เพิ่มเฉพาะกิ่ง lead */
alter table public.attachments drop constraint if exists attachments_owner_kind_check;
alter table public.attachments add constraint attachments_owner_kind_check
  check (owner_kind in ('leave', 'expense', 'employee', 'ot', 'payroll', 'project', 'lead'));

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
    /* ไฟล์ของผู้สนใจ — ใครเห็นงานขายก็เปิดได้ */
    when 'lead' then public.can_see_sales()
                     and exists (select 1 from public.customers c where c.id = p_owner)
    else false
  end;
$$;

drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'docs'
    and split_part(name, '/', 1) in ('leave', 'ot', 'expense', 'employee', 'payroll', 'project', 'lead')
    and public.doc_owner_of(name) is not null
    and public.can_see_doc(split_part(name, '/', 1), public.doc_owner_of(name))
  );

/* ตารางไฟล์แนบ — เพิ่มกิ่ง lead ทั้งตอนอ่านและตอนแนบ (กิ่งอื่นคงเดิม) */
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
      or (owner_kind = 'lead' and public.can_edit_sales())
    )
  );

/* ═══ 2 อ่านข้อความถึงไหนแล้ว ═════════════════════════════════════
   who_key = ชื่อที่หน้าจอใช้เรียกผู้อ่าน (เช่น "PM" หรือรหัสพนักงาน)
             เก็บไว้ตามที่ส่งมาเพื่อให้รูปร่างข้อมูลตรงกับที่หน้าจอใช้อยู่
   talk_key = คีย์ของสายข้อความ (งานในโปรเจค หรือคำขอก่อนการขาย)
   seen     = จำนวนข้อความของอีกฝ่ายที่อ่านไปแล้ว
   แต่ละแถวเป็นของพนักงานคนนั้น เห็นและแก้ได้เฉพาะของตัวเอง */
create table if not exists public.talk_reads (
  emp_id   uuid not null default public.my_employee_id()
             references public.employees (id) on delete cascade,
  who_key  text not null,
  talk_key text not null,
  seen     int  not null default 0 check (seen >= 0),
  at       timestamptz not null default now(),
  primary key (emp_id, who_key, talk_key)
);

alter table public.talk_reads enable row level security;
revoke all on public.talk_reads from public, anon;
grant select, insert, update on public.talk_reads to authenticated;

drop policy if exists talk_reads_own on public.talk_reads;
create policy talk_reads_own on public.talk_reads
  for all to authenticated
  using (emp_id = public.my_employee_id())
  with check (emp_id = public.my_employee_id());
