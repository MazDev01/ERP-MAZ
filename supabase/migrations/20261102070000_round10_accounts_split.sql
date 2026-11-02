-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ รอบที่ 10 — แยกบัญชีเข้าระบบออกจากทะเบียนพนักงาน                   ║
-- ╚══════════════════════════════════════════════════════════════════╝
/*
 * เจ้าของระบบสั่ง (2 พ.ย. 2569): "บัญชีผู้ใช้" กับ "พนักงาน" เป็นคนละเรื่อง
 *
 *   ผู้บริหาร (CEO) มีบัญชีเข้าระบบ แต่ไม่ใช่พนักงานในทะเบียน
 *   จึงต้องไม่โผล่ในลงเวลา การลา รอบเงินเดือน หรือรายชื่อผู้รับงาน
 *
 * ของเดิมบังคับว่าหนึ่งบัญชีต้องผูกกับพนักงานหนึ่งคน (employee_id not null)
 * บัญชีที่ไม่มีแถวพนักงานจึงสร้างไม่ได้เลย
 */
alter table public.user_accounts alter column employee_id drop not null;

comment on column public.user_accounts.employee_id is
  'พนักงานเจ้าของบัญชี — ว่างได้ สำหรับบัญชีที่ไม่ใช่พนักงานในทะเบียน เช่นผู้บริหาร';

-- ─── ช่องที่ทะเบียนพนักงานยังขาด ───────────────────────────────────
/*
 * ทะเบียนบนหน้าจอเก็บมากกว่าที่ตารางมี (ประวัติการศึกษา ที่อยู่ ผู้ติดต่อฉุกเฉิน ฯลฯ)
 * ตอนนี้หน้าจออ่านจากฐานข้อมูลเป็นหลักแล้ว ช่องที่ขาดจึงต้องมีที่เก็บจริง
 *
 * position กับ pos_key ไม่ใช่เรื่องเดียวกัน — แยกไว้ตั้งใจ
 *   position = บทบาทในระบบ (staff / pm / gm …) สายอนุมัติและ RLS ใช้ช่องนี้
 *   pos_key  = ตำแหน่งงานของฝ่ายบุคคล (website / dev / graphic …) ใช้แสดงและคิดเวลางาน
 * หนึ่งตำแหน่งงานได้บทบาทอะไรเป็นกติกาฝั่งหน้าจอ (rolesOfPosition ใน hr-data.ts)
 */
alter table public.employees
  add column first_en    text   not null default '',
  add column last_en     text   not null default '',
  add column pos_key     text   not null default '',
  add column edu         text   not null default '',
  add column exp         text[] not null default '{}',
  add column address     text   not null default '',
  add column sos         jsonb  not null default '{}',
  add column docs        text[] not null default '{}',
  add column leave_days  jsonb  not null default '{}',
  /* ข้อมูลทดสอบของเครื่องพัฒนา — ห้ามมีแถวนี้เป็น true บนฐานข้อมูลจริง */
  add column is_demo     boolean not null default false;

comment on column public.employees.position is
  'บทบาทในระบบ (staff/pm/gm/…) — สายอนุมัติและ RLS ใช้ช่องนี้';
comment on column public.employees.pos_key is
  'ตำแหน่งงานของฝ่ายบุคคล (website/dev/graphic/…) — คนละชั้นกับบทบาท';
comment on column public.employees.is_demo is
  'ข้อมูลทดสอบของเครื่องพัฒนา มาจาก supabase/seed.sql เท่านั้น';

-- ─── ผู้อนุมัติไม่จำเป็นต้องเป็นพนักงาน ────────────────────────────
/*
 * สองฟังก์ชันนี้เคยปฏิเสธทันทีถ้าคนกดไม่มีรหัสพนักงาน (no_account)
 * ซึ่งพอผู้บริหารไม่มีแถวในทะเบียนแล้ว จะกลายเป็นว่าอนุมัติโอทีไม่ได้เลย
 * (สายอนุมัติโอทีของพนักงานไปที่ ceo) จึงเปลี่ยนด่านเป็น "ต้องมีบทบาทในระบบ"
 *
 * ช่องผู้ตัดสิน (decided_by) อ้างทะเบียนพนักงาน คนที่ไม่มีแถวจึงบันทึกเป็นค่าว่าง
 * ใครกดยังตรวจย้อนได้จาก audit_log ที่เก็บผู้ใช้ (auth.uid) ไว้ทุกครั้ง
 *
 * ด่าน "ยื่นใบ" ไม่แก้ — คนที่ไม่มีแถวในทะเบียนยังยื่นใบลา โอที เบิก
 * และตอกบัตรไม่ได้ ตามที่เจ้าของสั่งไว้
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
  /* ผู้อนุมัติอาจไม่ใช่พนักงานในทะเบียน (ผู้บริหาร) แต่ต้องมีบทบาทในระบบ */
  if v_roles is null or array_length(v_roles, 1) is null then
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
  /* ใบของตัวเองอนุมัติเองไม่ได้ — คนที่ไม่มีแถวในทะเบียนไม่มีใบของตัวเองอยู่แล้ว */
  if v_me is not null and v_owner = v_me then
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
  if v_roles is null or array_length(v_roles, 1) is null then
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

  /* ใครกดย้อนเก็บไว้ที่ audit_log — ช่องผู้ตัดสินในใบถูกล้างไปแล้ว */
  return jsonb_build_object('ok', true);
end $$;
