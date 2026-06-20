import { MapManager } from './MapManager.js?v=1.2.4';
import { CrtanjeManager } from './CrtanjeManager.js?v=1.2.4';
import { EditorManager } from './EditorManager.js?v=1.2.4';
import { MeasureManager } from './MeasureManager.js?v=1.2.4';
import { SnapManager } from './SnapManager.js?v=1.2.4';
import { ComponentRegistry } from './komponente/core/ComponentRegistry.js?v=1.2.4';

document.addEventListener('DOMContentLoaded', async () => {
    // 0. Inicijalizuj ComponentRegistry - učitaj sve komponente sistema
    console.log('🚀 Pokretanje aplikacije za navodnjavanje...');
    try {
        await ComponentRegistry.autoLoadComponents();
        ComponentRegistry.printStats();
    } catch (error) {
        console.error('❌ Kritična greška pri učitavanju komponenti:', error);
        alert('Greška pri inicijalizaciji sistema komponenti. Proverite konzolu.');
        return;
    }
    
    // 1. Inicijalizacija mape pomoću MapManager-a
    const mapManager = new MapManager('mapa');
    const mapInstance = mapManager.getMapInstance();
    
    // 2. Inicijalizacija upravljača za crtanje parcela (CrtanjeManager)
    const crtanjeManager = new CrtanjeManager(mapInstance);
    
    // 2b. Inicijalizacija zajedničkog upravljača za lepljenje (SnapManager)
    const snapManager = new SnapManager(mapInstance, crtanjeManager.fieldsLayer);
    
    // 3. Inicijalizacija interaktivnog vizuelnog editora (EditorManager)
    const editorManager = new EditorManager(mapInstance);
    
    // 4. Inicijalizacija upravljača za obično premeravanje (MeasureManager)
    const measureManager = new MeasureManager(mapInstance);
    
    // Eksterno eksponiranje za koordinaciju bounds fitovanja i drugih menadžera
    window.crtanjeManager = crtanjeManager;
    window.snapManager = snapManager;
    window.editorManager = editorManager;
    window.measureManager = measureManager;
    
    window.fitSystemBounds = () => {
        if (!window.crtanjeManager || !window.editorManager) return;
        
        let bounds = L.latLngBounds([]);
        let hasElements = false;
        
        // 1. Dodaj granice iscrtanih njiva/parcela
        if (window.crtanjeManager.fieldsLayer) {
            const fieldsBounds = window.crtanjeManager.fieldsLayer.getBounds();
            if (fieldsBounds.isValid()) {
                bounds.extend(fieldsBounds);
                hasElements = true;
            }
        }
        
        // 2. Dodaj pozicije svih uređaja/markera
        if (window.editorManager.deviceMarkers) {
            const markers = Object.values(window.editorManager.deviceMarkers);
            if (markers.length > 0) {
                markers.forEach(marker => {
                    bounds.extend(marker.getLatLng());
                });
                hasElements = true;
            }
        }
        
        // 3. Dodaj sve linije creva
        if (window.editorManager.pipeLines) {
            const lines = Object.values(window.editorManager.pipeLines);
            if (lines.length > 0) {
                lines.forEach(line => {
                    const lineBounds = line.getBounds();
                    if (lineBounds.isValid()) {
                        bounds.extend(lineBounds);
                        hasElements = true;
                    }
                });
            }
        }
        
        // Ako imamo bar neki elemenat na mapi, automatski se prilagođavamo
        if (hasElements && bounds.isValid()) {
            mapInstance.fitBounds(bounds, {
                padding: [50, 50],
                maxZoom: 17
            });
            console.log("Mapa je automatski prilagođena celokupnom sistemu za navodnjavanje.");
        }
    };
    
    // ==========================================================================
    // INTEGRACIJA PLUTAJUĆEG PANELA BRZIH SLOJEVA (QUICK LAYERS)
    // ==========================================================================
    
    // Inicijalizacija sloja za istoriju zalivanja (Stopala)
    const trackingHistoryLayer = L.layerGroup();
    window.trackingHistoryLayer = trackingHistoryLayer;

    // Funkcija za čišćenje istorije zalivanja (prohodi i stope su izbrisani po zahtevu korisnika)
    function osveziTragoveIstorije() {
        if (!mapInstance) return;
        trackingHistoryLayer.clearLayers();
    }
    
    window.osveziTragoveIstorije = osveziTragoveIstorije;

    // Selektori za sve brze prekidače
    const btnStopala = document.getElementById('btnLayerStopala');
    const btnTrougao = document.getElementById('btnLayerTrougao');
    const btnEtiketa = document.getElementById('btnLayerEtiketa');
    const btnNazivi = document.getElementById('btnLayerNazivi');
    const btnMapica = document.getElementById('btnLayerMapica');
    const btnZone = document.getElementById('btnLayerZone');
    const btnCevi = document.getElementById('btnLayerCevi');
    const btnZice = document.getElementById('btnLayerZice');
    const btnUredjaji = document.getElementById('btnLayerUredjaji');
    const mapaElement = document.getElementById('mapa');

    // Dobavljanje trenutnog stanja vidljivosti iz UI elemenata
    function dobijStanjeVidljivosti() {
        return {
            stopala: btnStopala ? !btnStopala.classList.contains('inactive') : false,
            trougao: btnTrougao ? !btnTrougao.classList.contains('inactive') : true,
            etiketa: btnEtiketa ? !btnEtiketa.classList.contains('inactive') : true,
            nazivi: btnNazivi ? !btnNazivi.classList.contains('inactive') : true,
            mapica: btnMapica ? !btnMapica.classList.contains('inactive') : true,
            zone: btnZone ? !btnZone.classList.contains('inactive') : true,
            cevi: btnCevi ? !btnCevi.classList.contains('inactive') : true,
            zice: btnZice ? !btnZice.classList.contains('inactive') : true,
            uredjaji: btnUredjaji ? !btnUredjaji.classList.contains('inactive') : true
        };
    }

    // Čuvanje stanja dugmadi u podesavanja.json
    async function sacuvajStanjeDugmadi() {
        const vis = dobijStanjeVidljivosti();
        let settings = null;
        try {
            const response = await fetch('/api/podesavanja');
            if (response.ok) {
                settings = await response.json();
            }
        } catch (e) {
            console.error("Greška pri učitavanju podešavanja za čuvanje stanja dugmadi:", e);
        }
        
        if (!settings) settings = {};
        settings.layer_visibility = vis;
        
        try {
            await fetch('/api/podesavanja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            console.log("Stanje vidljivosti slojeva uspešno sačuvano.");
        } catch (e) {
            console.error("Greška pri čuvanju podešavanja dugmadi:", e);
        }
    }

    // Primenjivanje stanja vidljivosti na elemente mape i dugmad
    function primeniVidljivostSlojeva(vis) {
        if (!vis) return;
        
        // 1. Stopala
        if (btnStopala) {
            const active = vis.stopala === true; // podrazumevano false
            if (active) {
                btnStopala.classList.remove('inactive');
                if (!mapInstance.hasLayer(trackingHistoryLayer)) {
                    mapInstance.addLayer(trackingHistoryLayer);
                }
                osveziTragoveIstorije();
            } else {
                btnStopala.classList.add('inactive');
                if (mapInstance.hasLayer(trackingHistoryLayer)) {
                    mapInstance.removeLayer(trackingHistoryLayer);
                }
            }
        }
        
        // 2. Trougao
        if (btnTrougao) {
            const active = vis.trougao !== false; // podrazumevano true
            if (active) {
                btnTrougao.classList.remove('inactive');
                mapaElement.classList.remove('hide-parcel-areas');
            } else {
                btnTrougao.classList.add('inactive');
                mapaElement.classList.add('hide-parcel-areas');
            }
        }
        
        // 3. Etiketa
        if (btnEtiketa) {
            const active = vis.etiketa !== false; // podrazumevano true
            if (active) {
                btnEtiketa.classList.remove('inactive');
                mapaElement.classList.remove('hide-parcel-names');
            } else {
                btnEtiketa.classList.add('inactive');
                mapaElement.classList.add('hide-parcel-names');
            }
        }
        
        // 3b. Nazivi (svi nazivi na mapi: imena njiva + oznake uređaja)
        if (btnNazivi) {
            const active = vis.nazivi !== false; // podrazumevano true
            if (active) {
                btnNazivi.classList.remove('inactive');
                mapaElement.classList.remove('hide-all-labels');
            } else {
                btnNazivi.classList.add('inactive');
                mapaElement.classList.add('hide-all-labels');
            }
        }

        // 4. Mapica
        if (btnMapica && crtanjeManager && crtanjeManager.fieldsLayer) {
            const active = vis.mapica !== false; // podrazumevano true
            if (active) {
                btnMapica.classList.remove('inactive');
                if (!mapInstance.hasLayer(crtanjeManager.fieldsLayer)) {
                    mapInstance.addLayer(crtanjeManager.fieldsLayer);
                }
            } else {
                btnMapica.classList.add('inactive');
                if (mapInstance.hasLayer(crtanjeManager.fieldsLayer)) {
                    mapInstance.removeLayer(crtanjeManager.fieldsLayer);
                }
            }
        }
        
        // 5. Zone
        if (btnZone && crtanjeManager && crtanjeManager.zonesLayer) {
            const active = vis.zone !== false; // podrazumevano true
            if (active) {
                btnZone.classList.remove('inactive');
                if (!mapInstance.hasLayer(crtanjeManager.zonesLayer)) {
                    mapInstance.addLayer(crtanjeManager.zonesLayer);
                }
            } else {
                btnZone.classList.add('inactive');
                if (mapInstance.hasLayer(crtanjeManager.zonesLayer)) {
                    mapInstance.removeLayer(crtanjeManager.zonesLayer);
                }
            }
        }
        
        // 6. Cevi
        if (btnCevi && editorManager && editorManager.pipesLayer) {
            const active = vis.cevi !== false; // podrazumevano true
            if (active) {
                btnCevi.classList.remove('inactive');
                if (!mapInstance.hasLayer(editorManager.pipesLayer)) {
                    mapInstance.addLayer(editorManager.pipesLayer);
                }
                if (editorManager.pipeJointsLayer && !mapInstance.hasLayer(editorManager.pipeJointsLayer)) {
                    mapInstance.addLayer(editorManager.pipeJointsLayer);
                }
                editorManager.updatePipeJointMarkers();
            } else {
                btnCevi.classList.add('inactive');
                if (mapInstance.hasLayer(editorManager.pipesLayer)) {
                    mapInstance.removeLayer(editorManager.pipesLayer);
                }
                if (editorManager.pipeJointsLayer && mapInstance.hasLayer(editorManager.pipeJointsLayer)) {
                    mapInstance.removeLayer(editorManager.pipeJointsLayer);
                }
            }
        }
        
        // 7. Žice
        if (btnZice) {
            const active = vis.zice !== false; // podrazumevano true
            if (active) {
                btnZice.classList.remove('inactive');
                mapaElement.classList.remove('hide-wires');
            } else {
                btnZice.classList.add('inactive');
                mapaElement.classList.add('hide-wires');
            }
        }
        
        // 8. Uređaji
        if (btnUredjaji && editorManager && editorManager.devicesLayer) {
            const active = vis.uredjaji !== false; // podrazumevano true
            if (active) {
                btnUredjaji.classList.remove('inactive');
                if (!mapInstance.hasLayer(editorManager.devicesLayer)) {
                    mapInstance.addLayer(editorManager.devicesLayer);
                }
            } else {
                btnUredjaji.classList.add('inactive');
                if (mapInstance.hasLayer(editorManager.devicesLayer)) {
                    mapInstance.removeLayer(editorManager.devicesLayer);
                }
            }
        }
    }

    // Učitavanje i inicijalno primenjivanje stanja iz podešavanja
    let initialSettings = null;
    try {
        const response = await fetch('/api/podesavanja');
        if (response.ok) {
            initialSettings = await response.json();
        }
    } catch (e) {
        console.warn("Problem sa učitavanjem podešavanja za inicijalizaciju dugmadi:", e);
    }

    if (initialSettings && initialSettings.layer_visibility) {
        primeniVidljivostSlojeva(initialSettings.layer_visibility);
    } else {
        // Podrazumevana stanja ako podešavanja ne postoje
        primeniVidljivostSlojeva({
            stopala: false,
            trougao: true,
            etiketa: true,
            nazivi: true,
            mapica: true,
            zone: true,
            cevi: true,
            zice: true,
            uredjaji: true
        });
    }

    // Povezivanje click listener-a
    
    // 1. STOPALA (Istorija zalivanja)
    if (btnStopala) {
        btnStopala.addEventListener('click', () => {
            const isVisible = mapInstance.hasLayer(trackingHistoryLayer);
            if (isVisible) {
                mapInstance.removeLayer(trackingHistoryLayer);
                btnStopala.classList.add('inactive');
            } else {
                osveziTragoveIstorije();
                mapInstance.addLayer(trackingHistoryLayer);
                btnStopala.classList.remove('inactive');
            }
            sacuvajStanjeDugmadi();
        });
    }

    // 2. TROUGAO (Površine i brojevi njiva)
    if (btnTrougao) {
        btnTrougao.addEventListener('click', () => {
            const isHidden = mapaElement.classList.contains('hide-parcel-areas');
            if (isHidden) {
                mapaElement.classList.remove('hide-parcel-areas');
                btnTrougao.classList.remove('inactive');
            } else {
                mapaElement.classList.add('hide-parcel-areas');
                btnTrougao.classList.add('inactive');
            }
            sacuvajStanjeDugmadi();
        });
    }

    // 3. ETIKETA (Imena njiva)
    if (btnEtiketa) {
        btnEtiketa.addEventListener('click', () => {
            const isHidden = mapaElement.classList.contains('hide-parcel-names');
            if (isHidden) {
                mapaElement.classList.remove('hide-parcel-names');
                btnEtiketa.classList.remove('inactive');
            } else {
                mapaElement.classList.add('hide-parcel-names');
                btnEtiketa.classList.add('inactive');
            }
            sacuvajStanjeDugmadi();
        });
    }

    // 3b. NAZIVI (Svi nazivi na mapi: imena njiva + oznake uređaja)
    if (btnNazivi) {
        btnNazivi.addEventListener('click', () => {
            const isHidden = mapaElement.classList.contains('hide-all-labels');
            if (isHidden) {
                mapaElement.classList.remove('hide-all-labels');
                btnNazivi.classList.remove('inactive');
            } else {
                mapaElement.classList.add('hide-all-labels');
                btnNazivi.classList.add('inactive');
            }
            sacuvajStanjeDugmadi();
        });
    }

    // 4. MAPICA (Prikaz njiva)
    if (btnMapica) {
        btnMapica.addEventListener('click', () => {
            if (crtanjeManager && crtanjeManager.fieldsLayer) {
                const isVisible = mapInstance.hasLayer(crtanjeManager.fieldsLayer);
                if (isVisible) {
                    mapInstance.removeLayer(crtanjeManager.fieldsLayer);
                    btnMapica.classList.add('inactive');
                } else {
                    mapInstance.addLayer(crtanjeManager.fieldsLayer);
                    btnMapica.classList.remove('inactive');
                }
                sacuvajStanjeDugmadi();
            }
        });
    }

    // 5. ZONE (Zone zalivanja)
    if (btnZone) {
        btnZone.addEventListener('click', () => {
            if (crtanjeManager && crtanjeManager.zonesLayer) {
                const isVisible = mapInstance.hasLayer(crtanjeManager.zonesLayer);
                if (isVisible) {
                    mapInstance.removeLayer(crtanjeManager.zonesLayer);
                    btnZone.classList.add('inactive');
                } else {
                    mapInstance.addLayer(crtanjeManager.zonesLayer);
                    btnZone.classList.remove('inactive');
                }
                sacuvajStanjeDugmadi();
            }
        });
    }

    // 6. CEVI (Vodovodne cevi)
    if (btnCevi) {
        btnCevi.addEventListener('click', () => {
            if (editorManager && editorManager.pipesLayer) {
                const isVisible = mapInstance.hasLayer(editorManager.pipesLayer);
                if (isVisible) {
                    mapInstance.removeLayer(editorManager.pipesLayer);
                    if (editorManager.pipeJointsLayer && mapInstance.hasLayer(editorManager.pipeJointsLayer)) {
                        mapInstance.removeLayer(editorManager.pipeJointsLayer);
                    }
                    btnCevi.classList.add('inactive');
                } else {
                    mapInstance.addLayer(editorManager.pipesLayer);
                    if (editorManager.pipeJointsLayer && !mapInstance.hasLayer(editorManager.pipeJointsLayer)) {
                        mapInstance.addLayer(editorManager.pipeJointsLayer);
                    }
                    editorManager.updatePipeJointMarkers();
                    btnCevi.classList.remove('inactive');
                }
                sacuvajStanjeDugmadi();
            }
        });
    }

    // 7. ŽICE (Elektrovodovi / elektro-mreža)
    if (btnZice) {
        btnZice.addEventListener('click', () => {
            const isHidden = mapaElement.classList.contains('hide-wires');
            if (isHidden) {
                mapaElement.classList.remove('hide-wires');
                btnZice.classList.remove('inactive');
            } else {
                mapaElement.classList.add('hide-wires');
                btnZice.classList.add('inactive');
            }
            sacuvajStanjeDugmadi();
        });
    }

    // 8. UREĐAJI (Svi markeri uređaja)
    if (btnUredjaji) {
        btnUredjaji.addEventListener('click', () => {
            if (editorManager && editorManager.devicesLayer) {
                const isVisible = mapInstance.hasLayer(editorManager.devicesLayer);
                if (isVisible) {
                    mapInstance.removeLayer(editorManager.devicesLayer);
                    btnUredjaji.classList.add('inactive');
                } else {
                    mapInstance.addLayer(editorManager.devicesLayer);
                    btnUredjaji.classList.remove('inactive');
                }
                sacuvajStanjeDugmadi();
            }
        });
    }

    // Povezivanje dugmeta za promenu satelitskog/običnog prikaza
    const btnMap = document.getElementById('btnMapSwitch');
    if (btnMap) {
        btnMap.addEventListener('click', () => {
            mapManager.toggleLayer(btnMap);
        });
    }
    
    console.log("Aplikacija 'Irigacija' je uspešno inicijalizovana u modularnom OOP stilu.");
});
