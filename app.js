(() => {
  "use strict";

  // ════════════════════════════════════════════════════════════════════════
  // CONFIG
  // ════════════════════════════════════════════════════════════════════════
  const CONFIG = {
    graph: {
      clientId:    "c4143c1e-33ea-4c4d-a410-58110f966d0a",
      tenantId:    "3643e7ab-d166-4e27-bd5f-c5bbfcd282d7",
      authority:   "https://login.microsoftonline.com/3643e7ab-d166-4e27-bd5f-c5bbfcd282d7",
      redirectUri: "https://markusbaechler.github.io/bbzTailormade/",
      scopes:      ["User.Read", "Sites.ReadWrite.All"]
    },
    sp: {
      hostname: "bbzsg.sharepoint.com",
      sitePath: "/sites/CRM"
    },
    lists: {
      projekte:     "ProjekteTM",
      einsaetze:    "EinsaetzeTM",
      konzeption:   "KonzeptionTM",
      abrechnungen: "AbrechnungenTM",
      firms:        "CRMFirms",
      contacts:     "CRMContacts",
      history:      "CRMHistory",
      tasks:        "CRMTasks"
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // SP FIELD NAMES
  // Lesen: Graph API hängt nochmals "LookupId" an Lookup-Felder an.
  // Schreiben: Feldname exakt wie in SP angelegt.
  // Alle Lookup-Felder enden auf "LookupId" (kleines d) — einheitlich.
  // ════════════════════════════════════════════════════════════════════════
  const F = {
    // ProjekteTM — Lesen
    firma_r:           "FirmaLookupIdLookupId",
    ansprechpartner_r: "AnsprechpartnerLookupIdLookupId",
    // ProjekteTM — Schreiben
    firma_w:           "FirmaLookupId",
    ansprechpartner_w: "AnsprechpartnerLookupId",

    // EinsaetzeTM — Lesen
    // PersonLookupId0 weil SP den internen Namen wegen Konflikt mit "0" versehen hat
    projekt_r:         "ProjektLookupIdLookupId",
    person_r:          "PersonLookupId0LookupId",
    coPerson_r:        "CoPersonLookupIdLookupId",
    // EinsaetzeTM — Schreiben
    projekt_w:         "ProjektLookupId",
    person_w:          "PersonLookupId0",
    coPerson_w:        "CoPersonLookupId",

    // KonzeptionTM — Lesen (PersonLookupId OHNE "0")
    konz_projekt_r:    "ProjektLookupIdLookupId",
    konz_person_r:     "PersonLookupIdLookupId",
    // KonzeptionTM — Schreiben
    konz_projekt_w:    "ProjektLookupId",
    konz_person_w:     "PersonLookupId",

    // AbrechnungenTM — Lesen
    abr_projekt_r:     "ProjektLookupIdLookupId",
    // AbrechnungenTM — Schreiben
    abr_projekt_w:     "ProjektLookupId",

    // EinsaetzeTM / KonzeptionTM → AbrechnungenTM — Lesen
    abrechnung_r:      "AbrechnungLookupID0LookupId",
    // Schreiben — SP interner Name: AbrechnungLookupID0 (SP fügte 0-Suffix wegen Namenskonflikt an)
    abrechnung_w:      "AbrechnungLookupID0",

    // KonzeptionTM → AbrechnungenTM (interner SP-Name ohne Suffix — kleines d)
    konz_abrechnung_r: "AbrechnungLookupIdLookupId",
    konz_abrechnung_w: "AbrechnungLookupId"
  };

  // ════════════════════════════════════════════════════════════════════════
  // DEBUG — window.debug gibt vollständigen App-State zurück
  // ════════════════════════════════════════════════════════════════════════
  const debug = {
    lastApiCall: null,
    lastError:   null,
    log(label, data) {
      console.log(`[TM] ${label}`, data);
      this.lastApiCall = { label, data, ts: new Date().toISOString() };
    },
    err(label, error) {
      console.error(`[TM ERROR] ${label}`, error);
      this.lastError = { label, message: error?.message, ts: new Date().toISOString() };
    },
    inspect() {
      return {
        route:    state.filters.route,
        projekt:  state.selection.projektId,
        projekte: state.enriched.projekte.map(p => ({ id: p.id, title: p.title, firmaId: p.firmaLookupId, firmaName: p.firmaName })),
        einsaetze: state.enriched.einsaetze.length,
        lastApi:  this.lastApiCall,
        lastErr:  this.lastError
      };
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════════════
  const state = {
    auth: {
      msal:    null,
      account: null,
      token:   null,
      isAuth:  false
    },
    meta: {
      siteId: null
    },
    data: {
      projekte:     [],
      einsaetze:    [],
      konzeption:   [],
      abrechnungen: [],
      firms:        [],
      contacts:     [],
      history:      [],
      tasks:        []
    },
    choices: {
      // Dynamisch aus SP geladen via getChoices() — nie hier hardcodieren.
      // Leere Arrays bis loadChoices() gelaufen ist.
      projektStatus:      [],
      einsatzAbrechnung:  [],
      einsatzStatus:      [],
      konzVerrechenbar:   [],
      konzAbrechnung:     [],
      abrStatus:          []   // AbrechnungenTM.Status
    },
    enriched: {
      projekte:     [],
      einsaetze:    [],
      konzeption:   [],
      abrechnungen: []
    },
    filters: {
      route:        "projekte",
      projekte:     { search: "", status: "aktiv" },
      einsaetze:    { search: "", abrechnung: "", einsatzStatus: "", jahr: "", projekt: "", firma: "", person: "" },
      konzeption:   { search: "", verrechenbar: "", person: "", projekt: "", firma: "", jahr: "", abrechnung: "" },
      abrechnungen: { search: "", status: "", projekt: "", firma: "", jahr: "" },
      firmen:       { search: "", klassifizierung: "", vip: "", anzeigen: "" },
      projektDetail: { jahr: "", person: "", einsatzStatus: "", abrechnung: "", konzJahr: "", konzKat: "", konzVerr: "", konzAbr: "" },
      activeTab:    {}
    },
    selection: { projektId: null, firmaId: null },
    ui: { einsatzFilterOpen: false, einsatzSort: { col: "datum", dir: "desc" }, selectedProjektEinsatzId: null, selectedProjektKonzId: null, pdMobDetail: false, pdKpiOpen: false, selectedEinsatzId: null, selectedKonzId: null, selectedAbrId: null, selectedFirmaId: null, sbOpen: {}, eiMobFilter: false, kzMobFilter: false, abrMobFilter: false, fiMobFilter: false, eiCols: { ort: true, person: true, status: true, abrechnung: true }, kzCols: { person: true, katdauer: true, verrechenbar: true, abrechnung: true }, eiGroupBy: null, kzGroupBy: null, fiSort: { col: "name", dir: "asc" } },
    form: null   // aktives Formular-State (verhindert Router-Überschreiben)
  };

  // ════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════════════
  const h = {
    esc(v) {
      return String(v ?? "")
        .replaceAll("&","&amp;").replaceAll("<","&lt;")
        .replaceAll(">","&gt;").replaceAll('"',"&quot;");
    },
    num(v)  { const n = parseFloat(v); return isNaN(n) ? null : n; },
    bool(v) {
      if (typeof v === "boolean") return v;
      if (typeof v === "number")  return v === 1;
      if (typeof v === "string")  return ["true","1","ja","yes"].includes(v.trim().toLowerCase());
      return false;
    },
    toDate(v) {
      if (!v) return null;
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
      if (m) { const [y,mo,d] = m[1].split("-").map(Number); return new Date(y, mo-1, d); }
      const d = new Date(v); return isNaN(d.getTime()) ? null : d;
    },
    fmtDate(v) {
      const d = h.toDate(v);
      return d ? d.toLocaleDateString("de-CH", {day:"2-digit",month:"2-digit",year:"numeric"}) : "";
    },
    toDateInput(v) {
      const d = h.toDate(v);
      if (!d) return "";
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    },
    todayStart() { const d = new Date(); d.setHours(0,0,0,0); return d; },
    chf(v) {
      const n = h.num(v);
      return n === null ? "—" : n.toLocaleString("de-CH", {minimumFractionDigits:2,maximumFractionDigits:2});
    },
    inc(a, b) { return String(a||"").toLowerCase().includes(String(b||"").toLowerCase()); },

    // Debounce: verhindert dass render() bei jedem Tastendruck feuert
    _debounceTimers: {},
    debounce(key, fn, delay = 220) {
      clearTimeout(h._debounceTimers[key]);
      h._debounceTimers[key] = setTimeout(fn, delay);
    },
    searchInput(filterPath, value) {
      const parts = filterPath.split(".");
      let obj = state.filters;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      const selStart = document.activeElement?.selectionStart;
      const selEnd   = document.activeElement?.selectionEnd;
      h.debounce("search-" + filterPath, () => {
        ctrl.render();
        const el = document.querySelector(`[data-search-key="${filterPath}"]`);
        if (el) {
          el.focus();
          try { el.setSelectionRange(selStart, selEnd); } catch {}
        }
      });
    },

    // Lookup aus raw SP-Item lesen
    // SP/Graph gibt Lookup-Felder inkonsistent zurück:
    // - manchmal mit doppeltem Suffix: FirmaLookupIdLookupId
    // - manchmal nur einfach: FirmaLookupId
    // - manchmal als Objekt: { LookupId: 203, LookupValue: "..." }
    // Wir prüfen alle Varianten.
    rdLookup(raw, readField) {
      // Direkt mit dem gegebenen Feldnamen (z.B. FirmaLookupIdLookupId)
      let val = raw[readField];
      // Einfaches Suffix (z.B. FirmaLookupId)
      if (val == null) val = raw[readField.replace(/LookupIdLookupId$/, 'LookupId')];
      // Mit grossem ID (z.B. FirmaLookupID)  
      if (val == null) val = raw[readField.replace(/LookupIdLookupId$/, 'ID')];
      // Als Objekt mit LookupId-Property
      if (val != null && typeof val === 'object') val = val.LookupId ?? val.lookupId;
      return Number(val) || null;
    },

    firmName(id) {
      const f = state.data.firms.find(f => f.id === id);
      return f ? f.title : (id ? `Firma #${id}` : "—");
    },
    contactName(id) {
      const c = state.data.contacts.find(c => c.id === id);
      if (!c) return id ? `Person #${id}` : "—";
      return [c.vorname, c.nachname].filter(Boolean).join(" ") || "—";
    },

    // Typeahead
    typeaheadHtml(name, items, selectedId, placeholder="Suchen…") {
      const sid = String(selectedId || "");
      const sel = items.find(i => String(i.id) === sid);
      return `<div class="tm-typeahead" data-name="${h.esc(name)}">
        <input type="hidden" name="${h.esc(name)}" value="${h.esc(sid)}" class="tm-ta-val">
        <input type="text" class="tm-typeahead-input" placeholder="${h.esc(placeholder)}"
          value="${h.esc(sel?.label||"")}" autocomplete="off"
          oninput="h.taFilter(this)" onfocus="this.select();h.taOpen(this)"
          onblur="setTimeout(()=>h.taClose(this),200)">
        <div class="tm-typeahead-dropdown" style="display:none">
          ${items.map(i=>`<div class="tm-typeahead-item" data-id="${h.esc(i.id)}"
            onmousedown="event.preventDefault();h.taSelect(this)">${h.esc(i.label)}</div>`).join("")}
        </div>
      </div>`;
    },
    taOpen(inp) {
      const dd = inp.closest(".tm-typeahead").querySelector(".tm-typeahead-dropdown");
      // Alle Items anzeigen (nicht filtern beim Öffnen) — ermöglicht einfaches Austauschen
      dd.querySelectorAll(".tm-typeahead-item").forEach(it => it.style.display = "block");
      dd.style.display = "block";
    },
    taClose(inp) {
      const w = inp.closest(".tm-typeahead");
      w.querySelector(".tm-typeahead-dropdown").style.display="none";
      if (!w.querySelector(".tm-ta-val").value) inp.value="";
    },
    taFilter(inp) {
      const dd = inp.closest(".tm-typeahead").querySelector(".tm-typeahead-dropdown");
      const q = inp.value.toLowerCase(); let vis = 0;
      dd.querySelectorAll(".tm-typeahead-item").forEach(it => {
        const m = it.textContent.toLowerCase().includes(q);
        it.style.display = m ? "block" : "none";
        if (m) vis++;
      });
      dd.style.display = vis ? "block" : "none";
    },
    taSelect(item) {
      const w = item.closest(".tm-typeahead");
      w.querySelector(".tm-ta-val").value           = item.dataset.id;
      w.querySelector(".tm-typeahead-input").value  = item.textContent.trim();
      w.querySelector(".tm-typeahead-dropdown").style.display = "none";
      const name = w.dataset.name;
      if (name === "ansprechpartnerLookupId") ctrl.onApSelected(item.dataset.id);
      // Lead Pill aktualisieren
      if (name === "personLookupId") {
        const personName = item.textContent.trim();
        const initials = n => n.split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        const av = document.getElementById("ef-lead-av");
        const nm = document.getElementById("ef-lead-name");
        const pill = document.getElementById("ef-lead-pill");
        const ta = document.getElementById("ef-lead-ta");
        if (av) av.textContent = initials(personName);
        if (nm) nm.textContent = personName;
        if (pill) pill.style.display = "inline-flex";
        if (ta) ta.style.display = "none";
      }
      // Co-Lead Pill aktualisieren
      if (name === "coPersonLookupId_ta") {
        const coName = item.textContent.trim();
        const initials = n => n.split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        const av = document.getElementById("ef-co-av");
        const nm = document.getElementById("ef-co-name");
        const pill = document.getElementById("ef-co-pill");
        const ta = document.getElementById("ef-co-ta");
        const coVal = document.getElementById("coperson-val");
        if (av) av.textContent = initials(coName);
        if (nm) nm.textContent = coName;
        if (pill) pill.style.display = "inline-flex";
        if (ta) ta.style.display = "none";
        if (coVal) coVal.value = item.dataset.id;
        ctrl.updateCoBetrag();
      }
      // Konzeption-Person Pill aktualisieren
      if (name === "personLookupId" && document.getElementById("kf-person-pill")) {
        const pName = item.textContent.trim();
        const initials = n => n.split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        const av   = document.getElementById("kf-person-av");
        const nm   = document.getElementById("kf-person-name");
        const pill = document.getElementById("kf-person-pill");
        const ta   = document.getElementById("kf-person-ta");
        if (av)   av.textContent = initials(pName);
        if (nm)   nm.textContent = pName;
        if (pill) pill.style.display = "inline-flex";
        if (ta)   ta.style.display = "none";
      }
    },
    einsatzStatus(e) {
      const s = String(e.status||"").toLowerCase();
      if (s.includes("kostenfolge")) return "abgesagt-chf";
      if (s === "abgesagt") return "abgesagt";
      const d = h.toDate(e.datum);
      return (d && d > h.todayStart()) ? "geplant" : "durchgefuehrt";
    },

    // Badges
    badge(cls, label) { return `<span class="${cls}">${h.esc(label)}</span>`; },
    statusBadge(e) {
      const s = h.einsatzStatus(e);
      const m = {
        "geplant":       ["tm-badge tm-badge-planned",  "Geplant"],
        "durchgefuehrt": ["tm-badge tm-badge-done",     "Durchgeführt"],
        "abgesagt":      ["tm-badge tm-badge-cancelled","Abgesagt"],
        "abgesagt-chf":  ["tm-badge tm-badge-cancelled","Abgesagt (CHF)"]
      };
      const [c,l] = m[s] || ["tm-badge", s];
      return h.badge(c, l);
    },
    abrBadge(v) {
      const m = {
        "offen":          ["tm-badge tm-badge-open",   "offen"],
        "zur Abrechnung": ["tm-badge tm-badge-billing","zur Abrechnung"],
        "abgerechnet":    ["tm-badge tm-badge-billed", "abgerechnet"],
        "keine Verrechnung":        ["tm-badge tm-badge-incl","—"],
        "Inklusive (ohne Verrechnung)": ["tm-badge tm-badge-incl","—"]
      };
      const [c,l] = m[v] || ["tm-badge tm-badge-open", "offen"];
      return h.badge(c, l);
    },
    verrBadge(v) {
      const m = {
        "Inklusive":      ["tm-badge tm-badge-incl",   "Inklusive"],
        "Klärung nötig":  ["tm-badge tm-badge-clarify","Klärung nötig"],
        "zur Abrechnung": ["tm-badge tm-badge-billing","zur Abrechnung"],
        "abgerechnet":    ["tm-badge tm-badge-billed", "abgerechnet"]
      };
      const [c,l] = m[v] || ["tm-badge", v||"—"];
      return h.badge(c, l);
    },
    projStatusBadge(v) {
      const m = {
        "geplant":       ["tm-badge tm-badge-planned-p","geplant"],
        "aktiv":         ["tm-badge tm-badge-active",   "aktiv"],
        "abgeschlossen": ["tm-badge tm-badge-done-p",  "abgeschlossen"]
      };
      const [c,l] = m[v] || ["tm-badge", v||"—"];
      return h.badge(c, l);
    },

    // Kategorien aus Projekt-Ansätzen
    kategorien(p) {
      if (!p) return [];
      const k = [];
      if (p.ansatzEinsatz)   { k.push("Einsatz (Tag)"); k.push("Einsatz (Halbtag)"); }
      if (p.ansatzStunde)    k.push("Stunde");
      if (p.ansatzStueck)    k.push("Stück");
      if (p.ansatzPauschale) k.push("Pauschale");
      return k;
    },

    berechneBetrag(p, kat, tage, std, stk) {
      if (!p) return null;
      switch (kat) {
        case "Einsatz (Tag)":     return p.ansatzEinsatz ? p.ansatzEinsatz * (tage || 1) : null;
        case "Einsatz (Halbtag)": return p.ansatzHalbtag || null;
        case "Stunde":            return (p.ansatzStunde || 0) * (std || 0) || null;
        case "Stück":             return (p.ansatzStueck || 0) * (stk || 0) || null;
        case "Pauschale":         return p.ansatzPauschale || null;
        default: return null;
      }
    },

    // Co-Betrag aus Projektsettings
    berechneCoBetrag(p, kat, tage) {
      if (!p) return null;
      if (kat === "Einsatz (Tag)")     return p.ansatzCoEinsatz ? p.ansatzCoEinsatz * (tage || 1) : null;
      if (kat === "Einsatz (Halbtag)") return p.ansatzCoHalbtag || null;
      return null;
    },

    // Leeres aeSelected-Objekt erzeugen
    newAeSelected() {
      return { einsaetze: new Set(), konzeption: new Set(), zusatzBetrag: "", zusatzBem: "" };
    },

    // Eingeloggten User als Kontakt finden
    defaultPerson() {
      const name = (state.auth.account?.name || "").toLowerCase();
      if (!name) return null;
      return state.data.contacts.find(c => {
        const full = [c.vorname, c.nachname].filter(Boolean).join(" ").toLowerCase();
        return full === name || [c.nachname, c.vorname].filter(Boolean).join(", ").toLowerCase() === name;
      }) || null;
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // ENRICH — raw SP-Items in App-Objekte umwandeln
  // ════════════════════════════════════════════════════════════════════════
  function enrichProjekt(raw) {
    const p = {
      id:                      Number(raw.id),
      title:                   raw.Title || "",
      projektNr:               raw.ProjektNr || "",
      kontoNr:                 raw.KontoNr || "",
      firmaLookupId:           h.rdLookup(raw, F.firma_r),
      ansprechpartnerLookupId: h.rdLookup(raw, F.ansprechpartner_r),
      status:                  raw.Status || "",
      kmZumKunden:             h.num(raw.KmZumKunden),
      archiviert:              h.bool(raw.Archiviert),
      ansatzEinsatz:           h.num(raw.AnsatzEinsatz),
      ansatzHalbtag:           h.num(raw.AnsatzHalbtag),
      ansatzCoEinsatz:         h.num(raw.AnsatzCoEinsatz),
      ansatzCoHalbtag:         h.num(raw.AnsatzCoHalbtag),
      ansatzStunde:            h.num(raw.AnsatzStunde),
      ansatzStueck:            h.num(raw.AnsatzStueck),
      ansatzPauschale:         h.num(raw.AnsatzPauschale),
      ansatzKonzeption:        h.num(raw.AnsatzKonzeption),
      ansatzAdmin:             h.num(raw.AnsatzAdmin),
      ansatzKmSpesen:          h.num(raw.AnsatzKmSpesen),
      spesenKontoNr:           raw.SpesenKontoNr || "",
      konzeptionsrahmenTage:   h.num(raw.KonzeptionsrahmenTage),
      bemerkungen:             raw.Bemerkungen || ""
    };
    p.firmaName       = h.firmName(p.firmaLookupId);
    p.ansprechpartner = h.contactName(p.ansprechpartnerLookupId);
    // Verweise auf enriched — werden nach enrichAll korrekt gesetzt
    // Temporär aus raw für Totals (enrichAll setzt p.einsaetze nachträglich)
    const rawEinsaetze   = state.data.einsaetze.filter(e => h.rdLookup(e, F.projekt_r) === p.id);
    const rawKonzeintraege = state.data.konzeption.filter(k => h.rdLookup(k, F.konz_projekt_r) === p.id);
    // Totals aus raw berechnen (Feldnamen gross, SP-raw)
    p.totalEinsaetze  = rawEinsaetze
      .filter(e => { const s = h.einsatzStatus(e); return s !== "abgesagt"; })
      .reduce((s,e) => {
        const lead = h.num(e.BetragFinal) ?? h.num(e.BetragBerechnet) ?? 0;
        const co   = h.num(e.CoBetragFinal) ?? h.num(e.CoBetragBerechnet) ?? 0;
        return s + lead + co;
      }, 0);
    p.totalKonzeption = rawKonzeintraege
      .filter(k => k.Verrechenbar === "verrechenbar")
      .reduce((s,k) => s + (h.num(k.BetragFinal) ?? h.num(k.BetragBerechnet) ?? 0), 0);
    p.totalBetrag     = p.totalEinsaetze + p.totalKonzeption;
    p.einsaetzeCount  = rawEinsaetze.length;
    p.konzStunden     = rawKonzeintraege.reduce((s,k) => s + (h.num(k.AufwandStunden) || 0), 0);
    p.konzBudgetH     = p.konzeptionsrahmenTage ? p.konzeptionsrahmenTage * 8 : null;
    return p;
  }

  function enrichEinsatz(raw) {
    const e = {
      id:              Number(raw.id),
      title:           raw.Title || "",
      datum:           raw.Datum,
      projektLookupId: h.rdLookup(raw, F.projekt_r),
      ort:             raw.Ort || "",
      personLookupId:  h.rdLookup(raw, F.person_r),
      coPersonLookupId:h.rdLookup(raw, F.coPerson_r),
      bemerkungen:     raw.Bemerkungen || "",
      kategorie:       raw.Kategorie || "",
      dauerTage:       h.num(raw.DauerTage),
      dauerStunden:    h.num(raw.DauerStunden),
      anzahlStueck:    h.num(raw.AnzahlStueck),
      betragBerechnet:   h.num(raw.BetragBerechnet),
      betragFinal:       h.num(raw.BetragFinal),
      coBetragBerechnet: h.num(raw.CoBetragBerechnet),
      coBetragFinal:     h.num(raw.CoBetragFinal),
      spesenZusatz:    h.num(raw.SpesenZusatz),
      spesenBerechnet: h.num(raw.SpesenBerechnet),
      spesenFinal:     h.num(raw.SpesenFinal),
      status:          raw.Status || "",
      abrechnung:      raw.Abrechnung || "offen",
      abrechnungLookupId: h.rdLookup(raw, F.abrechnung_r)
    };
    e.datumFmt      = h.fmtDate(e.datum);
    e.einsatzStatus = h.einsatzStatus(e);
    e.anzeigeBetrag = h.num(e.betragFinal) ?? h.num(e.betragBerechnet);  // Lead only
    e.coAnzeigeBetrag = h.num(e.coBetragFinal) ?? h.num(e.coBetragBerechnet);
    e.totalBetrag   = (e.anzeigeBetrag || 0) + (e.coAnzeigeBetrag || 0); // Lead + Co kombiniert
    e.projektTitle  = state.data.projekte.find(p => Number(p.id) === e.projektLookupId)?.Title || "";
    e.personName    = h.contactName(e.personLookupId);
    e.coPersonName  = h.contactName(e.coPersonLookupId);
    return e;
  }

  function enrichKonzeption(raw) {
    const k = {
      id:              Number(raw.id),
      title:           raw.Title || "",
      datum:           raw.Datum,
      projektLookupId: h.rdLookup(raw, F.konz_projekt_r),
      kategorie:       raw.Kategorie || "",
      personLookupId:  h.rdLookup(raw, F.konz_person_r),
      aufwandStunden:  h.num(raw.AufwandStunden),
      betragBerechnet:   h.num(raw.BetragBerechnet),
      betragFinal:       h.num(raw.BetragFinal),
      coBetragBerechnet: h.num(raw.CoBetragBerechnet),
      coBetragFinal:     h.num(raw.CoBetragFinal),
      verrechenbar:    raw.Verrechenbar || "",
      abrechnung:      raw.Abrechnung || "offen",
      abrechnungLookupId: h.rdLookup(raw, F.konz_abrechnung_r),
      bemerkungen:     raw.Bemerkungen || ""
    };
    k.datumFmt      = h.fmtDate(k.datum);
    k.anzeigeBetrag = h.num(k.betragFinal) ?? h.num(k.betragBerechnet);
    k.personName    = h.contactName(k.personLookupId);
    k.projektTitle  = state.data.projekte.find(p => Number(p.id) === k.projektLookupId)?.Title || "";
    return k;
  }

  function enrichAbrechnung(raw) {
    const a = {
      id:                  Number(raw.id),
      title:               raw.Title || "",
      projektLookupId:     h.rdLookup(raw, F.abr_projekt_r),
      datum:               raw.Datum,
      spesenZusatzBetrag:  h.num(raw.SpesenZusatzBetrag),
      spesenZusatzBemerkung: raw.SpesenZusatzBemerkung || "",
      status:              raw.Status || "erstellt",
      totalBetrag:         0
    };
    a.datumFmt    = h.fmtDate(a.datum);
    a.projektTitle = state.data.projekte.find(p => Number(p.id) === a.projektLookupId)?.Title || "";
    return a;
  }

  function enrichAll() {
    state.enriched.abrechnungen = state.data.abrechnungen.map(enrichAbrechnung);
    state.enriched.einsaetze    = state.data.einsaetze.map(enrichEinsatz);
    state.enriched.konzeption   = state.data.konzeption.map(enrichKonzeption);
    state.enriched.projekte     = state.data.projekte.map(enrichProjekt);
    // Nachträgliche Zuweisung: enriched items pro Projekt
    state.enriched.projekte.forEach(p => {
      p.einsaetze    = state.enriched.einsaetze.filter(e => e.projektLookupId === p.id);
      p.konzeintraege = state.enriched.konzeption.filter(k => k.projektLookupId === p.id);
    });
    // totalBetrag auf Abrechnungen: Honorar (lead+co) + Wegspesen + Konzeption + Zusatzspesen
    state.enriched.abrechnungen.forEach(a => {
      const einsaetze = state.enriched.einsaetze.filter(e => e.abrechnungLookupId === a.id);
      const konz      = state.enriched.konzeption.filter(k => k.abrechnungLookupId === a.id);
      a.totalBetrag = einsaetze.reduce((s,e) => s+(e.totalBetrag||0)+(e.spesenBerechnet||0), 0)
                    + konz.reduce((s,k) => s+(k.anzeigeBetrag||0), 0)
                    + (a.spesenZusatzBetrag||0);
    });
    debug.log("enrichAll", {
      projekte:     state.enriched.projekte.map(p => ({ id: p.id, firma: p.firmaName })),
      einsaetze:    state.enriched.einsaetze.length,
      konzeption:   state.enriched.konzeption.length,
      abrechnungen: state.enriched.abrechnungen.length
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // API
  // ════════════════════════════════════════════════════════════════════════
  const api = {
    async token() {
      if (!state.auth.account) throw new Error("Nicht angemeldet.");
      try {
        const r = await state.auth.msal.acquireTokenSilent({ scopes: CONFIG.graph.scopes, account: state.auth.account });
        return (state.auth.token = r.accessToken);
      } catch {
        // Redirect-Fallback für Mobile (Popup blocked in Chrome Android)
        await state.auth.msal.acquireTokenRedirect({ scopes: CONFIG.graph.scopes });
        return ""; // wird nach Redirect-Return via boot() neu gesetzt
      }
    },

    async req(url, opts = {}) {
      const tok = await api.token();
      debug.log("req", { method: opts.method || "GET", url, body: (() => { try { return opts.body ? JSON.parse(opts.body) : undefined; } catch { return opts.body; } })() });
      const res = await fetch(url, {
        ...opts,
        headers: {
          "Authorization": `Bearer ${tok}`,
          "Content-Type":  "application/json",
          ...(opts.headers || {})
        }
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = txt;
        try { msg = JSON.parse(txt)?.error?.message || txt; } catch {}
        debug.err("req", { status: res.status, url, msg });
        throw new Error(`HTTP ${res.status}: ${msg.slice(0, 300)}`);
      }
      return res.status === 204 ? null : res.json();
    },

    async siteId() {
      if (state.meta.siteId) return state.meta.siteId;
      const d = await api.req(`https://graph.microsoft.com/v1.0/sites/${CONFIG.sp.hostname}:${CONFIG.sp.sitePath}`);
      return (state.meta.siteId = d.id);
    },

    // Choice-Felder eines SP-Lists-Felds laden
    async getChoices(list, fieldName) {
      const sid = await api.siteId();
      const url = `https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(list)}/columns`;
      const d = await api.req(url);
      const col = (d.value || []).find(c => c.name === fieldName || c.displayName === fieldName);
      return col?.choice?.choices || [];
    },

    async loadChoices() {
      try {
        const [projSt, einsAbrech, einsSt, konzVerr, konzAbrech, abrSt] = await Promise.all([
          api.getChoices(CONFIG.lists.projekte,     "Status"),
          api.getChoices(CONFIG.lists.einsaetze,   "Abrechnung"),
          api.getChoices(CONFIG.lists.einsaetze,   "Status"),
          api.getChoices(CONFIG.lists.konzeption,  "Verrechenbar"),
          api.getChoices(CONFIG.lists.konzeption,  "Abrechnung"),
          api.getChoices(CONFIG.lists.abrechnungen,"Status")
        ]);
        if (projSt.length)     state.choices.projektStatus    = projSt;
        if (einsAbrech.length) state.choices.einsatzAbrechnung = einsAbrech;
        if (einsSt.length)     state.choices.einsatzStatus    = einsSt;
        if (konzVerr.length)   state.choices.konzVerrechenbar = konzVerr;
        if (konzAbrech.length) state.choices.konzAbrechnung   = konzAbrech;
        if (abrSt.length)      state.choices.abrStatus        = abrSt;
        debug.log("loadChoices", state.choices);
      } catch (e) {
        debug.err("loadChoices", e);
      }
    },

    async getItems(list) {
      const sid = await api.siteId();
      const url = `https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(list)}/items?$expand=fields&$top=5000`;
      const items = [];
      let next = url;
      while (next) {
        const d = await api.req(next);
        for (const i of (d.value || [])) {
          if (i.fields) items.push({ id: Number(i.id), ...i.fields });
        }
        next = d["@odata.nextLink"] || null;
      }
      debug.log(`getItems:${list}`, { count: items.length });
      return items;
    },

    // POST: NUR Title — alle anderen Felder per PATCH
    async post(list, title) {
      const sid = await api.siteId();
      const url = `https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(list)}/items`;
      debug.log(`post:${list}`, { Title: title });
      return api.req(url, { method: "POST", body: JSON.stringify({ fields: { Title: title } }) });
    },

    // SP-Token für REST API (Lookup-Felder)
    async spToken() {
      try {
        const r = await state.auth.msal.acquireTokenSilent({
          scopes: ["https://bbzsg.sharepoint.com/AllSites.Write"],
          account: state.auth.account
        });
        return r.accessToken;
      } catch {
        // Redirect-Fallback für Mobile
        await state.auth.msal.acquireTokenRedirect({
          scopes: ["https://bbzsg.sharepoint.com/AllSites.Write"]
        });
        return ""; // wird nach Redirect-Return via boot() neu gesetzt
      }
    },

    // Lookup-Felder via SP REST API schreiben (Graph API ignoriert diese)
    async patchLookups(list, itemId, lookupFields) {
      const tok = await api.spToken();
      const formValues = Object.entries(lookupFields)
        .filter(([,v]) => v !== null && v !== undefined)
        .map(([k, v]) => ({ FieldName: k, FieldValue: String(v) }));
      if (!formValues.length) return;
      const url = `https://${CONFIG.sp.hostname}${CONFIG.sp.sitePath}/_api/web/lists/getbytitle('${list}')/items(${itemId})/validateUpdateListItem`;
      debug.log(`patchLookups:${list}:${itemId}`, lookupFields);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + tok,
          "Content-Type": "application/json;odata=verbose",
          Accept: "application/json;odata=verbose"
        },
        body: JSON.stringify({ formValues, bNewDocumentUpdate: false })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`SP REST ${res.status}: ${txt.slice(0, 200)}`);
      }
      return res.json();
    },

    // DELETE: Graph API
    async deleteItem(list, itemId) {
      const sid = await api.siteId();
      const tok = await api.token();
      const url = `https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(list)}/items/${itemId}`;
      debug.log(`delete:${list}:${itemId}`, {});
      const res = await fetch(url, { method: "DELETE", headers: { Authorization: "Bearer " + tok } });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
    },

    // PATCH: Graph API für normale Felder
    async patch(list, itemId, fields) {
      const sid = await api.siteId();
      const url = `https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(list)}/items/${itemId}/fields`;
      // null-Werte filtern
      const clean = Object.fromEntries(Object.entries(fields).filter(([,v]) => v !== null && v !== undefined));
      debug.log(`patch:${list}:${itemId}`, clean);
      return api.req(url, { method: "PATCH", body: JSON.stringify(clean) });
    },

    async loadAll() {
      ui.setLoading(true);
      ui.setMsg("Daten werden geladen…", "info");
      try {
        const [projekte, einsaetze, konzeption, abrechnungen, firms, contacts, history, tasks] = await Promise.all([
          api.getItems(CONFIG.lists.projekte),
          api.getItems(CONFIG.lists.einsaetze),
          api.getItems(CONFIG.lists.konzeption),
          api.getItems(CONFIG.lists.abrechnungen),
          api.getItems(CONFIG.lists.firms),
          api.getItems(CONFIG.lists.contacts),
          api.getItems(CONFIG.lists.history),
          api.getItems(CONFIG.lists.tasks)
        ]);
        await api.loadChoices();
        state.data.projekte     = projekte;
        state.data.einsaetze    = einsaetze;
        state.data.konzeption   = konzeption;
        state.data.abrechnungen = abrechnungen;
        state.data.history      = history;
        state.data.tasks        = tasks;
        state.data.firms = firms.map(f => ({
          id:               Number(f.id),
          title:            f.Title || "",
          adresse:          f.Adresse || "",
          plz:              f.PLZ || "",
          ort:              f.Ort || "",
          land:             f.Land || "",
          hauptnummer:      f.Hauptnummer || "",
          telefon:          f.Hauptnummer || f.Telefon || "",
          website:          f.Website || f.Webseite || "",
          klassifizierung:  f.Klassifizierung || "",
          vip:              f.VIP === true || f.VIP === 1 || String(f.VIP).toLowerCase() === "true"
        }));
        state.data.contacts = contacts.map(c => ({
          id:            Number(c.id),
          nachname:      c.Title || "",
          vorname:       c.Vorname || "",
          funktion:      c.Funktion || "",
          rolle:         c.Rolle || "",
          email1:        c.Email1 || "",
          direktwahl:    c.Direktwahl || "",
          mobile:        c.Mobile || "",
          firmaLookupId: Number(c.FirmaLookupIdLookupId || c.FirmaLookupId || 0) || null,
          archiviert:    c.Archiviert === true || c.Archiviert === 1
        }));
        // History: NachnameLookupId → Kontakt → Firma
        state.data.history = history.map(h2 => ({
          id:            Number(h2.id),
          title:         h2.Title || "",
          datum:         h2.Datum,
          typ:           h2.Kontaktart || "",
          notizen:       h2.Notizen || "",
          leadbbz:       h2.Leadbbz || "",
          kontaktId:     Number(h2.NachnameLookupIdLookupId || h2.NachnameLookupId || 0) || null
        }));
        state.data.tasks = tasks.map(t => ({
          id:            Number(t.id),
          title:         t.Title || "",
          deadline:      t.Deadline,
          status:        t.Status || "",
          leadbbz:       t.Leadbbz || "",
          kontaktId:     Number(t.NameLookupIdLookupId || t.NameLookupId || 0) || null
        }));
        enrichAll();
        ui.setMsg("", "");
      } catch (e) {
        debug.err("loadAll", e);
        ui.setMsg("Fehler beim Laden: " + e.message, "error");
      } finally {
        ui.setLoading(false);
      }
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // UI HELPERS
  // ════════════════════════════════════════════════════════════════════════
  const ui = {
    els: {},
    init() {
      this.els.root    = document.getElementById("view-root");
      this.els.msg     = document.getElementById("global-message");
      this.els.login   = document.getElementById("btn-login");
      this.els.refresh = document.getElementById("btn-refresh");
      this.els.auth    = document.getElementById("auth-status");
      this.els.navBtns = [...document.querySelectorAll(".tm-nav-btn")];

      if (this.els.login)   this.els.login.addEventListener("click",   () => ctrl.login());
      if (this.els.refresh) this.els.refresh.addEventListener("click", () => ctrl.refresh());
      this.els.navBtns.forEach(b => b.addEventListener("click", () => ctrl.navigate(b.dataset.route)));
      document.querySelectorAll(".tm-bn-item").forEach(b => b.addEventListener("click", () => ctrl.navigate(b.dataset.route)));

      // Form-Submit Delegation
      document.addEventListener("submit", e => {
        if (e.target.id === "projekt-form")    { e.preventDefault(); ctrl.saveProjekt(new FormData(e.target)); }
        if (e.target.id === "einsatz-form")    { e.preventDefault(); ctrl.saveEinsatz(new FormData(e.target)); }
        if (e.target.id === "konzeption-form") { e.preventDefault(); ctrl.saveKonzeption(new FormData(e.target)); }
      });

      // Click Delegation
      document.addEventListener("click", e => {
        const a = sel => e.target.closest(sel);
        if (a("[data-action='open-projekt']"))     {
          const id = +a("[data-action='open-projekt']").dataset.id;
          if (window.innerWidth <= 899) state.ui.pdMobDetail = true;
          ctrl.openProjekt(id);
          return;
        }
        if (a("[data-action='pd-mob-back']"))      { state.ui.pdMobDetail = false; ctrl.render(); return; }
        if (a("[data-action='pd-kpi-toggle']"))    { state.ui.pdKpiOpen = !state.ui.pdKpiOpen; ctrl.render(); return; }
        if (a("[data-action='back-to-projekte']")) {
          state.form = null;
          ctrl.navigate("projekte");
          return;
        }
        if (a("[data-action='pd-select-einsatz']")) {
          const el = a("[data-action='pd-select-einsatz']");
          const id = +el.dataset.id;
          if (window.innerWidth <= 899) { ctrl.pdMobOpenEinsatz(id); return; }
          state.ui.selectedProjektEinsatzId = id === state.ui.selectedProjektEinsatzId ? null : id;
          ctrl.render(); return;
        }
        if (a("[data-action='pd-select-konz']")) {
          const el = a("[data-action='pd-select-konz']");
          const id = +el.dataset.id;
          if (window.innerWidth <= 899) { ctrl.pdMobOpenKonz(id); return; }
          state.ui.selectedProjektKonzId = id === state.ui.selectedProjektKonzId ? null : id;
          ctrl.render(); return;
        }
        if (a(".pd-tab[data-tab]"))                { const t = a(".pd-tab[data-tab]"); state.ui.selectedProjektEinsatzId = null; state.ui.selectedProjektKonzId = null; ctrl.setTab(t.dataset.route, t.dataset.tab); return; }
        if (a("[data-action='new-einsatz']"))      { ctrl.openEinsatzForm(null, +a("[data-action='new-einsatz']").dataset.projektId || null); return; }
        if (a("[data-action='new-konzeption']"))   { ctrl.openKonzeptionForm(null, +a("[data-action='new-konzeption']").dataset.projektId || null); return; }
        if (a("[data-action='edit-einsatz']"))     { ctrl.openEinsatzForm(+a("[data-action='edit-einsatz']").dataset.id); return; }
        if (a("[data-action='edit-konzeption']"))  { ctrl.openKonzeptionForm(+a("[data-action='edit-konzeption']").dataset.id); return; }
        if (a("[data-action='open-abrechnung']"))  {
          const pid = +a("[data-action='open-abrechnung']").dataset.projektId;
          state.selection.projektId = pid;
          state.filters.route = "abrechnung-erstellen";
          ctrl.render();
          return;
        }
        if (a("[data-action='delete-einsatz']"))  { ctrl.deleteEinsatz(+a("[data-action='delete-einsatz']").dataset.id); return; }
        if (a("[data-action='copy-einsatz']"))    { ctrl.copyEinsatz(+a("[data-action='copy-einsatz']").dataset.id); return; }
        if (a("[data-action='delete-konzeption']")) { ctrl.deleteKonzeption(+a("[data-action='delete-konzeption']").dataset.id); return; }
        if (a("[data-action='delete-abrechnung']")) { ctrl.deleteAbrechnung(+a("[data-action='delete-abrechnung']").dataset.id); return; }
        if (a("[data-action='delete-projekt']"))   { ctrl.deleteProjekt(+a("[data-action='delete-projekt']").dataset.id); return; }
        if (a("[data-action='new-projekt']"))      { ctrl.openProjektForm(null); return; }
        if (a("[data-action='edit-projekt']"))     { ctrl.openProjektForm(+a("[data-action='edit-projekt']").dataset.id); return; }
        if (a("[data-close-modal]"))               { ctrl.closeModal(); return; }
        if (a(".ef-chip[data-fkey]"))              { const c = a(".ef-chip[data-fkey]"); const k = c.dataset.fkey, v = c.dataset.fval; state.filters.einsaetze[k] = state.filters.einsaetze[k] === v ? "" : v; ctrl.render(); return; }
        if (a("[data-action='reset-einsatz-filters']")) { state.filters.einsaetze = {search:"",abrechnung:"",einsatzStatus:"",jahr:"",projekt:"",firma:"",projektNr:"",person:""}; state.ui.selectedEinsatzId=null; ctrl.render(); return; }
        if (a("[data-action='ei-filter']")) { const el=a("[data-action='ei-filter']"); const k=el.dataset.fkey,v=el.dataset.fval; state.filters.einsaetze[k]=state.filters.einsaetze[k]===v?"":v; state.ui.selectedEinsatzId=null; ctrl.render(); return; }
        if (a("[data-action='ei-mob-filter']"))       { state.ui.eiMobFilter = true;  ctrl.render(); return; }
        if (a("[data-action='ei-mob-filter-close']")) { state.ui.eiMobFilter = false; ctrl.render(); return; }
        if (a("[data-action='select-einsatz']")) {
          const id = +a("[data-action='select-einsatz']").dataset.id;
          if (window.innerWidth <= 899) { ctrl.eiMobOpenEinsatz(id); return; }
          state.ui.selectedEinsatzId = state.ui.selectedEinsatzId===id ? null : id;
          document.querySelectorAll("[data-action='select-einsatz']").forEach(tr => {
            tr.classList.toggle("ei-row-sel", +tr.dataset.id === state.ui.selectedEinsatzId);
          });
          ctrl.updateDetailPanel(); return;
        }
        if (a("[data-action='open-bs']"))              { ctrl.openBs(+a("[data-action='open-bs']").dataset.id); return; }
        if (a("[data-action='kz-filter']"))         { const el=a("[data-action='kz-filter']"); const k=el.dataset.fkey,v=el.dataset.fval; state.filters.konzeption[k]=state.filters.konzeption[k]===v?"":v; state.ui.selectedKonzId=null; ctrl.render(); return; }
        if (a("[data-action='abr-filter']"))         { const el=a("[data-action='abr-filter']"); const k=el.dataset.fkey,v=el.dataset.fval; state.filters.abrechnungen[k]=state.filters.abrechnungen[k]===v?"":v; state.ui.selectedAbrId=null; ctrl.render(); return; }
        if (a("[data-action='fi-filter']"))          { const el=a("[data-action='fi-filter']"); const k=el.dataset.fkey,v=el.dataset.fval; state.filters.firmen[k]=state.filters.firmen[k]===v?"":v; state.ui.selectedFirmaId=null; ctrl.render(); return; }
        if (a("[data-action='fi-reset-filters']"))   { state.filters.firmen={search:"",klassifizierung:"",vip:"",anzeigen:""}; state.ui.selectedFirmaId=null; ctrl.render(); return; }
        if (a("[data-action='fi-toggle-sec']"))      { const sec=a("[data-action='fi-toggle-sec']").dataset.sec; state.ui.sbOpen[sec]=state.ui.sbOpen[sec]===false?true:false; ctrl.render(); return; }
        if (a("[data-action='fi-mob-filter']"))      { state.ui.fiMobFilter=true;  ctrl.render(); return; }
        if (a("[data-action='fi-mob-filter-close']")){ state.ui.fiMobFilter=false; ctrl.render(); return; }
        if (a("[data-action='fi-select']")) {
          const id = +a("[data-action='fi-select']").dataset.id;
          if (window.innerWidth <= 899) { ctrl.openFirma(id); return; }
          state.ui.selectedFirmaId = state.ui.selectedFirmaId===id ? null : id;
          document.querySelectorAll("[data-action='fi-select']").forEach(c=>c.classList.toggle("fi-row-sel",+c.dataset.id===state.ui.selectedFirmaId));
          ctrl.updateFirmaDetailPanel(); return;
        }
        if (a("[data-action='abr-reset-filters']"))  { state.filters.abrechnungen={search:"",status:"",projekt:"",firma:"",jahr:""}; state.ui.selectedAbrId=null; ctrl.render(); return; }
        if (a("[data-action='abr-toggle-sec']"))     { const sec=a("[data-action='abr-toggle-sec']").dataset.sec; state.ui.sbOpen[sec]=state.ui.sbOpen[sec]===false?true:false; ctrl.render(); return; }
        if (a("[data-action='abr-mob-filter']"))     { state.ui.abrMobFilter=true;  ctrl.render(); return; }
        if (a("[data-action='abr-mob-filter-close']")){ state.ui.abrMobFilter=false; ctrl.render(); return; }
        if (a("[data-action='abr-select']")) {
          const id = +a("[data-action='abr-select']").dataset.id;
          if (window.innerWidth <= 899) { ctrl.abrMobOpen(id); return; }
          state.ui.selectedAbrId = state.ui.selectedAbrId===id ? null : id;
          document.querySelectorAll("[data-action='abr-select']").forEach(c => c.classList.toggle("abr-card-sel", +c.dataset.id===state.ui.selectedAbrId));
          ctrl.updateAbrDetailPanel(); return;
        }
        if (a("[data-action='kz-reset-filters']"))   { state.filters.konzeption={search:"",verrechenbar:"",person:"",projekt:"",firma:"",jahr:"",abrechnung:""}; state.ui.selectedKonzId=null; ctrl.render(); return; }
        if (a("[data-action='kz-toggle-sec']"))      { const sec=a("[data-action='kz-toggle-sec']").dataset.sec; state.ui.sbOpen[sec]=state.ui.sbOpen[sec]===false?true:false; ctrl.render(); return; }
        if (a("[data-action='kz-mob-filter']"))      { state.ui.kzMobFilter=true;  ctrl.render(); return; }
        if (a("[data-action='kz-mob-filter-close']")){ state.ui.kzMobFilter=false; ctrl.render(); return; }
        if (a("[data-action='kz-select']")) {
          const id = +a("[data-action='kz-select']").dataset.id;
          if (window.innerWidth <= 899) { ctrl.kzMobOpen(id); return; }
          state.ui.selectedKonzId = state.ui.selectedKonzId===id ? null : id;
          document.querySelectorAll("[data-action='kz-select']").forEach(tr => tr.classList.toggle("kz-row-sel", +tr.dataset.id === state.ui.selectedKonzId));
          ctrl.updateKonzDetailPanel(); return;
        }
        if (a("[data-action='open-filter-sheet']"))    { const k=a("[data-action='open-filter-sheet']").dataset.filterKey; ctrl.openFs(k); return; }
        if (a("[data-action='open-kz-filter-sheet']")) { const k=a("[data-action='open-kz-filter-sheet']").dataset.filterKey; ctrl.openKzFs(k); return; }
        if (a("[data-action='clear-kz-filter']"))      { e.stopPropagation(); const k=a("[data-action='clear-kz-filter']").dataset.fkey; state.filters.konzeption[k]=""; state.ui.selectedKonzId=null; ctrl.render(); return; }
        if (a("[data-action='open-search-sheet']"))    { ctrl.openFs("search"); return; }
        if (a("[data-action='clear-filter']"))         { e.stopPropagation(); const k=a("[data-action='clear-filter']").dataset.fkey; state.filters.einsaetze[k]=""; state.ui.selectedEinsatzId=null; ctrl.render(); return; }
        if (a(".ef-sb-chip[data-fkey]"))               { const c = a(".ef-sb-chip[data-fkey]"); const k = c.dataset.fkey, v = c.dataset.fval; state.filters.einsaetze[k] = state.filters.einsaetze[k] === v ? "" : v; state.ui.selectedEinsatzId=null; ctrl.render(); return; }
        if (a("[data-action='toggle-sb-sec']"))        { const sec = a("[data-action='toggle-sb-sec']").dataset.sec; const sb = state.ui.sbOpen; sb[sec] = sb[sec] === false ? true : false; ctrl.render(); return; }
        if (a("[data-action='toggle-einsatz-filter']"))  { state.ui.einsatzFilterOpen = !state.ui.einsatzFilterOpen; ctrl.render(); return; }
        if (a("[data-sort-col]")) { const col = a("[data-sort-col]").dataset.sortCol; const s = state.ui.einsatzSort; s.dir = s.col===col ? (s.dir==="asc"?"desc":"asc") : "asc"; s.col=col; ctrl.render(); return; }
        if (a(".tm-tab[data-tab]"))                { const t = a(".tm-tab[data-tab]"); ctrl.setTab(t.dataset.route, t.dataset.tab); return; }
        if (e.target.id === "tm-modal-bd" || e.target.classList.contains("ei-bs-bd") || e.target.classList.contains("pd-bs-bd")) { ctrl.closeModal(); return; }
      });
    },

    setNav(route) {
      this.els.navBtns.forEach(b => b.classList.toggle("active", b.dataset.route === route));
      // Bottom nav
      document.querySelectorAll(".tm-bn-item").forEach(b => b.classList.toggle("active", b.dataset.route === route));
    },
    setLoading(v) { if (this.els.refresh) this.els.refresh.style.display = v ? "none" : ""; },
    setMsg(msg, type) {
      const el = this.els.msg;
      if (!el) return;
      if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
      el.textContent = msg;
      el.className = `tm-global-message ${type}`;
      el.style.display = "block";
      if (type === "success") setTimeout(() => ui.setMsg("", ""), 3000);
    },
    setAuth(name) {
      if (this.els.auth)    this.els.auth.textContent = name || "";
      if (this.els.login)   this.els.login.style.display   = name ? "none" : "";
      if (this.els.refresh) this.els.refresh.style.display = name ? "" : "none";
      const btnExport = document.getElementById("btn-export");
      if (btnExport) btnExport.style.display = name ? "" : "none";
    },
    render(html) { if (this.els.root) this.els.root.innerHTML = html; },
    renderModal(html) {
      let bd = document.getElementById("tm-modal-bd");
      if (!bd) { bd = document.createElement("div"); bd.id = "tm-modal-bd"; bd.className = "tm-modal-backdrop"; document.body.appendChild(bd); }
      bd.innerHTML = html;
      bd.style.display = "flex";
    },
    closeModal() { const el = document.getElementById("tm-modal-bd"); if (el) { el.style.display = "none"; el.innerHTML = ""; } },
    empty(msg = "Keine Einträge vorhanden.") {
      return `<div class="tm-empty"><div class="tm-empty-icon">📋</div><div class="tm-empty-text">${h.esc(msg)}</div></div>`;
    },

    // Select-HTML für Firma
    firmaSelect(name, selectedId, required = false, onchange = "") {
      const firms = state.data.firms.sort((a,b) => a.title.localeCompare(b.title, "de"));
      return `<select name="${h.esc(name)}" ${required?"required":""} ${onchange?`onchange="${onchange}"`:""}>
        <option value="">— Firma wählen —</option>
        ${firms.map(f => `<option value="${f.id}" ${String(f.id) === String(selectedId||"") ? "selected" : ""}>${h.esc(f.title)}</option>`).join("")}
      </select>`;
    },

    // Select-HTML für Kontakt (gefiltert nach Firma)
    contactSelect(name, selectedId, firmaId = null, required = false) {
      const contacts = state.data.contacts
        .filter(c => !firmaId || c.firmaLookupId === firmaId)
        .sort((a,b) => (a.nachname+a.vorname).localeCompare(b.nachname+b.vorname, "de"));
      return `<select name="${h.esc(name)}" ${required?"required":""}>
        <option value="">— Person wählen —</option>
        ${contacts.map(c => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${h.esc([c.nachname, c.vorname].filter(Boolean).join(", "))}</option>`).join("")}
      </select>`;
    },

    // Typeahead für Person (in Einsatz/Konzeption)
    personTypeahead(name, selectedId, firmaId = null) {
      const contacts = state.data.contacts
        .filter(c => !firmaId || c.firmaLookupId === firmaId)
        .sort((a,b) => (a.nachname+a.vorname).localeCompare(b.nachname+b.vorname, "de"))
        .map(c => ({ id: String(c.id), label: [c.nachname, c.vorname].filter(Boolean).join(", ") }));
      return h.typeaheadHtml(name, contacts, selectedId, "Person suchen…");
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEWS
  // ════════════════════════════════════════════════════════════════════════
  const views = {
    projekte() {
      // Projekte-Route zeigt direkt das erste Projekt im 3-Panel-Layout
      // Falls bereits ein Projekt gewählt → direkt zu projektDetail
      const alle = state.enriched.projekte.filter(p => !p.archiviert);
      if (!alle.length) { ui.render(ui.empty("Keine Projekte vorhanden.")); return; }
      if (!state.selection.projektId) {
        state.selection.projektId = alle[0].id;
      }
      state.filters.route = "projekt-detail";
      views.projektDetail(state.selection.projektId);
    },

    projektDetail(id) {
      // ── Daten ──────────────────────────────────────────────────────────────
      const alle = state.enriched.projekte; // alle inkl. archivierte — Filterung in Sidebar
      const p = alle.find(p => p.id === id);
      if (!p) { ui.render(`<p class="tm-muted">Projekt nicht gefunden (ID: ${id}).</p>`); return; }

      const tab = state.filters.activeTab["projekt-detail"] || "einsaetze";
      const pct = p.konzBudgetH ? Math.round(p.konzStunden / p.konzBudgetH * 100) : null;
      const f   = state.filters.projektDetail;

      // ── Firma-Farbpalette (deterministisch) ────────────────────────────────
      const PD_COLORS = [
        {dot:"#378ADD"},{dot:"#1D9E75"},{dot:"#D85A30"},{dot:"#7F77DD"},
        {dot:"#BA7517"},{dot:"#0F6E56"},{dot:"#185FA5"},{dot:"#854F0B"}
      ];
      const firmenSorted = [...new Set(alle.map(p => p.firmaName).filter(Boolean))].sort();
      const firmaColor = fn => PD_COLORS[firmenSorted.indexOf(fn) % PD_COLORS.length]?.dot || "#8896a5";

      // ── Sidebar HTML ───────────────────────────────────────────────────────
      const sbSearch = state.filters.projekte.search.toLowerCase();
      const pdCollapsed = state.ui.pdFirmaCollapsed || {};
      const statusFilter = state.filters.projekte.status !== undefined ? state.filters.projekte.status : "aktiv";
      // Sicherstellen dass Default "aktiv" gesetzt ist
      if (state.filters.projekte.status === undefined || state.filters.projekte.status === "") {
        state.filters.projekte.status = "aktiv";
      }

      const alleGefiltert = statusFilter === "alle"
        ? state.enriched.projekte
        : statusFilter === "archiviert"
          ? state.enriched.projekte.filter(p => p.archiviert)
          : state.enriched.projekte.filter(p => !p.archiviert);

      const firmenSortedSb = [...new Set(alleGefiltert.map(p => p.firmaName).filter(Boolean))].sort();

      const firmenGruppen = firmenSortedSb.map(fn => {
        let projekte = alleGefiltert.filter(pp => pp.firmaName === fn &&
          (!sbSearch || pp.title.toLowerCase().includes(sbSearch) || fn.toLowerCase().includes(sbSearch)));
        if (!projekte.length) return "";
        const hasActive = projekte.some(pp => pp.id === id);
        const isExpanded = hasActive || pdCollapsed[fn] === true || projekte.length === 1;
        const dot = `<div class="pd-sb-dot" style="background:${firmaColor(fn)}"></div>`;

        if (projekte.length === 1) {
          return `<div class="pd-sb-firma${hasActive?" has-active":""}" data-action="open-projekt" data-id="${projekte[0].id}">
            ${dot}<span class="pd-sb-firma-name">${h.esc(fn)}</span>
          </div>`;
        }
        return `<div>
          <div class="pd-sb-firma${hasActive?" has-active":""}" onclick="if(!state.ui.pdFirmaCollapsed)state.ui.pdFirmaCollapsed={};state.ui.pdFirmaCollapsed['${fn.replace(/'/g,"\\'")}']=${!isExpanded};ctrl.render()">
            ${dot}<span class="pd-sb-firma-name">${h.esc(fn)}</span>
            <span class="pd-sb-firma-arrow">${isExpanded?"▾":"▸"}</span>
          </div>
          ${isExpanded ? projekte.map(pp => `
            <div class="pd-sb-proj${pp.id===id?" active":""}" data-action="open-projekt" data-id="${pp.id}">
              <span class="pd-sb-proj-name">${h.esc(pp.title)}</span>
            </div>`).join("") : ""}
        </div>`;
      }).join("");

      // ── Einsätze-Tab ───────────────────────────────────────────────────────
      const tabEinsaetze = () => {
        let list = [...p.einsaetze].sort((a,b) => h.toDate(b.datum) - h.toDate(a.datum));

        // Jahre für Filter
        const jahre = [...new Set(list.map(e => e.datum ? new Date(e.datum).getFullYear() : null).filter(Boolean))].sort((a,b)=>b-a);
        const personen = [...new Set([...list.map(e=>e.personName), ...list.map(e=>e.coPersonName)].filter(n=>n&&n!=="—"))].sort();

        // Filter anwenden
        if (f.jahr)          list = list.filter(e => e.datum && new Date(e.datum).getFullYear() === +f.jahr);
        if (f.person)        list = list.filter(e => e.personName===f.person || e.coPersonName===f.person);
        if (f.einsatzStatus) list = list.filter(e => e.einsatzStatus===f.einsatzStatus);
        if (f.abrechnung)    list = list.filter(e => e.abrechnung===f.abrechnung);

        const sel = state.ui.selectedProjektEinsatzId;
        const geplant     = list.filter(e => e.einsatzStatus === "geplant");
        const durchgefuehrt = list.filter(e => e.einsatzStatus !== "geplant");

        const eRow = e => {
          const isSel = e.id === sel;
          const isAbgesagt = ["abgesagt","abgesagt-chf"].includes(e.einsatzStatus);
          const initials = n => (n||"").split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
          return `<tr class="pd-row${isSel?" pd-row-sel":""}${isAbgesagt?" pd-row-cancelled":""}"
            data-action="pd-select-einsatz" data-id="${e.id}">
            <td class="pd-td-muted pd-nowrap">${h.esc(e.datumFmt)}</td>
            <td style="font-weight:600">${h.esc(e.title)}${isAbgesagt?` ${h.badge("tm-badge tm-badge-cancelled","Abgesagt")}`:""}</td>
            <td class="pd-td-muted">${h.esc(e.kategorie)}</td>
            <td>
              <div style="display:inline-flex;align-items:center;gap:4px">
                <span class="pd-av pd-av-lead">${initials(e.personName)}</span>
                ${e.coPersonName && e.coPersonName!=="—" ? `<span class="pd-av pd-av-co">${initials(e.coPersonName)}</span>` : ""}
                <span class="pd-person-name">${h.esc(e.personName)}${e.coPersonName&&e.coPersonName!=="—"?` · ${h.esc(e.coPersonName)}`:""}</span>
              </div>
            </td>
            <td>${h.abrBadge(e.abrechnung)}</td>
          </tr>`;
        };

        const hasFilter = f.jahr||f.person||f.einsatzStatus||f.abrechnung;
        const filterBar = `<div class="pd-filter-bar">
          <span class="pd-filter-label">Filter:</span>
          <select class="pd-filter-select" onchange="state.filters.projektDetail.jahr=this.value;state.ui.selectedProjektEinsatzId=null;ctrl.render()">
            <option value="">Alle Jahre</option>
            ${jahre.map(j=>`<option value="${j}" ${f.jahr==j?"selected":""}>${j}</option>`).join("")}
          </select>
          <select class="pd-filter-select" onchange="state.filters.projektDetail.person=this.value;state.ui.selectedProjektEinsatzId=null;ctrl.render()">
            <option value="">Alle Personen</option>
            ${personen.map(n=>`<option value="${h.esc(n)}" ${f.person===n?"selected":""}>${h.esc(n)}</option>`).join("")}
          </select>
          <select class="pd-filter-select" onchange="state.filters.projektDetail.einsatzStatus=this.value;state.ui.selectedProjektEinsatzId=null;ctrl.render()">
            <option value="">Alle Status</option>
            <option value="geplant" ${f.einsatzStatus==="geplant"?"selected":""}>Geplant</option>
            <option value="durchgefuehrt" ${f.einsatzStatus==="durchgefuehrt"?"selected":""}>Durchgeführt</option>
            <option value="abgesagt" ${f.einsatzStatus==="abgesagt"?"selected":""}>Abgesagt</option>
            <option value="abgesagt-chf" ${f.einsatzStatus==="abgesagt-chf"?"selected":""}>Abgesagt (CHF)</option>
          </select>
          <select class="pd-filter-select" onchange="state.filters.projektDetail.abrechnung=this.value;state.ui.selectedProjektEinsatzId=null;ctrl.render()">
            <option value="">Alle Abrechn.</option>
            ${state.choices.einsatzAbrechnung.map(v=>`<option value="${h.esc(v)}" ${f.abrechnung===v?"selected":""}>${h.esc(v)}</option>`).join("")}
          </select>
          ${hasFilter?`<span class="pd-filter-reset" onclick="state.filters.projektDetail.jahr='';state.filters.projektDetail.person='';state.filters.projektDetail.einsatzStatus='';state.filters.projektDetail.abrechnung='';state.ui.selectedProjektEinsatzId=null;ctrl.render()">✕ Zurücksetzen</span>`:""}
        </div>
        <div class="pd-mob-filter-bar">
          <span style="font-size:12px;color:#8896a5;font-weight:600;flex:1">${hasFilter?`Filter aktiv`:"Alle Einsätze"}</span>
          ${hasFilter?`<button class="tm-btn tm-btn-sm" onclick="state.filters.projektDetail.jahr='';state.filters.projektDetail.person='';state.filters.projektDetail.einsatzStatus='';state.filters.projektDetail.abrechnung='';state.ui.selectedProjektEinsatzId=null;ctrl.render()">✕ Zurücksetzen</button>`:""}
        </div>`;

        const thead = `<thead><tr>
          <th style="width:88px">Datum ↓</th>
          <th>Beschreibung</th>
          <th style="width:130px">Kategorie</th>
          <th style="width:180px">Lead / Co-Lead</th>
          <th style="width:110px">Abrechnung</th>
        </tr></thead>`;

        if (!list.length) return filterBar + ui.empty("Keine Einsätze für diese Filter.");

        const sectionRow = label => `<tr class="pd-section-row"><td colspan="5">${label}</td></tr>`;

        const rows = [
          ...(geplant.length     ? [sectionRow(`Bevorstehend (${geplant.length})`),     ...geplant.map(eRow)]     : []),
          ...(durchgefuehrt.length ? [sectionRow(`Vergangen (${durchgefuehrt.length})`), ...durchgefuehrt.map(eRow)] : [])
        ];

        return filterBar + `<div class="pd-table-wrap">
          <table class="pd-table pd-tbl-einsaetze">
            ${thead}
            <tbody>${rows.join("")}</tbody>
          </table>
        </div>`;
      };

      // ── Konzeption-Tab ─────────────────────────────────────────────────────
      const tabKonzeption = () => {
        let list = [...p.konzeintraege].sort((a,b) => h.toDate(b.datum) - h.toDate(a.datum));

        const jahre = [...new Set(list.map(k => k.datum ? new Date(k.datum).getFullYear() : null).filter(Boolean))].sort((a,b)=>b-a);

        if (f.konzJahr)  list = list.filter(k => k.datum && new Date(k.datum).getFullYear() === +f.konzJahr);
        if (f.konzKat)   list = list.filter(k => k.kategorie === f.konzKat);
        if (f.konzVerr)  list = list.filter(k => k.verrechenbar === f.konzVerr);
        if (f.konzAbr)   list = list.filter(k => k.abrechnung === f.konzAbr);

        const sel = state.ui.selectedProjektKonzId;

        const filterBar = `<div class="pd-filter-bar">
          <span class="pd-filter-label">Filter:</span>
          <select class="pd-filter-select" onchange="state.filters.projektDetail.konzJahr=this.value;state.ui.selectedProjektKonzId=null;ctrl.render()">
            <option value="">Alle Jahre</option>
            ${jahre.map(j=>`<option value="${j}" ${f.konzJahr==j?"selected":""}>${j}</option>`).join("")}
          </select>
          <select class="pd-filter-select" onchange="state.filters.projektDetail.konzKat=this.value;state.ui.selectedProjektKonzId=null;ctrl.render()">
            <option value="">Alle Kategorien</option>
            <option value="Konzeption" ${f.konzKat==="Konzeption"?"selected":""}>Konzeption</option>
            <option value="Admin" ${f.konzKat==="Admin"?"selected":""}>Admin</option>
          </select>
          <select class="pd-filter-select" onchange="state.filters.projektDetail.konzVerr=this.value;state.ui.selectedProjektKonzId=null;ctrl.render()">
            <option value="">Alle Verrechenbar</option>
            ${state.choices.konzVerrechenbar.map(v=>`<option value="${h.esc(v)}" ${f.konzVerr===v?"selected":""}>${h.esc(v)}</option>`).join("")}
          </select>
          <select class="pd-filter-select" onchange="state.filters.projektDetail.konzAbr=this.value;state.ui.selectedProjektKonzId=null;ctrl.render()">
            <option value="">Alle Abrechn.</option>
            ${state.choices.konzAbrechnung.map(v=>`<option value="${h.esc(v)}" ${f.konzAbr===v?"selected":""}>${h.esc(v)}</option>`).join("")}
          </select>
          ${(f.konzJahr||f.konzKat||f.konzVerr||f.konzAbr)?`<span class="pd-filter-reset" onclick="state.filters.projektDetail.konzJahr='';state.filters.projektDetail.konzKat='';state.filters.projektDetail.konzVerr='';state.filters.projektDetail.konzAbr='';state.ui.selectedProjektKonzId=null;ctrl.render()">✕ Zurücksetzen</span>`:""}
        </div>`;

        if (!list.length) return filterBar + ui.empty("Keine Konzeptionsaufwände für diese Filter.");

        return filterBar + `<div class="pd-table-wrap">
          <table class="pd-table pd-tbl-konzeption">
            <thead><tr>
              <th style="width:88px">Datum ↓</th>
              <th>Beschreibung</th>
              <th style="width:90px">Kategorie</th>
              <th style="width:75px;text-align:right">Aufwand</th>
              <th style="width:140px">Verrechenbar</th>
              <th style="width:110px">Abrechnung</th>
            </tr></thead>
            <tbody>${list.map(k => `<tr class="pd-row${k.id===sel?" pd-row-sel":""}" data-action="pd-select-konz" data-id="${k.id}">
              <td class="pd-td-muted pd-nowrap">${h.esc(k.datumFmt)}</td>
              <td style="font-weight:600">${h.esc(k.title)}</td>
              <td class="pd-td-muted">${h.esc(k.kategorie)}</td>
              <td class="pd-td-right">${k.aufwandStunden !== null ? k.aufwandStunden.toFixed(1) + " h" : "—"}</td>
              <td>${h.verrBadge(k.verrechenbar)}</td>
              <td>${k.verrechenbar === "Inklusive (ohne Verrechnung)" ? "" : h.abrBadge(k.abrechnung)}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>`;
      };

      // ── Stammdaten-Tab ─────────────────────────────────────────────────────
      const tabStammdaten = () => `
        <div class="pd-stam-grid">
          <div class="pd-stam-card pd-stam-full">
            <div class="pd-stam-title">Projektdaten</div>
            ${[["Projektnummer", p.projektNr||"—"],["Firma",p.firmaName],["Ansprechpartner",p.ansprechpartner||"—"],
               ["Status",p.status],["Km zum Kunden",p.kmZumKunden!==null?`${p.kmZumKunden} km`:"—"],
               ["Konzeptionsrahmen",p.konzBudgetH?`${p.konzeptionsrahmenTage} Tage (${p.konzBudgetH} h)`:"—"]]
              .map(([l,v])=>`<div class="pd-stam-row"><span class="pd-stam-key">${l}</span><span class="pd-stam-val">${h.esc(String(v))}</span></div>`).join("")}
          </div>
          <div class="pd-stam-card">
            <div class="pd-stam-title">Einsatz-Ansätze</div>
            ${[["Einsatz (Tag)",p.ansatzEinsatz],["Einsatz (Halbtag)",p.ansatzHalbtag],
               ["Co-Einsatz (Tag)",p.ansatzCoEinsatz],["Stunde",p.ansatzStunde],
               ["Spesen (CHF/km)",p.ansatzKmSpesen]]
              .filter(([,v])=>v!==null)
              .map(([l,v])=>`<div class="pd-stam-row"><span class="pd-stam-key">${l}</span><span class="pd-stam-val">CHF ${h.chf(v)}</span></div>`).join("")}
          </div>
          <div class="pd-stam-card">
            <div class="pd-stam-title">Konzeption-Ansätze</div>
            ${[["Konzeption (pro Tag)",p.ansatzKonzeption],["Admin (pro Tag)",p.ansatzAdmin]]
              .filter(([,v])=>v!==null)
              .map(([l,v])=>`<div class="pd-stam-row"><span class="pd-stam-key">${l}</span><span class="pd-stam-val">CHF ${h.chf(v)}</span></div>`).join("")
              || `<div class="pd-stam-row"><span class="pd-stam-key">Keine Ansätze</span><span class="pd-stam-val">—</span></div>`}
          </div>
          ${p.bemerkungen ? `
          <div class="pd-stam-card pd-stam-full">
            <div class="pd-stam-title">Bemerkungen</div>
            <div style="font-size:13px;color:#4a5568;white-space:pre-wrap;line-height:1.55">${h.esc(p.bemerkungen)}</div>
          </div>` : ""}
        </div>`;

      // ── Detail-Panel ───────────────────────────────────────────────────────
      const detailPanel = () => {
        if (tab === "einsaetze") {
          const sel = state.ui.selectedProjektEinsatzId;
          const e = sel ? p.einsaetze.find(e=>e.id===sel) : null;
          if (!e) return `<div class="pd-dp-empty"><div class="pd-dp-empty-icon">☰</div><span>Zeile auswählen für Details</span></div>`;
          const initials = n => (n||"").split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
          return `
            <div class="pd-dp-title">${h.esc(e.title)}</div>
            <div class="pd-dp-row"><span class="pd-dp-key">Datum</span><span class="pd-dp-val">${h.esc(e.datumFmt)}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Kategorie</span><span class="pd-dp-val">${h.esc(e.kategorie)}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Person</span><span class="pd-dp-val">
              <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
                <span class="pd-av pd-av-lead">${initials(e.personName)}</span>
                ${e.coPersonName&&e.coPersonName!=="—"?`<span class="pd-av pd-av-co">${initials(e.coPersonName)}</span>`:""}
                <span style="font-size:12px">${h.esc(e.personName)}${e.coPersonName&&e.coPersonName!=="—"?` · ${h.esc(e.coPersonName)}`:""}</span>
              </div>
            </span></div>
            ${e.ort?`<div class="pd-dp-row"><span class="pd-dp-key">Ort</span><span class="pd-dp-val">${h.esc(e.ort)}</span></div>`:""}
            <div class="pd-dp-row"><span class="pd-dp-key">Status</span><span class="pd-dp-val">${h.statusBadge(e)}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Betrag</span><span class="pd-dp-val" style="font-weight:700">${
              e.coAnzeigeBetrag
                ? `CHF ${h.chf(e.totalBetrag)} <span style="font-size:11px;font-weight:400;color:#8896a5">(Lead ${h.chf(e.anzeigeBetrag)} + Co ${h.chf(e.coAnzeigeBetrag)})</span>`
                : e.anzeigeBetrag !== null ? `CHF ${h.chf(e.anzeigeBetrag)}` : "—"
            }</span></div>
            ${e.spesenBerechnet?`<div class="pd-dp-row"><span class="pd-dp-key">Wegspesen</span><span class="pd-dp-val">CHF ${h.chf(e.spesenBerechnet)}</span></div>`:""}
            <div class="pd-dp-row"><span class="pd-dp-key">Abrechnung</span><span class="pd-dp-val">${h.abrBadge(e.abrechnung)}</span></div>
            ${e.bemerkungen?`<div class="pd-dp-note">${h.esc(e.bemerkungen)}</div>`:""}
            <div class="pd-dp-footer">
              <button class="tm-btn tm-btn-sm" data-action="edit-einsatz" data-id="${e.id}">✎ Bearbeiten</button>
            </div>`;
        }
        if (tab === "konzeption") {
          const sel = state.ui.selectedProjektKonzId;
          const k = sel ? p.konzeintraege.find(k=>k.id===sel) : null;
          if (!k) return `<div class="pd-dp-empty"><div class="pd-dp-empty-icon">☰</div><span>Zeile auswählen für Details</span></div>`;
          return `
            <div class="pd-dp-title">${h.esc(k.title)}</div>
            <div class="pd-dp-row"><span class="pd-dp-key">Datum</span><span class="pd-dp-val">${h.esc(k.datumFmt)}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Kategorie</span><span class="pd-dp-val">${h.esc(k.kategorie)}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Person</span><span class="pd-dp-val">${h.esc(k.personName||"—")}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Aufwand</span><span class="pd-dp-val">${k.aufwandStunden!==null?k.aufwandStunden.toFixed(1)+" h":"—"}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Betrag</span><span class="pd-dp-val" style="font-weight:700">${k.anzeigeBetrag!==null?`CHF ${h.chf(k.anzeigeBetrag)}`:"—"}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Verrechenbar</span><span class="pd-dp-val">${h.verrBadge(k.verrechenbar)}</span></div>
            <div class="pd-dp-row"><span class="pd-dp-key">Abrechnung</span><span class="pd-dp-val">${h.abrBadge(k.abrechnung)}</span></div>
            ${k.bemerkungen?`<div class="pd-dp-note">${h.esc(k.bemerkungen)}</div>`:""}
            <div class="pd-dp-footer">
              <button class="tm-btn tm-btn-sm" data-action="edit-konzeption" data-id="${k.id}">✎ Bearbeiten</button>
            </div>`;
        }
        return `<div class="pd-dp-empty"><div class="pd-dp-empty-icon">☰</div><span>Stammdaten links einsehbar</span></div>`;
      };

      // ── Tab-Inhalt ─────────────────────────────────────────────────────────
      const tabContent = tab === "einsaetze" ? tabEinsaetze()
                       : tab === "konzeption" ? tabKonzeption()
                       : tabStammdaten();

      // ── Render ─────────────────────────────────────────────────────────────
      ui.render(`
        <style>
          /* ── Projekt-Detail 3-Panel-Layout ─────────────────────────────── */
          .pd-wrap { display:flex; flex-direction:column; height:calc(100vh - var(--tm-header-h, 52px)); overflow:hidden; }
          .pd-shell { display:flex; flex:1; min-height:0; overflow:hidden; }

          /* Mobile styles in app.css */
          .pd-mob-back { display:none; }

          /* Sidebar */
          .pd-sidebar { width:188px; min-width:188px; border-right:1px solid rgba(0,0,0,0.09); background:#fff; display:flex; flex-direction:column; overflow:hidden; }
          .pd-sb-search { padding:8px 10px; border-bottom:1px solid #dde3ea; }
          .pd-sb-search input { width:100%; padding:5px 9px; border:1px solid #dde3ea; border-radius:6px; font-size:12px; font-family:inherit; color:var(--tm-text); background:#f5f7fa; outline:none; }
          .pd-sb-search input:focus { border-color:#004078; background:#fff; }
          .pd-sb-scroll { flex:1; overflow-y:auto; }
          .pd-sb-sec { border-bottom:1px solid #dde3ea; padding:6px 0; }
          .pd-sb-lbl { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#8896a5; padding:2px 12px 5px; }
          .pd-sb-firma { display:flex; align-items:center; gap:8px; padding:6px 12px; cursor:pointer; border-left:2px solid transparent; font-size:12px; font-weight:600; color:var(--tm-text); white-space:nowrap; overflow:hidden; user-select:none; }
          .pd-sb-firma:hover { background:#f5f7fa; }
          .pd-sb-firma.has-active { border-left-color:#004078; background:#e6f1fb; color:#004078; }
          .pd-sb-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
          .pd-sb-firma-name { overflow:hidden; text-overflow:ellipsis; flex:1; }
          .pd-sb-firma-arrow { font-size:9px; color:#8896a5; flex-shrink:0; }
          .pd-sb-proj { display:flex; align-items:center; gap:6px; padding:5px 12px 5px 26px; cursor:pointer; border-left:2px solid transparent; font-size:12px; color:var(--tm-text); white-space:nowrap; overflow:hidden; }
          .pd-sb-proj:hover { background:#f5f7fa; }
          .pd-sb-proj.active { background:#e6f1fb; border-left-color:#004078; color:#004078; font-weight:600; }
          .pd-sb-proj-name { overflow:hidden; text-overflow:ellipsis; }
          .pd-sb-item { display:flex; align-items:center; gap:8px; padding:5px 12px; cursor:pointer; border-left:2px solid transparent; font-size:12px; color:var(--tm-text); white-space:nowrap; overflow:hidden; }
          .pd-sb-item:hover { background:#f5f7fa; }
          .pd-sb-item.active { background:#e6f1fb; border-left-color:#004078; color:#004078; font-weight:600; }
          .pd-sb-footer { padding:8px 10px; border-top:1px solid #dde3ea; }
          .pd-sb-new-btn { width:100%; padding:6px; background:#fff; color:#004078; border:1px solid #004078; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit; }
          .pd-sb-new-btn:hover { background:#e6f1fb; }

          /* Main */
          .pd-main { flex:1; display:flex; flex-direction:column; overflow:hidden; background:#e8ecf0; }
          .pd-topbar { display:flex; align-items:center; gap:8px; padding:8px 16px; border-bottom:1px solid rgba(0,0,0,0.09); background:#e8ecf0; flex-shrink:0; }
          .pd-topbar-actions { margin-left:auto; display:flex; gap:6px; }
          .pd-proj-header { padding:12px 16px 14px; border-bottom:1px solid rgba(0,0,0,0.09); background:#e8ecf0; flex-shrink:0; }
          .pd-proj-title { font-size:18px; font-weight:700; color:var(--tm-text); }
          .pd-proj-sub { display:flex; align-items:center; gap:6px; margin-top:3px; font-size:13px; color:var(--tm-text-muted); }
          .pd-kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:12px 16px; border-bottom:1px solid rgba(0,0,0,0.09); background:#e8ecf0; flex-shrink:0; }
          .pd-kpi { background:#fff; border-radius:8px; padding:10px 14px; border:1px solid var(--tm-blue-pale); }
          .pd-kpi-label { font-size:9px; font-weight:600; color:var(--tm-text-muted); text-transform:uppercase; letter-spacing:0.09em; margin-bottom:5px; }
          .pd-kpi-val { font-size:18px; font-weight:700; color:var(--tm-text); line-height:1.2; }
          .pd-kpi-sub { font-size:11px; color:var(--tm-text-muted); margin-top:3px; font-weight:600; }
          .pd-kpi-bar { height:3px; background:var(--tm-surface); border-radius:2px; margin-top:5px; }
          .pd-kpi-bar-fill { height:3px; border-radius:2px; }

          /* Karteikarten-Tabs */
          .pd-tabs-wrap { display:flex; align-items:flex-end; gap:2px; padding:10px 16px 0; background:#e8ecf0; border-bottom:2px solid rgba(0,0,0,0.12); flex-shrink:0; }
          .pd-tab { padding:8px 18px; font-size:13px; cursor:pointer; color:#8896a5; background:#dde1e7; border:1px solid rgba(0,0,0,0.12); border-bottom:none; border-radius:6px 6px 0 0; white-space:nowrap; position:relative; bottom:-2px; font-weight:600; font-family:inherit; transition:background 0.1s,color 0.1s; }
          .pd-tab:hover { background:#ced3da; color:#4a5568; }
          .pd-tab.active { background:#fff; color:#004078; font-weight:700; border-bottom-color:#fff; z-index:1; }

          /* Filter-Bar */
          .pd-filter-bar { display:flex; align-items:center; gap:8px; padding:8px 16px; border-bottom:1px solid var(--tm-blue-pale); flex-shrink:0; background:#fff; flex-wrap:wrap; }
          .pd-filter-label { font-size:12px; color:var(--tm-text-muted); white-space:nowrap; font-weight:600; }
          .pd-filter-select { padding:4px 26px 4px 9px; border:1px solid var(--tm-blue-pale); border-radius:6px; font-size:12px; font-weight:600; font-family:inherit; color:var(--tm-text); background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238896a5'/%3E%3C/svg%3E") no-repeat right 8px center; appearance:none; cursor:pointer; outline:none; }
          .pd-filter-select:focus { border-color:var(--tm-blue); }
          .pd-filter-reset { font-size:12px; color:var(--tm-text-muted); cursor:pointer; padding:3px 8px; border-radius:5px; border:1px solid transparent; font-weight:600; font-family:inherit; }
          .pd-filter-reset:hover { background:var(--tm-surface); color:var(--tm-text); border-color:var(--tm-blue-pale); }

          /* Tabelle */
          .pd-table-wrap { flex:1; overflow-y:auto; background:#fff; min-height:0; }
          .pd-section-row td { padding:5px 10px 4px; font-size:10px; font-weight:700; color:#8896a5; text-transform:uppercase; letter-spacing:0.07em; background:#e8ecf0; border-bottom:1px solid #dde3ea; border-top:1px solid #dde3ea; cursor:default; pointer-events:none; }
          .pd-section-row:hover td { background:#e8ecf0 !important; }
          .pd-table { width:100%; border-collapse:collapse; font-size:13px; font-family:inherit; }
          .pd-table th { padding:7px 10px; text-align:left; font-size:10px; font-weight:700; color:var(--tm-text-muted); text-transform:uppercase; letter-spacing:0.05em; border-bottom:1px solid var(--tm-blue-pale); white-space:nowrap; background:#fff; }
          .pd-table td { padding:9px 10px; border-bottom:1px solid var(--tm-blue-pale); color:var(--tm-text); vertical-align:middle; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; }
          .pd-row { cursor:pointer; }
          .pd-row:hover td { background:#f6f8fb; }
          .pd-row-sel td { background:var(--tm-blue-light) !important; border-top:1px solid #b8d4ed; border-bottom:1px solid #b8d4ed; }
          .pd-row-cancelled td { color:var(--tm-text-muted); text-decoration:line-through; }
          .pd-td-muted { color:var(--tm-text-muted) !important; }
          .pd-td-right { text-align:right !important; }
          .pd-nowrap { white-space:nowrap; }
          .pd-av { width:26px; height:26px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; flex-shrink:0; }
          .pd-av-lead { background:#B5D4F4; color:#0C447C; }
          .pd-av-co   { background:#CECBF6; color:#3C3489; margin-left:-7px; border:1.5px solid #fff; }
          .pd-person-name { font-size:12px; color:var(--tm-text-muted); margin-left:4px; }

          /* Stammdaten */
          .pd-stam-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:14px 16px; overflow-y:auto; background:#e8ecf0; flex:1; min-height:0; align-content:start; }
          .pd-stam-card { background:#fff; border-radius:8px; padding:12px 14px; border:1px solid rgba(0,0,0,0.09); }
          .pd-stam-full { grid-column:1/-1; }
          .pd-stam-title { font-size:10px; font-weight:700; color:var(--tm-text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:10px; }
          .pd-stam-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--tm-blue-pale); font-size:12px; }
          .pd-stam-row:last-child { border-bottom:none; }
          .pd-stam-key { color:var(--tm-text-muted); font-weight:600; }
          .pd-stam-val { color:var(--tm-text); font-weight:700; text-align:right; }

          /* Detail-Panel */
          .pd-detail { width:272px; min-width:272px; border-left:1px solid rgba(0,0,0,0.09); background:#fff; display:flex; flex-direction:column; overflow:hidden; }
          .pd-dp-head { display:flex; align-items:center; justify-content:space-between; padding:9px 14px; border-bottom:1px solid var(--tm-blue-pale); flex-shrink:0; }
          .pd-dp-label { font-size:10px; font-weight:700; color:var(--tm-text-muted); text-transform:uppercase; letter-spacing:0.06em; }
          .pd-dp-scroll { flex:1; overflow-y:auto; padding:14px; }
          .pd-dp-title { font-size:14px; font-weight:700; color:var(--tm-text); margin-bottom:14px; line-height:1.4; }
          .pd-dp-row { display:flex; justify-content:space-between; align-items:flex-start; padding:7px 0; border-bottom:1px solid var(--tm-blue-pale); }
          .pd-dp-row:last-child { border-bottom:none; }
          .pd-dp-key { font-size:12px; color:var(--tm-text-muted); font-weight:600; }
          .pd-dp-val { font-size:12px; color:var(--tm-text); text-align:right; max-width:160px; font-weight:600; }
          .pd-dp-note { margin-top:10px; padding:8px 10px; background:var(--tm-surface); border-radius:6px; font-size:12px; color:var(--tm-text-muted); line-height:1.5; }
          .pd-dp-footer { margin-top:16px; padding-top:12px; border-top:1px solid var(--tm-blue-pale); display:flex; gap:6px; }
          .pd-dp-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--tm-text-muted); font-size:13px; gap:8px; font-weight:600; }
          .pd-dp-empty-icon { font-size:28px; opacity:0.2; }
        </style>

        <div class="pd-wrap"><div class="pd-shell${state.ui.pdMobDetail ? " pd-mob-detail" : ""}">

          <!-- SIDEBAR -->
          <div class="pd-sidebar">
            <div class="pd-sb-search">
              <input type="search" placeholder="Suche Projekt oder Firma…"
                id="pd-sb-search" value="${h.esc(state.filters.projekte.search)}"
                data-search-key="projekte.search"
                oninput="h.searchInput('projekte.search',this.value)">
            </div>
            <div class="pd-sb-scroll">
              <div class="pd-sb-sec">
                <div class="pd-sb-lbl">Projekte</div>
                ${[["aktiv","Aktive"],["alle","Alle"],["archiviert","Archivierte"]].map(([val,lbl]) => `
                  <div class="pd-sb-item${state.filters.projekte.status===val?" active":""}" onclick="state.filters.projekte.status='${val}';ctrl.render()">
                    ${lbl}
                  </div>`).join("")}
              </div>
              <div class="pd-sb-sec" style="padding-bottom:2px">
                <div class="pd-sb-lbl">Firma / Projekt</div>
                ${firmenGruppen || `<div style="padding:8px 12px;font-size:12px;color:#8896a5">Keine Projekte</div>`}
              </div>
            </div>
            <div class="pd-sb-footer">
              <button class="pd-sb-new-btn" data-action="new-projekt">+ Neues Projekt</button>
            </div>
          </div>

          <!-- MAIN -->
          <div class="pd-main">
            <div class="pd-topbar">
              <button class="pd-mob-back tm-btn tm-btn-sm" data-action="pd-mob-back">← Projekte</button>
              <div class="pd-topbar-actions">
                <button class="tm-btn tm-btn-sm" data-action="edit-projekt" data-id="${p.id}">Bearbeiten</button>
                <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-einsatz" data-projekt-id="${p.id}">+ Einsatz</button>
                <button class="tm-btn tm-btn-sm" data-action="new-konzeption" data-projekt-id="${p.id}">+ Aufwand</button>
                <button class="tm-btn tm-btn-sm" data-action="open-abrechnung" data-projekt-id="${p.id}" style="background:var(--tm-green,#1D9E75);color:#fff;border-color:transparent">Abrechnung</button>
              </div>
            </div>

            <div class="pd-proj-header" data-action="pd-kpi-toggle" style="cursor:pointer">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div>
                  <div class="pd-proj-title">${h.esc(p.title)}</div>
                  <div class="pd-proj-sub">
                    <span style="color:var(--tm-blue);font-weight:700">${h.esc(p.firmaName)}</span>
                    <span>·</span>
                    <span>#${h.esc(p.projektNr||String(p.id))}</span>
                    ${h.projStatusBadge(p.status)}
                  </div>
                </div>
                <span class="pd-kpi-chevron">${state.ui.pdKpiOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            <div class="pd-kpis${state.ui.pdKpiOpen ? "" : " pd-kpis-collapsed"}">
              <div class="pd-kpi">
                <div class="pd-kpi-label">Total Umsatz</div>
                <div class="pd-kpi-val">CHF ${h.chf(p.totalBetrag)}</div>
                <div class="pd-kpi-sub">${p.einsaetzeCount} Einsätze${p.einsaetzeAbgerechnet ? ` · ${p.einsaetzeAbgerechnet} abgerechnet` : ""}</div>
              </div>
              <div class="pd-kpi">
                <div class="pd-kpi-label">Konzeptionsbudget</div>
                <div class="pd-kpi-val" style="font-size:16px;color:${pct!==null&&pct>=100?"var(--tm-red)":pct!==null&&pct>=80?"var(--tm-amber)":"var(--tm-text)"}">
                  ${p.konzBudgetH ? `${p.konzStunden.toFixed(1)} / ${p.konzBudgetH} h` : "—"}
                </div>
                ${pct!==null?`<div class="pd-kpi-sub" style="color:${pct>=100?"var(--tm-red)":pct>=80?"var(--tm-amber)":"var(--tm-text-muted)"}">${pct}% ${pct>=100?"⚠ überschritten":pct>=80?"⚠ Achtung":"im Rahmen"}</div>
                <div class="pd-kpi-bar"><div class="pd-kpi-bar-fill" style="width:${Math.min(pct,100)}%;background:${pct>=100?"var(--tm-red)":pct>=80?"var(--tm-amber)":"var(--tm-green)"}"></div></div>`:""}
              </div>
              <div class="pd-kpi">
                <div class="pd-kpi-label">Offen / abzurechnen</div>
                <div class="pd-kpi-val">CHF ${h.chf(p.einsaetze.filter(e=>e.abrechnung==="offen"&&!["abgesagt","abgesagt-chf"].includes(e.einsatzStatus)).reduce((s,e)=>s+(e.anzeigeBetrag||0),0))}</div>
                <div class="pd-kpi-sub">${p.einsaetze.filter(e=>e.abrechnung==="offen"&&!["abgesagt","abgesagt-chf"].includes(e.einsatzStatus)).length} Einsätze offen</div>
              </div>
            </div>

            <div class="pd-tabs-wrap">
              <button class="pd-tab${tab==="einsaetze"?" active":""}" data-tab="einsaetze" data-route="projekt-detail">Einsätze</button>
              <button class="pd-tab${tab==="konzeption"?" active":""}" data-tab="konzeption" data-route="projekt-detail">Konzeption &amp; Admin</button>
              <button class="pd-tab${tab==="stammdaten"?" active":""}" data-tab="stammdaten" data-route="projekt-detail">Stammdaten &amp; Ansätze</button>
            </div>

            <div style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;background:#e8ecf0">
              ${tabContent}
            </div>
          </div>

          <!-- DETAIL PANEL -->
          <div class="pd-detail">
            <div class="pd-dp-head">
              <div class="pd-dp-label">Details</div>
            </div>
            <div class="pd-dp-scroll">
              ${detailPanel()}
            </div>
          </div>

        </div></div>
      `);
    },

    einsaetze() {
      const f  = state.filters.einsaetze;
      const all = state.enriched.einsaetze;
      const selId = state.ui.selectedEinsatzId;
      const cols = state.ui.eiCols;

      // ── Filter-Optionen ────────────────────────────────────────────────────
      const jahre    = [...new Set(all.map(e => e.datum ? new Date(e.datum).getFullYear() : null).filter(Boolean))].sort((a,b)=>b-a);
      const firmen   = [...new Set(all.map(e => { const p = state.enriched.projekte.find(p=>p.id===e.projektLookupId); return p?.firmaName||""; }).filter(Boolean))].sort();
      const projekte = [...new Map(all.map(e => [e.projektLookupId, e.projektTitle])).entries()].filter(([,t])=>t).sort((a,b)=>a[1].localeCompare(b[1]));
      const personen = [...new Set([...all.map(e=>e.personName),...all.map(e=>e.coPersonName)].filter(n=>n&&n!=="—"))].sort();

      // ── Filter anwenden ────────────────────────────────────────────────────
      let list = [...all];
      if (f.search)        list = list.filter(e => { const p = state.enriched.projekte.find(p=>p.id===e.projektLookupId); return h.inc(e.title,f.search)||h.inc(e.projektTitle,f.search)||h.inc(e.personName,f.search)||h.inc(p?.firmaName||"",f.search); });
      if (f.jahr)          list = list.filter(e => e.datum && new Date(e.datum).getFullYear() === +f.jahr);
      if (f.firma)         list = list.filter(e => { const p = state.enriched.projekte.find(p=>p.id===e.projektLookupId); return p?.firmaName===f.firma; });
      if (f.projekt)       list = list.filter(e => e.projektLookupId === +f.projekt);
      if (f.einsatzStatus) list = list.filter(e => e.einsatzStatus===f.einsatzStatus);
      if (f.person)        list = list.filter(e => e.personName===f.person||e.coPersonName===f.person);
      if (f.abrechnung)    list = list.filter(e => e.abrechnung===f.abrechnung);

      // ── Sortierung ─────────────────────────────────────────────────────────
      const sort = state.ui.einsatzSort;
      const firmaOf = e => state.enriched.projekte.find(p=>p.id===e.projektLookupId)?.firmaName||"";
      list.sort((a,b) => {
        let va, vb;
        switch(sort.col) {
          case "datum":      va=h.toDate(a.datum);     vb=h.toDate(b.datum);     break;
          case "title":      va=a.title.toLowerCase(); vb=b.title.toLowerCase(); break;
          case "firma":      va=firmaOf(a).toLowerCase(); vb=firmaOf(b).toLowerCase(); break;
          case "betrag":     va=a.anzeigeBetrag??-1;   vb=b.anzeigeBetrag??-1;   break;
          case "status":     va=a.einsatzStatus;       vb=b.einsatzStatus;       break;
          case "abrechnung": va=a.abrechnung;          vb=b.abrechnung;          break;
          default:           va=h.toDate(a.datum);     vb=h.toDate(b.datum);
        }
        if (va===null||va===undefined) va = sort.col==="betrag"?-1:"";
        if (vb===null||vb===undefined) vb = sort.col==="betrag"?-1:"";
        const cmp = va<vb?-1:va>vb?1:0;
        return sort.dir==="asc" ? cmp : -cmp;
      });

      // ── Firma-Farben (deterministisch) ─────────────────────────────────────
      const COLORS = [
        {bg:"#dbeafe",tx:"#185FA5"},{bg:"#dcfce7",tx:"#3B6D11"},{bg:"#fef3c7",tx:"#854F0B"},
        {bg:"#fce7f3",tx:"#993556"},{bg:"#ede9fe",tx:"#534AB7"},{bg:"#ccfbf1",tx:"#0F6E56"},
        {bg:"#ffedd5",tx:"#854F0B"},{bg:"#fce7f3",tx:"#72243E"}
      ];
      const firmaColorMap = {};
      let ci = 0;
      list.forEach(e => { const fn = firmaOf(e); if (fn && !(fn in firmaColorMap)) firmaColorMap[fn] = COLORS[ci++ % COLORS.length]; });

      // ── Personen nach Häufigkeit sortiert ─────────────────────────────────
      const personCount = {};
      all.forEach(e => {
        if (e.personName && e.personName !== "—") personCount[e.personName] = (personCount[e.personName]||0) + 1;
        if (e.coPersonName && e.coPersonName !== "—") personCount[e.coPersonName] = (personCount[e.coPersonName]||0) + 1;
      });
      const personenSorted = [...new Set([...all.map(e=>e.personName),...all.map(e=>e.coPersonName)].filter(n=>n&&n!=="—"))]
        .sort((a,b) => (personCount[b]||0) - (personCount[a]||0));
      const top5 = personenSorted.slice(0, 5);
      const restPersonen = personenSorted.slice(5);

      const eiInitials = n => (n||"").split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
      const AVCOLORS = ["#B5D4F4:#0C447C","#CECBF6:#3C3489","#C0DD97:#3B6D11","#FAC775:#854F0B","#F4C0D1:#993556","#9FE1CB:#0F6E56","#F5C4B3:#993C1D","#D3D1C7:#444441"];
      const avColor = name => { const i = personenSorted.indexOf(name); const [bg,tx] = AVCOLORS[i % AVCOLORS.length].split(":"); return {bg,tx}; };

      const eiPersonItem = name => {
        const c = avColor(name);
        return `<div class="ei-sb-item${f.person===name?" active":""}" data-action="ei-filter" data-fkey="person" data-fval="${h.esc(name)}">
          <div class="ei-sb-av" style="background:${c.bg};color:${c.tx}">${eiInitials(name)}</div>
          <span class="ei-sb-iname">${h.esc(name)}</span>
        </div>`;
      };

      const eiFirmaItem = name => {
        const clr = firmaColorMap[name];
        return `<div class="ei-sb-item${f.firma===name?" active":""}" data-action="ei-filter" data-fkey="firma" data-fval="${h.esc(name)}">
          <div class="ei-sb-dot" style="background:${clr?.tx||"#8896a5"}"></div>
          <span class="ei-sb-iname">${h.esc(name)}</span>
        </div>`;
      };

      const eiSimple = (key, label, values) => `
        <div class="ei-sb-sec">
          <div class="ei-sb-lbl">${label}</div>
          ${values.map(([val,lbl]) => `<div class="ei-sb-item${f[key]===val?" active":""}" data-action="ei-filter" data-fkey="${key}" data-fval="${h.esc(val)}">
            <span class="ei-sb-iname">${h.esc(lbl)}</span>
          </div>`).join("")}
        </div>`;

      const hasFilter = f.search||f.jahr||f.firma||f.projekt||f.einsatzStatus||f.person||f.abrechnung;
      const totalBetrag = list.filter(e=>!["abgesagt","abgesagt-chf"].includes(e.einsatzStatus)).reduce((s,e)=>s+(e.totalBetrag||0),0);      // ── Detail-Panel Inhalt ────────────────────────────────────────────────
      const detailHtml = () => {
        const e = selId ? list.find(e=>e.id===selId) || all.find(e=>e.id===selId) : null;
        if (!e) return `<div class="ei-dp-empty"><div style="font-size:28px;opacity:0.2">☰</div><span>Zeile auswählen für Details</span></div>`;
        const proj = state.enriched.projekte.find(p=>p.id===e.projektLookupId);
        const initials = n => (n||"").split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        return `
          <div class="ei-dp-title">${h.esc(e.title||e.kategorie)}</div>
          <div class="ei-dp-sub">${h.esc(proj?.firmaName||"")}</div>
          <div class="ei-dp-row"><span class="ei-dp-key">Datum</span><span class="ei-dp-val">${h.esc(e.datumFmt)}</span></div>
          <div class="ei-dp-row"><span class="ei-dp-key">Projekt</span><span class="ei-dp-val">${h.esc(e.projektTitle||"—")}${proj?.projektNr?` #${proj.projektNr}`:""}</span></div>
          <div class="ei-dp-row"><span class="ei-dp-key">Kategorie</span><span class="ei-dp-val">${h.esc(e.kategorie)}</span></div>
          <div class="ei-dp-row"><span class="ei-dp-key">Person</span><span class="ei-dp-val">
            <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
              <span class="ei-av ei-av-lead">${initials(e.personName)}</span>
              ${e.coPersonName&&e.coPersonName!=="—"?`<span class="ei-av ei-av-co">${initials(e.coPersonName)}</span>`:""}
              <span style="font-size:12px">${h.esc(e.personName)}${e.coPersonName&&e.coPersonName!=="—"?` · ${h.esc(e.coPersonName)}`:""}</span>
            </div>
          </span></div>
          ${e.ort?`<div class="ei-dp-row"><span class="ei-dp-key">Ort</span><span class="ei-dp-val">${h.esc(e.ort)}</span></div>`:""}
          <div class="ei-dp-row"><span class="ei-dp-key">Status</span><span class="ei-dp-val">${h.statusBadge(e)}</span></div>
          <div class="ei-dp-row"><span class="ei-dp-key">Betrag</span><span class="ei-dp-val" style="font-weight:700">${e.anzeigeBetrag!==null?`CHF ${h.chf(e.anzeigeBetrag)}`:"—"}</span></div>
          ${e.spesenBerechnet?`<div class="ei-dp-row"><span class="ei-dp-key">Wegspesen</span><span class="ei-dp-val">CHF ${h.chf(e.spesenBerechnet)}</span></div>`:""}
          <div class="ei-dp-row"><span class="ei-dp-key">Abrechnung</span><span class="ei-dp-val">${h.abrBadge(e.abrechnung)}</span></div>
          ${e.bemerkungen?`<div class="ei-dp-note">${h.esc(e.bemerkungen)}</div>`:""}
          <div class="ei-dp-footer">
            <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="edit-einsatz" data-id="${e.id}">✎ Bearbeiten</button>
          </div>`;
      };

      // ── Zeilen ─────────────────────────────────────────────────────────────
      const eRow = e => {
        const proj = state.enriched.projekte.find(p=>p.id===e.projektLookupId);
        const fn   = proj?.firmaName||"";
        const clr  = firmaColorMap[fn];
        const isAbgesagt = ["abgesagt","abgesagt-chf"].includes(e.einsatzStatus);
        const isSel = e.id === selId;
        const initials = n => (n||"").split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        return `<tr class="ei-row${isSel?" ei-row-sel":""}${isAbgesagt?" ei-row-cancelled":""}" data-action="select-einsatz" data-id="${e.id}">
          <td class="ei-td-date">${h.esc(e.datumFmt)}</td>
          <td class="ei-td-proj">
            ${fn?`<span class="ei-firma-badge" style="background:${clr?.bg||"#f1f5f9"};color:${clr?.tx||"#475569"}">${h.esc(fn)}</span> `:""}
            <span class="ei-c2">${h.esc(e.projektTitle||"—")}${proj?.projektNr?` #${proj.projektNr}`:""}</span>
          </td>
          <td class="ei-td-desc">
            <span class="ei-c1">${h.esc(e.title||e.kategorie)}</span>
            <span class="ei-c-kat">${h.esc(e.kategorie)}</span>
            ${isAbgesagt?` ${h.badge("tm-badge tm-badge-cancelled","Abgesagt")}`:""}
          </td>
          <td class="ei-td-person">
            <div style="display:inline-flex;align-items:center;gap:3px">
              <span class="ei-av ei-av-lead">${initials(e.personName)}</span>
              ${e.coPersonName&&e.coPersonName!=="—"?`<span class="ei-av ei-av-co">${initials(e.coPersonName)}</span>`:""}
              <span class="ei-person-name">${h.esc(e.personName)}${e.coPersonName&&e.coPersonName!=="—"?` · ${h.esc(e.coPersonName)}`:""}</span>
            </div>
          </td>
          <td class="ei-td-ort ei-td-muted">${h.esc(e.ort||"—")}</td>
          <td class="ei-td-status">${h.statusBadge(e)}</td>
          <td class="ei-td-abr">${h.abrBadge(e.abrechnung)}</td>
        </tr>`;
      };

      ui.render(`
        <style>
          /* ── Einsätze 3-Panel ─────────────────────────────────────────────── */
          .ei-wrap { display:flex; flex-direction:column; height:calc(100vh - var(--tm-header-h,52px)); overflow:hidden; background:#fff; }
          .ei-shell { display:flex; flex:1; min-height:0; overflow:hidden; }

          /* Sidebar */
          .ei-sidebar { width:188px; min-width:188px; border-right:1px solid #dde3ea; background:#fff; display:flex; flex-direction:column; overflow:hidden; border-left:none; }
          .ei-sb-search { padding:8px 10px; border-bottom:1px solid #dde3ea; }
          .ei-sb-search input { width:100%; padding:5px 9px; border:1px solid #dde3ea; border-radius:6px; font-size:12px; font-family:inherit; color:var(--tm-text); background:#f5f7fa; outline:none; }
          .ei-sb-search input:focus { border-color:#004078; background:#fff; }
          .ei-sb-scroll { flex:1; overflow-y:auto; }
          .ei-sb-sec { border-bottom:1px solid #dde3ea; padding:6px 0; }
          .ei-sb-lbl { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#8896a5; padding:2px 12px 5px; }
          .ei-sb-item { display:flex; align-items:center; gap:8px; padding:5px 12px; cursor:pointer; border-left:2px solid transparent; font-size:12px; color:var(--tm-text); white-space:nowrap; overflow:hidden; }
          .ei-sb-item:hover { background:#f5f7fa; }
          .ei-sb-item.active { background:#e6f1fb; border-left-color:#004078; color:#004078; font-weight:600; }
          .ei-sb-iname { overflow:hidden; text-overflow:ellipsis; }
          .ei-sb-av { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:700; flex-shrink:0; }
          .ei-sb-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
          .ei-sb-mehr { display:flex; align-items:center; gap:5px; padding:4px 12px; cursor:pointer; color:#8896a5; font-size:12px; }
          .ei-sb-mehr:hover { color:var(--tm-text); }
          .ei-sb-reset { font-size:12px; color:#A32D2D; cursor:pointer; background:none; border:none; padding:0; font-family:inherit; font-weight:600; }

          /* Main */
          .ei-main { flex:1; display:flex; flex-direction:column; overflow:hidden; background:#fff; }
          .ei-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px 8px; background:#e8ecf0; flex-shrink:0; border-bottom:1px solid rgba(0,0,0,0.09); }
          .ei-title { font-size:18px; font-weight:700; color:var(--tm-text); flex:1; }
          .ei-meta { font-size:12px; color:#8896a5; }
          .ei-tbl-wrap { flex:1; overflow-y:auto; }
          table.ei-tbl { width:100%; border-collapse:collapse; font-size:13px; font-family:inherit; }
          .ei-tbl th { padding:6px 10px; text-align:left; font-size:10px; font-weight:700; color:#8896a5; text-transform:uppercase; letter-spacing:0.05em; border-bottom:1px solid #dde3ea; white-space:nowrap; background:#fff; position:sticky; top:0; z-index:1; cursor:pointer; user-select:none; }
          .ei-tbl th:hover { color:var(--tm-text); }
          .ei-tbl th.ei-th-active { color:#004078; }
          .ei-tbl td { padding:6px 10px; border-bottom:1px solid #f0f2f5; vertical-align:middle; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .ei-row { cursor:pointer; }
          .ei-row:hover td { background:#f6f8fb; }
          .ei-row-sel td { background:#e6f1fb !important; }
          .ei-row-cancelled td { color:#8896a5; }
          .ei-row-cancelled .ei-c1 { text-decoration:line-through; }

          /* Spalten-Breiten */
          .ei-td-date   { width:1px; white-space:nowrap; color:#8896a5; font-size:13px; padding-right:16px; }
          .ei-td-desc   { width:22%; }
          .ei-td-proj   { width:28%; }
          .ei-td-person { width:18%; }
          .ei-td-ort    { width:10%; }
          .ei-td-status { width:90px; min-width:90px; }
          .ei-td-abr    { width:90px; min-width:90px; }

          .ei-c1 { font-weight:600; font-size:13px; color:var(--tm-text); }
          .ei-c-kat { font-size:11px; color:#b0bac6; margin-left:5px; }
          .ei-c2 { font-size:11px; color:#8896a5; }
          .ei-firma-badge { display:inline-block; font-size:11px; font-weight:600; padding:1px 7px; border-radius:5px; white-space:nowrap; vertical-align:middle; }
          .ei-av { width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:9px; font-weight:700; flex-shrink:0; }
          .ei-av-lead { background:#B5D4F4; color:#0C447C; }
          .ei-av-co { background:#CECBF6; color:#3C3489; margin-left:-5px; border:1.5px solid #fff; }
          .ei-person-name { font-size:12px; color:#8896a5; margin-left:3px; }
          .ei-td-muted { color:#8896a5; font-size:12px; }

          /* Spalten ein/ausblenden via Klasse auf table */
          .ei-tbl.hide-ort      .ei-td-ort    { display:none; }
          .ei-tbl.hide-person   .ei-td-person  { display:none; }
          .ei-tbl.hide-status   .ei-td-status  { display:none; }
          .ei-tbl.hide-abr      .ei-td-abr     { display:none; }

          /* Gruppe Toggle */
          .ei-group-toggle { display:flex; border:1px solid #dde3ea; border-radius:6px; overflow:hidden; }
          .ei-group-toggle button { padding:4px 10px; font-size:12px; font-weight:600; font-family:inherit; background:#fff; border:none; cursor:pointer; color:#8896a5; }
          .ei-group-toggle button.active { background:#004078; color:#fff; }
          .ei-group-toggle button:hover:not(.active) { background:#f5f7fa; }

          /* Gruppen-Header */
          .ei-grp-hd td { background:#f0f4f8 !important; font-size:11px; font-weight:700; color:#004078; padding:6px 10px; border-top:2px solid #dde3ea; cursor:pointer; user-select:none; }
          .ei-grp-hd:hover td { background:#e6f1fb !important; }

          /* Detail Panel */
          .ei-detail { width:272px; min-width:272px; border-left:1px solid #dde3ea; background:#fff; display:flex; flex-direction:column; overflow:hidden; }
          .ei-dp-head { display:flex; align-items:center; justify-content:space-between; padding:9px 14px; border-bottom:1px solid #dde3ea; flex-shrink:0; }
          .ei-dp-label { font-size:10px; font-weight:700; color:#8896a5; text-transform:uppercase; letter-spacing:0.06em; }
          .ei-dp-scroll { flex:1; overflow-y:auto; padding:14px; }
          .ei-dp-title { font-size:14px; font-weight:700; color:var(--tm-text); margin-bottom:4px; line-height:1.4; }
          .ei-dp-sub { font-size:12px; color:#8896a5; margin-bottom:12px; font-weight:600; }
          .ei-dp-row { display:flex; justify-content:space-between; align-items:flex-start; padding:7px 0; border-bottom:1px solid #dde3ea; }
          .ei-dp-row:last-child { border-bottom:none; }
          .ei-dp-key { font-size:12px; color:#8896a5; font-weight:600; }
          .ei-dp-val { font-size:12px; color:var(--tm-text); text-align:right; max-width:160px; font-weight:600; }
          .ei-dp-note { margin-top:10px; padding:8px 10px; background:#f5f7fa; border-radius:6px; font-size:12px; color:#4a5568; line-height:1.5; }
          .ei-dp-footer { margin-top:16px; padding-top:12px; border-top:1px solid #dde3ea; display:flex; gap:6px; }
          .ei-dp-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#8896a5; font-size:13px; gap:8px; font-weight:600; }

          /* Mobile */
          @media(max-width:899px) {
            .ei-sidebar { display:none; }
            .ei-detail { display:none; }
          }
        </style>

        <div class="ei-wrap">
          <div class="ei-shell${state.ui.eiMobFilter ? " ei-mob-filter" : ""}">

            <!-- SIDEBAR -->
            <div class="ei-sidebar">
              <div class="ei-sb-search">
                <div class="ei-mob-filter-btn" style="align-items:center;justify-content:space-between;margin-bottom:8px">
                  <button class="tm-btn tm-btn-sm" data-action="ei-mob-filter-close">← Einsätze</button>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <input type="search" placeholder="Suche…" value="${h.esc(f.search||"")}"
                    data-search-key="einsaetze.search"
                    oninput="h.searchInput('einsaetze.search',this.value)"
                    style="flex:1">
                </div>
                ${hasFilter?`<button class="ei-sb-reset" data-action="reset-einsatz-filters" style="display:block;width:100%;margin-top:6px;padding:4px 0;text-align:center;border:1px dashed #f5b8b8;border-radius:6px;background:#fff8f8">✕ Filter löschen</button>`:""}
              </div>
              <div class="ei-sb-scroll">

                ${eiSimple("jahr", "Jahr", jahre.map(j=>[ String(j), String(j) ]))}

                <div class="ei-sb-sec">
                  <div class="ei-sb-lbl">Firma</div>
                  ${firmen.map(n => eiFirmaItem(n)).join("")}
                </div>

                <div class="ei-sb-sec">
                  <div class="ei-sb-lbl">Person</div>
                  ${top5.map(n => eiPersonItem(n)).join("")}
                  ${restPersonen.length ? `
                    <div class="ei-sb-mehr" onclick="
                      const l=this.nextElementSibling;
                      const open=l.style.display==='none';
                      l.style.display=open?'block':'none';
                      this.innerHTML=open?'▾ Weniger':'▸ + ${restPersonen.length} weitere';
                    ">▸ + ${restPersonen.length} weitere</div>
                    <div style="display:none">
                      ${restPersonen.map(n => eiPersonItem(n)).join("")}
                    </div>` : ""}
                </div>

                ${eiSimple("einsatzStatus", "Status", [["geplant","Geplant"],["durchgefuehrt","Durchgeführt"],["abgesagt","Abgesagt"],["abgesagt-chf","Abgesagt (CHF)"]])}
                ${eiSimple("abrechnung", "Abrechnung", state.choices.einsatzAbrechnung.map(v=>[v,v]))}

              </div>
            </div>

            <!-- MAIN -->
            <div class="ei-main">
              <div class="ei-toolbar">
                <div>
                  <div class="ei-title">${(() => {
                    const parts = [];
                    if (f.firma) parts.push(f.firma);
                    if (f.person) parts.push(f.person);
                    parts.push("Einsätze");
                    return parts.join(" · ");
                  })()}</div>
                  <div class="ei-meta">${list.length} Einträge · Total CHF ${h.chf(totalBetrag)}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <button class="tm-btn tm-btn-sm ei-mob-filter-btn${hasFilter?" tm-btn-primary":""}" data-action="ei-mob-filter">⚙ Filter${hasFilter?" ●":""}</button>
                  <div class="ei-group-toggle ei-mob-hide">
                    <button class="${!state.ui.eiGroupBy?"active":""}" onclick="state.ui.eiGroupBy=null;ctrl.render()">≡ Liste</button><button class="${state.ui.eiGroupBy==="projekt"?"active":""}" onclick="state.ui.eiGroupBy='projekt';ctrl.render()">⊟ Projekt</button>
                  </div>
                  <button class="tm-btn tm-btn-sm ei-mob-hide" onclick="ctrl.toggleEiColPicker()" title="Spalten" style="font-size:16px;padding:0 8px">⊞</button>
                  <button class="tm-btn tm-btn-sm tm-btn-primary ei-mob-hide" data-action="new-einsatz" data-projekt-id="">+ Einsatz</button>
                </div>
              </div>
              <div class="ei-tbl-wrap">
                <table class="ei-tbl${!cols.ort?" hide-ort":""}${!cols.person?" hide-person":""}${!cols.status?" hide-status":""}${!cols.abrechnung?" hide-abr":""}">
                  <thead><tr>
                    <th class="${sort.col==="datum"?"ei-th-active":""}" data-sort-col="datum" style="white-space:nowrap;width:1px">Datum ${sort.col==="datum"?(sort.dir==="asc"?"↑":"↓"):"↕"}</th>
                    <th class="${sort.col==="firma"?"ei-th-active":""}" data-sort-col="firma">Projekt / Firma ${sort.col==="firma"?(sort.dir==="asc"?"↑":"↓"):"↕"}</th>
                    <th class="${sort.col==="title"?"ei-th-active":""}" data-sort-col="title">Beschreibung ${sort.col==="title"?(sort.dir==="asc"?"↑":"↓"):"↕"}</th>
                    <th>Person</th>
                    <th class="ei-td-ort">Ort</th>
                    <th class="ei-td-status${sort.col==="status"?" ei-th-active":""}" data-sort-col="status">Status ${sort.col==="status"?(sort.dir==="asc"?"↑":"↓"):"↕"}</th>
                    <th class="ei-td-abr${sort.col==="abrechnung"?" ei-th-active":""}" data-sort-col="abrechnung">Abrechnung ${sort.col==="abrechnung"?(sort.dir==="asc"?"↑":"↓"):"↕"}</th>
                  </tr></thead>
                  <tbody>
                    ${(() => {
                      if (!list.length) return `<tr><td colspan="7" style="text-align:center;padding:32px;color:#8896a5">Keine Einsätze gefunden.</td></tr>`;
                      if (state.ui.eiGroupBy !== "projekt") return list.map(eRow).join("");
                      // Gruppiert nach Projekt
                      const groups = new Map();
                      list.forEach(e => {
                        const key = e.projektLookupId || 0;
                        if (!groups.has(key)) groups.set(key, { titel: e.projektTitle||"—", proj: state.enriched.projekte.find(p=>p.id===e.projektLookupId), items: [] });
                        groups.get(key).items.push(e);
                      });
                      const collapsed = state.ui.eiCollapsed || {};
                      return [...groups.entries()].map(([key, g]) => {
                        const fn = g.proj?.firmaName||"";
                        const clr = firmaColorMap[fn];
                        const total = g.items.filter(e=>!["abgesagt","abgesagt-chf"].includes(e.einsatzStatus)).reduce((s,e)=>s+(e.totalBetrag||0),0);
                        const isCollapsed = collapsed[key];
                        const badge = fn ? `<span class="ei-firma-badge" style="background:${clr?.bg||"#f1f5f9"};color:${clr?.tx||"#475569"}">${h.esc(fn)}</span> ` : "";
                        return `<tr class="ei-grp-hd" onclick="if(!state.ui.eiCollapsed)state.ui.eiCollapsed={};state.ui.eiCollapsed[${key}]=!state.ui.eiCollapsed[${key}];ctrl.render()">
                          <td colspan="7">${badge}${h.esc(g.titel)}${g.proj?.projektNr?` #${g.proj.projektNr}`:""} <span style="font-weight:400;color:#5a6a7a;margin-left:8px">${g.items.length} Einträge · CHF ${h.chf(total)}</span> <span style="float:right;opacity:.5">${isCollapsed?"▶":"▼"}</span></td>
                        </tr>
                        ${isCollapsed ? "" : g.items.map(eRow).join("")}`;
                      }).join("");
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- DETAIL -->
            <div class="ei-detail">
              <div class="ei-dp-head">
                <div class="ei-dp-label">Detail</div>
              </div>
              <div class="ei-dp-scroll">
                ${detailHtml()}
              </div>
            </div>

          </div>
        </div>
      `);
    },

    konzeption() {
      const f   = state.filters.konzeption;
      const all = state.enriched.konzeption;
      const selId = state.ui.selectedKonzId;
      const cols  = state.ui.kzCols;

      // ── Filter-Optionen ────────────────────────────────────────────────────
      const jahre   = [...new Set(all.map(k => k.datum ? new Date(k.datum).getFullYear() : null).filter(Boolean))].sort((a,b)=>b-a);
      const firmen  = [...new Set(all.map(k => { const p = state.enriched.projekte.find(p=>p.id===k.projektLookupId); return p?.firmaName||""; }).filter(Boolean))].sort();
      const projekte= [...new Map(all.map(k => [k.projektLookupId, k.projektTitle])).entries()].filter(([,t])=>t).sort((a,b)=>a[1].localeCompare(b[1]));
      const personen= [...new Set(all.map(k=>k.personName).filter(n=>n&&n!=="—"))].sort();

      // ── Filter anwenden ────────────────────────────────────────────────────
      let list = [...all];
      if (f.search)      list = list.filter(k => { const p = state.enriched.projekte.find(p=>p.id===k.projektLookupId); return h.inc(k.title,f.search)||h.inc(k.projektTitle,f.search)||h.inc(p?.firmaName||"",f.search); });
      if (f.jahr)        list = list.filter(k => k.datum && new Date(k.datum).getFullYear() === +f.jahr);
      if (f.firma)       list = list.filter(k => { const p = state.enriched.projekte.find(p=>p.id===k.projektLookupId); return p?.firmaName===f.firma; });
      if (f.projekt)     list = list.filter(k => k.projektLookupId === +f.projekt);
      if (f.verrechenbar)list = list.filter(k => k.verrechenbar === f.verrechenbar);
      if (f.person)      list = list.filter(k => k.personName === f.person);
      if (f.abrechnung)  list = list.filter(k => k.abrechnung === f.abrechnung);
      list.sort((a,b) => h.toDate(b.datum) - h.toDate(a.datum));

      // ── Firma-Farben ───────────────────────────────────────────────────────
      const COLORS = [
        {bg:"#dbeafe",tx:"#185FA5"},{bg:"#dcfce7",tx:"#3B6D11"},{bg:"#fef3c7",tx:"#854F0B"},
        {bg:"#fce7f3",tx:"#993556"},{bg:"#ede9fe",tx:"#534AB7"},{bg:"#ccfbf1",tx:"#0F6E56"},
        {bg:"#ffedd5",tx:"#854F0B"},{bg:"#fce7f3",tx:"#72243E"}
      ];
      const firmaColorMap = {};
      let ci = 0;
      const firmaOf = k => state.enriched.projekte.find(p=>p.id===k.projektLookupId)?.firmaName||"";
      list.forEach(k => { const fn = firmaOf(k); if (fn && !(fn in firmaColorMap)) firmaColorMap[fn] = COLORS[ci++ % COLORS.length]; });

      const hasFilter = f.search||f.jahr||f.firma||f.projekt||f.verrechenbar||f.person||f.abrechnung;
      const sumTotal  = list.reduce((s,k)=>s+(k.anzeigeBetrag||0),0);
      const sumVerr   = list.filter(k=>k.verrechenbar==="verrechenbar").reduce((s,k)=>s+(k.anzeigeBetrag||0),0);
      const sumStunden= list.reduce((s,k)=>s+(k.aufwandStunden||0),0);
      const sb = state.ui.sbOpen;

      // ── Personen nach Häufigkeit sortiert ─────────────────────────────────
      const personCount = {};
      all.forEach(k => { if (k.personName) personCount[k.personName] = (personCount[k.personName]||0) + 1; });
      const personenSorted = [...new Set(all.map(k=>k.personName).filter(n=>n&&n!=="—"))]
        .sort((a,b) => (personCount[b]||0) - (personCount[a]||0));
      const top5Personen = personenSorted.slice(0, 5);
      const restPersonen = personenSorted.slice(5);

      const initials = n => (n||"").split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
      const AVCOLORS = ["#B5D4F4:#0C447C","#CECBF6:#3C3489","#C0DD97:#3B6D11","#FAC775:#854F0B","#F4C0D1:#993556","#9FE1CB:#0F6E56","#F5C4B3:#993C1D","#D3D1C7:#444441"];
      const avColor = i => { const [bg,tx] = AVCOLORS[i % AVCOLORS.length].split(":"); return {bg,tx}; };

      const personItem = (name, idx) => {
        const c = avColor(personenSorted.indexOf(name));
        return `<div class="kz-sb-item${f.person===name?" active":""}" data-action="kz-filter" data-fkey="person" data-fval="${h.esc(name)}">
          <div class="kz-sb-av" style="background:${c.bg};color:${c.tx}">${initials(name)}</div>
          <span class="kz-sb-iname">${h.esc(name)}</span>
        </div>`;
      };

      const firmaItem = (name, idx) => {
        const clr = firmaColorMap[name];
        return `<div class="kz-sb-item${f.firma===name?" active":""}" data-action="kz-filter" data-fkey="firma" data-fval="${h.esc(name)}">
          <div class="kz-sb-dot" style="background:${clr?.tx||"#8896a5"}"></div>
          <span class="kz-sb-iname">${h.esc(name)}</span>
        </div>`;
      };

      const sbSimple = (key, label, values) => `
        <div class="kz-sb-sec">
          <div class="kz-sb-lbl">${label}</div>
          ${values.map(v => `<div class="kz-sb-item${f[key]===v?" active":""}" data-action="kz-filter" data-fkey="${key}" data-fval="${h.esc(v)}">
            <span class="kz-sb-iname">${h.esc(v)}</span>
          </div>`).join("")}
        </div>`;

      // ── Detail-Panel ───────────────────────────────────────────────────────
      const detailHtml = () => {
        const k = selId ? list.find(k=>k.id===selId) || all.find(k=>k.id===selId) : null;
        if (!k) return `<div class="kz-dp-empty"><div style="font-size:28px;opacity:0.2">☰</div><span>Zeile auswählen für Details</span></div>`;
        const proj = state.enriched.projekte.find(p=>p.id===k.projektLookupId);
        return `
          <div class="kz-dp-title">${h.esc(k.title)}</div>
          <div class="kz-dp-sub">${h.esc(proj?.firmaName||"")}${proj?.projektNr?` · #${proj.projektNr}`:""}</div>
          <div class="kz-dp-row"><span class="kz-dp-key">Datum</span><span class="kz-dp-val">${h.esc(k.datumFmt)}</span></div>
          <div class="kz-dp-row"><span class="kz-dp-key">Projekt</span><span class="kz-dp-val">${h.esc(k.projektTitle||"—")}</span></div>
          <div class="kz-dp-row"><span class="kz-dp-key">Kategorie</span><span class="kz-dp-val">${h.esc(k.kategorie)}</span></div>
          <div class="kz-dp-row"><span class="kz-dp-key">Person</span><span class="kz-dp-val">${h.esc(k.personName||"—")}</span></div>
          <div class="kz-dp-row"><span class="kz-dp-key">Aufwand</span><span class="kz-dp-val">${k.aufwandStunden!==null?k.aufwandStunden.toFixed(1)+" h":"—"}</span></div>
          <div class="kz-dp-row"><span class="kz-dp-key">Betrag</span><span class="kz-dp-val" style="font-weight:700">${k.anzeigeBetrag!==null?`CHF ${h.chf(k.anzeigeBetrag)}`:"—"}</span></div>
          <div class="kz-dp-row"><span class="kz-dp-key">Verrechenbar</span><span class="kz-dp-val">${h.verrBadge(k.verrechenbar)}</span></div>
          <div class="kz-dp-row"><span class="kz-dp-key">Abrechnung</span><span class="kz-dp-val">${h.abrBadge(k.abrechnung)}</span></div>
          ${k.bemerkungen?`<div class="kz-dp-note">${h.esc(k.bemerkungen)}</div>`:""}
          <div class="kz-dp-footer">
            <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="edit-konzeption" data-id="${k.id}">✎ Bearbeiten</button>
          </div>`;
      };

      // ── Zeilen ─────────────────────────────────────────────────────────────
      const kRow = k => {
        const proj = state.enriched.projekte.find(p=>p.id===k.projektLookupId);
        const fn   = proj?.firmaName||"";
        const clr  = firmaColorMap[fn];
        const isSel = k.id === selId;
        return `<tr class="kz-row${isSel?" kz-row-sel":""}" data-action="kz-select" data-id="${k.id}">
          <td class="kz-td-date">${h.esc(k.datumFmt)}</td>
          <td class="kz-td-proj">
            ${fn?`<span class="kz-firma-badge" style="background:${clr?.bg||"#f1f5f9"};color:${clr?.tx||"#475569"}">${h.esc(fn)}</span> `:""}
            <span class="kz-c2">${h.esc(k.projektTitle||"—")}${proj?.projektNr?` #${proj.projektNr}`:""}</span>
          </td>
          <td class="kz-td-desc"><span class="kz-c1">${h.esc(k.title)}</span></td>
          <td class="kz-td-person kz-td-muted">${h.esc(k.personName||"—")}</td>
          <td class="kz-td-katdauer kz-td-muted">${h.esc(k.kategorie)} · ${k.aufwandStunden!==null?k.aufwandStunden.toFixed(1)+" h":"—"}</td>
          <td class="kz-td-verrechenbar">${h.verrBadge(k.verrechenbar)}</td>
          <td class="kz-td-abr">${h.abrBadge(k.abrechnung)}</td>
        </tr>`;
      };

      ui.render(`
        <style>
          .kz-wrap { display:flex; flex-direction:column; height:calc(100vh - var(--tm-header-h,52px)); overflow:hidden; }
          .kz-shell { display:flex; flex:1; min-height:0; overflow:hidden; }
          .kz-sidebar { width:188px; min-width:188px; border-right:1px solid #dde3ea; background:#fff; display:flex; flex-direction:column; overflow:hidden; }
          .kz-sb-search { padding:8px 10px; border-bottom:1px solid #dde3ea; }
          .kz-sb-search input { width:100%; padding:5px 9px; border:1px solid #dde3ea; border-radius:6px; font-size:12px; font-family:inherit; color:var(--tm-text); background:#f5f7fa; outline:none; }
          .kz-sb-search input:focus { border-color:#004078; background:#fff; }
          .kz-sb-scroll { flex:1; overflow-y:auto; }
          .kz-sb-sec { border-bottom:1px solid #dde3ea; padding:6px 0; }
          .kz-sb-lbl { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#8896a5; padding:2px 12px 5px; }
          .kz-sb-item { display:flex; align-items:center; gap:8px; padding:5px 12px; cursor:pointer; border-left:2px solid transparent; font-size:12px; color:var(--tm-text); white-space:nowrap; overflow:hidden; }
          .kz-sb-item:hover { background:#f5f7fa; }
          .kz-sb-item.active { background:#e6f1fb; border-left-color:#004078; color:#004078; font-weight:600; }
          .kz-sb-iname { overflow:hidden; text-overflow:ellipsis; }
          .kz-sb-av { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:700; flex-shrink:0; }
          .kz-sb-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
          .kz-sb-mehr { display:flex; align-items:center; gap:5px; padding:4px 12px; cursor:pointer; color:#8896a5; font-size:12px; }
          .kz-sb-mehr:hover { color:var(--tm-text); }
          .kz-sb-footer { padding:8px 12px; border-top:1px solid #dde3ea; }
          .kz-sb-reset { font-size:12px; color:#A32D2D; cursor:pointer; background:none; border:none; padding:0; font-family:inherit; font-weight:600; }
          .kz-main { flex:1; display:flex; flex-direction:column; overflow:hidden; background:#fff; }
          .kz-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px 8px; background:#e8ecf0; flex-shrink:0; border-bottom:1px solid rgba(0,0,0,0.09); }
          .kz-title { font-size:18px; font-weight:700; color:var(--tm-text); }
          .kz-meta { font-size:12px; color:#8896a5; }
          .kz-tbl-wrap { flex:1; overflow-y:auto; }
          table.kz-tbl { width:100%; border-collapse:collapse; font-size:13px; font-family:inherit; }
          .kz-tbl th { padding:6px 10px; text-align:left; font-size:10px; font-weight:700; color:#8896a5; text-transform:uppercase; letter-spacing:0.05em; border-bottom:1px solid #dde3ea; white-space:nowrap; background:#fff; position:sticky; top:0; z-index:1; }
          .kz-tbl td { padding:6px 10px; border-bottom:1px solid #f0f2f5; vertical-align:middle; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .kz-row { cursor:pointer; }
          .kz-row:hover td { background:#f6f8fb; }
          .kz-row-sel td { background:#e6f1fb !important; }
          .kz-td-date     { width:1px; white-space:nowrap; color:#8896a5; font-size:13px; padding-right:16px; }
          .kz-td-proj     { width:22%; }
          .kz-td-desc     { width:30%; }
          .kz-td-person   { width:14%; }
          .kz-td-katdauer { width:14%; }
          .kz-td-verrechenbar { width:130px; }
          .kz-td-abr      { width:90px; }
          .kz-td-muted { color:#8896a5; font-size:12px; }
          .kz-c1 { font-weight:600; font-size:13px; color:var(--tm-text); }
          .kz-c2 { font-size:11px; color:#8896a5; }
          .kz-firma-badge { display:inline-block; font-size:11px; font-weight:600; padding:1px 7px; border-radius:5px; white-space:nowrap; vertical-align:middle; }
          /* Spalten ein/ausblenden */
          .kz-tbl.hide-person      .kz-td-person      { display:none; }
          .kz-tbl.hide-katdauer    .kz-td-katdauer    { display:none; }
          .kz-tbl.hide-verrechenbar .kz-td-verrechenbar { display:none; }
          .kz-tbl.hide-abr         .kz-td-abr         { display:none; }

          /* Gruppe Toggle */
          .kz-group-toggle { display:flex; border:1px solid #dde3ea; border-radius:6px; overflow:hidden; }
          .kz-group-toggle button { padding:4px 10px; font-size:12px; font-weight:600; font-family:inherit; background:#fff; border:none; cursor:pointer; color:#8896a5; }
          .kz-group-toggle button.active { background:#004078; color:#fff; }
          .kz-group-toggle button:hover:not(.active) { background:#f5f7fa; }

          /* Gruppen-Header */
          .kz-grp-hd td { background:#f0f4f8 !important; font-size:11px; font-weight:700; color:#004078; padding:6px 10px; border-top:2px solid #dde3ea; cursor:pointer; user-select:none; }
          .kz-grp-hd:hover td { background:#e6f1fb !important; }
          .kz-detail { width:272px; min-width:272px; border-left:1px solid #dde3ea; background:#fff; display:flex; flex-direction:column; overflow:hidden; }
          .kz-dp-head { display:flex; align-items:center; justify-content:space-between; padding:9px 14px; border-bottom:1px solid #dde3ea; flex-shrink:0; }
          .kz-dp-label { font-size:10px; font-weight:700; color:#8896a5; text-transform:uppercase; letter-spacing:0.06em; }
          .kz-dp-scroll { flex:1; overflow-y:auto; padding:14px; }
          .kz-dp-title { font-size:14px; font-weight:700; color:var(--tm-text); margin-bottom:4px; line-height:1.4; }
          .kz-dp-sub { font-size:12px; color:#8896a5; margin-bottom:12px; font-weight:600; }
          .kz-dp-row { display:flex; justify-content:space-between; align-items:flex-start; padding:7px 0; border-bottom:1px solid #dde3ea; }
          .kz-dp-row:last-child { border-bottom:none; }
          .kz-dp-key { font-size:12px; color:#8896a5; font-weight:600; }
          .kz-dp-val { font-size:12px; color:var(--tm-text); text-align:right; font-weight:600; }
          .kz-dp-note { margin-top:10px; padding:8px 10px; background:#f5f7fa; border-radius:6px; font-size:12px; color:#4a5568; line-height:1.5; }
          .kz-dp-footer { margin-top:16px; padding-top:12px; border-top:1px solid #dde3ea; display:flex; gap:6px; }
          .kz-dp-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#8896a5; font-size:13px; gap:8px; font-weight:600; }
          .kz-mob-filter-btn { display:none; }
          @media(max-width:899px) {
            .kz-sidebar { display:none !important; }
            .kz-detail  { display:none !important; }
            .kz-shell.kz-mob-filter .kz-sidebar { display:flex !important; width:100% !important; min-width:0 !important; border-right:none !important; }
            .kz-shell.kz-mob-filter .kz-main    { display:none !important; }
            .kz-mob-filter-btn { display:flex !important; }
          }
        </style>
        <div class="kz-wrap">
          <div class="kz-shell${state.ui.kzMobFilter?" kz-mob-filter":""}">

            <!-- SIDEBAR -->
            <div class="kz-sidebar">
              <div class="kz-sb-search">
                <div class="kz-mob-filter-btn" style="align-items:center;justify-content:space-between;margin-bottom:8px">
                  <button class="tm-btn tm-btn-sm" data-action="kz-mob-filter-close">← Konzeption</button>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <input type="search" placeholder="Suche…" value="${h.esc(f.search||"")}"
                    data-search-key="konzeption.search"
                    oninput="h.searchInput('konzeption.search',this.value)"
                    style="flex:1">
                </div>
                ${hasFilter?`<button class="kz-sb-reset" data-action="kz-reset-filters" style="display:block;width:100%;margin-top:6px;padding:4px 0;text-align:center;border:1px dashed #f5b8b8;border-radius:6px;background:#fff8f8">✕ Filter löschen</button>`:""}
              </div>
              <div class="kz-sb-scroll">

                ${sbSimple("jahr", "Jahr", jahre.map(j=>String(j)))}

                <div class="kz-sb-sec">
                  <div class="kz-sb-lbl">Firma</div>
                  ${firmen.map((n,i) => firmaItem(n,i)).join("")}
                </div>

                <div class="kz-sb-sec">
                  <div class="kz-sb-lbl">Person</div>
                  ${top5Personen.map((n,i) => personItem(n,i)).join("")}
                  ${restPersonen.length ? `
                    <div class="kz-sb-mehr" onclick="
                      const l=this.nextElementSibling;
                      const open=l.style.display==='none';
                      l.style.display=open?'block':'none';
                      this.innerHTML=open?'▾ Weniger':'▸ + ${restPersonen.length} weitere';
                    ">▸ + ${restPersonen.length} weitere</div>
                    <div style="display:none">
                      ${restPersonen.map((n,i) => personItem(n, top5Personen.length+i)).join("")}
                    </div>` : ""}
                </div>

                ${sbSimple("verrechenbar", "Verrechenbar", state.choices.konzVerrechenbar||[])}
                ${sbSimple("abrechnung",   "Abrechnung",   state.choices.konzAbrechnung||[])}

              </div>
              <div class="kz-sb-footer" style="display:none"></div>
            </div>

            <!-- MAIN -->
            <div class="kz-main">
              <div class="kz-toolbar">
                <div>
                  <div class="kz-title">${[f.firma,f.person].filter(Boolean).concat(["Konzeption & Admin"]).join(" · ")}</div>
                  <div class="kz-meta">${list.length} Einträge · ${sumStunden.toFixed(1)} h · CHF ${h.chf(sumVerr)} verrechenbar</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <button class="tm-btn tm-btn-sm kz-mob-filter-btn${hasFilter?" tm-btn-primary":""}" data-action="kz-mob-filter">⚙ Filter${hasFilter?" ●":""}</button>
                  <div class="kz-group-toggle kz-mob-hide">
                    <button class="${!state.ui.kzGroupBy?"active":""}" onclick="state.ui.kzGroupBy=null;ctrl.render()">≡ Liste</button><button class="${state.ui.kzGroupBy==="projekt"?"active":""}" onclick="state.ui.kzGroupBy='projekt';ctrl.render()">⊟ Projekt</button>
                  </div>
                  <button class="tm-btn tm-btn-sm kz-mob-hide" onclick="ctrl.toggleKzColPicker()" title="Spalten" style="font-size:16px;padding:0 8px">⊞</button>
                  <button class="tm-btn tm-btn-sm tm-btn-primary kz-mob-hide" data-action="new-konzeption" data-projekt-id="">+ Aufwand</button>
                </div>
              </div>
              <div class="kz-tbl-wrap">
                <table class="kz-tbl${!cols.person?" hide-person":""}${!cols.katdauer?" hide-katdauer":""}${!cols.verrechenbar?" hide-verrechenbar":""}${!cols.abrechnung?" hide-abr":""}">
                  <thead><tr>
                    <th style="width:1px;white-space:nowrap;padding-right:16px">Datum ↓</th>
                    <th class="kz-td-proj">Firma / Projekt</th>
                    <th class="kz-td-desc">Beschreibung</th>
                    <th class="kz-td-person">Person</th>
                    <th class="kz-td-katdauer">Kat. / Dauer</th>
                    <th class="kz-td-verrechenbar">Verrechenbar</th>
                    <th class="kz-td-abr">Abrechnung</th>
                  </tr></thead>
                  <tbody>
                    ${(() => {
                      if (!list.length) return `<tr><td colspan="7" style="text-align:center;padding:32px;color:#8896a5">Keine Einträge gefunden.</td></tr>`;
                      if (state.ui.kzGroupBy !== "projekt") return list.map(kRow).join("");
                      const groups = new Map();
                      list.forEach(k => {
                        const key = k.projektLookupId || 0;
                        if (!groups.has(key)) groups.set(key, { titel: k.projektTitle||"—", proj: state.enriched.projekte.find(p=>p.id===k.projektLookupId), items: [] });
                        groups.get(key).items.push(k);
                      });
                      const collapsed = state.ui.kzCollapsed || {};
                      return [...groups.entries()].map(([key, g]) => {
                        const fn = g.proj?.firmaName||"";
                        const clr = firmaColorMap[fn];
                        const totalH = g.items.reduce((s,k)=>s+(k.aufwandStunden||0),0);
                        const totalCHF = g.items.filter(k=>k.verrechenbar==="verrechenbar").reduce((s,k)=>s+(k.anzeigeBetrag||0),0);
                        const isCollapsed = collapsed[key];
                        const badge = fn ? `<span class="kz-firma-badge" style="background:${clr?.bg||"#f1f5f9"};color:${clr?.tx||"#475569"}">${h.esc(fn)}</span> ` : "";
                        return `<tr class="kz-grp-hd" onclick="if(!state.ui.kzCollapsed)state.ui.kzCollapsed={};state.ui.kzCollapsed[${key}]=!state.ui.kzCollapsed[${key}];ctrl.render()">
                          <td colspan="7">${badge}${h.esc(g.titel)}${g.proj?.projektNr?` #${g.proj.projektNr}`:""} <span style="font-weight:400;color:#5a6a7a;margin-left:8px">${g.items.length} Einträge · ${totalH.toFixed(1)} h · CHF ${h.chf(totalCHF)} verr.</span> <span style="float:right;opacity:.5">${isCollapsed?"▶":"▼"}</span></td>
                        </tr>
                        ${isCollapsed ? "" : g.items.map(kRow).join("")}`;
                      }).join("");
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- DETAIL -->
            <div class="kz-detail">
              <div class="kz-dp-head"><div class="kz-dp-label">Details</div></div>
              <div class="kz-dp-scroll">${detailHtml()}</div>
            </div>

          </div>
        </div>
      `);
    },

    abrechnungen() {
      const f   = state.filters.abrechnungen;
      const all = state.enriched.abrechnungen;
      const selId = state.ui.selectedAbrId;

      const jahre  = [...new Set(all.map(a => { const d=h.toDate(a.datum); return d?d.getFullYear():null; }).filter(Boolean))].sort((a,b)=>b-a);
      const firmen = [...new Set(all.map(a => { const p=state.enriched.projekte.find(p=>p.id===a.projektLookupId); return p?.firmaName||""; }).filter(Boolean))].sort();
      const projekte = [...new Map(all.map(a=>[a.projektLookupId,a.projektTitle])).entries()].filter(([,t])=>t).sort((a,b)=>a[1].localeCompare(b[1]));

      let list = [...all];
      if (f.search)  list = list.filter(a => { const p=state.enriched.projekte.find(p=>p.id===a.projektLookupId); return h.inc(a.title,f.search)||h.inc(a.projektTitle,f.search)||(p&&h.inc(p.firmaName,f.search)); });
      if (f.jahr)    list = list.filter(a => { const d=h.toDate(a.datum); return d&&String(d.getFullYear())===f.jahr; });
      if (f.firma)   list = list.filter(a => { const p=state.enriched.projekte.find(p=>p.id===a.projektLookupId); return p?.firmaName===f.firma; });
      if (f.projekt) list = list.filter(a => String(a.projektLookupId)===f.projekt);
      if (f.status)  list = list.filter(a => a.status===f.status);
      list.sort((a,b) => h.toDate(b.datum)-h.toDate(a.datum));

      // ── Firma-Farben ───────────────────────────────────────────────────────
      const COLORS = [
        {bg:"#dbeafe",tx:"#185FA5"},{bg:"#dcfce7",tx:"#3B6D11"},{bg:"#fef3c7",tx:"#854F0B"},
        {bg:"#fce7f3",tx:"#993556"},{bg:"#ede9fe",tx:"#534AB7"},{bg:"#ccfbf1",tx:"#0F6E56"},
        {bg:"#ffedd5",tx:"#854F0B"},{bg:"#fce7f3",tx:"#72243E"}
      ];
      const firmaColorMap = {};
      let ci = 0;
      firmen.forEach(fn => { firmaColorMap[fn] = COLORS[ci++ % COLORS.length]; });

      const hasFilter = f.search||f.jahr||f.firma||f.projekt||f.status;
      const total    = list.reduce((s,a)=>s+(a.totalBetrag||0),0);
      const byStatus = s => list.filter(a=>(a.status||"erstellt")===s).length;

      const abrStatusBadge = s => {
        const map={erstellt:"#B5D4F4:#0C447C",versendet:"#FEF3C7:#854F0B",bezahlt:"#D1FAE5:#0F6E56"};
        const [bg,tx]=(map[s]||"#f1f5f9:#475569").split(":");
        return `<span style="background:${bg};color:${tx};font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;white-space:nowrap">${h.esc(s||"erstellt")}</span>`;
      };

      const detailHtml = () => {
        const a = selId ? list.find(a=>a.id===selId)||all.find(a=>a.id===selId) : null;
        if (!a) return `<div class="abr-dp-empty"><div style="font-size:28px;opacity:0.2">☰</div><span>Abrechnung auswählen</span></div>`;
        const proj = state.enriched.projekte.find(p=>p.id===a.projektLookupId);
        const einsaetze = state.enriched.einsaetze.filter(e=>e.abrechnungLookupId===a.id);
        const konz = state.enriched.konzeption.filter(k=>k.abrechnungLookupId===a.id);
        const status = a.status||"erstellt";
        const flowBtns = ["erstellt","versendet","bezahlt"].map(s=>`<button class="abr-flow-btn${status===s?" abr-flow-active":""}" onclick="ctrl.abrSetStatus(${a.id},'${s}')">${h.esc(s)}</button>`).join("");
        return `
          <div class="abr-dp-title">${h.esc(a.title||a.datumFmt)}</div>
          <div class="abr-dp-sub">${h.esc(proj?.firmaName||"")}${proj?.projektNr?` · #${proj.projektNr}`:""}</div>
          <div class="abr-dp-flow">${flowBtns}</div>
          <div class="abr-dp-row"><span class="abr-dp-key">Datum</span><span class="abr-dp-val">${h.esc(a.datumFmt)}</span></div>
          <div class="abr-dp-row"><span class="abr-dp-key">Projekt</span><span class="abr-dp-val">${h.esc(a.projektTitle||"—")}</span></div>
          <div class="abr-dp-row"><span class="abr-dp-key">Status</span><span class="abr-dp-val">${abrStatusBadge(status)}</span></div>
          <div class="abr-dp-row"><span class="abr-dp-key">Total</span><span class="abr-dp-val" style="font-weight:700;color:#004078">CHF ${h.chf(a.totalBetrag||0)}</span></div>
          ${einsaetze.length?`<div class="abr-dp-row"><span class="abr-dp-key">Einsätze</span><span class="abr-dp-val">${einsaetze.length}</span></div>`:""}
          ${konz.length?`<div class="abr-dp-row"><span class="abr-dp-key">Konzeption</span><span class="abr-dp-val">${konz.length} Einträge</span></div>`:""}
          <div class="abr-dp-footer">
            <button class="tm-btn tm-btn-sm tm-btn-primary" onclick="ctrl.abrDownloadPdf(${a.id})">⬇ PDF</button>
            ${proj?`<button class="tm-btn tm-btn-sm" onclick="ctrl.openProjekt(${a.projektLookupId})">📋 Projekt</button>`:""}
            <button class="tm-btn tm-btn-sm" data-action="delete-abrechnung" data-id="${a.id}" style="color:var(--tm-red);margin-left:auto">🗑</button>
          </div>`;
      };

      const abrCard = a => {
        const proj = state.enriched.projekte.find(p=>p.id===a.projektLookupId);
        const isSel = a.id===selId;
        const status = a.status||"erstellt";
        return `<div class="abr-card${isSel?" abr-card-sel":""}" data-action="abr-select" data-id="${a.id}">
          <div class="abr-card-top">
            <div><div class="abr-card-title">${h.esc(a.title||a.datumFmt)}</div>
            <div class="abr-card-meta">${h.esc(proj?.firmaName||"")}${proj?.projektNr?` · #${proj.projektNr}`:""}</div></div>
            <div style="text-align:right;flex-shrink:0">
              <div class="abr-card-betrag">CHF ${h.chf(a.totalBetrag||0)}</div>
              <div style="margin-top:3px">${abrStatusBadge(status)}</div>
            </div>
          </div>
          <div class="abr-card-date">${h.esc(a.datumFmt)}</div>
        </div>`;
      };

      ui.render(`
        <style>
          .abr-wrap{display:flex;flex-direction:column;height:calc(100vh - var(--tm-header-h,52px));overflow:hidden}
          .abr-shell{display:flex;flex:1;min-height:0;overflow:hidden}
          .abr-sidebar{width:188px;min-width:188px;border-right:1px solid #dde3ea;background:#fff;display:flex;flex-direction:column;overflow:hidden}
          .abr-sb-search{padding:8px 10px;border-bottom:1px solid #dde3ea}
          .abr-sb-search input{width:100%;padding:5px 9px;border:1px solid #dde3ea;border-radius:6px;font-size:12px;font-family:inherit;color:var(--tm-text);background:#f5f7fa;outline:none}
          .abr-sb-search input:focus{border-color:#004078;background:#fff}
          .abr-sb-scroll{flex:1;overflow-y:auto}
          .abr-sb-sec{border-bottom:1px solid #dde3ea;padding:6px 0}
          .abr-sb-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#8896a5;padding:2px 12px 5px}
          .abr-sb-item{display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;border-left:2px solid transparent;font-size:12px;color:var(--tm-text);white-space:nowrap;overflow:hidden}
          .abr-sb-item:hover{background:#f5f7fa}
          .abr-sb-item.active{background:#e6f1fb;border-left-color:#004078;color:#004078;font-weight:600}
          .abr-sb-iname{overflow:hidden;text-overflow:ellipsis}
          .abr-sb-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
          .abr-sb-reset{font-size:12px;color:#A32D2D;cursor:pointer;background:none;border:none;padding:0;font-family:inherit;font-weight:600}
          .abr-main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:#e8ecf0}
          .abr-toolbar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px 8px;background:#e8ecf0;flex-shrink:0;border-bottom:1px solid rgba(0,0,0,0.09)}
          .abr-title{font-size:18px;font-weight:700;color:var(--tm-text)}
          .abr-meta{font-size:12px;color:#8896a5}
          .abr-kpis{display:flex;gap:10px;padding:10px 16px;background:#e8ecf0;flex-shrink:0;border-bottom:1px solid rgba(0,0,0,0.09)}
          .abr-kpi{flex:1;background:#fff;border-radius:8px;padding:8px 12px;border:1px solid rgba(0,0,0,0.09)}
          .abr-kpi-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8896a5;margin-bottom:3px}
          .abr-kpi-val{font-size:16px;font-weight:700;color:var(--tm-text)}
          .abr-kpi-val.green{color:#0F6E56}
          .abr-kpi-val.amber{color:#854F0B}
          .abr-cards{flex:1;overflow-y:auto;padding:10px 16px;display:flex;flex-direction:column;gap:8px}
          .abr-card{background:#fff;border-radius:8px;padding:10px 14px;border:1px solid rgba(0,0,0,0.09);cursor:pointer;transition:box-shadow .1s}
          .abr-card:hover{box-shadow:0 2px 8px rgba(0,64,120,.1)}
          .abr-card-sel{border-color:#004078;box-shadow:inset 3px 0 0 #004078}
          .abr-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:4px}
          .abr-card-title{font-size:13px;font-weight:700;color:var(--tm-text)}
          .abr-card-meta{font-size:11px;color:#8896a5;margin-top:2px}
          .abr-card-betrag{font-size:14px;font-weight:700;color:#004078;white-space:nowrap}
          .abr-card-date{font-size:11px;color:#8896a5}
          .abr-detail{width:272px;min-width:272px;border-left:1px solid #dde3ea;background:#fff;display:flex;flex-direction:column;overflow:hidden}
          .abr-dp-head{display:flex;align-items:center;padding:9px 14px;border-bottom:1px solid #dde3ea;flex-shrink:0}
          .abr-dp-label{font-size:10px;font-weight:700;color:#8896a5;text-transform:uppercase;letter-spacing:0.06em}
          .abr-dp-scroll{flex:1;overflow-y:auto;padding:14px}
          .abr-dp-title{font-size:14px;font-weight:700;color:var(--tm-text);margin-bottom:4px}
          .abr-dp-sub{font-size:12px;color:#8896a5;margin-bottom:10px;font-weight:600}
          .abr-dp-flow{display:flex;gap:4px;margin-bottom:12px}
          .abr-flow-btn{flex:1;padding:5px 6px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid #dde3ea;background:#f5f7fa;color:#8896a5;cursor:pointer;font-family:inherit;text-align:center}
          .abr-flow-btn:hover{background:#e6f1fb;color:#004078;border-color:#004078}
          .abr-flow-active{background:#004078!important;color:#fff!important;border-color:#004078!important}
          .abr-dp-row{display:flex;justify-content:space-between;align-items:flex-start;padding:7px 0;border-bottom:1px solid #dde3ea}
          .abr-dp-row:last-of-type{border-bottom:none}
          .abr-dp-key{font-size:12px;color:#8896a5;font-weight:600}
          .abr-dp-val{font-size:12px;color:var(--tm-text);text-align:right;font-weight:600}
          .abr-dp-footer{margin-top:16px;padding-top:12px;border-top:1px solid #dde3ea;display:flex;gap:6px;flex-wrap:wrap}
          .abr-dp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#8896a5;font-size:13px;gap:8px;font-weight:600}
          .abr-mob-filter-btn{display:none}
          @media(max-width:899px){
            .abr-sidebar{display:none!important}
            .abr-detail{display:none!important}
            .abr-shell.abr-mob-filter .abr-sidebar{display:flex!important;width:100%!important;min-width:0!important;border-right:none!important}
            .abr-shell.abr-mob-filter .abr-main{display:none!important}
            .abr-mob-filter-btn{display:flex!important}
            .abr-kpis{gap:6px;padding:8px 12px;overflow-x:auto}
            .abr-sb-head input{display:none!important}
          }
        </style>
        <div class="abr-wrap">
          <div class="abr-shell${state.ui.abrMobFilter?" abr-mob-filter":""}">
            <div class="abr-sidebar">
              <div class="abr-sb-search">
                <div class="abr-mob-filter-btn" style="align-items:center;justify-content:space-between;margin-bottom:8px">
                  <button class="tm-btn tm-btn-sm" data-action="abr-mob-filter-close">← Zurück</button>
                </div>
                <input type="search" placeholder="Suche…" value="${h.esc(f.search||"")}" data-search-key="abrechnungen.search" oninput="h.searchInput('abrechnungen.search',this.value)">
                ${hasFilter?`<button class="abr-sb-reset" data-action="abr-reset-filters" style="display:block;width:100%;margin-top:6px;padding:4px 0;text-align:center;border:1px dashed #f5b8b8;border-radius:6px;background:#fff8f8">✕ Filter löschen</button>`:""}
              </div>
              <div class="abr-sb-scroll">

                <div class="abr-sb-sec">
                  <div class="abr-sb-lbl">Jahr</div>
                  ${jahre.map(j => `<div class="abr-sb-item${f.jahr===String(j)?" active":""}" data-action="abr-filter" data-fkey="jahr" data-fval="${j}">
                    <span class="abr-sb-iname">${j}</span>
                  </div>`).join("")}
                </div>

                <div class="abr-sb-sec">
                  <div class="abr-sb-lbl">Firma</div>
                  ${firmen.map(fn => {
                    const clr = firmaColorMap[fn];
                    return `<div class="abr-sb-item${f.firma===fn?" active":""}" data-action="abr-filter" data-fkey="firma" data-fval="${h.esc(fn)}">
                      <div class="abr-sb-dot" style="background:${clr?.tx||"#8896a5"}"></div>
                      <span class="abr-sb-iname">${h.esc(fn)}</span>
                    </div>`;
                  }).join("")}
                </div>

                <div class="abr-sb-sec">
                  <div class="abr-sb-lbl">Status</div>
                  ${[["erstellt","Erstellt"],["versendet","Versendet"],["bezahlt","Bezahlt"]].map(([val,lbl]) => `
                    <div class="abr-sb-item${f.status===val?" active":""}" data-action="abr-filter" data-fkey="status" data-fval="${val}">
                      <span class="abr-sb-iname">${lbl}</span>
                    </div>`).join("")}
                </div>

              </div>
            </div>
            <div class="abr-main">
              <div class="abr-toolbar">
                <div>
                  <div class="abr-title">${[f.firma,f.status].filter(Boolean).concat(["Abrechnungen"]).join(" · ")}</div>
                  <div class="abr-meta">${list.length} Einträge · CHF ${h.chf(total)}</div>
                </div>
                <button class="tm-btn tm-btn-sm abr-mob-filter-btn${hasFilter?" tm-btn-primary":""}" data-action="abr-mob-filter">⚙ Filter${hasFilter?" ●":""}</button>
              </div>
              <div class="abr-kpis">
                <div class="abr-kpi"><div class="abr-kpi-label">Total</div><div class="abr-kpi-val">CHF ${h.chf(total)}</div></div>
                <div class="abr-kpi"><div class="abr-kpi-label">Erstellt</div><div class="abr-kpi-val amber">${byStatus("erstellt")}</div></div>
                <div class="abr-kpi"><div class="abr-kpi-label">Versendet</div><div class="abr-kpi-val amber">${byStatus("versendet")}</div></div>
                <div class="abr-kpi"><div class="abr-kpi-label">Bezahlt</div><div class="abr-kpi-val green">${byStatus("bezahlt")}</div></div>
              </div>
              <div class="abr-cards">
                ${list.length?list.map(abrCard).join(""):`<div style="text-align:center;padding:32px;color:#8896a5;font-size:13px;font-weight:600">Keine Abrechnungen gefunden.</div>`}
              </div>
            </div>
            <div class="abr-detail">
              <div class="abr-dp-head"><div class="abr-dp-label">Detail</div></div>
              <div class="abr-dp-scroll">${detailHtml()}</div>
            </div>
          </div>
        </div>
      `);
    },

    // ── Abrechnung Erstellen — Inline-Seite (ersetzt Modal) ───────────────
    abrechnungErstellen(projektId) {
      const p = state.enriched.projekte.find(p => p.id === projektId);
      if (!p) { ctrl.navigate("abrechnungen"); return; }

      ctrl._initAeUpdateTotal();

      const einsaetze = state.enriched.einsaetze
        .filter(e => e.projektLookupId === projektId && e.einsatzStatus !== "abgesagt")
        .filter(e => ["offen","zur Abrechnung"].includes(e.abrechnung))
        .sort((a,b) => h.toDate(a.datum) - h.toDate(b.datum));

      const konzVerr = state.enriched.konzeption
        .filter(k => k.projektLookupId === projektId && k.verrechenbar === "verrechenbar")
        .filter(k => ["offen","zur Abrechnung"].includes(k.abrechnung))
        .sort((a,b) => h.toDate(a.datum) - h.toDate(b.datum));

      const konzKlaer = state.enriched.konzeption
        .filter(k => k.projektLookupId === projektId && k.verrechenbar === "Klärung nötig")
        .sort((a,b) => h.toDate(a.datum) - h.toDate(b.datum));

      const konzAlle = state.enriched.konzeption.filter(k => k.projektLookupId === projektId);
      const konzTotalBetrag = konzAlle.reduce((s,k) => s+(k.anzeigeBetrag||0), 0);
      const konzVerrBetrag  = konzAlle.filter(k => k.verrechenbar==="verrechenbar").reduce((s,k) => s+(k.anzeigeBetrag||0), 0);
      const konzKlaerBetrag = konzAlle.filter(k => k.verrechenbar==="Klärung nötig").reduce((s,k) => s+(k.anzeigeBetrag||0), 0);
      const konzTotalStd    = konzAlle.reduce((s,k) => s+(k.aufwandStunden||0), 0);
      const konzVerrStd     = konzAlle.filter(k => k.verrechenbar==="verrechenbar").reduce((s,k) => s+(k.aufwandStunden||0), 0);
      const konzKlaerStd    = konzAlle.filter(k => k.verrechenbar==="Klärung nötig").reduce((s,k) => s+(k.aufwandStunden||0), 0);
      const today = new Date().toISOString().slice(0,10);

      // Aktiver Tab + Auswahl: state merken
      if (!state.ui.aeTab) state.ui.aeTab = "einsaetze";
      if (!state.ui.aeSelected) state.ui.aeSelected = h.newAeSelected();
      const tab = state.ui.aeTab;
      const sel = state.ui.aeSelected;

      // ── Tab-Inhalte ────────────────────────────────────────────────────────
      const tabEinsaetze = () => `
        <div class="ae-tab-body">
          ${einsaetze.length ? `
          <div class="ae-list-hd">
            <label class="ae-check-all"><input type="checkbox" id="ae-check-all"
              ${sel.einsaetze.size > 0 ? "checked" : ""}
              onchange="document.querySelectorAll('.ae-e-cb').forEach(cb=>{cb.checked=this.checked});ctrl.aeSaveSelection();aeUpdateTotal()"> Alle</label>
          </div>
          <div class="ae-list">
            ${einsaetze.map(e => {
              const honorar = (e.anzeigeBetrag||0) + (e.coAnzeigeBetrag||0);
              const spesen  = e.spesenBerechnet || 0;
              const hasSpesen = spesen > 0;
              return `<label class="ae-row">
                <input type="checkbox" class="ae-cb ae-e-cb"
                  data-id="${e.id}" data-honorar="${honorar}" data-betrag="${honorar}" data-spesen="${spesen}"
                  ${sel.einsaetze.has(e.id) ? "checked" : ""}
                  onchange="ctrl.aeSaveSelection();aeUpdateTotal()">
                <div class="ae-row-main">
                  <div class="ae-row-top">
                    <span class="ae-row-date">${h.esc(e.datumFmt)}</span>
                    <span class="ae-row-title">${h.esc(e.title || e.kategorie)}</span>
                    <span class="ae-row-amt">${h.chf(honorar)}</span>
                  </div>
                  <div class="ae-row-sub">
                    <span>${h.esc(e.personName||"")}${(e.coPersonName&&e.coPersonName!=="—")?` · Co: ${h.esc(e.coPersonName)}`:""}</span>
                    <span>${h.esc(e.kategorie)}</span>
                    ${hasSpesen ? `<span style="color:#1a8a5e">Spesen: CHF ${h.chf(spesen)}</span>` : ""}
                  </div>
                </div>
              </label>`;
            }).join("")}
          </div>
          <div class="ae-subtotal-row">
            <span>Honorar: <strong id="ae-einsatz-honorar">CHF 0.00</strong></span>
            <span>Wegspesen: <strong id="ae-einsatz-spesen-sub" style="color:#1a8a5e">CHF 0.00</strong></span>
            <span class="ae-subtotal-lbl">Total: <strong id="ae-einsatz-total" style="color:#004078;font-size:15px">CHF 0.00</strong></span>
          </div>` : `<div class="ae-empty">Keine offenen Einsätze vorhanden.</div>`}
        </div>`;

      const tabKonzeption = () => `
        <div class="ae-tab-body">
          ${konzKlaer.length ? `
          <div class="ae-klaer-section">
            <div class="ae-klaer-hd">Klärung nötig (${konzKlaer.length}) — <span style="color:#b45309">CHF ${h.chf(konzKlaerBetrag)} · ${konzKlaerStd.toFixed(1)} h</span></div>
            ${konzKlaer.map(k => `
            <div class="ae-klaer-row" id="ae-kl-${k.id}">
              <div class="ae-row-main" style="flex:1">
                <div class="ae-row-top">
                  <span class="ae-row-date">${h.esc(k.datumFmt)}</span>
                  <span class="ae-row-title">${h.esc(k.title)}</span>
                  <span class="ae-row-amt">${h.chf(k.anzeigeBetrag)}</span>
                </div>
                <div class="ae-row-sub"><span>${k.aufwandStunden ? k.aufwandStunden.toFixed(1) + " h" : "—"}</span></div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0;margin-top:4px">
                <button class="ae-kl-btn verr" onclick="ctrl.aeKlaerungEntscheid(${k.id},'verrechenbar',this,${projektId})">→ verrechenbar</button>
                <button class="ae-kl-btn inkl" onclick="ctrl.aeKlaerungEntscheid(${k.id},'Inklusive (ohne Verrechnung)',this,${projektId})">→ inklusive</button>
              </div>
            </div>`).join("")}
          </div>` : ""}
          <div class="ae-konz-kpi">
            <div class="ae-kc"><div class="ae-kc-lbl">Total</div><div class="ae-kc-val">CHF ${h.chf(konzTotalBetrag)}</div><div class="ae-kc-sub">${konzTotalStd.toFixed(1)} h</div></div>
            <div class="ae-kc verr"><div class="ae-kc-lbl">Verrechenbar</div><div class="ae-kc-val">CHF ${h.chf(konzVerrBetrag)}</div><div class="ae-kc-sub">${konzVerrStd.toFixed(1)} h</div></div>
          </div>
          ${konzVerr.length ? `
          <div class="ae-list-hd">
            <label class="ae-check-all"><input type="checkbox" id="ae-konz-check-all"
              ${sel.konzeption.size > 0 ? "checked" : ""}
              onchange="document.querySelectorAll('.ae-k-cb').forEach(cb=>{cb.checked=this.checked});ctrl.aeSaveSelection();aeUpdateTotal()"> Alle verrechenbaren</label>
          </div>
          <div class="ae-list">
            ${konzVerr.map(k => `
            <label class="ae-row">
              <input type="checkbox" class="ae-cb ae-k-cb" data-id="${k.id}" data-betrag="${k.anzeigeBetrag||0}"
                ${sel.konzeption.has(k.id) ? "checked" : ""}
                onchange="ctrl.aeSaveSelection();aeUpdateTotal()">
              <div class="ae-row-main">
                <div class="ae-row-top">
                  <span class="ae-row-date">${h.esc(k.datumFmt)}</span>
                  <span class="ae-row-title">${h.esc(k.title)}</span>
                  <span class="ae-row-amt">${h.chf(k.anzeigeBetrag)}</span>
                </div>
                <div class="ae-row-sub"><span>${k.aufwandStunden ? k.aufwandStunden.toFixed(1) + " h" : "—"}</span><span>${h.esc(k.kategorie)}</span></div>
              </div>
            </label>`).join("")}
          </div>
          <div class="ae-subtotal-row">
            <span class="ae-subtotal-lbl">Konzeption gewählt: <strong id="ae-konz-total" style="color:#004078;font-size:15px">CHF 0.00</strong></span>
          </div>` : `<div class="ae-empty">Keine verrechenbaren Konzeptionsaufwände.</div>`}
        </div>`;

      const tabSpesen = () => `
        <div class="ae-tab-body">
          <div style="padding:16px">
            <div class="ae-field-row">
              <label class="ae-field-lbl">Betrag CHF</label>
              <input type="number" id="ae-zusatz-betrag" step="0.01" min="0" placeholder="0.00"
                value="${sel.zusatzBetrag || ""}"
                style="width:130px;padding:9px 12px;font-size:14px;font-weight:600;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;font-family:inherit;outline:none"
                oninput="ctrl.aeSaveSelection();aeUpdateTotal()">
            </div>
            <div class="ae-field-row" style="margin-top:12px">
              <label class="ae-field-lbl">Beschreibung</label>
              <input type="text" id="ae-zusatz-bem" placeholder="z.B. Parkgebühren, ÖV, Material…"
                value="${h.esc(sel.zusatzBem || "")}"
                style="flex:1;padding:9px 12px;font-size:13px;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;font-family:inherit;outline:none"
                oninput="ctrl.aeSaveSelection()">
            </div>
          </div>
          <div class="ae-subtotal-row">
            <span class="ae-subtotal-lbl">Zusatzspesen: <strong id="ae-spesen-hd" style="color:#004078;font-size:15px">CHF 0.00</strong></span>
          </div>
        </div>`;

      ui.render(`
        <div class="ae-page">
          <style>
            .ae-page{max-width:760px;margin:0 auto;display:flex;flex-direction:column;height:calc(100vh - 56px)}
            /* Header */
            .ae-hdr{background:#004078;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;flex-shrink:0}
            .ae-hdr-l{display:flex;flex-direction:column}
            .ae-hdr-t{color:#fff;font-size:14px;font-weight:700}
            .ae-hdr-s{color:rgba(255,255,255,.6);font-size:11px;margin-top:1px}
            .ae-datum-row{display:flex;align-items:center;gap:8px}
            .ae-datum-lbl{color:rgba(255,255,255,.7);font-size:12px;font-weight:600}
            .ae-datum-inp{padding:5px 10px;border-radius:7px;border:1.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;font-family:inherit;font-size:13px;font-weight:600;outline:none;width:130px;-webkit-appearance:none;color-scheme:dark}
            /* Back */
            .ae-back{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#004078;background:none;border:none;cursor:pointer;padding:10px 16px 4px;font-family:inherit;flex-shrink:0}
            /* Tabs */
            .ae-tabs{display:flex;border-bottom:2px solid #dde4ec;background:#fff;flex-shrink:0}
            .ae-tab{flex:1;padding:10px 4px;font-family:inherit;font-size:12px;font-weight:600;color:#8896a5;background:none;border:none;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:2px}
            .ae-tab.active{color:#004078;border-bottom-color:#004078}
            .ae-tab-badge{font-size:10px;font-weight:700;background:#e8f1f9;color:#004078;border-radius:20px;padding:1px 6px}
            .ae-tab.active .ae-tab-badge{background:#004078;color:#fff}
            /* Tab content — scrollable */
            .ae-tab-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
            /* List rows */
            .ae-list{display:flex;flex-direction:column}
            .ae-list-hd{display:flex;justify-content:flex-end;padding:8px 16px 4px;border-bottom:1px solid #f0f4f8}
            .ae-row{display:flex;align-items:flex-start;gap:12px;padding:11px 16px;border-bottom:1px solid #f0f4f8;cursor:pointer;transition:background .12s}
            .ae-row:hover{background:#f8fafc}
            .ae-row input[type=checkbox]{margin-top:3px;flex-shrink:0;width:16px;height:16px;accent-color:#004078;cursor:pointer}
            .ae-row-main{flex:1;min-width:0}
            .ae-row-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
            .ae-row-date{font-size:11px;color:#8896a5;white-space:nowrap;flex-shrink:0}
            .ae-row-title{font-size:13px;font-weight:600;color:#1a2332;flex:1;min-width:0}
            .ae-row-amt{font-size:13px;font-weight:700;color:#1a2332;white-space:nowrap;margin-left:auto}
            .ae-row-sub{display:flex;gap:10px;flex-wrap:wrap;margin-top:3px;font-size:11px;color:#8896a5}
            /* Subtotal */
            .ae-subtotal-row{display:flex;justify-content:flex-end;align-items:center;gap:16px;padding:10px 16px;background:#f8fafc;border-top:1.5px solid #dde4ec;font-size:12px;color:#8896a5;flex-shrink:0}
            .ae-check-all{display:flex;align-items:center;gap:6px;font-size:12px;color:#8896a5;cursor:pointer}
            .ae-empty{font-size:13px;color:#8896a5;padding:20px 16px;font-style:italic}
            /* Konzeption KPI */
            .ae-konz-kpi{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 16px;border-bottom:1px solid #f0f4f8}
            .ae-kc{background:#f4f7fb;border-radius:8px;padding:9px 12px}
            .ae-kc-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#8896a5;margin-bottom:3px}
            .ae-kc-val{font-size:14px;font-weight:700;color:#1a2332}
            .ae-kc-sub{font-size:11px;color:#8896a5}
            .ae-kc.verr .ae-kc-val{color:#1a8a5e}
            /* Klärung */
            .ae-klaer-section{border-bottom:1px solid #f0f4f8;background:#fffbf0}
            .ae-klaer-hd{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#b45309;padding:8px 16px 4px}
            .ae-klaer-row{display:flex;flex-direction:column;padding:10px 16px;border-bottom:1px solid #f5e6c8;gap:6px}
            .ae-kl-btn{padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;border:1.5px solid #dde4ec;background:#fff;cursor:pointer;font-family:inherit;transition:all .15s}
            .ae-kl-btn.verr{border-color:rgba(26,138,94,.4);color:#1a8a5e}
            .ae-kl-btn.inkl{border-color:rgba(107,114,128,.4);color:#6b7280}
            /* Spesen-Felder */
            .ae-field-row{display:flex;align-items:center;gap:12px}
            .ae-field-lbl{font-size:12px;font-weight:600;color:#8896a5;width:100px;flex-shrink:0}
            /* Footer */
            .ae-footer{background:#fff;border-top:2px solid #dde4ec;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap}
            .ae-footer-sums{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#8896a5;align-items:center}
            .ae-footer-sums strong{color:#004078;font-size:12px}
            .ae-footer-r{display:flex;align-items:center;gap:10px}
            .ae-footer-grand{font-size:17px;font-weight:700;color:#004078}
            .ae-footer-grand-lbl{font-size:10px;color:#8896a5;text-transform:uppercase;letter-spacing:.4px}
            .ae-btn-c{padding:7px 14px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;background:none;border:1.5px solid #dde4ec;color:#4a5568;cursor:pointer}
            .ae-btn-s{padding:7px 20px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:700;background:#1D9E75;border:none;color:#fff;cursor:pointer}
          </style>

          <button class="ae-back" onclick="ctrl.openProjekt(${p.id})">← ${h.esc(p.title)}</button>

          <div class="ae-hdr">
            <div class="ae-hdr-l">
              <span class="ae-hdr-t">Abrechnung erstellen</span>
              <span class="ae-hdr-s">${h.esc(p.firmaName||"")} · ${h.esc(p.title)}</span>
            </div>
            <div class="ae-datum-row">
              <span class="ae-datum-lbl">Datum</span>
              <input type="date" class="ae-datum-inp" id="ae-datum" value="${today}">
            </div>
          </div>

          <div class="ae-tabs">
            <button class="ae-tab${tab==="einsaetze"?" active":""}" onclick="ctrl.aeSetTab('einsaetze',${projektId})">
              Einsätze <span class="ae-tab-badge">${einsaetze.length}</span>
            </button>
            <button class="ae-tab${tab==="konzeption"?" active":""}" onclick="ctrl.aeSetTab('konzeption',${projektId})">
              Konzeption <span class="ae-tab-badge">${konzVerr.length + konzKlaer.length}</span>
            </button>
            <button class="ae-tab${tab==="spesen"?" active":""}" onclick="ctrl.aeSetTab('spesen',${projektId})">
              Zusatzspesen
            </button>
          </div>

          ${tab==="einsaetze" ? tabEinsaetze() : tab==="konzeption" ? tabKonzeption() : tabSpesen()}

          <div class="ae-footer">
            <div class="ae-footer-sums">
              <span>Honorar: <strong id="ae-ft-honorar">CHF 0.00</strong></span>
              <span>Wegspesen: <strong id="ae-ft-wegspesen">CHF 0.00</strong></span>
              <span>Konzeption: <strong id="ae-ft-konz">CHF 0.00</strong></span>
              <span>Zusatzspesen: <strong id="ae-ft-zusatz">CHF 0.00</strong></span>
            </div>
            <div class="ae-footer-r">
              <div style="text-align:right">
                <div class="ae-footer-grand-lbl">Total</div>
                <div class="ae-footer-grand" id="ae-grand-total">CHF 0.00</div>
              </div>
              <button class="ae-btn-c" onclick="ctrl.openProjekt(${p.id})">Abbrechen</button>
              <button class="ae-btn-s" onclick="ctrl.aeAbrechnen(${projektId})">✓ Abrechnen</button>
            </div>
          </div>
        </div>
      `);
      window.aeUpdateTotal();
    },

    firmen() {
      const f    = state.filters.firmen;
      const all  = [...state.data.firms];
      const selId = state.ui.selectedFirmaId;

      // ── Helpers ────────────────────────────────────────────────────────────
      const hatProjekt = fi => state.enriched.projekte.some(p => p.firmaLookupId === fi.id && !p.archiviert);

      const matchFirma = (fi, q) => {
        if (!q) return true;
        if (h.inc(fi.title, q) || h.inc(fi.ort, q) || h.inc(fi.klassifizierung, q)) return true;
        return state.data.contacts.some(c => c.firmaLookupId === fi.id &&
          (h.inc([c.vorname, c.nachname].join(" "), q) || h.inc(c.funktion, q)));
      };

      const lastContact = fi => {
        const ids = new Set(state.data.contacts.filter(c => c.firmaLookupId === fi.id).map(c => c.id));
        const hist = state.data.history.filter(h2 => ids.has(h2.kontaktId));
        if (!hist.length) return null;
        return hist.map(h2 => h.toDate(h2.datum)).reduce((a, b) => a > b ? a : b);
      };

      const daysSince = d => d ? Math.round((Date.now() - d) / 86400000) : 9999;
      const fmtSince = d => {
        if (!d) return "—";
        const diff = daysSince(d);
        if (diff === 0) return "Heute";
        if (diff === 1) return "Gestern";
        if (diff < 7)  return `vor ${diff} d`;
        if (diff < 30) return `vor ${Math.round(diff/7)} Wo.`;
        if (diff < 365) return `vor ${Math.round(diff/30)} Mon.`;
        return `vor ${Math.round(diff/365)} J.`;
      };

      const klColor = k => k === "Akquisition" ? "#7c3aed" : k === "A-Kunde" ? "#1a6e40" : k === "B-Kunde" ? "#1a52a0" : k === "C-Kunde" ? "#6b7280" : "#9ca3af";
      const klBg    = k => k === "Akquisition" ? "#ede9fe" : k === "A-Kunde" ? "#dcfce7" : k === "B-Kunde" ? "#dbeafe" : k === "C-Kunde" ? "#f3f4f6" : "#f9fafb";

      // ── Filter ─────────────────────────────────────────────────────────────
      let list = [...all];
      if (f.search)          list = list.filter(fi => matchFirma(fi, f.search));
      if (f.klassifizierung) list = list.filter(fi => fi.klassifizierung === f.klassifizierung);
      if (f.vip === "ja")    list = list.filter(fi => fi.vip);
      if (f.anzeigen === "projekte")   list = list.filter(fi => state.enriched.projekte.some(p => p.firmaLookupId === fi.id));
      if (f.anzeigen === "crm")        list = list.filter(fi => {
        const ids = new Set(state.data.contacts.filter(c => c.firmaLookupId === fi.id && !c.archiviert).map(c => c.id));
        if (!ids.size) return false;
        return state.data.history.some(h2 => ids.has(h2.kontaktId)) ||
               state.data.tasks.some(t => ids.has(t.kontaktId) && t.status !== "erledigt");
      });

      // Sortierung: Akquisition > A > B > C > Rest, dann alphabetisch
      const klRank = k => k === "Akquisition" ? 0 : k === "A-Kunde" ? 1 : k === "B-Kunde" ? 2 : k === "C-Kunde" ? 3 : 4;

      const klassifizierungen = ["Akquisition","A-Kunde","B-Kunde","C-Kunde"].filter(kl => all.some(fi => fi.klassifizierung === kl));
      const hasFilter = f.search || f.klassifizierung || f.vip || f.anzeigen;

      // ── Sortierung ─────────────────────────────────────────────────────────
      const fiSort = state.ui.fiSort;
      list.sort((a, b) => {
        let va, vb;
        const projA = state.enriched.projekte.filter(p => p.firmaLookupId === a.id).length;
        const projB = state.enriched.projekte.filter(p => p.firmaLookupId === b.id).length;
        const lcA = lastContact(a); const lcB = lastContact(b);
        const naechsterA = state.enriched.einsaetze.filter(e => { const p = state.enriched.projekte.find(p=>p.id===e.projektLookupId); return p?.firmaLookupId===a.id&&h.toDate(e.datum)>=h.todayStart()&&!["abgesagt","abgesagt-chf"].includes(e.einsatzStatus); }).sort((x,y)=>h.toDate(x.datum)-h.toDate(y.datum))[0];
        const naechsterB = state.enriched.einsaetze.filter(e => { const p = state.enriched.projekte.find(p=>p.id===e.projektLookupId); return p?.firmaLookupId===b.id&&h.toDate(e.datum)>=h.todayStart()&&!["abgesagt","abgesagt-chf"].includes(e.einsatzStatus); }).sort((x,y)=>h.toDate(x.datum)-h.toDate(y.datum))[0];
        switch(fiSort.col) {
          case "name":    va=a.title.toLowerCase(); vb=b.title.toLowerCase(); break;
          case "seg":     va=klRank(a.klassifizierung); vb=klRank(b.klassifizierung); break;
          case "crm":     va=lcA?lcA.getTime():0; vb=lcB?lcB.getTime():0; break;
          case "kont":    va=state.data.contacts.filter(c=>c.firmaLookupId===a.id&&!c.archiviert).length; vb=state.data.contacts.filter(c=>c.firmaLookupId===b.id&&!c.archiviert).length; break;
          case "proj":    va=projA; vb=projB; break;
          case "next":    va=naechsterA?h.toDate(naechsterA.datum).getTime():Infinity; vb=naechsterB?h.toDate(naechsterB.datum).getTime():Infinity; break;
          default:        va=a.title.toLowerCase(); vb=b.title.toLowerCase();
        }
        const cmp = va<vb?-1:va>vb?1:0;
        return fiSort.dir==="asc"?cmp:-cmp;
      });

      const fiSortIcon = col => fiSort.col===col?(fiSort.dir==="asc"?"↑":"↓"):"↕";
      const fiSortTh = (col, label, cls="") =>
        `<th class="${cls}${fiSort.col===col?" fi-th-active":""}" onclick="const s=state.ui.fiSort;s.dir=s.col==='${col}'?(s.dir==='asc'?'desc':'asc'):'asc';s.col='${col}';ctrl.render()">${label} ${fiSortIcon(col)}</th>`;

      // ── Zeilen ─────────────────────────────────────────────────────────────
      const fiTblRow = fi => {
        const isSel = fi.id === selId;
        const kl = fi.klassifizierung || "";
        const kontakte = state.data.contacts.filter(c => c.firmaLookupId === fi.id && !c.archiviert).length;
        const projekte = state.enriched.projekte.filter(p => p.firmaLookupId === fi.id).length;
        const aktivProj = state.enriched.projekte.filter(p => p.firmaLookupId === fi.id && !p.archiviert).length;
        const lc = lastContact(fi);
        const d = daysSince(lc);
        const dotCol = !lc ? "#e5e7eb" : d <= 30 ? "#16a34a" : d <= 90 ? "#d97706" : "#dc2626";
        const naechster = state.enriched.einsaetze
          .filter(e => { const p = state.enriched.projekte.find(p=>p.id===e.projektLookupId); return p?.firmaLookupId===fi.id&&h.toDate(e.datum)>=h.todayStart()&&!["abgesagt","abgesagt-chf"].includes(e.einsatzStatus); })
          .sort((a,b)=>h.toDate(a.datum)-h.toDate(b.datum))[0];
        return `<tr class="fi-tbl-row${isSel?" fi-row-sel":""}" data-action="fi-select" data-id="${fi.id}">
          <td class="fi-td-name">
            <span class="fi-dot-sig" style="background:${dotCol}"></span>${h.esc(fi.title)}${fi.vip?` <span class="fi-vip">VIP</span>`:""}
            ${fi.ort?`<div style="font-size:11px;color:#9ca3af;margin-top:1px;padding-left:14px">${h.esc(fi.ort)}</div>`:""}
          </td>
          <td class="fi-td-seg">${kl?`<span class="fi-kl" style="background:${klBg(kl)};color:${klColor(kl)}">${h.esc(kl)}</span>`:""}</td>
          <td class="fi-td-crm">${fmtSince(lc)}</td>
          <td class="fi-td-kont">${kontakte}</td>
          <td class="fi-td-proj">${aktivProj > 0 ? `<span style="color:#374151;font-weight:500">${aktivProj} aktiv</span>` : projekte > 0 ? `${projekte} archiv.` : `<span style="color:#e5e7eb">—</span>`}</td>
          <td class="fi-td-next">${naechster?`<span style="color:#374151;font-weight:500;margin-right:4px">${h.esc(naechster.datumFmt)}</span><span style="color:#8896a5">${h.esc(naechster.title||naechster.kategorie)}</span>`:`<span style="color:#e5e7eb">—</span>`}</td>
        </tr>`;
      };

      // ── Detail-Panel ───────────────────────────────────────────────────────
      const detailHtml = () => {
        const fi = selId ? all.find(fi => fi.id === selId) : null;
        if (!fi) return `<div class="fi-dp-empty"><div style="font-size:40px;opacity:.08;margin-bottom:10px">🏢</div><div>Firma auswählen</div></div>`;

        const projekte = state.enriched.projekte.filter(p => p.firmaLookupId === fi.id && !p.archiviert);
        const aktiv    = projekte.filter(p => p.status === "aktiv").length;
        const kontakte = state.data.contacts.filter(c => c.firmaLookupId === fi.id && !c.archiviert);
        const ids = new Set(kontakte.map(c => c.id));
        const offTasks = state.data.tasks.filter(t => ids.has(t.kontaktId) && t.status !== "erledigt");
        const naechster = state.enriched.einsaetze
          .filter(e => { const p = state.enriched.projekte.find(p => p.id === e.projektLookupId); return p?.firmaLookupId === fi.id && h.toDate(e.datum) >= h.todayStart() && !["abgesagt","abgesagt-chf"].includes(e.einsatzStatus); })
          .sort((a, b) => h.toDate(a.datum) - h.toDate(b.datum))[0];
        const lc  = lastContact(fi);
        const d   = daysSince(lc);
        const dotCol = !hatProjekt(fi) ? "#9ca3af" : d <= 30 ? "#16a34a" : d <= 90 ? "#d97706" : "#dc2626";
        const kl  = fi.klassifizierung || "";
        const init2 = n => n.split(/[\s,]+/).filter(Boolean).map(w => w[0]).slice(0,2).join("").toUpperCase();

        return `
          <div class="fi-dp-firm">
            <div class="fi-dp-avatar" style="background:${klBg(kl)||"#f3f4f6"};color:${klColor(kl)||"#9ca3af"}">
              ${h.esc(fi.title.split(/[\s-]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase())}
            </div>
            <div>
              <div class="fi-dp-name">${h.esc(fi.title)}</div>
              <div class="fi-dp-loc">${[fi.ort, kl].filter(Boolean).join(" · ")}</div>
            </div>
          </div>

          <div class="fi-dp-nums">
            <div class="fi-dp-num" style="background:#e6f1fb;border-radius:6px">
              <div style="font-size:18px;font-weight:800;color:#004078">${aktiv||projekte.length}</div>
              <div style="font-size:10px;color:#185FA5">TM-Projekte</div>
            </div>
            <div class="fi-dp-num" style="background:#f3f4f6;border-radius:6px">
              <div style="font-size:18px;font-weight:800;color:#374151">${kontakte.length}</div>
              <div style="font-size:10px;color:#6b7280">Kontakte</div>
            </div>
            <div class="fi-dp-num" style="background:${offTasks.length>0?"#fef3c7":"#f3f4f6"};border-radius:6px">
              <div style="font-size:18px;font-weight:800;color:${offTasks.length>0?"#b45309":"#374151"}">${offTasks.length}</div>
              <div style="font-size:10px;color:${offTasks.length>0?"#b45309":"#6b7280"}">CRM-Tasks</div>
            </div>
          </div>

          ${naechster ? `
          <div class="fi-dp-next" style="background:#e6f1fb;border:1px solid #b5d4f4;border-radius:7px;padding:7px 10px;cursor:pointer" onclick="ctrl.openProjekt(${state.enriched.projekte.find(p=>p.id===naechster.projektLookupId)?.id||0})">
            <div style="font-size:11px;font-weight:700;color:#004078">▶ ${h.esc(naechster.datumFmt)}</div>
            <div style="font-size:11px;color:#004078;opacity:.8">${h.esc(naechster.title || naechster.kategorie)}</div>
            <div style="font-size:10px;color:#8896a5;margin-top:2px">${h.esc(state.enriched.projekte.find(p=>p.id===naechster.projektLookupId)?.title||"")}</div>
          </div>` : ""}

          <div class="fi-dp-divider"></div>

          ${projekte.filter(p=>p.status==="aktiv").length ? `
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#9ca3af;margin-bottom:5px">Tailormade-Projekte</div>
            ${projekte.filter(p=>p.status==="aktiv").map(p=>`
              <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f3f4f6;cursor:pointer" onclick="ctrl.openProjekt(${p.id})">
                <span style="font-size:12px;font-weight:600;color:#004078;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.esc(p.title)}</span>
                <span style="font-size:11px;color:#9ca3af;margin-left:8px;flex-shrink:0">CHF ${h.chf(Math.round(p.totalBetrag))}</span>
              </div>`).join("")}
            <div class="fi-dp-divider" style="margin-top:8px"></div>` : ""}

          ${(() => {
            const recentActs = state.data.history
              .filter(h2 => ids.has(h2.kontaktId))
              .sort((a,b) => h.toDate(b.datum)-h.toDate(a.datum))
              .slice(0,3);
            if (!recentActs.length) return "";
            const rows = recentActs.map(a => {
              const c = state.data.contacts.find(c2 => c2.id === a.kontaktId);
              const name = c ? [c.vorname,c.nachname].filter(Boolean).join(" ") : "";
              return `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #f3f4f6">
                <div style="font-size:11px;color:#9ca3af;white-space:nowrap;padding-top:1px;min-width:50px">${h.esc(h.fmtDate(a.datum))}</div>
                <div style="font-size:12px;color:#374151">${h.esc([name,a.typ].filter(Boolean).join(" · ")||"—")}</div>
              </div>`;
            }).join("");
            return `<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#9ca3af;margin-bottom:5px">Letzte Aktivitäten</div>
              ${rows}
              <div style="font-size:12px;color:#6b7280;cursor:pointer;padding:5px 0"
                onclick="window.open('https://markusbaechler.github.io/crm-spa','_blank')">→ alle Aktivitäten in CRM</div>`;
          })()}

          <div class="fi-dp-divider"></div>

          ${kontakte.length ? kontakte.slice(0,5).map(c => `
            <div class="fi-dp-contact">
              <div class="fi-dp-av">${h.esc(init2([c.vorname,c.nachname].filter(Boolean).join(" ")))}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.esc([c.vorname,c.nachname].filter(Boolean).join(" "))}</div>
                ${c.funktion?`<div style="font-size:10px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.esc(c.funktion)}</div>`:""}
              </div>
            </div>`).join("") : ""}
          ${kontakte.length > 5 ? `<div style="font-size:12px;color:#004078;padding:6px 0;cursor:pointer" onclick="ctrl.openFirma(${fi.id})">+ ${kontakte.length-5} weitere Kontakte</div>` : ""}

          <div style="padding:12px 0 0">
            <button class="tm-btn tm-btn-sm tm-btn-primary" style="width:100%" onclick="ctrl.openFirma(${fi.id})">Firma öffnen →</button>
          </div>`;
      };

      // ── Render ─────────────────────────────────────────────────────────────
      ui.render(`
        <style>
          .fi-wrap { display:flex; flex-direction:column; height:calc(100vh - var(--tm-header-h,52px)); overflow:hidden; }
          .fi-shell { display:flex; flex:1; min-height:0; overflow:hidden; }

          /* Sidebar — schlank */
          .fi-sidebar { width:188px; min-width:188px; border-right:1px solid #e5e7eb; background:#fff; display:flex; flex-direction:column; overflow:hidden; }
          .fi-sb-search { padding:8px 10px; border-bottom:1px solid #e5e7eb; }
          .fi-sb-search input { width:100%; padding:5px 9px; border:1px solid #e5e7eb; border-radius:6px; font-size:12px; font-family:inherit; background:#f9fafb; outline:none; color:#374151; }
          .fi-sb-search input:focus { border-color:#004078; background:#fff; }
          .fi-sb-scroll { flex:1; overflow-y:auto; }
          .fi-sb-sec { border-bottom:1px solid #e5e7eb; padding:6px 0; }
          .fi-sb-lbl { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#9ca3af; padding:2px 12px 5px; }
          .fi-sb-item { display:flex; align-items:center; gap:8px; padding:5px 12px; cursor:pointer; border-left:2px solid transparent; font-size:12px; color:#374151; white-space:nowrap; overflow:hidden; }
          .fi-sb-item:hover { background:#f9fafb; }
          .fi-sb-item.active { background:#eff6ff; border-left-color:#004078; color:#004078; font-weight:600; }
          .fi-sb-item .fi-sb-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
          .fi-sb-iname { overflow:hidden; text-overflow:ellipsis; flex:1; }
          .fi-sb-reset { font-size:12px; color:#A32D2D; cursor:pointer; background:none; border:none; padding:0; font-family:inherit; font-weight:600; }

          /* Main */
          .fi-main { flex:1; display:flex; flex-direction:column; overflow:hidden; background:#fff; }
          .fi-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px 8px; background:#e8ecf0; flex-shrink:0; border-bottom:1px solid rgba(0,0,0,0.09); }
          .fi-title { font-size:18px; font-weight:700; color:var(--tm-text); }
          .fi-meta { font-size:12px; color:#8896a5; }
          .fi-tbl-wrap { flex:1; overflow-y:auto; }
          table.fi-tbl { width:100%; border-collapse:collapse; font-size:13px; font-family:inherit; }
          .fi-tbl th { padding:6px 10px; text-align:left; font-size:10px; font-weight:700; color:#8896a5; text-transform:uppercase; letter-spacing:0.05em; border-bottom:1px solid #dde3ea; white-space:nowrap; background:#fff; position:sticky; top:0; z-index:1; cursor:pointer; user-select:none; }
          .fi-tbl th:hover { color:var(--tm-text); }
          .fi-tbl th.fi-th-active { color:#004078; }
          .fi-tbl td { padding:4px 10px; border-bottom:1px solid #f0f2f5; vertical-align:middle; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .fi-tbl-row { cursor:pointer; }
          .fi-tbl-row:hover td { background:#f6f8fb; }
          .fi-tbl-row.fi-row-sel td { background:#e6f1fb !important; }
          .fi-td-name { width:25%; font-weight:600; color:var(--tm-text); }
          .fi-td-seg  { width:110px; }
          .fi-td-crm  { width:130px; color:#8896a5; font-size:12px; }
          .fi-td-kont { width:80px; color:#8896a5; font-size:12px; text-align:center; }
          .fi-td-proj { width:90px; font-size:12px; text-align:center; }
          .fi-td-next { width:220px; font-size:12px; }
          .fi-dot-sig { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:6px; flex-shrink:0; vertical-align:middle; }

          /* Detail */
          .fi-detail { width:270px; min-width:270px; border-left:1px solid #e5e7eb; background:#fff; display:flex; flex-direction:column; overflow:hidden; }
          .fi-dp-head { padding:9px 14px; border-bottom:1px solid #e5e7eb; flex-shrink:0; }
          .fi-dp-lbl { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.09em; color:#9ca3af; }
          .fi-dp-scroll { flex:1; overflow-y:auto; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
          .fi-dp-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#9ca3af; font-size:12px; font-weight:600; gap:4px; }
          .fi-dp-firm { display:flex; align-items:flex-start; gap:10px; }
          .fi-dp-avatar { width:36px; height:36px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; flex-shrink:0; }
          .fi-dp-name { font-size:13px; font-weight:700; color:#111827; line-height:1.3; }
          .fi-dp-loc { font-size:11px; color:#9ca3af; margin-top:2px; }
          .fi-dp-signal { display:flex; align-items:center; gap:6px; padding:6px 8px; background:#f9fafb; border-radius:7px; }
          .fi-dp-next { background:#f0fdf4; border-radius:7px; padding:7px 10px; border:1px solid #bbf7d0; }
          .fi-dp-nums { display:flex; gap:6px; }
          .fi-dp-num { flex:1; text-align:center; padding:8px 4px; }
          .fi-dp-divider { height:1px; background:#f3f4f6; margin:4px 0; }
          .fi-dp-contact { display:flex; align-items:center; gap:8px; padding:4px 0; }
          .fi-dp-av { width:24px; height:24px; border-radius:50%; background:#dbeafe; color:#1d4ed8; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:800; flex-shrink:0; }

          /* Chip-Leiste — default hidden (Desktop), Mobile via media query sichtbar */
          .fi-mob-chips {
            display: none;
            gap: 6px;
            padding: 6px 12px 8px;
            background: #fff;
            border-bottom: 1px solid #e5e7eb;
            flex-wrap: wrap;
            flex-shrink: 0;
          }
          .fi-mob-chip {
            flex-shrink: 0;
            padding: 4px 12px;
            border-radius: 100px;
            font-size: 12px;
            font-weight: 600;
            font-family: inherit;
            border: 1.5px solid #e5e7eb;
            background: #f9fafb;
            color: #6b7280;
            cursor: pointer;
            white-space: nowrap;
          }
          .fi-mob-chip.active { background:#eff6ff; border-color:#2563eb; color:#1d4ed8; }
          .fi-mob-chip-reset  { background:#f3f4f6; color:#374151; border-color:#d1d5db; }

          /* Mobile */
          @media(max-width:899px) {
            .fi-sidebar { display:none !important; }
            .fi-detail  { display:none !important; }
            .fi-mob-filter-btn { display:none !important; }
            .fi-mob-hide { display:none !important; }
            .fi-mob-chips { display:flex !important; }

            /* Suchfeld full-width */
            .fi-bar { padding:8px 12px; }
            .fi-bar-right { flex:1; }
            .fi-mob-search { width:100% !important; }

            /* Tabellen-Header ausblenden */
            .fi-hdr { display:none !important; }

            /* Row → Card */
            .fi-row { flex-wrap:wrap; padding:11px 14px; gap:3px; align-items:flex-start; border-bottom:1px solid #f0f2f5; }
            .fi-col-sig  { width:auto; margin-top:3px; }
            .fi-col-name { flex:1; min-width:0; padding-right:8px; }
            .fi-col-seg  { width:auto; order:3; padding-right:0; }
            .fi-col-num  { width:auto; order:4; text-align:left; padding-right:0; font-size:12px; }
            .fi-col-next { display:flex !important; flex-basis:100%; order:5; padding:4px 0 0 22px; font-size:12px; }
            .fi-col-lk   { display:flex !important; flex-basis:100%; order:6; padding:0 0 0 22px; font-size:11px; color:#9ca3af; width:auto; text-align:left; }
            .fi-row-title { font-size:14px; }
            .fi-group-hd  { padding:5px 14px 4px; }
          }
        </style>

        <div class="fi-wrap">
          <div class="fi-shell${state.ui.fiMobFilter ? " fi-mob-filter" : ""}">

            <!-- SIDEBAR -->
            <div class="fi-sidebar">
              <div class="fi-sb-search">
                <input type="search" placeholder="Suche Firma, Ort…" value="${h.esc(f.search || "")}"
                  data-search-key="firmen.search" oninput="h.searchInput('firmen.search',this.value)">
                ${hasFilter?`<button class="fi-sb-reset" data-action="fi-reset-filters" style="display:block;width:100%;margin-top:6px;padding:4px 0;text-align:center;border:1px dashed #f5b8b8;border-radius:6px;background:#fff8f8">✕ Filter löschen</button>`:""}
              </div>
              <div class="fi-sb-scroll">

                <div class="fi-sb-sec">
                  <div class="fi-sb-lbl">Anzeigen</div>
                  ${[
                    ["","Alle Firmen"],
                    ["projekte","Tailormade-Projekte"],
                    ["crm","CRM-Aktivitäten/Aufgaben"]
                  ].map(([val,lbl]) => `
                    <div class="fi-sb-item${f.anzeigen===val?" active":""}" data-action="fi-filter" data-fkey="anzeigen" data-fval="${val}">
                      <span class="fi-sb-iname">${h.esc(lbl)}</span>
                    </div>`).join("")}
                </div>

                <div class="fi-sb-sec">
                  <div class="fi-sb-lbl">Klassifizierung</div>
                  ${klassifizierungen.map(kl => `
                    <div class="fi-sb-item${f.klassifizierung===kl?" active":""}" data-action="fi-filter" data-fkey="klassifizierung" data-fval="${h.esc(kl)}">
                      <div class="fi-sb-dot" style="background:${klColor(kl)}"></div>
                      <span class="fi-sb-iname">${h.esc(kl)}</span>
                    </div>`).join("")}
                </div>

                <div class="fi-sb-sec">
                  <div class="fi-sb-lbl">Selektion</div>
                  <div class="fi-sb-item${f.vip==="ja"?" active":""}" data-action="fi-filter" data-fkey="vip" data-fval="${f.vip==="ja"?"":"ja"}">
                    <span style="font-size:13px">⭐</span>
                    <span class="fi-sb-iname">Nur VIP</span>
                  </div>
                </div>

              </div>
            </div>

            <!-- MAIN -->
            <div class="fi-main">
              <div class="fi-toolbar">
                <div>
                  <div class="fi-title">${[f.klassifizierung, f.anzeigen==="projekte"?"Tailormade-Projekte":f.anzeigen==="crm"?"CRM-Aktivitäten":""].filter(Boolean).concat(["Firmen"]).join(" · ")}</div>
                  <div class="fi-meta">${(() => {
                    const totalKont  = state.data.contacts.filter(c => !c.archiviert).length;
                    const aktivProj  = state.enriched.projekte.filter(p => !p.archiviert).length;
                    const allKontIds = new Set(state.data.contacts.filter(c => !c.archiviert).map(c => c.id));
                    const offTasks   = state.data.tasks.filter(t => allKontIds.has(t.kontaktId) && t.status !== "erledigt").length;
                    const naechster  = state.enriched.einsaetze
                      .filter(e => h.toDate(e.datum) >= h.todayStart() && !["abgesagt","abgesagt-chf"].includes(e.einsatzStatus))
                      .sort((a,b) => h.toDate(a.datum)-h.toDate(b.datum))[0];
                    return [
                      `${list.length} Firmen`,
                      `${totalKont} Kontakte`,
                      `${aktivProj} Projekte aktiv`,
                      `${offTasks} Tasks offen`,
                      naechster ? `Nächster Einsatz ${naechster.datumFmt}` : ""
                    ].filter(Boolean).join(" · ");
                  })()}</div>
                </div>
              </div>

              <!-- Mobile Chips -->
              <div class="fi-mob-chips">
                ${["A-Kunde","B-Kunde","C-Kunde","Akquisition"].map(kl => {
                  const active = f.klassifizierung === kl;
                  return `<button class="fi-mob-chip${active?" active":""}" data-action="fi-filter" data-fkey="klassifizierung" data-fval="${h.esc(kl)}">${h.esc(kl)}${active?" ×":""}</button>`;
                }).join("")}
                <button class="fi-mob-chip${f.anzeigen==="projekte"?" active":""}" data-action="fi-filter" data-fkey="anzeigen" data-fval="${f.anzeigen==="projekte"?"":"projekte"}">Tailormade-Projekte${f.anzeigen==="projekte"?" ×":""}</button>
                <button class="fi-mob-chip${f.anzeigen==="crm"?" active":""}" data-action="fi-filter" data-fkey="anzeigen" data-fval="${f.anzeigen==="crm"?"":"crm"}">CRM-Aktivitäten${f.anzeigen==="crm"?" ×":""}</button>
                ${hasFilter ? `<button class="fi-mob-chip fi-mob-chip-reset" data-action="fi-reset-filters">Alle</button>` : ""}
              </div>

              <div class="fi-tbl-wrap">
                <table class="fi-tbl">
                  <thead><tr>
                    ${fiSortTh("name","Firma","fi-td-name")}
                    ${fiSortTh("seg","Segment","fi-td-seg")}
                    ${fiSortTh("crm","Letzte CRM-Aktivität","fi-td-crm")}
                    ${fiSortTh("kont","Kontakte","fi-td-kont")}
                    ${fiSortTh("proj","Projekte","fi-td-proj")}
                    ${fiSortTh("next","Nächster Einsatz","fi-td-next")}
                  </tr></thead>
                  <tbody>
                    ${list.length ? list.map(fiTblRow).join("") : `<tr><td colspan="6" style="text-align:center;padding:32px;color:#8896a5">Keine Firmen gefunden.</td></tr>`}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- DETAIL -->
            <div class="fi-detail">
              <div class="fi-dp-head"><div class="fi-dp-lbl">Details</div></div>
              <div class="fi-dp-scroll">${detailHtml()}</div>
            </div>

          </div>
        </div>
      `);
    },


    firmaDetail(id) {
      if (!id) { views.firmen(); return; }
      const fi = state.data.firms.find(fi => fi.id === id);
      if (!fi) { views.firmen(); return; }

      const kontakte   = state.data.contacts.filter(c => c.firmaLookupId === fi.id && !c.archiviert);
      const kontaktIds = new Set(kontakte.map(c => c.id));
      const projekte   = state.enriched.projekte.filter(p => p.firmaLookupId === fi.id);
      const aktivProj  = projekte.filter(p => p.status === "aktiv");
      const abgProj    = projekte.filter(p => p.status === "abgeschlossen");
      const history    = state.data.history.filter(h2 => kontaktIds.has(h2.kontaktId))
                          .sort((a, b) => h.toDate(b.datum) - h.toDate(a.datum));
      const tasks      = state.data.tasks.filter(t => kontaktIds.has(t.kontaktId));
      const offeneTasks = tasks.filter(t => t.status !== "erledigt");
      const naechsteDeadline = offeneTasks.filter(t => t.deadline)
        .sort((a, b) => h.toDate(a.deadline) - h.toDate(b.deadline))[0];

      const thisYear  = new Date().getFullYear();
      const einsaetze = state.enriched.einsaetze.filter(e => {
        const p = state.enriched.projekte.find(p => p.id === e.projektLookupId);
        return p?.firmaLookupId === fi.id && !["abgesagt","abgesagt-chf"].includes(e.einsatzStatus);
      });
      const umsatzJahr   = einsaetze.filter(e => e.datum && new Date(e.datum).getFullYear() === thisYear)
                             .reduce((s, e) => s + (e.anzeigeBetrag || 0), 0);
      const umsatzGesamt = einsaetze.reduce((s, e) => s + (e.anzeigeBetrag || 0), 0);

      const naechsterEinsatz = state.enriched.einsaetze
        .filter(e => { const p = state.enriched.projekte.find(p => p.id === e.projektLookupId); return p?.firmaLookupId === fi.id && h.toDate(e.datum) >= h.todayStart() && !["abgesagt","abgesagt-chf"].includes(e.einsatzStatus); })
        .sort((a, b) => h.toDate(a.datum) - h.toDate(b.datum))[0];

      const initials = c => ((c.vorname || "")[0] || "").toUpperCase() + ((c.nachname || "")[0] || "").toUpperCase();
      const avatar   = (init, size=32, bg="#B5D4F4", tx="#0C447C") =>
        `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${tx};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.33)}px;font-weight:700;flex-shrink:0">${init}</div>`;
      const fmtRel = d => {
        if (!d) return "—";
        const diff = Math.round((Date.now() - h.toDate(d)) / 86400000);
        if (diff === 0) return "Heute";
        if (diff === 1) return "Gestern";
        if (diff < 7)  return `vor ${diff} Tagen`;
        if (diff < 30) return `vor ${Math.round(diff / 7)} Wo.`;
        if (diff < 365) return `vor ${Math.round(diff / 30)} Mon.`;
        return `vor ${Math.round(diff / 365)} J.`;
      };

      const kl = fi.klassifizierung || "";
      const klColor = k => k === "Akquisition" ? "#7c3aed" : k === "A-Kunde" ? "#1a6e40" : k === "B-Kunde" ? "#1a52a0" : k === "C-Kunde" ? "#6b7280" : "#9ca3af";
      const klBg    = k => k === "Akquisition" ? "#ede9fe" : k === "A-Kunde" ? "#dcfce7" : k === "B-Kunde" ? "#dbeafe" : k === "C-Kunde" ? "#f3f4f6" : "#f9fafb";

      // Kontakt-Suche State
      const showAllContacts = state.ui.fdShowAllContacts === fi.id;

      ui.render(`
        <style>
          .fd-page { height:calc(100vh - var(--tm-header-h,52px)); background:#f5f7fb; overflow-y:auto; -webkit-overflow-scrolling:touch; }
          /* Header */
          .fd-hdr { background:#fff; border-bottom:1px solid #dde3ea; padding:0; }
          .fd-hdr-inner { padding:14px 24px 0; }
          .fd-hdr-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
          .fd-back { font-size:13px; color:#004078; font-weight:600; cursor:pointer; background:none; border:none; padding:0; font-family:inherit; display:inline-flex; align-items:center; gap:4px; }
          .fd-back:hover { text-decoration:underline; }
          .fd-hdr-id { display:flex; align-items:center; gap:14px; padding-bottom:16px; }
          .fd-avatar-lg { width:52px; height:52px; border-radius:14px; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800; flex-shrink:0; }
          .fd-hdr-name { font-size:22px; font-weight:800; color:#1a2332; line-height:1.2; }
          .fd-hdr-meta { font-size:13px; color:#8896a5; margin-top:3px; }
          /* KPI Bar */
          .fd-kpis { display:flex; gap:0; border-top:1px solid #dde3ea; background:#fff; }
          .fd-kpi { flex:1; padding:12px 16px; border-right:1px solid #dde3ea; text-align:center; }
          .fd-kpi:last-child { border-right:none; }
          .fd-kpi-val { font-size:20px; font-weight:800; color:#1a2332; line-height:1; }
          .fd-kpi-lbl { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#8896a5; margin-top:4px; }
          .fd-kpi-sub { font-size:11px; color:#8896a5; margin-top:2px; }
          /* Nächster Einsatz Banner */
          .fd-next-banner { display:flex; align-items:center; gap:10px; background:#e6f5ed; border-bottom:1px solid #c3e6d4; padding:10px 24px; font-size:13px; }
          /* Body */
          .fd-body { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:20px 24px; }
          @media(max-width:899px) { .fd-body { grid-template-columns:1fr; padding:12px 14px; } .fd-kpis { flex-wrap:wrap; } .fd-kpi { min-width:50%; } }
          .fd-card { background:#fff; border-radius:10px; border:1px solid #e4e7eb; overflow:hidden; }
          .fd-card-hd { display:flex; align-items:center; justify-content:space-between; padding:11px 16px 10px; border-bottom:1px solid #f0f2f5; }
          .fd-card-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#4a5568; }
          .fd-card-count { font-size:11px; color:#8896a5; font-weight:600; background:#f0f2f5; padding:1px 8px; border-radius:100px; }
          .fd-card-body { padding:12px 16px; }
          .fd-row { display:flex; align-items:baseline; padding:5px 0; border-bottom:1px solid #f5f7fa; font-size:13px; }
          .fd-row:last-child { border-bottom:none; }
          .fd-key { color:#8896a5; font-weight:600; width:120px; flex-shrink:0; font-size:12px; }
          .fd-val { color:#1a2332; font-weight:600; flex:1; }
          .fd-contact { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid #f5f7fa; }
          .fd-contact:last-child { border-bottom:none; }
          .fd-act { padding:9px 0; border-bottom:1px solid #f5f7fa; }
          .fd-act:last-child { border-bottom:none; }
          .fd-act-meta { font-size:10px; color:#8896a5; margin-bottom:3px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
          .fd-act-text { font-size:13px; color:#1a2332; line-height:1.45; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
          .fd-task { display:flex; align-items:center; gap:9px; padding:7px 0; border-bottom:1px solid #f5f7fa; font-size:13px; }
          .fd-task:last-child { border-bottom:none; }
          .fd-proj { display:flex; align-items:center; justify-content:space-between; padding:7px 0; border-bottom:1px solid #f5f7fa; }
          .fd-proj:last-child { border-bottom:none; }
          .fd-full { grid-column:1/-1; }
          .fd-typ-tag { font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; background:#e8f1f9; color:#004078; }
        </style>

        <div class="fd-page">

          <!-- Header -->
          <div class="fd-hdr">
            <div class="fd-hdr-inner">
              <div class="fd-hdr-top">
                <button class="fd-back" onclick="ctrl.navigate('firmen')">← Firmenliste</button>
                <div style="display:flex;gap:8px">
                  ${fi.website ? `<a href="${h.esc(fi.website)}" target="_blank" class="tm-btn tm-btn-sm" style="text-decoration:none">↗ Website</a>` : ""}
                </div>
              </div>
              <div class="fd-hdr-id">
                <div class="fd-avatar-lg" style="background:${klBg(kl)};color:${klColor(kl)}">
                  ${h.esc(fi.title.split(/[\s-]+/).filter(Boolean).map(w => w[0]).slice(0,2).join("").toUpperCase())}
                </div>
                <div style="flex:1;min-width:0">
                  <div class="fd-hdr-name">${h.esc(fi.title)}</div>
                  <div class="fd-hdr-meta">
                    ${[fi.ort, fi.land].filter(Boolean).join(" · ")}
                    ${kl ? `<span style="margin-left:8px;padding:2px 9px;border-radius:100px;background:${klBg(kl)};color:${klColor(kl)};font-size:11px;font-weight:700">${h.esc(kl)}</span>` : ""}
                    ${fi.vip ? `<span style="margin-left:4px;padding:2px 9px;border-radius:100px;background:#fff3cd;border:1px solid #e59c2e;color:#7a5000;font-size:11px;font-weight:700">VIP ⭐</span>` : ""}
                  </div>
                </div>
              </div>
            </div>

            <!-- KPI Bar -->
            <div class="fd-kpis">
              <div class="fd-kpi">
                <div class="fd-kpi-val" style="color:${aktivProj.length > 0 ? "#1a6e40" : "#004078"}">${aktivProj.length}</div>
                <div class="fd-kpi-lbl">Aktive Proj.</div>
                ${abgProj.length ? `<div class="fd-kpi-sub">${abgProj.length} abgeschl.</div>` : ""}
              </div>
              <div class="fd-kpi">
                <div class="fd-kpi-val">${kontakte.length}</div>
                <div class="fd-kpi-lbl">Kontakte</div>
              </div>
              <div class="fd-kpi">
                <div class="fd-kpi-val" style="color:${offeneTasks.length > 0 ? "#854F0B" : "#8896a5"}">${offeneTasks.length}</div>
                <div class="fd-kpi-lbl">Offene Tasks</div>
                ${naechsteDeadline ? `<div class="fd-kpi-sub" style="color:#854F0B">${h.esc(h.fmtDate(naechsteDeadline.deadline))}</div>` : ""}
              </div>
              <div class="fd-kpi">
                <div class="fd-kpi-val" style="font-size:15px">CHF ${h.chf(umsatzJahr)}</div>
                <div class="fd-kpi-lbl">Umsatz ${thisYear}</div>
                <div class="fd-kpi-sub">Total CHF ${h.chf(umsatzGesamt)}</div>
              </div>
            </div>
          </div>

          <!-- Nächster Einsatz Banner -->
          ${naechsterEinsatz ? `
          <div class="fd-next-banner">
            <span style="font-size:16px">📅</span>
            <div>
              <div style="font-weight:700;color:#1a6e40">Nächster Einsatz: ${h.esc(naechsterEinsatz.datumFmt)}</div>
              <div style="font-size:12px;color:#1a6e40;opacity:.8">${h.esc(naechsterEinsatz.title || naechsterEinsatz.kategorie)} · ${h.esc(naechsterEinsatz.personName || "")}</div>
            </div>
          </div>` : ""}

          <!-- Body Grid -->
          <div class="fd-body">

            <!-- Stammdaten -->
            <div class="fd-card">
              <div class="fd-card-hd"><span class="fd-card-title">Stammdaten</span></div>
              <div class="fd-card-body">
                ${[
                  ["Adresse",   fi.adresse],
                  ["PLZ / Ort", [fi.plz, fi.ort].filter(Boolean).join(" ")],
                  ["Land",      fi.land],
                  ["Telefon",   fi.telefon],
                  ["Website",   fi.website ? fi.website.replace(/^https?:\/\//, "") : null],
                ].filter(([, v]) => v).map(([k, v]) => `
                  <div class="fd-row"><span class="fd-key">${k}</span><span class="fd-val">${h.esc(String(v))}</span></div>
                `).join("") || `<div style="color:#8896a5;font-size:13px">Keine Stammdaten.</div>`}
              </div>
            </div>

            <!-- Aktive Projekte -->
            <div class="fd-card">
              <div class="fd-card-hd">
                <span class="fd-card-title">Projekte</span>
                <span class="fd-card-count">${aktivProj.length} aktiv · ${abgProj.length} abgeschl.</span>
              </div>
              <div class="fd-card-body">
                ${projekte.length ? projekte.sort((a, b) => a.status === "aktiv" ? -1 : 1).map(p => `
                  <div class="fd-proj">
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;gap:6px">
                        <div style="width:7px;height:7px;border-radius:50%;background:${p.status === "aktiv" ? "#1a6e40" : "#8896a5"};flex-shrink:0"></div>
                        <span style="font-weight:700;color:#004078;cursor:pointer;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                          onclick="ctrl.openProjekt(${p.id})">${h.esc(p.title)}</span>
                      </div>
                      <div style="font-size:11px;color:#8896a5;margin-left:13px">#${h.esc(p.projektNr || String(p.id))}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;margin-left:10px">
                      <div style="font-size:13px;font-weight:700;color:#004078">CHF ${h.chf(p.totalBetrag)}</div>
                      <div style="font-size:10px;color:#8896a5">${h.esc(p.status)}</div>
                    </div>
                  </div>`).join("")
                : `<div style="color:#8896a5;font-size:13px">Keine Projekte vorhanden.</div>`}
              </div>
            </div>

            <!-- Kontakte -->
            <div class="fd-card">
              <div class="fd-card-hd">
                <span class="fd-card-title">Kontakte</span>
                <span class="fd-card-count">${kontakte.length}</span>
              </div>
              <div class="fd-card-body">
                ${kontakte.length ? (showAllContacts ? kontakte : kontakte.slice(0, 5)).map(c => `
                  <div class="fd-contact">
                    ${avatar(initials(c))}
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:700;font-size:13px;color:#1a2332">${h.esc([c.vorname, c.nachname].filter(Boolean).join(" "))}</div>
                      <div style="font-size:11px;color:#8896a5">${h.esc([c.funktion, c.rolle].filter(Boolean).join(" · "))}</div>
                    </div>
                    ${c.email1 ? `<a href="mailto:${h.esc(c.email1)}" style="color:#004078;font-size:18px;text-decoration:none" title="${h.esc(c.email1)}">✉</a>` : ""}
                  </div>`).join("")
                : `<div style="color:#8896a5;font-size:13px">Keine Kontakte erfasst.</div>`}
                ${!showAllContacts && kontakte.length > 5 ? `
                  <div style="margin-top:8px;padding-top:8px;border-top:1px solid #f0f2f5">
                    <button style="background:none;border:none;color:#004078;font-size:12px;font-weight:600;cursor:pointer;padding:0;font-family:inherit"
                      onclick="state.ui.fdShowAllContacts=${fi.id};ctrl.render()">+ ${kontakte.length - 5} weitere Kontakte anzeigen</button>
                  </div>` : ""}
                ${showAllContacts && kontakte.length > 5 ? `
                  <div style="margin-top:8px;padding-top:8px;border-top:1px solid #f0f2f5">
                    <button style="background:none;border:none;color:#8896a5;font-size:12px;font-weight:600;cursor:pointer;padding:0;font-family:inherit"
                      onclick="state.ui.fdShowAllContacts=null;ctrl.render()">Weniger anzeigen</button>
                  </div>` : ""}
              </div>
            </div>

            <!-- Aufgaben -->
            <div class="fd-card">
              <div class="fd-card-hd">
                <span class="fd-card-title">Aufgaben</span>
                <span class="fd-card-count">${offeneTasks.length} offen</span>
              </div>
              <div class="fd-card-body">
                ${tasks.length ? tasks.sort((a, b) => (a.status !== "erledigt" ? -1 : 1)).slice(0, 8).map(t => {
                  const c = kontakte.find(c => c.id === t.kontaktId);
                  const offen = t.status !== "erledigt";
                  return `<div class="fd-task">
                    <div style="width:9px;height:9px;border-radius:50%;background:${offen ? "#854F0B" : "#1a6e40"};flex-shrink:0"></div>
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:600;font-size:13px;${!offen ? "text-decoration:line-through;color:#8896a5" : ""}">${h.esc(t.title)}</div>
                      <div style="font-size:11px;color:#8896a5">${c ? h.esc([c.vorname, c.nachname].filter(Boolean).join(" ")) : ""}${t.deadline ? ` · 📅 ${h.esc(h.fmtDate(t.deadline))}` : ""}</div>
                    </div>
                    <span style="font-size:11px;font-weight:600;color:${offen ? "#854F0B" : "#1a6e40"};white-space:nowrap">${h.esc(t.status || "offen")}</span>
                  </div>`;
                }).join("")
                : `<div style="color:#8896a5;font-size:13px">Keine Aufgaben vorhanden.</div>`}
              </div>
            </div>

            <!-- Aktivitäten (full width) -->
            <div class="fd-card fd-full">
              <div class="fd-card-hd">
                <span class="fd-card-title">Aktivitäten</span>
                <span class="fd-card-count">${history.length} total</span>
              </div>
              <div class="fd-card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">
                ${history.length ? history.slice(0, 10).map(act => {
                  const c = kontakte.find(c => c.id === act.kontaktId);
                  return `<div class="fd-act">
                    <div class="fd-act-meta">
                      <span>${fmtRel(act.datum)}</span>
                      <span style="color:#dde3ea">·</span>
                      <span>${h.esc(h.fmtDate(act.datum))}</span>
                      ${c ? `<span style="color:#dde3ea">·</span><span>${h.esc([c.vorname, c.nachname].filter(Boolean).join(" "))}</span>` : ""}
                      ${act.typ ? `<span class="fd-typ-tag">${h.esc(act.typ)}</span>` : ""}
                    </div>
                    <div class="fd-act-text">${h.esc(act.notizen || act.title || "")}</div>
                  </div>`;
                }).join("")
                : `<div style="color:#8896a5;font-size:13px;grid-column:1/-1">Keine Aktivitäten vorhanden.</div>`}
              </div>
            </div>

          </div>
        </div>
      `);
    },



  };

  const ctrl = {

    async login() {
      try {
        await state.auth.msal.loginRedirect({ scopes: CONFIG.graph.scopes }); return;
        state.auth.account = r.account;
        state.auth.isAuth  = true;
        ui.setAuth(r.account.name || r.account.username);
        await api.loadAll();
        ctrl.navigate("projekte");
      } catch (e) {
        debug.err("login", e);
        ui.setMsg("Anmeldung fehlgeschlagen: " + e.message, "error");
      }
    },

    async logout() {
      try {
        await state.auth.msal.logoutPopup();
        state.auth.account = null;
        state.auth.isAuth  = false;
        location.reload();
      } catch (e) {
        debug.err("logout", e);
      }
    },

    navigate(route) {
      // Mobile Filter-States bei Route-Wechsel zurücksetzen
      state.ui.eiMobFilter  = false;
      state.ui.kzMobFilter  = false;
      state.ui.abrMobFilter = false;
      state.ui.fiMobFilter  = false;
      if (route !== "abrechnung-erstellen") {
        state.ui.aeTab = "einsaetze";
        state.ui.aeSelected = null;
      }
      state.filters.route   = route;
      ctrl.render();
    },

    async refresh() {
      ui.setMsg("Aktualisiere…", "info");
      await api.loadAll();
      ctrl.render();
    },

    // ── Export ──────────────────────────────────────────────────────────────
    exportXlsx(opts = {}) {
      if (typeof XLSX === "undefined") { ui.setMsg("SheetJS nicht geladen.", "error"); return; }

      const { jahre = [], firma = "", person = "", projekt = "",
              status = "", abrechnung = "", verrechenbar = "",
              konzKat = "", abrState = "", sheets = ["projekte","einsaetze","konzeption"] } = opts;

      const inYear = (datum, jahrArr) => {
        if (!jahrArr || !jahrArr.length) return true;
        const d = h.toDate(datum);
        return d ? jahrArr.includes(String(d.getFullYear())) : false;
      };

      const wb = XLSX.utils.book_new();

      // ── Sheet: Projekte ──
      if (sheets.includes("projekte")) {
        let rows = state.enriched.projekte;
        if (firma)   rows = rows.filter(p => p.firmaName === firma);
        if (status)  rows = rows.filter(p => p.status === status);
        rows = rows.sort((a,b) => (a.projektNr||"").localeCompare(b.projektNr||"","de"));

        const data = rows.map(p => ({
          "Projekt-Nr":          p.projektNr || "",
          "Projektname":         p.title,
          "Firma":               p.firmaName || "",
          "Ansprechpartner":     p.ansprechpartner || "",
          "Status":              p.status,
          "Archiviert":          p.archiviert ? "Ja" : "Nein",
          "Ansatz Einsatz":      p.ansatzEinsatz ?? "",
          "Ansatz Halbtag":      p.ansatzHalbtag ?? "",
          "Ansatz Co":           p.ansatzCoEinsatz ?? "",
          "Ansatz Stunde":       p.ansatzStunde ?? "",
          "Ansatz Konzeption":   p.ansatzKonzeption ?? "",
          "Km zum Kunden":       p.kmZumKunden ?? "",
          "Konz.-Rahmen (Tage)": p.konzeptionsrahmenTage ?? "",
          "Konz.-Stunden (ist)": p.konzStunden,
          "Total Einsätze CHF":  p.totalEinsaetze,
          "Total Konzeption CHF":p.totalKonzeption,
          "Total CHF":           p.totalBetrag,
          "Bemerkungen":         p.bemerkungen || ""
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        ctrl._xlsxStyle(ws, data.length, Object.keys(data[0]||{}).length,
          [8,8,8,12,8,8,8,8,8,8,8,8,8,8,10,10,10,20]);
        XLSX.utils.book_append_sheet(wb, ws, "Projekte");
      }

      // ── Sheet: Einsätze ──
      if (sheets.includes("einsaetze")) {
        let rows = state.enriched.einsaetze;
        if (jahre.length)  rows = rows.filter(e => inYear(e.datum, jahre));
        if (firma)         rows = rows.filter(e => {
          const p = state.enriched.projekte.find(x => x.id === e.projektLookupId);
          return p?.firmaName === firma;
        });
        if (projekt)       rows = rows.filter(e => String(e.projektLookupId) === String(projekt) || e.projektTitle === projekt);
        if (person)        rows = rows.filter(e => e.personName === person || e.coPersonName === person);
        if (status)        rows = rows.filter(e => e.einsatzStatus === status);
        if (abrechnung)    rows = rows.filter(e => e.abrechnung === abrechnung);
        rows = rows.sort((a,b) => (b.datum||"").localeCompare(a.datum||""));

        const data = rows.map(e => {
          const proj = state.enriched.projekte.find(p => p.id === e.projektLookupId);
          return {
            "Datum":             e.datum ? h.toDate(e.datum)?.toISOString().slice(0,10) : "",
            "Projekt-Nr":        proj?.projektNr || "",
            "Projekt":           e.projektTitle,
            "Firma":             proj?.firmaName || "",
            "Beschreibung":      e.title,
            "Ort":               e.ort || "",
            "Kategorie":         e.kategorie,
            "Tage":              e.dauerTage ?? "",
            "Stunden":           e.dauerStunden ?? "",
            "Lead":              e.personName || "",
            "Co-Lead":           e.coPersonName || "",
            "Betrag Lead":       e.anzeigeBetrag ?? "",
            "Betrag Co":         e.coAnzeigeBetrag ?? "",
            "Betrag Total":      e.totalBetrag,
            "Wegspesen CHF":     e.spesenBerechnet ?? "",
            "Status":            e.einsatzStatus,
            "Abrechnung":        e.abrechnung,
            "Bemerkungen":       e.bemerkungen || ""
          };
        });

        const ws = XLSX.utils.json_to_sheet(data);
        ctrl._xlsxStyle(ws, data.length, Object.keys(data[0]||{}).length,
          [10,8,16,16,20,10,10,6,6,14,14,10,10,10,10,10,10,20]);
        XLSX.utils.book_append_sheet(wb, ws, "Einsätze");
      }

      // ── Sheet: Konzeption ──
      if (sheets.includes("konzeption")) {
        let rows = state.enriched.konzeption;
        if (jahre.length)   rows = rows.filter(k => inYear(k.datum, jahre));
        if (firma)          rows = rows.filter(k => {
          const p = state.enriched.projekte.find(x => x.id === k.projektLookupId);
          return p?.firmaName === firma;
        });
        if (projekt)        rows = rows.filter(k => String(k.projektLookupId) === String(projekt) || k.projektTitle === projekt);
        if (person)         rows = rows.filter(k => k.personName === person);
        if (verrechenbar)   rows = rows.filter(k => k.verrechenbar === verrechenbar);
        if (konzKat)        rows = rows.filter(k => k.kategorie === konzKat);
        if (abrechnung)     rows = rows.filter(k => k.abrechnung === abrechnung);
        rows = rows.sort((a,b) => (b.datum||"").localeCompare(a.datum||""));

        const data = rows.map(k => {
          const proj = state.enriched.projekte.find(p => p.id === k.projektLookupId);
          return {
            "Datum":          k.datum ? h.toDate(k.datum)?.toISOString().slice(0,10) : "",
            "Projekt-Nr":     proj?.projektNr || "",
            "Projekt":        k.projektTitle,
            "Firma":          proj?.firmaName || "",
            "Beschreibung":   k.title,
            "Kategorie":      k.kategorie,
            "Person":         k.personName || "",
            "Aufwand (h)":    k.aufwandStunden ?? "",
            "Betrag CHF":     k.anzeigeBetrag ?? "",
            "Verrechenbar":   k.verrechenbar,
            "Abrechnung":     k.abrechnung,
            "Bemerkungen":    k.bemerkungen || ""
          };
        });

        const ws = XLSX.utils.json_to_sheet(data);
        ctrl._xlsxStyle(ws, data.length, Object.keys(data[0]||{}).length,
          [10,8,18,18,24,12,14,8,10,14,10,20]);
        XLSX.utils.book_append_sheet(wb, ws, "Konzeption");
      }

      if (wb.SheetNames.length === 0) { ui.setMsg("Keine Daten zum Exportieren.", "error"); return; }

      const ts = new Date().toISOString().slice(0,10);
      XLSX.writeFile(wb, `TM-Export_${ts}.xlsx`);
      ui.setMsg("Export erfolgreich.", "success");
    },

    // Hilfsfunktion: Header fett + Spaltenbreiten setzen
    _xlsxStyle(ws, rowCount, colCount, colWidths = []) {
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      // Spaltenbreiten
      ws["!cols"] = colWidths.length
        ? colWidths.map(w => ({ wch: w }))
        : Array.from({length: colCount}, () => ({ wch: 14 }));
      // Header-Zeile fett
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        if (!ws[addr]) continue;
        ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: "E8ECF0" } } };
      }
    },

    // Export-Dropdown rendern und toggeln
    toggleExportDropdown() {
      let dd = document.getElementById("tm-export-dd");
      if (dd) { dd.remove(); return; }

      // Jahres-Optionen aus Daten ableiten
      const jahre = [...new Set(state.enriched.einsaetze.map(e => {
        const d = h.toDate(e.datum); return d ? String(d.getFullYear()) : null;
      }).filter(Boolean))].sort((a,b) => b-a);

      const firmen = [...new Set([
        ...state.enriched.einsaetze.map(e => state.enriched.projekte.find(p=>p.id===e.projektLookupId)?.firmaName).filter(Boolean),
        ...state.enriched.projekte.map(p => p.firmaName).filter(Boolean)
      ])].sort((a,b) => a.localeCompare(b,"de"));

      const personen = [...new Set([
        ...state.enriched.einsaetze.map(e => e.personName).filter(Boolean),
        ...state.enriched.konzeption.map(k => k.personName).filter(Boolean)
      ])].sort((a,b) => a.localeCompare(b,"de"));

      dd = document.createElement("div");
      dd.id = "tm-export-dd";
      dd.innerHTML = `
        <div class="tm-xdd-inner">
          <div class="tm-xdd-title">Excel-Export</div>

          <div class="tm-xdd-sec">Inhalt</div>
          <label class="tm-xdd-cb"><input type="checkbox" id="xsh-projekte" checked> Projekte</label>
          <label class="tm-xdd-cb"><input type="checkbox" id="xsh-einsaetze" checked> Einsätze</label>
          <label class="tm-xdd-cb"><input type="checkbox" id="xsh-konzeption" checked> Konzeption</label>

          <div class="tm-xdd-sec">Filter</div>
          <div class="tm-xdd-row">
            <label>Jahr</label>
            <select id="x-jahr" multiple size="3" style="height:auto">
              ${jahre.map(y=>`<option value="${y}">${y}</option>`).join("")}
            </select>
          </div>
          <div class="tm-xdd-row">
            <label>Firma</label>
            <select id="x-firma">
              <option value="">Alle</option>
              ${firmen.map(f=>`<option value="${h.esc(f)}">${h.esc(f)}</option>`).join("")}
            </select>
          </div>
          <div class="tm-xdd-row">
            <label>Person</label>
            <select id="x-person">
              <option value="">Alle</option>
              ${personen.map(p=>`<option value="${h.esc(p)}">${h.esc(p)}</option>`).join("")}
            </select>
          </div>
          <div class="tm-xdd-row">
            <label>Status</label>
            <select id="x-status">
              <option value="">Alle</option>
              <option>geplant</option><option>durchgeführt</option>
              <option>abgesagt</option><option>abgesagt mit Kostenfolge</option>
            </select>
          </div>
          <div class="tm-xdd-row">
            <label>Abrechnung</label>
            <select id="x-abrechnung">
              <option value="">Alle</option>
              <option value="offen">offen</option>
              <option value="zur Abrechnung">zur Abrechnung</option>
              <option value="abgerechnet">abgerechnet</option>
            </select>
          </div>
          <div class="tm-xdd-row">
            <label>Verrechenbar</label>
            <select id="x-verrechenbar">
              <option value="">Alle</option>
              ${(state.choices.konzVerrechenbar||[]).map(v=>`<option value="${h.esc(v)}">${h.esc(v)}</option>`).join("")}
            </select>
          </div>

          <button class="tm-btn tm-btn-primary tm-xdd-go" onclick="
            const jahre=[...document.getElementById('x-jahr').selectedOptions].map(o=>o.value);
            ctrl.exportXlsx({
              jahre,
              firma: document.getElementById('x-firma').value,
              person: document.getElementById('x-person').value,
              status: document.getElementById('x-status').value,
              abrechnung: document.getElementById('x-abrechnung').value,
              verrechenbar: document.getElementById('x-verrechenbar').value,
              sheets: [
                document.getElementById('xsh-projekte').checked   ? 'projekte'   : null,
                document.getElementById('xsh-einsaetze').checked  ? 'einsaetze'  : null,
                document.getElementById('xsh-konzeption').checked ? 'konzeption' : null,
              ].filter(Boolean)
            });
            document.getElementById('tm-export-dd')?.remove();
          ">↓ Herunterladen</button>
        </div>
      `;

      // Positionierung relativ zum Button
      const btn = document.getElementById("btn-export");
      if (btn) {
        const rect = btn.getBoundingClientRect();
        dd.style.cssText = `position:fixed;top:${rect.bottom+4}px;right:${window.innerWidth-rect.right}px;z-index:9999`;
      }
      document.body.appendChild(dd);

      // Klick ausserhalb schliesst Dropdown
      setTimeout(() => {
        document.addEventListener("click", function close(ev) {
          if (!document.getElementById("tm-export-dd")?.contains(ev.target) && ev.target.id !== "btn-export") {
            document.getElementById("tm-export-dd")?.remove();
            document.removeEventListener("click", close);
          }
        });
      }, 50);
    },

    toggleEiColPicker() {
      let dd = document.getElementById("ei-col-picker");
      if (dd) { dd.remove(); return; }

      const cols = state.ui.eiCols;
      const defs = [
        { key: "person",     label: "Person" },
        { key: "ort",        label: "Ort" },
        { key: "status",     label: "Status" },
        { key: "abrechnung", label: "Abrechnung" }
      ];

      dd = document.createElement("div");
      dd.id = "ei-col-picker";
      dd.style.cssText = "position:fixed;z-index:9999;background:#fff;border:1px solid rgba(0,0,0,0.13);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.14);padding:10px 14px;min-width:160px;display:flex;flex-direction:column;gap:6px;";
      dd.innerHTML = `
        <div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8896a5;margin-bottom:2px">Spalten</div>
        ${defs.map(d => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;font-family:inherit">
            <input type="checkbox" ${cols[d.key]?"checked":""} onchange="state.ui.eiCols['${d.key}']=this.checked;ctrl.render()" style="accent-color:#004078">
            ${d.label}
          </label>`).join("")}
      `;

      // Positionierung relativ zum ⊞-Button
      const btn = document.querySelector("button[onclick='ctrl.toggleEiColPicker()']");
      if (btn) {
        const rect = btn.getBoundingClientRect();
        dd.style.top  = (rect.bottom + 4) + "px";
        dd.style.left = rect.left + "px";
      }
      document.body.appendChild(dd);

      setTimeout(() => {
        document.addEventListener("click", function close(ev) {
          if (!document.getElementById("ei-col-picker")?.contains(ev.target)) {
            document.getElementById("ei-col-picker")?.remove();
            document.removeEventListener("click", close);
          }
        });
      }, 50);
    },

    toggleKzColPicker() {
      let dd = document.getElementById("kz-col-picker");
      if (dd) { dd.remove(); return; }
      const cols = state.ui.kzCols;
      const defs = [
        { key: "person",       label: "Person" },
        { key: "katdauer",     label: "Kat. / Dauer" },
        { key: "verrechenbar", label: "Verrechenbar" },
        { key: "abrechnung",   label: "Abrechnung" }
      ];
      dd = document.createElement("div");
      dd.id = "kz-col-picker";
      dd.style.cssText = "position:fixed;z-index:9999;background:#fff;border:1px solid rgba(0,0,0,0.13);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.14);padding:10px 14px;min-width:170px;display:flex;flex-direction:column;gap:6px;";
      dd.innerHTML = `
        <div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8896a5;margin-bottom:2px">Spalten</div>
        ${defs.map(d => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;font-family:inherit">
            <input type="checkbox" ${cols[d.key]?"checked":""} onchange="state.ui.kzCols['${d.key}']=this.checked;ctrl.render()" style="accent-color:#004078">
            ${d.label}
          </label>`).join("")}
      `;
      const btn = document.querySelector("button[onclick='ctrl.toggleKzColPicker()']");
      if (btn) {
        const rect = btn.getBoundingClientRect();
        dd.style.top  = (rect.bottom + 4) + "px";
        dd.style.left = rect.left + "px";
      }
      document.body.appendChild(dd);
      setTimeout(() => {
        document.addEventListener("click", function close(ev) {
          if (!document.getElementById("kz-col-picker")?.contains(ev.target)) {
            document.getElementById("kz-col-picker")?.remove();
            document.removeEventListener("click", close);
          }
        });
      }, 50);
    },

    render() {
      const r = state.filters.route;
      ui.setNav(["projekte","einsaetze","konzeption","abrechnungen","firmen"].includes(r) ? r : "projekte");
      ui.setMsg("", "");
      if (r === "projekte")       { views.projekte(); return; }
      if (r === "projekt-detail") { views.projektDetail(state.selection.projektId); return; }
      // Nicht-Panel-Views: in scroll-wrapper einbetten
      const scrollWrap = fn => {
        fn();
        const root = ui.els.root;
        if (root && !root.firstElementChild?.classList.contains("tm-scroll-view")) {
          const wrap = document.createElement("div");
          wrap.className = "tm-scroll-view";
          while (root.firstChild) wrap.appendChild(root.firstChild);
          root.appendChild(wrap);
        }
      };
      if (r === "einsaetze")           { views.einsaetze(); return; }
      if (r === "konzeption")           { views.konzeption(); return; }
      if (r === "abrechnungen")         { views.abrechnungen(); return; }
      if (r === "abrechnung-erstellen") { views.abrechnungErstellen(state.selection.projektId); return; }
      if (r === "firmen")               { views.firmen(); return; }
      if (r === "firma-detail")         { views.firmaDetail(state.selection.firmaId); return; }
    },

    openKzFs(key) {
      const overlay = document.getElementById("kz-fs-overlay");
      const title   = document.getElementById("kz-fs-title");
      const body    = document.getElementById("kz-fs-body");
      if (!overlay||!title||!body) return;
      const f = state.filters.konzeption;
      const all = state.enriched.konzeption;
      const chip = (fkey, val, lbl) => {
        const isActive = f[fkey]===String(val);
        return `<div class="ef-fs-opt${isActive?" active":""}" data-kz-fkey="${fkey}" data-kz-fval="${String(val).replace(/"/g,'&quot;')}">
          <span>${h.esc(lbl)}</span><span class="ef-fs-check">${isActive?"✓":""}</span>
        </div>`;
      };
      body.onclick = ev => {
        const opt = ev.target.closest("[data-kz-fkey]");
        if (!opt) return;
        const fk=opt.dataset.kzFkey, fv=opt.dataset.kzFval;
        state.filters.konzeption[fk] = state.filters.konzeption[fk]===fv ? "" : fv;
        state.ui.selectedKonzId=null;
        ctrl.closeKzFs();
        ctrl.render();
      };
      if (key==="verrechenbar") {
        title.textContent="Verrechenbar";
        body.innerHTML = chip("verrechenbar","","Alle")+state.choices.konzVerrechenbar.map(v=>chip("verrechenbar",v,v)).join("");
      } else if (key==="firma") {
        title.textContent="Firma";
        const firmen=[...new Set(all.map(k=>{const p=state.enriched.projekte.find(p=>p.id===k.projektLookupId);return p?.firmaName||"";}).filter(Boolean))].sort();
        body.innerHTML=chip("firma","","Alle Firmen")+firmen.map(n=>chip("firma",n,n)).join("");
      } else if (key==="projekt") {
        title.textContent="Projekt";
        const proj=[...new Map(all.map(k=>{const p=state.enriched.projekte.find(p=>p.id===k.projektLookupId);const nr=p?.projektNr||"";return [k.projektLookupId,nr?"#"+nr+" "+k.projektTitle:k.projektTitle];})).entries()].filter(([,t])=>t);
        body.innerHTML=chip("projekt","","Alle Projekte")+proj.map(([id,t])=>chip("projekt",id,t)).join("");
      } else if (key==="person") {
        title.textContent="Person";
        const personen=[...new Set(all.map(k=>k.personName).filter(n=>n&&n!=="—"))].sort((a,b)=>a.split(" ").pop().localeCompare(b.split(" ").pop()));
        body.innerHTML=chip("person","","Alle Personen")+personen.map(n=>chip("person",n,n)).join("");
      }
      overlay.classList.add("open");
      document.body.style.overflow="hidden";
    },

    closeKzFs() {
      const overlay=document.getElementById("kz-fs-overlay");
      if(overlay) overlay.classList.remove("open");
      document.body.style.overflow="";
    },

    openKzBs(id) {
      const k = state.enriched.konzeption.find(x=>x.id===id);
      if (!k) return;
      const proj = state.enriched.projekte.find(p=>p.id===k.projektLookupId);
      // Reuse existing BS overlay
      const overlay = document.getElementById("ef-bs-overlay");
      const bsTitle = document.getElementById("ef-bs-title");
      const bsSub   = document.getElementById("ef-bs-sub");
      const bsBody  = document.getElementById("ef-bs-body");
      if (!overlay||!bsTitle||!bsBody) return;
      bsTitle.textContent = k.title;
      bsSub.textContent   = proj?.firmaName||"";
      bsBody.innerHTML =
        '<div class="ef-bs-sec"><div class="ef-bs-lbl">Datum</div><div class="ef-bs-val">'+h.esc(k.datumFmt)+'</div></div>'
        +(proj?'<div class="ef-bs-sec"><div class="ef-bs-lbl">Projekt</div><div class="ef-bs-val">'+h.esc(proj.title)+(proj.projektNr?' <span style="color:var(--tm-text-muted);font-size:12px">#'+h.esc(proj.projektNr)+'</span>':'')+'</div></div>':"")
        +'<div class="ef-bs-sec"><div class="ef-bs-lbl">Person</div><div class="ef-bs-val">'+h.esc(k.personName)+'</div></div>'
        +'<div class="ef-bs-sec"><div class="ef-bs-lbl">Kategorie</div><div class="ef-bs-val">'+h.esc(k.kategorie||"—")+'</div></div>'
        +'<div class="ef-bs-sec"><div class="ef-bs-lbl">Dauer</div><div class="ef-bs-val">'+(k.aufwandStunden!==null?k.aufwandStunden.toFixed(1)+' h':'—')+'</div></div>'
        +'<div class="ef-bs-sec"><div class="ef-bs-lbl">Betrag</div><div class="ef-bs-val" style="color:var(--tm-text-muted)">'+(k.anzeigeBetrag!==null?'CHF '+h.chf(k.anzeigeBetrag):'—')+'</div></div>'
        +'<div class="ef-bs-sec"><div class="ef-bs-lbl">Verrechenbar</div><div class="ef-bs-val">'+h.verrBadge(k.verrechenbar)+'</div></div>'
        +(k.bemerkungen?'<div class="ef-bs-sec"><div class="ef-bs-lbl">Bemerkungen</div><div class="ef-bs-val" style="font-size:13px;color:var(--tm-text-muted);white-space:pre-wrap">'+h.esc(k.bemerkungen)+'</div></div>':"")
        +'<div class="ef-bs-sec"><div class="ef-bs-lbl">Abrechnung</div><div class="ef-bs-val">'+h.abrBadge(k.abrechnung)+'</div></div>'
        +'<div style="padding:14px 16px 20px"><button class="ef-bs-edit" onclick="ctrl.closeBs();ctrl.openKonzeptionForm('+k.id+')">Bearbeiten</button></div>';
      overlay.classList.add("open");
      document.body.style.overflow="hidden";
    },

    updateMobileCards() {
      const container = document.getElementById("ef-mobile-cards");
      if (!container) return;
      const f = state.filters.einsaetze;
      const firmaColorMap = state.ui._firmaColorMap || {};
      let list = [...state.enriched.einsaetze];
      if (f.search)       list = list.filter(e => h.inc(e.title,f.search)||h.inc(e.projektTitle,f.search)||h.inc(e.personName,f.search));
      if (f.jahr)         list = list.filter(e => e.datum && new Date(e.datum).getFullYear()===+f.jahr);
      if (f.firma)        list = list.filter(e => { const p=state.enriched.projekte.find(p=>p.id===e.projektLookupId); return p?.firmaName===f.firma; });
      if (f.projekt)      list = list.filter(e => e.projektLookupId===+f.projekt);
      if (f.einsatzStatus) list = list.filter(e => e.einsatzStatus===f.einsatzStatus);
      if (f.person)       list = list.filter(e => e.personName===f.person);
      if (f.abrechnung)   list = list.filter(e => e.abrechnung===f.abrechnung);
      list.sort((a,b) => h.toDate(b.datum) - h.toDate(a.datum));
      const initials = n => n ? n.split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase() : "?";
      container.innerHTML = list.length ? list.map(e => {
        const proj = state.enriched.projekte.find(p=>p.id===e.projektLookupId);
        const isCancelled = ["abgesagt","abgesagt-chf"].includes(e.einsatzStatus);
        const fn = proj?.firmaName||"";
        const fc = firmaColorMap[fn];
        const fb = fn ? `<span class="ef-mc-badge" style="background:${fc?.bg||"var(--tm-surface)"};color:${fc?.tx||"var(--tm-text-muted)"}">${h.esc(fn)}</span>` : "";
        return `<div class="ef-mc${isCancelled?" cancelled":""}" data-action="open-bs" data-id="${e.id}">
          <div class="ef-mc-top"><div class="ef-mc-date">${h.esc(e.datumFmt)}</div><div class="ef-mc-status">${h.statusBadge(e)}</div></div>
          <div class="ef-mc-title">${h.esc(e.title||e.kategorie)}</div>
          <div class="ef-mc-kat">${h.esc(e.kategorie)}</div>
          <div class="ef-mc-row">${fb}<span class="ef-mc-proj">${h.esc(e.projektTitle||"")}${proj?.projektNr?` #${h.esc(proj.projektNr)}`:""}</span></div>
          <div class="ef-mc-foot">
            <div class="ef-mc-person"><span class="ef-av" style="width:20px;height:20px;font-size:8px">${initials(e.personName||"?")}</span>${e.coPersonName&&e.coPersonName!=="—"?`<span class="ef-av" style="width:20px;height:20px;font-size:8px;margin-left:-6px">${initials(e.coPersonName)}</span>`:""}<span>${h.esc(e.personName)}${e.coPersonName&&e.coPersonName!=="—"?` · ${h.esc(e.coPersonName.split(" ").pop())}`:""}</span></div>
            ${e.ort ? `<div class="ef-mc-ort">${h.esc(e.ort)}</div>` : ""}
          </div>
        </div>`;
      }).join("") : `<div style="padding:40px;text-align:center;color:var(--tm-text-muted);font-size:14px">Keine Einsätze gefunden.</div>`;
    },

    updateKonzDetailPanel() {
      const panel = document.querySelector(".kz-dp-scroll");
      if (!panel) return;
      const selId = state.ui.selectedKonzId;
      const k = selId ? state.enriched.konzeption.find(k=>k.id===selId) : null;
      const proj = k ? state.enriched.projekte.find(p=>p.id===k.projektLookupId) : null;
      if (!k) { panel.innerHTML = `<div class="kz-dp-empty"><div style="font-size:28px;opacity:0.2">☰</div><span>Zeile auswählen für Details</span></div>`; return; }
      panel.innerHTML = `
        <div class="kz-dp-title">${h.esc(k.title)}</div>
        <div class="kz-dp-sub">${h.esc(proj?.firmaName||"")}${proj?.projektNr?` · #${proj.projektNr}`:""}</div>
        <div class="kz-dp-row"><span class="kz-dp-key">Datum</span><span class="kz-dp-val">${h.esc(k.datumFmt)}</span></div>
        <div class="kz-dp-row"><span class="kz-dp-key">Projekt</span><span class="kz-dp-val">${h.esc(k.projektTitle||"—")}</span></div>
        <div class="kz-dp-row"><span class="kz-dp-key">Kategorie</span><span class="kz-dp-val">${h.esc(k.kategorie)}</span></div>
        <div class="kz-dp-row"><span class="kz-dp-key">Person</span><span class="kz-dp-val">${h.esc(k.personName||"—")}</span></div>
        <div class="kz-dp-row"><span class="kz-dp-key">Aufwand</span><span class="kz-dp-val">${k.aufwandStunden!==null?k.aufwandStunden.toFixed(1)+" h":"—"}</span></div>
        <div class="kz-dp-row"><span class="kz-dp-key">Betrag</span><span class="kz-dp-val" style="font-weight:700">${k.anzeigeBetrag!==null?`CHF ${h.chf(k.anzeigeBetrag)}`:"—"}</span></div>
        <div class="kz-dp-row"><span class="kz-dp-key">Verrechenbar</span><span class="kz-dp-val">${h.verrBadge(k.verrechenbar)}</span></div>
        <div class="kz-dp-row"><span class="kz-dp-key">Abrechnung</span><span class="kz-dp-val">${h.abrBadge(k.abrechnung)}</span></div>
        ${k.bemerkungen?`<div class="kz-dp-note">${h.esc(k.bemerkungen)}</div>`:""}
        <div class="kz-dp-footer">
          <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="edit-konzeption" data-id="${k.id}">✎ Bearbeiten</button>
          <button class="tm-btn tm-btn-sm" data-action="delete-konzeption" data-id="${k.id}" style="color:var(--tm-red)">🗑</button>
        </div>`;
    },

    abrMobOpen(id) {
      const a = state.enriched.abrechnungen.find(a=>a.id===id);
      if (!a) return;
      const proj = state.enriched.projekte.find(p=>p.id===a.projektLookupId);
      const status = a.status||"erstellt";
      const abrStatusBadge = s => { const map={erstellt:"#B5D4F4:#0C447C",versendet:"#FEF3C7:#854F0B",bezahlt:"#D1FAE5:#0F6E56"}; const [bg,tx]=(map[s]||"#f1f5f9:#475569").split(":"); return `<span style="background:${bg};color:${tx};font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">${h.esc(s)}</span>`; };
      ui.renderModal(`
        <style>
          .ei-bs-bd{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:flex-end}
          .ei-bs{background:#fff;border-radius:16px 16px 0 0;width:100%;max-height:85vh;overflow-y:auto;padding:0 0 env(safe-area-inset-bottom)}
          .ei-bs-handle{width:40px;height:4px;background:#dde3ea;border-radius:2px;margin:12px auto 0}
          .ei-bs-head{padding:12px 16px 10px;border-bottom:1px solid rgba(0,0,0,0.09)}
          .ei-bs-title{font-size:16px;font-weight:700}
          .ei-bs-sub{font-size:12px;color:#8896a5;margin-top:2px;font-weight:600}
          .ei-bs-body{padding:4px 16px 14px}
          .ei-bs-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(0,0,0,0.07);font-size:14px}
          .ei-bs-row:last-child{border-bottom:none}
          .ei-bs-key{color:#8896a5;font-weight:600;font-size:13px}
          .ei-bs-val{font-weight:600;font-size:13px;text-align:right}
          .ei-bs-actions{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(0,0,0,0.09)}
        </style>
        <div class="ei-bs-bd">
          <div class="ei-bs">
            <div class="ei-bs-handle"></div>
            <div class="ei-bs-head">
              <div class="ei-bs-title">${h.esc(a.title||a.datumFmt)}</div>
              <div class="ei-bs-sub">${h.esc(proj?.firmaName||"")}${proj?.projektNr?` · #${proj.projektNr}`:""}</div>
            </div>
            <div class="ei-bs-body">
              <div class="ei-bs-row"><span class="ei-bs-key">Datum</span><span class="ei-bs-val">${h.esc(a.datumFmt)}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Projekt</span><span class="ei-bs-val">${h.esc(a.projektTitle||"—")}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Status</span><span class="ei-bs-val">${abrStatusBadge(status)}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Total</span><span class="ei-bs-val" style="color:#004078">CHF ${h.chf(a.totalBetrag||0)}</span></div>
            </div>
            <div class="ei-bs-actions">
              <button class="tm-btn tm-btn-sm tm-btn-primary" onclick="ctrl.abrDownloadPdf(${a.id});ui.closeModal()">⬇ PDF</button>
              ${proj?`<button class="tm-btn tm-btn-sm" onclick="ui.closeModal();ctrl.openProjekt(${a.projektLookupId})">📋 Projekt</button>`:""}
            </div>
          </div>
        </div>`);
    },

    updateFirmaDetailPanel() {
      const panel = document.querySelector(".fi-dp-scroll");
      if (!panel) return;
      // Re-render via views.firmen() would lose scroll position — update innerHTML directly with new style
      const selId = state.ui.selectedFirmaId;
      if (!selId) { panel.innerHTML = `<div class="fi-dp-empty"><div style="font-size:40px;opacity:.08;margin-bottom:10px">🏢</div><div>Firma auswählen</div></div>`; return; }
      // Delegate to firmen() detail generator by doing full re-render
      ctrl.render();
    },

    updateAbrDetailPanel() {
      const panel = document.querySelector(".abr-dp-scroll");
      if (!panel) return;
      const selId = state.ui.selectedAbrId;
      const a = selId ? state.enriched.abrechnungen.find(a=>a.id===selId) : null;
      if (!a) { panel.innerHTML = `<div class="abr-dp-empty"><div style="font-size:28px;opacity:0.2">☰</div><span>Abrechnung auswählen</span></div>`; return; }
      const proj = state.enriched.projekte.find(p=>p.id===a.projektLookupId);
      const einsaetze = state.enriched.einsaetze.filter(e=>e.abrechnungLookupId===a.id);
      const konz = state.enriched.konzeption.filter(k=>k.abrechnungLookupId===a.id);
      const status = a.status||"erstellt";
      const abrStatusBadge = s => { const map={erstellt:"#B5D4F4:#0C447C",versendet:"#FEF3C7:#854F0B",bezahlt:"#D1FAE5:#0F6E56"}; const [bg,tx]=(map[s]||"#f1f5f9:#475569").split(":"); return `<span style="background:${bg};color:${tx};font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;white-space:nowrap">${h.esc(s||"erstellt")}</span>`; };
      const flowBtns = ["erstellt","versendet","bezahlt"].map(s=>`<button class="abr-flow-btn${status===s?" abr-flow-active":""}" onclick="ctrl.abrSetStatus(${a.id},'${s}')">${h.esc(s)}</button>`).join("");
      panel.innerHTML = `
        <div class="abr-dp-title">${h.esc(a.title||a.datumFmt)}</div>
        <div class="abr-dp-sub">${h.esc(proj?.firmaName||"")}${proj?.projektNr?` · #${proj.projektNr}`:""}</div>
        <div class="abr-dp-flow">${flowBtns}</div>
        <div class="abr-dp-row"><span class="abr-dp-key">Datum</span><span class="abr-dp-val">${h.esc(a.datumFmt)}</span></div>
        <div class="abr-dp-row"><span class="abr-dp-key">Projekt</span><span class="abr-dp-val">${h.esc(a.projektTitle||"—")}</span></div>
        <div class="abr-dp-row"><span class="abr-dp-key">Status</span><span class="abr-dp-val">${abrStatusBadge(status)}</span></div>
        <div class="abr-dp-row"><span class="abr-dp-key">Total</span><span class="abr-dp-val" style="font-weight:700;color:#004078">CHF ${h.chf(a.totalBetrag||0)}</span></div>
        ${einsaetze.length?`<div class="abr-dp-row"><span class="abr-dp-key">Einsätze</span><span class="abr-dp-val">${einsaetze.length}</span></div>`:""}
        ${konz.length?`<div class="abr-dp-row"><span class="abr-dp-key">Konzeption</span><span class="abr-dp-val">${konz.length} Einträge</span></div>`:""}
        <div class="abr-dp-footer">
          <button class="tm-btn tm-btn-sm tm-btn-primary" onclick="ctrl.abrDownloadPdf(${a.id})">⬇ PDF</button>
          ${proj?`<button class="tm-btn tm-btn-sm" onclick="ctrl.openProjekt(${a.projektLookupId})">📋 Projekt</button>`:""}
          <button class="tm-btn tm-btn-sm" data-action="delete-abrechnung" data-id="${a.id}" style="color:var(--tm-red);margin-left:auto">🗑</button>
        </div>`;
    },

    kzMobOpen(id) {
      const k = state.enriched.konzeption.find(k=>k.id===id);
      if (!k) return;
      const proj = state.enriched.projekte.find(p=>p.id===k.projektLookupId);
      ui.renderModal(`
        <style>
          .ei-bs-bd{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:flex-end}
          .ei-bs{background:#fff;border-radius:16px 16px 0 0;width:100%;max-height:85vh;overflow-y:auto;padding:0 0 env(safe-area-inset-bottom)}
          .ei-bs-handle{width:40px;height:4px;background:#dde3ea;border-radius:2px;margin:12px auto 0}
          .ei-bs-head{padding:12px 16px 10px;border-bottom:1px solid rgba(0,0,0,0.09)}
          .ei-bs-title{font-size:16px;font-weight:700}
          .ei-bs-sub{font-size:12px;color:#8896a5;margin-top:2px;font-weight:600}
          .ei-bs-body{padding:4px 16px 14px}
          .ei-bs-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(0,0,0,0.07);font-size:14px}
          .ei-bs-row:last-child{border-bottom:none}
          .ei-bs-key{color:#8896a5;font-weight:600;font-size:13px}
          .ei-bs-val{font-weight:600;font-size:13px;text-align:right}
          .ei-bs-actions{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(0,0,0,0.09)}
        </style>
        <div class="ei-bs-bd">
          <div class="ei-bs">
            <div class="ei-bs-handle"></div>
            <div class="ei-bs-head">
              <div class="ei-bs-title">${h.esc(k.title)}</div>
              <div class="ei-bs-sub">${h.esc(proj?.firmaName||"")}${proj?.projektNr?` · #${proj.projektNr}`:""}</div>
            </div>
            <div class="ei-bs-body">
              <div class="ei-bs-row"><span class="ei-bs-key">Datum</span><span class="ei-bs-val">${h.esc(k.datumFmt)}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Projekt</span><span class="ei-bs-val">${h.esc(k.projektTitle||"—")}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Kategorie</span><span class="ei-bs-val">${h.esc(k.kategorie)}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Person</span><span class="ei-bs-val">${h.esc(k.personName||"—")}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Aufwand</span><span class="ei-bs-val">${k.aufwandStunden!==null?k.aufwandStunden.toFixed(1)+" h":"—"}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Betrag</span><span class="ei-bs-val" style="color:#004078">${k.anzeigeBetrag!==null?`CHF ${h.chf(k.anzeigeBetrag)}`:"—"}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Verrechenbar</span><span class="ei-bs-val">${h.verrBadge(k.verrechenbar)}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Abrechnung</span><span class="ei-bs-val">${h.abrBadge(k.abrechnung)}</span></div>
            </div>
            <div class="ei-bs-actions">
              <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="edit-konzeption" data-id="${k.id}" onclick="ui.closeModal()">✎ Bearbeiten</button>
              <button class="tm-btn tm-btn-sm" data-action="delete-konzeption" data-id="${k.id}" onclick="ui.closeModal()" style="color:var(--tm-red)">🗑</button>
            </div>
          </div>
        </div>`);
    },

    updateDetailPanel() {
      const panel = document.querySelector(".ei-dp-scroll");
      if (!panel) return;
      const selId = state.ui.selectedEinsatzId;
      const sel   = selId ? state.enriched.einsaetze.find(e => e.id === selId) : null;
      const proj  = sel ? state.enriched.projekte.find(p => p.id === sel.projektLookupId) : null;
      const initials = n => (n||"").split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
      if (!sel) {
        panel.innerHTML = `<div class="ei-dp-empty"><div style="font-size:28px;opacity:0.2">☰</div><span>Zeile auswählen für Details</span></div>`;
        return;
      }
      panel.innerHTML = `
        <div class="ei-dp-title">${h.esc(sel.title||sel.kategorie)}</div>
        <div class="ei-dp-sub">${h.esc(proj?.firmaName||"")}</div>
        <div class="ei-dp-row"><span class="ei-dp-key">Datum</span><span class="ei-dp-val">${h.esc(sel.datumFmt)}</span></div>
        <div class="ei-dp-row"><span class="ei-dp-key">Projekt</span><span class="ei-dp-val">${h.esc(sel.projektTitle||"—")}${proj?.projektNr?` #${proj.projektNr}`:""}</span></div>
        <div class="ei-dp-row"><span class="ei-dp-key">Kategorie</span><span class="ei-dp-val">${h.esc(sel.kategorie)}</span></div>
        <div class="ei-dp-row"><span class="ei-dp-key">Person</span><span class="ei-dp-val">
          <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
            <span class="ei-av ei-av-lead">${initials(sel.personName)}</span>
            ${sel.coPersonName&&sel.coPersonName!=="—"?`<span class="ei-av ei-av-co">${initials(sel.coPersonName)}</span>`:""}
            <span style="font-size:12px">${h.esc(sel.personName)}${sel.coPersonName&&sel.coPersonName!=="—"?` · ${h.esc(sel.coPersonName)}`:""}</span>
          </div>
        </span></div>
        ${sel.ort?`<div class="ei-dp-row"><span class="ei-dp-key">Ort</span><span class="ei-dp-val">${h.esc(sel.ort)}</span></div>`:""}
        <div class="ei-dp-row"><span class="ei-dp-key">Status</span><span class="ei-dp-val">${h.statusBadge(sel)}</span></div>
        <div class="ei-dp-row"><span class="ei-dp-key">Betrag</span><span class="ei-dp-val" style="font-weight:700">${
          sel.coAnzeigeBetrag
            ? `CHF ${h.chf(sel.totalBetrag)} <span style="font-size:11px;font-weight:400;color:#8896a5">(Lead ${h.chf(sel.anzeigeBetrag)} + Co ${h.chf(sel.coAnzeigeBetrag)})</span>`
            : sel.anzeigeBetrag !== null ? `CHF ${h.chf(sel.anzeigeBetrag)}` : "—"
        }</span></div>
        ${sel.spesenBerechnet?`<div class="ei-dp-row"><span class="ei-dp-key">Wegspesen</span><span class="ei-dp-val">CHF ${h.chf(sel.spesenBerechnet)}</span></div>`:""}
        <div class="ei-dp-row"><span class="ei-dp-key">Abrechnung</span><span class="ei-dp-val">${h.abrBadge(sel.abrechnung)}</span></div>
        ${sel.bemerkungen?`<div class="ei-dp-note">${h.esc(sel.bemerkungen)}</div>`:""}
        <div class="ei-dp-footer">
          <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="edit-einsatz" data-id="${sel.id}">✎ Bearbeiten</button>
        </div>`;
    },


    openFs(key) {
      const overlay = document.getElementById("ef-fs-overlay");
      const title   = document.getElementById("ef-fs-title");
      const body    = document.getElementById("ef-fs-body");
      if (!overlay||!title||!body) return;
      const f = state.filters.einsaetze;
      const all = state.enriched.einsaetze;
      const chip = (fkey, val, lbl) => {
        const isActive = f[fkey]===String(val);
        return `<div class="ef-fs-opt${isActive?" active":""}" data-action="fs-select" data-fkey="${fkey}" data-fval="${String(val).replace(/"/g,"&quot;")}">
          <span>${h.esc(lbl)}</span>
          <span class="ef-fs-check">${isActive?"✓":""}</span>
        </div>`;
      };
      if (key==="search") {
        title.textContent = "Suche";
        body.innerHTML = `<div style="padding:14px 16px">
          <input type="search" placeholder="Titel, Projekt, Person…" value="${h.esc(f.search||"")}"
            style="width:100%;padding:12px 14px;font-size:16px;border:1.5px solid var(--tm-border);border-radius:10px;background:var(--tm-bg);color:var(--tm-text);outline:none;box-sizing:border-box"
            oninput="state.filters.einsaetze.search=this.value;ctrl.updateMobileCards()" autofocus>
        </div>`;
      } else if (key==="jahr") {
        title.textContent = "Jahr";
        const jahre = [...new Set(all.map(e=>e.datum?new Date(e.datum).getFullYear():null).filter(Boolean))].sort((a,b)=>b-a);
        body.innerHTML = chip("jahr","","Alle Jahre") + jahre.map(j=>chip("jahr",j,j)).join("");
      } else if (key==="firma") {
        title.textContent = "Firma";
        const firmen = [...new Set(all.map(e=>{const p=state.enriched.projekte.find(p=>p.id===e.projektLookupId);return p?.firmaName||"";}).filter(Boolean))].sort();
        body.innerHTML = chip("firma","","Alle Firmen") + firmen.map(n=>chip("firma",n,n)).join("");
      } else if (key==="projekt") {
        title.textContent = "Projekt";
        const proj = [...new Map(all.map(e=>{
          const p=state.enriched.projekte.find(p=>p.id===e.projektLookupId);
          const nr=p?.projektNr||""; const lbl=nr?`#${nr} ${e.projektTitle}`:e.projektTitle;
          return [e.projektLookupId,lbl];
        })).entries()].filter(([,t])=>t).sort((a,b)=>{
          const na=a[1].match(/#(\d+)/)?.[1]||""; const nb=b[1].match(/#(\d+)/)?.[1]||"";
          return na&&nb?+na - +nb:a[1].localeCompare(b[1]);
        });
        body.innerHTML = chip("projekt","","Alle Projekte") + proj.map(([id,t])=>chip("projekt",id,t)).join("");
      } else if (key==="einsatzStatus") {
        title.textContent = "Status";
        body.innerHTML = chip("einsatzStatus","","Alle Status") +
          [["geplant","Geplant"],["durchgefuehrt","Durchgeführt"],["abgesagt","Abgesagt"],["abgesagt-chf","Abgesagt (CHF)"]].map(([v,l])=>chip("einsatzStatus",v,l)).join("");
      } else if (key==="person") {
        title.textContent = "Person";
        const personen = [...new Set([
          ...all.map(e=>e.personName).filter(n=>n&&n!=="—"),
          ...all.map(e=>e.coPersonName).filter(n=>n&&n!=="—")
        ])].sort((a,b)=>a.split(" ").pop().localeCompare(b.split(" ").pop()));
        body.innerHTML = chip("person","","Alle Personen") + personen.map(n=>chip("person",n,n)).join("");
      } else if (key==="abrechnung") {
        title.textContent = "Abrechnung";
        body.innerHTML = chip("abrechnung","","Alle") + state.choices.einsatzAbrechnung.map(s=>chip("abrechnung",s,s)).join("");
      }
      // fs-select click delegation inside sheet
      body.onclick = ev => {
        const opt = ev.target.closest("[data-action='fs-select']");
        if (!opt) return;
        const fk=opt.dataset.fkey, fv=opt.dataset.fval;
        state.filters.einsaetze[fk] = state.filters.einsaetze[fk]===fv ? "" : fv;
        state.ui.selectedEinsatzId=null;
        ctrl.closeFs();
        ctrl.render();
      };
      overlay.classList.add("open");
      document.body.style.overflow="hidden";
    },

    closeFs() {
      const overlay = document.getElementById("ef-fs-overlay");
      if (overlay) overlay.classList.remove("open");
      document.body.style.overflow="";
    },

    openBs(id) {
      const e = state.enriched.einsaetze.find(x=>x.id===id);
      if (!e) return;
      const proj = state.enriched.projekte.find(p=>p.id===e.projektLookupId);
      const initials = n => n.split(" ").filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
      const overlay = document.getElementById("ef-bs-overlay");
      const bsTitle = document.getElementById("ef-bs-title");
      const bsSub   = document.getElementById("ef-bs-sub");
      const bsBody  = document.getElementById("ef-bs-body");
      if (!overlay||!bsTitle||!bsBody) return;
      bsTitle.textContent = e.title||e.kategorie;
      bsSub.textContent   = proj?.firmaName||"";
      const av = n => `<div class="ef-bs-av">${initials(n||"?")}</div>`;
      bsBody.innerHTML = `
        <div class="ef-bs-sec"><div class="ef-bs-lbl">Datum</div><div class="ef-bs-val">${h.esc(e.datumFmt)}</div></div>
        ${proj?`<div class="ef-bs-sec"><div class="ef-bs-lbl">Projekt</div><div class="ef-bs-val">${h.esc(proj.title)}${proj.projektNr?` <span style="color:var(--tm-text-muted);font-size:12px">#${h.esc(proj.projektNr)}</span>`:""}</div></div>`:""}
        <div class="ef-bs-sec"><div class="ef-bs-lbl">Beschreibung</div><div class="ef-bs-val">${h.esc(e.title||"—")}</div></div>
        <div class="ef-bs-sec"><div class="ef-bs-lbl">Kategorie</div><div class="ef-bs-val">${h.esc(e.kategorie||"—")}</div></div>
        <div class="ef-bs-sec"><div class="ef-bs-lbl">Personen</div>
          <div class="ef-bs-person">${av(e.personName)}<div><div style="font-size:14px;font-weight:500">${h.esc(e.personName)}</div><div style="font-size:11px;color:var(--tm-text-muted)">Lead</div></div></div>
          ${e.coPersonName&&e.coPersonName!=="—"?`<div class="ef-bs-person" style="margin-top:6px">${av(e.coPersonName)}<div><div style="font-size:14px;font-weight:500">${h.esc(e.coPersonName)}</div><div style="font-size:11px;color:var(--tm-text-muted)">Co-Lead</div></div></div>`:""}
        </div>
        <div class="ef-bs-sec"><div class="ef-bs-lbl">Status</div><div class="ef-bs-val">${h.statusBadge(e)}</div></div>
        ${e.ort?`<div class="ef-bs-sec"><div class="ef-bs-lbl">Ort</div><div class="ef-bs-val">${h.esc(e.ort)}</div></div>`:""}
        ${e.bemerkungen?`<div class="ef-bs-sec"><div class="ef-bs-lbl">Bemerkungen</div><div class="ef-bs-val" style="font-size:13px;color:var(--tm-text-muted);white-space:pre-wrap">${h.esc(e.bemerkungen)}</div></div>`:""}
        <div class="ef-bs-sec"><div class="ef-bs-lbl">Betrag</div><div class="ef-bs-val" style="font-weight:700">${
          e.coAnzeigeBetrag
            ? `CHF ${h.chf(e.totalBetrag)} <span style="font-size:11px;font-weight:400;opacity:.7">(Lead ${h.chf(e.anzeigeBetrag)} + Co ${h.chf(e.coAnzeigeBetrag)})</span>`
            : e.anzeigeBetrag !== null ? "CHF " + h.chf(e.anzeigeBetrag) : "—"
        }</div></div>
        <div class="ef-bs-sec"><div class="ef-bs-lbl">Wegspesen</div><div class="ef-bs-val" style="color:var(--tm-text-muted)">${e.spesenAnzeige?"CHF "+h.chf(e.spesenAnzeige):"CHF 0.00 (keine Verrechnung)"}</div></div>
        <div class="ef-bs-sec"><div class="ef-bs-lbl">Abrechnung</div><div class="ef-bs-val">${h.abrBadge(e.abrechnung)}</div></div>
        <div style="padding:14px 16px 20px">
          <button class="ef-bs-edit" onclick="ctrl.closeBs();ctrl.openEinsatzForm(${e.id})">Bearbeiten</button>
        </div>`;
      overlay.classList.add("open");
      document.body.style.overflow = "hidden";
    },

    closeBs() {
      const overlay = document.getElementById("ef-bs-overlay");
      if (overlay) overlay.classList.remove("open");
      document.body.style.overflow = "";
    },


    // ── Projekt-Formular ───────────────────────────────────────────────────
    openFirma(id) {
      state.form = null;
      state.selection.firmaId = id;
      state.filters.route = "firma-detail";
      this.render();
      window.scrollTo(0, 0);
    },

    eiMobOpenEinsatz(id) {
      const e = state.enriched.einsaetze.find(e => e.id === id);
      if (!e) return;
      const proj = state.enriched.projekte.find(p => p.id === e.projektLookupId);
      ui.renderModal(`
        <style>
          .ei-bs-bd{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:flex-end}
          .ei-bs{background:#fff;border-radius:16px 16px 0 0;width:100%;max-height:85vh;overflow-y:auto;padding:0 0 env(safe-area-inset-bottom)}
          .ei-bs-handle{width:40px;height:4px;background:#dde3ea;border-radius:2px;margin:12px auto 0}
          .ei-bs-head{padding:12px 16px 10px;border-bottom:1px solid rgba(0,0,0,0.09)}
          .ei-bs-title{font-size:16px;font-weight:700}
          .ei-bs-sub{font-size:12px;color:#8896a5;margin-top:2px;font-weight:600}
          .ei-bs-body{padding:4px 16px 14px}
          .ei-bs-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(0,0,0,0.07);font-size:14px}
          .ei-bs-row:last-child{border-bottom:none}
          .ei-bs-key{color:#8896a5;font-weight:600;font-size:13px}
          .ei-bs-val{font-weight:600;font-size:13px;text-align:right}
          .ei-bs-actions{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(0,0,0,0.09)}
        </style>
        <div class="ei-bs-bd">
          <div class="ei-bs">
            <div class="ei-bs-handle"></div>
            <div class="ei-bs-head">
              <div class="ei-bs-title">${h.esc(e.title||e.kategorie)}</div>
              <div class="ei-bs-sub">${h.esc(proj?.firmaName||"")}${proj?.projektNr?` · #${proj.projektNr}`:""}</div>
            </div>
            <div class="ei-bs-body">
              <div class="ei-bs-row"><span class="ei-bs-key">Datum</span><span class="ei-bs-val">${h.esc(e.datumFmt)}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Projekt</span><span class="ei-bs-val">${h.esc(e.projektTitle||"—")}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Kategorie</span><span class="ei-bs-val">${h.esc(e.kategorie)}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Person</span><span class="ei-bs-val">${h.esc(e.personName)}${e.coPersonName&&e.coPersonName!=="—"?` · ${h.esc(e.coPersonName)}`:""}</span></div>
              ${e.ort?`<div class="ei-bs-row"><span class="ei-bs-key">Ort</span><span class="ei-bs-val">${h.esc(e.ort)}</span></div>`:""}
              <div class="ei-bs-row"><span class="ei-bs-key">Status</span><span class="ei-bs-val">${h.statusBadge(e)}</span></div>
              <div class="ei-bs-row"><span class="ei-bs-key">Betrag</span><span class="ei-bs-val" style="color:#004078">${e.anzeigeBetrag!==null?`CHF ${h.chf(e.anzeigeBetrag)}`:"—"}</span></div>
              ${e.spesenBerechnet?`<div class="ei-bs-row"><span class="ei-bs-key">Wegspesen</span><span class="ei-bs-val">CHF ${h.chf(e.spesenBerechnet)}</span></div>`:""}
              <div class="ei-bs-row"><span class="ei-bs-key">Abrechnung</span><span class="ei-bs-val">${h.abrBadge(e.abrechnung)}</span></div>
            </div>
            <div class="ei-bs-actions">
              <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="edit-einsatz" data-id="${e.id}" onclick="ui.closeModal()">✎ Bearbeiten</button>
              <button class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${e.id}" onclick="ui.closeModal()">⧉</button>
              <button class="tm-btn tm-btn-sm" data-action="delete-einsatz" data-id="${e.id}" onclick="ui.closeModal()" style="color:var(--tm-red)">🗑</button>
            </div>
          </div>
        </div>`);
    },

    openProjekt(id) {
      state.form = null;
      state.selection.projektId = id;
      state.filters.route = "projekt-detail";
      state.ui.selectedProjektEinsatzId = null;
      state.ui.selectedProjektKonzId = null;
      this.render();
      window.scrollTo(0, 0);
    },

    pdMobOpenEinsatz(id) {
      const p = state.enriched.projekte.find(p => p.id === state.selection.projektId);
      const e = p?.einsaetze.find(e => e.id === id);
      if (!e) return;
      ui.renderModal(`
        <style>
          .pd-bs-bd{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:flex-end}
          .pd-bs{background:#fff;border-radius:16px 16px 0 0;width:100%;max-height:85vh;overflow-y:auto;padding:0 0 env(safe-area-inset-bottom)}
          .pd-bs-handle{width:40px;height:4px;background:#dde3ea;border-radius:2px;margin:12px auto 0}
          .pd-bs-head{padding:12px 16px 10px;border-bottom:1px solid rgba(0,0,0,0.09)}
          .pd-bs-title{font-size:16px;font-weight:700;color:var(--tm-text)}
          .pd-bs-body{padding:14px 16px}
          .pd-bs-row{display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.07);font-size:14px}
          .pd-bs-row:last-child{border-bottom:none}
          .pd-bs-key{color:var(--tm-text-muted);font-weight:600}
          .pd-bs-val{text-align:right;font-weight:600;max-width:60%}
          .pd-bs-note{margin-top:10px;padding:10px 12px;background:#f5f7fa;border-radius:8px;font-size:13px;color:var(--tm-text-muted);line-height:1.5}
          .pd-bs-actions{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(0,0,0,0.09)}
        </style>
        <div class="pd-bs-bd">
          <div class="pd-bs">
            <div class="pd-bs-handle"></div>
            <div class="pd-bs-head"><div class="pd-bs-title">${h.esc(e.title)}</div></div>
            <div class="pd-bs-body">
              <div class="pd-bs-row"><span class="pd-bs-key">Datum</span><span class="pd-bs-val">${h.esc(e.datumFmt)}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Kategorie</span><span class="pd-bs-val">${h.esc(e.kategorie)}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Person</span><span class="pd-bs-val">${h.esc(e.personName)}${e.coPersonName&&e.coPersonName!=="—"?` · ${h.esc(e.coPersonName)}`:""}</span></div>
              ${e.ort?`<div class="pd-bs-row"><span class="pd-bs-key">Ort</span><span class="pd-bs-val">${h.esc(e.ort)}</span></div>`:""}
              <div class="pd-bs-row"><span class="pd-bs-key">Status</span><span class="pd-bs-val">${h.statusBadge(e)}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Betrag</span><span class="pd-bs-val" style="color:var(--tm-blue)">${e.anzeigeBetrag!==null?`CHF ${h.chf(e.anzeigeBetrag)}`:"—"}</span></div>
              ${e.spesenBerechnet?`<div class="pd-bs-row"><span class="pd-bs-key">Wegspesen</span><span class="pd-bs-val">CHF ${h.chf(e.spesenBerechnet)}</span></div>`:""}
              <div class="pd-bs-row"><span class="pd-bs-key">Abrechnung</span><span class="pd-bs-val">${h.abrBadge(e.abrechnung)}</span></div>
              ${e.bemerkungen?`<div class="pd-bs-note">${h.esc(e.bemerkungen)}</div>`:""}
            </div>
            <div class="pd-bs-actions">
              <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="edit-einsatz" data-id="${e.id}" onclick="ui.closeModal()">✎ Bearbeiten</button>
              <button class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${e.id}" onclick="ui.closeModal()">⧉ Duplizieren</button>
              <button class="tm-btn tm-btn-sm" data-action="delete-einsatz" data-id="${e.id}" onclick="ui.closeModal()" style="color:var(--tm-red)">🗑</button>
            </div>
          </div>
        </div>`);
    },

    pdMobOpenKonz(id) {
      const p = state.enriched.projekte.find(p => p.id === state.selection.projektId);
      const k = p?.konzeintraege.find(k => k.id === id);
      if (!k) return;
      ui.renderModal(`
        <style>
          .pd-bs-bd{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:flex-end}
          .pd-bs{background:#fff;border-radius:16px 16px 0 0;width:100%;max-height:85vh;overflow-y:auto;padding:0 0 env(safe-area-inset-bottom)}
          .pd-bs-handle{width:40px;height:4px;background:#dde3ea;border-radius:2px;margin:12px auto 0}
          .pd-bs-head{padding:12px 16px 10px;border-bottom:1px solid rgba(0,0,0,0.09)}
          .pd-bs-title{font-size:16px;font-weight:700;color:var(--tm-text)}
          .pd-bs-body{padding:14px 16px}
          .pd-bs-row{display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.07);font-size:14px}
          .pd-bs-row:last-child{border-bottom:none}
          .pd-bs-key{color:var(--tm-text-muted);font-weight:600}
          .pd-bs-val{text-align:right;font-weight:600;max-width:60%}
          .pd-bs-note{margin-top:10px;padding:10px 12px;background:#f5f7fa;border-radius:8px;font-size:13px;color:var(--tm-text-muted);line-height:1.5}
          .pd-bs-actions{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(0,0,0,0.09)}
        </style>
        <div class="pd-bs-bd">
          <div class="pd-bs">
            <div class="pd-bs-handle"></div>
            <div class="pd-bs-head"><div class="pd-bs-title">${h.esc(k.title)}</div></div>
            <div class="pd-bs-body">
              <div class="pd-bs-row"><span class="pd-bs-key">Datum</span><span class="pd-bs-val">${h.esc(k.datumFmt)}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Kategorie</span><span class="pd-bs-val">${h.esc(k.kategorie)}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Person</span><span class="pd-bs-val">${h.esc(k.personName||"—")}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Aufwand</span><span class="pd-bs-val">${k.aufwandStunden!==null?k.aufwandStunden.toFixed(1)+" h":"—"}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Betrag</span><span class="pd-bs-val" style="color:var(--tm-blue)">${k.anzeigeBetrag!==null?`CHF ${h.chf(k.anzeigeBetrag)}`:"—"}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Verrechenbar</span><span class="pd-bs-val">${h.verrBadge(k.verrechenbar)}</span></div>
              <div class="pd-bs-row"><span class="pd-bs-key">Abrechnung</span><span class="pd-bs-val">${h.abrBadge(k.abrechnung)}</span></div>
              ${k.bemerkungen?`<div class="pd-bs-note">${h.esc(k.bemerkungen)}</div>`:""}
            </div>
            <div class="pd-bs-actions">
              <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="edit-konzeption" data-id="${k.id}" onclick="ui.closeModal()">✎ Bearbeiten</button>
              <button class="tm-btn tm-btn-sm" data-action="delete-konzeption" data-id="${k.id}" onclick="ui.closeModal()" style="color:var(--tm-red)">🗑</button>
            </div>
          </div>
        </div>`);
    },

    setTab(route, tab) { state.filters.activeTab[route] = tab; this.render(); },
    closeModal() { ui.closeModal(); },

    async resetKonzeptionAbrechnung(id) {
      const k = state.enriched.konzeption.find(k => k.id === id);
      if (!k) return;
      if (!confirm(
        `Abrechnung zurücksetzen für: «${k.title || k.datumFmt}»\n\n` +
        `Dieser Konzeptionsaufwand ist als «abgerechnet» markiert, hat aber keine verknüpfte Abrechnung mehr.\n\n` +
        `Der Status wird auf «offen» zurückgesetzt.\n\nFortfahren?`
      )) return;
      try {
        ui.setMsg("Wird zurückgesetzt…", "info");
        await api.patch(CONFIG.lists.konzeption, id, { Abrechnung: "offen" });
        ui.closeModal();
        ui.setMsg(`Konzeptionsaufwand zurückgesetzt.`, "success");
        await api.loadAll();
        ctrl.render();
      } catch (err) {
        debug.err("resetKonzeptionAbrechnung", err);
        ui.setMsg("Fehler: " + err.message, "error");
      }
    },

    async resetEinsatzAbrechnung(id) {
      const e = state.enriched.einsaetze.find(e => e.id === id);
      if (!e) return;
      if (!confirm(
        `Abrechnung zurücksetzen für: «${e.title || e.datumFmt}»\n\n` +
        `Dieser Einsatz ist als «abgerechnet» markiert, hat aber keine verknüpfte Abrechnung mehr.\n\n` +
        `Der Status wird auf «offen» zurückgesetzt.\n\nFortfahren?`
      )) return;
      try {
        ui.setMsg("Wird zurückgesetzt…", "info");
        await api.patch(CONFIG.lists.einsaetze, id, { Abrechnung: "offen" });
        ui.closeModal();
        ui.setMsg(`Einsatz zurückgesetzt.`, "success");
        await api.loadAll();
        ctrl.render();
      } catch (err) {
        debug.err("resetEinsatzAbrechnung", err);
        ui.setMsg("Fehler: " + err.message, "error");
      }
    },

    async abrSetStatus(id, newStatus) {
      try {
        await api.patch(CONFIG.lists.abrechnungen, id, { Status: newStatus });
        const a = state.enriched.abrechnungen.find(a => a.id === id);
        if (a) a.status = newStatus;
        const raw = state.data.abrechnungen.find(r => Number(r.id) === id);
        if (raw) raw.Status = newStatus;
        ui.setMsg(`Status auf «${newStatus}» gesetzt.`, "success");
        this.render();
      } catch (e) {
        debug.err("abrSetStatus", e);
        ui.setMsg("Fehler: " + e.message, "error");
      }
    },

    async abrDownloadPdf(id) {
      const a = state.enriched.abrechnungen.find(a => a.id === id);
      if (!a) { ui.setMsg("Abrechnung nicht gefunden.", "error"); return; }
      const proj = state.enriched.projekte.find(p => p.id === a.projektLookupId);
      if (!proj) { ui.setMsg("Projekt nicht gefunden.", "error"); return; }
      const einsaetze = state.enriched.einsaetze.filter(e => e.abrechnungLookupId === id);
      const konz      = state.enriched.konzeption.filter(k => k.abrechnungLookupId === id);
      ui.setMsg("PDF wird generiert…", "info");
      try {
        await ctrl.generateAbrechnungPDF(
          proj.id,
          einsaetze.map(e => e.id),
          konz.map(k => k.id),
          a.spesenZusatzBetrag || 0,
          a.spesenZusatzBemerkung || "",
          a.datum
        );
        ui.setMsg("PDF heruntergeladen.", "success");
      } catch(e) {
        debug.err("abrDownloadPdf", e);
        ui.setMsg("PDF fehlgeschlagen: " + e.message, "error");
      }
    },

    openProjektForm(id) {
      const p  = id ? state.enriched.projekte.find(p => p.id === id) : null;
      const cv = (k, fb = "") => p ? (p[k] ?? fb) : fb;
      const cn = k => (p && p[k] !== null && p[k] !== undefined) ? p[k] : "";

      // Kein Formular-Lock mehr nötig — Modal übernimmt
      const closeAction = id ? `ctrl.openProjekt(${id});ui.closeModal()` : `ui.closeModal()`;

      const numInp = (name, placeholder="—") =>
        `<div style="display:flex;align-items:center;border:1.5px solid #dde4ec;border-radius:8px;overflow:hidden;background:#f4f7fb">
          <span style="padding:7px 9px;background:#f0f3f7;font-size:11px;color:#8896a5;border-right:1px solid #dde4ec;flex-shrink:0;font-family:inherit">CHF</span>
          <input type="number" name="${name}" value="${cn(name) !== "" ? cn(name) : ""}" placeholder="${placeholder}" step="0.01" min="0"
            style="border:none;padding:7px 9px;font-size:13px;background:transparent;flex:1;min-width:0;outline:none;font-family:inherit;color:#1a2332;width:80px">
        </div>`;

      const field = (lbl, content, hint="") =>
        `<div style="display:flex;flex-direction:column;gap:5px">
          <label style="font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#8896a5">${lbl}</label>
          ${content}
          ${hint ? `<span style="font-size:11px;color:#8896a5">${hint}</span>` : ""}
        </div>`;

      const sec = (lbl, body) =>
        `<div style="display:flex;flex-direction:column;gap:12px">
          <div style="font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#8896a5;padding-bottom:8px;border-bottom:1.5px solid #dde4ec">${lbl}</div>
          ${body}
        </div>`;

      ui.renderModal(`<style>
        .pf-m{background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(0,64,120,.18),0 0 0 1px rgba(0,64,120,.06);width:100%;max-width:480px;max-height:92vh;display:flex;flex-direction:column;animation:pfUp .25s cubic-bezier(.16,1,.3,1)}
        @media(min-width:860px){.pf-m{max-width:860px}}
        @keyframes pfUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
        .pf-hd{background:#004078;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;border-radius:20px 20px 0 0}
        .pf-hd-t{color:#fff;font-size:14px;font-weight:700}
        .pf-hd-s{color:rgba(255,255,255,.55);font-size:12px;margin-top:1px}
        .pf-cl{width:28px;height:28px;background:rgba(255,255,255,.1);border:none;border-radius:7px;color:rgba(255,255,255,.8);font-size:14px;cursor:pointer;font-family:inherit}
        .pf-bd{overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:20px;flex:1;min-height:0}
        @media(min-width:860px){
          .pf-bd{display:grid;grid-template-columns:1fr 1fr;column-gap:28px;align-items:start}
          .pf-full{grid-column:1/-1}
        }
        .pf-inp{width:100%;padding:8px 11px;font-family:inherit;font-size:13px;font-weight:500;color:#1a2332;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;outline:none;transition:border-color .15s,-webkit-appearance .15s;-webkit-appearance:none}
        .pf-inp:focus{border-color:#0a5a9e;background:#fff;box-shadow:0 0 0 3px rgba(10,90,158,.1)}
        .pf-g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .pf-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
        @media(max-width:500px){.pf-g2,.pf-g3{grid-template-columns:1fr}}
        .pf-ft{padding:12px 20px 14px;border-top:1px solid #dde4ec;display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-shrink:0}
        .pf-btn-c{padding:8px 18px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;background:none;border:1.5px solid #dde4ec;color:#4a5568;cursor:pointer}
        .pf-btn-s{padding:8px 22px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:700;background:#004078;border:none;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,64,120,.25)}
        .pf-btn-s:hover{background:#0a5a9e}
        .pf-btn-del{padding:7px 14px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;background:none;border:1.5px solid #dde4ec;color:#950e13;cursor:pointer}
        .pf-btn-del:hover{background:#fff0f0;border-color:#950e13}
        /* Typeahead im Projekt-Formular */
        #projekt-form .tm-typeahead-input{width:100%;padding:8px 11px;font-family:inherit;font-size:13px;font-weight:500;color:#1a2332;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;outline:none;-webkit-appearance:none}
        #projekt-form .tm-typeahead-input:focus{border-color:#0a5a9e;background:#fff;box-shadow:0 0 0 3px rgba(10,90,158,.1)}
        #projekt-form .tm-typeahead-dropdown{border:1.5px solid #dde4ec;border-radius:8px;box-shadow:0 4px 16px rgba(0,64,120,.12);max-height:200px;overflow-y:auto;z-index:400}
        #projekt-form .tm-typeahead-item{padding:8px 11px;font-size:13px;font-weight:500}
      </style>
      <div class="pf-m">
        <div class="pf-hd">
          <div>
            <div class="pf-hd-t">${p ? "Projekt bearbeiten" : "Neues Projekt"}</div>
            <div class="pf-hd-s">${p ? `#${h.esc(p.projektNr||String(p.id))} · ${h.esc(p.firmaName||"")}` : "Neues Projekt erfassen"}</div>
          </div>
          <button class="pf-cl" onclick="${closeAction}">✕</button>
        </div>

        <form id="projekt-form" autocomplete="off" class="pf-bd">
          <input type="hidden" name="itemId" value="${id || ""}">
          <input type="hidden" name="mode" value="${id ? "edit" : "create"}">

          <!-- LINKE SPALTE -->
          <div style="display:flex;flex-direction:column;gap:14px">
            ${sec("Stammdaten", `
              ${field("Projektname *",
                `<input class="pf-inp" type="text" name="title" value="${h.esc(cv("title"))}" required>`)}
              <div class="pf-g2">
                ${field("Projekt-Nr.",
                  `<input class="pf-inp" type="text" name="projektNr" value="${h.esc(cv("projektNr"))}">`)}
                ${field("Konto-Nr. Honorar",
                  `<input class="pf-inp" type="text" name="kontoNr" value="${h.esc(cv("kontoNr"))}" placeholder="z.B. 3200">`)}
              </div>
              ${field("Ansprechpartner *", ui.personTypeahead("ansprechpartnerLookupId", p?.ansprechpartnerLookupId ? String(p.ansprechpartnerLookupId) : ""))}
              ${field("Firma",
                `<div id="firma-display" class="pf-inp" style="color:#8896a5;cursor:default">
                  ${h.esc(p?.firmaName || "wird aus Ansprechpartner übernommen")}
                </div>
                <input type="hidden" name="firmaLookupId" id="firma-hidden" value="${p?.firmaLookupId || ""}">`)}
              <div class="pf-g2">
                ${field("Status *",
                  `<select class="pf-inp" name="status" required>
                    ${state.choices.projektStatus.map(s => `<option value="${s}" ${cv("status","aktiv")===s?"selected":""}>${s}</option>`).join("")}
                  </select>`)}
                ${field("Km zum Kunden",
                  `<input class="pf-inp" type="number" name="kmZumKunden" value="${cn("kmZumKunden")}" placeholder="z.B. 28" min="0" step="1">`,
                  "Hin &amp; Zurück (×1 mit CHF/km)")}
              </div>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" name="archiviert" ${cv("archiviert") ? "checked" : ""}
                  style="width:15px;height:15px;accent-color:#004078;cursor:pointer">
                <span style="font-size:13px;font-weight:500;color:#4a5568">Archiviert</span>
              </label>
              ${field("Bemerkungen",
                `<textarea class="pf-inp" name="bemerkungen" rows="3"
                  placeholder="Interne Notizen, Vereinbarungen…"
                  style="resize:vertical;min-height:70px;line-height:1.5">${h.esc(cv("bemerkungen"))}</textarea>`)}
            `)}
          </div>

          <!-- RECHTE SPALTE -->
          <div style="display:flex;flex-direction:column;gap:20px">

            ${sec(`Ansätze CHF <span style="font-size:10px;background:#e8f5ee;color:#085041;padding:1px 6px;border-radius:4px;margin-left:6px;font-weight:600;text-transform:none;letter-spacing:0">leer = nicht verfügbar</span>`, `
              <table style="width:100%;border-collapse:collapse">
                <thead><tr>
                  <th style="font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8896a5;text-align:left;padding:0 8px 6px 0;border-bottom:1px solid #f0f4f8"></th>
                  <th style="font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8896a5;text-align:left;padding:0 8px 6px;border-bottom:1px solid #f0f4f8">Lead</th>
                  <th style="font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8896a5;text-align:left;padding:0 0 6px 8px;border-bottom:1px solid #f0f4f8">Co</th>
                </tr></thead>
                <tbody>
                  ${[["Einsatz (Tag)","ansatzEinsatz","ansatzCoEinsatz"],["Einsatz (Halbtag)","ansatzHalbtag","ansatzCoHalbtag"]].map(([lbl,mk,ck]) => `
                  <tr>
                    <td style="font-size:12px;color:#4a5568;padding:7px 8px 7px 0;border-bottom:1px solid #f4f7fb;white-space:nowrap">${lbl}</td>
                    <td style="padding:4px 8px;border-bottom:1px solid #f4f7fb">${numInp(mk)}</td>
                    <td style="padding:4px 0 4px 8px;border-bottom:1px solid #f4f7fb">${numInp(ck)}</td>
                  </tr>`).join("")}
                </tbody>
              </table>
              <div class="pf-g3">
                ${[["Stunde","CHF/h"],["Stück","CHF/Stk."],["Pauschale","CHF fix"],
                   ["Konzeption/Tag","CHF/Tag"],["Admin/Tag","CHF/Tag"],["Km-Spesen","CHF/km"]
                  ].map(([lbl,hint],i) => {
                    const keys = ["ansatzStunde","ansatzStueck","ansatzPauschale","ansatzKonzeption","ansatzAdmin","ansatzKmSpesen"];
                    return field(lbl, numInp(keys[i]), hint);
                  }).join("")}
                ${field("Spesen Kto-Nr.",
                  `<input class="pf-inp" type="text" name="spesenKontoNr" value="${h.esc(cv("spesenKontoNr"))}" placeholder="z.B. 6500">`)}
              </div>
            `)}

            ${sec("Konzeptionsrahmen", `
              ${field("Vereinbarte Tage",
                `<div style="display:flex;align-items:center;gap:10px">
                  <input class="pf-inp" type="number" name="konzeptionsrahmenTage" value="${cn("konzeptionsrahmenTage")}"
                    placeholder="z.B. 10" min="0" step="0.5" style="max-width:120px"
                    oninput="document.getElementById('kh').textContent=(parseFloat(this.value)||0)*8">
                  <span style="font-size:12px;color:#8896a5;white-space:nowrap">
                    = <span id="kh" style="font-weight:700;color:#004078;font-size:14px">${(cv("konzeptionsrahmenTage",0)||0)*8}</span> h
                  </span>
                </div>`,
                "× 8 = Stunden-Budget")}
            `)}

          </div><!-- /rechte Spalte -->

        </form>

        <div class="pf-ft">
          <div style="flex:1">
            ${p ? `<button type="button" class="pf-btn-del" data-action="delete-projekt" data-id="${p.id}">🗑 Löschen</button>` : ""}
          </div>
          <button type="button" class="pf-btn-c" onclick="${closeAction}">Abbrechen</button>
          <button type="button" class="pf-btn-s" onclick="document.getElementById('projekt-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))">
            ${p ? "Änderungen speichern" : "Projekt erstellen"}
          </button>
        </div>
      </div>`);
    },


    // Co-Lead gewählt → Co-Betrag anzeigen
    updateCoBetrag() {
      const coVal = document.getElementById("coperson-val")?.value ||
                    document.querySelector('.tm-typeahead[data-name="coPersonLookupId_ta"] .tm-ta-val')?.value || "";
      const hasCoLead = !!coVal;
      const kat = document.getElementById("kat-hid")?.value || "";
      const isTagKat = ["Einsatz (Tag)","Einsatz (Halbtag)"].includes(kat);
      const show = isTagKat && hasCoLead;
      const coRow = document.getElementById("ef-betrag-co-row");
      if (coRow) coRow.style.display = show ? "" : "none";
      // Lead-Label nur anzeigen wenn Co-Lead aktiv
      const leadLbl = document.getElementById("ef-betrag-lead-lbl");
      if (leadLbl) leadLbl.style.display = show ? "" : "none";
      if (show) {
        const projId = Number(document.querySelector("[name='projektLookupId']")?.value) || null;
        const proj   = projId ? state.enriched.projekte.find(p => p.id === projId) : null;
        const tageInp = document.getElementById("ef-tage-inp");
        const tageVal = tageInp ? (h.num(tageInp.value) || 1) : 1;
        const coBetrag = proj ? h.berechneCoBetrag(proj, kat, tageVal) : null;
        const bvc = document.getElementById("ef-bval-co");
        if (bvc) {
          if (coBetrag === null) { bvc.textContent = "Nicht konfiguriert"; bvc.className = "ef-betrag-val warn"; }
          else                   { bvc.textContent = "CHF " + h.chf(coBetrag); bvc.className = "ef-betrag-val"; }
        }
      }
    },

    // Ansprechpartner gewählt → Firma automatisch befüllen
    onApSelected(contactId) {
      const cId = Number(contactId) || null;
      const contact = cId ? state.data.contacts.find(c => c.id === cId) : null;
      const firmaId = contact?.firmaLookupId || null;
      const firmaName = firmaId ? h.firmName(firmaId) : "—";
      const disp = document.getElementById("firma-display");
      const hidden = document.getElementById("firma-hidden");
      if (disp) disp.textContent = firmaName;
      if (hidden) hidden.value = firmaId || "";
    },

    async saveProjekt(fd) {
      ui.setMsg("Wird gespeichert…", "info");
      try {
        const mode   = fd.get("mode");
        const itemId = fd.get("itemId");
        const title  = (fd.get("title") || "").trim();
        const apId    = Number(fd.get("ansprechpartnerLookupId")) || null;
        // Firma automatisch aus Ansprechpartner ableiten
        const contact = apId ? state.data.contacts.find(c => c.id === apId) : null;
        const firmaId = Number(fd.get("firmaLookupId")) || contact?.firmaLookupId || null;

        debug.log("saveProjekt:formData", { title, firmaId, apId, mode, itemId });

        if (!title) throw new Error("Projektname ist Pflichtfeld.");
        if (!apId)  throw new Error("Bitte Ansprechpartner wählen.");

        const n = k => { const v = h.num(fd.get(k)); return v !== null ? v : undefined; };
        const s = k => fd.get(k) || undefined;

        // Lookup-Felder via SP REST API (Graph API ignoriert diese)
        const lookupFields = {};
        if (firmaId) lookupFields[F.firma_w] = firmaId;
        if (apId)    lookupFields[F.ansprechpartner_w] = apId;

        // Normale Felder via Graph API
        const fields = {
          Status:    fd.get("status") || "aktiv",
          Archiviert: fd.get("archiviert") === "on"
        };
        if (s("projektNr"))              fields.ProjektNr = s("projektNr");
        if (s("kontoNr"))                fields.KontoNr   = s("kontoNr");
        if (n("kmZumKunden") != null)    fields.KmZumKunden = n("kmZumKunden");
        if (n("ansatzEinsatz") != null)  fields.AnsatzEinsatz = n("ansatzEinsatz");
        if (n("ansatzHalbtag") != null)  fields.AnsatzHalbtag = n("ansatzHalbtag");
        if (n("ansatzCoEinsatz") != null) fields.AnsatzCoEinsatz = n("ansatzCoEinsatz");
        if (n("ansatzCoHalbtag") != null) fields.AnsatzCoHalbtag = n("ansatzCoHalbtag");
        if (n("ansatzStunde") != null)   fields.AnsatzStunde = n("ansatzStunde");
        if (n("ansatzStueck") != null)   fields.AnsatzStueck = n("ansatzStueck");
        if (n("ansatzPauschale") != null) fields.AnsatzPauschale = n("ansatzPauschale");
        if (n("ansatzKonzeption") != null) fields.AnsatzKonzeption = n("ansatzKonzeption");
        if (n("ansatzAdmin") != null)    fields.AnsatzAdmin = n("ansatzAdmin");
        if (n("ansatzKmSpesen") != null) fields.AnsatzKmSpesen = n("ansatzKmSpesen");
        if (s("spesenKontoNr"))          fields.SpesenKontoNr = s("spesenKontoNr");
        if (n("konzeptionsrahmenTage") != null) fields.KonzeptionsrahmenTage = n("konzeptionsrahmenTage");
        const bem = (fd.get("bemerkungen") || "").trim();
        fields.Bemerkungen = bem || null;

        if (mode === "edit" && itemId) {
          const eid = Number(itemId);
          fields.Title = title;
          await api.patch(CONFIG.lists.projekte, eid, fields);
          await api.patchLookups(CONFIG.lists.projekte, eid, lookupFields);
        } else {
          const cr  = await api.post(CONFIG.lists.projekte, title);
          const nid = Number(cr?.id || cr?.fields?.id);
          if (!nid) throw new Error("Neue ID fehlt im POST-Response.");
          fields.Title = title;
          await api.patch(CONFIG.lists.projekte, nid, fields);
          await api.patchLookups(CONFIG.lists.projekte, nid, lookupFields);
        }

        const savedId = (mode === "edit" && itemId) ? Number(itemId) : null;
        state.form = null;
        ui.closeModal();
        ui.setMsg("Projekt gespeichert.", "success");
        await api.loadAll();
        // Bei Bearbeitung → zurück zum Projekt-Detail; bei Neuanlage → Projektliste
        if (savedId) { ctrl.openProjekt(savedId); } else { ctrl.navigate("projekte"); }
      } catch (e) {
        debug.err("saveProjekt", e);
        ui.setMsg(e.message || "Fehler beim Speichern.", "error");
      }
    },

    // ── Einsatz-Formular (v2) ─────────────────────────────────────────────
    // Bereinigungen:
    // - Abrechnung raus aus Modal (read-only Badge im Footer)
    // - Status (Abgesagt/Abgesagt CHF) eigene Sektion, klar getrennt
    // - Spesen: 1 Toggle, 1 Km-Feld, keine Sub-Toggles
    // - SpesenZusatz + SpesenFinal entfernt
    // - Beschreibung zwischen Projekt und Kategorie
    // - Desktop: 2-spaltig, kein Scroll
    openEinsatzForm(id, projektId = null, preselectKat = null, copyOpts = null) {
      const e          = id ? state.enriched.einsaetze.find(e => e.id === id) : null;
      const prefProjId = projektId || (e?.projektLookupId || null);
      const selProjekt = prefProjId ? state.enriched.projekte.find(p => p.id === prefProjId) : null;
      const kats       = h.kategorien(selProjekt);
      const selKat     = e?.kategorie || (preselectKat && kats.includes(preselectKat) ? preselectKat : "");
      const defPerson  = h.defaultPerson();
      // copyOpts: beim Duplizieren Felder vorbelegen
      const selPerson   = e ? e.personLookupId   : (copyOpts?.personId   || defPerson?.id || null);
      const selCoPerson = e ? e.coPersonLookupId  : (copyOpts?.coPersonId || null);
      const selTitel    = e ? e.title             : (copyOpts?.titel      || "");
      const selOrt      = e ? e.ort               : (copyOpts?.ort        || "");
      const selBem      = e ? e.bemerkungen       : (copyOpts?.bemerkungen|| "");
      const selDauerTage   = e ? (e.dauerTage    || 1)    : (copyOpts?.dauerTage    || 1);
      const selDauerStunden = e ? (e.dauerStunden || null) : (copyOpts?.dauerStunden || null);
      const selAnzahlStueck = e ? (e.anzahlStueck || null) : (copyOpts?.anzahlStueck || null);
      const selBetragFinal   = e ? (e.betragFinal  || null) : (copyOpts?.betragFinal  || null);
      const selCoBetragFinal = e ? (e.coBetragFinal|| null) : (copyOpts?.coBetragFinal|| null);
      const isTagKat   = ["Einsatz (Tag)","Einsatz (Halbtag)"].includes(selKat);

      const betragBer   = selProjekt && selKat ? h.berechneBetrag(selProjekt, selKat, selDauerTage, e?.dauerStunden, e?.anzahlStueck) : null;
      const coBetragBer = selProjekt && selKat ? h.berechneCoBetrag(selProjekt, selKat, selDauerTage) : null;
      const personName   = selPerson ? h.contactName(selPerson) : null;
      const coPersonName = selCoPerson ? h.contactName(selCoPerson) : null;
      const initials = n => n ? n.split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase() : "?";

      const projektOpts = state.enriched.projekte
        .filter(p => !p.archiviert)
        .map(p => `<option value="${p.id}" ${prefProjId === p.id ? "selected" : ""}>${h.esc(p.title)}${p.projektNr ? ` (#${p.projektNr})` : ""}</option>`)
        .join("");

      const katBtnHtml = kats.map(k => `<button type="button" class="ef-kat-btn${selKat===k?" active":""}"
        onclick="document.querySelectorAll('.ef-kat-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');document.getElementById('kat-hid').value='${h.esc(k)}';ctrl.onKatChange('${h.esc(k)}')">${h.esc(k)}</button>`).join("");

      // Betrag-Info für Lead/Co — kompakte Read-only-Zeile
      const leadBetragInfo = () => {
        if (!selKat) return { val: "Kategorie wählen", sub: "", warn: true };
        if (betragBer === null) return { val: "Nicht konfiguriert", sub: "", warn: true };
        return { val: "CHF " + h.chf(betragBer), sub: "aus Projekt", warn: false };
      };
      const coBetragInfo = () => {
        if (coBetragBer === null) return { val: "Nicht konfiguriert", sub: "", warn: true };
        return { val: "CHF " + h.chf(coBetragBer), sub: "aus Projekt", warn: false };
      };
      const lbi = leadBetragInfo();
      const cbi = coBetragInfo();

      // Spesen: aus Einsatz (edit) oder copyOpts (duplizieren) oder Projekt-Default (neu)
      const kmVorbelegt  = selProjekt?.kmZumKunden || "";
      const ansatzKm     = selProjekt?.ansatzKmSpesen || null;
      const selSpBer     = e ? (e.spesenBerechnet || null) : (copyOpts?.spesenBerechnet || null);
      const hasSp        = !!(e ? e.spesenBerechnet : copyOpts?.spesenAktiv);
      // km rückrechnen: gespeicherter Wert / Ansatz; Fallback: Projekt-Km
      const kmGespeichert = (hasSp && ansatzKm && selSpBer)
        ? Math.round(selSpBer / ansatzKm)
        : (hasSp ? (kmVorbelegt || "") : (kmVorbelegt || ""));
      const spesenTotal  = hasSp && selSpBer ? selSpBer
        : (kmVorbelegt && ansatzKm ? kmVorbelegt * ansatzKm : 0);

      // Einsatz-Status berechnet (Geplant/Durchgeführt)
      const statusAnzeige = (() => {
        if (!e) return { label: "Geplant", cls: "ef-st-info-dot blue" };
        const s = h.einsatzStatus(e);
        if (s === "durchgefuehrt") return { label: "Durchgeführt", cls: "ef-st-info-dot green" };
        return { label: "Geplant", cls: "ef-st-info-dot blue" };
      })();

      ui.renderModal(`<style>
        .ef-m{background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(0,64,120,.18),0 0 0 1px rgba(0,64,120,.06);width:100%;max-width:560px;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;animation:efUp .25s cubic-bezier(.16,1,.3,1)}
        @media(min-width:700px){.ef-m{max-width:820px}}
        @keyframes efUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
        .ef-hd{background:#004078;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
        .ef-hd-l{display:flex;align-items:center;gap:10px}
        .ef-hd-ic{width:32px;height:32px;background:rgba(255,255,255,.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px}
        .ef-hd-t{color:#fff;font-size:14px;font-weight:700}
        .ef-hd-s{color:rgba(255,255,255,.55);font-size:12px;margin-top:1px}
        .ef-hd-abr{font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.2);margin-left:8px;vertical-align:middle}
        .ef-cl{width:28px;height:28px;background:rgba(255,255,255,.1);border:none;border-radius:7px;color:rgba(255,255,255,.8);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
        .ef-cl:hover{background:rgba(255,255,255,.2)}
        /* Body: single-col mobile, 2-col desktop */
        .ef-bd{overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px}
        @media(min-width:700px){
          .ef-bd{display:grid;grid-template-columns:1fr 1fr;column-gap:22px;overflow:visible;align-items:start}
          .ef-col-l{display:flex;flex-direction:column;gap:14px}
          .ef-col-r{display:flex;flex-direction:column;gap:14px}
        }
        .ef-s{display:flex;flex-direction:column;gap:6px}
        .ef-l{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#8896a5}
        .ef-r2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .ef-iw input,.ef-iw select,.ef-iw textarea{width:100%;font-family:inherit;font-size:13px;font-weight:500;color:#1a2332;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;padding:8px 10px;outline:none;transition:border-color .15s,background .15s;-webkit-appearance:none}
        .ef-iw input:focus,.ef-iw select:focus,.ef-iw textarea:focus{border-color:#0a5a9e;background:#fff;box-shadow:0 0 0 3px rgba(10,90,158,.1)}
        .ef-iw input::placeholder,.ef-iw textarea::placeholder{color:#8896a5;font-weight:400}
        .ef-iw textarea{resize:none;height:60px;line-height:1.5}
        /* Projekt-Card */
        .ef-proj-card{background:#e8f1f9;border:1.5px solid rgba(0,64,120,.15);border-radius:8px;padding:9px 12px;display:flex;align-items:center;justify-content:space-between}
        /* Kategorie */
        .ef-kg{display:flex;flex-wrap:wrap;gap:6px}
        .ef-kat-btn{flex:0 0 auto;padding:7px 13px;font-family:inherit;font-size:12px;font-weight:600;color:#4a5568;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:100px;cursor:pointer;transition:all .15s;white-space:nowrap}
        .ef-kat-btn:hover{border-color:#0a5a9e;color:#0a5a9e}
        .ef-kat-btn.active{background:#004078;border-color:#004078;color:#fff}
        .ef-sub-inp{display:none;margin-top:6px}
        .ef-sub-inp.show{display:block}
        /* Personen */
        .ef-pr{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
        .ef-pp{display:inline-flex;align-items:center;gap:7px;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:100px;padding:5px 10px 5px 6px;cursor:pointer;transition:all .15s}
        .ef-pp:hover{border-color:#0a5a9e}
        .ef-av{width:24px;height:24px;background:#004078;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0}
        .ef-av.co{background:#6b7280}
        .ef-pn{font-size:12px;font-weight:600;color:#1a2332}
        .ef-pr-role{font-size:10px;color:#8896a5}
        .ef-pe{font-size:11px;color:#8896a5;margin-left:2px}
        .ef-addco{display:inline-flex;align-items:center;gap:5px;background:none;border:1.5px dashed #dde4ec;border-radius:100px;padding:5px 12px;font-family:inherit;font-size:12px;font-weight:600;color:#8896a5;cursor:pointer;transition:all .15s}
        .ef-addco:hover{border-color:#0a5a9e;color:#0a5a9e}
        .ef-ta-wrap{display:none}
        /* Betrag */
        .ef-betrag-box{background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;overflow:hidden}
        .ef-betrag-row{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;gap:8px}
        .ef-betrag-row+.ef-betrag-row{border-top:1px solid #dde4ec}
        .ef-betrag-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#8896a5;margin-bottom:2px}
        .ef-betrag-val{font-size:15px;font-weight:700;color:#1a2332}
        .ef-betrag-val.warn{font-size:12px;font-weight:500;color:#b45309}
        .ef-betrag-src{font-size:10px;color:#8896a5}
        .ef-betrag-edit{font-size:11px;color:#0a5a9e;border:1px solid #dde4ec;border-radius:6px;padding:3px 8px;background:#fff;cursor:pointer;font-family:inherit;flex-shrink:0}
        .ef-betrag-override{padding:0 12px 9px;display:none}
        .ef-betrag-override.show{display:flex;align-items:center;gap:6px}
        .ef-betrag-override input{width:110px;padding:5px 8px;font-size:12px;background:#fff;border:1.5px solid #dde4ec;border-radius:6px;color:#1a2332;font-family:inherit;outline:none}
        .ef-betrag-override input:focus{border-color:#0a5a9e}
        .ef-betrag-override .muted{font-size:11px;color:#8896a5}
        /* Wegspesen */
        .ef-weg-toggle{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border-radius:100px;border:1.5px solid #dde4ec;background:#f4f7fb;color:#4a5568;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;font-family:inherit}
        .ef-weg-toggle:hover{border-color:#0a5a9e}
        .ef-weg-toggle.on{background:#004078;border-color:#004078;color:#fff}
        .ef-weg-detail{margin-top:8px;display:none;flex-direction:column;gap:7px;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;padding:10px 12px}
        .ef-weg-detail.show{display:flex}
        .ef-weg-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .ef-weg-inp{width:90px;padding:6px 8px;font-size:12px;background:#fff;border:1.5px solid #dde4ec;border-radius:6px;color:#1a2332;font-family:inherit;outline:none}
        .ef-weg-inp:focus{border-color:#0a5a9e}
        .ef-weg-hint{font-size:11px;color:#8896a5}
        .ef-weg-calc{font-size:12px;font-weight:700;color:#1a8a5e}
        .ef-weg-noansatz{font-size:11px;color:#950e13}
        /* Divider */
        .ef-dv{height:1px;background:#dde4ec}
        /* Status */
        .ef-st-info{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:7px;background:#f4f7fb;border:1.5px solid #dde4ec;font-size:12px;color:#4a5568}
        .ef-st-info-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
        .ef-st-info-dot.blue{background:#378ADD}
        .ef-st-info-dot.green{background:#1D9E75}
        .ef-st-info-dot.red{background:#950e13}
        .ef-st-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
        .ef-st-btn{padding:6px 13px;border-radius:100px;font-size:12px;font-weight:600;border:1.5px solid rgba(149,14,19,.3);color:#950e13;background:#f4f7fb;cursor:pointer;font-family:inherit;transition:all .15s}
        .ef-st-btn:hover{background:#fef2f2}
        .ef-st-btn.on{background:#950e13;border-color:#950e13;color:#fff}
        /* Footer */
        .ef-ft{padding:11px 20px 14px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #dde4ec;flex-shrink:0;gap:10px}
        .ef-abr-info{font-size:11px;color:#8896a5;display:flex;align-items:center;gap:5px}
        .ef-btn-c{padding:8px 18px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;background:none;border:1.5px solid #dde4ec;color:#4a5568;cursor:pointer}
        .ef-btn-c:hover{border-color:#4a5568}
        .ef-btn-s{padding:8px 22px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:700;background:#004078;border:none;color:#fff;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 2px 10px rgba(0,64,120,.25)}
        .ef-btn-s:hover{background:#0a5a9e}
      </style>
      <div class="ef-m">
        <div class="ef-hd">
          <div class="ef-hd-l">
            <div class="ef-hd-ic">📋</div>
            <div>
              <div class="ef-hd-t">
                ${id ? "Einsatz bearbeiten" : "Einsatz erfassen"}
                ${id && e?.abrechnung ? `<span class="ef-hd-abr">${h.esc(e.abrechnung)}</span>` : ""}
              </div>
              <div class="ef-hd-s" id="ef-hd-sub">${selProjekt ? h.esc(selProjekt.title) + (selProjekt.firmaName ? " · " + h.esc(selProjekt.firmaName) : "") : "Projekt wählen"}</div>
            </div>
          </div>
          <button type="button" class="ef-cl" data-close-modal>✕</button>
        </div>

        <form id="einsatz-form" autocomplete="off" class="ef-bd">
            <input type="hidden" name="itemId" value="${id || ""}">
            <input type="hidden" name="mode" value="${id ? "edit" : "create"}">
            <input type="hidden" id="kat-hid" name="kategorie" value="${h.esc(selKat)}">
            <input type="hidden" id="coperson-val" name="coPersonLookupId" value="${selCoPerson || ""}">
            <input type="hidden" id="abr-hid" name="abrechnung" value="${e?.abrechnung || "offen"}">
            <input type="hidden" id="status-hid" name="status" value="${e?.status || ""}">

            <!-- LINKE SPALTE (mobile: normal flow) -->
            <div class="ef-col-l">

              <!-- Datum & Ort -->
              <div class="ef-s">
                <div class="ef-l">Datum & Ort</div>
                <div class="ef-r2">
                  <div class="ef-iw"><input type="date" name="datum" value="${h.esc(e ? h.toDateInput(e.datum) : "")}" required></div>
                  <div class="ef-iw"><input type="text" name="ort" value="${h.esc(selOrt)}" placeholder="Ort, Virtuell…"></div>
                </div>
              </div>

              <!-- Projekt -->
              <div class="ef-s">
                <div class="ef-l">Projekt</div>
                ${selProjekt ? `
                <div class="ef-proj-card">
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:7px;height:7px;background:#004078;border-radius:50%;flex-shrink:0"></div>
                    <div>
                      <div style="font-size:13px;font-weight:600;color:#004078">${h.esc(selProjekt.title)}</div>
                      <div style="font-size:11px;color:#8896a5">${selProjekt.projektNr ? "#" + h.esc(selProjekt.projektNr) + " · " : ""}${h.esc(selProjekt.firmaName)}</div>
                    </div>
                  </div>
                  <span style="font-size:11px;color:#0a5a9e;font-weight:600;text-decoration:underline;cursor:pointer"
                    onclick="this.closest('.ef-proj-card').style.display='none';document.getElementById('ef-proj-sel').style.display='block'">ändern</span>
                </div>
                <div class="ef-iw" id="ef-proj-sel" style="display:none">
                  <select name="projektLookupId" onchange="ctrl.onProjChange(this);ctrl.efUpdateHeader(this)">
                    ${projektOpts}
                  </select>
                </div>` : `
                <div class="ef-iw">
                  <select name="projektLookupId" required onchange="ctrl.onProjChange(this);ctrl.efUpdateHeader(this)">
                    <option value="">— Projekt wählen —</option>
                    ${projektOpts}
                  </select>
                </div>`}
              </div>

              <!-- Beschreibung -->
              <div class="ef-s">
                <div class="ef-l">Beschreibung</div>
                <div class="ef-iw"><input type="text" name="titel" value="${h.esc(selTitel)}" placeholder="z.B. Kick-off Workshop, Modul 3…"></div>
              </div>

              <!-- Kategorie -->
              <div class="ef-s">
                <div class="ef-l">Kategorie</div>
                <div class="ef-kg" id="kat-grp">
                  ${kats.length ? katBtnHtml : `<span style="font-size:12px;color:#8896a5">Zuerst Projekt wählen</span>`}
                </div>
                <input type="hidden" name="dauerTage" id="ef-tage-inp" value="1">
                <div id="fd-std" class="ef-sub-inp${selKat === "Stunde" ? " show" : ""}">
                  <div class="ef-iw" style="max-width:180px">
                    <input type="number" name="dauerStunden" min="0.5" step="0.5" value="${selDauerStunden ?? ""}" placeholder="Anzahl Stunden" oninput="ctrl.onKatChange(document.getElementById('kat-hid').value)">
                  </div>
                </div>
                <div id="fd-stk" class="ef-sub-inp${selKat === "Stück" ? " show" : ""}">
                  <div class="ef-iw" style="max-width:180px">
                    <input type="number" name="anzahlStueck" min="1" step="1" value="${selAnzahlStueck ?? ""}" placeholder="Anzahl Stück" oninput="ctrl.onKatChange(document.getElementById('kat-hid').value)">
                  </div>
                </div>
              </div>

              <!-- Personen -->
              <div class="ef-s">
                <div class="ef-l">Personen</div>
                <div class="ef-pr" id="ef-pr">
                  <div class="ef-pp" onclick="ctrl.efOpenPicker('lead')" id="ef-lead-pill">
                    <div class="ef-av" id="ef-lead-av">${personName ? h.esc(initials(personName)) : "?"}</div>
                    <div>
                      <div class="ef-pn" id="ef-lead-name">${personName ? h.esc(personName) : "Person wählen"}</div>
                      <div class="ef-pr-role">Lead</div>
                    </div>
                    <span class="ef-pe">✎</span>
                  </div>
                  <div class="ef-ta-wrap" id="ef-lead-ta">
                    ${ui.personTypeahead("personLookupId", selPerson ? String(selPerson) : "")}
                  </div>
                  <button type="button" class="ef-addco" id="ef-addco-btn"
                    style="${isTagKat ? "" : "display:none"}"
                    onclick="ctrl.efToggleCo(true)">＋ Co-Lead</button>
                  <div class="ef-pp" id="ef-co-pill" style="${selCoPerson ? "" : "display:none"}" onclick="ctrl.efOpenPicker('co')">
                    <div class="ef-av co" id="ef-co-av">${coPersonName ? h.esc(initials(coPersonName)) : "?"}</div>
                    <div>
                      <div class="ef-pn" id="ef-co-name">${coPersonName ? h.esc(coPersonName) : "—"}</div>
                      <div class="ef-pr-role">Co-Lead</div>
                    </div>
                    <span class="ef-pe" onclick="event.stopPropagation();ctrl.efToggleCo(false)">✕</span>
                  </div>
                  <div class="ef-ta-wrap" id="ef-co-ta">
                    ${ui.personTypeahead("coPersonLookupId_ta", selCoPerson ? String(selCoPerson) : "")}
                  </div>
                </div>
              </div>

            </div><!-- /ef-col-l -->

            <!-- RECHTE SPALTE (mobile: normal flow, nach linker) -->
            <div class="ef-col-r">

              <!-- Betrag -->
              <div class="ef-s">
                <div class="ef-l">Betrag</div>
                <div class="ef-betrag-box" id="ef-betrag-box">
                  <!-- Lead: Label nur wenn Co-Lead gesetzt; Anpassen nur wenn Kategorie gewählt -->
                  <div class="ef-betrag-row">
                    <div>
                      <div class="ef-betrag-lbl" id="ef-betrag-lead-lbl" style="${selCoPerson && isTagKat ? "" : "display:none"}">Lead</div>
                      <div class="ef-betrag-val${lbi.warn ? " warn" : ""}" id="ef-bval-lead">${h.esc(lbi.val)}</div>
                      ${lbi.sub ? `<div class="ef-betrag-src">${h.esc(lbi.sub)}</div>` : ""}
                    </div>
                    <button type="button" class="ef-betrag-edit" id="ef-betrag-anpassen"
                      style="${selKat && !lbi.warn ? "" : "display:none"}"
                      onclick="ctrl.efToggleOverride('ef-ov-lead')">Anpassen</button>
                  </div>
                  <div class="ef-betrag-override${selBetragFinal ? " show" : ""}" id="ef-ov-lead">
                    <span style="font-size:11px;color:#8896a5">CHF</span>
                    <input type="number" name="betragFinal" step="0.01" value="${selBetragFinal ?? ""}" placeholder="Betrag">
                    <span class="muted">leer = aus Projekt</span>
                  </div>
                  <!-- Co-Lead (nur wenn Tag-Kat + Co gesetzt) -->
                  <div id="ef-betrag-co-row" style="${selCoPerson && isTagKat ? "" : "display:none"}">
                    <div class="ef-betrag-row">
                      <div>
                        <div class="ef-betrag-lbl">Co-Lead</div>
                        <div class="ef-betrag-val${cbi.warn ? " warn" : ""}" id="ef-bval-co">${h.esc(cbi.val)}</div>
                        ${cbi.sub ? `<div class="ef-betrag-src">${h.esc(cbi.sub)}</div>` : ""}
                      </div>
                      <button type="button" class="ef-betrag-edit" onclick="ctrl.efToggleOverride('ef-ov-co')">Anpassen</button>
                    </div>
                    <div class="ef-betrag-override${selCoBetragFinal ? " show" : ""}" id="ef-ov-co">
                      <span style="font-size:11px;color:#8896a5">CHF</span>
                      <input type="number" name="coBetragFinal" step="0.01" value="${selCoBetragFinal ?? ""}" placeholder="Betrag">
                      <span class="muted">leer = aus Projekt</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Wegspesen -->
              <div class="ef-s">
                <div class="ef-l">Wegspesen</div>
                <button type="button" id="ef-weg-btn" class="ef-weg-toggle${hasSp ? " on" : ""}" onclick="ctrl.efToggleWeg()">
                  ${hasSp ? "Wegspesen verrechnen ✓" : "Wegspesen verrechnen"}
                </button>
                <div class="ef-weg-detail${hasSp ? " show" : ""}" id="ef-weg-detail">
                  ${ansatzKm ? `
                  <div class="ef-weg-row">
                    <input type="number" class="ef-weg-inp" id="ef-km-inp" name="kmAnzahl" min="0" step="1"
                      value="${kmGespeichert}" placeholder="km" oninput="ctrl.efCalcKm(this.value)">
                    <span class="ef-weg-hint">km (Hin &amp; Zurück)</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span class="ef-weg-hint">CHF ${h.chf(ansatzKm)}/km</span>
                    <span class="ef-weg-calc" id="ef-km-calc">${spesenTotal > 0 ? "= CHF " + h.chf(spesenTotal) : ""}</span>
                  </div>
                  <input type="hidden" name="spesenBerechnet" id="ef-sp-ber" value="${hasSp ? (selSpBer ?? "") : (kmVorbelegt && ansatzKm ? kmVorbelegt * ansatzKm : "")}">
                  ` : `<span class="ef-weg-noansatz">⚠ Kein Km-Ansatz im Projekt hinterlegt</span>`}
                </div>
              </div>

              <div class="ef-dv"></div>

              <!-- Status / Abgesagt -->
              <div class="ef-s">
                <div class="ef-l">Status</div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <div class="ef-st-info" id="ef-st-info">
                    <div class="${statusAnzeige.cls}" id="ef-st-dot"></div>
                    <span id="ef-st-label">${h.esc(statusAnzeige.label)}</span>
                  </div>
                </div>
                <div class="ef-st-btns">
                  ${state.choices.einsatzStatus.length
                    ? state.choices.einsatzStatus
                        .filter(s => {
                          // Bei Neuerfassung: abgesagt-Stati nicht anzeigen
                          // Bei Bearbeitung: alle anzeigen (inkl. Zurücksetzen von abgesagt)
                          if (!id) return !s.toLowerCase().includes("abgesagt");
                          return true;
                        })
                        .map(s => `<button type="button"
                          class="ef-st-btn${e?.status === s ? " on" : ""}"
                          onclick="ctrl.efToggleStatus(this, '${h.esc(s)}')">${h.esc(s)}</button>`).join("")
                    : `<span style="font-size:12px;color:#950e13">⚠ Choices werden geladen…</span>`}
                </div>
              </div>

              <div class="ef-dv"></div>

              <!-- Bemerkungen -->
              <div class="ef-s">
                <div class="ef-l">Bemerkungen</div>
                <div class="ef-iw"><textarea name="bemerkungen" placeholder="Interne Notizen…">${h.esc(selBem)}</textarea></div>
              </div>

            </div><!-- /ef-col-r -->

          </form><!-- /ef-bd -->

        <div class="ef-ft">
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
            ${id && e?.abrechnung ? `<div class="ef-abr-info"><span style="width:6px;height:6px;border-radius:50%;background:#8896a5;display:inline-block"></span>Abrechnung: ${h.esc(e.abrechnung)}</div>` : ""}
            ${id && e?.abrechnung === "abgerechnet" && !e?.abrechnungLookupId ? `
              <button type="button" style="
                font-family:inherit;font-size:11px;font-weight:600;
                padding:4px 10px;border-radius:6px;cursor:pointer;
                background:#fff3cd;border:1.5px solid #e59c2e;color:#7a5000;
                display:flex;align-items:center;gap:5px;
              " onclick="ctrl.resetEinsatzAbrechnung(${id})" title="Nur verwenden wenn die verknüpfte Abrechnung direkt in SharePoint gelöscht wurde — nicht über die App.">
                ⚠ Abrechnung zurücksetzen
              </button>` : ""}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${id ? `
              <button type="button" class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${id}" title="Duplizieren" style="margin-right:4px">⧉ Duplizieren</button>
              <button type="button" class="tm-btn tm-btn-sm" data-action="delete-einsatz" data-id="${id}" title="Löschen" style="color:var(--tm-red)">🗑 Löschen</button>
            ` : ""}
            <span style="flex:1"></span>
            <button type="button" class="ef-btn-c" data-close-modal>Abbrechen</button>
            <button type="button" class="ef-btn-s" onclick="document.getElementById('einsatz-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))">
              <span>✓</span> Speichern
            </button>
          </div>
        </div>
      </div>`);
    },
    // ── Einsatz-Formular Helfer ──────────────────────────────────────────
    efUpdateHeader(sel) {
      const p = state.enriched.projekte.find(p => p.id === Number(sel.value));
      const sub = document.getElementById("ef-hd-sub");
      if (sub && p) sub.textContent = p.title + (p.firmaName ? " · " + p.firmaName : "");
    },

    efOpenPicker(type) {
      const taId   = type === "lead" ? "ef-lead-ta" : "ef-co-ta";
      const pillId = type === "lead" ? "ef-lead-pill" : "ef-co-pill";
      const ta   = document.getElementById(taId);
      const pill = document.getElementById(pillId);
      if (!ta || !pill) return;
      pill.style.display = "none";
      ta.style.display = "block";
      ta.querySelector(".tm-typeahead-input")?.focus();
    },

    efToggleCo(show) {
      const addBtn = document.getElementById("ef-addco-btn");
      const coPill = document.getElementById("ef-co-pill");
      const coRow  = document.getElementById("ef-betrag-co-row");
      const coVal  = document.getElementById("coperson-val");
      if (show) {
        if (addBtn) addBtn.style.display = "none";
        if (coPill) coPill.style.display = "inline-flex";
        ctrl.efOpenPicker("co");
      } else {
        if (addBtn) addBtn.style.display = "inline-flex";
        if (coPill) coPill.style.display = "none";
        if (coRow)  coRow.style.display = "none";
        if (coVal)  coVal.value = "";
        const coTa = document.getElementById("ef-co-ta");
        if (coTa) {
          coTa.style.display = "none";
          const inp = coTa.querySelector(".tm-ta-input");
          const val = coTa.querySelector(".tm-ta-val");
          if (inp) inp.value = "";
          if (val) val.value = "";
        }
        ctrl.updateCoBetrag();
      }
    },

    // Betrag-Override-Panel ein-/ausklappen
    efToggleOverride(id) {
      const el = document.getElementById(id);
      if (!el) return;
      const vis = el.classList.toggle("show");
      if (vis) el.querySelector("input")?.focus();
    },

    // Wegspesen-Toggle (einfacher 1-Stufen-Toggle)
    efToggleWeg() {
      const btn    = document.getElementById("ef-weg-btn");
      const detail = document.getElementById("ef-weg-detail");
      if (!btn || !detail) return;
      const on = btn.classList.toggle("on");
      detail.classList.toggle("show", on);
      btn.textContent = on ? "Wegspesen verrechnen \u2713" : "Wegspesen verrechnen";
      if (!on) {
        // Felder zurücksetzen
        const km  = document.getElementById("ef-km-inp");    if (km) km.value = "";
        const ber = document.getElementById("ef-sp-ber");    if (ber) ber.value = "";
        const calc = document.getElementById("ef-km-calc");  if (calc) calc.textContent = "";
      }
    },

    // Km-Berechnung (inline, still)
    efCalcKm(km) {
      const projId = Number(document.querySelector("[name='projektLookupId']")?.value) || null;
      const proj   = projId ? state.enriched.projekte.find(p => p.id === projId) : null;
      const ansatz = proj?.ansatzKmSpesen;
      if (!ansatz) return;
      const total = (parseFloat(km) || 0) * ansatz;
      const calc = document.getElementById("ef-km-calc");
      if (calc) calc.textContent = total > 0 ? "= CHF " + h.chf(total) : "";
      const ber = document.getElementById("ef-sp-ber");
      if (ber) ber.value = total > 0 ? String(total) : "";
    },

    // Status-Toggle: mutual exclusive, zweiter Klick deaktiviert
    efToggleStatus(btn, statusVal) {
      const statusHid = document.getElementById("status-hid");
      const abrHid    = document.getElementById("abr-hid");
      const wasOn = btn.classList.contains("on");
      document.querySelectorAll(".ef-st-btn").forEach(b => b.classList.remove("on"));
      const isAbgesagt = statusVal.toLowerCase().includes("abgesagt");
      if (!wasOn) {
        btn.classList.add("on");
        if (statusHid) statusHid.value = statusVal;
        // Abgesagt → Abrechnung auf "offen" setzen (kein Geld fliessen)
        if (isAbgesagt && abrHid) abrHid.value = "offen";
      } else {
        if (statusHid) statusHid.value = "";
        // Nicht mehr abgesagt → Abrechnung zurück auf "offen"
        if (abrHid) abrHid.value = "offen";
      }
      // Status-Info-Pill aktualisieren
      const dot   = document.getElementById("ef-st-dot");
      const label = document.getElementById("ef-st-label");
      const cur   = statusHid?.value || "";
      if (dot && label) {
        if (!cur) {
          // Datum-basiert: Geplant/Durchgeführt
          const datumVal = document.querySelector("[name='datum']")?.value;
          const d = h.toDate(datumVal);
          const isPast = d && d <= h.todayStart();
          dot.className   = "ef-st-info-dot " + (isPast ? "green" : "blue");
          label.textContent = isPast ? "Durchgef\u00fchrt" : "Geplant";
        } else {
          dot.className   = "ef-st-info-dot red";
          label.textContent = cur === "abgesagt mit Kostenfolge" ? "Abgesagt (CHF)" : "Abgesagt";
        }
      }
    },

    onProjChange(sel) {
      const p    = state.enriched.projekte.find(p => p.id === Number(sel.value));
      const kats = h.kategorien(p);
      const grp  = document.getElementById("kat-grp");
      if (grp) grp.innerHTML = kats.length
        ? kats.map(k => `<button type="button" class="ef-kat-btn"
            onclick="document.querySelectorAll('.ef-kat-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');document.getElementById('kat-hid').value='${h.esc(k)}';ctrl.onKatChange('${h.esc(k)}')">${h.esc(k)}</button>`).join("")
        : `<span style="font-size:12px;color:#8896a5">Keine Kategorien konfiguriert</span>`;
      const hid = document.getElementById("kat-hid");
      if (hid) hid.value = "";
      const dTage = document.getElementById("ef-tage-inp"); if (dTage) dTage.value = "1";
      const dStd = document.querySelector("[name='dauerStunden']"); if (dStd) dStd.value = "";
      const dStk = document.querySelector("[name='anzahlStueck']"); if (dStk) dStk.value = "";
      // Betrag-Anzeige zurücksetzen
      const bvl = document.getElementById("ef-bval-lead");
      if (bvl) { bvl.textContent = "Kategorie wählen"; bvl.className = "ef-betrag-val warn"; }
      // Wegspesen: Km-Ansatz aus neuem Projekt neu rendern
      const ansatzKm = p?.ansatzKmSpesen || null;
      const kmVorbelegt = p?.kmZumKunden || "";
      const wegDetail = document.getElementById("ef-weg-detail");
      if (wegDetail) {
        wegDetail.innerHTML = ansatzKm
          ? `<div class="ef-weg-row">
               <input type="number" class="ef-weg-inp" id="ef-km-inp" name="kmAnzahl" min="0" step="1"
                 value="${kmVorbelegt}" placeholder="km" oninput="ctrl.efCalcKm(this.value)">
               <span class="ef-weg-hint">km (Hin &amp; Zurück)</span>
             </div>
             <div style="display:flex;align-items:center;gap:6px">
               <span class="ef-weg-hint">CHF ${h.chf(ansatzKm)}/km</span>
               <span class="ef-weg-calc" id="ef-km-calc"></span>
             </div>
             <input type="hidden" name="spesenBerechnet" id="ef-sp-ber" value="">`
          : `<span class="ef-weg-noansatz">⚠ Kein Km-Ansatz im Projekt hinterlegt</span>`;
        wegDetail._ansatzKm = ansatzKm;
      }
      // efCalcKm braucht den neuen ansatzKm — als data attr auf btn speichern
      const wegBtn = document.getElementById("ef-weg-btn");
      if (wegBtn) wegBtn.dataset.ansatzKm = ansatzKm || "";
    },

    onKatChange(kat) {
      const fdStd  = document.getElementById("fd-std");
      const fdStk  = document.getElementById("fd-stk");
      if (fdStd)  fdStd.className  = "ef-sub-inp" + (kat === "Stunde" ? " show" : "");
      if (fdStk)  fdStk.className  = "ef-sub-inp" + (kat === "Stück" ? " show" : "");
      const isTagKat = ["Einsatz (Tag)", "Einsatz (Halbtag)"].includes(kat);
      const addCoBtn = document.getElementById("ef-addco-btn");
      if (addCoBtn) addCoBtn.style.display = isTagKat ? "inline-flex" : "none";
      if (!isTagKat) ctrl.efToggleCo(false);
      // Betrag neu berechnen (inkl. dauerTage für Mehrtagseinsätze)
      const projId = Number(document.querySelector("[name='projektLookupId']")?.value) || null;
      const proj   = projId ? state.enriched.projekte.find(p => p.id === projId) : null;
      const tage   = h.num(document.getElementById("ef-tage-inp")?.value) || 1;
      const std    = h.num(document.querySelector("[name='dauerStunden']")?.value);
      const stk    = h.num(document.querySelector("[name='anzahlStueck']")?.value);
      const betrag = proj ? h.berechneBetrag(proj, kat, tage, std, stk) : null;
      const bvl    = document.getElementById("ef-bval-lead");
      if (bvl) {
        if (!kat)            { bvl.textContent = "Kategorie w\u00e4hlen"; bvl.className = "ef-betrag-val warn"; }
        else if (betrag === null) { bvl.textContent = "Nicht konfiguriert"; bvl.className = "ef-betrag-val warn"; }
        else                 { bvl.textContent = "CHF " + h.chf(betrag);   bvl.className = "ef-betrag-val"; }
      }
      // Anpassen-Button: nur sichtbar wenn Kat gewählt + Betrag konfiguriert
      const anp = document.getElementById("ef-betrag-anpassen");
      if (anp) anp.style.display = (kat && betrag !== null) ? "" : "none";
      ctrl.updateCoBetrag();
    },

    _saveEinsatzBusy: false,
    async saveEinsatz(fd) {
      // Guard: verhindert Mehrfach-Submit (Flag, nicht Timestamp)
      if (ctrl._saveEinsatzBusy) return;
      ctrl._saveEinsatzBusy = true;
      ui.setMsg("Wird gespeichert…", "info");
      try {
        const mode   = fd.get("mode");
        const itemId = fd.get("itemId");
        const datum  = fd.get("datum");
        const kat    = fd.get("kategorie");
        const projId = Number(fd.get("projektLookupId")) || null;

        debug.log("saveEinsatz:formData", { datum, kat, projId, mode, itemId });

        const showModalErr = msg => {
          let el = document.getElementById("ef-inline-err");
          if (!el) {
            el = document.createElement("div");
            el.id = "ef-inline-err";
            el.style.cssText = "background:#fce7f3;color:#950e13;border:1px solid #f4c0d1;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:500;margin:0 0 4px;display:flex;align-items:center;gap:8px;grid-column:1/-1";
            const bd = document.querySelector(".ef-bd");
            if (bd) bd.insertBefore(el, bd.firstChild);
          }
          el.innerHTML = `<span style="flex-shrink:0">⚠</span> ${h.esc(msg)}`;
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        };
        if (!datum) {
          showModalErr("Bitte Datum auswählen.");
          document.querySelector("[name='datum']")?.focus();
          return;
        }
        if (!projId) { showModalErr("Bitte Projekt wählen."); return; }
        if (!kat)    { showModalErr("Bitte Kategorie wählen."); return; }
        const personIdCheck = h.num(fd.get("personLookupId"));
        if (!personIdCheck) { showModalErr("Bitte Lead-Person wählen."); return; }

        const p            = state.enriched.projekte.find(p => p.id === projId);
        const dauerTage    = h.num(fd.get("dauerTage"));
        const dauerStunden = h.num(fd.get("dauerStunden"));
        const anzahlStueck = h.num(fd.get("anzahlStueck"));
        const betragBer    = h.berechneBetrag(p, kat, dauerTage, dauerStunden, anzahlStueck);
        const titelInput   = (fd.get("titel") || "").trim();
        const titel        = titelInput || `${kat} · ${datum}`;

        const fields = {
          Datum:            datum + "T12:00:00Z",
          [F.projekt_w]:   projId,
          Kategorie:        kat,
          Abrechnung:       fd.get("abrechnung") || "offen"
        };

        // DauerTage: aus Input für Einsatz (Tag) — min. 1; Halbtag fix 0.5
        if (kat === "Einsatz (Tag)")          fields.DauerTage = Math.max(1, dauerTage || 1);
        else if (kat === "Einsatz (Halbtag)") fields.DauerTage = 0.5;
        else if (kat === "Stunde"  && dauerStunden) fields.DauerStunden = dauerStunden;
        else if (kat === "Stück"   && anzahlStueck) fields.AnzahlStueck = anzahlStueck;

        if (betragBer !== null) fields.BetragBerechnet = betragBer;
        const bf = h.num(fd.get("betragFinal"));
        if (bf !== null) fields.BetragFinal = bf;
        // Co-Betrag: nur wenn Co-Lead gesetzt
        const coPersonId2 = h.num(fd.get("coPersonLookupId"));
        if (coPersonId2) {
          const coBetragBer = h.berechneCoBetrag(p, kat, dauerTage);
          if (coBetragBer !== null) fields.CoBetragBerechnet = coBetragBer;
          const cbf = h.num(fd.get("coBetragFinal"));
          if (cbf !== null) fields.CoBetragFinal = cbf;
        }

        const ort = (fd.get("ort") || "").trim();
        if (ort) fields.Ort = ort;
        const bem = (fd.get("bemerkungen") || "").trim();
        if (bem) fields.Bemerkungen = bem;
        // Wegspesen: Toggle-Zustand aus ef-weg-btn, Betrag aus hidden field
        const wegAktiv = document.getElementById("ef-weg-btn")?.classList.contains("on");
        fields.SpesenBerechnet = wegAktiv ? (h.num(fd.get("spesenBerechnet")) ?? 0) : 0;
        // SpesenZusatz + SpesenFinal nicht mehr im Modal gesetzt — bestehende Werte erhalten
        // (werden im späteren Abrechnungsdialog verwaltet)
        const status = fd.get("status");
        if (status) fields.Status = status;
        else fields.Status = "";   // explizit leeren bei "normal"

        // Lookup-Felder via SP REST API
        const lookupFields = { [F.projekt_w]: projId };
        const personId = h.num(fd.get("personLookupId"));
        if (personId) lookupFields[F.person_w] = personId;
        const coPersonId = h.num(fd.get("coPersonLookupId"));
        if (coPersonId) lookupFields[F.coPerson_w] = coPersonId;
        delete fields[F.projekt_w];

        if (mode === "edit" && itemId) {
          const eid = Number(itemId);
          fields.Title = titel;
          await api.patch(CONFIG.lists.einsaetze, eid, fields);
          await api.patchLookups(CONFIG.lists.einsaetze, eid, lookupFields);
        } else {
          const cr  = await api.post(CONFIG.lists.einsaetze, titel);
          const nid = Number(cr?.id || cr?.fields?.id);
          if (!nid) throw new Error("Neue ID fehlt.");
          await api.patch(CONFIG.lists.einsaetze, nid, fields);
          await api.patchLookups(CONFIG.lists.einsaetze, nid, lookupFields);
        }

        ui.closeModal();
        ui.setMsg("Einsatz gespeichert.", "success");
        await api.loadAll();
        ctrl.render();
      } catch (e) {
        debug.err("saveEinsatz", e);
        // Fehler im Modal anzeigen (nicht in globaler Statusbar die hinter Modal liegt)
        const showModalErr = msg => {
          let el = document.getElementById("ef-inline-err");
          if (!el) {
            el = document.createElement("div");
            el.id = "ef-inline-err";
            el.style.cssText = "background:#fce7f3;color:#950e13;border:1px solid #f4c0d1;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:500;margin:0 0 4px;display:flex;align-items:center;gap:8px;grid-column:1/-1";
            const bd = document.querySelector(".ef-bd");
            if (bd) bd.insertBefore(el, bd.firstChild);
          }
          el.innerHTML = `<span style="flex-shrink:0">⚠</span> ${h.esc(msg)}`;
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        };
        showModalErr(e.message || "Fehler beim Speichern.");
      } finally {
        ctrl._saveEinsatzBusy = false;
      }
    },

    async deleteEinsatz(id) {
      const e = state.enriched.einsaetze.find(e => e.id === id);
      if (!e) return;
      const label = e.title || e.datumFmt || `Einsatz #${id}`;
      if (!confirm(`Einsatz "${label}" wirklich löschen?`)) return;
      ui.closeModal();
      try {
        await api.deleteItem(CONFIG.lists.einsaetze, id);
        ui.setMsg("Einsatz gelöscht.", "success");
        await api.loadAll();
        ctrl.render();
      } catch (e) {
        debug.err("deleteEinsatz", e);
        ui.setMsg("Fehler beim Löschen: " + e.message, "error");
      }
    },

    copyKonzeption(id) {
      const k = state.enriched.konzeption.find(k => k.id === id);
      if (!k) return;
      ui.closeModal();
      ctrl.openKonzeptionForm(null, k.projektLookupId, {
        titel:       k.title || "",
        datum:       "",           // Datum bewusst leer lassen
        kategorie:   k.kategorie || "",
        personId:    k.personLookupId || null,
        aufwandStunden: k.aufwandStunden || null,
        verrechenbar: k.verrechenbar || "",
        betragFinal: null,         // Betrag nicht übernehmen
        bemerkungen: k.bemerkungen || ""
      });
    },

    async deleteKonzeption(id) {
      const k = state.enriched.konzeption.find(k => k.id === id);
      if (!k) return;
      const label = k.title || k.datumFmt || `Konzeption #${id}`;
      if (!confirm(`Konzeptionsaufwand "${label}" wirklich löschen?`)) return;
      ui.closeModal();
      try {
        await api.deleteItem(CONFIG.lists.konzeption, id);
        ui.setMsg("Konzeptionsaufwand gelöscht.", "success");
        await api.loadAll();
        ctrl.render();
      } catch (e) {
        debug.err("deleteKonzeption", e);
        ui.setMsg("Fehler beim Löschen: " + e.message, "error");
      }
    },

    async deleteAbrechnung(id) {
      const a = state.enriched.abrechnungen.find(a => a.id === id);
      if (!a) return;
      if (!confirm(`Abrechnung "${a.title}" löschen?\n\nVerknüpfte Einsätze und Konzeptionsaufwände werden auf «offen» zurückgesetzt.`)) return;
      try {
        ui.setMsg("Wird bereinigt…", "info");

        // 1. Verknüpfte Einsätze: Abrechnung auf «offen» + Lookup leeren
        const verknEinsaetze = state.enriched.einsaetze.filter(e => e.abrechnungLookupId === id);
        await Promise.allSettled(verknEinsaetze.map(async e => {
          await api.patch(CONFIG.lists.einsaetze, e.id, { Abrechnung: "offen" });
          await api.patchLookups(CONFIG.lists.einsaetze, e.id, { [F.abrechnung_w]: 0 });
        }));

        // 2. Verknüpfte Konzeptionen: Abrechnung auf «offen» + Lookup leeren
        const verknKonz = state.enriched.konzeption.filter(k => k.abrechnungLookupId === id);
        await Promise.allSettled(verknKonz.map(async k => {
          await api.patch(CONFIG.lists.konzeption, k.id, { Abrechnung: "offen" });
          await api.patchLookups(CONFIG.lists.konzeption, k.id, { [F.konz_abrechnung_w]: 0 });
        }));

        // 3. Abrechnung löschen
        await api.deleteItem(CONFIG.lists.abrechnungen, id);
        ui.setMsg(`Abrechnung gelöscht — ${verknEinsaetze.length} Einsätze, ${verknKonz.length} Konzeptionsaufwände zurückgesetzt.`, "success");
        await api.loadAll();
        ctrl.render();
      } catch (e) {
        debug.err("deleteAbrechnung", e);
        ui.setMsg("Fehler beim Löschen: " + e.message, "error");
      }
    },

    deleteProjekt(id) {
      const p = state.enriched.projekte.find(p => p.id === id);
      if (!p) return;
      const einsaetze    = state.enriched.einsaetze.filter(e => e.projektLookupId === id);
      const konzeption   = state.enriched.konzeption.filter(k => k.projektLookupId === id);
      const abrechnungen = state.enriched.abrechnungen.filter(a => a.projektLookupId === id);

      const rows = [
        einsaetze.length    ? `<tr><td>Einsätze</td><td>${einsaetze.length}</td></tr>` : "",
        konzeption.length   ? `<tr><td>Konzeptionsaufwände</td><td>${konzeption.length}</td></tr>` : "",
        abrechnungen.length ? `<tr><td>Abrechnungen</td><td>${abrechnungen.length}</td></tr>` : ""
      ].filter(Boolean).join("");

      ui.renderModal(`
        <div style="background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.2);width:100%;max-width:440px;display:flex;flex-direction:column;overflow:hidden">
          <div style="background:#950e13;padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:15px;font-weight:700;color:#fff">Projekt löschen</div>
              <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:2px">#${h.esc(p.projektNr||String(p.id))} · ${h.esc(p.firmaName||"")}</div>
            </div>
            <button data-close-modal style="background:rgba(255,255,255,.15);border:none;border-radius:8px;width:30px;height:30px;cursor:pointer;color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center">×</button>
          </div>
          <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:14px;font-weight:600;color:#1a2332">${h.esc(p.title)}</div>
            ${rows ? `
              <div style="background:#fff8f8;border:1px solid #fcd0d0;border-radius:10px;padding:12px 16px">
                <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#950e13;margin-bottom:8px">Wird ebenfalls gelöscht</div>
                <table style="width:100%;font-size:13px;border-collapse:collapse">
                  ${rows}
                </table>
              </div>` : ""}
            <div style="font-size:13px;color:#5a6a7a;background:#f8f9fb;border-radius:8px;padding:10px 14px">
              ⚠️ Diese Aktion kann nicht rückgängig gemacht werden.
            </div>
          </div>
          <div style="padding:12px 20px 16px;border-top:1px solid #eef1f5;display:flex;justify-content:flex-end;gap:8px">
            <button data-close-modal style="padding:8px 18px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;background:none;border:1.5px solid #dde4ec;color:#4a5568;cursor:pointer">Abbrechen</button>
            <button onclick="ctrl._deleteProjektConfirmed(${id})" style="padding:8px 20px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:700;background:#950e13;border:none;color:#fff;cursor:pointer">Endgültig löschen</button>
          </div>
        </div>`);
    },

    async _deleteProjektConfirmed(id) {
      const p = state.enriched.projekte.find(p => p.id === id);
      if (!p) return;
      const einsaetze    = state.enriched.einsaetze.filter(e => e.projektLookupId === id);
      const konzeption   = state.enriched.konzeption.filter(k => k.projektLookupId === id);
      const abrechnungen = state.enriched.abrechnungen.filter(a => a.projektLookupId === id);

      ui.closeModal();
      try {
        ui.setMsg("Projekt wird gelöscht…", "info");
        await Promise.allSettled(einsaetze.map(e => api.deleteItem(CONFIG.lists.einsaetze, e.id)));
        await Promise.allSettled(konzeption.map(k => api.deleteItem(CONFIG.lists.konzeption, k.id)));
        await Promise.allSettled(abrechnungen.map(a => api.deleteItem(CONFIG.lists.abrechnungen, a.id)));
        await api.deleteItem(CONFIG.lists.projekte, id);
        ui.setMsg(`Projekt "${p.title}" und alle abhängigen Einträge gelöscht.`, "success");
        state.selection.projektId = null;
        state.filters.route = "projekte";
        await api.loadAll();
        ctrl.navigate("projekte");
      } catch (e) {
        debug.err("deleteProjekt", e);
        ui.setMsg("Fehler beim Löschen: " + e.message, "error");
      }
    },

    copyEinsatz(id) {
      // Einsatz duplizieren: neues Formular mit allen Feldern ausser Datum
      const e = state.enriched.einsaetze.find(e => e.id === id);
      if (!e) return;
      ui.closeModal();
      ctrl.openEinsatzForm(null, e.projektLookupId, e.kategorie, {
        ort:             e.ort || "",
        titel:           e.title || "",
        personId:        e.personLookupId || null,
        coPersonId:      e.coPersonLookupId || null,
        bemerkungen:     e.bemerkungen || "",
        dauerTage:       e.dauerTage || 1,
        dauerStunden:    e.dauerStunden || null,
        anzahlStueck:    e.anzahlStueck || null,
        spesenAktiv:     !!(e.spesenBerechnet),
        spesenBerechnet: e.spesenBerechnet || null,
        betragFinal:     e.betragFinal || null,
        coBetragFinal:   e.coBetragFinal || null
      });
    },

    // ── Abrechnung Inline-Helfer ─────────────────────────────────────────

    aeSetTab(tab, projektId) {
      ctrl.aeSaveSelection();   // Auswahl persistieren bevor neu gerendert
      state.ui.aeTab = tab;
      views.abrechnungErstellen(projektId);
    },

    aeSaveSelection() {
      if (!state.ui.aeSelected) state.ui.aeSelected = h.newAeSelected();
      const sel = state.ui.aeSelected;
      // Einsatz-Checkboxen
      document.querySelectorAll(".ae-e-cb").forEach(cb => {
        const id = Number(cb.dataset.id);
        if (cb.checked) sel.einsaetze.add(id);
        else sel.einsaetze.delete(id);
      });
      // Konzeption-Checkboxen
      document.querySelectorAll(".ae-k-cb").forEach(cb => {
        const id = Number(cb.dataset.id);
        if (cb.checked) sel.konzeption.add(id);
        else sel.konzeption.delete(id);
      });
      // Zusatzspesen
      const zb = document.getElementById("ae-zusatz-betrag");
      const zbm = document.getElementById("ae-zusatz-bem");
      if (zb)  sel.zusatzBetrag = zb.value;
      if (zbm) sel.zusatzBem    = zbm.value;
    },

    _initAeUpdateTotal() {
      // aeUpdateTotal als globale Funktion registrieren (muss vor render() verfügbar sein)
      window.aeUpdateTotal = () => {
        let honorar = 0, wegspesen = 0, kTotal = 0;
        // DOM-Checkboxen auslesen (aktueller Tab)
        document.querySelectorAll(".ae-e-cb:checked").forEach(cb => {
          honorar   += parseFloat(cb.dataset.honorar) || 0;
          wegspesen += parseFloat(cb.dataset.spesen)  || 0;
        });
        document.querySelectorAll(".ae-k-cb:checked").forEach(cb => {
          kTotal += parseFloat(cb.dataset.betrag) || 0;
        });
        // Tabs die nicht sichtbar sind → aus state lesen
        const sel = state.ui.aeSelected;
        if (sel) {
          // Einsätze: wenn kein DOM-Tab aktiv, aus state
          const domEinsaetze = document.querySelectorAll(".ae-e-cb");
          if (domEinsaetze.length === 0) {
            state.enriched.einsaetze.forEach(e => {
              if (sel.einsaetze.has(e.id)) {
                honorar   += (e.anzeigeBetrag||0) + (e.coAnzeigeBetrag||0);
                wegspesen += e.spesenBerechnet || 0;
              }
            });
          }
          // Konzeption: wenn kein DOM-Tab aktiv, aus state
          const domKonz = document.querySelectorAll(".ae-k-cb");
          if (domKonz.length === 0) {
            state.enriched.konzeption.forEach(k => {
              if (sel.konzeption.has(k.id)) kTotal += k.anzeigeBetrag || 0;
            });
          }
        }
        const zusatz = parseFloat(document.getElementById("ae-zusatz-betrag")?.value) || 0;
        const grand  = honorar + wegspesen + zusatz + kTotal;
        const fmt = v => v.toLocaleString("de-CH",{minimumFractionDigits:2,maximumFractionDigits:2});
        const s = id => document.getElementById(id);
        if(s("ae-einsatz-honorar"))    s("ae-einsatz-honorar").textContent    = "CHF " + fmt(honorar);
        if(s("ae-einsatz-spesen-sub")) s("ae-einsatz-spesen-sub").textContent = "CHF " + fmt(wegspesen);
        if(s("ae-einsatz-total"))      s("ae-einsatz-total").textContent      = "CHF " + fmt(honorar + wegspesen);
        if(s("ae-konz-total"))  s("ae-konz-total").textContent  = "CHF " + fmt(kTotal);
        if(s("ae-ft-konz"))     s("ae-ft-konz").textContent     = "CHF " + fmt(kTotal);
        if(s("ae-spesen-hd"))   s("ae-spesen-hd").textContent   = "CHF " + fmt(zusatz);
        if(s("ae-ft-zusatz"))   s("ae-ft-zusatz").textContent   = "CHF " + fmt(zusatz);
        if(s("ae-ft-honorar"))  s("ae-ft-honorar").textContent  = "CHF " + fmt(honorar);
        if(s("ae-ft-wegspesen"))s("ae-ft-wegspesen").textContent= "CHF " + fmt(wegspesen);
        if(s("ae-grand-total")) s("ae-grand-total").textContent = "CHF " + fmt(grand);
      };
    },

    // ── Abrechnung Inline-Helfer ─────────────────────────────────────────

    async aeKlaerungEntscheid(konzId, neuerWert, btn, projektId) {
      try {
        if (btn) btn.disabled = true;

        // SP patchen: nur Verrechenbar setzen
        // Abrechnung-Feld hat nur: offen / zur Abrechnung / abgerechnet
        // "Inklusive (ohne Verrechnung)" ist ein Verrechenbar-Wert, kein Abrechnung-Wert
        const fields = { Verrechenbar: neuerWert };
        // Bei Rückstufung auf Klärung nötig: Abrechnung auf offen zurücksetzen
        const isRevert = neuerWert === "Klärung nötig";
        if (isRevert) fields.Abrechnung = "offen";
        await api.patch(CONFIG.lists.konzeption, konzId, fields);
        // Bei Rückstufung: Abrechnung-Lookup leeren
        if (isRevert) {
          await api.patchLookups(CONFIG.lists.konzeption, konzId, { [F.konz_abrechnung_w]: 0 });
        }

        // State lokal aktualisieren
        const k = state.enriched.konzeption.find(k => k.id === konzId);
        if (k) {
          k.verrechenbar = neuerWert;
          if (isRevert) { k.abrechnung = "offen"; k.abrechnungLookupId = null; }
        }
        // Raw-State aktualisieren
        const raw = state.data.konzeption.find(r => Number(r.id) === konzId);
        if (raw) {
          raw.Verrechenbar = neuerWert;
          if (isRevert) raw.Abrechnung = "offen";
        }

        // Bei verrechenbar: sofort in Auswahl aufnehmen
        if (neuerWert === "verrechenbar") {
          if (!state.ui.aeSelected) state.ui.aeSelected = h.newAeSelected();
          state.ui.aeSelected.konzeption.add(konzId);
        }

        // Tab neu rendern
        views.abrechnungErstellen(projektId);
        const label = neuerWert === "verrechenbar" ? "verrechenbar" : "inklusive (ohne Verrechnung)";
        ui.setMsg(`Freigabe gesetzt: ${label}`, "success");
      } catch(e) {
        debug.err("aeKlaerungEntscheid", e);
        ui.setMsg("Fehler: " + e.message, "error");
        if (btn) btn.disabled = false;
      }
    },

    async aeAbrechnen(projektId) {
      const p = state.enriched.projekte.find(p => p.id === projektId);
      if (!p) return;

      // Auswahl zuerst aus DOM speichern (falls noch nicht getan)
      ctrl.aeSaveSelection();
      const sel = state.ui.aeSelected || h.newAeSelected();
      const checkedIds     = [...sel.einsaetze];
      const checkedKonzIds = [...sel.konzeption];
      const zusatzBetrag   = h.num(sel.zusatzBetrag);
      const zusatzBem      = (sel.zusatzBem || "").trim();
      const datumVal       = document.getElementById("ae-datum")?.value || new Date().toISOString().slice(0,10);

      if (!checkedIds.length && !checkedKonzIds.length) {
        ui.setMsg("Bitte mindestens einen Einsatz oder Konzeptionsaufwand wählen.", "error");
        return;
      }

      const einsaetze  = state.enriched.einsaetze.filter(e => checkedIds.includes(e.id));
      const konzeption = state.enriched.konzeption.filter(k => checkedKonzIds.includes(k.id));

      const totalEinsatz = einsaetze.reduce((s,e) => s + (e.totalBetrag || 0), 0);
      const totalSpesen  = einsaetze.reduce((s,e) => s + (e.spesenBerechnet || 0), 0) + (zusatzBetrag || 0);
      const totalKonz    = konzeption.reduce((s,k) => s + (k.anzeigeBetrag || 0), 0);
      const grandTotal   = totalEinsatz + totalSpesen + totalKonz;

      const fmt = v => v.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const confirmed = confirm(
        `Abrechnung erstellen für ${p.title}?\n\n` +
        `Einsätze: CHF ${fmt(totalEinsatz)} (${checkedIds.length} Stk.)\n` +
        `Konzeption: CHF ${fmt(totalKonz)} (${checkedKonzIds.length} Stk.)\n` +
        `Spesen: CHF ${fmt(totalSpesen)}\n\n` +
        `Total: CHF ${fmt(grandTotal)}`
      );
      if (!confirmed) return;

      try {
        ui.setMsg("Abrechnung wird erstellt…", "info");

        // 1. Abrechnung-Datensatz anlegen
        const abrTitel = `${p.title} · ${new Date(datumVal).toLocaleDateString("de-CH",{month:"long",year:"numeric"})}`;
        const cr   = await api.post(CONFIG.lists.abrechnungen, abrTitel);
        const abrId = Number(cr?.id || cr?.fields?.id);
        if (!abrId) throw new Error("Abrechnung konnte nicht angelegt werden.");

        const abrFields = {
          Datum:  datumVal + "T12:00:00Z",
          Status: "erstellt"
        };
        if (zusatzBetrag !== null) abrFields.SpesenZusatzBetrag = zusatzBetrag;
        if (zusatzBem)             abrFields.SpesenZusatzBemerkung = zusatzBem;
        await api.patch(CONFIG.lists.abrechnungen, abrId, abrFields);
        await api.patchLookups(CONFIG.lists.abrechnungen, abrId, { [F.abr_projekt_w]: projektId });

        // 2. Einsätze abrechnen
        await Promise.allSettled(checkedIds.map(async eid => {
          await api.patch(CONFIG.lists.einsaetze, eid, { Abrechnung: "abgerechnet" });
          await api.patchLookups(CONFIG.lists.einsaetze, eid, { [F.abrechnung_w]: abrId });
        }));

        // 3. Konzeption abrechnen
        await Promise.allSettled(checkedKonzIds.map(async kid => {
          await api.patch(CONFIG.lists.konzeption, kid, { Abrechnung: "abgerechnet" });
          await api.patchLookups(CONFIG.lists.konzeption, kid, { [F.konz_abrechnung_w]: abrId });
        }));

        ui.setMsg(`Abrechnung erstellt — ${checkedIds.length} Einsätze, ${checkedKonzIds.length} Konzeptionsaufwände.`, "success");
        await api.loadAll();

        // PDF generieren
        try {
          await ctrl.generateAbrechnungPDF(projektId, checkedIds, checkedKonzIds, zusatzBetrag, zusatzBem, datumVal);
        } catch(pdfErr) {
          debug.err("generateAbrechnungPDF", pdfErr);
          ui.setMsg("Abrechnung gespeichert — PDF fehlgeschlagen: " + pdfErr.message, "warning");
        }

        // Zurück zur Projektansicht
        ctrl.navigate("projekt-detail");
        ctrl.openProjekt(projektId);
      } catch(e) {
        debug.err("aeAbrechnen", e);
        ui.setMsg("Fehler: " + e.message, "error");
      }
    },

    // ── PDF-Generierung ──────────────────────────────────────────────────
    async generateAbrechnungPDF(projektId, checkedEinsatzIds, checkedKonzIds, spesenZusatzBetrag, spesenZusatzBem, datumVal) {
      const p        = state.enriched.projekte.find(p => p.id === projektId);
      const d        = datumVal ? new Date(datumVal) : new Date();
      const datum    = d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
      const datumLang = d.toLocaleDateString("de-CH", { day: "2-digit", month: "long", year: "numeric" });

      // Gewählte Einsätze
      const einsaetze = state.enriched.einsaetze
        .filter(e => checkedEinsatzIds.includes(e.id));

      // Gewählte Konzeption (nur gecheckte)
      const konzeption = state.enriched.konzeption
        .filter(k => (checkedKonzIds || []).includes(k.id));

      // Spesen: nur aus gewählten Einsätzen
      const spesenEinsaetze = einsaetze.filter(e => (e.spesenBerechnet || 0) > 0);
      const spesenTotal     = spesenEinsaetze.reduce((s,e) => s + (e.spesenBerechnet || 0), 0);

      // Totals
      const einsatzTotal = einsaetze.reduce((s,e) => s + (e.totalBetrag || 0), 0);
      const konzTotal    = konzeption.reduce((s,k) => s + (k.anzeigeBetrag || 0), 0);
      const spesenGes    = spesenTotal + (spesenZusatzBetrag || 0);

      // jsPDF dynamisch laden
      if (!window.jspdf) {
        await new Promise((res, rej) => {
          const s1 = document.createElement("script");
          s1.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s1.onload = res; s1.onerror = rej;
          document.head.appendChild(s1);
        });
      }
      if (!window.jspdf?.jsPDF?.API?.autoTable) {
        await new Promise((res, rej) => {
          const s2 = document.createElement("script");
          s2.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
          s2.onload = res; s2.onerror = rej;
          document.head.appendChild(s2);
        });
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const PW  = 210; // A4 Breite
      const PH  = 297; // A4 Höhe
      const ML  = 20;  // Margin links
      const MR  = 20;  // Margin rechts
      const CW  = PW - ML - MR; // Content-Breite
      const COL = "#919294";
      const BLUE = "#004078";

      // ── LOGO (Header) ────────────────────────────────────────────────
      const LOGO = "iVBORw0KGgoAAAANSUhEUgAAAJgAAABaCAYAAABE4p+eAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAHYcAAB2HAY/l8WUAABAeSURBVHhe7V1PqF5HFb9IhS66cCHYhWLxTxHsQtBFF2nufW0XghWKihQspYuiRSqKTb65973C9zRghC4iZhGwQhZZdFEhiwihBIwQahZZBCyYRReptJhFhIpFIgapnHNmzvw7M3e+79373svn/GBI3jd3/p3zu2f+nZnbNAbtsa80reqa9sef4N/uRWAbICzvD6Mq9gnIpZBHnTrfdP1HTXv8aT/iHkOnPqB2qIfCqIp9QtefRZL5P1aCVUyESrCKWVEJVjErKsEqZkUlWMWsKCIYTDNxur/4CQXV+QkyiNPuNq16fjSP9tiDlG74Ev29vL9p+6eadnGMAvz/2INhMg/QhhTB2uUDdhnjp58MoxFYd5hmH3/ar3sosABx3e/TdQcZlNV9UzBKMBCqsQReUB+Mk+T4003X34zTch7Xk3mAIum5s027eLTp+ltC+juosBRSFmy5/FjTqTM6j/NNu/i0Fw8AoUD9ojI5nA2TMLy6D4/IMlB3ibDL+8LkG4Uswbr+sv73pv7trPMbhVB5BvC7JeblplOnHCuwa4WuPgiTIlhJ6qIm1+2mU6c14U81nbph69A/FSZHpAjWqh/ptH9puuEJL47inboDyZy6kwwMSc6HSRG27he07CCv15y6W+K2i2fC5BuFEYKBkE5FK7H4djNBTnlxBqCQnBIAJg/JilkrQASN6rC8v+nUpWwZEsG21ONETvXfput/6D1vQETSFjZcheb2p18wv+7Xoi4YrBaRD+KvenGbhhGC3RQFDLBvqWyB8E1FBeyGUQxjDYCMIWz+d0QlAqgLhmduhFGIkGCPD59q2v53lGbx6/BxBg8R1PNhFMNYIekZl2DQRUpo1RGW8SYjT7CEdQIA8ViIAglpAJ0fEOdIaAn2dhjFwK4so6SQYG3/M/33m82R/uHwcQZb1pK6516O/r0wiuHKb5ORJZgkPBdMsDCDQpQRTO7+AKMEM/VTD5HFUHfJIo7U102XQlndL4VRHirBBPPvwlqIeAwFwGk+jMVQGTDQP0+zNhzow0C6QEm52ZqxAqluWiuQytFWqX8pfMyDa1lw/KknJWHgyY5g5W3XnX45AJVgIwutTDDhOSJQbpoPgZQ0O8E4yJbOhUewklAJlkWeYKUWTCAYT+dxvQze+g4Lwn9BAe5UfXaCvdF06kMqaxULhm3IB0lGlWAW8xEsE2dgZ2LzEozGYC/oZ/NjMG/ykhmD5VAJZpEnWOkgPxiD2cF3Xng0lpmRYM4s8qvf/3jTqd/o5y82WzufDx9HeAQLBVOISjCLPMEExRu4JArfdI5LKN7AkEgqZ2qCAdpt2P75k04Tj50MSghGyzDU9YeoBLPIEiwnICvEWLlja2QGZrV/vwgGaNWzTdf/s+n6/zTd4gfe8wY848x17zzGjIlaCWaRJ5jQ/QFIselpOoCVm+hmMY+5x2ACwQBt/0ud95+bbmi9OACTJ1O2nQHH49RKMIs8wXimB7OlXRQcWR274Z16y62SSNC0WQxuOhBg03cfZpEJgm29/Nmm7X+v076BW0gubNn0AlF3+BDPgs36HeUtvICVYIwswWg5wdn4dgMsPySsE8C1UGLQXgqkpP0lGMYtvtG06l1KvzgRRvMEJB/kulWCWYgEQ0sFFktH0Go8EI1W4924MbDFQqun04M1M858qYGyiUtYSADmAc8kiE557ybHgdxO9Qo6IIYwdeC6827EqWz7S+oOMPXbZIgEq6iYCpVgFbOiEqxiVlSCVcyKSrCKWVEJVjErKsEqZkUlWMWsEAlG2zw3xQXQiopVIBOs0GW6omIMlWAVs6ISTEDXv06nyf9PLiiZE5VgAkoO3laUoRJMQCXYdFiJYCm3l1Kge80e8sA7woSrlnIgl57YHyyHw0IwvGdMcCMqwTrtdmF0tZc8AKMEg0hctvCcB0EBsrOdC3I61NcVaec/DuAXFhbsoF18h8oZXtX5wDVOJu2dpuvPRbfWGHC54r1ccCdZ7OYMgLIwDVwxgM+/p/OwAerlAghPcVe830PQuA7SPxpGcbmQN5AK2kZtdOStzhS9nOS/FrRbyxq9cUd0Rx67gr4wXE7KLoU8wdDRUCrIUVai0aRkxxsW8kGS+o0PraSB9WgFYV/SSoe0t530saCwXFMGlimXK3mbuq7QqRA6N1J5aa9aA+vDH68t0rojHQru1Du27kgsn2i5j0qYfFLByvRymBTBnrimfCSaCZYHq5AsSzAq6DqxXxMJfdPN3V+CwA34GXCtFkjEykwohoWBxDrndRVt/3WOC2HrdjNuWCDElPk3ZJTSh5iSYKTUd7xn8PpNOAmlrWpKudE5Aq0z1Be22VjhNMHcgzyS4WA38pG2usgTDI/9J5TAb3uissYKZlyCc4q0ArsljkPg4jaJJFZZ8mkngK2brKxcvUJMSbBWvY8vj4RW/VbL47UwCmGNQmzVAdSjGCuU0Jlpd0Ln3NYVzhGMECzuRgw8SyCwfayygJyirQW7GEYhrFKCI2n61JNkNQ34sEnC+h4UwbLy7l/Uz1wIoxBc51y7uQtNESytT4NVzxFkCZbLyGVzlIFb2SzB0ooeO1XUqn7txdBcuYADI9jwahjFGBs/lch7NA9zCitDsFUxQrDYsrjgCmXupuAzhUKwVigm8hjBxoDjD3MFOZ4eonoADivBwEqlkCOH97LnCMa9TpwHwB6Ezut9FeQJljG3gBKClYQpCUZjDVgaScx+3fOYh41gifoAcuTwX+j1CcaDeJYT8EAfui74toGEPMFGmMwECxdkD5JgnpBgVkbnGEmJ9kQ6lptQ6D1NsEz3Rutgch4GnvwSIdR3DrMTLNfgHNYlGE/FU1Nt9wryhELvOYKVdpGZbjYEDmNwaEEHp70FXFhdEGQrIU+wTIMBJV1kaUVCrE+wcUFP2kWOXERssG8Ey9R5FYJJoHLKZQPYG8ESyix+o8xCoEDCdQhWqmyzGJtqX2qJhbZ7Xvd+4zLHLJheoZ+DYAD7sqd7Hdv9xXmgLvSEKAc7EYjbISFLsOy6DPfnsSIAHBdm7oAFO9EYrLS7KiZYUHfYpmr7d73f6Hfd1sR3h/DLHiyrWDGTEGxkgdm1PlIepbKbmGDpwuy2gUxCrkhGaLmx3joEA7Aiw0Y54O4qUTdrwawQYTeB8r7mPYtx6n2M21p8N4xCdOplWy9BMVMQzMorzgfJwyv9ch5ur5NDyrqnMEow8j5wBM1332uTnBCK3UpK7Anirr08SaD4NQnGXh9waMUS13THtl6ZuuttKJwoaKuEG9H42+nwcUdeN6KFX2wH3HBtbrmeiWAA8+LYYD7Epf8e295zJkghWO+aF9KwRkKWYCScxHqSrmiqIN8k68bi9Ud6d97JQ8K6BLOKSAT90sD/UwoFEtk07+HnbMzf5huQLtrjX3NcfKAMGG9dcz5BeG7WQb4L7iqDNkPeY8sUnuxYTkZnrjdFPKRJIUEw8qXCQV/43US2aul7t1yIDTaNxumvbGpdf7BVgXWO3mYSrBnIhhbORdyl6Ppm7tinb1peC4gGSjmpx2Bl/mApsDyCSUYKQCYMjo7GCAYgK+UaBrctl4moBXo3EAmWQmrGVwLTRe0lj3WwlzLpq7iUvhTkXqPLzPhuHQRWXabgdqwpP8BKBKs4vCDLc1YczxowwYQx1lyoBNsQ8AA+Qx4eNmSemRqVYBsCd4AOlsp0axhwHG09iFfp8veKSrANgj87l8MqM8ApUAm2YYhmgc5yw0EouhJsg7HuzG9KVIJVzIpKsIpZUQlWMSsqwSpmxcYRDC8MgXWgxAHWiv3F5hGsYEO3Yv9QCVYxKyrBKmaFSDBzTCkfZF8qAO6Dodcr7H/pbyxCQSPbFOQaYvMG576uP6HPNl4kD1P1bNr3Hd24jf8Z+HuFdY7LJ78piOvI1QbvgHhDl3da9N8CpPJzgb5n8Fwo4KBc/BvaigeGL+hwumnVET8Nji+hjU79+heT8jgMEAkW7l/JQbYQriu0GPR1UBJc69P2T7GbcRyuipfPZcvVIQQpjPboyPEvrO9drEsIU1ZutdyQXXoZ3XJBHum20td4SR6J9qm3I1ftwwKRYLQbLwdyBYZGxbe8gAViIeCXcZ/HzOlNBvdrvRmbOEzCBAOXY8znGlkseNtRwPCGG4/Rk2FyXb+TOo8bUd1ziqa6kZcrlgfeCXDxHZZ1NUw2GcHg5kJyy4Y2nyKLpF7xNq7RqiIBtVXGZ+jyF0u01VzL9wsiwVLo1LebVv0dfc2Pqm+G0Y7QzouCd/30JZcRa8FkAgNQ+JqEElYdg3Gd+782R4fHvLijx7/YdOpv2ObQO3UygmG4It+BxgTPPWPccOLL+A4DiglG46M3dWN+HkYj+LBIxquShS4ccHAJlrrstx0e4WckrE2wBKH5orugC5qSYCkFkB++sWJPhtEIemnNM18Iow8cxQTr1C+0Ii42j+18JoxGWOsUn5wxcMceISw5bodRDLAkRqAS1idYfBwNYLqh0OJORjB1PYxieC9cxr/f3Fubk/tBoYhgpmuEsLX4VhjNYGFkMrSCjd12rUDjMY+LOQgmER5AMzc4wOHP1KYjmHxwGWDbciuM8lDyYh8URgnmdY2LeGDtwiielybEYAb6OYLlyWHKkZRbmodBjvA5TEcw2XICbFvyd23c0wSzXeOl5kj/uTDagyVYQRAUWkoOk4ek3NI8DA6eYOlycfkC2zJCsBXvi9hPZAnGXWP/j2ZrkO9dcMGK14ul+RALo5QclWA+ViDYTt8/uTMM/Xbfv6SUMJOfGkmC+bPGstPVrHgpwwKUkqMSzEcBwZbL5X3bw3BhZxg+MmG77+9sK6FuUyJJMNM1tuqPzRP9w2G0iMNMMJjCo+UM6laiaAlch8w2jXvHR4iScick2KDUrksul2R9P+PyhkgwO2v8V9P13/MjM+C3Ot1QFDYoXxa6TI4Q6xBsSz2nf/cnKiWKlmCXBtLdjLk0RW7reLkTEmy7798KycUkU+p4+PxkiAjmdo1t/yv32VFwQ4VFVIOcYFPkCFFGMP/jVOZDBrDF4v2eqU8OfGNhagEUPpKlvzN0OAj2YUgsJ6TrsFdEBLNd41vN1uLL7rOjAGGNCQSXMJJCn4BgcJUSKu5Dr/uiK5TiXYYSRUvgr7+pi1E3iYvBztfh5LaOlzslwYbhikAsY8FeCJ+fDDHB+BIyqDQMUuXQCpXCzW4tVPSaMLNJuPIH3XfsZnfUL09FMPgcHm+Ig1cGfMHsjP4Nvnvkr4iXKFqCfw/ZFdwjJSt5Qn8GEDawiWSHgWDb28/tDMO/Q3Lt9P0f9ncMxgQbDfLuPQklk4e+DE3CFAQDWEvqlntXLLdE0SlgWvc+MA639H1hh2YWCQBLBYN6h1xvD4Nwod6UiAgGgoGKjoaRirGznQn6hr0UKQAQh88I1s2FqUMO4KwH4y0q+1gyTxpz2s/MrAqcnS6ecdoKDpHk9QAyovbEvlol5bI8Ek6PBqyzjGw1lsvlA9uLxaPDMDwSxs0Cp17/A1xEE82hNRZcAAAAAElFTkSuQmCC";
      const logoW = 25.4; // ~723900 EMU / 914400 * 25.4mm
      const logoH = 15.0;
      doc.addImage("data:image/png;base64," + LOGO, "PNG", PW - MR - logoW, 8, logoW, logoH);

      // ── HEADER-LINIE ─────────────────────────────────────────────────
      doc.setDrawColor(BLUE);
      doc.setLineWidth(0.5);
      doc.line(ML, 26, PW - MR, 26);

      // ── TITEL-BEREICH ────────────────────────────────────────────────
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(BLUE);
      doc.text("Abrechnung", ML, 36);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      doc.text(h.esc(p.title) + (p.projektNr ? "  #" + p.projektNr : ""), ML, 43);
      doc.text(h.esc(p.firmaName), ML, 49);

      doc.setTextColor(COL);
      doc.setFontSize(9);
      doc.text("Datum: " + datumLang, PW - MR, 36, { align: "right" });

      let y = 58;

      // ── SEKTION 1: KONZEPTION ────────────────────────────────────────
      if (konzeption.length) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(BLUE);
        doc.text("Konzeption", ML, y);
        y += 3;
        doc.autoTable({
          startY: y,
          margin: { left: ML, right: MR },
          headStyles: { fillColor: [0, 64, 120], textColor: 255, fontSize: 8, fontStyle: "bold" },
          bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
          alternateRowStyles: { fillColor: [245, 248, 251] },
          columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
          head: [["Datum", "Beschreibung", "Stunden", "Betrag CHF"]],
          body: konzeption.map(k => [
            k.datumFmt, k.title || "—",
            k.aufwandStunden ? k.aufwandStunden.toFixed(1) + " h" : "—",
            h.chf(k.anzeigeBetrag)
          ]),
          foot: [["", "Total Konzeption", "", h.chf(konzTotal)]],
          footStyles: { fillColor: [0, 64, 120], textColor: 255, fontSize: 8, fontStyle: "bold", halign: "right" },
        });
        y = doc.lastAutoTable.finalY + 8;
      }

      // ── SEKTION 2: EINSÄTZE ──────────────────────────────────────────
      if (einsaetze.length) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(BLUE);
        doc.text("Eins\u00e4tze", ML, y);
        y += 3;
        doc.autoTable({
          startY: y,
          margin: { left: ML, right: MR },
          headStyles: { fillColor: [0, 64, 120], textColor: 255, fontSize: 8, fontStyle: "bold" },
          bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
          alternateRowStyles: { fillColor: [245, 248, 251] },
          columnStyles: { 4: { halign: "right" } },
          head: [["Datum", "Beschreibung", "Kategorie", "Person", "Betrag CHF"]],
          body: einsaetze.map(e => [
            e.datumFmt, e.title || "—", e.kategorie,
            e.personName + (e.coPersonName && e.coPersonName !== "—" ? "\nCo: " + e.coPersonName : ""),
            h.chf((h.num(e.betragFinal) ?? h.num(e.betragBerechnet) ?? 0) + (e.coAnzeigeBetrag || 0))
          ]),
          foot: [["", "", "", "Total Eins\u00e4tze", h.chf(einsatzTotal)]],
          footStyles: { fillColor: [0, 64, 120], textColor: 255, fontSize: 8, fontStyle: "bold", halign: "right" },
        });
        y = doc.lastAutoTable.finalY + 8;
      }

      // ── SEKTION 3: SPESEN ────────────────────────────────────────────
      if (spesenEinsaetze.length || spesenZusatzBetrag) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(BLUE);
        doc.text("Spesen", ML, y);
        y += 3;
        const spesenRows = spesenEinsaetze.map(e => [
          e.datumFmt,
          (e.title || e.kategorie) + " \u2014 " + (p.firmaName || ""),
          "Wegspesen",
          h.chf(e.spesenBerechnet)
        ]);
        if (spesenZusatzBetrag) {
          spesenRows.push([datum, spesenZusatzBem || "Zusatzspesen", "Spesen", h.chf(spesenZusatzBetrag)]);
        }
        doc.autoTable({
          startY: y,
          margin: { left: ML, right: MR },
          headStyles: { fillColor: [0, 64, 120], textColor: 255, fontSize: 8, fontStyle: "bold" },
          bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
          alternateRowStyles: { fillColor: [245, 248, 251] },
          columnStyles: { 3: { halign: "right" } },
          head: [["Datum", "Beschreibung", "Art", "Betrag CHF"]],
          body: spesenRows,
          foot: [["", "", "Total Spesen", h.chf(spesenGes)]],
          footStyles: { fillColor: [0, 64, 120], textColor: 255, fontSize: 8, fontStyle: "bold", halign: "right" },
        });
        y = doc.lastAutoTable.finalY + 8;
      }

      // ── GESAMT-TOTAL ─────────────────────────────────────────────────
      const grandTotal = einsatzTotal + spesenGes + konzTotal;
      doc.setDrawColor(BLUE);
      doc.setLineWidth(0.3);
      doc.line(ML, y, PW - MR, y);
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(BLUE);
      doc.text("Total", ML, y);
      doc.text("CHF " + h.chf(grandTotal), PW - MR, y, { align: "right" });

      // ── FOOTER (alle Seiten) ─────────────────────────────────────────
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(COL);
        doc.setLineWidth(0.3);
        doc.line(ML, PH - 18, PW - MR, PH - 18);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(COL);
        doc.text("bbz st.gallen ag  |  Zürcherstrasse 202  |  CH-9014 St.Gallen  |  +41 71 274 02 40  |  info@bankenberatung.ch  |  bankenberatungszentrum.ch", ML, PH - 13);
        doc.text("Seite " + i + " | " + pageCount, PW - MR, PH - 13, { align: "right" });
      }

      // ── DOWNLOAD ─────────────────────────────────────────────────────
      const filename = `Abrechnung_${(p.title || "Projekt").replace(/[^a-zA-Z0-9]/g,"_")}_${datum.replace(/\./g,"")}.pdf`;
      doc.save(filename);
    },

    // Analog Einsatz-Modal: gleiche Struktur, alle Choices dynamisch aus SP
    openKonzeptionForm(id, projektId = null, copyOpts = null) {
      const k          = id ? state.enriched.konzeption.find(k => k.id === id) : null;
      const prefProjId = projektId || (k?.projektLookupId || null);
      const selProjekt = prefProjId ? state.enriched.projekte.find(p => p.id === prefProjId) : null;
      const defPerson  = h.defaultPerson();
      const selPerson  = k ? k.personLookupId : (copyOpts?.personId || defPerson?.id || null);
      const selKatInit = k?.kategorie || copyOpts?.kategorie || "Konzeption";
      const personName = selPerson ? h.contactName(selPerson) : null;
      const initials   = n => n ? n.split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase() : "?";

      const projektOpts = state.enriched.projekte
        .filter(p => !p.archiviert)
        .map(p => `<option value="${p.id}" ${prefProjId === p.id ? "selected" : ""}>${h.esc(p.title)}</option>`)
        .join("");

      // Betrag-Vorschau berechnen
      const selKat   = k?.kategorie || copyOpts?.kategorie || "Konzeption";
      const ansatz   = selProjekt ? (selKat === "Admin" ? selProjekt.ansatzAdmin : selProjekt.ansatzKonzeption) : null;
      const selAufwand = k?.aufwandStunden ?? copyOpts?.aufwandStunden ?? null;
      const betragBer = (ansatz && selAufwand) ? (ansatz / 8) * selAufwand : null;

      // Kategorie-Buttons dynamisch — aus SP wenn vorhanden, sonst Fallback
      const konzKats = ["Konzeption", "Admin"];

      ui.renderModal(`<style>
        .kf-m{background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(0,64,120,.18),0 0 0 1px rgba(0,64,120,.06);width:100%;max-width:560px;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;animation:kfUp .25s cubic-bezier(.16,1,.3,1)}
        @media(min-width:700px){.kf-m{max-width:780px}}
        @keyframes kfUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
        .kf-hd{background:#004078;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
        .kf-hd-l{display:flex;align-items:center;gap:10px}
        .kf-hd-ic{width:32px;height:32px;background:rgba(255,255,255,.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px}
        .kf-hd-t{color:#fff;font-size:14px;font-weight:700}
        .kf-hd-s{color:rgba(255,255,255,.55);font-size:12px;margin-top:1px}
        .kf-hd-abr{font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.2);margin-left:8px;vertical-align:middle}
        .kf-cl{width:28px;height:28px;background:rgba(255,255,255,.1);border:none;border-radius:7px;color:rgba(255,255,255,.8);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
        .kf-cl:hover{background:rgba(255,255,255,.2)}
        .kf-bd{overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px}
        @media(min-width:700px){
          .kf-bd{display:grid;grid-template-columns:1fr 1fr;column-gap:22px;overflow:visible;align-items:start}
          .kf-col-l,.kf-col-r{display:flex;flex-direction:column;gap:14px}
        }
        .kf-s{display:flex;flex-direction:column;gap:6px}
        .kf-l{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#8896a5}
        .kf-iw input,.kf-iw select,.kf-iw textarea{width:100%;font-family:inherit;font-size:13px;font-weight:500;color:#1a2332;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;padding:8px 10px;outline:none;transition:border-color .15s,background .15s;-webkit-appearance:none}
        .kf-iw input:focus,.kf-iw select:focus,.kf-iw textarea:focus{border-color:#0a5a9e;background:#fff;box-shadow:0 0 0 3px rgba(10,90,158,.1)}
        .kf-iw input::placeholder,.kf-iw textarea::placeholder{color:#8896a5;font-weight:400}
        .kf-iw textarea{resize:none;height:60px;line-height:1.5}
        .kf-r2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .kf-proj-card{background:#e8f1f9;border:1.5px solid rgba(0,64,120,.15);border-radius:8px;padding:9px 12px;display:flex;align-items:center;justify-content:space-between}
        .kf-kg{display:flex;flex-wrap:wrap;gap:6px}
        .kf-kat-btn{flex:0 0 auto;padding:7px 13px;font-family:inherit;font-size:12px;font-weight:600;color:#4a5568;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:100px;cursor:pointer;transition:all .15s}
        .kf-kat-btn:hover{border-color:#0a5a9e;color:#0a5a9e}
        .kf-kat-btn.active{background:#004078;border-color:#004078;color:#fff}
        .kf-pp{display:inline-flex;align-items:center;gap:7px;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:100px;padding:5px 10px 5px 6px;cursor:pointer;transition:all .15s}
        .kf-pp:hover{border-color:#0a5a9e}
        .kf-av{width:24px;height:24px;background:#004078;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0}
        .kf-pn{font-size:12px;font-weight:600;color:#1a2332}
        .kf-pr-role{font-size:10px;color:#8896a5}
        .kf-pe{font-size:11px;color:#8896a5;margin-left:2px}
        .kf-ta-wrap{display:none}
        /* Stunden + Betrag */
        .kf-std-row{display:flex;align-items:center;gap:10px}
        .kf-std-row input{width:100px;padding:8px 10px;font-family:inherit;font-size:13px;font-weight:500;color:#1a2332;background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;outline:none;transition:border-color .15s}
        .kf-std-row input:focus{border-color:#0a5a9e;background:#fff;box-shadow:0 0 0 3px rgba(10,90,158,.1)}
        .kf-betrag-preview{font-size:13px;font-weight:600;color:#1a8a5e}
        .kf-betrag-box{background:#f4f7fb;border:1.5px solid #dde4ec;border-radius:8px;overflow:hidden}
        .kf-betrag-row{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;gap:8px}
        .kf-betrag-val{font-size:15px;font-weight:700;color:#1a2332}
        .kf-betrag-val.warn{font-size:12px;font-weight:500;color:#b45309}
        .kf-betrag-src{font-size:10px;color:#8896a5;margin-top:1px}
        .kf-betrag-edit{font-size:11px;color:#0a5a9e;border:1px solid #dde4ec;border-radius:6px;padding:3px 8px;background:#fff;cursor:pointer;font-family:inherit;flex-shrink:0}
        .kf-betrag-override{padding:0 12px 9px;display:none}
        .kf-betrag-override.show{display:flex;align-items:center;gap:6px}
        .kf-betrag-override input{width:110px;padding:5px 8px;font-size:12px;background:#fff;border:1.5px solid #dde4ec;border-radius:6px;color:#1a2332;font-family:inherit;outline:none}
        .kf-betrag-override input:focus{border-color:#0a5a9e}
        .kf-betrag-override .muted{font-size:11px;color:#8896a5}
        /* Verrechenbar-Pills */
        .kf-verr{display:flex;gap:6px;flex-wrap:wrap}
        .kf-verr-btn{padding:6px 13px;border-radius:100px;font-size:12px;font-weight:600;border:1.5px solid #dde4ec;background:#f4f7fb;color:#4a5568;cursor:pointer;font-family:inherit;transition:all .15s}
        .kf-verr-btn:hover{border-color:#0a5a9e}
        .kf-verr-btn.on{background:#004078;border-color:#004078;color:#fff}
        .kf-dv{height:1px;background:#dde4ec}
        .kf-ft{padding:11px 20px 14px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #dde4ec;flex-shrink:0;gap:10px}
        .kf-abr-info{font-size:11px;color:#8896a5;display:flex;align-items:center;gap:5px}
        .kf-btn-c{padding:8px 18px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;background:none;border:1.5px solid #dde4ec;color:#4a5568;cursor:pointer}
        .kf-btn-c:hover{border-color:#4a5568}
        .kf-btn-s{padding:8px 22px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:700;background:#004078;border:none;color:#fff;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 2px 10px rgba(0,64,120,.25)}
        .kf-btn-s:hover{background:#0a5a9e}
      </style>
      <div class="kf-m">
        <div class="kf-hd">
          <div class="kf-hd-l">
            <div class="kf-hd-ic">📝</div>
            <div>
              <div class="kf-hd-t">
                ${id ? "Aufwand bearbeiten" : "Konzeptionsaufwand erfassen"}
                ${id && k?.abrechnung ? `<span class="kf-hd-abr">${h.esc(k.abrechnung)}</span>` : ""}
              </div>
              <div class="kf-hd-s">${selProjekt ? h.esc(selProjekt.title) + (selProjekt.firmaName ? " · " + h.esc(selProjekt.firmaName) : "") : "Projekt wählen"}</div>
            </div>
          </div>
          <button type="button" class="kf-cl" data-close-modal>✕</button>
        </div>

        <form id="konzeption-form" autocomplete="off" class="kf-bd">
            <input type="hidden" name="itemId" value="${id || ""}">
            <input type="hidden" name="mode" value="${id ? "edit" : "create"}">
            <input type="hidden" id="kf-kat-hid" name="kategorie" value="${h.esc(k?.kategorie || copyOpts?.kategorie || selKatInit)}">
            <input type="hidden" id="kf-verr-hid" name="verrechenbar" value="${h.esc(k?.verrechenbar || copyOpts?.verrechenbar || "")}">
            <input type="hidden" id="kf-abr-hid" name="abrechnung" value="${h.esc(k?.abrechnung || "offen")}">

            <!-- LINKE SPALTE -->
            <div class="kf-col-l">

              <!-- Datum -->
              <div class="kf-s">
                <div class="kf-l">Datum</div>
                <div class="kf-iw"><input type="date" name="datum" value="${h.esc(k ? h.toDateInput(k.datum) : (copyOpts?.datum || ""))}" required></div>
              </div>

              <!-- Projekt -->
              <div class="kf-s">
                <div class="kf-l">Projekt</div>
                ${selProjekt ? `
                <div class="kf-proj-card">
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:7px;height:7px;background:#004078;border-radius:50%;flex-shrink:0"></div>
                    <div>
                      <div style="font-size:13px;font-weight:600;color:#004078">${h.esc(selProjekt.title)}</div>
                      <div style="font-size:11px;color:#8896a5">${selProjekt.projektNr ? "#" + h.esc(selProjekt.projektNr) + " · " : ""}${h.esc(selProjekt.firmaName)}</div>
                    </div>
                  </div>
                  <span style="font-size:11px;color:#0a5a9e;font-weight:600;text-decoration:underline;cursor:pointer"
                    onclick="this.closest('.kf-proj-card').style.display='none';document.getElementById('kf-proj-sel').style.display='block'">ändern</span>
                </div>
                <div class="kf-iw" id="kf-proj-sel" style="display:none">
                  <select name="projektLookupId" onchange="ctrl.kfOnProjChange(this)">
                    ${projektOpts}
                  </select>
                </div>` : `
                <div class="kf-iw">
                  <select name="projektLookupId" required onchange="ctrl.kfOnProjChange(this)">
                    <option value="">— Projekt wählen —</option>
                    ${projektOpts}
                  </select>
                </div>`}
              </div>

              <!-- Beschreibung -->
              <div class="kf-s">
                <div class="kf-l">Beschreibung <span style="font-size:10px;color:#dde4ec">*</span></div>
                <div class="kf-iw"><input type="text" name="titel" value="${h.esc(k?.title || copyOpts?.titel || "")}" placeholder="z.B. Vorbereitung Modul 3, Call mit Kunde…" required></div>
              </div>

              <!-- Kategorie -->
              <div class="kf-s">
                <div class="kf-l">Kategorie</div>
                <div class="kf-kg">
                  ${konzKats.map(kat => `<button type="button" class="kf-kat-btn${selKat === kat ? " active" : ""}"
                    onclick="document.querySelectorAll('.kf-kat-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');document.getElementById('kf-kat-hid').value='${h.esc(kat)}';ctrl.kfUpdateBetrag()">${h.esc(kat)}</button>`).join("")}
                </div>
              </div>

              <!-- Person -->
              <div class="kf-s">
                <div class="kf-l">Person</div>
                <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
                  <div class="kf-pp" onclick="ctrl.kfOpenPicker()" id="kf-person-pill">
                    <div class="kf-av" id="kf-person-av">${personName ? h.esc(initials(personName)) : "?"}</div>
                    <div>
                      <div class="kf-pn" id="kf-person-name">${personName ? h.esc(personName) : "Person wählen"}</div>
                      <div class="kf-pr-role">Trainer</div>
                    </div>
                    <span class="kf-pe">✎</span>
                  </div>
                  <div class="kf-ta-wrap" id="kf-person-ta">
                    ${ui.personTypeahead("personLookupId", selPerson ? String(selPerson) : "")}
                  </div>
                </div>
              </div>

            </div><!-- /kf-col-l -->

            <!-- RECHTE SPALTE -->
            <div class="kf-col-r">

              <!-- Aufwand + Betrag-Vorschau -->
              <div class="kf-s">
                <div class="kf-l">Aufwand</div>
                <div class="kf-std-row">
                  <input type="number" name="aufwandStunden" id="kf-std-inp"
                    min="0.25" step="0.25" value="${k?.aufwandStunden || copyOpts?.aufwandStunden || ""}"
                    placeholder="Stunden" required oninput="ctrl.kfUpdateBetrag()">
                  <span style="font-size:12px;color:#8896a5">Stunden</span>
                  <span class="kf-betrag-preview" id="kf-betrag-preview">${betragBer !== null ? "= CHF " + h.chf(betragBer) : ""}</span>
                </div>
              </div>

              <!-- Betrag -->
              <div class="kf-s">
                <div class="kf-l">Betrag</div>
                <div class="kf-betrag-box">
                  <div class="kf-betrag-row">
                    <div>
                      <div class="kf-betrag-val${betragBer === null ? " warn" : ""}" id="kf-bval">
                        ${betragBer !== null ? "CHF " + h.chf(betragBer) : (selProjekt ? "Kein Ansatz konfiguriert" : "Projekt wählen")}
                      </div>
                      <div class="kf-betrag-src">berechnet (Ansatz ÷ 8 × Stunden)</div>
                    </div>
                    <button type="button" class="kf-betrag-edit"
                      id="kf-anpassen-btn"
                      style="${betragBer !== null ? "" : "display:none"}"
                      onclick="ctrl.kfToggleOverride()">Anpassen</button>
                  </div>
                  <div class="kf-betrag-override${k?.betragFinal ? " show" : ""}" id="kf-ov">
                    <span style="font-size:11px;color:#8896a5">CHF</span>
                    <input type="number" name="betragFinal" step="0.01" value="${k?.betragFinal ?? ""}" placeholder="Betrag">
                    <span class="muted">leer = berechnet</span>
                  </div>
                </div>
              </div>

              <div class="kf-dv"></div>

              <!-- Verrechenbar — dynamisch aus SP -->
              <div class="kf-s">
                <div class="kf-l">Verrechenbar</div>
                <div class="kf-verr">
                  ${state.choices.konzVerrechenbar.length
                    ? state.choices.konzVerrechenbar.map(v => `<button type="button"
                        class="kf-verr-btn${(k?.verrechenbar || copyOpts?.verrechenbar || "") === v ? " on" : ""}"
                        onclick="document.querySelectorAll('.kf-verr-btn').forEach(b=>b.classList.remove('on'));this.classList.add('on');document.getElementById('kf-verr-hid').value='${h.esc(v)}'"
                        >${h.esc(v)}</button>`).join("")
                    : `<span style="font-size:12px;color:#950e13">⚠ Choices werden geladen…</span>`}
                </div>
              </div>

              <div class="kf-dv"></div>

              <!-- Bemerkungen -->
              <div class="kf-s">
                <div class="kf-l">Bemerkungen</div>
                <div class="kf-iw"><textarea name="bemerkungen" placeholder="Interne Notizen…">${h.esc(k?.bemerkungen || copyOpts?.bemerkungen || "")}</textarea></div>
              </div>

            </div><!-- /kf-col-r -->

          </form><!-- /kf-bd -->

        <div class="kf-ft">
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
            ${id && k?.abrechnung ? `<div class="kf-abr-info"><span style="width:6px;height:6px;border-radius:50%;background:#8896a5;display:inline-block"></span>Abrechnung: ${h.esc(k.abrechnung)}</div>` : ""}
            ${id && k?.abrechnung === "abgerechnet" && !k?.abrechnungLookupId ? `
              <button type="button" style="
                font-family:inherit;font-size:11px;font-weight:600;
                padding:4px 10px;border-radius:6px;cursor:pointer;
                background:#fff3cd;border:1.5px solid #e59c2e;color:#7a5000;
                display:flex;align-items:center;gap:5px;
              " onclick="ctrl.resetKonzeptionAbrechnung(${id})" title="Nur verwenden wenn die verknüpfte Abrechnung direkt in SharePoint gelöscht wurde — nicht über die App.">
                ⚠ Abrechnung zurücksetzen
              </button>` : ""}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${id ? `
              <button type="button" class="tm-btn tm-btn-sm" onclick="ctrl.copyKonzeption(${id})" title="Duplizieren">⧉ Duplizieren</button>
              <button type="button" class="tm-btn tm-btn-sm" data-action="delete-konzeption" data-id="${id}" style="color:var(--tm-red)" title="Löschen">🗑 Löschen</button>
            ` : ""}
            <span style="flex:1"></span>
            <button type="button" class="kf-btn-c" data-close-modal>Abbrechen</button>
            <button type="button" class="kf-btn-s" onclick="document.getElementById('konzeption-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))">
              <span>✓</span> Speichern
            </button>
          </div>
        </div>
      </div>`);
    },

    // ── Konzeption-Formular Helfer ────────────────────────────────────────
    kfOpenPicker() {
      const ta   = document.getElementById("kf-person-ta");
      const pill = document.getElementById("kf-person-pill");
      if (!ta || !pill) return;
      pill.style.display = "none";
      ta.style.display = "block";
      ta.querySelector(".tm-typeahead-input")?.focus();
    },

    kfToggleOverride() {
      const el = document.getElementById("kf-ov");
      if (!el) return;
      const vis = el.classList.toggle("show");
      if (vis) el.querySelector("input")?.focus();
    },

    kfOnProjChange(sel) {
      // Betrag-Vorschau nach Projekt-Wechsel aktualisieren
      ctrl.kfUpdateBetrag();
    },

    kfUpdateBetrag() {
      const projId = Number(document.querySelector("[name='projektLookupId']")?.value) || null;
      const proj   = projId ? state.enriched.projekte.find(p => p.id === projId) : null;
      const kat    = document.getElementById("kf-kat-hid")?.value || "Konzeption";
      const std    = h.num(document.getElementById("kf-std-inp")?.value);
      const ansatz = proj ? (kat === "Admin" ? proj.ansatzAdmin : proj.ansatzKonzeption) : null;
      const betrag = (ansatz && std) ? (ansatz / 8) * std : null;

      const bval    = document.getElementById("kf-bval");
      const preview = document.getElementById("kf-betrag-preview");
      const anpBtn  = document.getElementById("kf-anpassen-btn");

      if (bval) {
        if (betrag !== null) { bval.textContent = "CHF " + h.chf(betrag); bval.className = "kf-betrag-val"; }
        else if (proj)       { bval.textContent = "Kein Ansatz konfiguriert"; bval.className = "kf-betrag-val warn"; }
        else                 { bval.textContent = "Projekt w\u00e4hlen"; bval.className = "kf-betrag-val warn"; }
      }
      if (preview) preview.textContent = betrag !== null ? "= CHF " + h.chf(betrag) : "";
      if (anpBtn)  anpBtn.style.display = betrag !== null ? "" : "none";
    },

    async saveKonzeption(fd) {
      ui.setMsg("Wird gespeichert…", "info");
      try {
        const mode   = fd.get("mode");
        const itemId = fd.get("itemId");
        const datum  = fd.get("datum");
        const kat    = fd.get("kategorie");
        const projId = Number(fd.get("projektLookupId")) || null;
        const titel  = (fd.get("titel") || "").trim();
        const std    = h.num(fd.get("aufwandStunden"));

        debug.log("saveKonzeption:formData", { datum, kat, projId, titel, std, mode });

        if (!datum) {
          document.querySelector("[name='datum']")?.focus();
          throw new Error("Bitte Datum auswählen.");
        }
        if (!projId) throw new Error("Bitte Projekt wählen.");
        if (!titel)  throw new Error("Beschreibung ist Pflichtfeld.");
        if (!kat)    throw new Error("Bitte Kategorie wählen.");
        if (!std)    throw new Error("Aufwand Stunden ist Pflichtfeld.");
        const verrVal = fd.get("verrechenbar") || "";
        if (!verrVal) throw new Error("Bitte Verrechenbar-Status wählen.");

        const p = state.enriched.projekte.find(p => p.id === projId);
        const ansatz = kat === "Admin" ? p?.ansatzAdmin : p?.ansatzKonzeption;
        const betragBer = (ansatz && std) ? (ansatz / 8) * std : null;

        // Lookup-Felder via SP REST API
        const lookupFields = { [F.konz_projekt_w]: projId };
        const personId = h.num(fd.get("personLookupId"));
        if (personId) lookupFields[F.konz_person_w] = personId;

        const neuerVerrWert = fd.get("verrechenbar") || "";
        const alteKonz      = mode === "edit" && itemId
          ? state.enriched.konzeption.find(k => k.id === Number(itemId))
          : null;

        // Wenn Verrechenbar auf Klärung nötig oder Inklusive wechselt:
        // Abrechnung auf offen zurücksetzen, Lookup wird nach dem Patch geleert
        const verrWechselZuNichtVerr = alteKonz &&
          alteKonz.verrechenbar === "verrechenbar" &&
          neuerVerrWert !== "verrechenbar";

        const fields = {
          Kategorie:      kat,
          AufwandStunden: std,
          Verrechenbar:   neuerVerrWert,
          Abrechnung:     verrWechselZuNichtVerr ? "offen" : (fd.get("abrechnung") || "offen")
        };
        if (betragBer !== null) fields.BetragBerechnet = betragBer;
        const bf = h.num(fd.get("betragFinal"));
        if (bf !== null) fields.BetragFinal = bf;
        const bem = (fd.get("bemerkungen") || "").trim();
        if (bem) fields.Bemerkungen = bem;

        if (mode === "edit" && itemId) {
          const eid = Number(itemId);
          fields.Title = titel;
          fields.Datum = datum + "T12:00:00Z";
          await api.patch(CONFIG.lists.konzeption, eid, fields);
          await api.patchLookups(CONFIG.lists.konzeption, eid, lookupFields);
          // Abrechnung-Lookup leeren wenn Verrechenbar-Wechsel
          if (verrWechselZuNichtVerr) {
            await api.patchLookups(CONFIG.lists.konzeption, eid, { [F.konz_abrechnung_w]: 0 });
          }
        } else {
          const cr  = await api.post(CONFIG.lists.konzeption, titel);
          const nid = Number(cr?.id || cr?.fields?.id);
          if (!nid) throw new Error("Neue ID fehlt.");
          fields.Datum = datum + "T12:00:00Z";
          await api.patch(CONFIG.lists.konzeption, nid, fields);
          await api.patchLookups(CONFIG.lists.konzeption, nid, lookupFields);
        }

        ui.closeModal();
        ui.setMsg("Aufwand gespeichert.", "success");
        await api.loadAll();
        ctrl.render();
      } catch (e) {
        debug.err("saveKonzeption", e);
        ui.setMsg(e.message || "Fehler.", "error");
      }
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // BOOT
  // ════════════════════════════════════════════════════════════════════════
  async function boot() {
    try {
      const msalLib = window.msalBrowser || window.msal;
      if (!msalLib?.PublicClientApplication) throw new Error("MSAL nicht geladen.");

      state.auth.msal = new msalLib.PublicClientApplication({
        auth: {
          clientId:    CONFIG.graph.clientId,
          authority:   CONFIG.graph.authority,
          redirectUri: CONFIG.graph.redirectUri
        },
        cache: { cacheLocation: "localStorage", storeAuthStateInCookie: true }
      });
      await state.auth.msal.initialize();
      await state.auth.msal.handleRedirectPromise();

      const accounts = state.auth.msal.getAllAccounts();
      if (accounts.length) state.auth.account = accounts[0];
      state.auth.isAuth = !!state.auth.account;

      ui.init();

      if (state.auth.isAuth) {
        ui.setAuth(state.auth.account.name || state.auth.account.username);
        await api.loadAll();
        ctrl.navigate("projekte");
      } else {
        ui.render(`
          <div class="tm-loading-screen" style="flex-direction:column;gap:16px">
            <div style="font-size:40px">📋</div>
            <div style="font-size:18px;font-weight:600;color:var(--tm-blue)">TM-App · bbz st.gallen</div>
            <p style="color:var(--tm-text-muted)">Termin- & Einsatzplanung für Tailormade Projekte</p>
            <button class="tm-btn tm-btn-primary" onclick="ctrl.login()">Mit Microsoft anmelden</button>
          </div>`);
        if (ui.els.login) ui.els.login.style.display = "";
      }
    } catch (e) {
      debug.err("boot", e);
      document.getElementById("view-root").innerHTML =
        `<div class="tm-loading-screen"><div style="color:var(--tm-red)">⚠ Fehler beim Start: ${h.esc(e.message)}</div></div>`;
    }
  }

  // Globale Referenzen
  window.ctrl  = ctrl;
  window.state = state;
  window.h     = h;
  window.debug = debug;
  window.ui    = ui;

  document.addEventListener("DOMContentLoaded", boot);
})();
