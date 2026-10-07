"use client";

/*
 * สรุปเวลาทำงานรายเดือน — ด่านก่อนคำนวณเงินเดือน (ตามต้นแบบ hr-timesheet.html)
 *
 * หน้านี้มีหน้าที่เดียวคือทำให้ตัวเลขเวลาของทุกคน "นิ่ง" ก่อนเอาไปคิดเงิน
 * ปิดรอบแล้วตัวเลขถูกล็อก และปิดแล้วปิดเลย ไม่มีการเปิดกลับ (ตามต้นแบบ)
 * เพราะถ้าแก้ได้ตลอด เงินเดือนที่คำนวณไปแล้วจะไม่ตรงกับข้อมูลที่ใช้คำนวณ
 *
 * พนักงานทดลองงานจ่ายค่าจ้างรายวัน ฐานการจ่ายคนละแบบ จึงแยกเป็นอีกแท็บ ไม่ต่อท้ายตารางเดิม
 * และปิดรอบแยกกลุ่มกัน กลุ่มที่ตรวจเสร็จก่อนไม่ต้องรออีกกลุ่ม (ตามต้นแบบ hr-payroll.html)
 * ของกลุ่มนี้นับเฉพาะวันที่ผ่านมาแล้ว — นับวันในอนาคตด้วยจะกลายเป็นจ่ายค่าจ้างวันที่ยังไม่ได้มาทำงาน
 *
 * รายการที่เครื่องบันทึกเวลาให้มาไม่ครบต้องมีคำอธิบายทุกใบก่อนปิดรอบ
 * ระบบไม่เดาให้ เพราะการเดาผิดหนึ่งวันคือเงินของคนคนหนึ่ง
 */

import { useState } from "react";
import { thaiDate, thaiMonth, todayIso } from "@/lib/format";
import { targetWorkMs } from "@/lib/work-schedule";
import {
  HR_ISSUE_LABEL,
  HR_LEAVE_LABEL,
  HR_OT_LABEL,
  daysOf,
  empOf,
  hrCycle,
  hrPos,
  inPeriod,
  isDaily,
  lateMin,
  leaveDays,
  openIssues,
  otKindAt,
  otHours,
  recIn,
  rolesOfEmployee,
  workedDaysIn,
  type Employee,
  type TimeRec,
  type PayGroup,
  GROUP_LABEL,
} from "@/lib/hr-data";
import {
  closePeriod,
  noteIssue,
  useHr,
} from "@/lib/hr-store";
import { HrSteps, useUrlGroup, useUrlMonth } from "./hr-steps";
import { CycleSheet, GroupBack, GroupTiles, PayHead, PaySummary, useGroupBack, useGroupUrl } from "./hr-pay-mobile";
import { usePendingInMonth, useHrTime, useMissingApproved, type MissingReq } from "@/lib/hr-link";
import { MissingBox } from "./hr-payroll-page";
import { ChevronDownIcon, PencilIcon } from "./icons";
import { Sheet } from "./lead-dialogs";
import { Field, Select } from "./ui";
import { PhoneCard, PhoneList } from "./acchr-phone";

type Tab = "month" | "daily";
/*
 * ชั่วโมงทำงาน (ระบบต้นฉบับ 5 ต.ค. 2569) — วันทำงาน × ชั่วโมงต่อวันตามเวลางานที่ตั้งไว้ (หักพักแล้ว) − นาทีที่มาสาย
 * ไม่รวมโอที (แยกคอลัมน์อยู่แล้ว) · ระบบยังไม่มีเวลากดออกจริงของทุกวัน จึงคิดจากตารางเวลางาน
 */
const workHours = (days: number, r: TimeRec, e: Employee) =>
  /* คิดตามกะของคนนั้น — แม่บ้านเข้า 08:00 เลิก 17:00 ไม่เท่ากับคนอื่น */
  Math.max(0, days * (targetWorkMs(rolesOfEmployee(e)[0]) / 3_600_000) - lateMin(r) / 60);

type Sum = { lateMin: number; lateN: number; lv: number; ot: number };
type Line = { e: Employee; r: TimeRec; days: number };

function sumOf(list: Line[]): Sum {
  return list.reduce(
    (a, { r }) => ({
      lateMin: a.lateMin + lateMin(r),
      lateN: a.lateN + r.late.length,
      lv: a.lv + leaveDays(r),
      ot: a.ot + otHours(r),
    }),
    { lateMin: 0, lateN: 0, lv: 0, ot: 0 },
  );
}

