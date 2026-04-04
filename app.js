(() => {
  "use strict";

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
      projekte:   "ProjekteTM",
      einsaetze:  "EinsaetzeTM",
      konzeption: "KonzeptionTM",
      firms:      "CRMFirms",
      contacts:   "CRMContacts"
    }
  };

  // ── SP-Feldnamen (intern, wie von Graph API zurückgegeben beim Lesen = beim Schreiben)
  // BESTÄTIGT via /columns-Abfrage 2026-04-04
  const SP = {
    projekte: {
      title:                   "Title",
      projektNr:               "ProjektNr",
      kontoNr:                 "KontoNr",
      firmaLookupId:           "FirmaLookupId",
      ansprechpartnerLookupId: "AnsprechpartnerLookupId",
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
    },
    einsaetze: {
      title:             "Title",
      datum:             "Datum",
      projektLookupId:   "ProjektLookupId",
      ort:               "Ort",
      personLookupId:    "PersonLookupId",
      coPersonLookupId:  "CoPersonLookupId",
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
    },
    konzeption: {
      title:           "Title",
      datum:           "Datum",
      projektLookupId: "ProjektLookupId",
      kategorie:       "Kategorie",
      personLookupId:  "PersonLookupId",
      aufwandStunden:  "AufwandStunden",
      betragBerechnet: "BetragBerechnet",
      betragFinal:     "BetragFinal",
      verrechenbar:    "Verrechenbar",
      bemerkungen:     "Bemerkungen"
    }
  };

  const state = {
    auth: { msal: null, account: null, token: null, isAuthenticated: false, isReady: false },
    meta: { siteId: null, loading: false },
    data: { projekte: [], einsaetze: [], konzeption: [], firms: [], contacts: [] },
    enriched: { projekte: [], einsaetze: [], konzeption: [] },
    filters: {
      route: "projekte",
      projekte:   { search: "", status: "" },
      einsaetze:  { search: "", abrechnung: "", einsatzStatus: "" },
      konzeption: { search: "", verrechenbar: "" },
      activeTab:  {}
    },
    selection: { projektId: null },
    modal: null
  };

  const h = {
    esc(v) {
      return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    },
    bool(v) {
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v === 1;
      if (typeof v === "string") return ["true","1","ja","yes"].includes(v.trim().toLowerCase());
      return false;
    },
    num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; },
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
      return n === null ? "—" : n.toLocaleString("de-CH",{minimumFractionDigits:2,maximumFractionDigits:2});
    },
    inc(a, b) { return String(a||"").toLowerCase().includes(String(b||"").toLowerCase()); },

    einsatzStatus(e) {
      const s = String(e.status||"").toLowerCase();
      if (s.includes("kostenfolge")) return "abgesagt-chf";
      if (s === "abgesagt") return "abgesagt";
      const d = h.toDate(e.datum);
      return d && d > h.todayStart() ? "geplant" : "durchgefuehrt";
    },

    statusBadge(e) {
      const s = h.einsatzStatus(e);
      const m = {
        "geplant":        ["tm-badge tm-badge-planned","Geplant"],
        "durchgefuehrt":  ["tm-badge tm-badge-done","Durchgeführt"],
        "abgesagt":       ["tm-badge tm-badge-cancelled","Abgesagt"],
        "abgesagt-chf":   ["tm-badge tm-badge-cancelled","Abgesagt (CHF)"]
      };
      const [c,l] = m[s]||["tm-badge",s];
      return `<span class="${c}">${l}</span>`;
    },

    abrBadge(v) {
      const m = {"offen":["tm-badge tm-badge-open","offen"],"zur Abrechnung":["tm-badge tm-badge-billing","zur Abrechnung"],"abgerechnet":["tm-badge tm-badge-billed","abgerechnet"]};
      const [c,l] = m[v]||["tm-badge",h.esc(v||"—")];
      return `<span class="${c}">${l}</span>`;
    },

    verrBadge(v) {
      const m = {"Inklusive":["tm-badge tm-badge-incl","Inklusive"],"Klärung nötig":["tm-badge tm-badge-clarify","Klärung nötig"],"zur Abrechnung":["tm-badge tm-badge-billing","zur Abrechnung"],"abgerechnet":["tm-badge tm-badge-billed","abgerechnet"]};
      const [c,l] = m[v]||["tm-badge",h.esc(v||"—")];
      return `<span class="${c}">${l}</span>`;
    },

    projStatusBadge(v) {
      const m = {"geplant":["tm-badge tm-badge-planned-p","geplant"],"aktiv":["tm-badge tm-badge-active","aktiv"],"abgeschlossen":["tm-badge tm-badge-done-p","abgeschlossen"]};
      const [c,l] = m[v]||["tm-badge",h.esc(v||"—")];
      return `<span class="${c}">${l}</span>`;
    },

    firmName(id) { const f = state.data.firms.find(f=>f.id===id); return f?f.title:(id?`Firma #${id}`:"—"); },
    contactName(id) {
      const c = state.data.contacts.find(c=>c.id===id);
      if (!c) return id?`Person #${id}`:"—";
      return [c.vorname,c.nachname].filter(Boolean).join(" ")||c.nachname||"—";
    },

    // Typeahead
    typeaheadHtml(name, items, selectedId, placeholder="Suchen…", required=false) {
      const sel = items.find(i=>i.id===String(selectedId||""));
      return `<div class="tm-typeahead" data-name="${name}">
        <input type="hidden" name="${name}" value="${h.esc(selectedId||"")}" ${required?"required":""} class="tm-ta-val">
        <input type="text" class="tm-ta-input" placeholder="${h.esc(placeholder)}" value="${h.esc(sel?.label||"")}"
          autocomplete="off"
          oninput="h.taFilter(this)" onfocus="h.taOpen(this)" onblur="setTimeout(()=>h.taClose(this),150)">
        <div class="tm-ta-dd" style="display:none">
          ${items.map(i=>`<div class="tm-ta-item" data-id="${h.esc(i.id)}" onmousedown="h.taSelect(this)">${h.esc(i.label)}</div>`).join("")}
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
      const w = inp.closest(".tm-typeahead"), q = inp.value.toLowerCase(), dd = w.querySelector(".tm-ta-dd");
      let vis=0;
      dd.querySelectorAll(".tm-ta-item").forEach(it=>{const m=it.textContent.toLowerCase().includes(q);it.style.display=m?"block":"none";if(m)vis++;});
      dd.style.display=vis>0?"block":"none";
    },
    taSelect(item) {
      const w = item.closest(".tm-typeahead");
      const val = w.querySelector(".tm-ta-val");
      val.value = item.dataset.id;
      w.querySelector(".tm-ta-input").value = item.textContent.trim();
      w.querySelector(".tm-ta-dd").style.display="none";
      val.dispatchEvent(new Event("change", {bubbles:true}));
    },

    // Verfügbare Einsatz-Kategorien aus Projekt-Ansätzen
    kategorien(p) {
      if (!p) return [];
      const k=[];
      if (p.ansatzEinsatz) { k.push("Einsatz (Tag)"); k.push("Einsatz (Halbtag)"); }
      if (p.ansatzCoEinsatz) { k.push("Co-Einsatz (Tag)"); k.push("Co-Einsatz (Halbtag)"); }
      if (p.ansatzStunde) k.push("Stunde");
      if (p.ansatzStueck) k.push("Stück");
      if (p.ansatzPauschale) k.push("Pauschale");
      return k;
    },

    berechneBetrag(p, kat, dauerTage, dauerStunden, anzahl) {
      if (!p) return null;
      switch(kat) {
        case "Einsatz (Tag)":        return (p.ansatzEinsatz||0) * 1.0;
        case "Einsatz (Halbtag)":    return p.ansatzHalbtag;
        case "Co-Einsatz (Tag)":     return (p.ansatzCoEinsatz||0) * 1.0;
        case "Co-Einsatz (Halbtag)": return p.ansatzCoHalbtag;
        case "Stunde":               return (p.ansatzStunde||0) * (dauerStunden||0);
        case "Stück":                return (p.ansatzStueck||0) * (anzahl||0);
        case "Pauschale":            return p.ansatzPauschale;
        default: return null;
      }
    },

    // nur nicht-null/nicht-leer Felder in fields-Objekt setzen
    setIf(fields, key, val) { if (val !== null && val !== undefined && val !== "") fields[key] = val; }
  };

  // Globale Referenzen für Inline-Handler
  window.h = h;

  // ── ENRICH ──────────────────────────────────────────────────────────────
  function enrichProjekt(raw) {
    const g = k => raw[SP.projekte[k]] ?? raw[SP.projekte[k]+"LookupId"] ?? null;
    const p = {
      id:                      Number(raw.id),
      title:                   raw.Title || "",
      projektNr:               raw.ProjektNr || "",
      kontoNr:                 raw.KontoNr || "",
      firmaLookupId:           Number(raw.FirmaLookupIdLookupId||raw.FirmaLookupId||0)||null,
      ansprechpartnerLookupId: Number(raw.AnsprechpartnerLookupIdLookupId||raw.AnsprechpartnerLookupId||0)||null,
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
    p.firmaName        = h.firmName(p.firmaLookupId);
    p.ansprechpartner  = h.contactName(p.ansprechpartnerLookupId);
    p.einsaetze        = state.data.einsaetze.filter(e=>Number(e.ProjektLookupIdLookupId||e.ProjektLookupId||0)===p.id);
    p.konzeintraege    = state.data.konzeption.filter(k=>Number(k.ProjektLookupIdLookupId||k.ProjektLookupId||0)===p.id);
    const aktiv        = p.einsaetze.filter(e=>!String(e.Status||"").toLowerCase().includes("abgesagt"));
    p.totalBetrag      = aktiv.reduce((s,e)=>s+(h.num(e.BetragFinal)??h.num(e.BetragBerechnet)??0),0);
    p.einsaetzeCount   = p.einsaetze.length;
    p.konzStunden      = p.konzeintraege.reduce((s,k)=>s+(h.num(k.AufwandStunden)||0),0);
    p.konzBudgetH      = p.konzeptionsrahmenTage ? p.konzeptionsrahmenTage * 8 : null;
    return p;
  }

  function enrichEinsatz(raw) {
    const e = {
      id:             Number(raw.id),
      title:          raw.Title || "",
      datum:          raw.Datum,
      projektLookupId:Number(raw.ProjektLookupIdLookupId||raw.ProjektLookupId||0)||null,
      ort:            raw.Ort || "",
      personLookupId: Number(raw.PersonLookupIDLookupId||raw.PersonLookupID||raw.PersonLookupId||0)||null,
      coPersonLookupId:Number(raw.CoPersonLookupIdLookupId||raw.CoPersonLookupId||0)||null,
      bemerkungen:    raw.Bemerkungen || "",
      kategorie:      raw.Kategorie || "",
      dauerTage:      h.num(raw.DauerTage),
      dauerStunden:   h.num(raw.DauerStunden),
      anzahlStueck:   h.num(raw.AnzahlStueck),
      betragBerechnet:h.num(raw.BetragBerechnet),
      betragFinal:    h.num(raw.BetragFinal),
      coBetragBerechnet:h.num(raw.CoBetragBerechnet),
      coBetragFinal:  h.num(raw.CoBetragFinal),
      spesen:         h.bool(raw.Spesen),
      spesenZusatz:   h.num(raw.SpesenZusatz),
      spesenBerechnet:h.num(raw.SpesenBerechnet),
      spesenFinal:    h.num(raw.SpesenFinal),
      status:         raw.Status || "",
      abrechnung:     raw.Abrechnung || "offen"
    };
    e.datumFmt     = h.fmtDate(e.datum);
    e.einsatzStatus = h.einsatzStatus(e);
    e.anzeigeBetrag = h.num(e.betragFinal) ?? h.num(e.betragBerechnet);
    e.projektTitle  = state.data.projekte.find(p=>Number(p.id)===e.projektLookupId)?.Title || "";
    e.personName    = h.contactName(e.personLookupId);
    return e;
  }

  function enrichKonzeption(raw) {
    const k = {
      id:              Number(raw.id),
      title:           raw.Title || "",
      datum:           raw.Datum,
      projektLookupId: Number(raw.ProjektLookupIdLookupId||raw.ProjektLookupId||0)||null,
      kategorie:       raw.Kategorie || "",
      personLookupId:  Number(raw.PersonLookupIDLookupId||raw.PersonLookupID||raw.PersonLookupId||0)||null,
      aufwandStunden:  h.num(raw.AufwandStunden),
      betragBerechnet: h.num(raw.BetragBerechnet),
      betragFinal:     h.num(raw.BetragFinal),
      verrechenbar:    raw.Verrechenbar || "",
      bemerkungen:     raw.Bemerkungen || ""
    };
    k.datumFmt     = h.fmtDate(k.datum);
    k.anzeigeBetrag = h.num(k.betragFinal) ?? h.num(k.betragBerechnet);
    k.personName    = h.contactName(k.personLookupId);
    k.projektTitle  = state.data.projekte.find(p=>Number(p.id)===k.projektLookupId)?.Title || "";
    return k;
  }

  function enrichAll() {
    state.enriched.projekte   = state.data.projekte.map(enrichProjekt);
    state.enriched.einsaetze  = state.data.einsaetze.map(enrichEinsatz);
    state.enriched.konzeption = state.data.konzeption.map(enrichKonzeption);
  }

  // ── API ──────────────────────────────────────────────────────────────────
  const api = {
    async getToken() {
      if (!state.auth.account) throw new Error("Nicht angemeldet.");
      try {
        const r = await state.auth.msal.acquireTokenSilent({scopes:CONFIG.graph.scopes,account:state.auth.account});
        return (state.auth.token = r.accessToken);
      } catch {
        const r = await state.auth.msal.acquireTokenPopup({scopes:CONFIG.graph.scopes});
        return (state.auth.token = r.accessToken);
      }
    },

    async req(url, opts={}) {
      const token = await api.getToken();
      const res = await fetch(url, {
        ...opts,
        headers: {"Authorization":`Bearer ${token}`,"Content-Type":"application/json",...(opts.headers||{})}
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=>"");
        let msg = txt;
        try { msg = JSON.parse(txt)?.error?.message || txt; } catch {}
        throw new Error(`HTTP ${res.status}: ${msg.slice(0,200)}`);
      }
      return res.status===204 ? null : res.json();
    },

    async getSiteId() {
      if (state.meta.siteId) return state.meta.siteId;
      const d = await api.req(`https://graph.microsoft.com/v1.0/sites/${CONFIG.sharePoint.siteHostname}:${CONFIG.sharePoint.sitePath}`);
      return (state.meta.siteId = d.id);
    },

    async getItems(listTitle) {
      const sid = await api.getSiteId();
      let url = `https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(listTitle)}/items?expand=fields&$top=5000`;
      const items = [];
      while (url) {
        const d = await api.req(url);
        for (const i of (d.value||[])) {
          if (i.fields) items.push({id: Number(i.id), ...i.fields});
        }
        url = d["@odata.nextLink"] || null;
      }
      return items;
    },

    async post(listTitle, fields) {
      const sid = await api.getSiteId();
      return api.req(`https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(listTitle)}/items`,
        {method:"POST", body:JSON.stringify({fields})});
    },

    async patch(listTitle, itemId, fields) {
      const sid = await api.getSiteId();
      return api.req(`https://graph.microsoft.com/v1.0/sites/${sid}/lists/${encodeURIComponent(listTitle)}/items/${itemId}/fields`,
        {method:"PATCH", body:JSON.stringify(fields)});
    },

    async loadAll() {
      ui.setLoading(true);
      try {
        const [projekte, einsaetze, konzeption, firms, contacts] = await Promise.all([
          api.getItems(CONFIG.lists.projekte),
          api.getItems(CONFIG.lists.einsaetze),
          api.getItems(CONFIG.lists.konzeption),
          api.getItems(CONFIG.lists.firms),
          api.getItems(CONFIG.lists.contacts)
        ]);
        state.data.projekte   = projekte;
        state.data.einsaetze  = einsaetze;
        state.data.konzeption = konzeption;
        state.data.firms      = firms.map(f=>({id:Number(f.id),title:f.Title||""}));
        state.data.contacts   = contacts.map(c=>({id:Number(c.id),nachname:c.Title||"",vorname:c.Vorname||"",FirmaLookupId:Number(c.FirmaLookupIdLookupId||c.FirmaLookupId||0)||null}));
        enrichAll();
      } finally {
        ui.setLoading(false);
      }
    }
  };

  // ── UI ───────────────────────────────────────────────────────────────────
  const ui = {
    els: {},
    init() {
      this.els.root    = document.getElementById("view-root");
      this.els.msg     = document.getElementById("global-message");
      this.els.login   = document.getElementById("btn-login");
      this.els.refresh = document.getElementById("btn-refresh");
      this.els.auth    = document.getElementById("auth-status");
      this.els.navBtns = [...document.querySelectorAll(".tm-nav-btn")];

      if (this.els.login)   this.els.login.addEventListener("click",   ()=>ctrl.login());
      if (this.els.refresh) this.els.refresh.addEventListener("click", ()=>ctrl.refresh());
      this.els.navBtns.forEach(b=>b.addEventListener("click",()=>ctrl.navigate(b.dataset.route)));

      // Form-Submit-Delegation
      document.addEventListener("submit", e=>{
        if (e.target.id==="projekt-form")    { e.preventDefault(); ctrl.saveProjekt(new FormData(e.target)); }
        if (e.target.id==="einsatz-form")    { e.preventDefault(); ctrl.saveEinsatz(new FormData(e.target)); }
        if (e.target.id==="konzeption-form") { e.preventDefault(); ctrl.saveKonzeption(new FormData(e.target)); }
      });

      // Click-Delegation
      document.addEventListener("click", e=>{
        const a = sel => e.target.closest(sel);
        if (a("[data-action='open-projekt']"))     { ctrl.openProjekt(+a("[data-action='open-projekt']").dataset.id); return; }
        if (a("[data-action='back-to-projekte']")) { ctrl.navigate("projekte"); return; }
        if (a("[data-action='new-einsatz']"))      { ctrl.openEinsatzForm(null, +a("[data-action='new-einsatz']").dataset.projektId||null); return; }
        if (a("[data-action='new-konzeption']"))   { ctrl.openKonzeptionForm(null, +a("[data-action='new-konzeption']").dataset.projektId||null); return; }
        if (a("[data-action='edit-einsatz']"))     { ctrl.openEinsatzForm(+a("[data-action='edit-einsatz']").dataset.id); return; }
        if (a("[data-action='edit-konzeption']"))  { ctrl.openKonzeptionForm(+a("[data-action='edit-konzeption']").dataset.id); return; }
        if (a("[data-action='copy-einsatz']"))     { ctrl.copyEinsatz(+a("[data-action='copy-einsatz']").dataset.id); return; }
        if (a("[data-action='new-projekt']"))      { ctrl.openProjektForm(null); return; }
        if (a("[data-action='edit-projekt']"))     { ctrl.openProjektForm(+a("[data-action='edit-projekt']").dataset.id); return; }
        if (a("[data-close-modal]"))               { ctrl.closeModal(); return; }
        if (a(".tm-tab[data-tab]"))                { const t=a(".tm-tab[data-tab]"); ctrl.setTab(t.dataset.route,t.dataset.tab); return; }
        if (a(".tm-modal-backdrop")&&!a(".tm-modal")) { ctrl.closeModal(); return; }
      });
    },

    setNav(route) { this.els.navBtns.forEach(b=>b.classList.toggle("active",b.dataset.route===route)); },
    setLoading(v) { if(this.els.refresh) this.els.refresh.style.display=v?"none":""; },
    setMsg(msg, type="info") {
      const el=this.els.msg; if(!el)return;
      if(!msg){el.style.display="none";el.textContent="";return;}
      el.textContent=msg; el.className=`tm-global-message ${type}`; el.style.display="block";
      if(type==="success") setTimeout(()=>ui.setMsg(""),3000);
    },
    setAuth(name) {
      if(this.els.auth) this.els.auth.textContent=name||"";
      if(this.els.login) this.els.login.style.display=name?"none":"";
      if(this.els.refresh) this.els.refresh.style.display=name?"":"none";
    },
    render(html) { if(this.els.root) this.els.root.innerHTML=html; },
    renderModal(html) {
      let bd=document.getElementById("tm-modal-bd");
      if(!bd){bd=document.createElement("div");bd.id="tm-modal-bd";bd.className="tm-modal-backdrop";document.body.appendChild(bd);}
      bd.innerHTML=html; bd.style.display="flex";
    },
    closeModal() { const el=document.getElementById("tm-modal-bd"); if(el){el.style.display="none";el.innerHTML="";} },
    empty(msg="Keine Einträge vorhanden.") { return `<div class="tm-empty"><div class="tm-empty-icon">📋</div><div class="tm-empty-text">${h.esc(msg)}</div></div>`; }
  };

  // ── VIEWS ─────────────────────────────────────────────────────────────────
  const views = {
    projekte() {
      const f = state.filters.projekte;
      let list = state.enriched.projekte.filter(p=>!p.archiviert);
      if (f.search) list = list.filter(p=>h.inc(p.title,f.search)||h.inc(p.firmaName,f.search));
      if (f.status) list = list.filter(p=>p.status===f.status);

      ui.render(`
        <div class="tm-page-header">
          <div><div class="tm-page-title">Projekte</div><div class="tm-page-meta">${list.length} aktive Projekte</div></div>
          <div class="tm-page-actions"><button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-projekt">+ Projekt</button></div>
        </div>
        <div class="tm-filter-bar">
          <input type="search" placeholder="Suche…" value="${h.esc(f.search)}" oninput="state.filters.projekte.search=this.value;ctrl.render()">
          <select onchange="state.filters.projekte.status=this.value;ctrl.render()">
            <option value="">Alle Status</option>
            ${["geplant","aktiv","abgeschlossen"].map(s=>`<option value="${s}" ${f.status===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${list.length ? `<div class="tm-proj-grid">${list.map(p=>{
          const pct = p.konzBudgetH ? Math.round(p.konzStunden/p.konzBudgetH*100) : null;
          return `<div class="tm-proj-card" data-action="open-projekt" data-id="${p.id}">
            <div class="tm-proj-name">${h.esc(p.title)}</div>
            <div class="tm-proj-firm">${h.esc(p.firmaName)}${p.projektNr?` · #${h.esc(p.projektNr)}`:""} · ${h.projStatusBadge(p.status)}</div>
            <div class="tm-proj-stats">
              <div class="tm-proj-stat"><strong class="tm-chf">CHF ${h.chf(p.totalBetrag)}</strong>Umsatz</div>
              <div class="tm-proj-stat"><strong>${p.einsaetzeCount}</strong>Einsätze</div>
              ${p.konzBudgetH?`<div class="tm-proj-stat"><strong>${p.konzStunden.toFixed(1)} h</strong>Konzeption</div>`:""}
            </div>
            ${pct!==null?`<div class="tm-budget-bar" style="margin-top:8px"><div class="tm-budget-fill ${pct>=100?"over":pct>=80?"warn":""}" style="width:${Math.min(pct,100)}%"></div></div><div style="font-size:11px;color:var(--tm-text-muted);margin-top:3px">${p.konzStunden.toFixed(1)} / ${p.konzBudgetH} h</div>`:""}
          </div>`;
        }).join("")}</div>` : ui.empty("Keine Projekte gefunden.")}
      `);
    },

    projektDetail(id) {
      const p = state.enriched.projekte.find(p=>p.id===id);
      if (!p) { ui.render(`<p>Projekt nicht gefunden.</p>`); return; }
      const tab = state.filters.activeTab["projekt-detail"] || "einsaetze";
      const pct = p.konzBudgetH ? Math.round(p.konzStunden/p.konzBudgetH*100) : null;

      const einsaetzeTab = () => {
        const list = p.einsaetze.map(enrichEinsatz).sort((a,b)=>h.toDate(b.datum)-h.toDate(a.datum));
        if (!list.length) return ui.empty("Noch keine Einsätze erfasst.");
        return `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung</th><th>Kategorie</th><th>Person</th><th>Betrag</th><th>Status</th><th>Abrechnung</th><th></th></tr></thead>
          <tbody>${list.map(e=>`<tr class="${["abgesagt","abgesagt-chf"].includes(e.einsatzStatus)?"cancelled":""}">
            <td class="tm-nowrap">${h.esc(e.datumFmt)}</td>
            <td>${h.esc(e.title)}</td>
            <td class="tm-muted">${h.esc(e.kategorie)}</td>
            <td class="tm-muted">${h.esc(e.personName)}</td>
            <td class="tm-right tm-chf">${e.anzeigeBetrag!==null?h.chf(e.anzeigeBetrag):"—"}</td>
            <td>${h.statusBadge(e)}</td>
            <td>${h.abrBadge(e.abrechnung)}</td>
            <td><div class="tm-actions">
              <button class="tm-btn tm-btn-sm" data-action="edit-einsatz" data-id="${e.id}">✎</button>
              <button class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${e.id}" title="Duplizieren">⧉</button>
            </div></td>
          </tr>`).join("")}</tbody></table></div>`;
      };

      const konzTab = () => {
        const list = p.konzeintraege.map(enrichKonzeption).sort((a,b)=>h.toDate(b.datum)-h.toDate(a.datum));
        if (!list.length) return ui.empty("Noch keine Konzeptionsaufwände erfasst.");
        return `<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung</th><th>Kategorie</th><th>Person</th><th>Stunden</th><th>Betrag</th><th>Verrechenbar</th><th></th></tr></thead>
          <tbody>${list.map(k=>`<tr>
            <td class="tm-nowrap">${h.esc(k.datumFmt)}</td>
            <td>${h.esc(k.title)}</td>
            <td class="tm-muted">${h.esc(k.kategorie)}</td>
            <td class="tm-muted">${h.esc(k.personName)}</td>
            <td class="tm-right">${k.aufwandStunden!==null?k.aufwandStunden.toFixed(1):"—"}</td>
            <td class="tm-right tm-chf">${k.anzeigeBetrag!==null?h.chf(k.anzeigeBetrag):"—"}</td>
            <td>${h.verrBadge(k.verrechenbar)}</td>
            <td><div class="tm-actions"><button class="tm-btn tm-btn-sm" data-action="edit-konzeption" data-id="${k.id}">✎</button></div></td>
          </tr>`).join("")}</tbody></table></div>`;
      };

      const stammdatenTab = () => `
        <div class="tm-form-wrap" style="max-width:100%">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--tm-text-muted);margin-bottom:8px">Stammdaten</div>
              ${[["Projekt-Nr.",p.projektNr||"—"],["Firma",p.firmaName],["Ansprechpartner",p.ansprechpartner],["Status",p.status],["Km zum Kunden",p.kmZumKunden!==null?`${p.kmZumKunden} km`:"—"],["Konzeptionsrahmen",p.konzBudgetH!==null?`${p.konzeptionsrahmenTage} Tage (${p.konzBudgetH} h)`:"—"]]
                .map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--tm-blue-pale)"><span style="color:var(--tm-text-muted)">${l}</span><span style="font-weight:500">${h.esc(String(v))}</span></div>`).join("")}
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--tm-text-muted);margin-bottom:8px">Ansätze CHF</div>
              ${[["Einsatz (Tag)",p.ansatzEinsatz],["Einsatz (Halbtag)",p.ansatzHalbtag],["Co-Einsatz (Tag)",p.ansatzCoEinsatz],["Stunde",p.ansatzStunde],["Konzeption/Tag",p.ansatzKonzeption],["Admin/Tag",p.ansatzAdmin],["Km-Spesen/km",p.ansatzKmSpesen]]
                .filter(([,v])=>v!==null).map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--tm-blue-pale)"><span style="color:var(--tm-text-muted)">${l}</span><span style="font-weight:500">${h.chf(v)}</span></div>`).join("")}
            </div>
          </div>
        </div>`;

      const tabContent = {einsaetze:einsaetzeTab(),konzeption:konzTab(),stammdaten:stammdatenTab()};

      ui.render(`
        <div class="tm-page-header">
          <div>
            <button class="tm-btn tm-btn-sm" data-action="back-to-projekte" style="margin-bottom:8px">← Projekte</button>
            <div class="tm-page-title">${h.esc(p.title)}</div>
            <div class="tm-page-meta">${h.esc(p.firmaName)}${p.projektNr?` · #${h.esc(p.projektNr)}`:""} · ${h.projStatusBadge(p.status)}</div>
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
          ${p.konzBudgetH?`<div class="tm-kpi"><div class="tm-kpi-label">Konzeption</div><div class="tm-kpi-value ${pct>=100?"red":pct>=80?"amber":"green"}">${p.konzStunden.toFixed(1)} h</div><div class="tm-kpi-sub">von ${p.konzBudgetH} h Budget</div></div>`:""}
        </div>
        ${pct!==null?`<div class="tm-budget-bar-wrap"><div class="tm-budget-labels"><span>Konzeptionsbudget: ${p.konzStunden.toFixed(1)} / ${p.konzBudgetH} h (${pct}%)</span><span style="color:${pct>=100?"var(--tm-red)":pct>=80?"var(--tm-amber)":"var(--tm-green)"}">${pct>=100?"⚠ überschritten":pct>=80?"⚠ Achtung":"im Rahmen"}</span></div><div class="tm-budget-bar"><div class="tm-budget-fill ${pct>=100?"over":pct>=80?"warn":""}" style="width:${Math.min(pct,100)}%"></div></div></div>`:""}
        <div class="tm-tabs">
          ${["einsaetze","konzeption","stammdaten"].map(t=>`<div class="tm-tab${tab===t?" active":""}" data-tab="${t}" data-route="projekt-detail">${{einsaetze:"Einsätze",konzeption:"Konzeption",stammdaten:"Stammdaten & Ansätze"}[t]}</div>`).join("")}
        </div>
        ${tabContent[tab]||""}
      `);
    },

    einsaetze() {
      const f = state.filters.einsaetze;
      let list = [...state.enriched.einsaetze];
      if (f.search)       list = list.filter(e=>h.inc(e.title,f.search)||h.inc(e.projektTitle,f.search));
      if (f.abrechnung)   list = list.filter(e=>e.abrechnung===f.abrechnung);
      if (f.einsatzStatus) list = list.filter(e=>e.einsatzStatus===f.einsatzStatus);
      list.sort((a,b)=>h.toDate(b.datum)-h.toDate(a.datum));

      ui.render(`
        <div class="tm-page-header">
          <div><div class="tm-page-title">Alle Einsätze</div><div class="tm-page-meta">${list.length} Einträge</div></div>
          <div class="tm-page-actions"><button class="tm-btn tm-btn-sm tm-btn-primary" data-action="new-einsatz" data-projekt-id="">+ Einsatz</button></div>
        </div>
        <div class="tm-filter-bar">
          <input type="search" placeholder="Suche…" value="${h.esc(f.search)}" oninput="state.filters.einsaetze.search=this.value;ctrl.render()">
          <select onchange="state.filters.einsaetze.abrechnung=this.value;ctrl.render()">
            <option value="">Abrechnung: alle</option>
            ${["offen","zur Abrechnung","abgerechnet"].map(s=>`<option value="${s}" ${f.abrechnung===s?"selected":""}>${s}</option>`).join("")}
          </select>
          <select onchange="state.filters.einsaetze.einsatzStatus=this.value;ctrl.render()">
            <option value="">Status: alle</option>
            ${["geplant","durchgefuehrt","abgesagt"].map(s=>`<option value="${s}" ${f.einsatzStatus===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${list.length?`<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung</th><th>Projekt / Firma</th><th>Kategorie</th><th>Person</th><th>Betrag</th><th>Status</th><th>Abrechnung</th><th></th></tr></thead>
          <tbody>${list.map(e=>{
            const proj = state.enriched.projekte.find(p=>p.id===e.projektLookupId);
            return `<tr class="${["abgesagt","abgesagt-chf"].includes(e.einsatzStatus)?"cancelled":""}">
            <td class="tm-nowrap">${h.esc(e.datumFmt)}</td>
            <td style="font-weight:500">${h.esc(e.title)}</td>
            <td><div style="font-weight:500">${h.esc(e.projektTitle)}</div><div style="font-size:11px;color:var(--tm-text-muted)">${h.esc(proj?.firmaName||"")}</div></td>
            <td class="tm-muted">${h.esc(e.kategorie)}</td>
            <td class="tm-muted">${h.esc(e.personName)}</td>
            <td class="tm-right tm-chf">${e.anzeigeBetrag!==null?h.chf(e.anzeigeBetrag):"—"}</td>
            <td>${h.statusBadge(e)}</td>
            <td>${h.abrBadge(e.abrechnung)}</td>
            <td><div class="tm-actions">
              <button class="tm-btn tm-btn-sm" data-action="edit-einsatz" data-id="${e.id}">✎</button>
              <button class="tm-btn tm-btn-sm" data-action="copy-einsatz" data-id="${e.id}">⧉</button>
            </div></td>
          </tr>`;}).join("")}</tbody></table></div>`:ui.empty("Keine Einsätze gefunden.")}
      `);
    },

    konzeption() {
      const f = state.filters.konzeption;
      let list = [...state.enriched.konzeption];
      if (f.search)       list = list.filter(k=>h.inc(k.title,f.search)||h.inc(k.projektTitle,f.search));
      if (f.verrechenbar) list = list.filter(k=>k.verrechenbar===f.verrechenbar);
      list.sort((a,b)=>h.toDate(b.datum)-h.toDate(a.datum));
      const sumF = list.filter(k=>k.verrechenbar==="zur Abrechnung").reduce((s,k)=>s+(k.anzeigeBetrag||0),0);
      const sumK = list.filter(k=>k.verrechenbar==="Klärung nötig").reduce((s,k)=>s+(k.anzeigeBetrag||0),0);
      const sumI = list.filter(k=>k.verrechenbar==="Inklusive").reduce((s,k)=>s+(k.anzeigeBetrag||0),0);

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
            ${["Inklusive","Klärung nötig","zur Abrechnung","abgerechnet"].map(s=>`<option value="${s}" ${f.verrechenbar===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${list.length?`<div class="tm-table-wrap"><table class="tm-table">
          <thead><tr><th>Datum</th><th>Beschreibung / Projekt</th><th>Kategorie</th><th>Person</th><th>Stunden</th><th>Betrag</th><th>Verrechenbar</th><th></th></tr></thead>
          <tbody>${list.map(k=>`<tr>
            <td class="tm-nowrap">${h.esc(k.datumFmt)}</td>
            <td><div style="font-weight:500">${h.esc(k.title)}</div><div style="font-size:11px;color:var(--tm-text-muted)">${h.esc(k.projektTitle)}</div></td>
            <td class="tm-muted">${h.esc(k.kategorie)}</td>
            <td class="tm-muted">${h.esc(k.personName)}</td>
            <td class="tm-right">${k.aufwandStunden!==null?k.aufwandStunden.toFixed(1)+" h":"—"}</td>
            <td class="tm-right tm-chf">${k.anzeigeBetrag!==null?h.chf(k.anzeigeBetrag):"—"}</td>
            <td>${h.verrBadge(k.verrechenbar)}</td>
            <td><div class="tm-actions"><button class="tm-btn tm-btn-sm" data-action="edit-konzeption" data-id="${k.id}">✎</button></div></td>
          </tr>`).join("")}</tbody></table></div>`:ui.empty("Keine Konzeptionsaufwände gefunden.")}
      `);
    }
  };

  // ── CONTROLLER ────────────────────────────────────────────────────────────
  const ctrl = {
    render() {
      const r = state.filters.route;
      ui.setNav(["projekte","einsaetze","konzeption"].includes(r)?r:"projekte");
      ui.setMsg("");
      if (r==="projekte")       { views.projekte(); return; }
      if (r==="projekt-detail") { views.projektDetail(state.selection.projektId); return; }
      if (r==="projekt-form")   { return; } // form rendert sich selbst
      if (r==="einsaetze")      { views.einsaetze(); return; }
      if (r==="konzeption")     { views.konzeption(); return; }
    },

    navigate(route) {
      state.filters.route = route;
      if (route!=="projekt-detail") state.selection.projektId=null;
      this.render();
    },

    openProjekt(id) { state.selection.projektId=id; state.filters.route="projekt-detail"; this.render(); },
    setTab(route, tab) { state.filters.activeTab[route]=tab; this.render(); },
    closeModal() { ui.closeModal(); },

    async login() {
      try {
        const r = await state.auth.msal.loginPopup({scopes:CONFIG.graph.scopes});
        state.auth.account = r.account; state.auth.isAuthenticated=true;
        ui.setAuth(r.account.name||r.account.username);
        ui.setMsg("Daten werden geladen…","info");
        await api.loadAll(); ctrl.render();
      } catch(e) { ui.setMsg("Anmeldung fehlgeschlagen: "+e.message,"error"); }
    },

    async refresh() { ui.setMsg("Aktualisiere…","info"); await api.loadAll(); ctrl.render(); },

    // ── Projekt-Formular ─────────────────────────────────────────────────
    openProjektForm(id) {
      const p = id ? state.enriched.projekte.find(p=>p.id===id) : null;
      const firmaItems = state.data.firms
        .sort((a,b)=>a.title.localeCompare(b.title,"de"))
        .map(f=>({id:String(f.id),label:f.title}));
      const prefFirmaId = p?.firmaLookupId || null;
      const allContactItems = () => fId => state.data.contacts
        .filter(c => !fId || Number(c.FirmaLookupId||c.firmaLookupId||0) === fId)
        .sort((a,b)=>(a.nachname+a.vorname).localeCompare(b.nachname+b.vorname,"de"))
        .map(c=>({id:String(c.id),label:[c.nachname,c.vorname].filter(Boolean).join(", ")}));
      const contactItems = state.data.contacts
        .filter(c => !prefFirmaId || Number(c.FirmaLookupId||c.firmaLookupId||0) === prefFirmaId)
        .sort((a,b)=>(a.nachname+a.vorname).localeCompare(b.nachname+b.vorname,"de"))
        .map(c=>({id:String(c.id),label:[c.nachname,c.vorname].filter(Boolean).join(", ")}));
      const v = (k,fb="") => p?(p[k]??fb):fb;
      const chfv = k => p&&p[k]!==null&&p[k]!==undefined?p[k]:"";
      state.filters.route="projekt-form";
      ui.render(`
        <div style="max-width:700px;margin:0 auto">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <button class="tm-btn tm-btn-sm" data-action="back-to-projekte">← Projekte</button>
            <div class="tm-page-title">${p?"Projekt bearbeiten":"Neues Projekt erfassen"}</div>
          </div>
          <form id="projekt-form">
            <input type="hidden" name="itemId" value="${id||""}">
            <input type="hidden" name="mode" value="${id?"edit":"create"}">
            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">Stammdaten</div>
              <div class="tm-form-grid" style="margin-top:14px">
                <div class="tm-field tm-form-full"><label>Projektname <span class="req">*</span></label><input type="text" name="title" value="${h.esc(v("title"))}" required></div>
                <div class="tm-field"><label>Projekt-Nr.</label><input type="text" name="projektNr" value="${h.esc(v("projektNr"))}"></div>
                <div class="tm-field"><label>Konto-Nr. Honorar</label><input type="text" name="kontoNr" value="${h.esc(v("kontoNr"))}" placeholder="z.B. 4210"></div>
                <div class="tm-field"><label>Firma <span class="req">*</span></label>
                  ${h.typeaheadHtml("firmaLookupId",firmaItems,p?String(p.firmaLookupId||""):"","Firma suchen…")}
                  <span class="tm-hint">Nach Auswahl werden Ansprechpartner gefiltert</span>
                </div>
                <div class="tm-field"><label>Ansprechpartner <span class="req">*</span></label>
                  <div id="ap-wrap">${h.typeaheadHtml("ansprechpartnerLookupId",contactItems,p?String(p.ansprechpartnerLookupId||""):"","Person suchen…")}</div>
                </div>
                <div class="tm-field"><label>Status <span class="req">*</span></label><select name="status" required>${["geplant","aktiv","abgeschlossen"].map(s=>`<option value="${s}" ${v("status","aktiv")===s?"selected":""}>${s}</option>`).join("")}</select></div>
                <div class="tm-field"><label>Km zum Kunden</label><input type="number" name="kmZumKunden" value="${chfv("kmZumKunden")}" placeholder="z.B. 28"><span class="tm-hint">bbz SG → Kundendomizil (App rechnet ×2)</span></div>
                <div class="tm-field" style="justify-content:flex-end"><label>&nbsp;</label><label class="tm-checkbox-row"><input type="checkbox" name="archiviert" ${v("archiviert")?"checked":""}> Archiviert</label></div>
              </div>
            </div>
            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">Ansätze CHF <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;background:#E1F5EE;color:#085041;padding:2px 8px;border-radius:4px">leer = Kategorie nicht verfügbar</span></div>
              <table style="width:100%;border-collapse:collapse;margin-top:14px">
                <thead><tr>
                  <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted);text-align:left;padding:0 16px 8px 0;border-bottom:1px solid var(--tm-border);width:160px">Kategorie</th>
                  <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted);text-align:left;padding:0 12px 8px;border-bottom:1px solid var(--tm-border)">Haupttrainer</th>
                  <th style="font-size:11px;font-weight:500;color:var(--tm-text-muted);text-align:left;padding:0 0 8px 12px;border-bottom:1px solid var(--tm-border)">Co-Trainer</th>
                </tr></thead>
                <tbody>
                  ${[["Einsatz (Tag)","ansatzEinsatz","ansatzCoEinsatz"],["Einsatz (Halbtag)","ansatzHalbtag","ansatzCoHalbtag"]].map(([lbl,mk,ck])=>`
                  <tr>
                    <td style="font-size:13px;padding:8px 16px 8px 0;border-bottom:1px solid var(--tm-blue-pale)">${lbl}</td>
                    <td style="padding:6px 12px;border-bottom:1px solid var(--tm-blue-pale)"><div style="display:flex;align-items:center;border:1px solid var(--tm-border);border-radius:6px;overflow:hidden;max-width:140px"><span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border)">CHF</span><input type="number" name="${mk}" value="${chfv(mk)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;width:90px;outline:none;font-family:inherit"></div></td>
                    <td style="padding:6px 0 6px 12px;border-bottom:1px solid var(--tm-blue-pale)"><div style="display:flex;align-items:center;border:1px solid var(--tm-border);border-radius:6px;overflow:hidden;max-width:140px"><span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border)">CHF</span><input type="number" name="${ck}" value="${chfv(ck)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;width:90px;outline:none;font-family:inherit"></div></td>
                  </tr>`).join("")}
                </tbody>
              </table>
              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px">
                ${[["Stunde","ansatzStunde","CHF/h"],["Stück","ansatzStueck","CHF/Stück"],["Pauschale","ansatzPauschale","CHF fix"],["Konzeption/Tag","ansatzKonzeption","CHF/Tag"],["Admin/Tag","ansatzAdmin","CHF/Tag"],["Km-Spesen","ansatzKmSpesen","CHF/km"]].map(([lbl,key,hint])=>`
                <div class="tm-field"><label>${lbl}</label>
                  <div style="display:flex;align-items:center;border:1px solid var(--tm-border);border-radius:6px;overflow:hidden">
                    <span style="padding:6px 8px;background:#F5F7FA;font-size:11px;color:#6B7280;border-right:1px solid var(--tm-border)">CHF</span>
                    <input type="number" name="${key}" value="${chfv(key)}" placeholder="—" step="0.01" style="border:none;padding:6px 8px;font-size:13px;background:transparent;flex:1;min-width:0;outline:none;font-family:inherit">
                  </div><span class="tm-hint">${hint}</span></div>`).join("")}
                <div class="tm-field"><label>Spesen Konto-Nr.</label><input type="text" name="spesenKontoNr" value="${h.esc(v("spesenKontoNr"))}" placeholder="z.B. 6500"></div>
              </div>
            </div>
            <div class="tm-form-wrap" style="max-width:100%;margin-bottom:16px">
              <div class="tm-section-divider" style="margin-top:0">Konzeptionsrahmen</div>
              <div class="tm-form-grid" style="margin-top:14px">
                <div class="tm-field"><label>Vereinbarte Tage</label>
                  <input type="number" name="konzeptionsrahmenTage" value="${chfv("konzeptionsrahmenTage")}" placeholder="z.B. 2" min="0" step="0.5"
                    oninput="document.getElementById(\'kh\').textContent=(parseFloat(this.value)||0)*8">
                  <span class="tm-hint">× 8 = Stunden-Budget</span>
                </div>
                <div class="tm-field" style="justify-content:flex-end"><label>&nbsp;</label>
                  <div style="padding:10px 14px;background:var(--tm-blue-pale);border-radius:6px;font-size:13px;color:#6B7280">= <span id="kh" style="font-weight:600;color:var(--tm-text)">${(v("konzeptionsrahmenTage",0)||0)*8}</span> Stunden Budget</div>
                </div>
              </div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px">
              <button type="button" class="tm-btn" data-action="back-to-projekte">Abbrechen</button>
              <button type="submit" class="tm-btn tm-btn-primary">Projekt speichern</button>
            </div>
          </form>
        </div>`);
      // Firma-Wechsel → Ansprechpartner filtern
      const taFirma = document.querySelector(".tm-typeahead[data-name=\'firmaLookupId\'] .tm-ta-val");
      if (taFirma) {
        taFirma.addEventListener("change", () => {
          const fId = Number(taFirma.value)||null;
          const filtered = state.data.contacts
            .filter(c => !fId || Number(c.FirmaLookupId||c.firmaLookupId||0) === fId)
            .sort((a,b)=>(a.nachname+a.vorname).localeCompare(b.nachname+b.vorname,"de"))
            .map(c=>({id:String(c.id),label:[c.nachname,c.vorname].filter(Boolean).join(", ")}));
          const wrap = document.getElementById("ap-wrap");
          if (wrap) wrap.innerHTML = h.typeaheadHtml("ansprechpartnerLookupId", filtered, "", "Person suchen…");
        });
      }
    },

    async saveProjekt(fd) {
      ui.setMsg("Wird gespeichert…","info");
      try {
        const mode  = fd.get("mode"), itemId = fd.get("itemId");
        const title = (fd.get("title")||"").trim();
        const firmaId = h.num(fd.get("firmaLookupId"));
        const apId    = h.num(fd.get("ansprechpartnerLookupId"));
        if (!title)   throw new Error("Projektname ist Pflichtfeld.");
        if (!firmaId) throw new Error("Bitte Firma wählen.");
        if (!apId)    throw new Error("Bitte Ansprechpartner wählen.");

        const n = k => { const v=h.num(fd.get(k)); return v!==null?v:undefined; };
        const s = k => fd.get(k)||undefined;

        const fields = {};
        h.setIf(fields,"ProjektNr",   s("projektNr"));
        h.setIf(fields,"KontoNr",     s("kontoNr"));
        fields.FirmaLookupId           = firmaId;
        fields.AnsprechpartnerLookupId = apId;
        fields.Status                  = fd.get("status")||"aktiv";
        fields.Archiviert              = fd.get("archiviert")==="on";
        h.setIf(fields,"KmZumKunden",          n("kmZumKunden"));
        h.setIf(fields,"AnsatzEinsatz",        n("ansatzEinsatz"));
        h.setIf(fields,"AnsatzHalbtag",        n("ansatzHalbtag"));
        h.setIf(fields,"AnsatzCoEinsatz",      n("ansatzCoEinsatz"));
        h.setIf(fields,"AnsatzCoHalbtag",      n("ansatzCoHalbtag"));
        h.setIf(fields,"AnsatzStunde",         n("ansatzStunde"));
        h.setIf(fields,"AnsatzStueck",         n("ansatzStueck"));
        h.setIf(fields,"AnsatzPauschale",      n("ansatzPauschale"));
        h.setIf(fields,"AnsatzKonzeption",     n("ansatzKonzeption"));
        h.setIf(fields,"AnsatzAdmin",          n("ansatzAdmin"));
        h.setIf(fields,"AnsatzKmSpesen",       n("ansatzKmSpesen"));
        h.setIf(fields,"SpesenKontoNr",        s("spesenKontoNr"));
        h.setIf(fields,"KonzeptionsrahmenTage",n("konzeptionsrahmenTage"));

        if (mode==="edit"&&itemId) {
          fields.Title = title;
          await api.patch(CONFIG.lists.projekte, Number(itemId), fields);
        } else {
          const cr = await api.post(CONFIG.lists.projekte, {Title:title});
          const nid = Number(cr?.id||cr?.fields?.id); if(!nid) throw new Error("Neue ID fehlt.");
          await api.patch(CONFIG.lists.projekte, nid, fields);
        }
        ui.setMsg("Projekt gespeichert.","success");
        await api.loadAll(); ctrl.navigate("projekte");
      } catch(e) { ui.setMsg(e.message||"Fehler.","error"); }
    },

    // ── Einsatz-Formular ─────────────────────────────────────────────────
    openEinsatzForm(id, projektId=null) {
      const e = id ? state.enriched.einsaetze.find(e=>e.id===id) : null;
      const prefProjId = projektId||(e?.projektLookupId||null);
      const selProjekt = prefProjId ? state.enriched.projekte.find(p=>p.id===prefProjId) : null;
      const kats = h.kategorien(selProjekt);
      const selKat = e?.kategorie||"";

      // Eingeloggter User als Default-Person
      const loggedInName = state.auth.account?.name || "";
      const defaultPerson = state.data.contacts.find(c => {
        const fullName = [c.vorname, c.nachname].filter(Boolean).join(" ");
        return fullName.toLowerCase() === loggedInName.toLowerCase() ||
               [c.nachname, c.vorname].filter(Boolean).join(", ").toLowerCase() === loggedInName.toLowerCase();
      });
      const defaultPersonId = e ? String(e.personLookupId||"") : (defaultPerson ? String(defaultPerson.id) : "");

      const contactItems = state.data.contacts
        .sort((a,b)=>(a.nachname+a.vorname).localeCompare(b.nachname+b.vorname,"de"))
        .map(c=>({id:String(c.id),label:[c.nachname,c.vorname].filter(Boolean).join(", ")}));
      const projektOpts = state.enriched.projekte.filter(p=>!p.archiviert)
        .map(p=>`<option value="${p.id}" ${prefProjId===p.id?"selected":""}>${h.esc(p.title)}${p.projektNr?` (#${p.projektNr})`:""}</option>`).join("");

      ui.renderModal(`<div class="tm-modal-backdrop"><div class="tm-modal">
        <div class="tm-modal-header"><span class="tm-modal-title">${id?"Einsatz bearbeiten":"Einsatz erfassen"}</span><button class="tm-modal-close" data-close-modal>✕</button></div>
        <div class="tm-modal-body">
          <form id="einsatz-form" class="tm-form-grid">
            <input type="hidden" name="itemId" value="${id||""}">
            <input type="hidden" name="mode" value="${id?"edit":"create"}">
            <div class="tm-field"><label>Datum <span class="req">*</span></label><input type="date" name="datum" value="${h.esc(e?h.toDateInput(e.datum):"")}"></div>
            <div class="tm-field"><label>Projekt <span class="req">*</span></label><select name="projektLookupId" required onchange="ctrl.onProjChange(this)"><option value="">— wählen —</option>${projektOpts}</select></div>
            <div class="tm-field tm-form-full"><label>Beschreibung</label><input type="text" name="titel" value="${h.esc(e?.title||"")}" placeholder="z.B. Kick-off Workshop, Modul 3 Leadership…"></div>
              <div class="tm-radio-group" id="kat-grp">${kats.map(k=>`<div class="tm-radio-btn${selKat===k?" sel":""}" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('kat-hid').value='${k}';ctrl.onKatChange('${k}')">${h.esc(k)}</div>`).join("")}</div>
              <input type="hidden" id="kat-hid" name="kategorie" value="${h.esc(selKat)}">
            </div>
            <div class="tm-field" id="fd-tage" style="${["Stunde","Stück","Pauschale"].includes(selKat)?"display:none":""}">
              <label>Dauer</label>
              <div class="tm-radio-group">
                <div class="tm-radio-btn${(e?.dauerTage||1)===1?" sel":""}" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('dt-hid').value='1'">Ganztag (1.0)</div>
                <div class="tm-radio-btn${e?.dauerTage===0.5?" sel":""}" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('dt-hid').value='0.5'">Halbtag (0.5)</div>
              </div>
              <input type="hidden" id="dt-hid" name="dauerTage" value="${e?.dauerTage||1}">
            </div>
            <div class="tm-field" id="fd-std" style="${selKat==="Stunde"?"":"display:none"}"><label>Stunden</label><input type="number" name="dauerStunden" min="0.5" step="0.5" value="${e?.dauerStunden||""}"></div>
            <div class="tm-field" id="fd-stk" style="${selKat==="Stück"?"":"display:none"}"><label>Anzahl Stück</label><input type="number" name="anzahlStueck" min="1" step="1" value="${e?.anzahlStueck||""}"></div>
            <div class="tm-field"><label>Ort</label><input type="text" name="ort" value="${h.esc(e?.ort||"")}"></div>
            <div class="tm-field"><label>Person (Lead)</label>${h.typeaheadHtml("personLookupId",contactItems,defaultPersonId,"Person suchen…")}</div>
            <div class="tm-field tm-form-full"><label>Bemerkungen</label><textarea name="bemerkungen">${h.esc(e?.bemerkungen||"")}</textarea></div>
            <div class="tm-section-divider">Beträge</div>
            <div class="tm-field"><label>Betrag berechnet</label><div class="tm-computed">Wird beim Speichern eingefroren</div></div>
            <div class="tm-field"><label>Betrag final (optional)</label><input type="number" name="betragFinal" step="0.01" value="${e?.betragFinal??""}" placeholder="Manuelle Überschreibung"></div>
            <div class="tm-section-divider">Status</div>
            <div class="tm-field"><label>Abrechnung <span class="req">*</span></label><select name="abrechnung">${["offen","zur Abrechnung","abgerechnet"].map(s=>`<option value="${s}" ${(e?.abrechnung||"offen")===s?"selected":""}>${s}</option>`).join("")}</select></div>
            <div class="tm-field"><label>Status</label><select name="status"><option value="">—</option>${["abgesagt","abgesagt mit Kostenfolge"].map(s=>`<option value="${s}" ${e?.status===s?"selected":""}>${s}</option>`).join("")}</select></div>
            <div class="tm-form-actions tm-form-full">
              <button type="button" class="tm-btn" data-close-modal>Abbrechen</button>
              <button type="submit" class="tm-btn tm-btn-primary">Speichern</button>
            </div>
          </form>
        </div>
      </div></div>`);
    },

    onProjChange(sel) {
      const p = state.enriched.projekte.find(p=>p.id===Number(sel.value));
      const kats = h.kategorien(p);
      const grp = document.getElementById("kat-grp");
      if (grp) grp.innerHTML = kats.map(k=>`<div class="tm-radio-btn" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('kat-hid').value='${k}';ctrl.onKatChange('${k}')">${h.esc(k)}</div>`).join("");
    },

    onKatChange(kat) {
      document.getElementById("fd-tage").style.display=["Stunde","Stück","Pauschale"].includes(kat)?"none":"";
      document.getElementById("fd-std").style.display=kat==="Stunde"?"":"none";
      document.getElementById("fd-stk").style.display=kat==="Stück"?"":"none";
    },

    async saveEinsatz(fd) {
      ui.setMsg("Wird gespeichert…","info");
      try {
        const mode=fd.get("mode"), itemId=fd.get("itemId");
        const datum=fd.get("datum"), kat=fd.get("kategorie");
        const projId=h.num(fd.get("projektLookupId"));
        if (!datum)  throw new Error("Datum ist Pflichtfeld.");
        if (!projId) throw new Error("Bitte Projekt wählen.");
        if (!kat)    throw new Error("Bitte Kategorie wählen.");

        const p = state.enriched.projekte.find(p=>p.id===projId);
        const dauerTage    = h.num(fd.get("dauerTage"));
        const dauerStunden = h.num(fd.get("dauerStunden"));
        const anzahlStueck = h.num(fd.get("anzahlStueck"));
        const betragBer    = h.berechneBetrag(p, kat, dauerTage, dauerStunden, anzahlStueck);
        const titelInput = fd.get("titel")?.trim();
        const titel = titelInput || `${kat} · ${datum}`;

        const fields = {
          Datum:            datum+"T12:00:00Z",
          ProjektLookupId:  projId,
          Kategorie:        kat,
          Abrechnung:       fd.get("abrechnung")||"offen"
        };
        const ort=fd.get("ort")?.trim(); if(ort) fields.Ort=ort;
        const bem=fd.get("bemerkungen")?.trim(); if(bem) fields.Bemerkungen=bem;
        const status=fd.get("status"); if(status) fields.Status=status;

        if (["Einsatz (Tag)","Co-Einsatz (Tag)"].includes(kat))          fields.DauerTage=1.0;
        else if (["Einsatz (Halbtag)","Co-Einsatz (Halbtag)"].includes(kat)) fields.DauerTage=0.5;
        else if (kat==="Stunde"&&dauerStunden)   fields.DauerStunden=dauerStunden;
        else if (kat==="Stück"&&anzahlStueck)    fields.AnzahlStueck=anzahlStueck;

        if (betragBer!==null) fields.BetragBerechnet=betragBer;
        const bf=h.num(fd.get("betragFinal")); if(bf!==null) fields.BetragFinal=bf;

        // Person: nur wenn gesetzt. SP-interner Feldname: PersonLookupId (bestätigt via /columns)
        const personId=h.num(fd.get("personLookupId")); if(personId) fields.PersonLookupID=personId;

        if (mode==="edit"&&itemId) {
          fields.Title=titel;
          await api.patch(CONFIG.lists.einsaetze, Number(itemId), fields);
        } else {
          const cr = await api.post(CONFIG.lists.einsaetze, {Title:titel});
          const nid = Number(cr?.id||cr?.fields?.id); if(!nid) throw new Error("Neue ID fehlt.");
          fields.ProjektLookupId = projId;
          await api.patch(CONFIG.lists.einsaetze, nid, fields);
        }
        ui.closeModal(); ui.setMsg("Einsatz gespeichert.","success");
        await api.loadAll(); ctrl.render();
      } catch(e) { ui.setMsg(e.message||"Fehler.","error"); }
    },

    copyEinsatz(id) {
      const e = state.enriched.einsaetze.find(e=>e.id===id);
      if (e) ctrl.openEinsatzForm(null, e.projektLookupId);
    },

    // ── Konzeption-Formular ───────────────────────────────────────────────
    openKonzeptionForm(id, projektId=null) {
      const k = id ? state.enriched.konzeption.find(k=>k.id===id) : null;
      const prefProjId = projektId||(k?.projektLookupId||null);

      const loggedInName = state.auth.account?.name || "";
      const defaultPerson = state.data.contacts.find(c => {
        const fullName = [c.vorname, c.nachname].filter(Boolean).join(" ");
        return fullName.toLowerCase() === loggedInName.toLowerCase() ||
               [c.nachname, c.vorname].filter(Boolean).join(", ").toLowerCase() === loggedInName.toLowerCase();
      });
      const defaultPersonId = k ? String(k.personLookupId||"") : (defaultPerson ? String(defaultPerson.id) : "");

      const contactItems = state.data.contacts.sort((a,b)=>(a.nachname+a.vorname).localeCompare(b.nachname+b.vorname,"de")).map(c=>({id:String(c.id),label:[c.nachname,c.vorname].filter(Boolean).join(", ")}));
      const projektOpts  = state.enriched.projekte.filter(p=>!p.archiviert).map(p=>`<option value="${p.id}" ${prefProjId===p.id?"selected":""}>${h.esc(p.title)}</option>`).join("");

      ui.renderModal(`<div class="tm-modal-backdrop"><div class="tm-modal">
        <div class="tm-modal-header"><span class="tm-modal-title">${id?"Aufwand bearbeiten":"Konzeptionsaufwand erfassen"}</span><button class="tm-modal-close" data-close-modal>✕</button></div>
        <div class="tm-modal-body">
          <form id="konzeption-form" class="tm-form-grid">
            <input type="hidden" name="itemId" value="${id||""}">
            <input type="hidden" name="mode" value="${id?"edit":"create"}">
            <div class="tm-field"><label>Datum <span class="req">*</span></label><input type="date" name="datum" value="${h.esc(k?h.toDateInput(k.datum):"")}"></div>
            <div class="tm-field"><label>Projekt <span class="req">*</span></label><select name="projektLookupId" required><option value="">— wählen —</option>${projektOpts}</select></div>
            <div class="tm-field tm-form-full"><label>Beschreibung <span class="req">*</span></label><input type="text" name="titel" value="${h.esc(k?.title||"")}" required></div>
            <div class="tm-field"><label>Kategorie <span class="req">*</span></label>
              <div class="tm-radio-group">
                ${["Konzeption","Admin"].map(kat=>`<div class="tm-radio-btn${(k?.kategorie||"Konzeption")===kat?" sel":""}" onclick="this.closest('.tm-radio-group').querySelectorAll('.tm-radio-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel');document.getElementById('kat-konz').value='${kat}'">${kat}</div>`).join("")}
              </div>
              <input type="hidden" id="kat-konz" name="kategorie" value="${h.esc(k?.kategorie||"Konzeption")}">
            </div>
            <div class="tm-field"><label>Person</label>${h.typeaheadHtml("personLookupId",contactItems,defaultPersonId,"Person suchen…")}</div>
            <div class="tm-field"><label>Aufwand Stunden <span class="req">*</span></label><input type="number" name="aufwandStunden" min="0.25" step="0.25" value="${k?.aufwandStunden||""}" required></div>
            <div class="tm-field"><label>Betrag berechnet</label><div class="tm-computed">Ansatz ÷ 8 × Stunden</div></div>
            <div class="tm-field"><label>Betrag final (optional)</label><input type="number" name="betragFinal" step="0.01" value="${k?.betragFinal??""}"></div>
            <div class="tm-field tm-form-full"><label>Verrechenbar <span class="req">*</span></label>
              <select name="verrechenbar" required>
                ${["Inklusive","Klärung nötig","zur Abrechnung","abgerechnet"].map(v=>`<option value="${v}" ${(k?.verrechenbar||"Inklusive")===v?"selected":""}>${v}</option>`).join("")}
              </select>
            </div>
            <div class="tm-field tm-form-full"><label>Bemerkungen</label><textarea name="bemerkungen">${h.esc(k?.bemerkungen||"")}</textarea></div>
            <div class="tm-form-actions tm-form-full">
              <button type="button" class="tm-btn" data-close-modal>Abbrechen</button>
              <button type="submit" class="tm-btn tm-btn-primary">Speichern</button>
            </div>
          </form>
        </div>
      </div></div>`);
    },

    async saveKonzeption(fd) {
      ui.setMsg("Wird gespeichert…","info");
      try {
        const mode=fd.get("mode"), itemId=fd.get("itemId");
        const datum=fd.get("datum"), kat=fd.get("kategorie");
        const projId=h.num(fd.get("projektLookupId"));
        const titel=(fd.get("titel")||"").trim();
        const std=h.num(fd.get("aufwandStunden"));
        if (!datum)  throw new Error("Datum ist Pflichtfeld.");
        if (!projId) throw new Error("Bitte Projekt wählen.");
        if (!titel)  throw new Error("Beschreibung ist Pflichtfeld.");
        if (!std)    throw new Error("Stunden ist Pflichtfeld.");

        const p = state.enriched.projekte.find(p=>p.id===projId);
        const ansatz = kat==="Admin" ? p?.ansatzAdmin : p?.ansatzKonzeption;
        const betragBer = (ansatz&&std) ? (ansatz/8)*std : null;

        const fields = {
          Datum:            datum+"T12:00:00Z",
          ProjektLookupId:  projId,
          Kategorie:        kat,
          AufwandStunden:   std,
          Verrechenbar:     fd.get("verrechenbar")
        };
        if (betragBer!==null) fields.BetragBerechnet=betragBer;
        const bf=h.num(fd.get("betragFinal")); if(bf!==null) fields.BetragFinal=bf;
        const bem=fd.get("bemerkungen")?.trim(); if(bem) fields.Bemerkungen=bem;
        const personId=h.num(fd.get("personLookupId")); if(personId) fields.PersonLookupId=personId;

        if (mode==="edit"&&itemId) {
          fields.Title=titel;
          await api.patch(CONFIG.lists.konzeption, Number(itemId), fields);
        } else {
          const cr = await api.post(CONFIG.lists.konzeption, {Title:titel});
          const nid = Number(cr?.id||cr?.fields?.id); if(!nid) throw new Error("Neue ID fehlt.");
          fields.ProjektLookupId = projId;
          await api.patch(CONFIG.lists.konzeption, nid, fields);
        }
        ui.closeModal(); ui.setMsg("Aufwand gespeichert.","success");
        await api.loadAll(); ctrl.render();
      } catch(e) { ui.setMsg(e.message||"Fehler.","error"); }
    }
  };

  window.ctrl = ctrl;
  window.state = state;
  window.h = h;

  // ── BOOT ─────────────────────────────────────────────────────────────────
  async function boot() {
    try {
      const msalLib = window.msalBrowser || window.msal;
      if (!msalLib?.PublicClientApplication) throw new Error("MSAL nicht geladen.");
      state.auth.msal = new msalLib.PublicClientApplication({
        auth: {clientId:CONFIG.graph.clientId, authority:CONFIG.graph.authority, redirectUri:CONFIG.graph.redirectUri},
        cache: {cacheLocation:"sessionStorage", storeAuthStateInCookie:false}
      });
      await state.auth.msal.initialize();
      await state.auth.msal.handleRedirectPromise();
      const accounts = state.auth.msal.getAllAccounts();
      if (accounts.length) state.auth.account = accounts[0];
      state.auth.isAuthenticated = !!state.auth.account;
      state.auth.isReady = true;
      ui.init();

      if (state.auth.isAuthenticated) {
        ui.setAuth(state.auth.account.name||state.auth.account.username);
        ui.setMsg("Daten werden geladen…","info");
        await api.loadAll(); ctrl.render();
      } else {
        ui.render(`<div class="tm-loading-screen" style="flex-direction:column;gap:16px">
          <div style="font-size:40px">📋</div>
          <div style="font-size:18px;font-weight:600;color:var(--tm-blue)">TM-App · bbz st.gallen</div>
          <p style="color:var(--tm-text-muted)">Termin- & Einsatzplanung für Tailormade Projekte</p>
          <button class="tm-btn tm-btn-primary" onclick="ctrl.login()">Mit Microsoft anmelden</button>
        </div>`);
        if (ui.els.login) ui.els.login.style.display="";
      }
    } catch(e) {
      document.getElementById("view-root").innerHTML=`<div class="tm-loading-screen"><div style="color:var(--tm-red)">⚠ Fehler: ${h.esc(e.message)}</div></div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
