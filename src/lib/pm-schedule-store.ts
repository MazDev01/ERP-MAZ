"use client";

/*
 * ตารางงานของ PM — กิจกรรม รายละเอียดที่พิมพ์เอง และรายการที่ปิดงานแล้ว
 *
 * เก็บกิจกรรมทั้งก้อนในสโตร์ ไม่ใช่เก็บเฉพาะส่วนที่แก้
 * เพราะหน้านี้เพิ่มกิจกรรมใหม่และแก้ของเดิมได้ ถ้าเก็บแยกเป็น "ของเดิม + ส่วนที่แก้"
 * ต้องมีตรรกะรวมร่างทุกครั้งที่อ่าน ซึ่งพังง่ายกว่าตอนลบกิจกรรม
 *
 * รายละเอียด (notes) ยังแยกออกมา เพราะเป็นโน้ตของ PM คนละชั้นกับตัวนัด
 * กิจกรรมที่ยังไม่เคยแตะจะอ่านค่าตั้งต้นจาก todo ของมันเอง
 * จึงแยกออกได้ว่า "ยังไม่เคยเขียน" กับ "เขียนแล้วลบจนว่าง"
 *
 * ต่อฐานข้อมูลแล้ว (รอบที่ 110) — นัดหมายเป็นของทีม ผู้เข้าร่วมบนเครื่องอื่นต้องเห็นด้วย
 * รายละเอียดที่พิมพ์เองอยู่ในคอลัมน์ note ของใบนั้น (null = ยังไม่เคยเขียน)
 * ยังไม่ได้ต่อฐานข้อมูล (dev ที่ไม่มีคีย์) ถอยไปเก็บในเบราว์เซอร์เหมือนเดิม
 */

import { useSyncExternalStore } from "react";
import { bkkStamp } from "./format";
import {
  PM_EVENTS,
  type EventChange,
  type EventColor,
  type EventKind,
  type PmEvent,
} from "./pm-schedule-data";
import { createPersistedStore } from "./persisted-store";
import { hasBackend } from "./supabase/env";
import {
  fetchSchedule,
  sbAddEvent,
  sbCancelEvent,
  sbEditEvent,
  sbSaveNote,
} from "./supabase/schedule";

export type ScheduleState = {
  events: PmEvent[];
  /** ข้อความที่ PM พิมพ์เอง ทับค่าตั้งต้นจาก todo */
  notes: Record<string, string>;
};

const INITIAL: ScheduleState = { events: PM_EVENTS, notes: {} };

function isState(value: unknown): value is ScheduleState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return Array.isArray(s.events) && typeof s.notes === "object";
}

/* v5 — นัดหมายเก็บประวัติการแก้ (edits) เพิ่มจาก v4 ที่มีแค่ผู้สร้างกับการยกเลิก */
const store = createPersistedStore<ScheduleState>("maz-erp.pm-schedule.v5", INITIAL, isState);

/* ─── ชั้นต่อฐานข้อมูล ───────────────────────────────────────────── */
const live = hasBackend;
let fromDb: ScheduleState | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

const EMPTY: ScheduleState = { events: [], notes: {} };

