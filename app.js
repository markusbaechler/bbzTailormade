(() => {
  "use strict";

  // ── CONFIG ──────────────────────────────────────────────────────────────
  const CONFIG = {
    appName: "TM-App",

    graph: {
      tenantId:    "3643e7ab-d166-4e27-bd5f-c5bbfcd282d7",
      clientId:    "c4143c1e-33ea-4c4d-a410-58110f966d0a",
      authority:   "https://login.microsoftonline.com/3643e7ab-d166-4e27-bd5f-c5bbfcd282d7",
      redirectUri: "https://markusbaechler.github.io/bbzTailormade/",
      scopes:      ["User.Read", "Sites.ReadWrite.All"]
    },

    sharePoint: {
      siteHostname: "bbzsg.sharepoint.com",
      sitePath:     "/sites/CRM"
    },

    lists: {
      projekte:    "ProjekteTM",
      einsaetze:   "EinsaetzeTM",
      konzeption:  "KonzeptionTM",
      firms:       "CRMFirms",
      contacts:    "CRMContacts"
    },

    defaults: {
      route: "projekte"
    }
  };

  // ── SCHEMA ──────────────────────────────────────────────────────────────
  const SCHEMA = {
    projekte: {
      listTitle: CONFIG.lists.projekte,
      fields: {
        title:                   "Title",
        projektNr:               "ProjektNr",
        kontoNr:                 "KontoNr",
        firmaLookupId:           "FirmaLookupId",
        firmaRaw:                "Firma",
        ansprechpartnerLookupId: "AnsprechpartnerLookupId",
        ansprechpartnerRaw:      "Ansprechpartner",
        status:                  "Status",
        kmZumKunden:             "KmZumKunden",
        archiviert:              "Archiviert",
        ansatzEinsatz:           "AnsatzEinsatz",
        ansatzHalbtag:           "AnsatzHalbtag",
        ansatzCoEinsatz:         "AnsatzCoEinsatz",
        ansatzCoHalbtag:         "AnsatzCoHalbtag",
        ansatzStunde:            "AnsatzStunde",
        ansatzStueck:            "AnsatzStueck",
        ansatzPauschale:         "AnsatzPauschale",
        ansatzKonzeption:        "AnsatzKonzeption",
        ansatzAdmin:             "AnsatzAdmin",
        ansatzKmSpesen:          "AnsatzKmSpesen",
        spesenKontoNr:           "SpesenKontoNr",
        konzeptionsrahmenTage:   "KonzeptionsrahmenTage"
      }
    },

    einsaetze: {
      listTitle: CONFIG.lists.einsaetze,
      fields: {
        title:             "Title",
        datum:             "Datum",
        projektLookupId:   "ProjektLookupId",
        projektRaw:        "Projekt",
        ort:               "Ort",
        personLookupId:    "PersonLookupId",
        personRaw:         "Person",
        coPersonLookupId:  "CoPersonLookupId",
        coPersonRaw:       "CoPerson",
        bemerkungen:       "Bemerkungen",
        kategorie:         "Kategorie",
        dauerTage:         "DauerTage",
        dauerStunden:      "DauerStunden",
        anzahlStueck:      "AnzahlStueck",
        betragBerechnet:   "BetragBerechnet",
        betragFinal:       "BetragFinal",
        coBetragBerechnet: "CoBetragBerechnet",
        coBetragFinal:     "CoBetragFinal",
        spesen:            "Spesen",
        spesenZusatz:      "SpesenZusatz",
        spesenBerechnet:   "SpesenBerechnet",
        spesenFinal:       "SpesenFinal",
        status:            "Status",
        abrechnung:        "Abrechnung"
      }
    },

    konzeption: {
      listTitle: CONFIG.lists.konzeption,
      fields: {
        title:           "Title",
        datum:           "Datum",
        projektLookupId: "ProjektLookupId",
        projektRaw:      "Projekt",
        kategorie:       "Kategorie",
        personLookupId:  "PersonLookupId",
        personRaw:       "Person",
        aufwandStunden:  "AufwandStunden",
        betragBerechnet: "BetragBerechnet",
        betragFinal:     "BetragFinal",
        verrechenbar:    "Verrechenbar",
        bemerkungen:     "Bemerkungen"
      }
    },

    firms: {
      listTitle: CONFIG.lists.firms,
      fields: { title: "Title" }
    },

    contacts: {
      listTitle: CONFIG.lists.contacts,
      fields: {
        nachname: "Title",
        vorname:  "Vorname"
      }
    }
  };

  // ── STATE ────────────────────────────────────────────────────────────────
  const state = {
    auth: {
      msal:            null,
      account:         null,
      token:           null,
      isAuthenticated: false,
      isReady:         false
    },

    meta: {
      siteId:  null,
      loading: false,
      choices: {}
    },

    data: {
      projekte:   [],
      einsaetze:  [],
      konzeption: [],
      firms:      [],
      contacts:   []
    },

    enriched: {
      projekte:   [],
      einsaetze:  [],
      konzeption: []
    },

    filters: {
      route:      CONFIG.defaults.route,
      projekte:   { search: "", status: "", archiviert: false },
      einsaetze:  { search: "", projektId: null, abrechnung: "", einsatzStatus: "" },
      konzeption: { search: "", projektId: null, verrechenbar: "" },
      activeTab:  {}        // route → tab-name
    },

    selection: {
      projektId: null
    },

    modal: null
  };

  // ── HELPERS ──────────────────────────────────────────────────────────────
  const helpers = {
    esc(v) {
      return String(v ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    },

    bool(v) {
      if (typeof v === "boolean") return v;
      if (typeof v === "number")  return v === 1;
      if (typeof v === "string")  return ["true","1","ja","yes"].includes(v.trim().toLowerCase());
      return false;
    },

    num(v) {
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    },

    toDate(v) {
      if (!v) return null;
      const s = typeof v === "string" ? v.trim() : null;
      if (!s) return null;
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
      if (m) {
        const [y, mo, d] = m[1].split("-").map(Number);
        return new Date(y, mo - 1, d);
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    },

    formatDate(v) {
      const d = helpers.toDate(v);
      if (!d) return "";
      return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
    },

    toDateInput(v) {
      const d = helpers.toDate(v);
      if (!d) return "";
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    },

    todayStart() {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    },

    formatChf(v) {
      const n = helpers.num(v);
      if (n === null) return "—";
      return n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    textIncludes(haystack, needle) {
      return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
    },

    // Einsatz-Status aus Datum + Status-Feld ableiten
    einsatzStatus(einsatz) {
      const s = String(einsatz.status || "").toLowerCase();
      if (s === "abgesagt mit kostenfolge") return "abgesagt-chf";
      if (s === "abgesagt") return "abgesagt";
      const d = helpers.toDate(einsatz.datum);
      if (!d) return "geplant";
      return d > helpers.todayStart() ? "geplant" : "durchgefuehrt";
    },

    // Angezeigter Betrag: Final wenn gesetzt, sonst Berechnet
    anzeigebetrag(berechnet, final_) {
      const f = helpers.num(final_);
      if (f !== null) return f;
      return helpers.num(berechnet);
    },

    // Betrag berechnen (Einfrieren-Prinzip: nur beim ersten Speichern)
    berechneBetrag(projekt, kategorie, dauerTage, dauerStunden, anzahlStueck) {
      if (!projekt) return null;
      const f = SCHEMA.projekte.fields;
      const getField = (key) => projekt[key] ?? null;

      switch (kategorie) {
        case "Einsatz (Tag)":       return helpers.num(getField("ansatzEinsatz")) * (dauerTage || 1);
        case "Einsatz (Halbtag)":   return helpers.num(getField("ansatzHalbtag"));
        case "Co-Einsatz (Tag)":    return helpers.num(getField("ansatzCoEinsatz")) * (dauerTage || 1);
        case "Co-Einsatz (Halbtag)":return helpers.num(getField("ansatzCoHalbtag"));
        case "Stunde":              return (helpers.num(getField("ansatzStunde")) || 0) * (dauerStunden || 0);
        case "Stück":               return (helpers.num(getField("ansatzStueck")) || 0) * (anzahlStueck || 0);
        case "Pauschale":           return helpers.num(getField("ansatzPauschale"));
        default:                    return null;
      }
    },

    // Verfügbare Kategorien aus Projekt-Ansätzen ableiten
    verfuegbareKategorien(projekt) {
      if (!projekt) return [];
      const kat = [];
      if (projekt.ansatzEinsatz)    { kat.push("Einsatz (Tag)"); kat.push("Einsatz (Halbtag)"); }
      if (projekt.ansatzCoEinsatz)  { kat.push("Co-Einsatz (Tag)"); kat.push("Co-Einsatz (Halbtag)"); }
      if (projekt.ansatzStunde)     kat.push("Stunde");
      if (projekt.ansatzStueck)     kat.push("Stück");
      if (projekt.ansatzPauschale)  kat.push("Pauschale");
      return kat;
    },

    // Badge-HTML für Einsatz-Status
    einsatzStatusBadge(einsatz) {
      const s = helpers.einsatzStatus(einsatz);
      const map = {
        "geplant":       ["tm-badge tm-badge-planned", "Geplant"],
        "durchgefuehrt": ["tm-badge tm-badge-done",    "Durchgeführt"],
        "abgesagt":      ["tm-badge tm-badge-cancelled","Abgesagt"],
        "abgesagt-chf":  ["tm-badge tm-badge-cancelled","Abgesagt (CHF)"]
      };
      const [cls, label] = map[s] || ["tm-badge", s];
      return `<span class="${cls}">${label}</span>`;
    },

    abrechnungBadge(v) {
      const map = {
        "offen":           ["tm-badge tm-badge-open",    "offen"],
        "zur Abrechnung":  ["tm-badge tm-badge-billing", "zur Abrechnung"],
        "abgerechnet":     ["tm-badge tm-badge-billed",  "abgerechnet"]
      };
      const [cls, label] = map[v] || ["tm-badge", helpers.esc(v || "—")];
      return `<span class="${cls}">${label}</span>`;
    },

    verrechenbarBadge(v) {
      const map = {
        "Inklusive":       ["tm-badge tm-badge-incl",    "Inklusive"],
        "Klärung nötig":   ["tm-badge tm-badge-clarify", "Klärung nötig"],
        "zur Abrechnung":  ["tm-badge tm-badge-billing", "zur Abrechnung"],
        "abgerechnet":     ["tm-badge tm-badge-billed",  "abgerechnet"]
      };
      const [cls, label] = map[v] || ["tm-badge", helpers.esc(v || "—")];
      return `<span class="${cls}">${label}</span>`;
    },

    projektStatusBadge(v) {
      const map = {
        "geplant":        ["tm-badge tm-badge-planned-p", "geplant"],
        "aktiv":          ["tm-badge tm-badge-active",    "aktiv"],
        "abgeschlossen":  ["tm-badge tm-badge-done-p",   "abgeschlossen"]
      };
      const [cls, label] = map[v] || ["tm-badge", helpers.esc(v || "—")];
      return `<span class="${cls}">${label}</span>`;
    },

    // Firmen-Name via ID
    firmName(id) {
      const f = state.data.firms.find(f => f.id === id);
      return f ? f.title : (id ? `Firma #${id}` : "—");
    },

    // Kontakt-Name via ID
    contactName(id) {
      const c = state.data.contacts.find(c => c.id === id);
      if (!c) return id ? `Kontakt #${id}` : "—";
      return [c.vorname, c.nachname].filter(Boolean).join(" ") || c.nachname || "—";
    },

    validateConfig() {
      const missing = [];
      if (!CONFIG.graph.clientId)           missing.push("clientId");
      if (!CONFIG.graph.tenantId)           missing.push("tenantId");
      if (!CONFIG.graph.authority)          missing.push("authority");
      if (!CONFIG.graph.redirectUri)        missing.push("redirectUri");
      if (!CONFIG.sharePoint.siteHostname)  missing.push("siteHostname");
      if (!CONFIG.sharePoint.sitePath)      missing.push("sitePath");
      if (missing.length) throw new Error(`Konfiguration unvollständig: ${missing.join(", ")}`);
    }
  };

  // ── API ──────────────────────────────────────────────────────────────────
  const api = {
    async getToken() {
      if (!state.auth.account) throw new Error("Nicht angemeldet.");
      try {
        const result = await state.auth.msal.acquireTokenSilent({
          scopes:  CONFIG.graph.scopes,
          account: state.auth.account
        });
        state.auth.token = result.accessToken;
        return result.accessToken;
      } catch {
        const result = await state.auth.msal.acquireTokenPopup({ scopes: CONFIG.graph.scopes });
        state.auth.token = result.accessToken;
        return result.accessToken;
      }
    },

    async fetch(url, options = {}) {
      const token = await api.getToken();
      const res = await fetch(url, {
        ...options,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type":  "application/json",
          ...(options.headers || {})
        }
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (res.status === 204) return null;
      return res.json();
    },

    async getSiteId() {
      if (state.meta.siteId) return state.meta.siteId;
      const url = `https://graph.microsoft.com/v1.0/sites/${CONFIG.sharePoint.siteHostname}:${CONFIG.sharePoint.sitePath}`;
      const data = await api.fetch(url);
      state.meta.siteId = data.id;
      return data.id;
    },

    async getListItems(listTitle, select = null, expand = null) {
      const siteId = await api.getSiteId();
      let url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listTitle}/items?expand=fields&$top=5000`;
      if (select) url += `&$select=${select}`;
      const items = [];
      while (url) {
        const data = await api.fetch(url);
        items.push(...(data.value || []));
        url = data["@odata.nextLink"] || null;
      }
      return items.map(i => ({ id: Number(i.id), ...i.fields }));
    },

    async postItem(listTitle, fields) {
      const siteId = await api.getSiteId();
      const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listTitle}/items`;
      return api.fetch(url, { method: "POST", body: JSON.stringify({ fields }) });
    },

    async patchItem(listTitle, itemId, fields) {
      const siteId = await api.getSiteId();
      const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listTitle}/items/${itemId}/fields`;
      return api.fetch(url, { method: "PATCH", body: JSON.stringify(fields) });
    },

    async deleteItem(listTitle, itemId) {
      const siteId = await api.getSiteId();
      const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listTitle}/items/${itemId}`;
      return api.fetch(url, { method: "DELETE" });
    },

    async getChoices(listTitle, fieldName) {
      const siteId = await api.getSiteId();
      const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listTitle}/columns`;
      const data = await api.fetch(url);
      const col = (data.value || []).find(c => c.name === fieldName);
      return col?.choice?.choices || [];
    },

    async loadAll() {
      ui.setLoading(true);
      try {
        const [projekte, einsaetze, konzeption, firms, contacts] = await Promise.all([
          api.getListItems(CONFIG.lists.projekte),
          api.getListItems(CONFIG.lists.einsaetze),
          api.getListItems(CONFIG.lists.konzeption),
          api.getListItems(CONFIG.lists.firms),
          api.getListItems(CONFIG.lists.contacts)
        ]);
        state.data.projekte   = projekte;
        state.data.einsaetze  = einsaetze;
        state.data.konzeption = konzeption;
        state.data.firms      = firms.map(f => ({ id: Number(f.id), title: f.Title || "" }));
        state.data.contacts   = contacts.map(c => ({
          id:       Number(c.id),
          nachname: c.Title || "",
          vorname:  c.Vorname || ""
        }));
        enrich.all();
      } finally {
        ui.setLoading(false);
      }
    }
  };

  // ── ENRICH ───────────────────────────────────────────────────────────────
  const enrich = {
    all() {
      state.enriched.projekte   = state.data.projekte.map(enrich.projekt);
      state.enriched.einsaetze  = state.data.einsaetze.map(enrich.einsatz);
      state.enriched.konzeption = state.data.konzeption.map(enrich.konzeptionEintrag);
    },

    projekt(raw) {
      const f = SCHEMA.projekte.fields;
      const get = (spName) => raw[spName] ?? null;
      const p = {
        id:                      Number(raw.id),
        title:                   get("Title") || "",
        projektNr:               get("ProjektNr") || "",
        kontoNr:                 get("KontoNr") || "",
        firmaLookupId:           Number(raw["FirmaLookupId"] || raw["FirmaId"] || 0) || null,
        ansprechpartnerLookupId: Number(raw["AnsprechpartnerLookupId"] || 0) || null,
        status:                  get("Status") || "",
        kmZumKunden:             helpers.num(get("KmZumKunden")),
        archiviert:              helpers.bool(get("Archiviert")),
        ansatzEinsatz:           helpers.num(get("AnsatzEinsatz")),
        ansatzHalbtag:           helpers.num(get("AnsatzHalbtag")),
        ansatzCoEinsatz:         helpers.num(get("AnsatzCoEinsatz")),
        ansatzCoHalbtag:         helpers.num(get("AnsatzCoHalbtag")),
        ansatzStunde:            helpers.num(get("AnsatzStunde")),
        ansatzStueck:            helpers.num(get("AnsatzStueck")),
        ansatzPauschale:         helpers.num(get("AnsatzPauschale")),
        ansatzKonzeption:        helpers.num(get("AnsatzKonzeption")),
        ansatzAdmin:             helpers.num(get("AnsatzAdmin")),
        ansatzKmSpesen:          helpers.num(get("AnsatzKmSpesen")),
        spesenKontoNr:           get("SpesenKontoNr") || "",
        konzeptionsrahmenTage:   helpers.num(get("KonzeptionsrahmenTage"))
      };
      // Abgeleitete Werte
      p.firmaName          = helpers.firmName(p.firmaLookupId);
      p.ansprechpartner    = helpers.contactName(p.ansprechpartnerLookupId);
      p.einsaetze          = state.data.einsaetze.filter(e => Number(e["ProjektLookupId"] || e["ProjektId"]) === p.id);
      p.konzeptionEintraege= state.data.konzeption.filter(k => Number(k["ProjektLookupId"] || k["ProjektId"]) === p.id);

      // KPIs
      const aktivEinsaetze = p.einsaetze.filter(e => {
        const s = String(e["Status"] || "").toLowerCase();
        return s !== "abgesagt";
      });
      p.totalBetrag = aktivEinsaetze.reduce((sum, e) => {
        return sum + (helpers.num(e["BetragFinal"]) ?? helpers.num(e["BetragBerechnet"]) ?? 0);
      }, 0);
      p.einsaetzeCount = p.einsaetze.length;
      p.konzeptionStunden = p.konzeptionEintraege.reduce((sum, k) => sum + (helpers.num(k["AufwandStunden"]) || 0), 0);
      p.konzeptionBudgetStunden = p.konzeptionsrahmenTage ? p.konzeptionsrahmenTage * 8 : null;
      return p;
    },

    einsatz(raw) {
      const get = (spName) => raw[spName] ?? null;
      const e = {
        id:             Number(raw.id),
        title:          get("Title") || "",
        datum:          get("Datum"),
        projektLookupId:Number(raw["ProjektLookupId"] || raw["ProjektId"] || 0) || null,
        ort:            get("Ort") || "",
        personLookupId: Number(raw["PersonLookupId"] || raw["PersonId"] || 0) || null,
        coPersonLookupId:Number(raw["CoPersonLookupId"] || raw["CoPersonId"] || 0) || null,
        bemerkungen:    get("Bemerkungen") || "",
        kategorie:      get("Kategorie") || "",
        dauerTage:      helpers.num(get("DauerTage")),
        dauerStunden:   helpers.num(get("DauerStunden")),
        anzahlStueck:   helpers.num(get("AnzahlStueck")),
        betragBerechnet:helpers.num(get("BetragBerechnet")),
        betragFinal:    helpers.num(get("BetragFinal")),
        coBetragBerechnet:helpers.num(get("CoBetragBerechnet")),
        coBetragFinal:  helpers.num(get("CoBetragFinal")),
        spesen:         helpers.bool(get("Spesen")),
        spesenZusatz:   helpers.num(get("SpesenZusatz")),
        spesenBerechnet:helpers.num(get("SpesenBerechnet")),
        spesenFinal:    helpers.num(get("SpesenFinal")),
        status:         get("Status") || "",
        abrechnung:     get("Abrechnung") || "offen"
      };
      e.datumFormatted = helpers.formatDate(e.datum);
      e.einsatzStatus  = helpers.einsatzStatus(e);
      e.anzeigeBetrag  = helpers.anzeigebetrag(e.betragBerechnet, e.betragFinal);
      e.projektTitle   = state.data.projekte.find(p => p.id === e.projektLookupId)?.Title || "";
      e.personName     = helpers.contactName(e.personLookupId);
      e.coPersonName   = helpers.contactName(e.coPersonLookupId);
      return e;
    },

    konzeptionEintrag(raw) {
      const get = (spName) => raw[spName] ?? null;
      const k = {
        id:              Number(raw.id),
        title:           get("Title") || "",
        datum:           get("Datum"),
        projektLookupId: Number(raw["ProjektLookupId"] || raw["ProjektId"] || 0) || null,
        kategorie:       get("Kategorie") || "",
        personLookupId:  Number(raw["PersonLookupId"] || raw["PersonId"] || 0) || null,
        aufwandStunden:  helpers.num(get("AufwandStunden")),
        betragBerechnet: helpers.num(get("BetragBerechnet")),
        betragFinal:     helpers.num(get("BetragFinal")),
        verrechenbar:    get("Verrechenbar") || "",
        bemerkungen:     get("Bemerkungen") || ""
      };
      k.datumFormatted = helpers.formatDate(k.datum);
      k.anzeigeBetrag  = helpers.anzeigebetrag(k.betragBerechnet, k.betragFinal);
      k.personName     = helpers.contactName(k.personLookupId);
      k.projektTitle   = state.data.projekte.find(p => p.id === k.projektLookupId)?.Title || "";
      return k;
    }
  };

  // ── UI ───────────────────────────────────────────────────────────────────
  const ui = {
    els: {
      viewRoot:      null,
      authStatus:    null,
      globalMessage: null,
      btnLogin:      null,
      btnRefresh:    null,
      navButtons:    []
    },

    init() {
      this.els.viewRoot      = document.getElementById("view-root");
      this.els.authStatus    = document.getElementById("auth-status");
      this.els.globalMessage = document.getElementById("global-message");
      this.els.btnLogin      = document.getElementById("btn-login");
      this.els.btnRefresh    = document.getElementById("btn-refresh");
      this.els.navButtons    = [...document.querySelectorAll(".tm-nav-btn")];

      if (this.els.btnLogin)   this.els.btnLogin.addEventListener("click",   () => controller.handleLogin());
      if (this.els.btnRefresh) this.els.btnRefresh.addEventListener("click", () => controller.handleRefresh());

      this.els.navButtons.forEach(btn => {
        btn.addEventListener("click", () => controller.navigate(btn.dataset.route));
      });

      // Zentraler Click-Handler
      document.addEventListener("click", e => {
        const a = (sel) => e.target.closest(sel);

        if (a("[data-action='open-projekt']"))       { controller.openProjekt(a("[data-action='open-projekt']").dataset.id); return; }
        if (a("[data-action='back-to-projekte']"))   { controller.navigate("projekte"); return; }
        if (a("[data-action='new-einsatz']"))        { controller.openEinsatzForm(null, a("[data-action='new-einsatz']").dataset.projektId); return; }
        if (a("[data-action='new-konzeption']"))     { controller.openKonzeptionForm(null, a("[data-action='new-konzeption']").dataset.projektId); return; }
        if (a("[data-action='edit-einsatz']"))       { controller.openEinsatzForm(a("[data-action='edit-einsatz']").dataset.id); return; }
        if (a("[data-action='edit-konzeption']"))    { controller.openKonzeptionForm(a("[data-action='edit-konzeption']").dataset.id); return; }
        if (a("[data-action='copy-einsatz']"))       { controller.copyEinsatz(a("[data-action='copy-einsatz']").dataset.id); return; }
        if (a("[data-action='new-projekt']"))        { controller.openProjektForm(null); return; }
        if (a("[data-action='edit-projekt']"))       { controller.openProjektForm(a("[data-action='edit-projekt']").dataset.id); return; }
        if (a("[data-close-modal]"))                 { controller.closeModal(); return; }
        if (a(".tm-tab[data-tab]")) {
          const tab = a(".tm-tab[data-tab]");
          controller.setTab(tab.dataset.route, tab.dataset.tab);
          return;
        }
        if (a(".tm-modal-backdrop") && !a(".tm-modal")) { controller.closeModal(); return; }
      });
    },

    setNav(route) {
      this.els.navButtons.forEach(b => b.classList.toggle("active", b.dataset.route === route));
    },

    setLoading(v) {
      state.meta.loading = v;
      if (this.els.btnRefresh) this.els.btnRefresh.style.display = v ? "none" : "";
    },

    setMessage(msg, type = "info") {
      const el = this.els.globalMessage;
      if (!el) return;
      if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
      el.textContent = msg;
      el.className = `tm-global-message ${type}`;
      el.style.display = "block";
      if (type === "success") setTimeout(() => ui.setMessage(""), 3000);
    },

    setAuthStatus(name) {
      if (this.els.authStatus) this.els.authStatus.textContent = name || "";
      if (this.els.btnLogin)   this.els.btnLogin.style.display  = name ? "none" : "";
      if (this.els.btnRefresh) this.els.btnRefresh.style.display = name ? "" : "none";
    },

    render(html) {
      if (this.els.viewRoot) this.els.viewRoot.innerHTML = html;
    },

    renderModal(html) {
      let backdrop = document.getElementById("tm-modal-backdrop");
      if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "tm-modal-backdrop";
        backdrop.className = "tm-modal-backdrop";
        document.body.appendChild(backdrop);
      }
      backdrop.innerHTML = html;
      backdrop.style.display = "flex";
    },

    closeModal() {
      const el = document.getElementById("tm-modal-backdrop");
      if (el) { el.style.display = "none"; el.innerHTML = ""; }
    },

    empty(msg = "Keine Einträge vorhanden.") {
      return `<div class="tm-empty"><div class="tm-empty-icon">📋</div><div class="tm-empty-text">${helpers.esc(msg)}</div></div>`;
    }
  };

  // ── VIEWS ─────────────────────────────────────────────────────────────────
  const views = {

    // ── Projektliste ────────────────────────────────────────────────────────
    projekte() {
      const f = state.filters.projekte;
      let list = state.enriched.projekte.filter(p => !p.archiviert);
      if (f.search)  list = list.filter(p => helpers.textIncludes(p.title, f.search) || helpers.textIncludes(p.firmaName, f.search));
      if (f.status)  list = list.filter(p => p.status === f.status);

      const cards = list.map(p => {
        const budgetPct = p.konzeptionBudgetStunden ? Math.round(p.konzeptionStunden / p.konzeptionBudgetStunden * 100) : null;
        const budgetBar = budgetPct !== null
          ? `<div class="tm-budget-bar" style="margin-top:8px"><div class="tm-budget-fill ${budgetPct >= 100 ? "over" : budgetPct >= 80 ? "warn" : ""}" style="width:${Math.min(budgetPct,100)}%"></div></div><div style="font-size:11px;color:var(--tm-text-muted);margin-top:3px">Konzeption ${p.konzeptionStunden.toFixed(1)} / ${p.konzeptionBudgetStunden} h</div>`
          : "";
        return `
          <div class="tm-proj-card" data-action="open-projekt" data-id="${p.id}">
            <div class="tm-proj-name">${helpers.esc(p.title)}</div>
            <div class="tm-proj-firm">${helpers.esc(p.firmaName)}${p.projektNr ? ` · #${helpers.esc(p.projektNr)}` : ""} · ${helpers.projektStatusBadge(p.status)}</div>
            <div class="tm-proj-stats">
              <div class="tm-proj-stat"><strong class="tm-chf">CHF ${helpers.formatChf(p.totalBetrag)}</strong>Umsatz</div>
              <div class="tm-proj-stat"><strong>${p.einsaetzeCount}</strong>Einsätze</div>
              ${p.konzeptionBudgetStunden ? `<div class="tm-proj-stat"><strong>${p.konzeptionStunden.toFixed(1)} h</strong>Konzeption</div>` : ""}
            </div>
            ${budgetBar}
          </div>`;
      }).join("");

      ui.render(`
        <div class="tm-page-header">
          <div>
            <div class="tm-page-title">Projekte</div>
            <div class="tm-page-meta">${list.length} aktive Projekte</div>
          </div>
          <div class="tm-page-actions">
            <button class="tm-btn tm-btn-sm" data-action="new-projekt">+ Projekt</button>
          </div>
        </div>
        <div class="tm-filter-bar">
          <input type="search" placeholder="Suche Projekt oder Firma…" value="${helpers.esc(f.search)}" oninput="state.filters.projekte.search=this.value;controller.render()">
          <select onchange="state.filters.projekte.status=this.value;controller.render()">
            <option value="">Alle Status</option>
            ${["geplant","aktiv","abgeschlossen"].map(s => `<option value="${s}" ${f.status===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${list.length ? `<div class="tm-proj-grid">${cards}</div>` : ui.empty("Keine Projekte gefunden.")}
      `);
    },

    // ── Projektdetail ───────────────────────────────────────────────────────
    projektDetail(projektId) {
      const p = state.enriched.projekte.find(p => p.id === projektId);
      if (!p) { ui.render(`<p>Projekt nicht gefunden.</p>`); return; }

      const activeTab = state.filters.activeTab["projekt-detail"] || "einsaetze";

      const budgetPct = p.konzeptionBudgetStunden ? Math.round(p.konzeptionStunden / p.konzeptionBudgetStunden * 100) : null;
      const budgetBar = budgetPct !== null ? `
        <div class="tm-budget-bar-wrap">
          <div class="tm-budget-labels">
            <span>Konzeptionsbudget: ${p.konzeptionStunden.toFixed(1)} / ${p.konzeptionBudgetStunden} h (${budgetPct}%)</span>
            <span style="color:${budgetPct >= 100 ? "var(--tm-red)" : budgetPct >= 80 ? "var(--tm-amber)" : "var(--tm-green)"}">${budgetPct >= 100 ? "⚠ überschritten" : budgetPct >= 80 ? "⚠ Achtung" : "im Rahmen"}</span>
          </div>
          <div class="tm-budget-bar"><div class="tm-budget-fill ${budgetPct >= 100 ? "over" : budgetPct >= 80 ? "warn" : ""}" style="width:${Math.min(budgetPct,100)}%"></div></div>
        </div>` : "";

      const kpiRow = `
        <div class="tm-kpi-row">
          <div class="tm-kpi"><div class="tm-kpi-label">Total Umsatz</div><div class="tm-kpi-value tm-chf">CHF ${helpers.formatChf(p.totalBetrag)}</div></div>
          <div class="tm-kpi"><div class="tm-kpi-label">Einsätze</div><div class="tm-kpi-value">${p.einsaetzeCount}</div></div>
          ${p.konzeptionBudgetStunden ? `<div class="tm-kpi"><div class="tm-kpi-label">Konzeption</div><div class="tm-kpi-value ${budgetPct >= 100 ? "red" : budgetPct >= 80 ? "amber" : "green"}">${p.konzeptionStunden.toFixed(1)} h</div><div class="tm-kpi-sub">von ${p.konzeptionBudgetStunden} h Budget</div></div>` : ""}
        </div>`;

      // Tab: Einsätze
      const einsaetzeHtml = (() => {
        const list = p.einsaetze.map(raw => enrich.einsatz(raw));
        list.sort((a,b) => helpers.toDate(b.datum) - helpers.toDate(a.datum));
        if (!list.length) return ui.empty("Noch keine Einsätze erfasst.");
        return `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung</th><th>Kategorie</th><th>Person</th><th>Betrag</th><th>Status</th><th>Abrechnung</th><th></th></tr></thead>
          <tbody>${list.map(e => `
            <tr class="${e.einsatzStatus === "abgesagt" || e.einsatzStatus === "abgesagt-chf" ? "cancelled" : ""}">
              <td class="tm-nowrap">${helpers.esc(e.datumFormatted)}</td>
              <td>${helpers.esc(e.title)}</td>
              <td class="tm-muted">${helpers.esc(e.kategorie)}</td>
              <td class="tm-muted">${helpers.esc(e.personName)}</td>
              <td class="tm-right tm-chf">${e.anzeigeBetrag !== null ? helpers.formatChf(e.anzeigeBetrag) : "—"}</td>
              <td>${helpers.einsatzStatusBadge(e)}</td>
              <td>${helpers.abrechnungBadge(e.abrechnung)}</td>
              <td><div class="tm-actions">
                <button class="tm-btn tm-btn-sm" data-action="edit-einsatz" data-id="${e.id}">✎</button>
                <button class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${e.id}" title="Duplizieren">⧉</button>
              </div></td>
            </tr>`).join("")}
          </tbody></table></div>`;
      })();

      // Tab: Konzeption
      const konzeptionHtml = (() => {
        const list = p.konzeptionEintraege.map(raw => enrich.konzeptionEintrag(raw));
        list.sort((a,b) => helpers.toDate(b.datum) - helpers.toDate(a.datum));
        if (!list.length) return ui.empty("Noch keine Konzeptionsaufwände erfasst.");
        return `
          <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
            <button class="tm-btn tm-btn-sm">Export Anlage</button>
          </div>
          <div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung</th><th>Kategorie</th><th>Person</th><th>Stunden</th><th>Betrag</th><th>Verrechenbar</th><th></th></tr></thead>
          <tbody>${list.map(k => `
            <tr>
              <td class="tm-nowrap">${helpers.esc(k.datumFormatted)}</td>
              <td>${helpers.esc(k.title)}</td>
              <td class="tm-muted">${helpers.esc(k.kategorie)}</td>
              <td class="tm-muted">${helpers.esc(k.personName)}</td>
              <td class="tm-right">${k.aufwandStunden !== null ? k.aufwandStunden.toFixed(1) : "—"}</td>
              <td class="tm-right tm-chf">${k.anzeigeBetrag !== null ? helpers.formatChf(k.anzeigeBetrag) : "—"}</td>
              <td>${helpers.verrechenbarBadge(k.verrechenbar)}</td>
              <td><div class="tm-actions"><button class="tm-btn tm-btn-sm" data-action="edit-konzeption" data-id="${k.id}">✎</button></div></td>
            </tr>`).join("")}
          </tbody></table></div>`;
      })();

      // Tab: Stammdaten
      const stammdatenHtml = `
        <div class="tm-form-wrap" style="max-width:100%">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--tm-text-muted);margin-bottom:8px">Stammdaten</div>
              ${[
                ["Projekt-Nr.", p.projektNr || "—"],
                ["Firma", p.firmaName],
                ["Ansprechpartner", p.ansprechpartner],
                ["Status", p.status],
                ["Km zum Kunden", p.kmZumKunden !== null ? `${p.kmZumKunden} km` : "—"],
                ["Konzeptionsrahmen", p.konzeptionsrahmenTage !== null ? `${p.konzeptionsrahmenTage} Tage (${p.konzeptionsrahmenTage * 8} h)` : "—"]
              ].map(([l,v]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--tm-blue-pale)"><span style="color:var(--tm-text-muted)">${l}</span><span style="font-weight:500">${helpers.esc(String(v))}</span></div>`).join("")}
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--tm-text-muted);margin-bottom:8px">Ansätze CHF</div>
              ${[
                ["Einsatz (Tag)", p.ansatzEinsatz],
                ["Einsatz (Halbtag)", p.ansatzHalbtag],
                ["Co-Einsatz (Tag)", p.ansatzCoEinsatz],
                ["Stunde", p.ansatzStunde],
                ["Konzeption / Tag", p.ansatzKonzeption],
                ["Admin / Tag", p.ansatzAdmin],
                ["Km-Spesen / km", p.ansatzKmSpesen]
              ].filter(([,v]) => v !== null).map(([l,v]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--tm-blue-pale)"><span style="color:var(--tm-text-muted)">${l}</span><span style="font-weight:500">${helpers.formatChf(v)}</span></div>`).join("")}
            </div>
          </div>
        </div>`;

      const tabContent = { einsaetze: einsaetzeHtml, konzeption: konzeptionHtml, stammdaten: stammdatenHtml };

      ui.render(`
        <div class="tm-page-header">
          <div>
            <button class="tm-btn tm-btn-sm" data-action="back-to-projekte" style="margin-bottom:8px">← Projekte</button>
            <div class="tm-page-title">${helpers.esc(p.title)}</div>
            <div class="tm-page-meta">${helpers.esc(p.firmaName)}${p.projektNr ? ` · #${helpers.esc(p.projektNr)}` : ""} · ${helpers.projektStatusBadge(p.status)}</div>
          </div>
          <div class="tm-page-actions">
            <button class="tm-btn tm-btn-sm" data-action="edit-projekt" data-id="${p.id}">Bearbeiten</button>
            <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-einsatz" data-projekt-id="${p.id}">+ Einsatz</button>
            <button class="tm-btn tm-btn-sm" data-action="new-konzeption" data-projekt-id="${p.id}">+ Aufwand</button>
          </div>
        </div>
        ${kpiRow}
        ${budgetBar}
        <div class="tm-tabs">
          ${["einsaetze","konzeption","stammdaten"].map(t => `<div class="tm-tab${activeTab===t?" active":""}" data-tab="${t}" data-route="projekt-detail">${{einsaetze:"Einsätze",konzeption:"Konzeption",stammdaten:"Stammdaten & Ansätze"}[t]}</div>`).join("")}
        </div>
        ${tabContent[activeTab] || ""}
      `);
    },

    // ── Alle Einsätze ───────────────────────────────────────────────────────
    einsaetze() {
      const f = state.filters.einsaetze;
      let list = [...state.enriched.einsaetze];
      if (f.search)       list = list.filter(e => helpers.textIncludes(e.title, f.search) || helpers.textIncludes(e.projektTitle, f.search));
      if (f.abrechnung)   list = list.filter(e => e.abrechnung === f.abrechnung);
      if (f.einsatzStatus) list = list.filter(e => e.einsatzStatus === f.einsatzStatus);
      list.sort((a,b) => helpers.toDate(b.datum) - helpers.toDate(a.datum));

      const rows = list.map(e => `
        <tr class="${e.einsatzStatus === "abgesagt" || e.einsatzStatus === "abgesagt-chf" ? "cancelled" : ""}">
          <td class="tm-nowrap">${helpers.esc(e.datumFormatted)}</td>
          <td><div style="font-weight:500">${helpers.esc(e.title)}</div><div style="font-size:11px;color:var(--tm-text-muted)">${helpers.esc(e.projektTitle)}</div></td>
          <td class="tm-muted">${helpers.esc(e.kategorie)}</td>
          <td class="tm-right tm-chf">${e.anzeigeBetrag !== null ? helpers.formatChf(e.anzeigeBetrag) : "—"}</td>
          <td>${helpers.einsatzStatusBadge(e)}</td>
          <td>${helpers.abrechnungBadge(e.abrechnung)}</td>
          <td><div class="tm-actions">
            <button class="tm-btn tm-btn-sm" data-action="edit-einsatz" data-id="${e.id}">✎</button>
            <button class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${e.id}" title="Duplizieren">⧉</button>
          </div></td>
        </tr>`).join("");

      ui.render(`
        <div class="tm-page-header">
          <div>
            <div class="tm-page-title">Alle Einsätze</div>
            <div class="tm-page-meta">${list.length} Einträge</div>
          </div>
          <div class="tm-page-actions">
            <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-einsatz" data-projekt-id="">+ Einsatz</button>
          </div>
        </div>
        <div class="tm-filter-bar">
          <input type="search" placeholder="Suche…" value="${helpers.esc(f.search)}" oninput="state.filters.einsaetze.search=this.value;controller.render()">
          <select onchange="state.filters.einsaetze.abrechnung=this.value;controller.render()">
            <option value="">Abrechnung: alle</option>
            ${["offen","zur Abrechnung","abgerechnet"].map(s => `<option value="${s}" ${f.abrechnung===s?"selected":""}>${s}</option>`).join("")}
          </select>
          <select onchange="state.filters.einsaetze.einsatzStatus=this.value;controller.render()">
            <option value="">Status: alle</option>
            ${["geplant","durchgefuehrt","abgesagt"].map(s => `<option value="${s}" ${f.einsatzStatus===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${list.length ? `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung / Projekt</th><th>Kategorie</th><th>Betrag</th><th>Status</th><th>Abrechnung</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : ui.empty("Keine Einsätze gefunden.")}
      `);
    },

    // ── Alle Konzeption ─────────────────────────────────────────────────────
    konzeption() {
      const f = state.filters.konzeption;
      let list = [...state.enriched.konzeption];
      if (f.search)       list = list.filter(k => helpers.textIncludes(k.title, f.search) || helpers.textIncludes(k.projektTitle, f.search));
      if (f.verrechenbar) list = list.filter(k => k.verrechenbar === f.verrechenbar);
      list.sort((a,b) => helpers.toDate(b.datum) - helpers.toDate(a.datum));

      // KPI-Summen
      const sumFreigegeben = list.filter(k => k.verrechenbar === "zur Abrechnung").reduce((s,k) => s + (k.anzeigeBetrag || 0), 0);
      const sumKlaerung    = list.filter(k => k.verrechenbar === "Klärung nötig").reduce((s,k)  => s + (k.anzeigeBetrag || 0), 0);
      const sumInklusive   = list.filter(k => k.verrechenbar === "Inklusive").reduce((s,k)      => s + (k.anzeigeBetrag || 0), 0);

      const rows = list.map(k => `
        <tr>
          <td class="tm-nowrap">${helpers.esc(k.datumFormatted)}</td>
          <td><div style="font-weight:500">${helpers.esc(k.title)}</div><div style="font-size:11px;color:var(--tm-text-muted)">${helpers.esc(k.projektTitle)}</div></td>
          <td class="tm-muted">${helpers.esc(k.kategorie)}</td>
          <td class="tm-muted">${helpers.esc(k.personName)}</td>
          <td class="tm-right">${k.aufwandStunden !== null ? k.aufwandStunden.toFixed(1) + " h" : "—"}</td>
          <td class="tm-right tm-chf">${k.anzeigeBetrag !== null ? helpers.formatChf(k.anzeigeBetrag) : "—"}</td>
          <td>${helpers.verrechenbarBadge(k.verrechenbar)}</td>
          <td><div class="tm-actions"><button class="tm-btn tm-btn-sm" data-action="edit-konzeption" data-id="${k.id}">✎</button></div></td>
        </tr>`).join("");

      ui.render(`
        <div class="tm-page-header">
          <div>
            <div class="tm-page-title">Konzeption & Admin</div>
            <div class="tm-page-meta">${list.length} Einträge</div>
          </div>
          <div class="tm-page-actions">
            <button class="tm-btn tm-btn-sm">Export Anlage</button>
            <button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-konzeption" data-projekt-id="">+ Aufwand</button>
          </div>
        </div>
        <div class="tm-kpi-row" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:16px">
          <div class="tm-kpi"><div class="tm-kpi-label">Zur Abrechnung</div><div class="tm-kpi-value green tm-chf">CHF ${helpers.formatChf(sumFreigegeben)}</div></div>
          <div class="tm-kpi"><div class="tm-kpi-label">In Klärung</div><div class="tm-kpi-value amber tm-chf">CHF ${helpers.formatChf(sumKlaerung)}</div></div>
          <div class="tm-kpi"><div class="tm-kpi-label">Inklusive</div><div class="tm-kpi-value tm-chf">CHF ${helpers.formatChf(sumInklusive)}</div></div>
        </div>
        <div class="tm-filter-bar">
          <input type="search" placeholder="Suche…" value="${helpers.esc(f.search)}" oninput="state.filters.konzeption.search=this.value;controller.render()">
          <select onchange="state.filters.konzeption.verrechenbar=this.value;controller.render()">
            <option value="">Verrechenbar: alle</option>
            ${["Inklusive","Klärung nötig","zur Abrechnung","abgerechnet"].map(s => `<option value="${s}" ${f.verrechenbar===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${list.length ? `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung / Projekt</th><th>Kategorie</th><th>Person</th><th>Aufwand</th><th>Betrag</th><th>Verrechenbar</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : ui.empty("Keine Konzeptionsaufwände gefunden.")}
      `);
    }
  };

  // ── CONTROLLER ────────────────────────────────────────────────────────────
  const controller = {
    render() {
      const route = state.filters.route;
      ui.setNav(["projekte","einsaetze","konzeption"].includes(route) ? route : "projekte");
      ui.setMessage("");

      if (route === "projekte")       { views.projekte(); return; }
      if (route === "projekt-detail") { views.projektDetail(state.selection.projektId); return; }
      if (route === "projekt-form")   { return; }
      if (route === "einsaetze")      { views.einsaetze(); return; }
      if (route === "konzeption")     { views.konzeption(); return; }

      ui.render(`<p class="tm-muted">Route nicht gefunden: ${helpers.esc(route)}</p>`);
    },

    navigate(route) {
      state.filters.route = route;
      if (route !== "projekt-detail") state.selection.projektId = null;
      this.render();
    },

    openProjekt(id) {
      state.selection.projektId = Number(id);
      state.filters.route = "projekt-detail";
      this.render();
    },

    setTab(route, tab) {
      state.filters.activeTab[route] = tab;
      this.render();
    },

    openEinsatzForm(id, projektId) {
      const einsatz = id ? state.enriched.einsaetze.find(e => e.id === Number(id)) : null;
      const prefProjektId = projektId ? Number(projektId) : (einsatz?.projektLookupId || null);
      const titel = id ? "Einsatz bearbeiten" : "Einsatz erfassen";

      const projektOptionen = state.enriched.projekte
        .filter(p => !p.archiviert)
        .map(p => `<option value="${p.id}" ${prefProjektId === p.id ? "selected" : ""}>${helpers.esc(p.title)}${p.projektNr ? ` (#${p.projektNr})` : ""}</option>`)
        .join("");

      const selProjekt = prefProjektId ? state.enriched.projekte.find(p => p.id === prefProjektId) : null;
      const kategorien = selProjekt ? helpers.verfuegbareKategorien(selProjekt) : ["Einsatz (Tag)", "Einsatz (Halbtag)", "Stunde", "Pauschale"];
      const selKat = einsatz?.kategorie || "";

      const contactOptionen = state.data.contacts
        .map(c => `<option value="${c.id}" ${(einsatz?.personLookupId === c.id) ? "selected" : ""}>${helpers.esc([c.vorname, c.nachname].filter(Boolean).join(" "))}</option>`)
        .join("");

      ui.renderModal(`
        <div class="tm-modal-backdrop">
          <div class="tm-modal">
            <div class="tm-modal-header">
              <span class="tm-modal-title">${titel}</span>
              <button class="tm-modal-close" data-close-modal>✕</button>
            </div>
            <div class="tm-modal-body">
              <form id="einsatz-form" class="tm-form-grid">
                <input type="hidden" name="itemId" value="${id || ""}">
                <input type="hidden" name="mode" value="${id ? "edit" : "create"}">
                <div class="tm-field"><label>Datum <span class="req">*</span></label><input type="date" name="datum" value="${helpers.esc(einsatz ? helpers.toDateInput(einsatz.datum) : "")}" required></div>
                <div class="tm-field"><label>Projekt <span class="req">*</span></label><select name="projektLookupId" required onchange="controller.onProjektChangeEinsatz(this)"><option value="">— wählen —</option>${projektOptionen}</select></div>
                <div class="tm-field tm-form-full"><label>Kategorie <span class="req">*</span></label>
                  <div class="tm-radio-group" id="kat-group">
                    ${kategorien.map(k => `<div class="tm-radio-btn${selKat===k?" sel":""}" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('kat-hidden').value='${k}';controller.onKategorieChange('${k}')">${helpers.esc(k)}</div>`).join("")}
                  </div>
                  <input type="hidden" id="kat-hidden" name="kategorie" value="${helpers.esc(selKat)}">
                </div>
                <div class="tm-field" id="field-dauer-tage" style="${["Stunde","Stück","Pauschale"].includes(selKat)?"display:none":""}">
                  <label>Dauer</label>
                  <div class="tm-radio-group">
                    <div class="tm-radio-btn${(einsatz?.dauerTage||1)===1?" sel":""}" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('dauer-hidden').value='1'">Ganztag (1.0)</div>
                    <div class="tm-radio-btn${einsatz?.dauerTage===0.5?" sel":""}" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('dauer-hidden').value='0.5'">Halbtag (0.5)</div>
                  </div>
                  <input type="hidden" id="dauer-hidden" name="dauerTage" value="${einsatz?.dauerTage || 1}">
                </div>
                <div class="tm-field" id="field-dauer-stunden" style="${selKat==="Stunde"?"":"display:none"}"><label>Stunden</label><input type="number" name="dauerStunden" min="0.5" step="0.5" value="${einsatz?.dauerStunden || ""}"></div>
                <div class="tm-field" id="field-anzahl-stueck" style="${selKat==="Stück"?"":"display:none"}"><label>Anzahl Stück</label><input type="number" name="anzahlStueck" min="1" step="1" value="${einsatz?.anzahlStueck || ""}"></div>
                <div class="tm-field"><label>Ort</label><input type="text" name="ort" value="${helpers.esc(einsatz?.ort || "")}"></div>
                <div class="tm-field"><label>Person (Lead)</label><select name="personLookupId"><option value="">— keine —</option>${contactOptionen}</select></div>
                <div class="tm-field tm-form-full"><label>Bemerkungen</label><textarea name="bemerkungen">${helpers.esc(einsatz?.bemerkungen || "")}</textarea></div>
                <div class="tm-section-divider">Beträge</div>
                <div class="tm-field"><label>Betrag berechnet</label><div class="tm-computed" id="betrag-preview">—</div><div class="tm-hint">Wird beim Speichern eingefroren</div></div>
                <div class="tm-field"><label>Betrag final (optional)</label><input type="number" name="betragFinal" step="0.01" value="${einsatz?.betragFinal ?? ""}"></div>
                <div class="tm-section-divider">Status</div>
                <div class="tm-field"><label>Abrechnung <span class="req">*</span></label>
                  <select name="abrechnung">
                    ${["offen","zur Abrechnung","abgerechnet"].map(s => `<option value="${s}" ${(einsatz?.abrechnung||"offen")===s?"selected":""}>${s}</option>`).join("")}
                  </select>
                </div>
                <div class="tm-field"><label>Status</label>
                  <select name="status">
                    <option value="">—</option>
                    ${["abgesagt","abgesagt mit Kostenfolge"].map(s => `<option value="${s}" ${einsatz?.status===s?"selected":""}>${s}</option>`).join("")}
                  </select>
                </div>
                <div class="tm-form-actions tm-form-full">
                  <button type="button" class="tm-btn" data-close-modal>Abbrechen</button>
                  <button type="submit" class="tm-btn tm-btn-primary">Speichern</button>
                </div>
              </form>
            </div>
          </div>
        </div>`);

      document.getElementById("einsatz-form").addEventListener("submit", e => {
        e.preventDefault();
        controller.handleEinsatzSubmit(new FormData(e.target));
      });
    },

    onProjektChangeEinsatz(sel) {
      // Kategorien neu rendern wenn Projekt wechselt — vereinfacht: Seite neu öffnen
      const projektId = Number(sel.value);
      const projekt = state.enriched.projekte.find(p => p.id === projektId);
      const kategorien = projekt ? helpers.verfuegbareKategorien(projekt) : [];
      const group = document.getElementById("kat-group");
      if (group) {
        group.innerHTML = kategorien.map(k =>
          `<div class="tm-radio-btn" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('kat-hidden').value='${k}'">${helpers.esc(k)}</div>`
        ).join("");
      }
    },

    onKategorieChange(kat) {
      document.getElementById("field-dauer-tage").style.display    = ["Stunde","Stück","Pauschale"].includes(kat) ? "none" : "";
      document.getElementById("field-dauer-stunden").style.display = kat === "Stunde" ? "" : "none";
      document.getElementById("field-anzahl-stueck").style.display = kat === "Stück"  ? "" : "none";
    },

    async handleEinsatzSubmit(fd) {
      ui.setMessage("Wird gespeichert…", "info");
      try {
        const mode    = fd.get("mode");
        const itemId  = fd.get("itemId");
        const datum   = fd.get("datum");
        const projektLookupId = Number(fd.get("projektLookupId"));
        const kategorie       = fd.get("kategorie");
        const dauerTage       = helpers.num(fd.get("dauerTage"));
        const dauerStunden    = helpers.num(fd.get("dauerStunden"));
        const anzahlStueck    = helpers.num(fd.get("anzahlStueck"));

        if (!datum)          throw new Error("Datum ist ein Pflichtfeld.");
        if (!projektLookupId) throw new Error("Bitte ein Projekt wählen.");
        if (!kategorie)      throw new Error("Bitte eine Kategorie wählen.");

        const titel = fd.get("titel") || kategorie;  // Title = Kategorie als Fallback
        const projekt = state.enriched.projekte.find(p => p.id === projektLookupId);

        // Betrag berechnen (einfrieren)
        const betragBerechnet = mode === "create" || !itemId
          ? helpers.berechneBetrag(projekt, kategorie, dauerTage, dauerStunden, anzahlStueck)
          : helpers.num(fd.get("betragBerechnet_existing")); // bei Edit: behalten

        const fields = {
          Title:             fd.get("titel") || `${kategorie} · ${datum}`,
          Datum:             datum + "T12:00:00Z",
          ProjektLookupId:   projektLookupId,
          Ort:               fd.get("ort") || null,
          PersonLookupId:    helpers.num(fd.get("personLookupId")) || null,
          Bemerkungen:       fd.get("bemerkungen") || null,
          Kategorie:         kategorie,
          DauerTage:         ["Einsatz (Tag)","Co-Einsatz (Tag)"].includes(kategorie) ? 1.0
                           : ["Einsatz (Halbtag)","Co-Einsatz (Halbtag)"].includes(kategorie) ? 0.5 : null,
          DauerStunden:      kategorie === "Stunde" ? dauerStunden : null,
          AnzahlStueck:      kategorie === "Stück"  ? anzahlStueck : null,
          BetragBerechnet:   betragBerechnet,
          BetragFinal:       helpers.num(fd.get("betragFinal")),
          Abrechnung:        fd.get("abrechnung") || "offen",
          Status:            fd.get("status") || null
        };

        if (mode === "edit" && itemId) {
          await api.patchItem(CONFIG.lists.einsaetze, Number(itemId), fields);
        } else {
          const created = await api.postItem(CONFIG.lists.einsaetze, { Title: fields.Title, ProjektLookupId: projektLookupId });
          const newId = created?.id || created?.fields?.id;
          if (!newId) throw new Error("Neue Item-ID fehlt.");
          delete fields.Title;
          delete fields.ProjektLookupId;
          await api.patchItem(CONFIG.lists.einsaetze, Number(newId), fields);
        }

        ui.closeModal();
        ui.setMessage("Einsatz gespeichert.", "success");
        await api.loadAll();
        controller.render();
      } catch (err) {
        ui.setMessage(err.message || "Fehler beim Speichern.", "error");
      }
    },

    copyEinsatz(id) {
      const e = state.enriched.einsaetze.find(e => e.id === Number(id));
      if (!e) return;
      // Duplizieren: Datum leer, BetragBerechnet/Final nicht kopiert, Abrechnung=offen, Status=leer
      controller.openEinsatzForm(null, e.projektLookupId);
    },

    openKonzeptionForm(id, projektId) {
      const k = id ? state.enriched.konzeption.find(k => k.id === Number(id)) : null;
      const prefProjektId = projektId ? Number(projektId) : (k?.projektLookupId || null);
      const titel = id ? "Aufwand bearbeiten" : "Konzeptionsaufwand erfassen";

      const projektOptionen = state.enriched.projekte.filter(p => !p.archiviert)
        .map(p => `<option value="${p.id}" ${prefProjektId === p.id ? "selected" : ""}>${helpers.esc(p.title)}</option>`)
        .join("");

      const contactOptionen = state.data.contacts
        .map(c => `<option value="${c.id}" ${k?.personLookupId === c.id ? "selected" : ""}>${helpers.esc([c.vorname, c.nachname].filter(Boolean).join(" "))}</option>`)
        .join("");

      ui.renderModal(`
        <div class="tm-modal-backdrop">
          <div class="tm-modal">
            <div class="tm-modal-header">
              <span class="tm-modal-title">${titel}</span>
              <button class="tm-modal-close" data-close-modal>✕</button>
            </div>
            <div class="tm-modal-body">
              <form id="konzeption-form" class="tm-form-grid">
                <input type="hidden" name="itemId" value="${id || ""}">
                <input type="hidden" name="mode" value="${id ? "edit" : "create"}">
                <div class="tm-field"><label>Datum <span class="req">*</span></label><input type="date" name="datum" value="${helpers.esc(k ? helpers.toDateInput(k.datum) : "")}" required></div>
                <div class="tm-field"><label>Projekt <span class="req">*</span></label><select name="projektLookupId" required><option value="">— wählen —</option>${projektOptionen}</select></div>
                <div class="tm-field tm-form-full"><label>Beschreibung (Title) <span class="req">*</span></label><input type="text" name="titel" value="${helpers.esc(k?.title || "")}" required></div>
                <div class="tm-field"><label>Kategorie <span class="req">*</span></label>
                  <div class="tm-radio-group">
                    ${["Konzeption","Admin"].map(kat => `<div class="tm-radio-btn${(k?.kategorie||"Konzeption")===kat?" sel":""}" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('kat-konz-hidden').value='${kat}'">${kat}</div>`).join("")}
                  </div>
                  <input type="hidden" id="kat-konz-hidden" name="kategorie" value="${helpers.esc(k?.kategorie || "Konzeption")}">
                </div>
                <div class="tm-field"><label>Person</label><select name="personLookupId"><option value="">— keine —</option>${contactOptionen}</select></div>
                <div class="tm-field"><label>Aufwand Stunden <span class="req">*</span></label><input type="number" name="aufwandStunden" min="0.25" step="0.25" value="${k?.aufwandStunden || ""}" required></div>
                <div class="tm-field"><label>Betrag berechnet</label><div class="tm-computed">Berechnung nach Speichern</div><div class="tm-hint">Ansatz ÷ 8 × Stunden</div></div>
                <div class="tm-field"><label>Betrag final (optional)</label><input type="number" name="betragFinal" step="0.01" value="${k?.betragFinal ?? ""}"></div>
                <div class="tm-field tm-form-full"><label>Verrechenbar <span class="req">*</span></label>
                  <select name="verrechenbar" required>
                    ${["Inklusive","Klärung nötig","zur Abrechnung","abgerechnet"].map(v => `<option value="${v}" ${(k?.verrechenbar||"Inklusive")===v?"selected":""}>${v}</option>`).join("")}
                  </select>
                </div>
                <div class="tm-field tm-form-full"><label>Bemerkungen</label><textarea name="bemerkungen">${helpers.esc(k?.bemerkungen || "")}</textarea></div>
                <div class="tm-form-actions tm-form-full">
                  <button type="button" class="tm-btn" data-close-modal>Abbrechen</button>
                  <button type="submit" class="tm-btn tm-btn-primary">Speichern</button>
                </div>
              </form>
            </div>
          </div>
        </div>`);

      document.getElementById("konzeption-form").addEventListener("submit", e => {
        e.preventDefault();
        controller.handleKonzeptionSubmit(new FormData(e.target));
      });
    },

    async handleKonzeptionSubmit(fd) {
      ui.setMessage("Wird gespeichert…", "info");
      try {
        const mode    = fd.get("mode");
        const itemId  = fd.get("itemId");
        const datum   = fd.get("datum");
        const projektLookupId = Number(fd.get("projektLookupId"));
        const kategorie       = fd.get("kategorie");
        const aufwandStunden  = helpers.num(fd.get("aufwandStunden"));
        const titelValue      = fd.get("titel") || "";

        if (!datum)            throw new Error("Datum ist ein Pflichtfeld.");
        if (!projektLookupId)  throw new Error("Bitte ein Projekt wählen.");
        if (!titelValue.trim()) throw new Error("Beschreibung ist ein Pflichtfeld.");
        if (!aufwandStunden)   throw new Error("Aufwand Stunden ist ein Pflichtfeld.");

        // Betrag berechnen
        const projekt = state.enriched.projekte.find(p => p.id === projektLookupId);
        let betragBerechnet = null;
        if (projekt && aufwandStunden) {
          const ansatz = kategorie === "Admin" ? projekt.ansatzAdmin : projekt.ansatzKonzeption;
          if (ansatz) betragBerechnet = (ansatz / 8) * aufwandStunden;
        }

        const fields = {
          Datum:           datum + "T12:00:00Z",
          ProjektLookupId: projektLookupId,
          Kategorie:       kategorie,
          PersonLookupId:  helpers.num(fd.get("personLookupId")) || null,
          AufwandStunden:  aufwandStunden,
          BetragBerechnet: betragBerechnet,
          BetragFinal:     helpers.num(fd.get("betragFinal")),
          Verrechenbar:    fd.get("verrechenbar"),
          Bemerkungen:     fd.get("bemerkungen") || null
        };

        if (mode === "edit" && itemId) {
          fields.Title = titelValue;
          await api.patchItem(CONFIG.lists.konzeption, Number(itemId), fields);
        } else {
          const created = await api.postItem(CONFIG.lists.konzeption, { Title: titelValue, ProjektLookupId: projektLookupId });
          const newId = created?.id || created?.fields?.id;
          if (!newId) throw new Error("Neue Item-ID fehlt.");
          await api.patchItem(CONFIG.lists.konzeption, Number(newId), fields);
        }

        ui.closeModal();
        ui.setMessage("Aufwand gespeichert.", "success");
        await api.loadAll();
        controller.render();
      } catch (err) {
        ui.setMessage(err.message || "Fehler beim Speichern.", "error");
      }
    },

    openProjektForm(id) {
      const p = id ? state.enriched.projekte.find(p => p.id === Number(id)) : null;
      const titel = p ? "Projekt bearbeiten" : "Neues Projekt erfassen";

      const firmaOptionen = state.data.firms
        .sort((a,b) => a.title.localeCompare(b.title, "de"))
        .map(f => `<option value="${f.id}" ${p?.firmaLookupId === f.id ? "selected" : ""}>${helpers.esc(f.title)}</option>`)
        .join("");

      const contactOptionen = state.data.contacts
        .sort((a,b) => (a.nachname+a.vorname).localeCompare(b.nachname+b.vorname, "de"))
        .map(c => {
          const name = [c.nachname, c.vorname].filter(Boolean).join(", ");
          return `<option value="${c.id}" ${p?.ansprechpartnerLookupId === c.id ? "selected" : ""}>${helpers.esc(name)}</option>`;
        }).join("");

      const val = (key, fallback = "") => p ? (p[key] ?? fallback) : fallback;
      const chf = (key) => p?.[key] !== null && p?.[key] !== undefined ? p[key] : "";

      state.filters.route = "projekt-form";
      state.modal = { projektId: id ? Number(id) : null };

      ui.render(`
        <div style="max-width:700px;margin:0 auto">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <button class="tm-btn tm-btn-sm" data-action="back-to-projekte">← Projekte</button>
            <div class="tm-page-title">${titel}</div>
          </div>

          <form id="projekt-form">
            <input type="hidden" name="itemId" value="${id || ""}">
            <input type="hidden" name="mode" value="${id ? "edit" : "create"}">

            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">Stammdaten</div>
              <div class="tm-form-grid" style="margin-top:14px">
                <div class="tm-field tm-form-full">
                  <label>Projektname <span class="req">*</span></label>
                  <input type="text" name="title" value="${helpers.esc(val("title"))}" placeholder="z.B. PC-Zertifizierung Leadership" required>
                </div>
                <div class="tm-field">
                  <label>Projekt-Nr.</label>
                  <input type="text" name="projektNr" value="${helpers.esc(val("projektNr"))}">
                </div>
                <div class="tm-field">
                  <label>Konto-Nr. Honorar</label>
                  <input type="text" name="kontoNr" value="${helpers.esc(val("kontoNr"))}" placeholder="z.B. 4210">
                </div>
                <div class="tm-field">
                  <label>Firma <span class="req">*</span></label>
                  <select name="firmaLookupId" required>
                    <option value="">— wählen —</option>
                    ${firmaOptionen}
                  </select>
                </div>
                <div class="tm-field">
                  <label>Ansprechpartner <span class="req">*</span></label>
                  <select name="ansprechpartnerLookupId" required>
                    <option value="">— wählen —</option>
                    ${contactOptionen}
                  </select>
                </div>
                <div class="tm-field">
                  <label>Status <span class="req">*</span></label>
                  <select name="status" required>
                    ${["geplant","aktiv","abgeschlossen"].map(s => `<option value="${s}" ${val("status","aktiv")===s?"selected":""}>${s}</option>`).join("")}
                  </select>
                </div>
                <div class="tm-field">
                  <label>Km zum Kunden</label>
                  <input type="number" name="kmZumKunden" value="${chf("kmZumKunden")}" placeholder="z.B. 28" min="0" step="1">
                  <span class="tm-hint">bbz SG → Kundendomizil (App rechnet ×2 für Hin+Rückfahrt)</span>
                </div>
                <div class="tm-field" style="justify-content:flex-end">
                  <label>&nbsp;</label>
                  <label class="tm-checkbox-row">
                    <input type="checkbox" name="archiviert" ${val("archiviert") ? "checked" : ""}>
                    Archiviert (aus aktiven Ansichten ausblenden)
                  </label>
                </div>
              </div>
            </div>

            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">
                Ansätze CHF
                <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;background:#E1F5EE;color:#085041;padding:2px 8px;border-radius:4px">leer lassen = Kategorie nicht verfügbar</span>
              </div>

              <table style="width:100%;border-collapse:collapse;margin-top:14px">
                <thead>
                  <tr>
                    <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted,#6B7280);text-align:left;padding:0 16px 8px 0;border-bottom:1px solid var(--tm-border,#D1D5DB);width:160px">Kategorie</th>
                    <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted,#6B7280);text-align:left;padding:0 12px 8px;border-bottom:1px solid var(--tm-border,#D1D5DB)">Haupttrainer</th>
                    <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted,#6B7280);text-align:left;padding:0 0 8px 12px;border-bottom:1px solid var(--tm-border,#D1D5DB)">Co-Trainer</th>
                  </tr>
                </thead>
                <tbody>
                  ${[
                    ["Einsatz (Tag)",    "ansatzEinsatz",   "ansatzCoEinsatz"],
                    ["Einsatz (Halbtag)","ansatzHalbtag",   "ansatzCoHalbtag"]
                  ].map(([label, mainKey, coKey]) => `
                    <tr>
                      <td style="font-size:13px;padding:8px 16px 8px 0;border-bottom:1px solid var(--tm-blue-pale,#EBF3FB)">${label}</td>
                      <td style="padding:6px 12px;border-bottom:1px solid var(--tm-blue-pale,#EBF3FB)">
                        <div style="display:flex;align-items:center;border:1px solid var(--tm-border,#D1D5DB);border-radius:6px;overflow:hidden;max-width:140px">
                          <span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border,#D1D5DB)">CHF</span>
                          <input type="number" name="${mainKey}" value="${chf(mainKey)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;width:90px;outline:none;font-family:inherit;color:var(--tm-text,#1F2937)">
                        </div>
                      </td>
                      <td style="padding:6px 0 6px 12px;border-bottom:1px solid var(--tm-blue-pale,#EBF3FB)">
                        <div style="display:flex;align-items:center;border:1px solid var(--tm-border,#D1D5DB);border-radius:6px;overflow:hidden;max-width:140px">
                          <span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border,#D1D5DB)">CHF</span>
                          <input type="number" name="${coKey}" value="${chf(coKey)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;width:90px;outline:none;font-family:inherit;color:var(--tm-text,#1F2937)">
                        </div>
                      </td>
                    </tr>`).join("")}
                </tbody>
              </table>

              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px">
                ${[
                  ["Stunde",          "ansatzStunde",      "CHF / h"],
                  ["Stück",           "ansatzStueck",      "CHF / Stück"],
                  ["Pauschale",       "ansatzPauschale",   "CHF fix"],
                  ["Konzeption / Tag","ansatzKonzeption",  "CHF / Tag"],
                  ["Admin / Tag",     "ansatzAdmin",       "CHF / Tag"],
                  ["Km-Spesen",       "ansatzKmSpesen",    "CHF / km"]
                ].map(([label, key, hint]) => `
                  <div class="tm-field">
                    <label>${label}</label>
                    <div style="display:flex;align-items:center;border:1px solid var(--tm-border,#D1D5DB);border-radius:6px;overflow:hidden">
                      <span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border,#D1D5DB);white-space:nowrap">CHF</span>
                      <input type="number" name="${key}" value="${chf(key)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;flex:1;min-width:0;outline:none;font-family:inherit;color:var(--tm-text,#1F2937)">
                    </div>
                    <span class="tm-hint">${hint}</span>
                  </div>`).join("")}
                <div class="tm-field">
                  <label>Spesen Konto-Nr.</label>
                  <input type="text" name="spesenKontoNr" value="${helpers.esc(val("spesenKontoNr"))}" placeholder="z.B. 6500">
                </div>
              </div>
            </div>

            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">Konzeptionsrahmen</div>
              <div class="tm-form-grid" style="margin-top:14px">
                <div class="tm-field">
                  <label>Vereinbarte Tage</label>
                  <input type="number" name="konzeptionsrahmenTage" value="${chf("konzeptionsrahmenTage")}" placeholder="z.B. 2" min="0" step="0.5"
                    oninput="document.getElementById('konz-h').textContent=(parseFloat(this.value)||0)*8">
                  <span class="tm-hint">App rechnet × 8 = Stunden-Budget</span>
                </div>
                <div class="tm-field" style="justify-content:flex-end">
                  <label>&nbsp;</label>
                  <div style="padding:10px 14px;background:var(--tm-blue-pale,#EBF3FB);border-radius:6px;font-size:13px;color:#6B7280">
                    = <span id="konz-h" style="font-weight:600;color:#1F2937">${(val("konzeptionsrahmenTage",0)||0)*8}</span> Stunden Budget
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

      document.getElementById("projekt-form").addEventListener("submit", e => {
        e.preventDefault();
        controller.handleProjektSubmit(new FormData(e.target));
      });
    },

    async handleProjektSubmit(fd) {
      ui.setMessage("Wird gespeichert…", "info");
      try {
        const mode   = fd.get("mode");
        const itemId = fd.get("itemId");
        const title  = (fd.get("title") || "").trim();
        const firmaLookupId           = helpers.num(fd.get("firmaLookupId"));
        const ansprechpartnerLookupId = helpers.num(fd.get("ansprechpartnerLookupId"));

        if (!title)                    throw new Error("Projektname ist ein Pflichtfeld.");
        if (!firmaLookupId)            throw new Error("Bitte eine Firma wählen.");
        if (!ansprechpartnerLookupId)  throw new Error("Bitte einen Ansprechpartner wählen.");

        const numOpt = (key) => { const v = helpers.num(fd.get(key)); return v !== null ? v : null; };

        const fields = {
          ProjektNr:               fd.get("projektNr") || null,
          KontoNr:                 fd.get("kontoNr") || null,
          FirmaLookupId:           firmaLookupId,
          AnsprechpartnerLookupId: ansprechpartnerLookupId,
          Status:                  fd.get("status") || "aktiv",
          KmZumKunden:             numOpt("kmZumKunden"),
          Archiviert:              fd.get("archiviert") === "on",
          AnsatzEinsatz:           numOpt("ansatzEinsatz"),
          AnsatzHalbtag:           numOpt("ansatzHalbtag"),
          AnsatzCoEinsatz:         numOpt("ansatzCoEinsatz"),
          AnsatzCoHalbtag:         numOpt("ansatzCoHalbtag"),
          AnsatzStunde:            numOpt("ansatzStunde"),
          AnsatzStueck:            numOpt("ansatzStueck"),
          AnsatzPauschale:         numOpt("ansatzPauschale"),
          AnsatzKonzeption:        numOpt("ansatzKonzeption"),
          AnsatzAdmin:             numOpt("ansatzAdmin"),
          AnsatzKmSpesen:          numOpt("ansatzKmSpesen"),
          SpesenKontoNr:           fd.get("spesenKontoNr") || null,
          KonzeptionsrahmenTage:   numOpt("konzeptionsrahmenTage")
        };

        if (mode === "edit" && itemId) {
          fields.Title = title;
          await api.patchItem(CONFIG.lists.projekte, Number(itemId), fields);
        } else {
          const created = await api.postItem(CONFIG.lists.projekte, { Title: title, FirmaLookupId: firmaLookupId });
          const newId = created?.id || created?.fields?.id;
          if (!newId) throw new Error("Neue Item-ID fehlt.");
          await api.patchItem(CONFIG.lists.projekte, Number(newId), fields);
        }

        ui.setMessage("Projekt gespeichert.", "success");
        await api.loadAll();
        controller.navigate("projekte");
      } catch (err) {
        ui.setMessage(err.message || "Fehler beim Speichern.", "error");
      }
    },

    closeModal() {
      state.modal = null;
      ui.closeModal();
    },

    async handleLogin() {
      try {
        const result = await state.auth.msal.loginPopup({ scopes: CONFIG.graph.scopes });
        state.auth.account         = result.account;
        state.auth.isAuthenticated = true;
        ui.setAuthStatus(result.account.name || result.account.username);
        ui.setMessage("Angemeldet. Daten werden geladen…", "info");
        await api.loadAll();
        controller.render();
      } catch (err) {
        ui.setMessage("Anmeldung fehlgeschlagen: " + err.message, "error");
      }
    },

    async handleRefresh() {
      ui.setMessage("Aktualisiere…", "info");
      await api.loadAll();
      controller.render();
    }
  };

  // ── BOOT ──────────────────────────────────────────────────────────────────
  async function boot() {
    try {
      helpers.validateConfig();

      const msalLib = window.msal || window.msalBrowser || window["@azure/msal-browser"];
      if (!msalLib?.PublicClientApplication) throw new Error("MSAL nicht geladen.");

      const msalConfig = {
        auth: {
          clientId:    CONFIG.graph.clientId,
          authority:   CONFIG.graph.authority,
          redirectUri: CONFIG.graph.redirectUri
        },
        cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false }
      };

      state.auth.msal = new msalLib.PublicClientApplication(msalConfig);
      await state.auth.msal.initialize();

      // Redirect-Response verarbeiten
      const response = await state.auth.msal.handleRedirectPromise();
      if (response) {
        state.auth.account = response.account;
      }

      // Bestehende Session prüfen
      const accounts = state.auth.msal.getAllAccounts();
      if (accounts.length > 0) {
        state.auth.account = accounts[0];
      }

      state.auth.isAuthenticated = !!state.auth.account;
      state.auth.isReady = true;

      ui.init();

      if (state.auth.isAuthenticated) {
        ui.setAuthStatus(state.auth.account.name || state.auth.account.username);
        ui.setMessage("Daten werden geladen…", "info");
        await api.loadAll();
        controller.render();
      } else {
        ui.render(`
          <div class="tm-loading-screen" style="flex-direction:column;gap:16px">
            <div style="font-size:40px">📋</div>
            <div style="font-size:18px;font-weight:600;color:var(--tm-blue)">TM-App · bbz st.gallen</div>
            <p style="color:var(--tm-text-muted)">Termin- & Einsatzplanung für Tailormade Projekte</p>
            <button class="tm-btn tm-btn-primary" onclick="controller.handleLogin()">Mit Microsoft anmelden</button>
          </div>`);
        if (document.getElementById("btn-login")) {
          document.getElementById("btn-login").style.display = "";
        }
      }
    } catch (err) {
      document.getElementById("view-root").innerHTML = `
        <div class="tm-loading-screen">
          <div style="color:var(--tm-red);font-size:14px">⚠ Fehler beim Start: ${helpers.esc(err.message)}</div>
        </div>`;
    }
  }

  // Globale Referenzen für Inline-Handler
  window.controller = controller;
  window.state      = state;
  window.helpers    = helpers;

  document.addEventListener("DOMContentLoaded", boot);
})();
