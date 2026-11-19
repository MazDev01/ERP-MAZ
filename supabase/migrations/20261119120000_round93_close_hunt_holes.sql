-- ─── ปิดช่องที่เจอตอนล่าบั๊ก 19 พ.ย. 2569 ───────────────────────
/*
 * 1) ค่าจ้างพนักงานทดลองงาน — ลาไม่เต็มวันถูกหักซ้ำ
 *    round90 หักลาครึ่งวันออกจากวันที่มาทำงาน โดยไม่ดูว่าวันนั้นมาทำงานจริงไหม
 *    ลาครึ่งวันในวันที่ไม่ได้ตอกบัตร หรือในวันเสาร์-อาทิตย์ ก็ถูกหักด้วย
 *    ทั้งสองวันนั้นไม่ได้ค่าจ้างอยู่แล้ว กลายเป็นหักสองรอบ
 *    ทดสอบ: ตอกบัตร 3 วัน + ลาครึ่งวันในวันที่ 4 (ไม่มา) → ได้ 2.5 วัน ควรเป็น 3
 *
 * 2) ใบเบิกค่าใช้จ่าย — เพดานต่อรายการมีแต่บนหน้าจอ
 *    ฐานข้อมูลกันแค่ค่าติดลบ ยิงตรงเข้ามาใส่ 9,999 กม. หรือ 999,999 บาทได้
 *    กติกาเดียวกับชั่วโมงโอทีและจำนวนวันลา (round33) คือฐานข้อมูลต้องตรวจเอง
 *
 * 3) ไฟล์แนบ — แนบเข้าใบของคนอื่นได้ และพาธย้อนขึ้นไปได้
 *    นโยบายเดิมตรวจแค่ว่า uploaded_by เป็นตัวเอง ไม่ได้ดูว่าใบนั้นเป็นของใคร
 *    และไม่ได้ตรวจรูปพาธ จึงใส่ ../../ ลงไปได้
 */

