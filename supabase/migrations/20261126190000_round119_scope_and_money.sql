/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 119 · สิทธิ์เห็นข้อมูลฝ่ายโครงการ (ตรวจระบบ 26 พ.ย. 2569)

   1 พนักงานเห็นทุกโปรเจคพร้อมมูลค่างานและเบอร์ลูกค้า — ต้องเห็นเฉพาะงานที่ได้รับ
   2 ผู้จัดการทั่วไปเห็นมูลค่างาน — ข้อกำหนดบอกว่าไม่เห็นเงินของบริษัท
   3 ลิงก์ตรวจงานที่หมดอายุแล้วยังเปิดไฟล์ได้ เพราะถังไฟล์เป็นถังสาธารณะ
   ═══════════════════════════════════════════════════════════════════ */

/* ── 1 พนักงานเห็นเฉพาะงานที่ได้รับ ───────────────────────────────
   ตัด staff ออกจาก can_see_pm() แล้วเปิดทางเฉพาะโปรเจคที่ตัวเองมีงานอยู่
   (ฝ่ายขาย บัญชี ก่อนการขาย ยังเห็นทั้งหมดเหมือนที่เห็นทุกดีลอยู่แล้ว) */
create or replace function public.can_see_pm() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role('pm')    or public.has_role('gm')  or public.has_role('ceo')
      or public.has_role('sales') or public.has_role('acc') or public.has_role('ps')
$$;

