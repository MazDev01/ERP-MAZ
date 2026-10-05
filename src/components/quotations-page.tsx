"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFindParam } from "@/lib/deep-link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  EXPIRING_DAYS,
  canBillQuotation,
  isLatestQuotation,
  quotationChain,
  quotationTotals,
  quotationValidUntil,
  type Quotation,
} from "@/lib/crm-data";
import { useCrm } from "@/lib/crm-store";
import { serviceLabel } from "@/lib/pm-data";
import { baht, daysBetween, thaiDate, todayIso } from "@/lib/format";
import { ChevronDownIcon, ClockIcon, EyeIcon, FileIcon, PlusIcon, RotateIcon } from "./icons";
import { BillQuotationDialog, RejectQuotationDialog } from "./quotation-dialogs";
import { Pager, SearchBox, Who, usePaged } from "./sales-ui";
import { QuotationsMobile } from "./quotations-mobile";

const PER_PAGE = 7;

/*
 * รายการใบเสนอราคา — ตามต้นแบบ quotations.html
 * ไม่มีร่างและแก้ใบเดิมไม่ได้ ถ้าต้องเปลี่ยนให้ "ออกใบใหม่แทนใบนี้" ใบเดิมกลายเป็นแทนที่แล้ว
 * ประวัติคือจำนวนใบที่ออกแทนกันมา กดชิป "ฉบับที่ N" กางดูได้
 * ไม่มีแท็บสถานะ ระบบอนุมานจาก มีดีล / ถูกแทน / ถูกปฏิเสธ / เลยวันมีผล · มีตัวกรองเดียวคือ "ใกล้หมดอายุ"
 */
