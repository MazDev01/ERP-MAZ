"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFindParam } from "@/lib/deep-link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  EXPIRING_DAYS,
  canBillQuotation,
  issuerOf,
  quotationTotals,
  quotationValidUntil,
  type Quotation,
} from "@/lib/crm-data";
import { issueDraft, markQuotationSent, useCrm } from "@/lib/crm-store";
import { serviceLabel } from "@/lib/pm-data";
import { baht, daysBetween, thaiDate, todayIso } from "@/lib/format";
import { CheckIcon, ClockIcon, EyeIcon, FileIcon, PlusIcon } from "./icons";
import {
  BillQuotationDialog,
  DeleteDraftDialog,
  IssueNumberDialog,
  RejectQuotationDialog,
} from "./quotation-dialogs";
import { Pager, SearchBox, Who, usePaged } from "./sales-ui";
import { QuotationsMobile } from "./quotations-mobile";

const PER_PAGE = 7;

/*
 * รายการใบเสนอราคา — ตามต้นแบบ quotations.html
 * ไม่มีแท็บสถานะ ใบเสนอราคาไม่มีช่องสถานะ ระบบอนุมานจาก ส่งแล้วหรือยัง / มีดีล / ถูกแทน / ถูกปฏิเสธ
 * มีตัวกรองเดียวคือ "ใกล้หมดอายุ"
 */
