/**
 * Export a path as a printable PDF.
 *
 * On the desktop the document is handed to the shell, which prints it with
 * Chromium's own PDF writer. In a browser there is no such thing, so the
 * report is opened in a new window and the browser's print dialog is offered
 * instead — which will save a PDF if that is what the person wants.
 */
import type { SimulationDoc } from '../../core/types';
import { getActivePacks } from '../../core/packs';
import { buildPdfReport, pdfReportFileName } from '../../core/pdfReport';

/** What happened. */
export type PdfExportResult =
  /** A PDF file was written. */
  | 'saved'
  /** A browser opened the report and offered to print it. */
  | 'printed'
  /** The person closed the file dialog without choosing anything. */
  | 'cancelled'
  /** The report could not be produced. */
  | 'failed';

/** What to tell the person, and how to tell it. */
export function pdfExportMessage(result: PdfExportResult): {
  text: string;
  tone: 'info' | 'error' | 'success';
} {
  switch (result) {
    case 'saved':
      return { text: 'Path report saved as a PDF', tone: 'success' };
    case 'printed':
      return {
        text: 'Report opened — use your browser to save it as a PDF',
        tone: 'info',
      };
    case 'cancelled':
      return { text: 'PDF export cancelled', tone: 'info' };
    default:
      return { text: 'Could not build the PDF report', tone: 'error' };
  }
}

export async function exportPathAsPdf(
  doc: SimulationDoc,
  nodeId: string
): Promise<PdfExportResult> {
  let html: string;
  let defaultName: string;
  try {
    html = buildPdfReport(doc, nodeId, getActivePacks());
    defaultName = pdfReportFileName(doc, nodeId);
  } catch (err) {
    console.error('Failed to build the path report:', err);
    return 'failed';
  }

  const bridge = window.whatifs;
  if (bridge?.exportPdf) {
    try {
      const saved = await bridge.exportPdf({ html, defaultName });
      return saved ? 'saved' : 'cancelled';
    } catch (err) {
      console.error('Failed to print the path report:', err);
      return 'failed';
    }
  }

  // Browser fallback: open the report and let the browser print it.
  try {
    const win = window.open('', '_blank');
    if (!win) return 'failed';
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    // Give the browser a moment to lay the document out before the dialog.
    win.setTimeout(() => win.print(), 300);
    return 'printed';
  } catch (err) {
    console.error('Failed to open the path report:', err);
    return 'failed';
  }
}
