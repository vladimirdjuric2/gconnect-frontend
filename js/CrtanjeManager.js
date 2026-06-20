const DEFAULT_OPSTINE = [];

/**
 * CrtanjeManager - Upravlja režimom crtanja parcela/njiva na mapi
 */
export class CrtanjeManager {
    constructor(mapInstance) {
        this.map = mapInstance;
        this.crtanjeAktivno = false;
        this.trenutneTacke = [];
        
        // Pomoćne linije za crtanje i prikaz
        this.nacrtanaLinija = L.polyline([], {color: '#ff8c00', weight: 3}).addTo(this.map);
        this.privremenaLinija = L.polyline([], {color: '#ff8c00', weight: 3, dashArray: '5, 5'}).addTo(this.map);
        this.trenutniPoligon = null;
        this.trenutniKruzici = [];
        
        // State za njive i parcele
        this.njiveList = [];
        this.drawnPolygons = {};
        this.katastarskeOpstine = [];
        this.activeCoordinateTextarea = null;
        
        // Grupa slojeva za iscrtane njive
        this.fieldsLayer = L.featureGroup().addTo(this.map);

        // State i grupa slojeva za zone zalivanja
        this.zoneList = [];
        this.zonesLayer = L.featureGroup().addTo(this.map);
        this.tipCrtanja = 'njiva'; // 'njiva' ili 'zona'
        
        // Privatni fallback parametri (koje SnapManager preuzima nakon inicijalizacije)
        this._snapAngle = 90;
        this._angleSnapPx = 5;
        this._lineSnapPx = 5;
        this._popupDuration = 3;
        this._snapIndicator = null;
        this.popupTimer = null;
        
        this.initEvents();
        
        // Učitavanje na startu
        this.loadNjive();
        this.loadZoneZalivanja();
        this.loadOpstine();
        this.loadGeneralSettings();

        // Osluškivanje promena zuma za postavljanje klase na kontejner mape
        const updateZoomClass = () => {
            const currentZoom = this.map.getZoom();
            const container = this.map.getContainer();
            if (container) {
                const roundedZoom = Math.round(currentZoom);
                container.className = container.className.replace(/\bmap-zoom-[\d.]+\b/g, '');
                container.classList.add(`map-zoom-${roundedZoom}`);
            }
        };
        this.map.on('zoomend', updateZoomClass);
        updateZoomClass();
        
        // Kreiranje panela za podešavanja crtanja na mapi
        this.stvoriDrawingSettingsPanel();
    }
    
    // Geteri i seteri za preusmeravanje parametara na SnapManager
    get snapAngle() { return window.snapManager ? window.snapManager.snapAngle : (this._snapAngle !== undefined ? this._snapAngle : 90); }
    set snapAngle(val) {
        this._snapAngle = val;
        if (window.snapManager) window.snapManager.snapAngle = val;
    }
    get angleSnapPx() { return window.snapManager ? window.snapManager.angleSnapPx : (this._angleSnapPx !== undefined ? this._angleSnapPx : 5); }
    set angleSnapPx(val) {
        this._angleSnapPx = val;
        if (window.snapManager) window.snapManager.angleSnapPx = val;
    }
    get lineSnapPx() { return window.snapManager ? window.snapManager.lineSnapPx : (this._lineSnapPx !== undefined ? this._lineSnapPx : 5); }
    set lineSnapPx(val) {
        this._lineSnapPx = val;
        if (window.snapManager) window.snapManager.lineSnapPx = val;
    }
    get popupDuration() { return window.snapManager ? window.snapManager.popupDuration : (this._popupDuration !== undefined ? this._popupDuration : 3); }
    set popupDuration(val) {
        this._popupDuration = val;
        if (window.snapManager) window.snapManager.popupDuration = val;
    }
    get snapIndicator() { return window.snapManager ? window.snapManager.snapIndicator : this._snapIndicator; }
    set snapIndicator(val) { this._snapIndicator = val; }
    
