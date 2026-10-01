"use client";

/*
 * กล่องประวัติพนักงาน — แบบหน้าโปรไฟล์ (โครงใหม่ 24 ก.ย. 2569)
 *
 * แบนเนอร์แดงของแอป + รูป + แถบข้อมูลสี่ช่อง + แท็บห้าอัน
 * เอาเฉพาะ "โครง" จากต้นแบบที่เจ้าของส่งมา สีและฟอนต์ยังเป็นของแอปเดิม (พื้นเรียบ ไม่มีกระจก)
 *
 * แท็บเงินเดือนเปิดให้เฉพาะฝ่ายบุคคลกับผู้บริหาร — เป็นข้อมูลค่าจ้างของคนอื่น
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { baht, thaiDate } from "@/lib/format";
import { useHydrated } from "@/lib/pwa";
import { lockScroll } from "@/lib/scroll-lock";
import { useRole } from "@/lib/role";
import {
  HR_EMPTYPE,
  HR_STATUS,
  empYears,
  hrDept,
  hrDocs,
  hrPos,
  probDaysLeft,
  probLine,
  type Employee,
} from "@/lib/hr-data";
import { useHr } from "@/lib/hr-store";
import { CloseIcon } from "./icons";

/**
 * ช่องรูปพนักงาน — ยังไม่มีที่ให้อัปโหลดรูป จึงเป็นกรอบว่างบอกตรง ๆ ว่ายังไม่มีรูป
 * ไม่เอารูปคนอื่นหรือรูปการ์ตูนมาแทน จะได้ไม่มีใครเข้าใจผิดว่าเป็นหน้าจริงของคนนั้น
 */
export function EmpPhoto({ className = "", note = true }: { className?: string; note?: boolean }) {
  return (
    <span
      /* พื้นในกรอบเป็นสีทึบตามต้นแบบ (--field) ไม่ใช่สีโปร่ง ไม่งั้นทับแบนเนอร์แดงแล้วกลายเป็นชมพู */
      className={`relative flex flex-none items-center justify-center overflow-hidden border border-border bg-[#FAFBFC] text-muted-foreground ${className}`}
      aria-hidden="true"
    >
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={note ? "mb-3" : ""}
      >
        <circle cx="12" cy="9" r="3.4" />
        <path d="M4.5 20c0-3.8 3.4-6.2 7.5-6.2s7.5 2.4 7.5 6.2" />
      </svg>
      {note && (
        <em className="absolute right-0 bottom-[7px] left-0 text-center text-[9.5px] leading-tight not-italic">
          ยังไม่มีรูป
        </em>
      )}
    </span>
  );
}

