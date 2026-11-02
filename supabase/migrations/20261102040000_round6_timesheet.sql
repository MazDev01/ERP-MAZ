-- ERP MAZ · backend รอบที่ 6 — ตัวสรุปเวลาทำงานในฐานข้อมูล
--
-- ปิดช่องสุดท้ายของหลังบ้านฝั่งพนักงานกับเงินเดือน
-- เดิมฐานข้อมูลรับ "ยอดที่คำนวณเสร็จแล้ว" จากหน้าเว็บมาเก็บเป็น jsonb เท่านั้น
-- ใครแก้ตัวเลขก่อนส่งมาก็ไม่มีใครรู้ รอบนี้ฐานข้อมูลคำนวณเองจากข้อมูลดิบได้
-- แล้วเทียบกับยอดที่ส่งมาตอนปิดรอบจ่าย ไม่ตรงคือปิดไม่ได้
--
-- สูตรเงินเดือนเต็ม ๆ (ฐาน ค่าคอม ประกันสังคม) ยังอยู่ฝั่งหน้าเว็บ
-- ที่ย้ายลงมาคือส่วนที่นับจากข้อมูลดิบล้วน ๆ และเป็นตัวตั้งของทุกยอด
--   วันทำงาน · ชั่วโมงทำงาน · นาทีมาสาย · วันลา · ชั่วโมงโอทีที่อนุมัติ

-- ─── เวลาทำงานตามตำแหน่ง ───────────────────────────────────────────
/*
 * ตรงกับ schedule ใน system-settings.ts — แถวที่ position เป็น null คือค่ากลาง
 * แม่บ้านเข้างานเช้ากว่าคนอื่นหนึ่งชั่วโมง (ผู้ใช้สั่ง 7 ต.ค. 2569)
 */
create table public.work_hours (
  position    text primary key default '*',
  start_min   int not null check (start_min between 0 and 1440),
  end_min     int not null check (end_min between 0 and 1440),
  lunch_from  int not null default 720,
  lunch_to    int not null default 780,
  grace_min   int not null default 0,
  updated_at  timestamptz not null default now()
);

insert into public.work_hours (position, start_min, end_min) values
  ('*', 540, 1080),     -- 09:00 – 18:00
  ('maid', 480, 1020);  -- 08:00 – 17:00

alter table public.work_hours enable row level security;
create policy hours_read on public.work_hours for select to authenticated using (true);
create policy hours_write on public.work_hours for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

create function public.hours_of(p_position text) returns public.work_hours
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select w from public.work_hours w where w.position = p_position),
    (select w from public.work_hours w where w.position = '*')
  )
$$;

-- ─── สรุปเวลาทำงานต่อคนต่อรอบ ──────────────────────────────────────
/*
 * นับจากข้อมูลดิบทั้งหมด ไม่รับตัวเลขจากใคร
 *   วันทำงาน = วันที่มีทั้งตอกเข้าและตอกออก
 *   ชั่วโมงทำงาน = เวลาออก − เวลาเข้า − พักกลางวัน (ถ้าคร่อมช่วงพัก)
 *   มาสาย = ตอกเข้าหลังเวลาเริ่มงานเกินช่วงผ่อนผัน
 *   วันลา = ใบลาที่อนุมัติแล้วและตกอยู่ในรอบ
 *   ชั่วโมงโอที = ชั่วโมงที่อนุมัติจริง ไม่ใช่ที่ขอ
 *
 * คืนเป็นหนึ่งแถวต่อคน ใช้ได้ทั้งหน้าตรวจเวลาของฝ่ายบุคคลและตอนปิดรอบ
 */
