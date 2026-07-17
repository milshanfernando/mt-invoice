import jsPDF from "jspdf";

/**
 * WHY THIS FILE EXISTS
 * --------------------
 * The previous approach rendered the invoice as HTML/Tailwind, took a
 * screenshot with html2canvas(-pro), and dropped that screenshot into a PDF.
 * That works... until it doesn't: html2canvas periodically fails to
 * rasterize backgrounds/borders/rounded corners on the 2nd/3rd capture in a
 * session (memory pressure, stylesheet cloning timing, canvas paint
 * deprioritization, etc.) while plain text still draws — which is exactly
 * the "unstyled text dump" symptom you're seeing.
 *
 * This file draws the invoice directly with jsPDF's own text/line/rect
 * primitives instead. There is no DOM, no canvas, no screenshot — so there
 * is nothing to intermittently fail. The same input always produces the
 * same output, every time, on every device.
 *
 * The on-screen Preview tab can keep using your existing Tailwind/HTML
 * markup exactly as-is (that's just for the user to look at). Only the
 * actual export (Download / Share) should call buildInvoicePdfBlob below.
 */

export interface InvoiceLike {
  businessName: string;
  businessTagline: string;
  address1: string;
  address2: string;
  phone: string;
  email: string;
  website: string;

  invoiceNo: string;
  invoiceDate: string; // formatted display string, e.g. "17 Jul 2026"
  bookingSource: string;
  invoiceStatus: string;

  guestTitle: string;
  guestName: string;
  totalGuests: string;
  idPassport: string;
  contact: string;

  checkInDisplay: string;
  checkOutDisplay: string;
  totalUnits: string;

  roomDescription: string;
  nights: number;
  rate: number;
  subtotal: number;
  discountLabel: string;
  discount: number;
  total: number;

  paymentMethod: string;
  paymentStatus: string;
  transactionId: string;
  currency: string;
}

/** Loads any image URL (including local paths like /seal.png) and converts it
 * to a PNG data URL via an offscreen canvas, so jsPDF.addImage always gets
 * something it can embed directly — no network/format quirks at PDF-build time. */
export async function loadImageAsDataUrl(url: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
  });
  img.src = url;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context for seal image");
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

