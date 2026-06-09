/**
 * Geo — Routen-/Kilometer-Berechnung (Leaflet-frei, headless)
 *
 * Geocoding via Nominatim, Routing via OSRM. Tolerant gegen nicht gefundene
 * Adressen (diese werden uebersprungen, km aus den gefundenen Punkten).
 * Wird sowohl vom Tagesabschluss (headless) als auch optional von der
 * Fahrten-Routenberechnung genutzt.
 */
const Geo = {
  _geocodeCache: {},

  async _geocode(addr) {
    if (this._geocodeCache[addr]) return this._geocodeCache[addr];
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`,
        { headers: { 'Accept': 'application/json' } }
      );
      const results = await res.json();
      if (results && results.length > 0) {
        const c = [parseFloat(results[0].lon), parseFloat(results[0].lat)];
        this._geocodeCache[addr] = c;
        return c;
      }
    } catch (e) {
      console.warn('Geocode-Fehler:', addr, e);
    }
    return null;
  },

  /**
   * Tour-Kilometer berechnen: Start -> Ziele -> (Rueckfahrt zum Start).
   * @param {string} startAdresse
   * @param {string[]} zielAdressen
   * @returns {Promise<{km:number, legs:Array<{von:string,nach:string,km:number}>, fehlend:string[]}|null>}
   *          null wenn weniger als 2 Wegpunkte zustande kommen.
   */
  async tourKm(startAdresse, zielAdressen) {
    const adressen = [startAdresse, ...((zielAdressen || []).filter(Boolean))];
    // Rueckfahrt anhaengen, wenn das letzte Ziel nicht schon der Start ist
    const letztes = (adressen[adressen.length - 1] || '').toLowerCase().trim();
    if (letztes !== (startAdresse || '').toLowerCase().trim()) {
      adressen.push(startAdresse);
    }
    if (adressen.length < 2) return null;

    const coords = [];
    const coordAdr = [];
    const fehlend = [];
    for (const addr of adressen) {
      if (this._geocodeCache[addr]) {
        coords.push(this._geocodeCache[addr]);
        coordAdr.push(addr);
        continue;
      }
      await new Promise(r => setTimeout(r, 1100)); // Nominatim Rate-Limit (1 req/s)
      const c = await this._geocode(addr);
      if (c) { coords.push(c); coordAdr.push(addr); }
      else { fehlend.push(addr); }
    }

    if (coords.length < 2) return { km: 0, legs: [], fehlend };

    const coordStr = coords.map(c => c.join(',')).join(';');
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false`
      );
      const data = await res.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const km = Math.round(route.distance / 1000 * 10) / 10;
        const legs = (route.legs || []).map((leg, i) => ({
          von: (coordAdr[i] || '').split(',')[0].trim(),
          nach: (coordAdr[i + 1] || '').split(',')[0].trim(),
          km: Math.round(leg.distance / 1000 * 10) / 10
        }));
        return { km, legs, fehlend };
      }
    } catch (e) {
      console.warn('OSRM-Fehler:', e);
    }
    return { km: 0, legs: [], fehlend };
  }
};
