-- ERP MAZ · backend รอบที่ 3 — เงินเดือน
-- รอบเวลาทำงาน · รอบจ่าย · ปิดรอบ/เปิดรอบ · CEO อนุมัติยอด · สลิป · รายการปรับ
--
-- สูตรคำนวณเงินเดือนยังอยู่ฝั่งหน้าเว็บ (hr-data.ts) รอบนี้ฐานข้อมูลรับผิดชอบ
-- "สถานะ" กับ "ยอดที่ปิดไว้" ซึ่งเป็นของที่ย้อนไม่ได้และต้องสืบได้ว่าใครทำเมื่อไร
--
-- ลำดับที่บังคับไว้ที่นี่ ไม่ใช่ที่หน้าจอ
--   ปิดรอบเวลา → คำนวณ → CEO อนุมัติ → ปิดรอบจ่าย → เผยแพร่สลิป
--   ข้ามขั้นไม่ได้ · ย้อนทุกขั้นต้องมีเหตุผลและถูกบันทึกไว้

-- ─── ประวัติเงินเดือนและตำแหน่ง ────────────────────────────────────
/* ปรับเงินเดือนคือการต่อแถวใหม่ ไม่ใช่แก้แถวเดิม ยอดของรอบที่ปิดไปแล้วจะได้ไม่ขยับ */
create table public.salary_steps (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  effective   date not null,
  position    text not null,
  salary      numeric(12,2) not null check (salary >= 0),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create index salary_emp_idx on public.salary_steps (employee_id, effective desc);

-- ─── รอบเวลาทำงานและรอบจ่าย ────────────────────────────────────────
/*
 * กลุ่มจ่ายแยกกันคนละรอบ month = พนักงานรายเดือน · day = ทดลองงานจ่ายรายวัน
 * เดิมเก็บเป็นสองชุดคอลัมน์ในแถวเดียว (Period.closed กับ dayClosed)
 * ที่นี่แยกเป็นคนละแถว กติกาเดียวเขียนครั้งเดียวใช้ได้ทั้งสองกลุ่ม
 */
create table public.pay_periods (
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  pay_group  text not null check (pay_group in ('month', 'day')),
  closed     boolean not null default false,
  closed_at  timestamptz,
  closed_by  uuid references public.employees (id),
  /* ยอดที่บันทึกไว้ ณ วันปิดรอบ — เทียบกับยอดที่คำนวณสดเพื่อดูว่าตัวเลขขยับไหม */
  sum        jsonb,
  primary key (month, pay_group)
);

create table public.payruns (
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  pay_group  text not null check (pay_group in ('month', 'day')),
  closed     boolean not null default false,
  closed_at  timestamptz,
  closed_by  uuid references public.employees (id),
  sum        jsonb,
  primary key (month, pay_group)
);

/* ประวัติการเปิดรอบ — เปิดได้แต่ต้องมีเหตุผล และของเดิมไม่หาย */
create table public.pay_reopens (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('period', 'payrun', 'slip')),
  month      text not null,
  pay_group  text not null,
  why        text not null check (length(trim(why)) > 0),
  at         timestamptz not null default now(),
  by         uuid references public.employees (id)
);

create index reopen_idx on public.pay_reopens (month, pay_group, at desc);

-- ─── รายการปรับและเงินเพิ่ม ────────────────────────────────────────
/* ค่าคอมและเบี้ยเลี้ยงรายเดือน — ฝ่ายบุคคลกรอกก่อนคำนวณ */
create table public.pay_extras (
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  employee_id uuid not null references public.employees (id) on delete cascade,
  incentive   numeric(12,2) not null default 0,
  allowance   numeric(12,2) not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (month, employee_id)
);

