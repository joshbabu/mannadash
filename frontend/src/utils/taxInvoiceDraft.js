/**
 * DRAFT tax-invoice generator.
 *
 * Matches the real 3-invoice structure Zomato/Eternal issues per order under Indian GST
 * law: a restaurant-service invoice, a platform-fee invoice, and a delivery-service
 * invoice — because the platform (not the restaurant) is the liable e-commerce operator
 * for GST on food orders once registered (CGST Act section 9(5)).
 *
 * Every field that would legally assert a real tax-registration number — GSTIN, PAN, CIN,
 * FSSAI, invoice number — renders as an explicit bracketed placeholder token, e.g.
 * "[RESTAURANT_GSTIN — pending registration]", never a plausible-looking fake number. A
 * document formatted like an official GST tax invoice makes a specific legal claim; a
 * "dummy" number that merely looks real is exactly the kind of thing that could get
 * copy-pasted, screenshotted, or handed to an accountant/auditor and mistaken for genuine.
 * Placeholders can't be mistaken that way. The DRAFT banner + the button that opens this
 * (see TrackOrderScreen) both say "preview" for the same reason — honest about status
 * even if a real customer taps it before real numbers are in.
 *
 * HSN/SAC codes below (996331 restaurant service, 999799 platform/other services, 996813
 * local delivery service) are real public GST classification codes, not registration
 * numbers — safe to include as accurate reference info, same spirit as the commonly-cited
 * rates already noted in gst-config.util.ts.
 *
 * To go fully live once MannaDash is actually GST-registered:
 *   1. Replace the PLATFORM_* placeholder constants below with the real values.
 *   2. Drop the DRAFT watermark and update the button label in TrackOrderScreen.
 *   3. Consider real per-restaurant GSTIN/FSSAI (order.restaurant.gstin /
 *      .fssaiNumber already exist on the entity) instead of the restaurant placeholders.
 */

// Replace these once real registration exists — see file header.
const PLATFORM_GSTIN = '[PLATFORM_GSTIN — pending registration]';
const PLATFORM_PAN = '[PLATFORM_PAN — pending]';
const PLATFORM_CIN = '[PLATFORM_CIN — pending]';
const PLATFORM_NAME = 'MANNADASH (PLACEHOLDER LEGAL ENTITY NAME)';
const PLATFORM_ADDRESS = '[Registered office address — pending]';

function numberToIndianWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return ones[n];
    return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`;
  }
  function threeDigits(n) {
    if (n < 100) return twoDigits(n);
    return `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${twoDigits(n % 100)}` : ''}`;
  }
  function wholeNumber(n) {
    if (n === 0) return 'Zero';
    let remaining = n;
    const parts = [];
    const crore = Math.floor(remaining / 10000000);
    remaining %= 10000000;
    const lakh = Math.floor(remaining / 100000);
    remaining %= 100000;
    const thousand = Math.floor(remaining / 1000);
    remaining %= 1000;
    if (crore) parts.push(`${threeDigits(crore)} Crore`);
    if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
    if (remaining) parts.push(threeDigits(remaining));
    return parts.join(' ');
  }

  const rupees = Math.floor(amount);
  const paisa = Math.round((amount - rupees) * 100);
  let words = `${wholeNumber(rupees)} Rupees`;
  if (paisa > 0) words += ` And ${wholeNumber(paisa)} Paisa`;
  return `${words} Only`;
}

function escapeHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(d) {
  return new Date(d).toISOString().slice(0, 10).split('-').reverse().join('/');
}

// Intra-state GST splits evenly into CGST + SGST (each half the total rate) — matches the
// reference invoices, which are all Telangana-to-Telangana. Inter-state IGST isn't modeled
// here since MannaDash currently only operates within one state.
function splitGst(amount) {
  const half = amount / 2;
  return { cgst: half, sgst: half };
}

