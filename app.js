/* Chasseur Vieux-Lille : appli (aucun secret ici, le jeton d'accès est propre à chaque utilisateur). */
(() => {
  'use strict';
  const APP_VERSION = '1.6.0'; // = VERSION dans sw.js ; même 1.x que VERSION_SERVEUR (n8n/build.js), le dernier chiffre ne concerne que l'appli
  const CONFIG = window.CHASSEUR_CONFIG || {};
  const API = String(CONFIG.api || '').replace(/\/$/, '');
  const K = { jeton: 'chasseur.jeton', cache: 'chasseur.cache', filtres: 'chasseur.filtres' };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
  };
  const $ = (id) => document.getElementById(id);

  let jeton = null, donnees = null, onglet = 'annonces', horsLigne = null, enCours = false;
  let filtres = new Set();
  try { filtres = new Set(JSON.parse(store.get(K.filtres) || '[]')); } catch (e) { filtres = new Set(); }

  // ---------- utilitaires ----------
  function h(tag, attrs, ...enfants) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const e of enfants.flat()) if (e !== null && e !== undefined && e !== false) el.append(e.nodeType ? e : String(e));
    return el;
  }
  const svg = (inner, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    s.innerHTML = inner; // contenu statique uniquement
    return s;
  };
  const ICONES = {
    oeil: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    coeur: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    croix: '<path d="M6 6l12 12M18 6L6 18"/>',
    retour: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    copier: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    lien: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    maison: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  };
  const euros = (n) => (n === null || n === undefined ? '?' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €');
  function depuis(iso) {
    if (!iso) return null;
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return "à l'instant";
    if (min < 60) return 'il y a ' + min + ' min';
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return 'il y a ' + hrs + ' h';
    const j = Math.floor(hrs / 24);
    return j === 1 ? 'hier' : 'il y a ' + j + ' j';
  }
  const debutJour = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const param = (cle, defaut) => {
    const p = donnees && (donnees.parametres || []).find((x) => x.cle === cle);
    return p ? Number(p.valeur) : defaut;
  };

  // ---------- accès ----------
  function lireJetonUrl() {
    const m = location.hash.match(/[#&]t=([^&]+)/);
    if (m) {
      store.set(K.jeton, decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
    }
    jeton = store.get(K.jeton);
  }
  function ecranCode(message) {
    $('ecran-principal').hidden = true;
    $('ecran-code').hidden = false;
    $('erreur-code').textContent = message || '';
  }
  $('form-code').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('champ-code').value.trim();
    if (!v) { $('erreur-code').textContent = 'Saisis ton code.'; return; }
    store.set(K.jeton, v); jeton = v;
    charger(true);
  });
  $('btn-deconnexion').addEventListener('click', () => { store.del(K.jeton); store.del(K.cache); jeton = null; donnees = null; ecranCode(); });

  // ---------- API ----------
  async function appel(chemin, corps) {
    const url = API + '/' + chemin + '?t=' + encodeURIComponent(jeton);
    const opts = corps ? { method: 'POST', body: new URLSearchParams({ data: JSON.stringify(corps) }) } : { cache: 'no-store' };
    const r = await fetch(url, opts);
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (r.status === 401) { const err = new Error((j && j.erreur) || 'Code invalide'); err.acces = true; throw err; }
    if (!r.ok || !j || j.erreur) throw new Error((j && j.erreur) || ('Erreur ' + r.status));
    return j;
  }

  async function charger(depuisCode) {
    if (!jeton) return ecranCode();
    if (enCours) return;
    enCours = true;
    $('btn-actualiser').classList.add('tourne');
    try {
      donnees = await appel('annonces');
      horsLigne = null;
      store.set(K.cache, JSON.stringify(donnees));
      $('ecran-code').hidden = true;
      $('ecran-principal').hidden = false;
    } catch (e) {
      if (e.acces) { store.del(K.jeton); store.del(K.cache); jeton = null; ecranCode(depuisCode ? "Ce code n'est pas reconnu." : "Ton code n'est plus valide, saisis-le à nouveau."); return; }
      if (!donnees) { try { donnees = JSON.parse(store.get(K.cache) || 'null'); } catch (x) { donnees = null; } }
      horsLigne = donnees ? 'Hors ligne : affichage des dernières données reçues.' : null;
      if (!donnees) { ecranCode('Impossible de joindre le serveur. Vérifie ta connexion.'); return; }
      $('ecran-code').hidden = true;
      $('ecran-principal').hidden = false;
    } finally {
      enCours = false;
      $('btn-actualiser').classList.remove('tourne');
    }
    rendre();
  }

  async function changerEtat(a, champ) {
    const avant = a[champ];
    a[champ] = !avant;
    if (champ === 'ecartee' && a.ecartee) a.favori = false;
    rendre();
    try {
      const corps = { annonce_id: a.id, [champ]: a[champ] };
      if (champ === 'ecartee' && a.ecartee) corps.favori = false;
      await appel('etat', corps);
      store.set(K.cache, JSON.stringify(donnees));
    } catch (e) {
      a[champ] = avant; rendre();
      montrerBandeau("L'action n'a pas pu être enregistrée. Réessaie.");
    }
  }
  // Depuis l'appli installée, l'iPhone ouvre les liens dans une fenêtre Safari réduite où certains sites
  // (bannière cookies SeLoger) restent bloqués : on permet de copier le lien pour le coller dans Safari.
  async function copierLien(url) {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {
      const t = h('textarea', { readonly: true, style: 'position:fixed;top:-100px;opacity:0' }, url);
      document.body.append(t); t.select(); t.setSelectionRange(0, url.length);
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
    }
    montrerBandeau(ok ? 'Lien copié : colle-le dans Safari.' : 'Copie impossible : ouvre l\'annonce puis touche la boussole pour Safari.');
  }
  function montrerBandeau(t) {
    const b = $('bandeau'); b.textContent = t; b.hidden = false; b.dataset.temp = '1';
    setTimeout(() => { delete b.dataset.temp; b.hidden = !horsLigne; if (horsLigne) b.textContent = horsLigne; }, 4000);
  }

  // ---------- rendu ----------
  const FILTRES = [
    { id: 'non_vues', label: 'Non vues', test: (a) => !a.vue },
    { id: 'jour', label: "Aujourd'hui", test: (a) => new Date(a.date_tri).getTime() >= debutJour() },
    { id: 'deux', label: '2 chambres', test: (a) => a.chambres === 2 },
  ];

  function rendre() {
    if (!donnees) return;
    $('surtitre').textContent = 'T' + (param('chambres_min', 1) + 1) + (param('chambres_max', 2) > param('chambres_min', 1) ? '/T' + (param('chambres_max', 2) + 1) : '')
      + (param('meuble', 0) === 1 ? ' meublé' : param('meuble', 0) === 2 ? ' vide' : '')
      + ' · ≤ ' + euros(param('loyer_max_cc', 1400)) + ' CC · ' + String(param('rayon_km', 1.5)).replace('.', ',') + ' km';
    rendreScan();
    const b = $('bandeau');
    if (horsLigne) { b.textContent = horsLigne; b.hidden = false; } else if (!b.dataset.temp) b.hidden = true;
    for (const btn of document.querySelectorAll('.onglets button')) {
      if (btn.dataset.onglet === onglet) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    }
    $('vue-annonces').hidden = onglet === 'moteur';
    $('vue-moteur').hidden = onglet !== 'moteur';
    $('filtres').hidden = onglet !== 'annonces';
    if (onglet === 'moteur') rendreMoteur(); else rendreListe();
  }

  function rendreScan() {
    const m = donnees.moteur || {};
    const freq = Number(m.frequence_min) || 12;
    const point = $('point-scan');
    point.className = 'point';
    if (!m.dernier_scan) { $('texte-scan').textContent = 'Aucun scan pour le moment'; point.classList.add('retard'); return; }
    const age = (Date.now() - new Date(m.dernier_scan).getTime()) / 60000;
    const veilleMail = Number(m.sources_actives) === 0;
    let t = (veilleMail ? 'Veille par alertes e-mail · dernier contrôle ' : 'Dernier scan ') + depuis(m.dernier_scan);
    if (age > freq * 3) { point.classList.add('panne'); t += ' · le moteur semble arrêté'; }
    else if (age > freq * 1.5) { point.classList.add('retard'); t += ' · en retard'; }
    else if (!veilleMail) t += ' · prochain dans ' + Math.max(1, Math.round(freq - age)) + ' min';
    $('texte-scan').textContent = t;
  }

  function annoncesOnglet() {
    const toutes = donnees.annonces || [];
    if (onglet === 'favoris') return toutes.filter((a) => a.favori);
    if (onglet === 'ecartees') return toutes.filter((a) => a.ecartee);
    // Le score minimum réglé s'applique aussi à l'affichage. Les favoris ne sont que dans l'onglet Favoris.
    let l = toutes.filter((a) => !a.ecartee && !a.favori && a.score >= param('seuil_alerte', 70));
    for (const f of FILTRES) if (filtres.has(f.id)) l = l.filter(f.test);
    return l;
  }

  function rendreListe() {
    const zone = $('filtres');
    zone.replaceChildren(...FILTRES.map((f) => h('button', {
      class: 'puce', 'aria-pressed': filtres.has(f.id) ? 'true' : 'false',
      onclick: () => { filtres.has(f.id) ? filtres.delete(f.id) : filtres.add(f.id); store.set(K.filtres, JSON.stringify([...filtres])); rendre(); },
    }, typeof f.label === 'function' ? f.label() : f.label)));
    const liste = annoncesOnglet();
    const actives = (donnees.annonces || []).filter((a) => !a.ecartee);
    const duJour = actives.filter((a) => !a.favori && a.score >= param('seuil_alerte', 70)).filter((a) => new Date(a.date_tri).getTime() >= debutJour()).length;
    const c = $('compteur');
    c.replaceChildren();
    if (onglet === 'annonces') c.append(h('strong', null, liste.length + ' annonce' + (liste.length > 1 ? 's' : '')), ' · score ≥ ' + param('seuil_alerte', 70) + ' · ' + duJour + " aujourd'hui · tri : plus récentes");
    else c.append(h('strong', null, liste.length + (onglet === 'favoris' ? ' favori' : ' écartée') + (liste.length > 1 ? 's' : '')));
    const vide = {
      annonces: filtres.size ? 'Aucune annonce avec ces filtres.' : 'Aucune annonce au-dessus du score minimum pour le moment. Le moteur scanne en continu, les nouveautés apparaîtront ici.',
      favoris: 'Touche le cœur sur une annonce pour la retrouver ici.',
      ecartees: 'Les annonces écartées apparaissent ici, tu peux les rétablir.',
    }[onglet];
    $('liste').replaceChildren(...(liste.length ? liste.map(carte) : [h('p', { class: 'vide' }, vide)]));
  }

  function carte(a) {
    const recent = Date.now() - new Date(a.date_tri).getTime() < 24 * 3600 * 1000;
    const photo = h('a', { class: 'photo', href: a.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': "Ouvrir l'annonce", onclick: () => { if (!a.vue) changerEtat(a, 'vue'); } });
    photo.append(svg(ICONES.maison, 'repli'));
    if (a.photo_url) {
      const img = h('img', { src: a.photo_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      photo.append(img);
    }
    photo.append(h('div', { class: 'badges' },
      recent && !a.vue ? h('span', { class: 'badge nouveau' }, 'Nouveau') : null,
      a.prix_precedent ? h('span', { class: 'badge baisse' }, 'Prix en baisse') : null,
      h('span', { class: 'badge' }, depuis(a.date_tri))));
    photo.append(h('span', { class: 'badge sombre src' }, a.source + (a.annonceur ? ' · ' + a.annonceur : '')));

    const prixTxt = a.total_cc !== null && a.total_cc !== undefined ? euros(a.total_cc) : euros(a.prix);
    const prix = h('div', { class: 'prix' }, prixTxt,
      h('small', null, a.total_cc !== null && a.total_cc !== undefined ? 'CC' : 'HC · charges ?'),
      a.prix_precedent ? h('span', { class: 'barre' }, euros(a.prix_precedent)) : null);
    const specs = [a.surface ? String(a.surface).replace('.', ',') + ' m²' : 'surface ?',
      a.chambres !== null && a.chambres !== undefined ? (a.chambres + ' ch.') : (a.pieces ? 'T' + a.pieces : null),
      a.etage === 0 ? 'RDC' : (a.etage ? a.etage + 'e étage' : null),
      a.ascenseur === true ? 'ascenseur' : null, a.meuble === true ? 'meublé' : null].filter(Boolean).join(' · ');
    const lieu = [a.adresse || 'Adresse non précisée',
      a.distance_m !== null && a.distance_m !== undefined ? (a.distance_m < 1000 ? a.distance_m + ' m' : (a.distance_m / 1000).toFixed(1).replace('.', ',') + ' km') + ' de la cathédrale' : null].filter(Boolean).join(' · ');
    const pub = a.date_publication ? 'Publiée ' + depuis(a.date_publication) : 'Date de publication non communiquée';
    const niveau = a.score >= param('seuil_alerte', 70) ? 'haut' : a.score >= 50 ? 'moyen' : 'bas';

    const tags = [];
    if (a.dpe) tags.push(h('span', { class: 'tag ' + ('ABC'.includes(a.dpe) ? 'bon' : 'FG'.includes(a.dpe) ? 'risque' : '') }, 'DPE ' + a.dpe));
    if (a.zone === 'limitrophe') tags.push(h('span', { class: 'tag att' }, 'Limitrophe'));
    for (const v of a.vigilances || []) tags.push(h('span', { class: 'tag ' + (/arnaque/i.test(v) ? 'risque' : 'att') }, v));
    for (const p of (a.points_forts || []).slice(0, 2)) tags.push(h('span', { class: 'tag bon' }, p));
    const autres = (a.liens || []).filter((l) => l.url !== a.url);

    const btn = (champ, icone, label, cls) => h('button', {
      class: 'icone', 'aria-label': label, 'aria-pressed': a[champ] ? 'true' : 'false', onclick: () => changerEtat(a, champ),
    }, svg(ICONES[icone], cls));

    return h('article', { class: 'annonce' + (a.vue && onglet === 'annonces' ? ' vue' : ''), 'data-id': a.id },
      photo,
      h('div', { class: 'corps' },
        h('div', { class: 'ligne-prix' },
          h('div', null, prix, h('div', { class: 'specs' }, specs), h('div', { class: 'adresse' }, lieu), h('div', { class: 'adresse' }, pub)),
          h('div', { class: 'score ' + niveau, 'aria-label': 'Score ' + a.score + ' sur 100' }, h('b', null, String(a.score)), h('span', null, 'score'))),
        a.resume ? h('p', { class: 'resume' }, a.resume) : null,
        tags.length ? h('div', { class: 'tags' }, tags) : null,
        autres.length ? h('div', { class: 'aussi' }, 'Aussi sur : ', ...autres.map((l, i) => [i ? ', ' : '', h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.source)])) : null,
        h('div', { class: 'actions' },
          h('div', { class: 'gauche' },
            btn('vue', 'oeil', a.vue ? 'Marquer non vue' : 'Marquer vue'),
            btn('favori', 'coeur', a.favori ? 'Retirer des favoris' : 'Ajouter aux favoris', 'coeur'),
            onglet === 'ecartees' ? btn('ecartee', 'retour', 'Rétablir') : btn('ecartee', 'croix', 'Écarter'),
            h('button', { class: 'icone', 'aria-label': 'Copier le lien', onclick: () => copierLien(a.url) }, svg(ICONES.copier))),
          h('a', { class: 'voir', href: a.url, target: '_blank', rel: 'noopener noreferrer', onclick: () => { if (!a.vue) changerEtat(a, 'vue'); } },
            "Voir l'annonce", svg(ICONES.lien)))));
  }

  const LIBELLES = { seuil_alerte: 'Score minimum (annonces affichées et alertes Telegram)' };
  const CHOIX = {
    meuble: [[0, 'Indifférent'], [1, 'Meublé'], [2, 'Vide']],
    dpe_max: [[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D'], [5, 'E'], [6, 'F'], [7, 'G (tous)']],
  };

  function rendreMoteur() {
    const m = donnees.moteur || {};
    const kpi = (n, t) => h('div', { class: 'kpi' }, h('b', null, String(n ?? 0)), h('span', null, t));
    $('kpis').replaceChildren(kpi(m.scans_jour, "scans aujourd'hui"), kpi(m.retenues_jour, 'nouvelles retenues'),
      kpi(m.doublons_jour, 'doublons filtrés'), kpi(m.baisses_jour, 'baisses de prix'), kpi(m.rejets_jour, 'hors critères'), kpi(m.liens_jour, 'liens analysés'));
    // Sources « pages » : seules les actives sont affichées. Puis une ligne par portail suivi par alerte e-mail.
    const lignesPages = (m.sources || []).filter((s) => s.actif).map((s) => {
      const ok = s.statut === 'ok';
      const coul = ok ? '#2F6B4F' : /erreur/.test(s.statut || '') ? '#7A2E22' : '#B07D16';
      const pt = h('span', { class: 'point' }); pt.style.background = coul;
      return h('div', { class: 'ligne' }, pt,
        h('div', { class: 'txt' }, h('b', null, s.nom), h('span', null, 'Page du site · ' + (s.statut || 'pas encore collectée') + (s.nb_liens !== null && s.nb_liens !== undefined ? ' · ' + s.nb_liens + ' liens' : ''))),
        h('span', { class: 'droite' }, s.derniere_collecte ? depuis(s.derniere_collecte) : '—'));
    });
    const lignesMail = m.portails ? m.portails.map((p) => {
      const pt = h('span', { class: 'point' }); pt.style.background = p.derniere ? '#2F6B4F' : '#9AA0A6';
      return h('div', { class: 'ligne' }, pt,
        h('div', { class: 'txt' }, h('b', null, p.nom), h('span', null, 'Alerte e-mail · ' + (p.derniere ? p.nb_jour + " annonce" + (p.nb_jour > 1 ? 's' : '') + " aujourd'hui" : 'aucune annonce reçue pour l\'instant'))),
        h('span', { class: 'droite' }, p.derniere ? depuis(p.derniere) : '—'));
    }) : [h('div', { class: 'ligne' }, h('span', { class: 'point' }),
      h('div', { class: 'txt' }, h('b', null, 'Alertes e-mail des portails'), h('span', null, 'Traitées dès réception')))];
    $('sources').replaceChildren(...lignesPages, ...lignesMail);
    $('nom-utilisateur').textContent = donnees.utilisateur || '';
    const vs = m.version_serveur;
    $('versions').textContent = 'Appli v' + APP_VERSION + ' · Serveur ' + (vs ? 'v' + vs : 'ancienne version (à mettre à jour)')
      + (vs && vs.split('.').slice(0, 2).join('.') !== APP_VERSION.split('.').slice(0, 2).join('.') ? ' · versions différentes, mets à jour le serveur ou l\'appli' : '');
    const form = $('form-reglages');
    if (!form.contains(document.activeElement)) {
      form.replaceChildren(...(donnees.parametres || []).map((p) => {
        const id = 'p-' + p.cle;
        const choix = CHOIX[p.cle];
        const champ = choix
          ? h('select', { id, name: p.cle }, choix.map(([v, t]) => h('option', { value: v, selected: Number(p.valeur) === v }, t)))
          : h('input', { id, name: p.cle, type: 'number', inputmode: 'decimal', min: p.min, max: p.max, step: /_km$/.test(p.cle) ? '0.1' : '1', value: p.valeur, required: true });
        return h('div', { class: 'ligne' }, h('label', { for: id }, LIBELLES[p.cle] || p.libelle), champ);
      }), h('div', { class: 'valider' }, h('button', { type: 'submit', class: 'bouton-plein' }, 'Enregistrer les réglages')));
    }
  }

  $('form-reglages').addEventListener('submit', async (e) => {
    e.preventDefault();
    const corps = {};
    for (const inp of e.target.querySelectorAll('input, select')) corps[inp.name] = Number(String(inp.value).replace(',', '.'));
    const msg = $('msg-reglages');
    msg.textContent = 'Enregistrement…';
    try {
      const r = await appel('parametres', corps);
      msg.textContent = r.erreurs && r.erreurs.length ? 'Non enregistré : ' + r.erreurs.join(' ; ') : 'Réglages enregistrés. Ils s\'appliquent au prochain scan.';
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      await charger();
    } catch (err) {
      msg.textContent = 'Échec de l\'enregistrement : ' + err.message;
    }
  });

  for (const btn of document.querySelectorAll('.onglets button')) {
    btn.addEventListener('click', () => { onglet = btn.dataset.onglet; window.scrollTo(0, 0); rendre(); });
  }
  $('btn-actualiser').addEventListener('click', () => charger());
  window.addEventListener('hashchange', () => { if (/[#&]t=/.test(location.hash)) { lireJetonUrl(); donnees = null; charger(true); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') charger(); });
  setInterval(() => { if (document.visibilityState === 'visible') charger(); }, 2 * 60 * 1000);
  setInterval(() => { if (donnees && document.visibilityState === 'visible' && onglet !== 'moteur') rendre(); }, 60 * 1000);

  // Mise à jour automatique : quand une nouvelle version est publiée sur GitHub, le service worker
  // la récupère, prend la main, et l'appli se recharge une fois d'elle-même.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const dejaControlee = !!navigator.serviceWorker.controller;
    let recharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!dejaControlee || recharge) return;
      recharge = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch(() => {});
  }

  lireJetonUrl();
  if (!API) { ecranCode("Appli mal configurée : l'adresse du serveur manque dans config.js."); return; }
  if (jeton) {
    try { donnees = JSON.parse(store.get(K.cache) || 'null'); } catch (e) { donnees = null; }
    if (donnees) { $('ecran-principal').hidden = false; rendre(); }
    charger();
  } else ecranCode();
})();
