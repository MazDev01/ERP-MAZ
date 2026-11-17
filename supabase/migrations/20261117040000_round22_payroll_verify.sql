-- ─── ยอดเงินเดือนต้องผ่านการตรวจของฐานข้อมูลก่อนปิดรอบ ───────────
/*
 * ของเดิม send_payroll และ close_payrun รับ "ยอด" มาจากหน้าเว็บตรง ๆ
 * ส่ง net = 1 ก็ปิดรอบและออกสลิปได้ ทั้งที่ฐานข้อมูลมีสูตรของตัวเองอยู่แล้ว
 * (payroll_lines — หลังบ้านรอบที่ 12) ตัวเลขที่จ่ายจริงจึงเชื่อหน้าเว็บทั้งหมด
 *
 * ตรงนี้ให้ฐานข้อมูลคิดเองแล้วเทียบ ไม่ตรงเกิน 1 สตางค์ = ไม่ให้ผ่าน
 * ค่าคอมมิชชั่นกับวันขาดงานยังต้องรับจากหน้าเว็บ เพราะงานขายและผลการตรวจ
 * ของฝ่ายบุคคลยังไม่ได้อยู่ในฐานข้อมูลทั้งหมด — ส่งมาชุดเดียวกับที่ใช้แสดงผล
 * แล้วฐานข้อมูลคิดซ้ำด้วยชุดนั้น จึงกันการพิมพ์ยอดเองได้
 */

/* ยอดสุทธิและประกันสังคมของกลุ่มหนึ่งตามสูตรของฐานข้อมูล */
create or replace function public.payroll_total(
  p_month      text,
  p_group      text,
  p_commission jsonb default '{}'::jsonb,
  p_absent     jsonb default '{}'::jsonb
) returns table (people int, net numeric, ss numeric)
language sql stable security definer set search_path = '' as $$
  select count(*)::int,
         coalesce(round(sum(l.net), 2), 0),
         coalesce(round(sum(l.ss), 2), 0)
    from public.payroll_lines(p_month, p_commission, p_absent) l
   where l.pay_group = p_group;
$$;

grant execute on function public.payroll_total(text, text, jsonb, jsonb) to authenticated;

create or replace function public.send_payroll(
  p_month      text,
  p_group      text,
  p_people     int,
  p_net        numeric,
  p_ss         numeric,
  p_commission jsonb default '{}'::jsonb,
  p_absent     jsonb default '{}'::jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.my_employee_id();
  v_t  record;
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_hr');
  end if;
  /* ต้องปิดรอบเวลาทำงานก่อน ไม่งั้นยอดยังขยับได้ */
  if not exists (select 1 from public.pay_periods where month = p_month and pay_group = p_group and closed) then
    return jsonb_build_object('ok', false, 'reason', 'period_open');
  end if;

  select * into v_t from public.payroll_total(p_month, p_group, p_commission, p_absent);
  if abs(coalesce(p_net, 0) - v_t.net) > 0.01 then
    return jsonb_build_object('ok', false, 'reason', 'sum_mismatch',
                              'expected', v_t.net, 'got', p_net);
  end if;

  insert into public.pay_approvals (month, pay_group, status, people, net, ss, sent_by, sent_at, reason, void_why)
  values (p_month, p_group, 'waiting', v_t.people, v_t.net, v_t.ss, v_me, now(), '', '')
  on conflict (month, pay_group) do update
    set status = 'waiting', people = excluded.people, net = excluded.net, ss = excluded.ss,
        sent_by = v_me, sent_at = now(), decided_by = null, decided_at = null,
        reason = '', void_why = '';
  return jsonb_build_object('ok', true);
end $$;

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
  v_me  uuid := public.my_employee_id();
  v_n   int;
  v_t   record;
  v_bad record;
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

  select * into v_t from public.payroll_total(p_month, p_group, p_commission, p_absent);

  /* ยอดรวมที่จะปิดต้องตรงกับที่ฐานข้อมูลคิดได้ */
  if abs(coalesce((p_sum ->> 'net')::numeric, 0) - v_t.net) > 0.01 then
    return jsonb_build_object('ok', false, 'reason', 'sum_mismatch',
                              'expected', v_t.net, 'got', (p_sum ->> 'net')::numeric);
  end if;

  /* และยอดของแต่ละคนบนสลิปต้องตรงด้วย — ยอดรวมตรงแต่สลับกันรายคนก็ไม่ได้ */
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

  insert into public.payruns (month, pay_group, closed, closed_at, closed_by, sum)
  values (p_month, p_group, true, now(), v_me,
          /* เก็บยอดที่ฐานข้อมูลคิดได้ ไม่ใช่ยอดที่หน้าเว็บส่งมา */
          coalesce(p_sum, '{}'::jsonb) || jsonb_build_object('net', v_t.net, 'ss', v_t.ss, 'n', v_t.people))
  on conflict (month, pay_group) do update
    set closed = true, closed_at = now(), closed_by = v_me, sum = excluded.sum;

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
          jsonb_build_object('month', p_month, 'group', p_group, 'lines', v_n, 'net', v_t.net));
  return jsonb_build_object('ok', true, 'lines', v_n);
end $$;
