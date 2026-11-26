/* รอบที่ 116 — ลูกค้าตรวจงานผ่านลิงก์ (เฟส 2: ลงฐานข้อมูลจริง)

   เฟส 1 ทำหน้าบ้านไว้ทั้งหมดแต่เก็บใน localStorage ลิงก์จึงเปิดได้แค่ในเครื่องที่สร้าง
   รอบนี้ย้ายขึ้นฐานข้อมูล ลูกค้าเปิดลิงก์จากเครื่องไหนก็ได้ ไม่ต้องล็อกอิน

   ลูกค้าไม่มีบัญชีในระบบ ตัวลิงก์ (โทเคน 20 ตัวอักษร) จึงเป็นกุญแจ
   ฝั่งลูกค้าจึงไม่ได้อ่านตารางตรง ๆ แต่เรียกผ่านฟังก์ชัน security definer ที่รับโทเคน
   ฟังก์ชันเหล่านี้ให้สิทธิ์ anon ได้ เพราะทำงานเฉพาะกับรอบของโทเคนนั้น และกันรอบที่หมดอายุไว้

   ไฟล์ที่ลูกค้าต้องเปิดดูอยู่ในถัง "review" ที่เป็นถังสาธารณะ
   ที่อยู่ไฟล์ขึ้นต้นด้วยโทเคน (review/<token>/…) ซึ่งเดาไม่ได้เท่าตัวลิงก์เอง
   เลือกแบบนี้เพราะลูกค้าไม่ได้ล็อกอิน จะขอลิงก์ชั่วคราวแบบถัง docs ไม่ได้ */

/* ═══ ตาราง ════════════════════════════════════════════════════════ */
create table if not exists public.review_rounds (
  id          uuid primary key default gen_random_uuid(),
  /* กุญแจของลิงก์ — เดาไม่ได้ ใครมีลิงก์ก็เปิดได้ (เหมือนลิงก์แชร์ไฟล์) */
  token       text not null unique check (length(token) >= 16),
  project_id  uuid not null references public.projects (id) on delete cascade,
  task_name   text not null check (btrim(task_name) <> ''),
  /* รอบที่ของงานใบนี้ (Draft N) */
  round       int  not null check (round >= 1),
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  /* วันสุดท้ายที่ลิงก์ยังเปิดได้ */
  expires_at  date not null,
  message     text not null default '',
  contact     text not null default '',
  /* ชื่อโปรเจคตอนส่ง — หน้าลูกค้าไม่ต้องอ่านตารางของ PM */
  project     text not null default '',
  /* open = รอลูกค้า · submitted = ส่งความเห็นแล้ว · approved = อนุมัติแล้ว
     หมดอายุคิดจาก expires_at ตอนอ่าน ไม่เก็บเป็นสถานะ */
  status      text not null default 'open' check (status in ('open', 'submitted', 'approved')),
  submitted_at timestamptz,
  forwarded_at timestamptz,
  closed_at    timestamptz,
  unique (project_id, task_name, round)
);

create index if not exists review_rounds_proj_idx on public.review_rounds (project_id, task_name, round desc);

create table if not exists public.review_files (
  id        uuid primary key default gen_random_uuid(),
  round_id  uuid not null references public.review_rounds (id) on delete cascade,
  name      text not null check (btrim(name) <> ''),
  kind      text not null default 'image' check (kind in ('image', 'video', 'pdf', 'link')),
  /* ขนาดสำหรับแสดง เช่น "1.2 MB" — ไฟล์ที่รู้แค่ชื่อเป็น "—" */
  size_text text not null default '—',
  /* ลิงก์ภายนอก หรือที่อยู่เต็มของไฟล์ในถังสาธารณะ */
  url       text,
  poster    text,
  duration  int,
  approved  boolean not null default false,
  /* ไฟล์ที่ยังไม่ได้อัปโหลดจริง (ชื่อไฟล์ส่งมอบของงาน) — ลูกค้าเปิดไม่ได้ */
  name_only boolean not null default false,
  idx       int not null default 0
);

