-- ERP MAZ · backend รอบที่ 2 — คำขออนุมัติ (ลา · โอที · เบิกค่าใช้จ่าย)
-- ต่อจากรอบที่ 1 ที่วางบัญชีผู้ใช้กับการตอกบัตรไว้แล้ว
-- ยังไม่มี: เงินเดือน · งานขาย · บัญชี · งานโครงการ (รอบหลัง)
--
-- หลักคิดเดียวกับรอบแรก
--   ทุกตารางเปิด RLS · ผู้ยื่นเห็นของตัวเอง · ผู้อนุมัติเห็นเฉพาะใบที่สายอนุมัติชี้มาหาตน · hr เห็นทุกใบ
--   การตัดสินใบทำได้ทางเดียวคือ decide_request() — เวลาและสิทธิ์ตัดสินที่ฐานข้อมูล
--   เลขที่เอกสารออกจากฐานข้อมูล ไม่ใช่จากเครื่องผู้ใช้ สองคนกดพร้อมกันต้องไม่ได้เลขซ้ำ

-- ─── เลขที่เอกสาร ──────────────────────────────────────────────────
/*
 * LV-2569-0001 · OT-2569-0001 · EX-2569-0001 — ปีเป็น พ.ศ. ตาม docNo ใน hr-data.ts
 * นับแยกตามคำนำหน้าและปี ขึ้นปีใหม่เริ่มนับหนึ่งใหม่
 */
create table public.doc_counters (
  prefix  text not null,
  year_be int  not null,
  last_no int  not null default 0,
  primary key (prefix, year_be)
);

create function public.next_doc_no(p_prefix text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_year int := extract(year from (clock_timestamp() at time zone 'Asia/Bangkok'))::int + 543;
  v_no   int;
begin
  insert into public.doc_counters (prefix, year_be, last_no)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year_be) do update set last_no = public.doc_counters.last_no + 1
  returning last_no into v_no;
  return p_prefix || '-' || v_year || '-' || lpad(v_no::text, 4, '0');
end $$;

-- ─── สายอนุมัติ ────────────────────────────────────────────────────
/*
 * ใบของบทบาทไหน ประเภทไหน ไปถึงบทบาทไหน (approvesFor / APPROVER_ROLE ใน role.ts)
 * เก็บเป็นตารางเพราะฝ่ายบุคคลแก้สายอนุมัติได้เอง และ RLS ต้องอ่านค่าเดียวกันนี้
 */
create table public.approval_routes (
  kind          text not null check (kind in ('leave', 'ot', 'expense')),
  from_role     text not null,
  approver_role text not null,
  primary key (kind, from_role)
);

-- ─── ประเภทการลาและสิทธิ์ ──────────────────────────────────────────
create table public.leave_types (
  code      text primary key,
  label     text not null,
  /* ลาประเภทนี้ได้ค่าจ้างไหม — ลาไม่รับค่าจ้างคิดเป็นวันหักเงิน */
  paid      boolean not null default true,
  /* ต้องแนบเอกสารไหม เช่นใบรับรองแพทย์ */
  needs_doc boolean not null default false,
  builtin   boolean not null default false,
  active    boolean not null default true,
  sort      int not null default 0
);

insert into public.leave_types (code, label, paid, builtin, sort) values
  ('ลาพักร้อน', 'ลาพักร้อน', true, true, 1),
  ('ลาป่วย', 'ลาป่วย', true, true, 2),
  ('ลากิจ', 'ลากิจ', true, true, 3),
  ('ลาคลอด', 'ลาคลอด', true, true, 4),
  ('ลาไม่รับค่าจ้าง', 'ลาไม่รับค่าจ้าง', false, true, 5);

/* สิทธิ์ต่อคนต่อปี — ไม่มีแถว = ใช้สิทธิ์กลางของประเภทนั้น (หน้าตั้งค่าประเภทการลา) */
create table public.leave_entitlements (
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type  text not null references public.leave_types (code),
  year_be     int  not null,
  days        numeric(5,2) not null check (days >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (employee_id, leave_type, year_be)
);

-- ─── ใบลา ──────────────────────────────────────────────────────────
create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  no            text unique not null,
  employee_id   uuid not null references public.employees (id),
  leave_type    text not null references public.leave_types (code),
  /* ช่วงวันที่ลา — วันเดียวให้ from_date = to_date */
  from_date     date not null,
  to_date       date not null check (to_date >= from_date),
  /* จำนวนวันที่ใช้หักสิทธิ์เสมอ ลาด่วนคิดจากชั่วโมง ÷ ชั่วโมงทำงานต่อวัน */
  days          numeric(5,2) not null check (days > 0),
  half          text check (half in ('morning', 'afternoon')),
  start_min     int check (start_min between 0 and 1440),
  end_min       int check (end_min between 0 and 1440),
  hours         numeric(5,2),
  reason        text not null default '',
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  /* บทบาทที่ใบนี้ถูกส่งไปหา — ตรึงไว้ตอนยื่น สายอนุมัติเปลี่ยนทีหลังใบเก่าไม่ย้าย */
  approver_role text not null,
  decided_by    uuid references public.employees (id),
  decided_at    timestamptz,
  decision_note text not null default '',
  cancel_why    text not null default '',
  cancelled_at  timestamptz,
  undone_at     timestamptz,
  undone_why    text not null default '',
  submitted_at  timestamptz not null default now(),
  edited_at     timestamptz,
  created_by    uuid
);

