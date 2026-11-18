-- ─── ช่องของผู้อนุมัติ เจ้าของใบต้องแตะไม่ได้ ────────────────────
/*
 * ทริกเกอร์ล็อกการแก้ใบ (round24) กันเฉพาะช่องที่เป็น "คำขอ" เช่น วัน เวลา จำนวน
 * แต่ไม่ได้กันช่องที่เป็น "ผลการตัดสิน"
 *
 * ยิงทดสอบ 18 พ.ย. 2569 แล้วพบว่า เจ้าของใบโอทีตั้ง approved_hours ของตัวเองได้
 * ซึ่งเป็นชั่วโมงที่ใช้จ่ายเงินจริง (ค่าโอที = ชั่วโมงที่อนุมัติ × เรต)
 * ตั้งไว้ล่วงหน้าแล้วรอให้ผู้อนุมัติกดอนุมัติ ก็ได้เงินเกินจริงโดยผู้อนุมัติไม่ทันสังเกต
 *
 * ที่นี่ล็อกช่องของผู้อนุมัติทั้งหมดเมื่อคำสั่งมาจากเบราว์เซอร์ของผู้ใช้โดยตรง
 * (current_user = authenticated) · คำสั่งที่มาจาก decide_request / undo_decision
 * เป็น security definer จึงรันในสิทธิ์เจ้าของฐานข้อมูล ไม่ติดด่านนี้
 *
 * ทริกเกอร์สองตัวนี้ต้องไม่เป็น security definer เอง ไม่งั้น current_user
 * กลายเป็นเจ้าของฐานข้อมูลเสมอ แล้วด่านนี้ไม่ทำงานเลย (พลาดมาแล้วตอนเขียนรอบแรก)
 */
create or replace function public.lock_ot_edit()
 returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.employee_id is distinct from old.employee_id
     or new.work_date is distinct from old.work_date
     or new.start_min is distinct from old.start_min
     or new.end_min is distinct from old.end_min
     or new.hours is distinct from old.hours
     or new.approver_role is distinct from old.approver_role
     or new.no is distinct from old.no then
    raise exception 'locked' using errcode = 'P0001',
      hint = 'ใบขอโอทีที่ยื่นแล้วแก้ไม่ได้ — ยกเลิกแล้วยื่นใหม่';
  end if;

  if current_user in ('authenticated', 'anon')
     and (new.approved_hours is distinct from old.approved_hours
          or new.decided_by is distinct from old.decided_by
          or new.decided_at is distinct from old.decided_at
          or new.decision_note is distinct from old.decision_note
          or new.undone_at is distinct from old.undone_at
          or new.undone_why is distinct from old.undone_why
          or new.submitted_at is distinct from old.submitted_at
          or new.created_by is distinct from old.created_by
          or new.filed_by is distinct from old.filed_by) then
    raise exception 'not_yours' using errcode = 'P0001',
      hint = 'ช่องนี้เป็นของผู้อนุมัติ เจ้าของใบแก้ไม่ได้';
  end if;
  return new;
end $function$;

create or replace function public.lock_leave_edit()
 returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.employee_id is distinct from old.employee_id
     or new.leave_type is distinct from old.leave_type
     or new.from_date is distinct from old.from_date
     or new.to_date is distinct from old.to_date
     or new.days is distinct from old.days
     or new.half is distinct from old.half
     or new.start_min is distinct from old.start_min
     or new.end_min is distinct from old.end_min
     or new.hours is distinct from old.hours
     or new.approver_role is distinct from old.approver_role
     or new.no is distinct from old.no then
    raise exception 'locked' using errcode = 'P0001',
      hint = 'ใบลาที่ยื่นแล้วแก้ไม่ได้ — ยกเลิกแล้วยื่นใหม่';
  end if;

  if current_user in ('authenticated', 'anon')
     and (new.decided_by is distinct from old.decided_by
          or new.decided_at is distinct from old.decided_at
          or new.decision_note is distinct from old.decision_note
          or new.undone_at is distinct from old.undone_at
          or new.undone_why is distinct from old.undone_why
          or new.submitted_at is distinct from old.submitted_at
          or new.created_by is distinct from old.created_by
          or new.filed_by is distinct from old.filed_by) then
    raise exception 'not_yours' using errcode = 'P0001',
      hint = 'ช่องนี้เป็นของผู้อนุมัติ เจ้าของใบแก้ไม่ได้';
  end if;
  return new;
end $function$;