create index if not exists review_files_round_idx on public.review_files (round_id, idx);

create table if not exists public.review_comments (
  id       uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.review_rounds (id) on delete cascade,
  file_id  uuid not null references public.review_files (id) on delete cascade,
  author   text not null default '',
  tx       text not null check (btrim(tx) <> ''),
  at       timestamptz not null default now(),
  /* วินาทีในวิดีโอ — ว่าง = ทั้งไฟล์ */
  t        int,
  /* ภาพเฟรม ณ เวลานั้น (data URL ย่อ) */
  frame    text,
  /* หมุดบนรูป {x, y, n} เป็นเปอร์เซ็นต์ */
  pin      jsonb,
  page     int,
  attach   jsonb,
  /* PM ติ๊กว่าแก้แล้ว */
  done     boolean not null default false
);

create index if not exists review_comments_round_idx on public.review_comments (round_id, at);

/* ═══ สิทธิ์ของคนในบริษัท ═════════════════════════════════════════
   อ่าน: ชุดเดียวกับที่เห็นงานของฝ่ายโครงการ · เขียน/แก้: ฝ่ายโครงการขึ้นไป
   ฝั่งลูกค้าไม่ได้ใช้นโยบายพวกนี้ แต่เรียกผ่านฟังก์ชันที่รับโทเคน */
alter table public.review_rounds   enable row level security;
alter table public.review_files    enable row level security;
alter table public.review_comments enable row level security;

revoke all on public.review_rounds   from public, anon;
revoke all on public.review_files    from public, anon;
revoke all on public.review_comments from public, anon;
grant select, insert, update on public.review_rounds   to authenticated;
grant select, insert, update on public.review_files    to authenticated;
grant select, update         on public.review_comments to authenticated;

drop policy if exists review_rounds_read    on public.review_rounds;
drop policy if exists review_rounds_write   on public.review_rounds;
drop policy if exists review_rounds_change  on public.review_rounds;
drop policy if exists review_files_read     on public.review_files;
drop policy if exists review_files_write    on public.review_files;
drop policy if exists review_files_change   on public.review_files;
drop policy if exists review_comments_read  on public.review_comments;
drop policy if exists review_comments_change on public.review_comments;

create policy review_rounds_read on public.review_rounds
  for select to authenticated using (public.can_see_pm());
create policy review_rounds_write on public.review_rounds
  for insert to authenticated with check (public.can_edit_pm());
create policy review_rounds_change on public.review_rounds
  for update to authenticated using (public.can_edit_pm()) with check (public.can_edit_pm());

create policy review_files_read on public.review_files
  for select to authenticated using (public.can_see_pm());
create policy review_files_write on public.review_files
  for insert to authenticated with check (public.can_edit_pm());
create policy review_files_change on public.review_files
  for update to authenticated using (public.can_edit_pm()) with check (public.can_edit_pm());

create policy review_comments_read on public.review_comments
  for select to authenticated using (public.can_see_pm());
/* ฝ่ายโครงการแก้ได้แค่ช่อง "แก้แล้ว" — ข้อความของลูกค้าห้ามแก้ (ทริกเกอร์กันไว้) */
create policy review_comments_change on public.review_comments
  for update to authenticated using (public.can_edit_pm()) with check (public.can_edit_pm());

create or replace function public.review_comment_keep() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  /* ฟังก์ชันของฝั่งลูกค้าปักธงไว้ก่อนแก้ (maz.review_client) ทริกเกอร์จึงปล่อยผ่าน
     ส่วนคนในบริษัทที่สั่งแก้ตรง ๆ ไม่มีธงนี้ แก้ได้เฉพาะช่อง "แก้แล้ว" */
  if coalesce(current_setting('maz.review_client', true), '') <> 'on'
     and (new.tx is distinct from old.tx or new.author is distinct from old.author
          or new.file_id is distinct from old.file_id or new.at is distinct from old.at) then
    raise exception 'ข้อความของลูกค้าแก้ไม่ได้ แก้ได้เฉพาะสถานะว่าแก้แล้ว'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists review_comments_keep on public.review_comments;
