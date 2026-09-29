"use client";

/*
 * ล็อกไม่ให้พื้นหลังเลื่อนตอนเปิดกล่องทับหน้า
 *
 * นับชั้นไว้ เพราะกล่องซ้อนกันได้ (เช่นเปิดฟอร์มแล้วมีกล่องยืนยันซ้อนอีกที)
 * ถ้าปลดล็อกทันทีที่ตัวในสุดปิด พื้นหลังจะเลื่อนได้ทั้งที่ยังมีกล่องค้างอยู่
 *
 * ที่จองแถบเลื่อนอยู่ในคลาส .modal-open ของ globals.css — จองเฉพาะตอนล็อก
 * ไม่ใช่จองไว้ตลอด ไม่งั้นจะเห็นแถบว่างที่ขอบขวาของทุกหน้า
 */

let depth = 0;

export function lockScroll() {
  depth += 1;
  document.body.classList.add("modal-open");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove("modal-open");
  };
}
