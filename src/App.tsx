import { useEffect, useRef, useState } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

/**
 * SIMPLE INVOICE SYSTEM — MOBILE FIRST
 * -------------------------------------
 * npm install jspdf html2canvas-pro
 *
 * IMPORTANT: uses `html2canvas-pro`, NOT the original `html2canvas`.
 * If your Tailwind version is v4+, its default color palette compiles to
 * oklch()/lab() color values, which the classic html2canvas cannot parse —
 * it throws immediately and every export silently fails into the catch
 * block. html2canvas-pro is a maintained fork that supports these modern
 * color functions and is a drop-in replacement (same API).
 *
 * - Edit / Preview tabs (built for small screens, works fine on desktop too)
 * - Business selector (auto-fills business details per property)
 * - Guest title dropdown (Mr. / Mrs. / Ms. / Miss / Dr. / Eng.)
 * - Room type dropdown (with "Custom" fallback)
 * - Payment method + payment status dropdowns
 * - Invoice number auto-increments per business (persisted in localStorage)
 * - Company seal: upload a PNG/JPG and it's stamped onto the invoice
 * - Download PDF or Share directly to WhatsApp (native share sheet on phones)
 *
 * FIX NOTES (this revision):
 * - PDF/WhatsApp export previously captured the on-screen node, which has a
 *   CSS `transform: scale()` applied for responsive display. html2canvas does
 *   not reliably render transformed nodes, which produced blank/broken PDFs.
 *   The invoice is now also rendered once, at full size, completely
 *   off-screen (no transform, no clipping) and THAT node is what gets
 *   captured. The on-screen scaled copy is purely visual.
 */

const TITLES = ["Mr.", "Mrs.", "Ms.", "Miss", "Dr.", "Eng.", "(none)"];

const ROOM_TYPES = [
  "Standard Single Room with Shared Bathroom",
  "King Room with Shared Bathroom",
  "Queen Room with Shared Bathroom",
];

const PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer"];
const PAYMENT_STATUSES = ["Paid", "Pending", "Advance Payment"];

interface BusinessProfile {
  businessName: string;
  businessTagline: string;
  address1: string;
  address2: string;
  phone: string;
  email: string;
  website: string;
  code: string; // used as invoice number prefix
}

const BUSINESS_PROFILES: Record<string, BusinessProfile> = {
  "Majestic Town": {
    businessName: "MAJESTIC TOWN",
    businessTagline: "GUEST HOUSE",
    address1: "Al Khalidiya, Behind Shining Tower,",
    address2: "Building No. 15, Floor M, Office M2",
    phone: "+971 54 757 5749",
    email: "info@majestictown.ae",
    website: "www.majestictown.ae",
    code: "MT",
  },
  "Vouge Inn": {
    businessName: "VOUGE INN",
    businessTagline: "GUEST HOUSE",
    address1: "Enter address line 1",
    address2: "Enter address line 2",
    phone: "+971 5X XXX XXXX",
    email: "info@vogueinn.ae",
    website: "www.vogueinn.ae",
    code: "VI",
  },
  "DSV Property": {
    businessName: "DSV PROPERTY",
    businessTagline: "GUEST HOUSE",
    address1: "Enter address line 1",
    address2: "Enter address line 2",
    phone: "+971 5X XXX XXXX",
    email: "info@dsvproperty.ae",
    website: "www.dsvproperty.ae",
    code: "DSV",
  },
};

const BUSINESS_KEYS = Object.keys(BUSINESS_PROFILES);

interface InvoiceData {
  businessKey: string;
  businessName: string;
  businessTagline: string;
  address1: string;
  address2: string;
  phone: string;
  email: string;
  website: string;

  invoiceNo: string;
  invoiceDate: string;
  bookingSource: string;
  invoiceStatus: "PAID" | "UNPAID" | "PARTIAL";

  guestTitle: string;
  guestName: string;
  totalGuests: string;
  idPassport: string;
  contact: string;

