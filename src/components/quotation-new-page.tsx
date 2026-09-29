"use client";

import Link from "next/link";
import { useHydrated } from "@/lib/pwa";
import { useRole } from "@/lib/role";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BUYER_TYPE,
  canBillQuotation,
  issuerOf,
  issuers,
  quotationTotals,
  whtRate,
  WHT_PCTS,
  type BuyerType,
  type Customer,
  type IssuerCode,
  type Quotation,
} from "@/lib/crm-data";
import { NO_WHT_NOTE } from "@/lib/acc-data";
import { addQuotation, addQuotationDraft, issueDraft, updateDraft, useCrm, type CrmState } from "@/lib/crm-store";
import { services, type ServiceKey } from "@/lib/pm-data";
import { addDays, baht, commaInput, round2, thaiDate, todayIso } from "@/lib/format";
import { cleanHtml, htmlToText } from "@/lib/rich-text";
import { CustomerCombo } from "./customer-combo";
import { CheckIcon, ChevronLeftIcon, CloseIcon, EyeIcon } from "./icons";
import { Field } from "./lead-dialogs";
import { IssueNumberDialog } from "./quotation-dialogs";
import { QuotationPaper } from "./quotation-paper";
import { RichEditor } from "./rich-editor";
import { ADD_VALUE, useAddOption } from "./add-option";
import { IssuerAddDialog } from "./issuer-add";

/*
 * หน้าสร้างใบเสนอราคา — ตามต้นแบบ quotation-new.html (หน้าเต็ม ไม่ใช่กล่องเด้ง)
 *
 *   ?customer=<รหัส>  เปิดจากหน้าผู้สนใจ เลือกลูกค้าไว้ให้
 *   ?ps=<เลขที่คำขอ>   ออกจากคำขอก่อนการขาย — ใบที่ออกผูกกับคำขอนั้น เอกสารของคำขอจึงตามไปถึง PM
 *   ?from=<เลขที่>     ออกใบใหม่จากใบเดิม คัดลอกเฉพาะเนื้อหา เลขที่ วันที่ และภาษีคิดใหม่เสมอ
 *   ?draft=<id>       แก้ไขร่างที่บันทึกไว้ (ร่างยังไม่มีเลขที่ จึงอ้างด้วย id)
 *
 * บันทึกสองทาง (ผู้ใช้กำหนด 23 ก.ย. 2569 · กติกา SL-03)
 *   "บันทึกร่าง"        ยังไม่ออกเลขที่ กลับมาแก้หรือลบได้ เปลี่ยนใจแล้วไม่กินเลข
 *   "ออกเลขที่เอกสาร"   ออกเลขทันที ย้อนไม่ได้ จึงถามยืนยันก่อนเสมอ
 */

type Mode =
  | { kind: "new" }
  | { kind: "from"; src: Quotation }
  | { kind: "draft"; src: Quotation };

/** ค่าตั้งต้นของฟอร์มตามโหมดที่เปิดมา */
function initialOf(crm: CrmState, mode: Mode, presetCustomer?: string, ps?: string) {
  const src = mode.kind === "new" ? undefined : mode.src;
  /* ออกจากคำขอ — หาลูกค้าจากคำขอ ไม่มีก็ดูจากใบเสนอราคาที่เคยอ้างคำขอนี้ */
  const psReq = ps ? crm.presales.find((p) => p.no === ps) : undefined;
  const code =
    src?.customerCode ??
    presetCustomer ??
    psReq?.customerCode ??
    (ps ? crm.quotations.find((q) => q.ps === ps)?.customerCode : undefined);
  const customer = crm.customers.find((c) => c.code === code) ?? null;
  return {
    customer,
    service: (src?.service ?? "") as ServiceKey | "",
    issuer: (src?.issuer ?? "") as IssuerCode | "",
    buyer: (src?.buyer ?? customer?.type ?? "juristic") as BuyerType,
    validDays: String(src?.validDays ?? 30),
    body: src?.body ?? "",
    amount: !src ? "" : commaInput(String(mode.kind === "draft" ? src.amount : round2(src.amount - src.discount))),
    /* ต้นแบบคัดลอกยอดก่อนภาษีมาเป็นจำนวนเงิน ส่วนลดเริ่มว่าง · ร่างแก้ของเดิมต่อ จึงเก็บส่วนลดไว้ */
    discount: mode.kind === "draft" && src?.discount ? commaInput(String(src.discount)) : "",
    terms: src?.terms ?? "",
    wht: src?.wht ?? false,
    /* อัตราของใบเดิม ถ้าเป็นใบใหม่ใช้อัตรามาตรฐานเป็นค่าตั้งต้น */
    whtPct: src?.whtPct ?? whtRate(),
  };
}

