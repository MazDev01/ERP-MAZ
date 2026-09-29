"use client";

import Link from "next/link";

import { useMemo, useRef, useState } from "react";
import {
  CLAIM_STATUS,
  checkClaim,
  fuelRate,
  fuelAmount,
  fuelRowMiss,
  fuelTotal,
  otherRowProblem,
  otherTotal,
  isLocked,
  type FuelMiss,
  type FuelRow,
  type OtherRow,
} from "@/lib/expense-data";
import { optionsOf } from "@/lib/options";
import { useAddOption } from "./add-option";
import {
  addFuelRow,
  addOtherRow,
  removeOtherRow,
  updateOtherRow,
  claimOf,
  monthKey,
  removeFuelRow,
  setClaimField,
  submitClaim,
  updateFuelRow,
  useExpenseClaims,
  withdrawClaim,
} from "@/lib/expense-store";
import { TH_MONTHS_FULL, baht, bkkNow, pad2, thaiMonth as thaiMonthName, thaiStamp } from "@/lib/format";
import { useProfile } from "@/lib/profile-data";
import { hasNoApprover, useApprovalRoute, useRole } from "@/lib/role";
import {
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  ChevronRightIcon,
  PlusIcon,
  PrintIcon,
  RotateIcon,
  TrashIcon,
} from "./icons";
import { ApproverNote } from "./approver-note";

import { DateField } from "./thai-date-picker";
/*
 * ใบเบิกมีแค่ค่าน้ำมันรถ (ERD expense_claim: fuel / other)
 * ค่าคอมมิชชั่นคิดในเงินเดือนที่ฝ่ายบุคคลคำนวณจากดีลจริงแล้ว (payroll_line) ไม่ได้เบิกผ่านใบนี้ — กันได้ซ้ำสองทาง
 */

