/* รอบที่ 94 — ลาเกินสิทธิ์ยื่นได้ อนุมัติได้ และนับเป็นขาดงาน หักจากเงินเดือน
   (SRS 1.5: "ลาเกินสิทธิ์ยื่นได้แต่นับเป็นขาดงาน" · "แสดงสีแดง นับเป็นขาดงานและหักเงินเดือน"
    เงินเดือน: "หักลาเกินสิทธิ์จากการลาที่อนุมัติ")

   ของเดิม (รอบที่ 5 · 10 · 37) decide_request ตอบ over_quota แล้วไม่ยอมอนุมัติ
   ใบจึงค้างอยู่ตลอด ทั้งที่คนลาไปแล้วจริง และเงินเดือนไม่เคยหักส่วนที่เกิน
   ฝั่งหน้าเว็บเขียนไว้ตรงตาม SRS อยู่แล้ว (leave-store.ts: over = อนุมัติ − สิทธิ์
   และหน้าการลาขึ้นข้อความ "ลาเกินสิทธิ์ x วัน — ส่วนที่เกินถูกหักจากเงินเดือน")
   รอบนี้จึงแก้ฝั่งฐานข้อมูลให้ตรงกับที่หน้าจอบอกไว้ */

/* ── 1. วันลาที่เกินสิทธิ์ของแต่ละคนในช่วงที่กำหนด ───────────────────────────
   นับทีละใบตามลำดับวัน ใบที่ทำให้ยอดสะสมล้นสิทธิ์จะถูกนับเฉพาะส่วนที่ล้นออกมา
   เช่น สิทธิ์ลากิจ 3 วัน ใบแรก 2 วัน ใบสองอีก 2 วัน → ใบสองเกิน 1 วัน
   คิดแยกตามประเภทและปี พ.ศ. เพราะสิทธิ์ตั้งเป็นรายปีรายประเภท

   นับเฉพาะประเภทที่ "รับค่าจ้าง" — ลาไม่รับค่าจ้างถูกหักเต็มจำนวนอยู่แล้ว
   ในช่อง unpaid ของ payroll_lines ถ้านับซ้ำจะโดนหักสองต่อ */
create or replace function public.leave_over_in(p_from date, p_to date)
returns table (employee_id uuid, days numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with req as (
    select l.id, l.employee_id, l.leave_type, l.from_date, l.days,
           extract(year from l.from_date)::int + 543 as year_be
      from public.leave_requests l
      join public.leave_types t on t.code = l.leave_type
     where l.status = 'approved'
       and t.paid = true
  ),
  cum as (
    select r.*,
           sum(r.days) over (
             partition by r.employee_id, r.leave_type, r.year_be
             order by r.from_date, r.id
             rows between unbounded preceding and current row
           ) as used
      from req r
  ),
  q as (
    select c.*,
           coalesce(
             (select e.days from public.leave_entitlements e
               where e.employee_id = c.employee_id
                 and e.leave_type = c.leave_type
                 and e.year_be = c.year_be),
             (select t.default_days from public.leave_types t where t.code = c.leave_type)
           ) as quota
      from cum c
  )
  select q.employee_id, sum(least(q.days, q.used - q.quota))
    from q
   where q.quota is not null
     and q.used > q.quota
     and q.from_date between p_from and p_to
   group by q.employee_id
$$;

/* ตัวนี้เห็นวันลาของทุกคน จึงให้เรียกได้เฉพาะในสูตรเงินเดือน (ซึ่งเป็น security definer อยู่แล้ว)
   ไม่เปิดให้ผู้ใช้เรียกตรง ๆ ไม่งั้นพนักงานอ่านวันลาของคนอื่นได้ */
revoke all on function public.leave_over_in(date, date) from public, anon, authenticated;

/* ── 2. อนุมัติใบที่เกินสิทธิ์ได้ ─────────────────────────────────────────── */
create or replace function public.decide_request(
  p_kind text, p_id uuid, p_ok boolean, p_note text default '', p_hours numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := public.my_employee_id();
  v_roles text[] := public.my_roles();
  v_route text;
  v_owner uuid;
  v_asked numeric;
  v_note  text := coalesce(trim(p_note), '');
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
    select employee_id, approver_role, to_date
      into v_owner, v_route, v_when
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
    /* เดิมมีด่านกั้นไม่ให้อนุมัติเกินสิทธิ์ (รอบที่ 5) — เอาออกตาม SRS 1.5
       ลาเกินสิทธิ์อนุมัติได้ แล้วส่วนที่เกินไปนับเป็นขาดงานในสูตรเงินเดือนแทน */
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


/* ── 3. สูตรเงินเดือน — หักวันลาที่เกินสิทธิ์เป็นขาดงาน ─────────────────── */
create or replace function public.payroll_lines(p_month text, p_commission jsonb DEFAULT '{}'::jsonb, p_absent jsonb DEFAULT '{}'::jsonb)
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
  /* วันลาที่อนุมัติไปเกินสิทธิ์ในรอบนี้ — นับเป็นขาดงาน หักจากเงินเดือน (SRS 1.5)
     ส่วนที่ไม่เกินสิทธิ์ยังเป็นลาปกติ ไม่หักอะไร */
  lvover as (
    select o.employee_id as id, o.days
      from public.leave_over_in(c_from, c_to) o
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
  left join lvover   on lvover.id = e.id
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
      /* ขาดงานที่ฝ่ายบุคคลตรวจเจอ + วันลาที่อนุมัติเกินสิทธิ์ (SRS 1.5)
         วันที่มีใบลาอนุมัติแล้วไม่เคยถูกตั้งเป็นขาดงานในตัวตรวจเวลา จึงไม่นับซ้ำกัน
         คนจ่ายรายวันไม่ต้องหัก เพราะจ่ายเฉพาะวันที่มาตอกบัตรอยู่แล้ว */
      case when e.daily then 0
           else coalesce((p_absent ->> e.id::text)::numeric, 0) + coalesce(lvover.days, 0) end as absent_days,
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
end $function$
;