function fmt(n: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Draws the invoice directly onto a jsPDF document and returns it as a Blob.
 * `sealDataUrl` should already be a data: URL (see loadImageAsDataUrl above),
 * or null/undefined to skip the seal.
 */
export function buildInvoicePdfBlob(
  data: InvoiceLike,
  sealDataUrl: string | null | undefined,
): Blob {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const rightX = pageWidth - margin;
  let y = margin;

  const gray = (v: number) => pdf.setTextColor(v, v, v);
  const black = () => pdf.setTextColor(17, 24, 39); // gray-900
  const amber = () => pdf.setTextColor(180, 83, 9); // amber-700
  const green = () => pdf.setTextColor(22, 163, 74); // green-600
  const red = () => pdf.setTextColor(220, 38, 38); // red-600
  const rule = (yy: number) => {
    pdf.setDrawColor(229, 231, 235); // gray-200
    pdf.setLineWidth(0.75);
    pdf.line(margin, yy, rightX, yy);
  };

  pdf.setFont("times", "bold");

  // ---- Header: business (left) / invoice meta (right) ----
  black();
  pdf.setFontSize(20);
  pdf.text(data.businessName, margin, y + 16);

  pdf.setFont("times", "normal");
  pdf.setFontSize(9);
  amber();
  pdf.text(data.businessTagline, margin, y + 32);
  pdf.setDrawColor(180, 83, 9);
  pdf.line(
    margin,
    y + 36,
    margin + pdf.getTextWidth(data.businessTagline),
    y + 36,
  );

  gray(75);
  pdf.setFontSize(9);
  pdf.text(data.address1, margin, y + 52);
  pdf.text(data.address2, margin, y + 64);
  pdf.text(data.phone, margin, y + 78);

  pdf.setFont("times", "bold");
  pdf.setFontSize(26);
  black();
  pdf.text("INVOICE", rightX, y + 20, { align: "right" });
  pdf.setDrawColor(180, 83, 9);
  pdf.line(rightX - 60, y + 28, rightX, y + 28);

  const metaRows: [string, string, "gray" | "green"][] = [
    ["INVOICE NO.", data.invoiceNo, "gray"],
    ["INVOICE DATE", data.invoiceDate, "gray"],
    ["BOOKING SOURCE", data.bookingSource, "gray"],
    ["INVOICE STATUS", data.invoiceStatus, "green"],
  ];
  let metaY = y + 42;
  pdf.setFontSize(8);
  metaRows.forEach(([label, value, tone]) => {
    pdf.setFont("times", "bold");
    gray(107);
    pdf.text(label, rightX - 100, metaY, { align: "right" });
    pdf.setFont("times", tone === "green" ? "bold" : "normal");
    if (tone === "green") green();
    else black();
    pdf.text(value || "—", rightX, metaY, { align: "right" });
    metaY += 13;
  });

  y = Math.max(y + 90, metaY + 10);
  rule(y);
  y += 24;

  // ---- Guest details / Stay details (two columns) ----
  const colGap = 20;
  const colWidth = (contentWidth - colGap) / 2;
  const col2X = margin + colWidth + colGap;

  const drawKeyValTable = (
    x: number,
    startY: number,
    title: string,
    rows: [string, string][],
  ) => {
    let ry = startY;
    pdf.setFont("times", "bold");
    pdf.setFontSize(10);
    black();
    pdf.text(title, x, ry);
    ry += 16;
    pdf.setFontSize(9);
    rows.forEach(([label, value]) => {
      pdf.setFont("times", "normal");
      gray(107);
      pdf.text(label, x, ry);
      black();
      pdf.text(value || "—", x + colWidth * 0.55, ry);
      ry += 15;
    });
    return ry;
  };

  const guestBottom = drawKeyValTable(margin, y, "GUEST DETAILS", [
    [
      "Guest Name",
      `${data.guestTitle ? data.guestTitle + " " : ""}${data.guestName}`,
    ],
    ["Total Guests", data.totalGuests],
    ["ID / Passport No.", data.idPassport],
    ["Contact", data.contact],
  ]);

  const stayBottom = drawKeyValTable(col2X, y, "STAY DETAILS", [
    ["Check-in Date", data.checkInDisplay],
    ["Check-out Date", data.checkOutDisplay],
    ["Length of Stay", `${data.nights} Night${data.nights === 1 ? "" : "s"}`],
    ["Total Units", data.totalUnits],
  ]);

  y = Math.max(guestBottom, stayBottom) + 14;

  // ---- Line items table ----
  const col = {
    desc: margin,
    qty: margin + contentWidth * 0.5,
    rate: margin + contentWidth * 0.68,
    amount: rightX,
  };

  pdf.setFillColor(243, 244, 246); // gray-100
  pdf.rect(margin, y, contentWidth, 20, "F");
  pdf.setFont("times", "bold");
  pdf.setFontSize(8);
  gray(55);
  pdf.text("DESCRIPTION", col.desc + 6, y + 13);
  pdf.text("QTY", col.qty, y + 13, { align: "center" });
  pdf.text(`RATE (${data.currency})`, col.rate, y + 13, { align: "center" });
  pdf.text(`AMOUNT (${data.currency})`, col.amount, y + 13, { align: "right" });
  y += 30;

  pdf.setFont("times", "bold");
  pdf.setFontSize(9);
  black();
  pdf.text(data.roomDescription, col.desc + 6, y);
  pdf.setFont("times", "normal");
  pdf.setFontSize(8);
  gray(107);
  if (data.checkInDisplay && data.checkOutDisplay) {
    pdf.text(
      `${data.checkInDisplay} - ${data.checkOutDisplay}`,
      col.desc + 6,
      y + 12,
    );
  }
  pdf.setFontSize(9);
  black();
  pdf.text(`${data.nights} Night${data.nights === 1 ? "" : "s"}`, col.qty, y, {
    align: "center",
  });
  pdf.text(fmt(data.rate), col.rate, y, { align: "center" });
  pdf.text(fmt(data.subtotal), col.amount, y, { align: "right" });
  y += 22;
  rule(y);
  y += 6;

  if (data.discount > 0) {
    gray(75);
    pdf.setFontSize(9);
    pdf.text(data.discountLabel || "Discount", col.desc + 6, y + 10);
    pdf.text(`-${fmt(data.discount)}`, col.amount, y + 10, { align: "right" });
    y += 24;
    rule(y);
    y += 6;
  }

  y += 14;

  // ---- Total ----
  pdf.setFont("times", "bold");
  pdf.setFontSize(10);
  black();
  pdf.text(
    `TOTAL (${data.nights} NIGHT${data.nights === 1 ? "" : "S"})`,
    col.desc,
    y,
  );
  pdf.setFontSize(16);
  pdf.text(`${data.currency} ${fmt(data.total)}`, rightX, y, {
    align: "right",
  });
  y += 26;

  // ---- Payment info (left) / Total payable box + seal (right) ----
  const payBottom = drawKeyValTable(margin, y, "PAYMENT INFORMATION", [
    ["Payment Method", data.paymentMethod],
    ["Payment Status", data.paymentStatus],
    ["Transaction ID", data.transactionId],
  ]);
  pdf.setFont("times", "italic");
  pdf.setFontSize(8);
  red();
  pdf.text("Note: Payments are non-refundable.", margin, payBottom + 8);

  const boxX = col2X;
  const boxY = y;
  const boxW = colWidth;
  const boxH = 70;
  pdf.setDrawColor(229, 231, 235);
  pdf.roundedRect(boxX, boxY, boxW, boxH, 6, 6);
  pdf.setFont("times", "bold");
  pdf.setFontSize(9);
  black();
  pdf.text("TOTAL PAYABLE", boxX + 14, boxY + 20);
  pdf.setFontSize(15);
  pdf.text(`${data.currency} ${fmt(data.total)}`, boxX + 14, boxY + 42);

  if (sealDataUrl) {
    try {
      const sealSize = 70;
      pdf.saveGraphicsState();

      pdf.setGState(new (pdf as any).GState({ opacity: 0.85 }));
      pdf.addImage(
        sealDataUrl,
        "PNG",
        boxX + boxW - sealSize + 15,
        boxY + boxH - sealSize + 20,
        sealSize,
        sealSize,
      );
      pdf.restoreGraphicsState();
    } catch {
      // If the seal image fails to embed for any reason, skip it silently —
      // never fail the whole invoice export over a stamp graphic.
    }
  }

  y = Math.max(payBottom + 20, boxY + boxH + 20);
  rule(y);
  y += 20;

  // ---- Footer ----
  pdf.setFont("times", "bold");
  pdf.setFontSize(10);
  black();
  pdf.text(`Thank you for choosing ${data.businessName}.`, pageWidth / 2, y, {
    align: "center",
  });
  y += 14;
  pdf.setFont("times", "normal");
  pdf.setFontSize(9);
  gray(75);
  pdf.text(
    "We appreciate your visit. Welcome back anytime!",
    pageWidth / 2,
    y,
    {
      align: "center",
    },
  );
  y += 14;
  pdf.setFont("times", "bold");
  pdf.text("Payments are non-refundable.", pageWidth / 2, y, {
    align: "center",
  });
  y += 16;
  rule(y);
  y += 16;

  pdf.setFont("times", "normal");
  pdf.setFontSize(8);
  gray(75);
  const footerLine = [data.website, data.email, data.phone]
    .filter(Boolean)
    .join("     ");
  pdf.text(footerLine, pageWidth / 2, y, { align: "center" });

  return pdf.output("blob");
}
