/* Long Distance EV Routing on the classic endpoint, returned in the SDK's
   Route shape — the fallback for API keys that have the classic Routing
   API but not the Orbis routing the SDK's calculateRoute calls
   (`/maps/orbis/routing/calculateLongDistanceEVRoute`, which answers 403
   on those keys).

   Same car, same physics, different wire format:
     consumption     speedsToConsumptionsKWH → "speed,kWh:speed,kWh" query
     battery curve   power per charge level → a charging curve (cumulative
                     seconds to each charge level) per charging mode
     reserve         minChargeAt… query parameters, unchanged
   The answer is reshaped into what RoutingModule.showRoutes and the scene
   read: a LineString Feature whose properties carry summary, per-leg
   sections (with chargingInformationAtEndOfLeg as a Point Feature), toll,
   traffic and country sections. Nothing is invented on the way — fields
   the classic answer doesn't have are left out. */

const PLUG = 'Combo_to_IEC_62196_Type_2_Base';
const MAGNITUDE = ['unknown', 'minor', 'moderate', 'major', 'indefinite'];

/* Cumulative seconds to reach each 10% of the battery, reading the power
   points the way TomTom reads a batteryCurve (a point's power holds from
   its charge level up to the next point), capped at the charger's power.
   The classic API wants the last point at maxChargeInkWh. */
function chargingCurve(batteryCurve, maxKWh, capKw) {
  const powerAt = (kwh) => {
    let p = batteryCurve[0].maxPowerInkW;
    for (const pt of batteryCurve) if (kwh >= pt.stateOfChargeInkWh) p = pt.maxPowerInkW;
    return Math.min(p, capKw);
  };
  const out = [];
  let t = 0;
  const steps = 1000;
  for (let i = 1; i <= steps; i++) {
    const kwh = maxKWh * (i - 0.5) / steps;
    t += (maxKWh / steps) / powerAt(kwh) * 3600;
    if (i % (steps / 10) === 0) out.push({ chargeInkWh: Math.round(maxKWh * i / steps * 100) / 100, timeToChargeInSeconds: Math.round(t) });
  }
  out[out.length - 1].chargeInkWh = maxKWh;
  return out;
}

const toDate = v => (v ? new Date(v) : undefined);
const withDates = s => ({ ...s, departureTime: toDate(s.departureTime), arrivalTime: toDate(s.arrivalTime) });

/* The classic chargingInformationAtEndOfLeg → the SDK's Point Feature. */
function stopFeature(info) {
  const loc = info.chargingParkLocation || {};
  const c = loc.coordinate;
  if (!c) return undefined;
  const conn = info.chargingConnectionInfo || {};
  const address = [loc.street?.trim(), [loc.postalCode, loc.city].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
    properties: {
      ...info,
      chargingParkId: info.chargingParkUuid,
      address: address ? { freeformAddress: address } : undefined,
      chargingConnectionInfo: {
        plugType: conn.chargingPlugType,
        chargingPowerInkW: conn.chargingPowerInkW,
        currentType: conn.chargingCurrentType === 'Direct_Current' ? 'DC' : conn.chargingCurrentType,
        voltageInV: conn.chargingVoltageInV,
        currentInA: conn.chargingCurrentInA,
      },
    },
  };
}

let seq = 0;
const newId = () => `classic-${Date.now().toString(36)}-${(seq++).toString(36)}`;


/* The classic endpoint names a country section's country in ISO 3166
   alpha-3 only; the SDK labels border crossings with alpha-2
   ("NL → DE"), so without this they read "undefined → undefined". */
const ISO3_TO_2 = Object.fromEntries((
  'ABWAW AFGAF AGOAO AIAAI ALAAX ALBAL ANDAD AREAE ARGAR ARMAM ASMAS ATAAQ ATFTF ATGAG AUSAU AUTAT AZEAZ '
  + 'BDIBI BELBE BENBJ BESBQ BFABF BGDBD BGRBG BHRBH BHSBS BIHBA BLMBL BLRBY BLZBZ BMUBM BOLBO BRABR BRBBB '
  + 'BRNBN BTNBT BVTBV BWABW CAFCF CANCA CCKCC CHECH CHLCL CHNCN CIVCI CMRCM CODCD COGCG COKCK COLCO COMKM '
  + 'CPVCV CRICR CUBCU CUWCW CXRCX CYMKY CYPCY CZECZ DEUDE DJIDJ DMADM DNKDK DOMDO DZADZ ECUEC EGYEG ERIER '
  + 'ESHEH ESPES ESTEE ETHET FINFI FJIFJ FLKFK FRAFR FROFO FSMFM GABGA GBRGB GEOGE GGYGG GHAGH GIBGI GINGN '
  + 'GLPGP GMBGM GNBGW GNQGQ GRCGR GRDGD GRLGL GTMGT GUFGF GUMGU GUYGY HKGHK HMDHM HNDHN HRVHR HTIHT HUNHU '
  + 'IDNID IMNIM INDIN IOTIO IRLIE IRNIR IRQIQ ISLIS ISRIL ITAIT JAMJM JEYJE JORJO JPNJP KAZKZ KENKE KGZKG '
  + 'KHMKH KIRKI KNAKN KORKR KWTKW LAOLA LBNLB LBRLR LBYLY LCALC LIELI LKALK LSOLS LTULT LUXLU LVALV MACMO '
  + 'MAFMF MARMA MCOMC MDAMD MDGMG MDVMV MEXMX MHLMH MKDMK MLIML MLTMT MMRMM MNEME MNGMN MNPMP MOZMZ MRTMR '
  + 'MSRMS MTQMQ MUSMU MWIMW MYSMY MYTYT NAMNA NCLNC NERNE NFKNF NGANG NICNI NIUNU NLDNL NORNO NPLNP NRUNR '
  + 'NZLNZ OMNOM PAKPK PANPA PCNPN PERPE PHLPH PLWPW PNGPG POLPL PRIPR PRKKP PRTPT PRYPY PSEPS PYFPF QATQA '
  + 'REURE ROURO RUSRU RWARW SAUSA SDNSD SENSN SGPSG SGSGS SHNSH SJMSJ SLBSB SLESL SLVSV SMRSM SOMSO SPMPM '
  + 'SRBRS SSDSS STPST SURSR SVKSK SVNSI SWESE SWZSZ SXMSX SYCSC SYRSY TCATC TCDTD TGOTG THATH TJKTJ TKLTK '
  + 'TKMTM TLSTL TONTO TTOTT TUNTN TURTR TUVTV TWNTW TZATZ UGAUG UKRUA UMIUM URYUY USAUS UZBUZ VATVA VCTVC '
  + 'VENVE VGBVG VIRVI VNMVN VUTVU WLFWF WSMWS XKXXK YEMYE ZAFZA ZMBZM ZWEZW'
).split(' ').map(p => [p.slice(0, 3), p.slice(3)]));
const iso2 = code => ISO3_TO_2[code] ?? code ?? '';

