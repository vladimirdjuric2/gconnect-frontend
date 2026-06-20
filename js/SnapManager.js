/**
 * SnapManager - Upravlja parametrima, panelom za podešavanja i matematičkom logikom snepovanja na mapi.
 * Omogućava nezavisnu i unifikovanu snap podršku za crtanje i merenje na mapi.
 */
export class SnapManager {
    constructor(map, fieldsLayer) {
        this.map = map;
        this.fieldsLayer = fieldsLayer; // Referenca na zajednički sloj iscrtanih njiva/parcela
        
        // Podrazumevani parametri snepovanja i tajmera
        this.snapAngle = 90;
        this.angleSnapPx = 5;
        this.lineSnapPx = 5;
        this.popupDuration = 3;
        
        this.snapIndicator = null;
        this.init();
    }
    
    init() {
        this.stvoriDrawingSettingsPanel();
        this.stvoriSnapIndicator();
    }
    
    /**
     * Kreira neon-zeleni kružić koji služi kao vizuelni indikator uspešnog snepovanja
     */
    stvoriSnapIndicator() {
        if (!this.snapIndicator) {
            this.snapIndicator = L.circleMarker([0, 0], {
                radius: 6,
                color: '#ffffff',
                weight: 2,
                fillColor: '#39ff14', // Neon zelena
                fillOpacity: 0.9,
                interactive: false
            });
        }
    }
    
