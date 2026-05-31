/**
 * /api/places — Proxy para Google Places API
 * Env: GOOGLE_PLACES_API_KEY
 */

export const config = { maxDuration: 30 };

const BASE = 'https://maps.googleapis.com/maps/api/place';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!KEY) {
    return res.status(500).json({
      error: 'GOOGLE_PLACES_API_KEY não configurada na Vercel.',
      hint: 'Vá em Settings → Environment Variables e adicione GOOGLE_PLACES_API_KEY'
    });
  }

  const action    = req.query.action    || '';
  const query     = req.query.query     || '';
  const place_id  = req.query.place_id  || '';
  const location  = req.query.location  || '';
  const radius    = req.query.radius    || '1000';
  const keyword   = req.query.keyword   || '';
  const ref       = req.query.ref       || '';
  const maxwidth  = req.query.maxwidth  || '800';
  const url       = req.query.url       || '';

  try {
    if (action === 'search') {
      if (!query) return res.status(400).json({ error: 'query obrigatório' });
      return res.status(200).json(await gFetch(`${BASE}/textsearch/json?query=${encodeURIComponent(query)}&language=pt-BR&key=${KEY}`));
    }

    if (action === 'details') {
      if (!place_id) return res.status(400).json({ error: 'place_id obrigatório' });
      const fields = ['place_id','name','formatted_address','formatted_phone_number','website','rating','user_ratings_total','types','business_status','opening_hours','photos','reviews','geometry','url','editorial_summary','delivery','dine_in','takeout','serves_beer','wheelchair_accessible_entrance','reservable','serves_breakfast','serves_lunch','serves_dinner'].join(',');
      return res.status(200).json(await gFetch(`${BASE}/details/json?place_id=${encodeURIComponent(place_id)}&fields=${fields}&language=pt-BR&key=${KEY}`));
    }

    if (action === 'nearby') {
      if (!location || !keyword) return res.status(400).json({ error: 'location e keyword obrigatórios' });
      return res.status(200).json(await gFetch(`${BASE}/nearbysearch/json?location=${location}&radius=${radius}&keyword=${encodeURIComponent(keyword)}&language=pt-BR&key=${KEY}`));
    }

    if (action === 'photo') {
      if (!ref) return res.status(400).json({ error: 'ref obrigatório' });
      const photoResp = await fetch(`${BASE}/photo?maxwidth=${maxwidth}&photoreference=${ref}&key=${KEY}`);
      res.setHeader('Content-Type', photoResp.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(Buffer.from(await photoResp.arrayBuffer()));
    }

    if (action === 'resolve_url') {
      if (!url) return res.status(400).json({ error: 'url obrigatório' });

      const m1 = url.match(/place_id[=:]([A-Za-z0-9_-]{10,})/);
      if (m1) return res.status(200).json({ place_id: m1[1] });

      const m2 = url.match(/maps\/place\/([^/@?&]+)/);
      if (m2 && !/^[A-Za-z0-9]{20,}$/.test(m2[1])) {
        const name = decodeURIComponent(m2[1].replace(/\+/g,' '));
        return res.status(200).json(await gFetch(`${BASE}/textsearch/json?query=${encodeURIComponent(name)}&language=pt-BR&key=${KEY}`));
      }

      let current = url;
      for (let i = 0; i < 6; i++) {
        let resp;
        try {
          resp = await fetch(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } });
        } catch (e) { break; }

        const loc = resp.headers.get('location');
        if (loc) current = loc.startsWith('http') ? loc : new URL(loc, current).href;
        else current = resp.url || current;

        const pid = current.match(/place_id[=:]([A-Za-z0-9_-]{10,})/);
        if (pid) return res.status(200).json({ place_id: pid[1] });

        const nm = current.match(/maps\/place\/([^/@?&]+)/);
        if (nm && !/^[A-Za-z0-9]{20,}$/.test(nm[1])) {
          const name = decodeURIComponent(nm[1].replace(/\+/g,' '));
          return res.status(200).json(await gFetch(`${BASE}/textsearch/json?query=${encodeURIComponent(name)}&language=pt-BR&key=${KEY}`));
        }

        const cid = current.match(/[?&]cid=(\d+)/);
        if (cid) {
          const fp = await gFetch(`${BASE}/findplacefromtext/json?input=cid:${cid[1]}&inputtype=textquery&fields=place_id&key=${KEY}`);
          if (fp.candidates?.[0]) return res.status(200).json({ place_id: fp.candidates[0].place_id });
        }

        const qp = current.match(/[?&]q=([^&]+)/);
        if (qp) {
          const q = decodeURIComponent(qp[1].replace(/\+/g,' '));
          return res.status(200).json(await gFetch(`${BASE}/textsearch/json?query=${encodeURIComponent(q)}&language=pt-BR&key=${KEY}`));
        }

        if (!loc) break;
      }

      const coord = current.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (coord) {
        return res.status(200).json(await gFetch(`${BASE}/nearbysearch/json?location=${coord[1]},${coord[2]}&radius=50&rankby=distance&key=${KEY}`));
      }

      return res.status(200).json({ error: 'Não foi possível resolver este link.' });
    }

    return res.status(400).json({ error: `Ação desconhecida: "${action}"` });

  } catch (err) {
    console.error('[api/places] ERRO:', err.message);
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}

async function gFetch(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google API HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status && !['OK','ZERO_RESULTS'].includes(data.status)) {
    throw new Error(`Google Places: ${data.status} — ${data.error_message || ''}`);
  }
  return data;
}
