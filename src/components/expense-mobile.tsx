"use client";

/*
 * เบิกค่าใช้จ่ายบนมือถือ — ต้นแบบ dose-erp-maz/expense.html (#ex-mobile · 1 ต.ค. 2569)
 *
 * สามจอต่อกัน
 *   1) รายการใบเบิกของฉัน — จัดกลุ่มตามเดือน การ์ดหนึ่งใบคือหนึ่งประเภทของเดือนนั้น
 *   2) กดปุ่มกลม + แล้วเลือกประเภทที่จะเบิก (แผ่นเลื่อนขึ้นจากด้านล่าง)
 *   3) จอกรอกรายละเอียด — กรอกทีละรายการเป็นกล่อง แล้วกดส่งขออนุมัติที่แถบล่าง
 *
 * ประเภทของระบบนี้มีสองอย่าง: ค่าน้ำมันรถ กับ ค่าใช้จ่ายอื่น
 * (ต้นแบบมี incentive/commission ด้วย แต่เจ้าของสั่งย้ายค่าคอมไปคิดในเงินเดือนแล้ว 22 ก.ย. 2569)
 * ข้อมูลใช้สโตร์ชุดเดียวกับจอคอมทุกตัว ยอดและสถานะจึงตรงกันเสมอ
 */

import { useEffect, useRef, useState } from "react";
import {
  CLAIM_STATUS,
  checkClaim,
  fuelAmount,
  fuelRate,
  fuelTotal,
  isLocked,
  otherTotal,
  type ExpenseClaim,
} from "@/lib/expense-data";
import {
  addFuelRow,
  addOtherRow,
  claimOf,
  monthKey,
  removeFuelRow,
  removeOtherRow,
  setClaimField,
  submitClaim,
  updateFuelRow,
  updateOtherRow,
  useExpenseClaims,
} from "@/lib/expense-store";
import { optionsOf } from "@/lib/options";
import { baht, bkkNow, thaiMonth } from "@/lib/format";
import { ChevronLeftIcon, ChevronRightIcon, CommissionIcon, PlusIcon, TrashIcon } from "./icons";
import { Sheet } from "./lead-dialogs";
import { DateField } from "./thai-date-picker";
import { Select } from "./ui";

type Kind = "fuel" | "other";

const KIND: Record<Kind, { name: string; desc: string; rate: () => string; bg: string; fg: string }> = {
  fuel: {
    name: "ค่าน้ำมันรถ",
    desc: "เบิกตามระยะทางที่ใช้รถส่วนตัวไปทำงาน",
    rate: () => `คิดกิโลเมตรละ ${fuelRate()} บาท`,
    bg: "#FDEDD6",
    fg: "#94500A",
  },
  other: {
    name: "ค่าใช้จ่ายอื่น",
    desc: "ค่าใช้จ่ายที่สำรองจ่ายไปก่อน เช่น ค่าเดินทาง ค่ารับรอง",
    rate: () => "แนบหลักฐานการจ่ายด้วยทุกครั้ง",
    bg: "#ECE6FA",
    fg: "#4E35A8",
  },
};

const CARD = "rounded-[20px] bg-white p-3.5 shadow-[0_1px_2px_rgb(40_20_25/0.04),0_12px_28px_-20px_rgb(120_20_35/0.3)]";
const BOX = "rounded-[18px] bg-white p-3.5";
const INPUT = "field-control h-11 w-full rounded-[12px] px-3 text-[14.5px]";

/** กล่องนี้กรอกอะไรไปแล้วหรือยัง — ว่างล้วนถือว่าไม่ได้ตั้งใจเบิก */
function fuelFilled(r: { date: string; place: string; km: string; work: string }) {
  return Boolean(r.date || r.place.trim() || r.km.trim() || r.work.trim());
}

function otherFilled(r: { kind: string; date: string; amount: string; note: string }) {
  return Boolean(r.kind || r.date || r.amount.trim() || r.note.trim());
}

function rowsOf(claim: ExpenseClaim, kind: Kind) {
  return kind === "fuel" ? claim.fuel : (claim.other ?? []);
}

function totalOf(claim: ExpenseClaim, kind: Kind) {
  return kind === "fuel" ? fuelTotal(claim.fuel) : otherTotal(claim.other ?? []);
}

