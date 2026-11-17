-- ─── เอาช่องยอดรวมออกจากตารางรอบเวลาทำงาน ─────────────────────────
/*
 * pay_periods ต้องอ่านได้ทุกคนที่ล็อกอิน เพราะทุกหน้าต้องรู้ว่ารอบไหนปิดแล้ว
 * (ห้ามแก้ใบลา/โอทีย้อนหลังในรอบที่ปิดไปแล้ว)
 *
 * แต่ตารางนี้มีช่อง sum ติดมาตั้งแต่รอบแรก ถ้ามีใครใส่ยอดรวมเงินเดือนลงไป
 * พนักงานทุกคนจะอ่านยอดรวมของทั้งบริษัทได้ — ช่องโหว่แบบเดียวกับ payruns.sum (round23)
 *
 * ตอนนี้หน้าจอส่ง p_sum เป็น null เสมอ ช่องนี้จึงว่างมาตลอดและไม่มีใครใช้ — เอาออกเลย
 * คงพารามิเตอร์ p_sum ไว้ให้หน้าจอเรียกได้เหมือนเดิม แต่ไม่เก็บลงตารางอีก
 */
alter table public.pay_periods drop column if exists sum;

create or replace function public.close_period(p_month text, p_group text, p_sum jsonb)
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

  insert into public.pay_periods (month, pay_group, closed, closed_at, closed_by)
  values (p_month, p_group, true, now(), v_me)
  on conflict (month, pay_group) do update
    set closed = true, closed_at = now(), closed_by = v_me;

  insert into public.audit_log (actor, action, detail)
  values (auth.uid(), 'close_period', jsonb_build_object('month', p_month, 'group', p_group));
  return jsonb_build_object('ok', true);
end $$;

/* เปิดรอบใหม่ก็ไม่ต้องล้างช่องที่ไม่มีแล้ว — ถ้าไม่แก้ด้วย เปิดรอบใหม่จะพังทันที */
create or replace function public.reopen_period(p_month text, p_group text, p_why text)
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

  update public.pay_periods set closed = false
   where month = p_month and pay_group = p_group and closed;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_closed');
  end if;

  insert into public.pay_reopens (kind, month, pay_group, why, by)
  values ('period', p_month, p_group, v_why, v_me);
  perform public.void_pay_approval(p_month, p_group, 'เปิดรอบเวลาทำงานใหม่');
  return jsonb_build_object('ok', true);
end $$;
