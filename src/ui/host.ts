/**
 * Laufzeitumgebung: eigenes HTTPS-Hosting (voller Offline-Vertrag mit Service Worker)
 * oder Claude-Artefakt (Sandbox: kein Service Worker, keine direkten Downloads,
 * kein confirm/prompt/print). Wird beim Build festgelegt: `vite build --mode artifact`.
 */
export const IS_ARTIFACT = import.meta.env.MODE === 'artifact';

interface DownloadsNs {
  save(req: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }): Promise<{ status: string }>;
}
type ClaudeHost = { use(name: string): Promise<unknown> };

let downloadsPromise: Promise<DownloadsNs | null> | null = null;
function downloadsNs(): Promise<DownloadsNs | null> {
  const c = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!c?.use) return Promise.resolve(null);
  downloadsPromise ??= c.use('downloads').then((d) => (d as DownloadsNs) ?? null).catch(() => null);
  return downloadsPromise;
}

export type SaveOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Datei an den Nutzer übergeben. Im Artefakt über die Download-Fähigkeit der
 * Plattform (der Nutzer bestätigt), sonst über einen normalen Browser-Download.
 */
export async function saveFile(data: Uint8Array | string, filename: string, mime: string): Promise<SaveOutcome> {
  if (IS_ARTIFACT) {
    // window.claude wird von der Plattform evtl. erst nach dem Start bereitgestellt
    for (let i = 0; i < 20 && !(window as unknown as { claude?: unknown }).claude; i++) await new Promise((r) => setTimeout(r, 100));
    const ns = await downloadsNs();
    if (!ns) return { ok: false, reason: 'Downloads sind in dieser Ansicht nicht verfügbar. Bitte das Artefakt direkt auf claude.ai öffnen.' };
    try {
      const payload = typeof data === 'string' ? data : new Blob([data as BlobPart], { type: mime });
      await ns.save({ filename, data: payload });
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return { ok: false, reason: 'Download abgelehnt.' };
      if (code === 'rate_limited') return { ok: false, reason: 'Es ist bereits eine Download-Abfrage offen. Bitte kurz warten.' };
      return { ok: false, reason: `Download nicht möglich (${code ?? String(e)}).` };
    }
  }
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { ok: true };
}
