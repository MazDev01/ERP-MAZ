/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 142 · อ่านบิลผู้ขาย แล้วบัญชีตรวจก่อนนำเข้า
   (Requirement รอบ 12 · ข้อค้างใน issue #1)

   เจ้าของสั่งไว้ว่า "อ่านบิลด้วย OCR แล้วบัญชีตรวจก่อนนำเข้า"
   จุดสำคัญคือคำว่า "ตรวจก่อน" — ระบบห้ามเขียนรายการค่าใช้จ่ายเองจากบิล
   บิลที่อ่านได้เป็นแค่ "ร่าง" รอบัญชีตรวจ แก้ แล้วกดนำเข้าเองเท่านั้น

   ขั้นของบิลหนึ่งใบ
     new      อ่านแล้ว รอบัญชีตรวจ
     imported บัญชีตรวจแล้วและนำเข้าเป็นเอกสารจริง (เก็บเลขเอกสารที่ออกไว้)
     dropped  บัญชีทิ้งใบนี้ (บิลซ้ำ อ่านไม่ออก ไม่ใช่ของบริษัท) ต้องบอกเหตุผล
   ปิดแล้วเปิดใหม่ไม่ได้ อัปโหลดใบใหม่แทน — กติกาเดียวกับคำขออื่นของระบบ
   ═══════════════════════════════════════════════════════════════════ */

create table if not exists public.bill_scans (
  id          uuid primary key default gen_random_uuid(),
  /** เลขที่ใบอ่านบิล BS-{พ.ศ.}-{NNNN} ฐานข้อมูลออกให้ */
  no          text not null default '',
  /** ที่อยู่ไฟล์ในถัง docs ใต้โฟลเดอร์ bill — ว่างได้ถ้าบัญชีวางแต่ข้อความ */
  path        text not null default '',
  /** ข้อความที่อ่านได้จากบิล (จากบริการ OCR หรือบัญชีวางมาเอง) */
  text        text not null default '',
  /** ร่างที่ระบบแยกให้ {vendor, taxId, date, no, base, vat, total} — บัญชีแก้ได้ก่อนนำเข้า */
  draft       jsonb not null default '{}'::jsonb,
  status      text not null default 'new' check (status in ('new', 'imported', 'dropped')),
  /** เลขเอกสารที่บัญชีออกจากบิลใบนี้ — ว่างคือยังไม่ได้นำเข้า */
  doc_no      text not null default '',
  /** เหตุผลตอนทิ้งใบนี้ */
  why         text not null default '',
  by_name     text not null default '',
  by_id       uuid references public.employees(id),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   text not null default ''
);

create unique index if not exists bill_scans_no on public.bill_scans (no);
create index if not exists bill_scans_open on public.bill_scans (status, created_at desc);

/** เลขที่ใบ และชื่อคนอัปโหลด — ฐานข้อมูลเขียนให้ กรอกแทนกันไม่ได้ */
create or replace function public.bill_scan_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_me record;
begin
  if coalesce(new.no, '') = '' then
    new.no := public.next_doc_no('BS');
  end if;
  select trim(e.first_name || ' ' || e.last_name) nm, e.id into v_me
    from public.user_accounts a
    join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  if v_me.id is not null then
    new.by_name := v_me.nm;
    new.by_id := v_me.id;
  end if;
  return new;
end;
$$;

drop trigger if exists bill_scans_stamp on public.bill_scans;
create trigger bill_scans_stamp before insert on public.bill_scans
  for each row execute function public.bill_scan_stamp();

/** ปิดแล้วห้ามแก้ — ใบที่นำเข้าหรือทิ้งไปแล้วย้อนไม่ได้ */
create or replace function public.bill_scan_closed() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'new' then
    raise exception 'scan_closed';
  end if;
  if new.no is distinct from old.no or new.by_name is distinct from old.by_name then
    raise exception 'scan_locked';
  end if;
  return new;
end;
$$;

drop trigger if exists bill_scans_closed on public.bill_scans;
create trigger bill_scans_closed before update on public.bill_scans
  for each row execute function public.bill_scan_closed();

alter table public.bill_scans enable row level security;

/* บิลค่าใช้จ่ายของบริษัทเป็นงานบัญชี — ผู้บริหารดูได้ บทบาทอื่นไม่เกี่ยว */
drop policy if exists bill_scans_read on public.bill_scans;
create policy bill_scans_read on public.bill_scans
  for select to authenticated using (public.has_role('acc') or public.has_role('ceo'));

drop policy if exists bill_scans_add on public.bill_scans;
create policy bill_scans_add on public.bill_scans
  for insert to authenticated with check (public.has_role('acc'));

drop policy if exists bill_scans_edit on public.bill_scans;
create policy bill_scans_edit on public.bill_scans
  for update to authenticated using (public.has_role('acc')) with check (public.has_role('acc'));

grant select, insert, update on public.bill_scans to authenticated;

/**
 * บัญชีตรวจแล้วกดนำเข้า — ผูกเลขเอกสารที่ออกจากบิลใบนี้
 * ระบบไม่สร้างเอกสารให้เอง บัญชีเป็นคนออกเอกสารจริงแล้วค่อยผูกเลขกลับมา
 */
create or replace function public.bill_scan_import(p_no text, p_doc text, p_draft jsonb default null)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me text := '';
  v_n int;
begin
  if not public.has_role('acc') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if coalesce(trim(p_doc), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_doc');
  end if;
  select trim(e.first_name || ' ' || e.last_name) into v_me
    from public.user_accounts a
    join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  update public.bill_scans
     set status = 'imported',
         doc_no = trim(p_doc),
         /* เก็บค่าที่บัญชีตรวจแก้แล้ว ไม่ใช่ค่าที่ระบบเดาไว้ตอนแรก */
         draft = coalesce(p_draft, draft),
         closed_at = now(),
         closed_by = coalesce(v_me, '')
   where no = p_no and status = 'new';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.bill_scan_import(text, text, jsonb) to authenticated;

/** ทิ้งบิลใบนี้ — บิลซ้ำ อ่านไม่ออก หรือไม่ใช่ของบริษัท ต้องบอกเหตุผล */
create or replace function public.bill_scan_drop(p_no text, p_why text)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me text := '';
  v_n int;
begin
  if not public.has_role('acc') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if coalesce(trim(p_why), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_why');
  end if;
  select trim(e.first_name || ' ' || e.last_name) into v_me
    from public.user_accounts a
    join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  update public.bill_scans
     set status = 'dropped', why = trim(p_why), closed_at = now(), closed_by = coalesce(v_me, '')
   where no = p_no and status = 'new';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.bill_scan_drop(text, text) to authenticated;

/* ── ไฟล์บิลเก็บในถัง docs ใต้โฟลเดอร์ bill ────────────────────────
   เติม bill เข้าไปในกติมาเดิมของถัง (รอบที่ 134 เติม proposal ไว้แล้ว)
   อ่าน/เขียน/ลบได้เฉพาะบัญชี เพราะเป็นเอกสารการเงินของบริษัท */
drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'docs'
    and (
      (split_part(name, '/', 1) = 'proposal'
       and (public.has_role('ceo') or public.has_role('hr')))
      or (split_part(name, '/', 1) = 'bill' and public.has_role('acc'))
      or (split_part(name, '/', 1) = any (array['leave', 'ot', 'expense', 'employee', 'payroll', 'project', 'lead'])
          and public.doc_owner_of(name) is not null
          and public.can_see_doc(split_part(name, '/', 1), public.doc_owner_of(name)))
    )
  );

drop policy if exists docs_read on storage.objects;
create policy docs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'docs'
    and (
      (split_part(name, '/', 1) = 'proposal' and (public.can_see_sales() or public.has_role('hr')))
      or (split_part(name, '/', 1) = 'bill' and (public.has_role('acc') or public.has_role('ceo')))
      or exists (
        select 1 from public.attachments a
         where a.path = objects.name
           and (a.uploaded_by = public.my_employee_id()
                or public.has_role('hr')
                or public.can_see_doc(a.owner_kind, a.owner_id)))
    )
  );

drop policy if exists docs_delete on storage.objects;
create policy docs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'docs'
    and (
      (split_part(name, '/', 1) = 'proposal' and (public.has_role('ceo') or public.has_role('hr')))
      or (split_part(name, '/', 1) = 'bill' and public.has_role('acc'))
      or exists (
        select 1 from public.attachments a
         where a.path = objects.name
           and (a.uploaded_by = public.my_employee_id() or public.has_role('hr')))
    )
  );

notify pgrst, 'reload schema';
