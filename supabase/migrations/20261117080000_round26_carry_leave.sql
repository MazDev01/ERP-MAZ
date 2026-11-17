-- ─── ยกวันลาที่ใช้ไปแล้วจากระบบเดิมเข้ามา ─────────────────────────
/*
 * ก่อนเริ่มใช้ระบบจริง พนักงานแต่ละคนใช้วันลาของปีนี้ไปแล้วบางส่วนในระบบเดิม
 * ถ้าไม่ยกยอดเข้ามา ระบบจะคิดว่าทุกคนยังมีสิทธิ์เต็ม แล้วอนุมัติเกินสิทธิ์โดยไม่รู้ตัว
 *
 * ฝ่ายบุคคลบันทึกย้อนหลังได้ทางนี้ทางเดียว — เป็นใบที่ "อนุมัติแล้ว" ตั้งแต่ต้น
 * เพราะมันเกิดขึ้นจริงไปแล้ว ไม่ต้องให้ใครอนุมัติซ้ำ และต้องมีเหตุผลกำกับเสมอ
 * (ทริกเกอร์ guard_leave_request ยังกันวันซ้อนกับใบที่มีอยู่ให้เหมือนเดิม)
 */
create or replace function public.hr_record_leave(
  p_employee uuid,
  p_type     text,
  p_from     date,
  p_to       date,
  p_days     numeric,
  p_why      text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me  uuid := public.my_employee_id();
  v_why text := coalesce(trim(p_why), '');
  v_row public.leave_requests;
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if v_why = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;
  if p_to < p_from then
    return jsonb_build_object('ok', false, 'reason', 'bad_range');
  end if;
  if coalesce(p_days, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_days');
  end if;
  if not exists (select 1 from public.leave_types where code = p_type and active) then
    return jsonb_build_object('ok', false, 'reason', 'bad_type');
  end if;
  /* วันลาที่ตกในรอบเงินเดือนที่ปิดไปแล้วแก้ไม่ได้ ยอดที่จ่ายไปแล้วจะขยับ */
  if p_from <= coalesce(public.payroll_locked_until(), '1900-01-01'::date) then
    return jsonb_build_object('ok', false, 'reason', 'period_closed');
  end if;

  insert into public.leave_requests
    (employee_id, leave_type, from_date, to_date, days, reason, status,
     approver_role, decided_by, decided_at, decision_note, filed_by)
  values
    (p_employee, p_type, p_from, p_to, p_days, v_why, 'approved',
     coalesce(public.route_of('leave', p_employee), 'hr'), v_me, now(),
     'ยกยอดจากระบบเดิม', v_me)
  returning * into v_row;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'hr_record_leave', p_employee,
          jsonb_build_object('type', p_type, 'from', p_from, 'to', p_to, 'days', p_days, 'why', v_why));

  return jsonb_build_object('ok', true, 'no', v_row.no);
exception
  when others then
    /* ทริกเกอร์กันวันซ้อนจะโยน leave_overlap ออกมา — ส่งกลับให้หน้าจออ่านได้ */
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;

grant execute on function public.hr_record_leave(uuid, text, date, date, numeric, text) to authenticated;