  checkIn: string;
  checkOut: string;
  totalUnits: string;

  roomDescription: string;
  qtyNights: string;
  rate: string;

  discountLabel: string;
  discountAmount: string;

  paymentMethod: string;
  paymentStatus: string;
  transactionId: string;

  currency: string;
}

// ---------- Invoice number auto-increment (persisted per business) ----------
let memoryCounterFallback: Record<string, number> = {};

function getNextInvoiceNumber(code: string): string {
  const storageKey = `invoiceCounter_${code}`;
  let next = 1;
  try {
    const current = parseInt(localStorage.getItem(storageKey) || "0", 10);
    next = (isNaN(current) ? 0 : current) + 1;
    localStorage.setItem(storageKey, String(next));
  } catch {
    // localStorage unavailable (e.g. private mode) — fall back to in-memory counter
    memoryCounterFallback[code] = (memoryCounterFallback[code] || 0) + 1;
    next = memoryCounterFallback[code];
  }
  const yyyy = new Date().getFullYear();
  return `${code}-${yyyy}-${String(next).padStart(4, "0")}`;
}

function buildDefaultData(): InvoiceData {
  const initialKey = BUSINESS_KEYS[0];
  const profile = BUSINESS_PROFILES[initialKey];
  return {
    businessKey: initialKey,
    businessName: profile.businessName,
    businessTagline: profile.businessTagline,
    address1: profile.address1,
    address2: profile.address2,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,

    invoiceNo: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    bookingSource: "Direct Booking",
    invoiceStatus: "PAID",

    guestTitle: "Mr.",
    guestName: "",
    totalGuests: "1",
    idPassport: "",
    contact: "",

    checkIn: "",
    checkOut: "",
    totalUnits: "1",

    roomDescription: ROOM_TYPES[0],
    qtyNights: "1",
    rate: "85",

    discountLabel: "",
    discountAmount: "0",

    paymentMethod: "Cash",
    paymentStatus: "Paid",
    transactionId: "",

    currency: "AED",
  };
}