/** โปรเจคนี้เป็นงานของเราไหม — มีงานสักใบที่มอบหมายให้เรา */
create or replace function public.my_project(p_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.can_see_pm() or exists (
    select 1 from public.project_tasks t
     where t.project_id = p_id and public.owns_task(t.whos))
$$;

/** คุยเรื่องงานใบไหนได้ — ตารางนี้อ้างด้วยเลขโปรเจคกับชื่องาน ไม่ได้อ้างด้วยรหัส */
create or replace function public.my_task_talk(p_pj text, p_task text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.can_see_pm() or exists (
    select 1 from public.project_tasks t
      join public.projects p on p.id = t.project_id
     where p.pj = p_pj and t.name = p_task and public.owns_task(t.whos))
$$;

grant execute on function public.my_project(uuid), public.my_task_talk(text, text) to authenticated;

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated
  using (public.my_project(id));

drop policy if exists project_tasks_read on public.project_tasks;
create policy project_tasks_read on public.project_tasks for select to authenticated
  using (public.can_see_pm() or public.owns_task(whos));

drop policy if exists project_chat_read on public.project_chat;
create policy project_chat_read on public.project_chat for select to authenticated
  using (public.my_project(project_id));
drop policy if exists project_chat_write on public.project_chat;
create policy project_chat_write on public.project_chat for insert to authenticated
  with check (public.my_project(project_id));

drop policy if exists project_acts_read on public.project_acts;
create policy project_acts_read on public.project_acts for select to authenticated
  using (public.my_project(project_id));
drop policy if exists project_acts_write on public.project_acts;
create policy project_acts_write on public.project_acts for insert to authenticated
  with check (public.my_project(project_id));

drop policy if exists project_docs_read on public.project_docs;
create policy project_docs_read on public.project_docs for select to authenticated
  using (public.my_project(project_id));

drop policy if exists project_transfers_read on public.project_transfers;
create policy project_transfers_read on public.project_transfers for select to authenticated
  using (public.my_project(project_id));

drop policy if exists task_talks_read on public.task_talks;
create policy task_talks_read on public.task_talks for select to authenticated
  using (public.my_task_talk(pj, task_name));
drop policy if exists task_talks_write on public.task_talks;
create policy task_talks_write on public.task_talks for insert to authenticated
  with check (public.my_task_talk(pj, task_name));

/* งานเข้าใหม่ แผนงานร่าง และงานตรวจของลูกค้า เป็นของฝ่ายโครงการล้วน ๆ
   can_see_pm() ที่ตัด staff ออกแล้ว กันให้เองโดยไม่ต้องแก้นโยบาย */

/* ── 2 ผู้จัดการทั่วไปไม่เห็นเงินของบริษัท ────────────────────────
   ซ่อนเป็นรายช่อง ไม่ใช่รายแถว — ถอนสิทธิ์อ่านช่อง net ทิ้ง
   แล้วให้อ่านยอดผ่านฟังก์ชันที่ไม่คืนอะไรเลยให้ผู้จัดการทั่วไป */
create or replace function public.sees_money() returns boolean
language sql stable security definer set search_path = ''
as $$
  select not (public.has_role('gm')
              and not (public.has_role('ceo') or public.has_role('acc') or public.has_role('pm')))
$$;

/* อ่านเงินผ่านฟังก์ชันของมันเอง — คืนเฉพาะแถวที่คนเรียกมีสิทธิ์เห็น
   และคืนทั้งชุดว่างให้ผู้จัดการทั่วไป (เรียกทั้งชุดครั้งเดียวตอนโหลดหน้า) */
create or replace function public.project_money()
  returns table (id uuid, net numeric)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.net from public.projects p
   where public.sees_money() and public.my_project(p.id)
$$;

create or replace function public.inbox_money()
  returns table (id uuid, net numeric)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.net from public.project_inbox i
   where public.sees_money() and public.can_see_pm()
$$;

grant execute on function public.sees_money(), public.project_money(), public.inbox_money() to authenticated;

/* ถอนสิทธิ์อ่านทั้งตารางก่อน แล้วคืนให้ทีละช่องยกเว้น net
   (สิทธิ์ระดับตารางกลบสิทธิ์ระดับช่อง ถอนเฉพาะช่องอย่างเดียวจึงไม่มีผล)
   เพิ่มช่องใหม่ในสองตารางนี้ภายหลัง ต้อง grant ช่องนั้นให้ authenticated ด้วย */
do $$
declare
  v_t text;
  v_c text;
begin
  foreach v_t in array array['projects', 'project_inbox'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_c
      from information_schema.columns
     where table_schema = 'public' and table_name = v_t and column_name <> 'net';
    execute format('revoke select on public.%I from authenticated, anon', v_t);
    execute format('grant select (%s) on public.%I to authenticated', v_c, v_t);
  end loop;
end $$;

/* ── 3 ลิงก์ตรวจงานหมดอายุแล้วต้องเปิดไฟล์ไม่ได้ ──────────────────
   ถังเดิมเป็นถังสาธารณะ ใครเก็บที่อยู่ไฟล์ไว้ก็เปิดได้ตลอดไป
   เปลี่ยนเป็นถังปิด เก็บที่อยู่ในถังไว้ที่ path แล้วให้ฝั่งเซิร์ฟเวอร์
   ออกลิงก์ชั่วคราวเฉพาะรอบที่ยังไม่หมดอายุ */
alter table public.review_files add column if not exists path text;

update public.review_files
   set path = regexp_replace(url, '^.*/review/', '')
 where path is null and url like '%/review/%';

update storage.buckets set public = false where id = 'review';

drop policy if exists review_bucket_read on storage.objects;
create policy review_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'review' and public.can_see_pm());

/* ฟังก์ชันของลูกค้า — หมดอายุแล้วไม่ส่งทั้งที่อยู่ไฟล์และลิงก์
   ยังบอกรายชื่อไฟล์ไว้ให้รู้ว่ารอบนั้นมีอะไร แต่เปิดดูไม่ได้ */
create or replace function public.review_open(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_r    record;
  v_over boolean;
begin
  select * into v_r from public.review_rounds where token = p_token;
  if v_r.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  v_over := (now() at time zone 'Asia/Bangkok')::date > v_r.expires_at;

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
      'expired', v_over),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', f.name, 'kind', f.kind, 'size', f.size_text,
               'url', case when v_over then null else f.url end,
               'path', case when v_over then null else f.path end,
               'poster', case when v_over then null else f.poster end,
               'duration', f.duration,
               'approved', f.approved,
               'nameOnly', f.name_only or v_over) order by f.idx)
        from public.review_files f where f.round_id = v_r.id), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'fileId', c.file_id, 'author', c.author, 'text', c.tx,
               'at', c.at, 't', c.t, 'frame', c.frame, 'pin', c.pin,
               'page', c.page, 'attach', c.attach, 'done', c.done) order by c.at)
        from public.review_comments c where c.round_id = v_r.id), '[]'::jsonb));
end $$;

/* ให้ชั้น REST อ่านตารางกับฟังก์ชันใหม่ทันที ไม่ต้องรอรอบถัดไป */
notify pgrst, 'reload schema';
