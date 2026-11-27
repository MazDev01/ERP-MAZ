/*
 * อ่านบิลผู้ขาย แล้วแยกเป็นช่อง ๆ ให้บัญชีตรวจก่อนนำเข้า (Requirement รอบ 12 · รอบที่ 142)
 *
 * ไฟล์นี้คือ "สมอง" ของการอ่านบิล — รับข้อความล้วนเข้ามา แล้วเดาค่าออกไป
 * ไม่ยุ่งกับไฟล์ ไม่ยุ่งกับเครือข่าย จึงทดสอบได้ตรง ๆ และใช้ได้กับข้อความจากทุกทาง
 *   · ข้อความที่บัญชีคัดลอกมาจากบิล PDF หรืออีเมลของผู้ขาย (ใช้ได้ทันที)
 *   · ข้อความจากบริการอ่านภาพ (OCR) เมื่อได้กุญแจแล้ว — /api/ocr/bill
 *
 * ทุกค่าที่เดาได้ถือเป็น "ร่าง" เสมอ บัญชีต้องตรวจและแก้ได้ก่อนกดนำเข้า
 * ค่าที่เดาไม่ได้ปล่อยว่าง ดีกว่าเดามั่วแล้วบัญชีเผลอกดผ่าน
 */

export type BillDraft = {
  /** ชื่อผู้ขาย (ผู้ถูกหักภาษี) */
  vendor: string;
  /** เลขประจำตัวผู้เสียภาษี 13 หลัก */
  taxId: string;
  /** วันที่บนบิล (yyyy-mm-dd) */
  date: string;
  /** เลขที่บิลของผู้ขาย */
  no: string;
  /** ยอดก่อนภาษีมูลค่าเพิ่ม */
  base: number;
  /** ภาษีมูลค่าเพิ่มบนบิล */
  vat: number;
  /** ยอดรวมทั้งสิ้นบนบิล */
  total: number;
  /** ช่องที่อ่านได้จริง — หน้าจอใช้ชี้ว่าช่องไหนระบบเดาให้ ช่องไหนต้องกรอกเอง */
  got: string[];
};

const EMPTY: BillDraft = { vendor: "", taxId: "", date: "", no: "", base: 0, vat: 0, total: 0, got: [] };

const TH_MONTHS = [
  ["ม.ค", "มกราคม"],
  ["ก.พ", "กุมภาพันธ์"],
  ["มี.ค", "มีนาคม"],
  ["เม.ย", "เมษายน"],
  ["พ.ค", "พฤษภาคม"],
  ["มิ.ย", "มิถุนายน"],
  ["ก.ค", "กรกฎาคม"],
  ["ส.ค", "สิงหาคม"],
  ["ก.ย", "กันยายน"],
  ["ต.ค", "ตุลาคม"],
  ["พ.ย", "พฤศจิกายน"],
  ["ธ.ค", "ธันวาคม"],
];

/** แปลงเลขไทยเป็นอารบิก — บิลบางใบพิมพ์เลขไทย */
const arabic = (s: string) => s.replace(/[๐-๙]/g, (d) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(d)));

const pad = (n: number) => String(n).padStart(2, "0");

/** ปี พ.ศ. → ค.ศ. (ปีสองหลักถือเป็น พ.ศ. ย่อ เช่น 69 = 2569) */
function yearOf(raw: string) {
  const n = Number(raw);
  if (raw.length === 2) return n + 2500 - 543;
  return n > 2400 ? n - 543 : n;
}