create trigger review_comments_keep before update on public.review_comments
  for each row execute function public.review_comment_keep();

/* ═══ ถังไฟล์สาธารณะของรอบตรวจ ════════════════════════════════════
   ลูกค้าไม่ได้ล็อกอิน จึงขอลิงก์ชั่วคราวไม่ได้ — ใช้ถังสาธารณะแต่ที่อยู่ขึ้นต้นด้วยโทเคน
   รับเฉพาะรูป วิดีโอ และ PDF · ไฟล์ละไม่เกิน 25 MB */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review', 'review', true, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
              'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = true, file_size_limit = 26214400, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists review_bucket_read   on storage.objects;
drop policy if exists review_bucket_insert on storage.objects;
drop policy if exists review_bucket_delete on storage.objects;

/* อ่านได้ทุกคน (ถังสาธารณะ) — ที่อยู่ไฟล์คือกุญแจเหมือนตัวลิงก์ */
create policy review_bucket_read on storage.objects
  for select using (bucket_id = 'review');
/* อัปโหลดได้เฉพาะฝ่ายโครงการขึ้นไป และที่อยู่ต้องขึ้นต้นด้วยโทเคนของรอบที่มีจริง */
create policy review_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'review'
    and public.can_edit_pm()
    and exists (select 1 from public.review_rounds r where r.token = split_part(name, '/', 1))
  );
create policy review_bucket_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'review' and public.can_edit_pm());

/* ═══ ฝั่งลูกค้า — เรียกด้วยโทเคน ไม่ต้องล็อกอิน ══════════════════ */

/** รอบที่เปิดได้จากโทเคนนี้ — null คือไม่มีหรือหมดอายุ */
create or replace function public.review_open(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r record;
begin
  select * into v_r from public.review_rounds where token = p_token;
  if v_r.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'round', jsonb_build_object(
      'token', v_r.token,
      'taskName', v_r.task_name,
      'round', v_r.round,
      'createdBy', v_r.created_by,
      'createdAt', v_r.created_at,
      'expiresAt', v_r.expires_at,
      'message', v_r.message,
      'contact', v_r.contact,
      'project', v_r.project,
      'status', v_r.status,
      'submittedAt', v_r.submitted_at,
      'expired', (now() at time zone 'Asia/Bangkok')::date > v_r.expires_at
    ),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', f.name, 'kind', f.kind, 'size', f.size_text,
               'url', f.url, 'poster', f.poster, 'duration', f.duration,
               'approved', f.approved, 'nameOnly', f.name_only) order by f.idx)
        from public.review_files f where f.round_id = v_r.id), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'fileId', c.file_id, 'author', c.author, 'text', c.tx,
               'at', c.at, 't', c.t, 'frame', c.frame, 'pin', c.pin,
               'page', c.page, 'attach', c.attach, 'done', c.done) order by c.at)
        from public.review_comments c where c.round_id = v_r.id), '[]'::jsonb)
  );
end $$;

