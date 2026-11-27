"use client";

/*
 * ประสิทธิภาพพนักงาน — หน้าของผู้จัดการทั่วไป (ยกหน้ามาจาก ERP_Test · รอบที่ 136)
 *
 * ท่าพักเป็นรายชื่อพนักงานล้วน ๆ ไม่มีตัวเลข — กดชื่อแล้วรายละเอียดกางออกในรายการ
 * ข้างในมี 3 แถบพอดี (งาน · การเข้างาน · KPI)
 * ไม่มีคะแนนรวมและไม่เรียงลำดับเทียบกัน เพราะเจ้าของตัดสินไว้ว่าไม่เทียบข้ามตำแหน่ง
 *
 * ตัวเลขมาจากฟังก์ชันของฐานข้อมูล (lib/emp-performance) ไม่คิดจากข้อมูลรายใบในเครื่อง
 * KPI ยังไม่มีข้อมูลในระบบ จึงขึ้นว่ายังไม่มีข้อมูล ไม่ใส่ตัวเลขสมมติ
 */

import { useMemo, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { SearchBox } from "@/components/sales-ui";
import { displayName, initialOf, nameHay } from "@/lib/emp-name";
import {
  BAND_CLS,
  BAND_LABEL,
  bandOf,
  hhmm,
  PERIOD_TEXT,
  perfOf,
  RANGE_KEYS,
  rangeKeyOf,
  usePerfSources,
  type PerfOf,
} from "@/lib/emp-performance";
import { todayIso } from "@/lib/format";
import { hrDept, hrPos, type Employee } from "@/lib/hr-data";
import { useHr } from "@/lib/hr-store";
import { RANGE_LABEL } from "@/lib/sales-report";

const num = (n: number) => Number(n).toLocaleString("th-TH");

function Bar({ pct }: { pct: number | null }) {
  const b = bandOf(pct);
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={pct == null ? BAND_LABEL.none : `${pct}%`}
    >
      {pct != null && (
        <span
          className={`block h-full rounded-full ${BAND_CLS[b].fill}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      )}
    </div>
  );
}

function Measure({ title, pct, main, extra }: { title: string; pct: number | null; main: string; extra?: string }) {
  const b = bandOf(pct);
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${BAND_CLS[b].chip}`}>
          {BAND_LABEL[b]}
        </span>
      </div>
      <p className="num mt-1.5 text-[12.5px] leading-[1.6]">{main}</p>
      {extra && <p className="num mt-0.5 text-[11.5px] leading-[1.6] text-muted-foreground">{extra}</p>}
      <Bar pct={pct} />
    </div>
  );
}

/** 3 แถบของคนหนึ่งคน */
function Measures({ p, period }: { p: PerfOf; period: string }) {
  const { task, att } = p;
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      <Measure
        title="ประสิทธิภาพงาน"
        pct={task.pct}
        main={
          task.denom > 0
            ? `ส่งทันกำหนด ${num(task.onTime)} จาก ${num(task.denom)} งาน${task.pct != null ? ` (${task.pct}%)` : ""}`
            : `ไม่มีงานที่ครบกำหนด${period}ให้วัด`
        }
        extra={`ส่งช้า ${num(task.late)} · เลยกำหนดยังไม่ส่ง ${num(task.overdue)} · รอลูกค้าตรวจ ${num(task.waiting)} (ไม่นับเป็นความช้า)`}
      />
      <Measure
        title="การเข้างาน"
        pct={att.pct}
        main={
          att.days > 0
            ? `เข้างานตรงเวลา ${num(att.onTime)} จาก ${num(att.days)} วันที่มาทำงาน${att.pct != null ? ` (${att.pct}%)` : ""}`
            : `ไม่มีวันที่ตอกบัตรเข้างาน${period}`
        }
        extra={att.days > 0 ? `มาสาย ${num(att.late)} วัน · เวลาเข้าเฉลี่ย ${hhmm(att.avgIn)}` : undefined}
      />
      {/* KPI ยังไม่มีข้อมูลในระบบ — ปล่อยแถบว่างไว้ ไม่ใส่ตัวเลขสมมติ */}
      <Measure title="KPI" pct={null} main="ยังไม่มีข้อมูล KPI ในระบบ" />
    </div>
  );
}

export function GmPerformancePage({ initialRange }: { initialRange?: string }) {
  const today = todayIso();
  const hr = useHr();
  const [range, setRange] = useState(rangeKeyOf(initialRange));
  const { span, tasks, att, loading } = usePerfSources(range, today);

  const [q, setQ] = useState("");
  const [deptF, setDeptF] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  /* วัดเฉพาะคนที่ยังปฏิบัติงานอยู่ */
  const people = useMemo(() => hr.emp.filter((e: Employee) => e.status === "active"), [hr.emp]);
  const deptOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of people) {
      const d = hrPos(e.pos).dept;
      m.set(d, hrDept(d).label);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "th"));
  }, [people]);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return people
      .filter((e) => !deptF || hrPos(e.pos).dept === deptF)
      .filter((e) => !k || nameHay(e).toLowerCase().includes(k))
      .sort((a, b) => displayName(a).localeCompare(displayName(b), "th"));
  }, [people, q, deptF]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-bold">ประสิทธิภาพพนักงาน</h1>
          <p className="num mt-0.5 text-[12px] text-muted-foreground">{span.note}</p>
        </div>
        <div className="seg glass-thin" role="group" aria-label="ช่วงเวลา">
          {RANGE_KEYS.map((r) => (
            <button
              key={r}
              type="button"
              className={range === r ? "on" : ""}
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="ค้นหาชื่อหรือชื่อเล่น" />
        <select
          className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[13px] sm:w-[190px]"
          value={deptF}
          onChange={(ev) => setDeptF(ev.target.value)}
          aria-label="กรองตามแผนก"
        >
          <option value="">ทุกแผนก</option>
          {deptOpts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <p className="num text-[12px] text-muted-foreground">
        {num(list.length)} คน · กดชื่อเพื่อดูประสิทธิภาพ{PERIOD_TEXT[range]}
        {loading && " · กำลังอ่านตัวเลข…"}
      </p>

      {list.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          ไม่พบพนักงานตามตัวกรองนี้
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((e) => {
            const open = sel === e.id;
            const pos = hrPos(e.pos);
            return (
              <li key={e.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                  aria-expanded={open}
                  onClick={() => setSel(open ? null : e.id)}
                >
                  {/* รูปสี่เหลี่ยมจัตุรัสตามต้นแบบ ไม่ใช่วงกลม */}
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-[14px] font-bold"
                    aria-hidden="true"
                  >
                    {initialOf(e)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{displayName(e)}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {pos.label} · {hrDept(pos.dept).label}
                    </span>
                  </span>
                  <ChevronDownIcon
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open && (
                  <div className="border-t border-border bg-muted/30 p-3">
                    <Measures p={perfOf(e.id, tasks, att)} period={PERIOD_TEXT[range]} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
