"use client";

/*
 * แดชบอร์ดบนมือถือ — ชุดชิ้นส่วนที่ทุกบทบาทใช้ร่วมกัน
 * (ต้นแบบ dashboard.html ส่วน .mob ที่เจ้าของส่งมา 29 ก.ย. 2569)
 *
 * จอเล็กไม่ได้ย่อแดชบอร์ดของจอคอมลงมา แต่เรียงใหม่แบบแอป
 *   การ์ดยอดใหญ่พร้อมวงแหวน → ปฏิทินรายสัปดาห์ → รายการของวันที่เลือก → อันดับ
 * ตัวเลขทุกตัวรับมาจากหน้าแดชบอร์ดของบทบาทนั้น ไม่ได้คิดเองซ้ำ — จอคอมกับมือถือจึงตรงกันเสมอ
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { thaiDate, todayIso } from "@/lib/format";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const TH_MONTH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export const DASH_TINT = {
  rose: "bg-[#FCE3E7] text-[#C0121F]",
  sky: "bg-[#E3EEFC] text-[#1F6FD0]",
  mint: "bg-[#DDF2E6] text-[#14875A]",
  peach: "bg-[#FDEDD6] text-[#B4630B]",
  lilac: "bg-[#ECE6FA] text-[#5B3FBF]",
  grey: "bg-muted text-muted-foreground",
} as const;

export type DashTint = keyof typeof DASH_TINT;

export type DashRow = {
  key: string;
  title: string;
  /** บรรทัดรองใต้ชื่อ — ป้ายสีอ่อนแบบต้นแบบ */
  meta?: string;
  metaTint?: DashTint;
  /** ตัวเลขหรืออันดับท้ายแถว */
  end?: string;
  endTint?: DashTint;
  href?: string;
};

