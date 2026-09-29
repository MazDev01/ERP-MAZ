"use client";

/*
 * วางบิล — ต้นแบบ dose-erp-maz/billing.html
 *
 * รอวางบิล: ดีลที่ยังมีงวดไม่ได้ออกใบแจ้งหนี้ (หรือยังไม่แบ่งงวด) · กดแถวเพื่อกางงวดที่รอออกใบ
 * ใบแจ้งหนี้: เฉพาะใบที่ยังไม่ชำระ (ชำระ = ออกใบเสร็จแล้วที่หน้าใบเสร็จ AC-BR-05) · กดแถวเปิดเอกสาร
 * ค้างชำระ: ใบที่เลยวันครบกำหนด พร้อมบันทึกการติดตามหนี้
 */

import { ADD_VALUE, useAddOption } from "./add-option";
import { optionsOf } from "@/lib/options";
import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AccDeal, Installment, Invoice } from "@/lib/acc-data";
import { INVOICE_STATUS, parseTermsPct, planFromPct } from "@/lib/acc-data";
import { useCrm } from "@/lib/crm-store";
import {
  canBill,
  dealPaid,
  invoiceDue,
  invoiceOf,
  invoiceStatus,
  issueInvoice,
  logCollection,
  markDealsSeen,
  savePlan,
  seqLocked,
  seqStatus,
  unseenDeals,
  useAcc,
  type AccState,
} from "@/lib/acc-store";
import { baht, bkkNow, daysBetween, round2, thaiDate, todayIso, commaInput } from "@/lib/format";
import { useRouter, useSearchParams } from "next/navigation";
import { useFindParam } from "@/lib/deep-link";
import { PlusIcon, TrashIcon } from "./icons";
import { Sheet } from "./lead-dialogs";
import { AccFilters, MonthNav, NewDot, useAccFilter } from "./acc-ui";
import { Field, Textarea } from "./ui";
import { PhoneCard, PhoneList } from "./acchr-phone";

import { DateField } from "./thai-date-picker";
import { CancelDealDialog } from "./cancel-deal-dialog";
type TabKey = "todo" | "inv" | "due";

/** ที่อยู่หน้าเอกสารใบแจ้งหนี้ — อยู่ใต้เมนูวางบิล สิทธิ์เข้าหน้าจึงตามเมนูนี้ */
export function invoiceHref(no: string) {
  return `/acc/billing/invoice/${encodeURIComponent(no)}`;
}

