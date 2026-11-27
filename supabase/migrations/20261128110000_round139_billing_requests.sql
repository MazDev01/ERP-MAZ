/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 139 · ต่อบริการเดิม — PM แจ้งบัญชีออกใบเสนอราคา/ใบแจ้งหนี้
   (Requirement รอบ 7 · ข้อค้างใน issue #1)

   ลูกค้าเก่าติดต่อ PM เองว่าจะต่อบริการ ไม่ได้กลับไปเข้าทางฝ่ายขาย
   PM จึง "แจ้งบัญชี" ได้เลยจากหน้าโปรเจคของลูกค้ารายนั้น ไม่ต้องเปิดผู้สนใจใหม่

   คำขอเป็นแค่ใบสั่งงานถึงบัญชี — ไม่ใช่เอกสารขาย
     ลูกค้ากับโปรเจคมาจากโปรเจคที่กดแจ้ง (PM ไม่ได้เลือกลูกค้าเอง)
     บัญชีเป็นคนออกเอกสารจริง และคำขอปิดตัวเองเมื่อผูกเลขเอกสารแล้ว
     ปิดแล้วเปิดใหม่ไม่ได้ ต้องแจ้งใบใหม่ (เหมือนใบขออื่นของระบบ)

   ลูกค้าต่อสัญญา/ซื้อ Phase ถัดไป = งานใหม่เสมอ (SRS) — คำขอนี้จึงไม่แก้โปรเจคเดิม
   ═══════════════════════════════════════════════════════════════════ */

create table if not exists public.billing_requests (
  id          uuid primary key default gen_random_uuid(),
  /** เลขที่คำขอ — BR-{พ.ศ.}-{NNNN} ฐานข้อมูลออกให้ */
  no          text not null default '',
  customer_id uuid not null references public.customers(id) on delete cascade,
  /** โปรเจคที่ลูกค้าติดต่อมาต่อบริการ — ลบโปรเจคทิ้งคำขอยังอยู่เป็นหลักฐาน */
  project_id  uuid references public.projects(id) on delete set null,
  /** ขออะไร — ใบเสนอราคา (ต่อบริการใหม่) หรือใบแจ้งหนี้ (ตกลงราคากันแล้ว) */
  kind        text not null check (kind in ('quotation', 'invoice')),
  /** บริการที่จะต่อ — ตั้งต้นจากบริการของโปรเจคเดิม */
  service     text not null default '',
  /** สิ่งที่ลูกค้าขอ ยอดที่คุยไว้ กำหนดที่ลูกค้าต้องการ */
  note        text not null,
  status      text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  /** เลขเอกสารที่บัญชีออกให้ — ว่างคือยังไม่ได้ออก */
  doc_no      text not null default '',
  by_name     text not null default '',
  by_id       uuid references public.employees(id),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   text not null default '',
  /** เหตุผลตอนยกเลิก — ปิดงานต้องบอกเหตุผลเสมอเหมือนใบอื่น */
  why         text not null default ''
);

create unique index if not exists billing_requests_no on public.billing_requests (no);
create index if not exists billing_requests_open on public.billing_requests (status, created_at desc);

/** เลขที่คำขอ และชื่อคนแจ้ง — ฐานข้อมูลเขียนให้ กรอกแทนกันไม่ได้ */
create or replace function public.billing_request_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_me record;
begin
  if coalesce(new.no, '') = '' then
    new.no := public.next_doc_no('BR');
  end if;
  select trim(e.first_name || ' ' || e.last_name) nm, e.id
    into v_me
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

drop trigger if exists billing_requests_stamp on public.billing_requests;
create trigger billing_requests_stamp before insert on public.billing_requests
  for each row execute function public.billing_request_stamp();

/** ปิดแล้วห้ามแก้ — คำขอที่ปิดไปแล้วเปิดใหม่ไม่ได้ ต้องแจ้งใบใหม่ */
create or replace function public.billing_request_closed() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'open' then
    raise exception 'request_closed';
  end if;
  if new.customer_id is distinct from old.customer_id
     or new.kind is distinct from old.kind
     or new.no is distinct from old.no
     or new.by_name is distinct from old.by_name then
    raise exception 'request_locked';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_requests_closed on public.billing_requests;
create trigger billing_requests_closed before update on public.billing_requests
  for each row execute function public.billing_request_closed();

alter table public.billing_requests enable row level security;

/* ใครเกี่ยวข้อง — PM กับผู้จัดการทั่วไปเป็นคนแจ้ง บัญชีเป็นคนทำ ผู้บริหารดูได้ */
create or replace function public.can_see_billing_req() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role('pm') or public.has_role('gm')
      or public.has_role('acc') or public.has_role('ceo')
$$;

grant execute on function public.can_see_billing_req() to authenticated;

drop policy if exists billing_req_read on public.billing_requests;
create policy billing_req_read on public.billing_requests
  for select to authenticated using (public.can_see_billing_req());

/* แจ้งได้เฉพาะ PM และผู้จัดการทั่วไป — บัญชีไม่สั่งงานตัวเอง */
drop policy if exists billing_req_add on public.billing_requests;
create policy billing_req_add on public.billing_requests
  for insert to authenticated
  with check (public.has_role('pm') or public.has_role('gm'));

/* ปิดคำขอได้เฉพาะบัญชี (ทำเสร็จ) และคนแจ้งเอง (ยกเลิกคำขอของตัวเอง) */
drop policy if exists billing_req_close on public.billing_requests;
create policy billing_req_close on public.billing_requests
  for update to authenticated
  using (
    public.has_role('acc')
    or by_id = (select a.employee_id from public.user_accounts a where a.user_id = auth.uid())
  )
  with check (
    public.has_role('acc')
    or by_id = (select a.employee_id from public.user_accounts a where a.user_id = auth.uid())
  );

grant select, insert, update on public.billing_requests to authenticated;

/**
 * แจ้งบัญชีจากโปรเจค — ลูกค้าและบริการมาจากโปรเจคนั้น PM ไม่ได้พิมพ์เอง
 * คืนเลขที่คำขอ หรือเหตุผลที่แจ้งไม่ได้
 */
drop function if exists public.billing_request_add(uuid, text, text, text);
create or replace function public.billing_request_add(
  p_pj text,
  p_kind text,
  p_note text,
  p_service text default ''
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pj record;
  v_no text;
begin
  if not (public.has_role('pm') or public.has_role('gm')) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if p_kind not in ('quotation', 'invoice') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if coalesce(trim(p_note), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_note');
  end if;
  /* อ้างโปรเจคด้วยเลขที่ (PJ-…) แบบเดียวกับที่หน้าจอใช้ทุกที่ ไม่ใช่ uuid ของแถว */
  select p.id, p.customer_id, p.service into v_pj
    from public.projects p where p.pj = p_pj;
  if v_pj.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_project');
  end if;
  if v_pj.customer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_customer');
  end if;
  /* คำขอที่ยังเปิดอยู่ของโปรเจคเดียวกันและประเภทเดียวกัน ไม่ต้องแจ้งซ้ำ */
  if exists (
    select 1 from public.billing_requests r
     where r.project_id = v_pj.id and r.kind = p_kind and r.status = 'open'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_open');
  end if;

  insert into public.billing_requests (customer_id, project_id, kind, service, note)
  values (v_pj.customer_id, v_pj.id, p_kind,
          coalesce(nullif(trim(p_service), ''), v_pj.service, ''), trim(p_note))
  returning no into v_no;
  return jsonb_build_object('ok', true, 'no', v_no);
end;
$$;

grant execute on function public.billing_request_add(text, text, text, text) to authenticated;

/** บัญชีทำเสร็จ — ผูกเลขเอกสารที่ออกให้ แล้วคำขอปิดตัวเอง */
create or replace function public.billing_request_done(p_no text, p_doc text)
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
  update public.billing_requests
     set status = 'done', doc_no = trim(p_doc), closed_at = now(), closed_by = coalesce(v_me, '')
   where no = p_no and status = 'open';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.billing_request_done(text, text) to authenticated;

/** ยกเลิกคำขอ — คนแจ้งเองหรือบัญชี ต้องบอกเหตุผล */
create or replace function public.billing_request_cancel(p_no text, p_why text)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me record;
  v_n int;
begin
  if coalesce(trim(p_why), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_why');
  end if;
  select trim(e.first_name || ' ' || e.last_name) nm, e.id into v_me
    from public.user_accounts a
    join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  update public.billing_requests r
     set status = 'cancelled', why = trim(p_why), closed_at = now(), closed_by = coalesce(v_me.nm, '')
   where r.no = p_no and r.status = 'open'
     and (public.has_role('acc') or r.by_id = v_me.id);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.billing_request_cancel(text, text) to authenticated;

notify pgrst, 'reload schema';
