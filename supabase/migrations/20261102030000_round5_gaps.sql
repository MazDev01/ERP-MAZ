-- ERP MAZ · backend รอบที่ 5 — ปิดช่องว่างของสี่รอบแรก
-- เรื่องที่ใช้งานจริงทุกวันแต่สี่รอบแรกยังทำไม่ได้
--   1 ฝ่ายบุคคลแก้เวลาตอกบัตรแทนพนักงาน (คนลืมตอกออก)
--   2 PM/GM ยื่นคำขอแทนทีมงานที่ยังไม่มีบัญชีเข้าระบบ
--   3 ตัดสิทธิ์การลา — เดิมเก็บสิทธิ์ไว้แต่ไม่มีใครตรวจ อนุมัติเกินสิทธิ์ได้

-- ─── 1 ฝ่ายบุคคลแก้เวลาตอกบัตร ─────────────────────────────────────
/*
 * รอบแรกตั้งใจให้เขียน punches ได้ทางเดียวคือ clock_punch() เพื่อกันการโกงเวลา
 * แต่ของจริงมีคนลืมตอกออกทุกเดือน แล้วไม่มีทางแก้เลย รอบเวลาจึงปิดไม่ได้
 *
 * ทางออกคือเปิดช่องให้ฝ่ายบุคคลเท่านั้น และทิ้งร่องรอยไว้ให้ครบ
 *   ต้องมีเหตุผลเสมอ · ติดธงว่าเป็นรายการที่ฝ่ายบุคคลเพิ่ม ไม่ใช่พนักงานตอกเอง
 *   ลงบันทึกว่าใครเพิ่ม · แก้รายการของรอบที่ปิดไปแล้วไม่ได้
 */
alter table public.punches add column by_hr boolean not null default false;
alter table public.punches add column hr_why text not null default '';

create function public.hr_add_punch(
  p_employee uuid,
  p_type     text,
  p_at       timestamptz,
  p_why      text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me  uuid := public.my_employee_id();
  v_why text := coalesce(trim(p_why), '');
  v_day date := (p_at at time zone 'Asia/Bangkok')::date;
  v_row public.punches;
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if p_type not in ('in', 'out') then
    return jsonb_build_object('ok', false, 'reason', 'bad_type');
  end if;
  if v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;
  if p_at > clock_timestamp() then
    return jsonb_build_object('ok', false, 'reason', 'future');
  end if;
  /* รอบที่ปิดไปแล้วแก้ไม่ได้ ยอดที่ปิดไว้จะขยับ */
  if v_day <= coalesce(public.payroll_locked_until(), '1900-01-01'::date) then
    return jsonb_build_object('ok', false, 'reason', 'period_closed',
                              'locked_until', public.payroll_locked_until());
  end if;

  insert into public.punches (employee_id, type, at, work_date, geo_status, note,
                              by_hr, hr_why, created_by)
  values (p_employee, p_type, p_at, v_day, 'off', '', true, v_why, auth.uid())
  returning * into v_row;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'hr_add_punch', p_employee,
          jsonb_build_object('type', p_type, 'at', p_at, 'why', v_why));

  return jsonb_build_object('ok', true, 'punch', to_jsonb(v_row));
end $$;

/* ลบรายการที่ฝ่ายบุคคลเพิ่มเองได้ แต่ลบของที่พนักงานตอกจริงไม่ได้ */
create function public.hr_remove_punch(p_id uuid, p_why text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_why text := coalesce(trim(p_why), '');
  v_row public.punches;
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  select * into v_row from public.punches where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not v_row.by_hr then
    return jsonb_build_object('ok', false, 'reason', 'not_hr_record');
  end if;
  if v_row.work_date <= coalesce(public.payroll_locked_until(), '1900-01-01'::date) then
    return jsonb_build_object('ok', false, 'reason', 'period_closed');
  end if;

  delete from public.punches where id = p_id;
  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'hr_remove_punch', v_row.employee_id,
          jsonb_build_object('at', v_row.at, 'why', v_why));
  return jsonb_build_object('ok', true);
end $$;

-- ─── 2 ยื่นคำขอแทนทีมงานที่ไม่มีบัญชี ──────────────────────────────
/*
 * หน้าเว็บเก็บคำขอกลุ่มนี้ไว้คนละที่ (emp-requests.ts) เพราะข้อมูลอยู่ในเครื่อง
 * ในฐานข้อมูลไม่ต้องแยกตาราง — คำขอเป็นของพนักงานคนนั้นเหมือนกัน
 * ต่างแค่ "ใครเป็นคนกรอกให้" จึงเพิ่มคอลัมน์เดียวแล้วเปิดสิทธิ์ให้ PM/GM กรอกแทน
 *
 * กรอกแทนได้เฉพาะคนที่ยังไม่มีบัญชีเข้าระบบ — คนที่มีบัญชีต้องยื่นเอง
 * ไม่งั้นหัวหน้าจะยื่นใบลาแทนลูกน้องที่ล็อกอินได้เองโดยเจ้าตัวไม่รู้
 */