-- ── 1. ค่าจ้างพนักงานทดลองงาน ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.payroll_lines(p_month text, p_commission jsonb DEFAULT '{}'::jsonb, p_absent jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(employee_id uuid, emp_no text, name text, pos_key text, pay_group text, base numeric, ot numeric, com numeric, inc numeric, allow numeric, adj numeric, ss numeric, late_min integer, late numeric, absent_days numeric, absent numeric, unpaid_days numeric, unpaid numeric, gross numeric, reimb numeric, net numeric, days numeric, rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  /* FIX-1: วันที่มาทำงานจริง (มีตอกบัตรเข้า) — คนจ่ายรายวันได้ค่าจ้างเฉพาะวันที่มา
     ตามคำตอบฝ่ายบุคคล "จ่ายเฉพาะวันที่มางานเท่านั้น" */
  att as (
    select p.employee_id as id, count(distinct p.work_date)::numeric as n
      from public.punches p
      join emp e on e.id = p.employee_id
     where p.type = 'in'
       and p.work_date between greatest(c_from, e.started_at) and least(c_to, v_today, coalesce(e.left_at, c_to))
       /* นับเฉพาะวันทำการ — มาทำงานวันหยุดได้ค่าล่วงเวลาอย่างเดียว ไม่ได้ค่าแรงรายวันอีกต่อ
          (ฝ่ายบุคคลตอบ 19 พ.ย. 2569 "ทำวันหยุดได้แค่ ot") */
       and exists (select 1 from public.workdays_in(c_from, c_to) w where w = p.work_date)
     group by p.employee_id
  ),
  /* ลาไม่เต็มวัน (ลาเป็นชั่วโมง/ครึ่งวัน) — หักเป็นสัดส่วนของวัน (ข้อ 3.1)
     หักได้เฉพาะวันที่นับเป็นวันทำงานของคนนี้จริง คือเป็นวันทำการ อยู่ในช่วงที่ยังทำงานอยู่
     และมีตอกบัตรเข้าในวันนั้น ไม่งั้นจะหักซ้ำวันที่ไม่ได้ค่าจ้างอยู่แล้ว */
  lvp as (
    select l.employee_id as id, sum(l.days) as days
      from public.leave_requests l
      join emp e on e.id = l.employee_id
     where l.status = 'approved' and l.days < 1
       and l.from_date between greatest(c_from, e.started_at)
                           and least(c_to, v_today, coalesce(e.left_at, c_to))
       and exists (select 1 from public.workdays_in(c_from, c_to) w where w = l.from_date)
       and exists (select 1 from public.punches p
                    where p.employee_id = l.employee_id and p.type = 'in'
                      and p.work_date = l.from_date)
     group by l.employee_id
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
  left join att      on att.id = e.id
  left join lvp      on lvp.id = e.id
  left join lv       on lv.id = e.id
  left join ot_sum   on ot_sum.id = e.id
  left join late_sum on late_sum.id = e.id
  left join ex       on ex.id = e.id
  left join adjs     on adjs.id = e.id
  left join rb       on rb.id = e.id
  cross join lateral (
    select
      round(case when e.daily then greatest(0, coalesce(att.n, 0) - coalesce(lvp.days, 0))
                 else coalesce(wdays.n, 0) - coalesce(lv.days, 0) end, 2) as worked,
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
                              /* FIX-3: มาสายคิดจากค่าแรงต่อวัน = ฐาน / 22 ทั้งรายวันและรายเดือน
                                 ตามตัวอย่างฝ่ายบุคคล (15,000 → 681.82 บาท/วัน) */
                              else b.day_rate / nullif(v_hours, 0) / 60.0 end, 2) as late,
      round(m.absent_days * (case when e.daily then b.day_rate else b.per_day end), 2) as absent,
      round(m.unpaid_days * (case when e.daily then b.day_rate else b.per_day end), 2) as unpaid,
      round(m.base + m.ot + m.com + m.inc + m.allow + m.adj, 2) as gross
  ) calc0
  cross join lateral (
    select calc0.*,
           round(calc0.gross - calc0.ss - calc0.late - calc0.absent - calc0.unpaid + calc0.reimb, 2) as net
  ) calc
  order by e.emp_no;
end $function$;

-- ── 2. เพดานใบเบิกค่าใช้จ่าย ───────────────────────────────────
/* เพดานอ่านจากตั้งค่าระบบ ไม่ใช่ค่าตายตัว — ผู้ดูแลเปลี่ยนได้ที่หน้าตั้งค่า */
create or replace function public.guard_expense_fuel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max numeric := public.pay_num(array['rates', 'fuelKmMax'], 500);
begin
  if new.km is null or new.km < 0 then
    raise exception 'bad_km';
  end if;
  if v_max > 0 and new.km > v_max then
    raise exception 'km_over_max';
  end if;
  return new;
end $$;

create or replace function public.guard_expense_other() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max numeric := public.pay_num(array['rates', 'expenseItemMax'], 50000);
begin
  if new.amount is null or new.amount < 0 then
    raise exception 'bad_amount';
  end if;
  if v_max > 0 and new.amount > v_max then
    raise exception 'amount_over_max';
  end if;
  return new;
end $$;

revoke all on function public.guard_expense_fuel() from public, anon, authenticated;
revoke all on function public.guard_expense_other() from public, anon, authenticated;

drop trigger if exists expense_fuel_guard on public.expense_fuel_rows;
create trigger expense_fuel_guard before insert or update on public.expense_fuel_rows
  for each row execute function public.guard_expense_fuel();

drop trigger if exists expense_other_guard on public.expense_other_rows;
create trigger expense_other_guard before insert or update on public.expense_other_rows
  for each row execute function public.guard_expense_other();

-- ── 3. ไฟล์แนบต้องเป็นใบของตัวเอง และพาธต้องตรงรูป ─────────────
/*
 * หน้าจออัปโหลดด้วยพาธ <ชนิด>/<รหัสใบ>/<เวลา>-<ชื่อไฟล์> อยู่แล้ว (files.ts)
 * จึงบังคับรูปนี้ได้ตรง ๆ และกัน ../ ไปด้วยในคราวเดียว
 */
drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments for insert to authenticated
with check (
  uploaded_by = public.my_employee_id()
  and path like (owner_kind || '/' || owner_id::text || '/%')
  and path not like '%..%'
  and (
    public.has_role('hr')
    or (owner_kind = 'employee' and owner_id = public.my_employee_id())
    or (owner_kind = 'leave' and exists (
          select 1 from public.leave_requests r
           where r.id = owner_id and r.employee_id = public.my_employee_id()))
    or (owner_kind = 'ot' and exists (
          select 1 from public.ot_requests o
           where o.id = owner_id and o.employee_id = public.my_employee_id()))
    or (owner_kind = 'expense' and exists (
          select 1 from public.expense_claims c
           where c.id = owner_id and c.employee_id = public.my_employee_id()))
  )
);
