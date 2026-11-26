/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 126 · กติกาวันลาที่ฝ่ายบุคคลยืนยัน 25 พ.ย. 2569

   1 ลาพักร้อน 6 วัน/ปี เริ่มหลังผ่านทดลองงาน แล้วเพิ่มปีละ 1 วัน
     ตามอายุงาน สูงสุด 10 วัน (ของเดิม 6 วันตายตัวตาม SRS — ยึดตามนี้)
   2 ลากิจ (รวมลาด่วน) กับลาพักร้อน ใช้สิทธิ์ร่วมกันเป็น "ก้อนเดียว"
     สิทธิ์ของก้อน = ผลรวมของทุกประเภทในก้อน · ใช้ประเภทไหนก็ตัดจากก้อนเดียวกัน
   ═══════════════════════════════════════════════════════════════════ */

alter table public.leave_types
  add column if not exists per_year    numeric(5,2) not null default 0,
  add column if not exists max_days    numeric(5,2),
  add column if not exists from_probat boolean      not null default false,
  add column if not exists pool        text;

comment on column public.leave_types.per_year is 'เพิ่มให้ปีละกี่วันตามอายุงาน · 0 = ไม่เพิ่ม';
comment on column public.leave_types.max_days is 'เพดานรวมเมื่อนับอายุงานแล้ว · ว่าง = ไม่มีเพดาน';
comment on column public.leave_types.from_probat is 'เริ่มมีสิทธิ์หลังผ่านทดลองงาน';
comment on column public.leave_types.pool is 'ชื่อก้อนสิทธิ์ที่ใช้ร่วมกัน · ว่าง = ก้อนของตัวเอง';

update public.leave_types
   set per_year = 1, max_days = 10, from_probat = true, pool = 'personal'
 where code = 'ลาพักร้อน';
update public.leave_types set pool = 'personal' where code = 'ลากิจ';

/** ประเภทที่อยู่ก้อนเดียวกับประเภทนี้ (รวมตัวมันเอง) */
create or replace function public.leave_pool_types(p_type text)
  returns setof text
language sql stable security definer set search_path = ''
as $$
  select t.code from public.leave_types t
   where t.code = p_type
      or (t.pool is not null
          and t.pool = (select x.pool from public.leave_types x where x.code = p_type))
$$;

/** เดือนทดลองงานจากค่าตั้งค่า — ไม่เขียนเป็นค่าคงที่ */
create or replace function public.probation_months() returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((select (s.data -> 'rates' ->> 'probationMonths')::int
                     from public.system_settings s order by s.updated_at desc limit 1), 3)
$$;

/**
 * สิทธิ์วันลาของคนนั้นในประเภทนั้นของปีนั้น
 *   ฝ่ายบุคคลตั้งเฉพาะคนไว้ (leave_entitlements) → ใช้ของคนนั้น
 *   ไม่ได้ตั้ง → วันตั้งต้นของประเภท + เพิ่มตามอายุงาน (ไม่เกินเพดาน)
 *   ประเภทที่เริ่มหลังผ่านทดลองงาน — ยังไม่พ้นทดลองงานได้ 0 วัน
 */
create or replace function public.leave_quota(p_employee uuid, p_type text, p_year_be int)
  returns numeric
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_t      record;
  v_own    numeric;
  v_start  date;
  v_ok_at  date;
  v_end    date := make_date(p_year_be - 543, 12, 31);
  v_years  int;
  v_days   numeric;
begin
  select * into v_t from public.leave_types where code = p_type;
  if v_t.code is null then
    return null;
  end if;

  select days into v_own from public.leave_entitlements
   where employee_id = p_employee and leave_type = p_type and year_be = p_year_be;
  if v_own is not null then
    return v_own;
  end if;

  v_days := coalesce(v_t.default_days, 0);
  select started_at into v_start from public.employees where id = p_employee;
  if v_start is null then
    return v_days;
  end if;

  /* วันที่พ้นทดลองงาน = วันเริ่มงาน + เดือนทดลองงาน */
  v_ok_at := v_start + (public.probation_months() || ' months')::interval;
  if v_t.from_probat and v_ok_at > v_end then
    return 0;
  end if;

  if coalesce(v_t.per_year, 0) > 0 then
    /* อายุงานครบปีที่เท่าไรเมื่อสิ้นรอบปีนั้น — ปีแรกได้วันตั้งต้น */
    /* วันที่ลบวันที่ได้จำนวนวันเป็นจำนวนเต็ม ไม่ใช่ช่วงเวลา */
    v_years := greatest(0, floor((v_end - coalesce(v_ok_at, v_start))::numeric / 365.25)::int);
    v_days := v_days + v_years * v_t.per_year;
    if v_t.max_days is not null then
      v_days := least(v_days, v_t.max_days);
    end if;
  end if;
  return v_days;