export function QuotationNewPage() {
  /* รอ hydrate ก่อน — ร่างและใบที่สร้างในเครื่องอยู่ใน localStorage ตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์ยังหาไม่เจอ
     แล้วโหมด/ค่าตั้งต้นของฟอร์มจะถูกจำเป็นค่าว่างไปตลอด */
  const hydrated = useHydrated();
  return hydrated ? <NewPageBody /> : null;
}

function NewPageBody() {
  const crm = useCrm();
  const params = useSearchParams();
  const router = useRouter();
  const today = todayIso();

  const fromNo = params.get("from") ?? "";
  const draftId = params.get("draft") ?? "";
  const ps = params.get("ps") ?? "";
  const presetCustomer = params.get("customer") ?? undefined;

  const mode: Mode = useMemo(() => {
    const draft = draftId ? crm.quotations.find((q) => q.id === draftId && q.status === "ร่าง") : undefined;
    if (draft) return { kind: "draft", src: draft };
    const from = fromNo ? crm.quotations.find((q) => q.no === fromNo) : undefined;
    if (from) return { kind: "from", src: from };
    return { kind: "new" };
    /* โหมดตัดสินครั้งเดียวตอนเปิดหน้า — บันทึกแล้วรายการเปลี่ยนก็ไม่สลับโหมดกลางทาง */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* key ใหม่ = ล้างฟอร์มทั้งหมด (ช่องค้นหาลูกค้าจำข้อความของตัวเองไว้ ต้องสร้างใหม่) */
  const [formKey, setFormKey] = useState(0);
  const [fresh, setFresh] = useState(false);
  const [done, setDone] = useState<ReactNode>(null);

  const effective: Mode = fresh ? { kind: "new" } : mode;

  return (
    <div className="space-y-4">
      <div className="bar">
        <div className="min-w-0">
          <Link href="/quotations" className="btn glass-thin btn-mini mb-1.5">
            <ChevronLeftIcon className="size-3.5" strokeWidth={2.4} />
            ใบเสนอราคา
          </Link>
          <h1>สร้างใบเสนอราคา</h1>
          <p>บันทึกเป็นร่างไว้ก่อนได้ เลขที่เอกสารออกเมื่อกด “ออกเลขที่เอกสาร”</p>
          {!fresh && <FromLine mode={mode} ps={ps} />}
        </div>
      </div>

      {done && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-[var(--success-soft)] px-4 py-3 text-[13.5px] font-semibold text-[var(--success)]"
        >
          <CheckIcon className="size-4 shrink-0" strokeWidth={2.4} />
          {done}
        </p>
      )}

      <QuotationForm
        key={formKey}
        crm={crm}
        today={today}
        mode={effective}
        ps={fresh ? "" : ps}
        presetCustomer={fresh ? undefined : presetCustomer}
        onSaved={(msg, keep) => {
          setDone(msg);
          window.scrollTo({ top: 0, behavior: "smooth" });
          /* ร่างแก้ต่อได้ที่เดิม · ใบใหม่ล้างฟอร์มกันบันทึกซ้ำเป็นอีกเลขที่ */
          if (!keep) {
            setFresh(true);
            setFormKey((k) => k + 1);
          }
        }}
        /* ยกเลิก = ออกจากฟอร์ม กลับไปหน้ารายการใบเสนอราคา (เจ้าของแจ้ง 25 ก.ย. 2569)
           เดิมล้างฟอร์มให้ว่างเฉย ๆ ฟอร์มที่ยังไม่ได้กรอกอะไรกดแล้วจึงเหมือนปุ่มเสีย */
        onReset={() => router.push("/quotations")}
      />
    </div>
  );
}

/** บรรทัดบอกที่มาของฟอร์มใต้หัวเรื่อง ตามต้นแบบ (.qn-from) */
function FromLine({ mode, ps }: { mode: Mode; ps: string }) {
  const lines: string[] = [];
  if (mode.kind === "draft") lines.push(`กำลังแก้ไขร่างที่บันทึกไว้เมื่อ ${thaiDate(mode.src.createdAt)}`);
  if (mode.kind === "from")
    lines.push(
      `คัดลอกจากใบ ${mode.src.no} ลงวันที่ ${thaiDate(mode.src.issued)} ยอด ${baht(quotationTotals(mode.src).grand)} บาท`,
    );
  if (ps) lines.push(`ออกจากคำขอก่อนการขาย ${ps}`);
  return (
    <>
      {lines.map((l) => (
        <p key={l} className="mt-1 text-[12.5px] font-semibold text-primary">
          {l}
        </p>
      ))}
    </>
  );
}

function QuotationForm({
  crm,
  today,
  mode,
  ps,
  presetCustomer,
  onSaved,
  onReset,
}: {
  crm: CrmState;
  today: string;
  mode: Mode;
  ps: string;
  presetCustomer?: string;
  onSaved: (msg: ReactNode, keep: boolean) => void;
  onReset: () => void;
}) {
  const router = useRouter();
  const init = useMemo(() => initialOf(crm, mode, presetCustomer, ps), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [customer, setCustomer] = useState<Customer | null>(init.customer);
  const [service, setService] = useState<ServiceKey | "">(init.service);
  const addService = useAddOption({ catalog: "services" }, setService);
  const [issuer, setIssuer] = useState<IssuerCode | "">(init.issuer);
  const [addingIssuer, setAddingIssuer] = useState(false);
  const role = useRole();
  const [buyer, setBuyer] = useState<BuyerType>(init.buyer);
  const [validDays, setValidDays] = useState(init.validDays);
  const [body, setBody] = useState(init.body);
  const [amount, setAmount] = useState(init.amount);
  const [discount, setDiscount] = useState(init.discount);
  const [terms, setTerms] = useState(init.terms);
  const [wht, setWht] = useState(init.wht);
  /* อัตราหัก ณ ที่จ่ายของใบนี้ — งานคนละประเภทคนละอัตรา ต้องเลือกไว้ในใบ ไม่ใช่ให้จอปลายทางเดา */
  const [whtPct, setWhtPct] = useState(init.whtPct);
  /* ออกแทนใบเดิม — "new" = ใบใหม่แยก · เลขที่ = ออกแทนใบนั้น · null = ยังไม่เลือก
     ออกใบใหม่จากใบเดิม (?from=) เลือกใบต้นทางไว้ให้ก่อน เปลี่ยนได้ */
  const [rep, setRep] = useState<string | null>(mode.kind === "from" ? mode.src.no : null);
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState(false);
  /* ร่างที่ฟอร์มนี้ผูกอยู่ — เปิดมาจาก ?draft= หรือเพิ่งกด "บันทึกร่าง" ครั้งแรก
     บันทึกซ้ำจึงทับร่างเดิม ไม่แตกเป็นร่างใหม่ทุกครั้งที่กด */
  const [draftId, setDraftId] = useState(mode.kind === "draft" ? mode.src.id : "");
  /* ยืนยันก่อนออกเลขที่ — ขั้นนี้ย้อนไม่ได้ */
  const [confirming, setConfirming] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);

  const days = Number(validDays.replace(/\D/g, "")) || 0;
  const num = (v: string) => Number(v.replace(/,/g, "")) || 0;

  /** คิดยอดสดขณะกรอก ใช้กติกาเดียวกับตอนบันทึกจริง */
  const totals = useMemo(() => {
    /* คิดด้วยกติกาเดียวกับตอนบันทึกจริง (quotationTotals) ตัวเลขที่เห็นตอนกรอกจะได้ตรงกับเอกสาร */
    const t = quotationTotals({
      amount: num(amount),
      discount: num(discount),
      issuer: issuer || "MAZ",
      buyer,
      wht,
      whtPct,
    });
    return { ...t, disc: t.discount };
  }, [amount, discount, issuer, buyer, wht, whtPct]);

  /*
   * ใบของลูกค้ารายนี้ที่ส่งแล้วและยังรอคำตอบ (ยังไม่มีดีล ไม่ถูกแทน ไม่ถูกปฏิเสธ ไม่หมดอายุ)
   * มีเมื่อไรต้องเลือกว่าออกเป็นใบใหม่แยก หรือออกแทนใบเดิม · ใบต้นทางของ ?from= อยู่ในรายการเสมอถ้ายังแทนได้
   */
  const waiting = useMemo(() => {
    if (!customer || mode.kind === "draft") return [];
    const hasDeal = (q: Quotation) => crm.deals.some((d) => d.quotationNo === q.no);
    return crm.quotations.filter(
      (q) =>
        q.customerCode === customer.code &&
        (canBillQuotation(q, hasDeal(q), today) ||
          (mode.kind === "from" && q.id === mode.src.id && Boolean(q.no) && !q.replacedBy && !hasDeal(q))),
    );
  }, [crm.quotations, crm.deals, customer, mode, today]);
  const repValue = rep && (rep === "new" || waiting.some((q) => q.no === rep)) ? rep : null;

  const problems = {
    customer: !customer,
    service: !service,
    rep: waiting.length > 0 && !repValue,
    issuer: !issuer,
    days: days <= 0,
    items: !htmlToText(body) || totals.gross <= 0,
  };
  const miss = [
    problems.customer && "ผู้สนใจ",
    problems.service && "บริการ",
    problems.rep && "ออกแทนใบเดิม",
    problems.issuer && "ออกในนาม",
    problems.days && "จำนวนวันยืนราคา",
    problems.items && "รายละเอียดและจำนวนเงิน",
  ].filter((x): x is string => Boolean(x));

  /** ค่าที่จะบันทึก — ใช้ทั้งตอนบันทึกร่างและตอนออกเลขที่ กติกาคิดยอดจึงเป็นชุดเดียวกัน */
  function inputOf(c: Customer, iss: IssuerCode, svc: ServiceKey) {
    return {
      customerCode: c.code,
      issuer: iss,
      buyer,
      service: svc,
      validDays: days,
      amount: totals.gross,
      discount: totals.disc,
      wht,
      whtPct,
      body: cleanHtml(body),
      terms: terms.trim(),
      ps: ps || (mode.kind === "new" ? undefined : mode.src.ps),
      replaces: repValue && repValue !== "new" ? repValue : undefined,
    };
  }

  /** กรอกครบหรือยัง — ไม่ครบก็เลื่อนไปที่สรุปสิ่งที่ขาด ไม่ปล่อยให้กดแล้วเงียบ */
  function ready() {
    setTouched(true);
    if (!miss.length && customer && issuer && service) return { customer, issuer, service };
    window.setTimeout(() => summaryRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
    return null;
  }

  /* บันทึกร่าง — ยังไม่ออกเลขที่ กลับมาแก้หรือลบได้ (กติกา SL-03) */
  function saveDraft() {
    const ok = ready();
    if (!ok) return;
    const input = inputOf(ok.customer, ok.issuer, ok.service);
    if (draftId) {
      updateDraft(draftId, input);
    } else {
      const id = addQuotationDraft(input);
      setDraftId(id);
      /* ผูก URL กับร่างที่เพิ่งได้ — ปิดหน้าไปแล้วกลับมาโหลดใหม่ก็ยังแก้ร่างเดิมต่อ ไม่สร้างใบซ้ำ */
      router.replace(`/quotations/new?draft=${encodeURIComponent(id)}`, { scroll: false });
    }
    onSaved(
      <>
        บันทึกร่างแล้ว · ยังไม่ออกเลขที่เอกสาร · รวมทั้งสิ้น {baht(totals.grand)} บาท
        <span className="font-normal">แก้ต่อได้ที่หน้านี้ หรือกด “ออกเลขที่เอกสาร” เมื่อพร้อมส่งลูกค้า</span>
      </>,
      true,
    );
  }

  /* ออกเลขที่เอกสาร — ย้อนไม่ได้ ผ่านกล่องยืนยันมาแล้วเท่านั้น */
  function issueNow() {
    const ok = ready();
    if (!ok) return;
    setConfirming(false);
    const input = inputOf(ok.customer, ok.issuer, ok.service);
    let no: string;
    if (draftId) {
      /* บันทึกสิ่งที่แก้ล่าสุดลงร่างก่อน แล้วค่อยออกเลข เลขจะได้ตรงกับที่เห็นบนจอ */
      updateDraft(draftId, input);
      no = issueDraft(draftId);
    } else {
      no = addQuotation(input);
    }
    onSaved(
      <>
        ออกเลขที่ <b className="num">{no}</b> แล้ว · รวมทั้งสิ้น {baht(totals.grand)} บาท · แก้ไขไม่ได้อีก
        <Link href={`/quotations/${encodeURIComponent(no)}`} className="font-semibold underline">
          เปิดเอกสารไปส่งลูกค้า
        </Link>
        <Link href="/quotations" className="font-semibold underline">
          กลับไปรายการใบเสนอราคา
        </Link>
      </>,
      false,
    );
  }

  /* กด Enter ในช่องกรอก = บันทึกร่าง ซึ่งเป็นทางที่ย้อนได้ ไม่ใช่ออกเลขที่ */
  function submit(e: React.FormEvent) {
    e.preventDefault();
    saveDraft();
  }

  const card = "glass rounded-2xl px-4 py-5 sm:px-6";
  const h2 = "mb-4 border-b border-border pb-3 text-[15px] font-semibold";

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className={card}>
            <h2 className={h2}>ผู้สนใจ</h2>
            <Field label="ผู้สนใจ" required error={touched && problems.customer ? "เลือกลูกค้าก่อน" : undefined}>
              <CustomerCombo
                /* ต้นแบบ quotation-new ไม่มีรายที่ปฏิเสธแล้วในรายการ · เลือกแล้วแสดงแค่ชื่อ · มีป้ายไม่มีเลขภาษี */
                customers={crm.customers.filter((c) => c.status !== "ปฏิเสธ")}
                nameOnly
                taxFlag
                value={customer}
                onChange={(c) => {
                  setCustomer(c);
                  setRep(null);
                  if (c) setBuyer(c.type);
                }}
                invalid={touched && problems.customer}
              />
              {customer && !customer.taxId && (
                <p className="mt-2.5 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--warning)]">
                  ผู้สนใจรายนี้ยังไม่มีเลขประจำตัวผู้เสียภาษี
                </p>
              )}
            </Field>

            {waiting.length > 0 && (
              <div className="mb-[15px]" role="radiogroup" aria-labelledby="rep-label">
                <p id="rep-label" className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">
                  ลูกค้ารายนี้มีใบเสนอราคาที่รอคำตอบ
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <RepOption
                    checked={repValue === "new"}
                    onPick={() => setRep("new")}
                    title="ออกเป็นใบใหม่แยก"
                    sub="ใบเดิมยังรอคำตอบตามเดิม"
                    bad={touched && problems.rep}
                  />
                  {waiting.map((q) => (
                    <RepOption
                      key={q.id}
                      checked={repValue === q.no}
                      onPick={() => setRep(q.no)}
                      title={`ออกแทนใบ ${q.no}`}
                      sub={`${baht(quotationTotals(q).grand)} บาท`}
                      bad={touched && problems.rep}
                    />
                  ))}
                </div>
                {touched && problems.rep && (
                  <p className="mt-1.5 text-[12.5px] text-destructive">เลือกว่าออกเป็นใบใหม่แยก หรือออกแทนใบเดิม</p>
                )}
              </div>
            )}

            <div className="grid gap-x-5 sm:grid-cols-2">
              <Field
                label="บริการ"
                required
                error={touched && problems.service ? "เลือกบริการ" : undefined}
                hint="1 ใบเสนอราคา = 1 บริการ ถ้าลูกค้าซื้อหลายบริการให้ออกคนละใบ"
              >
                <select
                  value={service}
                  onChange={(e) => addService.pick(e.target.value) || setService(e.target.value as ServiceKey)}
                  className="field-control cursor-pointer"
                >
                  <option value="">— เลือกบริการ —</option>
                  {services().map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                  {addService.option}
                </select>
              </Field>

              <Field
                label="ออกในนาม"
                required
                error={touched && problems.issuer ? "เลือกผู้ออกเอกสาร" : undefined}
                hint={
                  issuer && !issuerOf(issuer).vat
                    ? "ผู้ออกรายนี้ไม่ได้จดทะเบียน VAT จึงไม่คิดภาษีมูลค่าเพิ่ม"
                    : undefined
                }
              >
                <select
                  value={issuer}
                  onChange={(e) =>
                    e.target.value === ADD_VALUE ? setAddingIssuer(true) : setIssuer(e.target.value as IssuerCode)
                  }
                  className="field-control cursor-pointer"
                >
                  <option value="">— เลือกผู้ออกเอกสาร —</option>
                  {issuers().map(({ code: k, label }) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                  {/* เพิ่มผู้ออกเอกสารได้เฉพาะฝ่ายบุคคล ซึ่งเป็นผู้ดูแลการตั้งค่า (Full Proposal · M5) */}
                  {role === "hr" && (
                    <option value={ADD_VALUE} className="font-semibold text-primary">
                      ＋ เพิ่มผู้ออกเอกสารใหม่…
                    </option>
                  )}
                </select>
              </Field>

              <Field label="ประเภทผู้ซื้อ">
                <select
                  value={buyer}
                  onChange={(e) => setBuyer(e.target.value as BuyerType)}
                  className="field-control cursor-pointer"
                >
                  {(Object.keys(BUYER_TYPE) as BuyerType[]).map((k) => (
                    <option key={k} value={k}>
                      {BUYER_TYPE[k]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="ใบเสนอราคายืนราคา (วัน)"
                required
                hint={days > 0 ? `ครบกำหนด ${thaiDate(addDays(today, days))}` : undefined}
              >
                <input
                  value={validDays}
                  inputMode="numeric"
                  onChange={(e) => setValidDays(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  aria-invalid={touched && problems.days}
                  className={`field-control num ${touched && problems.days ? "border-destructive" : ""}`}
                />
              </Field>
            </div>
            {addingIssuer && (
              <IssuerAddDialog
                onClose={() => setAddingIssuer(false)}
                onAdded={(code) => {
                  setIssuer(code);
                  setAddingIssuer(false);
                }}
              />
            )}
            {addService.dialog}
          </section>

          <section className={card}>
            <h2 className={h2}>รายการ</h2>
            <label id="bodyLabel" className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
              รายละเอียด<em className="ml-0.5 text-primary not-italic">*</em>
            </label>
            <RichEditor
              value={body}
              onChange={setBody}
              labelId="bodyLabel"
              invalid={touched && !htmlToText(body)}
              placeholder="วางรายละเอียดจาก Word ได้เลย ตัวหนา ขีดเส้นใต้ จุดหัวข้อ และตัวแบ่งหน้าจะติดมาด้วย"
            />
            {touched && problems.items && (
              <p className="mt-2.5 text-[12.5px] text-destructive">กรอกรายละเอียดและจำนวนเงิน</p>
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-[88px]">
          <section className={card}>
            <h2 className={h2}>จำนวนเงินและการชำระเงิน</h2>
            <div className="grid grid-cols-2 gap-x-4">
              <Field label="จำนวนเงิน" required>
                <input
                  value={amount}
                  inputMode="decimal"
                  onChange={(e) => setAmount(commaInput(e.target.value))}
                  placeholder="0"
                  className="field-control num text-right"
                />
              </Field>
              <Field label="ส่วนลด">
                <input
                  value={discount}
                  inputMode="decimal"
                  onChange={(e) => setDiscount(commaInput(e.target.value))}
                  placeholder="0"
                  className="field-control num text-right"
                />
              </Field>
            </div>
            <Field label="เงื่อนไขการชำระเงิน">
              <input
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="เช่น มัดจำ 50% ก่อนเริ่มงาน ส่วนที่เหลือชำระเมื่อส่งมอบ"
                className="field-control"
              />
            </Field>
          </section>

          <section className={card}>
            <h2 className={h2}>สรุปยอด</h2>
            {/* เรียงและใช้คำให้ตรงกับกระดาษใบเสนอราคา รวมทั้งสิ้น = ฐาน + VAT − หัก ณ ที่จ่าย */}
            <dl className="text-[13.5px]">
              {totals.disc > 0 && (
                <>
                  <Row label="รวมเป็นเงิน" value={baht(totals.gross)} />
                  <Row label="หักส่วนลด" value={`-${baht(totals.disc)}`} minus />
                </>
              )}
              <Row label="รวมสุทธิก่อนภาษี" value={baht(totals.base)} />
              <Row
                label={totals.vatRate ? `ภาษีมูลค่าเพิ่ม ${totals.vatRate}%` : "ภาษีมูลค่าเพิ่ม (ไม่คิด)"}
                value={baht(totals.vat)}
              />
              {totals.whtPct > 0 ? (
                <Row label={`หัก ณ ที่จ่าย ${totals.whtPct}%`} value={`-${baht(totals.whtAmount)}`} minus />
              ) : (
                <Row label="หัก ณ ที่จ่าย" value={NO_WHT_NOTE} />
              )}
              <div className="mt-1 flex items-center justify-between gap-3 border-t-2 border-foreground pt-3.5">
                <dt className="font-semibold">รวมทั้งสิ้น</dt>
                <dd className="num text-xl font-bold">{baht(totals.grand)}</dd>
              </div>
            </dl>

            <div className="glass-thin mt-4 rounded-xl px-3.5 py-3 text-[13.5px]">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={wht}
                  onChange={(e) => setWht(e.target.checked)}
                  className="mt-px size-[18px] shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1">
                  หักภาษี ณ ที่จ่าย
                  <small className="mt-0.5 block text-[11.5px] text-muted-foreground">
                    {buyer === "individual"
                      ? "ลูกค้าบุคคลธรรมดาไม่มีหน้าที่หักภาษี ณ ที่จ่าย"
                      : "อัตราที่เลือกจะติดไปกับใบนี้ทุกหน้าจอ"}
                  </small>
                </span>
              </label>
              {/* อัตราติดอยู่กับใบเสนอราคา ไม่ใช่ค่าตั้งค่าของระบบ ใบเก่าจึงไม่เปลี่ยนตามทีหลัง */}
              {wht && buyer !== "individual" && (
                <div className="mt-2.5 flex items-center gap-2.5">
                  <span className="text-[12.5px] text-muted-foreground">อัตราที่ลูกค้าหัก</span>
                  <select
                    value={whtPct}
                    aria-label="อัตราหักภาษี ณ ที่จ่าย"
                    onChange={(e) => setWhtPct(Number(e.target.value))}
                    className="field-control h-9 max-w-[110px] cursor-pointer text-[13.5px]"
                  >
                    {WHT_PCTS.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn glass-thin flex-1 justify-center" onClick={onReset}>
                ยกเลิก
              </button>
              <button type="button" className="btn glass-thin flex-1 justify-center" onClick={() => setPreview(true)}>
                <EyeIcon className="size-[15px]" strokeWidth={1.9} />
                ดูตัวอย่างเอกสาร
              </button>
              {/* ทางที่ย้อนได้อยู่ก่อน — เก็บเป็นร่างไว้ไม่กินเลขที่ */}
              <button type="submit" className="btn glass-thin w-full justify-center">
                บันทึกร่าง
              </button>
              <button
                type="button"
                className="btn solid btn-solid w-full justify-center"
                onClick={() => {
                  if (ready()) setConfirming(true);
                }}
              >
                ออกเลขที่เอกสาร
              </button>
            </div>
            {touched && miss.length > 0 && (
              <p
                ref={summaryRef}
                role="alert"
                className="mt-2.5 flex flex-wrap justify-center gap-x-2 gap-y-1 text-center text-[12.5px] text-destructive"
              >
                ยังกรอกไม่ครบ
                {miss.map((m) => (
                  <span key={m} className="rounded-full bg-[var(--destructive-soft)] px-2 font-semibold">
                    {m}
                  </span>
                ))}
              </p>
            )}
            <p className="mt-3 text-center text-[11.5px] leading-relaxed text-muted-foreground">
              ร่างยังไม่มีเลขที่เอกสาร แก้และลบได้ · ออกเลขที่แล้วย้อนไม่ได้ จากนั้นดาวน์โหลดไฟล์ไปส่งลูกค้าเอง
              แล้วกด “บันทึกว่าส่งแล้ว” ในหน้ารายการ
            </p>
          </section>
        </aside>
      </div>

      {/* มือถือ: แถบยอดรวมติดล่างจอเหนือแถบเมนู เห็นยอดตลอดขณะกรอก และกดบันทึกได้โดยไม่ต้องเลื่อนลงสุด
          ปุ่มบันทึกเดิมในการ์ดสรุปยอดยังอยู่ — ตัวนี้ส่งฟอร์มเดียวกัน */}
      <div className="sticky bottom-[calc(var(--botbar)+10px)] z-10 mt-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5 pl-4 shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.25)] sm:hidden">
        <span className="min-w-0 flex-1">
          <small className="block text-[11.5px] text-muted-foreground">รวมทั้งสิ้น</small>
          <b className="num block truncate text-[17px] font-bold">{baht(totals.grand)}</b>
        </span>
        {/* มือถือ: ปุ่มร่างเป็นปุ่มรอง ปุ่มออกเลขที่เป็นปุ่มทึบ ชุดเดียวกับในการ์ดสรุปยอด */}
        <button type="submit" className="btn glass-thin h-11 shrink-0 justify-center px-4">
          บันทึกร่าง
        </button>
        <button
          type="button"
          className="btn solid btn-solid h-11 shrink-0 justify-center px-4"
          onClick={() => {
            if (ready()) setConfirming(true);
          }}
        >
          ออกเลขที่
        </button>
      </div>

      {confirming && customer && issuer && (
        <IssueNumberDialog
          customerName={customer.name}
          issuer={issuerOf(issuer).name}
          total={totals.grand}
          onGo={issueNow}
          onClose={() => setConfirming(false)}
        />
      )}

      {/* ตัวอย่างเอกสาร — ยิงออกไปที่ body เพราะกล่องที่มี backdrop-filter เป็นกรอบอ้างอิงของ position: fixed */}
      {preview &&
        createPortal(
          <div
            className="fixed inset-0 z-90 flex flex-col bg-black/50"
            role="dialog"
            aria-modal="true"
            aria-label="ตัวอย่างใบเสนอราคา"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setPreview(false);
            }}
          >
            <div className="glass-solid mx-auto flex max-h-full w-full max-w-[900px] flex-col overflow-hidden sm:my-6 sm:rounded-[18px]">
              <div className="flex flex-none items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
                <b className="text-[15px] font-bold">ตัวอย่างใบเสนอราคา</b>
                <button type="button" className="iconbtn glass-thin" aria-label="ปิด" onClick={() => setPreview(false)}>
                  <CloseIcon className="size-[15px]" strokeWidth={2.2} />
                </button>
              </div>
              <div className="scroll-stable flex min-h-0 flex-1 flex-col items-center gap-5 overflow-auto bg-[#eef0f4] p-4 sm:p-6">
                <QuotationPaper
                  doc={{
                    no: "",
                    issued: "",
                    validDays: days,
                    issuer: issuer || "MAZ",
                    body,
                    terms: terms.trim(),
                    totals: {
                      gross: totals.gross,
                      discount: totals.disc,
                      base: totals.base,
                      vatRate: totals.vatRate,
                      vat: totals.vat,
                      whtPct: totals.whtPct,
                      whtAmount: totals.whtAmount,
                      grand: totals.grand,
                    },
                    customer: customer
                      ? {
                          name: customer.name,
                          taxId: customer.taxId,
                          address: customer.address,
                          contact: customer.contact,
                          phone: customer.phone,
                          email: customer.email,
                        }
                      : null,
                  }}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </form>
  );
}

function RepOption({
  checked,
  onPick,
  title,
  sub,
  bad,
}: {
  checked: boolean;
  onPick: () => void;
  title: string;
  sub: string;
  bad?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border-[1.4px] px-3 py-2.5 transition-colors ${
        checked ? "border-primary bg-accent" : bad ? "border-destructive" : "border-border bg-white"
      }`}
    >
      <input type="radio" name="rep" checked={checked} onChange={onPick} className="mt-1 accent-[var(--primary)]" />
      <span>
        <b className="block text-[13.5px] font-semibold">{title}</b>
        <em className="block text-[11.5px] text-muted-foreground not-italic">{sub}</em>
      </span>
    </label>
  );
}

function Row({ label, value, minus }: { label: string; value: string; minus?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`num ${minus ? "text-destructive" : ""}`}>{value}</dd>
    </div>
  );
}
