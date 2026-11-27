/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 136 · ตัวเลขประสิทธิภาพพนักงานสำหรับผู้จัดการทั่วไป
   (ยกหน้ามาจาก ERP_Test · เจ้าของตัดสินไว้ 26 ต.ค. 2569)

   วัดแยกกันสองเรื่อง ไม่มีคะแนนรวม และไม่เทียบข้ามตำแหน่ง
     ก. งาน — ใบงานที่ครบกำหนดในช่วง ส่งรอบแรกทันกำหนดไหม
        ใบที่รอลูกค้าตรวจอยู่ ไม่นับเป็นความช้าของคนทำ
     ข. การเข้างาน — ตอกบัตรเข้าทันเวลาของคนนั้นกี่วันจากวันที่มาทำงาน

   สำคัญ: ผู้จัดการทั่วไปไม่มีสิทธิ์อ่านตารางตอกบัตรของคนอื่น (กติกาเดิมของระบบ)
   จึงคืนเป็น "ยอดรวมรายคน" ผ่านฟังก์ชันนี้เท่านั้น ไม่เปิดเวลาตอกบัตรรายใบให้
   ═══════════════════════════════════════════════════════════════════ */

/** ใครดูตัวเลขประสิทธิภาพได้ — ผู้จัดการทั่วไป ผู้บริหาร และฝ่ายบุคคล */
create or replace function public.can_see_perf() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role('gm') or public.has_role('ceo') or public.has_role('hr')
$$;

grant execute on function public.can_see_perf() to authenticated;

/**
 * การเข้างานรายคนในช่วง
 *   days    วันที่มาทำงานจริง (มีใบตอกเข้า)
 *   on_time เข้างานไม่เกินเวลาเริ่มงาน + เวลาผ่อนผันของตำแหน่งนั้น
 *   late    เข้าสายกว่านั้น
 *   avg_in  เวลาเข้าเฉลี่ยเป็นนาทีของวัน (ใช้บอกแนวโน้ม ไม่ใช่เวลาของวันใดวันหนึ่ง)
 */
/* ส่งกลับเป็นรหัสพนักงาน (emp_no) เพราะหน้าเว็บทั้งระบบอ้างคนด้วยรหัสนี้ ไม่ใช่ uuid ของแถว */
drop function if exists public.perf_attendance(date, date);
create function public.perf_attendance(p_from date, p_to date)
  returns table (emp_no text, days int, on_time int, late int, avg_in numeric)
language sql stable security definer set search_path = ''
as $$
  with first_in as (
    select p.employee_id, p.work_date,
           min(p.at) as in_at
      from public.punches p
     where p.type = 'in'
       and p.work_date between p_from and p_to
     group by p.employee_id, p.work_date
  ),
  calc as (
    select e.emp_no,
           (extract(hour from f.in_at at time zone 'Asia/Bangkok') * 60
            + extract(minute from f.in_at at time zone 'Asia/Bangkok'))::int as in_min,
           h.start_min + h.grace_min as limit_min
      from first_in f
      join public.employees e on e.id = f.employee_id
      cross join lateral public.hours_of(e.position) h
  )
  select c.emp_no,
         count(*)::int,
         count(*) filter (where c.in_min <= c.limit_min)::int,
         count(*) filter (where c.in_min > c.limit_min)::int,
         round(avg(c.in_min), 0)
    from calc c
   where public.can_see_perf()
   group by c.emp_no
$$;

grant execute on function public.perf_attendance(date, date) to authenticated;

/**
 * งานรายคนในช่วง — นับจากใบงานที่ "ครบกำหนด" ในช่วงนั้น
 *   done_on  ส่งรอบแรกทันกำหนด
 *   done_late ส่งแล้วแต่เลยกำหนด
 *   waiting  ยังไม่ได้ส่งและยังไม่เลยกำหนด หรือรอลูกค้าตรวจอยู่ (ไม่ใช่ความช้าของคนทำ)
 *   overdue  เลยกำหนดแล้วยังไม่ส่ง
 * ผู้ถืองานเก็บเป็นรหัสพนักงานในช่อง whos ของใบงาน จึงจับคู่กับทะเบียนด้วย emp_no
 */
drop function if exists public.perf_tasks(date, date);
create function public.perf_tasks(p_from date, p_to date)
  returns table (emp_no text, total int, done_on int, done_late int, waiting int, overdue int)
language sql stable security definer set search_path = ''
as $$
  with rows as (
    select e.emp_no,
           t.status,
           t.due,
           (select min((s->>'at')::timestamp) from jsonb_array_elements(t.subs) s) as first_sub
      from public.project_tasks t
      join public.projects pj on pj.id = t.project_id
      cross join lateral unnest(t.whos) as w(emp_no)
      join public.employees e on e.emp_no = w.emp_no
     where t.due between p_from and p_to
       and pj.status <> 'cancelled'
  )
  select r.emp_no,
         count(*)::int,
         count(*) filter (where r.first_sub is not null and r.first_sub::date <= r.due)::int,
         count(*) filter (where r.first_sub is not null and r.first_sub::date > r.due)::int,
         count(*) filter (where r.first_sub is null and (r.status = 'wait' or r.due >= (now() at time zone 'Asia/Bangkok')::date))::int,
         count(*) filter (where r.first_sub is null and r.status <> 'wait' and r.due < (now() at time zone 'Asia/Bangkok')::date)::int
    from rows r
   where public.can_see_perf()
   group by r.emp_no
$$;

grant execute on function public.perf_tasks(date, date) to authenticated;

notify pgrst, 'reload schema';
