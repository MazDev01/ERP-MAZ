/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 130 · ขั้นตรวจงานมีผู้ตรวจได้หลายคน (คำตอบเจ้าของ 25 พ.ย. 2569)

   สายงาน DM: "ขั้นตรวจก่อนส่งลูกค้าต้องมีคนตรวจได้หลายคน (PM + BD + Sale)"
   ของเดิมฝ่ายโครงการคนเดียวกดผ่าน งานที่ต้องให้ BD กับฝ่ายขายดูด้วยจึงไม่มีที่ลง

   กติกา
     · ฝ่ายโครงการตั้งว่าใบงานนั้นใครต้องตรวจ (ไม่ตั้ง = ฝ่ายโครงการตรวจคนเดียวเหมือนเดิม)
     · ผู้ตรวจกด "ผ่าน" หรือ "ขอแก้" ได้คนละครั้ง · ขอแก้ = งานกลับไปแก้ทันที
     · ครบทุกคนกดผ่าน งานจึงเป็น "ตรวจผ่าน" — ไม่ใช่คนแรกที่กดชนะ
   ═══════════════════════════════════════════════════════════════════ */

alter table public.project_tasks
  add column if not exists reviewers text[] not null default '{}';

comment on column public.project_tasks.reviewers is 'คนที่ต้องตรวจใบงานนี้ (รหัสพนักงาน) · ว่าง = ฝ่ายโครงการตรวจเอง';

create table if not exists public.task_reviews (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references public.project_tasks(id) on delete cascade,
  who      text not null,
  ok       boolean not null,
  note     text not null default '',
  at       timestamptz not null default now(),
  by_id    uuid,
  unique (task_id, who)
);

comment on table public.task_reviews is 'ผลตรวจของผู้ตรวจแต่ละคนในใบงานหนึ่ง';

alter table public.task_reviews enable row level security;

drop policy if exists task_reviews_read on public.task_reviews;
create policy task_reviews_read on public.task_reviews for select to authenticated
  using (exists (select 1 from public.project_tasks t
                  where t.id = task_id
                    and (public.can_see_pm() or public.owns_task(t.whos)
                         or public.owns_task(t.reviewers))));

grant select on public.task_reviews to authenticated;

/** ฉันเป็นผู้ตรวจของใบงานนี้ไหม (เทียบทั้งรหัสแถวและรหัสพนักงาน เหมือน owns_task) */
create or replace function public.my_review_turn(p_task uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.project_tasks t
                  where t.id = p_task and public.owns_task(t.reviewers))
$$;

/**
 * ผู้ตรวจกดผลของตัวเอง
 *   ok = true  → บันทึกว่าผ่าน · ครบทุกคนแล้วงานเป็น done 100%
 *   ok = false → งานกลับไปแก้ทันที พร้อมเหตุผล และล้างผลตรวจของรอบนั้นทิ้ง
 * ฝ่ายโครงการกดได้เสมอ (เป็นผู้ตรวจอยู่แล้วโดยตำแหน่ง)
 */
create or replace function public.task_review(p_task uuid, p_ok boolean, p_note text default '')
  returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t     record;
  v_me    text;
  v_left  int;
  v_total int;
begin
  select * into v_t from public.project_tasks where id = p_task;
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (public.can_edit_pm() or public.my_review_turn(p_task)) then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;
  if v_t.status <> 'sent' then
    return jsonb_build_object('ok', false, 'reason', 'not_sent', 'status', v_t.status);
  end if;

  select coalesce(e.emp_no, public.my_employee_id()::text) into v_me
    from public.employees e where e.id = public.my_employee_id();
  v_me := coalesce(v_me, 'pm');

  insert into public.task_reviews (task_id, who, ok, note, by_id)
  values (p_task, v_me, p_ok, coalesce(btrim(p_note), ''), auth.uid())
  on conflict (task_id, who)
    do update set ok = excluded.ok, note = excluded.note, at = now(), by_id = excluded.by_id;

  /* งานของระบบเอง — ทริกเกอร์กันพนักงานแก้ช่องอื่น (รอบที่ 124) ต้องยอมให้ผ่านตรงนี้ */
  perform set_config('maz.task_review', '1', true);

  if not p_ok then
    update public.project_tasks
       set status = 'revise',
           back = jsonb_build_object('why', coalesce(nullif(btrim(p_note), ''), 'ขอแก้งาน'),
                                     'at', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
                                     'by', v_me)
     where id = p_task;
    delete from public.task_reviews where task_id = p_task;
    perform set_config('maz.task_review', '', true);
    return jsonb_build_object('ok', true, 'status', 'revise');
  end if;

  v_total := greatest(coalesce(array_length(v_t.reviewers, 1), 0), 1);
  select v_total - count(*) into v_left from public.task_reviews
   where task_id = p_task and ok = true;

  if v_left <= 0 then
    update public.project_tasks
       set status = 'done', pct = 100, done_at = now(), back = null
     where id = p_task;
    perform set_config('maz.task_review', '', true);
    return jsonb_build_object('ok', true, 'status', 'done');
  end if;

  perform set_config('maz.task_review', '', true);
  return jsonb_build_object('ok', true, 'status', 'sent', 'left', v_left);
end $$;

grant execute on function public.my_review_turn(uuid), public.task_review(uuid, boolean, text) to authenticated;

