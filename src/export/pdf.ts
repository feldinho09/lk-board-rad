/** PDF-Erzeugung im Browser mit pdfmake (MIT) und eingebetteter Roboto-Schrift. Wird erst bei Bedarf geladen. */
export async function renderPdf(docDefinition: unknown): Promise<Uint8Array> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const pm = pdfMake as unknown as {
    addVirtualFileSystem(v: unknown): void;
    setUrlAccessPolicy?(cb: (url: string) => boolean): void;
    createPdf(d: unknown): { getBuffer(): Promise<Uint8Array> };
  };
  pm.addVirtualFileSystem(vfs);
  // Keine externen Abrufe (Bilder/Schriften per URL) – das PDF entsteht vollständig lokal
  pm.setUrlAccessPolicy?.(() => false);
  const buf = await pm.createPdf(docDefinition).getBuffer();
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer);
}
