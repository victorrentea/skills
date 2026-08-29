/**
 * Reading a document's *content*.
 *
 * Every field on an invoice except its amounts — issue date, client, line items,
 * the currency — exists ONLY inside the PDF. No SmartBill endpoint returns them,
 * and /invoice/paymentstatus explicitly refuses to say which currency its numbers
 * are in. So "read invoice S324" means: fetch the PDF, pull its text layer.
 */
import { extractText, getDocumentProxy } from 'unpdf';

export async function pdfText(bytes: Buffer): Promise<{ text: string; pages: number }> {
  // pdf.js warns about every embedded font it cannot substitute and about a
  // Math.sumPrecise it expects from a newer V8. Both are harmless and both go to
  // stderr, where they would drown the actual output.
  const warn = console.warn;
  console.warn = () => {};
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const { text, totalPages } = await extractText(doc, { mergePages: true });
    return { text: Array.isArray(text) ? text.join('\n') : text, pages: totalPages };
  } finally {
    console.warn = warn;
  }
}

export interface Summary {
  date?: string; total?: string; currency?: string; party?: string;
  lines: string[]; storno?: string; dueDate?: string;
}

/**
 * SmartBill renders two different templates and the parser must handle both:
 * a Romanian one for domestic clients ("Data emiterii", "TOTAL PLATA", "Furnizor
 * Client") and an English one for foreign/EUR/USD invoices ("Issue date",
 * "Total value", "Vendor Customer"). Matching only the first silently returns
 * blanks for every foreign invoice.
 */
export function summarize(raw: string): Summary {
  const t = raw.replace(/\s+/g, ' ');
  const grab = (re: RegExp) => re.exec(t)?.[1]?.trim();

  const total = grab(/(?:TOTAL PLATA|Total value)\s*(-?[\d\s.,]+\s*(?:Lei|EUR|USD|RON))/i);

  return {
    date: grab(/(?:Data emiterii|Issue date):\s*([\d/.]+)/),
    dueDate: grab(/(?:Termen plata|Payment term):\s*([\d/.]+)/),
    total,
    currency: total?.match(/(Lei|RON|EUR|USD)/i)?.[1],
    // The counterparty is the name printed right after the two-column header,
    // before its own CIF/VAT line.
    party: grab(/(?:Furnizor Client|Vendor Customer)\s+(.{0,70}?)\s+(?:CIF|VAT CODE):/),
    // Line items sit between the unit-price header and the totals block.
    lines: [...t.matchAll(/(?:^|\s)(\d{1,2})\s+((?:(?!Intocmit de|Made by|Exchange rate|Total)[^\n]){10,160}?)\s+(?:buc|ora|training|sesiune|1)\s/gi)]
      .map(m => m[2].trim())
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 20),
    storno: grab(/Storno factura (seria [A-Z]+ nr\.? *\d+[^.]*)/i),
  };
}
