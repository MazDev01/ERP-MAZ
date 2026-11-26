/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 124 · กติกาที่ยังไม่ตรงข้อกำหนด (ตรวจระบบ 26 พ.ย. 2569)

   1 พนักงานที่ถือใบงานแก้ได้ทุกช่อง — ตั้งเสร็จเอง ใส่ % เอง เลื่อนกำหนดส่ง
     และเพิ่มคนในงานได้ · ข้อกำหนด: พนักงานทำได้แค่ "ส่งงาน"
     ส่วนผ่าน/เสร็จเป็นของฝ่ายโครงการกับลูกค้า และไม่มีการกรอก %
   2 ใบโอทีไม่ตรวจชั่วโมงกับช่วงเวลา — ช่วง 2 ชม. ขอ 9 ชม. ได้
   3 ผลตรวจของลูกค้าไม่ขยับสถานะใบงานเอง ต้องรอฝ่ายโครงการกดอีกที
     ข้อกำหนด: ลูกค้าอนุมัติ = งานเสร็จ · ลูกค้าขอแก้ = งานกลับไปแก้
   4 ลงเวลารับพิกัดที่ความแม่นยำแย่มาก (±5 กม.) ถ้าจุดอยู่ในรัศมี
   5 ฝ่ายโครงการแก้มูลค่างานของโปรเจคได้ตรง ๆ ทั้งที่เป็นเงินของดีล
   ═══════════════════════════════════════════════════════════════════ */

/* ── 1 พนักงานทำได้แค่ส่งงาน ──────────────────────────────────────
   ฝ่ายโครงการ (รวม GM/CEO) แก้ได้เหมือนเดิม · คนที่ถืองานแก้ได้เฉพาะ
   ช่องของการส่งงาน คือสถานะเป็น "sent" พร้อมแนบงานที่ส่ง */
create or replace function public.task_staff_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /* งานของระบบเองผ่านได้ — ฟังก์ชันที่รันด้วยสิทธิ์เจ้าของ (เช่นผลตรวจของลูกค้า)
     และงานดูแลฐานข้อมูล ไม่มีผู้ใช้ที่ล็อกอินอยู่ */
  if auth.uid() is null or public.can_edit_pm() then
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

  /* ช่องที่พนักงานแตะไม่ได้ — ใครถืองาน กำหนดส่ง ชื่องาน ลำดับ ขั้นงาน และ %
     (ข้อกำหนดไม่ให้พนักงานกรอกเปอร์เซ็นต์ความคืบหน้า) */
  if new.whos is distinct from old.whos
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

drop trigger if exists project_tasks_staff_limit on public.project_tasks;
create trigger project_tasks_staff_limit before update on public.project_tasks
  for each row execute function public.task_staff_limit();

/* ── 2 ชั่วโมงที่อนุมัติต้องไม่เกินที่ขอ ──────────────────────────
   ชั่วโมงของใบขอ ฐานข้อมูลคิดจากช่วงเวลาให้เองแล้ว (guard_ot_request) และ
   แก้ภายหลังไม่ได้ (lock_ot_edit) — ตรวจแล้วว่ากรอก 9 ชม. ในช่วง 2 ชม.
   ระบบบันทึกเป็น 2 ชม. จึงไม่ใช่ช่องโหว่ตามที่รายงาน
   ที่ยังไม่มีใครกันคือ "ชั่วโมงที่อนุมัติ" ซึ่งใส่เกินที่ขอได้ */
create or replace function public.ot_hours_fit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.approved_hours, 0) > coalesce(new.hours, 0) + 0.001 then
    raise exception 'อนุมัติ % ชั่วโมง เกินที่ขอไว้ % ชั่วโมง',
      new.approved_hours, new.hours using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists ot_requests_hours_fit on public.ot_requests;
create trigger ot_requests_hours_fit before insert or update of hours, approved_hours
  on public.ot_requests
  for each row execute function public.ot_hours_fit();

/* ── 3 ผลตรวจของลูกค้าขยับสถานะใบงานเอง ──────────────────────────
   ลูกค้าอนุมัติครบ = งานเสร็จ · ส่งคอมเมนต์มา = งานกลับไปแก้
   ขยับเฉพาะใบที่กำลังรอลูกค้าตรวจ (wait) ฝ่ายโครงการยังกดซ้ำได้ ไม่เสียหาย */
