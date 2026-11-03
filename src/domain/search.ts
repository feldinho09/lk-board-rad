import { db, alive } from '../db/db';
import type { Participation, Rider } from './types';
import { normalize } from './text';

export interface SearchHit {
  rider: Rider;
  participation?: Participation;
  reason: 'startnummer' | 'name_im_rennen' | 'name';
}

/**
 * Suche: exakte Startnummer im aktiven Rennen hat Vorrang, dann Namen im Rennen,
 * dann globale Fahrer (Präfix über indexierte, akzentfreie Suchschlüssel und Aliasnamen).
 */
export async function search(query: string, editionId: string | null, limit = 20): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const nq = normalize(q);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => {
    if (seen.has(h.rider.id) || h.rider.deleted) return;
    seen.add(h.rider.id);
    hits.push(h);
  };

  if (editionId) {
    const parts = alive(await db.participations.where('editionId').equals(editionId).toArray());
    const exact = parts.filter((p) => p.bib === q || (/^\d+$/.test(q) && p.bib.replace(/^0+/, '') === q.replace(/^0+/, '') && q.replace(/^0+/, '') !== ''));
    const riders = new Map((await db.riders.bulkGet(parts.map((p) => p.riderId))).filter(Boolean).map((r) => [r!.id, r!]));
    for (const p of exact) { const r = riders.get(p.riderId); if (r) push({ rider: r, participation: p, reason: 'startnummer' }); }
    if (nq) {
      for (const p of parts) {
        const r = riders.get(p.riderId);
        if (r && r.searchTokens.some((t) => t.startsWith(nq))) push({ rider: r, participation: p, reason: 'name_im_rennen' });
      }
    }
  }
  if (nq && hits.length < limit) {
    const firstToken = nq.split(' ')[0];
    const global = await db.riders.where('searchTokens').startsWith(firstToken).limit(limit * 3).toArray();
    const aliasHits = await db.riders.where('aliases').startsWithIgnoreCase(q).limit(limit).toArray();
    for (const r of [...global, ...aliasHits]) {
      if (r.mergedInto) continue;
      if (!nq.includes(' ') || r.searchTokens.some((t) => t.startsWith(nq)) || normalize(r.displayName).includes(nq)) push({ rider: r, reason: 'name' });
      if (hits.length >= limit) break;
    }
  }
  return hits.slice(0, limit);
}
