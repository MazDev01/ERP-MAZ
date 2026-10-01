"use client";

/*
 * ชิ้นส่วนมือถือของหน้ารอบเงินเดือน — ต้นแบบ dose-erp-maz/hr-payroll.html + hr-payslip.html
 * (บล็อก pay-mobile · pay-cal · pay-tiles · 1 ต.ค. 2569)
 *
 * บนมือถือหน้าพวกนี้ทำทีละกลุ่ม: เลือกก่อนว่าจะทำกลุ่ม "พนักงาน" หรือ "ทดลองงาน"
 * แล้วค่อยเห็นแถบขั้นตอน รายการ และปุ่มของกลุ่มนั้น จอแคบจะได้ไม่ต้องยัดสองกลุ่มพร้อมกัน
 *
 * ช่วงเวลาเลือกจากปฏิทินแทนช่องวันที่สองช่อง — แตะวันไหนก็ได้ในรอบ (26 ถึง 25 ของเดือนถัดไป)
 * ระบบจะเลือกรอบนั้นให้ทั้งรอบ เพราะรอบเงินเดือนไม่ใช่เดือนปฏิทิน
 */

import { useState } from "react";
import { bkkNow, thaiDate, thaiMonth, todayIso } from "@/lib/format";
import { hrCycle } from "@/lib/hr-data";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";

const TH_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** หัวเรื่องบนมือถือ: ชื่อรอบที่กำลังดู + ปุ่มปฏิทินกลม */
export function PayHead({ title, onCal }: { title: string; onCal: () => void }) {
  return (
    <div className="flex items-center gap-2.5 md:hidden">
      <h1 className="min-w-0 flex-1 truncate text-[20px] font-bold">{title}</h1>
      <button
        type="button"
        className="grid size-[42px] flex-none place-items-center rounded-full border border-border bg-card text-foreground shadow-[0_4px_10px_-6px_rgb(90_20_35/0.3)]"
        onClick={onCal}
        aria-label="เลือกรอบเงินเดือน"
        aria-haspopup="dialog"
      >
        <CalendarIcon className="size-5" strokeWidth={2.2} />
      </button>
    </div>
  );
}

/*
 * ปฏิทินเลือกรอบ — แผ่นเลื่อนขึ้นจากด้านล่าง
 *   mode cycle (หน้าคำนวณ) แตะวันไหนก็ได้ในรอบ ระบบเลือกทั้งรอบ 26–25
 *   mode month (หน้าสลิป) แตะวันในเดือนไหน ได้รอบของเดือนนั้น
 * วันที่ไม่มีรอบในระบบกดไม่ได้ ไม่งั้นเลือกไปก็ไม่มีข้อมูล
 */
