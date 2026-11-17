-- ─── ฝ่ายบุคคลแก้ตัวเลขเวลาได้ และมีร่องรอยว่าแก้อะไร ─────────────
/*
 * มีสองเรื่องที่ฝ่ายบุคคลต้องแก้ได้จริง แต่ยังไม่มีที่เก็บ
 *   นาทีมาสาย   พนักงานมาตรงเวลาแต่กดช้าเพราะแบตหมด/เน็ตล่ม ระบบนับว่าสาย
 *   ชั่วโมงโอที  เวลาที่อนุมัติไว้ไม่ตรงกับที่ทำจริง
 * ของเดิมแก้ได้แต่ค้างอยู่ในเครื่องที่เปิดหน้าอยู่ ซึ่งเท่ากับไม่ได้แก้
 *
 * เก็บเป็น "รายการแก้" ไม่ใช่ทับค่าเดิม — ต้องเห็นว่าเครื่องบันทึกมาเท่าไร
 * และใครแก้เป็นเท่าไร เพราะตัวเลขพวกนี้แปลงเป็นเงินโดยตรง
 */
create table if not exists public.time_edits (
  employee_id uuid not null references public.employees (id) on delete cascade,
  on_date     date not null,
  kind        text not null check (kind in ('late', 'ot')),
  /* ค่าที่ฝ่ายบุคคลตั้ง — นาที (late) หรือชั่วโมง (ot) */
  value       numeric(6,2) not null check (value >= 0),
  /* ค่าที่ระบบคำนวณได้ก่อนแก้ ครั้งแรกที่แก้เท่านั้น */
  was         numeric(6,2),
  why         text not null check (length(trim(why)) > 0),
  edited_by   uuid references public.employees (id),
  edited_at   timestamptz not null default now(),
  primary key (employee_id, on_date, kind)
);

alter table public.time_edits enable row level security;
grant select, insert, update, delete on public.time_edits to authenticated;

create policy edits_read on public.time_edits for select to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr') or public.has_role('ceo'));
create policy edits_write on public.time_edits for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

/*
 * เติมเวลาที่ขาดให้พนักงาน (ลืมกดเข้า/ออก)
 * ใช้ hr_add_punch ที่มีอยู่แล้ว แต่ของเดิมรับเวลาเป็น timestamptz ตรง ๆ
 * ตัวนี้รับ "วันที่ + เวลานาฬิกาไทย" ซึ่งเป็นรูปที่หน้าจอมีอยู่ และกันกรอกเวลาอนาคต
 */
create or replace function public.hr_fill_punch(
  p_employee uuid,
  p_type     text,
  p_date     date,
  p_time     text,
  p_why      text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_at timestamptz;
begin
  if p_time !~ '^\d{2}:\d{2}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_time');
  end if;
  v_at := ((p_date::text || ' ' || p_time || ':00') at time zone 'Asia/Bangkok');
  return public.hr_add_punch(p_employee, p_type, v_at, p_why);
end $$;

grant execute on function public.hr_fill_punch(uuid, text, date, text, text) to authenticated;