export function ExpensePage() {
  const claims = useExpenseClaims();
  const me = useProfile();
  const today = bkkNow();
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  /** โชว์ที่กรอกไม่ครบหลังกดยื่นครั้งแรก ไม่ขึ้นเตือนตั้งแต่ยังไม่ได้กรอก */
  const [tried, setTried] = useState(false);

  const month = monthKey(view);
  const claim = useMemo(() => claimOf(claims, month), [claims, month]);
  const locked = isLocked(claim.status);
  const monthLabel = `${TH_MONTHS_FULL[view.getMonth()]} ${view.getFullYear() + 543}`;

  /** เดือนหน้ายังมาไม่ถึง ไม่ให้เบิกล่วงหน้า */
  const atLatest =
    view.getFullYear() > today.getFullYear() ||
    (view.getFullYear() === today.getFullYear() && view.getMonth() >= today.getMonth());

  /* ใบนี้มีคนอนุมัติไหม — ผู้อนุมัติที่ตั้งไว้เป็นคนเดียวกับผู้ยื่นก็เท่ากับไม่มี */
  const noApprover = hasNoApprover(useRole(), "expense", useApprovalRoute());
  const check = checkClaim(claim);
  const reasons = noApprover
    ? [...check.reasons, "ใบนี้ยังไม่มีผู้อนุมัติ — ให้ผู้ดูแลระบบแก้สายอนุมัติก่อน"]
    : check.reasons;
  const fuelSum = fuelTotal(claim.fuel);
  const otherSum = otherTotal(claim.other);
  /* กล่องบอกเหตุผล — กดยื่นแล้วต้องเห็นทันที ถึงจะกำลังมองตารางอยู่ก็ตาม
     (เคยขึ้นข้อความไว้เหนือตารางเฉย ๆ คนกดเลยคิดว่ากดแล้วไม่มีอะไรเกิดขึ้น) */
  const alertRef = useRef<HTMLDivElement>(null);

  function trySubmit() {
    setTried(true);
    if (reasons.length) {
      /* พาสายตาไปที่เหตุผล แล้วโฟกัสช่องแรกที่ยังไม่ครบให้เลย */
      requestAnimationFrame(() => {
        alertRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        const box = document.querySelector<HTMLElement>("[data-miss='1']");
        const el = box?.matches("input, button")
          ? box
          : box?.querySelector<HTMLElement>("input, button");
        el?.focus({ preventScroll: true });
      });
      return;
    }
    submitClaim(month);
    setTried(false);
  }

  function switchMonth(step: number) {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + step, 1));
    setTried(false);
  }

  return (
    <div className="space-y-4">
      <div className="bar no-print">
        <div>
          <h1>เบิกค่าใช้จ่าย</h1>
          <ApproverNote kind="expense" />
        </div>
        <div className="tools w-full flex-wrap sm:w-auto">
          <div className="mo glass-thin w-full justify-center sm:w-auto">
            <button type="button" onClick={() => switchMonth(-1)} aria-label="เดือนก่อนหน้า">
              <ChevronLeftIcon className="size-[15px]" strokeWidth={2.4} />
            </button>
            <span className="min-w-[150px]">{monthLabel}</span>
            <button
              type="button"
              disabled={atLatest}
              onClick={() => switchMonth(1)}
              aria-label="เดือนถัดไป"
            >
              <ChevronRightIcon className="size-[15px]" strokeWidth={2.4} />
            </button>
          </div>

          {/* วันที่ในใบเบิกเป็นวันที่ออกไปทำงานจริง เทียบกับบันทึกเวลาเดือนเดียวกันได้ */}
          <Link href={`/records?month=${month}`} className="btn glass-thin">
            <ClockIcon className="size-[15px]" strokeWidth={1.9} />
            เวลาทำงานเดือนนี้
          </Link>

          <button type="button" className="btn glass-thin" onClick={() => window.print()}>
            <PrintIcon className="size-[15px]" strokeWidth={1.9} />
            พิมพ์ใบเบิก
          </button>

          {claim.status === "รออนุมัติ" && (
            <button
              type="button"
              className="btn glass-thin"
              onClick={() => withdrawClaim(month)}
            >
              <RotateIcon className="size-[15px]" strokeWidth={2.2} />
              ขอแก้ไข
            </button>
          )}

          {!locked && (
            <button
              type="button"
              className="btn solid btn-solid btn-block-mobile shrink-0"
              onClick={trySubmit}
            >
              <CheckIcon className="size-[15px]" strokeWidth={2.2} />
              ส่งขออนุมัติ
            </button>
          )}
        </div>
      </div>

      {claim.status === "ไม่อนุมัติ" && claim.comment && (
        <p className="no-print rounded-xl border border-destructive/20 bg-[var(--destructive-soft)] px-4 py-3 text-sm text-destructive">
          ผู้อนุมัติตีกลับ: {claim.comment} — แก้ไขแล้วยื่นใหม่ได้
        </p>
      )}

      {claim.status === "รออนุมัติ" && (
        <p className="no-print rounded-xl border border-[var(--warning)]/20 bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning)]">
          ยื่นแล้วเมื่อ {thaiStamp(claim.submittedAt)} · แก้ไม่ได้จนกว่าจะกด “ขอแก้ไข”
          เพื่อดึงกลับมาเป็นร่าง
        </p>
      )}

      {tried && reasons.length > 0 && (
        <div
          ref={alertRef}
          className="no-print rounded-xl border border-destructive/20 bg-[var(--destructive-soft)] px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <b className="font-semibold">ยังยื่นไม่ได้ — ต้องแก้ {reasons.length} จุด</b>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px]">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="panel glass flex flex-col">
        <div className="strip no-print">
          <div className="tabs">
            <button type="button" className="on">
              ค่าน้ำมันรถ <b>{claim.fuel.length}</b>
            </button>
          </div>
          <span className="flex items-center gap-2.5 py-2">
            <span className={`tag ${CLAIM_STATUS[claim.status]}`}>
              <i />
              {claim.status}
            </span>
            {/* ใบที่อนุมัติแล้วจ่ายคืนพร้อมเงินเดือน (ERD HR-BR-18) — บอกว่าจ่ายแล้วรอบไหน หรือยังรอรอบถัดไป */}
            {claim.status === "อนุมัติแล้ว" && (
              <span className="text-[12px] text-muted-foreground">
                {claim.paidIn
                  ? `จ่ายคืนพร้อมเงินเดือนรอบ ${thaiMonthName(claim.paidIn)} แล้ว`
                  : "รอจ่ายคืนพร้อมเงินเดือนงวดถัดไป"}
              </span>
            )}
          </span>
        </div>

          <div className="claim">
            <p className="ftitle">แบบฟอร์มขออนุมัติเบิกค่าน้ำมันรถ</p>
            <p className="fsub">
              {/* สถานะอยู่ที่ป้ายบนแถบแล้ว (ต้นแบบ) เหลือเดือนกับเลขที่ใบเบิก */}
              ประจำเดือน {monthLabel}
              {claim.no && ` · เลขที่ ${claim.no}`}
            </p>

            <div className="meta">
              <div className="mrow">
                <span>เรื่อง</span>
                <b>ขออนุมัติเบิกค่าน้ำมันรถจักรยานยนต์</b>
              </div>
              <div className="mrow">
                <span>ชื่อ – นามสกุล</span>
                <b>{me.name}</b>
              </div>
              <div className="mrow">
                <span>ตำแหน่ง</span>
                <b>{me.position}</b>
              </div>
              <div className="mrow">
                <span>แผนก</span>
                <b>{me.department}</b>
              </div>
              <div className="mrow">
                <label htmlFor="plate">ป้ายทะเบียนรถ</label>
                <input
                  id="plate"
                  className={`field-control ${tried && claim.fuel.length && !claim.plate.trim() ? "border-destructive" : ""}`}
                  value={claim.plate}
                  disabled={locked}
                  placeholder="เช่น 1กก 1234 เชียงใหม่"
                  onChange={(e) => setClaimField(month, "plate", e.target.value)}
                />
              </div>
            </div>
            <p className="lead">ซึ่งข้าพเจ้าได้สำรองจ่ายไปก่อนในเดือนนี้ ตามรายละเอียดดังนี้</p>

            <FuelTable
              rows={claim.fuel}
              month={month}
              locked={locked}
              tried={tried}
              total={fuelSum}
            />

            {!locked && (
              <button
                type="button"
                className="btn glass-thin no-print mt-3"
                onClick={() => {
                  /* ยังไม่มีรายการ = มีแถวว่างที่เติมให้อยู่แล้ว เก็บแถวนั้นไว้ก่อนแล้วค่อยเพิ่มแถวใหม่ (ตาม mockup) */
                  if (!claim.fuel.length) addFuelRow(month, { id: `F-blank-${month}` });
                  addFuelRow(month);
                }}
              >
                <PlusIcon className="size-[15px]" strokeWidth={2.2} />
                เพิ่มรายการ
              </button>
            )}
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
              จำนวนเงินคำนวณจากระยะทาง × {fuelRate()} บาทต่อกิโลเมตร
            </p>
            <SignBlock />
          </div>

        <div className="foot no-print flex-col items-stretch gap-3 text-center sm:flex-row sm:items-center sm:text-left">
          <span>
            ค่าน้ำมัน {claim.fuel.length} รายการ
            {claim.other?.length ? ` · ค่าใช้จ่ายอื่น ${claim.other.length} รายการ` : ""}
          </span>
          {/* ยอดนี้เป็นค่าน้ำมันอย่างเดียว — ค่าคอมมิชชั่นย้ายไปคิดในเงินเดือนแล้ว
              กระดิ่งแจ้งเตือนอ่านยอดเดียวกันนี้ผ่าน claimTotal() ตัวเลขสองที่จึงตรงกัน */}
          <span className="sum sm:ml-auto">
            รวมที่ขอเบิกทั้งใบ<b>{baht(fuelSum + otherSum)}</b> บาท
          </span>
        </div>
      </section>

      {/* ค่าใช้จ่ายอื่นนอกจากค่าน้ำมัน (Full Proposal · M6) — ประเภทมาจากข้อมูลหลัก */}
      <OtherCard rows={claim.other ?? []} month={month} locked={locked} tried={tried} total={otherSum} />

    </div>
  );
}

function OtherCard({
  rows,
  month,
  locked,
  tried,
  total,
}: {
  rows: OtherRow[];
  month: string;
  locked: boolean;
  tried: boolean;
  total: number;
}) {
  const kinds = optionsOf("expenseKind");
  /* เพิ่มประเภทค่าใช้จ่ายใหม่ได้จากใบเบิกเลย — เพิ่มแล้วเลือกให้แถวที่กำลังกรอก */
  const [adding, setAdding] = useState("");
  const addKind = useAddOption({ list: "expenseKind" }, (v) => adding && updateOtherRow(month, adding, { kind: v }));
  const { min, max } = monthRange(month);

  if (locked && !rows.length) return null;

  return (
    <section className="panel glass mt-4 px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold">ค่าใช้จ่ายอื่น</h2>
        <p className="text-[12.5px] text-muted-foreground">นอกจากค่าน้ำมัน — เลือกประเภท กรอกวันที่ จำนวนเงิน และแนบหลักฐาน</p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">ยังไม่มีรายการ</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {rows.map((r, i) => {
            const why = otherRowProblem(r, month);
            return (
              <li
                key={r.id}
                className={`grid gap-2 rounded-[12px] border bg-card p-2.5 sm:grid-cols-[minmax(0,1fr)_150px_120px_36px] ${
                  tried && why ? "border-destructive" : "border-border"
                }`}
              >
                <label className="grid gap-1 text-[12px] text-muted-foreground">
                  ประเภท
                  <select
                    value={r.kind}
                    disabled={locked}
                    aria-label={`ประเภทค่าใช้จ่ายลำดับ ${i + 1}`}
                    onChange={(e) => {
                      setAdding(r.id);
                      if (!addKind.pick(e.target.value)) updateOtherRow(month, r.id, { kind: e.target.value });
                    }}
                    className="field-control"
                  >
                    <option value="">ยังไม่ระบุ</option>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                    {addKind.option}
                  </select>
                </label>
                <label className="grid gap-1 text-[12px] text-muted-foreground">
                  วันที่
                  <DateField
                    value={r.date}
                    min={min}
                    max={max}
                    disabled={locked}
                    onChange={(iso) => updateOtherRow(month, r.id, { date: iso })}
                    label={`วันที่ของค่าใช้จ่ายลำดับ ${i + 1}`}
                    placeholder="เลือกวันที่"
                    className="h-[38px] rounded-[10px] text-[13.5px]"
                  />
                </label>
                <label className="grid gap-1 text-[12px] text-muted-foreground">
                  จำนวนเงิน
                  <input
                    value={r.amount}
                    disabled={locked}
                    inputMode="decimal"
                    aria-label={`จำนวนเงินของค่าใช้จ่ายลำดับ ${i + 1}`}
                    onChange={(e) => updateOtherRow(month, r.id, { amount: e.target.value })}
                    className="field-control num text-right"
                  />
                </label>
                {!locked && (
                  <button
                    type="button"
                    aria-label={`ลบค่าใช้จ่ายลำดับ ${i + 1}`}
                    className="btn glass-thin btn-mini self-end"
                    onClick={() => removeOtherRow(month, r.id)}
                  >
                    <TrashIcon className="size-4" strokeWidth={2.2} />
                  </button>
                )}
                <label className="grid gap-1 text-[12px] text-muted-foreground sm:col-span-2">
                  รายละเอียด
                  <input
                    value={r.note}
                    disabled={locked}
                    aria-label={`รายละเอียดของค่าใช้จ่ายลำดับ ${i + 1}`}
                    onChange={(e) => updateOtherRow(month, r.id, { note: e.target.value })}
                    className="field-control"
                  />
                </label>
                <label className="grid gap-1 text-[12px] text-muted-foreground sm:col-span-2">
                  หลักฐาน
                  {locked ? (
                    <span className="field-control flex items-center text-[13px]">{r.file || "ไม่ได้แนบ"}</span>
                  ) : (
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      aria-label={`ไฟล์หลักฐานของค่าใช้จ่ายลำดับ ${i + 1}`}
                      /* ยังไม่มี backend — เก็บแค่ชื่อไฟล์ไว้ให้ผู้อนุมัติเห็นว่าแนบอะไรมา */
                      onChange={(e) => updateOtherRow(month, r.id, { file: e.target.files?.[0]?.name ?? "" })}
                      className="field-control py-1.5 text-[12.5px]"
                    />
                  )}
                </label>
                {tried && why && <p className="text-[12px] text-destructive sm:col-span-4">{why}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {addKind.dialog}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!locked && (
          <button type="button" className="btn glass-thin" onClick={() => addOtherRow(month)}>
            <PlusIcon className="size-[15px]" strokeWidth={2.2} />
            เพิ่มค่าใช้จ่าย
          </button>
        )}
        <span className="sum ml-auto text-[13px]">
          รวมค่าใช้จ่ายอื่น<b>{baht(total)}</b> บาท
        </span>
      </div>
    </section>
  );
}

/** ช่องเซ็นชื่อ — ขึ้นเฉพาะตอนพิมพ์ เพราะใบเบิกต้องมีลายเซ็นถึงจะเบิกได้ */
function SignBlock() {
  const me = useProfile();
  return (
    <div className="sign-block mt-10 hidden grid-cols-2 gap-10 print:grid">
      <div className="text-center">
        <span className="mb-[46px] block text-xs font-semibold">ผู้ขอเบิก</span>
        <span className="block h-px bg-[#8a9099]" />
        <span className="mt-1.5 block text-[11px] text-[#5a6069]">
          ({me.name})
        </span>
      </div>
      <div className="text-center">
        <span className="mb-[46px] block text-xs font-semibold">ผู้อนุมัติ</span>
        <span className="block h-px bg-[#8a9099]" />
        <span className="mt-1.5 block text-[11px] text-[#5a6069]">
          ({me.supervisor})
        </span>
      </div>
    </div>
  );
}

/** ช่วงวันที่ที่กรอกได้ — ต้องอยู่ในเดือนที่เบิกเท่านั้น */
function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { min: `${month}-01`, max: `${month}-${pad2(last)}` };
}

const onlyNumber = (v: string) => {
  const cleaned = v.replace(/[^\d.]/g, "");
  // กันพิมพ์จุดหลายตัวแบบ 1.2.3 ที่กลายเป็น NaN ตอนคิดเงิน
  const [head, ...rest] = cleaned.split(".");
  return rest.length ? `${head}.${rest.join("")}` : head;
};

function FuelTable({
  rows,
  month,
  locked,
  tried,
  total,
}: {
  rows: FuelRow[];
  month: string;
  locked: boolean;
  tried: boolean;
  total: number;
}) {
  /*
   * ตาม mockup: ใบร่างที่ยังไม่มีรายการ เติมแถวว่างให้หนึ่งแถวพร้อมกรอก
   * แถวนี้ยังไม่ลงสโตร์จนกว่าจะเริ่มกรอก (ใช้รหัสเดิมตอนลง ช่องที่กำลังพิมพ์จึงไม่หลุดโฟกัส)
   */
  const blankId = `F-blank-${month}`;
  const shown: FuelRow[] =
    rows.length || locked
      ? rows
      : [{ id: blankId, date: "", place: "", km: "", work: "", note: "" }];
  const set = (id: string, patch: Partial<Omit<FuelRow, "id">>) =>
    rows.some((r) => r.id === id)
      ? updateFuelRow(month, id, patch)
      : addFuelRow(month, { ...patch, id });
  const { min, max } = monthRange(month);

  if (!shown.length) {
    return (
      <p className="py-10 text-center text-[13px] text-muted-foreground">
        ไม่มีรายการในเดือนนี้
      </p>
    );
  }

  return (
    <>
      <div className="print-block hidden overflow-x-auto md:block">
        <table className="sheet min-w-[1020px]">
          <thead>
            <tr>
              <th className="c" style={{ width: 62 }}>ครั้งที่</th>
              <th style={{ width: 150 }}>วัน / เดือน / ปี</th>
              <th>สถานที่ปฏิบัติงาน (เริ่มต้น–สิ้นสุด)</th>
              <th style={{ width: 200 }}>งานที่ไปปฏิบัติ</th>
              <th className="c" style={{ width: 112 }}>ระยะทาง (กม.)</th>
              <th className="r" style={{ width: 120 }}>จำนวนเงิน (บาท)</th>
              <th style={{ width: 150 }}>หมายเหตุ</th>
              <th className="c no-print" style={{ width: 46 }} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const miss = fuelRowMiss(r, month);
              const why = miss.why;
              /* ชี้ลงไปถึงช่อง: กรอบแดง + บรรทัดบอกเหตุผลใต้ช่องที่ขาด และ data-miss ให้ปุ่มยื่นโฟกัสให้ */
              const bad = (f: FuelMiss["field"]) => tried && miss.field === f;
              return (
                <tr key={r.id} className={tried && why ? "bad" : ""}>
                  <td className="c num">{i + 1}</td>
                  <td>
                    <span data-miss={bad("date") ? "1" : undefined}>
                      <DateField
                        value={r.date}
                        min={min}
                        max={max}
                        disabled={locked}
                        invalid={bad("date")}
                        label={`วันที่ ครั้งที่ ${i + 1}`}
                        placeholder="เลือกวันที่"
                        className="h-9 px-2 text-[12.5px]"
                        onChange={(iso) => set(r.id, { date: iso })}
                      />
                    </span>
                    {bad("date") && <span className="over">{why}</span>}
                  </td>
                  <td>
                    <input data-miss={bad("place") ? "1" : undefined} value={r.place} disabled={locked} placeholder="เริ่มต้น – สิ้นสุด" aria-label={`สถานที่ ครั้งที่ ${i + 1}`} onChange={(e) => set(r.id, { place: e.target.value })} />
                    {bad("place") && <span className="over">{why}</span>}
                  </td>
                  <td>
                    <input data-miss={bad("work") ? "1" : undefined} value={r.work} disabled={locked} placeholder="งานที่ไปปฏิบัติ" aria-label={`งาน ครั้งที่ ${i + 1}`} onChange={(e) => set(r.id, { work: e.target.value })} />
                    {bad("work") && <span className="over">{why}</span>}
                  </td>
                  <td>
                    <input className="c num" data-miss={bad("km") ? "1" : undefined} inputMode="decimal" value={r.km} disabled={locked} placeholder="0" aria-label={`ระยะทาง ครั้งที่ ${i + 1}`} onChange={(e) => set(r.id, { km: onlyNumber(e.target.value) })} />
                    {bad("km") && <span className="over">{why}</span>}
                  </td>
                  <td className="r num">{baht(fuelAmount(r))}</td>
                  <td>
                    <input value={r.note} disabled={locked} placeholder="—" aria-label={`หมายเหตุ ครั้งที่ ${i + 1}`} onChange={(e) => set(r.id, { note: e.target.value })} />
                  </td>
                  <td className="c no-print">
                    {!locked && (
                      <button type="button" className="del" aria-label={`ลบครั้งที่ ${i + 1}`} onClick={() => removeFuelRow(month, r.id)}>
                        <TrashIcon className="size-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="r tsum">รวมทั้งสิ้น</td>
              <td className="r tsum num">{baht(total)}</td>
              <td />
              <td className="no-print" />
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="no-print mt-3 space-y-3 md:hidden">
        {shown.map((r, i) => {
          const miss = fuelRowMiss(r, month);
          const why = miss.why;
          const bad = (f: FuelMiss["field"]) => tried && miss.field === f;
          return (
            <li
              key={r.id}
              className={`glass-thin rounded-xl px-3.5 py-3 ${tried && why ? "border-destructive" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <b className="text-[12.5px] font-semibold text-muted-foreground">
                  ครั้งที่ {i + 1}
                </b>
                {!locked && (
                  <button type="button" className="del" aria-label={`ลบครั้งที่ ${i + 1}`} onClick={() => removeFuelRow(month, r.id)}>
                    <TrashIcon className="size-3.5" strokeWidth={2} />
                  </button>
                )}
              </div>
              <div className="mt-2 space-y-2.5">
                <MiniField label="วันที่">
                  <DateField
                    value={r.date}
                    min={min}
                    max={max}
                    disabled={locked}
                    label={`วันที่ ครั้งที่ ${i + 1}`}
                    invalid={bad("date")}
                    className="h-9 text-[13px]"
                    onChange={(iso) => set(r.id, { date: iso })}
                  />
                </MiniField>
                <MiniField label="สถานที่ปฏิบัติงาน">
                  <input className={`field-control h-9 text-[13px] ${bad("place") ? "border-destructive" : ""}`} data-miss={bad("place") ? "1" : undefined} value={r.place} disabled={locked} placeholder="เริ่มต้น – สิ้นสุด" onChange={(e) => set(r.id, { place: e.target.value })} />
                </MiniField>
                <div className="grid grid-cols-2 gap-2.5">
                  <MiniField label="ระยะทาง (กม.)">
                    <input className={`field-control num h-9 text-[13px] ${bad("km") ? "border-destructive" : ""}`} data-miss={bad("km") ? "1" : undefined} inputMode="decimal" value={r.km} disabled={locked} placeholder="0" onChange={(e) => set(r.id, { km: onlyNumber(e.target.value) })} />
                  </MiniField>
                  <MiniField label="จำนวนเงิน">
                    {/* ค่าที่ระบบคิดให้ ไม่ใช่ช่องกรอก — วางในกรอบจาง ๆ ให้เห็นว่าอยู่คู่กับช่องระยะทาง
                        เดิมชิดขวาสุดจนดูเหมือนไม่เกี่ยวกับป้ายของตัวเอง */}
                    <p className="num flex h-9 items-center rounded-[10px] bg-muted px-3 text-[13px] font-semibold">
                      {baht(fuelAmount(r))}
                    </p>
                  </MiniField>
                </div>
                <MiniField label="งานที่ไปปฏิบัติ">
                  <input className={`field-control h-9 text-[13px] ${bad("work") ? "border-destructive" : ""}`} data-miss={bad("work") ? "1" : undefined} value={r.work} disabled={locked} onChange={(e) => set(r.id, { work: e.target.value })} />
                </MiniField>
                <MiniField label="หมายเหตุ">
                  <input className="field-control h-9 text-[13px]" value={r.note} disabled={locked} placeholder="—" onChange={(e) => set(r.id, { note: e.target.value })} />
                </MiniField>
              </div>
              {tried && why && (
                <p className="mt-2 text-[12px] font-medium text-destructive">{why}</p>
              )}
            </li>
          );
        })}
        <li className="flex items-center justify-between rounded-xl bg-muted px-3.5 py-3 text-sm font-semibold">
          <span>รวมทั้งสิ้น</span>
          <b className="num">{baht(total)}</b>
        </li>
      </ul>
    </>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
