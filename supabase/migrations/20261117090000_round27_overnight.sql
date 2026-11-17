-- ─── ตอกบัตรข้ามเที่ยงคืน ─────────────────────────────────────────
/*
 * เจ้าของสั่งทำ 17 พ.ย. 2569 — คนที่ทำโอทีดึกข้ามคืนต้องกดออกงานได้
 * กติกา: ใบออกต้องอยู่ภายใน 12 ชั่วโมงนับจากใบเข้า และลงวันเดียวกับใบเข้าเสมอ
 * (เวลาจริงที่กดยังบันทึกไว้ครบใน at — เปลี่ยนแค่ "วันของรอบงาน")
 */
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
