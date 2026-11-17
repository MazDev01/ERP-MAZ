-- ─── ทริกเกอร์กันสายอนุมัติปลอม และกันใบซ้อนกัน ──────────────────
/*
 * ฟังก์ชันและทริกเกอร์ชุดนี้ถูกสร้างไว้บนฐานข้อมูลจริงตั้งแต่รอบก่อน แต่ไม่เคยเข้าไฟล์
 * migration (รอบที่ 21 เก็บไปแค่ route_of) ฐานข้อมูลที่สร้างใหม่จากไฟล์จึงไม่มีทริกเกอร์
 * และผู้ยื่นจะกำหนดเองได้ว่าใบของตัวเองไปหาใคร — ผู้ตรวจสอบรายงาน 17 พ.ย. 2569
 *
 * หน้าที่ของทริกเกอร์
 *   ตั้ง approver_role จาก approval_routes เสมอ ไม่สนว่าหน้าเว็บส่งอะไรมา
 *   กันใบลา/ใบโอทีที่ช่วงวัน–ช่วงเวลาซ้อนกับใบที่ยังรอหรืออนุมัติแล้ว
 */
create or replace function public.guard_leave_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_route text := public.route_of('leave', new.employee_id);
begin
  if v_route is null then
    raise exception 'no_route' using errcode = 'P0001',
      hint = 'ยังไม่ได้ตั้งสายอนุมัติการลาของตำแหน่งนี้ — แจ้งฝ่ายบุคคล';
  end if;
  new.approver_role := v_route;

  perform pg_advisory_xact_lock(hashtext('leave:' || new.employee_id::text));

  /* ช่วงวันซ้อนกับใบที่ยังรอหรืออนุมัติแล้ว
     ลาครึ่งวันเช้ากับครึ่งวันบ่ายของวันเดียวกันไม่ถือว่าซ้อน */
  if exists (
    select 1 from public.leave_requests l
     where l.employee_id = new.employee_id
       and l.status in ('pending', 'approved')
       and l.from_date <= new.to_date
       and l.to_date >= new.from_date
       and (l.half is null or new.half is null or l.half = new.half)
  ) then
    raise exception 'leave_overlap' using errcode = 'P0001',
      hint = 'มีใบลาของช่วงวันนี้อยู่แล้ว';
  end if;
  return new;
end $function$
;

create or replace function public.guard_ot_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_route text := public.route_of('ot', new.employee_id);
  v_end   int  := case when new.end_min <= new.start_min then new.end_min + 1440 else new.end_min end;
begin
  if v_route is null then
    raise exception 'no_route' using errcode = 'P0001',
      hint = 'ยังไม่ได้ตั้งสายอนุมัติโอทีของตำแหน่งนี้ — แจ้งฝ่ายบุคคล';
  end if;
  new.approver_role := v_route;

  /* กดรัวสองแท็บพร้อมกันต้องเห็นกันและกัน */
  perform pg_advisory_xact_lock(hashtext('ot:' || new.employee_id::text || ':' || new.work_date::text));

  /* ช่วงเวลาซ้อนกับใบที่ยังรอหรืออนุมัติแล้วในวันเดียวกัน — ข้ามเที่ยงคืนนับต่อเป็นนาทีที่เกิน 1440 */
  if exists (
    select 1 from public.ot_requests o
     where o.employee_id = new.employee_id
       and o.work_date = new.work_date
       and o.status in ('pending', 'approved')
       and o.start_min < v_end
       and (case when o.end_min <= o.start_min then o.end_min + 1440 else o.end_min end) > new.start_min
  ) then
    raise exception 'ot_overlap' using errcode = 'P0001',
      hint = 'มีใบโอทีของช่วงเวลานี้อยู่แล้ว';
  end if;
  return new;
end $function$
;

drop trigger if exists leave_guard on public.leave_requests;
create trigger leave_guard before insert on public.leave_requests
  for each row execute function public.guard_leave_request();

drop trigger if exists ot_guard on public.ot_requests;
create trigger ot_guard before insert on public.ot_requests
  for each row execute function public.guard_ot_request();