create index leave_emp_idx on public.leave_requests (employee_id, from_date desc);
create index leave_queue_idx on public.leave_requests (approver_role, status);

-- ─── ใบโอที ────────────────────────────────────────────────────────
create table public.ot_requests (
  id             uuid primary key default gen_random_uuid(),
  no             text unique not null,
  employee_id    uuid not null references public.employees (id),
  work_date      date not null,
  start_min      int not null check (start_min between 0 and 1440),
  end_min        int not null check (end_min between 0 and 1440),
  /* ชั่วโมงที่ขอ คิดจากช่วงเวลา · ข้ามเที่ยงคืนได้ end_min จึงน้อยกว่า start_min ได้ */
  hours          numeric(5,2) not null check (hours > 0),
  /* ชั่วโมงที่อนุมัติจริง ผู้อนุมัติตัดได้ตามเวลาตอกบัตร · null = ยังไม่ตัดสิน */
  approved_hours numeric(5,2) check (approved_hours >= 0),
  reason         text not null default '',
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_role  text not null,
  decided_by     uuid references public.employees (id),
  decided_at     timestamptz,
  decision_note  text not null default '',
  cancelled_at   timestamptz,
  undone_at      timestamptz,
  undone_why     text not null default '',
  submitted_at   timestamptz not null default now(),
  edited_at      timestamptz,
  created_by     uuid
);

create index ot_emp_idx on public.ot_requests (employee_id, work_date desc);
create index ot_queue_idx on public.ot_requests (approver_role, status);

-- ─── ใบเบิกค่าใช้จ่าย ──────────────────────────────────────────────
/* หนึ่งคนหนึ่งใบต่อเดือน (claimOf ใน expense-store.ts) */
create table public.expense_claims (
  id            uuid primary key default gen_random_uuid(),
  no            text unique,
  employee_id   uuid not null references public.employees (id),
  month         text not null check (month ~ '^\d{4}-\d{2}$'),
  status        text not null default 'draft'
                  check (status in ('draft', 'pending', 'approved', 'rejected')),
  plate         text not null default '',
  approver_role text not null default '',
  decided_by    uuid references public.employees (id),
  decided_at    timestamptz,
  decision_note text not null default '',
  /* รอบเงินเดือนที่จ่ายคืนใบนี้แล้ว (yyyy-mm) — มีค่าแล้วย้อนการอนุมัติไม่ได้ */
  paid_in       text,
  undone_at     timestamptz,
  undone_why    text not null default '',
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (employee_id, month)
);

create index claims_queue_idx on public.expense_claims (approver_role, status);

/* ค่าน้ำมัน คิดจากระยะทาง × อัตราต่อกิโลเมตร ณ วันอนุมัติ */
create table public.expense_fuel_rows (
  id        uuid primary key default gen_random_uuid(),
  claim_id  uuid not null references public.expense_claims (id) on delete cascade,
  on_date   date,
  place     text not null default '',
  work      text not null default '',
  km        numeric(8,2) check (km >= 0),
  note      text not null default '',
  sort      int not null default 0
);

/* ค่าเดินทางและค่าใช้จ่ายอื่น กรอกเป็นจำนวนเงินตรง ๆ */
create table public.expense_other_rows (
  id        uuid primary key default gen_random_uuid(),
  claim_id  uuid not null references public.expense_claims (id) on delete cascade,
  on_date   date,
  kind      text not null default '',
  item      text not null default '',
  amount    numeric(12,2) check (amount >= 0),
  note      text not null default '',
  sort      int not null default 0
);

