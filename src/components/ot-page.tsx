"use client";

import Link from "next/link";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  OT_KIND,
  otKindOf,
  paidHours,
  type OtKind,
  type OtRecord,
  type OtStatus,
} from "@/lib/ot-data";
import { cancelOtRequest, useOtRecords } from "@/lib/ot-store";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon , PlusIcon } from "./icons";
import { ApproverNote } from "./approver-note";
import { OtDialog } from "./ot-dialog";

const PER_PAGE = 10;

const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const TH_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

const STATUS_CLASS: Record<OtStatus, string> = {
  รออนุมัติ: "t-early",
  อนุมัติแล้ว: "t-ok",
  ไม่อนุมัติ: "t-late",
  ยกเลิก: "t-miss",
};

const TABS: { key: "all" | OtStatus; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "รออนุมัติ", label: "รออนุมัติ" },
  { key: "อนุมัติแล้ว", label: "อนุมัติแล้ว" },
  { key: "ไม่อนุมัติ", label: "ไม่อนุมัติ" },
  { key: "ยกเลิก", label: "ยกเลิก" },
];


export function OtPage() {
  const records = useOtRecords();
  /* ลิงก์จากแจ้งเตือน LINE — /ot?find=OT-2569-0123 เปิดเดือนของคำขอนั้นแล้วไฮไลต์ให้ */
  const findId = useSearchParams().get("find") ?? "";
  const found = records.find((r) => r.id === findId);
  const [view, setView] = useState(() => {
    if (!found) return new Date(2026, 8, 1);
    const [y, m] = found.date.split("-").map(Number);
    return new Date(y, m - 1, 1);
  });
  const [tab, setTab] = useState<"all" | OtStatus>("all");
  const [page, setPage] = useState(1);
  /* หน้าบันทึกเวลาส่งลิงก์ ?new=1&date=... มาเปิดฟอร์มพร้อมวันที่ให้เลย */
  const params = useSearchParams();
  const presetDate = params.get("date") ?? undefined;
  const [dialogOpen, setDialogOpen] = useState(params.get("new") !== null);
  /* ใบที่กำลังแก้ — ใช้กล่องเดียวกับตอนขอ แต่เติมค่าเดิมไว้ (เจ้าของสั่ง 29 ก.ย. 2569) */
  const [editing, setEditing] = useState<OtRecord | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const inMonth = useMemo(() => {
    const prefix = `${view.getFullYear()}-${pad(view.getMonth() + 1)}`;
    return records.filter((r) => r.date.startsWith(prefix));
  }, [records, view]);

  const scoped = useMemo(() => {
    const list = tab === "all" ? inMonth : inMonth.filter((r) => r.status === tab);
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  }, [inMonth, tab]);

  const maxPage = Math.max(1, Math.ceil(scoped.length / PER_PAGE));
  const safePage = Math.min(page, maxPage);
  const from = (safePage - 1) * PER_PAGE;
  const list = scoped.slice(from, from + PER_PAGE);
  const totalPaid = inMonth.reduce((sum, r) => sum + paidHours(r), 0);

  function hoursOfKind(kind: OtKind) {
    return inMonth
      .filter((r) => otKindOf(r.date) === kind)
      .reduce((sum, r) => sum + paidHours(r), 0);
  }

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1>โอทีของฉัน</h1>
          <ApproverNote kind="ot" />
        </div>
        <div className="tools w-full flex-wrap sm:w-auto">
          <div className="mo glass-thin w-full justify-center sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1));
                setPage(1);
              }}
              aria-label="เดือนก่อนหน้า"
            >
              <ChevronLeftIcon className="size-[15px]" strokeWidth={2.4} />
            </button>
            <span className="min-w-[150px]">
              {TH_MONTHS[view.getMonth()]} {view.getFullYear() + 543}
            </span>
            <button
              type="button"
              onClick={() => {
                setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1));
                setPage(1);
              }}
              aria-label="เดือนถัดไป"
            >
              <ChevronRightIcon className="size-[15px]" strokeWidth={2.4} />
            </button>
          </div>
          {/* มือถือ: ปุ่มลอยเหนือแถบเมนูล่าง กดได้ตลอดไม่ต้องเลื่อนขึ้นมาหา
             (ต้นแบบ dose-erp-maz/mobile/attendance.html · 30 ก.ย. 2569) */}
          <button
            type="button"
            className="btn solid btn-solid btn-block-mobile shrink-0 max-md:fixed max-md:inset-x-4 max-md:bottom-[calc(104px+env(safe-area-inset-bottom))] max-md:z-40 max-md:h-[50px] max-md:justify-center max-md:rounded-[16px] max-md:shadow-[0_14px_24px_-12px_rgb(208_2_27/0.9)]"
            onClick={() => setDialogOpen(true)}
          >
            <PlusIcon className="size-[15px]" strokeWidth={2.2} />
            ขอทำล่วงเวลา
          </button>
        </div>
      </div>

      {flash && (
        <p className="flex items-center gap-2.5 rounded-xl border border-[var(--success)]/20 bg-[var(--success-soft)] px-4 py-3 text-sm font-medium text-[var(--success)]">
          <CheckIcon className="size-4 shrink-0" strokeWidth={2.4} />
          {flash}
        </p>
      )}

      {/* ── ชั่วโมงที่อนุมัติแล้วแยกตามเรต ── */}
      {/* มือถือ: แถวเดียวอ่านรวดเดียวจบ ไม่เอาการ์ดตัวเลขใหญ่ (เจ้าของสั่ง 30 ก.ย. 2569) */}
      <section className="glass rounded-[20px] px-4 py-3.5 sm:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <b className="text-[13.5px] font-bold">โอทีที่อนุมัติแล้วเดือนนี้</b>
          <em className="num text-[11.5px] text-muted-foreground not-italic">
            รวม {(Object.keys(OT_KIND) as OtKind[]).reduce((a, k) => a + hoursOfKind(k), 0).toFixed(2)} ชม.
          </em>
        </div>
        <ul className="mt-2.5 flex list-none gap-2 p-0">
          {(Object.keys(OT_KIND) as OtKind[]).map((kind) => (
            <li key={kind} className="flex flex-1 flex-col items-center rounded-[14px] bg-muted/60 px-2 py-2">
              <span className="truncate text-[11px] text-muted-foreground">{OT_KIND[kind].label}</span>
              <b className="num text-[18px] leading-tight font-bold text-primary">{hoursOfKind(kind).toFixed(2)}</b>
              <em className="num text-[10.5px] text-muted-foreground not-italic">{OT_KIND[kind].rate}x</em>
            </li>
          ))}
        </ul>
      </section>

      <div className="hidden gap-3.5 sm:grid sm:grid-cols-3">
        {(Object.keys(OT_KIND) as OtKind[]).map((kind) => (
          <div key={kind} className="glass rounded-2xl px-[17px] py-[15px]">
            <div className="flex items-center justify-between gap-2.5">
              <b className="text-[13.5px] font-semibold">
                โอที{OT_KIND[kind].label}
              </b>
              <em className="glass-thin rounded-full px-[9px] py-0.5 text-[11.5px] font-semibold text-muted-foreground not-italic">
                {OT_KIND[kind].rate} เท่า
              </em>
            </div>
            <p className="num mt-2 text-[27px] leading-tight font-bold">
              {hoursOfKind(kind).toFixed(2)}
              <span className="ml-1.5 text-[13px] font-semibold text-muted-foreground">
                ชั่วโมง
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              อนุมัติแล้วในเดือนนี้
            </p>
          </div>
        ))}
      </div>

      <section className="panel glass flex flex-col max-md:mb-24 max-md:border-0! max-md:bg-transparent! max-md:shadow-none!">
        <div className="strip">
          <div className="tabs">
            {TABS.map((t) => {
              const count =
                t.key === "all"
                  ? inMonth.length
                  : inMonth.filter((r) => r.status === t.key).length;
              return (
                <button
                  key={t.key}
                  type="button"
                  className={tab === t.key ? "on" : ""}
                  onClick={() => {
                    setTab(t.key);
                    setPage(1);
                  }}
                >
                  {t.label} <b>{count}</b>
                </button>
              );
            })}
          </div>
          <div className="legend hidden! sm:flex!">
            <span><i style={{ background: "var(--warning)" }} />รออนุมัติ</span>
            <span><i style={{ background: "var(--success)" }} />อนุมัติแล้ว</span>
            <span><i style={{ background: "var(--destructive)" }} />ไม่อนุมัติ</span>
            <span><i style={{ background: "var(--neutral)" }} />ยกเลิก</span>
          </div>
        </div>

        <div className="scroll-stable hidden min-h-0 flex-1 overflow-auto md:block">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th style={{ width: 150 }}>วันที่ทำล่วงเวลา</th>
                <th style={{ width: 140 }}>ช่วงเวลา</th>
                <th className="c" style={{ width: 116 }}>ชั่วโมง</th>
                <th>งานที่ปฏิบัติ</th>
                <th style={{ width: 132 }}>สถานะ</th>
                <th className="c" style={{ width: 96 }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-[50px] text-center text-muted-foreground">
                    ไม่มีรายการในเดือนนี้
                  </td>
                </tr>
              ) : (
                list.map((r) => <Row key={r.id} row={r} hit={r.id === findId} onEdit={() => setEditing(r)} />)
              )}
            </tbody>
          </table>
        </div>

        <ul className="flex flex-col gap-2.5 pt-2.5 md:hidden">
          {list.length === 0 ? (
            <li className="rounded-[22px] border border-white/95 bg-white/72 px-5 py-10 text-center text-muted-foreground shadow-[0_12px_30px_-22px_rgb(140_20_40/0.45)] backdrop-blur-[18px]">
              ไม่มีรายการในเดือนนี้
            </li>
          ) : (
            list.map((r) => <MobileRow key={r.id} row={r} hit={r.id === findId} onEdit={() => setEditing(r)} />)
          )}
        </ul>

        <div className="foot flex-col items-stretch gap-3 text-center sm:flex-row sm:items-center sm:text-left">
          <span>
            {scoped.length === 0
              ? "แสดง 0 รายการ"
              : `แสดง ${from + 1}–${from + list.length} จาก ${scoped.length} รายการ`}
          </span>
          <span className="sum">
            ชั่วโมงที่อนุมัติแล้วรวม<b>{totalPaid.toFixed(2)}</b> ชั่วโมง
          </span>
          {/* หน้าเดียวไม่ต้องมีแถบเลขหน้าบนมือถือ — กินที่เปล่า ๆ */}
          <div className={`pages justify-center sm:justify-start ${maxPage <= 1 ? "max-md:hidden" : ""}`}>
            <button
              type="button"
              className="glass-thin"
              disabled={safePage === 1}
              onClick={() => setPage(safePage - 1)}
              aria-label="ก่อนหน้า"
            >
              ‹
            </button>
            {Array.from({ length: maxPage }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={`glass-thin ${n === safePage ? "on" : ""}`}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="glass-thin"
              disabled={safePage === maxPage}
              onClick={() => setPage(safePage + 1)}
              aria-label="ถัดไป"
            >
              ›
            </button>
          </div>
        </div>
      </section>

      {(dialogOpen || editing) && (
        <OtDialog
          records={records}
          presetDate={editing ? undefined : presetDate}
          edit={editing ?? undefined}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSubmitted={(hours, date) => {
            setFlash(`ส่งคำขอโอที ${hours.toFixed(2)} ชั่วโมงเรียบร้อย — รอหัวหน้าอนุมัติ`);
            const d = new Date(`${date}T00:00:00`);
            setView(new Date(d.getFullYear(), d.getMonth(), 1));
            setTab("all");
            setPage(1);
            if (flashTimer.current) clearTimeout(flashTimer.current);
            flashTimer.current = setTimeout(() => setFlash(null), 6000);
          }}
        />
      )}
    </div>
  );
}

