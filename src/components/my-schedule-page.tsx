"use client";

/*
 * ตารางงานของทีมงาน — ใช้ปฏิทินชุดเดียวกับทุกบทบาท (schedule-board.tsx)
 *
 * เจ้าของสั่ง 24 ก.ย. 2569 ว่าหน้าตารางงานต้องหน้าตาเหมือนกันทุกอัน
 * ต่างกันแค่ว่าในปฏิทินมีอะไร และหน้านี้เพิ่มนัดไม่ได้ (ไม่ส่ง onAdd)
 *
 * สามชนิด
 *   งานที่ได้รับ (น้ำเงิน)   — งานย่อยที่ PM มอบหมาย ตามวันกำหนดส่ง กดแล้วเปิดใบงานนั้น
 *   วันลาของฉัน (ส้ม)      — ใบลาของตัวเอง กดแล้วเปิดใบนั้นในหน้าการลา
 *   นัดหมายที่ถูกเชิญ (ม่วง) — นัดที่ PM หรือ GM ใส่ชื่อเราไว้ กดแล้วดูรายละเอียด
 *
 * **หน้านี้สร้างอะไรไม่ได้เลย** สร้างนัดหมายได้เฉพาะ PM กับ GM (เจ้าของสั่ง 24 ก.ย. 2569)
 * ถ้าทีมงานอยากนัดใคร ต้องขอให้ PM หรือ GM เป็นคนตั้งนัดให้
 */

import { useMemo, useState } from "react";
import { useLeaveRecords } from "@/lib/leave-store";
import { invitedEvents, type PmEvent } from "@/lib/pm-schedule-data";
import { useSchedule } from "@/lib/pm-schedule-store";
import { usePm } from "@/lib/pm-store";
import { useProfile } from "@/lib/profile-data";
import { AppointmentSheet } from "./appointment-sheet";
import {
  ScheduleBoard,
  tintPaint,
  useBoardNav,
  type BoardEvent,
  type BoardKind,
} from "./schedule-board";

const KINDS: BoardKind[] = [
  { key: "task", label: "งานที่ได้รับ", color: "#1F6FD0" },
  { key: "leave", label: "วันลาของฉัน", color: "#B4630B" },
  { key: "meet", label: "นัดหมายที่ถูกเชิญ", color: "#6A2CA0" },
];

const COLOR = Object.fromEntries(KINDS.map((k) => [k.key, k.color])) as Record<string, string>;

/*
 * สถานะงานที่ขึ้นในบรรทัดรอง และแท็บของหน้า "งานที่ได้รับ" ที่ต้องเปิดตอนกดลิงก์
 * ไม่ส่ง stage ไปด้วย หน้านั้นจะเปิดแท็บ "งานที่ได้รับ" เป็นค่าตั้งต้น
 * แล้วงานที่ส่งไปแล้วหรือถูกตีกลับจะหาไม่เจอ ทั้งที่ลิงก์ชี้มาที่ใบนั้นโดยตรง
 */
const TASK_STATE: Record<string, { label: string; stage: string }> = {
  done: { label: "ส่งแล้ว", stage: "done" },
  sent: { label: "รอ PM ตรวจ", stage: "sent" },
  revise: { label: "ต้องแก้ไข", stage: "revise" },
};
const TASK_TODO = { label: "ยังไม่ส่ง", stage: "recv" };

export function MySchedulePage() {
  const sc = useSchedule();
  const me = useProfile();
  const pm = usePm();
  const leave = useLeaveRecords();
  const nav = useBoardNav();
  /* นัดที่เปิดดูรายละเอียดอยู่ — ดูอย่างเดียว */
  const [open, setOpen] = useState<PmEvent | null>(null);

  const events = useMemo(() => {
    /* ข้อมูลของแถบ — มีเฉพาะนัดหมายที่กดแล้วเปิดกล่องรายละเอียดได้ นอกนั้นเป็นลิงก์ */
    const out: BoardEvent<PmEvent | null>[] = [];
    const paint = (kind: string) => ({ dot: COLOR[kind], paint: tintPaint(COLOR[kind]) });

    for (const p of pm.projects)
      p.tasks.forEach((t, ti) => {
        if (!t.whos.includes(me.employeeId) || !t.due) return;
        const state = TASK_STATE[t.status] ?? TASK_TODO;
        out.push({
          id: `task-${p.deal}-${ti}`,
          kind: "task",
          start: t.due,
          end: t.due,
          title: `กำหนดส่ง · ${t.name}`,
          bar: t.name,
          sub: `${p.name || p.cus} · ${state.label}`,
          /* กดแล้วไปที่ใบงานนั้นในหน้า "งานที่ได้รับ" ซึ่งเป็นหน้าของทีมงานเอง */
          href: `/my-tasks?stage=${state.stage}&find=${encodeURIComponent(t.name)}`,
          ...paint("task"),
          data: null,
        });
      });
    for (const l of leave) {
      if (l.status === "ไม่อนุมัติ" || l.status === "ยกเลิก") continue;
      out.push({
        id: `leave-${l.id}`,
        kind: "leave",
        start: l.date,
        end: l.toDate || l.date,
        title: l.type,
        sub: `${l.status === "อนุมัติแล้ว" ? "อนุมัติแล้ว" : "รออนุมัติ"} · ${l.id}`,
        href: `/leave?find=${encodeURIComponent(l.id)}`,
        ...paint("leave"),
        data: null,
      });
    }
    for (const e of invitedEvents(sc.events, me.employeeId))
      out.push({
        id: `ev-${e.id}`,
        kind: "meet",
        start: e.date,
        end: e.dateEnd && e.dateEnd > e.date ? e.dateEnd : e.date,
        title: e.title,
        time: e.from || undefined,
        timeEnd: e.to || undefined,
        sub: e.place || undefined,
        /* นัดที่ถูกยกเลิกยังอยู่ในรายการแบบขีดฆ่า ไม่หายเงียบ (เจ้าของสั่ง 24 ก.ย. 2569) */
        cancelled: Boolean(e.cancel),
        cancelWhy: e.cancel?.why,
        ...paint("meet"),
        data: e,
      });
    return out;
  }, [pm.projects, me.employeeId, leave, sc.events]);

  return (
    /* ชื่อหน้ากับวันที่วันนี้อยู่ในแถบบนของเปลือกแอปแล้วทุกขนาดจอ จึงไม่มีหัวเรื่องซ้ำในหน้า */
    <div className="space-y-4">
      <ScheduleBoard
        nav={nav}
        events={events}
        kinds={KINDS}
        hint="ทุกรายการมาจากที่อื่น (ใบงานที่ PM มอบหมาย · ใบลาของคุณ · คำเชิญประชุม) หน้านี้จึงไม่มีปุ่มเพิ่ม · ถ้าต้องการนัดหมาย ขอให้ PM หรือ GM เป็นผู้ตั้งนัด"
        onOpen={(e) => e.data && setOpen(e.data)}
      />

      {open && (
        <AppointmentSheet event={open} note={sc.notes[open.id] ?? open.todo.join("\n")} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