/* รายรับที่ผูกกับดีล — ฝ่ายขายกรอกไว้ให้บัญชีเทียบ */
create table public.expense_income_rows (
  id        uuid primary key default gen_random_uuid(),
  claim_id  uuid not null references public.expense_claims (id) on delete cascade,
  item      text not null default '',
  amount    numeric(12,2) check (amount >= 0),
  deal_no   text not null default '',
  sort      int not null default 0
);

create index fuel_claim_idx on public.expense_fuel_rows (claim_id);
create index other_claim_idx on public.expense_other_rows (claim_id);
create index income_claim_idx on public.expense_income_rows (claim_id);

-- ─── บทบาทของฉัน ───────────────────────────────────────────────────
/* บทบาททั้งหมดของคนที่ล็อกอินอยู่ — ใช้ใน RLS ของคิวอนุมัติ */
create function public.my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(roles, '{}') from public.user_accounts where user_id = auth.uid()
$$;

-- ─── ตัดสินใบ ──────────────────────────────────────────────────────
/*
 * อนุมัติหรือไม่อนุมัติ — ทำได้ทางเดียวคือผ่านฟังก์ชันนี้
 *
 * กติกาที่บังคับไว้ที่นี่ ไม่ใช่ที่หน้าจอ
 *   ตัดสินได้เฉพาะใบที่ยังรออนุมัติ · กดรัวสองครั้งได้ผลเดียว
 *   ต้องเป็นบทบาทที่สายอนุมัติชี้มาหาตน · ใบของตัวเองตัดสินเองไม่ได้
 *   ไม่อนุมัติต้องมีเหตุผล (CEO-BR-03)
 *   โอทีตัดชั่วโมงได้ แต่ไม่เกินที่ขอ
 */
create function public.decide_request(
  p_kind   text,
  p_id     uuid,
  p_ok     boolean,
  p_note   text default '',
  p_hours  numeric default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    uuid := public.my_employee_id();
  v_roles text[] := public.my_roles();
  v_route text;
  v_owner uuid;
  v_asked numeric;
  v_note  text := coalesce(trim(p_note), '');
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  if p_kind not in ('leave', 'ot', 'expense') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if not p_ok and v_note = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  perform pg_advisory_xact_lock(hashtext('decide:' || p_id::text));

  if p_kind = 'leave' then
    select employee_id, approver_role into v_owner, v_route
      from public.leave_requests where id = p_id and status = 'pending';
  elsif p_kind = 'ot' then
    select employee_id, approver_role, hours into v_owner, v_route, v_asked
      from public.ot_requests where id = p_id and status = 'pending';
  else
    select employee_id, approver_role into v_owner, v_route
      from public.expense_claims where id = p_id and status = 'pending';
  end if;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  if v_owner = v_me then
    return jsonb_build_object('ok', false, 'reason', 'own_request');
  end if;
  if not (v_route = any (v_roles) or 'hr' = any (v_roles)) then
    return jsonb_build_object('ok', false, 'reason', 'not_approver');
  end if;

  if p_kind = 'leave' then
    update public.leave_requests
       set status = case when p_ok then 'approved' else 'rejected' end,
           decided_by = v_me, decided_at = now(), decision_note = v_note
     where id = p_id;
  elsif p_kind = 'ot' then
    if p_ok and p_hours is not null and (p_hours <= 0 or p_hours > v_asked) then
      return jsonb_build_object('ok', false, 'reason', 'bad_hours', 'asked', v_asked);
    end if;
    update public.ot_requests
       set status = case when p_ok then 'approved' else 'rejected' end,
           approved_hours = case when p_ok then coalesce(p_hours, v_asked) else null end,
           decided_by = v_me, decided_at = now(), decision_note = v_note
     where id = p_id;
  else
    update public.expense_claims
       set status = case when p_ok then 'approved' else 'rejected' end,
           decided_by = v_me, decided_at = now(), decision_note = v_note
     where id = p_id;
  end if;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'decide_' || p_kind, p_id,
          jsonb_build_object('ok', p_ok, 'note', v_note, 'hours', p_hours));

  return jsonb_build_object('ok', true);
end $$;

-- ─── ยกเลิกการอนุมัติ ──────────────────────────────────────────────
/*
 * ดึงใบที่ตัดสินไปแล้วกลับมารออนุมัติใหม่ (กติกาเดียวกับหน้าจอ 12 ต.ค. 2569)
 * ต้องมีเหตุผลเสมอ · ใบเบิกที่จ่ายคืนไปแล้วย้อนไม่ได้
 * ส่วนด่านรอบเวลาที่ปิดแล้วจะมาในรอบเงินเดือน ตรงนี้เว้นที่ไว้ให้เสียบเพิ่ม
 */