alter table public.leave_requests add column filed_by uuid references public.employees (id);
alter table public.ot_requests    add column filed_by uuid references public.employees (id);
alter table public.expense_claims add column filed_by uuid references public.employees (id);

create function public.can_file_for(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    /* ตัวเองยื่นเองได้เสมอ */
    p_employee = public.my_employee_id()
    or (
      /* กรอกแทนได้เมื่อเป็น PM หรือ GM และคนนั้นยังไม่มีบัญชีเข้าระบบ */
      (public.has_role('pm') or public.has_role('gm'))
      and not exists (select 1 from public.user_accounts a where a.employee_id = p_employee)
    )
$$;

drop policy leave_insert on public.leave_requests;
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (public.can_file_for(employee_id) and status = 'pending');

drop policy ot_insert on public.ot_requests;
create policy ot_insert on public.ot_requests for insert to authenticated
  with check (public.can_file_for(employee_id) and status = 'pending');

drop policy claim_insert on public.expense_claims;
create policy claim_insert on public.expense_claims for insert to authenticated
  with check (public.can_file_for(employee_id) and status in ('draft', 'pending'));

/* คนกรอกแทนต้องเห็นใบที่ตัวเองกรอกด้วย ไม่งั้นกรอกเสร็จแล้วหาย */
drop policy leave_read on public.leave_requests;
create policy leave_read on public.leave_requests for select to authenticated
  using (
    employee_id = public.my_employee_id()
    or filed_by = public.my_employee_id()
    or approver_role = any (public.my_roles())
    or public.has_role('hr')
  );

drop policy ot_read on public.ot_requests;
create policy ot_read on public.ot_requests for select to authenticated
  using (
    employee_id = public.my_employee_id()
    or filed_by = public.my_employee_id()
    or approver_role = any (public.my_roles())
    or public.has_role('hr')
  );

drop policy claim_read on public.expense_claims;
create policy claim_read on public.expense_claims for select to authenticated
  using (
    employee_id = public.my_employee_id()
    or filed_by = public.my_employee_id()
    or approver_role = any (public.my_roles())
    or public.has_role('hr')
  );

-- ─── 3 สิทธิ์การลาคงเหลือ ──────────────────────────────────────────
/* สิทธิ์กลางต่อปีของแต่ละประเภท — ตรงกับค่าตั้งต้นใน system-settings.ts (HR-BR-13) */
alter table public.leave_types add column default_days numeric(5,2);

update public.leave_types set default_days = 6  where code = 'ลาพักร้อน';
update public.leave_types set default_days = 30 where code = 'ลาป่วย';
update public.leave_types set default_days = 3  where code = 'ลากิจ';
update public.leave_types set default_days = 45 where code = 'ลาคลอด';
update public.leave_types set default_days = 15 where code = 'ลาไม่รับค่าจ้าง';

/*
 * สิทธิ์คงเหลือ = สิทธิ์ของคนนั้น − วันที่อนุมัติไปแล้วในปีนั้น
 * สิทธิ์รายคน (leave_entitlements) มาก่อนเสมอ ไม่มีจึงใช้สิทธิ์กลางของประเภทนั้น
 * คืน null = ไม่จำกัด (ประเภทที่ยังไม่ได้ตั้งสิทธิ์ไว้)
 */
create function public.leave_balance(p_employee uuid, p_type text, p_year_be int)
returns numeric
language sql stable security definer set search_path = '' as $$
  with quota as (
    select coalesce(
      (select days from public.leave_entitlements
        where employee_id = p_employee and leave_type = p_type and year_be = p_year_be),
      (select default_days from public.leave_types where code = p_type)
    ) as days
  ),
  used as (
    select coalesce(sum(days), 0) as days
      from public.leave_requests
     where employee_id = p_employee
       and leave_type = p_type
       and status = 'approved'
       and extract(year from from_date)::int + 543 = p_year_be
  )
  select case when (select days from quota) is null then null
              else (select days from quota) - (select days from used) end
$$;

/*
 * อนุมัติเกินสิทธิ์ไม่ได้ — เสียบด่านเข้าไปใน decide_request
 * ลาไม่รับค่าจ้างก็ยังมีเพดาน เพราะเกินเพดานคือต้องคุยกันก่อน ไม่ใช่กดอนุมัติผ่าน
 */
create or replace function public.decide_request(
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
  v_type  text;
  v_days  numeric;
  v_year  int;
  v_left  numeric;
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
    select employee_id, approver_role, leave_type, days,
           extract(year from from_date)::int + 543
      into v_owner, v_route, v_type, v_days, v_year
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
    if p_ok then
      v_left := public.leave_balance(v_owner, v_type, v_year);
      if v_left is not null and v_days > v_left then
        return jsonb_build_object('ok', false, 'reason', 'over_quota',
                                  'asked', v_days, 'left', v_left, 'type', v_type);
      end if;
    end if;
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

-- ─── สิทธิ์เรียกฟังก์ชัน ───────────────────────────────────────────
grant execute on function public.hr_add_punch(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.hr_remove_punch(uuid, text) to authenticated;
grant execute on function public.can_file_for(uuid) to authenticated;
grant execute on function public.leave_balance(uuid, text, int) to authenticated;