export function AccBillingPage() {
  const acc = useAcc();
  /* เงื่อนไขชำระเงินเป็นของใบเสนอราคาฝ่ายขาย อ่านสดทุกครั้งจากเลขที่ใบในดีล
     ไม่คัดลอกมาเก็บไว้ในสโตร์บัญชี จะได้ไม่ค้างเป็นข้อความเก่าเมื่อฝ่ายขายแก้ใบ */
  const crm = useCrm();
  const termsOf = (quo: string) => (quo ? crm.quotations.find((q) => q.no === quo)?.terms ?? "" : "");
  const router = useRouter();
  /* หน้าอื่นลิงก์มาหาเอกสารใบเดียวด้วย ?find= ใช้ช่องค้นหาเป็นตัวกรอง */
  const find = useFindParam();
  const filter = useAccFilter(find);
  const { hit, inRange } = filter;
  /* ?tab= ให้การ์ดตัวเลขบนแดชบอร์ดพามาลงแท็บที่ตรงกับตัวเลขที่กด
     ?find= สำคัญกว่า เพราะเจาะจงถึงใบเดียวอยู่แล้ว */
  const wanted = useSearchParams().get("tab");
  const [tab, setTab] = useState<TabKey>(() => {
    /* ถูกลิงก์มาหาเอกสารใบเดียว — เปิดแท็บที่มีใบนั้นจริง
       ไม่งั้นคนกดมาจะเจอตารางว่างแล้วนึกว่าของหาย */
    if (find) {
      const inv = acc.invoices.some(
        (v) => v.status !== "paid" && v.status !== "cancelled" && `${v.no} ${v.cus} ${v.deal}`.includes(find),
      );
      return inv ? "inv" : "todo";
    }
    return wanted === "inv" || wanted === "due" ? wanted : "todo";
  });
  const [view, setView] = useState(() => bkkNow());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [planning, setPlanning] = useState<AccDeal | null>(null);
  const [billing, setBilling] = useState<{ deal: AccDeal; item: Installment } | null>(null);
  /* ดีลที่รับเงินแล้ว ฝ่ายบัญชีเป็นคนยกเลิก (ก่อนรับเงินฝ่ายขายยกเลิกที่หน้าดีล) */
  const [cancelling, setCancelling] = useState<AccDeal | null>(null);
  const [collecting, setCollecting] = useState<Invoice | null>(null);
  /* จุดแดงที่แท็บใบแจ้งหนี้หลังออกใบใหม่ — หายเมื่อเปิดแท็บนั้น */
  const [invDot, setInvDot] = useState(false);
  const today = todayIso();

  const canCancel = (dealNo: string) => {
    const d = acc.deals.find((x) => x.no === dealNo);
    return Boolean(d && !d.cancelled && dealPaid(acc, dealNo));
  };

  /* ดีลอยู่ในแท็บนี้จนทุกงวดออกใบแจ้งหนี้ครบ งวดที่ยังออกไม่ได้แสดงว่ารอชำระงวดก่อนหน้า
     กรองด้วยวันที่ส่งใบเสนอราคา */
  const todo = acc.deals.filter(
    (d) =>
      !d.cancelled &&
      hit(d.cus, d.quo, d.no) &&
      inRange(d.quoDate) &&
      (d.plan.length === 0 || d.plan.some((p) => seqStatus(acc, d.no, p.seq) === "pending")),
  );
  /* ใบแจ้งหนี้ที่ยังต้องเก็บเงิน — เงื่อนไขชุดเดียวกับ awaitingReceipt ในสโตร์ กรองด้วยวันที่วางบิล */
  const invoices = acc.invoices
    .filter((v) => invoiceStatus(acc, v) !== "cancelled" && invoiceDue(v) > 0)
    .filter((v) => hit(v.no, v.cus, v.deal) && inRange(v.issue))
    .sort((a, b) => b.issue.localeCompare(a.issue));
  /* เลยวันครบกำหนดแล้ว — กรองด้วยวันครบกำหนด */
  const overdue = acc.invoices.filter(
    (v) =>
      invoiceDue(v) > 0 &&
      invoiceStatus(acc, v) !== "cancelled" &&
      daysBetween(v.due, today) > 0 &&
      hit(v.no, v.cus, v.deal) &&
      inRange(v.due),
  );

  /* ดีลใหม่ที่ยังไม่ได้เปิดดู (AC-BR-01) — เปิดแท็บรอวางบิลอยู่ ให้จุดแดงค้างไว้ครู่หนึ่งพอให้เห็น แล้วถือว่าเปิดดูแล้ว */
  const newDeals = unseenDeals(acc).filter((d) => todo.some((t) => t.no === d.no)).length;
  const hasUnseen = unseenDeals(acc).length > 0;
  useEffect(() => {
    if (tab !== "todo" || !hasUnseen) return;
    const t = window.setTimeout(markDealsSeen, 1500);
    return () => window.clearTimeout(t);
  }, [tab, hasUnseen]);

  function pickTab(k: TabKey) {
    setTab(k);
    if (k === "inv") setInvDot(false);
    if (k === "todo") markDealsSeen();
  }

  function openCancel(dealNo: string) {
    const d = acc.deals.find((x) => x.no === dealNo);
    if (d && canCancel(dealNo)) setCancelling(d);
  }

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1>วางบิล</h1>
        </div>
        <div className="tools w-full sm:w-auto">
          <MonthNav view={view} onChange={setView} />
        </div>
      </div>

      <section className="panel glass flex flex-col">
        <div className="strip">
          <div className="tabs">
            <Tab on={tab === "todo"} onClick={() => pickTab("todo")} count={todo.length} dot={newDeals > 0 ? "มีดีลใหม่รอวางบิล" : ""}>
              รอวางบิล
            </Tab>
            <Tab on={tab === "inv"} onClick={() => pickTab("inv")} count={invoices.length} dot={invDot ? "มีใบแจ้งหนี้ใหม่" : ""}>
              ใบแจ้งหนี้
            </Tab>
            <Tab on={tab === "due"} onClick={() => pickTab("due")} count={overdue.length}>
              ค้างชำระ
            </Tab>
          </div>
          <AccFilters filter={filter} />
        </div>

        <div className="scroll-stable min-h-0 flex-1 overflow-auto max-sm:hidden">
          {tab === "todo" && (
            <table className="data-table cards-sm min-w-[980px]">
              <thead>
                <tr>
                  <th style={{ width: 190 }}>ลูกค้า</th>
                  <th style={{ width: 170 }}>ใบเสนอราคาล่าสุด</th>
                  <th className="r" style={{ width: 190 }}>ยอดสุทธิตามใบเสนอราคา (บาท)</th>
                  <th style={{ width: 270 }}>งวดชำระ</th>
                  <th className="c">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {todo.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-muted-foreground">
                      ไม่มีดีลที่รอวางบิล
                    </td>
                  </tr>
                ) : (
                  todo.map((d) => {
                    const has = d.plan.length > 0;
                    const isOpen = Boolean(open[d.no]);
                    const waiting = d.plan.filter((p) => seqStatus(acc, d.no, p.seq) === "pending").length;
                    return (
                      <Fragment key={d.no}>
                        <tr
                          className={isOpen ? "open" : ""}
                          style={{ cursor: has ? "pointer" : "default" }}
                          onClick={() => has && setOpen((o) => ({ ...o, [d.no]: !o[d.no] }))}
                        >
                          <td data-label="ลูกค้า" className="font-semibold">{d.cus}</td>
                          <td data-label="ใบเสนอราคาล่าสุด" className="muted">
                            <span className="num">{d.quo}</span>
                            <span className="why">ส่ง {thaiDate(d.quoDate)}</span>
                          </td>
                          <td data-label="ยอดสุทธิตามใบเสนอราคา (บาท)" className="r num font-semibold">{baht(d.net)}</td>
                          <td data-label="งวดชำระ" className="muted">
                            {has ? (
                              <>
                                <span className="clip">รอออกใบแจ้งหนี้ {waiting} งวด</span>
                                <span className="why">
                                  {isOpen ? "กดแถวเพื่อย่อ" : "กดแถวเพื่อดูงวดและออกใบแจ้งหนี้"}
                                </span>
                              </>
                            ) : (
                              <span className="why">ยังไม่ได้แบ่งงวด</span>
                            )}
                          </td>
                          <td data-label="จัดการ" className="c">
                            <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                              <button
                                type="button"
                                className="lnk"
                                data-ceo-hide
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPlanning(d);
                                }}
                              >
                                {has ? "แก้งวด" : "แบ่งงวด"}
                              </button>
                              {canCancel(d.no) && (
                                <button
                                  type="button"
                                  className="lnk quiet text-destructive"
                                  data-ceo-hide
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openCancel(d.no);
                                  }}
                                >
                                  ยกเลิกดีล
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                        {isOpen && has && (
                          <tr className="sub">
                            <td colSpan={5}>
                              <PlanRows
                                acc={acc}
                                deal={d}
                                onBill={(item) => setBilling({ deal: d, item })}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {tab === "inv" && (
            <table className="data-table cards-sm min-w-[1110px]">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>เลขที่ใบแจ้งหนี้</th>
                  <th style={{ width: 170 }}>ลูกค้า</th>
                  <th style={{ width: 118 }}>วันที่วางบิล</th>
                  <th style={{ width: 170 }}>ครบกำหนดชำระ</th>
                  <th className="c" style={{ width: 130 }}>ยอดที่ต้องชำระ (บาท)</th>
                  <th className="c" style={{ width: 130 }}>ยอดคงเหลือ (บาท)</th>
                  <th style={{ width: 120 }}>สถานะ</th>
                  <th className="c" style={{ width: 120 }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground">
                      ไม่มีใบแจ้งหนี้ที่รอชำระ
                    </td>
                  </tr>
                ) : (
                  invoices.map((v) => (
                    <tr
                      key={v.no}
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      title="เปิดใบแจ้งหนี้"
                      onClick={() => router.push(invoiceHref(v.no))}
                      onKeyDown={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(invoiceHref(v.no));
                        }
                      }}
                    >
                      <td data-label="เลขที่ใบแจ้งหนี้" className="num">
                        <b className="font-semibold">{v.no}</b>
                        <span className="why">งวดที่ {v.seq}</span>
                      </td>
                      <td data-label="ลูกค้า">{v.cus}</td>
                      <td data-label="วันที่วางบิล" className="num muted">{thaiDate(v.issue)}</td>
                      <td data-label="ครบกำหนดชำระ" className="num muted">
                        {thaiDate(v.due)}
                        <DueBadge invoice={v} today={today} />
                      </td>
                      <td data-label="ยอดที่ต้องชำระ (บาท)" className="c num">{baht(v.total)}</td>
                      <td data-label="ยอดคงเหลือ (บาท)" className="c num font-semibold">{baht(invoiceDue(v))}</td>
                      <td data-label="สถานะ">
                        <InvoiceTag acc={acc} invoice={v} />
                      </td>
                      <td data-label="จัดการ" className="c">
                        <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                          {invoiceDue(v) > 0 && canCancel(v.deal) && (
                            <button
                              type="button"
                              className="lnk quiet text-destructive"
                              data-ceo-hide
                              onClick={(e) => {
                                e.stopPropagation();
                                openCancel(v.deal);
                              }}
                            >
                              ยกเลิกดีล
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === "due" && (
            <table className="data-table cards-sm min-w-[1040px]">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>เลขที่ใบแจ้งหนี้</th>
                  <th>ลูกค้า</th>
                  <th style={{ width: 130 }}>ครบกำหนด</th>
                  <th className="c" style={{ width: 100 }}>เกินกำหนด</th>
                  <th className="c" style={{ width: 130 }}>ยอดคงเหลือ (บาท)</th>
                  <th>ติดตามล่าสุด</th>
                  <th className="c" style={{ width: 130 }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {overdue.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      ไม่มีใบแจ้งหนี้ที่เกินกำหนด
                    </td>
                  </tr>
                ) : (
                  overdue.map((v) => {
                    const last = v.col[v.col.length - 1];
                    return (
                      <tr key={v.no}>
                        <td data-label="เลขที่ใบแจ้งหนี้" className="num">
                          <b className="font-semibold">{v.no}</b>
                        </td>
                        <td data-label="ลูกค้า">{v.cus}</td>
                        <td data-label="ครบกำหนด" className="num muted">{thaiDate(v.due)}</td>
                        <td data-label="เกินกำหนด" className="c">
                          <span className="late">{daysBetween(v.due, today)} วัน</span>
                        </td>
                        <td data-label="ยอดคงเหลือ (บาท)" className="c num font-semibold">{baht(invoiceDue(v))}</td>
                        <td data-label="ติดตามล่าสุด" className="muted">
                          {last ? (
                            <>
                              <span className="clip">{last.result}</span>
                              {/* ต้นแบบแยกวันที่ ช่องทาง และวันนัดคนละบรรทัด ไม่ใช้เครื่องหมายคั่น */}
                              <span className="why">{thaiDate(last.date)}</span>
                              <span className="why">{last.channel}</span>
                              {last.next && (
                                <span className="why">นัดอีกครั้ง {thaiDate(last.next)}</span>
                              )}
                            </>
                          ) : (
                            <span className="why">ยังไม่เคยติดตาม</span>
                          )}
                        </td>
                        <td data-label="จัดการ" className="c">
                          <button type="button" className="lnk" data-ceo-hide onClick={() => setCollecting(v)}>
                            บันทึกติดตาม
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* มือถือ: การ์ดย่อ ลูกค้า + ยอดเงินขึ้นก่อน ปุ่มงานหลักของแต่ละแท็บเป็นปุ่มใหญ่ท้ายการ์ด */}
        {tab === "todo" && (
          <PhoneList empty={todo.length === 0 ? "ไม่มีดีลที่รอวางบิล" : undefined}>
            {todo.map((d) => {
              const has = d.plan.length > 0;
              const waiting = d.plan.filter((p) => seqStatus(acc, d.no, p.seq) === "pending").length;
              return (
                <PhoneCard
                  key={d.no}
                  title={d.cus}
                  sub={
                    <>
                      ใบเสนอราคา <span className="num">{d.quo}</span> · <span className="whitespace-nowrap">ส่ง {thaiDate(d.quoDate)}</span>
                    </>
                  }
                  amount={baht(d.net)}
                  amountNote="ยอดสุทธิ (บาท)"
                  badge={
                    <span className={`tag ${has ? "t-early" : "t-miss"}`}>
                      <i />
                      {has ? `รอออกใบแจ้งหนี้ ${waiting} งวด` : "ยังไม่ได้แบ่งงวด"}
                    </span>
                  }
                  actions={
                    <>
                      <button type="button" className="btn glass-thin" data-ceo-hide onClick={() => setPlanning(d)}>
                        {has ? "แก้งวด" : "แบ่งงวด"}
                      </button>
                      {canCancel(d.no) && (
                        <button
                          type="button"
                          className="btn glass-thin text-destructive!"
                          data-ceo-hide
                          onClick={() => openCancel(d.no)}
                        >
                          ยกเลิกดีล
                        </button>
                      )}
                    </>
                  }
                >
                  {/* งวดที่รอออกใบแจ้งหนี้กางไว้ในการ์ดเลย ไม่ต้องแตะเพื่อกางอีกชั้น */}
                  {has && <PlanPhone acc={acc} deal={d} onBill={(item) => setBilling({ deal: d, item })} />}
                </PhoneCard>
              );
            })}
          </PhoneList>
        )}
        {tab === "inv" && (
          <PhoneList empty={invoices.length === 0 ? "ไม่มีใบแจ้งหนี้ที่รอชำระ" : undefined}>
            {invoices.map((v) => (
              <PhoneCard
                key={v.no}
                title={v.cus}
                sub={
                  <>
                    <span className="num">{v.no}</span> · งวดที่ {v.seq}
                  </>
                }
                amount={baht(invoiceDue(v))}
                amountNote="ยอดคงเหลือ (บาท)"
                onOpen={() => router.push(invoiceHref(v.no))}
                openLabel={`เปิดใบแจ้งหนี้ ${v.no}`}
                badge={
                  <>
                    <InvoiceTag acc={acc} invoice={v} />
                    <span className="text-[11.5px]">
                      <DueBadge invoice={v} today={today} />
                    </span>
                  </>
                }
                stats={[
                  { label: "วันที่วางบิล", value: thaiDate(v.issue) },
                  { label: "ครบกำหนดชำระ", value: thaiDate(v.due) },
                  { label: "ยอดที่ต้องชำระ", value: baht(v.total) },
                ]}
                actions={
                  <>
                    <button type="button" className="btn glass-thin" onClick={() => router.push(invoiceHref(v.no))}>
                      เปิดใบแจ้งหนี้
                    </button>
                    {invoiceDue(v) > 0 && canCancel(v.deal) && (
                      <button
                        type="button"
                        className="btn glass-thin text-destructive!"
                        data-ceo-hide
                        onClick={() => openCancel(v.deal)}
                      >
                        ยกเลิกดีล
                      </button>
                    )}
                  </>
                }
              />
            ))}
          </PhoneList>
        )}
        {tab === "due" && (
          <PhoneList empty={overdue.length === 0 ? "ไม่มีใบแจ้งหนี้ที่เกินกำหนด" : undefined}>
            {overdue.map((v) => {
              const last = v.col[v.col.length - 1];
              return (
                <PhoneCard
                  key={v.no}
                  title={v.cus}
                  sub={
                    <>
                      <span className="num">{v.no}</span> · ครบกำหนด {thaiDate(v.due)}
                    </>
                  }
                  amount={baht(invoiceDue(v))}
                  amountNote="ยอดคงเหลือ (บาท)"
                  alert
                  badge={
                    <span className="tag t-late">
                      <i />
                      เกินกำหนด {daysBetween(v.due, today)} วัน
                    </span>
                  }
                  actions={
                    <button type="button" className="btn solid btn-solid" data-ceo-hide onClick={() => setCollecting(v)}>
                      บันทึกติดตาม
                    </button>
                  }
                >
                  <div className="mt-2.5 rounded-[10px] bg-muted/50 px-3 py-2.5 text-[12.5px]">
                    <p className="text-[11px] text-muted-foreground">ติดตามล่าสุด</p>
                    {last ? (
                      <>
                        <p className="mt-0.5 font-semibold">{last.result}</p>
                        <p className="text-[11.5px] text-muted-foreground">
                          {thaiDate(last.date)} · {last.channel}
                          {last.next && ` · นัดอีกครั้ง ${thaiDate(last.next)}`}
                        </p>
                      </>
                    ) : (
                      <p className="mt-0.5 text-muted-foreground">ยังไม่เคยติดตาม</p>
                    )}
                  </div>
                </PhoneCard>
              );
            })}
          </PhoneList>
        )}

        <div className="foot flex-col items-stretch gap-3 text-center sm:flex-row sm:items-center sm:text-left">
          <Foot tab={tab} acc={acc} invoices={invoices} todo={todo} overdue={overdue} />
        </div>
      </section>

      {planning && (
        <PlanDialog
          deal={planning}
          acc={acc}
          terms={termsOf(planning.quo)}
          onClose={() => setPlanning(null)}
          onSaved={() => {
            /* กางงวดให้เลย ผู้ใช้จะได้เห็นปุ่มออกใบแจ้งหนี้ของงวดแรกทันที */
            setOpen((o) => ({ ...o, [planning.no]: true }));
            setPlanning(null);
          }}
        />
      )}
      {billing && (
        <BillDialog
          deal={billing.deal}
          item={billing.item}
          onClose={() => setBilling(null)}
          onDone={() => {
            setOpen((o) => ({ ...o, [billing.deal.no]: true }));
            if (tab !== "inv") setInvDot(true);
            setBilling(null);
          }}
        />
      )}
      {collecting && (
        <CollectDialog invoice={collecting} today={today} onClose={() => setCollecting(null)} />
      )}

      {cancelling && (
        <CancelDealDialog
          dealNo={cancelling.no}
          cus={cancelling.cus}
          total={cancelling.net}
          by="ฝ่ายบัญชี"
          rows={cancelRows(acc, cancelling)}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

/**
 * ข้อมูลในกล่องยกเลิกดีล — ลูกค้า · รับชำระแล้ว · ใบแจ้งหนี้ที่จะถูกยกเลิกไปด้วย
 * ต้องบอกจำนวนใบและยอดให้เห็นก่อนกด ไม่ใช่ให้ไปเจอเอาทีหลังว่าใบไหนหายไปบ้าง
 */
function cancelRows(acc: AccState, d: AccDeal) {
  const invs = acc.invoices.filter((v) => v.deal === d.no);
  const got = invs.reduce((a, v) => a + (v.total - invoiceDue(v)), 0);
  /* ใบที่ยังไม่ได้รับชำระเท่านั้นที่จะถูกยกเลิก — ใบที่รับเงินครบแล้วยังอยู่ตามเดิม */
  const open = invs.filter((v) => invoiceStatus(acc, v) !== "cancelled" && invoiceDue(v) > 0);
  const sum = open.reduce((a, v) => a + invoiceDue(v), 0);
  return [
    { label: "ลูกค้า", value: d.cus },
    { label: "รับชำระแล้ว (ไม่คืนอัตโนมัติ)", value: `${baht(got)} บาท` },
    ...(open.length
      ? [
          {
            label: "ใบแจ้งหนี้ที่จะถูกยกเลิก",
            value: `${open.length} ใบ · ${baht(sum)} บาท`,
          },
        ]
      : []),
  ];
}

function Tab({
  on,
  count,
  dot = "",
  onClick,
  children,
}: {
  on: boolean;
  count: number;
  /** ข้อความของจุดแดง — ว่าง = ไม่มีจุด */
  dot?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`relative ${on ? "on" : ""}`} onClick={onClick}>
      {children} <b>{count}</b>
      {/* บนมือถือแท็บเป็นเม็ดยา จุดที่ลอยอยู่มุมบนจะหลุดออกนอกขอบโค้ง จึงย้ายมาต่อท้ายในบรรทัดเดียวกัน
         และแท็บที่เลือกอยู่พื้นแดง จุดแดงจะจมหาย ต้องเปลี่ยนเป็นขาว */}
      {dot && (
        <NewDot
          label={dot}
          className={`absolute top-2 right-1 max-sm:static max-sm:ml-1.5 max-sm:shadow-none ${
            on ? "max-sm:bg-white" : ""
          }`}
        />
      )}
    </button>
  );
}

function Foot({
  tab,
  acc,
  invoices,
  todo,
  overdue,
}: {
  tab: TabKey;
  acc: AccState;
  invoices: Invoice[];
  todo: AccDeal[];
  overdue: Invoice[];
}) {
  if (tab === "todo") {
    /*
     * "ออกใบแจ้งหนี้ได้ตอนนี้" = เฉพาะงวดที่กดออกใบได้จริงในวันนี้
     * ดีลที่ยังไม่ได้แบ่งงวดกดออกใบไม่ได้เลย จึงไม่ใช่ยอดของบรรทัดนี้ — แยกไปบอกอีกบรรทัด
     * (เคยรวมยอดเต็มของดีลที่ยังไม่แบ่งงวดเข้ามาด้วย ทำให้ยอดสูงเกินจริง · ผู้ใช้ทักท้วง 24 ก.ย. 2569)
     * งวดที่ต้องรอใบเสร็จของงวดก่อนก็ไม่นับ เพราะยังวางบิลวันนี้ไม่ได้เหมือนกัน
     */
    const ready = todo.filter((d) => d.plan.length > 0);
    const waiting = ready.reduce(
      (sum, d) => sum + d.plan.reduce((a, p, i) => a + (canBill(acc, d, i) ? p.amount : 0), 0),
      0,
    );
    const unsplit = todo.filter((d) => d.plan.length === 0);
    const unsplitSum = unsplit.reduce((a, d) => a + d.net, 0);
    return (
      <>
        <span>แสดง {todo.length} ดีล</span>
        {unsplit.length > 0 && (
          <span className="text-muted-foreground">
            ยังไม่ได้แบ่งงวด {unsplit.length} ดีล · <span className="num">{baht(unsplitSum)}</span> บาท
          </span>
        )}
        <span className="sum sm:ml-auto">
          ยอดที่ออกใบแจ้งหนี้ได้ตอนนี้<b>{baht(waiting)}</b> บาท
        </span>
      </>
    );
  }
  if (tab === "inv") {
    const left = invoices.reduce((a, v) => a + invoiceDue(v), 0);
    return (
      <>
        <span>แสดง {invoices.length} ใบแจ้งหนี้</span>
        <span className="sum sm:ml-auto">
          ยอดคงเหลือรวม<b>{baht(left)}</b> บาท
        </span>
      </>
    );
  }
  const late = overdue.reduce((a, v) => a + invoiceDue(v), 0);
  return (
    <>
      <span>แสดง {overdue.length} ใบแจ้งหนี้</span>
      <span className="sum sm:ml-auto">
        ยอดเกินกำหนดรวม<b>{baht(late)}</b> บาท
      </span>
    </>
  );
}

/**
 * ป้ายสถานะใบแจ้งหนี้ — ชำระ = มีใบเสร็จ (AC-BR-05)
 * อ่านสถานะที่คิดจากยอดค้างและใบเสร็จจริง ไม่ใช่ค่าที่ค้างอยู่ในตัวเอกสาร
 */
export function InvoiceTag({ acc, invoice }: { acc: AccState; invoice: Invoice }) {
  const s = INVOICE_STATUS[invoiceStatus(acc, invoice)];
  return (
    <span className={`tag ${s.cls}`}>
      <i />
      {s.label}
    </span>
  );
}

/* บัญชีต้องรู้ว่าต้องไล่ตามใบไหนก่อน จึงบอกจำนวนวันเทียบกับวันครบกำหนด */
function DueBadge({ invoice, today }: { invoice: Invoice; today: string }) {
  if (invoiceDue(invoice) <= 0) return <span className="why">ชำระแล้ว</span>;
  const n = daysBetween(invoice.due, today);
  if (n > 0) return <span className="late">เกินกำหนด {n} วัน</span>;
  if (n === 0) return <span className="soon">ครบกำหนดวันนี้</span>;
  if (n >= -7) return <span className="soon">เหลืออีก {-n} วัน</span>;
  return <span className="why">เหลืออีก {-n} วัน</span>;
}

/**
 * งวดชำระใต้แถวดีล — ออกใบแจ้งหนี้ได้เฉพาะงวดที่งวดก่อนหน้าออกใบเสร็จแล้ว (AC-BR-04)
 * งวดที่ออกใบแล้วยังอยู่ในรายการเสมอ ขึ้นสถานะและเลขที่ใบให้กดเปิดดูได้ ไม่หายไปจนไม่เหลือร่องรอย
 */
function PlanRows({
  acc,
  deal,
  onBill,
}: {
  acc: AccState;
  deal: AccDeal;
  onBill: (item: Installment) => void;
}) {
  return (
    <div className="subwrap">
      <table className="inner">
        <colgroup>
          <col style={{ width: 90 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 190 }} />
        </colgroup>
        <tbody>
          {deal.plan.map((p, i) => {
            const inv = invoiceOf(acc, deal.no, p.seq);
            return (
              <tr key={p.seq}>
                <td data-label="งวดที่" className="c num">งวดที่ {p.seq}</td>
                <td data-label="สัดส่วน" className="c num">{p.pct}%</td>
                <td data-label="จำนวนเงิน" className="r num">{baht(p.amount)}</td>
                <td data-label="จัดการ" className="c">
                  {seqStatus(acc, deal.no, p.seq) === "pending" ? (
                    canBill(acc, deal, i) ? (
                      <button type="button" className="lnk" data-ceo-hide onClick={() => onBill(p)}>
                        ออกใบแจ้งหนี้
                      </button>
                    ) : (
                      <span className="why">ต้องออกใบเสร็จงวดก่อนหน้าก่อน</span>
                    )
                  ) : (
                    <SeqBilled acc={acc} deal={deal.no} seq={p.seq} no={inv?.no ?? ""} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * งวดที่ออกใบแจ้งหนี้ไปแล้ว — บอกสถานะพร้อมเลขที่ใบซึ่งกดเปิดเอกสารได้
 * ออกใบเสร็จแล้วถือว่าลูกค้าชำระงวดนั้นแล้ว (AC-BR-05) จึงแยกข้อความคนละคำ
 */
function SeqBilled({ acc, deal, seq, no }: { acc: AccState; deal: string; seq: number; no: string }) {
  const paid = seqStatus(acc, deal, seq) === "paid";
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className={`tag ${paid ? "t-ok" : "t-early"}`}>
        <i />
        {paid ? "ชำระแล้ว" : "วางบิลแล้ว"}
      </span>
      {no && (
        <Link className="lnk num" href={invoiceHref(no)} title="เปิดใบแจ้งหนี้">
          {no}
        </Link>
      )}
    </span>
  );
}

/** งวดชำระในการ์ดมือถือ — เงื่อนไขเดียวกับ PlanRows ปุ่มออกใบแจ้งหนี้ใหญ่พอให้นิ้วกด */
function PlanPhone({
  acc,
  deal,
  onBill,
}: {
  acc: AccState;
  deal: AccDeal;
  onBill: (item: Installment) => void;
}) {
  return (
    <ul className="mt-2.5 divide-y divide-border rounded-[10px] border border-border">
      {deal.plan.map((p, i) => {
        const inv = invoiceOf(acc, deal.no, p.seq);
        return (
          <li key={p.seq} className="flex items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <b className="num block text-[13px] font-semibold">
                งวดที่ {p.seq} · {p.pct}%
              </b>
              <span className="num text-[12.5px] text-muted-foreground">{baht(p.amount)} บาท</span>
            </span>
            {seqStatus(acc, deal.no, p.seq) === "pending" ? (
              canBill(acc, deal, i) ? (
                <button
                  type="button"
                  className="btn solid btn-solid flex-none"
                  style={{ height: 40 }}
                  data-ceo-hide
                  onClick={() => onBill(p)}
                >
                  ออกใบแจ้งหนี้
                </button>
              ) : (
                <span className="why flex-none text-right">ต้องออกใบเสร็จงวดก่อนหน้าก่อน</span>
              )
            ) : (
              <span className="flex-none text-right">
                <SeqBilled acc={acc} deal={deal.no} seq={p.seq} no={inv?.no ?? ""} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * แบ่งงวดชำระเงิน — ยอดรวมทุกงวดต้องเท่ากับยอดสุทธิพอดีจึงบันทึกได้ (AC-BR-03)
 * งวดที่ออกใบแจ้งหนี้แล้วแก้และลบไม่ได้ เพราะเอกสารออกเลขแล้ว
 *
 * ตั้งต้นตามเงื่อนไขชำระเงินในใบเสนอราคาที่ฝ่ายขายตกลงกับลูกค้า ไม่ใช่ครึ่ง-ครึ่งลอย ๆ
 * อ่านเป็นสัดส่วนไม่ได้ก็ปล่อยช่องว่างไว้ให้กรอกเอง (parseTermsPct) — เดาผิดอันตรายกว่าไม่เดา
 */
function PlanDialog({
  deal,
  acc,
  terms,
  onClose,
  onSaved,
}: {
  deal: AccDeal;
  acc: AccState;
  /** ข้อความเงื่อนไขชำระเงินตามใบเสนอราคา ดิบ ๆ อย่างที่ฝ่ายขายพิมพ์ */
  terms: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const pcts = parseTermsPct(terms);
  /* เติมตัวเลขให้เฉพาะดีลที่ยังไม่เคยแบ่งงวด และเงื่อนไขอ่านออกชัดเจนเท่านั้น */
  const prefilled = deal.plan.length === 0 && Boolean(pcts);
  const [rows, setRows] = useState<Installment[]>(() =>
    deal.plan.length
      ? deal.plan.map((p) => ({ ...p }))
      : pcts
        ? planFromPct(deal.net, pcts)
        : /* ไม่เดา — งวดเปล่าหนึ่งแถวไว้ให้เริ่มพิมพ์ */
          [{ seq: 1, pct: 0, amount: 0, due: "" }],
  );
  const locked = (i: number) => seqLocked(acc, deal.no, rows[i].seq);

  const total = round2(rows.reduce((a, r) => a + r.amount, 0));
  const diff = round2(deal.net - total);

  function edit(i: number, patch: Partial<Installment>) {
    setRows((list) => list.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  }
  /* ช่องที่กำลังพิมพ์อยู่เก็บเป็นข้อความดิบ ไม่จัดรูปทุกครั้งที่กดแป้น
     (ไม่งั้นพิมพ์เลขหลายหลักหรือจุดทศนิยมไม่ได้) ออกจากช่องแล้วค่อยจัดรูป */
  const [draft, setDraft] = useState<{ i: number; f: "pct" | "amt"; v: string } | null>(null);
  const shown = (i: number, f: "pct" | "amt", fmt: string) =>
    draft && draft.i === i && draft.f === f ? draft.v : fmt;

  return (
    <Sheet
      title="แบ่งงวดชำระเงิน"
      narrow
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn solid btn-solid disabled:opacity-45"
            disabled={diff !== 0}
            onClick={() => {
              savePlan(
                deal.no,
                rows.map((r, i) => ({ ...r, seq: i + 1 })),
              );
              onSaved();
            }}
          >
            บันทึกงวด
          </button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed">
        <b className="font-semibold">{deal.cus}</b>
        <br />
        <span className="text-[12.5px] text-muted-foreground">
          อ้างอิงใบเสนอราคา {deal.quo} ส่งเมื่อ {thaiDate(deal.quoDate)}
          <br />
          ยอดสุทธิ {baht(deal.net)} บาท
        </span>
      </p>

      {/* เงื่อนไขที่ตกลงกับลูกค้าไว้ ต้องเห็นข้อความเดิมเต็ม ๆ ก่อนตั้งงวดเสมอ */}
      <div className="mt-3 rounded-[10px] bg-muted/50 px-3 py-2.5 text-[12.5px] leading-relaxed">
        <p className="text-[11px] text-muted-foreground">
          เงื่อนไขชำระเงินตามใบเสนอราคา <span className="num">{deal.quo}</span>
        </p>
        {terms.trim() ? (
          <p className="mt-0.5 font-semibold whitespace-pre-line">{terms.trim()}</p>
        ) : (
          <p className="mt-0.5 text-muted-foreground">ใบเสนอราคาไม่ได้ระบุเงื่อนไขชำระเงิน</p>
        )}
        {deal.plan.length === 0 && (
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {prefilled
              ? "ตั้งงวดตามเงื่อนไขนี้ให้แล้ว แก้ได้ถ้าตกลงกับลูกค้าเป็นอย่างอื่น"
              : "อ่านเป็นสัดส่วนงวดไม่ได้แน่ชัด จึงไม่เดาตัวเลขให้ กรุณากรอกตามเงื่อนไขข้างบน"}
          </p>
        )}
      </div>

      <table className="sheet mt-3">
        <thead>
          <tr>
            <th className="c" style={{ width: 70 }}>งวดที่</th>
            <th className="c" style={{ width: 110 }}>สัดส่วน (%)</th>
            <th className="r" style={{ width: 170 }}>จำนวนเงิน (บาท)</th>
            <th className="c" style={{ width: 46 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) =>
            locked(i) ? (
              <tr key={i}>
                <td data-label="งวดที่" className="c num">{i + 1}</td>
                <td data-label="สัดส่วน (%)">
                  <input className="c bg-muted text-muted-foreground" value={r.pct} readOnly tabIndex={-1} aria-label={`สัดส่วนงวดที่ ${i + 1}`} />
                </td>
                <td data-label="จำนวนเงิน (บาท)">
                  <input className="r num bg-muted text-muted-foreground" value={baht(r.amount)} readOnly tabIndex={-1} aria-label={`จำนวนเงินงวดที่ ${i + 1}`} />
                </td>
                <td className="c">
                  <span className="why whitespace-nowrap">ออกใบแล้ว</span>
                </td>
              </tr>
            ) : (
              <tr key={i}>
                <td data-label="งวดที่" className="c num">{i + 1}</td>
                <td data-label="สัดส่วน (%)">
                  <input
                    className="c"
                    inputMode="decimal"
                    value={shown(i, "pct", r.pct ? String(r.pct) : "")}
                    placeholder="0"
                    aria-label={`สัดส่วนงวดที่ ${i + 1}`}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.]/g, "");
                      setDraft({ i, f: "pct", v });
                      const pct = parseFloat(v) || 0;
                      edit(i, { pct, amount: round2((deal.net * pct) / 100) });
                    }}
                    onBlur={() => setDraft(null)}
                  />
                </td>
                <td data-label="จำนวนเงิน (บาท)">
                  <input
                    className="r num"
                    inputMode="decimal"
                    value={shown(i, "amt", r.amount ? baht(r.amount) : "")}
                    placeholder="0.00"
                    aria-label={`จำนวนเงินงวดที่ ${i + 1}`}
                    onChange={(e) => {
                      const v = commaInput(e.target.value);
                      setDraft({ i, f: "amt", v });
                      const amount = parseFloat(v.replace(/,/g, "")) || 0;
                      edit(i, {
                        amount: round2(amount),
                        pct: deal.net ? Math.round((amount * 10000) / deal.net) / 100 : 0,
                      });
                    }}
                    onBlur={() => setDraft(null)}
                  />
                </td>
                <td className="c">
                  <button
                    type="button"
                    className="del"
                    aria-label={`ลบงวดที่ ${i + 1}`}
                    onClick={() => {
                      setDraft(null);
                      setRows((l) => l.filter((_, x) => x !== i));
                    }}
                  >
                    <TrashIcon className="size-3.5" strokeWidth={2} />
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="r tsum">รวมทุกงวด</td>
            <td className="r tsum num">{baht(total)}</td>
            <td className="tsum" />
          </tr>
        </tfoot>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-3.5">
        <button
          type="button"
          className="btn glass-thin"
          onClick={() =>
            setRows((l) => [...l, { seq: l.length + 1, pct: 0, amount: 0, due: "" }])
          }
        >
          <PlusIcon className="size-[15px]" strokeWidth={2.2} />
          เพิ่มงวด
        </button>
        <p className="ml-auto text-right">
          {diff === 0 ? (
            <span className="text-[12.5px] font-semibold text-[var(--success)]">
              ตรงกับยอดสุทธิ
            </span>
          ) : (
            <span className="text-[12.5px] font-semibold text-destructive">
              ต่างจากยอดสุทธิ {baht(Math.abs(diff))} บาท
            </span>
          )}
        </p>
      </div>
    </Sheet>
  );
}

/** ออกใบแจ้งหนี้ — ต้องเลือกวันครบกำหนดก่อน (เริ่มว่างทุกครั้ง) เพราะเอกสารออกเลขแล้วแก้วันไม่ได้ง่าย ๆ */
function BillDialog({
  deal,
  item,
  onClose,
  onDone,
}: {
  deal: AccDeal;
  item: Installment;
  onClose: () => void;
  onDone: () => void;
}) {
  const [due, setDue] = useState("");

  return (
    <Sheet
      title="ออกใบแจ้งหนี้"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn solid btn-solid disabled:opacity-45"
            disabled={!due}
            onClick={() => {
              issueInvoice(deal.no, item.seq, due);
              onDone();
            }}
          >
            ออกใบแจ้งหนี้
          </button>
        </>
      }
    >
      {/* ลูกค้า งวด และยอด อยู่คนละบรรทัดตามต้นแบบ (dueWho) */}
      <p className="text-[13.5px] leading-relaxed">
        <b className="font-semibold">{deal.cus}</b>
        <br />
        <span className="text-[12.5px] text-muted-foreground">
          งวดที่ {item.seq} จาก {deal.plan.length}
          <br />
          ยอด {baht(item.amount)} บาท
        </span>
      </p>

      <div className="mt-4">
        <Field label="วันครบกำหนดชำระ">
          <DateField
            value={due}
            onChange={(iso) => setDue(iso)}
            label="วันครบกำหนดชำระ"
            placeholder="เลือกวันที่"
            className="h-[38px] rounded-[10px] text-[13.5px]"
          />
        </Field>
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
        เอกสารออกเลขแล้วห้ามลบและห้ามยกเลิกเพื่อออกใหม่ หากผิดต้องแก้ในใบเดิม
      </p>
    </Sheet>
  );
}

/** บันทึกการติดตามหนี้ — ช่องทางเป็นปุ่มแบ่งช่อง ตัวเลือกมาจากที่ผู้ดูแลระบบตั้งไว้ (collectChannel) */
function CollectDialog({
  invoice,
  today,
  onClose,
}: {
  invoice: Invoice;
  today: string;
  onClose: () => void;
}) {
  const channels = optionsOf("collectChannel");
  const [channel, setChannel] = useState(() => channels[0] ?? "");
  /* เพิ่มช่องทางใหม่ได้จากหน้างาน (เจ้าของสั่ง 28 ก.ย. 2569) — เพิ่มแล้วเลือกให้เลย */
  const addChannel = useAddOption({ list: "collectChannel" }, setChannel);
  const [result, setResult] = useState("");
  const [next, setNext] = useState("");
  const resultBox = useRef<HTMLDivElement>(null);

  return (
    <Sheet
      title="บันทึกการติดตามหนี้"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn solid btn-solid"
            onClick={() => {
              /* ต้องมีผลการติดตาม — ว่างอยู่ให้กลับไปที่ช่องนั้น */
              if (!result.trim()) return resultBox.current?.querySelector("textarea")?.focus();
              logCollection(invoice.no, { date: today, channel, result: result.trim(), next });
              onClose();
            }}
          >
            บันทึก
          </button>
        </>
      }
    >
      {/* เลขที่ · ลูกค้า · ยอดคงเหลือ แยกเป็นสามบรรทัดตาม mockup (colWho) */}
      <p className="flex flex-col gap-2.5 text-[13.5px] leading-normal">
        <span>{invoice.no}</span>
        <span>{invoice.cus}</span>
        <span>คงเหลือ {baht(invoiceDue(invoice))} บาท</span>
      </p>

      <div className="mt-4 grid gap-4">
        <Field label="วันที่ติดตาม">
          <input
            value={thaiDate(today)}
            readOnly
            className="field-control h-[38px] w-full rounded-[10px] px-3 text-[13.5px]"
          />
        </Field>
        <Field label="ช่องทาง">
          <div className="seg" role="radiogroup" aria-label="ช่องทาง">
            {channels.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={channel === c}
                className={channel === c ? "on" : ""}
                onClick={() => setChannel(c)}
              >
                {c}
              </button>
            ))}
            {addChannel.canAdd && (
              <button type="button" onClick={() => addChannel.pick(ADD_VALUE)}>
                ＋ เพิ่ม
              </button>
            )}
          </div>
        </Field>
        {addChannel.dialog}
        <Field label="ผลการติดตาม">
          <div ref={resultBox}>
          <Textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            placeholder="ลูกค้าตอบว่าอย่างไร"
          />
          </div>
        </Field>
        <Field label="วันนัดติดตามครั้งถัดไป">
          <DateField
            value={next}
            onChange={(iso) => setNext(iso)}
            label="วันนัดติดตามครั้งถัดไป"
            placeholder="เลือกวันที่"
            clearable
            className="h-[38px] rounded-[10px] text-[13.5px]"
          />
        </Field>
      </div>
    </Sheet>
  );
}