export function HrTimesheetPage() {
  const hr = useHr();
  const today = todayIso();
  /* มาจากขั้นอื่นพร้อม ?m= ก็เปิดรอบนั้นเลย ไม่ต้องเลือกใหม่ (ต้นแบบ urlMonth) */
  const urlMonth = useUrlMonth(hr.periods.map((p) => p.month));
  const [month, setMonth] = useState(urlMonth || hr.periods[hr.periods.length - 1].month);
  const urlGroup = useUrlGroup();
  /* กลุ่มมาจากเมนูย่อย "พนักงาน / ทดลองงาน" ทาง ?g= อย่างเดียว (ระบบต้นฉบับ 5 ต.ค. 2569)
     เก็บเป็นค่าที่คำนวณจาก URL ไม่ใช่ state ไม่งั้นกดเมนูย่อยแล้วตารางไม่เปลี่ยนตาม */
  const tab: Tab = urlGroup === "day" ? "daily" : "month";
  /* เวลาทำงานอ่านผ่านสะพาน — ใบลาใบโอทีของคนที่ผูกบทบาทไว้มาจากใบจริงในระบบ */
  const time = useHrTime();
  /* ใบที่ยังไม่ตัดสินและตกอยู่ในรอบนี้ ปิดรอบไปทั้งที่มีใบค้าง = ตัวเลขจะเปลี่ยนทีหลัง */
  const pending = usePendingInMonth(month);
  /* edit = เปิดจากปุ่มแก้ไข — กล่องจะเปิดช่องแก้รายการแรกให้เลย ไม่ต้องหาเอง */
  const [viewing, setViewing] = useState<{ id: string; edit: boolean } | null>(null);
  const [closing, setClosing] = useState(false);
  /* มือถือ: เลือกกลุ่มก่อน แล้วค่อยเห็นขั้นตอนกับรายการ · เลือกรอบจากปฏิทินแทนดรอปดาวน์ */
  const [mgroup, setMgroup] = useState<Tab | null>(urlGroup ? (urlGroup === "day" ? "daily" : "month") : null);
  const [cal, setCal] = useState(false);
  /* ปุ่มย้อนกลับบนแถบหัว: อยู่ในกลุ่ม = กลับไปหน้าเลือกกลุ่ม */
  const syncGroupUrl = useGroupUrl();
  /* สี่ขั้นนี้คือหน้าเดียวกัน — ปุ่มย้อนกลับพากลับไปหน้าเลือกกลุ่มเสมอ
     ไม่ไล่ย้อนทีละขั้นที่เพิ่งข้ามมา (เจ้าของสั่ง 2 ต.ค. 2569) */
  useGroupBack(mgroup !== null, () => {
    setMgroup(null);
    syncGroupUrl(null);
  });

  const period = hr.periods.find((p) => p.month === month)!;
  /* ปิดรอบทีละกลุ่ม ปุ่มและสถานะจึงอ่านจากแท็บที่เปิดอยู่ */
  const group: PayGroup = tab === "month" ? "month" : "day";
  const locked = group === "month" ? period.closed : period.dayClosed;
  const cycle = hrCycle(month);

  /* คนที่มีรายการต้องตรวจขึ้นก่อน เพราะนั่นคือสิ่งเดียวที่กั้นไม่ให้ปิดรอบ */
  const people = hr.emp
    .filter((e) => inPeriod(e, month))
    .map((e) => {
      const r = recIn(time, e.id, month);
      const days = isDaily(e)
        ? workedDaysIn(e, cycle, time, today)
        : daysOf(e, month).length - leaveDays(r);
      return { e, r, days };
    })
    .sort((a, b) => openIssues(b.r).length - openIssues(a.r).length);

  const monthly = people.filter((x) => !isDaily(x.e));
  const daily = people.filter((x) => isDaily(x.e));

  const dailyDays = daily.reduce((n, x) => n + x.days, 0);
  const dailyOt = daily.reduce((n, x) => n + otHours(x.r), 0);

  const current = viewing ? hr.emp.find((e) => e.id === viewing.id) : undefined;
  const list = tab === "month" ? monthly : daily;
  /* รายการค้างตรวจและใบรออนุมัติ นับเฉพาะคนในกลุ่มที่กำลังดูอยู่ */
  const groupOpen = issuesOf(list);
  const groupPending = list.reduce(
    (n, x) => n + (pending[x.e.id] ? pending[x.e.id].leave + pending[x.e.id].ot : 0),
    0,
  );
  /*
   * ใบลาและใบโอทีที่อนุมัติแล้วแต่ไม่โผล่ในรอบ — เฉพาะคนในกลุ่มที่กำลังดูอยู่
   * รอบเวลาทำงานคือจุดตัดของสองชนิดนี้ ปิดไปทั้งที่ยังไม่เข้า = ชั่วโมงและวันลาหายถาวร
   * จึงกั้นไม่ให้ปิด ไม่ใช่แค่เตือน (ผู้ใช้กำหนด 23 ก.ย. 2569) ส่วนใบเบิกไปกั้นที่รอบเงินเดือน
   */
  const inList = new Set(list.map((x) => x.e.id));
  const missing = useMissingApproved(cycle).filter(
    (x) => x.kind !== "expense" && inList.has(x.emp),
  );
  /*
   * ปิดรอบได้เมื่อถึงวันตัดรอบแล้วเท่านั้น (ผู้ใช้กำหนด 23 ก.ย. 2569) ทั้งกลุ่มรายเดือนและรายวัน
   * วันตัดรอบคือวันสุดท้ายของช่วง อ่านจากค่าที่ผู้ดูแลระบบตั้งไว้ ไม่ใช่เลข 25 ที่เขียนตาย
   * ปิดก่อนถึงวันนั้น = ปิดรอบที่ยังมีวันทำงานเหลืออยู่ ตัวเลขจะเพิ่มหลังปิดแน่นอน
   */
  const cutReady = today >= cycle.to;
  const closeWhy = !cutReady
    ? `ปิดรอบได้เมื่อถึงวันตัดรอบแล้ว (${thaiDate(cycle.to)})`
    : groupOpen > 0
      ? `ยังมีรายการที่ต้องตรวจ ${groupOpen} รายการ`
      : missing.length > 0
        ? `มีใบที่อนุมัติแล้วยังไม่เข้ารอบนี้ ${missing.length} ใบ — ปิดรอบตอนนี้เวลาก้อนนี้จะหาย`
        : undefined;
  const closedAt = group === "month" ? period.closedAt : period.dayClosedAt;
  const closedById = group === "month" ? period.closedBy : period.dayClosedBy;
  const reopenedTimes = (group === "month" ? period.reopened : period.dayReopened).length;
  const closedBy = closedById ? (empOf(hr.emp, closedById)?.name ?? closedById) : "";

  return (
    <div className="space-y-4">
      {/* มือถือ: ชื่อรอบ + ปุ่มปฏิทิน แทนแถบหัวเรื่องกับดรอปดาวน์เดือนของจอคอม */}
      <PayHead title={thaiMonth(month)} onCal={() => setCal(true)} />

      {cal && (
        <CycleSheet
          months={hr.periods.map((p) => p.month)}
          selected={month}
          onPick={(m) => {
            setMonth(m);
            setViewing(null);
            setCal(false);
          }}
          onClose={() => setCal(false)}
        />
      )}

      {mgroup === null && (
        <PaySummary
          items={[
            { k: "คนในรอบ", v: String(people.length), u: "คน" },
            { k: "ต้องตรวจ", v: String(issuesOf(people)), u: "รายการ" },
            { k: "วันลาในรอบ", v: String(people.reduce((n, x) => n + leaveDays(x.r), 0)), u: "วัน" },
            { k: "โอทีในรอบ", v: String(Math.round(people.reduce((n, x) => n + otHours(x.r), 0) * 10) / 10), u: "ชม." },
          ]}
        />
      )}

      {mgroup === null && (
        <GroupTiles
          onPick={(g) => { setMgroup(g); syncGroupUrl(g === "daily" ? "day" : "month"); }}
          month={{
            n: monthly.length,
            note: period.closed ? "ปิดรอบแล้ว" : issuesOf(monthly) ? `ต้องตรวจ ${issuesOf(monthly)} รายการ` : "ตรวจครบแล้ว",
          }}
          daily={{
            n: daily.length,
            note: period.dayClosed ? "ปิดรอบแล้ว" : issuesOf(daily) ? `ต้องตรวจ ${issuesOf(daily)} รายการ` : "ตรวจครบแล้ว",
          }}
        />
      )}

      <div className="bar max-md:hidden!">
        {/* มุมซ้ายบอกว่ากำลังอยู่ขั้นไหนของสายรอบเงินเดือน และรอบนี้กินวันไหนถึงวันไหน
            ดรอปดาวน์ขวาบอกแค่ชื่อเดือน ไม่ได้บอกช่วงวันของรอบ (เจ้าของสั่ง 6 ต.ค. 2569) */}
        <div>
          <h1 className="text-[19px] leading-tight font-bold">ตรวจเวลาทำงาน</h1>
          <p className="num mt-1 text-[13px] text-muted-foreground">
            ช่วงรอบ {thaiDate(cycle.from)} – {thaiDate(cycle.to)}
          </p>
        </div>
        <div className="tools w-full flex-wrap items-end sm:w-auto">
          <Field label="รอบเดือน">
            <Select
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setViewing(null);
              }}
              aria-label="เลือกรอบเดือน"
              className="w-auto min-w-[170px] font-semibold"
            >
              {[...hr.periods].reverse().map((p) => (
                <option key={p.month} value={p.month}>
                  {thaiMonth(p.month)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <div className={mgroup === null ? "max-md:hidden" : ""}>
        <HrSteps month={month} group={tab === "daily" ? "day" : "month"} />
      </div>

      {mgroup !== null && (
        <GroupBack
          label={mgroup === "month" ? "พนักงาน" : "ทดลองงาน"}
          count={mgroup === "month" ? monthly.length : daily.length}
        />
      )}

      <section className={`panel glass flex flex-col ${mgroup === null ? "max-md:hidden!" : ""}`}>
        <div className="strip">
          {/* แท็บสลับกลุ่มเอาออก — เลือกกลุ่มจากเมนูย่อย "พนักงาน / ทดลองงาน" แทน (ระบบต้นฉบับ 5 ต.ค. 2569) */}
          {locked ? (
            /* ปิดแล้วปิดเลย ป้ายแทนที่ปุ่ม ไม่มีทางเปิดกลับ */
            <span className="tag t-ok my-2 ml-auto">
              <i />
              ปิดรอบแล้ว {thaiDate(closedAt)}
            </span>
          ) : (
            /* มือถือ: ปุ่มปิดรอบย้ายไปท้ายรายการ ให้ไล่ดูข้อมูลก่อน (ต้นแบบ pay-bottom) */
            <button
              type="button"
              className="btn solid btn-solid my-2 ml-auto disabled:opacity-45 max-md:hidden!"
              style={{ height: 38 }}
              /* ปิดรอบไม่ได้ถ้ายังไม่ถึงวันตัดรอบ หรือยังมีรายการค้างตรวจ
                 กันตรงนี้ ไม่ใช่ไปเตือนตอนกดยืนยัน */
              disabled={Boolean(closeWhy)}
              title={closeWhy}
              onClick={() => setClosing(true)}
            >
              ปิดรอบ
            </button>
          )}
        </div>

        {/* บนมือถือไม่มีการชี้ค้าง เหตุผลที่ปิดรอบไม่ได้จึงต้องอยู่บนหน้าจอ ไม่ใช่ซ่อนใน title */}
        {!locked && closeWhy && (
          <p className="border-b border-border px-4 py-2.5 text-[12.5px] text-muted-foreground sm:hidden">
            ยังปิดรอบไม่ได้ — {closeWhy}
          </p>
        )}

        {/* ใบที่อนุมัติแล้วแต่ไม่ปรากฏในรอบ — เคยเงียบมาแล้ว ต้องเห็นบนหน้าจอ ไม่ใช่รอให้พนักงานทัก */}
        {missing.length > 0 && <MissingBox rows={missing} emp={hr.emp} />}

        <div className="scroll-stable min-h-0 flex-1 overflow-auto max-sm:hidden">
          <table className="data-table cards-sm min-w-[1100px]">
            <thead>
              <tr>
                <th>พนักงาน</th>
                {tab === "month" ? (
                  <Th w={110} unit="วัน">วันทำงาน</Th>
                ) : (
                  <Th w={118} unit="วัน">วันที่มาทำงาน</Th>
                )}
                <Th w={116} unit="ชม.">ชั่วโมงทำงาน</Th>
                <Th w={104} unit="นาที">มาสาย</Th>
                <Th w={96} unit="วัน">ลา</Th>
                <Th w={124} unit="ชม.">โอทีวันธรรมดา</Th>
                <Th w={116} unit="ชม.">โอทีวันหยุด</Th>
                <th style={{ width: 150 }}>ต้องตรวจ</th>
                <th className="c" style={{ width: 110 }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    {tab === "month" ? "ไม่มีพนักงานในรอบนี้" : "ไม่มีพนักงานทดลองงานในรอบนี้"}
                  </td>
                </tr>
              ) : (
                list.map((x) => (
                  <TimeRow
                    key={x.e.id}
                    line={x}
                    waitDocs={(pending[x.e.id]?.leave ?? 0) + (pending[x.e.id]?.ot ?? 0)}
                    waitDays={pending[x.e.id]?.leaveDays ?? 0}
                    locked={locked}
                    dayLabel={tab === "month" ? "วันทำงาน (วัน)" : "วันที่มาทำงาน (วัน)"}
                    onOpen={() => setViewing({ id: x.e.id, edit: false })}
                    onEdit={() => setViewing({ id: x.e.id, edit: true })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* มือถือ: การ์ดย่อคนละใบ ชื่อ + สถานะตรวจอยู่บนสุด ตัวเลขเวลาเป็นกริด แตะการ์ดเพื่อดูรายวัน */}
        <PhoneList
          empty={
            list.length === 0
              ? tab === "month"
                ? "ไม่มีพนักงานในรอบนี้"
                : "ไม่มีพนักงานทดลองงานในรอบนี้"
              : undefined
          }
        >
          {list.map((x) => (
            <TimeCard
              key={x.e.id}
              line={x}
              waitDocs={(pending[x.e.id]?.leave ?? 0) + (pending[x.e.id]?.ot ?? 0)}
              waitDays={pending[x.e.id]?.leaveDays ?? 0}
              locked={locked}
              dayLabel={tab === "month" ? "วันทำงาน" : "วันที่มาทำงาน"}
              onOpen={() => setViewing({ id: x.e.id, edit: false })}
              onEdit={() => setViewing({ id: x.e.id, edit: true })}
            />
          ))}
        </PhoneList>

        {/* มือถือ: ปุ่มปิดรอบอยู่ท้ายรายการ เต็มความกว้าง (ต้นแบบ pay-bottom ชุด 1 ต.ค. 2569) */}
        {!locked && (
          <div className="px-4 pt-3.5 md:hidden">
            <button
              type="button"
              className="btn solid btn-solid h-[50px]! w-full justify-center rounded-[14px]! text-[15px] disabled:opacity-45"
              disabled={Boolean(closeWhy)}
              onClick={() => setClosing(true)}
            >
              ปิดรอบ
            </button>
          </div>
        )}

        {/* แถบท้ายมีเฉพาะแท็บรายวัน ตามต้นแบบ */}
        {tab === "month" ? null : (
          <div className="foot flex-col items-stretch gap-3 text-center sm:flex-row sm:items-center sm:text-left">
            <span className="flex flex-wrap items-center gap-2">
              คิดค่าจ้างตามวันที่มาทำงานจริง นับถึง {thaiDate(today)}
              <CycleTag
                locked={locked}
                open={groupOpen}
                at={closedAt}
                by={closedBy}
                reopened={reopenedTimes}
              />
            </span>
            {daily.length > 0 && (
              /* สองบรรทัดตาม mockup (dayFoot) */
              <span className="sum flex flex-col sm:ml-auto">
                <span>
                  วันที่มาทำงานรวม<b>{dailyDays}</b> วัน
                </span>
                <span>
                  โอที<b>{dailyOt.toFixed(2)}</b> ชม.
                </span>
              </span>
            )}
          </div>
        )}
      </section>

      {current && viewing && (
        <DayDetail
          key={current.id}
          emp={current}
          month={month}
          locked={locked}
          rec={recIn(time, current.id, month)}
          onClose={() => setViewing(null)}
        />
      )}

      {closing && !locked && (
        <CloseDialog
          month={month}
          group={group}
          blocked={Boolean(closeWhy)}
          why={closeWhy}
          people={list.length}
          sum={sumOf(list)}
          pending={groupPending}
          missing={missing}
          emp={hr.emp}
          today={today}
          onClose={() => setClosing(false)}
        />
      )}
    </div>
  );
}

/** หัวคอลัมน์ตัวเลข — หน่วยอยู่บรรทัดล่าง จะได้ไม่ดันคอลัมน์ให้กว้าง */
function Th({ w, unit, children }: { w: number; unit: string; children: React.ReactNode }) {
  return (
    <th className="c" style={{ width: w }}>
      {children}
      <span className="mt-0.5 block text-[10.5px] font-medium text-muted-foreground">({unit})</span>
    </th>
  );
}

function TimeRow({
  line: { e, r, days },
  waitDocs,
  waitDays,
  locked,
  dayLabel,
  onOpen,
  onEdit,
}: {
  line: Line;
  /** จำนวนใบลา/โอทีของคนนี้ที่ผู้อนุมัติยังไม่ตัดสิน — ตัวเลขของรอบยังขยับได้ */
  waitDocs: number;
  /** วันลาที่ยื่นไว้แต่ยังไม่อนุมัติ — ยังไม่เข้าช่อง "ลา" ของรอบ */
  waitDays: number;
  locked: boolean;
  dayLabel: string;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const open = openIssues(r).length;
  const fixed = r.issues.length - open;
  return (
    /* กดที่ไหนก็ได้ในแถวเพื่อดูรายละเอียดรายวัน ไม่ต้องเล็งปุ่มเล็ก ๆ */
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
      aria-label={`ดูรายละเอียดรายวันของ ${e.name}`}
      className={`cursor-pointer ${open ? "bg-[#FFF7F7]" : ""}`}
    >
      <td data-label="พนักงาน">
        <b className="block truncate text-[13.5px] font-semibold">{e.name}</b>
        <em className="block truncate text-[11.5px] not-italic text-muted-foreground">
          {hrPos(e.pos).label}
        </em>
      </td>
      <td data-label={dayLabel} className="c num">
        {days}
      </td>
      <Num label="ชั่วโมงทำงาน (ชม.)" v={workHours(days, r, e)} fixed2 />
      <Num label="มาสาย (นาที)" v={lateMin(r)} />
      {/* ลา = ที่อนุมัติแล้วเท่านั้น · ใบที่ยังรออนุมัติบอกไว้ข้างล่าง ยังไม่นับเป็นวันลา */}
      <td data-label="ลา (วัน)" className={`c num ${leaveDays(r) ? "" : "text-muted-foreground"}`}>
        {leaveDays(r)}
        {waitDays > 0 && (
          <span className="mt-0.5 block text-[10.5px] font-medium text-[var(--warning)]">
            รออนุมัติ {waitDays}
          </span>
        )}
      </td>
      <Num label="โอทีวันธรรมดา (ชม.)" v={otHours(r, "after_work")} fixed2 />
      {/* วันหยุดราชการรวมอยู่ในช่องวันหยุด — ต้นแบบแยกแค่วันธรรมดากับวันหยุด (เรตยังคิดแยกในเงินเดือน) */}
      <Num label="โอทีวันหยุด (ชม.)" v={otHours(r, "holiday") + otHours(r, "public")} fixed2 />
      <td data-label="ต้องตรวจ">
        {open > 0 ? (
          /* ป้ายนี้เป็นปุ่มจริง ๆ — เดิมเป็นข้อความเฉย ๆ ต้องเดาว่าคลิกทั้งแถวได้
             (ทดสอบฝ่ายบุคคล 30 ก.ย. 2569) */
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onOpen();
            }}
            className="tag t-late cursor-pointer underline-offset-2 hover:underline"
            aria-label={`ตรวจรายการของ ${e.name} ${open} รายการ`}
          >
            <i />
            ต้องตรวจ {open} ›
          </button>
        ) : fixed > 0 ? (
          <span className="tag t-early">
            <i />
            บันทึกเหตุผลแล้ว
          </span>
        ) : waitDocs > 0 ? (
          /* ใบลา/โอทีที่ยังไม่ตัดสินทำให้ตัวเลขยังขยับได้ — บอกตั้งแต่ในตาราง
             ไม่ใช่ไปรู้ตอนกดปิดรอบ (ทดสอบฝ่ายบุคคล 30 ก.ย. 2569) */
          <span className="tag t-early">
            <i />
            รออนุมัติ {waitDocs} ใบ
          </span>
        ) : (
          <span className="tag t-ok">
            <i />
            ครบถ้วน
          </span>
        )}
      </td>
      <td data-label="จัดการ" className="c">
        {/* แถวที่ครบถ้วนไม่มีอะไรต้องแก้ ปุ่มแก้ไขจึงขึ้นเฉพาะแถวที่มีรายการต้องตรวจ */}
        {locked || r.issues.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onEdit();
            }}
            aria-label={`แก้ไขเวลาของ ${e.name}`}
            title="แก้ไข"
            className="iconbtn glass-thin mx-auto"
            style={{ width: 32, height: 32 }}
          >
            <PencilIcon className="size-4" strokeWidth={1.9} />
          </button>
        )}
      </td>
    </tr>
  );
}

/** การ์ดของหนึ่งคนบนมือถือ — ข้อมูลชุดเดียวกับแถวในตาราง */
function TimeCard({
  line: { e, r, days },
  waitDocs,
  waitDays,
  locked,
  dayLabel,
  onOpen,
  onEdit,
}: {
  line: Line;
  /** ใบลา/โอทีที่ยังไม่ตัดสินของคนนี้ */
  waitDocs: number;
  waitDays: number;
  locked: boolean;
  dayLabel: string;
  onOpen: () => void;
  onEdit: () => void;
}) {
  /*
   * ต้นแบบชุด 1 ต.ค. 2569 (บล็อก ts-collapse) พับการ์ดไว้ก่อน
   * เห็นแค่ชื่อ ตำแหน่ง และสถานะต้องตรวจ แตะแล้วค่อยกางตัวเลขของรอบ
   * รอบหนึ่งมีสิบกว่าคน ถ้ากางหมดตั้งแต่แรกต้องปัดยาวกว่าจะเจอคนที่ติดปัญหา
   */
  const [open, setOpen] = useState(false);
  const issues = openIssues(r).length;
  const fixed = r.issues.length - issues;
  const late = lateMin(r);
  const lv = leaveDays(r);
  const otW = otHours(r, "after_work");
  const otH = otHours(r, "holiday") + otHours(r, "public");
  const badge =
    issues > 0 ? (
      <span className="tag t-late">
        <i />
        ต้องตรวจ {issues}
      </span>
    ) : fixed > 0 ? (
      <span className="tag t-early">
        <i />
        บันทึกเหตุผลแล้ว
      </span>
    ) : waitDocs > 0 ? (
      <span className="tag t-early">
        <i />
        รออนุมัติ {waitDocs} ใบ
      </span>
    ) : (
      <span className="tag t-ok">
        <i />
        ครบถ้วน
      </span>
    );
  return (
    <PhoneCard
      title={e.name}
      sub={hrPos(e.pos).label}
      alert={issues > 0}
      /* สถานะอยู่ขวาชื่อ เห็นได้ทั้งตอนพับและตอนกาง */
      amount={badge}
      onOpen={() => setOpen(!open)}
      openLabel={`${open ? "ซ่อน" : "ดู"}รายละเอียดของ ${e.name}`}
      statRows
      stats={
        open
          ? [
              { label: dayLabel, value: `${days} วัน` },
              { label: "มาสาย (นาที)", value: late, muted: !late },
              /* ลาที่อนุมัติแล้ว · ใบที่ยังรออนุมัติต่อท้ายให้เห็น ยังไม่นับเป็นวันลา */
              { label: "ลา (วัน)", value: waitDays > 0 ? `${lv} (รอ ${waitDays})` : lv, muted: !lv && !waitDays },
              { label: "โอทีวันธรรมดา", value: `${otW.toFixed(2)} ชม.`, muted: !otW },
              { label: "โอทีวันหยุด", value: `${otH.toFixed(2)} ชม.`, muted: !otH },
            ]
          : undefined
      }
      actions={
        open ? (
          <>
            <button
              type="button"
              className="btn border-0! bg-[#FAF6F7]! font-bold text-primary!"
              onClick={onOpen}
            >
              ดูรายละเอียดรายวัน
            </button>
            {!locked && r.issues.length > 0 && (
              <button type="button" className="btn glass-thin" onClick={onEdit}>
                <PencilIcon className="size-4" strokeWidth={1.9} />
                แก้ไขรายการที่ต้องตรวจ
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {/* บอกว่าแตะได้ ไม่งั้นการ์ดที่พับอยู่ดูเหมือนไม่มีอะไรข้างใน */}
      <p className="mt-1.5 flex items-center gap-1 text-[12px] whitespace-nowrap text-[#9A8E91]">
        {open ? "ซ่อนรายละเอียด" : "แตะเพื่อดูรายละเอียด"}
        <ChevronDownIcon className={`size-3.5 ${open ? "rotate-180" : ""}`} strokeWidth={2.4} />
      </p>
    </PhoneCard>
  );
}

/** ศูนย์ให้จางลง เพื่อให้ตาจับเฉพาะช่องที่มีตัวเลขจริง */
function Num({ label, v, fixed2 }: { label: string; v: number; fixed2?: boolean }) {
  return (
    <td data-label={label} className={`c num ${v ? "" : "text-muted-foreground"}`}>
      {fixed2 ? v.toFixed(2) : v}
    </td>
  );
}

// ─── รายละเอียดรายวันของคนเดียว ───────────────────────────────────

function DayDetail({
  emp,
  month,
  locked,
  rec,
  onClose,
}: {
  emp: Employee;
  month: string;
  locked: boolean;
  rec: TimeRec;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});

  /* รวมทุกอย่างเข้าเป็น "วันที่" เดียวกัน เพราะวันหนึ่งอาจมาสายและมีโอทีพร้อมกัน */
  const byDay = new Map<string, React.ReactNode[]>();
  const push = (d: string, node: React.ReactNode) => {
    byDay.set(d, [...(byDay.get(d) ?? []), node]);
  };

  for (const x of rec.late) {
    push(
      x.d,
      <span key={`late-${x.d}`} className="flex flex-wrap items-center gap-2">
        <span className="tag t-late">
          <i />
          มาสาย {x.min} นาที
        </span>
        {x.was != null && (
          <em className="num basis-full text-[11.5px] not-italic text-muted-foreground">
            แก้จาก {x.was} นาที
          </em>
        )}
      </span>,
    );
  }

  for (const x of rec.leave) {
    push(
      x.d,
      <span key={`lv-${x.d}`} className="tag t-info">
        <i />
        {HR_LEAVE_LABEL[x.type]}
        {x.span === "half" ? " ครึ่งวัน" : ""}
      </span>,
    );
  }

  for (const x of rec.ot) {
    push(
      x.d,
      <span key={`ot-${x.d}`} className="flex flex-wrap items-center gap-2">
        <span className="tag t-early">
          <i />
          โอที {x.h.toFixed(2)} ชม. {HR_OT_LABEL[otKindAt(x)]}
        </span>
        {x.was != null && (
          <em className="num basis-full text-[11.5px] not-italic text-muted-foreground">
            แก้จาก {x.was.toFixed(2)} ชม.
          </em>
        )}
      </span>,
    );
  }

  const days = [...byDay.keys()].sort();

  return (
    <Sheet
      title={`${emp.name} ${thaiMonth(month)}`}
      wide
      onClose={onClose}
      footer={
        <button type="button" className="btn glass-thin" onClick={onClose}>
          ปิด
        </button>
      }
    >
      {/* มือถือ: รายการที่ต้องตรวจขึ้นก่อน เพราะเป็นงานที่ต้องทำ ส่วนวันที่มีรายการเป็นข้อมูลอ่านอย่างเดียว
          (ต้นแบบ ts-detail ชุด 1 ต.ค. 2569) */}
      <div className="max-sm:flex max-sm:flex-col max-sm:gap-3.5">
      {/* ผู้ใช้สั่ง 1 ต.ค. 2569 — กล่องนี้แสดงตัวเลขกับข้อมูลพอ หัวข้อไหนไม่มีของก็ไม่ต้องขึ้น */}
      {days.length > 0 && (
      <section>
        <h3 className="mb-2.5 text-[12.5px] font-bold text-primary max-sm:text-[14px] max-sm:text-foreground">วันที่มีรายการ</h3>
        {(
          days.map((d) => (
            <div key={d} className={`border-t border-border py-3 first:border-t-0 first:pt-1 max-sm:mb-2 ${PANEL_DAY}`}>
              <p className={`num text-[12px] font-semibold text-muted-foreground ${PANEL_DT}`}>{thaiDate(d)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">{byDay.get(d)}</div>
            </div>
          ))
        )}
      </section>
      )}

      {rec.issues.length > 0 && (
      <section className="mt-5 border-t border-border pt-4 max-sm:order-first max-sm:mt-0 max-sm:border-0 max-sm:pt-0">
        <h3 className="mb-2.5 text-[12.5px] font-bold text-primary max-sm:text-[14px]">รายการที่ต้องตรวจ</h3>
        {(
          rec.issues.map((x) => (
            /* รายการที่ยังไม่ได้บันทึกเหตุผล ขึ้นกรอบชมพูให้สะดุดตา */
            <div
              key={x.d}
              className={`border-t border-border py-3 first:border-t-0 first:pt-1 max-sm:mb-2 ${PANEL_DAY} ${
                x.note || locked ? "" : "max-sm:border-[1.5px]! max-sm:border-[#F4D3D9]! max-sm:bg-card!"
              }`}
            >
              <p className={`num text-[12px] font-semibold text-muted-foreground ${PANEL_DT}`}>{thaiDate(x.d)}</p>
              <span className={`tag mt-2 ${x.note ? "t-early" : "t-late"}`}>
                <i />
                {HR_ISSUE_LABEL[x.kind]}
              </span>
              {x.note ? (
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  {x.absent ? "สรุปว่าขาดงาน · หักเต็มวัน · " : "ตรวจแล้ว มาทำงานจริง · "}
                  {x.note}
                </p>
              ) : locked ? (
                <p className="mt-2 text-[12.5px] text-muted-foreground">รอบนี้ปิดแล้ว</p>
              ) : (
                <div className="mt-2.5 flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
                  <input
                    value={notes[x.d] ?? ""}
                    onChange={(e) => setNotes((v) => ({ ...v, [x.d]: e.target.value }))}
                    placeholder="ระบุเหตุผลหรือผลการตรวจสอบ"
                    aria-label={`เหตุผลของวันที่ ${thaiDate(x.d)}`}
                    style={{ height: 36 }}
                    className="field-control min-w-0 flex-1 rounded-[10px] px-3 text-[13px] max-sm:h-[46px]! max-sm:w-full max-sm:rounded-[12px] max-sm:text-[14.5px]"
                  />
                  {/* สองทางเท่านั้น — มาทำงานจริง (ไม่หัก) หรือขาดงานจริง (หักเต็มวัน)
                      ต้องให้ฝ่ายบุคคลสรุป ไม่ใช่ให้ระบบเดาจากการไม่มีบันทึกเวลา (เจ้าของตัดสิน 6 ต.ค. 2569) */}
                  <button
                    type="button"
                    className="btn glass-thin flex-none disabled:opacity-45 max-sm:h-[46px]! max-sm:w-full max-sm:justify-center max-sm:rounded-[12px]!"
                    disabled={!(notes[x.d] ?? "").trim()}
                    onClick={() => noteIssue(emp.id, x.d, (notes[x.d] ?? "").trim())}
                  >
                    มาทำงานจริง
                  </button>
                  <button
                    type="button"
                    className="btn solid btn-solid flex-none disabled:opacity-45 max-sm:h-[46px]! max-sm:w-full max-sm:justify-center max-sm:rounded-[12px]!"
                    disabled={!(notes[x.d] ?? "").trim()}
                    title="หักเงินเต็มวันตามค่าจ้างรายวันในรอบนี้"
                    onClick={() => noteIssue(emp.id, x.d, (notes[x.d] ?? "").trim(), true)}
                  >
                    ขาดงาน
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>
      )}

      {/* ไม่มีอะไรผิดปกติเลย ต้องบอกสั้น ๆ ไม่ใช่ปล่อยกล่องว่าง */}
      {days.length === 0 && rec.issues.length === 0 && (
        <p className="text-[12.5px] text-muted-foreground">ไม่มีวันที่ผิดจากปกติในรอบนี้</p>
      )}
      </div>
    </Sheet>
  );
}

/* มือถือ: แต่ละวันในกล่องรายละเอียดเป็นการ์ด ไม่ใช่แถวคั่นเส้น (ต้นแบบ ts-detail) */
const PANEL_DAY =
  "max-sm:flex max-sm:flex-col max-sm:items-start max-sm:gap-2 max-sm:rounded-[14px] max-sm:border-0! max-sm:bg-[#FAF6F7] max-sm:px-3.5 max-sm:py-3 max-sm:first:pt-3";
const PANEL_DT = "max-sm:text-[14px] max-sm:font-bold max-sm:text-foreground";

/* ปิดรอบต้องเคลียร์ทั้งสองแท็บ บอกบนแท็บเลยว่าค้างอยู่ฝั่งไหน ไม่งั้นต้องสลับไปหาเอง */
function issuesOf(list: { r: Parameters<typeof openIssues>[0] }[]) {
  return list.reduce((n, x) => n + openIssues(x.r).length, 0);
}

// ─── ปิดรอบ ──────────────────────────────────────────────────────

function CloseDialog({
  month,
  group,
  blocked,
  why,
  people,
  sum,
  pending,
  missing,
  emp,
  today,
  onClose,
}: {
  month: string;
  group: PayGroup;
  blocked: boolean;
  why?: string;
  people: number;
  sum: Sum;
  pending: number;
  missing: MissingReq[];
  emp: Employee[];
  today: string;
  onClose: () => void;
}) {
  const c = hrCycle(month);

  function confirm() {
    /* กันไว้อีกชั้น เผื่อสถานะเปลี่ยนระหว่างเปิดกล่อง */
    if (blocked) return;
    closePeriod(month, today, group);
    onClose();
  }

  return (
    <Sheet
      title="ปิดรอบเวลาทำงาน"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn solid btn-solid disabled:opacity-45"
            disabled={blocked}
            title={why}
            onClick={confirm}
          >
            ยืนยัน
          </button>
        </>
      }
    >
      {/* มือถือ: สรุปว่ากำลังปิดรอบไหน กลุ่มไหน เป็นกล่องสีชมพูอ่านง่าย (ต้นแบบ pay-dlg) */}
      <p className="text-[12.5px] text-muted-foreground max-sm:flex max-sm:flex-col max-sm:gap-0.5 max-sm:rounded-[14px] max-sm:bg-[#FDF0F2] max-sm:px-3.5 max-sm:py-3 max-sm:text-[13px]">
        <span className="max-sm:text-[16px] max-sm:font-bold max-sm:text-foreground">รอบ {thaiMonth(month)}</span>
        <span className="max-sm:text-[#8A5560]">
          <span className="max-sm:hidden"> · </span>
          {thaiDate(c.from)} – {thaiDate(c.to)}
        </span>
        <span className="max-sm:font-bold max-sm:text-primary">
          <span className="max-sm:hidden"> · </span>กลุ่ม {GROUP_LABEL[group]}
        </span>
      </p>
      {why && (
        <p className="mt-3 rounded-[11px] border border-[rgba(192,18,31,.2)] bg-[var(--destructive-soft)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-destructive">
          ยังปิดรอบไม่ได้ · {why}
        </p>
      )}
      {/* ขาดใบไหนต้องเห็นตรงนี้ด้วย ไม่ใช่เห็นแค่จำนวนแล้วเดาเอาเอง */}
      {missing.length > 0 && (
        <div className="-mx-3">
          <MissingBox rows={missing} emp={emp} />
        </div>
      )}

        <>
          <dl className="mt-3 grid gap-2 text-[13.5px] max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-0 max-sm:rounded-[14px] max-sm:bg-[#FAF6F7] max-sm:px-3.5 max-sm:[&>dd]:border-b max-sm:[&>dd]:border-[#F0E6E8] max-sm:[&>dd]:py-2.5 max-sm:[&>dd]:text-right max-sm:[&>dd]:last-of-type:border-0 max-sm:[&>dt]:border-b max-sm:[&>dt]:border-[#F0E6E8] max-sm:[&>dt]:py-2.5 max-sm:[&>dt]:pr-3 max-sm:[&>dt]:font-normal! max-sm:[&>dt]:whitespace-nowrap max-sm:[&>dt]:last-of-type:border-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-4">
            <dt className="text-[12.5px] font-semibold text-muted-foreground">พนักงานในรอบ</dt>
            <dd className="num font-semibold">{people} คน</dd>
            <dt className="text-[12.5px] font-semibold text-muted-foreground">มาสาย</dt>
            <dd className="num font-semibold">
              {sum.lateMin} นาที ({sum.lateN} ครั้ง)
            </dd>
            <dt className="text-[12.5px] font-semibold text-muted-foreground">ลา</dt>
            <dd className="num font-semibold">{sum.lv} วัน</dd>
            <dt className="text-[12.5px] font-semibold text-muted-foreground">ชั่วโมงล่วงเวลา</dt>
            <dd className="num font-semibold">{sum.ot.toFixed(2)} ชม.</dd>
          </dl>
          {pending > 0 && (
            /* ไม่ห้ามปิด เพราะใบที่ค้างอาจเป็นของรอบถัดไปที่ยื่นล่วงหน้า
               แต่ต้องเห็นก่อนกด ไม่ใช่ไปรู้ตอนมีคนทักว่าตัวเลขไม่ตรง */
            <p className="mt-3 rounded-[11px] border border-[rgba(180,99,11,.25)] bg-[var(--warning-soft)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[var(--warning)]">
              รอบนี้ยังมีใบลาหรือใบโอทีที่ผู้อนุมัติยังไม่ตัดสิน {pending} ใบ
              ถ้าอนุมัติหลังปิดรอบ ตัวเลขจะไม่ตรงกับที่ปิดไป
            </p>
          )}
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground max-sm:rounded-[14px] max-sm:bg-[#FFF6E5] max-sm:px-3.5 max-sm:py-3 max-sm:text-[13px] max-sm:text-[#7A4A07]">
            ปิดรอบแล้วแก้ไขข้อมูลของกลุ่มนี้ไม่ได้อีก และข้อมูลจะถูกส่งไปยังการคำนวณเงินเดือน ตรวจให้ครบก่อนกดปิด
          </p>
        </>
    </Sheet>
  );
}

/** ป้ายบอกสถานะรอบของกลุ่มที่กำลังดู — ปิดแล้ว ค้างตรวจ หรือยังไม่ปิด */
function CycleTag({
  locked,
  open,
  at,
  by,
  reopened,
}: {
  locked: boolean;
  open: number;
  at: string;
  by: string;
  reopened: number;
}) {
  if (locked) {
    return (
      <span className="tag t-ok">
        <i />
        ปิดรอบแล้ว {thaiDate(at)}
        {by && ` โดย ${by}`}
        {reopened > 0 && ` · เคยเปิดรอบใหม่ ${reopened} ครั้ง`}
      </span>
    );
  }
  return open > 0 ? (
    <span className="tag t-late">
      <i />
      ยังมีรายการต้องตรวจ {open}
    </span>
  ) : (
    /* ยังไม่ปิดและไม่มีรายการค้างตรวจ — ข้อความตาม mockup (rangetag free) */
    <span className="tag t-miss">
      <i />
      รอบยังไม่จบ ตัวเลขจะเพิ่มทุกวันทำงาน
    </span>
  );
}
