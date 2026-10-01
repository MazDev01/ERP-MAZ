"use client";

/*
 * ตัวเลื่อนเดือนของหน้าฝั่งบัญชี — งานบัญชีปิดเป็นเดือน จึงต้องย้อนดูเดือนก่อนได้
 * เลื่อนไปเดือนอนาคตไม่ได้ เพราะยังไม่มีเอกสารให้ดู
 */

import { useState } from "react";
import { unseenDeals, useAcc } from "@/lib/acc-store";
import { TH_MONTHS_FULL, bkkNow, thaiDate, todayIso } from "@/lib/format";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, SearchIcon } from "./icons";
import { DateField } from "./thai-date-picker";
import { Sheet } from "./lead-dialogs";

export function MonthNav({
  view,
  onChange,
}: {
  view: Date;
  onChange: (next: Date) => void;
}) {
  const now = bkkNow();
  const atNow =
    view.getFullYear() > now.getFullYear() ||
    (view.getFullYear() === now.getFullYear() && view.getMonth() >= now.getMonth());

  function shift(step: number) {
    onChange(new Date(view.getFullYear(), view.getMonth() + step, 1));
  }

  return (
    <div className="mo glass-thin w-full justify-center sm:w-auto">
      <button type="button" onClick={() => shift(-1)} aria-label="เดือนก่อนหน้า">
        <ChevronLeftIcon className="size-[15px]" strokeWidth={2.4} />
      </button>
      <span>
        {TH_MONTHS_FULL[view.getMonth()]} {view.getFullYear() + 543}
      </span>
      <button
        type="button"
        onClick={() => shift(1)}
        disabled={atNow}
        aria-label="เดือนถัดไป"
      >
        <ChevronRightIcon className="size-[15px]" strokeWidth={2.4} />
      </button>
    </div>
  );
}

// ─── ตัวกรองของหน้าวางบิลและหน้าใบเสร็จ ────────────────────────────
/*
 * ค้นหาเลขที่เอกสารหรือลูกค้า + ช่วงวันที่ ตามต้นแบบ billing.html / receipts.html (.rc-filters)
 * วันที่ที่ใช้เทียบขึ้นกับแท็บ หน้าจอเป็นคนเลือกเองว่าจะเอาวันไหนมาเทียบ
 */
export type AccFilter = { q: string; from: string; to: string };

export function useAccFilter(initialQuery = "") {
  const [f, setF] = useState<AccFilter>({ q: initialQuery, from: "", to: "" });
  const q = f.q.trim().toLowerCase();
  return {
    f,
    setF,
    active: Boolean(q || f.from || f.to),
    /** คำค้นตรงกับข้อความใดข้อความหนึ่งไหม */
    hit: (...fields: string[]) => !q || fields.join(" ").toLowerCase().includes(q),
    /** วันที่อยู่ในช่วงไหม — รายการที่ไม่มีวันที่แสดงเฉพาะตอนยังไม่ได้เลือกช่วง */
    inRange: (iso: string) => {
      if (!iso) return !f.from && !f.to;
      if (f.from && iso < f.from) return false;
      if (f.to && iso > f.to) return false;
      return true;
    },
    clear: () => setF({ q: "", from: "", to: "" }),
  };
}

export function AccFilters({
  filter,
}: {
  filter: ReturnType<typeof useAccFilter>;
}) {
  const { f, setF, active, clear } = filter;
  return (
    <div className="flex w-full flex-wrap items-center gap-2.5 py-2 lg:ml-auto lg:w-auto">
      {/* มือถือ: ช่องค้นหาเต็มแถว วันที่สองช่องแบ่งครึ่งแถวถัดไป สูงพอให้นิ้วกด */}
      <div className="search min-w-[160px] flex-1 max-sm:h-10! max-sm:basis-full lg:w-[250px] lg:flex-none">
        <SearchIcon className="size-[15px] shrink-0" strokeWidth={2} />
        <input
          type="search"
          value={f.q}
          onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))}
          placeholder="ค้นหาเลขที่เอกสารหรือลูกค้า"
          aria-label="ค้นหาเลขที่เอกสารหรือลูกค้า"
        />
      </div>
      {/* มือถือเหลือแค่ช่องค้นหาตามต้นแบบใหม่ — ช่วงวันที่กรองได้บนจอคอม
         บนมือถือเลือกวันจากปุ่มปฏิทิน (AccDayFilter) แล้วขึ้นเป็นชิปแทน ไม่ต้องมีสองช่องนี้ซ้ำ */}
      <div className="w-[calc(50%-5px)] max-sm:hidden sm:w-[160px]">
        <DateField
          value={f.from}
          onChange={(iso) => setF((x) => ({ ...x, from: iso }))}
          label="ตั้งแต่วันที่"
          placeholder="ตั้งแต่วันที่"
          clearable
          className="h-9 rounded-[10px] text-[13.5px]"
        />
      </div>
      <div className="w-[calc(50%-5px)] max-sm:hidden sm:w-[160px]">
        <DateField
          value={f.to}
          onChange={(iso) => setF((x) => ({ ...x, to: iso }))}
          label="ถึงวันที่"
          placeholder="ถึงวันที่"
          clearable
          className="h-9 rounded-[10px] text-[13.5px]"
        />
      </div>
      {active && (
        <button
          type="button"
          /* มือถือ: ล้างวันที่กดที่ชิปได้อยู่แล้ว ปุ่มนี้จึงขึ้นเฉพาะตอนมีคำค้น */
          className={`lnk px-2 text-[13px] font-semibold ${f.q ? "" : "max-sm:hidden"}`}
          onClick={clear}
        >
          ล้างตัวกรอง
        </button>
      )}
    </div>
  );
}