function Row({ row, hit, onEdit }: { row: OtRecord; hit?: boolean; onEdit: () => void }) {
  const adjusted =
    row.status === "อนุมัติแล้ว" &&
    row.approvedHours != null &&
    row.approvedHours !== row.hours;

  return (
    <tr className={hit ? "ring-2 ring-primary ring-inset" : undefined}>
      <td>
        {/* กดวันที่เพื่อไปดูเวลาทำงานจริงของเดือนนั้น ว่าวันนั้นเข้าออกกี่โมง */}
        <Link
          href={`/records?month=${row.date.slice(0, 7)}`}
          className="whitespace-nowrap hover:text-primary hover:underline"
        >
          {thaiDate(row.date)}
        </Link>
        {/* เลขที่ใบ — ผู้อนุมัติอ้างเลขนี้ พนักงานจึงต้องเห็นเลขเดียวกันที่ใบของตัวเอง */}
        <span className="why">
          {row.id} · โอที{OT_KIND[otKindOf(row.date)].label}
        </span>
      </td>
      <td className="num whitespace-nowrap">
        {hhmm(row.startMin)}–{hhmm(row.endMin)}
      </td>
      <td className="c num">
        <b className="font-semibold">{row.hours.toFixed(2)}</b>
        {adjusted && (
          <span className="adj">อนุมัติ {row.approvedHours?.toFixed(2)}</span>
        )}
      </td>
      <td>
        <span className="clip">{row.reason}</span>
        {row.comment && <span className="why">หัวหน้า: {row.comment}</span>}
      </td>
      <td>
        <span className={`tag ${STATUS_CLASS[row.status]}`}>
          <i />
          {row.status}
        </span>
      </td>
      <td className="c">
        {row.status === "รออนุมัติ" ? (
          <span className="flex items-center justify-center gap-2.5">
            <button type="button" className="lnk" onClick={onEdit}>
              แก้ไข
            </button>
            <button type="button" className="lnk" onClick={() => cancelOtRequest(row.id)}>
              ยกเลิก
            </button>
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

/*
 * การ์ดคำขอโอทีบนมือถือ — ต้นแบบ dose-erp-maz/mobile/attendance.html (30 ก.ย. 2569)
 * วันที่กับสถานะอยู่แถวบน · ช่วงเวลากับชั่วโมงเป็นกล่องนุ่มมีป้ายกำกับ · งานที่ปฏิบัติอยู่ล่าง
 */
function MobileRow({ row, hit, onEdit }: { row: OtRecord; hit?: boolean; onEdit: () => void }) {
  const adjusted =
    row.status === "อนุมัติแล้ว" &&
    row.approvedHours != null &&
    row.approvedHours !== row.hours;

  return (
    <li
      className={`rounded-[22px] border border-white/95 bg-white/72 p-3.5 shadow-[0_12px_30px_-22px_rgb(140_20_40/0.45)] backdrop-blur-[18px] ${
        hit ? "ring-2 ring-primary ring-inset" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/records?month=${row.date.slice(0, 7)}`}
            className="block text-[15px] font-bold hover:text-primary hover:underline"
          >
            {thaiDate(row.date)}
          </Link>
          <span className="num block text-[11.5px] text-muted-foreground">
            {row.id} · โอที{OT_KIND[otKindOf(row.date)].label}
          </span>
        </div>
        <span className={`tag shrink-0 ${STATUS_CLASS[row.status]}`}>
          <i />
          {row.status}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <span className="rounded-[14px] bg-muted/60 px-2.5 py-2">
          <small className="block text-[11px] font-semibold text-muted-foreground">ช่วงเวลา</small>
          <b className="num text-[15px] font-bold">
            {hhmm(row.startMin)}–{hhmm(row.endMin)}
          </b>
        </span>
        <span className="rounded-[14px] bg-muted/60 px-2.5 py-2">
          <small className="block text-[11px] font-semibold text-muted-foreground">ชั่วโมง</small>
          <b className="num text-[15px] font-bold text-primary">{row.hours.toFixed(2)}</b>
          {adjusted && (
            <em className="num block text-[11px] font-semibold text-[var(--warning)] not-italic">
              อนุมัติจริง {row.approvedHours?.toFixed(2)}
            </em>
          )}
        </span>
      </div>

      <p className="mt-2 text-[13px] break-words">{row.reason}</p>
      {row.comment && (
        <p className="mt-1 text-[12px] text-muted-foreground">หัวหน้า: {row.comment}</p>
      )}

      {row.status === "รออนุมัติ" && (
        <span className="mt-2.5 flex items-center justify-end gap-3">
          <button type="button" className="lnk" onClick={onEdit}>
            แก้ไขคำขอนี้
          </button>
          <button type="button" className="lnk" onClick={() => cancelOtRequest(row.id)}>
            ยกเลิกคำขอนี้
          </button>
        </span>
      )}
    </li>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function hhmm(m: number) {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function thaiDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + 543}`;
}