function invoiceHeader(title) {
  return `
    <div class="draft-banner">DRAFT — placeholder registration numbers, NOT valid for tax filing</div>
    <div class="doc-header">
      <span class="wordmark">eternal-style</span>
      <span class="doc-title">${title}<br/><span class="doc-subtitle">ORIGINAL FOR RECIPIENT (DRAFT)</span></span>
    </div>`;
}

function restaurantInvoiceHtml(order) {
  const gst = splitGst(Number(order.restaurantGstAmount || 0));
  const gross = Number(order.subtotal || 0);
  return `
    <section class="invoice-page">
      ${invoiceHeader('Tax Invoice')}
      <p class="field-block">
        <strong>Tax Invoice on behalf of –</strong><br/>
        <strong>Legal Entity Name:</strong> [RESTAURANT_LEGAL_ENTITY_NAME — pending]<br/>
        <strong>Restaurant Name:</strong> ${escapeHtml(order.restaurant?.name)}<br/>
        <strong>Restaurant Address:</strong> ${escapeHtml(order.restaurant?.address)}<br/>
        <strong>Restaurant GSTIN:</strong> [RESTAURANT_GSTIN — pending registration]<br/>
        <strong>Restaurant FSSAI:</strong> [RESTAURANT_FSSAI — pending]<br/>
        <strong>Invoice No.:</strong> [INVOICE_NUMBER — pending numbering scheme]<br/>
        <strong>Invoice Date:</strong> ${formatDate(order.placedAt)}
      </p>
      <p class="field-block">
        <strong>Customer Name:</strong> ${escapeHtml(order.customer?.user?.name)}<br/>
        <strong>Delivery Address:</strong> ${escapeHtml(order.deliveryAddress)}<br/>
        <strong>State name and Place of Supply:</strong> Telangana (36)
      </p>
      <p class="field-block">
        <strong>HSN Code:</strong> 996331<br/>
        <strong>Service Description:</strong> Restaurant Service
      </p>
      <table>
        <thead><tr>
          <th>Particulars</th><th>Gross value</th><th>Discount</th><th>Net value</th>
          <th>CGST (Rate)</th><th>CGST (INR)</th><th>SGST (Rate)</th><th>SGST (INR)</th><th>Total</th>
        </tr></thead>
        <tbody>
          ${(order.items || []).map((i) => {
            const lineGross = Number(i.priceAtOrder) * i.quantity;
            const share = gross > 0 ? lineGross / gross : 0;
            const lineCgst = gst.cgst * share;
            const lineSgst = gst.sgst * share;
            return `<tr>
              <td>1 x ${escapeHtml(i.menuItem?.name)}</td>
              <td class="r">${lineGross.toFixed(2)}</td>
              <td class="r">0.00</td>
              <td class="r">${lineGross.toFixed(2)}</td>
              <td class="r">—</td>
              <td class="r">${lineCgst.toFixed(2)}</td>
              <td class="r">—</td>
              <td class="r">${lineSgst.toFixed(2)}</td>
              <td class="r">${(lineGross + lineCgst + lineSgst).toFixed(2)}</td>
            </tr>`;
          }).join('')}
          <tr class="totals-row">
            <td>Item(s) Total</td><td class="r">${gross.toFixed(2)}</td><td class="r">0.00</td><td class="r">${gross.toFixed(2)}</td>
            <td></td><td class="r">${gst.cgst.toFixed(2)}</td><td></td><td class="r">${gst.sgst.toFixed(2)}</td>
            <td class="r">${(gross + gst.cgst + gst.sgst).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <p><strong>Amount (in words):</strong> ${numberToIndianWords(gross + gst.cgst + gst.sgst)}</p>
      <p>Amount of INR ${(gross + gst.cgst + gst.sgst).toFixed(2)} settled digitally against Order ID ${escapeHtml(order.id.slice(0, 8))} dated ${formatDate(order.placedAt)}.</p>
      <p>Supply attracts reverse charge: No</p>
      ${platformSignatureBlock()}
    </section>`;
}