create or replace function public.review_submit(p_token text, p_all boolean default false)
  returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round    uuid := public.review_live(p_token);
  v_comments int;
  v_left     int;
  v_status   text;
  v_r        record;
  v_task     int := 0;
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
   where id = v_round
  returning * into v_r;

  update public.project_tasks t
     set status  = case when v_status = 'approved' then 'done' else 'revise' end,
         pct     = case when v_status = 'approved' then 100 else t.pct end,
         done_at = case when v_status = 'approved' then now() else t.done_at end,
         back    = case when v_status = 'approved' then null
                        else jsonb_build_object('why', 'ลูกค้าขอแก้ ' || v_comments || ' จุด',
                                                'at', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
                                                'by', 'ลูกค้า') end
   where t.project_id = v_r.project_id
     and t.name = v_r.task_name
     and t.status = 'wait';
  get diagnostics v_task = row_count;

  if v_task > 0 then
    insert into public.project_acts (project_id, kind, who, at, tx)
    values (v_r.project_id,
            case when v_status = 'approved' then 'done' else 'status' end,
            'ลูกค้า', now(),
            case when v_status = 'approved'
                 then 'ลูกค้าอนุมัติ ' || v_r.task_name || ' รอบที่ ' || v_r.round
                 else 'ลูกค้าขอแก้ ' || v_r.task_name || ' รอบที่ ' || v_r.round end);
  end if;

  return jsonb_build_object('ok', true, 'status', v_status, 'comments', v_comments, 'task', v_task);
end $$;

grant execute on function public.review_submit(text, boolean) to anon, authenticated;

/* ── 4 พิกัดที่ความแม่นยำแย่เกินไป ไม่รับลงเวลา ───────────────────
   เกณฑ์เก็บเป็นค่าตั้งค่า (rates.gpsAccMaxM) ตั้งได้ที่หน้าอัตราและภาษี
   0 = ไม่ตรวจ · ของเดิมเอาค่าความแม่นยำไปใช้แค่เลือกข้อความบอกเหตุผล */
create or replace function public.gps_acc_max() returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce((select (s.data -> 'rates' ->> 'gpsAccMaxM')::numeric
                     from public.system_settings s order by s.updated_at desc limit 1), 100)
$$;

grant execute on function public.gps_acc_max() to authenticated;

update public.system_settings
   set data = jsonb_set(data, '{rates,gpsAccMaxM}',
                        coalesce(data -> 'rates' -> 'gpsAccMaxM', to_jsonb(100)), true)
 where data ? 'rates';

/* ── 5 มูลค่างานของโปรเจคแก้ตรง ๆ ไม่ได้ ──────────────────────────
   เงินมาจากดีล ไม่ใช่ของที่ฝ่ายโครงการกรอก · ตอนสร้างโปรเจคยังใส่ได้
   (มาจากกล่องงานที่ฐานข้อมูลเขียนให้) แต่แก้ภายหลังต้องแก้ที่ดีล */
/* สิทธิ์ระดับตารางกลบระดับช่อง (เจอมาแล้วในรอบที่ 119) ต้องถอนทั้งตารางแล้วคืนรายช่อง
   เพิ่มช่องใหม่ในสองตารางนี้ภายหลัง ต้อง grant update ของช่องนั้นด้วย */
do $$
declare
  v_t text;
  v_c text;