/* รายการปรับเพิ่ม-ลด ติดลบได้ ต้องมีเหตุผลเสมอ */
create table public.pay_adjusts (
  id          uuid primary key default gen_random_uuid(),
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  employee_id uuid not null references public.employees (id) on delete cascade,
  amount      numeric(12,2) not null check (amount <> 0),
  why         text not null check (length(trim(why)) > 0),
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create index adjust_idx on public.pay_adjusts (month, employee_id);

-- ─── ยอดที่ CEO ต้องอนุมัติ ─────────────────────────────────────────
/*
 * draft → waiting → approved | rejected
 * ฝ่ายบุคคลส่งยอดให้ CEO ดู · CEO อนุมัติหรือตีกลับพร้อมเหตุผล
 * ยอดขยับเมื่อไรการอนุมัติเป็นโมฆะทันที (void_pay_approval) เพราะที่อนุมัติไปคือยอดเก่า
 */
create table public.pay_approvals (
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  pay_group  text not null check (pay_group in ('month', 'day')),
  status     text not null default 'draft'
               check (status in ('draft', 'waiting', 'approved', 'rejected')),
  people     int,
  net        numeric(14,2),
  ss         numeric(14,2),
  sent_by    uuid references public.employees (id),
  sent_at    timestamptz,
  decided_by uuid references public.employees (id),
  decided_at timestamptz,
  reason     text not null default '',
  void_why   text not null default '',
  primary key (month, pay_group)
);

-- ─── สลิปเงินเดือน ─────────────────────────────────────────────────
create table public.payslips (
  month        text not null check (month ~ '^\d{4}-\d{2}$'),
  pay_group    text not null check (pay_group in ('month', 'day')),
  published    boolean not null default false,
  made_at      timestamptz,
  published_at timestamptz,
  published_by uuid references public.employees (id),
  primary key (month, pay_group)
);

/* บรรทัดของแต่ละคนในรอบนั้น — แช่ไว้ตอนปิดรอบ ตัวเลขจะได้ไม่เปลี่ยนตามข้อมูลที่แก้ทีหลัง */
create table public.payslip_lines (
  id          uuid primary key default gen_random_uuid(),
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  pay_group   text not null check (pay_group in ('month', 'day')),
  employee_id uuid not null references public.employees (id),
  /* ยอดทั้งก้อนตามโครง CycleLine ของหน้าเว็บ เก็บเป็น jsonb เพราะสูตรยังอยู่ฝั่งนั้น */
  line        jsonb not null,
  net         numeric(12,2) not null,
  made_at     timestamptz not null default now(),
  unique (month, pay_group, employee_id)
);

create index slip_line_emp_idx on public.payslip_lines (employee_id, month desc);

/* นับการเปิดดูและดาวน์โหลดสลิป */
create table public.payslip_reads (
  month       text not null,
  employee_id uuid not null references public.employees (id) on delete cascade,
  views       int not null default 0,
  downloads   int not null default 0,
  primary key (month, employee_id)
);

-- ─── ด่านรอบที่ปิดแล้ว ─────────────────────────────────────────────
/*
 * วันสุดท้ายของรอบที่ปิดไปแล้ว — ทั้งรอบเวลาทำงานและรอบจ่าย เอาวันหลังสุด
 * ใบลาและใบโอทีที่ตกในช่วงนี้ย้อนการอนุมัติไม่ได้ ต้องเปิดรอบก่อน
 * ตรงกับ lockedUntil + timesheetLockedUntil ที่หน้าจอใช้ (แก้ไว้ 12 ต.ค. 2569)
 */
/* วันสุดท้ายของรอบเดือนนั้น — วันตัดรอบตาม hrCycle ในหน้าเว็บ (ตั้งต้นวันที่ 25) */
create function public.cycle_to(p_month text) returns date
language sql immutable set search_path = '' as $$
  select (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '24 days')::date
$$;

create function public.payroll_locked_until() returns date
language sql stable security definer set search_path = '' as $$
  select max(cut) from (
    select public.cycle_to(month) as cut from public.pay_periods where closed
    union all
    select public.cycle_to(month) from public.payruns where closed
  ) t
$$;

-- ─── ปิดและเปิดรอบเวลาทำงาน ────────────────────────────────────────
create function public.close_period(p_month text, p_group text, p_sum jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := public.my_employee_id();
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if exists (select 1 from public.pay_periods where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'already_closed');
  end if;

  insert into public.pay_periods (month, pay_group, closed, closed_at, closed_by, sum)
  values (p_month, p_group, true, now(), v_me, p_sum)
  on conflict (month, pay_group) do update
    set closed = true, closed_at = now(), closed_by = v_me, sum = p_sum;

  insert into public.audit_log (actor, action, detail)
  values (auth.uid(), 'close_period', jsonb_build_object('month', p_month, 'group', p_group));
  return jsonb_build_object('ok', true);
end $$;

create function public.reopen_period(p_month text, p_group text, p_why text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me  uuid := public.my_employee_id();
  v_why text := coalesce(trim(p_why), '');
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;
  /* ปิดรอบจ่ายไปแล้วเปิดรอบเวลาไม่ได้ ต้องเปิดรอบจ่ายก่อน ไม่งั้นยอดที่จ่ายไปแล้วจะขยับ */
  if exists (select 1 from public.payruns where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'payrun_closed');
  end if;

  update public.pay_periods set closed = false, sum = null
   where month = p_month and pay_group = p_group and closed;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_closed');
  end if;

  insert into public.pay_reopens (kind, month, pay_group, why, by)
  values ('period', p_month, p_group, v_why, v_me);
  perform public.void_pay_approval(p_month, p_group, 'เปิดรอบเวลาทำงานใหม่');
  return jsonb_build_object('ok', true);
end $$;

-- ─── ส่งยอดให้ CEO และการตัดสิน ────────────────────────────────────
create function public.send_payroll(p_month text, p_group text, p_people int, p_net numeric, p_ss numeric)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := public.my_employee_id();
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  /* ต้องปิดรอบเวลาทำงานก่อน ไม่งั้นยอดยังขยับได้ */
  if not exists (select 1 from public.pay_periods where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'period_open');
  end if;

  insert into public.pay_approvals (month, pay_group, status, people, net, ss, sent_by, sent_at, reason, void_why)
  values (p_month, p_group, 'waiting', p_people, p_net, p_ss, v_me, now(), '', '')
  on conflict (month, pay_group) do update
    set status = 'waiting', people = p_people, net = p_net, ss = p_ss,
        sent_by = v_me, sent_at = now(), decided_by = null, decided_at = null,
        reason = '', void_why = '';
  return jsonb_build_object('ok', true);
end $$;

create function public.decide_payroll(p_month text, p_group text, p_ok boolean, p_why text default '')
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me  uuid := public.my_employee_id();
  v_why text := coalesce(trim(p_why), '');
begin
  if not (public.has_role('ceo')) then
    return jsonb_build_object('ok', false, 'reason', 'not_ceo');
  end if;
  if not p_ok and v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  update public.pay_approvals
     set status = case when p_ok then 'approved' else 'rejected' end,
         decided_by = v_me, decided_at = now(), reason = v_why
   where month = p_month and pay_group = p_group and status = 'waiting';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_waiting');
  end if;

  insert into public.audit_log (actor, action, detail)
  values (auth.uid(), 'decide_payroll',
          jsonb_build_object('month', p_month, 'group', p_group, 'ok', p_ok, 'why', v_why));
  return jsonb_build_object('ok', true);
end $$;

/* ยอดขยับ = ที่ CEO อนุมัติไปเป็นยอดเก่า ถือเป็นโมฆะ ต้องส่งใหม่ */
create function public.void_pay_approval(p_month text, p_group text, p_why text)
returns void
language sql volatile security definer set search_path = '' as $$
  update public.pay_approvals
     set status = 'draft', void_why = p_why, decided_by = null, decided_at = null
   where month = p_month and pay_group = p_group and status in ('waiting', 'approved')
$$;

-- ─── ปิดและเปิดรอบจ่าย ─────────────────────────────────────────────
/*
 * ปิดรอบจ่าย = แช่ยอดของทุกคนไว้ และถือว่าใบเบิกที่รวมอยู่ในรอบนี้จ่ายคืนแล้ว
 * p_lines เป็น array ของ { employee_id, line, net } ตามที่หน้าเว็บคำนวณมา
 */
create function public.close_payrun(p_month text, p_group text, p_sum jsonb, p_lines jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.my_employee_id();
  v_n  int;
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if not exists (select 1 from public.pay_periods where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'period_open');
  end if;
  if not exists (select 1 from public.pay_approvals
                  where month = p_month and pay_group = p_group and status = 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'not_approved');
  end if;
  if exists (select 1 from public.payruns where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'already_closed');
  end if;

  insert into public.payruns (month, pay_group, closed, closed_at, closed_by, sum)
  values (p_month, p_group, true, now(), v_me, p_sum)
  on conflict (month, pay_group) do update
    set closed = true, closed_at = now(), closed_by = v_me, sum = p_sum;

  insert into public.payslip_lines (month, pay_group, employee_id, line, net)
  select p_month, p_group, (x ->> 'employee_id')::uuid, x -> 'line', (x ->> 'net')::numeric
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  on conflict (month, pay_group, employee_id) do update
    set line = excluded.line, net = excluded.net, made_at = now();
  get diagnostics v_n = row_count;

  /* ใบเบิกที่อนุมัติแล้วและยังไม่เคยจ่าย ถือว่าจ่ายคืนในรอบนี้ (markReimbursed) */
  update public.expense_claims set paid_in = p_month
   where status = 'approved' and paid_in is null and month <= p_month;

  insert into public.payslips (month, pay_group, made_at)
  values (p_month, p_group, now())
  on conflict (month, pay_group) do update set made_at = now();

  insert into public.audit_log (actor, action, detail)
  values (auth.uid(), 'close_payrun',
          jsonb_build_object('month', p_month, 'group', p_group, 'lines', v_n));
  return jsonb_build_object('ok', true, 'lines', v_n);
end $$;

/*
 * เปิดรอบจ่ายใหม่ — ย้อนทั้งชุดในครั้งเดียว ไม่ให้ค้างครึ่ง ๆ กลาง ๆ
 * เปิดรอบ + ทำการอนุมัติของ CEO เป็นโมฆะ + เก็บสลิปกลับ + คืนสถานะใบเบิกที่จ่ายในรอบนี้
 */
create function public.reopen_payrun(p_month text, p_group text, p_why text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me  uuid := public.my_employee_id();
  v_why text := coalesce(trim(p_why), '');
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  update public.payruns set closed = false, sum = null
   where month = p_month and pay_group = p_group and closed;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_closed');
  end if;

  update public.payslips set published = false, published_at = null
   where month = p_month and pay_group = p_group;
  update public.expense_claims set paid_in = null where paid_in = p_month;
  perform public.void_pay_approval(p_month, p_group, v_why);

  insert into public.pay_reopens (kind, month, pay_group, why, by)
  values ('payrun', p_month, p_group, v_why, v_me);
  insert into public.audit_log (actor, action, detail)
  values (auth.uid(), 'reopen_payrun',
          jsonb_build_object('month', p_month, 'group', p_group, 'why', v_why));
  return jsonb_build_object('ok', true);
end $$;

-- ─── เผยแพร่สลิป ───────────────────────────────────────────────────
create function public.publish_slips(p_month text, p_group text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := public.my_employee_id();
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if not exists (select 1 from public.payruns where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'payrun_open');
  end if;

  update public.payslips
     set published = true, published_at = now(), published_by = v_me
   where month = p_month and pay_group = p_group;
  return jsonb_build_object('ok', true);
end $$;

create function public.unpublish_slips(p_month text, p_group text, p_why text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me  uuid := public.my_employee_id();
  v_why text := coalesce(trim(p_why), '');
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  update public.payslips set published = false, published_at = null
   where month = p_month and pay_group = p_group and published;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_published');
  end if;

  insert into public.pay_reopens (kind, month, pay_group, why, by)
  values ('slip', p_month, p_group, v_why, v_me);
  return jsonb_build_object('ok', true);
end $$;

-- ─── ปิดช่องที่รอบ 2 เว้นไว้ ───────────────────────────────────────
/*
 * ย้อนการอนุมัติใบลา/โอทีของรอบที่ปิดไปแล้วไม่ได้ — ยอดที่ปิดไว้จะขยับเงียบ ๆ
 * รอบ 2 เขียนฟังก์ชันไว้ก่อนโดยยังไม่มีตารางรอบ ตอนนี้มีแล้วจึงเสียบด่านเข้าไป
 */
create or replace function public.undo_decision(p_kind text, p_id uuid, p_why text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    uuid := public.my_employee_id();
  v_roles text[] := public.my_roles();
  v_route text;
  v_why   text := coalesce(trim(p_why), '');
  v_paid  text;
  v_when  date;
  v_lock  date := public.payroll_locked_until();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  if v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  perform pg_advisory_xact_lock(hashtext('decide:' || p_id::text));

  if p_kind = 'leave' then
    select approver_role, to_date into v_route, v_when from public.leave_requests
      where id = p_id and status in ('approved', 'rejected');
  elsif p_kind = 'ot' then
    select approver_role, work_date into v_route, v_when from public.ot_requests
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
  if v_when is not null and v_lock is not null and v_when <= v_lock then
    return jsonb_build_object('ok', false, 'reason', 'period_closed', 'locked_until', v_lock);
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

-- ─── RLS ───────────────────────────────────────────────────────────
alter table public.salary_steps   enable row level security;
alter table public.pay_periods    enable row level security;
alter table public.payruns        enable row level security;
alter table public.pay_reopens    enable row level security;
alter table public.pay_extras     enable row level security;
alter table public.pay_adjusts    enable row level security;
alter table public.pay_approvals  enable row level security;
alter table public.payslips       enable row level security;
alter table public.payslip_lines  enable row level security;
alter table public.payslip_reads  enable row level security;

/* เงินเดือนเป็นเรื่องส่วนตัว — เจ้าตัวเห็นของตัวเอง ฝ่ายบุคคลเห็นทุกคน */
create policy salary_read on public.salary_steps for select to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr'));
create policy salary_write on public.salary_steps for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

/* สถานะรอบ — ทุกคนอ่านได้ (หน้าจอต้องรู้ว่ารอบปิดหรือยัง) แก้ผ่านฟังก์ชันเท่านั้น */
create policy period_read on public.pay_periods for select to authenticated using (true);
create policy payrun_read on public.payruns for select to authenticated using (true);
create policy reopen_read on public.pay_reopens for select to authenticated
  using (public.has_role('hr') or public.has_role('ceo'));

create policy extra_read on public.pay_extras for select to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr'));
create policy extra_write on public.pay_extras for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

create policy adjust_read on public.pay_adjusts for select to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr'));
create policy adjust_write on public.pay_adjusts for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

/* ยอดรวมทั้งบริษัท — เฉพาะฝ่ายบุคคลกับผู้บริหาร */
create policy approval_read on public.pay_approvals for select to authenticated
  using (public.has_role('hr') or public.has_role('ceo'));

create policy slips_read on public.payslips for select to authenticated using (true);

/* บรรทัดสลิป — เจ้าตัวเห็นได้เมื่อเผยแพร่แล้วเท่านั้น ฝ่ายบุคคลเห็นตลอด */
create policy slipline_read on public.payslip_lines for select to authenticated
  using (
    public.has_role('hr')
    or (
      employee_id = public.my_employee_id()
      and exists (select 1 from public.payslips s
                   where s.month = payslip_lines.month
                     and s.pay_group = payslip_lines.pay_group
                     and s.published)
    )
  );

create policy reads_own on public.payslip_reads for all to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr'))
  with check (employee_id = public.my_employee_id());

-- ─── สิทธิ์เรียกฟังก์ชัน ───────────────────────────────────────────
revoke execute on function public.void_pay_approval(text, text, text) from public, anon, authenticated;
grant execute on function public.payroll_locked_until() to authenticated;
grant execute on function public.cycle_to(text) to authenticated;
grant execute on function public.close_period(text, text, jsonb) to authenticated;
grant execute on function public.reopen_period(text, text, text) to authenticated;
grant execute on function public.send_payroll(text, text, int, numeric, numeric) to authenticated;
grant execute on function public.decide_payroll(text, text, boolean, text) to authenticated;
grant execute on function public.close_payrun(text, text, jsonb, jsonb) to authenticated;
grant execute on function public.reopen_payrun(text, text, text) to authenticated;
grant execute on function public.publish_slips(text, text) to authenticated;
grant execute on function public.unpublish_slips(text, text, text) to authenticated;