create function public.undo_decision(p_kind text, p_id uuid, p_why text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    uuid := public.my_employee_id();
  v_roles text[] := public.my_roles();
  v_route text;
  v_why   text := coalesce(trim(p_why), '');
  v_paid  text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  if v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  perform pg_advisory_xact_lock(hashtext('decide:' || p_id::text));

  if p_kind = 'leave' then
    select approver_role into v_route from public.leave_requests
      where id = p_id and status in ('approved', 'rejected');
  elsif p_kind = 'ot' then
    select approver_role into v_route from public.ot_requests
      where id = p_id and status in ('approved', 'rejected');
  elsif p_kind = 'expense' then
    select approver_role, paid_in into v_route, v_paid from public.expense_claims
      where id = p_id and status in ('approved', 'rejected');
    if v_paid is not null then
      return jsonb_build_object('ok', false, 'reason', 'already_paid', 'paid_in', v_paid);
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;

  if v_route is null then
    return jsonb_build_object('ok', false, 'reason', 'not_decided');
  end if;
  if not (v_route = any (v_roles) or 'hr' = any (v_roles)) then
    return jsonb_build_object('ok', false, 'reason', 'not_approver');
  end if;

  if p_kind = 'leave' then
    update public.leave_requests set status = 'pending', decided_by = null, decided_at = null,
           undone_at = now(), undone_why = v_why where id = p_id;
  elsif p_kind = 'ot' then
    update public.ot_requests set status = 'pending', approved_hours = null, decided_by = null,
           decided_at = null, undone_at = now(), undone_why = v_why where id = p_id;
  else
    update public.expense_claims set status = 'pending', decided_by = null, decided_at = null,
           undone_at = now(), undone_why = v_why where id = p_id;
  end if;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'undo_' || p_kind, p_id, jsonb_build_object('why', v_why));

  return jsonb_build_object('ok', true);
end $$;

-- ─── ออกเลขที่ตอนยื่น ──────────────────────────────────────────────
/* ใบร่างยังไม่มีเลข · ยื่นเมื่อไรออกเลขเมื่อนั้น (กติกาเดิมของใบเบิก) */
create function public.stamp_leave_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_doc_no('LV'); end if;
  return new;
end $$;

create function public.stamp_ot_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_doc_no('OT'); end if;
  return new;
end $$;

create function public.stamp_claim_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' and (new.no is null or new.no = '') then
    new.no := public.next_doc_no('EX');
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end $$;

create trigger leave_no before insert on public.leave_requests
  for each row execute function public.stamp_leave_no();
create trigger ot_no before insert on public.ot_requests
  for each row execute function public.stamp_ot_no();
create trigger claim_no before insert or update of status on public.expense_claims
  for each row execute function public.stamp_claim_no();

-- ─── RLS ───────────────────────────────────────────────────────────
alter table public.doc_counters        enable row level security;
alter table public.approval_routes     enable row level security;
alter table public.leave_types         enable row level security;
alter table public.leave_entitlements  enable row level security;
alter table public.leave_requests      enable row level security;
alter table public.ot_requests         enable row level security;
alter table public.expense_claims      enable row level security;
alter table public.expense_fuel_rows   enable row level security;
alter table public.expense_other_rows  enable row level security;
alter table public.expense_income_rows enable row level security;

/* ตารางอ้างอิง — ทุกคนที่ล็อกอินอ่านได้ แก้ได้เฉพาะ hr */
create policy routes_read on public.approval_routes for select to authenticated using (true);
create policy routes_write on public.approval_routes for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));
create policy ltypes_read on public.leave_types for select to authenticated using (true);
create policy ltypes_write on public.leave_types for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

/* สิทธิ์การลา — เจ้าตัวดูได้ hr แก้ได้ */
create policy ent_read on public.leave_entitlements for select to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr'));
create policy ent_write on public.leave_entitlements for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

/* ใบลา — เจ้าตัวเห็นและยื่นเอง · ผู้อนุมัติเห็นคิวของตัวเอง · hr เห็นหมด
   แก้ใบได้เฉพาะตอนยังรออนุมัติ และการตัดสินต้องผ่าน decide_request เท่านั้น */
create policy leave_read on public.leave_requests for select to authenticated
  using (
    employee_id = public.my_employee_id()
    or approver_role = any (public.my_roles())
    or public.has_role('hr')
  );
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (employee_id = public.my_employee_id() and status = 'pending');
create policy leave_update on public.leave_requests for update to authenticated
  using (employee_id = public.my_employee_id() and status = 'pending')
  with check (employee_id = public.my_employee_id() and status in ('pending', 'cancelled'));