begin
  foreach v_t in array array['projects', 'project_inbox'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_c
      from information_schema.columns
     where table_schema = 'public' and table_name = v_t and column_name <> 'net';
    execute format('revoke update on public.%I from authenticated, anon', v_t);
    execute format('grant update (%s) on public.%I to authenticated', v_c, v_t);
  end loop;
end $$;

/* ── ลงเวลา: ใช้เกณฑ์ความแม่นยำจากค่าตั้งค่า ── */
create or replace function public.clock_punch(p_type text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_acc double precision DEFAULT NULL::double precision, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.my_employee_id();
  v_at    timestamptz := clock_timestamp();
  v_day   date := (clock_timestamp() at time zone 'Asia/Bangkok')::date;
  v_last  public.punches;
  v_area  public.work_areas;
  v_dist  double precision;
  v_row   public.punches;
begin
  if v_emp is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  if p_type is null or p_type not in ('in', 'out') then
    return jsonb_build_object('ok', false, 'reason', 'bad_type');
  end if;

  /* กดซ้ำสองแท็บพร้อมกันต้องได้รายการเดียว */
  perform pg_advisory_xact_lock(hashtext('punch:' || v_emp::text));

  select * into v_last from public.punches
  where employee_id = v_emp order by at desc limit 1;

  if p_type = 'in' then
    if v_last.type = 'in' and v_last.work_date = v_day then
      return jsonb_build_object('ok', false, 'reason', 'already_in');
    end if;
    if p_lat is null or p_lng is null or p_acc is null
       or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_acc < 0 then
      return jsonb_build_object('ok', false, 'reason', 'nogps');
    end if;
    /* ความแม่นยำแย่เกินเกณฑ์ = ยังไม่รู้ว่าอยู่ที่ไหนจริง ไม่รับลงเวลา (รอบที่ 124)
       เกณฑ์อยู่ในค่าตั้งค่า · ของเดิมเอาค่านี้ไปใช้แค่เลือกข้อความบอกเหตุผล */
    if public.gps_acc_max() > 0 and p_acc > public.gps_acc_max() then
      return jsonb_build_object('ok', false, 'reason', 'weak',
                                'acc', round(p_acc), 'max', public.gps_acc_max());
    end if;

    select * into v_area from public.work_areas where active limit 1;
    if v_area.id is null then
      return jsonb_build_object('ok', false, 'reason', 'no_area');
    end if;

    /* haversine — สูตรเดียวกับ distanceM ใน work-area.ts */
    v_dist := 2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat - v_area.lat) / 2), 2)
      + cos(radians(v_area.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_area.lng) / 2), 2)
    ));

    if v_dist > v_area.radius_m then
      return jsonb_build_object(
        'ok', false,
        'reason', case when p_acc > 100 then 'weak' else 'outside' end,
        'dist', round(v_dist),
        'area', v_area.name,
        'radius', v_area.radius_m
      );
    end if;

    insert into public.punches (employee_id, type, at, work_date, lat, lng, acc, geo_status, area_id, area_name, dist_m, note, created_by)
    values (v_emp, 'in', v_at, v_day, p_lat, p_lng, round(p_acc), 'inside', v_area.id, v_area.name, round(v_dist), left(coalesce(p_note, ''), 500), auth.uid())
    returning * into v_row;
  else
    if v_last.id is null or v_last.type <> 'in' then
      return jsonb_build_object('ok', false, 'reason', 'not_in');
    end if;
    /*
     * ทำงานข้ามเที่ยงคืน — เข้า 5 ทุ่ม ออกตี 1 ยังเป็นงานของ "วันที่เข้า"
     * ของเดิมบังคับให้ใบออกอยู่วันเดียวกับใบเข้า คนทำโอทีดึกจึงกดออกไม่ได้เลย
     * ยอมข้ามวันได้ไม่เกิน 12 ชั่วโมงนับจากเวลาเข้า เกินกว่านั้นถือว่าลืมตอกออก
     * ให้ฝ่ายบุคคลเติมเวลาย้อนหลังแทน (hr_fill_punch) จะได้มีเหตุผลกำกับ
     */
    if v_last.work_date <> v_day and v_at - v_last.at > interval '12 hours' then
      return jsonb_build_object('ok', false, 'reason', 'too_late');
    end if;

    /* ใบออกลงวันเดียวกับใบเข้าเสมอ ชั่วโมงทำงานของคืนนั้นจะได้ไม่ถูกตัดครึ่ง */
    insert into public.punches (employee_id, type, at, work_date, note, created_by)
    values (v_emp, 'out', v_at, v_last.work_date, left(coalesce(p_note, ''), 500), auth.uid())
    returning * into v_row;
  end if;

  return jsonb_build_object('ok', true, 'punch', to_jsonb(v_row));
end $function$
;

notify pgrst, 'reload schema';