export function CycleSheet({
  months,
  selected,
  mode = "cycle",
  onPick,
  onClose,
}: {
  months: string[];
  selected: string;
  mode?: "cycle" | "month";
  onPick: (month: string) => void;
  onClose: () => void;
}) {
  const start = selected ? new Date(`${hrCycle(selected).to}T00:00:00`) : bkkNow();
  const [view, setView] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const today = todayIso();
  const y = view.getFullYear();
  const m = view.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const range = selected ? hrCycle(selected) : null;

  /** วันนี้อยู่ในรอบไหน — ตัดวันที่ 25 ของเดือน วันที่ 26 ขึ้นไปนับเป็นรอบของเดือนถัดไป */
  function cycleOf(iso: string) {
    if (mode === "month") return iso.slice(0, 7);
    const [yy, mm, dd] = iso.split("-").map(Number);
    if (dd >= 26) return mm === 12 ? `${yy + 1}-01` : `${yy}-${pad(mm + 1)}`;
    return `${yy}-${pad(mm)}`;
  }

  return (
    <PaySheet
      title="เลือกรอบเงินเดือน"
      hint={mode === "cycle" ? "แตะวันใดก็ได้ในรอบ (26 ถึง 25 ของเดือนถัดไป)" : "แตะวันใดก็ได้ในเดือนที่ต้องการ"}
      onClose={onClose}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="iconbtn glass-thin size-[38px] rounded-full"
          onClick={() => setView(new Date(y, m - 1, 1))}
          aria-label="เดือนก่อนหน้า"
        >
          <ChevronLeftIcon className="size-4" strokeWidth={2.4} />
        </button>
        <h3 className="text-[17px] font-bold">
          {TH_MONTHS_FULL[m]} {y + 543}
        </h3>
        <button
          type="button"
          className="iconbtn glass-thin size-[38px] rounded-full"
          onClick={() => setView(new Date(y, m + 1, 1))}
          aria-label="เดือนถัดไป"
        >
          <ChevronRightIcon className="size-4" strokeWidth={2.4} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-[12px] text-muted-foreground" aria-hidden="true">
        {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d) => (
          <span key={d} className="py-1">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center">
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} className="h-11" />)}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${y}-${pad(m + 1)}-${pad(i + 1)}`;
          const cycle = cycleOf(iso);
          const has = months.includes(cycle);
          /* วันในรอบที่เลือกอยู่ พื้นชมพูต่อกันเป็นแถบ หัวท้ายมน */
          const inRange = Boolean(range && iso >= range.from && iso <= range.to);
          const first = inRange && (iso === range?.from || i === 0 || new Date(y, m, i + 1).getDay() === 0);
          const last = inRange && (iso === range?.to || i + 1 === days || new Date(y, m, i + 1).getDay() === 6);
          return (
            <button
              key={iso}
              type="button"
              disabled={!has}
              onClick={() => onPick(cycle)}
              className={`flex h-11 items-center justify-center disabled:opacity-30 ${
                inRange ? "bg-[var(--primary-soft,#FDECEE)]" : ""
              } ${first ? "rounded-l-[22px]" : ""} ${last ? "rounded-r-[22px]" : ""}`}
            >
              <b
                className={`num grid size-[34px] place-items-center rounded-full text-[14px] font-semibold ${
                  inRange ? "text-primary" : ""
                } ${iso === today ? "ring-[1.5px] ring-primary ring-inset" : ""}`}
              >
                {i + 1}
              </b>
            </button>
          );
        })}
      </div>
    </PaySheet>
  );
}

/** แผ่นเลื่อนขึ้นแบบเบา ๆ ของหน้ารอบเงินเดือน (ไม่มีปุ่มท้ายกล่อง) */
function PaySheet({
  title,
  hint,
  children,
  onClose,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="veil-in fixed inset-0 z-80 flex items-end justify-center bg-[rgb(40_20_25/0.4)]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-in w-full rounded-t-[26px] bg-card px-[18px] pt-2.5 pb-[max(22px,env(safe-area-inset-bottom))] sm:mb-6 sm:max-w-[420px] sm:rounded-[20px] sm:pb-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
        {children}
        {hint && <p className="mt-1.5 text-center text-[12px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** เลือกกลุ่มก่อนเข้ารายการ — สองช่องสี่เหลี่ยมใหญ่ กดง่ายด้วยนิ้วโป้ง */
export function GroupTiles({ onPick }: { onPick: (g: "month" | "daily") => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:hidden">
      {([["month", "พนักงาน"], ["daily", "ทดลองงาน"]] as const).map(([k, label]) => (
        <button
          key={k}
          type="button"
          className="grid aspect-square place-items-center rounded-[24px] bg-card p-4 text-[19px] font-bold shadow-[0_1px_2px_rgb(40_20_25/0.04),0_12px_24px_-20px_rgb(90_20_35/0.45)]"
          onClick={() => onPick(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** แถวย้อนกลับไปเลือกกลุ่มใหม่ พร้อมจำนวนคนของกลุ่มที่เปิดอยู่ */
export function GroupBack({ label, count, onBack }: { label: string; count: number; onBack: () => void }) {
  return (
    <button
      type="button"
      className="flex h-9 w-full items-center gap-1.5 text-left text-[16px] font-bold md:hidden"
      onClick={onBack}
    >
      <ChevronLeftIcon className="size-[18px]" strokeWidth={2.4} />
      {label}
      <small className="num ml-1 text-[12.5px] font-medium text-muted-foreground">{count} คน</small>
    </button>
  );
}

/** ชื่อรอบที่กำลังดู — ไม่ตรงรอบไหนก็บอกเป็นช่วงวันที่ */
export function cycleTitle(month: string | null, from: string, to: string) {
  return month ? thaiMonth(month) : `${thaiDate(from)} – ${thaiDate(to)}`;
}
