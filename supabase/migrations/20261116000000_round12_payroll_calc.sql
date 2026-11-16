-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ รอบที่ 12 — สูตรเงินเดือนย้ายลงฐานข้อมูล                           ║
-- ╚══════════════════════════════════════════════════════════════════╝
/*
 * ของเดิมเบราว์เซอร์เป็นคนคิดเงินเดือนทั้งหมดแล้วส่ง "ยอด" ขึ้นมาให้ปิดรอบ
 * ใครแก้หน้าเว็บได้ก็เปลี่ยนเงินที่ตัวเองจะได้รับ และเครื่องที่ตั้งค่าคนละชุด
 * จะคำนวณออกมาคนละตัวเลข — เงินเดือนเป็นเรื่องที่พลาดไม่ได้ สูตรจึงต้องอยู่ที่เดียว
 *
 * ฟังก์ชันนี้คิดด้วยข้อมูลดิบในฐานข้อมูลล้วน ๆ (ทะเบียน ประวัติเงินเดือน ตอกบัตร
 * ใบลา ใบโอที ใบเบิก รายการปรับ และค่าตั้งค่าระบบ) ตามสูตรเดียวกับที่หน้าจอใช้
 *
 * สองอย่างที่ฐานข้อมูลยังไม่รู้ จึงรับเป็นพารามิเตอร์ไปก่อน
 *   p_commission = ฐานคิดค่าคอม (ยอดขายที่ปิดได้ / ยอดที่ลูกค้าจ่าย) — งานขายยังไม่มีหลังบ้าน
 *   p_absent     = วันขาดงานที่ฝ่ายบุคคลตรวจแล้ว — รายการต้องตรวจยังอยู่ในหน้าจอ
 * ทั้งคู่เป็น { "<employee_id>": ตัวเลข } · ไม่ส่งมาคือศูนย์
 * เมื่อสองเรื่องนั้นย้ายขึ้นฐานข้อมูลแล้ว ให้ตัดพารามิเตอร์ออกแล้วอ่านตรงจากตาราง
 */

/* ค่าตั้งค่าระบบที่สูตรต้องใช้ — ไม่มีในฐานข้อมูลก็ใช้ค่าเดียวกับค่าตั้งต้นของหน้าจอ */
create function public.pay_settings()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select data from public.system_settings where id), '{}'::jsonb)
$$;

