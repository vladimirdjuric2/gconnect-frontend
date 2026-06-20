/**
 * MeasureManager - Upravlja funkcionalnošću običnog premeravanja na mapi.
 * Reuzuje snap logiku iz CrtanjeManager-a i podržava segmentne dužine, zatvaranje poligona i površine.
 */
export class MeasureManager {
    constructor(map) {
        this.map = map;
        this.isMeasuring = false;
        
        this.points = [];
        this.markers = [];
        this.polyline = null;
        this.tempPolyline = null;
        
        // Sloj za sva završena merenja na mapi
        this.measurementsLayer = L.featureGroup().addTo(this.map);
        // Sloj za trenutno aktivno crtanje merenja
        this.activeGroup = L.featureGroup().addTo(this.map);
        
        this.escapeHandler = null;
        
        this.init();
    }
    
    /**
     * Inicijalizuje kontrolu i povezuje klik događaje za dugmad
     */
    init() {
        const btnMeasure = document.getElementById('btnMeasure');
        if (btnMeasure) {
            btnMeasure.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleMeasuring();
            });
        }
        
        const btnRemove = document.getElementById('btnRemoveMeasurements');
        if (btnRemove) {
            btnRemove.addEventListener('click', (e) => {
                e.preventDefault();
                this.clearAllMeasurements();
            });
        }
    }
    
    /**
     * Uključuje ili isključuje režim premeravanja
     */
    toggleMeasuring() {
        if (this.isMeasuring) {
            this.stopMeasuring(true); // Otkazivanje aktivnog crtanja
        } else {
            this.startMeasuring();
        }
    }
    
    /**
     * Pokreće režim premeravanja, menja kursor i inicijalizuje crtaće elemente
     */
    startMeasuring() {
        if (this.isMeasuring) return;
        
        // Otkaži crtanje nove njive ako je aktivno u CrtanjeManager-u
        if (window.crtanjeManager && window.crtanjeManager.crtanjeAktivno) {
            window.crtanjeManager.crtanjeAktivno = false;
            window.crtanjeManager.nacrtanaLinija.setLatLngs([]);
            window.crtanjeManager.privremenaLinija.setLatLngs([]);
            window.crtanjeManager.odbaciPoligon();
        }

        // Otkaži aktivni alat za postavljanje komponenti u EditorManager-u
        if (window.editorManager && typeof window.editorManager.selectTool === 'function') {
            window.editorManager.selectTool(null);
        }
        
        this.isMeasuring = true;
        
        const btnMeasure = document.getElementById('btnMeasure');
        if (btnMeasure) {
            btnMeasure.classList.add('active');
        }
        
        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.style.cursor = 'crosshair';
            mapaEl.classList.add('drawing-mode-active');
        }
        
        this.points = [];
        this.markers = [];
        this.activeGroup.clearLayers();
        
        this.polyline = L.polyline([], { color: '#ff8c00', weight: 3 }).addTo(this.activeGroup);
        this.tempPolyline = L.polyline([], { color: '#ff8c00', weight: 3, dashArray: '5, 5' }).addTo(this.activeGroup);
        
        // Osluškivanje događaja na mapi sa pravilnim predajom konteksta (this)
        this.map.on('click', this.onMapClick, this);
        this.map.on('mousemove', this.onMapMouseMove, this);
        this.map.on('contextmenu', this.onMapContextMenu, this);
        
        // Povezivanje Escape tastera za prekid
        this.escapeHandler = (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                this.stopMeasuring(true);
            }
        };
        document.addEventListener('keydown', this.escapeHandler);

        // Prikaži panel za podešavanje snapa
        if (window.snapManager) {
            window.snapManager.prikaziDrawingSettingsPanel();
        }
    }
    
    /**
     * Zaustavlja režim premeravanja i opciono čuva ili odbacuje trenutno aktivnu liniju
     * @param {Boolean} cancelActive Ako je true, odbacuje se započeto merenje. Ako je false, čuva se do poslednje tačke
     */
    stopMeasuring(cancelActive = false) {
        if (!this.isMeasuring) return;
        
        this.isMeasuring = false;
        
        const btnMeasure = document.getElementById('btnMeasure');
        if (btnMeasure) {
            btnMeasure.classList.remove('active');
        }
        
        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.style.cursor = '';
            // Ukloni drawing-mode-active klasu samo ako CrtanjeManager takođe nije aktivan
            if (!window.crtanjeManager || !window.crtanjeManager.crtanjeAktivno) {
                mapaEl.classList.remove('drawing-mode-active');
            }
        }
        
        // Ukloni mrežne slušaoce događaja
        this.map.off('click', this.onMapClick, this);
        this.map.off('mousemove', this.onMapMouseMove, this);
        this.map.off('contextmenu', this.onMapContextMenu, this);
        
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }
        
        // Sakrij snapIndicator iz SnapManager-a
        if (window.snapManager && window.snapManager.snapIndicator && this.map.hasLayer(window.snapManager.snapIndicator)) {
            this.map.removeLayer(window.snapManager.snapIndicator);
        }
        
        // Sakrij lebdeći merni tooltip
        const tooltip = document.getElementById('measure-tooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
        
        if (cancelActive) {
            this.activeGroup.clearLayers();
            this.points = [];
            this.markers = [];
        } else {
            // Ako završavamo bez zatvaranja poligona (npr. desnim klikom), sačuvaj sve segmente i tačke
            if (this.points.length >= 2) {
                // Prebaci glavnu poliliniju u sloj završenih merenja
                const finalPolyline = L.polyline(this.points, { color: '#ff8c00', weight: 3 }).addTo(this.measurementsLayer);
                
                // Prebaci sva temena i oznake
                const layersToTransfer = [];
                this.activeGroup.eachLayer(layer => {
                    // Izbegni privremenu isprekidanu liniju i glavnu poliliniju (nju crtamo ponovo na measurementsLayer)
                    if (layer !== this.tempPolyline && layer !== this.polyline) {
                        layersToTransfer.push(layer);
                    }
                });
                layersToTransfer.forEach(layer => {
                    this.activeGroup.removeLayer(layer);
                    layer.addTo(this.measurementsLayer);
                });
                
                // Dodaj ukupnu dužinu na poslednjoj tački
                const lastPt = this.points[this.points.length - 1];
                const totalDist = this.calculatePathLength(this.points);
                
                const totalLabelIcon = L.divIcon({
                    className: 'segment-distance-label',
                    html: `<span style="background-color: #c0392b; border-color: #ff8c00;">Ukupno: ${totalDist.toFixed(1)} m</span>`,
                    iconSize: [120, 20],
                    iconAnchor: [60, 30]
                });
                L.marker(lastPt, { icon: totalLabelIcon, interactive: false }).addTo(this.measurementsLayer);
            }
            
            this.activeGroup.clearLayers();
            this.points = [];
            this.markers = [];
        }

        // Sakrij panel za podešavanje snapa ako CrtanjeManager takođe nije aktivan
        if (window.snapManager && (!window.crtanjeManager || !window.crtanjeManager.crtanjeAktivno)) {
            window.snapManager.sakrijDrawingSettingsPanel();
        }
    }
    
    /**
     * Događaj pomeranja miša - računa snap i ažurira privremenu isprekidanu liniju i merni tooltip
     */
    onMapMouseMove(e) {
        if (!this.isMeasuring) return;
        
        let snappedLatLng = e.latlng;
        let isSnapped = false;
        
        // Pokušaj snapovanje reuzovanjem logike iz SnapManager-a
        if (window.snapManager) {
            const snappedResult = window.snapManager.getSnappedResult(e.latlng, this.points);
            snappedLatLng = snappedResult.latlng;
            isSnapped = snappedResult.snapped;
            
            // Prikaži/sakrij neon-zeleni kružić lepljenja
            if (isSnapped) {
                if (!this.map.hasLayer(window.snapManager.snapIndicator)) {
                    window.snapManager.snapIndicator.addTo(this.map);
                }
                window.snapManager.snapIndicator.setLatLng(snappedLatLng);
            } else {
                if (window.snapManager.snapIndicator && this.map.hasLayer(window.snapManager.snapIndicator)) {
                    this.map.removeLayer(window.snapManager.snapIndicator);
                }
            }
        }
        
        // Prikaz lebdećeg mernog tooltip-a
        let tooltip = document.getElementById('measure-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'measure-tooltip';
            tooltip.style.position = 'absolute';
            tooltip.style.backgroundColor = 'rgba(18, 18, 18, 0.9)';
            tooltip.style.backdropFilter = 'blur(4px)';
            tooltip.style.color = '#ffffff';
            tooltip.style.padding = '6px 10px';
            tooltip.style.borderRadius = '4px';
            tooltip.style.border = '1px solid #ff8c00';
            tooltip.style.fontSize = '11px';
            tooltip.style.fontFamily = "'Outfit', 'Inter', sans-serif";
            tooltip.style.fontWeight = 'bold';
            tooltip.style.pointerEvents = 'none';
            tooltip.style.zIndex = '2000';
            tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)';
            document.body.appendChild(tooltip);
        }
        
        tooltip.style.display = 'block';
        tooltip.style.left = (e.originalEvent.pageX + 15) + 'px';
        tooltip.style.top = (e.originalEvent.pageY + 15) + 'px';
        
        if (this.points.length === 0) {
            tooltip.innerHTML = `Kliknite za početak merenja`;
        } else {
            const lastPt = this.points[this.points.length - 1];
            // Segmentna dužina od zadnje tačke do trenutnog kursora
            const segmentDist = lastPt.distanceTo(snappedLatLng);
            const prevTotal = this.calculatePathLength(this.points);
            const liveTotal = prevTotal + segmentDist;
            
            tooltip.innerHTML = `Segment: <span style="color: #ff8c00;">${segmentDist.toFixed(1)} m</span><br>Ukupno: <span style="color: #39ff14;">${liveTotal.toFixed(1)} m</span>`;
            
            // Ažuriraj privremenu isprekidanu narandžastu liniju
            this.tempPolyline.setLatLngs([lastPt, snappedLatLng]);
        }
    }
    
    /**
     * Događaj levog klika - postavlja čvorište, iscrtava solidne linije ili zatvara poligon
     */
    onMapClick(e) {
        if (!this.isMeasuring) return;
        
        let snappedLatLng = e.latlng;
        let isFirstPointClick = false;
        
        if (window.snapManager) {
            const snappedResult = window.snapManager.getSnappedResult(e.latlng, this.points);
            snappedLatLng = snappedResult.latlng;
            
            // Klik na početnu tačku (zatvaranje poligona)
            if (this.points.length >= 3 && snappedResult.type === 'vertex') {
                const firstPt = this.points[0];
                if (snappedLatLng.distanceTo(firstPt) < 0.1) {
                    isFirstPointClick = true;
                }
            }
        }
        
        if (isFirstPointClick) {
            // ZATVARANJE POLIGONA I RAČUNANJE POVRŠINE
            this.tempPolyline.setLatLngs([]);
            
            // Kreiraj pravi narandžasti merni poligon
            const closedPoly = L.polygon(this.points, {
                color: '#ff8c00',
                fillColor: '#ff8c00',
                fillOpacity: 0.2,
                weight: 3
            }).addTo(this.measurementsLayer);
            
            // Dodaj krugove i segmentne natpise za sve tačke, uključujući i zatvarajući segment
            this.points.forEach((pt, idx) => {
                let kruzicIcon = L.divIcon({
                    className: 'custom-vertex-marker',
                    html: '<div style="width: 12px; height: 12px; background-color: #ffffff; border: 2px solid #ff8c00; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4);"></div>',
                    iconSize: [12, 12],
                    iconAnchor: [6, 6]
                });
                L.marker(pt, { icon: kruzicIcon, interactive: false }).addTo(this.measurementsLayer);
                
                // Računanje mernog segmenta do sledeće tačke
                const nextPt = this.points[(idx + 1) % this.points.length];
                const segmentDist = pt.distanceTo(nextPt);
                const midLatLng = L.latLng((pt.lat + nextPt.lat) / 2, (pt.lng + nextPt.lng) / 2);
                
                const midIcon = L.divIcon({
                    className: 'segment-distance-label',
                    html: `<span>${segmentDist.toFixed(1)} m</span>`,
                    iconSize: [60, 20],
                    iconAnchor: [30, 10]
                });
                L.marker(midLatLng, { icon: midIcon, interactive: false }).addTo(this.measurementsLayer);
            });
            
            // Izračunaj površinu preko Shoelace formule iz CrtanjeManager-a
            let areaHa = 0;
            if (window.crtanjeManager) {
                areaHa = window.crtanjeManager.calculatePolygonArea(this.points.map(p => [p.lat, p.lng]));
            }
            
            let areaText = '';
            if (areaHa < 0.1) {
                // Ako je manje od 1000m² prikaži u kvadratnim metrima
                areaText = (areaHa * 10000).toFixed(1) + ' m²';
            } else {
                areaText = areaHa.toFixed(3) + ' ha';
            }
            
            // Ukupan obim poligona
            const perimeter = this.calculatePathLength(this.points) + this.points[this.points.length - 1].distanceTo(this.points[0]);
            
            // Postavljanje velike info oznake u centar poligona
            const center = closedPoly.getBounds().getCenter();
            const labelIcon = L.divIcon({
                className: 'polygon-measurement-label-container',
                html: `
                    <div class="measurement-label">
                        <strong>Površina:</strong> ${areaText}<br>
                        <strong>Obim:</strong> ${perimeter.toFixed(1)} m
                    </div>
                `,
                iconSize: [150, 60],
                iconAnchor: [75, 30]
            });
            L.marker(center, { icon: labelIcon, interactive: false }).addTo(this.measurementsLayer);
            
            // Obustavi merenje i očisti aktivne crteže
            this.activeGroup.clearLayers();
            this.points = [];
            this.markers = [];
            this.stopMeasuring(false);
            
        } else {
            // DODAVANJE OBIČNE TAČKE
            this.points.push(snappedLatLng);
            this.polyline.setLatLngs(this.points);
            
            // Iscrtavanje belo-narandžastog markera na temenu
            let kruzicIcon = L.divIcon({
                className: 'custom-vertex-marker',
                html: '<div style="width: 12px; height: 12px; background-color: #ffffff; border: 2px solid #ff8c00; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4);"></div>',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });
            const marker = L.marker(snappedLatLng, { icon: kruzicIcon, interactive: false }).addTo(this.activeGroup);
            this.markers.push(marker);
            
            // Ako imamo više od 1 tačke, iscrtaj dužinu segmenta na sredini
            if (this.points.length > 1) {
                const p1 = this.points[this.points.length - 2];
                const p2 = snappedLatLng;
                const segmentDist = p1.distanceTo(p2);
                const midLatLng = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);
                
                const midIcon = L.divIcon({
                    className: 'segment-distance-label',
                    html: `<span>${segmentDist.toFixed(1)} m</span>`,
                    iconSize: [60, 20],
                    iconAnchor: [30, 10]
                });
                L.marker(midLatLng, { icon: midIcon, interactive: false }).addTo(this.activeGroup);
            }
        }
    }
    
    /**
     * Događaj desnog klika - prekida crtanje i završava trenutnu liniju
     */
    onMapContextMenu(e) {
        if (!this.isMeasuring) return;
        
        // Zaustavi i sačuvaj sve do sada unete tačke kao otvorenu mernu liniju
        this.stopMeasuring(false);
    }
    
    /**
     * Pomoćna funkcija za računanje dužine niza LatLng tačaka
     */
    calculatePathLength(points) {
        let length = 0;
        for (let i = 0; i < points.length - 1; i++) {
            length += points[i].distanceTo(points[i+1]);
        }
        return length;
    }
    
    /**
     * Briše sva obavljena merenja sa mape
     */
    clearAllMeasurements() {
        this.measurementsLayer.clearLayers();
    }
}
