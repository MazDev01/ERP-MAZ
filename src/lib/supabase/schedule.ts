"use client";

import { signedIn, supabase } from "./client";
import { myId } from "./people";
import type { EventChange, EventColor, EventKind, PmEvent } from "../pm-schedule-data";
import type { EventDraft, ScheduleState } from "../pm-schedule-store";

/*
 * ตารางงานของฝ่ายโครงการ (รอบที่ 110)
 *
 * ใบนัดอยู่ในแถวเดียว ส่วนประวัติการแก้อยู่อีกตาราง ต่อท้ายได้แก้ไม่ได้
 * รายละเอียดที่ PM พิมพ์เองเก็บในคอลัมน์ note — null = ยังไม่เคยเขียน
 * หน้าจอจึงแยกออกได้ว่า "ยังไม่เคยเขียน" (ใช้ todo เป็นค่าตั้งต้น) กับ "เขียนแล้วลบจนว่าง"
 */

/** "yyyy-mm-dd HH:mm" ตามเวลาไทย */
function stampOf(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

type EventRow = {
  id: string;
  on_date: string;
  date_end: string | null;
  from_time: string;
  to_time: string;
  kind: string;
  col: string;
  title: string;
  place: string;
  pj: string;
  who: string[] | null;
  todo: string[] | null;
  by_role: string;
  ps_no: string;
  note: string | null;
  cancel_at: string | null;
  cancel_by: string;
  cancel_why: string;
};

type EditRow = {
  event_id: string;
  at: string;
  by_name: string;
  date_before: string;
  date_after: string;
  time_before: string;
  time_after: string;
  added: string[] | null;
  removed: string[] | null;
};

const EVENT_COLS =
  "id, on_date, date_end, from_time, to_time, kind, col, title, place, pj, who, todo," +
  " by_role, ps_no, note, cancel_at, cancel_by, cancel_why";

const BY_ROLES: PmEvent["by"][] = ["pm", "gm", "ps", "sales"];

export async function fetchSchedule(): Promise<ScheduleState> {
  const empty: ScheduleState = { events: [], notes: {} };
  const sb = supabase();
  if (!sb || !(await signedIn())) return empty;

  const [evs, edits] = await Promise.all([
    sb.from("pm_events").select(EVENT_COLS).order("on_date"),
    sb
      .from("pm_event_edits")
      .select("event_id, at, by_name, date_before, date_after, time_before, time_after, added, removed")
      .order("at"),
  ]);
  if (evs.error || edits.error) return empty;

  const byEvent = new Map<string, EventChange[]>();
  for (const r of (edits.data ?? []) as unknown as EditRow[]) {
    const c: EventChange = {
      at: stampOf(r.at),
      by: r.by_name,
      date: r.date_before || r.date_after ? { before: r.date_before, after: r.date_after } : undefined,
      time: r.time_before || r.time_after ? { before: r.time_before, after: r.time_after } : undefined,
      added: r.added ?? [],
      removed: r.removed ?? [],
    };
    byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), c]);
  }

  const notes: Record<string, string> = {};
  const events = ((evs.data ?? []) as unknown as EventRow[]).map<PmEvent>((r) => {
    if (r.note !== null) notes[r.id] = r.note;
    const edited = byEvent.get(r.id);
    return {
      id: r.id,
      date: r.on_date,
      dateEnd: r.date_end ?? undefined,
      from: r.from_time,
      to: r.to_time,
      kind: r.kind as EventKind,
      col: (r.col || undefined) as EventColor | undefined,
      title: r.title,
      place: r.place,
      pj: r.pj || undefined,
      who: r.who ?? [],
      todo: r.todo ?? [],
      by: (BY_ROLES.includes(r.by_role as PmEvent["by"]) ? r.by_role : "pm") as PmEvent["by"],
      ps: r.ps_no || undefined,
      cancel: r.cancel_at
        ? { at: stampOf(r.cancel_at), by: r.cancel_by, why: r.cancel_why }
        : undefined,
      edits: edited?.length ? edited : undefined,
    };
  });
  return { events, notes };
}

function toRow(d: EventDraft) {
  return {
    on_date: d.date,
    date_end: d.dateEnd || null,
    from_time: d.from,
    to_time: d.to,
    kind: d.kind,
    col: d.col ?? "",
    title: d.title,
    place: d.place || "ยังไม่ระบุสถานที่",
    pj: d.pj ?? "",
    who: d.who,
    by_role: d.by ?? "pm",
    ps_no: d.ps ?? "",
  };
}

export async function sbAddEvent(id: string, d: EventDraft) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("pm_events").insert({ ...toRow(d), id, todo: [], note: d.note, created_by: myId() });
}

export async function sbEditEvent(id: string, d: EventDraft, change?: EventChange) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  /* ผู้สร้างและคำขอที่ผูกไว้ของใบเดิมไม่เปลี่ยนตอนแก้ — ส่งไปเฉพาะช่องที่หน้าจอแก้ได้ */
  const row = toRow(d);
  delete (row as Partial<typeof row>).by_role;
  delete (row as Partial<typeof row>).ps_no;
  await sb.from("pm_events").update({ ...row, note: d.note }).eq("id", id);
  if (!change) return;
  await sb.from("pm_event_edits").insert({
    event_id: id,
    by_name: change.by,
    date_before: change.date?.before ?? "",
    date_after: change.date?.after ?? "",
    time_before: change.time?.before ?? "",
    time_after: change.time?.after ?? "",
    added: change.added,
    removed: change.removed,
  });
}

export async function sbSaveNote(id: string, text: string) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("pm_events").update({ note: text }).eq("id", id);
}

export async function sbCancelEvent(id: string, by: string, why: string) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.rpc("pm_event_cancel", { p_event: id, p_by: by, p_why: why });
}