function platformFeeInvoiceHtml(order) {
  const amount = Number(order.platformFeeAmount || 0);
  // Platform fee itself isn't a tax (see gst-config.util.ts) — GST here would be GST *on*
  // that fee, which the reference invoice also computes at 9%+9% for illustration. Left
  // at 0 unless order.deliveryGstAmount-style tracking for platform fee GST exists.
  const gst = splitGst(amount * 0.09 * 2);
  const total = amount + gst.cgst + gst.sgst;
  return `
    <section class="invoice-page">
      ${invoiceHeader('Tax Invoice')}
      <p class="field-block">
        <strong>${PLATFORM_NAME}</strong><br/>
        <strong>Address:</strong> ${PLATFORM_ADDRESS}<br/>
        <strong>Invoice No:</strong> [INVOICE_NUMBER — pending numbering scheme]<br/>
        <strong>PAN:</strong> ${PLATFORM_PAN} &nbsp; <strong>CIN:</strong> ${PLATFORM_CIN} &nbsp; <strong>GSTIN:</strong> ${PLATFORM_GSTIN}<br/>
        <strong>Invoice Date:</strong> ${formatDate(order.placedAt)}
      </p>
      <p class="field-block">
        <strong>Customer Name:</strong> ${escapeHtml(order.customer?.user?.name)}<br/>
        <strong>Delivery Address:</strong> ${escapeHtml(order.deliveryAddress)}<br/>
        <strong>Place of Supply:</strong> Telangana (36)
      </p>
      <p class="field-block">
        <strong>HSN Code:</strong> 999799 &nbsp; <strong>Supply Description:</strong> Other Services N.E.C
      </p>
      <table>
        <thead><tr><th>Sr.No</th><th>Particulars</th><th>Taxable Amount</th><th>CGST</th><th>SGST</th><th>Total</th></tr></thead>
        <tbody>
          <tr>
            <td>1</td><td>Platform fee</td><td class="r">${amount.toFixed(2)}</td>
            <td class="r">${gst.cgst.toFixed(2)}</td><td class="r">${gst.sgst.toFixed(2)}</td><td class="r">${total.toFixed(2)}</td>
          </tr>
          <tr class="totals-row">
            <td colspan="2">Total</td><td class="r">${amount.toFixed(2)}</td>
            <td class="r">${gst.cgst.toFixed(2)}</td><td class="r">${gst.sgst.toFixed(2)}</td><td class="r">${total.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <p>Amount of ₹${total.toFixed(2)} settled through digital mode/payment received against Order id (${escapeHtml(order.id.slice(0, 8))}) dated (${formatDate(order.placedAt)})</p>
      <p>Tax is not payable on reverse charge basis</p>
      ${platformSignatureBlock()}
    </section>`;
}