/** ป้ายสถานะ เขียว = ปฏิบัติงานอยู่ · เทา = พ้นสภาพ */
export function StatusPill({ emp, big }: { emp: Employee; big?: boolean }) {
  const gone = emp.status === "left";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[20px] font-semibold ${
        big ? "px-3 py-[4px] text-[12.5px]" : "px-[11px] py-[3px] text-xs"
      } ${gone ? "bg-muted text-muted-foreground" : "bg-[var(--success-soft)] text-[var(--success)]"}`}
    >
      <i className="size-[7px] rounded-full bg-current" />
      {HR_STATUS[emp.status].label}
    </span>
  );
}

export function EmployeeDetail({
  emp,
  today,
  onPass,
  onEdit,
  onClose,
}: {
  emp: Employee;
  today: string;
  onPass: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const hydrated = useHydrated();
  const role = useRole();
  const hr = useHr();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const unlock = lockScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
    };
  }, [onClose]);

  if (!hydrated) return null;

  const p = hrPos(emp.pos);
  /* ตำแหน่งควบ (ถ้ามี) — เงินเดือนกับสายอนุมัติยังอิงตำแหน่งหลัก */
  const more = (emp.posMore ?? []).map((v) => hrPos(v).label).join(" · ");
  const cur = emp.history[emp.history.length - 1];
  const bossName = emp.boss ? hr.emp.find((e) => e.id === emp.boss)?.name : "";
  /* เงินเดือนเป็นข้อมูลค่าจ้างของคนอื่น — เปิดให้เฉพาะฝ่ายบุคคลกับผู้บริหาร */
  const seePay = role === "hr" || role === "ceo";
  const onProbation = emp.type === "probat" && emp.status === "active";

  return createPortal(
    <div
      className="veil-in fixed inset-0 z-80 flex items-end justify-center bg-[rgb(28_20_45/0.42)] sm:items-start sm:p-6 sm:pt-[max(24px,7vh)]"
      role="dialog"
      aria-modal="true"
      aria-label={`ประวัติของ ${emp.name}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* ต้นแบบชุด 1 ต.ค. 2569: กล่องเรียบ หัวกล่องเป็นชื่อพนักงานกับปุ่มปิด
          เนื้อหาเป็นหัวข้อเรียงลงมาในกรอบเลื่อนเดียว ไม่มีแท็บและไม่มีแบนเนอร์แดงแล้ว
          มือถือเป็นแผ่นเลื่อนขึ้นจากด้านล่าง แถวข้อมูลเป็นชื่อซ้าย-ค่าขวาบนพื้นอ่อน */}
      <div className="sheet-in glass-solid flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[24px] shadow-[0_-10px_40px_-18px_rgb(40_25_60/0.5)] sm:max-h-[90dvh] sm:max-w-[680px] sm:rounded-[18px]">
        <div className="flex flex-none items-center justify-between gap-3 border-b border-border px-[18px] py-4 sm:px-5">
          <h2 className="min-w-0 truncate text-[18px] font-bold sm:text-[16.5px]">
            {emp.name}
            {emp.nick && <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">({emp.nick})</span>}
          </h2>
          <span className="flex flex-none items-center gap-2.5">
            <StatusPill emp={emp} />
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="flex size-9 items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <CloseIcon className="size-[15px]" strokeWidth={2.2} />
            </button>
          </span>
        </div>

        <div className="scroll-stable min-h-0 flex-1 overflow-auto px-[18px] pt-1.5 pb-4 sm:px-5 sm:pb-[18px]">
          <Sect title="ข้อมูลการจ้างงาน">
            <Kv>
              <Row k="ตำแหน่ง" v={p.label} />
              {more && <Row k="ตำแหน่งควบ" v={more} />}
              <Row k="แผนก" v={hrDept(p.dept).label} />
              <Row k="ผู้บังคับบัญชา" v={bossName || "ไม่มี"} muted={!bossName} />
              <Row k="ประเภทพนักงาน" v={HR_EMPTYPE[emp.type].label} />
              <Row k="วันเริ่มงาน" v={thaiDate(emp.startedAt)} num />
              {emp.type === "probat" && (
                <Row
                  k="ครบกำหนดทดลองงาน"
                  v={probLine(emp.startedAt, today)}
                  num
                  bad={probDaysLeft(emp.startedAt, today) < 0}
                />
              )}
              <Row k={emp.leftAt ? "ทำงานรวม" : "ทำงานมาแล้ว"} v={empYears(emp.startedAt, today, emp.leftAt)} />
              <Row
                k="สถานะ"
                v={
                  emp.leftAt
                    ? `${HR_STATUS[emp.status].label} · ${thaiDate(emp.leftAt)}${emp.leftWhy ? ` · ${emp.leftWhy}` : ""}`
                    : HR_STATUS[emp.status].label
                }
              />
              {/* BR-04 เงินเดือนเห็นได้เฉพาะฝ่ายบุคคลกับผู้บริหาร */}
              {seePay && <Row k="เงินเดือนปัจจุบัน" v={`${baht(cur.salary)} บาท`} num />}
            </Kv>

            {onProbation && (
              <div className="mt-3 rounded-[11px] border border-border bg-muted/50 px-3.5 py-3">
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  ตอนนี้จ่ายค่าจ้างรายวัน ผ่านทดลองงานแล้วจะเปลี่ยนเป็นพนักงานประจำจ่ายรายเดือน
                  ฝ่ายบุคคลต้องระบุเงินเดือนที่จะใช้ตั้งแต่วันที่มีผล
                </p>
                <button type="button" className="btn solid btn-solid mt-2.5 max-sm:h-11! max-sm:w-full!" onClick={onPass}>
                  บันทึกผ่านทดลองงาน
                </button>
              </div>
            )}
          </Sect>

          <Sect title="ประวัติส่วนตัว">
            <Kv>
              <Row k="ชื่อ-สกุล" v={emp.nick ? `${emp.name} (${emp.nick})` : emp.name} />
              <Row k="เพศ" v={emp.sex} />
              <Row k="วันเกิด" v={emp.birth ? thaiDate(emp.birth) : "—"} num />
              <Row k="วุฒิการศึกษา" v={emp.edu || "—"} />
              <RowNode k="ประสบการณ์ทำงาน">
                {emp.exp.length ? (
                  <ul className="list-none">
                    {emp.exp.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">ไม่มี</span>
                )}
              </RowNode>
            </Kv>
          </Sect>

          <Sect title="ข้อมูลติดต่อ">
            <Kv>
              <Row k="โทรศัพท์" v={emp.phone || "—"} num />
              <Row k="อีเมล" v={emp.email || "ไม่มี"} muted={!emp.email} />
              <Row k="ที่อยู่" v={emp.address || "—"} />
              <RowNode k="ติดต่อฉุกเฉิน">
                {emp.sos.name ? (
                  <>
                    <span className="block">
                      {emp.sos.name}
                      {emp.sos.rel ? ` (${emp.sos.rel})` : ""}
                    </span>
                    {emp.sos.phone && <span className="num block">{emp.sos.phone}</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">ยังไม่ได้บันทึก</span>
                )}
              </RowNode>
            </Kv>
          </Sect>

          <Sect title="เอกสารประกอบ">
            <Docs emp={emp} />
          </Sect>

          {seePay && (
            <Sect title="ประวัติตำแหน่งและเงินเดือน">
              <p className="mb-2.5 text-[12.5px] text-muted-foreground">
                เงินเดือนปัจจุบัน <b className="num text-foreground">{baht(cur.salary)}</b> บาท ·
                เพิ่มเป็นแถวใหม่ทุกครั้งที่ปรับ ไม่ทับของเดิม
              </p>
              <History emp={emp} />
            </Sect>
          )}

          {emp.edited && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              แก้ไขข้อมูลล่าสุดโดย {emp.edited.by} · {thaiDate(emp.edited.at.slice(0, 10))} {emp.edited.at.slice(11)} น.
            </p>
          )}
        </div>

        <div className="grid flex-none grid-cols-[1fr_1.4fr] items-center gap-2.5 border-t border-border px-[18px] py-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:flex sm:justify-end sm:px-5 sm:py-3.5">
          <button type="button" className="btn glass-thin max-sm:h-12! max-sm:justify-center max-sm:rounded-[14px]!" onClick={onClose}>
            ปิด
          </button>
          <button type="button" className="btn solid btn-solid max-sm:h-12! max-sm:justify-center max-sm:rounded-[14px]!" onClick={onEdit}>
            แก้ไขข้อมูล
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── ชิ้นส่วนย่อย ─────────────────────────────────────────────────

export function Sect({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-border pt-4 first:mt-0 first:border-0 first:pt-3">
      <h3 className="mb-2.5 text-[12.5px] font-bold text-primary max-sm:text-[14px]">{title}</h3>
      {children}
    </section>
  );
}

function Kv({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] text-[13.5px] max-sm:rounded-[14px] max-sm:bg-[#FAF6F7] max-sm:px-3.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-2 sm:gap-x-3">
      {children}
    </dl>
  );
}

/** แถวที่ค่าเป็นหลายบรรทัดหรือเป็นรายการ ใช้โครงเดียวกับ Row */
function RowNode({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className={DT}>{k}</dt>
      <dd className={`${DD} max-sm:[&_ul]:text-right`}>{children}</dd>
    </>
  );
}

const DT =
  "text-[12.5px] font-semibold text-muted-foreground max-sm:border-b max-sm:border-[#F0E6E8] max-sm:py-2.5 max-sm:pr-3 max-sm:text-[13.5px] max-sm:font-normal max-sm:whitespace-nowrap max-sm:last-of-type:border-0";
const DD =
  "leading-relaxed max-sm:border-b max-sm:border-[#F0E6E8] max-sm:py-2.5 max-sm:text-right max-sm:font-semibold max-sm:last-of-type:border-0";

function Row({
  k,
  v,
  num,
  muted,
  bad,
}: {
  k: string;
  v: string;
  num?: boolean;
  muted?: boolean;
  bad?: boolean;
}) {
  return (
    <>
      <dt className={DT}>{k}</dt>
      <dd
        className={`${DD} ${num ? "num font-semibold" : ""} ${
          bad ? "text-destructive" : muted ? "text-muted-foreground" : ""
        }`}
      >
        {v}
      </dd>
    </>
  );
}

/**
 * เอกสารประกอบ — บอกว่าขาดอะไรบ้าง ไม่ได้กันไม่ให้ทำอะไรต่อ (S-5)
 * เอกสารไม่ครบเป็นเรื่องที่ต้องตามเก็บ ไม่ใช่เหตุให้พนักงานใช้ระบบไม่ได้
 */
function Docs({ emp }: { emp: Employee }) {
  const missing = hrDocs().filter((d) => d.req && !emp.docs.includes(d.v));
  return (
    <>
      <ul className="text-[13px]">
        {hrDocs().map((d) => {
          const has = emp.docs.includes(d.v);
          const skin = has
            ? "bg-[var(--success-soft)] ring-[var(--success)]"
            : d.req
              ? "bg-[var(--destructive-soft)] ring-destructive"
              : "bg-muted ring-muted-foreground";
          return (
            <li
              key={d.v}
              className={`flex items-center gap-2.5 py-1.5 ${!has && !d.req ? "text-muted-foreground" : ""}`}
            >
              <i className={`size-4 flex-none rounded-full ring-[1.5px] ring-inset ${skin}`} />
              {d.label}
              {!has && (d.req ? " — ยังไม่ได้เก็บ" : " — ไม่มี")}
            </li>
          );
        })}
      </ul>
      <p
        className={`mt-2.5 rounded-[11px] border px-3.5 py-2.5 text-[12.5px] ${
          missing.length
            ? "border-[rgba(192,18,31,.2)] bg-[var(--destructive-soft)] text-destructive"
            : "border-border bg-card text-muted-foreground"
        }`}
      >
        {missing.length ? `ยังขาดเอกสารที่ต้องเก็บ ${missing.length} รายการ` : "เอกสารที่ต้องเก็บครบแล้ว"}
      </p>
    </>
  );
}

/** เรียงใหม่สุดขึ้นก่อน (BR-03) เพราะสิ่งที่ถามบ่อยที่สุดคือความเปลี่ยนแปลงล่าสุด */
function History({ emp }: { emp: Employee }) {
  const rows = [...emp.history].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="scroll-stable overflow-x-auto">
      <table className="data-table min-w-[420px] text-[12.5px]">
        <thead>
          <tr>
            <th style={{ width: 120 }}>วันที่มีผล</th>
            <th style={{ width: 120 }}>ตำแหน่ง</th>
            <th className="r" style={{ width: 110 }}>
              เงินเดือน
            </th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.at}-${r.salary}-${r.note}`}>
              <td className="num muted">{thaiDate(r.at)}</td>
              <td>{hrPos(r.pos).label}</td>
              <td className="r num font-semibold">{baht(r.salary)}</td>
              <td className="muted">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
