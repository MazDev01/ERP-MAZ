/* รอบที่ 102 — หลังบ้านฝ่ายโครงการ ชุดแรก (SRS 1.5 M4)
   โปรเจค · เฟส · งานย่อย · แชท · ความเคลื่อนไหว · เอกสารแนบ · การโอนโปรเจค

   รอบนี้ทำแค่ "ที่เก็บ" — ตาราง สิทธิ์เข้าถึง และเลขที่โปรเจค ยังไม่แตะหน้าเว็บ

   โปรเจคผูกกับ "ใบแจ้งหนี้งวดแรก" ไม่ใช่ดีล (เจ้าของสั่ง 5 ต.ค. 2569)
   เพราะโปรเจคมาได้สองทาง — ดีลฝ่ายขายที่ส่งไปวางบิล หรือลูกค้าเก่าที่บัญชีออกใบเสนอราคาเอง
   ทั้งสองทางมาบรรจบที่ใบแจ้งหนี้งวดแรก

   ทำไมงานย่อยถึงแยกตาราง ไม่ฝังรวมกับโปรเจค
   คนทำงานหลายคนแก้คนละงานในโปรเจคเดียวกันพร้อมกันได้จริง ถ้าเก็บรวมเป็นก้อนเดียว
   คนที่บันทึกทีหลังจะทับงานของอีกคนทั้งก้อน แชทกับความเคลื่อนไหวก็เป็นการต่อท้ายตลอดเวลา
   ส่วนเฟสเป็นชุดที่ผู้จัดการโครงการแก้ทั้งแผงครั้งเดียว เก็บรวมไว้กับโปรเจคได้ */

-- ─── โปรเจค ────────────────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  pj          text not null unique,
  /* ใบแจ้งหนี้งวดแรก — ว่างได้กับงานเก่าที่ยังไม่รู้เลข */
  invoice_id  uuid references public.invoices (id) on delete set null,
  deal_id     uuid references public.deals (id) on delete set null,
  service     text not null default '',
  name        text not null default '',
  /* ชื่อลูกค้าและเลขที่ใบเสนอราคา — เก็บเป็นข้อความด้วย เพราะงานเก่าบางงานไม่มีใบในระบบ */
  cus         text not null default '',
  customer_id uuid references public.customers (id) on delete set null,
  quo         text not null default '',
  net         numeric not null default 0,
  scope       text not null default '',
  /* ผู้จัดการโครงการเจ้าของงาน — ชื่อคือสิ่งที่หน้าจอแสดง รหัสมีไว้ให้ด่านสิทธิ์ใช้ */
  pm          text not null default '',
  pm_id       uuid references public.employees (id) on delete set null,
  start_on    date,
  due         date,
  status      text not null default 'running' check (status in ('running', 'done', 'cancelled')),
  /* ดีลถูกยกเลิก — งานหยุด ทีมไม่ต้องทำต่อ ต้องมีเหตุผลเสมอ */
  cancel_at   date,
  cancel_by   text not null default '',
  cancel_why  text not null default '',
  tone        text not null default 'a' check (tone in ('a', 'b', 'c')),
  /* เฟสเป็นชุดที่แก้ทั้งแผงครั้งเดียว เก็บรวมไว้ตรงนี้ */
  phases      jsonb not null default '[]'::jsonb,
  /* งานตอนรับเข้ามา (ใบเสนอราคา + ข้อเสนอ) ไว้เปิดดูตอนกลับมาวางแผนใหม่ */
  source      jsonb,
  updated     date,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.employees (id) on delete set null,
  updated_at  timestamptz not null default now()
);

create index if not exists projects_status_idx on public.projects (status);
create index if not exists projects_pm_idx     on public.projects (pm_id);

