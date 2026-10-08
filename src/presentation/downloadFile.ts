/** Saves generated content through the browser's download flow. */
export function downloadFile(
  filename: string,
  type: string,
  content: string | Uint8Array,
): void {
  const blobContent = typeof content === 'string' ? content : Uint8Array.from(content);
  const url = URL.createObjectURL(new Blob([blobContent], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