function deliveryInvoiceHtml(order) {
  const gross = Number(order.deliveryFee || 0);
  const gst = splitGst(Number(order.deliveryGstAmount || 0));
  return `
    <section class="invoice-page">
      ${invoiceHeader('Tax Invoice')}
      <p class="field-block">
        <strong>Tax Invoice on behalf of –</strong><br/>
        <strong>Delivery Partner / Vendor Name:</strong> ${escapeHtml(order.deliveryPartner?.name) || '[DELIVERY_PARTNER_NAME — pending]'}<br/>
        <strong>Delivery Partner / Vendor State:</strong> Telangana<br/>
        <strong>Invoice No.:</strong> [INVOICE_NUMBER — pending numbering scheme]<br/>
        <strong>Invoice Date:</strong> ${formatDate(order.placedAt)}
      </p>
      <p class="field-block">
        <strong>Customer Name:</strong> ${escapeHtml(order.customer?.user?.name)}<br/>
        <strong>Delivery Address:</strong> ${escapeHtml(order.deliveryAddress)}<br/>
        <strong>State name and Place of Supply:</strong> Telangana (36)
      </p>
      <p class="field-block">
        <strong>HSN Code:</strong> 996813<br/>
        <strong>Service Description:</strong> Local delivery service
      </p>
      <table>
        <thead><tr>
          <th>Particulars</th><th>Gross value</th><th>Discount</th><th>Net value</th>
          <th>CGST (Rate)</th><th>CGST (INR)</th><th>SGST (Rate)</th><th>SGST (INR)</th><th>Total</th>
        </tr></thead>
        <tbody>
          <tr>
            <td>Fee for delivery services</td>
            <td class="r">${gross.toFixed(2)}</td><td class="r">0.00</td><td class="r">${gross.toFixed(2)}</td>
            <td class="r">—</td><td class="r">${gst.cgst.toFixed(2)}</td><td class="r">—</td><td class="r">${gst.sgst.toFixed(2)}</td>
            <td class="r">${(gross + gst.cgst + gst.sgst).toFixed(2)}</td>
          </tr>
          <tr class="totals-row">
            <td>Total Value</td><td class="r">${gross.toFixed(2)}</td><td class="r">0.00</td><td class="r">${gross.toFixed(2)}</td>
            <td></td><td class="r">${gst.cgst.toFixed(2)}</td><td></td><td class="r">${gst.sgst.toFixed(2)}</td>
            <td class="r">${(gross + gst.cgst + gst.sgst).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <p><strong>Amount (in words):</strong> ${numberToIndianWords(gross + gst.cgst + gst.sgst)}</p>
      <p>Amount of INR ${(gross + gst.cgst + gst.sgst).toFixed(2)} settled through digital mode/payment received against Order Id: ${escapeHtml(order.id.slice(0, 8))} dated ${formatDate(order.placedAt)}.</p>
      <p>Supply attracts reverse charge: No</p>
      ${platformSignatureBlock()}
    </section>`;
}

function platformSignatureBlock() {
  return `
    <div class="signature-block">
      <p><strong>For ${PLATFORM_NAME}</strong></p>
      <p>PAN: ${PLATFORM_PAN}<br/>CIN: ${PLATFORM_CIN}<br/>GST: ${PLATFORM_GSTIN}</p>
      <p class="signatory">[Authorised Signatory — pending]</p>
    </div>`;
}

const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1a1a1a; margin: 0; }
  .invoice-page { padding: 28px 32px; page-break-after: always; }
  .invoice-page:last-child { page-break-after: auto; }
  .draft-banner { background: #fff3cd; color: #7a5200; border: 1px solid #f0c36d; padding: 8px 12px; font-weight: 700; text-align: center; margin-bottom: 16px; font-size: 12px; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .wordmark { font-size: 22px; font-weight: 800; }
  .doc-title { text-align: right; font-weight: 700; }
  .doc-subtitle { font-weight: 400; font-size: 11px; color: #555; }
  .field-block { margin: 0 0 12px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; }
  th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; }
  th { background: #eee; }
  .r { text-align: right; }
  .totals-row td { font-weight: 700; }
  .signature-block { margin-top: 40px; font-size: 11px; }
  .signatory { margin-top: 30px; }
  @media print { .draft-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

/**
 * Opens a print-preview window with all three DRAFT tax invoices for one order.
 */
export function generateTaxInvoiceDraft(order) {
  const w = window.open('', '_blank', 'width=680,height=800');
  if (!w) return; // popup blocked
  w.document.write(`<!doctype html><html><head><title>DRAFT tax invoices — order #${escapeHtml(order.id.slice(0, 8))}</title>
    <style>${STYLES}</style></head><body>
    ${restaurantInvoiceHtml(order)}
    ${platformFeeInvoiceHtml(order)}
    ${deliveryInvoiceHtml(order)}
  </body></html>`);
  w.document.close();
}