-- ─── งานย่อย ───────────────────────────────────────────────────────
create table if not exists public.project_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  /* ลำดับงานในโปรเจค — หน้าจออ้างงานด้วยลำดับนี้ */
  idx         int  not null check (idx >= 0),
  name        text not null default '',
  phase       int  not null default 0 check (phase >= 0),
  /* รหัสพนักงานที่รับงานนี้ — งานหนึ่งมีได้หลายคน */
  whos        text[] not null default '{}',
  start_on    date,
  due         date,
  status      text not null default 'todo'
              check (status in ('todo', 'doing', 'sent', 'revise', 'wait', 'done')),
  pct         int  not null default 0 check (pct between 0 and 100),
  brief       text not null default '',
  /* ไฟล์ของงานและทุกรอบที่ส่งมา — คนแก้คือเจ้าของงานคนเดียว เก็บรวมในแถวงานได้ */
  files       jsonb not null default '[]'::jsonb,
  subs        jsonb not null default '[]'::jsonb,
  /* ผลตรวจที่ผู้จัดการโครงการตีกลับรอบล่าสุด — ต้องมีเหตุผลเสมอ */
  back        jsonb,
  assigned_at timestamptz,
  done_at     timestamptz,
  last_change jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, idx)
);

create index if not exists project_tasks_proj_idx   on public.project_tasks (project_id);
create index if not exists project_tasks_status_idx on public.project_tasks (status);
create index if not exists project_tasks_whos_idx   on public.project_tasks using gin (whos);

