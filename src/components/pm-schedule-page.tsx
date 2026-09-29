"use client";

/*
 * ตารางงานของ PM — ใช้ปฏิทินชุดเดียวกับทุกบทบาท (schedule-board.tsx)
 *
 * เจ้าของสั่ง 24 ก.ย. 2569 ว่าหน้าตารางงานต้องหน้าตาเหมือนกันทุกอัน
 * (โครงชุดเดียวกันเคยแยกเป็นปฏิทินเต็มกับปฏิทินสรุป — ยกเลิกแล้ว)
 * ต่างกันแค่ว่าในปฏิทินมีอะไร และใครเพิ่มนัดได้ — PM กับ GM เท่านั้น
 *
 * ซ้ายเป็นของที่ใช้คุมมุมมอง (ตัวกรองประเภท และรายการนัดของวันที่เลือก)
 * ขวาเป็นปฏิทินเดือนหรือสัปดาห์ ที่ตอบว่าเดือนนี้ยุ่งช่วงไหนและวันไหนชนกัน
 *
 * กดช่องวัน = เลือกวันนั้น (รายการทางซ้ายเปลี่ยนตาม) และเปิดฟอร์มเพิ่มนัดของวันนั้นทันที
 * ปุ่ม "เพิ่มนัดหมาย" บนแถบหัวเรื่องเพิ่มนัดของวันที่เลือกอยู่
 * กดที่แถบนัด = เปิดแก้ใบนั้น · นัดที่ผ่านไปแล้วจางลง จะได้เห็นว่าอะไรยังรออยู่
 * GM ที่เปิดหน้านี้เป็นโหมดดูอย่างเดียว (pm-readonly.tsx) — ปฏิทินนัดของ GM คือ /gm/calendar
 *
 * ยกเลิกนัดไม่ได้ลบใบทิ้ง แต่เก็บไว้เป็นประวัติ (ยูสเคส PM-06 BR-03)
 * ใบที่ยกเลิกแล้วหายจากปฏิทิน แต่ยังอยู่ในรายการของวันนั้นแบบขีดฆ่า
 *
 * วันหยุดราชการแสดงเป็นแถบทึบที่กดไม่ได้ อ่านจาก holidays.ts ชุดเดียวกับที่ใบลาใช้นับวัน
 * ตารางงานกับการนับวันลาจึงไม่มีทางเห็นวันหยุดไม่ตรงกัน
 *
 * ทุกลิงก์ในหน้านี้อยู่ในหน้าของ PM เท่านั้น ไม่พาข้ามไปหน้าของบทบาทอื่น
 */

import { useState } from "react";
import { projName } from "@/lib/pm-data";
import { thaiDate } from "@/lib/format";
import { usePm, useTeam } from "@/lib/pm-store";
import { USERS } from "@/lib/mock-data";
import {
  KIND_COLOR,
  PM_COLORS,
  eventKind,
  eventKinds,
  chipTime,
  colorOf,
  dayDiff,
  endOf,
  eventPaint,
  isPsEvent,
  type EventKind,
  type PmEvent,
} from "@/lib/pm-schedule-data";
import {
  addEvent,
  cancelEvent,
  editEvent,
  useSchedule,
  type EventDraft,
} from "@/lib/pm-schedule-store";
import { AppointmentSheet } from "./appointment-sheet";
import { PlusIcon } from "./icons";
import { Sheet } from "./lead-dialogs";
import { ReadOnlyNote, usePmReadOnly } from "./pm-readonly";
import { ScheduleBoard, useBoardNav, type BoardEvent, type BoardKind } from "./schedule-board";
import { ThaiDatePicker } from "./thai-date-picker";
import { Field, Input, Select } from "./ui";
import { useAddOption } from "./add-option";

/* ประเภทนัดอ่านจากข้อมูลหลักทุกครั้ง — ฝ่ายบุคคลเพิ่ม/แก้ชื่อได้ที่ /admin/options */
const kindList = () => eventKinds();

/** ตัวคั่นบรรทัด — แยกเป็นค่าคงที่ เพราะสตริงขึ้นบรรทัดใหม่ใน JSX อ่านยาก */
const NEWLINE = String.fromCharCode(10);

/** ป้ายประเภทนัดของ PM — สีเดียวกับจุดในปฏิทินสรุปของหน้าอื่น */
const pmBoardKinds = (): BoardKind[] => kindList().map((k) => ({ key: k.key, label: k.label, color: k.dot }));