/** รอบที่ยังแก้ได้ — เปิดอยู่ และยังไม่หมดอายุ */
create or replace function public.review_live(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id from public.review_rounds r
   where r.token = p_token
     and r.status = 'open'
     and (now() at time zone 'Asia/Bangkok')::date <= r.expires_at
$$;

create or replace function public.review_comment_add(
  p_token text, p_file uuid, p_author text, p_text text,
  p_t int default null, p_frame text default null, p_pin jsonb default null,
  p_page int default null, p_attach jsonb default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_round uuid := public.review_live(p_token);
  v_id    uuid;
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if not exists (select 1 from public.review_files f where f.id = p_file and f.round_id = v_round) then
    return jsonb_build_object('ok', false, 'reason', 'file_not_found');
  end if;
  if btrim(coalesce(p_text, '')) = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  insert into public.review_comments (round_id, file_id, author, tx, t, frame, pin, page, attach)
  values (v_round, p_file, coalesce(p_author, ''), btrim(p_text), p_t, p_frame, p_pin, p_page, p_attach)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.review_comment_edit(p_token text, p_id uuid, p_text text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_round uuid := public.review_live(p_token);
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if btrim(coalesce(p_text, '')) = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  /* ปักธงบอกทริกเกอร์ว่าเป็นลูกค้าแก้ข้อความของตัวเอง (ธงอยู่แค่ในธุรกรรมนี้) */
  perform set_config('maz.review_client', 'on', true);
  update public.review_comments set tx = btrim(p_text)
   where id = p_id and round_id = v_round;
  /* เก็บธงทันทีหลังใช้ จะได้ไม่ค้างไปถึงคำสั่งอื่นในธุรกรรมเดียวกัน */
  perform set_config('maz.review_client', '', true);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.review_comment_del(p_token text, p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_round uuid := public.review_live(p_token);
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  delete from public.review_comments where id = p_id and round_id = v_round;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.review_file_approve(p_token text, p_file uuid, p_ok boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_round uuid := public.review_live(p_token);
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  update public.review_files set approved = coalesce(p_ok, false)
   where id = p_file and round_id = v_round;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end $$;

/**
 * ลูกค้าส่งรอบนี้ — p_all = กด "อนุมัติงานทั้งหมด"
 * ไม่มีคอมเมนต์และทุกไฟล์อนุมัติแล้ว = อนุมัติ · นอกนั้น = ส่งความเห็น
 * ส่งแล้วแก้อะไรไม่ได้อีก (review_live จะคืน null)
 */
create or replace function public.review_submit(p_token text, p_all boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_round    uuid := public.review_live(p_token);
  v_comments int;
  v_left     int;
  v_status   text;
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if p_all then
    update public.review_files set approved = true where round_id = v_round;
  end if;

  select count(*) into v_comments from public.review_comments where round_id = v_round;
  select count(*) into v_left from public.review_files where round_id = v_round and approved = false;
  v_status := case when v_left = 0 and (p_all or v_comments = 0) then 'approved' else 'submitted' end;

  update public.review_rounds
     set status = v_status, submitted_at = now()
   where id = v_round;

  return jsonb_build_object('ok', true, 'status', v_status, 'comments', v_comments);
end $$;

revoke all on function public.review_open(text) from public;
revoke all on function public.review_live(text) from public;
revoke all on function public.review_comment_add(text, uuid, text, text, int, text, jsonb, int, jsonb) from public;
revoke all on function public.review_comment_edit(text, uuid, text) from public;
revoke all on function public.review_comment_del(text, uuid) from public;
revoke all on function public.review_file_approve(text, uuid, boolean) from public;
revoke all on function public.review_submit(text, boolean) from public;

/* ลูกค้าไม่มีบัญชี — ให้สิทธิ์ anon เฉพาะฟังก์ชันชุดนี้ ซึ่งทำงานได้แค่กับรอบของโทเคนที่ส่งมา */
grant execute on function public.review_open(text) to anon, authenticated;
grant execute on function public.review_comment_add(text, uuid, text, text, int, text, jsonb, int, jsonb) to anon, authenticated;
grant execute on function public.review_comment_edit(text, uuid, text) to anon, authenticated;
grant execute on function public.review_comment_del(text, uuid) to anon, authenticated;
grant execute on function public.review_file_approve(text, uuid, boolean) to anon, authenticated;
grant execute on function public.review_submit(text, boolean) to anon, authenticated;
