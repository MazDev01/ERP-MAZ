-- ─── จำนวนชั่วโมงโอทีและจำนวนวันลา ต้องคิดจากฐานข้อมูลเอง ────────
/*
 * ที่ผ่านมา ot_requests.hours และ leave_requests.days มาจากหน้าจอล้วน ๆ
 * ฐานข้อมูลตรวจแค่ว่า "มากกว่าศูนย์" เท่านั้น
 *
 * ยิงทดสอบ 18 พ.ย. 2569 แล้วพบว่า ยื่นโอที 0:00–23:59 แต่ใส่ 99 ชั่วโมง ผ่านเข้าระบบได้
 * ชั่วโมงนี้เดินต่อไปถึงหน้าอนุมัติและเงินเดือน (ค่าโอที = ชั่วโมง × เรต)
 * ใบลาก็เช่นกัน — ลาวันเดียวแต่กรอก 99 วัน ตัดสิทธิ์วันลาเกินจริง
 *
 * ที่นี่ให้ฐานข้อมูลคิดเองเหมือนที่ทำกับสายอนุมัติ (approver_role)
 *   โอที  — ชั่วโมง = (เวลาเลิก − เวลาเริ่ม)/60 ข้ามเที่ยงคืนบวก 24 ชม. และต้องไม่เกิน 24 ชม.
 *   ใบลา  — จำนวนวันต้องไม่เกินจำนวนวันตามปฏิทินของช่วงที่ขอ และต้องมากกว่าศูนย์
 *            (ครึ่งวัน 0.5 และลาเป็นชั่วโมงยังทำได้ เพราะเป็นค่าที่น้อยกว่าอยู่แล้ว)
 */
create or replace function public.guard_ot_request()
 returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_route text := public.route_of('ot', new.employee_id);
  /* เลิกก่อนเริ่ม = งานข้ามเที่ยงคืน บวกไปอีกวัน · เลิกเท่ากับเริ่ม = ไม่มีช่วงเวลา (ไม่ใช่ 24 ชม.) */
  v_end   int  := case when new.end_min < new.start_min then new.end_min + 1440 else new.end_min end;
  v_hours numeric(5,2);
begin
  if v_route is null then
    raise exception 'no_route' using errcode = 'P0001',
      hint = 'ยังไม่ได้ตั้งสายอนุมัติโอทีของตำแหน่งนี้ — แจ้งฝ่ายบุคคล';
  end if;
  new.approver_role := v_route;

  /* ชั่วโมงคิดจากช่วงเวลาที่กรอก ไม่ใช่ตัวเลขที่หน้าจอส่งมา */
  v_hours := round((v_end - new.start_min)::numeric / 60, 2);
  if v_hours <= 0 or v_hours > 24 then
    raise exception 'bad_hours' using errcode = 'P0001',
      hint = 'ช่วงเวลาที่ขอโอทีไม่ถูกต้อง';
  end if;
  new.hours := v_hours;

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
end $function$;

create or replace function public.guard_leave_request()
 returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_route text := public.route_of('leave', new.employee_id);
  v_span  int;
begin
  if v_route is null then
    raise exception 'no_route' using errcode = 'P0001',
      hint = 'ยังไม่ได้ตั้งสายอนุมัติการลาของตำแหน่งนี้ — แจ้งฝ่ายบุคคล';
  end if;
  new.approver_role := v_route;

  if new.to_date < new.from_date then
    raise exception 'bad_range' using errcode = 'P0001', hint = 'วันสิ้นสุดอยู่ก่อนวันเริ่ม';
  end if;

  /* จำนวนวันต้องไม่เกินช่วงที่ขอจริง — ลาวันเดียวแต่กรอก 99 วันไม่ได้ */
  v_span := (new.to_date - new.from_date) + 1;
  if new.days <= 0 or new.days > v_span then
    raise exception 'bad_days' using errcode = 'P0001',
      hint = 'จำนวนวันลาไม่ตรงกับช่วงวันที่เลือก';
  end if;

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
end $function$;
