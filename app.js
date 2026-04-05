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
      projekte:   "ProjekteTM",
      einsaetze:  "EinsaetzeTM",
      konzeption: "KonzeptionTM",
      firms:      "CRMFirms",
      contacts:   "CRMContacts"
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
    konz_person_w:     "PersonLookupId"
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
      projekte:   [],   // raw SP items
      einsaetze:  [],
      konzeption: [],
      firms:      [],   // [{id, title}]
      contacts:   []    // [{id, nachname, vorname, firmaLookupId}]
    },
    choices: {
      // Dynamisch aus SP geladen via getChoices() — nie hier hardcodieren.
      // Leere Arrays bis loadChoices() gelaufen ist.
      projektStatus:      [],
      einsatzAbrechnung:  [],
      einsatzStatus:      [],
      konzVerrechenbar:   [],
      konzAbrechnung:     []
    },
    enriched: {
      projekte:   [],
      einsaetze:  [],
      konzeption: []
    },
    filters: {
      route:      "projekte",
      projekte:   { search: "", status: "" },
      einsaetze:  { search: "", abrechnung: "", einsatzStatus: "" },
      konzeption: { search: "", verrechenbar: "" },
      activeTab:  {}
    },
    selection: { projektId: null },
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
        <input type="text" class="tm-ta-input" placeholder="${h.esc(placeholder)}"
          value="${h.esc(sel?.label||"")}" autocomplete="off"
          oninput="h.taFilter(this)" onfocus="h.taOpen(this)"
          onblur="setTimeout(()=>h.taClose(this),200)">
        <div class="tm-ta-dd" style="display:none">
          ${items.map(i=>`<div class="tm-ta-item" data-id="${h.esc(i.id)}"
            onmousedown="event.preventDefault();h.taSelect(this)">${h.esc(i.label)}</div>`).join("")}
        </div>
      </div>`;
    },
    taOpen(inp) { h.taFilter(inp); inp.closest(".tm-typeahead").querySelector(".tm-ta-dd").style.display="block"; },
    taClose(inp) {
      const w = inp.closest(".tm-typeahead");
      w.querySelector(".tm-ta-dd").style.display="none";
      if (!w.querySelector(".tm-ta-val").value) inp.value="";
    },
    taFilter(inp) {
      const dd = inp.closest(".tm-typeahead").querySelector(".tm-ta-dd");
      const q = inp.value.toLowerCase(); let vis = 0;
      dd.querySelectorAll(".tm-ta-item").forEach(it => {
        const m = it.textContent.toLowerCase().includes(q);
        it.style.display = m ? "block" : "none";
        if (m) vis++;
      });
      dd.style.display = vis ? "block" : "none";
    },
    taSelect(item) {
      const w = item.closest(".tm-typeahead");
      w.querySelector(".tm-ta-val").value   = item.dataset.id;
      w.querySelector(".tm-ta-input").value = item.textContent.trim();
      w.querySelector(".tm-ta-dd").style.display = "none";
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
        "abgerechnet":    ["tm-badge tm-badge-billed", "abgerechnet"]
      };
      const [c,l] = m[v] || ["tm-badge", v||"—"];
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
        case "Einsatz (Tag)":    return p.ansatzEinsatz || null;
        case "Einsatz (Halbtag)": return p.ansatzHalbtag || null;
        case "Stunde":           return (p.ansatzStunde || 0) * (std || 0) || null;
        case "Stück":            return (p.ansatzStueck || 0) * (stk || 0) || null;
        case "Pauschale":        return p.ansatzPauschale || null;
        default: return null;
      }
    },

    // Co-Betrag aus Projektsettings
    berechneCoBetrag(p, kat) {
      if (!p) return null;
      if (kat === "Einsatz (Tag)")     return p.ansatzCoEinsatz || null;
      if (kat === "Einsatz (Halbtag)") return p.ansatzCoHalbtag || null;
      return null;
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
      konzeptionsrahmenTage:   h.num(raw.KonzeptionsrahmenTage)
    };
    p.firmaName       = h.firmName(p.firmaLookupId);
    p.ansprechpartner = h.contactName(p.ansprechpartnerLookupId);
    p.einsaetze       = state.data.einsaetze.filter(e => h.rdLookup(e, F.projekt_r) === p.id);
    p.konzeintraege   = state.data.konzeption.filter(k => h.rdLookup(k, F.konz_projekt_r) === p.id);
    // Einsätze: abgesagt ❌, abgesagt mit Kostenfolge ✅
    p.totalEinsaetze  = p.einsaetze
      .filter(e => { const s = h.einsatzStatus(e); return s !== "abgesagt"; })  // berechnet, nicht raw
      .reduce((s,e) => {
        const lead = h.num(e.BetragFinal) ?? h.num(e.BetragBerechnet) ?? 0;
        const co   = h.num(e.CoBetragFinal) ?? h.num(e.CoBetragBerechnet) ?? 0;
        return s + lead + co;
      }, 0);
    // Konzeption: nur "zur Abrechnung" und "abgerechnet"
    p.totalKonzeption = p.konzeintraege
      .filter(k => ["zur Abrechnung","abgerechnet"].includes(k.Verrechenbar))  // explizit, nicht positionsabhängig
      .reduce((s,k) => s + (h.num(k.BetragFinal) ?? h.num(k.BetragBerechnet) ?? 0), 0);
    p.totalBetrag     = p.totalEinsaetze + p.totalKonzeption;
    p.einsaetzeCount  = p.einsaetze.length;
    p.konzStunden     = p.konzeintraege.reduce((s,k) => s + (h.num(k.AufwandStunden) || 0), 0);
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
      abrechnung:      raw.Abrechnung || "offen"
    };
    e.datumFmt      = h.fmtDate(e.datum);
    e.einsatzStatus = h.einsatzStatus(e);
    e.anzeigeBetrag = h.num(e.betragFinal) ?? h.num(e.betragBerechnet);
    e.projektTitle  = state.data.projekte.find(p => Number(p.id) === e.projektLookupId)?.Title || "";
    e.personName    = h.contactName(e.personLookupId);
    e.coPersonName  = h.contactName(e.coPersonLookupId);
    e.coAnzeigeBetrag = h.num(e.coBetragFinal) ?? h.num(e.coBetragBerechnet);
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
      bemerkungen:     raw.Bemerkungen || ""
    };
    k.datumFmt      = h.fmtDate(k.datum);
    k.anzeigeBetrag = h.num(k.betragFinal) ?? h.num(k.betragBerechnet);
    k.personName    = h.contactName(k.personLookupId);
    k.projektTitle  = state.data.projekte.find(p => Number(p.id) === k.projektLookupId)?.Title || "";
    return k;
  }

  function enrichAll() {
    state.enriched.projekte   = state.data.projekte.map(enrichProjekt);
    state.enriched.einsaetze  = state.data.einsaetze.map(enrichEinsatz);
    state.enriched.konzeption = state.data.konzeption.map(enrichKonzeption);
    debug.log("enrichAll", {
      projekte: state.enriched.projekte.map(p => ({ id: p.id, firma: p.firmaName, ap: p.ansprechpartner })),
      einsaetze: state.enriched.einsaetze.length,
      konzeption: state.enriched.konzeption.length
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
        const r = await state.auth.msal.acquireTokenPopup({ scopes: CONFIG.graph.scopes });
        return (state.auth.token = r.accessToken);
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
        const [projSt, einsAbrech, einsSt, konzVerr, konzAbrech] = await Promise.all([
          api.getChoices(CONFIG.lists.projekte,   "Status"),
          api.getChoices(CONFIG.lists.einsaetze,  "Abrechnung"),
          api.getChoices(CONFIG.lists.einsaetze,  "Status"),
          api.getChoices(CONFIG.lists.konzeption, "Verrechenbar"),
          api.getChoices(CONFIG.lists.konzeption, "Abrechnung")
        ]);
        if (projSt.length)     state.choices.projektStatus    = projSt;
        if (einsAbrech.length) state.choices.einsatzAbrechnung = einsAbrech;
        if (einsSt.length)     state.choices.einsatzStatus    = einsSt;
        if (konzVerr.length)   state.choices.konzVerrechenbar = konzVerr;
        if (konzAbrech.length) state.choices.konzAbrechnung   = konzAbrech;
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
        const r = await state.auth.msal.acquireTokenPopup({
          scopes: ["https://bbzsg.sharepoint.com/AllSites.Write"]
        });
        return r.accessToken;
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
        // Choices einmalig laden (parallel zu Daten)
        const [projekte, einsaetze, konzeption, firms, contacts] = await Promise.all([
          api.getItems(CONFIG.lists.projekte),
          api.getItems(CONFIG.lists.einsaetze),
          api.getItems(CONFIG.lists.konzeption),
          api.getItems(CONFIG.lists.firms),
          api.getItems(CONFIG.lists.contacts)
        ]);
        await api.loadChoices();
        state.data.projekte   = projekte;
        state.data.einsaetze  = einsaetze;
        state.data.konzeption = konzeption;
        state.data.firms      = firms.map(f => ({ id: Number(f.id), title: f.Title || "" }));
        state.data.contacts   = contacts.map(c => ({
          id:            Number(c.id),
          nachname:      c.Title || "",
          vorname:       c.Vorname || "",
          firmaLookupId: Number(c.FirmaLookupIdLookupId || c.FirmaLookupId || 0) || null
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

      // Form-Submit Delegation
      document.addEventListener("submit", e => {
        if (e.target.id === "projekt-form")    { e.preventDefault(); ctrl.saveProjekt(new FormData(e.target)); }
        if (e.target.id === "einsatz-form")    { e.preventDefault(); ctrl.saveEinsatz(new FormData(e.target)); }
        if (e.target.id === "konzeption-form") { e.preventDefault(); ctrl.saveKonzeption(new FormData(e.target)); }
      });

      // Click Delegation
      document.addEventListener("click", e => {
        const a = sel => e.target.closest(sel);
        if (a("[data-action='open-projekt']"))     { ctrl.openProjekt(+a("[data-action='open-projekt']").dataset.id); return; }
        if (a("[data-action='back-to-projekte']")) { ctrl.navigate("projekte"); return; }
        if (a("[data-action='new-einsatz']"))      { ctrl.openEinsatzForm(null, +a("[data-action='new-einsatz']").dataset.projektId || null); return; }
        if (a("[data-action='new-konzeption']"))   { ctrl.openKonzeptionForm(null, +a("[data-action='new-konzeption']").dataset.projektId || null); return; }
        if (a("[data-action='edit-einsatz']"))     { ctrl.openEinsatzForm(+a("[data-action='edit-einsatz']").dataset.id); return; }
        if (a("[data-action='edit-konzeption']"))  { ctrl.openKonzeptionForm(+a("[data-action='edit-konzeption']").dataset.id); return; }
        if (a("[data-action='copy-einsatz']"))     { ctrl.copyEinsatz(+a("[data-action='copy-einsatz']").dataset.id); return; }
        if (a("[data-action='delete-einsatz']"))  { ctrl.deleteEinsatz(+a("[data-action='delete-einsatz']").dataset.id); return; }
        if (a("[data-action='new-projekt']"))      { ctrl.openProjektForm(null); return; }
        if (a("[data-action='edit-projekt']"))     { ctrl.openProjektForm(+a("[data-action='edit-projekt']").dataset.id); return; }
        if (a("[data-close-modal]"))               { ctrl.closeModal(); return; }
        if (a(".tm-tab[data-tab]"))                { const t = a(".tm-tab[data-tab]"); ctrl.setTab(t.dataset.route, t.dataset.tab); return; }
        if (a(".tm-modal-backdrop") && !a(".tm-modal") && !a(".ef-m")) { ctrl.closeModal(); return; }
      });
    },

    setNav(route) { this.els.navBtns.forEach(b => b.classList.toggle("active", b.dataset.route === route)); },
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
      const f = state.filters.projekte;
      let list = state.enriched.projekte.filter(p => !p.archiviert);
      if (f.search) list = list.filter(p => h.inc(p.title, f.search) || h.inc(p.firmaName, f.search));
      if (f.status) list = list.filter(p => p.status === f.status);

      ui.render(`
        <div class="tm-page-header">
          <div>
            <div class="tm-page-title">Projekte</div>
            <div class="tm-page-meta">${list.length} aktive Projekte</div>
          </div>
          <div class="tm-page-actions">
            <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-projekt">+ Projekt</button>
          </div>
        </div>
        <div class="tm-filter-bar">
          <input type="search" placeholder="Suche Projekt oder Firma…" value="${h.esc(f.search)}"
            oninput="state.filters.projekte.search=this.value;ctrl.render()">
          <select onchange="state.filters.projekte.status=this.value;ctrl.render()">
            <option value="">Alle Status</option>
            ${state.choices.projektStatus.map(s => `<option value="${s}" ${f.status===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${list.length ? `<div class="tm-proj-grid">${list.map(p => {
          const pct = p.konzBudgetH ? Math.round(p.konzStunden / p.konzBudgetH * 100) : null;
          return `<div class="tm-proj-card" data-action="open-projekt" data-id="${p.id}">
            <div class="tm-proj-name">${h.esc(p.title)}</div>
            <div class="tm-proj-firm">${h.esc(p.firmaName)}${p.projektNr ? ` · #${h.esc(p.projektNr)}` : ""} · ${h.projStatusBadge(p.status)}</div>
            <div class="tm-proj-stats">
              <div class="tm-proj-stat"><strong class="tm-chf">CHF ${h.chf(p.totalBetrag)}</strong>Umsatz</div>
              <div class="tm-proj-stat"><strong>${p.einsaetzeCount}</strong>Einsätze</div>
              ${p.konzBudgetH ? `<div class="tm-proj-stat"><strong>${p.konzStunden.toFixed(1)} h</strong>Konzeption</div>` : ""}
            </div>
            ${pct !== null ? `<div class="tm-budget-bar" style="margin-top:8px">
              <div class="tm-budget-fill ${pct>=100?"over":pct>=80?"warn":""}" style="width:${Math.min(pct,100)}%"></div>
            </div><div style="font-size:11px;color:var(--tm-text-muted);margin-top:3px">${p.konzStunden.toFixed(1)} / ${p.konzBudgetH} h</div>` : ""}
          </div>`;
        }).join("")}</div>` : ui.empty("Keine Projekte gefunden.")}
      `);
    },

    projektDetail(id) {
      const p = state.enriched.projekte.find(p => p.id === id);
      if (!p) { ui.render(`<p class="tm-muted">Projekt nicht gefunden (ID: ${id}).</p>`); return; }

      const tab = state.filters.activeTab["projekt-detail"] || "einsaetze";
      const pct = p.konzBudgetH ? Math.round(p.konzStunden / p.konzBudgetH * 100) : null;

      const tabEinsaetze = () => {
        const list = p.einsaetze.map(enrichEinsatz).sort((a,b) => h.toDate(b.datum) - h.toDate(a.datum));
        if (!list.length) return ui.empty("Noch keine Einsätze erfasst.");
        return `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung</th><th>Kategorie</th><th>Lead / Co-Lead</th><th>Betrag</th><th>Status</th><th>Abrechnung</th><th></th></tr></thead>
          <tbody>${list.map(e => `<tr class="${["abgesagt","abgesagt-chf"].includes(e.einsatzStatus)?"cancelled":""}">
            <td class="tm-nowrap">${h.esc(e.datumFmt)}</td>
            <td style="font-weight:500">${h.esc(e.title)}</td>
            <td class="tm-muted">${h.esc(e.kategorie)}</td>
            <td class="tm-muted">${h.esc(e.personName)}${e.coPersonName && e.coPersonName !== "—" ? `<div style="font-size:11px;color:var(--tm-text-muted)">Co: ${h.esc(e.coPersonName)}</div>` : ""}</td>
            <td class="tm-right tm-chf">${e.anzeigeBetrag !== null ? h.chf(e.anzeigeBetrag) : "—"}${e.coAnzeigeBetrag !== null && e.coAnzeigeBetrag !== undefined ? `<div style="font-size:11px;color:var(--tm-text-muted)">Co: ${h.chf(e.coAnzeigeBetrag)}</div>` : ""}</td>
            <td>${h.statusBadge(e)}</td>
            <td>${h.abrBadge(e.abrechnung)}</td>
            <td><div class="tm-actions">
              <button class="tm-btn tm-btn-sm" data-action="edit-einsatz" data-id="${e.id}">✎</button>
              <button class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${e.id}" title="Duplizieren">⧉</button>
              <button class="tm-btn tm-btn-sm" data-action="delete-einsatz" data-id="${e.id}" title="Löschen" style="color:var(--tm-red)">🗑</button>
            </div></td>
          </tr>`).join("")}</tbody></table></div>`;
      };

      const tabKonzeption = () => {
        const list = p.konzeintraege.map(enrichKonzeption).sort((a,b) => h.toDate(b.datum) - h.toDate(a.datum));
        if (!list.length) return ui.empty("Noch keine Konzeptionsaufwände erfasst.");
        return `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung</th><th>Kategorie</th><th>Person</th><th>Stunden</th><th>Betrag</th><th>Verrechenbar</th><th></th></tr></thead>
          <tbody>${list.map(k => `<tr>
            <td class="tm-nowrap">${h.esc(k.datumFmt)}</td>
            <td style="font-weight:500">${h.esc(k.title)}</td>
            <td class="tm-muted">${h.esc(k.kategorie)}</td>
            <td class="tm-muted">${h.esc(k.personName)}</td>
            <td class="tm-right">${k.aufwandStunden !== null ? k.aufwandStunden.toFixed(1) : "—"}</td>
            <td class="tm-right tm-chf">${k.anzeigeBetrag !== null ? h.chf(k.anzeigeBetrag) : "—"}</td>
            <td>${h.verrBadge(k.verrechenbar)}</td>
            <td><div class="tm-actions"><button class="tm-btn tm-btn-sm" data-action="edit-konzeption" data-id="${k.id}">✎</button></div></td>
          </tr>`).join("")}</tbody></table></div>`;
      };

      const tabStammdaten = () => `
        <div class="tm-form-wrap" style="max-width:100%">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--tm-text-muted);margin-bottom:8px">Stammdaten</div>
              ${[["Projekt-Nr.",p.projektNr||"—"],["Firma",p.firmaName],["Ansprechpartner",p.ansprechpartner],["Status",p.status],["Km zum Kunden",p.kmZumKunden!==null?`${p.kmZumKunden} km`:"—"],["Konzeptionsrahmen",p.konzBudgetH?`${p.konzeptionsrahmenTage} Tage (${p.konzBudgetH} h)`:"—"]]
                .map(([l,v]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--tm-blue-pale)"><span style="color:var(--tm-text-muted)">${l}</span><span style="font-weight:500">${h.esc(String(v))}</span></div>`).join("")}
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--tm-text-muted);margin-bottom:8px">Ansätze CHF</div>
              ${[["Einsatz (Tag)",p.ansatzEinsatz],["Einsatz (Halbtag)",p.ansatzHalbtag],["Co-Einsatz (Tag)",p.ansatzCoEinsatz],["Stunde",p.ansatzStunde],["Konzeption/Tag",p.ansatzKonzeption],["Admin/Tag",p.ansatzAdmin],["Km-Spesen/km",p.ansatzKmSpesen]]
                .filter(([,v]) => v !== null)
                .map(([l,v]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--tm-blue-pale)"><span style="color:var(--tm-text-muted)">${l}</span><span style="font-weight:500">${h.chf(v)}</span></div>`).join("")}
            </div>
          </div>
        </div>`;

      const tabContent = { einsaetze: tabEinsaetze(), konzeption: tabKonzeption(), stammdaten: tabStammdaten() };

      ui.render(`
        <div class="tm-page-header">
          <div>
            <button class="tm-btn tm-btn-sm" data-action="back-to-projekte" style="margin-bottom:8px">← Projekte</button>
            <div class="tm-page-title">${h.esc(p.title)}</div>
            <div class="tm-page-meta">${h.esc(p.firmaName)}${p.projektNr ? ` · #${h.esc(p.projektNr)}` : ""} · ${h.projStatusBadge(p.status)}</div>
          </div>
          <div class="tm-page-actions">
            <button class="tm-btn tm-btn-sm" data-action="edit-projekt" data-id="${p.id}">Bearbeiten</button>
            <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-einsatz" data-projekt-id="${p.id}">+ Einsatz</button>
            <button class="tm-btn tm-btn-sm" data-action="new-konzeption" data-projekt-id="${p.id}">+ Aufwand</button>
          </div>
        </div>
        <div class="tm-kpi-row">
          <div class="tm-kpi"><div class="tm-kpi-label">Total Umsatz</div><div class="tm-kpi-value tm-chf">CHF ${h.chf(p.totalBetrag)}</div></div>
          <div class="tm-kpi"><div class="tm-kpi-label">Einsätze</div><div class="tm-kpi-value">${p.einsaetzeCount}</div></div>
          ${p.konzBudgetH ? `<div class="tm-kpi"><div class="tm-kpi-label">Konzeption</div>
            <div class="tm-kpi-value ${pct>=100?"red":pct>=80?"amber":"green"}">${p.konzStunden.toFixed(1)} h</div>
            <div class="tm-kpi-sub">von ${p.konzBudgetH} h Budget</div></div>` : ""}
        </div>
        ${pct !== null ? `<div class="tm-budget-bar-wrap">
          <div class="tm-budget-labels">
            <span>Konzeptionsbudget: ${p.konzStunden.toFixed(1)} / ${p.konzBudgetH} h (${pct}%)</span>
            <span style="color:${pct>=100?"var(--tm-red)":pct>=80?"var(--tm-amber)":"var(--tm-green)"}">${pct>=100?"⚠ überschritten":pct>=80?"⚠ Achtung":"im Rahmen"}</span>
          </div>
          <div class="tm-budget-bar"><div class="tm-budget-fill ${pct>=100?"over":pct>=80?"warn":""}" style="width:${Math.min(pct,100)}%"></div></div>
        </div>` : ""}
        <div class="tm-tabs">
          ${["einsaetze","konzeption","stammdaten"].map(t => `<div class="tm-tab${tab===t?" active":""}" data-tab="${t}" data-route="projekt-detail">
            ${{ einsaetze:"Einsätze", konzeption:"Konzeption", stammdaten:"Stammdaten & Ansätze" }[t]}
          </div>`).join("")}
        </div>
        ${tabContent[tab] || ""}
      `);
    },

    einsaetze() {
      const f = state.filters.einsaetze;
      let list = [...state.enriched.einsaetze];
      if (f.search)        list = list.filter(e => h.inc(e.title, f.search) || h.inc(e.projektTitle, f.search));
      if (f.abrechnung)    list = list.filter(e => e.abrechnung === f.abrechnung);
      if (f.einsatzStatus) list = list.filter(e => e.einsatzStatus === f.einsatzStatus);
      list.sort((a,b) => h.toDate(b.datum) - h.toDate(a.datum));

      ui.render(`
        <div class="tm-page-header">
          <div><div class="tm-page-title">Alle Einsätze</div><div class="tm-page-meta">${list.length} Einträge</div></div>
          <div class="tm-page-actions"><button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-einsatz" data-projekt-id="">+ Einsatz</button></div>
        </div>
        <div class="tm-filter-bar">
          <input type="search" placeholder="Suche…" value="${h.esc(f.search)}" oninput="state.filters.einsaetze.search=this.value;ctrl.render()">
          <select onchange="state.filters.einsaetze.abrechnung=this.value;ctrl.render()">
            <option value="">Abrechnung: alle</option>
            ${state.choices.einsatzAbrechnung.map(s => `<option value="${s}" ${f.abrechnung===s?"selected":""}>${s}</option>`).join("")}
          </select>
          <select onchange="state.filters.einsaetze.einsatzStatus=this.value;ctrl.render()">
            <option value="">Status: alle</option>
            ${["geplant","durchgefuehrt","abgesagt","abgesagt-chf"].map(s => `<option value="${s}" ${f.einsatzStatus===s?"selected":""}>${{geplant:"Geplant",durchgefuehrt:"Durchgeführt",abgesagt:"Abgesagt","abgesagt-chf":"Abgesagt (CHF)"}[s]}</option>`).join("")}
          </select>
        </div>
        ${list.length ? `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung</th><th>Projekt / Firma</th><th>Kategorie</th><th>Person</th><th>Betrag</th><th>Status</th><th>Abrechnung</th><th></th></tr></thead>
          <tbody>${list.map(e => {
            const proj = state.enriched.projekte.find(p => p.id === e.projektLookupId);
            return `<tr class="${["abgesagt","abgesagt-chf"].includes(e.einsatzStatus)?"cancelled":""}">
              <td class="tm-nowrap">${h.esc(e.datumFmt)}</td>
              <td style="font-weight:500">${h.esc(e.title)}</td>
              <td><div style="font-weight:500">${h.esc(e.projektTitle)}</div><div style="font-size:11px;color:var(--tm-text-muted)">${h.esc(proj?.firmaName||"")}</div></td>
              <td class="tm-muted">${h.esc(e.kategorie)}</td>
              <td class="tm-muted">${h.esc(e.personName)}${e.coPersonName && e.coPersonName !== "—" ? `<div style="font-size:11px;color:var(--tm-text-muted)">Co: ${h.esc(e.coPersonName)}</div>` : ""}</td>
              <td class="tm-right tm-chf">${e.anzeigeBetrag !== null ? h.chf(e.anzeigeBetrag) : "—"}${e.coAnzeigeBetrag !== null && e.coAnzeigeBetrag !== undefined ? `<div style="font-size:11px;color:var(--tm-text-muted)">Co: ${h.chf(e.coAnzeigeBetrag)}</div>` : ""}</td>
              <td>${h.statusBadge(e)}</td>
              <td>${h.abrBadge(e.abrechnung)}</td>
              <td><div class="tm-actions">
                <button class="tm-btn tm-btn-sm" data-action="edit-einsatz" data-id="${e.id}">✎</button>
                <button class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${e.id}">⧉</button>
                <button class="tm-btn tm-btn-sm" data-action="delete-einsatz" data-id="${e.id}" title="Löschen" style="color:var(--tm-red)">🗑</button>
              </div></td>
            </tr>`;
          }).join("")}</tbody></table></div>` : ui.empty("Keine Einsätze gefunden.")}
      `);
    },

    konzeption() {
      const f = state.filters.konzeption;
      let list = [...state.enriched.konzeption];
      if (f.search)       list = list.filter(k => h.inc(k.title, f.search) || h.inc(k.projektTitle, f.search));
      if (f.verrechenbar) list = list.filter(k => k.verrechenbar === f.verrechenbar);
      list.sort((a,b) => h.toDate(b.datum) - h.toDate(a.datum));

      const sumF = list.filter(k => k.verrechenbar === "zur Abrechnung").reduce((s,k) => s + (k.anzeigeBetrag||0), 0);
      const sumK = list.filter(k => k.verrechenbar === "Klärung nötig").reduce((s,k)  => s + (k.anzeigeBetrag||0), 0);
      const sumI = list.filter(k => k.verrechenbar === "Inklusive").reduce((s,k)      => s + (k.anzeigeBetrag||0), 0);

      ui.render(`
        <div class="tm-page-header">
          <div><div class="tm-page-title">Konzeption & Admin</div><div class="tm-page-meta">${list.length} Einträge</div></div>
          <div class="tm-page-actions"><button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-konzeption" data-projekt-id="">+ Aufwand</button></div>
        </div>
        <div class="tm-kpi-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div class="tm-kpi"><div class="tm-kpi-label">Zur Abrechnung</div><div class="tm-kpi-value green tm-chf">CHF ${h.chf(sumF)}</div></div>
          <div class="tm-kpi"><div class="tm-kpi-label">In Klärung</div><div class="tm-kpi-value amber tm-chf">CHF ${h.chf(sumK)}</div></div>
          <div class="tm-kpi"><div class="tm-kpi-label">Inklusive</div><div class="tm-kpi-value tm-chf">CHF ${h.chf(sumI)}</div></div>
        </div>
        <div class="tm-filter-bar">
          <input type="search" placeholder="Suche…" value="${h.esc(f.search)}" oninput="state.filters.konzeption.search=this.value;ctrl.render()">
          <select onchange="state.filters.konzeption.verrechenbar=this.value;ctrl.render()">
            <option value="">Verrechenbar: alle</option>
            ${state.choices.konzVerrechenbar.map(s => `<option value="${s}" ${f.verrechenbar===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${list.length ? `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung / Projekt</th><th>Kategorie</th><th>Person</th><th>Stunden</th><th>Betrag</th><th>Verrechenbar</th><th></th></tr></thead>
          <tbody>${list.map(k => `<tr>
            <td class="tm-nowrap">${h.esc(k.datumFmt)}</td>
            <td><div style="font-weight:500">${h.esc(k.title)}</div><div style="font-size:11px;color:var(--tm-text-muted)">${h.esc(k.projektTitle)}</div></td>
            <td class="tm-muted">${h.esc(k.kategorie)}</td>
            <td class="tm-muted">${h.esc(k.personName)}</td>
            <td class="tm-right">${k.aufwandStunden !== null ? k.aufwandStunden.toFixed(1) + " h" : "—"}</td>
            <td class="tm-right tm-chf">${k.anzeigeBetrag !== null ? h.chf(k.anzeigeBetrag) : "—"}</td>
            <td>${h.verrBadge(k.verrechenbar)}</td>
            <td><div class="tm-actions"><button class="tm-btn tm-btn-sm" data-action="edit-konzeption" data-id="${k.id}">✎</button></div></td>
          </tr>`).join("")}</tbody></table></div>` : ui.empty("Keine Konzeptionsaufwände gefunden.")}
      `);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // CONTROLLER
  // ════════════════════════════════════════════════════════════════════════
  const ctrl = {
    render() {
      // Formular-State hat Priorität — verhindert Überschreiben durch Router
      if (state.form) return;
      const r = state.filters.route;
      ui.setNav(["projekte","einsaetze","konzeption"].includes(r) ? r : "projekte");
      ui.setMsg("", "");
      if (r === "projekte")       { views.projekte(); return; }
      if (r === "projekt-detail") { views.projektDetail(state.selection.projektId); return; }
      if (r === "einsaetze")      { views.einsaetze(); return; }
      if (r === "konzeption")     { views.konzeption(); return; }
    },

    navigate(route) {
      state.form = null;   // Formular-Lock aufheben
      state.filters.route = route;
      if (route !== "projekt-detail") state.selection.projektId = null;
      this.render();
      window.scrollTo(0, 0);
    },

    openProjekt(id) {
      state.form = null;
      state.selection.projektId = id;
      state.filters.route = "projekt-detail";
      this.render();
      window.scrollTo(0, 0);
    },

    setTab(route, tab) { state.filters.activeTab[route] = tab; this.render(); },
    closeModal() { ui.closeModal(); },

    async login() {
      try {
        const r = await state.auth.msal.loginPopup({ scopes: CONFIG.graph.scopes });
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

    async refresh() {
      ui.setMsg("Aktualisiere…", "info");
      await api.loadAll();
      ctrl.render();
    },

    // ── Projekt-Formular ───────────────────────────────────────────────────
    openProjektForm(id) {
      const p  = id ? state.enriched.projekte.find(p => p.id === id) : null;
      const cv = (k, fb = "") => p ? (p[k] ?? fb) : fb;
      const cn = k => (p && p[k] !== null && p[k] !== undefined) ? p[k] : "";

      // Formular-Lock setzen — verhindert Router-Überschreiben
      state.form = { type: "projekt", id: id || null };
      state.filters.route = "projekt-form";
      ui.setNav("projekte");

      ui.render(`
        <div style="max-width:700px;margin:0 auto">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <button class="tm-btn tm-btn-sm" data-action="back-to-projekte">← Projekte</button>
            <div class="tm-page-title">${p ? "Projekt bearbeiten" : "Neues Projekt erfassen"}</div>
          </div>
          <form id="projekt-form" autocomplete="off">
            <input type="hidden" name="itemId" value="${id || ""}">
            <input type="hidden" name="mode"   value="${id ? "edit" : "create"}">

            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">Stammdaten</div>
              <div class="tm-form-grid" style="margin-top:14px">
                <div class="tm-field tm-form-full">
                  <label>Projektname <span class="req">*</span></label>
                  <input type="text" name="title" value="${h.esc(cv("title"))}" required>
                </div>
                <div class="tm-field">
                  <label>Projekt-Nr.</label>
                  <input type="text" name="projektNr" value="${h.esc(cv("projektNr"))}">
                </div>
                <div class="tm-field">
                  <label>Konto-Nr. Honorar</label>
                  <input type="text" name="kontoNr" value="${h.esc(cv("kontoNr"))}" placeholder="z.B. 4210">
                </div>
                <div class="tm-field">
                  <label>Ansprechpartner <span class="req">*</span></label>
                  ${ui.personTypeahead("ansprechpartnerLookupId", p?.ansprechpartnerLookupId ? String(p.ansprechpartnerLookupId) : "")}
                </div>
                <div class="tm-field">
                  <label>Firma</label>
                  <div id="firma-display" style="padding:8px 12px;background:var(--tm-blue-pale);border-radius:6px;font-size:13px;color:var(--tm-text)">
                    ${h.esc(p?.firmaName || "— wird aus Ansprechpartner übernommen —")}
                  </div>
                  <input type="hidden" name="firmaLookupId" id="firma-hidden" value="${p?.firmaLookupId || ""}">
                </div>
                <div class="tm-field">
                  <label>Status <span class="req">*</span></label>
                  <select name="status" required>
                    ${state.choices.projektStatus.map(s => `<option value="${s}" ${cv("status","aktiv")===s?"selected":""}>${s}</option>`).join("")}
                  </select>
                </div>
                <div class="tm-field">
                  <label>Km zum Kunden</label>
                  <input type="number" name="kmZumKunden" value="${cn("kmZumKunden")}" placeholder="z.B. 28" min="0" step="1">
                  <span class="tm-hint">Hin &amp; Zurück total (wird 1× mit CHF/km multipliziert)</span>
                </div>
                <div class="tm-field" style="justify-content:flex-end">
                  <label>&nbsp;</label>
                  <label class="tm-checkbox-row">
                    <input type="checkbox" name="archiviert" ${cv("archiviert") ? "checked" : ""}> Archiviert
                  </label>
                </div>
              </div>
            </div>

            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">Ansätze CHF
                <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;background:#E1F5EE;color:#085041;padding:2px 8px;border-radius:4px">leer = Kategorie nicht verfügbar</span>
              </div>
              <table style="width:100%;border-collapse:collapse;margin-top:14px">
                <thead><tr>
                  <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted);text-align:left;padding:0 16px 8px 0;border-bottom:1px solid var(--tm-border);width:160px">Kategorie</th>
                  <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted);text-align:left;padding:0 12px 8px;border-bottom:1px solid var(--tm-border)">Haupttrainer</th>
                  <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted);text-align:left;padding:0 0 8px 12px;border-bottom:1px solid var(--tm-border)">Co-Trainer</th>
                </tr></thead>
                <tbody>
                  ${[["Einsatz (Tag)","ansatzEinsatz","ansatzCoEinsatz"],["Einsatz (Halbtag)","ansatzHalbtag","ansatzCoHalbtag"]].map(([lbl,mk,ck]) => `
                  <tr>
                    <td style="font-size:13px;padding:8px 16px 8px 0;border-bottom:1px solid var(--tm-blue-pale)">${lbl}</td>
                    <td style="padding:6px 12px;border-bottom:1px solid var(--tm-blue-pale)">
                      <div style="display:flex;align-items:center;border:1px solid var(--tm-border);border-radius:6px;overflow:hidden;max-width:140px">
                        <span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border)">CHF</span>
                        <input type="number" name="${mk}" value="${cn(mk)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;width:90px;outline:none;font-family:inherit">
                      </div>
                    </td>
                    <td style="padding:6px 0 6px 12px;border-bottom:1px solid var(--tm-blue-pale)">
                      <div style="display:flex;align-items:center;border:1px solid var(--tm-border);border-radius:6px;overflow:hidden;max-width:140px">
                        <span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border)">CHF</span>
                        <input type="number" name="${ck}" value="${cn(ck)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;width:90px;outline:none;font-family:inherit">
                      </div>
                    </td>
                  </tr>`).join("")}
                </tbody>
              </table>
              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px">
                ${[["Stunde","ansatzStunde","CHF/h"],["Stück","ansatzStueck","CHF/Stück"],["Pauschale","ansatzPauschale","CHF fix"],["Konzeption/Tag","ansatzKonzeption","CHF/Tag"],["Admin/Tag","ansatzAdmin","CHF/Tag"],["Km-Spesen","ansatzKmSpesen","CHF/km"]].map(([lbl,key,hint]) => `
                <div class="tm-field">
                  <label>${lbl}</label>
                  <div style="display:flex;align-items:center;border:1px solid var(--tm-border);border-radius:6px;overflow:hidden">
                    <span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border)">CHF</span>
                    <input type="number" name="${key}" value="${cn(key)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;flex:1;min-width:0;outline:none;font-family:inherit">
                  </div>
                  <span class="tm-hint">${hint}</span>
                </div>`).join("")}
                <div class="tm-field">
                  <label>Spesen Konto-Nr.</label>
                  <input type="text" name="spesenKontoNr" value="${h.esc(cv("spesenKontoNr"))}" placeholder="z.B. 6500">
                </div>
              </div>
            </div>

            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">Konzeptionsrahmen</div>
              <div class="tm-form-grid" style="margin-top:14px">
                <div class="tm-field">
                  <label>Vereinbarte Tage</label>
                  <input type="number" name="konzeptionsrahmenTage" value="${cn("konzeptionsrahmenTage")}"
                    placeholder="z.B. 2" min="0" step="0.5"
                    oninput="document.getElementById('kh').textContent=(parseFloat(this.value)||0)*8">
                  <span class="tm-hint">× 8 = Stunden-Budget</span>
                </div>
                <div class="tm-field" style="justify-content:flex-end">
                  <label>&nbsp;</label>
                  <div style="padding:10px 14px;background:var(--tm-blue-pale);border-radius:6px;font-size:13px;color:#6B7280">
                    = <span id="kh" style="font-weight:600;color:var(--tm-text)">${(cv("konzeptionsrahmenTage",0)||0)*8}</span> Stunden Budget
                  </div>
                </div>
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px">
              <button type="button" class="tm-btn" data-action="back-to-projekte">Abbrechen</button>
              <button type="submit" class="tm-btn tm-btn-primary">Projekt speichern</button>
            </div>
          </form>
        </div>
      `);
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
        const coBetrag = proj ? h.berechneCoBetrag(proj, kat) : null;
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

        state.form = null;
        ui.setMsg("Projekt gespeichert.", "success");
        await api.loadAll();
        ctrl.navigate("projekte");
      } catch (e) {
        debug.err("saveProjekt", e);
        state.form = null;
        ui.setMsg(e.message || "Fehler beim Speichern.", "error");
        ctrl.render();
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
    openEinsatzForm(id, projektId = null, preselectKat = null) {
      const e          = id ? state.enriched.einsaetze.find(e => e.id === id) : null;
      const prefProjId = projektId || (e?.projektLookupId || null);
      const selProjekt = prefProjId ? state.enriched.projekte.find(p => p.id === prefProjId) : null;
      const kats       = h.kategorien(selProjekt);
      // preselectKat: beim Duplizieren Kategorie vorwählen (wenn vorhanden)
      const selKat     = e?.kategorie || (preselectKat && kats.includes(preselectKat) ? preselectKat : "");
      const defPerson  = h.defaultPerson();
      const selPerson  = e ? e.personLookupId : (defPerson?.id || null);
      const selCoPerson = e?.coPersonLookupId || null;
      const isTagKat   = ["Einsatz (Tag)","Einsatz (Halbtag)"].includes(selKat);

      const betragBer   = selProjekt && selKat ? h.berechneBetrag(selProjekt, selKat, 1, e?.dauerStunden, e?.anzahlStueck) : null;
      const coBetragBer = selProjekt && selKat ? h.berechneCoBetrag(selProjekt, selKat) : null;
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

      // Spesen: Km aus Projekt vorbelegen falls vorhanden
      const kmVorbelegt = selProjekt?.kmZumKunden || "";
      const ansatzKm    = selProjekt?.ansatzKmSpesen || null;
      const hasSp       = !!(e?.spesenBerechnet);
      const kmGespeichert = (hasSp && ansatzKm) ? Math.round(e.spesenBerechnet / ansatzKm) : (kmVorbelegt || "");
      const spesenTotal = hasSp ? e.spesenBerechnet : (kmVorbelegt && ansatzKm ? kmVorbelegt * ansatzKm : 0);

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
          <button class="ef-cl" data-close-modal>✕</button>
        </div>

        <div class="ef-bd">
          <form id="einsatz-form" autocomplete="off" style="display:contents">
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
                  <div class="ef-iw"><input type="text" name="ort" value="${h.esc(e?.ort || "")}" placeholder="Ort, Virtuell…"></div>
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
                <div class="ef-iw"><input type="text" name="titel" value="${h.esc(e?.title || "")}" placeholder="z.B. Kick-off Workshop, Modul 3…"></div>
              </div>

              <!-- Kategorie -->
              <div class="ef-s">
                <div class="ef-l">Kategorie</div>
                <div class="ef-kg" id="kat-grp">
                  ${kats.length ? katBtnHtml : `<span style="font-size:12px;color:#8896a5">Zuerst Projekt wählen</span>`}
                </div>
                <div id="fd-std" class="ef-sub-inp${selKat === "Stunde" ? " show" : ""}">
                  <div class="ef-iw" style="max-width:180px">
                    <input type="number" name="dauerStunden" min="0.5" step="0.5" value="${e?.dauerStunden || ""}" placeholder="Anzahl Stunden" oninput="ctrl.onKatChange(document.getElementById('kat-hid').value)">
                  </div>
                </div>
                <div id="fd-stk" class="ef-sub-inp${selKat === "Stück" ? " show" : ""}">
                  <div class="ef-iw" style="max-width:180px">
                    <input type="number" name="anzahlStueck" min="1" step="1" value="${e?.anzahlStueck || ""}" placeholder="Anzahl Stück" oninput="ctrl.onKatChange(document.getElementById('kat-hid').value)">
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
                  <div class="ef-betrag-override${e?.betragFinal ? " show" : ""}" id="ef-ov-lead">
                    <span style="font-size:11px;color:#8896a5">CHF</span>
                    <input type="number" name="betragFinal" step="0.01" value="${e?.betragFinal ?? ""}" placeholder="Betrag">
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
                    <div class="ef-betrag-override${e?.coBetragFinal ? " show" : ""}" id="ef-ov-co">
                      <span style="font-size:11px;color:#8896a5">CHF</span>
                      <input type="number" name="coBetragFinal" step="0.01" value="${e?.coBetragFinal ?? ""}" placeholder="Betrag">
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
                  <input type="hidden" name="spesenBerechnet" id="ef-sp-ber" value="${hasSp ? (e?.spesenBerechnet ?? "") : (kmVorbelegt && ansatzKm ? kmVorbelegt * ansatzKm : "")}">
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
                  ${state.choices.einsatzStatus.map(s => `<button type="button"
                    class="ef-st-btn${e?.status === s ? " on" : ""}"
                    onclick="ctrl.efToggleStatus(this, '${h.esc(s)}')">${h.esc(s)}</button>`).join("")}
                </div>
              </div>

              <div class="ef-dv"></div>

              <!-- Bemerkungen -->
              <div class="ef-s">
                <div class="ef-l">Bemerkungen</div>
                <div class="ef-iw"><textarea name="bemerkungen" placeholder="Interne Notizen…">${h.esc(e?.bemerkungen || "")}</textarea></div>
              </div>

            </div><!-- /ef-col-r -->

          </form>
        </div><!-- /ef-bd -->

        <div class="ef-ft">
          ${id && e?.abrechnung ? `<div class="ef-abr-info"><span style="width:6px;height:6px;border-radius:50%;background:#8896a5;display:inline-block"></span>Abrechnung: ${h.esc(e.abrechnung)}</div>` : `<div></div>`}
          <div style="display:flex;gap:8px">
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
      ta.querySelector(".tm-ta-input")?.focus();
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
      const wasOn = btn.classList.contains("on");
      document.querySelectorAll(".ef-st-btn").forEach(b => b.classList.remove("on"));
      if (!wasOn) {
        btn.classList.add("on");
        if (statusHid) statusHid.value = statusVal;
      } else {
        if (statusHid) statusHid.value = "";
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
      const dStd = document.querySelector("[name='dauerStunden']"); if (dStd) dStd.value = "";
      const dStk = document.querySelector("[name='anzahlStueck']"); if (dStk) dStk.value = "";
      // Betrag-Anzeige zurücksetzen
      const bvl = document.getElementById("ef-bval-lead");
      if (bvl) { bvl.textContent = "Kategorie wählen"; bvl.className = "ef-betrag-val warn"; }
    },

    onKatChange(kat) {
      const fdStd = document.getElementById("fd-std");
      const fdStk = document.getElementById("fd-stk");
      if (fdStd) fdStd.className = "ef-sub-inp" + (kat === "Stunde" ? " show" : "");
      if (fdStk) fdStk.className = "ef-sub-inp" + (kat === "St\u00fcck" ? " show" : "");
      const isTagKat = ["Einsatz (Tag)", "Einsatz (Halbtag)"].includes(kat);
      const addCoBtn = document.getElementById("ef-addco-btn");
      if (addCoBtn) addCoBtn.style.display = isTagKat ? "inline-flex" : "none";
      if (!isTagKat) ctrl.efToggleCo(false);
      // Betrag neu berechnen
      const projId = Number(document.querySelector("[name='projektLookupId']")?.value) || null;
      const proj   = projId ? state.enriched.projekte.find(p => p.id === projId) : null;
      const std    = h.num(document.querySelector("[name='dauerStunden']")?.value);
      const stk    = h.num(document.querySelector("[name='anzahlStueck']")?.value);
      const betrag = proj ? h.berechneBetrag(proj, kat, 1, std, stk) : null;
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

        if (!datum) {
          document.querySelector("[name='datum']")?.focus();
          throw new Error("Bitte Datum auswählen.");
        }
        if (!projId) throw new Error("Bitte Projekt wählen.");
        if (!kat)    throw new Error("Bitte Kategorie wählen.");
        const personIdCheck = h.num(fd.get("personLookupId"));
        if (!personIdCheck) throw new Error("Bitte Lead-Person wählen.");

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

        // DauerTage direkt aus Kategorie ableiten — kein separates Dauer-Radio nötig
        if (kat === "Einsatz (Tag)")     fields.DauerTage = 1.0;
        else if (kat === "Einsatz (Halbtag)") fields.DauerTage = 0.5;
        else if (kat === "Stunde"  && dauerStunden) fields.DauerStunden = dauerStunden;
        else if (kat === "Stück"   && anzahlStueck) fields.AnzahlStueck = anzahlStueck;

        if (betragBer !== null) fields.BetragBerechnet = betragBer;
        const bf = h.num(fd.get("betragFinal"));
        if (bf !== null) fields.BetragFinal = bf;
        // Co-Betrag: nur wenn Co-Lead gesetzt
        const coPersonId2 = h.num(fd.get("coPersonLookupId"));
        if (coPersonId2) {
          const coBetragBer = h.berechneCoBetrag(p, kat);
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
        ui.setMsg(e.message || "Fehler.", "error");
      } finally {
        ctrl._saveEinsatzBusy = false;
      }
    },

    async deleteEinsatz(id) {
      const e = state.enriched.einsaetze.find(e => e.id === id);
      if (!e) return;
      const label = e.title || e.datumFmt || `Einsatz #${id}`;
      if (!confirm(`Einsatz "${label}" wirklich löschen?`)) return;
      try {
        const sid = await api.siteId();
        const tok = await api.token();
        const url = `https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(CONFIG.lists.einsaetze)}/items/${id}`;
        const res = await fetch(url, { method: "DELETE", headers: { Authorization: "Bearer " + tok } });
        if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
        ui.setMsg("Einsatz gelöscht.", "success");
        await api.loadAll();
        ctrl.render();
      } catch (e) {
        debug.err("deleteEinsatz", e);
        ui.setMsg("Fehler beim Löschen: " + e.message, "error");
      }
    },

    copyEinsatz(id) {
      // Einsatz duplizieren: neues Formular öffnen mit Projekt und Kategorie vorbelegt,
      // Datum leer damit der User bewusst ein neues Datum wählt.
      const e = state.enriched.einsaetze.find(e => e.id === id);
      if (!e) return;
      ctrl.openEinsatzForm(null, e.projektLookupId, e.kategorie);
    },

    // ── Konzeption-Formular (v2) ──────────────────────────────────────────
    // Analog Einsatz-Modal: gleiche Struktur, alle Choices dynamisch aus SP
    openKonzeptionForm(id, projektId = null) {
      const k          = id ? state.enriched.konzeption.find(k => k.id === id) : null;
      const prefProjId = projektId || (k?.projektLookupId || null);
      const selProjekt = prefProjId ? state.enriched.projekte.find(p => p.id === prefProjId) : null;
      const defPerson  = h.defaultPerson();
      const selPerson  = k ? k.personLookupId : (defPerson?.id || null);
      const personName = selPerson ? h.contactName(selPerson) : null;
      const initials   = n => n ? n.split(/[\s,]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase() : "?";

      const projektOpts = state.enriched.projekte
        .filter(p => !p.archiviert)
        .map(p => `<option value="${p.id}" ${prefProjId === p.id ? "selected" : ""}>${h.esc(p.title)}</option>`)
        .join("");

      // Betrag-Vorschau berechnen
      const selKat   = k?.kategorie || "Konzeption";
      const ansatz   = selProjekt ? (selKat === "Admin" ? selProjekt.ansatzAdmin : selProjekt.ansatzKonzeption) : null;
      const betragBer = (ansatz && k?.aufwandStunden) ? (ansatz / 8) * k.aufwandStunden : null;

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
          <button class="kf-cl" data-close-modal>✕</button>
        </div>

        <div class="kf-bd">
          <form id="konzeption-form" autocomplete="off" style="display:contents">
            <input type="hidden" name="itemId" value="${id || ""}">
            <input type="hidden" name="mode" value="${id ? "edit" : "create"}">
            <input type="hidden" id="kf-kat-hid" name="kategorie" value="${h.esc(selKat)}">
            <input type="hidden" id="kf-verr-hid" name="verrechenbar" value="${h.esc(k?.verrechenbar || "")}">
            <input type="hidden" id="kf-abr-hid" name="abrechnung" value="${h.esc(k?.abrechnung || "offen")}">

            <!-- LINKE SPALTE -->
            <div class="kf-col-l">

              <!-- Datum -->
              <div class="kf-s">
                <div class="kf-l">Datum</div>
                <div class="kf-iw"><input type="date" name="datum" value="${h.esc(k ? h.toDateInput(k.datum) : "")}" required></div>
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
                <div class="kf-iw"><input type="text" name="titel" value="${h.esc(k?.title || "")}" placeholder="z.B. Vorbereitung Modul 3, Call mit Kunde…" required></div>
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
                    min="0.25" step="0.25" value="${k?.aufwandStunden || ""}"
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
                  ${state.choices.konzVerrechenbar.map(v => `<button type="button"
                    class="kf-verr-btn${(k?.verrechenbar || "") === v ? " on" : ""}"
                    onclick="document.querySelectorAll('.kf-verr-btn').forEach(b=>b.classList.remove('on'));this.classList.add('on');document.getElementById('kf-verr-hid').value='${h.esc(v)}'"
                    >${h.esc(v)}</button>`).join("")}
                </div>
              </div>

              <div class="kf-dv"></div>

              <!-- Bemerkungen -->
              <div class="kf-s">
                <div class="kf-l">Bemerkungen</div>
                <div class="kf-iw"><textarea name="bemerkungen" placeholder="Interne Notizen…">${h.esc(k?.bemerkungen || "")}</textarea></div>
              </div>

            </div><!-- /kf-col-r -->

          </form>
        </div>

        <div class="kf-ft">
          ${id && k?.abrechnung ? `<div class="kf-abr-info"><span style="width:6px;height:6px;border-radius:50%;background:#8896a5;display:inline-block"></span>Abrechnung: ${h.esc(k.abrechnung)}</div>` : `<div></div>`}
          <div style="display:flex;gap:8px">
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
      ta.querySelector(".tm-ta-input")?.focus();
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

        const p = state.enriched.projekte.find(p => p.id === projId);
        const ansatz = kat === "Admin" ? p?.ansatzAdmin : p?.ansatzKonzeption;
        const betragBer = (ansatz && std) ? (ansatz / 8) * std : null;

        // Lookup-Felder via SP REST API
        const lookupFields = { [F.konz_projekt_w]: projId };
        const personId = h.num(fd.get("personLookupId"));
        if (personId) lookupFields[F.konz_person_w] = personId;

        const fields = {
          Kategorie:      kat,
          AufwandStunden: std,
          Verrechenbar:   fd.get("verrechenbar") || "",
          Abrechnung:     fd.get("abrechnung") || "offen"
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
        cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false }
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

  document.addEventListener("DOMContentLoaded", boot);
})();