    /**
     * Kreira plutajući panel za pravila crtanja/premeravanja na mapi (glassmorphism)
     */
    stvoriDrawingSettingsPanel() {
        const container = document.getElementById('map-container') || document.body;
        if (document.getElementById('drawing-settings-panel')) return;
        
        const panel = document.createElement('div');
        panel.id = 'drawing-settings-panel';
        panel.className = 'drawing-settings-panel';
        panel.innerHTML = `
            <div class="settings-row">
                <div class="icon-box bg-green" title="Snap ugao (stepeni)">
                    <i class="fas fa-ruler-combined text-yellow"></i>
                </div>
                <input type="number" id="snap-angle-input" class="settings-input" value="${this.snapAngle}" min="1" max="180">
                <span class="unit-label">°</span>
            </div>
            <div class="settings-row">
                <div class="icon-box bg-green" title="Zona hvatanja uglova (px)">
                    <i class="fas fa-thumbtack text-red"></i>
                </div>
                <input type="number" id="angle-snap-px-input" class="settings-input" value="${this.angleSnapPx}" min="0" max="100">
                <span class="unit-label">px</span>
            </div>
            <div class="settings-row">
                <div class="icon-box bg-green" title="Zona hvatanja linija (px)">
                    <i class="fas fa-map-pin text-red"></i>
                </div>
                <input type="number" id="line-snap-px-input" class="settings-input" value="${this.lineSnapPx}" min="0" max="100">
                <span class="unit-label">px</span>
            </div>
            <div class="settings-row">
                <div class="icon-box bg-blue" title="Vreme trajanja oblačića (s)">
                    <i class="fas fa-stopwatch text-white"></i>
                </div>
                <input type="number" id="popup-duration-input" class="settings-input" value="${this.popupDuration}" min="0" max="60">
                <span class="unit-label">s</span>
            </div>
        `;
        
        container.appendChild(panel);
        
        // Povezivanje inputa sa parametrima klase
        const snapAngleInput = panel.querySelector('#snap-angle-input');
        const angleSnapPxInput = panel.querySelector('#angle-snap-px-input');
        const lineSnapPxInput = panel.querySelector('#line-snap-px-input');
        const popupDurationInput = panel.querySelector('#popup-duration-input');
        
        snapAngleInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val <= 0) val = 1;
            if (val > 180) val = 180;
            this.snapAngle = val;
        });
        
        angleSnapPxInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            this.angleSnapPx = val;
        });
        
        lineSnapPxInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            this.lineSnapPx = val;
        });
        
        popupDurationInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            this.popupDuration = val;
        });
    }
    
    prikaziDrawingSettingsPanel() {
        const panel = document.getElementById('drawing-settings-panel');
        if (panel) {
            panel.classList.add('show');
        }
    }
    
    sakrijDrawingSettingsPanel() {
        const panel = document.getElementById('drawing-settings-panel');
        if (panel) {
            panel.classList.remove('show');
        }
    }
    
    /**
     * Računa snepovanu poziciju i vraća detaljne informacije o snepovanju (teme, ivica, ugao)
     * @param {L.LatLng} latlng Početna koordinata sa miša
     * @param {Array} activePoints Niz tačaka aktivne linije koja se crta ili meri
     * @returns {Object} Rezultat snepovanja sa poljima {latlng, snapped, type}
     */
    getSnappedResult(latlng, activePoints = []) {
        if (!this.map) return { latlng: latlng, snapped: false, type: 'none' };
        
        const mousePoint = this.map.latLngToLayerPoint(latlng);
        let minVertexDist = Infinity;
        let minEdgeDist = Infinity;
        
        // Pomoćna funkcija za bezbedno ravnanje koordinata (Leaflet LatLngs mogu biti duboko ugnježdeni)
        const flattenLatLngs = (arr) => {
            let result = [];
            const recurse = (item) => {
                if (item instanceof L.LatLng) {
                    result.push(item);
                } else if (Array.isArray(item)) {
                    item.forEach(recurse);
                } else if (item && typeof item === 'object' && typeof item.lat === 'number' && typeof item.lng === 'number') {
                    result.push(L.latLng(item.lat, item.lng));
                }
            };
            recurse(arr);
            return result;
        };

        // --- 1. SNAPPING NA POSTOJEĆA TEMENA (VERTICES) ---
        const vertices = [];
        
        // Temena trenutne linije koja se crta
        activePoints.forEach(pt => {
            vertices.push(pt);
        });
        
        // Temena svih sačuvanih poligona na mapi (robustan check preko getLatLngs)
        if (this.fieldsLayer) {
            this.fieldsLayer.eachLayer(layer => {
                if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
                    const flat = flattenLatLngs(layer.getLatLngs());
                    flat.forEach(pt => {
                        vertices.push(pt);
                    });
                }
            });
        }
        
        // Temena svih sačuvanih zona zalivanja na mapi
        if (window.crtanjeManager && window.crtanjeManager.zonesLayer) {
            window.crtanjeManager.zonesLayer.eachLayer(layer => {
                if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
                    const flat = flattenLatLngs(layer.getLatLngs());
                    flat.forEach(pt => {
                        vertices.push(pt);
                    });
                }
            });
        }

        // Temena završenih merenja na mapi (ruler/lenjir)
        if (window.measureManager && window.measureManager.measurementsLayer) {
            window.measureManager.measurementsLayer.eachLayer(layer => {
                if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
                    const flat = flattenLatLngs(layer.getLatLngs());
                    flat.forEach(pt => {
                        vertices.push(pt);
                    });
                }
            });
        }

        // Temena aktivnog premeravanja na mapi (ruler/lenjir u toku crtanja)
        if (window.measureManager && window.measureManager.points) {
            window.measureManager.points.forEach(pt => {
                vertices.push(pt);
            });
        }

        // 1) Uređaji (pumpe, ventili, merači, kontroleri)
        if (window.editorManager && window.editorManager.devices) {
            window.editorManager.devices.forEach(dev => {
                if (dev.type === 'valve' && typeof window.editorManager.getWaterPinLatLng === 'function') {
                    const pinInLatLng = window.editorManager.getWaterPinLatLng(dev.id, 'W_IN');
                    const pinOutLatLng = window.editorManager.getWaterPinLatLng(dev.id, 'W_OUT');
                    if (pinInLatLng) vertices.push(pinInLatLng);
                    if (pinOutLatLng) vertices.push(pinOutLatLng);
                } else if (typeof dev.lat === 'number' && typeof dev.lng === 'number') {
                    vertices.push(L.latLng(dev.lat, dev.lng));
                }
            });
        }

        // 2) Temena svih sačuvanih creva (cevovoda)
        if (window.editorManager && window.editorManager.pipes) {
            window.editorManager.pipes.forEach(pipe => {
                if (pipe.points && Array.isArray(pipe.points)) {
                    pipe.points.forEach(pt => {
                        vertices.push(L.latLng(pt[0], pt[1]));
                    });
                }
            });
        }
        
        let nearestVertex = null;
        vertices.forEach(v => {
            const vPoint = this.map.latLngToLayerPoint(v);
            const dist = mousePoint.distanceTo(vPoint); // Distanca u pikselima
            if (dist < minVertexDist) {
                minVertexDist = dist;
                nearestVertex = v;
            }
        });
        
        // Ako je najbliže teme unutar definisane zone hvatanja, snepuj direktno
        if (nearestVertex && minVertexDist <= this.lineSnapPx) {
            return { latlng: nearestVertex, snapped: true, type: 'vertex' };
        }
        
        // --- 2. SNAPPING NA POSTOJEĆE LINIJE/STRANICE (EDGES) ---
        let nearestEdgePoint = null;
        
        const checkSegment = (latlng1, latlng2) => {
            const p1 = this.map.latLngToLayerPoint(latlng1);
            const p2 = this.map.latLngToLayerPoint(latlng2);
            
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) return;
            
            // Projekcija tačke na duž
            let t = ((mousePoint.x - p1.x) * dx + (mousePoint.y - p1.y) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t)); // Ograniči na krajeve segmenta
            
            const projX = p1.x + t * dx;
            const projY = p1.y + t * dy;
            const projPoint = L.point(projX, projY);
            
            const dist = mousePoint.distanceTo(projPoint);
            if (dist < minEdgeDist) {
                minEdgeDist = dist;
                nearestEdgePoint = this.map.layerPointToLatLng(projPoint);
            }
        };
        
        // Stranice trenutne linije
        if (activePoints.length > 1) {
            for (let i = 0; i < activePoints.length - 1; i++) {
                checkSegment(activePoints[i], activePoints[i+1]);
            }
        }
        
        // Stranice svih postojećih parcela na mapi (robustan check)
        if (this.fieldsLayer) {
            this.fieldsLayer.eachLayer(layer => {
                if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
                    const flat = flattenLatLngs(layer.getLatLngs());
                    if (flat.length > 1) {
                        for (let i = 0; i < flat.length; i++) {
                            const pt1 = flat[i];
                            const pt2 = flat[(i + 1) % flat.length];
                            checkSegment(pt1, pt2);
                        }
                    }
                }
            });
        }

        // Stranice svih sačuvanih zona zalivanja na mapi
        if (window.crtanjeManager && window.crtanjeManager.zonesLayer) {
            window.crtanjeManager.zonesLayer.eachLayer(layer => {
                if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
                    const flat = flattenLatLngs(layer.getLatLngs());
                    if (flat.length > 1) {
                        for (let i = 0; i < flat.length; i++) {
                            const pt1 = flat[i];
                            const pt2 = flat[(i + 1) % flat.length];
                            checkSegment(pt1, pt2);
                        }
                    }
                }
            });
        }

        // Stranice svih sačuvanih merenja (ruler/lenjir) na mapi
        if (window.measureManager && window.measureManager.measurementsLayer) {
            window.measureManager.measurementsLayer.eachLayer(layer => {
                if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
                    const flat = flattenLatLngs(layer.getLatLngs());
                    if (flat.length > 1) {
                        const isPolygon = (layer instanceof L.Polygon);
                        const len = isPolygon ? flat.length : flat.length - 1;
                        for (let i = 0; i < len; i++) {
                            const pt1 = flat[i];
                            const pt2 = flat[(i + 1) % flat.length];
                            checkSegment(pt1, pt2);
                        }
                    }
                }
            });
        }

        // Stranice aktivnog premeravanja na mapi (ruler/lenjir u toku crtanja)
        if (window.measureManager && window.measureManager.points && window.measureManager.points.length > 1) {
            const activePts = window.measureManager.points;
            for (let i = 0; i < activePts.length - 1; i++) {
                checkSegment(activePts[i], activePts[i+1]);
            }
        }

        // Stranice svih sačuvanih creva na mapi
        if (window.editorManager && window.editorManager.pipes) {
            window.editorManager.pipes.forEach(pipe => {
                if (pipe.points && pipe.points.length > 1) {
                    for (let i = 0; i < pipe.points.length - 1; i++) {
                        checkSegment(L.latLng(pipe.points[i]), L.latLng(pipe.points[i+1]));
                    }
                }
            });
        }
        
        // Ako je najbliža ivica unutar zone hvatanja, snepuj na nju
        if (nearestEdgePoint && minEdgeDist <= this.lineSnapPx) {
            return { latlng: nearestEdgePoint, snapped: true, type: 'edge' };
        }
        
        // --- 3. SNAPPING NA ZADATI UGAO (ANGLE SNAP) ---
        if (activePoints.length > 0) {
            const lastLatLng = activePoints[activePoints.length - 1];
            const lastPoint = this.map.latLngToLayerPoint(lastLatLng);
            
            const dx = mousePoint.x - lastPoint.x;
            const dy = mousePoint.y - lastPoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 3) {
                let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
                if (angleDeg < 0) angleDeg += 360;
                
                const refAngles = [0]; // Apsolutni pravac (0)
                
                // 1. Pravac prethodne linije iz aktivnog crtanja
                if (activePoints.length >= 2) {
                    const prevLatLng = activePoints[activePoints.length - 2];
                    const prevPoint = this.map.latLngToLayerPoint(prevLatLng);
                    const pdx = lastPoint.x - prevPoint.x;
                    const pdy = lastPoint.y - prevPoint.y;
                    if (Math.abs(pdx) > 0.1 || Math.abs(pdy) > 0.1) {
                        let prevAngle = Math.atan2(pdy, pdx) * 180 / Math.PI;
                        if (prevAngle < 0) prevAngle += 360;
                        refAngles.push(prevAngle);
                    }
                }
                
                // 2. Pravci svih linija iz čvorišta iz kojeg krecemo crtanje
                if (this.fieldsLayer) {
                    this.fieldsLayer.eachLayer(layer => {
                        if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
                            const flat = flattenLatLngs(layer.getLatLngs());
                            for (let pt of flat) {
                                if (pt.distanceTo(lastLatLng) < 0.1) {
                                    const idx = flat.indexOf(pt);
                                    const prevPt = flat[(idx - 1 + flat.length) % flat.length];
                                    const nextPt = flat[(idx + 1) % flat.length];
                                    
                                    const ptPt = this.map.latLngToLayerPoint(pt);
                                    const prevPtPt = this.map.latLngToLayerPoint(prevPt);
                                    const nextPtPt = this.map.latLngToLayerPoint(nextPt);
                                    
                                    const dx1 = prevPtPt.x - ptPt.x;
                                    const dy1 = prevPtPt.y - ptPt.y;
                                    let a1 = Math.atan2(dy1, dx1) * 180 / Math.PI;
                                    if (a1 < 0) a1 += 360;
                                    refAngles.push(a1);
                                    
                                    const dx2 = nextPtPt.x - ptPt.x;
                                    const dy2 = nextPtPt.y - ptPt.y;
                                    let a2 = Math.atan2(dy2, dx2) * 180 / Math.PI;
                                    if (a2 < 0) a2 += 360;
                                    refAngles.push(a2);
                                }
                            }
                        }
                    });
                }
                
                // 3. Pravci svih segmenata creva iz čvorišta iz kojeg krećemo crtanje
                if (window.editorManager && window.editorManager.pipes) {
                    window.editorManager.pipes.forEach(pipe => {
                        if (pipe.points && pipe.points.length > 1) {
                            for (let i = 0; i < pipe.points.length; i++) {
                                const pt = L.latLng(pipe.points[i]);
                                if (pt.distanceTo(lastLatLng) < 0.1) {
                                    const ptPt = this.map.latLngToLayerPoint(pt);
                                    
                                    if (i > 0) {
                                        const prevPt = L.latLng(pipe.points[i - 1]);
                                        const prevPtPt = this.map.latLngToLayerPoint(prevPt);
                                        const dx1 = prevPtPt.x - ptPt.x;
                                        const dy1 = prevPtPt.y - ptPt.y;
                                        let a1 = Math.atan2(dy1, dx1) * 180 / Math.PI;
                                        if (a1 < 0) a1 += 360;
                                        refAngles.push(a1);
                                    }
                                    if (i < pipe.points.length - 1) {
                                        const nextPt = L.latLng(pipe.points[i + 1]);
                                        const nextPtPt = this.map.latLngToLayerPoint(nextPt);
                                        const dx2 = nextPtPt.x - ptPt.x;
                                        const dy2 = nextPtPt.y - ptPt.y;
                                        let a2 = Math.atan2(dy2, dx2) * 180 / Math.PI;
                                        if (a2 < 0) a2 += 360;
                                        refAngles.push(a2);
                                    }
                                }
                            }
                        }
                    });
                }
                
                let bestProjLatLng = null;
                let bestDist = Infinity;
                
                for (let refAngle of refAngles) {
                    for (let k = -4; k <= 4; k++) {
                        const targetAngle = (refAngle + k * this.snapAngle) % 360;
                        const targetAngleRad = targetAngle * Math.PI / 180;
                        
                        const rayX = Math.cos(targetAngleRad);
                        const rayY = Math.sin(targetAngleRad);
                        
                        const t = (dx * rayX + dy * rayY);
                        if (t < 0) continue; // Projekcija je u suprotnom smeru zraka
                        
                        const projX = lastPoint.x + t * rayX;
                        const projY = lastPoint.y + t * rayY;
                        const projPoint = L.point(projX, projY);
                        
                        const distToRay = mousePoint.distanceTo(projPoint);
                        if (distToRay < bestDist) {
                            bestDist = distToRay;
                            bestProjLatLng = this.map.layerPointToLatLng(projPoint);
                        }
                    }
                }
                
                if (bestProjLatLng && bestDist <= this.angleSnapPx) {
                    return { latlng: bestProjLatLng, snapped: true, type: 'angle' };
                }
            }
        }
        
        return { latlng: latlng, snapped: false, type: 'none' };
    }
}
