-- เวลาที่ประกอบจากข้อความต้องแปลงเป็น timestamp ก่อนเทียบเขตเวลา
-- (search_path ว่าง จึงไม่มีการแปลงชนิดให้อัตโนมัติ — ฟ้องว่า timezone(unknown, text) ไม่มี)
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
  v_at := (p_date::text || ' ' || p_time || ':00')::timestamp at time zone 'Asia/Bangkok';
  return public.hr_add_punch(p_employee, p_type, v_at, p_why);
end $$;