/** วันที่บนบิล — รับทั้ง 27/11/2569, 2026-11-27 และ 27 พ.ย. 2569 */
export function billDate(text: string): string {
  const t = arabic(text);

  const iso = t.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;

  const slash = t.match(/(\d{1,2})[/.-](\d{1,2})[/.-]((?:25|20)\d{2}|\d{2})\b/);
  if (slash) {
    const y = yearOf(slash[3]);
    const m = Number(slash[2]);
    const d = Number(slash[1]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad(m)}-${pad(d)}`;
  }

  for (let i = 0; i < TH_MONTHS.length; i += 1) {
    for (const name of TH_MONTHS[i]) {
      const re = new RegExp(`(\\d{1,2})\\s*${name.replace(/\./g, "\\.?")}\\.?\\s*((?:25|20)\\d{2}|\\d{2})`);
      const m = t.match(re);
      if (m) return `${yearOf(m[2])}-${pad(i + 1)}-${pad(Number(m[1]))}`;
    }
  }
  return "";
}

/** เลขประจำตัวผู้เสียภาษี 13 หลัก — ยอมให้มีขีดหรือเว้นวรรคคั่น */
export function billTaxId(text: string): string {
  const t = arabic(text);
  const m = t.match(/\b(\d[\d\s-]{11,20}\d)\b/g) ?? [];
  for (const raw of m) {
    const d = raw.replace(/\D/g, "");
    if (d.length === 13) return d;
  }
  return "";
}

const money = (s: string) => Number(s.replace(/,/g, ""));

/**
 * ตัวเลขเงินของบรรทัดที่มีคำนี้
 * ตัดตัวเลขที่ตามด้วย % ทิ้งก่อน ไม่งั้น "ภาษีมูลค่าเพิ่ม 7% 294.00" จะอ่านได้ 7
 * (เจอตอนทดสอบรอบที่ 142 บนบิลจริงที่พิมพ์อัตราภาษีไว้หน้าจำนวนเงิน)
 * บิลบางใบขึ้นบรรทัดใหม่ก่อนตัวเลข จึงมองบรรทัดถัดไปให้อีกหนึ่งบรรทัด
 */
function amountAfter(text: string, words: string[]): number {
  const lines = arabic(text).split(/\r?\n/);
  const pick = (s: string) => {
    const clean = s.replace(/[\d,]+(?:\.\d+)?\s*%/g, " ");
    const m = clean.match(/([\d,]+(?:\.\d{1,2})?)/);
    if (!m) return 0;
    const v = money(m[1]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  for (const w of words) {
    const re = new RegExp(w, "i");
    for (let i = 0; i < lines.length; i += 1) {
      const hit = lines[i].match(re);
      if (!hit) continue;
      const after = lines[i].slice((hit.index ?? 0) + hit[0].length);
      const here = pick(after);
      if (here) return here;
      const next = pick(lines[i + 1] ?? "");
      if (next) return next;
    }
  }
  return 0;
}

/**
 * ชื่อผู้ขาย — บรรทัดแรกที่ดูเหมือนชื่อร้าน/บริษัท
 * ข้ามหัวเอกสาร (ใบกำกับภาษี ใบเสร็จรับเงิน ฯลฯ) เพราะบิลส่วนใหญ่พิมพ์หัวไว้ก่อนชื่อร้าน
 */
export function billVendor(text: string): string {
  const skip = /(ใบกำกับภาษี|ใบเสร็จ|ใบแจ้งหนี้|ต้นฉบับ|สำเนา|tax invoice|receipt|invoice)/i;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 3 || line.length > 80) continue;
    if (skip.test(line)) continue;
    if (/^[\d\s,.:/-]+$/.test(line)) continue;
    return line.replace(/\s{2,}/g, " ");
  }
  return "";
}

/**
 * อ่านบิลจากข้อความ แล้วคืนร่างให้บัญชีตรวจ
 * ยอดก่อนภาษีเดาจาก "รวมเป็นเงิน/ราคาสุทธิ" ไม่มีก็ถอดออกจากยอดรวมลบ VAT
 */
export function readBill(text: string): BillDraft {
  if (!text.trim()) return { ...EMPTY };
  const got: string[] = [];
  const vendor = billVendor(text);
  const taxId = billTaxId(text);
  const date = billDate(text);
  const noMatch = arabic(text).match(/(?:เลขที่|เลขที่เอกสาร|no\.?|invoice no\.?)[^\dA-Z\n]{0,10}([A-Z0-9][A-Z0-9/-]{3,20})/i);
  const no = noMatch ? noMatch[1] : "";

  const vat = amountAfter(text, ["ภาษีมูลค่าเพิ่ม", "ภาษีมูลค่า", "vat"]);
  const total = amountAfter(text, ["รวมทั้งสิ้น", "ยอดสุทธิ", "จำนวนเงินรวมทั้งสิ้น", "grand total", "total amount"]);
  let base = amountAfter(text, ["รวมเป็นเงิน", "ราคาสุทธิ", "มูลค่าสินค้า", "sub ?total", "ยอดก่อนภาษี"]);
  if (!base && total && vat && total > vat) base = Math.round((total - vat) * 100) / 100;
  if (!base && total && !vat) base = total;

  if (vendor) got.push("vendor");
  if (taxId) got.push("taxId");
  if (date) got.push("date");
  if (no) got.push("no");
  if (base) got.push("base");
  if (vat) got.push("vat");
  if (total) got.push("total");

  return { vendor, taxId, date, no, base, vat, total, got };
}

/** ร่างนี้พร้อมให้บัญชีกดนำเข้าหรือยัง — ต้องมีผู้ขาย วันที่ และยอด */
export function billReady(d: BillDraft) {
  const miss = [
    !d.vendor.trim() && "ชื่อผู้ขาย",
    !d.date && "วันที่บนบิล",
    !(d.base > 0) && "ยอดก่อนภาษี",
  ].filter((x): x is string => Boolean(x));
  return { ok: miss.length === 0, miss };
}
