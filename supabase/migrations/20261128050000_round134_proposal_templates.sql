/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 134 · แม่แบบ Proposal ของผู้บริหาร (ยกมาจาก ERP_Test)

   กรอบ Proposal หลักของบริษัท — ผู้บริหารหรือผู้ดูแลระบบอัปโหลดไว้
   ฝ่ายขายกับทีมก่อนการขายเปิดหรือดาวน์โหลดไปใช้เป็นโครงก่อนทำข้อเสนอ

   คนละอย่างกับ "คลังเทมเพลต" ของทีมก่อนการขาย (presales_templates)
   ซึ่งเป็นไฟล์งานของทีมที่เลือกไปแนบตอนส่งข้อเสนอรายใบ
   ═══════════════════════════════════════════════════════════════════ */

create table if not exists public.proposal_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  note        text not null default '',
  /** ชื่อไฟล์ หรือที่อยู่ลิงก์ถ้าเป็นลิงก์ */
  file        text not null default '',
  size_bytes  bigint not null default 0 check (size_bytes >= 0),
  url         text not null default '',
  /** ที่อยู่ไฟล์ในถังของระบบ — ว่าง = เก็บแค่ชื่อหรือเป็นลิงก์ */
  path        text,
  by_name     text not null default '',
  at          timestamptz not null default now(),
  created_by  uuid,
  off         boolean not null default false
);

comment on table public.proposal_templates is 'แม่แบบ Proposal ของผู้บริหาร — ฝ่ายขายใช้เป็นโครงก่อนทำข้อเสนอ';

alter table public.proposal_templates enable row level security;

/* ทุกคนในสายงานขายอ่านได้ · ผู้บริหารกับฝ่ายบุคคล (ผู้ดูแลระบบ) เป็นคนจัดการ */
drop policy if exists proposal_templates_read on public.proposal_templates;
create policy proposal_templates_read on public.proposal_templates for select to authenticated
  using (public.can_see_sales() or public.has_role('hr'));

drop policy if exists proposal_templates_write on public.proposal_templates;
create policy proposal_templates_write on public.proposal_templates for insert to authenticated
  with check (public.has_role('ceo') or public.has_role('hr'));

drop policy if exists proposal_templates_change on public.proposal_templates;
create policy proposal_templates_change on public.proposal_templates for update to authenticated
  using (public.has_role('ceo') or public.has_role('hr'))
  with check (public.has_role('ceo') or public.has_role('hr'));

drop policy if exists proposal_templates_del on public.proposal_templates;
create policy proposal_templates_del on public.proposal_templates for delete to authenticated
  using (public.has_role('ceo') or public.has_role('hr'));

grant select, insert, update, delete on public.proposal_templates to authenticated;

/* ── ไฟล์ของแม่แบบเก็บในถัง docs ใต้โฟลเดอร์ proposal ───────────────
   ของเดิมอนุญาตเฉพาะโฟลเดอร์ของใบลา/โอที/ค่าใช้จ่าย/พนักงาน/เงินเดือน/โปรเจค/ผู้สนใจ
   เติม proposal เข้าไป โดยให้สิทธิ์ตามคนที่จัดการแม่แบบ (ผู้บริหาร/ฝ่ายบุคคล) */
drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'docs'
    and (
      (split_part(name, '/', 1) = 'proposal'
       and (public.has_role('ceo') or public.has_role('hr')))
      or (split_part(name, '/', 1) = any (array['leave', 'ot', 'expense', 'employee', 'payroll', 'project', 'lead'])
          and public.doc_owner_of(name) is not null
          and public.can_see_doc(split_part(name, '/', 1), public.doc_owner_of(name)))
    )
  );

/* อ่านไฟล์แม่แบบได้ทุกคนในสายงานขาย — ไม่ได้ผูกกับตารางไฟล์แนบของพนักงาน */
drop policy if exists docs_read on storage.objects;
create policy docs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'docs'
    and (
      (split_part(name, '/', 1) = 'proposal' and (public.can_see_sales() or public.has_role('hr')))
      or exists (
        select 1 from public.attachments a
         where a.path = objects.name
           and (a.uploaded_by = public.my_employee_id()
                or public.has_role('hr')
                or public.can_see_doc(a.owner_kind, a.owner_id)))
    )
  );

/* ลบไฟล์แม่แบบได้เฉพาะคนที่จัดการแม่แบบ */
drop policy if exists docs_delete on storage.objects;
create policy docs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'docs'
    and (
      (split_part(name, '/', 1) = 'proposal' and (public.has_role('ceo') or public.has_role('hr')))
      or exists (
        select 1 from public.attachments a
         where a.path = objects.name
           and (a.uploaded_by = public.my_employee_id() or public.has_role('hr')))
    )
  );

notify pgrst, 'reload schema';