create function public.timesheet(p_month text)
returns table (
  employee_id uuid,
  emp_no      text,
  name        text,
  work_days   int,
  work_min    int,
  late_min    int,
  leave_days  numeric,
  unpaid_days numeric,
  ot_hours    numeric
)
language sql stable security definer set search_path = '' as $$
  with span as (
    select (public.cycle_to(p_month) - interval '1 month' + interval '1 day')::date as d_from,
           public.cycle_to(p_month) as d_to
  ),
  /* จับคู่ตอกเข้ากับตอกออกของวันเดียวกัน — เอาเข้าแรกสุดกับออกท้ายสุด */
  day_pair as (
    select p.employee_id, p.work_date,
           min(p.at) filter (where p.type = 'in')  as in_at,
           max(p.at) filter (where p.type = 'out') as out_at
      from public.punches p, span
     where p.work_date between span.d_from and span.d_to
     group by p.employee_id, p.work_date
  ),
  day_calc as (
    select d.employee_id, d.work_date,
           /* นาทีของวันตามเวลาไทย */
           (extract(hour from d.in_at at time zone 'Asia/Bangkok') * 60
            + extract(minute from d.in_at at time zone 'Asia/Bangkok'))::int as in_min,
           (extract(hour from d.out_at at time zone 'Asia/Bangkok') * 60
            + extract(minute from d.out_at at time zone 'Asia/Bangkok'))::int as out_min,
           h.start_min, h.grace_min, h.lunch_from, h.lunch_to
      from day_pair d
      join public.employees e on e.id = d.employee_id
      cross join lateral public.hours_of(e.position) h
     where d.in_at is not null and d.out_at is not null
  ),
  per_day as (
    select employee_id,
           greatest(0, out_min - in_min
             - case when in_min < lunch_to and out_min > lunch_from
                    then lunch_to - lunch_from else 0 end) as worked,
           greatest(0, in_min - start_min - grace_min) as late
      from day_calc
  ),
  work as (
    select employee_id, count(*)::int as work_days,
           coalesce(sum(worked), 0)::int as work_min,
           coalesce(sum(late), 0)::int as late_min
      from per_day group by employee_id
  ),
  lv as (
    select l.employee_id,
           coalesce(sum(l.days), 0) as leave_days,
           coalesce(sum(l.days) filter (where t.paid = false), 0) as unpaid_days
      from public.leave_requests l
      join public.leave_types t on t.code = l.leave_type
      cross join span
     where l.status = 'approved'
       and l.from_date between span.d_from and span.d_to
     group by l.employee_id
  ),
  ot as (
    select o.employee_id, coalesce(sum(coalesce(o.approved_hours, 0)), 0) as ot_hours
      from public.ot_requests o, span
     where o.status = 'approved'
       and o.work_date between span.d_from and span.d_to
     group by o.employee_id
  )
  select e.id, e.emp_no, trim(e.first_name || ' ' || e.last_name),
         coalesce(w.work_days, 0), coalesce(w.work_min, 0), coalesce(w.late_min, 0),
         coalesce(lv.leave_days, 0), coalesce(lv.unpaid_days, 0), coalesce(ot.ot_hours, 0)
    from public.employees e
    left join work w  on w.employee_id = e.id
    left join lv      on lv.employee_id = e.id
    left join ot      on ot.employee_id = e.id
   where e.status = 'active'
     and (e.id = public.my_employee_id() or public.has_role('hr'))
   order by e.emp_no
$$;

-- ─── ตรวจยอดตอนปิดรอบจ่าย ──────────────────────────────────────────
/*
 * ปิดรอบจ่ายแล้วแก้ไม่ได้ จึงต้องมั่นใจว่ายอดที่ส่งมาตรงกับข้อมูลดิบ
 * ตรวจสามตัวที่นับจากข้อมูลดิบล้วน ๆ — ชั่วโมงทำงาน นาทีมาสาย และชั่วโมงโอที
 * ตัวที่เหลือ (ฐาน ค่าคอม ประกันสังคม) ยังคำนวณฝั่งหน้าเว็บ จึงยังตรวจไม่ได้
 *
 * ไม่ตรงคือปิดไม่ได้ และบอกด้วยว่าใครไม่ตรงและต่างกันเท่าไร
 */
create function public.check_payrun(p_month text, p_lines jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bad jsonb := '[]'::jsonb;
  v_row record;
  v_sent jsonb;
begin
  for v_row in select * from public.timesheet(p_month) loop
    select x into v_sent
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
     where (x ->> 'employee_id')::uuid = v_row.employee_id;

    if v_sent is null then continue; end if;

    if coalesce((v_sent -> 'line' ->> 'otHours')::numeric, v_row.ot_hours) <> v_row.ot_hours
       or coalesce((v_sent -> 'line' ->> 'lateMin')::int, v_row.late_min) <> v_row.late_min
       or coalesce((v_sent -> 'line' ->> 'workMin')::int, v_row.work_min) <> v_row.work_min then
      v_bad := v_bad || jsonb_build_object(
        'employee_id', v_row.employee_id,
        'emp_no', v_row.emp_no,
        'db', jsonb_build_object('otHours', v_row.ot_hours, 'lateMin', v_row.late_min, 'workMin', v_row.work_min),
        'sent', v_sent -> 'line'
      );
    end if;
  end loop;

  return jsonb_build_object('ok', jsonb_array_length(v_bad) = 0, 'mismatch', v_bad);
end $$;

/* เสียบตัวตรวจเข้าไปใน close_payrun — ยอดไม่ตรงคือปิดไม่ได้ */
create or replace function public.close_payrun(p_month text, p_group text, p_sum jsonb, p_lines jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    uuid := public.my_employee_id();
  v_n     int;
  v_check jsonb;
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

  /* ยอดที่ส่งมาต้องตรงกับที่ฐานข้อมูลนับได้จากข้อมูลดิบ */
  v_check := public.check_payrun(p_month, p_lines);
  if not (v_check ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'mismatch', 'mismatch', v_check -> 'mismatch');
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

-- ─── สิทธิ์เรียกฟังก์ชัน ───────────────────────────────────────────
grant execute on function public.hours_of(text) to authenticated;
grant execute on function public.timesheet(text) to authenticated;
grant execute on function public.check_payrun(text, jsonb) to authenticated;
