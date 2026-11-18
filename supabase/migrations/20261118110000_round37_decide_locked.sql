-- ─── อนุมัติใบย้อนหลังเข้ารอบที่ปิดไปแล้วไม่ได้ ──────────────────
/*
 * undo_decision กันไว้แล้วว่า "ถอนคำอนุมัติของรอบที่ปิดไปแล้วไม่ได้"
 * แต่ decide_request ไม่ได้กัน — อนุมัติใบลา/โอทีของเดือนที่ปิดจ่ายไปแล้วได้
 *
 * ผลคือใบขึ้นสถานะ "อนุมัติแล้ว" ทั้งที่รอบนั้นจ่ายเงินไปแล้วโดยไม่มีรายการนี้
 * วันลาถูกตัดจากสิทธิ์ของปีนั้น และถ้าเปิดรอบใหม่ ยอดจะขยับโดยไม่มีใครตั้งใจ
 * (ไล่ตรวจ backend ทั้งชุด 18 พ.ย. 2569)
 *
 * ให้ปฏิเสธไปเลยพร้อมบอกวันที่ปิดล่าสุด ฝ่ายบุคคลต้องเปิดรอบก่อนถ้าจะแก้ย้อนหลังจริง
 */
create or replace function public.decide_request(p_kind text, p_id uuid, p_ok boolean, p_note text default ''::text, p_hours numeric default null::numeric)
 returns jsonb language plpgsql security definer set search_path = '' as $function$
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
  v_when  date;
  v_lock  date := public.payroll_locked_until();
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
           extract(year from from_date)::int + 543, to_date
      into v_owner, v_route, v_type, v_days, v_year, v_when
      from public.leave_requests where id = p_id and status = 'pending';
  elsif p_kind = 'ot' then
    select employee_id, approver_role, hours, work_date
      into v_owner, v_route, v_asked, v_when
      from public.ot_requests where id = p_id and status = 'pending';
  else
    select employee_id, approver_role, (month || '-01')::date
      into v_owner, v_route, v_when
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

  /* วันของใบตกอยู่ในรอบที่ปิดจ่ายไปแล้ว — ตัดสินย้อนหลังไม่ได้ */
  if v_lock is not null and v_when is not null and v_when <= v_lock then
    return jsonb_build_object('ok', false, 'reason', 'period_closed', 'locked_until', v_lock);
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
end $function$;
