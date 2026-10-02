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

import { useEffect, useRef, useState } from "react";
import { setMobileBack } from "@/lib/mobile-back";
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

/**
 * แถบสรุปรอบแบบเดียวกับหน้าการลา — ตัวเลขสำคัญของรอบนี้เรียงในกรอบเดียว
 * (เจ้าของสั่ง 2 ต.ค. 2569 ให้หน้าอื่นทำตามหน้าการลา)
 */
export function PaySummary({ items }: { items: { k: string; v: string; u?: string }[] }) {
  return (
    <ul className="flex list-none rounded-[16px] border border-[#E3D3D7] bg-white p-0 py-3 md:hidden">
      {items.map((it) => (
        <li
          key={it.k}
          className="flex flex-1 flex-col items-center gap-0.5 border-r border-[#D9C8CC] px-1 text-center last:border-r-0"
        >
          <b className="num text-[17px] leading-tight font-bold whitespace-nowrap">
            {it.v}
            {it.u && <span className="ml-0.5 text-[11px] font-semibold text-[#6B5F62]">{it.u}</span>}
          </b>
          <span className="truncate text-[11px] text-[#8A7E81]">{it.k}</span>
        </li>
      ))}
    </ul>
  );
}

/** ข้อมูลบนช่องเลือกกลุ่ม — จำนวนคนและสถานะของรอบนี้ จะได้รู้ตั้งแต่ยังไม่กดเข้าไป */
export type GroupInfo = { n?: number; note?: string; unit?: string };

/**
 * เลือกกลุ่มก่อนเข้ารายการ — การ์ดสองใบ กดง่ายด้วยนิ้วโป้ง (ต้นแบบชุด 1 ต.ค. 2569)
 * 2 ต.ค. 2569 เจ้าของสั่งให้หน้าอื่นทำตามหน้าการลา — การ์ดจึงบอกจำนวนคนและสถานะด้วย
 * ไม่ใช่ช่องเปล่าเต็มจอแบบเดิม
 */
export function GroupTiles({
  onPick,
  month,
  daily,
}: {
  onPick: (g: "month" | "daily") => void;
  month?: GroupInfo;
  daily?: GroupInfo;
}) {
  const tiles = [
    { k: "month" as const, label: "พนักงาน", sub: "รายเดือน", info: month },
    { k: "daily" as const, label: "ทดลองงาน", sub: "จ่ายรายวัน", info: daily },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:hidden">
      {tiles.map((t) => (
        <button
          key={t.k}
          type="button"
          className="flex min-h-[132px] flex-col items-start rounded-[24px] bg-card p-4 text-left shadow-[0_1px_2px_rgb(40_20_25/0.04),0_12px_24px_-20px_rgb(90_20_35/0.45)] active:bg-accent/60"
          onClick={() => onPick(t.k)}
        >
          <span className="flex w-full items-start justify-between gap-2">
            <span className="min-w-0">
              <b className="block text-[18px] leading-tight font-bold">{t.label}</b>
              <small className="mt-0.5 block text-[12px] text-muted-foreground">{t.sub}</small>
            </span>
            <ChevronRightIcon className="mt-1 size-4 flex-none text-muted-foreground" strokeWidth={2.2} />
          </span>
          <span className="mt-auto flex flex-col gap-0.5 pt-3">
            {t.info?.n !== undefined && (
              <b className="num text-[22px] leading-none font-bold">
                {t.info.n}
                <small className="ml-1 text-[12px] font-medium text-muted-foreground">{t.info.unit ?? "คน"}</small>
              </b>
            )}
            {t.info?.note && <small className="text-[12px] text-muted-foreground">{t.info.note}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

/*
 * อยู่ในกลุ่มไหนอยู่ ปุ่มย้อนกลับบนแถบหัวพากลับไปหน้าเลือกกลุ่มก่อน ไม่ออกจากหน้าไปเลย
 * (ต้นแบบชุด 1 ต.ค. 2569 เลิกใช้แถวย้อนกลับในเนื้อหา ใช้ปุ่มกลมบนหัวแทน)
 */
export function useGroupBack(active: boolean, onBack: () => void) {
  const fn = useRef(onBack);
  useEffect(() => {
    fn.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    setMobileBack(() => fn.current());
    return () => setMobileBack(null);
  }, [active]);
}

/** ชื่อกลุ่มที่เปิดอยู่ พร้อมจำนวนคน — ย้อนกลับด้วยปุ่มบนแถบหัว */
export function GroupBack({ label, count }: { label: string; count: number }) {
  return (
    <p className="flex h-9 items-center text-[16px] font-bold md:hidden">
      {label}
      <small className="num ml-2 text-[12.5px] font-medium text-muted-foreground">{count} คน</small>
    </p>
  );
}

/** ชื่อรอบที่กำลังดู — ไม่ตรงรอบไหนก็บอกเป็นช่วงวันที่ */
export function cycleTitle(month: string | null, from: string, to: string) {
  return month ? thaiMonth(month) : `${thaiDate(from)} – ${thaiDate(to)}`;
}