    /**
     * Inicijalizuje događaje na mapi i elementima interfejsa
     */
    initEvents() {
        // 1. DUGME "+ NOVA NJIVA" - resetuje formu i otvara modal
        const btnNewField = document.querySelector('.btn-new-field');
        if (btnNewField) {
            btnNewField.addEventListener('click', () => {
                this.resetForm();
            });
        }

        // 1.1 DUGME "ZONA ZALIVANJA" U BOČNOM PANELU
        const btnZoneDraw = document.getElementById('tool-zone-draw');
        if (btnZoneDraw) {
            btnZoneDraw.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.crtanjeAktivno && this.tipCrtanja === 'zona') {
                    this.odbaciPoligon();
                } else {
                    this.pokreniCrtanje('zona');
                }
            });
        }
        
        // 2. DUGME "+ DODAJ PARCELU"
        const btnDodajParcelu = document.getElementById('btn-dodaj-parcelu');
        if (btnDodajParcelu) {
            btnDodajParcelu.addEventListener('click', (e) => {
                e.preventDefault();
                this.dodajParceluCard();
            });
        }
        
        // 3. DUGME "SNIMI" ZA NJIVU
        const btnSnimiNjivu = document.getElementById('btn-snimi-njivu');
        if (btnSnimiNjivu) {
            btnSnimiNjivu.addEventListener('click', (e) => {
                e.preventDefault();
                this.saveNjiva();
            });
        }
        
        // 4. LEVI KLIK NA MAPU (DODAVANJE NOVE TAČKE)
        this.map.on('click', (e) => {
            if (!this.crtanjeAktivno) return;
            let snappedLatLng = this.getSnappedLatLng(e.latlng);
            
            // Provera da li klikće blizu prve tačke radi zatvaranja poligona (sprečavanje duplih tačaka)
            if (this.trenutneTacke.length >= 3) {
                let prvaLatLng = this.trenutneTacke[0];
                let dist = this.map.latLngToLayerPoint(snappedLatLng).distanceTo(this.map.latLngToLayerPoint(prvaLatLng));
                if (dist < 15) { // 15 piksela tolerancije
                    this.zavrsiPoligon();
                    return;
                }
            }
            this.dodajTacku(snappedLatLng);
        });

        
        // 5. POMERANJE MIŠA (PRIVREMENA LINIJA PRATI KURSOR I SNAPUJE)
        this.map.on('mousemove', (e) => {
            if (!this.crtanjeAktivno) return;
            
            let snappedResult = this.getSnappedResult(e.latlng);
            let snappedLatLng = snappedResult.latlng;
            
            // Prikaz/skrivanje kružića za lepljenje (snap indicator)
            if (snappedResult.snapped) {
                if (!this.map.hasLayer(this.snapIndicator)) {
                    this.snapIndicator.addTo(this.map);
                }
                this.snapIndicator.setLatLng(snappedLatLng);
            } else {
                if (this.snapIndicator && this.map.hasLayer(this.snapIndicator)) {
                    this.map.removeLayer(this.snapIndicator);
                }
            }
            
            if (this.trenutneTacke.length === 0) return;
            
            // Linija od poslednje kliknute tačke do trenutne pozicije miša
            let zadnjaTacka = this.trenutneTacke[this.trenutneTacke.length - 1];
            this.privremenaLinija.setLatLngs([zadnjaTacka, snappedLatLng]);
        });
        
        // 6. DESNI KLIK NA MAPU (ZAVRŠETAK POLIGONA)
        this.map.on('contextmenu', (e) => {
            // Ne dozvoli zatvaranje poligona ako nema bar 3 tačke
            if (!this.crtanjeAktivno || this.trenutneTacke.length < 3) return;
            this.zavrsiPoligon();
        });

        // 6a. ESCAPE TASTER ZA PREKID CRTANJA I POVRATAK U MODAL
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                if (this.crtanjeAktivno || this.trenutniPoligon) {
                    this.crtanjeAktivno = false;
                    const mapaEl = document.getElementById('mapa');
                    if (mapaEl) {
                        mapaEl.style.cursor = '';
                        mapaEl.classList.remove('drawing-mode-active');
                    }
                    if (this.snapIndicator && this.map.hasLayer(this.snapIndicator)) {
                        this.map.removeLayer(this.snapIndicator);
                    }
                    this.nacrtanaLinija.setLatLngs([]);
                    this.privremenaLinija.setLatLngs([]);
                    this.odbaciPoligon();
                }
            }
        });
        
        // Povezivanje globalnih funkcija za gumbe unutar popupa na metode klase
        window.prihvatiPoligon = () => this.prihvatiPoligon();
        window.odbaciPoligon = () => this.odbaciPoligon();
        
        // 7. DUGME "DODAJ" ZA KATASTARSKU OPŠTINU
        const btnDodajOpstinu = document.getElementById('btn-dodaj-opstinu');
        if (btnDodajOpstinu) {
            btnDodajOpstinu.addEventListener('click', (e) => {
                e.preventDefault();
                const input = document.getElementById('nova-opstina-input');
                if (input && input.value.trim() !== '') {
                    const novaOpstina = input.value.trim();
                    if (!this.katastarskeOpstine.includes(novaOpstina)) {
                        this.katastarskeOpstine.push(novaOpstina);
                        input.value = '';
                        this.renderOpstineInTable();
                    } else {
                        alert("Ova katastarska opština već postoji na listi!");
                    }
                }
            });
        }
        
        // Enter u inputu za novu opštinu
        const inputNovaOpstina = document.getElementById('nova-opstina-input');
        if (inputNovaOpstina) {
            inputNovaOpstina.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (btnDodajOpstinu) btnDodajOpstinu.click();
                }
            });
        }
        
        // 8. DUGME "SNIMI" U KORISNIČKA PODEŠAVANJA MODAL-U
        const btnSnimiPodesavanja = document.getElementById('btn-snimi-podesavanja');
        if (btnSnimiPodesavanja) {
            btnSnimiPodesavanja.addEventListener('click', async (e) => {
                e.preventDefault();
                
                // Sačuvaj opštine
                const uspehOpstine = await this.saveOpstineToBackend();
                
                // Sačuvaj opšta podešavanja na server
                const optNaziv = document.getElementById('opt-naziv-sistema')?.value || '';
                const optGrupa = document.getElementById('opt-korisnik-grupa')?.value || '';
                const optLat = document.getElementById('opt-map-lat')?.value || '';
                const optLon = document.getElementById('opt-map-lon')?.value || '';
                const optZoom = document.getElementById('opt-map-zoom')?.value || '';
                
                const uspehPodesavanja = await this.saveSettingsToBackend({
                    system_name: optNaziv,
                    user_group: optGrupa,
                    map_lat: optLat,
                    map_lon: optLon,
                    map_zoom: optZoom
                });
                
                // Ažuriraj naslov/logo u top-nav ako postoji
                const logoSpan = document.getElementById('sistemski-naziv-prikaz');
                if (logoSpan) {
                    logoSpan.textContent = optNaziv || "Novi Sistem";
                }
                
                // Ažuriraj korisničku grupu u top-nav ako postoji
                const navUserSpan = document.getElementById('nav-user-prikaz');
                if (navUserSpan) {
                    navUserSpan.textContent = optGrupa || "Grupa: Nedefinisano";
                }
                
                if (uspehOpstine) {
                    // Zatvori modal
                    const modalEl = document.getElementById('modalPodesavanja');
                    const modalObj = bootstrap.Modal.getInstance(modalEl);
                    if (modalObj) modalObj.hide();
                    
                    alert("Podešavanja su uspešno sačuvana.");
                } else {
                    alert("Došlo je do greške prilikom čuvanja podešavanja.");
                }
            });
        }

        // 9. MOBILNA NAVIGACIJA - PROSLEDIVANJE DOGAĐAJA I SINHRONIZACIJA
        const mobTabPregled = document.getElementById('mobile-tab-pregled');
        if (mobTabPregled) {
            mobTabPregled.addEventListener('click', (e) => {
                e.preventDefault();
                const desktopPregled = document.querySelectorAll('.nav-center-links .nav-link-custom')[1];
                if (desktopPregled) desktopPregled.click();
            });
        }
        
        const mobTabNalozi = document.getElementById('mobile-tab-nalozi');
        if (mobTabNalozi) {
            mobTabNalozi.addEventListener('click', (e) => {
                e.preventDefault();
                const desktopNalozi = document.querySelectorAll('.nav-center-links .nav-link-custom')[2];
                if (desktopNalozi) desktopNalozi.click();
            });
        }
        
        const btnEditSystem = document.getElementById('btnEditSystem');
        const mobTabEdit = document.getElementById('mobile-tab-edit');
        if (btnEditSystem && mobTabEdit) {
            const syncEditButtonState = () => {
                const isActive = btnEditSystem.classList.contains('active');
                const icon = mobTabEdit.querySelector('i');
                const text = mobTabEdit.querySelector('#mobile-edit-text');
                if (isActive) {
                    mobTabEdit.classList.add('active');
                    if (icon) icon.className = 'fas fa-times';
                    if (text) text.textContent = 'Zatvori';
                } else {
                    mobTabEdit.classList.remove('active');
                    if (icon) icon.className = 'fas fa-pencil-alt';
                    if (text) text.textContent = 'Uredi';
                }
            };
            
            syncEditButtonState();
            
            const observer = new MutationObserver(() => {
                syncEditButtonState();
            });
            observer.observe(btnEditSystem, { attributes: true, attributeFilter: ['class'] });
            
            mobTabEdit.addEventListener('click', (e) => {
                e.preventDefault();
                btnEditSystem.click();
            });
        }
        
        const mobTabLogout = document.getElementById('mobile-tab-logout');
        if (mobTabLogout) {
            mobTabLogout.addEventListener('click', (e) => {
                e.preventDefault();
                const btnLogout = document.querySelector('.btn-odjava');
                if (btnLogout) btnLogout.click();
            });
        }
    }
    
    pokreniCrtanje(tip = 'njiva') {
        this.tipCrtanja = tip;

        if (tip !== 'zona') {
            // Sakrij modal pomoću Bootstrap API-ja
            let modalEl = document.getElementById('modalNovaNjiva');
            if (modalEl) {
                let modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
                modalObj.hide();
            }
        } else {
            // Deaktiviramo ostale alate u editoru
            if (window.editorManager) {
                window.editorManager.selectTool(null);
            }
            const btnZone = document.getElementById('tool-zone-draw');
            if (btnZone) btnZone.classList.add('active');
        }

        // Otkaži aktivno premeravanje ako je aktivno u MeasureManager-u
        if (window.measureManager && window.measureManager.isMeasuring) {
            window.measureManager.stopMeasuring(true);
        }

        // Aktiviraj režim crtanja i promeni kursor
        this.crtanjeAktivno = true;
        
        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.style.cursor = 'crosshair'; // Ikona "nišana"
            mapaEl.classList.add('drawing-mode-active');
        }
        
        // Inicijalizacija snap indikatora ako ne postoji
        if (!this.snapIndicator) {
            this.snapIndicator = L.circleMarker([0, 0], {
                radius: 6,
                color: '#ffffff',
                weight: 2,
                fillColor: '#39ff14', // Neon Zelena boja
                fillOpacity: 0.9,
                interactive: false
            });
        }
        if (this.map && this.map.hasLayer(this.snapIndicator)) {
            this.map.removeLayer(this.snapIndicator);
        }
        
        // Postavi stil linija u zavisnosti od tipa crtanja
        const lineStyle = tip === 'zona' ? {color: '#38bdf8', weight: 2.5} : {color: '#ff8c00', weight: 3};
        this.nacrtanaLinija.setStyle(lineStyle);
        this.privremenaLinija.setStyle(Object.assign({}, lineStyle, {dashArray: '5, 5'}));

        // Očisti prethodna crtanja
        this.trenutneTacke = [];
        this.nacrtanaLinija.setLatLngs([]);
        this.privremenaLinija.setLatLngs([]);
        this.trenutniKruzici.forEach(k => this.map.removeLayer(k));
        this.trenutniKruzici = [];
        if (this.trenutniPoligon) {
            this.map.removeLayer(this.trenutniPoligon);
            this.trenutniPoligon = null;
        }

        // Prikaži panel sa pravilima crtanja u gornjem desnom uglu mape
        this.prikaziDrawingSettingsPanel();
    }
    
    /**
     * Dodaje novu tačku poligonu i postavlja interaktivni marker koji može da se prevlači
     * @param {L.LatLng} latlng Koordinata nove tačke
     */
    dodajTacku(latlng) {
        this.trenutneTacke.push(latlng);
        this.nacrtanaLinija.addLatLng(latlng);

        // Kreiranje custom krug ikone pomoću L.divIcon
        let kruzicIcon = L.divIcon({
            className: 'custom-vertex-marker',
            html: '<div style="width: 12px; height: 12px; background-color: #ffffff; border: 2px solid #ff8c00; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4); cursor: move;"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });

        // Dodavanje pomičnog markera na kliknutu koordinatu
        let kruzic = L.marker(latlng, {
            icon: kruzicIcon,
            draggable: true
        }).addTo(this.map);

        // Čuvamo indeks tačke kojoj pripada ovaj kružić kako bismo je znali ažurirati pri prevlačenju
        kruzic.vertexIndex = this.trenutneTacke.length - 1;

        // Ako je ovo prva tačka, klik na nju treba da zatvori poligon ako ima bar 3 tačke
        if (kruzic.vertexIndex === 0) {
            kruzic.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (this.trenutneTacke.length >= 3) {
                    this.zavrsiPoligon();
                }
            });
        }

        // Slušamo događaj prevlačenja (drag) markera
        kruzic.on('drag', (event) => {
            let noviLatLng = event.target.getLatLng();
            let index = event.target.vertexIndex;
            
            // Ažuriramo tačku u nizu
            this.trenutneTacke[index] = noviLatLng;

            // Ako je poligon već kreiran, ažuriraj poligon, inače ažuriraj liniju crtanja
            if (this.trenutniPoligon) {
                this.trenutniPoligon.setLatLngs(this.trenutneTacke);
            } else {
                this.nacrtanaLinija.setLatLngs(this.trenutneTacke);
            }
        });

        this.trenutniKruzici.push(kruzic);
    }
    
    /**
     * Zaustavlja režim crtanja, generiše poligon i otvara popup za potvrdu/odbacivanje
     */
    zavrsiPoligon() {
        this.crtanjeAktivno = false;
        
        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.style.cursor = ''; // Vrati normalan kursor
            mapaEl.classList.remove('drawing-mode-active');
        }
        
        if (this.snapIndicator && this.map && this.map.hasLayer(this.snapIndicator)) {
            this.map.removeLayer(this.snapIndicator);
        }
        
        // Obriši pomoćne crtajuće linije
        this.nacrtanaLinija.setLatLngs([]);
        this.privremenaLinija.setLatLngs([]);

        // Kreiraj pravi poligon
        const polyColor = this.tipCrtanja === 'zona' ? '#38bdf8' : '#00cc00';
        const isZona = this.tipCrtanja === 'zona';
        this.trenutniPoligon = L.polygon(this.trenutneTacke, {
            color: polyColor, 
            weight: isZona ? 2.5 : 3.0,
            fill: !isZona,
            fillColor: isZona ? 'transparent' : polyColor, 
            fillOpacity: isZona ? 0 : 0.4,
            className: isZona ? 'watering-zone-polygon' : ''
        }).addTo(this.map);

        // Kreiranje HTML sadržaja za popup prozor
        let popupSadrzaj = `
            <div style="text-align: center; font-family: sans-serif;">
                <b style="font-size: 14px;">Završen poligon</b><br>
                <div style="margin-top: 10px; display: flex; gap: 5px; justify-content: center;">
                    <button onclick="prihvatiPoligon()" style="background: #00cc00; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Prihvati</button>
                    <button onclick="odbaciPoligon()" style="background: #ff3300; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Odbaci</button>
                </div>
            </div>
        `;

        // Veži popup za poligon i automatski ga otvori
        this.trenutniPoligon.bindPopup(popupSadrzaj, {
            closeButton: false, 
            closeOnClick: false
        }).openPopup();

        // Pokretanje automatskog zatvaranja popupa (Prihvati) ako je definisano vreme trajanja i ako nije zona
        if (this.tipCrtanja !== 'zona' && this.popupDuration > 0) {
            this.popupTimer = setTimeout(() => {
                this.prihvatiPoligon();
            }, this.popupDuration * 1000);
        }
    }
    
    /**
     * Prihvata iscrtani poligon, upisuje koordinate u formu i ponovo otvara modal
     */
    prihvatiPoligon() {
        if (this.popupTimer) {
            clearTimeout(this.popupTimer);
            this.popupTimer = null;
        }
        this.sakrijDrawingSettingsPanel();

        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.classList.remove('drawing-mode-active');
        }
        
        if (this.snapIndicator && this.map && this.map.hasLayer(this.snapIndicator)) {
            this.map.removeLayer(this.snapIndicator);
        }

        if (this.trenutniPoligon) {
            this.trenutniPoligon.closePopup();
        }

        // Deaktiviramo active klasu na dugmetu za zonu
        const btnZone = document.getElementById('tool-zone-draw');
        if (btnZone) btnZone.classList.remove('active');

        if (this.tipCrtanja === 'zona') {
            // Pitaj korisnika za naziv zone pomoću prompt()
            let imeZone = prompt("Unesite naziv zone zalivanja:", "Nova zona");
            if (imeZone === null) {
                // Korisnik je otkazao prompt, pa brišemo poligon i prekidamo
                if (this.trenutniPoligon) {
                    this.map.removeLayer(this.trenutniPoligon);
                    this.trenutniPoligon = null;
                }
                this.trenutneTacke = [];
                this.trenutniKruzici.forEach(k => this.map.removeLayer(k));
                this.trenutniKruzici = [];
                return;
            }
            if (!imeZone.trim()) imeZone = "Zona bez naziva";

            // Kreiramo objekat zone
            let novaZona = {
                id: 'zona_' + Date.now(),
                naziv: imeZone.trim(),
                koordinate: this.trenutneTacke.map(tacka => `${tacka.lat.toFixed(6)}, ${tacka.lng.toFixed(6)}`).join('\n')
            };

            this.zoneList.push(novaZona);
            
            // Brišemo privremeni poligon sa mape
            if (this.trenutniPoligon) {
                this.map.removeLayer(this.trenutniPoligon);
                this.trenutniPoligon = null;
            }
            this.trenutneTacke = [];
            this.trenutniKruzici.forEach(k => this.map.removeLayer(k));
            this.trenutniKruzici = [];

            // Sačuvaj i osveži
            this.saveZoneZalivanjaToBackend();
            this.renderZoneZalivanjaOnMap();
            return;
        }

        // Formatiranje koordinata za Textarea (lat, lon u novom redu)
        let formatiraneKoordinate = this.trenutneTacke.map(tacka => `${tacka.lat.toFixed(6)}, ${tacka.lng.toFixed(6)}`).join('\n');
        
        // Upisivanje u formu
        if (this.activeCoordinateTextarea) {
            this.activeCoordinateTextarea.value = formatiraneKoordinate;
            this.activeCoordinateTextarea = null;
        }

        // Sakrij pomoćne kružiće jer smo završili proces izmene
        this.trenutniKruzici.forEach(k => this.map.removeLayer(k));
        this.trenutniKruzici = [];

        // Ponovo prikaži modal "Nova Njiva"
        let modalEl = document.getElementById('modalNovaNjiva');
        if (modalEl) {
            let modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modalObj.show();
        }
    }
    
    /**
     * Odbacuje poligon i briše sve tragove crtanja, zatim ponovo otvara modal
     */
    odbaciPoligon() {
        if (this.popupTimer) {
            clearTimeout(this.popupTimer);
            this.popupTimer = null;
        }
        this.sakrijDrawingSettingsPanel();

        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.classList.remove('drawing-mode-active');
        }
        
        if (this.snapIndicator && this.map && this.map.hasLayer(this.snapIndicator)) {
            this.map.removeLayer(this.snapIndicator);
        }

        if (this.trenutniPoligon) {
            this.map.removeLayer(this.trenutniPoligon);
            this.trenutniPoligon = null;
        }
        this.trenutneTacke = [];
        this.activeCoordinateTextarea = null;
        
        // Sakrij pomoćne kružiće
        this.trenutniKruzici.forEach(k => this.map.removeLayer(k));
        this.trenutniKruzici = [];

        // Deaktiviramo active klasu na dugmetu za zonu
        const btnZone = document.getElementById('tool-zone-draw');
        if (btnZone) btnZone.classList.remove('active');

        if (this.tipCrtanja === 'zona') {
            return;
        }
        
        // Vrati modal ako korisnik odustane od crtanja
        let modalEl = document.getElementById('modalNovaNjiva');
        if (modalEl) {
            let modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modalObj.show();
        }
    }

    /**
     * Čisti formu i otvara je svežu
     */
    resetForm() {
        document.getElementById('njiva-naziv').value = '';
        document.getElementById('njiva-opis').value = '';
        document.getElementById('njiva-edit-id').value = '';
        const container = document.getElementById('parcele-kontejner');
        if (container) {
            container.innerHTML = '';
        }
        this.dodajParceluCard(); // Dodaj jednu podrazumevanu praznu parcelu
    }

    /**
     * Generiše i dodaje novu karticu za parcelu u modal
     */
    dodajParceluCard(data = null) {
        const container = document.getElementById('parcele-kontejner');
        if (!container) return;
        
        const parcelCount = container.querySelectorAll('.parcel-card').length + 1;
        const parcelId = 'parcel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const card = document.createElement('div');
        card.className = 'parcel-card mb-3';
        card.id = parcelId;
        card.style = "background-color: #343a40; border: 1px solid #495057; border-radius: 6px; padding: 15px; margin-bottom: 10px;";
        
        const checkedStr = (data && data.aktivna === false) ? '' : 'checked';
        const opstinaVal = (data && data.katastarska_opstina) ? data.katastarska_opstina : (this.katastarskeOpstine[0] || '');
        const brojVal = (data && data.broj_parcele) ? data.broj_parcele : '';
        const povrsinaVal = (data && data.povrsina) ? data.povrsina : '';
        const koordinateVal = (data && data.koordinate) ? data.koordinate : '';
        const bojaVal = (data && data.boja) ? data.boja : '#00cc00';
        
        let opcijeHtml = '';
        this.katastarskeOpstine.forEach(op => {
            const sel = (op === opstinaVal) ? 'selected' : '';
            opcijeHtml += `<option value="${op}" ${sel}>${op}</option>`;
        });
        
        card.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="d-flex align-items-center">
                    <input type="checkbox" class="parcel-aktivna" ${checkedStr} style="width: 18px; height: 18px; margin-right: 10px; accent-color: #00cc00;">
                    <span style="font-weight: bold; font-size: 13px; margin-right: 10px;">Parcela <span class="parcel-num">${parcelCount}</span></span>
                    <input type="color" class="parcel-boja" value="${bojaVal}" style="width: 30px; height: 24px; padding: 0; border: none; background: transparent; cursor: pointer; outline: none; vertical-align: middle;" title="Izaberi boju parcele">
                </div>
                <button type="button" class="btn-remove-parcel btn btn-link text-danger p-0 border-0" style="text-decoration: none; font-size: 13px; font-weight: bold;">
                    <i class="fas fa-trash-alt"></i> Ukloni
                </button>
            </div>

            <div class="row">
                <div class="col-md-4 mb-2">
                    <label class="form-label-custom">Katastarska opština *</label>
                    <select class="form-select form-control-custom parcel-opstina">
                        ${opcijeHtml}
                    </select>
                </div>
                <div class="col-md-4 mb-2">
                    <label class="form-label-custom">Broj parcele *</label>
                    <input type="text" class="form-control form-control-custom parcel-broj" value="${brojVal}" placeholder="npr. 1413">
                </div>
                <div class="col-md-4 mb-2">
                    <label class="form-label-custom">Površina (ha)</label>
                    <input type="text" class="form-control form-control-custom parcel-povrsina" value="${povrsinaVal}" placeholder="npr. 7.818">
                </div>
                <div class="col-12 mt-2">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <label class="form-label-custom mb-0">Koordinate *</label>
                        <button type="button" class="btn btn-warning btn-sm btn-unesi-koordinate" style="font-size: 11px; font-weight: bold; padding: 2px 10px;">UNESI KOORDINATE</button>
                    </div>
                    <textarea class="form-control form-control-custom parcel-koordinate" rows="2" style="font-family: monospace; font-size: 11px;" placeholder="lat, lon tačaka razdvojene novim redom...">${koordinateVal}</textarea>
                </div>
            </div>
        `;
        
        container.appendChild(card);
        
        // Poveži događaj brisanja
        card.querySelector('.btn-remove-parcel').addEventListener('click', () => {
            card.remove();
            this.renumerisiParcele();
        });
        
        // Poveži dugme "UNESI KOORDINATE"
        card.querySelector('.btn-unesi-koordinate').addEventListener('click', (e) => {
            e.preventDefault();
            this.activeCoordinateTextarea = card.querySelector('.parcel-koordinate');
            this.pokreniCrtanje();
        });
    }

    /**
     * Prebrojava i prenumeriše preostale parcele
     */
    renumerisiParcele() {
        const container = document.getElementById('parcele-kontejner');
        if (!container) return;
        const cards = container.querySelectorAll('.parcel-card');
        cards.forEach((card, index) => {
            card.querySelector('.parcel-num').innerText = index + 1;
        });
    }

    /**
     * Prikuplja podatke iz forme i snima na server
     */
    async saveNjiva() {
        const naziv = document.getElementById('njiva-naziv').value.trim();
        const opis = document.getElementById('njiva-opis').value.trim();
        const editId = document.getElementById('njiva-edit-id').value;
        
        if (!naziv) {
            alert("Naziv njive je obavezno polje!");
            return;
        }
        
        const container = document.getElementById('parcele-kontejner');
        const cards = container.querySelectorAll('.parcel-card');
        const parcele = [];
        
        let valid = true;
        cards.forEach(card => {
            const aktivna = card.querySelector('.parcel-aktivna').checked;
            const katastarska_opstina = card.querySelector('.parcel-opstina').value;
            const broj_parcele = card.querySelector('.parcel-broj').value.trim();
            const povrsinaRaw = card.querySelector('.parcel-povrsina').value.trim();
            const koordinateRaw = card.querySelector('.parcel-koordinate').value.trim();
            
            if (aktivna) {
                if (!broj_parcele) {
                    alert("Broj parcele je obavezan za sve aktivne parcele!");
                    valid = false;
                    return;
                }
                if (!koordinateRaw) {
                    alert("Koordinate su obavezne za sve aktivne parcele!");
                    valid = false;
                    return;
                }
            }
            
            const povrsina = parseFloat(povrsinaRaw) || 0;
            const boja = card.querySelector('.parcel-boja').value || '#00cc00';
            
            parcele.push({
                aktivna,
                katastarska_opstina,
                broj_parcele,
                povrsina,
                koordinate: koordinateRaw,
                boja
            });
        });
        
        if (!valid) return;
        
        // Generiši ili zadrži ID
        const id = editId ? editId : 'njiva_' + Date.now();
        
        const novaNjiva = {
            id,
            naziv,
            opis,
            parcele
        };
        
        // Ažuriraj ili dodaj u niz
        const index = this.njiveList.findIndex(n => n.id === id);
        if (index > -1) {
            this.njiveList[index] = novaNjiva;
        } else {
            this.njiveList.push(novaNjiva);
        }
        
        // Sačuvaj na RPi bekend
        const uspeh = await this.saveNjiveToBackend();
        if (uspeh) {
            // Zatvori modal pomoću Bootstrap API-ja
            let modalEl = document.getElementById('modalNovaNjiva');
            let modalObj = bootstrap.Modal.getInstance(modalEl);
            if (modalObj) modalObj.hide();
            
            // Osveži mapu i tabelu
            this.renderNjiveOnMap();
            this.renderNjiveInTable();
        } else {
            alert("Došlo je do greške prilikom čuvanja njive na serveru!");
        }
    }

    /**
     * Šalje zahteve na bekend radi trajnog skladištenja
     */
    async saveNjiveToBackend() {
        try {
            const response = await fetch('/api/njive', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.njiveList)
            });

            if (response.ok) {
                console.log("Njive uspešno sačuvane na bekend.");
                return true;
            }
        } catch (err) {
            console.error("Greška prilikom čuvanja njiva na bekend:", err);
        }
        // Rezervno čuvamo u localStorage
        localStorage.setItem('gimelnet_njive_v1', JSON.stringify(this.njiveList));
        return true; 
    }

    /**
     * Učitava podatke o njivama sa bekenda ili localStorage
     */
    async loadNjive() {
        let loaded = false;
        try {
            const response = await fetch('/api/njive');
            if (response.ok) {
                this.njiveList = await response.json();
                console.log("Njive uspešno učitane sa bekenda.");
                loaded = true;
            }
        } catch (err) {
            console.warn("Problem sa učitavanjem njiva sa bekenda:", err.message);
        }
        
        if (!loaded) {
            const raw = localStorage.getItem('gimelnet_njive_v1');
            if (raw) {
                try {
                    this.njiveList = JSON.parse(raw);
                    console.log("Njive učitane iz localStorage.");
                } catch(e) {
                    this.njiveList = [];
                }
            }
        }

        // Auto-korekcija površina ukoliko su prazne, 0, null ili NaN
        let needSave = false;
        if (this.njiveList && Array.isArray(this.njiveList)) {
            this.njiveList.forEach(njiva => {
                if (njiva.parcele && Array.isArray(njiva.parcele)) {
                    njiva.parcele.forEach(parcel => {
                        const parsedPts = this.parseCoordinates(parcel.koordinate);
                        if (parsedPts.length >= 3) {
                            const computed = this.calculatePolygonArea(parsedPts);
                            const current = parseFloat(parcel.povrsina);
                            // Ako povrsina nije definisana, ili je 0, ili je NaN, ili se razlikuje od izračunate
                            if (parcel.povrsina === null || parcel.povrsina === undefined || isNaN(current) || current === 0 || Math.abs(current - computed) > 0.001) {
                                parcel.povrsina = computed;
                                needSave = true;
                            }
                        } else {
                            if (parcel.povrsina !== 0) {
                                parcel.povrsina = 0;
                                needSave = true;
                            }
                        }
                    });
                }
            });
        }

        if (needSave) {
            console.log("Automatski ispravljene površine parcela u bazi. Snimam na server...");
            this.saveNjiveToBackend();
        }
        
        // Iscrtaj i osveži
        this.renderNjiveOnMap();
        this.renderNjiveInTable();
        
        if (window.fitSystemBounds) {
            window.fitSystemBounds();
        }
    }

    /**
     * Pomoćni metod za pretvaranje teksta koordinata u niz [lat, lng]
     */
    parseCoordinates(text) {
        const tacke = [];
        if (!text) return tacke;
        const linije = text.split('\n');
        linije.forEach(linija => {
            const delovi = linija.split(',');
            if (delovi.length === 2) {
                const lat = parseFloat(delovi[0].trim());
                const lng = parseFloat(delovi[1].trim());
                if (!isNaN(lat) && !isNaN(lng)) {
                    tacke.push([lat, lng]);
                }
            }
        });
        return tacke;
    }

    /**
     * Pronalazi teme koje je najbliže gornjem levom uglu bounding box-a poligona
     * @param {Array} points Niz [lat, lng] tačaka
     * @returns {Array} [lat, lng] najsevernijeg-najzapadnijeg temena
     */
    findTopLeftVertex(points) {
        if (!points || points.length === 0) return null;
        
        let maxLat = -Infinity;
        let minLng = Infinity;
        
        points.forEach(p => {
            if (p[0] > maxLat) maxLat = p[0];
            if (p[1] < minLng) minLng = p[1];
        });
        
        let bestPoint = points[0];
        let minDistance = Infinity;
        
        points.forEach(p => {
            const dLat = p[0] - maxLat;
            const dLng = p[1] - minLng;
            const dist = dLat * dLat + dLng * dLng;
            if (dist < minDistance) {
                minDistance = dist;
                bestPoint = p;
            }
        });
        
        return bestPoint;
    }

    /**
     * Računa površinu poligona u hektarima (ha) koristeći Shoelace formulu u metrima
     * @param {Array} points Niz tačaka (podržava [lat, lng], {lat, lng} i L.LatLng)
     * @returns {Number} Površina u hektarima
     */
    calculatePolygonArea(points) {
        if (!points || points.length < 3) return 0;
        
        // Normalizujemo tačke u jednostavan format {lat, lng}
        const normalized = points.map(p => {
            if (p instanceof L.LatLng) {
                return { lat: p.lat, lng: p.lng };
            } else if (Array.isArray(p)) {
                return { lat: parseFloat(p[0]), lng: parseFloat(p[1]) };
            } else if (p && typeof p === 'object') {
                return { 
                    lat: parseFloat(p.lat !== undefined ? p.lat : p[0]), 
                    lng: parseFloat(p.lng !== undefined ? p.lng : p[1]) 
                };
            }
            return null;
        }).filter(p => p !== null && !isNaN(p.lat) && !isNaN(p.lng));

        if (normalized.length < 3) return 0;
        
        let sumLat = 0;
        normalized.forEach(p => sumLat += p.lat);
        const lat0 = sumLat / normalized.length;
        const cosLat0 = Math.cos(lat0 * Math.PI / 180.0);
        
        // Konverzija u lokalne metre
        const x = normalized.map(p => p.lng * 111319.9 * cosLat0);
        const y = normalized.map(p => p.lat * 111132.92);
        
        // Shoelace formula
        let area = 0;
        const n = normalized.length;
        for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            area += x[i] * y[next] - x[next] * y[i];
        }
        
        return Math.abs(area) / 2.0 / 10000.0;
    }

    /**
     * Iscrtava prozirne zelene poligone na Leaflet mapi sa permanentnim oznakama
     */
    renderNjiveOnMap(options = {}) {
        this.fieldsLayer.clearLayers();
        this.drawnPolygons = {};
        
        const ignore = options.ignoreParcel || null;
        
        this.njiveList.forEach(njiva => {
            let renderedFieldName = false;
            njiva.parcele.forEach((parcel, parcelIdx) => {
                if (!parcel.aktivna) return;
                
                // Provera za ignorisanje tokom editovanja
                if (ignore && ignore.njivaId === njiva.id && ignore.parcelIdx === parcelIdx) {
                    return;
                }
                
                const points = this.parseCoordinates(parcel.koordinate);
                if (points.length >= 3) {
                    const parcelColor = parcel.boja || '#00cc00';
                    const isSystemEdit = !!(window.editorManager && window.editorManager.isEditMode);
                    const poly = L.polygon(points, {
                        color: parcelColor,
                        weight: 2,
                        fillColor: parcelColor,
                        fillOpacity: 0.15,
                        interactive: !isSystemEdit,
                        className: 'parcel-polygon'
                    });
                    
                    // Dodaj klik osluškivač za otvaranje custom popupa sa podacima njive
                    poly.on('click', (e) => {
                        L.DomEvent.stopPropagation(e);
                        
                        // Ako je u toku selekcija ventila za scenario u EditorManager-u, potpuno ignoriši klik na parcelu
                        if (window.editorManager && window.editorManager.isSelectingValvesForScenario) {
                            return;
                        }
                        
                        // Ne otvaraj ako je u toku crtanje, premeravanje ili editovanje
                        if (this.crtanjeAktivno) return;
                        if (window.measureManager && window.measureManager.isMeasuring) return;
                        if (this.editingNjiva) return;
                        
                        this.openFieldPopup(njiva, e.latlng);
                    });

                    // Dodaj contextmenu (desni klik) osluškivač za otvaranje menija PRIHVATI/ODBACI ako je selekcija aktivna
                    poly.on('contextmenu', (e) => {
                        if (window.editorManager && window.editorManager.isSelectingValvesForScenario) {
                            L.DomEvent.stopPropagation(e);
                            window.editorManager.showSelectionContextMenu(e.latlng);
                        }
                    });
                    
                    this.fieldsLayer.addLayer(poly);
                    
                    // 1. Naziv njive u gornjem levom uglu (samo jednom za celu njivu)
                    const topLeftPoint = this.findTopLeftVertex(points);
                    if (topLeftPoint && !renderedFieldName) {
                        const topLeftLabel = L.divIcon({
                            className: 'parcel-label-top-left-container',
                            html: `<div class="parcel-label-top-left" style="border-color: ${parcelColor}80;">
                                <div class="field-name" style="color: #ffffff; font-weight: bold;">${njiva.naziv}</div>
                            </div>`,
                            iconSize: [120, 30],
                            iconAnchor: [0, 0]
                        });
                        const topLeftMarker = L.marker(topLeftPoint, {
                            icon: topLeftLabel,
                            interactive: false
                        });
                        this.fieldsLayer.addLayer(topLeftMarker);
                        renderedFieldName = true;
                    }
                    
                    // 2. Broj parcele i površina u centru parcele (dinamički izračunata, sa brojem parcele iznad površine)
                    const calculatedArea = this.calculatePolygonArea(points);
                    const centerPoint = poly.getBounds().getCenter();
                    if (centerPoint) {
                        const centerLabel = L.divIcon({
                            className: 'parcel-label-center-container',
                            html: `<div class="parcel-label-center" style="border-color: ${parcelColor}40;">
                                <div class="parcel-number">Parc. ${parcel.broj_parcele}</div>
                                <div class="parcel-area">${calculatedArea.toFixed(3)} ha</div>
                            </div>`,
                            iconSize: [100, 38],
                            iconAnchor: [50, 19]
                        });
                        const centerMarker = L.marker(centerPoint, {
                            icon: centerLabel,
                            interactive: false
                        });
                        this.fieldsLayer.addLayer(centerMarker);
                    }
                    
                    if (!this.drawnPolygons[njiva.id]) {
                        this.drawnPolygons[njiva.id] = [];
                    }
                    this.drawnPolygons[njiva.id].push(poly);
                }
            });
        });

        if (typeof window.osveziTragoveIstorije === 'function') {
            window.osveziTragoveIstorije();
        }
    }

    /**
     * Popunjava tabelu u tabu Podešavanja dinamičkim podacima
     */
    renderNjiveInTable() {
        const tbody = document.getElementById('njive-table-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (this.njiveList.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: center; color: #ced4da; padding: 20px; font-size: 13px;">
                        Nema unesenih njiva. Kliknite na dugme "+ NOVA NJIVA" iznad da dodate novu njivu.
                    </td>
                </tr>
            `;
            return;
        }
        
        this.njiveList.forEach(njiva => {
            const totalArea = njiva.parcele.reduce((sum, p) => p.aktivna ? sum + p.povrsina : sum, 0);
            const parcelDetails = njiva.parcele.map(p => `${p.katastarska_opstina}_${p.broj_parcele}`).join(', ') || 'Nema parcela';
            
            const firstActiveParcel = njiva.parcele.find(p => p.aktivna);
            const fieldColor = firstActiveParcel ? (firstActiveParcel.boja || '#00cc00') : '#00cc00';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <span class="field-circle" style="background-color: ${fieldColor};"></span>
                    <b>${njiva.naziv}</b><br>
                    <small style="color: #adb5bd; font-size: 11px;">${parcelDetails}</small>
                </td>
                <td>
                    <span class="area-text" style="color: ${fieldColor}; font-weight: bold;">${totalArea.toFixed(3)} ha</span><br>
                    <small style="color: #6c757d;">${njiva.parcele.length} parcela</small>
                </td>
                <td style="white-space: nowrap;">
                    <i class="fas fa-search action-icon btn-zoom-njiva" title="Prikaži na mapi" style="cursor: pointer; margin-right: 15px; font-size: 14px;"></i>
                    <i class="fas fa-pencil-alt action-icon btn-edit-njiva" title="Izmeni" style="cursor: pointer; margin-right: 15px; font-size: 14px;"></i>
                    <i class="fas fa-trash-alt action-icon text-danger btn-delete-njiva" title="Obriši" style="cursor: pointer; font-size: 14px;"></i>
                </td>
            `;
            
            tbody.appendChild(tr);
            
            // Poveži događaje
            tr.querySelector('.btn-zoom-njiva').addEventListener('click', () => this.zoomToNjiva(njiva.id));
            tr.querySelector('.btn-edit-njiva').addEventListener('click', () => this.editNjiva(njiva.id));
            tr.querySelector('.btn-delete-njiva').addEventListener('click', () => this.deleteNjiva(njiva.id));
        });
    }

    /**
     * Zumira mapu na granice poligona izabrane njive
     */
    zoomToNjiva(id) {
        const polygons = this.drawnPolygons[id];
        if (polygons && polygons.length > 0) {
            // Zatvori modal podešavanja da bi se videla mapa
            const modalEl = document.getElementById('modalPodesavanja');
            const modalObj = bootstrap.Modal.getInstance(modalEl);
            if (modalObj) modalObj.hide();
            
            // Napravi bounds od svih poligona te njive
            const group = L.featureGroup(polygons);
            this.map.fitBounds(group.getBounds(), { padding: [50, 50] });
        } else {
            alert("Ova njiva nema iscrtanih parcela sa koordinatama!");
        }
    }

    /**
     * Pokreće režim izmene njive i popunjava modal
     */
    editNjiva(id) {
        const njiva = this.njiveList.find(n => n.id === id);
        if (!njiva) return;
        
        // Zatvori modal podešavanja da se ne preklapaju
        const modalPodesavanjaEl = document.getElementById('modalPodesavanja');
        const modalPodesavanjaObj = bootstrap.Modal.getInstance(modalPodesavanjaEl);
        if (modalPodesavanjaObj) modalPodesavanjaObj.hide();
        
        // Otvori modalNovaNjiva i popuni ga
        document.getElementById('njiva-naziv').value = njiva.naziv;
        document.getElementById('njiva-opis').value = njiva.opis || '';
        document.getElementById('njiva-edit-id').value = njiva.id;
        
        const container = document.getElementById('parcele-kontejner');
        container.innerHTML = '';
        
        if (njiva.parcele && njiva.parcele.length > 0) {
            njiva.parcele.forEach(p => {
                this.dodajParceluCard(p);
            });
        } else {
            this.dodajParceluCard();
        }
        
        // Otvori modalNovaNjiva
        const modalEl = document.getElementById('modalNovaNjiva');
        const modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        modalObj.show();
    }

    /**
     * Briše njivu i sačuva stanje
     */
    async deleteNjiva(id) {
        const njiva = this.njiveList.find(n => n.id === id);
        if (!njiva) return;
        
        if (confirm(`Da li ste sigurni da želite obrisati njivu "${njiva.naziv}" i sve njene parcele?`)) {
            this.njiveList = this.njiveList.filter(n => n.id !== id);
            
            const uspeh = await this.saveNjiveToBackend();
            if (uspeh) {
                this.renderNjiveOnMap();
                this.renderNjiveInTable();
            } else {
                alert("Greška pri brisanju sa servera!");
            }
        }
    }

    /**
     * Učitava podatke o katastarskim opštinama sa bekenda ili koristi podrazumevane
     */
    async loadOpstine() {
        let loaded = false;
        try {
            const response = await fetch('/api/opstine');
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    this.katastarskeOpstine = data;
                    console.log("Katastarske opštine uspešno učitane sa bekenda.");
                    loaded = true;
                } else {
                    console.error("Učitani podaci o katastarskim opštinama nisu u formatu niza:", data);
                }
            }
        } catch (err) {
            console.warn("Problem sa učitavanjem opština sa bekenda:", err.message);
        }
        
        if (!loaded) {
            const raw = localStorage.getItem('gimelnet_opstine_v1');
            if (raw) {
                try {
                    const data = JSON.parse(raw);
                    if (Array.isArray(data)) {
                        this.katastarskeOpstine = data;
                        console.log("Katastarske opštine učitane iz localStorage.");
                        loaded = true;
                    }
                } catch(e) {
                    // fall back to default
                }
            }
        }
        
        if (!Array.isArray(this.katastarskeOpstine)) {
            this.katastarskeOpstine = [...DEFAULT_OPSTINE];
        }
        
        this.renderOpstineInTable();
    }

    /**
     * Šalje zahteve na bekend radi trajnog skladištenja opština
     */
    async saveOpstineToBackend() {
        if (!Array.isArray(this.katastarskeOpstine)) {
            this.katastarskeOpstine = [...DEFAULT_OPSTINE];
        }
        try {
            const response = await fetch('/api/opstine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.katastarskeOpstine)
            });

            if (response.ok) {
                console.log("Katastarske opštine uspešno sačuvane na bekend.");
                return true;
            }
        } catch (err) {
            console.error("Greška prilikom čuvanja opština na bekend:", err);
        }
        
        localStorage.setItem('gimelnet_opstine_v1', JSON.stringify(this.katastarskeOpstine));
        return true;
    }

    /**
     * Popunjava tabelu u tabu Podešavanja -> KAT. OPŠTINE dinamičkim podacima
     */
    renderOpstineInTable() {
        const tbody = document.getElementById('opstine-table-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (!Array.isArray(this.katastarskeOpstine)) {
            this.katastarskeOpstine = [...DEFAULT_OPSTINE];
        }
        
        if (this.katastarskeOpstine.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="2" style="text-align: center; color: #ced4da; padding: 20px; font-size: 13px;">
                        Nema unesenih katastarskih opština. Unesite naziv iznad i kliknite na dugme "DODAJ".
                    </td>
                </tr>
            `;
            return;
        }
        
        this.katastarskeOpstine.forEach((opstina, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <span class="field-circle" style="background-color: #ff8c00;"></span>
                    <b>${opstina}</b>
                </td>
                <td style="white-space: nowrap; text-align: right;">
                    <i class="fas fa-trash-alt action-icon text-danger btn-delete-opstina" data-index="${index}" title="Obriši" style="cursor: pointer; font-size: 14px;"></i>
                </td>
            `;
            tbody.appendChild(tr);
            
            tr.querySelector('.btn-delete-opstina').addEventListener('click', () => {
                this.deleteOpstina(index);
            });
        });
    }

    /**
     * Briše opštinu iz lokalne liste
     */
    deleteOpstina(index) {
        const opstina = this.katastarskeOpstine[index];
        if (confirm(`Da li ste sigurni da želite obrisati katastarsku opštinu "${opstina}"?`)) {
            this.katastarskeOpstine.splice(index, 1);
            this.renderOpstineInTable();
        }
    }

    /**
     * Učitava opšta podešavanja sa servera i primenjuje ih na UI
     */
    async loadGeneralSettings() {
        let settings = null;
        try {
            const response = await fetch('/api/podesavanja');
            if (response.ok) {
                settings = await response.json();
            }
        } catch (err) {
            console.warn("Problem sa učitavanjem podešavanja sa bekenda:", err.message);
        }

        this.generalSettings = settings || {};

        if (!settings || typeof settings !== 'object') {
            try {
                settings = {
                    system_name: localStorage.getItem('gimelnet_system_name') || "",
                    user_group: localStorage.getItem('gimelnet_user_group') || "",
                    map_lat: localStorage.getItem('gimelnet_map_lat') || "",
                    map_lon: localStorage.getItem('gimelnet_map_lon') || "",
                    map_zoom: localStorage.getItem('gimelnet_map_zoom') || ""
                };
            } catch (e) {
                settings = {};
            }
        }

        const optNaziv = settings.system_name || "";
        const optGrupa = settings.user_group || "";
        const optLat = settings.map_lat || "";
        const optLon = settings.map_lon || "";
        const optZoom = settings.map_zoom || "";

        // Ažuriraj naslov/logo u top-nav ako postoji
        const logoSpan = document.getElementById('sistemski-naziv-prikaz');
        if (logoSpan) {
            logoSpan.textContent = optNaziv || "Novi Sistem";
        }
        
        // Ažuriraj korisničku grupu u top-nav ako postoji
        const navUserSpan = document.getElementById('nav-user-prikaz');
        if (navUserSpan) {
            navUserSpan.textContent = optGrupa || "Grupa: Nedefinisano";
        }
        
        // Popuni inputs u tabu ukoliko već postoje u DOM-u
        const inputNaziv = document.getElementById('opt-naziv-sistema');
        if (inputNaziv) inputNaziv.value = optNaziv;
        
        const inputGrupa = document.getElementById('opt-korisnik-grupa');
        if (inputGrupa) inputGrupa.value = optGrupa;
        
        const inputLat = document.getElementById('opt-map-lat');
        if (inputLat) inputLat.value = optLat;
        
        const inputLon = document.getElementById('opt-map-lon');
        if (inputLon) inputLon.value = optLon;
        
        const inputZoom = document.getElementById('opt-map-zoom');
        if (inputZoom) inputZoom.value = optZoom;

        // Ako imamo koordinate i zoom, i nemamo elemenata na mapi, postavimo centar mape
        if (optLat && optLon) {
            const lat = parseFloat(optLat);
            const lon = parseFloat(optLon);
            const zoom = optZoom ? parseInt(optZoom) : 13;
            if (!isNaN(lat) && !isNaN(lon)) {
                // Proveravamo da li imamo ikakve elemente, ako nemamo, pozicioniraj mapu
                setTimeout(() => {
                    let hasElements = false;
                    if (this.fieldsLayer && this.fieldsLayer.getBounds().isValid()) {
                        hasElements = true;
                    }
                    if (window.editorManager && window.editorManager.deviceMarkers && Object.keys(window.editorManager.deviceMarkers).length > 0) {
                        hasElements = true;
                    }
                    if (window.editorManager && window.editorManager.pipeLines && Object.keys(window.editorManager.pipeLines).length > 0) {
                        hasElements = true;
                    }
                    
                    if (!hasElements) {
                        this.map.setView([lat, lon], zoom);
                        console.log(`Mapa pozicionirana na korisnički centar: [${lat}, ${lon}], zoom: ${zoom}`);
                    }
                }, 200);
            }
        }
    }

    /**
     * Učitava podatke o zonama zalivanja sa bekenda ili localStorage
     */
    async loadZoneZalivanja() {
        let loaded = false;
        try {
            const response = await fetch('/api/zone-zalivanja');
            if (response.ok) {
                this.zoneList = await response.json();
                console.log("Zone zalivanja uspešno učitane sa bekenda.");
                loaded = true;
            }
        } catch (err) {
            console.warn("Problem sa učitavanjem zona zalivanja sa bekenda:", err.message);
        }
        
        if (!loaded) {
            const raw = localStorage.getItem('gimelnet_zone_zalivanja_v1');
            if (raw) {
                try {
                    this.zoneList = JSON.parse(raw);
                    console.log("Zone zalivanja učitane iz localStorage.");
                } catch(e) {
                    this.zoneList = [];
                }
            }
        }

        // Iscrtaj na mapi
        this.renderZoneZalivanjaOnMap();
    }

    /**
     * Čuva zone zalivanja na bekend ili localStorage
     */
    async saveZoneZalivanjaToBackend() {
        try {
            const response = await fetch('/api/zone-zalivanja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.zoneList)
            });

            if (response.ok) {
                console.log("Zone zalivanja uspešno sačuvane na bekend.");
                return true;
            }
        } catch (err) {
            console.error("Greška prilikom čuvanja zona zalivanja na bekend:", err);
        }
        localStorage.setItem('gimelnet_zone_zalivanja_v1', JSON.stringify(this.zoneList));
        return true; 
    }

    /**
     * Iscrtava sve zone zalivanja na mapi
     */
    renderZoneZalivanjaOnMap() {
        if (!this.zonesLayer) {
            this.zonesLayer = L.featureGroup().addTo(this.map);
        }
        this.zonesLayer.clearLayers();

        const isEditMode = !!(window.editorManager && window.editorManager.isEditMode);

        this.zoneList.forEach(zona => {
            const points = this.parseCoordinates(zona.koordinate);
            if (points.length >= 3) {
                const poly = L.polygon(points, {
                    color: '#38bdf8',
                    weight: 2.0,
                    fill: false, // Potpuno transparentne i dozvoljavaju klik kroz njihovu površinu
                    className: 'watering-zone-polygon',
                    interactive: true
                });

                // Računanje površine zone za prikaz u popupu / modalu
                const povrsina = this.calculatePolygonArea(points);

                if (isEditMode) {
                    // U edit modu, klik otvara modal za podešavanje zone
                    poly.on('click', (e) => {
                        if (e && e.originalEvent) {
                            e.originalEvent._handledByLayer = true;
                        }
                        L.DomEvent.stopPropagation(e);
                        this.otvoriModalZaEditZone(zona);
                    });
                } else {
                    // Popup sa nazivom, površinom i dugmetom za brisanje
                    let popupSadrzaj = `
                        <div style="font-family: 'Outfit', 'Inter', sans-serif; padding: 5px; min-width: 150px; color: #333;">
                            <div style="font-weight: bold; font-size: 13px; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-bottom: 6px; color: #111;">
                                <i class="fas fa-shower" style="color: #38bdf8; margin-right: 5px;"></i> ${zona.naziv}
                            </div>
                            <div style="font-size: 11px; margin-bottom: 8px; color: #555;">
                                <b>Površina:</b> ${povrsina.toLocaleString('sr-RS', {minimumFractionDigits: 1, maximumFractionDigits: 1})} m²
                            </div>
                            <button onclick="window.crtanjeManager.obrisiZonu('${zona.id}')" 
                                    style="width: 100%; background: #ef4444; color: white; border: none; padding: 5px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px;">
                                <i class="fas fa-trash-alt"></i> Obriši zonu
                            </button>
                        </div>
                    `;

                    poly.bindPopup(popupSadrzaj, {
                        className: 'custom-leaflet-popup'
                    });
                }

                this.zonesLayer.addLayer(poly);
            }
        });
    }

    /**
     * Otvara namenski modal za izmenu zone zalivanja
     */
    otvoriModalZaEditZone(zona) {
        const modalEl = document.getElementById('modalZonaEdit');
        if (!modalEl) return;

        const inputNaziv = document.getElementById('zone-edit-name');
        const spanPovrsina = document.getElementById('zone-edit-area-val');
        const inputId = document.getElementById('zone-edit-id');

        if (inputNaziv) inputNaziv.value = zona.naziv;
        if (spanPovrsina) {
            const points = this.parseCoordinates(zona.koordinate);
            const povrsina = this.calculatePolygonArea(points);
            spanPovrsina.textContent = povrsina.toLocaleString('sr-RS', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + ' m²';
        }
        if (inputId) inputId.value = zona.id;

        // Bootstrap modal instanca
        const modalObj = bootstrap.Modal.getOrCreateInstance(modalEl);

        // Povezivanje akcije brisanja
        const btnUkloni = document.getElementById('btn-zone-delete');
        if (btnUkloni) {
            // Očisti prethodne listenere kloniranjem dugmeta
            const noviBtn = btnUkloni.cloneNode(true);
            btnUkloni.parentNode.replaceChild(noviBtn, btnUkloni);
            noviBtn.addEventListener('click', async () => {
                modalObj.hide();
                await this.obrisiZonu(zona.id);
            });
        }

        // Povezivanje akcije izmene geometrije
        const btnGeometrija = document.getElementById('btn-zone-edit-geometry');
        if (btnGeometrija) {
            const noviBtn = btnGeometrija.cloneNode(true);
            btnGeometrija.parentNode.replaceChild(noviBtn, btnGeometrija);
            noviBtn.addEventListener('click', () => {
                modalObj.hide();
                this.pokreniIzmenuGeometrijeZone(zona);
            });
        }

        // Povezivanje akcije snimanja izmena (naziv)
        const btnSave = document.getElementById('btn-zone-save');
        if (btnSave) {
            const noviBtn = btnSave.cloneNode(true);
            btnSave.parentNode.replaceChild(noviBtn, btnSave);
            noviBtn.addEventListener('click', async () => {
                const noviNaziv = inputNaziv.value.trim() || "Nova zona";
                zona.naziv = noviNaziv;
                await this.saveZoneZalivanjaToBackend();
                this.renderZoneZalivanjaOnMap();
                modalObj.hide();
            });
        }

        modalObj.show();
    }

    /**
     * Pokreće režim interaktivne izmene geometrije (temena) zone na mapi
     */
    pokreniIzmenuGeometrijeZone(zona) {
        // Sakrij sve druge alate u bočnom panelu
        if (window.editorManager) {
            window.editorManager.selectTool(null);
        }

        const panel = document.getElementById('zone-geom-edit-panel');
        const nameDisplay = document.getElementById('zone-geom-edit-name-display');
        if (panel) {
            if (nameDisplay) nameDisplay.textContent = zona.naziv;
            panel.classList.add('show');
        }

        // Kopiramo originalne koordinate za slučaj da korisnik klikne ODUSTANI
        const originalneKoordinate = JSON.parse(JSON.stringify(zona.koordinate));
        let trenutneKoordinate = this.parseCoordinates(zona.koordinate);

        // Sakrijemo originalni sloj sa svim zonama dok uređujemo, da ne smeta
        if (this.zonesLayer) {
            this.map.removeLayer(this.zonesLayer);
        }

        // Kreiramo privremeni sloj za poligon koji menjamo
        const editPoly = L.polygon(trenutneKoordinate, {
            color: '#38bdf8',
            weight: 2.5,
            fill: false, // Potpuno transparentan i u modu izmene
            className: 'watering-zone-edit-polygon',
            interactive: false
        }).addTo(this.map);

        // Niz markera koji predstavljaju temena
        let markerSloj = L.featureGroup().addTo(this.map);

        // Funkcija za iscrtavanje markera na osnovu trenutnih koordinata
        const iscrtajMarkerTemena = () => {
            markerSloj.clearLayers();
            trenutneKoordinate.forEach((latlng, idx) => {
                let kruzicIcon = L.divIcon({
                    className: 'custom-vertex-marker-edit',
                    html: `<div style="width: 14px; height: 14px; background-color: #ffffff; border: 2.5px solid #38bdf8; border-radius: 50%; box-shadow: 0 1px 5px rgba(0,0,0,0.5); cursor: move;"></div>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                });

                let marker = L.marker(latlng, {
                    icon: kruzicIcon,
                    draggable: true
                }).addTo(markerSloj);

                marker.vertexIdx = idx;

                // Prevlačenje markera (pomeranje tačke)
                marker.on('drag', (e) => {
                    let noviPos = e.target.getLatLng();
                    
                    if (window.snapManager) {
                        const otherPoints = trenutneKoordinate.filter((_, i) => i !== e.target.vertexIdx);
                        const snappedResult = window.snapManager.getSnappedResult(noviPos, otherPoints);
                        if (snappedResult && snappedResult.snapped) {
                            noviPos = snappedResult.latlng;
                            e.target.setLatLng(noviPos);
                            
                            if (window.snapManager.snapIndicator) {
                                window.snapManager.snapIndicator.setLatLng(noviPos).addTo(this.map);
                            }
                        } else {
                            if (window.snapManager.snapIndicator) {
                                this.map.removeLayer(window.snapManager.snapIndicator);
                            }
                        }
                    }
                    
                    trenutneKoordinate[e.target.vertexIdx] = noviPos;
                    editPoly.setLatLngs(trenutneKoordinate);
                });

                marker.on('dragend', () => {
                    if (window.snapManager && window.snapManager.snapIndicator) {
                        this.map.removeLayer(window.snapManager.snapIndicator);
                    }
                });

                // Povezivanje brisanja na dvoklik (dblclick) i desni klik (contextmenu)
                const obrisiTacku = (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (trenutneKoordinate.length <= 3) {
                        alert("Zona zalivanja mora imati najmanje 3 tačke kako bi ostala zatvorena površina!");
                        return;
                    }
                    if (confirm("Da li ste sigurni da želite da obrišete ovu tačku geometrije?")) {
                        trenutneKoordinate.splice(e.target.vertexIdx, 1);
                        editPoly.setLatLngs(trenutneKoordinate);
                        iscrtajMarkerTemena(); // Ponovo nacrtaj preostale markere da se ažuriraju indeksi
                    }
                };

                marker.on('dblclick', obrisiTacku);
                marker.on('contextmenu', obrisiTacku);
            });
        };

        iscrtajMarkerTemena();

        // Povezivanje dugmadi na gornjem panelu
        const btnCancel = document.getElementById('btn-zone-geom-cancel');
        const btnSave = document.getElementById('btn-zone-geom-save');

        const ocistiEditRezim = () => {
            // Skloni privremene slojeve
            this.map.removeLayer(editPoly);
            this.map.removeLayer(markerSloj);
            if (panel) panel.classList.remove('show');
            // Vrati originalni sloj sa svim zonama
            if (this.zonesLayer) this.zonesLayer.addTo(this.map);
        };

        const noviBtnCancel = btnCancel.cloneNode(true);
        btnCancel.parentNode.replaceChild(noviBtnCancel, btnCancel);
        noviBtnCancel.addEventListener('click', () => {
            ocistiEditRezim();
            this.renderZoneZalivanjaOnMap(); // Vrati sve u normalu
        });

        const noviBtnSave = btnSave.cloneNode(true);
        btnSave.parentNode.replaceChild(noviBtnSave, btnSave);
        noviBtnSave.addEventListener('click', async () => {
            // Pretvaramo trenutneKoordinate u format stringa koji se čuva na serveru
            const formatiraneKoordinate = trenutneKoordinate.map(pt => {
                const ll = L.latLng(pt);
                return `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
            }).join('\n');
            zona.koordinate = formatiraneKoordinate;
            
            ocistiEditRezim();
            await this.saveZoneZalivanjaToBackend();
            this.renderZoneZalivanjaOnMap(); // Osveži sve zone
        });
    }


    /**
     * Briše zonu zalivanja na osnovu ID-a
     */
    async obrisiZonu(id) {
        if (!confirm("Da li ste sigurni da želite da obrišete ovu zonu zalivanja?")) {
            return;
        }
        this.zoneList = this.zoneList.filter(z => z.id !== id);
        
        await this.saveZoneZalivanjaToBackend();
        this.renderZoneZalivanjaOnMap();
        console.log(`Zona zalivanja ${id} je uspešno obrisana.`);
    }

    /**
     * Šalje zahteve na bekend radi trajnog skladištenja opštih podešavanja
     */
    async saveSettingsToBackend(settingsObj) {
        // Spoji nova podešavanja sa postojećim da ne bismo pregazili druge ključeve (npr. layer_visibility)
        const fullSettings = { ...(this.generalSettings || {}), ...settingsObj };
        this.generalSettings = fullSettings;
        try {
            const response = await fetch('/api/podesavanja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fullSettings)
            });

            if (response.ok) {
                console.log("Opšta podešavanja uspešno sačuvana na bekend.");
                return true;
            }
        } catch (err) {
            console.error("Greška prilikom čuvanja podešavanja na bekend:", err);
        }
        
        // fallback na localStorage za offline ili stare instalacije
        try {
            localStorage.setItem('gimelnet_system_name', settingsObj.system_name);
            localStorage.setItem('gimelnet_user_group', settingsObj.user_group);
            localStorage.setItem('gimelnet_map_lat', settingsObj.map_lat);
            localStorage.setItem('gimelnet_map_lon', settingsObj.map_lon);
            localStorage.setItem('gimelnet_map_zoom', settingsObj.map_zoom);
        } catch (e) {
            // ignore localStorage error
        }
        return true;
    }

    /**
     * Kreira plutajući panel za pravila crtanja na mapi
     */
    stvoriDrawingSettingsPanel() {
        if (window.snapManager) {
            window.snapManager.stvoriDrawingSettingsPanel();
        }
    }

    /**
     * Prikazuje panel za pravila crtanja
     */
    prikaziDrawingSettingsPanel() {
        if (window.snapManager) {
            window.snapManager.prikaziDrawingSettingsPanel();
        }
    }

    /**
     * Sakriva panel za pravila crtanja
     */
    sakrijDrawingSettingsPanel() {
        if (window.snapManager) {
            window.snapManager.sakrijDrawingSettingsPanel();
        }
    }

    /**
     * Računa snepovanu poziciju i vraća detaljne informacije o snepovanju (teme, ivica, ugao)
     * @param {L.LatLng} latlng Početna koordinata sa miša
     * @param {Array} customPoints Opcione tačke iz drugih menadžera (npr. MeasureManager)
     * @returns {Object} Rezultat snepovanja sa poljima {latlng, snapped, type}
     */
    getSnappedResult(latlng, customPoints = null) {
        if (window.snapManager) {
            return window.snapManager.getSnappedResult(latlng, customPoints || this.trenutneTacke);
        }
        return { latlng: latlng, snapped: false, type: 'none' };
    }

    /**
     * Nalazi najbližu tačku (snap) na osnovu pravila crtanja (uglovi, postojeće linije/temena)
     * @param {L.LatLng} latlng Početna koordinata sa miša
     * @returns {L.LatLng} Snepovana koordinata
     */
    getSnappedLatLng(latlng) {
        return this.getSnappedResult(latlng).latlng;
    }

    /**
     * Otvara stilizovani popup prozor sa informacijama o parcelama njive
     * @param {Object} njiva Objekat njive
     * @param {L.LatLng} latlng Koordinata gde je kliknuto
     */
    openFieldPopup(njiva, latlng) {
        let totalArea = 0;
        let parcelCardsHTML = '';
        
        // Boje za leve ivice kartica kako bi se slagalo sa modernim vizuelnim identitetom
        const borderColors = ['#3498db', '#2ecc71', '#e67e22', '#9b59b6', '#1abc9c'];
        
        njiva.parcele.forEach((parcel, idx) => {
            if (!parcel.aktivna) return;
            const points = this.parseCoordinates(parcel.koordinate);
            const calculatedArea = this.calculatePolygonArea(points);
            totalArea += calculatedArea;
            
            const cardColor = borderColors[idx % borderColors.length];
            
            parcelCardsHTML += `
                <div class="field-popup-parcel-card" style="border-left: 4px solid ${cardColor} !important;">
                     <div class="field-popup-parcel-info">
                         <span class="field-popup-parcel-title">Parcela ${parcel.broj_parcele}</span>
                         <span class="field-popup-parcel-ko">${parcel.katastarska_opstina}</span>
                     </div>
                     <div style="display: flex; align-items: center; gap: 8px;">
                         <span class="field-popup-parcel-measure">
                             <i class="fas fa-drafting-triangle"></i> ${calculatedArea.toFixed(4)} ha
                         </span>
                         <i class="fas fa-pencil-alt field-popup-parcel-edit-btn" data-parcel-idx="${idx}" title="Uredi tačke"></i>
                     </div>
                </div>
            `;
        });
        
        const popupDiv = document.createElement('div');
        popupDiv.className = 'field-popup-container';
        
        popupDiv.innerHTML = `
            <div class="field-popup-header">
                <span class="field-popup-title">${njiva.naziv}</span>
                <span class="field-popup-area">${totalArea.toFixed(3)} ha</span>
            </div>
            <div class="field-popup-divider"></div>
            <div class="field-popup-parcel-list">
                ${parcelCardsHTML}
            </div>
            <div class="field-popup-year-row">
                <span class="field-popup-year-label">
                    <i class="far fa-calendar-alt"></i> Godina:
                </span>
                <select class="field-popup-year-select">
                    <option value="2025-2026">2025-2026</option>
                    <option value="2026-2027" selected>2026-2027</option>
                    <option value="2027-2028">2027-2028</option>
                </select>
            </div>
            <div class="field-popup-note">${njiva.opis || 'Bez opisa'}</div>
            <div class="field-popup-buttons">
                <button class="field-popup-btn-work" id="btn-popup-work">
                    <i class="fas fa-tractor"></i> RADNA OP.
                </button>
                <button class="field-popup-btn-history" id="btn-popup-history">
                    <i class="fas fa-scroll"></i> ISTORIJA
                </button>
            </div>
        `;
        
        // Spreči da klikovi unutar popupa propagiraju do mape
        L.DomEvent.on(popupDiv, 'click', L.DomEvent.stopPropagation);
        L.DomEvent.on(popupDiv, 'mousedown', L.DomEvent.stopPropagation);
        
        // Povezivanje događaja unutar popupa
        popupDiv.querySelectorAll('.field-popup-parcel-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pIdx = parseInt(btn.getAttribute('data-parcel-idx'));
                this.map.closePopup();
                this.startEditingParcel(njiva, pIdx);
            });
        });
        
        const btnWork = popupDiv.querySelector('#btn-popup-work');
        if (btnWork) {
            btnWork.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                alert(`Radne operacije za njivu: ${njiva.naziv}`);
            });
        }
        
        const btnHistory = popupDiv.querySelector('#btn-popup-history');
        if (btnHistory) {
            btnHistory.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                alert(`Istorija za njivu: ${njiva.naziv}`);
            });
        }
        
        // Otvaranje popupa na mapi
        L.popup({
            className: 'field-popup-custom',
            maxWidth: 350,
            minWidth: 320,
            autoPan: true
        })
        .setLatLng(latlng)
        .setContent(popupDiv)
        .openOn(this.map);
    }

    /**
     * Pokreće interaktivni režim izmene temena (point-dragging) za izabranu parcelu
     * @param {Object} njiva Objekat njive
     * @param {Number} parcelIdx Indeks parcele
     */
    startEditingParcel(njiva, parcelIdx) {
        // Otkaži prethodno editovanje ukoliko je bilo aktivno
        this.stopEditingParcel(false);
        
        this.editingNjiva = njiva;
        this.editingParcelIdx = parcelIdx;
        
        const parcel = njiva.parcele[parcelIdx];
        
        // Normalizujemo tačke u L.LatLng kako bi sve imale lat i lng svojstva bez obzira na poreklo koordinata
        const parsed = this.parseCoordinates(parcel.koordinate);
        this.editingPoints = parsed.map(pt => L.latLng(pt[0], pt[1]));
        
        // 1. Privremeno sakrij statički sloj parcele iz fieldsLayer-a re-renderovanjem sa ignore filterom
        this.renderNjiveOnMap({ ignoreParcel: { njivaId: njiva.id, parcelIdx: parcelIdx } });
        
        // 2. Kreiraj interaktivni poligon za editovanje
        const parcelColor = parcel.boja || '#ff8c00';
        this.editPolygon = L.polygon(this.editingPoints, {
            color: '#ff8c00', // Prepoznatljiva narandžasta boja za edit mod
            weight: 3,
            fillColor: parcelColor,
            fillOpacity: 0.3,
            interactive: false
        }).addTo(this.map);
        
        // 3. Postavi draggable markere za svako teme parcele
        this.createEditVertexMarkers();
        
        // Otvori snap settings panel
        if (window.snapManager) {
            window.snapManager.prikaziDrawingSettingsPanel();
        }
        
        // 4. Prikaži plutajući gornji panel sa dugmićima "SNIMI" i "ODUSTANI"
        this.showParcelEditFloatPanel(njiva, parcel);
        
        // Pozicioniraj mapu na granice parcele radi udobnijeg rada
        if (this.editPolygon.getBounds().isValid()) {
            this.map.fitBounds(this.editPolygon.getBounds(), { padding: [100, 100], maxZoom: 18 });
        }
    }

    /**
     * Kreira i osvežava draggable markere za svako teme parcele koja se uređuje
     */
    createEditVertexMarkers() {
        // Prvo očisti stare markere
        if (this.editVertexMarkers) {
            this.editVertexMarkers.forEach(m => this.map.removeLayer(m));
        }
        this.editVertexMarkers = [];
        
        this.editingPoints.forEach((latlng, idx) => {
            const kruzicIcon = L.divIcon({
                className: 'custom-vertex-marker',
                html: '<div style="width: 14px; height: 14px; background-color: #ffffff; border: 2px solid #ff8c00; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4); cursor: move;"></div>',
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });
            
            const marker = L.marker(latlng, {
                icon: kruzicIcon,
                draggable: true
            }).addTo(this.map);
            
            marker.vertexIndex = idx;
            
            // Sačuvaj originalnu poziciju pri započinjanju prevlačenja (za vraćanje unazad ako spajanje nije dozvoljeno)
            marker.on('dragstart', (e) => {
                marker._originalLatLng = e.target.getLatLng();
            });
            
            // Osluškivanje prevlačenja temena u realnom vremenu uz praćenje snap-a
            marker.on('drag', (e) => {
                const currentLatLng = e.target.getLatLng();
                const otherPoints = this.editingPoints.filter((_, i) => i !== idx);
                
                // Dobavi snepovanu poziciju preko SnapManager-a
                const snappedResult = window.snapManager.getSnappedResult(currentLatLng, otherPoints);
                const finalLatLng = snappedResult.latlng;
                
                // Prikaži neon-zeleni krug za uspešan snap
                if (snappedResult.snapped) {
                    if (!this.map.hasLayer(window.snapManager.snapIndicator)) {
                        window.snapManager.snapIndicator.addTo(this.map);
                    }
                    window.snapManager.snapIndicator.setLatLng(finalLatLng);
                } else {
                    if (window.snapManager.snapIndicator && this.map.hasLayer(window.snapManager.snapIndicator)) {
                        this.map.removeLayer(window.snapManager.snapIndicator);
                    }
                }
                
                // Ažuriraj lokaciju markera, skladišnu tačku i interaktivni poligon
                e.target.setLatLng(finalLatLng);
                this.editingPoints[idx] = finalLatLng;
                this.editPolygon.setLatLngs(this.editingPoints);
            });
            
            // Kada se prevlačenje završi, skloni snap indikator i proveri da li je stavljen "kružić na kružić"
            marker.on('dragend', (e) => {
                if (window.snapManager && window.snapManager.snapIndicator && this.map.hasLayer(window.snapManager.snapIndicator)) {
                    this.map.removeLayer(window.snapManager.snapIndicator);
                }
                
                // Obezbedi da se konačna tačka zalepi za snap
                const currentLatLng = e.target.getLatLng();
                const otherPoints = this.editingPoints.filter((_, i) => i !== idx);
                const snappedResult = window.snapManager.getSnappedResult(currentLatLng, otherPoints);
                const finalLatLng = snappedResult.latlng;
                
                e.target.setLatLng(finalLatLng);
                this.editingPoints[idx] = finalLatLng;
                this.editPolygon.setLatLngs(this.editingPoints);
                
                // Proveri preklapanje sa ostalim temenima (manje od 1 metar)
                let mergeWithIdx = -1;
                for (let i = 0; i < this.editingPoints.length; i++) {
                    if (i === idx) continue;
                    const dist = this.map.distance(finalLatLng, this.editingPoints[i]);
                    if (dist < 1.0) { // Ako je rastojanje manje od 1 metra
                        mergeWithIdx = i;
                        break;
                    }
                }
                
                if (mergeWithIdx !== -1) {
                    if (this.editingPoints.length > 3) {
                        // Brišemo trenutni kružić jer se preklopio sa drugim
                        console.log(`Preklapanje detektovano: uklanja se teme na indeksu ${idx}`);
                        this.editingPoints.splice(idx, 1);
                        this.editPolygon.setLatLngs(this.editingPoints);
                        
                        // Ponovo izgradi markere sa novim indeksima
                        this.createEditVertexMarkers();
                    } else {
                        alert("Poligon mora imati najmanje 3 temena!");
                        // Vrati marker na prvobitnu poziciju
                        if (marker._originalLatLng) {
                            marker.setLatLng(marker._originalLatLng);
                            this.editingPoints[idx] = marker._originalLatLng;
                            this.editPolygon.setLatLngs(this.editingPoints);
                        }
                    }
                }
            });
            
            this.editVertexMarkers.push(marker);
        });
    }

    /**
     * Završava režim izmene temena, opciono snima rezultate na server i osvežava prikaz
     * @param {Boolean} saveChanges Da li treba sačuvati izmene
     */
    async stopEditingParcel(saveChanges) {
        try {
            if (saveChanges && this.editingNjiva && this.editingParcelIdx !== null) {
                const njiva = this.editingNjiva;
                const idx = this.editingParcelIdx;
                const parcel = njiva.parcele[idx];
                
                // Formatiraj koordinate nazad u tekstualni format za snimanje
                const coordLines = this.editingPoints.map(pt => `${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}`);
                parcel.koordinate = coordLines.join('\n');
                
                // Izračunaj novu površinu i ažuriraj polje povrsina
                parcel.povrsina = this.calculatePolygonArea(this.editingPoints);
                
                // Sačuvaj ažuriranu listu njiva na server
                const uspeh = await this.saveNjiveToBackend();
                if (uspeh) {
                    console.log("Izmene na parceli su uspešno sačuvane.");
                } else {
                    alert("Došlo je do greške prilikom čuvanja izmena na serveru!");
                }
            }
        } catch (err) {
            console.error("Greška tokom stopEditingParcel čuvanja:", err);
            alert("Došlo je do greške prilikom čuvanja podataka!");
        } finally {
            // Očisti interaktivne slojeve sa mape bez obzira na to da li je upis uspeo
            if (this.editPolygon) {
                this.map.removeLayer(this.editPolygon);
                this.editPolygon = null;
            }
            
            if (this.editVertexMarkers) {
                this.editVertexMarkers.forEach(m => this.map.removeLayer(m));
                this.editVertexMarkers = [];
            }
            
            if (window.snapManager && window.snapManager.snapIndicator && this.map.hasLayer(window.snapManager.snapIndicator)) {
                this.map.removeLayer(window.snapManager.snapIndicator);
            }
            
            // Zatvori snap settings panel
            if (window.snapManager) {
                window.snapManager.sakrijDrawingSettingsPanel();
            }
            
            this.removeParcelEditFloatPanel();
            
            this.editingNjiva = null;
            this.editingParcelIdx = null;
            this.editingPoints = [];
            
            // Ponovo iscrtaj statičke poligone i osveži tabele
            this.renderNjiveOnMap();
            this.renderNjiveInTable();
        }
    }

    /**
     * Kreira i prikazuje plutajući panel za snimanje/odbacivanje izmena temena
     * @param {Object} njiva Objekat njive
     * @param {Object} parcel Objekat parcele
     */
    showParcelEditFloatPanel(njiva, parcel) {
        this.removeParcelEditFloatPanel();
        
        const container = document.getElementById('map-container') || document.body;
        const panel = document.createElement('div');
        panel.id = 'parcel-edit-float-panel';
        panel.className = 'parcel-edit-float-panel';
        
        panel.innerHTML = `
            <div class="parcel-edit-float-info">
                <span class="parcel-edit-float-title">Uređivanje parcele ${parcel.broj_parcele}</span>
                <span class="parcel-edit-float-subtitle">${njiva.naziv} (${parcel.katastarska_opstina}) - Prevucite tačke</span>
            </div>
            <div class="parcel-edit-float-actions">
                <button class="btn-parcel-edit-save" id="btn-parcel-edit-save">
                    <i class="fas fa-check"></i> SNIMI
                </button>
                <button class="btn-parcel-edit-cancel" id="btn-parcel-edit-cancel">
                    <i class="fas fa-times"></i> ODUSTANI
                </button>
            </div>
        `;
        
        // Spreči širenje klik događaja na mapu
        L.DomEvent.on(panel, 'click', L.DomEvent.stopPropagation);
        L.DomEvent.on(panel, 'mousedown', L.DomEvent.stopPropagation);
        
        container.appendChild(panel);
        
        // Povezivanje dugmadi na akcije
        panel.querySelector('#btn-parcel-edit-save').addEventListener('click', (e) => {
            e.preventDefault();
            this.stopEditingParcel(true);
        });
        
        panel.querySelector('#btn-parcel-edit-cancel').addEventListener('click', (e) => {
            e.preventDefault();
            this.stopEditingParcel(false);
        });
    }

    /**
     * Uklanja plutajući panel iz DOM-a
     */
    removeParcelEditFloatPanel() {
        const panel = document.getElementById('parcel-edit-float-panel');
        if (panel) {
            panel.remove();
        }
    }
}

