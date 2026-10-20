/**
 * Export the current canvas view as a PNG.
 */
export function exportCanvasAsPng(canvas: HTMLCanvasElement, filename: string): void {
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename.replace(/\.json$/i, '') + '.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('Failed to export canvas as PNG:', err);
    throw err;
  }
}