/* ── ตั้งผู้ตรวจของใบงาน — ฝ่ายโครงการเท่านั้น ─────────────────────
   เปลี่ยนผู้ตรวจแล้วผลตรวจของรอบก่อนไม่ใช้อีก (คนที่เพิ่มเข้ามายังไม่ได้ดูงาน) */
create or replace function public.task_set_reviewers(p_task uuid, p_who text[])
  returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_pm() then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;
  perform set_config('maz.task_review', '1', true);
  update public.project_tasks set reviewers = coalesce(p_who, '{}') where id = p_task;
  delete from public.task_reviews where task_id = p_task;
  perform set_config('maz.task_review', '', true);
  return jsonb_build_object('ok', true, 'n', coalesce(array_length(p_who, 1), 0));
end $$;

grant execute on function public.task_set_reviewers(uuid, text[]) to authenticated;

/* ── ทริกเกอร์ของรอบที่ 124 ต้องยอมให้ฟังก์ชันตรวจงานทำงาน ───────── */
create or replace function public.task_staff_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /* งานของระบบเอง — ผลตรวจของลูกค้า ผลตรวจของผู้ตรวจ และงานดูแลฐานข้อมูล */
  if auth.uid() is null
     or coalesce(current_setting('maz.task_review', true), '') = '1'
     or public.can_edit_pm() then
    return new;
  end if;

  /* ส่งงานได้ทางเดียว — จากงานที่ยังทำอยู่หรือที่ถูกตีกลับมาแก้ */
  if new.status is distinct from 'sent' then
    raise exception 'พนักงานทำได้แค่ส่งงานให้ตรวจ สถานะอื่นเป็นของฝ่ายโครงการ'
      using errcode = 'check_violation';
  end if;
  if old.status not in ('todo', 'doing', 'revise', 'sent') then
    raise exception 'ใบงานนี้ส่งไม่ได้แล้ว (สถานะ %)', old.status
      using errcode = 'check_violation';
  end if;

  if new.whos is distinct from old.whos
     or new.reviewers is distinct from old.reviewers
     or new.due is distinct from old.due
     or new.start_on is distinct from old.start_on
     or new.name is distinct from old.name
     or new.idx is distinct from old.idx
     or new.phase is distinct from old.phase
     or new.pct is distinct from old.pct
     or new.brief is distinct from old.brief
     or new.done_at is distinct from old.done_at
     or new.project_id is distinct from old.project_id then
    raise exception 'พนักงานแก้ได้แค่การส่งงาน ช่องอื่นเป็นของฝ่ายโครงการ'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

/* เพิ่มช่องใหม่ในตารางโปรเจค — คืนสิทธิ์รายช่องที่รอบที่ 119/124 ถอนไว้ */
grant select (reviewers), update (reviewers) on public.project_tasks to authenticated;

/* ── รายการ "งานที่รอฉันตรวจ" ──────────────────────────────────────
   ผู้ตรวจอยู่คนละฝ่าย (ฝ่ายขายเห็นทะเบียนพนักงานแค่ของตัวเอง) ถ้าให้หน้าจอ
   ไปประกอบชื่อเอง จะขึ้นเป็นรหัสพนักงานของคนอื่น — ฟังก์ชันนี้คืนชื่อมาให้พร้อม */
create or replace function public.my_review_tasks()
  returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'due' nulls last), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'task', t.id,
               'pj', p.pj,
               'project', coalesce(nullif(p.name, ''), p.cus),
               'cus', p.cus,
               'name', t.name,
               'due', t.due,
               'sent', (select s->>'at' from jsonb_array_elements(t.subs) s
                         order by s->>'at' desc limit 1),
               'sentBy', (select coalesce(nullif(e2.nick, ''), e2.first_name)
                            from jsonb_array_elements(t.subs) s
                            left join public.employees e2 on e2.emp_no = s->>'by'
                           order by s->>'at' desc limit 1),
               'note', (select s->>'note' from jsonb_array_elements(t.subs) s
                         order by s->>'at' desc limit 1),
               'doers', (select coalesce(jsonb_agg(coalesce(nullif(e3.nick, ''), e3.first_name, w)), '[]'::jsonb)
                           from unnest(t.whos) w
                           left join public.employees e3 on e3.emp_no = w),
               'reviewers', (select coalesce(jsonb_agg(jsonb_build_object(
                                      'who', w,
                                      'name', coalesce(nullif(e4.nick, ''), e4.first_name, w),
                                      'ok', exists (select 1 from public.task_reviews r
                                                     where r.task_id = t.id and r.who = w and r.ok))), '[]'::jsonb)
                               from unnest(t.reviewers) w
                               left join public.employees e4 on e4.emp_no = w)
             ) x
        from public.project_tasks t
        join public.projects p on p.id = t.project_id
       where t.status = 'sent'
         and p.status <> 'cancelled'
         and public.owns_task(t.reviewers)
         and not exists (select 1 from public.task_reviews r
                          where r.task_id = t.id and r.ok
                            and (r.who = (select e.emp_no from public.employees e where e.id = public.my_employee_id())
                                 or r.who = public.my_employee_id()::text))
    ) q
$$;

grant execute on function public.my_review_tasks() to authenticated;

notify pgrst, 'reload schema';