// ─── มือถือ: เลือกวันจากปฏิทินแทนแถบเลือกเดือน ──────────────────
/*
 * ต้นแบบ dose-erp-maz/billing.html (#bx-cal · 1 ต.ค. 2569)
 * แถบเลือกเดือนกินที่และกดยาก บนมือถือจึงเหลือปุ่มปฏิทินกลม กดแล้วเลื่อนแผ่นขึ้นมาเลือกวัน
 * วันที่มีรายการมีจุดแดงใต้ตัวเลข เลือกวันแล้วตั้งช่วงวันที่ของตัวกรองเป็นวันเดียว
 * "ดูทั้งหมด" = ล้างวันที่ กลับไปเห็นทุกใบ
 */
export function AccDayFilter({
  filter,
  dates,
}: {
  filter: ReturnType<typeof useAccFilter>;
  /** วันที่ (ISO) ที่มีรายการในแท็บที่เปิดอยู่ — ใช้ขึ้นจุดใต้ตัวเลขวัน */
  dates: string[];
}) {
  const { f, setF } = filter;
  const [open, setOpen] = useState(false);
  /* เลือกวันเดียวอยู่หรือไม่ — ช่วงคนละวันถือว่ากรองจากจอคอม ไม่ขึ้นชิปวันเดียว */
  const day = f.from && f.from === f.to ? f.from : "";

  return (
    <>
      <div className="flex w-full items-center gap-2 sm:hidden">
        {day && (
          <span className="flex h-9 items-center gap-2 rounded-full bg-[var(--primary-soft,#FDECEE)] pr-1.5 pl-3.5 text-[13px] font-bold text-primary">
            {thaiDate(day)}
            <button
              type="button"
              className="grid size-[26px] place-items-center rounded-full bg-white text-primary"
              onClick={() => setF((x) => ({ ...x, from: "", to: "" }))}
              aria-label="ล้างวันที่ที่เลือก"
            >
              <CloseIcon className="size-3.5" strokeWidth={2.6} />
            </button>
          </span>
        )}
        <button
          type="button"
          className="ml-auto grid size-[42px] flex-none place-items-center rounded-full bg-white text-foreground shadow-[0_4px_10px_-6px_rgb(90_20_35/0.3)]"
          onClick={() => setOpen(true)}
          aria-label="เลือกวันที่"
          aria-haspopup="dialog"
        >
          <CalendarIcon className="size-5" strokeWidth={2.2} />
        </button>
      </div>

      {open && (
        <DaySheet
          day={day}
          dates={dates}
          onPick={(iso) => {
            setF((x) => ({ ...x, from: iso, to: iso }));
            setOpen(false);
          }}
          onAll={() => {
            setF((x) => ({ ...x, from: "", to: "" }));
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DaySheet({
  day,
  dates,
  onPick,
  onAll,
  onClose,
}: {
  day: string;
  dates: string[];
  onPick: (iso: string) => void;
  onAll: () => void;
  onClose: () => void;
}) {
  const start = day ? new Date(`${day}T00:00:00`) : bkkNow();
  const [view, setView] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const has = new Set(dates);
  const today = todayIso();
  const y = view.getFullYear();
  const m = view.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();

  return (
    <Sheet
      title="เลือกวันที่"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn glass-thin h-12 w-full justify-center rounded-[14px] text-[14px] font-bold"
          onClick={onAll}
        >
          ดูทั้งหมด
        </button>
      }
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
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} className="h-[46px]" />)}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              key={iso}
              type="button"
              className="flex h-[46px] flex-col items-center gap-[3px] pt-1"
              onClick={() => onPick(iso)}
            >
              <b
                className={`grid size-[34px] place-items-center rounded-full text-[14px] font-semibold ${
                  iso === day ? "bg-primary text-white" : iso === today ? "text-primary" : ""
                }`}
              >
                {i + 1}
              </b>
              <i className={`size-[5px] rounded-full ${has.has(iso) ? "bg-primary" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

// ─── จุดแดงดีลใหม่ (AC-BR-01) ────────────────────────────────────
/** จุดแดงบนเมนู "วางบิล" ที่แถบข้าง — มีดีลใหม่ที่ฝ่ายบัญชียังไม่ได้เปิดแท็บรอวางบิลดู */
export function BillingNavDot() {
  const acc = useAcc();
  if (!unseenDeals(acc).length) return null;
  /* เมนูที่เปิดอยู่พื้นเป็นสีแบรนด์ จุดจึงเปลี่ยนเป็นสีขาว */
  return <NewDot label="มีดีลใหม่รอวางบิล" className="ml-auto [.on_&]:bg-white" />;
}

export function NewDot({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-block size-[9px] flex-none rounded-full bg-primary shadow-[0_0_0_2px_#fff] ${className}`}
    />
  );
}