export async function classicEvRoutes({ apiBase, apiKey, origin, dest, consumption, batteryCurve, maxKWh, dcPeak, weight, startKWh, reserveKWh }) {
  const url = new URL(`${apiBase}/routing/1/calculateLongDistanceEVRoute/${origin[1]},${origin[0]}:${dest[1]},${dest[0]}/json`);
  const q = url.searchParams;
  q.set('key', apiKey);
  q.set('vehicleEngineType', 'electric');
  q.set('traffic', 'true');
  q.set('constantSpeedConsumptionInkWhPerHundredkm', consumption.map(c => `${c.speedKMH},${c.consumptionUnitsPer100KM}`).join(':'));
  q.set('maxChargeInkWh', String(maxKWh));
  q.set('currentChargeInkWh', String(Math.round(startKWh * 100) / 100));
  q.set('minChargeAtDestinationInkWh', String(reserveKWh));
  q.set('minChargeAtChargingStopsInkWh', String(reserveKWh));
  if (weight) q.set('vehicleWeight', String(weight));
  for (const t of ['tollRoad', 'traffic', 'country']) q.append('sectionType', t);

  // A 50 kW post caps the car at 50; faster posts are capped by the car.
  const chargingModes = [{
    chargingConnections: [{ facilityType: 'Charge_Direct_Current_at_50kW', plugType: PLUG }],
    chargingCurve: chargingCurve(batteryCurve, maxKWh, Math.min(50, dcPeak)),
  }];
  if (dcPeak > 50) chargingModes.push({
    chargingConnections: [{ facilityType: 'Charge_Direct_Current_above_50kW', plugType: PLUG }],
    chargingCurve: chargingCurve(batteryCurve, maxKWh, dcPeak),
  });

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chargingModes }) });
  if (!res.ok) {
    const err = new Error(`TomTom API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const raw = (await res.json()).routes?.[0];
  if (!raw) throw new Error('Long Distance EV Routing returned no route');

  // Legs, with their point ranges on the concatenated line.
  const coords = [];
  const legs = raw.legs.map((leg) => {
    const start = coords.length;
    for (const p of leg.points) coords.push([p.longitude, p.latitude]);
    const { chargingInformationAtEndOfLeg: info, ...summary } = leg.summary;
    return {
      id: newId(),
      startPointIndex: start,
      endPointIndex: coords.length - 1,
      summary: { ...withDates(summary), ...(info ? { chargingInformationAtEndOfLeg: stopFeature(info) } : {}) },
    };
  });

  const byType = t => (raw.sections || []).filter(s => s.sectionType === t);
  const span = s => ({ id: newId(), startPointIndex: s.startPointIndex, endPointIndex: s.endPointIndex });
  const toll = byType('TOLL_ROAD').map(span);
  const sections = {
    leg: legs,
    toll,
    tollRoad: toll,
    country: byType('COUNTRY').map(s => ({ ...span(s), countryCodeISO2: iso2(s.countryCode), countryCodeISO3: s.countryCode })),
    traffic: byType('TRAFFIC').map(s => ({
      ...span(s),
      delayInSeconds: s.delayInSeconds,
      effectiveSpeedInKmh: s.effectiveSpeedInKmh,
      magnitudeOfDelay: MAGNITUDE[s.magnitudeOfDelay] ?? 'unknown',
      categories: s.simpleCategory ? [String(s.simpleCategory).toLowerCase()] : [],
      tec: s.tec,
    })),
  };

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  const summary = withDates(raw.summary);
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: newId(),
      bbox: [minLng, minLat, maxLng, maxLat],
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        index: 0,
        summary,
        sections,
        progress: [
          { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
          { pointIndex: coords.length - 1, distanceInMeters: summary.lengthInMeters, travelTimeInSeconds: summary.travelTimeInSeconds },
        ],
      },
    }],
  };
}
