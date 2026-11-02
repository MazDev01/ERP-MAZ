-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ รอบที่ 8 — ยื่นใบเบิกทั้งใบในครั้งเดียว และดึงใบกลับมาแก้          ║
-- ╚══════════════════════════════════════════════════════════════════╝
/*
 * ใบเบิกไม่เหมือนใบลากับใบโอที — เป็นเอกสารหลายแถว (ค่าน้ำมัน / ค่าใช้จ่ายอื่น /
 * รายรับ) ที่พนักงานกรอกทีละช่อง ถ้าเขียนขึ้นฐานข้อมูลทุกตัวอักษรที่พิมพ์
 * จะยิงคำขอเป็นร้อยครั้งต่อหนึ่งใบ จึงตกลงกันว่า
 *
 *   ใบร่าง  → อยู่ในเครื่องของผู้กรอก (เหมือนเดิม)
 *   กดยื่น  → ส่งขึ้นฐานข้อมูลทั้งใบในครั้งเดียวด้วย file_claim()
 *
 * ทำเป็นฟังก์ชันเดียวเพราะต้องเขียน 4 ตารางให้สำเร็จหรือล้มเหลวพร้อมกัน
 * ยิงทีละตารางจากหน้าเว็บแล้วเน็ตหลุดกลางทาง = ใบที่ไม่มีรายการ แต่มีเลขที่เอกสาร
 *
 * และรองรับ "ยื่นใหม่หลังถูกตีกลับ" ด้วย — ใบของเดือนนั้นมีได้ใบเดียว
 * (unique (employee_id, month)) การยื่นใหม่จึงเป็นการเขียนทับใบเดิมและใช้เลขเดิม
 * ไม่ใช่ออกเลขใหม่ ไม่งั้นเลขที่ใบเบิกจะกระโดดทุกครั้งที่หัวหน้าตีกลับ
 */
create function public.file_claim(
  p_month  text,
  p_plate  text default '',
  p_fuel   jsonb default '[]',
  p_other  jsonb default '[]',
  p_income jsonb default '[]'
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    uuid := public.my_employee_id();
  v_role  text;
  v_route text;
  v_id    uuid;
  v_now   text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  if p_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_month');
  end if;

  select position into v_role from public.employees where id = v_me;
  select approver_role into v_route from public.approval_routes
    where kind = 'expense' and from_role = v_role;
  if v_route is null then
    return jsonb_build_object('ok', false, 'reason', 'no_route');
  end if;

  /* คนเดียวกันกดยื่นรัว ๆ ต้องไม่ได้สองใบ */
  perform pg_advisory_xact_lock(hashtext('claim:' || v_me::text || ':' || p_month));

  select id into v_id from public.expense_claims
    where employee_id = v_me and month = p_month;

  /* ใบที่ยื่นแล้วหรืออนุมัติแล้วห้ามเขียนทับ — ตัวเลขที่ผู้อนุมัติเห็นต้องไม่เปลี่ยนหลังยื่น */
  if v_id is not null and exists (
    select 1 from public.expense_claims
     where id = v_id and status in ('pending', 'approved')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if v_id is null then
    insert into public.expense_claims (employee_id, month, status, plate, approver_role, filed_by)
    values (v_me, p_month, 'draft', coalesce(p_plate, ''), v_route, v_me)
    returning id into v_id;
  else
    update public.expense_claims
       set plate = coalesce(p_plate, ''), approver_role = v_route,
           decided_by = null, decided_at = null, decision_note = '',
           undone_at = null, undone_why = ''
     where id = v_id;
  end if;

  /* เขียนทับรายการทั้งชุด — ใบร่างที่ส่งมาคือความจริงล่าสุด */
  delete from public.expense_fuel_rows   where claim_id = v_id;
  delete from public.expense_other_rows  where claim_id = v_id;
  delete from public.expense_income_rows where claim_id = v_id;

  insert into public.expense_fuel_rows (claim_id, on_date, place, work, km, note, sort)
  select v_id,
         nullif(r->>'date', '')::date,
         coalesce(r->>'place', ''),
         coalesce(r->>'work', ''),
         nullif(r->>'km', '')::numeric,
         coalesce(r->>'note', ''),
         (i - 1)
    from jsonb_array_elements(coalesce(p_fuel, '[]')) with ordinality as t(r, i);

  insert into public.expense_other_rows (claim_id, on_date, kind, amount, note, sort)
  select v_id,
         nullif(r->>'date', '')::date,
         coalesce(r->>'kind', ''),
         nullif(r->>'amount', '')::numeric,
         coalesce(r->>'note', ''),
         (i - 1)
    from jsonb_array_elements(coalesce(p_other, '[]')) with ordinality as t(r, i);

  insert into public.expense_income_rows (claim_id, item, amount, deal_no, sort)
  select v_id,
         coalesce(r->>'item', ''),
         nullif(r->>'amount', '')::numeric,
         coalesce(r->>'dealNo', ''),
         (i - 1)
    from jsonb_array_elements(coalesce(p_income, '[]')) with ordinality as t(r, i);

  /* เลขที่ใบออกตอนนี้ (trigger claim_no) ใบที่มีเลขแล้วใช้เลขเดิม */
  update public.expense_claims set status = 'pending', submitted_at = now() where id = v_id;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'file_expense', v_id, jsonb_build_object('month', p_month));

  select no into v_now from public.expense_claims where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'no', v_now);
end $$;

/*
 * ดึงใบที่ยื่นไว้กลับมาแก้ — ได้เฉพาะใบของตัวเองที่หัวหน้ายังไม่ตัดสิน
 *
 * ใบกลับเป็นร่าง แต่ไม่ลบทิ้ง เพราะเลขที่ใบต้องเป็นเลขเดิมเมื่อยื่นใหม่
 * หน้าเว็บไม่อ่านใบร่างจากฐานข้อมูล (ร่างอยู่ในเครื่อง) แถวที่ค้างในฐานข้อมูล
 * จะถูกเขียนทับทั้งชุดตอน file_claim() ครั้งถัดไป
 */
create function public.withdraw_claim(p_month text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.my_employee_id();
  v_id uuid;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;

  select id into v_id from public.expense_claims
    where employee_id = v_me and month = p_month and status = 'pending' and paid_in is null;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  update public.expense_claims set status = 'draft', submitted_at = null where id = v_id;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'withdraw_expense', v_id, jsonb_build_object('month', p_month));

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.file_claim(text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.withdraw_claim(text) to authenticated;
