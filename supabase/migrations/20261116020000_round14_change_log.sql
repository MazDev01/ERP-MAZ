-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ รอบที่ 14 — ประวัติการกระทำ บันทึกชื่อคนที่ทำได้ทุกบัญชี            ║
-- ╚══════════════════════════════════════════════════════════════════╝
/*
 * log_setting() เดิมดึงชื่อผู้ทำจากทะเบียนพนักงาน บัญชีที่ไม่ใช่พนักงาน (ผู้บริหาร)
 * จึงไม่มีชื่อติดไปกับประวัติ — ประวัติที่ไม่รู้ว่าใครทำก็ตรวจย้อนไม่ได้
 *
 * รับชื่อจากหน้าจอมาด้วย (คนที่ล็อกอินอยู่จริงตอนนั้น) ไม่มีค่อยถอยไปใช้ทะเบียน
 * ส่วนช่อง by ยังเป็นรหัสพนักงานจริงเหมือนเดิม — ชื่อซ้ำกันได้ รหัสไม่ซ้ำ
 */
create or replace function public.log_setting(
  p_area    text,
  p_detail  text,
  p_by_name text default ''
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me   uuid := public.my_employee_id();
  v_name text := nullif(trim(coalesce(p_by_name, '')), '');
begin
  if v_name is null then
    select trim(coalesce(nick, first_name)) into v_name from public.employees where id = v_me;
  end if;
  insert into public.setting_log (by, by_name, area, detail)
  values (v_me, coalesce(v_name, ''), p_area, p_detail);
end $$;

grant execute on function public.log_setting(text, text, text) to authenticated;

/* ทุกคนที่ล็อกอินลงประวัติได้ แต่ยังอ่านได้เฉพาะฝ่ายบุคคลกับผู้บริหารเหมือนเดิม
   (คำขออนุมัติที่ถูกย้อนก็ต้องลงประวัติ ซึ่งคนย้อนอาจเป็นหัวหน้าสายงาน ไม่ใช่ฝ่ายบุคคล) */