export function QuotationsPage() {
  const crm = useCrm();
  const router = useRouter();
  const params = useSearchParams();
  /* ลิงก์จากหน้าอื่นเจาะมาที่ฉบับเดียวได้ด้วย ?find=<เลขที่> — เอามาใส่ช่องค้นหาเลย */
  const find = useFindParam();
  const [query, setQuery] = useState(find);
  const [soonOnly, setSoonOnly] = useState(false);
  const [rejecting, setRejecting] = useState<Quotation | null>(null);
  const [billing, setBilling] = useState<Quotation | null>(null);
  /* สายใบที่กางดูประวัติอยู่ — เก็บเป็นเลขที่ใบ */
  const [openChain, setOpenChain] = useState<string>("");
  const today = todayIso();

  /* ลิงก์เดิม ?new=1&customer=&from=<คำขอ> — ฟอร์มย้ายไปเป็นหน้าเต็ม /quotations/new แล้ว */
  useEffect(() => {
    if (!params.get("new")) return;
    const q = new URLSearchParams();
    const customer = params.get("customer");
    const ps = params.get("from") ?? params.get("ps");
    if (customer) q.set("customer", customer);
    if (ps) q.set("ps", ps);
    router.replace(`/quotations/new${q.size ? `?${q}` : ""}`);
  }, [params, router]);

  const nameOf = useMemo(
    () => new Map(crm.customers.map((c) => [c.code, c.name])),
    [crm.customers],
  );
  const hasDeal = useMemo(
    () => new Set(crm.deals.filter((d) => d.quotationNo).map((d) => d.quotationNo)),
    [crm.deals],
  );

  const validOf = (q: Quotation) => quotationValidUntil(q);
  const daysLeft = (q: Quotation) => daysBetween(today, validOf(q));
  /** ส่งแล้ว ยังไม่มีดีล ยังไม่ถูกแทน และเหลือไม่เกิน 7 วัน = ต้องรีบตาม */
  const isSoon = (q: Quotation) =>
    Boolean(q.sentAt) && !hasDeal.has(q.no) && !q.replacedBy && daysLeft(q) >= 0 && daysLeft(q) <= EXPIRING_DAYS;
  const canBill = (q: Quotation) => canBillQuotation(q, hasDeal.has(q.no), today);

  const rows = useMemo(() => {
    const qq = query.trim().toLowerCase();
    return crm.quotations.filter((q) => {
      if (soonOnly && !isSoon(q)) return false;
      if (!qq) return true;
      const name = nameOf.get(q.customerCode) ?? "";
      return `${q.no} ${name} ${q.customerCode}`.toLowerCase().includes(qq);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crm.quotations, query, soonOnly, nameOf, hasDeal, today]);
  const paged = usePaged(rows, PER_PAGE);
  const total = rows.reduce((sum, q) => sum + quotationTotals(q).grand, 0);

  const docHref = (q: Quotation) => `/quotations/${encodeURIComponent(q.no)}`;
  const openDoc = (q: Quotation) => router.push(docHref(q));
  /** สายใบที่ออกแทนกันมาของใบนี้ — ยาวกว่า 1 ใบ = มีประวัติให้กางดู */
  const chainOf = (q: Quotation) => quotationChain(crm.quotations, q.no);
  /** ออกใบใหม่แทนได้เฉพาะใบล่าสุดของสายที่ยังไม่ถูกแทน */
  const canReplace = (q: Quotation) => isLatestQuotation(crm.quotations, q);

  /** ปุ่มจัดการตามต้นแบบ — ขึ้นตามข้อมูลของใบ ไม่ใช่ตามสถานะที่กดเลือก */
  const actions = (q: Quotation) => (
    <>
      {canBill(q) && (
        <>
          <button type="button" className="lnk" onClick={() => setBilling(q)}>
            ส่งไปวางบิล
          </button>
          <button type="button" className="lnk" onClick={() => setRejecting(q)}>
            ลูกค้าปฏิเสธ
          </button>
        </>
      )}
      {/* แก้ใบเดิมไม่ได้เลย — เปลี่ยนอะไรก็ออกใบใหม่แทนใบนี้ ใบเดิมกลายเป็น "แทนที่แล้ว" */}
      {canReplace(q) && (
        <Link
          href={`/quotations/new?replace=${encodeURIComponent(q.no)}`}
          className="lnk"
          title="ออกใบใหม่แทนใบนี้ (ใบนี้แก้ไม่ได้)"
        >
          <RotateIcon className="size-3.5" strokeWidth={2} />
          ออกใบใหม่แทนใบนี้
        </Link>
      )}
      {/* ปุ่มเอกสาร + ปุ่มดูรายละเอียด ขึ้นทุกแถวตามต้นแบบ */}
      <Link
        href={docHref(q)}
        className="iconbtn glass-thin"
        aria-label="เปิดเอกสาร"
        title="เปิดเอกสาร"
      >
        <FileIcon className="size-3.5" strokeWidth={2} />
      </Link>
      <Link
        href={docHref(q)}
        className="iconbtn glass-thin"
        aria-label="ดูรายละเอียด"
        title="ดูรายละเอียด"
      >
        <EyeIcon className="size-3.5" strokeWidth={2} />
      </Link>
    </>
  );

  /**
   * ปุ่มจัดการบนมือถือ — ชุดเดียวกับ actions() แต่เป็นปุ่มสูง 40px วางกริดสองช่อง
   * งานหลักของใบนั้นเป็นปุ่มทึบ ปุ่มเอกสารกับปุ่มดูรายละเอียดไปที่เดียวกัน จึงรวมเป็นปุ่ม "เปิดเอกสาร" ปุ่มเดียว
   */
  const phoneActions = (q: Quotation) => {
    const base = "btn h-10 justify-center px-2";
    const plain = `${base} glass-thin`;
    const main = `${base} solid btn-solid`;
    const danger = `${plain} !text-destructive`;
    const items: ReactNode[] = [];
    if (canBill(q)) {
      items.push(
        <button key="bill" type="button" className={main} onClick={() => setBilling(q)}>
          ส่งไปวางบิล
        </button>,
        <button key="rej" type="button" className={danger} onClick={() => setRejecting(q)}>
          ลูกค้าปฏิเสธ
        </button>,
      );
    }
    if (canReplace(q)) {
      items.push(
        <Link key="re" href={`/quotations/new?replace=${encodeURIComponent(q.no)}`} className={plain}>
          ออกใบใหม่แทนใบนี้
        </Link>,
      );
    }
    items.push(
      <Link key="doc" href={docHref(q)} className={plain}>
        <FileIcon className="size-4" strokeWidth={2} />
        เปิดเอกสาร
      </Link>,
    );
    return (
      <div className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
        {items.map((it, i) => (
          /* จำนวนปุ่มเป็นเลขคี่ ปุ่มสุดท้ายกินเต็มแถว */
          <div key={i} className={`grid ${items.length % 2 && i === items.length - 1 ? "col-span-2" : ""}`}>
            {it}
          </div>
        ))}
      </div>
    );
  };

  /** บรรทัดความสัมพันธ์ใต้เลขที่ — ใบใหม่แทน · แทนใบ · อ้างอิงคำขอ · ลูกค้าปฏิเสธ */
  const relations = (q: Quotation) => (
    <>
      {q.replacedBy && <span className="why">ถูกแทนด้วยใบ {q.replacedBy}</span>}
      {q.replaces && <span className="why">แทนใบ {q.replaces}</span>}
      {q.ps && <span className="why">อ้างอิงคำขอ {q.ps}</span>}
      {q.rejectedAt && <span className="why text-destructive">ลูกค้าปฏิเสธ {thaiDate(q.rejectedAt)}</span>}
    </>
  );

  const validCell = (q: Quotation) => (
    <>
      {thaiDate(validOf(q))}
      {isSoon(q) && <span className="diff early">อีก {daysLeft(q)} วัน</span>}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <p className="max-md:hidden!">พบ {rows.length} ฉบับ</p>
        </div>
        <div className="tools w-full flex-wrap sm:w-auto">
          {/* มือถือมีช่องค้นหาของตัวเองในรายการรายลูกค้าแล้ว ไม่ต้องมีสองช่อง */}
          <SearchBox
            className="max-md:hidden!"
            value={query}
            onChange={(v) => {
              setQuery(v);
              paged.setPage(1);
            }}
            placeholder="ค้นหาเลขที่เอกสารหรือชื่อผู้สนใจ"
          />
          <Link href="/quotations/new" className="btn solid btn-solid btn-block-mobile fab-mobile shrink-0">
            <PlusIcon className="size-[15px]" strokeWidth={2.2} />
            <span className="lbl">สร้างใบเสนอราคา</span>
          </Link>
        </div>
      </div>

      {/* มือถือดูเป็น "รายลูกค้า" ตามต้นแบบ quotations-mobile.html · จอคอมยังเป็นตารางรายใบเหมือนเดิม */}
      <QuotationsMobile />

      <section className="panel glass hidden flex-col md:flex">
        <div className="strip">
          <button
            type="button"
            onClick={() => {
              setSoonOnly((v) => !v);
              paged.setPage(1);
            }}
            aria-pressed={soonOnly}
            className={`btn my-2 ${soonOnly ? "bg-accent font-semibold text-primary" : "glass-thin"}`}
          >
            {/* ไอคอนนาฬิกาหน้าป้ายตัวกรอง ตามต้นแบบ quotations.html */}
            <ClockIcon className="size-[13px]" strokeWidth={2} />
            ใกล้หมดอายุ
          </button>
        </div>

        <div className="scroll-stable hidden min-h-0 flex-1 overflow-auto md:block">
          <table className="data-table min-w-[1040px]">
            <thead>
              <tr>
                <th style={{ width: 165 }}>เลขที่เอกสาร</th>
                <th>ผู้สนใจ</th>
                <th style={{ width: 112 }}>บริการ</th>
                <th style={{ width: 108 }}>วันที่ออก</th>
                <th style={{ width: 124 }}>มีผลถึง</th>
                <th style={{ width: 84 }}>ออกในนาม</th>
                <th className="r" style={{ width: 118 }}>ยอดรวม</th>
                <th style={{ width: 236 }} />
              </tr>
            </thead>
            <tbody>
              {paged.list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-[50px] text-center text-muted-foreground">
                    ไม่พบใบเสนอราคาที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                paged.list.flatMap((q) => {
                  const chain = chainOf(q);
                  const open = openChain === q.no;
                  const rowsOut = [
                  <tr
                    key={q.id}
                    onClick={() => openDoc(q)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="num muted">
                      {q.no}
                      {chain.length > 1 && (
                        <button
                          type="button"
                          className={`ml-1.5 inline-flex h-[22px] items-center gap-1 rounded-full border px-[9px] text-[10.5px] font-semibold ${
                            open ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"
                          }`}
                          title="ดูประวัติใบที่ออกแทนกันมา"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenChain(open ? "" : q.no);
                          }}
                        >
                          ฉบับที่ {chain.length}
                          <ChevronDownIcon className={`size-2.5 ${open ? "rotate-180" : ""}`} strokeWidth={3} />
                        </button>
                      )}
                      {relations(q)}
                    </td>
                    <td>
                      <Link href={`/leads/${q.customerCode}`} onClick={(e) => e.stopPropagation()}>
                        <Who name={nameOf.get(q.customerCode) ?? q.customerCode} />
                      </Link>
                    </td>
                    <td className="muted">{q.service ? serviceLabel(q.service) : "—"}</td>
                    <td className="num muted whitespace-nowrap">{q.issued ? thaiDate(q.issued) : "—"}</td>
                    <td className="num muted">{validCell(q)}</td>
                    <td className="muted">{q.issuer}</td>
                    <td className="r money">{baht(quotationTotals(q).grand)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span className="flex flex-wrap items-center justify-end gap-1.5">{actions(q)}</span>
                    </td>
                  </tr>,
                  ];
                  /* ประวัติ = สายใบที่ออกแทนกันมา ไม่ใช่การแก้ในใบเดิม */
                  if (open && chain.length > 1)
                    rowsOut.push(
                      <tr key={`${q.id}-chain`}>
                        <td colSpan={8} className="bg-muted/40 p-0">
                          <ChainTable chain={chain} />
                        </td>
                      </tr>,
                    );
                  return rowsOut;
                })
              )}
            </tbody>
          </table>
        </div>

        <ul className="hidden divide-y divide-border">
          {paged.list.length === 0 ? (
            <li className="px-5 py-12 text-center text-muted-foreground">
              ไม่พบใบเสนอราคาที่ตรงกับเงื่อนไข
            </li>
          ) : (
            paged.list.map((q) => (
              <li key={q.id} className="px-5 py-4 max-sm:px-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/leads/${q.customerCode}`} className="min-w-0">
                    <Who name={nameOf.get(q.customerCode) ?? q.customerCode} sub={q.no} />
                  </Link>
                  <b className="money num shrink-0 text-[15px]">{baht(quotationTotals(q).grand)}</b>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {q.service ? serviceLabel(q.service) : "—"} · ออกในนาม {q.issuer}
                  {q.issued && ` · ออก ${thaiDate(q.issued)}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">มีผลถึง {validCell(q)}</p>
                {chainOf(q).length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    ออกแทนกันมาแล้ว {chainOf(q).length} ฉบับ
                  </p>
                )}
                {relations(q)}
                <div className="mt-2.5 flex flex-wrap gap-2 max-sm:hidden">{actions(q)}</div>
                {phoneActions(q)}
              </li>
            ))
          )}
        </ul>

        <div className="foot flex-col items-stretch gap-3 text-center sm:flex-row sm:items-center sm:text-left">
          <span>{paged.range("ฉบับ")}</span>
          <span className="sum">
            ยอดรวมที่กรอง<b>{baht(total)}</b> บาท
          </span>
          {/* ไม่มีผลลัพธ์ก็ไม่ต้องแสดงปุ่มแบ่งหน้า ตาม mockup */}
          {paged.list.length > 0 && (
            <Pager page={paged.page} maxPage={paged.maxPage} onChange={paged.setPage} />
          )}
        </div>
      </section>

      {rejecting && (
        <RejectQuotationDialog
          quotation={rejecting}
          customerName={nameOf.get(rejecting.customerCode) ?? rejecting.customerCode}
          onClose={() => setRejecting(null)}
        />
      )}
      {billing && (
        <BillQuotationDialog
          quotation={billing}
          customerName={nameOf.get(billing.customerCode) ?? billing.customerCode}
          onClose={() => setBilling(null)}
        />
      )}
    </div>
  );
}

/**
 * ประวัติของสายใบ — ออกใบใหม่แทนกันมากี่ฉบับ ยอดต่างกันเท่าไร (ต้นแบบ quotations.html table.revs)
 * chain เรียงจากใบที่ใช้อยู่ไปใบเก่าสุด
 */
export function ChainTable({ chain }: { chain: Quotation[] }) {
  return (
    <div className="px-4 py-3">
      <h4 className="pb-2 text-[11.5px] font-semibold text-muted-foreground">
        ออกใบมาแล้ว {chain.length} ฉบับ
      </h4>
      <table className="data-table w-full rounded-xl bg-card">
        <thead>
          <tr>
            <th style={{ width: 68 }}>ฉบับที่</th>
            <th style={{ width: 150 }}>เลขที่เอกสาร</th>
            <th style={{ width: 110 }}>วันที่ออก</th>
            <th>สถานะ</th>
            <th className="r" style={{ width: 120 }}>ยอดรวม</th>
            <th className="r" style={{ width: 110 }}>ส่วนต่าง</th>
            <th style={{ width: 92 }} />
          </tr>
        </thead>
        <tbody>
          {chain.map((r, i) => {
            const older = chain[i + 1];
            const diff = older ? quotationTotals(r).grand - quotationTotals(older).grand : null;
            const cur = i === 0;
            return (
              <tr key={r.id}>
                <td>
                  <span
                    className={`inline-flex h-[23px] min-w-[30px] items-center justify-center rounded-[7px] px-2 text-[11.5px] font-semibold ${
                      cur ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
                    }`}
                  >
                    {chain.length - i}
                  </span>
                </td>
                <td className="num">{r.no}</td>
                <td className="num muted">{thaiDate(r.issued)}</td>
                <td className="muted">
                  {cur ? <b className="text-foreground">ฉบับที่ใช้อยู่</b> : `ถูกแทนที่ด้วย ${chain[i - 1].no}`}
                </td>
                <td className="r money">{baht(quotationTotals(r).grand)}</td>
                <td className="r num">
                  {diff === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className={diff > 0 ? "text-[var(--warn)]" : "text-[var(--success)]"}>
                      {diff > 0 ? "+" : ""}
                      {baht(diff)}
                    </span>
                  )}
                </td>
                <td className="r">
                  <Link href={`/quotations/${encodeURIComponent(r.no)}`} className="lnk">
                    ดูเอกสาร
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
