-- ─── ยอดที่ปิดรอบต้องเท่ากับยอดที่ CEO เซ็น ───────────────────────
/*
 * รอบที่ 22 ให้ฐานข้อมูลคิดยอดเองแล้วเทียบกับยอดที่หน้าเว็บส่งมา
 * แต่ยังขาดการเทียบกับ "ยอดที่ CEO อนุมัติไว้" — ถ้าฐานการคำนวณขยับหลัง CEO เซ็น
 * (เช่น ฝ่ายบุคคลแก้นาทีมาสายทีหลัง) ยอดที่ปิดจะไม่ใช่ยอดที่ถูกอนุมัติ
 * กติกาของเจ้าของคือ CEO ต้องเซ็นตัวเลขที่จ่ายจริง จึงต้องตรงกันทั้งสองทาง
 */
create or replace function public.close_payrun(
  p_month      text,
  p_group      text,
  p_sum        jsonb,
  p_lines      jsonb,
  p_commission jsonb default '{}'::jsonb,
  p_absent     jsonb default '{}'::jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me       uuid := public.my_employee_id();
  v_n        int;
  v_t        record;
  v_bad      record;
  v_approved numeric;
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  if not exists (select 1 from public.pay_periods where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'period_open');
  end if;

  select net into v_approved from public.pay_approvals
   where month = p_month and pay_group = p_group and status = 'approved';
  if v_approved is null then
    return jsonb_build_object('ok', false, 'reason', 'not_approved');
  end if;
  if exists (select 1 from public.payruns where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'already_closed');
  end if;

  select * into v_t from public.payroll_total(p_month, p_group, p_commission, p_absent);

  /* ยอดที่ฐานข้อมูลคิดได้ตอนนี้ ต้องเท่ากับที่ CEO เซ็นไว้ */
  if abs(v_t.net - v_approved) > 0.01 then
    return jsonb_build_object('ok', false, 'reason', 'approval_stale',
                              'approved', v_approved, 'now', v_t.net);
  end if;

  /* และยอดที่หน้าเว็บส่งมาต้องตรงกับทั้งสองค่า */
  if abs(coalesce((p_sum ->> 'net')::numeric, 0) - v_t.net) > 0.01 then
    return jsonb_build_object('ok', false, 'reason', 'sum_mismatch',
                              'expected', v_t.net, 'got', (p_sum ->> 'net')::numeric);
  end if;

  select x.emp as employee_id, x.net as got, l.net as expected into v_bad
    from (select (e ->> 'employee_id')::uuid as emp, (e ->> 'net')::numeric as net
            from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e) x
    left join public.payroll_lines(p_month, p_commission, p_absent) l
      on l.employee_id = x.emp and l.pay_group = p_group
   where l.employee_id is null or abs(x.net - l.net) > 0.01
   limit 1;

  if v_bad.employee_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'line_mismatch',
                              'employee_id', v_bad.employee_id,
                              'expected', v_bad.expected, 'got', v_bad.got);
  end if;

  /* บรรทัดสลิปต้องครบทุกคนในกลุ่ม ไม่ใช่ส่งมาคนเดียวแล้วปิดรอบได้ */
  if (select count(*) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))) <> v_t.people then
    return jsonb_build_object('ok', false, 'reason', 'lines_incomplete',
                              'expected', v_t.people,
                              'got', (select count(*) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))));
  end if;

  insert into public.payruns (month, pay_group, closed, closed_at, closed_by, sum)
  values (p_month, p_group, true, now(), v_me,
          coalesce(p_sum, '{}'::jsonb) || jsonb_build_object('net', v_t.net, 'ss', v_t.ss, 'n', v_t.people))
  on conflict (month, pay_group) do update
    set closed = true, closed_at = now(), closed_by = v_me, sum = excluded.sum;

  insert into public.payslip_lines (month, pay_group, employee_id, line, net)
  select p_month, p_group, (x ->> 'employee_id')::uuid, x -> 'line', (x ->> 'net')::numeric
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  on conflict (month, pay_group, employee_id) do update
    set line = excluded.line, net = excluded.net, made_at = now();
  get diagnostics v_n = row_count;

  update public.expense_claims set paid_in = p_month
   where status = 'approved' and paid_in is null and month <= p_month;

  insert into public.payslips (month, pay_group, made_at)
  values (p_month, p_group, now())
  on conflict (month, pay_group) do update set made_at = now();

  insert into public.audit_log (actor, action, detail)
  values (auth.uid(), 'close_payrun',
          jsonb_build_object('month', p_month, 'group', p_group, 'lines', v_n, 'net', v_t.net));
  return jsonb_build_object('ok', true, 'lines', v_n);
end $$;
