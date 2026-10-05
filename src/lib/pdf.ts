"use client";

/*
 * ดาวน์โหลดเอกสารเป็นไฟล์ PDF จริง (ข้อเสนอโครงการ · ข้อ 4 "Export PDF")
 *
 * เดิมปุ่ม "ดาวน์โหลด PDF" สั่งพิมพ์ของเบราว์เซอร์ ผู้ใช้ต้องเลือก "บันทึกเป็น PDF" เอง
 * บนมือถือบางเครื่องไม่มีตัวเลือกนั้นเลย จึงเปลี่ยนมาสร้างไฟล์เองแล้วสั่งดาวน์โหลด
 *
 * วิธี: วาดเอกสารบนหน้าจอลงผืนผ้าใบ แล้ววางลงหน้า A4
 *   - ใช้รูปเพราะภาษาไทยในเอกสารต้องตัดคำและสระวางถูกตำแหน่ง ฝัง font ลง PDF ตรง ๆ ยุ่งกว่าและไฟล์ใหญ่กว่า
 *   - เอกสารยาวเกินหนึ่งหน้าให้ตัดเป็นหลายหน้าตามความสูง A4
 *
 * โหลดไลบรารีแบบ dynamic import — หน้าอื่นที่ไม่ได้กดดาวน์โหลดจะได้ไม่ต้องโหลดไปด้วย
 */

/** ขนาด A4 แนวตั้งในหน่วยมิลลิเมตร */
const A4 = { w: 210, h: 297 };
/** ขอบกระดาษ (มม.) — เอกสารของระบบมีขอบในตัวอยู่แล้ว เว้นนิดเดียวพอ */
const PAD = 6;

export type PdfResult = { ok: true } | { ok: false; error: string };

/**
 * บันทึกเนื้อหาใน element เป็นไฟล์ PDF
 * @param el กล่องของเอกสาร (ส่วนที่เป็นกระดาษ ไม่รวมแถบปุ่ม)
 * @param filename ชื่อไฟล์ ไม่ต้องใส่ .pdf
 */
export async function savePdf(el: HTMLElement, filename: string): Promise<PdfResult> {
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);

    const canvas = await html2canvas(el, {
      /* คมพอสำหรับอ่านและพิมพ์ แต่ไม่ใหญ่จนไฟล์อืด */
      scale: Math.min(2, window.devicePixelRatio || 1) * 1.5,
      backgroundColor: "#ffffff",
      useCORS: true,
      /* เงาและมุมโค้งของหน้าจอไม่ต้องติดไปในเอกสาร */
      logging: false,
    });

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const usableW = A4.w - PAD * 2;
    const usableH = A4.h - PAD * 2;
    /* ความสูงของภาพเมื่อย่อให้พอดีความกว้างกระดาษ */
    const fullH = (canvas.height * usableW) / canvas.width;

    if (fullH <= usableH) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", PAD, PAD, usableW, fullH);
    } else {
      /* ยาวเกินหนึ่งหน้า — ตัดภาพเป็นแถบตามความสูงที่กระดาษหนึ่งแผ่นรับได้ */
      const sliceH = Math.floor((usableH * canvas.width) / usableW);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      const ctx = slice.getContext("2d");
      if (!ctx) return { ok: false, error: "เบราว์เซอร์นี้สร้างไฟล์ PDF ไม่ได้" };
      for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
        const h = Math.min(sliceH, canvas.height - y);
        slice.height = h;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, slice.width, h);
        ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (page > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", PAD, PAD, usableW, (h * usableW) / canvas.width);
      }
    }

    pdf.save(`${filename}.pdf`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "สร้างไฟล์ PDF ไม่สำเร็จ" };
  }
}

/** ชื่อไฟล์ที่ปลอดภัยกับทุกระบบ — กันอักขระที่ตั้งชื่อไฟล์ไม่ได้ */
export function pdfName(parts: (string | undefined)[]) {
  return parts
    .filter(Boolean)
    .join("-")
    .replace(/[\\/:*?"<>|]/g, "")
    .slice(0, 80);
}