create policy ot_read on public.ot_requests for select to authenticated
  using (
    employee_id = public.my_employee_id()
    or approver_role = any (public.my_roles())
    or public.has_role('hr')
  );
create policy ot_insert on public.ot_requests for insert to authenticated
  with check (employee_id = public.my_employee_id() and status = 'pending');
create policy ot_update on public.ot_requests for update to authenticated
  using (employee_id = public.my_employee_id() and status = 'pending')
  with check (employee_id = public.my_employee_id() and status in ('pending', 'cancelled'));

/* ใบเบิก — ใบร่างแก้ได้ ยื่นแล้วแก้ไม่ได้ (isLocked ใน expense-data.ts) */
create policy claim_read on public.expense_claims for select to authenticated
  using (
    employee_id = public.my_employee_id()
    or approver_role = any (public.my_roles())
    or public.has_role('hr')
  );
create policy claim_insert on public.expense_claims for insert to authenticated
  with check (employee_id = public.my_employee_id() and status in ('draft', 'pending'));
create policy claim_update on public.expense_claims for update to authenticated
  using (employee_id = public.my_employee_id() and status = 'draft')
  with check (employee_id = public.my_employee_id() and status in ('draft', 'pending'));

/* แถวในใบเบิก — ตามสิทธิ์ของใบแม่ แก้ได้เฉพาะตอนใบยังเป็นร่าง */
create policy fuel_read on public.expense_fuel_rows for select to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id));
create policy fuel_write on public.expense_fuel_rows for all to authenticated
  using (exists (select 1 from public.expense_claims c
                  where c.id = claim_id and c.employee_id = public.my_employee_id() and c.status = 'draft'))
  with check (exists (select 1 from public.expense_claims c
                  where c.id = claim_id and c.employee_id = public.my_employee_id() and c.status = 'draft'));

create policy other_read on public.expense_other_rows for select to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id));
create policy other_write on public.expense_other_rows for all to authenticated
  using (exists (select 1 from public.expense_claims c
                  where c.id = claim_id and c.employee_id = public.my_employee_id() and c.status = 'draft'))
  with check (exists (select 1 from public.expense_claims c
                  where c.id = claim_id and c.employee_id = public.my_employee_id() and c.status = 'draft'));

create policy income_read on public.expense_income_rows for select to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id));
create policy income_write on public.expense_income_rows for all to authenticated
  using (exists (select 1 from public.expense_claims c
                  where c.id = claim_id and c.employee_id = public.my_employee_id() and c.status = 'draft'))
  with check (exists (select 1 from public.expense_claims c
                  where c.id = claim_id and c.employee_id = public.my_employee_id() and c.status = 'draft'));

-- ─── สิทธิ์เรียกฟังก์ชัน ───────────────────────────────────────────
revoke execute on function public.next_doc_no(text) from public, anon, authenticated;
grant execute on function public.my_roles() to authenticated;
grant execute on function public.decide_request(text, uuid, boolean, text, numeric) to authenticated;
grant execute on function public.undo_decision(text, uuid, text) to authenticated;

-- ─── สายอนุมัติตั้งต้น ─────────────────────────────────────────────
/* ตามค่าใน role.ts วันที่เขียน — ฝ่ายบุคคลแก้ได้เองภายหลัง */
insert into public.approval_routes (kind, from_role, approver_role) values
  ('leave', 'sales', 'gm'),   ('ot', 'sales', 'ceo'),   ('expense', 'sales', 'gm'),
  ('leave', 'ps', 'gm'),      ('ot', 'ps', 'ceo'),      ('expense', 'ps', 'gm'),
  ('leave', 'pm', 'gm'),      ('ot', 'pm', 'ceo'),      ('expense', 'pm', 'gm'),
  ('leave', 'acc', 'gm'),     ('ot', 'acc', 'ceo'),     ('expense', 'acc', 'gm'),
  ('leave', 'staff', 'gm'),   ('ot', 'staff', 'ceo'),   ('expense', 'staff', 'gm'),
  ('leave', 'maid', 'gm'),    ('ot', 'maid', 'ceo'),    ('expense', 'maid', 'gm'),
  ('leave', 'intern', 'pm'),  ('ot', 'intern', 'ceo'),  ('expense', 'intern', 'gm'),
  ('leave', 'hr', 'ceo'),     ('ot', 'hr', 'ceo'),      ('expense', 'hr', 'ceo'),
  ('leave', 'gm', 'ceo'),     ('ot', 'gm', 'ceo'),      ('expense', 'gm', 'ceo');
