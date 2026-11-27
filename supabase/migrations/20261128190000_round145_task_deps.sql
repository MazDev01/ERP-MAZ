/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 145 · งานรอกันตามลำดับ และสถานะ "รอข้อมูล"
   (ยกมาจาก ERP_Test · แผนที่ระบบ 20 ต.ค. 2569 หัวข้อ 6 และ 8)

   สองเรื่องที่คนละแบบกัน
     ก. รองานก่อนหน้า — ใบงานบอกได้ว่า "เริ่มได้เมื่องานไหนผ่าน" (after เก็บชื่องานในโปรเจคเดียวกัน)
        สถานะนี้ไม่เก็บซ้ำ คิดจาก after ทุกครั้ง งานก่อนหน้าผ่านปุ๊บใบที่รออยู่เริ่มได้เอง
        ระหว่างรออยู่ ส่งงานไม่ได้ — กันไว้ที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม
     ข. รอข้อมูลที่คนทำกดเอง — รอนอกแผน เช่น รอลูกค้าส่งรูป รอไฟล์จากฝ่ายอื่น
        ไม่ล็อกการส่งงาน แต่เก็บไว้ว่ารอตั้งแต่เมื่อไรและรอเรื่องอะไร
        เวลาที่รอจะได้ไม่ถูกนับเป็นความช้าของคนทำ (ใช้กับตัวเลขประสิทธิภาพรอบที่ 136)

   "ผ่าน" ของงานก่อนหน้า = ผู้ตรวจกดผ่านแล้ว (รอลูกค้าตรวจ หรือเสร็จแล้ว)
   ═══════════════════════════════════════════════════════════════════ */

alter table public.project_tasks
  add column if not exists after_names text[] not null default '{}',
  add column if not exists waiting_on jsonb;

comment on column public.project_tasks.after_names is
  'ชื่องานในโปรเจคเดียวกันที่ต้องผ่านก่อน ใบนี้ถึงจะเริ่มได้ — ว่างคือเริ่มได้ทันที';
comment on column public.project_tasks.waiting_on is
  'รอข้อมูลที่คนทำกดเอง {kind, note, since} — ว่างคือไม่ได้รออะไร';

grant select (after_names, waiting_on), update (after_names, waiting_on)
  on public.project_tasks to authenticated;

/** งานใบนี้ "ผ่าน" แล้วหรือยัง — ผู้ตรวจกดผ่านแล้วคือรอลูกค้าตรวจ หรือเสร็จ */
create or replace function public.task_passed(p_status text) returns boolean
language sql immutable set search_path = ''
as $$ select p_status in ('wait', 'done') $$;

grant execute on function public.task_passed(text) to authenticated;

/**
 * งานก่อนหน้าที่ยังไม่ผ่านของใบนี้ — ว่างคือเริ่มได้
 * รอเฉพาะใบที่ยังไม่เคยส่ง (todo/doing) ใบที่ส่งแล้วหรือถูกตีกลับไม่ย้อนกลับไปรอ
 */
create or replace function public.task_blockers(p_project uuid, p_idx int)
  returns table (name text, status text)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select t.after_names, t.status
      from public.project_tasks t
     where t.project_id = p_project and t.idx = p_idx
  )
  select o.name, o.status
    from public.project_tasks o, me
   where o.project_id = p_project
     and o.name = any (me.after_names)
     and me.status in ('todo', 'doing')
     and not public.task_passed(o.status)
$$;

grant execute on function public.task_blockers(uuid, int) to authenticated;

/*
 * ส่งงานระหว่างที่ยังรองานก่อนหน้าไม่ได้
 * แผนผังสถานะของเอกสาร: "รอข้อมูล" ไปได้ทางเดียวคือกลับเป็น "ยังไม่เริ่ม" ไม่มีทางไป "รอตรวจ"
 * ด่านนี้ต้องอยู่ที่ฐานข้อมูล เพราะหน้าจอซ่อนปุ่มได้อย่างเดียว
 */
create or replace function public.task_after_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_left int;
begin
  if new.status <> 'sent' or old.status = 'sent' then
    return new;
  end if;
  if coalesce(array_length(old.after_names, 1), 0) = 0 then
    return new;
  end if;
  select count(*) into v_left
    from public.project_tasks o
   where o.project_id = new.project_id
     and o.name = any (old.after_names)
     and not public.task_passed(o.status);
  if v_left > 0 then
    raise exception 'งานนี้ยังรองานก่อนหน้าอยู่ % ใบ ส่งงานไม่ได้', v_left using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists project_tasks_after_guard on public.project_tasks;
create trigger project_tasks_after_guard before update on public.project_tasks
  for each row execute function public.task_after_guard();

/**
 * คนทำกด "รอข้อมูล" เอง — เก็บว่ารอเรื่องอะไรและตั้งแต่เมื่อไร
 * กดได้เฉพาะคนที่ถืองานใบนั้น และเฉพาะใบที่ยังไม่ส่ง
 */
create or replace function public.task_wait_set(p_project uuid, p_idx int, p_kind text, p_note text)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_t record;
  v_me text;
begin
  if p_kind not in ('customer', 'file', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  select t.*, p.pj into v_t
    from public.project_tasks t join public.projects p on p.id = t.project_id
   where t.project_id = p_project and t.idx = p_idx;
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_t.status not in ('todo', 'doing') then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  select e.emp_no into v_me
    from public.user_accounts a join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  /* ผู้จัดการโครงการกดแทนได้ คนนอกทีมของใบนั้นกดไม่ได้ */
  if not (v_me = any (v_t.whos) or public.has_role('pm') or public.has_role('gm')) then
    return jsonb_build_object('ok', false, 'reason', 'not_mine');
  end if;
  /* ด่านของรอบที่ 124/130 ยอมให้พนักงานเปลี่ยนได้แค่สถานะ "ส่งงาน"
     การกดรอข้อมูลเป็นงานของระบบ (ตรวจสิทธิ์ในฟังก์ชันนี้แล้ว) จึงยกธงให้ด่านนั้นปล่อยผ่าน */
  perform set_config('maz.task_review', '1', true);
  update public.project_tasks
     set waiting_on = jsonb_build_object(
           'kind', p_kind,
           'note', coalesce(trim(p_note), ''),
           'since', to_char((now() at time zone 'Asia/Bangkok'), 'YYYY-MM-DD HH24:MI'),
           'by', coalesce(v_me, ''))
   where id = v_t.id;
  perform set_config('maz.task_review', '', true);
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.task_wait_set(uuid, int, text, text) to authenticated;

/** เลิกรอข้อมูล — ได้ของที่รอแล้ว ทำงานต่อได้ */
create or replace function public.task_wait_clear(p_project uuid, p_idx int)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_t record;
  v_me text;
begin
  select t.* into v_t from public.project_tasks t
   where t.project_id = p_project and t.idx = p_idx;
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select e.emp_no into v_me
    from public.user_accounts a join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  if not (v_me = any (v_t.whos) or public.has_role('pm') or public.has_role('gm')) then
    return jsonb_build_object('ok', false, 'reason', 'not_mine');
  end if;
  perform set_config('maz.task_review', '1', true);
  update public.project_tasks set waiting_on = null where id = v_t.id;
  perform set_config('maz.task_review', '', true);
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.task_wait_clear(uuid, int) to authenticated;

notify pgrst, 'reload schema';