export function QuotationsPage() {
  const crm = useCrm();
  const router = useRouter();
  const params = useSearchParams();
  /* ลิงก์จากหน้าอื่นเจาะมาที่ฉบับเดียวได้ด้วย ?find=<เลขที่> — เอามาใส่ช่องค้นหาเลย */
  const find = useFindParam();
  const [query, setQuery] = useState(find);
  const [soonOnly, setSoonOnly] = useState(false);
  const [deleting, setDeleting] = useState<Quotation | null>(null);
  const [rejecting, setRejecting] = useState<Quotation | null>(null);
  const [billing, setBilling] = useState<Quotation | null>(null);
  /* ร่างที่กำลังจะออกเลขที่ — ขั้นนี้ย้อนไม่ได้ จึงถามยืนยันก่อนเสมอ */
  const [issuing, setIssuing] = useState<Quotation | null>(null);
  /* ออกเลขที่แล้วต้องบอกว่าได้เลขอะไร และพาไปดูเอกสาร ไม่ใช่ให้แถวเปลี่ยนไปเงียบ ๆ */
  const [issued, setIssued] = useState<string>("");
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

  /* ทุกแถวเปิดเอกสารได้ ร่างด้วย (ต้นแบบ) — ร่างยังไม่มีเลขที่ จึงเปิดด้วยรหัสของใบแทน */
  const docHref = (q: Quotation) => `/quotations/${encodeURIComponent(q.no || q.id)}`;
  const openDoc = (q: Quotation) => router.push(docHref(q));
  const isDraft = (q: Quotation) => q.status === "ร่าง";

  /** ปุ่มจัดการตามต้นแบบ — ขึ้นตามข้อมูลของใบ ไม่ใช่ตามสถานะที่กดเลือก */
  const actions = (q: Quotation) => (
    <>
      {isDraft(q) && (
        <>
          <Link href={`/quotations/new?draft=${encodeURIComponent(q.id)}`} className="lnk">
            แก้ไขร่าง
          </Link>
          <button type="button" className="lnk" onClick={() => setIssuing(q)}>
            ออกเลขที่เอกสาร
          </button>
          <button type="button" className="lnk" onClick={() => setDeleting(q)}>
            ลบร่าง
          </button>
        </>
      )}
      {!isDraft(q) && !q.sentAt && !q.replacedBy && (
        <button type="button" className="lnk" onClick={() => markQuotationSent(q.id)}>
          บันทึกว่าส่งแล้ว
        </button>
      )}
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
      {/* ใบที่ส่งแล้วแก้ไม่ได้ตามกติกาเอกสาร — แก้ราคาหรือขอบเขตต้องออกฉบับแก้แทนใบเดิม
          ใบที่ปิดไปแล้ว (มีดีล/ปฏิเสธ/หมดอายุ) แทนไม่ได้ ปุ่มจึงเป็นการคัดลอกไปออกใบใหม่เฉย ๆ */}
      {!isDraft(q) && (
        <Link
          href={`/quotations/new?from=${encodeURIComponent(q.no)}`}
          className="lnk quiet"
          title={canBill(q) ? "คัดลอกใบนี้ไปออกฉบับแก้ แล้วให้ใบเดิมถูกแทน" : "คัดลอกใบนี้ไปออกใบใหม่"}
        >
          {canBill(q) ? "ออกฉบับแก้" : "ออกใบใหม่"}
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
    if (isDraft(q)) {
      items.push(
        <button key="issue" type="button" className={main} onClick={() => setIssuing(q)}>
          ออกเลขที่เอกสาร
        </button>,
        <Link key="edit" href={`/quotations/new?draft=${encodeURIComponent(q.id)}`} className={plain}>
          แก้ไขร่าง
        </Link>,
        <button key="del" type="button" className={danger} onClick={() => setDeleting(q)}>
          ลบร่าง
        </button>,
      );
    }
    if (!isDraft(q) && !q.sentAt && !q.replacedBy) {
      items.push(
        <button key="sent" type="button" className={main} onClick={() => markQuotationSent(q.id)}>
          บันทึกว่าส่งแล้ว
        </button>,
      );
    }
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
    if (!isDraft(q)) {
      items.push(
        <Link key="re" href={`/quotations/new?from=${encodeURIComponent(q.no)}`} className={plain}>
          {canBill(q) ? "ออกฉบับแก้" : "ออกใบใหม่"}
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
      {q.replacedBy && <span className="why">ออกใบใหม่แทน {q.replacedBy}</span>}
      {q.replaces && <span className="why">แทนใบ {q.replaces}</span>}
      {q.ps && <span className="why">อ้างอิงคำขอ {q.ps}</span>}
      {q.rejectedAt && <span className="why text-destructive">ลูกค้าปฏิเสธ {thaiDate(q.rejectedAt)}</span>}
    </>
  );

  const validCell = (q: Quotation) =>
    isDraft(q) ? (
      <span className="why">ยังไม่ออกเลขที่</span>
    ) : q.sentAt ? (
      <>
        {thaiDate(validOf(q))}
        {isSoon(q) && <span className="diff early">อีก {daysLeft(q)} วัน</span>}
      </>
    ) : (
      <span className="why">ยังไม่ได้ส่งให้ลูกค้า</span>
    );

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1>ใบเสนอราคา</h1>
          <p>พบ {rows.length} ฉบับ</p>
        </div>
        <div className="tools w-full flex-wrap sm:w-auto">
          <SearchBox
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

      {issued && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-[var(--success-soft)] px-4 py-3 text-[13.5px] font-semibold text-[var(--success)]"
        >
          <CheckIcon className="size-4 shrink-0" strokeWidth={2.4} />
          ออกเลขที่ <b className="num">{issued}</b> แล้ว · แก้ไขไม่ได้อีก
          <Link href={`/quotations/${encodeURIComponent(issued)}`} className="font-semibold underline">
            เปิดเอกสารไปส่งลูกค้า
          </Link>
        </p>
      )}

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
                paged.list.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => openDoc(q)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="num muted">
                      {isDraft(q) ? (
                        <span className="inline-flex h-[22px] items-center rounded-full bg-[#F5F0FF] px-[9px] text-[11.5px] font-semibold text-[#6B4FBF]">
                          ร่าง
                        </span>
                      ) : (
                        q.no
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
                  </tr>
                ))
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
                    <Who
                      name={nameOf.get(q.customerCode) ?? q.customerCode}
                      sub={isDraft(q) ? "ร่าง" : q.no}
                    />
                  </Link>
                  <b className="money num shrink-0 text-[15px]">{baht(quotationTotals(q).grand)}</b>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {q.service ? serviceLabel(q.service) : "—"} · ออกในนาม {q.issuer}
                  {q.issued && ` · ออก ${thaiDate(q.issued)}`}
                </p>
                {/* ใบที่ยังไม่มีวันหมดอายุจริง (ร่าง / ยังไม่ได้ส่ง) ไม่ต้องขึ้นคำว่า "มีผลถึง" ค้างไว้
                    เดิมขึ้นเป็น "มีผลถึง" แล้วบรรทัดล่างว่างเปล่าตามด้วยสถานะ อ่านแล้วงง */}
                <p className="mt-1 text-xs text-muted-foreground">
                  {isDraft(q)
                    ? "ยังไม่ออกเลขที่เอกสาร"
                    : q.sentAt
                      ? <>มีผลถึง {validCell(q)}</>
                      : "ยังไม่ได้ส่งให้ลูกค้า"}
                </p>
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

      {deleting && (
        <DeleteDraftDialog
          quotation={deleting}
          customerName={nameOf.get(deleting.customerCode) ?? deleting.customerCode}
          onClose={() => setDeleting(null)}
        />
      )}
      {issuing && (
        <IssueNumberDialog
          customerName={nameOf.get(issuing.customerCode) ?? issuing.customerCode}
          issuer={issuerOf(issuing.issuer).name}
          total={quotationTotals(issuing).grand}
          onGo={() => {
            const no = issueDraft(issuing.id);
            setIssuing(null);
            if (no) setIssued(no);
          }}
          onClose={() => setIssuing(null)}
        />
      )}
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
