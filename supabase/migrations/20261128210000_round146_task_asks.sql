/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 146 · งานที่ทีมเสนอเอง (ยกมาจาก ERP_Test · เจ้าของอนุมัติ 20 ต.ค. 2569)

   ลูกค้าหรือคนในบริษัทเดินมาสั่งงานกับคนทำโดยตรงอยู่แล้วทุกวัน
   เดิมงานพวกนี้ไม่เคยอยู่ในระบบ — ฝ่ายโครงการไม่รู้ว่าทีมถืออะไรอยู่บ้าง

   กติกา
     1. เสนอได้เฉพาะงานของตัวเอง — คนเสนอคือคนรับงาน
     2. ทุกใบต้องให้ฝ่ายโครงการอนุมัติก่อน ถึงจะกลายเป็นใบงานจริง
     3. อนุมัติแล้วงานไปอยู่ในโปรเจคที่ฝ่ายโครงการเลือก (เปลี่ยนจากที่ผู้เสนอกรอกมาได้)
     4. ไม่อนุมัติต้องบอกเหตุผล · ใบไม่เคยถูกลบ เก็บไว้ดูย้อนหลังทั้งหมด

   ยังไม่ทำในรอบนี้: "งานนอกโปรเจค" ของ ERP_Test (งานที่อนุมัติแล้วไม่ผูกโปรเจคไหนเลย)
   ระบบนี้ใบงานอยู่ใต้โปรเจคเสมอ การเปิดบ้านชั่วคราวให้งานลอยต้องให้เจ้าของตัดสินก่อน
   ═══════════════════════════════════════════════════════════════════ */

create table if not exists public.task_asks (
  id         uuid primary key default gen_random_uuid(),
  /** เลขที่ใบเสนองาน TA-{พ.ศ.}-{NNNN} */
  no         text not null default '',
  /** รหัสพนักงานผู้เสนอ = ผู้รับงาน (ฐานข้อมูลเติมให้) */
  by_no      text not null default '',
  by_name    text not null default '',
  by_id      uuid references public.employees(id),
  /** โปรเจคที่ผู้เสนอคิดว่างานนี้ควรอยู่ — ว่างได้ ฝ่ายโครงการเลือกตอนอนุมัติ */
  pj         text not null default '',
  name       text not null,
  /** งานนี้ใครขอมา — ลูกค้า หรือคนในบริษัท */
  from_kind  text not null default 'staff' check (from_kind in ('client', 'staff')),
  from_name  text not null default '',
  brief      text not null default '',
  due        date,
  files      jsonb not null default '[]'::jsonb,
  status     text not null default 'waiting' check (status in ('waiting', 'ok', 'no')),
  /** ที่ที่งานไปอยู่จริงตอนอนุมัติ */
  ok_pj      text not null default '',
  ok_idx     int,
  /** เหตุผลที่ไม่อนุมัติ */
  why        text not null default '',
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  closed_by  text not null default ''
);

create unique index if not exists task_asks_no on public.task_asks (no);
create index if not exists task_asks_open on public.task_asks (status, created_at desc);

/** เลขที่ใบ และชื่อผู้เสนอ — ฐานข้อมูลเขียนให้ เสนอแทนคนอื่นไม่ได้ */
create or replace function public.task_ask_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_me record;
begin
  if coalesce(new.no, '') = '' then
    new.no := public.next_doc_no('TA');
  end if;
  select e.emp_no nm_no, trim(e.first_name || ' ' || e.last_name) nm, e.id
    into v_me
    from public.user_accounts a
    join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  if v_me.id is not null then
    new.by_no := v_me.nm_no;
    new.by_name := v_me.nm;
    new.by_id := v_me.id;
  end if;
  return new;
end $$;

drop trigger if exists task_asks_stamp on public.task_asks;
create trigger task_asks_stamp before insert on public.task_asks
  for each row execute function public.task_ask_stamp();

/** ปิดแล้วห้ามแก้ — ใบที่ตัดสินไปแล้วย้อนไม่ได้ ต้องเสนอใบใหม่ */
create or replace function public.task_ask_closed() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'waiting' then
    raise exception 'ask_closed';
  end if;
  if new.no is distinct from old.no or new.by_no is distinct from old.by_no then
    raise exception 'ask_locked';
  end if;
  return new;
