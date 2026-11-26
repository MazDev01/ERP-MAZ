/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 127 · แจ้งทำงานที่บ้านช่วงฉุกเฉิน (ฝ่ายบุคคลยืนยัน 25 พ.ย. 2569)

   ไฟดับ เน็ตล่ม น้ำท่วม — พนักงาน "กดแจ้ง" ในระบบ ไม่ต้องรออนุมัติ
   (ข้อกำหนดไม่ได้เขียนไว้ เป็นคำตอบของฝ่ายบุคคล)

   วันที่แจ้งไว้ต้องไม่ขึ้นเป็น "ขาดบันทึก" ให้ฝ่ายบุคคลตามอีก
   แต่ยังเห็นในตารางเวลาว่าเป็นวันทำงานที่บ้าน พร้อมเหตุผล
   ═══════════════════════════════════════════════════════════════════ */

create table if not exists public.wfh_notices (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  on_date     date not null,
  reason      text not null default '',
  note        text not null default '',
  at          timestamptz not null default now(),
  created_by  uuid,
  unique (employee_id, on_date)
);

comment on table public.wfh_notices is 'แจ้งทำงานที่บ้านช่วงฉุกเฉิน — ไม่ต้องอนุมัติ';

alter table public.wfh_notices enable row level security;

/* เห็นของตัวเอง · ฝ่ายบุคคลกับผู้บริหารเห็นทุกคน (ใช้ตรวจตอนปิดรอบเวลา) */
drop policy if exists wfh_read on public.wfh_notices;
create policy wfh_read on public.wfh_notices for select to authenticated
  using (employee_id = public.my_employee_id()
         or public.has_role('hr') or public.has_role('ceo') or public.has_role('gm'));

/* เขียนผ่านฟังก์ชันเท่านั้น (ฟังก์ชันรันด้วยสิทธิ์เจ้าของ) ฝ่ายบุคคลแก้ย้อนหลังได้ */
drop policy if exists wfh_write on public.wfh_notices;
create policy wfh_write on public.wfh_notices for insert to authenticated
  with check (public.has_role('hr'));
drop policy if exists wfh_del on public.wfh_notices;
create policy wfh_del on public.wfh_notices for delete to authenticated
  using (public.has_role('hr'));

grant select, insert, delete on public.wfh_notices to authenticated;

/**
 * พนักงานกดแจ้งเอง — ได้เฉพาะวันนี้กับเมื่อวาน (เหตุฉุกเฉินแจ้งย้อนหลังข้ามสัปดาห์ไม่ได้)
 * แจ้งซ้ำวันเดิมถือเป็นการแก้เหตุผล ไม่ใช่ใบใหม่
 */
create or replace function public.wfh_notice(p_date date, p_reason text, p_note text default '')
  returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp   uuid := public.my_employee_id();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_row   record;
begin
  if v_emp is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  if p_date is null or p_date > v_today or p_date < v_today - 1 then
    return jsonb_build_object('ok', false, 'reason', 'bad_date');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  insert into public.wfh_notices (employee_id, on_date, reason, note, created_by)
  values (v_emp, p_date, btrim(p_reason), coalesce(btrim(p_note), ''), auth.uid())
  on conflict (employee_id, on_date)
    do update set reason = excluded.reason, note = excluded.note, at = now()
  returning * into v_row;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'wfh_notice', v_row.id,
          jsonb_build_object('date', p_date, 'reason', btrim(p_reason)));

  return jsonb_build_object('ok', true, 'id', v_row.id, 'date', v_row.on_date);
end $$;

/** ถอนที่แจ้งไว้ — ได้เฉพาะของตัวเองและวันที่ยังแจ้งได้ */
create or replace function public.wfh_cancel(p_date date) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp   uuid := public.my_employee_id();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_n     int;
begin
  if v_emp is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  if p_date is null or p_date > v_today or p_date < v_today - 1 then
    return jsonb_build_object('ok', false, 'reason', 'bad_date');
  end if;
  delete from public.wfh_notices where employee_id = v_emp and on_date = p_date;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0, 'reason', case when v_n > 0 then null else 'not_found' end);
end $$;

grant execute on function public.wfh_notice(date, text, text), public.wfh_cancel(date) to authenticated;

/* เหตุผลที่เลือกได้ — เก็บเป็นตัวเลือกในค่าตั้งค่า ผู้ดูแลเพิ่มได้ ไม่ใช่ค่าคงที่ */
update public.system_settings
   set data = jsonb_set(data, '{options,wfh}',
                        coalesce(data -> 'options' -> 'wfh',
                                 '["ไฟดับ","อินเทอร์เน็ตล่ม","น้ำท่วม","เหตุสุดวิสัยอื่น ๆ"]'::jsonb), true)
 where data ? 'options';

notify pgrst, 'reload schema';
