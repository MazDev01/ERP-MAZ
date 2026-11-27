/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 148 · ลาแล้วแต่มีตอกบัตร — ฝ่ายบุคคลต้องยืนยันก่อนปิดรอบเวลา
   (ยกมาจาก ERP_Test · ผู้ใช้สั่ง 15 ต.ค. 2569)

   วันที่พนักงานลาและใบลาอนุมัติแล้ว แต่วันนั้นกลับมีใบตอกบัตร
   แปลว่าอย่างใดอย่างหนึ่งผิด — ลาแล้วมาทำงาน หรือลืมยกเลิกใบลา
   ถ้าปล่อยผ่าน รอบนั้นจะคิดเงินผิดทั้งสองทาง (หักวันลาเกิน หรือจ่ายวันที่ไม่ได้ทำงาน)

   กติกา
     ฝ่ายบุคคลเห็นรายการวันที่ชนกันของรอบนั้น แล้วกด "ยืนยัน" ทีละวันพร้อมเหตุผล
     ปิดรอบเวลาไม่ได้จนกว่าจะยืนยันครบ — ด่านอยู่ที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม
     ยืนยันแล้วลบไม่ได้ เก็บเป็นหลักฐานว่าใครยืนยันและด้วยเหตุผลอะไร
   ═══════════════════════════════════════════════════════════════════ */

create table if not exists public.leave_clash_ok (
  employee_id uuid not null references public.employees(id) on delete cascade,
  on_date     date not null,
  why         text not null,
  by_name     text not null default '',
  at          timestamptz not null default now(),
  primary key (employee_id, on_date)
);

comment on table public.leave_clash_ok is
  'วันที่ลาแล้วมีตอกบัตร ซึ่งฝ่ายบุคคลตรวจและยืนยันแล้ว — ปิดรอบเวลาได้เมื่อยืนยันครบ';

alter table public.leave_clash_ok enable row level security;

drop policy if exists leave_clash_ok_read on public.leave_clash_ok;
create policy leave_clash_ok_read on public.leave_clash_ok
  for select to authenticated using (public.has_role('hr') or public.has_role('ceo'));

grant select on public.leave_clash_ok to authenticated;

/**
 * จำนวนวันที่ชนกันและยังไม่ยืนยัน — ใช้กับด่านปิดรอบ
 * แยกจากตัวที่หน้าจอเรียก เพราะด่านทำงานตอนไหนก็ได้ (รวมถึงงานของระบบที่ไม่มีผู้ใช้)
 * ถ้าเอาด่านไปผูกกับฟังก์ชันที่กันสิทธิ์ไว้ จะนับได้ 0 เสมอแล้วปิดรอบหลุด
 */
create or replace function public.leave_clash_count(p_from date, p_to date) returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
    from public.leave_requests l
    cross join lateral generate_series(l.from_date, l.to_date, interval '1 day') d
   where l.status = 'approved'
     and d::date between p_from and p_to
     and exists (select 1 from public.punches p where p.employee_id = l.employee_id and p.work_date = d::date)
     and not exists (select 1 from public.leave_clash_ok k where k.employee_id = l.employee_id and k.on_date = d::date)
$$;

revoke all on function public.leave_clash_count(date, date) from public, anon;

/**
 * วันที่ "ลาแล้วแต่มีตอกบัตร" ในช่วงที่ขอ — เฉพาะที่ยังไม่ได้ยืนยัน
 * นับเฉพาะใบลาที่อนุมัติแล้ว และวันที่มีใบตอกบัตรอย่างน้อยหนึ่งใบ
 */
create or replace function public.leave_clashes(p_from date, p_to date)
  returns table (employee_id uuid, emp_no text, emp_name text, on_date date, leave_no text, leave_type text)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.emp_no, trim(e.first_name || ' ' || e.last_name), d::date, l.no, l.leave_type
    from public.leave_requests l
    join public.employees e on e.id = l.employee_id
    cross join lateral generate_series(l.from_date, l.to_date, interval '1 day') d
   where (public.has_role('hr') or public.has_role('ceo'))
     and l.status = 'approved'
     and d::date between p_from and p_to
     and exists (
       select 1 from public.punches p
        where p.employee_id = l.employee_id and p.work_date = d::date
     )
     and not exists (
       select 1 from public.leave_clash_ok k
        where k.employee_id = l.employee_id and k.on_date = d::date
     )
   order by d::date, e.emp_no
$$;

grant execute on function public.leave_clashes(date, date) to authenticated;

/** ฝ่ายบุคคลยืนยันวันที่ชนกันหนึ่งวัน — ต้องบอกเหตุผลเสมอ และยืนยันแล้วยกเลิกไม่ได้ */
create or replace function public.leave_clash_confirm(p_emp text, p_date date, p_why text)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_me text;
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if coalesce(trim(p_why), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_why');
  end if;
  select id into v_id from public.employees where emp_no = p_emp;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select trim(e.first_name || ' ' || e.last_name) into v_me
    from public.user_accounts a join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  insert into public.leave_clash_ok (employee_id, on_date, why, by_name)
  values (v_id, p_date, trim(p_why), coalesce(v_me, ''))
  on conflict (employee_id, on_date) do nothing;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.leave_clash_confirm(text, date, text) to authenticated;

/*
 * ด่านปิดรอบเวลา — ยังมีวันที่ลาแล้วมีตอกบัตรที่ยังไม่ยืนยัน ปิดไม่ได้
 * ของเดิมหน้าจอเป็นคนกันอย่างเดียว ซึ่งข้ามได้ด้วยการยิงคำสั่งตรง
 * ช่วงเดือนของรอบใช้ทั้งเดือนตามที่ตารางรอบเก็บไว้ (เดือน + กลุ่มการจ่าย)
 */
create or replace function public.period_clash_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_from date;
  v_to date;
  v_left int;
begin
  if not new.closed or old.closed then
    return new;
  end if;
  v_from := to_date(new.month || '-01', 'YYYY-MM-DD');
  v_to := (v_from + interval '1 month - 1 day')::date;
  v_left := public.leave_clash_count(v_from, v_to);
  if v_left > 0 then
    raise exception 'ยังมีวันลาที่มีตอกบัตรและยังไม่ได้ยืนยันอีก % วัน ปิดรอบเวลาไม่ได้', v_left
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists pay_periods_clash_guard on public.pay_periods;
create trigger pay_periods_clash_guard before update on public.pay_periods
  for each row execute function public.period_clash_guard();

notify pgrst, 'reload schema';