export function ExpenseMobile() {
  const claims = useExpenseClaims();
  const today = bkkNow();
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<{ month: string; kind: Kind } | null>(null);
  /* แถบดำบอกผลหลังส่ง (ต้นแบบ .exm-toast) — หายเองใน 2 วินาที */
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* เดือนที่มีใบเบิกจริง เรียงใหม่ไปเก่า — เดือนปัจจุบันขึ้นก่อนเสมอถึงจะยังว่าง */
  const months = [...new Set([monthKey(today), ...claims.map((c) => c.month)])].sort().reverse();

  const cards = months.flatMap((m) => {
    const claim = claimOf(claims, m);
    return (["fuel", "other"] as Kind[])
      .filter((k) => rowsOf(claim, k).length > 0)
      .map((k) => ({ month: m, kind: k, claim }));
  });

  return (
    <div className="md:hidden">
      {cards.length === 0 ? (
        <p className={`${CARD} py-10 text-center text-[14px] text-[#9A8E91]`}>ยังไม่มีใบเบิก</p>
      ) : (
        months.map((m) => {
          const mine = cards.filter((c) => c.month === m);
          if (!mine.length) return null;
          return (
            <section key={m}>
              <h2 className="mt-4 mb-2 px-1 text-[15px] font-bold">{thaiMonth(m)}</h2>
              <ul className="flex list-none flex-col gap-2.5 p-0">
                {mine.map(({ kind, claim }) => {
                  const k = KIND[kind];
                  const rows = rowsOf(claim, kind);
                  return (
                    <li key={kind}>
                      <button
                        type="button"
                        className={`${CARD} grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-left`}
                        onClick={() => setOpen({ month: m, kind })}
                      >
                        <span
                          className="row-span-2 grid size-[42px] place-items-center rounded-full"
                          style={{ background: k.bg, color: k.fg }}
                        >
                          <CommissionIcon className="size-[19px]" strokeWidth={2} />
                        </span>
                        <b className="text-[15px] font-bold">{k.name}</b>
                        <span className="num text-right text-[15px] font-bold whitespace-nowrap">
                          {baht(totalOf(claim, kind))} ฿
                        </span>
                        <span className="text-[12.5px] text-[#8A7E81]">{rows.length} รายการ</span>
                        <span className={`tag justify-self-end ${CLAIM_STATUS[claim.status]}`}>
                          <i />
                          {claim.status}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {/* ปุ่มกลมมุมขวาล่างชุดเดียวกับหน้าอื่น */}
      <button
        type="button"
        className="btn solid btn-solid fab-mobile"
        onClick={() => setPicking(true)}
      >
        <PlusIcon className="size-[15px]" strokeWidth={2.4} />
        <span className="lbl">เบิกค่าใช้จ่ายใหม่</span>
      </button>

      {picking && (
        <Sheet
          title="เลือกประเภทการเบิก"
          onClose={() => setPicking(false)}
          footer={
            <button type="button" className="btn glass-thin h-12 w-full justify-center rounded-[14px]" onClick={() => setPicking(false)}>
              ปิด
            </button>
          }
        >
          <p className="mb-3 text-[13px] text-muted-foreground">
            เลือกก่อน แล้วค่อยกรอกรายละเอียดและส่งอนุมัติ
          </p>
          <ul className="flex list-none flex-col gap-2.5 p-0">
            {(["fuel", "other"] as Kind[]).map((kind) => {
              const k = KIND[kind];
              return (
                <li key={kind}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3.5 rounded-[18px] border-[1.5px] border-border bg-card p-4 text-left hover:border-primary"
                    onClick={() => {
                      setPicking(false);
                      setOpen({ month: monthKey(today), kind });
                    }}
                  >
                    <span
                      className="grid size-[46px] flex-none place-items-center rounded-full"
                      style={{ background: k.bg, color: k.fg }}
                    >
                      <CommissionIcon className="size-[21px]" strokeWidth={2} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <b className="text-[15.5px] font-bold">{k.name}</b>
                      <small className="text-[12.5px] text-muted-foreground">{k.desc}</small>
                      <small className="text-[12.5px] text-muted-foreground">{k.rate()}</small>
                    </span>
                    <ChevronRightIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2.2} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}

      {open && (
        <ClaimForm
          month={open.month}
          kind={open.kind}
          onClose={() => setOpen(null)}
          onSent={(name) => setToast(`ส่งขออนุมัติ${name}แล้ว`)}
        />
      )}

      {toast && (
        <p
          role="status"
          className="fixed bottom-[calc(110px+env(safe-area-inset-bottom))] left-1/2 z-90 -translate-x-1/2 rounded-[12px] bg-[#2A1F22] px-4 py-2.5 text-[13.5px] whitespace-nowrap text-white"
        >
          {toast}
        </p>
      )}
    </div>
  );
}

/** จอกรอกรายละเอียดของประเภทหนึ่ง — เต็มจอ มีแถบล่างบอกยอดรวมและปุ่มส่ง */
function ClaimForm({
  month,
  kind,
  onClose,
  onSent,
}: {
  month: string;
  kind: Kind;
  onClose: () => void;
  onSent: (name: string) => void;
}) {
  const claims = useExpenseClaims();
  const claim = claimOf(claims, month);
  const locked = isLocked(claim.status);
  const rows = rowsOf(claim, kind);
  const kinds = optionsOf("expenseKind");
  const [err, setErr] = useState("");
  const k = KIND[kind];

  function addRow() {
    if (kind === "fuel") addFuelRow(month);
    else addOtherRow(month);
  }

  /* ยังไม่มีรายการเลย = เปิดกล่องเปล่าไว้ให้กรอกทันที ไม่ต้องกดเพิ่มก่อน
     ต้องทำใน effect ไม่ใช่ตอนวาด ไม่งั้นแก้สโตร์ระหว่างเรนเดอร์ */
  const empty = !locked && rows.length === 0;
  /* เปิดกล่องเปล่าให้ครั้งเดียวต่อใบ — โหมดพัฒนาเรียก effect สองรอบ ถ้าไม่กันจะได้กล่องว่างสองใบ */
  const seeded = useRef("");
  useEffect(() => {
    const key = `${month}/${kind}`;
    if (!empty || seeded.current === key) return;
    seeded.current = key;
    addRow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, month, kind]);

  function send() {
    /*
     * ทิ้งกล่องที่ยังไม่ได้กรอกอะไรเลยก่อนยื่น — รวมถึงของอีกประเภทหนึ่งด้วย
     * ไม่งั้นกล่องเปล่าที่ระบบเปิดทิ้งไว้ให้ (ตอนเปิดฟอร์มครั้งแรก) จะกันไม่ให้ยื่น
     * แล้วขึ้นเหตุผลของอีกประเภทที่ผู้ใช้ไม่ได้มองอยู่ งงว่าทำไมกดส่งไม่ได้
     */
    const keepFuel = claim.fuel.filter(fuelFilled);
    const keepOther = (claim.other ?? []).filter(otherFilled);
    claim.fuel.filter((r) => !fuelFilled(r)).forEach((r) => removeFuelRow(month, r.id));
    (claim.other ?? []).filter((r) => !otherFilled(r)).forEach((r) => removeOtherRow(month, r.id));

    const problem = checkClaim({ ...claim, fuel: keepFuel, other: keepOther });
    if (!problem.ok) {
      setErr(problem.reasons[0] ?? "กรอกข้อมูลยังไม่ครบ");
      return;
    }
    if (!submitClaim(month)) {
      setErr("ยื่นไม่สำเร็จ ลองตรวจข้อมูลอีกครั้ง");
      return;
    }
    onSent(k.name);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-80 flex flex-col bg-[var(--background)]">
      <header className="grid grid-cols-[42px_1fr_42px] items-center px-4 pt-4 pb-2.5">
        <button
          type="button"
          className="iconbtn glass-thin size-[42px] rounded-full"
          aria-label="ย้อนกลับ"
          onClick={onClose}
        >
          <ChevronLeftIcon className="size-5" strokeWidth={2.2} />
        </button>
        <div className="text-center">
          <b className="block text-[16.5px] font-bold">{k.name}</b>
          <small className="text-[12.5px] text-muted-foreground">{thaiMonth(month)}</small>
        </div>
        <span />
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-1 pb-5">
        {locked && (
          <p className="mb-2.5 text-center">
            <span className={`tag ${CLAIM_STATUS[claim.status]}`}>
              <i />
              {claim.status}
            </span>
          </p>
        )}

        {kind === "fuel" && (
          <div className={`${BOX} mb-2.5`}>
            <label className="mb-1 block text-[12px] text-muted-foreground" htmlFor="m-plate">
              ป้ายทะเบียนรถ
            </label>
            <input
              id="m-plate"
              className={INPUT}
              value={claim.plate}
              disabled={locked}
              placeholder="เช่น 1กก 1234 เชียงใหม่"
              onChange={(e) => setClaimField(month, "plate", e.target.value)}
            />
          </div>
        )}

        {rows.map((row, i) => (
          <div key={row.id} className={`${BOX} mb-2.5`}>
            <div className="mb-1 flex items-center justify-between">
              <b className="text-[14px] font-bold">
                {kind === "fuel" ? `ครั้งที่ ${i + 1}` : `รายการที่ ${i + 1}`}
              </b>
              {!locked && (
                <button
                  type="button"
                  className="grid size-[34px] place-items-center rounded-full text-muted-foreground"
                  aria-label={`ลบรายการที่ ${i + 1}`}
                  onClick={() => (kind === "fuel" ? removeFuelRow(month, row.id) : removeOtherRow(month, row.id))}
                >
                  <TrashIcon className="size-[17px]" strokeWidth={2} />
                </button>
              )}
            </div>

            {kind === "fuel" ? (
              <FuelFields month={month} row={row as never} locked={locked} />
            ) : (
              <OtherFields month={month} row={row as never} locked={locked} kinds={kinds} />
            )}
          </div>
        ))}

        {!locked && (
          <button
            type="button"
            className="mb-2.5 h-[46px] w-full rounded-[14px] border-[1.5px] border-dashed border-[#E3D3D7] bg-card text-[14px] font-bold"
            onClick={addRow}
          >
            + เพิ่มรายการ
          </button>
        )}

        {kind === "fuel" && (
          <p className="px-1 text-[12px] text-muted-foreground">{k.rate()}</p>
        )}
        {err && <p className="mt-2 text-center text-[12.5px] text-destructive">{err}</p>}
      </div>

      <div className="flex items-center gap-3 border-t border-border bg-card px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <span className="flex flex-1 flex-col">
          <small className="text-[12px] text-muted-foreground">รวมทั้งสิ้น</small>
          <b className="num text-[19px] font-bold">{baht(totalOf(claim, kind))} ฿</b>
        </span>
        {!locked && (
          <button
            type="button"
            className="btn solid btn-solid h-[50px] rounded-[14px] px-6 text-[15px]"
            onClick={send}
          >
            ส่งขออนุมัติ
          </button>
        )}
      </div>
    </div>
  );
}

function FuelFields({
  month,
  row,
  locked,
}: {
  month: string;
  row: { id: string; date: string; place: string; km: string; work: string; note: string };
  locked: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted-foreground">วันที่</span>
          <DateField
            value={row.date}
            onChange={(iso) => updateFuelRow(month, row.id, { date: iso })}
            label="วันที่"
            disabled={locked}
            className="h-11 rounded-[12px] text-[14.5px]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted-foreground">ระยะทาง (กม.)</span>
          <input
            className={INPUT}
            inputMode="decimal"
            value={row.km}
            disabled={locked}
            placeholder="0"
            onChange={(e) => updateFuelRow(month, row.id, { km: e.target.value.replace(/[^\d.]/g, "") })}
          />
        </label>
      </div>
      <label className="mt-2.5 block">
        <span className="mb-1 block text-[12px] text-muted-foreground">สถานที่ (เริ่มต้น – สิ้นสุด)</span>
        <input
          className={INPUT}
          value={row.place}
          disabled={locked}
          placeholder="เช่น ออฟฟิศ – ลูกค้า"
          onChange={(e) => updateFuelRow(month, row.id, { place: e.target.value })}
        />
      </label>
      <label className="mt-2.5 block">
        <span className="mb-1 block text-[12px] text-muted-foreground">งานที่ไปปฏิบัติ</span>
        <input
          className={INPUT}
          value={row.work}
          disabled={locked}
          placeholder="งานที่ไปปฏิบัติ"
          onChange={(e) => updateFuelRow(month, row.id, { work: e.target.value })}
        />
      </label>
      <label className="mt-2.5 block">
        <span className="mb-1 block text-[12px] text-muted-foreground">หมายเหตุ</span>
        <input
          className={INPUT}
          value={row.note}
          disabled={locked}
          placeholder="—"
          onChange={(e) => updateFuelRow(month, row.id, { note: e.target.value })}
        />
      </label>
      <div className="mt-2.5 flex items-center justify-between rounded-[12px] bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground">
        <span>จำนวนเงิน</span>
        <b className="num text-[15px] text-foreground">{baht(fuelAmount(row))} ฿</b>
      </div>
    </>
  );
}

function OtherFields({
  month,
  row,
  locked,
  kinds,
}: {
  month: string;
  row: { id: string; kind: string; date: string; amount: string; note: string; file?: string };
  locked: boolean;
  kinds: string[];
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted-foreground">วันที่</span>
          <DateField
            value={row.date}
            onChange={(iso) => updateOtherRow(month, row.id, { date: iso })}
            label="วันที่"
            disabled={locked}
            className="h-11 rounded-[12px] text-[14.5px]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted-foreground">จำนวนเงิน (บาท)</span>
          <input
            className={INPUT}
            inputMode="decimal"
            value={row.amount}
            disabled={locked}
            placeholder="0"
            onChange={(e) => updateOtherRow(month, row.id, { amount: e.target.value.replace(/[^\d.]/g, "") })}
          />
        </label>
      </div>
      <label className="mt-2.5 block">
        <span className="mb-1 block text-[12px] text-muted-foreground">รายการ</span>
        <Select
          value={row.kind}
          disabled={locked}
          className="h-11 rounded-[12px] text-[14.5px]"
          onChange={(e) => updateOtherRow(month, row.id, { kind: e.target.value })}
        >
          <option value="">เช่น ค่าทางด่วน ค่าจอดรถ</option>
          {kinds.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </label>
      {/* ช่องนี้บังคับกรอก (otherRowProblem) จึงใช้ชื่อ "รายละเอียด" เหมือนจอคอม ไม่ใช่ "หมายเหตุ" ที่ฟังดูไม่ต้องกรอก */}
      <label className="mt-2.5 block">
        <span className="mb-1 block text-[12px] text-muted-foreground">รายละเอียด</span>
        <input
          className={INPUT}
          value={row.note}
          disabled={locked}
          placeholder="จ่ายอะไร ที่ไหน"
          onChange={(e) => updateOtherRow(month, row.id, { note: e.target.value })}
        />
      </label>

      {/* ใบเสร็จ — ยังไม่มี backend จึงเก็บแค่ชื่อไฟล์ให้ผู้อนุมัติเห็นว่าแนบอะไรมา */}
      <label className="relative mt-2.5 block">
        <span className="mb-1 block text-[12px] text-muted-foreground">ใบเสร็จ / หลักฐาน</span>
        <span className="flex h-11 items-center justify-center truncate rounded-[12px] border-[1.5px] border-dashed border-[#E3D3D7] px-2.5 text-[13.5px] font-semibold text-muted-foreground">
          {row.file || (locked ? "ไม่ได้แนบ" : "แนบไฟล์หรือถ่ายรูป")}
        </span>
        {!locked && (
          <input
            type="file"
            accept="image/*,application/pdf"
            aria-label="แนบใบเสร็จ"
            className="absolute inset-x-0 bottom-0 h-11 opacity-0"
            onChange={(e) => updateOtherRow(month, row.id, { file: e.target.files?.[0]?.name ?? "" })}
          />
        )}
      </label>

      <div className="mt-2.5 flex items-center justify-between rounded-[12px] bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground">
        <span>จำนวนเงิน</span>
        <b className="num text-[15px] text-foreground">{baht(Number(row.amount.replace(/,/g, "")) || 0)} ฿</b>
      </div>
    </>
  );
}
