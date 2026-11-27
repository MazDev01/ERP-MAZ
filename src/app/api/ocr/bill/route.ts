import "server-only";

/*
 * อ่านข้อความจากไฟล์บิล (รอบที่ 142 · Requirement รอบ 12)
 *
 * บิลที่บัญชีได้รับมีสองแบบ
 *   PDF ที่มีชั้นข้อความ — ดึงข้อความออกได้เองที่เซิร์ฟเวอร์ ไม่ต้องใช้บริการข้างนอก
 *   รูปถ่าย/สแกน        — ต้องใช้บริการอ่านภาพ (OCR) ซึ่งต้องมีกุญแจ
 *
 * กุญแจอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น (.env.local ซึ่งไม่ขึ้น git):
 *   OCR_API_URL  ปลายทางของบริการอ่านภาพ (รูปแบบ Google Cloud Vision)
 *   OCR_API_KEY  กุญแจของบริการนั้น
 * ยังไม่ได้กุญแจ = ตอบ no_keys แล้วหน้าจอให้บัญชีวางข้อความจากบิลเองแทน
 *
 * ไม่ว่าจะมาทางไหน ข้อความที่ได้เป็นแค่ "ร่าง" — บัญชีต้องตรวจก่อนนำเข้าเสมอ
 */

import { serverSupabase } from "@/lib/supabase/server";

/** เพดานไฟล์ — ใหญ่กว่านี้ไม่ใช่บิล และกินหน่วยความจำของเซิร์ฟเวอร์ */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * ดึงข้อความจาก PDF ที่มีชั้นข้อความ (ไม่ใช่สแกนเป็นรูป)
 * อ่านเฉพาะสตรีมที่ไม่ได้บีบอัด และข้อความในวงเล็บของคำสั่ง Tj/TJ
 * อ่านไม่ออกคืนค่าว่าง แล้วไปทางบริการ OCR หรือให้บัญชีวางเอง
 */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  if (!raw.startsWith("%PDF")) return "";
  const out: string[] = [];
  /* ข้อความใน PDF อยู่ในวงเล็บ เช่น (ร้านกระดาษดี) Tj */
  const re = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|TJ|')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const s = m[1]
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ");
    if (s.trim()) out.push(s);
  }
  return out.join("\n");
}

type Keys = { url: string; key: string };

function keys(): Keys | null {
  const url = process.env.OCR_API_URL ?? "";
  const key = process.env.OCR_API_KEY ?? "";
  if (!url || !key) return null;
  return { url, key };
}

/** ส่งรูปให้บริการอ่านภาพ (รูปแบบคำขอของ Google Cloud Vision) */
async function readImage(k: Keys, buf: Buffer): Promise<string | null> {
  const res = await fetch(`${k.url}?key=${encodeURIComponent(k.key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: buf.toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          /* บิลไทยปนอังกฤษ บอกภาษาไว้ก่อนช่วยให้อ่านเลขกับวันที่แม่นขึ้น */
          imageContext: { languageHints: ["th", "en"] },
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const out = (await res.json()) as {
    responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[];
  };
  const first = out.responses?.[0];
  if (!first || first.error) return null;
  return first.fullTextAnnotation?.text ?? "";
}

export async function POST(request: Request) {
  /* บิลค่าใช้จ่ายของบริษัทเป็นเอกสารการเงิน ต้องล็อกอินก่อน */
  const sb = await serverSupabase();
  const me = sb ? (await sb.auth.getUser()).data.user : null;
  if (!me) return Response.json({ ok: false, reason: "no_account" }, { status: 401 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return Response.json({ ok: false, reason: "bad_form" }, { status: 400 });
  }
  if (!file) return Response.json({ ok: false, reason: "need_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ ok: false, reason: "too_big" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());

  /* ทาง PDF ก่อน — ไม่ต้องใช้กุญแจและได้ข้อความตรงกว่าการอ่านภาพ */
  const fromPdf = pdfText(buf);
  if (fromPdf.trim().length >= 20) {
    return Response.json({ ok: true, text: fromPdf, how: "pdf" });
  }

  const k = keys();
  if (!k) {
    /* ยังไม่ได้กุญแจบริการอ่านภาพ — หน้าจอจะให้บัญชีวางข้อความเอง */
    return Response.json({ ok: false, reason: "no_keys" }, { status: 503 });
  }

  const text = await readImage(k, buf);
  if (text === null) return Response.json({ ok: false, reason: "ocr_refused" }, { status: 502 });
  return Response.json({ ok: true, text, how: "ocr" });
}