/** ปุ่มเลือกช่วงเวลาแบบเม็ดยา — เดือนนี้ / ไตรมาส / ปีนี้ */
export function DashChips<T extends string>({
  value,
  items,
  onPick,
}: {
  value: T;
  items: { key: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="ช่วงเวลา">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(it.key)}
            className={`h-7 rounded-full px-[11px] text-[12px] font-semibold ${
              on ? "bg-white text-primary shadow-[0_4px_10px_-6px_rgba(120,20,35,.45)]" : "bg-white/70 text-muted-foreground"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/** การ์ดยอดใหญ่ + วงแหวนสัดส่วน — ชิ้นแรกที่เห็นเมื่อเปิดแดชบอร์ดบนมือถือ */
export function DashHero({
  chips,
  label,
  value,
  foot,
  ringPct,
  ringLabel,
}: {
  chips?: React.ReactNode;
  label: string;
  value: string;
  foot?: React.ReactNode;
  /** สัดส่วนในวงแหวน 0–100 · ไม่ส่งมาคือไม่มีวงแหวน */
  ringPct?: number | null;
  ringLabel?: string;
}) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, ringPct ?? 0));
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-3 rounded-[26px] bg-[linear-gradient(150deg,#FDE3E7,#FBEFF1_70%)] p-[18px] shadow-[0_1px_2px_rgba(120,20,35,.05),0_12px_28px_-18px_rgba(120,20,35,.3)]">
      <div className="min-w-0">
        {chips}
        <h2 className="mt-3.5 text-[14px] font-semibold text-muted-foreground">{label}</h2>
        <p className="num text-[26px] leading-tight font-bold whitespace-nowrap">{value}</p>
        {foot && <p className="mt-0.5 text-[12px] text-muted-foreground">{foot}</p>}
      </div>
      {ringPct != null && (
        <div className="relative size-[112px]">
          <svg viewBox="0 0 112 112" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="56" cy="56" r={R} fill="none" stroke="#FFF" strokeWidth="11" />
            <circle
              cx="56"
              cy="56"
              r={R}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={`${((C * pct) / 100).toFixed(1)} ${C.toFixed(1)}`}
            />
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <b className="num text-[22px] leading-none">{Math.round(pct)}%</b>
            {ringLabel && (
              <small className="mt-1 block text-[10.5px] leading-tight text-muted-foreground">{ringLabel}</small>
            )}
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * ปฏิทินรายสัปดาห์ — เลื่อนทีละสัปดาห์ จุดแดงใต้วันที่มีรายการ
 * กดวันไหนก็ได้ รายการด้านล่างเปลี่ยนตามวันที่เลือก
 */
export function DashWeek({
  value,
  onPick,
  has,
}: {
  value: string;
  onPick: (iso: string) => void;
  /** วันนี้มีรายการไหม */
  has: (iso: string) => boolean;
}) {
  const today = todayIso();
  const [offset, setOffset] = useState(0);
  const days = useMemo(() => {
    const base = new Date(`${value}T00:00:00`);
    base.setDate(base.getDate() - base.getDay() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { iso, day: d.getDate(), dow: DOW[d.getDay()], month: d.getMonth(), year: d.getFullYear() };
    });
  }, [value, offset]);
  const mid = days[3];

  return (
    <section className="glass rounded-[22px] p-3.5">
      <div className="flex items-center justify-between">
        <b className="text-[16px]">
          {TH_MONTH[mid.month]} {mid.year + 543}
        </b>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="สัปดาห์ก่อน"
            onClick={() => setOffset((v) => v - 1)}
            className="grid size-[34px] place-items-center rounded-full border-[1.5px] border-border bg-card text-muted-foreground"
          >
            <ChevronLeftIcon className="size-4" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            aria-label="สัปดาห์ถัดไป"
            onClick={() => setOffset((v) => v + 1)}
            className="grid size-[34px] place-items-center rounded-full border-[1.5px] border-border bg-card text-muted-foreground"
          >
            <ChevronRightIcon className="size-4" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {days.map((d) => {
          const on = d.iso === value;
          return (
            <button
              key={d.iso}
              type="button"
              aria-pressed={on}
              aria-label={thaiDate(d.iso)}
              onClick={() => onPick(d.iso)}
              className={`flex flex-col items-center gap-1 rounded-2xl py-1.5 ${on ? "bg-accent" : ""}`}
            >
              <small className="text-[11px] text-muted-foreground">{d.dow}</small>
              <b
                className={`num grid size-[34px] place-items-center rounded-full text-[15px] font-semibold ${
                  on
                    ? "bg-primary text-white"
                    : d.iso === today
                      ? "text-primary ring-[1.5px] ring-primary ring-inset"
                      : ""
                }`}
              >
                {d.day}
              </b>
              <i className={`size-[5px] rounded-full ${has(d.iso) ? "bg-primary" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** หัวข้อของแต่ละกลุ่ม พร้อมลิงก์ "ดูทั้งหมด" */
export function DashSection({
  title,
  href,
  linkLabel = "ดูทั้งหมด",
  rows,
  empty,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  rows: DashRow[];
  empty: string;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-bold">{title}</h3>
        {href && (
          <Link href={href} className="text-[12.5px] font-semibold text-primary">
            {linkLabel}
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="glass rounded-[20px] px-5 py-6 text-center text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const inner = (
              <>
                <span className="min-w-0">
                  <b className="block truncate text-[14.5px] font-semibold">{r.title}</b>
                  {r.meta && (
                    <span
                      className={`mt-1.5 inline-block rounded-[9px] px-2.5 py-1 text-[12px] font-semibold ${
                        DASH_TINT[r.metaTint ?? "grey"]
                      }`}
                    >
                      {r.meta}
                    </span>
                  )}
                </span>
                {r.end && (
                  <span
                    className={`num grid size-9 flex-none place-items-center rounded-full text-[13px] font-bold ${
                      DASH_TINT[r.endTint ?? "rose"]
                    }`}
                  >
                    {r.end}
                  </span>
                )}
              </>
            );
            const cls =
              "glass grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[20px] p-3.5 text-foreground";
            return (
              <li key={r.key}>
                {r.href ? (
                  <Link href={r.href} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