-- ─── แชท · ความเคลื่อนไหว · เอกสาร · การโอน ───────────────────────
create table if not exists public.project_chat (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  /* รหัสพนักงาน หรือ "PM" ถ้าเป็นข้อความของผู้จัดการโครงการเอง */
  who        text not null default '',
  at         timestamptz not null default now(),
  tx         text not null default '',
  files      jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_chat_proj_idx on public.project_chat (project_id, at);

create table if not exists public.project_acts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind       text not null check (kind in ('file', 'chat', 'status', 'done')),
  who        text not null default '',
  at         timestamptz not null default now(),
  tx         text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists project_acts_proj_idx on public.project_acts (project_id, at desc);

create table if not exists public.project_docs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null default '',
  size_text  text not null default '',
  by_name    text not null default '',
  at         timestamptz not null default now(),
  url        text not null default '',
  file_id    text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists project_docs_proj_idx on public.project_docs (project_id);

/* โปรเจคมีเจ้าของได้คนเดียว โอนแล้วเจ้าของเดิมไม่ได้เป็นเจ้าของอีก
   เก็บทุกครั้งที่โอน เพราะต้องย้อนดูได้ว่าใครโอนให้ใครเพราะอะไร */
create table if not exists public.project_transfers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  at         timestamptz not null default now(),
  from_name  text not null default '',
  to_name    text not null default '',
  by_name    text not null default '',
  why        text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists project_transfers_proj_idx on public.project_transfers (project_id, at);

-- ─── เลขที่โปรเจคและด่านกันข้อมูลเพี้ยน ───────────────────────────
create or replace function public.stamp_project_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pj is null or new.pj = '' then new.pj := public.next_sales_no('project', 'PJ'); end if;
  if new.status = 'cancelled' and coalesce(trim(new.cancel_why), '') = '' then
    raise exception 'need_cancel_reason';
  end if;
  return new;
end $$;

create or replace function public.guard_project_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.pj is distinct from old.pj then raise exception 'project_no_locked'; end if;
  /* ยกเลิกโปรเจคต้องบอกเหตุผลเสมอ ทีมจะได้รู้ว่าทำไมงานหยุด */
  if new.status = 'cancelled' and coalesce(trim(new.cancel_why), '') = '' then
    raise exception 'need_cancel_reason';
  end if;
  new.updated_at := now();
  return new;
end $$;

/* ตีกลับงานต้องบอกเหตุผล ไม่งั้นคนทำไม่รู้ว่าต้องแก้อะไร */
create or replace function public.guard_task_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'revise'
     and coalesce(trim(new.back #>> array['why']), '') = '' then
    raise exception 'need_sendback_reason';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists projects_no      on public.projects;
drop trigger if exists projects_guard   on public.projects;
drop trigger if exists project_tasks_guard on public.project_tasks;

create trigger projects_no    before insert on public.projects
  for each row execute function public.stamp_project_no();
create trigger projects_guard before update on public.projects
  for each row execute function public.guard_project_edit();
create trigger project_tasks_guard before insert or update on public.project_tasks
  for each row execute function public.guard_task_edit();

-- ─── สิทธิ์เข้าถึง ──────────────────────────────────────────────────
/*
 * งานโครงการเป็นงานของทั้งทีม — ทุกคนที่ทำงานให้บริษัทเห็นโปรเจคได้
 * เพราะงานย่อยมอบให้ใครก็ได้ และคนทำต้องเห็นบริบทของโปรเจคที่ตัวเองถืองานอยู่
 * ฝ่ายบุคคลกับแม่บ้านไม่เกี่ยว จึงไม่เปิดให้
 *
 * ใครเขียนโปรเจค/เฟส : ผู้จัดการโครงการ · ผู้จัดการทั่วไป · ผู้บริหาร
 * ใครเขียนงานย่อย    : เพิ่มข้างบน + คนที่ถืองานนั้น (อัปเดตความคืบหน้าและส่งงาน)
 * แชท/ความเคลื่อนไหว : ทุกคนที่เห็นโปรเจค
 * ลบ                 : ไม่เปิดให้ใครเลย
 */
create or replace function public.can_see_pm() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('pm')    or public.has_role('gm')  or public.has_role('ceo')
      or public.has_role('sales') or public.has_role('acc') or public.has_role('ps')
      or public.has_role('staff')
$$;

create or replace function public.can_edit_pm() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('pm') or public.has_role('gm') or public.has_role('ceo')
$$;

/* คนนี้ถืองานย่อยใบนี้อยู่ไหม — เทียบด้วยรหัสพนักงานของผู้ล็อกอิน */
create or replace function public.owns_task(p_whos text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_employee_id()::text = any (p_whos), false)
      or coalesce((select e.emp_no from public.employees e where e.id = public.my_employee_id()) = any (p_whos), false)
$$;

revoke all on function public.can_see_pm() from public, anon;
revoke all on function public.can_edit_pm() from public, anon;
revoke all on function public.owns_task(text[]) from public, anon;
grant execute on function public.can_see_pm() to authenticated;
grant execute on function public.can_edit_pm() to authenticated;
grant execute on function public.owns_task(text[]) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['projects', 'project_tasks', 'project_chat',
                           'project_acts', 'project_docs', 'project_transfers']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_see_pm())',
                   t || '_read', t);
  end loop;
end $$;

/* โปรเจคและเอกสาร — ผู้จัดการโครงการและหัวหน้าเท่านั้น */
do $$
declare t text;
begin
  foreach t in array array['projects', 'project_docs', 'project_transfers']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_change', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_pm())',
                   t || '_write', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_pm()) with check (public.can_edit_pm())',
                   t || '_change', t);
  end loop;
end $$;

/* งานย่อย — ผู้จัดการโครงการมอบหมายและตรวจ ส่วนคนที่ถืองานอัปเดตและส่งงานของตัวเองได้ */
drop policy if exists project_tasks_write  on public.project_tasks;
drop policy if exists project_tasks_change on public.project_tasks;
create policy project_tasks_write on public.project_tasks
  for insert to authenticated with check (public.can_edit_pm());
create policy project_tasks_change on public.project_tasks
  for update to authenticated
  using (public.can_edit_pm() or public.owns_task(whos))
  with check (public.can_edit_pm() or public.owns_task(whos));

/* แชทและความเคลื่อนไหว — ทุกคนที่เห็นโปรเจคพิมพ์ได้ แต่แก้ของคนอื่นไม่ได้ */
do $$
declare t text;
begin
  foreach t in array array['project_chat', 'project_acts']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_change', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_see_pm())',
                   t || '_write', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_pm()) with check (public.can_edit_pm())',
                   t || '_change', t);
  end loop;
end $$;