function load() {
  if (!live || loading || fromDb !== null) return;
  loading = true;
  void fetchSchedule()
    .then((got) => {
      fromDb = got;
    })
    .catch(() => {
      fromDb = EMPTY;
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

function refresh() {
  if (!live) return;
  fromDb = null;
  loading = false;
  load();
  tell();
}

/** หน้าจอไม่รอผลลัพธ์ — เขียนแล้วค่อยอ่านตารางใหม่เมื่อฐานข้อมูลตอบ */
function after(job: Promise<unknown>) {
  void job.then(refresh, refresh);
}

function snapshot(): ScheduleState {
  if (!live) return store.get();
  load();
  return fromDb ?? EMPTY;
}

function subscribeAll(onChange: () => void) {
  const off = store.subscribe(onChange);
  watchers.add(onChange);
  return () => {
    off();
    watchers.delete(onChange);
  };
}

export function useSchedule() {
  return useSyncExternalStore(subscribeAll, snapshot, store.getServer);
}

export function resetSchedule() {
  if (live) {
    refresh();
    return;
  }
  store.reset();
}

export function saveNote(id: string, text: string) {
  if (live) {
    after(sbSaveNote(id, text));
    return;
  }
  store.update((s) => ({ ...s, notes: { ...s.notes, [id]: text } }));
}

export type EventDraft = {
  title: string;
  kind: EventKind;
  date: string;
  dateEnd: string;
  from: string;
  to: string;
  place: string;
  /** เลขที่โปรเจค (PJ-) ที่เกี่ยวข้อง — ว่างคือไม่ผูกกับโปรเจคไหน */
  pj: string;
  who: string[];
  note: string;
  col: EventColor;
  /** ผู้สร้าง — PM · GM · ทีมก่อนการขาย (เจ้าของสั่ง 24 และ 25 ก.ย. 2569) ไม่ส่งมา = PM */
  by?: "pm" | "gm" | "ps" | "sales";
  /** เลขที่คำขอก่อนการขายที่นัดนี้ผูกอยู่ — บังคับเมื่อ by เป็น ps */
  ps?: string;
};

/**
 * เพิ่มกิจกรรมใหม่ — คืนรหัสที่สร้าง เพื่อให้หน้าจอเลือกใบนั้นต่อได้ทันที
 *
 * รหัสนับจากจำนวนใบที่มี ไม่ได้ใช้เวลาปัจจุบัน เพราะการสร้างรหัสจากนาฬิกา
 * ทำให้ผลลัพธ์ต่างกันทุกครั้งที่รัน ซึ่งกฎ purity ของโปรเจคนี้ห้ามไว้
 */
export function addEvent(d: EventDraft) {
  if (live) {
    /* รหัสออกจากฝั่งนี้ เพราะหน้าจอต้องเลือกใบที่เพิ่งสร้างต่อทันที ไม่รอฐานข้อมูลตอบ */
    const id = crypto.randomUUID();
    after(sbAddEvent(id, d));
    return id;
  }
  const id = `EVN${store.get().events.length + 1}`;
  store.update((s) => ({
    ...s,
    events: [
      ...s.events,
      {
        id,
        date: d.date,
        dateEnd: d.dateEnd,
        from: d.from,
        to: d.to,
        kind: d.kind,
        col: d.col,
        title: d.title,
        place: d.place || "ยังไม่ระบุสถานที่",
        pj: d.pj,
        who: d.who,
        todo: [],
        by: d.by ?? "pm",
        ps: d.ps,
      },
    ],
    notes: { ...s.notes, [id]: d.note },
  }));
  return id;
}

/** ช่วงวันของนัดเป็นข้อความเดียว — ใช้เทียบว่า "วันเปลี่ยนไหม" ทั้งนัดวันเดียวและนัดข้ามวัน */
const spanOf = (date: string, dateEnd?: string) =>
  dateEnd && dateEnd > date ? `${date}~${dateEnd}` : date;

/**
 * สิ่งที่เปลี่ยนไปจากใบเดิม — คืน undefined ถ้าไม่มีอะไรที่ผู้เข้าร่วมต้องรู้
 *
 * เทียบเฉพาะวัน เวลา และรายชื่อผู้เข้าร่วม ตามที่เจ้าของสั่ง (24 ก.ย. 2569)
 * แก้หัวข้อ สถานที่ หรือสีไม่ต้องกวนใคร เพราะไม่ได้ทำให้ใครต้องเปลี่ยนแผน
 */
function diffEvent(before: PmEvent, d: EventDraft, by: string): EventChange | undefined {
  const b = spanOf(before.date, before.dateEnd);
  const a = spanOf(d.date, d.dateEnd);
  const bt = `${before.from}-${before.to}`;
  const at = `${d.from}-${d.to}`;
  const added = d.who.filter((x) => !before.who.includes(x));
  const removed = before.who.filter((x) => !d.who.includes(x));
  if (b === a && bt === at && !added.length && !removed.length) return undefined;
  return {
    at: bkkStamp(),
    by,
    date: b === a ? undefined : { before: b, after: a },
    time: bt === at ? undefined : { before: bt, after: at },
    added,
    removed,
  };
}

/**
 * แก้กิจกรรมเดิม — เปลี่ยนประเภทได้ เพราะนัดที่เลื่อนแล้วอาจกลายเป็นนัดคนละแบบ
 *
 * บันทึกประวัติไว้ด้วยว่าใครแก้ เปลี่ยนวันเวลาจากอะไรเป็นอะไร และถอดใครออก
 * เพราะคนที่ถูกถอดออกจะไม่เห็นนัดนี้ในปฏิทินตัวเองอีก ตัวใบจึงเป็นที่เดียว
 * ที่ยังจำได้ว่าเขาเคยถูกเชิญ — กระดิ่งแจ้งเตือนอ่านจากตรงนี้
 */
export function editEvent(id: string, d: EventDraft, by: string) {
  if (live) {
    const before = snapshot().events.find((e) => e.id === id);
    after(sbEditEvent(id, d, before ? diffEvent(before, d, by) : undefined));
    return;
  }
  store.update((s) => ({
    ...s,
    events: s.events.map((e) => {
      if (e.id !== id) return e;
      const change = diffEvent(e, d, by);
      return {
        ...e,
        title: d.title,
        kind: d.kind,
        date: d.date,
        dateEnd: d.dateEnd,
        from: d.from,
        to: d.to,
        col: d.col,
        place: d.place || "ยังไม่ระบุสถานที่",
        pj: d.pj,
        who: d.who,
        edits: change ? [...(e.edits ?? []), change] : e.edits,
      };
    }),
    notes: { ...s.notes, [id]: d.note },
  }));
}

/**
 * ยกเลิกนัดหมาย — เก็บใบไว้เป็นประวัติ ไม่ลบหาย (ยูสเคส PM-06 BR-03)
 *
 * เดิมหน้านี้ลบทิ้งจริง เพราะคิดว่าตารางเป็นของ PM คนเดียว
 * แต่ตั้งแต่ 24 ก.ย. 2569 นัดหมายมีผู้เข้าร่วมคนอื่นที่กันเวลาไว้แล้ว
 * จึงต้องย้อนดูได้ว่าใบนี้เคยมีอยู่ ใครยกเลิก เมื่อไร และด้วยเหตุผลอะไร
 * โน้ตของใบนั้นเก็บไว้ด้วย เพราะเป็นส่วนหนึ่งของประวัติ
 *
 * เหตุผลเป็นของบังคับ (เจ้าของสั่ง 24 ก.ย. 2569) — ข้อความแจ้งเตือนที่ผู้เข้าร่วมได้รับ
 * คือเหตุผลบรรทัดนี้ ถ้าปล่อยว่างเขาก็ได้แค่ข่าวว่ายกเลิก แล้วต้องเดินมาถามอยู่ดี
 * หน้าจอกันไว้ตั้งแต่ปุ่มบันทึก ที่นี่จึงแค่ตัดช่องว่างหัวท้าย
 */
export function cancelEvent(id: string, by: string, why: string) {
  if (live) {
    after(sbCancelEvent(id, by, why.trim()));
    return;
  }
  store.update((s) => ({
    ...s,
    events: s.events.map((e) =>
      e.id === id ? { ...e, cancel: { at: bkkStamp(), by, why: why.trim() } } : e,
    ),
  }));
}