function fmt(n: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(d: string) {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00");
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-semibold text-gray-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

// Colors are explicit (bg-white text-gray-900) so this can never inherit an
// invisible-text bug from global/dark-mode CSS elsewhere in the project.
const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500";

export default function App() {
  const [data, setData] = useState<InvoiceData>(buildDefaultData);
  const [sealImage, setSealImage] = useState<string | null>("/seal.png");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<"pdf" | "share" | null>(null);

  // Full-size, unscaled, off-screen node — this is what actually gets captured for PDF/share.
  const captureRef = useRef<HTMLDivElement>(null);

  // On-screen scaled copy — purely visual, never used for export.
  const scaleWrapRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);

  const update = (key: keyof InvoiceData, value: string) =>
    setData((d) => ({ ...d, [key]: value }));

  // Assign the first auto invoice number once on mount.
  useEffect(() => {
    const code = BUSINESS_PROFILES[buildDefaultData().businessKey].code;
    setData((d) => ({
      ...d,
      invoiceNo: d.invoiceNo || getNextInvoiceNumber(code),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBusinessChange(key: string) {
    const profile = BUSINESS_PROFILES[key];
    if (!profile) return;
    setData((d) => ({
      ...d,
      businessKey: key,
      businessName: profile.businessName,
      businessTagline: profile.businessTagline,
      address1: profile.address1,
      address2: profile.address2,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      invoiceNo: getNextInvoiceNumber(profile.code),
    }));
  }

  function handleNewInvoiceNumber() {
    const code = BUSINESS_PROFILES[data.businessKey]?.code || "INV";
    update("invoiceNo", getNextInvoiceNumber(code));
  }

  // Measure the always-present, full-size capture node so the scaled
  // preview wrapper knows how tall to be.
  useEffect(() => {
    function recalc() {
      if (scaleWrapRef.current) {
        const w = scaleWrapRef.current.offsetWidth;
        setScale(Math.min(1, w / 700));
      }
      if (captureRef.current) {
        setContentHeight(captureRef.current.offsetHeight);
      }
    }
    recalc();
    window.addEventListener("resize", recalc);
    const ro = new ResizeObserver(recalc);
    if (captureRef.current) ro.observe(captureRef.current);
    return () => {
      window.removeEventListener("resize", recalc);
      ro.disconnect();
    };
  }, [data, sealImage, tab]);

  const nights = (() => {
    if (data.checkIn && data.checkOut) {
      const inD = new Date(data.checkIn);
      const outD = new Date(data.checkOut);
      const diff = Math.round(
        (outD.getTime() - inD.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diff > 0) return diff;
    }
    const parsed = parseFloat(data.qtyNights);
    return isNaN(parsed) ? 0 : parsed;
  })();

  const rate = parseFloat(data.rate) || 0;
  const discount = parseFloat(data.discountAmount) || 0;
  const subtotal = nights * rate;
  const total = Math.max(subtotal - discount, 0);
  const isCustomRoom = !ROOM_TYPES.includes(data.roomDescription);

  function handleSealUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSealImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function buildPdfBlob(): Promise<Blob> {
    const node = captureRef.current;
    if (!node) throw new Error("Invoice content not ready");

    const canvas = await html2canvas(node, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: 700,
    });

    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error("Captured canvas was empty");
    }

    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF({ unit: "px", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    } else {
      const scaleF = pageHeight / imgHeight;
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth * scaleF, pageHeight);
    }
    return pdf.output("blob");
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDownload() {
    try {
      setBusy("pdf");
      const blob = await buildPdfBlob();
      downloadBlob(blob, `Invoice-${data.invoiceNo || "draft"}.pdf`);
    } catch (e) {
      console.error("PDF generation failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Could not generate the PDF.\n\nDetails: ${msg}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleShareWhatsApp() {
    try {
      setBusy("share");
      const blob = await buildPdfBlob();
      const filename = `Invoice-${data.invoiceNo || "draft"}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });

      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData & { files?: File[] }) => boolean;
        share?: (data?: ShareData & { files?: File[] }) => Promise<void>;
      };

      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        await nav.share({
          files: [file],
          title: `Invoice ${data.invoiceNo}`,
          text: `Invoice ${data.invoiceNo} for ${data.guestName || "guest"}`,
        });
      } else {
        downloadBlob(blob, filename);
        const text = encodeURIComponent(
          `Invoice ${data.invoiceNo} (PDF downloaded — please attach it here).`,
        );
        window.open(`https://wa.me/?text=${text}`, "_blank");
      }
    } catch (e) {
      console.error("WhatsApp share failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Could not share the PDF.\n\nDetails: ${msg}`);
    } finally {
      setBusy(null);
    }
  }

  // ---------- Shared invoice markup (used for BOTH the on-screen scaled
  // preview and the off-screen full-size capture node) ----------
  function InvoiceBody() {
    return (
      <>
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <div className="text-2xl font-bold tracking-wide text-gray-900">
              {data.businessName}
            </div>
            <div className="text-[11px] tracking-[0.25em] text-amber-700 mt-1 border-t border-amber-600 pt-1 inline-block">
              {data.businessTagline}
            </div>
            <div className="text-xs text-gray-600 mt-4 leading-relaxed">
              <div>{data.address1}</div>
              <div className="pl-0">{data.address2}</div>
              <div className="mt-1">{data.phone}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold tracking-widest text-gray-900">
              INVOICE
            </div>
            <div className="w-16 h-[2px] bg-amber-600 ml-auto my-2" />
            <table className="text-xs mt-2">
              <tbody>
                <tr>
                  <td className="font-semibold text-gray-500 pr-4 py-0.5 text-right">
                    INVOICE NO.
                  </td>
                  <td className="py-0.5 text-gray-800">{data.invoiceNo}</td>
                </tr>
                <tr>
                  <td className="font-semibold text-gray-500 pr-4 py-0.5 text-right">
                    INVOICE DATE
                  </td>
                  <td className="py-0.5 text-gray-800">
                    {formatDate(data.invoiceDate)}
                  </td>
                </tr>
                <tr>
                  <td className="font-semibold text-gray-500 pr-4 py-0.5 text-right">
                    BOOKING SOURCE
                  </td>
                  <td className="py-0.5 text-gray-800">{data.bookingSource}</td>
                </tr>
                <tr>
                  <td className="font-semibold text-gray-500 pr-4 py-0.5 text-right">
                    INVOICE STATUS
                  </td>
                  <td className="py-0.5 font-bold text-green-600">
                    {data.invoiceStatus}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <hr className="my-5 border-gray-200" />

        {/* Guest / Stay details */}
        <div className="grid grid-cols-2 gap-8">
          <div>
            <div className="font-bold text-sm text-gray-900 mb-2">
              GUEST DETAILS
            </div>
            <table className="text-xs w-full">
              <tbody>
                <tr>
                  <td className="text-gray-500 py-1 w-1/2">Guest Name</td>
                  <td className="py-1 text-gray-800">
                    {data.guestTitle ? `${data.guestTitle} ` : ""}
                    {data.guestName || "—"}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 py-1">Total Guests</td>
                  <td className="py-1 text-gray-800">
                    {data.totalGuests || "—"}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 py-1">ID / Passport No.</td>
                  <td className="py-1 text-gray-800">
                    {data.idPassport || "—"}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 py-1">Contact</td>
                  <td className="py-1 text-gray-800">{data.contact || "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <div className="font-bold text-sm text-gray-900 mb-2">
              STAY DETAILS
            </div>
            <table className="text-xs w-full">
              <tbody>
                <tr>
                  <td className="text-gray-500 py-1 w-1/2">Check-in Date</td>
                  <td className="py-1 text-gray-800">
                    {formatDate(data.checkIn)}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 py-1">Check-out Date</td>
                  <td className="py-1 text-gray-800">
                    {formatDate(data.checkOut)}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 py-1">Length of Stay</td>
                  <td className="py-1 text-gray-800">
                    {nights} Night{nights === 1 ? "" : "s"}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 py-1">Total Units</td>
                  <td className="py-1 text-gray-800">
                    {data.totalUnits || "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Line items */}
        <div className="mt-6">
          <div className="bg-gray-100 grid grid-cols-[2fr_1fr_1fr_1fr] text-xs font-bold text-gray-700 px-3 py-2 rounded-t">
            <div>DESCRIPTION</div>
            <div className="text-center">QTY</div>
            <div className="text-center">RATE ({data.currency})</div>
            <div className="text-right">AMOUNT ({data.currency})</div>
          </div>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] text-xs px-3 py-3 border-b border-gray-100">
            <div>
              <div className="font-semibold text-gray-800">
                {data.roomDescription}
              </div>
              <div className="text-gray-500 text-[11px]">
                {data.checkIn && data.checkOut
                  ? `${formatDate(data.checkIn)} – ${formatDate(data.checkOut)}`
                  : ""}
              </div>
            </div>
            <div className="text-center text-gray-800">
              {nights} Night{nights === 1 ? "" : "s"}
            </div>
            <div className="text-center text-gray-800">{fmt(rate)}</div>
            <div className="text-right text-gray-800">{fmt(subtotal)}</div>
          </div>
          {discount > 0 && (
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] text-xs px-3 py-2 border-b border-gray-100 text-gray-600">
              <div>{data.discountLabel || "Discount"}</div>
              <div className="text-center">—</div>
              <div className="text-center">—</div>
              <div className="text-right">-{fmt(discount)}</div>
            </div>
          )}
        </div>

        {/* Total */}
        <div className="flex justify-between items-center mt-4">
          <div className="font-bold text-sm text-gray-900">
            TOTAL ({nights} NIGHT{nights === 1 ? "" : "S"})
          </div>
          <div className="font-bold text-xl text-gray-900">
            {data.currency} {fmt(total)}
          </div>
        </div>

        {/* Payment info + seal */}
        <div className="grid grid-cols-2 gap-8 mt-6 items-start relative">
          <div>
            <div className="font-bold text-sm text-gray-900 mb-2">
              PAYMENT INFORMATION
            </div>
            <table className="text-xs w-full">
              <tbody>
                <tr>
                  <td className="text-gray-500 py-1 w-1/2">Payment Method</td>
                  <td className="py-1 text-gray-800">
                    {data.paymentMethod || "—"}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 py-1">Payment Status</td>
                  <td className="py-1 font-bold text-green-600">
                    {data.paymentStatus || "—"}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 py-1">Transaction ID</td>
                  <td className="py-1 text-gray-800">
                    {data.transactionId || "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="border border-gray-200 rounded-xl p-4 relative overflow-visible">
            <div className="text-xs font-bold text-gray-700">TOTAL PAYABLE</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {data.currency} {fmt(total)}
            </div>
            {sealImage && (
              <img
                src={sealImage}
                alt="Company seal"
                style={{
                  position: "absolute",
                  width: 110,
                  height: 110,
                  objectFit: "contain",
                  right: -20,
                  bottom: -30,
                  transform: "rotate(-10deg)",
                  opacity: 0.9,
                  mixBlendMode: "multiply",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        </div>

        <hr className="my-6 border-gray-200" />

        <div className="text-center text-xs text-gray-600">
          <div className="font-bold text-gray-900 mb-1">
            Thank you for choosing {data.businessName}.
          </div>
          <div>We appreciate your visit. Welcome back anytime!</div>
        </div>

        <hr className="my-4 border-gray-200" />

        <div className="flex justify-center gap-6 text-[11px] text-gray-600">
          <span>{data.website}</span>
          <span>{data.email}</span>
          <span>{data.phone}</span>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-24">
      {/* Top tab bar */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-3 pt-3 pb-0">
        <h1 className="text-base font-bold text-gray-800 mb-2 px-1">
          Invoice Maker
        </h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setTab("edit")}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition ${
              tab === "edit" ? "bg-white shadow text-gray-900" : "text-gray-500"
            }`}
          >
            Edit
          </button>
          <button
            onClick={() => setTab("preview")}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition ${
              tab === "preview"
                ? "bg-white shadow text-gray-900"
                : "text-gray-500"
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-3 pt-4">
        {tab === "edit" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <Field label="Business">
              <select
                className={inputCls}
                value={data.businessKey}
                onChange={(e) => handleBusinessChange(e.target.value)}
              >
                {BUSINESS_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>

            <details className="mb-4">
              <summary className="cursor-pointer text-sm font-semibold text-amber-700 mb-2">
                Business info (edit details)
              </summary>
              <div className="mt-3">
                <Field label="Business name">
                  <input
                    className={inputCls}
                    value={data.businessName}
                    onChange={(e) => update("businessName", e.target.value)}
                  />
                </Field>
                <Field label="Tagline">
                  <input
                    className={inputCls}
                    value={data.businessTagline}
                    onChange={(e) => update("businessTagline", e.target.value)}
                  />
                </Field>
                <Field label="Address line 1">
                  <input
                    className={inputCls}
                    value={data.address1}
                    onChange={(e) => update("address1", e.target.value)}
                  />
                </Field>
                <Field label="Address line 2">
                  <input
                    className={inputCls}
                    value={data.address2}
                    onChange={(e) => update("address2", e.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={inputCls}
                    value={data.phone}
                    onChange={(e) => update("phone", e.target.value)}
                  />
                </Field>
                <Field label="Email">
                  <input
                    className={inputCls}
                    value={data.email}
                    onChange={(e) => update("email", e.target.value)}
                  />
                </Field>
                <Field label="Website">
                  <input
                    className={inputCls}
                    value={data.website}
                    onChange={(e) => update("website", e.target.value)}
                  />
                </Field>

                <Field label="Company Seal / Stamp">
                  <div className="flex items-center gap-3">
                    {sealImage ? (
                      <img
                        src={sealImage}
                        alt="Seal preview"
                        className="w-16 h-16 object-contain border border-gray-200 rounded-lg bg-white"
                      />
                    ) : (
                      <div className="w-16 h-16 border border-dashed border-gray-300 rounded-lg flex items-center justify-center text-[10px] text-gray-400 text-center">
                        No seal
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-amber-700 cursor-pointer">
                        {sealImage ? "Change image" : "Upload PNG"}
                        <input
                          type="file"
                          accept="image/png, image/jpeg"
                          className="hidden"
                          onChange={handleSealUpload}
                        />
                      </label>
                      {sealImage && (
                        <button
                          type="button"
                          className="text-xs text-red-500 text-left"
                          onClick={() => setSealImage(null)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </Field>
              </div>
            </details>

            <hr className="my-4" />

            <Field label="Invoice No. (auto-generated)">
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={data.invoiceNo}
                  onChange={(e) => update("invoiceNo", e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleNewInvoiceNumber}
                  className="shrink-0 rounded-lg border border-amber-600 text-amber-700 text-xs font-semibold px-3"
                  title="Generate next invoice number"
                >
                  New #
                </button>
              </div>
            </Field>
            <Field label="Invoice Date">
              <input
                type="date"
                className={inputCls}
                value={data.invoiceDate}
                onChange={(e) => update("invoiceDate", e.target.value)}
              />
            </Field>
            <Field label="Booking Source">
              <input
                className={inputCls}
                value={data.bookingSource}
                onChange={(e) => update("bookingSource", e.target.value)}
              />
            </Field>
            <Field label="Invoice Status">
              <select
                className={inputCls}
                value={data.invoiceStatus}
                onChange={(e) =>
                  update(
                    "invoiceStatus",
                    e.target.value as InvoiceData["invoiceStatus"],
                  )
                }
              >
                <option value="PAID">PAID</option>
                <option value="UNPAID">UNPAID</option>
                <option value="PARTIAL">PARTIAL</option>
              </select>
            </Field>

            <hr className="my-4" />

            {/* Guest title + name */}
            <Field label="Title">
              <select
                className={inputCls}
                value={data.guestTitle}
                onChange={(e) => update("guestTitle", e.target.value)}
              >
                {TITLES.map((t) => (
                  <option key={t} value={t === "(none)" ? "" : t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Guest Name">
              <input
                type="text"
                className={inputCls}
                value={data.guestName}
                onChange={(e) => update("guestName", e.target.value)}
                placeholder="John Doe"
                autoComplete="off"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Total Guests">
                <input
                  className={inputCls}
                  value={data.totalGuests}
                  onChange={(e) => update("totalGuests", e.target.value)}
                />
              </Field>
              <Field label="Total Units">
                <input
                  className={inputCls}
                  value={data.totalUnits}
                  onChange={(e) => update("totalUnits", e.target.value)}
                />
              </Field>
            </div>
            <Field label="ID / Passport No.">
              <input
                className={inputCls}
                value={data.idPassport}
                onChange={(e) => update("idPassport", e.target.value)}
              />
            </Field>
            <Field label="Contact">
              <input
                className={inputCls}
                value={data.contact}
                onChange={(e) => update("contact", e.target.value)}
              />
            </Field>

            <hr className="my-4" />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Check-in Date">
                <input
                  type="date"
                  className={inputCls}
                  value={data.checkIn}
                  onChange={(e) => update("checkIn", e.target.value)}
                />
              </Field>
              <Field label="Check-out Date">
                <input
                  type="date"
                  className={inputCls}
                  value={data.checkOut}
                  onChange={(e) => update("checkOut", e.target.value)}
                />
              </Field>
            </div>

            <hr className="my-4" />

            <Field label="Room Type">
              <select
                className={inputCls}
                value={isCustomRoom ? "custom" : data.roomDescription}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    update("roomDescription", "");
                  } else {
                    update("roomDescription", e.target.value);
                  }
                }}
              >
                {ROOM_TYPES.map((rt) => (
                  <option key={rt} value={rt}>
                    {rt}
                  </option>
                ))}
                <option value="custom">Custom / Other…</option>
              </select>
            </Field>
            {isCustomRoom && (
              <Field label="Custom Room Description">
                <input
                  className={inputCls}
                  value={data.roomDescription}
                  onChange={(e) => update("roomDescription", e.target.value)}
                  placeholder="Enter room description"
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nights (if no dates above)">
                <input
                  className={inputCls}
                  value={data.qtyNights}
                  onChange={(e) => update("qtyNights", e.target.value)}
                />
              </Field>
              <Field label={`Rate / night (${data.currency})`}>
                <input
                  className={inputCls}
                  value={data.rate}
                  onChange={(e) => update("rate", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Discount label">
                <input
                  className={inputCls}
                  value={data.discountLabel}
                  onChange={(e) => update("discountLabel", e.target.value)}
                  placeholder="e.g. Full payment discount"
                />
              </Field>
              <Field label={`Discount amount (${data.currency})`}>
                <input
                  className={inputCls}
                  value={data.discountAmount}
                  onChange={(e) => update("discountAmount", e.target.value)}
                />
              </Field>
            </div>

            <hr className="my-4" />

            <Field label="Payment Method">
              <select
                className={inputCls}
                value={data.paymentMethod}
                onChange={(e) => update("paymentMethod", e.target.value)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment Status">
              <select
                className={inputCls}
                value={data.paymentStatus}
                onChange={(e) => update("paymentStatus", e.target.value)}
              >
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Transaction ID">
              <input
                className={inputCls}
                value={data.transactionId}
                onChange={(e) => update("transactionId", e.target.value)}
              />
            </Field>

            <button
              onClick={() => setTab("preview")}
              className="w-full mt-2 rounded-lg bg-amber-600 text-white text-sm font-semibold py-2.5 hover:bg-amber-700"
            >
              Preview Invoice →
            </button>
          </div>
        )}

        {tab === "preview" && (
          <div>
            <div
              ref={scaleWrapRef}
              className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
            >
              <div
                style={{ height: contentHeight * scale, position: "relative" }}
              >
                <div
                  style={{
                    width: 700,
                    padding: 40,
                    fontFamily: "Georgia, 'Times New Roman', serif",
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    background: "#fff",
                  }}
                >
                  <InvoiceBody />
                </div>
              </div>
            </div>

            <button
              onClick={() => setTab("edit")}
              className="w-full mt-3 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold py-2.5"
            >
              ← Back to Edit
            </button>
          </div>
        )}
      </div>

      {/* Always-present, full-size, off-screen node used ONLY for PDF/share
          capture. Never scaled, never clipped, so html2canvas renders it
          correctly regardless of the viewport or which tab is active. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: "-10000px",
          width: 700,
        }}
        aria-hidden="true"
      >
        <div
          ref={captureRef}
          style={{
            width: 700,
            padding: 40,
            fontFamily: "Georgia, 'Times New Roman', serif",
            background: "#fff",
          }}
        >
          <InvoiceBody />
        </div>
      </div>

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 z-20">
        <div className="max-w-xl mx-auto flex gap-2">
          <button
            onClick={handleDownload}
            disabled={busy !== null}
            className="flex-1 rounded-lg bg-gray-900 text-white text-sm font-semibold py-3 disabled:opacity-50"
          >
            {busy === "pdf" ? "Generating…" : "Download PDF"}
          </button>
          <button
            onClick={handleShareWhatsApp}
            disabled={busy !== null}
            className="flex-1 rounded-lg bg-green-600 text-white text-sm font-semibold py-3 disabled:opacity-50"
          >
            {busy === "share" ? "Preparing…" : "Share WhatsApp"}
          </button>
        </div>
      </div>
    </div>
  );
}