end $$;

drop trigger if exists task_asks_closed on public.task_asks;
create trigger task_asks_closed before update on public.task_asks
  for each row execute function public.task_ask_closed();

alter table public.task_asks enable row level security;

/* ผู้เสนอเห็นของตัวเอง · ฝ่ายโครงการกับผู้บริหารเห็นทั้งหมด */
drop policy if exists task_asks_read on public.task_asks;
create policy task_asks_read on public.task_asks
  for select to authenticated
  using (
    public.has_role('pm') or public.has_role('gm') or public.has_role('ceo')
    or by_id = public.my_employee_id()
  );

/* เสนอได้เฉพาะในนามตัวเอง (ทริกเกอร์เติมชื่อให้ ใครยิงมาก็เป็นชื่อตัวเอง) */
drop policy if exists task_asks_add on public.task_asks;
create policy task_asks_add on public.task_asks
  for insert to authenticated with check (public.my_employee_id() is not null);

grant select, insert on public.task_asks to authenticated;

/**
 * ฝ่ายโครงการอนุมัติ — สร้างใบงานจริงในโปรเจคที่เลือก แล้วปิดใบเสนอ
 * ใบงานใหม่ต่อท้ายเฟสสุดท้ายของโปรเจคนั้น และมอบให้ผู้เสนอเป็นผู้รับงาน
 */
create or replace function public.task_ask_ok(p_no text, p_pj text, p_due date default null)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_a record;
  v_p record;
  v_idx int;
  v_phase int;
  v_me text;
begin
  if not public.can_edit_pm() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  select * into v_a from public.task_asks where no = p_no and status = 'waiting';
  if v_a.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  select * into v_p from public.projects where pj = coalesce(nullif(trim(p_pj), ''), v_a.pj);
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_project');
  end if;
  if v_p.status <> 'running' then
    return jsonb_build_object('ok', false, 'reason', 'project_closed');
  end if;

  select coalesce(max(idx), -1) + 1, coalesce(max(phase), 0)
    into v_idx, v_phase
    from public.project_tasks where project_id = v_p.id;

  /* ใบงานของระบบเอง — ยกธงให้ด่านของพนักงาน (รอบที่ 124/130) ปล่อยผ่าน */
  perform set_config('maz.task_review', '1', true);
  insert into public.project_tasks
    (project_id, idx, name, phase, whos, start_on, due, status, pct, brief, files, subs, assigned_at)
  values (v_p.id, v_idx, v_a.name, v_phase, array[v_a.by_no],
          (now() at time zone 'Asia/Bangkok')::date,
          coalesce(p_due, v_a.due, (now() at time zone 'Asia/Bangkok')::date + 3),
          'todo', 0, v_a.brief, v_a.files, '[]'::jsonb, now());
  perform set_config('maz.task_review', '', true);

  select trim(e.first_name || ' ' || e.last_name) into v_me
    from public.user_accounts a join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();

  update public.task_asks
     set status = 'ok', ok_pj = v_p.pj, ok_idx = v_idx, closed_at = now(), closed_by = coalesce(v_me, '')
   where id = v_a.id;
  return jsonb_build_object('ok', true, 'pj', v_p.pj, 'idx', v_idx);
end $$;

grant execute on function public.task_ask_ok(text, text, date) to authenticated;

/** ฝ่ายโครงการไม่อนุมัติ — ต้องบอกเหตุผล ผู้เสนอจะได้รู้ว่าทำไม */
create or replace function public.task_ask_no(p_no text, p_why text)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me text;
  v_n int;
begin
  if not public.can_edit_pm() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if coalesce(trim(p_why), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_why');
  end if;
  select trim(e.first_name || ' ' || e.last_name) into v_me
    from public.user_accounts a join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  update public.task_asks
     set status = 'no', why = trim(p_why), closed_at = now(), closed_by = coalesce(v_me, '')
   where no = p_no and status = 'waiting';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.task_ask_no(text, text) to authenticated;

notify pgrst, 'reload schema';