/** แปลงนัดของ PM เป็นรายการบนปฏิทิน — สีที่เลือกเองมาก่อนสีของประเภท */
function pmBoardEvent(e: PmEvent): BoardEvent<PmEvent> {
  const paint = eventPaint(e);
  return {
    id: e.id,
    kind: e.kind,
    start: e.date,
    end: endOf(e),
    title: e.title,
    time: e.from,
    timeEnd: e.to,
    chip: (day) => chipTime(e, day),
    sub: e.place || undefined,
    dot: e.col ? colorOf(e.col).fg : eventKind(e.kind).dot,
    paint: { cls: paint.cls, style: paint.style },
    tip: `${e.title} · ${thaiDate(e.date)}${endOf(e) > e.date ? ` – ${thaiDate(endOf(e))}` : ""} · ${e.from} – ${e.to}`,
    /* ใบที่ยกเลิกแล้วไม่ขึ้นเป็นแถบในปฏิทิน แต่ยังอยู่ในรายการของวันแบบขีดฆ่า */
    cancelled: Boolean(e.cancel),
    data: e,
  };
}

export function PmSchedulePage() {
  const sc = useSchedule();
  const nav = useBoardNav();
  /* GM เปิดหน้าของ PM ได้แบบดูอย่างเดียว — สร้างหรือแก้นัดของ PM ไม่ได้ */
  const ro = usePmReadOnly();
  const canEdit = !ro;

  /* ว่างอยู่ = ปิด · มี date = เพิ่มใบใหม่ของวันนั้น · มี event = แก้ใบเดิม */
  const [editing, setEditing] = useState<{ date: string; event?: PmEvent } | null>(null);
  /* ใบที่ยกเลิกแล้วและคนที่แก้ไม่ได้ เปิดได้แค่ดู จึงเก็บคนละตัวกับกล่องแก้ไข */
  const [viewing, setViewing] = useState<PmEvent | null>(null);

  /** กดที่นัดหนึ่งใบ — ใบที่ยังใช้งานอยู่เปิดแก้ไข ใบที่ยกเลิกแล้วเปิดดูประวัติ */
  function openEvent(e: PmEvent) {
    if (canEdit && !e.cancel) setEditing({ date: e.date, event: e });
    else setViewing(e);
  }

  /*
   * นัดที่ทีมก่อนการขายตั้งเองไม่ขึ้นที่นี่ (เจ้าของตัดสิน 25 ก.ย. 2569)
   * งานช่วงก่อนการขายยังไม่มีดีลและยังไม่ใช่ความรับผิดชอบของ PM
   */
  const events = sc.events.filter((e) => !isPsEvent(e)).map(pmBoardEvent);

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1>ตารางงาน</h1>
          <p>
            {canEdit
              ? "นัดหมายและกิจกรรมของผู้จัดการโครงการ กดวันในปฏิทินเพื่อเพิ่มนัดของวันนั้น"
              : "นัดหมายของผู้จัดการโครงการ กดวันเพื่อดูนัดของวันนั้น"}
          </p>
        </div>
        {canEdit && (
          <div className="tools">
            {/* มือถือใช้ปุ่ม "+ เพิ่มนัดหมาย" ในการ์ดนัดของวันที่เลือก (schedule-board) จึงซ่อนปุ่มนี้
                ซ่อนที่ตัวครอบ ไม่ใช่ที่ปุ่ม เพราะ .btn ใน globals.css ตั้ง display ไว้นอก @layer
                คลาส hidden ของ Tailwind อยู่ในเลเยอร์ จึงแพ้ แล้วปุ่มก็โผล่ทั้งสองขนาดจอ */}
            <span className="max-sm:hidden">
              <button
                type="button"
                className="btn solid btn-solid"
                title={`เพิ่มนัดหมายวันที่ ${thaiDate(nav.sel)}`}
                onClick={() => setEditing({ date: nav.sel })}
              >
                <PlusIcon className="size-3.5" strokeWidth={2.4} />
                เพิ่มนัดหมาย
              </button>
            </span>
          </div>
        )}
      </div>

      <ReadOnlyNote />

      <ScheduleBoard
        nav={nav}
        events={events}
        kinds={pmBoardKinds()}
        /* คำแนะนำตามโครงหน้า · คนที่แก้ไม่ได้ให้บอกวิธีใช้ตัวกรองแทน */
        hint={
          canEdit
            ? "กดที่ช่องวันในปฏิทินเพื่อเพิ่มนัดของวันนั้น"
            : "กดที่ประเภทเพื่อซ่อนหรือแสดงในปฏิทิน นับจากนัดทั้งหมดที่มี"
        }
        onOpen={(e) => openEvent(e.data)}
        onAdd={canEdit ? (day) => setEditing({ date: day }) : undefined}
      />

      {viewing && (
        <AppointmentSheet
          event={viewing}
          note={sc.notes[viewing.id] ?? viewing.todo.join(NEWLINE)}
          onClose={() => setViewing(null)}
        />
      )}

      {editing && (
        <EventForm
          day={editing.date}
          event={editing.event}
          note={editing.event ? (sc.notes[editing.event.id] ?? editing.event.todo.join(NEWLINE)) : ""}
          onClose={() => setEditing(null)}
          onSaved={(date) => {
            /* พาปฏิทินไปที่วันของนัดที่เพิ่งบันทึก จะได้เห็นทันทีว่ามันลงไปแล้ว */
            nav.jumpTo(date);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}


/*
 * เหตุผลตอนยกเลิกเป็นของบังคับ (เจ้าของสั่ง 24 ก.ย. 2569)
 * คนที่กันเวลาไว้แล้วได้รับแจ้งว่า "ยกเลิก" เฉย ๆ ก็ต้องเดินมาถามอยู่ดี
 */
const CANCEL_WARN = "กรอกเหตุผลที่ยกเลิกก่อน — ผู้เข้าร่วมจะเห็นข้อความนี้ในแจ้งเตือน";

/*
 * บอกให้ตรงช่องที่ยังไม่ผ่าน (เจ้าของสั่ง 25 ก.ย. 2569)
 * เดิมขึ้นข้อความรวมสามบรรทัดเหมือนกันทุกกรณี คนกรอกต้องไล่หาเองว่าผิดช่องไหน
 */
function saveWarn(f: EventDraft, multi: boolean) {
  const bad: string[] = [];
  if (!f.title.trim()) bad.push("หัวข้อ");
  if (!f.date) bad.push("วันที่");
  if (!f.from) bad.push("เวลาเริ่ม");
  if (!f.to) bad.push("เวลาสิ้นสุด");
  if (bad.length) return `ยังไม่ได้กรอก${bad.join(" · ")}`;
  if (f.dateEnd < f.date) return "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม";
  if (!multi && f.to <= f.from) return "นัดวันเดียว เวลาเริ่มต้องไม่หลังเวลาสิ้นสุด";
  return "";
}

// ─── ฟอร์มเพิ่ม / แก้ / ยกเลิกนัดหมาย ─────────────────────────────

function EventForm({
  day,
  event,
  note,
  onClose,
  onSaved,
}: {
  day: string;
  event?: PmEvent;
  note: string;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const projects = usePm().projects;
  /* ผู้เข้าร่วมเลือกจากทีมที่ซิงก์จากทะเบียนฝ่ายบุคคล — คนที่พ้นสภาพแล้วไม่ขึ้นให้เลือก */
  const team = useTeam().filter((m) => !m.left);
  const [form, setForm] = useState<EventDraft>(() => ({
    title: event?.title ?? "",
    kind: event?.kind ?? "client",
    date: event?.date ?? day,
    dateEnd: event ? endOf(event) : day,
    from: event?.from ?? "10:00",
    to: event?.to ?? "11:00",
    place: event && event.place !== "ยังไม่ระบุสถานที่" ? event.place : "",
    deal: event?.deal ?? "",
    who: event?.who ?? [],
    note,
    /* ใบเดิมที่ยังไม่เคยเลือกสี เปิดมาให้ตรงกับสีที่เห็นในปฏิทินอยู่แล้ว ไม่ใช่เด้งเป็นแดง */
    col: event?.col ?? (event ? KIND_COLOR[event.kind] : "red"),
  }));
  const [err, setErr] = useState("");
  /* เพิ่มประเภทนัดหมายใหม่ได้จากหน้างาน ไม่ต้องไปหน้าตั้งค่าก่อน (ข้อมูลหลัก HR-10) */
  const addKind = useAddOption({ catalog: "eventKinds" }, (v) => set("kind", v as EventKind));
  /* เปิดตัวเลือกวันได้ทีละอัน — เปิดอันหนึ่งแล้วอีกอันต้องปิด ไม่งั้นปฏิทินสองอันซ้อนกัน */
  const [pick, setPick] = useState<"s" | "e" | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  /* เหตุผลที่ยกเลิก — ไม่บังคับ แต่เก็บไว้ในประวัติของใบนั้น */
  const [why, setWhy] = useState("");

  function set<K extends keyof EventDraft>(k: K, v: EventDraft[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      /* ขยับวันเริ่มแล้ววันจบต้องตามไปด้วย ไม่งั้นช่วงจะกลับด้านโดยที่คนกรอกไม่ทันสังเกต */
      if (k === "date" && next.dateEnd < next.date) next.dateEnd = next.date;
      return next;
    });
    setErr("");
  }

  function toggleWho(id: string) {
    setForm((f) => ({
      ...f,
      who: f.who.includes(id) ? f.who.filter((x) => x !== id) : [...f.who, id],
    }));
  }

  const multi = form.dateEnd > form.date;
  /* บอกให้เห็นทันทีว่านัดนี้กินกี่วัน (ต้นแบบ spanNote) */
  const hint =
    form.date && multi
      ? `นัดต่อเนื่อง ${dayDiff(form.date, form.dateEnd) + 1} วัน ${thaiDate(form.date)} – ${thaiDate(form.dateEnd)} เวลาที่กรอกคือเวลาของแต่ละวัน`
      : "นัดวันเดียว";

  function save() {
    const warn = saveWarn(form, multi);
    if (warn) return setErr(warn);

    /* หน้านี้เป็นของ PM — ใบที่สร้างจากที่นี่จึงบันทึกผู้สร้างเป็น PM เสมอ */
    const draft: EventDraft = { ...form, title: form.title.trim(), place: form.place.trim(), by: "pm" };
    if (event) editEvent(event.id, draft, USERS.pm.name);
    else addEvent(draft);
    onSaved(draft.date);
  }

  const sub = "font-normal text-muted-foreground";

  return (
    <Sheet
      title={event ? "แก้นัดหมาย" : "เพิ่มนัดหมาย"}
      onClose={onClose}
      footer={
        <>
          {/* ยกเลิกแล้วเก็บใบไว้เป็นประวัติ ไม่ลบหาย (ยูสเคส PM-06 BR-03)
              ผู้เข้าร่วมกันเวลาไว้แล้ว จึงต้องย้อนดูได้ว่าใครยกเลิกและเพราะอะไร */}
          {event && (
            <button
              type="button"
              className="btn glass-thin mr-auto border-destructive text-destructive"
              onClick={() => {
                if (!confirmDel) {
                  setConfirmDel(true);
                  return;
                }
                /* เหตุผลเป็นของบังคับ — ข้อความแจ้งเตือนที่ผู้เข้าร่วมได้รับคือเหตุผลบรรทัดนี้ */
                if (!why.trim()) return setErr(CANCEL_WARN);
                cancelEvent(event.id, USERS.pm.name, why);
                onClose();
              }}
            >
              {confirmDel ? "กดอีกครั้งเพื่อยกเลิกนัด" : "ยกเลิกนัดหมาย"}
            </button>
          )}
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" onClick={save}>
            บันทึก
          </button>
        </>
      }
    >
      {confirmDel && (
        <p
          role="alert"
          className="mb-3.5 rounded-[11px] bg-[var(--destructive-soft)] px-3 py-2.5 text-xs leading-[1.6] font-semibold text-destructive"
        >
          ยกเลิกนัดนี้แล้วใบจะยังอยู่ในประวัติของวันนั้น ไม่หายไป · ผู้เข้าร่วมทุกคนจะได้รับแจ้งพร้อมเหตุผล
          <Input
            className="mt-2 bg-white"
            value={why}
            aria-label="เหตุผลที่ยกเลิก"
            onChange={(e) => {
              setWhy(e.target.value);
              setErr("");
            }}
            placeholder="เหตุผลที่ยกเลิก (ต้องกรอก)"
          />
          {err === CANCEL_WARN && <span className="mt-1.5 block">{CANCEL_WARN}</span>}
        </p>
      )}

      {/* กด Enter ที่ช่องไหนก็ได้เพื่อบันทึก ยกเว้นช่องบันทึกที่ Enter คือขึ้นบรรทัดใหม่ · กดที่ว่างปิดตัวเลือกวัน */}
      <div
        className="space-y-3.5"
        onClick={() => setPick(null)}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          if (e.key === "Enter" && t.tagName !== "TEXTAREA" && t.tagName !== "BUTTON") {
            e.preventDefault();
            save();
          }
        }}
      >
        <Field label="หัวข้อ">
          <Input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="เช่น นัดลูกค้าตรวจงานรอบแรก"
          />
        </Field>

        <Field label="ประเภท">
          <Select
            value={form.kind}
            onChange={(e) => {
              if (addKind.pick(e.target.value)) return;
              set("kind", e.target.value as EventKind);
            }}
          >
            {kindList().map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
            {addKind.option}
          </Select>
        </Field>
        {addKind.dialog}

        <div>
          <p className="mb-2 block text-[0.8rem] font-medium">
            สีของนัด <span className={sub}>— เลือกให้ตรงกับงานของคุณเอง</span>
          </p>
          <span className="flex flex-wrap gap-[9px] pt-1 pl-1">
            {PM_COLORS.map((c) => (
              <button
                key={c.c}
                type="button"
                className="cpick"
                aria-pressed={form.col === c.c}
                aria-label={`สี${c.name}`}
                title={c.name}
                style={{ background: c.bg, color: c.fg }}
                onClick={() => set("col", c.c)}
              />
            ))}
          </span>
        </div>

        <div>
          <p className="mb-2 block text-[0.8rem] font-medium">
            วันและเวลา <span className={sub}>— นัดข้ามวันได้</span>
          </p>
          <div className="grid grid-cols-[52px_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-x-2.5 gap-y-[9px]">
            <span className="text-xs font-bold text-muted-foreground">เริ่ม</span>
            <ThaiDatePicker
              value={form.date}
              open={pick === "s"}
              label="วันที่เริ่ม"
              onToggle={() => setPick((p) => (p === "s" ? null : "s"))}
              onPick={(iso) => {
                set("date", iso);
                setPick(null);
              }}
            />
            <Input
              type="time"
              step={900}
              value={form.from}
              aria-label="เวลาเริ่ม"
              onChange={(e) => set("from", e.target.value)}
            />

            <span className="text-xs font-bold text-muted-foreground">สิ้นสุด</span>
            <ThaiDatePicker
              value={form.dateEnd}
              min={form.date}
              open={pick === "e"}
              label="วันที่สิ้นสุด"
              onToggle={() => setPick((p) => (p === "e" ? null : "e"))}
              onPick={(iso) => {
                set("dateEnd", iso);
                setPick(null);
              }}
            />
            <Input
              type="time"
              step={900}
              value={form.to}
              aria-label="เวลาสิ้นสุด"
              onChange={(e) => set("to", e.target.value)}
            />
          </div>
          <p className="mt-2 text-[11.5px] font-semibold text-muted-foreground">{hint}</p>
          {/* คำเตือนเรื่องเหตุผลที่ยกเลิกขึ้นในกล่องยืนยันด้านบนแล้ว ไม่ต้องขึ้นซ้ำใต้ช่องวันเวลา */}
          {err && err !== CANCEL_WARN && (
            <p role="alert" className="mt-2 rounded-[11px] bg-[var(--destructive-soft)] px-3 py-2.5 text-xs leading-[1.55] font-semibold text-destructive">
              {err.split("\n").map((x) => (
                <span key={x} className="block">
                  {x}
                </span>
              ))}
            </p>
          )}
        </div>

        <Field label="สถานที่หรือลิงก์">
          <Input
            value={form.place}
            onChange={(e) => set("place", e.target.value)}
            placeholder="เช่น ห้องประชุมชั้น 3 หรือ ออนไลน์"
          />
        </Field>

        <Field label="โปรเจคที่เกี่ยวข้อง">
          <Select value={form.deal} onChange={(e) => set("deal", e.target.value)}>
            <option value="">ไม่ผูกกับโปรเจค</option>
            {projects.map((p) => (
              <option key={p.deal} value={p.deal}>
                {projName(p)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="ผู้เข้าร่วม">
          <span className="flex flex-wrap gap-[7px]">
            {team.map((m) => {
              const on = form.who.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleWho(m.id)}
                  aria-pressed={on}
                  className={`h-[30px] rounded-[20px] border px-3 text-xs font-semibold ${
                    on
                      ? "border-primary bg-[var(--accent)] text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </span>
        </Field>

        <Field label="บันทึก">
          <textarea
            value={form.note}
            spellCheck={false}
            onChange={(e) => set("note", e.target.value)}
            placeholder="ไม่บังคับ"
            className="block min-h-[82px] w-full resize-y rounded-[10px] border border-border bg-muted/40 px-3 py-2.5 text-[13px] leading-[1.65] outline-none focus:border-primary focus:bg-card"
          />
        </Field>
      </div>
    </Sheet>
  );
}