/* ตัวเลขจากค่าตั้งค่า — ไม่มีหรือไม่ใช่ตัวเลขก็ใช้ค่าตั้งต้นที่ส่งมา */
create function public.pay_num(p_path text[], p_default numeric)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((public.pay_settings() #>> p_path)::numeric, p_default)
$$;

/* "HH:MM" → นาทีของวัน */
create function public.hhmm_min(p text)
returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p is null or p !~ '^\d{1,2}:\d{2}$' then null
    else split_part(p, ':', 1)::numeric * 60 + split_part(p, ':', 2)::numeric
  end
$$;

/*
 * ชั่วโมงทำงานต่อวัน — คิดจากเวลาทำงานที่ตั้งไว้ หักพักกลางวันแล้ว
 * ใช้เป็นตัวหารทั้งค่าล่วงเวลาและค่าปรับมาสาย ตัวเลขสองฝั่งจะได้ไปทางเดียวกัน
 */
create function public.pay_hours_per_day()
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  s    jsonb := public.pay_settings() -> 'schedule';
  mins numeric;
begin
  if s is null then return 8; end if;
  mins :=
    public.hhmm_min(s ->> 'end') - public.hhmm_min(s ->> 'start')
    - greatest(0, public.hhmm_min(s ->> 'lunchEnd') - public.hhmm_min(s ->> 'lunchStart'));
  if mins is null or mins <= 0 then return 8; end if;
  return mins / 60.0;
end $$;

/* เพดานประกันสังคมของปีที่วันนั้นตกอยู่ — ฝ่ายบุคคลตั้งช่วงปีไว้ในค่าตั้งค่า */
create function public.ss_ceiling_on(p_date date)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_year int := extract(year from p_date)::int + 543;
  v_out  numeric;
begin
  select (x ->> 'ceiling')::numeric into v_out
    from jsonb_array_elements(coalesce(public.pay_settings() -> 'ssCeiling', '[]'::jsonb)) x
   where v_year >= (x ->> 'from')::int and v_year <= (x ->> 'to')::int
   limit 1;
  /* ค่าตั้งต้นเดียวกับ HR_SS_CEILING ในหน้าจอ */
  if v_out is null then
    v_out := case
      when v_year <= 2571 then 17500
      when v_year <= 2574 then 20000
      else 23000
    end;
  end if;
  return v_out;
end $$;

/* ประเภทโอทีของวันนั้น — วันหยุดบริษัท · เสาร์อาทิตย์ · วันทำงาน (otKindOf ในหน้าจอ) */
create function public.ot_kind_of(p_date date)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.holidays h where h.on_date = p_date) then 'public'
    when extract(dow from p_date) in (0, 6) then 'holiday'
    else 'after_work'
  end
$$;

/* วันทำการในช่วง — ตัดเสาร์อาทิตย์และวันหยุดบริษัทออก */
create function public.workdays_in(p_from date, p_to date)
returns setof date
language sql stable security definer set search_path = '' as $$
  select d::date from generate_series(p_from, p_to, interval '1 day') d
   where extract(dow from d) not in (0, 6)
     and not exists (select 1 from public.holidays h where h.on_date = d::date)
$$;

-- ─── สูตรเงินเดือนของรอบหนึ่ง ──────────────────────────────────────
create function public.payroll_lines(
  p_month      text,
  p_commission jsonb default '{}',
  p_absent     jsonb default '{}'
)
returns table (
  employee_id  uuid,
  emp_no       text,
  name         text,
  pos_key      text,
  pay_group    text,
  base         numeric,
  ot           numeric,
  com          numeric,
  inc          numeric,
  allow        numeric,
  adj          numeric,
  ss           numeric,
  late_min     int,
  late         numeric,
  absent_days  numeric,
  absent       numeric,
  unpaid_days  numeric,
  unpaid       numeric,
  gross        numeric,
  reimb        numeric,
  net          numeric,
  days         numeric,
  rate         numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  c_to    date := public.cycle_to(p_month);
  c_from  date := (public.cycle_to(p_month) - interval '1 month' + interval '1 day')::date;
  v_hours numeric := public.pay_hours_per_day();
  v_dpm   numeric := public.pay_num(array['rates', 'workDaysPerMonth'], 22);
  v_ssr   numeric := public.pay_num(array['rates', 'socialSecurity'], 5) / 100.0;
  v_late_fixed boolean := coalesce(public.pay_settings() #>> array['rates', 'lateMode'], '') = 'fixed';
  v_late_per   numeric := public.pay_num(array['rates', 'latePerMinute'], 0);
  v_com_sales  numeric := public.pay_num(array['rates', 'commission'], 5) / 100.0;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  /* ฝ่ายบุคคลเห็นทุกคน คนอื่นเห็นเฉพาะของตัวเอง — เงินเดือนเป็นเรื่องส่วนตัว */
  return query
  with emp as (
    select e.id, e.emp_no, trim(e.first_name || ' ' || e.last_name) as name,
           coalesce(nullif(e.pos_key, ''), e.position) as pos_key,
           e.emp_type, e.started_at, e.left_at,
           (e.emp_type = 'probat') as daily
      from public.employees e
     where e.emp_type <> 'intern'
       and e.started_at <= c_to
       and (e.left_at is null or e.left_at >= c_from)
       and (e.id = public.my_employee_id() or public.has_role('hr') or public.has_role('ceo'))
  ),
  /* เงินเดือนตามสัญญา ณ วันสุดท้ายของรอบ — ขึ้นเงินกลางรอบไม่ย้อนหลัง */
  sal as (
    select e.id,
           coalesce((select s.salary from public.salary_steps s
                      where s.employee_id = e.id and s.effective <= c_to
                      order by s.effective desc, s.created_at desc limit 1), 0) as full
      from emp e
  ),
  /* วันที่อยู่จริงในรอบ — เข้าใหม่หรือลาออกกลางรอบจ่ายตามสัดส่วน */
  span as (
    select e.id,
           (c_to - c_from + 1) as total_days,
           greatest(0, least(coalesce(e.left_at, c_to), c_to)
                     - greatest(e.started_at, c_from) + 1) as in_days
      from emp e
  ),
  /* วันทำการที่คนนี้อยู่จริง และไม่เกินวันนี้ (ไม่จ่ายวันที่ยังไม่มาทำงาน) */
  wdays as (
    select e.id, count(*)::numeric as n
      from emp e
      join lateral public.workdays_in(c_from, c_to) d on true
     where d >= e.started_at
       and (e.left_at is null or d <= e.left_at)
       and d <= least(c_to, v_today)
     group by e.id
  ),
  /* วันลาที่อนุมัติแล้วในรอบ แยกวันที่ไม่ได้ค่าจ้าง */
  lv as (
    select l.employee_id as id,
           coalesce(sum(l.days), 0) as days,
           coalesce(sum(l.days) filter (where t.paid = false), 0) as unpaid
      from public.leave_requests l
      join public.leave_types t on t.code = l.leave_type
     where l.status = 'approved'
       and l.from_date between c_from and c_to
     group by l.employee_id
  ),
  /* ค่าล่วงเวลา — คิดทีละใบ เพราะอัตราขึ้นกับประเภทของวันนั้น */
  ot_sum as (
    select o.employee_id as id,
           coalesce(sum(
             coalesce(o.approved_hours, o.hours) *
             case public.ot_kind_of(o.work_date)
               when 'public'  then public.pay_num(array['rates', 'otPublic'], 3)
               when 'holiday' then public.pay_num(array['rates', 'otHoliday'], 2)
               else public.pay_num(array['rates', 'otAfterWork'], 1.5)
             end
           ), 0) as weighted
      from public.ot_requests o
     where o.status = 'approved'
       and o.work_date between c_from and c_to
     group by o.employee_id
  ),
  /* มาสายกี่นาที — นับจากการตอกบัตรจริง ชุดเดียวกับที่หน้าสรุปเวลาใช้ */
  late_sum as (
    select t.employee_id as id, t.late_min
      from public.timesheet(p_month) t
  ),
  /* เงินเพิ่มและรายการปรับที่ฝ่ายบุคคลกรอก */
  ex as (
    select x.employee_id as id, x.incentive, x.allowance
      from public.pay_extras x where x.month = p_month
  ),
  adjs as (
    select a.employee_id as id, coalesce(sum(a.amount), 0) as amount
      from public.pay_adjusts a where a.month = p_month
     group by a.employee_id
  ),
  /* ใบเบิกที่จ่ายคืนในรอบนี้ — จ่ายแล้วนับรอบที่จ่าย ยังไม่จ่ายนับเมื่ออนุมัติไม่เกินวันตัดรอบ */
  rb as (
    select c.employee_id as id,
           coalesce(sum(
             coalesce((select sum(f.km * public.pay_num(array['rates', 'fuelPerKm'], 4))
                         from public.expense_fuel_rows f where f.claim_id = c.id), 0)
             + coalesce((select sum(o2.amount)
                         from public.expense_other_rows o2 where o2.claim_id = c.id), 0)
           ), 0) as total
      from public.expense_claims c
     where c.status = 'approved'
       and (case when c.paid_in is not null then c.paid_in = p_month
                 else (c.decided_at at time zone 'Asia/Bangkok')::date <= c_to end)
     group by c.employee_id
  )
  select
    e.id, e.emp_no, e.name, e.pos_key,
    case when e.daily then 'day' else 'month' end as pay_group,
    calc.base, calc.ot, calc.com, calc.inc, calc.allow, calc.adj, calc.ss,
    calc.late_min, calc.late, calc.absent_days, calc.absent,
    calc.unpaid_days, calc.unpaid, calc.gross, calc.reimb, calc.net,
    calc.worked, calc.day_rate
  from emp e
  join sal  on sal.id = e.id
  join span on span.id = e.id
  left join wdays    on wdays.id = e.id
  left join lv       on lv.id = e.id
  left join ot_sum   on ot_sum.id = e.id
  left join late_sum on late_sum.id = e.id
  left join ex       on ex.id = e.id
  left join adjs     on adjs.id = e.id
  left join rb       on rb.id = e.id
  cross join lateral (
    select
      round(coalesce(wdays.n, 0) - coalesce(lv.days, 0), 2) as worked,
      round(sal.full / nullif(v_dpm, 0), 2) as day_rate,
      sal.full / 30.0 as per_day,
      sal.full / 30.0 / nullif(v_hours, 0) as per_hour
  ) b
  cross join lateral (
    select
      /* ฐาน: รายวันจ่ายตามวันที่มาจริง · รายเดือนจ่ายตามสัดส่วนวันที่อยู่ในรอบ */
      round(case when e.daily then b.day_rate * b.worked
                 else sal.full * span.in_days / nullif(span.total_days, 0) end, 2) as base,
      round(coalesce(ot_sum.weighted, 0) * b.per_hour, 2) as ot,
      round(coalesce((p_commission ->> e.id::text)::numeric, 0)
            * case e.pos_key when 'sales' then v_com_sales when 'pm' then 0.025 else 0 end, 2) as com,
      coalesce(ex.incentive, 0) as inc,
      coalesce(ex.allowance, 0) as allow,
      coalesce(adjs.amount, 0) as adj,
      coalesce(late_sum.late_min, 0) as late_min,
      coalesce(rb.total, 0) as reimb,
      /* ขาดงานและลาไม่รับค่าจ้าง — คนจ่ายรายวันไม่ต้องหักซ้ำ จ่ายตามวันที่มาอยู่แล้ว */
      case when e.daily then 0 else coalesce((p_absent ->> e.id::text)::numeric, 0) end as absent_days,
      case when e.daily then 0 else coalesce(lv.unpaid, 0) end as unpaid_days
  ) m
  cross join lateral (
    select
      m.base, m.ot, m.com, m.inc, m.allow, m.adj, m.late_min, m.reimb,
      m.absent_days, m.unpaid_days, b.worked, b.day_rate,
      /* ประกันสังคมคิดจากเงินเดือนฐาน ไม่รวมค่าล่วงเวลา และไม่เกินเพดานของปีนั้น (BR-04) */
      round(least(m.base, public.ss_ceiling_on(c_to)) * v_ssr, 2) as ss,
      round(m.late_min * case when v_late_fixed then v_late_per
                              else (case when e.daily then b.day_rate else b.per_day end)
                                   / nullif(v_hours, 0) / 60.0 end, 2) as late,
      round(m.absent_days * (case when e.daily then b.day_rate else b.per_day end), 2) as absent,
      round(m.unpaid_days * (case when e.daily then b.day_rate else b.per_day end), 2) as unpaid,
      round(m.base + m.ot + m.com + m.inc + m.allow + m.adj, 2) as gross
  ) calc0
  cross join lateral (
    select calc0.*,
           round(calc0.gross - calc0.ss - calc0.late - calc0.absent - calc0.unpaid + calc0.reimb, 2) as net
  ) calc
  order by e.emp_no;
end $$;

grant execute on function public.payroll_lines(text, jsonb, jsonb) to authenticated;
grant execute on function public.pay_settings() to authenticated;
grant execute on function public.pay_num(text[], numeric) to authenticated;
grant execute on function public.pay_hours_per_day() to authenticated;
grant execute on function public.hhmm_min(text) to authenticated;
grant execute on function public.ss_ceiling_on(date) to authenticated;
grant execute on function public.ot_kind_of(date) to authenticated;
grant execute on function public.workdays_in(date, date) to authenticated;
