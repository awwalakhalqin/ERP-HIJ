import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/*
 * Documents are laid out as A4 pages in the DOM and rasterised one page per
 * sheet. JPEG at high quality keeps a full-colour letterhead page around 1 MB;
 * the same page as PNG runs to tens of megabytes because the letterhead art is
 * photographic rather than flat line work.
 */
const RENDER_SCALE = 2; // ~192 dpi on A4
const JPEG_QUALITY = 0.94;

export const sanitizeColorsForCanvas = (clonedDoc: Document) => {
  const styleTags = clonedDoc.querySelectorAll('style');
  styleTags.forEach((styleTag) => {
    if (styleTag.textContent && (styleTag.textContent.includes('oklch') || styleTag.textContent.includes('oklab'))) {
      styleTag.textContent = styleTag.textContent
        .replace(/oklch\([^)]+\)/gi, '#13707f')
        .replace(/oklab\([^)]+\)/gi, '#13707f');
    }
  });

  const canvas = clonedDoc.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');

  const colorProperties = [
    'color',
    'background-color',
    'border-color',
    'border-top-color',
    'border-bottom-color',
    'border-left-color',
    'border-right-color'
  ];

  const elements = clonedDoc.querySelectorAll('*');
  elements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    try {
      const style = window.getComputedStyle(htmlEl);
      for (const prop of colorProperties) {
        const val = style.getPropertyValue(prop);
        if (val && (val.includes('oklch') || val.includes('oklab') || val.includes('color('))) {
          if (ctx) {
            ctx.fillStyle = '#000000';
            ctx.fillStyle = val;
            htmlEl.style.setProperty(prop, ctx.fillStyle, 'important');
          } else {
            htmlEl.style.setProperty(prop, prop.includes('background') ? '#ffffff' : '#000000', 'important');
          }
        }
      }
    } catch (e) {}
  });
};

async function renderPage(element: HTMLElement): Promise<string> {
  const canvas = await html2canvas(element, {
    scale: RENDER_SCALE,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    onclone: (clonedDoc) => sanitizeColorsForCanvas(clonedDoc)
  });
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function requireElement(elementId: string): HTMLElement {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`Elemen dokumen ${elementId} tidak ditemukan`);
  }
  return element;
}

/** Export one or more A4 page elements as a single PDF, one element per sheet. */
export async function exportPagesToPdf(elementIds: string[], fileName: string) {
  const elements = elementIds.map(requireElement);
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < elements.length; i++) {
    const imgData = await renderPage(elements[i]);
    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
  }

  pdf.save(`${fileName}.pdf`);
}

/**
 * Export a single element. A4-shaped documents map onto one sheet; anything
 * taller is sliced across as many sheets as it needs instead of being cropped.
 */
export async function exportElementToPdf(elementId: string, fileName: string) {
  const element = requireElement(elementId);

  const canvas = await html2canvas(element, {
    scale: RENDER_SCALE,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    onclone: (clonedDoc) => sanitizeColorsForCanvas(clonedDoc)
  });

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const scaledHeight = (canvas.height * pageWidth) / canvas.width;

  // Fits a sheet (within a millimetre): draw it as one page.
  if (scaledHeight <= pageHeight + 1) {
    pdf.addImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, pageWidth, scaledHeight, undefined, 'FAST');
    pdf.save(`${fileName}.pdf`);
    return;
  }

  // Taller than a sheet: cut the canvas into page-height slices.
  const sliceHeightPx = Math.floor((pageHeight * canvas.width) / pageWidth);
  const sliceCanvas = document.createElement('canvas');
  sliceCanvas.width = canvas.width;
  const sliceCtx = sliceCanvas.getContext('2d');

  let offset = 0;
  let page = 0;
  while (offset < canvas.height) {
    const currentHeight = Math.min(sliceHeightPx, canvas.height - offset);
    sliceCanvas.height = currentHeight;
    if (sliceCtx) {
      sliceCtx.fillStyle = '#ffffff';
      sliceCtx.fillRect(0, 0, sliceCanvas.width, currentHeight);
      sliceCtx.drawImage(canvas, 0, offset, canvas.width, currentHeight, 0, 0, canvas.width, currentHeight);
    }
    if (page > 0) pdf.addPage();
    pdf.addImage(
      sliceCanvas.toDataURL('image/jpeg', JPEG_QUALITY),
      'JPEG',
      0,
      0,
      pageWidth,
      (currentHeight * pageWidth) / canvas.width,
      undefined,
      'FAST'
    );
    offset += currentHeight;
    page += 1;
  }

  pdf.save(`${fileName}.pdf`);
}

/** Kept for the SPK, which is always two pages. */
export async function exportTwoPageSPK(page1Id: string, page2Id: string, spkNumber: string) {
  await exportPagesToPdf([page1Id, page2Id], `SPK_${spkNumber}`);
}