end $$;

grant execute on function public.leave_pool_types(text), public.probation_months(),
  public.leave_quota(uuid, text, int) to authenticated;

/* ── คงเหลือ: คิดเป็นก้อน ───────────────────────────────────────────
   ใช้ลากิจไป 2 วัน สิทธิ์พักร้อนก็เหลือน้อยลงด้วย เพราะเป็นก้อนเดียวกัน */
create or replace function public.leave_balance(p_employee uuid, p_type text, p_year_be integer)
  returns numeric
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_quota numeric := 0;
  v_used  numeric := 0;
  v_any   boolean := false;
  v_code  text;
  v_q     numeric;
begin
  for v_code in select * from public.leave_pool_types(p_type) loop
    v_q := public.leave_quota(p_employee, v_code, p_year_be);
    if v_q is not null then
      v_any := true;
      v_quota := v_quota + v_q;
    end if;
  end loop;
  if not v_any then
    return null;
  end if;

  select coalesce(sum(l.days), 0) into v_used
    from public.leave_requests l
   where l.employee_id = p_employee
     and l.leave_type in (select * from public.leave_pool_types(p_type))
     and l.status = 'approved'
     and extract(year from l.from_date)::int + 543 = p_year_be;

  return v_quota - v_used;
end $$;

grant execute on function public.leave_balance(uuid, text, integer) to authenticated;

/* ── ส่วนที่เกินสิทธิ์ (ใช้หักเงินเดือน) — คิดเป็นก้อนเช่นกัน ────── */
create or replace function public.leave_over_in(p_from date, p_to date)
  returns table(employee_id uuid, days numeric)
language sql stable security definer set search_path = ''
as $$
  with req as (
    select l.id, l.employee_id, l.leave_type, l.from_date, l.days,
           coalesce(t.pool, l.leave_type) as pool,
           extract(year from l.from_date)::int + 543 as year_be
      from public.leave_requests l
      join public.leave_types t on t.code = l.leave_type
     where l.status = 'approved'
       and t.paid = true
  ),
  cum as (
    select r.*,
           sum(r.days) over (
             partition by r.employee_id, r.pool, r.year_be
             order by r.from_date, r.id
             rows between unbounded preceding and current row
           ) as used
      from req r
  ),
  q as (
    select c.*,
           (select coalesce(sum(public.leave_quota(c.employee_id, k, c.year_be)), 0)
              from public.leave_pool_types(c.leave_type) k) as quota
      from cum c
  )
  select q.employee_id,
         sum(least(q.days, greatest(0, q.used - q.quota))) as days
    from q
   where q.from_date between p_from and p_to
   group by q.employee_id
  having sum(least(q.days, greatest(0, q.used - q.quota))) > 0
$$;

grant execute on function public.leave_over_in(date, date) to authenticated;

/* ── ค่าตั้งค่าที่หน้าเว็บอ่าน ต้องมีกติกาเดียวกัน ───────────────────
   หน้าเว็บคิดสิทธิ์จาก settings().leave ถ้าแถวค่าตั้งค่ายังเป็นของเก่า
   ตัวเลขบนจอจะไม่ตรงกับที่ฐานข้อมูลหักเงินเดือน */
update public.system_settings s
   set data = jsonb_set(
         s.data,
         '{leave}',
         (select jsonb_agg(
                   case
                     when q ->> 'type' = 'ลาพักร้อน'
                       then q || jsonb_build_object('perYear', 1, 'maxDays', 10,
                                                    'fromProbat', true, 'pool', 'personal')
                     when q ->> 'type' = 'ลากิจ'
                       then q || jsonb_build_object('pool', 'personal')
                     else q
                   end order by i)
            from jsonb_array_elements(s.data -> 'leave') with ordinality as t(q, i)),
         true)
 where s.data ? 'leave';

notify pgrst, 'reload schema';
