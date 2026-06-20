import { ComponentRegistry } from './komponente/core/ComponentRegistry.js?v=1.2.4';
import { friendlyGncModel } from './komponente/core/Konstante.js?v=1.2.4';
import { getToolCursor } from './editor/CursorHelper.js?v=1.2.4';

/**
 * EditorManager - Upravlja vizuelnim projektovanjem (Edit mod) i izvršnim režimom (Run mod)
 */
export class EditorManager {
    constructor(mapInstance) {
        this.map = mapInstance;
        
        // Leaflet LayerGroups za upravljanje vidljivošću slojeva
        this.devicesLayer = L.layerGroup().addTo(this.map);
        this.pipesLayer = L.layerGroup().addTo(this.map);
        this.pipeJointsLayer = L.layerGroup().addTo(this.map);

        // Kreiranje visoko-prioritetnog panela za GNC markere (kako bi bili iznad žica)
        if (this.map && !this.map.getPane('gncMarkerPane')) {
            const gncPane = this.map.createPane('gncMarkerPane');
            gncPane.style.zIndex = '1050';
        }

        // Stanje editora
        this.isEditMode = false;
        this.selectedTool = null; // 'pump', 'valve', 'gauge', 'pipe'
        
        // Baza postavljenih elemenata (Source of Truth)
        this.devices = [];
        this.pipes = [];
        
        // Pomagači za crtanje creva (veza) - NOVI POLILINIJSKI SISTEM
        this.pipeStartDevice = null;
        this.pipeStartPoint = null;
        this.tempPipeLine = null;
        this.isDrawingPipe = false;
        this.drawingPipePoints = [];
        this.drawingPipeMarkers = [];
        this.activePipePolyline = null;
        this.continuingPipeId = null;
        
        // Leaflet reference za brisanje i ažuriranje
        this.deviceMarkers = {};
        this.pipeLines = {};
        
        // Pomoćne reference za izmenu geometrije creva (sprečavanje curenja markera)
        this.geomEditMarkerSloj = null;
        this.geomEditPoly = null;
        
        // Interval za mrežnu anketu senzora
        this.pollingInterval = null;
        
        // Potrošnja vode i aktivne gauge reference
        this.totalWaterConsumption = parseFloat(localStorage.getItem('irigacija_total_consumption') || '0.0');
        this.activeGaugeDevice = null;
        
        // Stanje za Scenarije i Radne Liste Zalivanja
        this.scenarios = [];
        this.activeScenarioId = null;
        this.selectedValvesForScenario = [];
        this.isSelectingValvesForScenario = false;
        
        // Elektroožičenje stanje i reference
        this.wiring = [];
        this.wireLines = {};
        this.wireStartPoint = null;
        this.tempWireLine = null;
        
        this.init();
    }
    
    /**
     * Pokreće editor, učitava postojeći raspored i vezuje DOM događaje
     */
    init() {
        // Učitaj raspored sa bekenda ili lokalne memorije
        this.loadLayout();
        
        // Poveži glavno dugme za promenu režima (Edit / Run)
        const btnEdit = document.getElementById('btnEditSystem');
        if (btnEdit) {
            btnEdit.addEventListener('click', () => this.toggleEditMode());
        }
        
        // Poveži izbor alata iz bočne palete
        const tools = ['gnc', 'pump', 'valve', 'gauge', 'flow_meter', 'pipe', 'wire'];
        tools.forEach(tool => {
            const el = document.getElementById(`tool-${tool}`);
            if (el) {
                el.addEventListener('click', () => this.selectTool(tool));
            }
        });
        
        // Poveži dugme za ručno čuvanje na bekend / disk RPi-ja
        const btnSave = document.getElementById('btnSaveLayout');
        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                const uspeh = await this.saveLayout();
                if (uspeh) {
                    alert("Raspored je uspešno sačuvan na RPi disku!");
                } else {
                    alert("Raspored je privremeno sačuvan u pretraživaču, ali bekend trenutno nije dostupan.");
                }
            });
        }

        // Poveži dugme za izvoz JSON fajla
        const btnExport = document.getElementById('btnExportLayout');
        if (btnExport) {
            btnExport.addEventListener('click', () => this.exportLayoutToJson());
        }

        // Poveži dugme za uvoz JSON fajla
        const btnImport = document.getElementById('btnImportLayout');
        const fileInput = document.getElementById('importFile');
        if (btnImport && fileInput) {
            btnImport.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => this.importLayoutFromJson(e));
        }

        // Poveži dugme za zatvaranje bočne palete (ZATVORI)
        const btnCloseSidebar = document.getElementById('btnCloseSidebar');
        if (btnCloseSidebar) {
            btnCloseSidebar.addEventListener('click', () => {
                if (this.isEditMode) {
                    this.toggleEditMode();
                }
            });
        }

        // Poveži dugme za čišćenje mrežnog monitora
        const btnClearLog = document.getElementById('btnClearMonitor');
        if (btnClearLog) {
            btnClearLog.addEventListener('click', () => this.clearNetworkLogs());
        }
        
        // Poveži zatvaranje modalnog sat-gauge-a
        const modalClose = document.getElementById('gauge-modal-close');
        if (modalClose) {
            modalClose.addEventListener('click', () => this.closeGaugeModal());
        }
        const gaugeModal = document.getElementById('gauge-modal');
        if (gaugeModal) {
            gaugeModal.addEventListener('click', (e) => {
                if (e.target === gaugeModal) {
                    this.closeGaugeModal();
                }
            });
        }
        
        // Slušaj klik na samu mapu (za postavljanje novih uređaja)
        this.map.on('click', (e) => this.onMapClick(e));
        
        // Slušaj pomeranje miša na mapi (za privremeno iscrtavanje creva dok crtamo)
        this.map.on('mousemove', (e) => this.onMapMouseMove(e));

        // Slušaj promene prikaza na mapi (zoom, move) za dinamičko fiksiranje ožičenja
        this.map.on('zoom move zoomend moveend viewreset', () => {
            this.updateAllWires();
            this.updateAllPipes();
        });

        // Slušaj taster Escape za prekid crtanja creva ili ožičenja ili odbacivanje selekcije ventila
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isSelectingValvesForScenario) {
                    this.rejectValveSelectionForScenario();
                } else {
                    this.resetPipeConnection();
                    this.resetWireConnection();
                }
            }
        });

        // Slušaj desni klik na mapi i njenom kontejneru za prekid crtanja creva/ožičenja ili za akcije selekcije ventila
        this.map.on('contextmenu', (e) => {
            if (this.isSelectingValvesForScenario) {
                L.DomEvent.preventDefault(e);
                this.showSelectionContextMenu(e.latlng);
                return;
            }
            if (this.isEditMode && this.selectedTool === 'pipe') {
                if (this.isDrawingPipe) {
                    L.DomEvent.preventDefault(e);
                    this.stopDrawingPipe(false); // Završi i sačuvaj uspešno!
                } else if (this.pipeStartPoint || this.tempPipeLine) {
                    L.DomEvent.preventDefault(e);
                    this.resetPipeConnection();
                }
            }
            if (this.isEditMode && this.selectedTool === 'wire' && (this.wireStartPoint || this.tempWireLine)) {
                L.DomEvent.preventDefault(e);
                this.resetWireConnection();
            }
        });
        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.addEventListener('contextmenu', (e) => {
                if (this.isSelectingValvesForScenario) {
                    e.preventDefault();
                    return;
                }
                if (this.isEditMode && this.selectedTool === 'pipe') {
                    if (this.isDrawingPipe) {
                        e.preventDefault();
                        this.stopDrawingPipe(false); // Završi i sačuvaj uspešno!
                    } else if (this.pipeStartPoint || this.tempPipeLine) {
                        e.preventDefault();
                        this.resetPipeConnection();
                    }
                }
                if (this.isEditMode && this.selectedTool === 'wire' && (this.wireStartPoint || this.tempWireLine)) {
                    e.preventDefault();
                    this.resetWireConnection();
                }
            });
        }

        // Spreči propagaciju klikova i skrolovanja sa GNC overlay-a na mapu ispod
        const overlay = document.getElementById('gnc-schematic-overlay');
        if (overlay) {
            L.DomEvent.disableClickPropagation(overlay);
            L.DomEvent.disableScrollPropagation(overlay);

            // Omogući prevlačenje (drag-and-drop) panela sa pinovima (radi i u edit i u radnom režimu)
            overlay.addEventListener('mousedown', (e) => {
                // Preskoči prevlačenje ako se klikne na interaktivne tastere (close ili pinove)
                if (e.target.closest('.pin-socket, .gnc-schematic-close')) return;
                
                const dragData = {
                    startX: e.clientX,
                    startY: e.clientY,
                    initialLeft: overlay.offsetLeft,
                    initialTop: overlay.offsetTop
                };

                let hasDragged = false;

                const handleMouseMove = (me) => {
                    const dx = me.clientX - dragData.startX;
                    const dy = me.clientY - dragData.startY;
                    
                    if (!hasDragged && Math.sqrt(dx*dx + dy*dy) > 5) {
                        hasDragged = true;
                    }

                    if (hasDragged) {
                        me.preventDefault(); // Spreči selekciju teksta tokom povlačenja
                        overlay.style.right = 'auto';
                        overlay.style.bottom = 'auto';
                        overlay.style.left = (dragData.initialLeft + dx) + 'px';
                        overlay.style.top = (dragData.initialTop + dy) + 'px';
                        this.updateAllWires();
                    }
                };

                const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);

                    if (hasDragged) {
                        // Sačuvaj poziciju i automatski postavi remember_position na true čim se pomeri panel
                        if (this.hoveredGncId) {
                            const device = this.devices.find(d => d.id === this.hoveredGncId);
                            if (device) {
                                device.properties = device.properties || {};
                                device.properties.panel_left = overlay.style.left;
                                device.properties.panel_top = overlay.style.top;
                                device.properties.remember_position = true; // Automatski pamtimo čim se pomeri panel
                                this.saveLayout();
                            }
                        }

                        // Spreči klik događaj nakon prevlačenja da se ne bi otvorio veliki modal
                        const captureClick = (clickEvent) => {
                            clickEvent.stopPropagation();
                            clickEvent.preventDefault();
                            document.removeEventListener('click', captureClick, true);
                        };
                        document.addEventListener('click', captureClick, true);
                        
                        setTimeout(() => {
                            document.removeEventListener('click', captureClick, true);
                        }, 50);
                    }
                };

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            });
        }

        // Inicijalizacija scenarija za zalivanje
        this.initScenarioEvents();

        // Slušaj globalne Bootstrap modal događaje za sakrivanje i ponovno iscrtavanje električnog ožičenja i GNC panela
        document.addEventListener('show.bs.modal', () => {
            this.closeGncSchematic();
            const wiresOverlay = document.getElementById('wires-svg-overlay');
            if (wiresOverlay) {
                wiresOverlay.style.display = 'none';
            }
        });

        document.addEventListener('hidden.bs.modal', () => {
            const openModals = document.querySelectorAll('.modal.show');
            if (openModals.length === 0) {
                const wiresOverlay = document.getElementById('wires-svg-overlay');
                if (wiresOverlay) {
                    wiresOverlay.style.display = '';
                }
                this.updateAllWires();
            }
            
            // Deaktiviraj aktivni alat (isključi komponente) pri zatvaranju bilo kog modala
            this.selectTool(null);
        });

        // --- INICIJALIZACIJA DOGAĐAJA ZA NOVE INTERAKTIVNE MODALE ---
        
        // A. MODAL ZA UREĐAJE: ČUVANJE
        const btnDevSave = document.getElementById('btn-dev-save');
        if (btnDevSave) {
            btnDevSave.addEventListener('click', () => {
                const devId = document.getElementById('dev-edit-id').value;
                const device = this.devices.find(d => d.id === devId);
                if (!device) return;

                let nameVal = '';
                if (device.type === 'pump') {
                    nameVal = document.getElementById('dev-pump-name').value.trim();
                } else if (device.type === 'valve') {
                    nameVal = document.getElementById('dev-valve-name').value.trim();
                } else if (device.type === 'gauge' || device.type === 'flow_meter') {
                    nameVal = document.getElementById('dev-sensor-name').value.trim();
                } else if (device.type === 'gnc') {
                    nameVal = document.getElementById('dev-gnc-name').value.trim();
                } else {
                    nameVal = document.getElementById('dev-name').value.trim();
                }

                if (!nameVal) {
                    alert("Naziv uređaja je obavezan!");
                    return;
                }

                device.name = nameVal;

                if (device.type === 'pump') {
                    device.arduinoId = document.getElementById('dev-pump-network-id').value.trim();
                } else if (device.type === 'valve') {
                    device.arduinoId = document.getElementById('dev-valve-network-id').value.trim();
                } else if (device.type === 'gauge' || device.type === 'flow_meter') {
                    device.arduinoId = document.getElementById('dev-sensor-network-id').value.trim();
                } else if (device.type === 'gnc') {
                    device.arduinoId = document.getElementById('dev-gnc-network-id').value.trim();
                } else {
                    device.arduinoId = document.getElementById('dev-network-id').value.trim();
                }

                device.properties = device.properties || {};

                if (device.type === 'pump') {
                    const capacityVal = parseFloat(document.getElementById('dev-pump-capacity').value);
                    device.properties.max_capacity = !isNaN(capacityVal) ? capacityVal : null;
                    device.properties.port_pin = document.getElementById('dev-pump-port-pin').value.trim();
                } else if (device.type === 'valve') {
                    device.properties.promer = document.getElementById('dev-valve-promer').value;
                    device.properties.port_pin = document.getElementById('dev-valve-port-pin').value.trim();
                } else if (device.type === 'gauge' || device.type === 'flow_meter') {
                    const sensorTypeEl = document.querySelector('input[name="sensor_type"]:checked');
                    device.properties.sensor_type = sensorTypeEl ? sensorTypeEl.value : 'pulse';
                    device.properties.transfer_function = document.getElementById('dev-sensor-formula').value.trim();
                    device.properties.port_pin = document.getElementById('dev-sensor-port-pin').value.trim();
                    if (device.type === 'gauge') {
                        const maxPresVal = parseFloat(document.getElementById('dev-sensor-max-pressure').value);
                        device.properties.max_pressure = !isNaN(maxPresVal) ? maxPresVal : 10.0;
                    }
                } else if (device.type === 'gnc') {
                    device.properties.gnc_model = document.getElementById('dev-gnc-model').value;
                    device.properties.port_pin = document.getElementById('dev-gnc-port-pin').value.trim();
                    device.properties.gnc_logic = document.getElementById('dev-gnc-logic').value.trim();
                    const rememberPosEl = document.getElementById('dev-gnc-remember-position');
                    device.properties.remember_position = rememberPosEl ? rememberPosEl.checked : false;
                    
                    if (device.properties.remember_position) {
                        const overlay = document.getElementById('gnc-schematic-overlay');
                        if (overlay && overlay.classList.contains('show')) {
                            device.properties.panel_left = overlay.style.left || (overlay.offsetLeft + 'px');
                            device.properties.panel_top = overlay.style.top || (overlay.offsetTop + 'px');
                        }
                    } else {
                        delete device.properties.panel_left;
                        delete device.properties.panel_top;
                    }

                    // Ako je ovaj GNC trenutno otvoren i prikazuje panel sa pinovima, re-renderuj ga odmah
                    if (this.hoveredGncId === device.id) {
                        const overlay = document.getElementById('gnc-schematic-overlay');
                        if (overlay && overlay.classList.contains('show')) {
                            overlay.innerHTML = this.getGncSchematicHtml(device);
                        }
                    }
                }

                this.refreshDeviceIcon(device);
                this.saveLayout();
                this.updateAllWires();

                // Zatvori modal
                const modalEl = document.getElementById('modalUredjajKarakteristike');
                const modalObj = bootstrap.Modal.getInstance(modalEl);
                if (modalObj) modalObj.hide();
            });
        }

        // B. MODAL ZA UREĐAJE: BRISANJE
        const btnDevDelete = document.getElementById('btn-dev-delete');
        if (btnDevDelete) {
            btnDevDelete.addEventListener('click', () => {
                const devId = document.getElementById('dev-edit-id').value;
                const device = this.devices.find(d => d.id === devId);
                if (!device) return;

                if (confirm(`Da li sigurno želiš da ukloniš uređaj "${device.name}"?`)) {
                    if (device.type === 'gnc') {
                        this.closeGncSchematic();
                    }
                    const marker = this.deviceMarkers[device.id];
                    if (marker) {
                        if (this.devicesLayer) this.devicesLayer.removeLayer(marker);
                        this.map.removeLayer(marker);
                        delete this.deviceMarkers[device.id];
                    }

                    // Obriši sva creva povezana na njega
                    this.pipes.forEach(pipe => {
                        if (pipe.from === device.id || pipe.to === device.id) {
                            if (this.pipeLines[pipe.id]) {
                                if (this.pipesLayer) this.pipesLayer.removeLayer(this.pipeLines[pipe.id]);
                                this.map.removeLayer(this.pipeLines[pipe.id]);
                                delete this.pipeLines[pipe.id];
                            }
                        }
                    });
                    this.pipes = this.pipes.filter(p => p.from !== device.id && p.to !== device.id);

                    // Obriši sva električna ožičenja povezana na njega
                    if (this.wiring) {
                        this.wiring.forEach(wire => {
                            if (wire.fromDeviceId === device.id || wire.toDeviceId === device.id) {
                                if (this.wireLayers && this.wireLayers[wire.id]) {
                                    this.wireLayers[wire.id].forEach(layer => this.map.removeLayer(layer));
                                    delete this.wireLayers[wire.id];
                                }
                            }
                        });
                        this.wiring = this.wiring.filter(w => w.fromDeviceId !== device.id && w.toDeviceId !== device.id);
                    }

                    this.devices = this.devices.filter(d => d.id !== device.id);

                    this.saveLayout();

                    // Zatvori modal
                    const modalEl = document.getElementById('modalUredjajKarakteristike');
                    const modalObj = bootstrap.Modal.getInstance(modalEl);
                    if (modalObj) modalObj.hide();
                }
            });
        }

        // C. MODAL ZA UREĐAJE: MANUELNE KONTROLE (PUMPA)
        const btnPumpOn = document.getElementById('btn-pump-on');
        if (btnPumpOn) {
            btnPumpOn.addEventListener('click', () => {
                const devId = document.getElementById('dev-edit-id').value;
                const device = this.devices.find(d => d.id === devId);
                if (device && device.type === 'pump') {
                    device.status = 'on';
                    this.refreshDeviceIcon(device);
                    this.sendPumpCommandPhysical(device, 'on');
                    
                    // Vizuelni feedback dugmadi u realnom vremenu
                    document.getElementById('btn-pump-on').style.opacity = '1';
                    document.getElementById('btn-pump-off').style.opacity = '0.5';
                }
            });
        }
        const btnPumpOff = document.getElementById('btn-pump-off');
        if (btnPumpOff) {
            btnPumpOff.addEventListener('click', () => {
                const devId = document.getElementById('dev-edit-id').value;
                const device = this.devices.find(d => d.id === devId);
                if (device && device.type === 'pump') {
                    device.status = 'off';
                    this.refreshDeviceIcon(device);
                    this.sendPumpCommandPhysical(device, 'off');
                    
                    // Vizuelni feedback dugmadi u realnom vremenu
                    document.getElementById('btn-pump-on').style.opacity = '0.5';
                    document.getElementById('btn-pump-off').style.opacity = '1';
                }
            });
        }

        // D. MODAL ZA UREĐAJE: MANUELNE KONTROLE (VENTIL)
        const btnValveOpen = document.getElementById('btn-valve-open');
        if (btnValveOpen) {
            btnValveOpen.addEventListener('click', () => {
                const devId = document.getElementById('dev-edit-id').value;
                const device = this.devices.find(d => d.id === devId);
                if (device && device.type === 'valve') {
                    device.status = 'open';
                    this.refreshDeviceIcon(device);
                    this.sendValveCommandPhysical(device, 'open');
                    
                    // Vizuelni feedback dugmadi u realnom vremenu
                    document.getElementById('btn-valve-open').style.opacity = '1';
                    document.getElementById('btn-valve-close').style.opacity = '0.5';
                }
            });
        }
        const btnValveClose = document.getElementById('btn-valve-close');
        if (btnValveClose) {
            btnValveClose.addEventListener('click', () => {
                const devId = document.getElementById('dev-edit-id').value;
                const device = this.devices.find(d => d.id === devId);
                if (device && device.type === 'valve') {
                    device.status = 'closed';
                    this.refreshDeviceIcon(device);
                    this.sendValveCommandPhysical(device, 'closed');
                    
                    // Vizuelni feedback dugmadi u realnom vremenu
                    document.getElementById('btn-valve-open').style.opacity = '0.5';
                    document.getElementById('btn-valve-close').style.opacity = '1';
                }
            });
        }

        // E. SENSOR DETALJI: DUGME ZA ANALOGNI SAT
        const btnShowAnalogGauge = document.getElementById('btn-show-analog-gauge');
        if (btnShowAnalogGauge) {
            btnShowAnalogGauge.addEventListener('click', () => {
                const devId = document.getElementById('dev-edit-id').value;
                const device = this.devices.find(d => d.id === devId);
                if (device && (device.type === 'gauge' || device.type === 'flow_meter')) {
                    // Prvo zatvori modal karakteristika
                    const modalEl = document.getElementById('modalUredjajKarakteristike');
                    const modalObj = bootstrap.Modal.getInstance(modalEl);
                    if (modalObj) modalObj.hide();
                    
                    // Otvori analogni sat
                    setTimeout(() => this.openGaugeModal(device), 300);
                }
            });
        }

        // F. MODAL ZA CREVA: IZBOR KATEGORIJE (KLIK NA KARTICE)
        document.querySelectorAll('.pipe-category-option').forEach(option => {
            option.addEventListener('click', (e) => {
                if (!this.isEditMode) return; // ignoriši ako nije edit mod
                
                const category = option.getAttribute('data-category');
                const thickness = option.getAttribute('data-thickness');
                
                document.getElementById('pipe-category-val').value = category;
                document.getElementById('pipe-thickness-val').value = thickness;
                
                document.querySelectorAll('.pipe-category-option').forEach(el => el.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        // G. MODAL ZA CREVA: SAČUVAJ
        const btnPipeSave = document.getElementById('btn-pipe-save');
        if (btnPipeSave) {
            btnPipeSave.addEventListener('click', () => {
                const pipeId = document.getElementById('pipe-edit-id').value;
                const pipe = this.pipes.find(p => p.id === pipeId);
                if (!pipe) return;

                const category = document.getElementById('pipe-category-val').value;
                const thickness = parseInt(document.getElementById('pipe-thickness-val').value) || 4;
                const color = document.getElementById('pipe-color-picker').value;

                pipe.properties = {
                    category: category,
                    thickness: thickness,
                    color: color
                };

                // Odmah ažuriraj stil na mapi
                const polyline = this.pipeLines[pipe.id];
                if (polyline) {
                    polyline.setStyle({
                        color: color,
                        weight: thickness
                    });
                }

                this.saveLayout();

                // Zatvori modal
                const modalEl = document.getElementById('modalCrevoKarakteristike');
                const modalObj = bootstrap.Modal.getInstance(modalEl);
                if (modalObj) modalObj.hide();
            });
        }

        // H. MODAL ZA CREVA: BRISANJE
        const btnPipeDelete = document.getElementById('btn-pipe-delete');
        if (btnPipeDelete) {
            btnPipeDelete.addEventListener('click', () => {
                const pipeId = document.getElementById('pipe-edit-id').value;
                const pipe = this.pipes.find(p => p.id === pipeId);
                if (!pipe) return;

                if (confirm("Da li želite da obrišete ovo crevo za vodu?")) {
                    const polyline = this.pipeLines[pipe.id];
                    if (polyline) {
                        if (this.pipesLayer) this.pipesLayer.removeLayer(polyline);
                        this.map.removeLayer(polyline);
                    }
                    delete this.pipeLines[pipe.id];
                    this.pipes = this.pipes.filter(p => p.id !== pipe.id);

                    this.updatePipeJointMarkers();
                    this.saveLayout();

                    // Zatvori modal
                    const modalEl = document.getElementById('modalCrevoKarakteristike');
                    const modalObj = bootstrap.Modal.getInstance(modalEl);
                    if (modalObj) modalObj.hide();
                }
            });
        }

        // H.2 MODAL ZA CREVA: UREDI GEOMETRIJU
        const btnPipeEditGeometry = document.getElementById('btn-pipe-edit-geometry');
        if (btnPipeEditGeometry) {
            btnPipeEditGeometry.addEventListener('click', () => {
                const pipeId = document.getElementById('pipe-edit-id').value;
                const pipe = this.pipes.find(p => p.id === pipeId);
                if (!pipe) return;

                // Prvo zatvori modal karakteristika
                const modalEl = document.getElementById('modalCrevoKarakteristike');
                const modalObj = bootstrap.Modal.getInstance(modalEl);
                if (modalObj) {
                    modalEl.addEventListener('hidden.bs.modal', () => {
                        setTimeout(() => {
                            this.pokreniIzmenuGeometrijeCreva(pipe);
                        }, 50);
                    }, { once: true });
                    modalObj.hide();
                } else {
                    this.pokreniIzmenuGeometrijeCreva(pipe);
                }
            });
        }


        // I. MODAL ZA ŽICE (ELEKTRO-VODOVE): SAČUVAJ
        const btnWireSave = document.getElementById('btn-wire-save');
        if (btnWireSave) {
            btnWireSave.addEventListener('click', () => {
                const wireId = document.getElementById('wire-edit-id').value;
                const wire = this.wiring.find(w => w.id === wireId);
                if (!wire) return;

                const color = document.getElementById('wire-color-picker').value;
                wire.color = color;

                // Odmah ažuriraj stil na mapi
                this.drawWireLine(wire);

                this.saveLayout();

                // Zatvori modal
                const modalEl = document.getElementById('modalZicaKarakteristike');
                const modalObj = bootstrap.Modal.getInstance(modalEl);
                if (modalObj) modalObj.hide();
            });
        }

        // J. MODAL ZA ŽICE (ELEKTRO-VODOVE): BRISANJE
        const btnWireDelete = document.getElementById('btn-wire-delete');
        if (btnWireDelete) {
            btnWireDelete.addEventListener('click', () => {
                const wireId = document.getElementById('wire-edit-id').value;
                const wire = this.wiring.find(w => w.id === wireId);
                if (!wire) return;

                const dev1 = this.devices.find(d => d.id === wire.fromDeviceId);
                const dev2 = this.devices.find(d => d.id === wire.toDeviceId);

                if (confirm(`Da li želite da obrišete ovu električnu vezu?\n\n${dev1 ? dev1.name : ''} (${wire.fromPin}) - ${dev2 ? dev2.name : ''} (${wire.toPin})`)) {
                    this.deleteWire(wire.id);

                    // Zatvori modal
                    const modalEl = document.getElementById('modalZicaKarakteristike');
                    const modalObj = bootstrap.Modal.getInstance(modalEl);
                    if (modalObj) modalObj.hide();
                }
            });
        }
        
        console.log("EditorManager je uspešno inicijalizovan.");
    }
    
    toggleEditMode() {
        this.isEditMode = !this.isEditMode;
        
        const btnEdit = document.getElementById('btnEditSystem');
        const sidebar = document.getElementById('editor-sidebar');
        const mapContainer = document.getElementById('map-container');
        
        if (this.isEditMode) {
            // --- EDIT MOD JE AKTIVAN ---
            if (btnEdit) btnEdit.classList.add('active');
            if (sidebar) sidebar.classList.add('open');
            if (mapContainer) mapContainer.classList.add('edit-active');
            
            // Omogući pomeranje (prevlačenje) svih markera
            Object.values(this.deviceMarkers).forEach(marker => {
                marker.dragging.enable();
                const iconContainer = marker.getElement().querySelector('.device-icon-container');
                if (iconContainer) {
                    iconContainer.style.cursor = 'move';
                }
            });
        } else {
            // --- EDIT MOD ISKLJUČEN (Zatvoreno projektovanje) ---
            if (btnEdit) btnEdit.classList.remove('active');
            if (sidebar) sidebar.classList.remove('open');
            if (mapContainer) mapContainer.classList.remove('edit-active');
            
            // Onemogući pomeranje markera
            Object.values(this.deviceMarkers).forEach(marker => {
                marker.dragging.disable();
                const iconContainer = marker.getElement().querySelector('.device-icon-container');
                if (iconContainer) {
                    iconContainer.style.cursor = 'pointer';
                }
            });
            
            // Resetuj izabrane alate i očisti izmene geometrije
            this.selectTool(null);
            this.ocistiIzmenuGeometrijeCreva(false);
            this.resetPipeConnection();
        }

        // Re-render njiva to enable/disable interactivity based on isEditMode
        if (window.crtanjeManager) {
            window.crtanjeManager.renderNjiveOnMap();
            window.crtanjeManager.renderZoneZalivanjaOnMap();
        }
        
        // Osveži prikaz električnog ožičenja
        this.updateAllWires();
    }
    
    /**
     * Vraća url SVG-a sa ikonicom izabranog alata koji se koristi kao kursor na mapi
     */
    getCustomCursor(tool) {
        return getToolCursor(tool);
    }

    /**
     * Označava aktivni alat u bočnoj paleti
     * @param {String|null} tool Naziv alata ('pump', 'valve', 'gauge', 'flow_meter', 'pipe')
     */
    selectTool(tool) {
        if (this.selectedTool === tool) {
            tool = null;
        }

        // Poništi aktivno uređivanje geometrije creva ako promenimo ili isključimo alat
        this.ocistiIzmenuGeometrijeCreva(false);

        // Ukloni aktivnu klasu sa svih alata
        const tools = ['gnc', 'pump', 'valve', 'gauge', 'flow_meter', 'pipe', 'wire'];
        tools.forEach(t => {
            const el = document.getElementById(`tool-${t}`);
            if (el) el.classList.remove('active');
        });
        const btnZone = document.getElementById('tool-zone-draw');
        if (btnZone) btnZone.classList.remove('active');
        
        const oldTool = this.selectedTool;
        this.selectedTool = tool;

        if (tool) {
            // Ako je bilo aktivno crtanje zone, otkaži ga
            if (window.crtanjeManager && window.crtanjeManager.crtanjeAktivno && window.crtanjeManager.tipCrtanja === 'zona') {
                window.crtanjeManager.odbaciPoligon();
            }
            // Otkaži aktivno premeravanje ako je aktivno u MeasureManager-u
            if (window.measureManager && window.measureManager.isMeasuring) {
                window.measureManager.stopMeasuring(true);
            }
        }
        
        // Označi kliknuti alat kao aktivan
        if (tool) {
            const activeEl = document.getElementById(`tool-${tool}`);
            if (activeEl) activeEl.classList.add('active');
            
            // Promeni kursor na mapi u prilagođeni kursor komponente za precizno postavljanje
            document.getElementById('mapa').style.cursor = this.getCustomCursor(tool);
        } else {
            document.getElementById('mapa').style.cursor = '';
        }
        
        // Resetuj privremeno crtanje creva ako promenimo alat
        if (tool !== 'pipe') {
            if (this.isDrawingPipe) {
                this.stopDrawingPipe(true);
            } else {
                // Ako nismo počeli crtanje, ali smo bili u hoveru, ukloni indikatore
                if (window.snapManager && window.snapManager.snapIndicator && this.map.hasLayer(window.snapManager.snapIndicator)) {
                    this.map.removeLayer(window.snapManager.snapIndicator);
                }
                const tooltip = document.getElementById('pipe-measure-tooltip');
                if (tooltip) {
                    tooltip.style.display = 'none';
                }
            }
            this.resetPipeConnection();
        }
        
        // Resetuj privremeno crtanje žica ako promenimo alat
        if (tool !== 'wire') {
            this.resetWireConnection();
        }
        
        // Ako smo prebacili na 'wire' ili se sklonili sa 'wire', moramo ponovo iscrtati markere!
        if (tool === 'wire' || oldTool === 'wire') {
            this.refreshAllDeviceMarkers();
        }

        const mapEl = document.getElementById('mapa');
        if (mapEl) {
            if (tool === 'wire') {
                mapEl.classList.add('wiring-active');
            } else {
                mapEl.classList.remove('wiring-active');
            }
            if (tool === 'pipe') {
                mapEl.classList.add('pipe-active');
            } else {
                mapEl.classList.remove('pipe-active');
            }
        }
    }
    
    /**
     * Proverava da li je trenutno aktivno bilo kakvo crtanje ili merenje na mapi
     * @returns {Boolean} True ako je nešto aktivno
     */
    isAnyDrawingOrMeasuringActive() {
        return (
            this.isDrawingPipe || 
            this.wireStartPoint !== null || 
            (window.crtanjeManager && window.crtanjeManager.crtanjeAktivno) || 
            (window.measureManager && window.measureManager.isMeasuring)
        );
    }
    
    /**
     * Resetuje stanje crtanja creva (veza)
     */
    resetPipeConnection() {
        if (this.isDrawingPipe) {
            this.stopDrawingPipe(true);
        }
        this.pipeStartDevice = null;
        this.pipeStartPoint = null;
        if (this.tempPipeLine) {
            this.map.removeLayer(this.tempPipeLine);
            this.tempPipeLine = null;
        }
        if (window.snapManager && window.snapManager.snapIndicator) {
            this.map.removeLayer(window.snapManager.snapIndicator);
        }
    }
    
    /**
     * Resetuje stanje crtanja električnog ožičenja
     */
    resetWireConnection() {
        if (this.wireStartPoint && this.wireStartPoint.el) {
            this.wireStartPoint.el.classList.remove('wiring-active');
        }
        this.wireStartPoint = null;
        if (this.tempWireLine) {
            this.map.removeLayer(this.tempWireLine);
            this.tempWireLine = null;
        }
        this.map.off('mousemove', this.handleWireMouseMove, this);

        // Skloni collapsed-forced i force-expanded sa svih GNC kontejnera
        document.querySelectorAll('.gnc-hybrid-container').forEach(cnt => {
            cnt.classList.remove('force-expanded');
            cnt.classList.remove('collapsed-forced');
        });

        // Osveži sve žice
        this.updateAllWires();
    }

    /**
     * Potpuno uklanja i ponovo iscrtava sve markere na mapi
     */
    refreshAllDeviceMarkers() {
        // Ukloni postojeće markere sa mape i iz sloja uređaja
        if (this.devicesLayer) {
            this.devicesLayer.clearLayers();
        } else {
            Object.values(this.deviceMarkers).forEach(marker => {
                this.map.removeLayer(marker);
            });
        }
        this.deviceMarkers = {};
        
        // Ponovo ih iscrtaj u novom grafičkom modu
        this.devices.forEach(device => {
            this.createDeviceMarker(device);
        });
    }

    /**
     * Pronalazi najbliži slobodan kraj ili spoj nekog drugog creva na mapi
     * na osnovu udaljenosti u pikselima ekrana (manje od lineSnapPx u SnapManageru)
     */
    getSnappedPipeEndpoint(latlng, excludePipeId = null) {
        if (!this.map || !this.pipes || this.pipes.length === 0) return null;
        
        // Uzmi toleranciju u pikselima iz SnapManager-a, ali obezbedi da je bar 20px za lakše i pouzdanije spajanje creva
        const snapRadius = Math.max(
            (window.snapManager && window.snapManager.lineSnapPx) ? window.snapManager.lineSnapPx : 20,
            20
        );
        const mousePoint = this.map.latLngToContainerPoint(latlng);
        let closestPt = null;
        let minDistance = snapRadius;
        
        this.pipes.forEach(pipe => {
            if (excludePipeId && pipe.id === excludePipeId) return;
            
            // Proveri slobodne krajeve ovog creva (from === null ili to === null)
            const endpointsToCheck = [];
            if (!pipe.from && pipe.points && pipe.points[0]) {
                endpointsToCheck.push(pipe.points[0]);
            }
            if (!pipe.to && pipe.points && pipe.points.length > 0 && pipe.points[pipe.points.length - 1]) {
                endpointsToCheck.push(pipe.points[pipe.points.length - 1]);
            }
            
            endpointsToCheck.forEach(pt => {
                const ptLatLng = L.latLng(pt[0], pt[1]);
                const ptScreen = this.map.latLngToContainerPoint(ptLatLng);
                const dist = mousePoint.distanceTo(ptScreen);
                
                if (dist < minDistance) {
                    minDistance = dist;
                    closestPt = {
                        lat: ptLatLng.lat,
                        lng: ptLatLng.lng
                    };
                }
            });
        });
        
        return closestPt;
    }

    /**
     * Pronalazi najbližu početnu ili završnu tačku bilo kog sačuvanog creva na mapi
     * na osnovu udaljenosti u pikselima ekrana (unutar 15px)
     */
    getPipeEndpointNearLatLng(latlng) {
        if (!this.map || !this.pipes || this.pipes.length === 0) return null;
        
        const mousePoint = this.map.latLngToContainerPoint(latlng);
        let result = null;
        let minDistance = 15; // Radijus u pikselima za klik
        
        this.pipes.forEach(pipe => {
            if (!pipe.points || pipe.points.length === 0) return;
            
            const startPt = L.latLng(pipe.points[0]);
            const startScreen = this.map.latLngToContainerPoint(startPt);
            const startDist = mousePoint.distanceTo(startScreen);
            
            if (startDist < minDistance) {
                minDistance = startDist;
                result = {
                    pipe: pipe,
                    isStart: true,
                    latlng: startPt
                };
            }
            
            const endPt = L.latLng(pipe.points[pipe.points.length - 1]);
            const endScreen = this.map.latLngToContainerPoint(endPt);
            const endDist = mousePoint.distanceTo(endScreen);
            
            if (endDist < minDistance) {
                minDistance = endDist;
                result = {
                    pipe: pipe,
                    isStart: false,
                    latlng: endPt
                };
            }
        });
        
        return result;
    }

    /**
     * Pronalazi da li zadata koordinata odgovara nekom temenu bilo kog postojećeg creva.
     */
    findPipeVertex(latlng, excludePipeId = null) {
        if (!this.pipes || this.pipes.length === 0) return null;
        for (let pipe of this.pipes) {
            if (excludePipeId && pipe.id === excludePipeId) continue;
            if (!pipe.points || pipe.points.length === 0) continue;
            for (let i = 0; i < pipe.points.length; i++) {
                const pt = L.latLng(pipe.points[i]);
                if (pt.distanceTo(latlng) < 0.1) { // 10 cm tolerancija
                    return { pipe: pipe, index: i };
                }
            }
        }
        return null;
    }

    /**
     * Pronalazi da li zadata koordinata leži na segmentu/stranici nekog postojećeg creva (unutar 10px na ekranu).
     */
    findPipeEdgeSegment(latlng, excludePipeId = null) {
        if (!this.pipes || this.pipes.length === 0) return null;
        for (let pipe of this.pipes) {
            if (excludePipeId && pipe.id === excludePipeId) continue;
            if (!pipe.points || pipe.points.length < 2) continue;
            for (let i = 0; i < pipe.points.length - 1; i++) {
                const pt1 = L.latLng(pipe.points[i]);
                const pt2 = L.latLng(pipe.points[i+1]);
                
                const p = this.map.latLngToContainerPoint(latlng);
                const p1 = this.map.latLngToContainerPoint(pt1);
                const p2 = this.map.latLngToContainerPoint(pt2);
                
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const lenSq = dx * dx + dy * dy;
                if (lenSq === 0) continue;
                
                let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t));
                
                const projX = p1.x + t * dx;
                const projY = p1.y + t * dy;
                const projDist = p.distanceTo(L.point(projX, projY));
                
                if (projDist < 10) { // unutar 10 piksela na ekranu
                    return { pipe: pipe, index: i, latlng: latlng };
                }
            }
        }
        return null;
    }

    /**
     * Uklanja uzastopne duple tačke (sa tolerancijom 1e-6 stepeni) radi geometrijske čistoće.
     */
    filterConsecutiveDuplicates(arr) {
        const result = [];
        for (let i = 0; i < arr.length; i++) {
            if (i === 0) {
                result.push(arr[i]);
            } else {
                const prev = result[result.length - 1];
                const curr = arr[i];
                const latDiff = Math.abs(curr[0] - prev[0]);
                const lngDiff = Math.abs(curr[1] - prev[1]);
                if (latDiff > 1e-6 || lngDiff > 1e-6) {
                    result.push(curr);
                }
            }
        }
        return result;
    }

    /**
     * Primenjuje double-back algoritam za spajanje novog creva kao grane postojećeg creva.
     */
    mergeNewPipeAsBranch(drawingPoints, pipe, vertexIndex) {
        const existPoints = pipe.points; // niz [lat, lng]
        const newPoints = drawingPoints.map(pt => [pt.lat, pt.lng]);
        
        const part1 = existPoints.slice(0, vertexIndex + 1);
        const part2 = existPoints.slice(vertexIndex + 1);
        
        const branchForward = newPoints.slice(1);
        const branchBackward = [...branchForward].reverse();
        branchBackward.push(existPoints[vertexIndex]);
        
        const mergedPoints = [
            ...part1,
            ...branchForward,
            ...branchBackward,
            ...part2
        ];
        
        return this.filterConsecutiveDuplicates(mergedPoints);
    }

    /**
     * Pokreće režim crtanja creva (novog ili nastavka postojećeg)
     */
    startDrawingPipe(startLatLng, continuingPipe = null, isStart = false) {
        this.isDrawingPipe = true;
        this.drawingPipePoints = [];
        this.drawingPipeMarkers = [];
        this.continuingPipeId = continuingPipe ? continuingPipe.id : null;
        
        // Prikaži settings panel za snap
        if (window.snapManager) {
            window.snapManager.prikaziDrawingSettingsPanel();
        }
        
        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.style.cursor = 'crosshair';
            mapaEl.classList.add('drawing-mode-active');
        }
        
        // Povezivanje tastera Escape i desnog klika za završetak
        this.pipeEscapeHandler = (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                this.stopDrawingPipe(true);
            }
        };
        document.addEventListener('keydown', this.pipeEscapeHandler);
        this.map.on('contextmenu', this.onPipeDrawingContextMenu, this);
        
        if (continuingPipe) {
            // Nastavak postojećeg creva!
            let pts = JSON.parse(JSON.stringify(continuingPipe.points));
            if (isStart) {
                // Ako nastavljamo sa početka, moramo obrnuti tačke tako da početak postane kraj!
                pts.reverse();
            }
            
            // Konvertuj u L.LatLng
            this.drawingPipePoints = pts.map(pt => L.latLng(pt[0], pt[1]));
            
            // Sakrij originalnu poliliniju dok crtamo
            const polyline = this.pipeLines[continuingPipe.id];
            if (polyline) {
                if (this.pipesLayer) {
                    this.pipesLayer.removeLayer(polyline);
                } else {
                    this.map.removeLayer(polyline);
                }
            }
            
            // Nacrtaj markere za sva postojeća temena
            this.drawingPipePoints.forEach((pt, idx) => {
                const isEndJoint = (idx === this.drawingPipePoints.length - 1);
                const color = isEndJoint ? '#39ff14' : '#0055ff';
                const kruzicIcon = L.divIcon({
                    className: 'custom-vertex-marker custom-vertex-marker-pipe',
                    html: `<div style="width: 12px; height: 12px; background-color: #ffffff; border: 2px solid ${color}; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4);"></div>`,
                    iconSize: [12, 12],
                    iconAnchor: [6, 6]
                });
                const m = L.marker(pt, { icon: kruzicIcon, interactive: false }).addTo(this.map);
                this.drawingPipeMarkers.push(m);
            });
            
            // Kreiraj aktivnu poliliniju creva
            this.activePipePolyline = L.polyline(this.drawingPipePoints, {
                color: continuingPipe.properties?.color || '#0055ff',
                weight: continuingPipe.properties?.thickness || 8,
                opacity: 0.8
            }).addTo(this.map);
            
        } else {
            // Novo crevo!
            this.drawingPipePoints.push(startLatLng);
            
            // Prvi marker
            const kruzicIcon = L.divIcon({
                className: 'custom-vertex-marker custom-vertex-marker-pipe',
                html: '<div style="width: 12px; height: 12px; background-color: #ffffff; border: 2px solid #39ff14; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4);"></div>',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });
            const m = L.marker(startLatLng, { icon: kruzicIcon, interactive: false }).addTo(this.map);
            this.drawingPipeMarkers.push(m);
            
            this.activePipePolyline = L.polyline(this.drawingPipePoints, {
                color: '#0055ff',
                weight: 5,
                opacity: 0.8
            }).addTo(this.map);
        }
        
        this.tempPipeLine = L.polyline([], {
            color: '#0055ff',
            weight: 3,
            dashArray: '5, 5'
        }).addTo(this.map);
    }
 
    /**
     * Događaj klika tokom crtanja creva
     */
    onPipeDrawingMapClick(e) {
        if (!this.isDrawingPipe) return;
        
        let snappedLatLng = e.latlng;
        if (window.snapManager) {
            const snappedResult = window.snapManager.getSnappedResult(e.latlng, this.drawingPipePoints);
            snappedLatLng = snappedResult.latlng;
        }
        
        this.drawingPipePoints.push(snappedLatLng);
        this.activePipePolyline.setLatLngs(this.drawingPipePoints);
        
        // Dodaj marker za novo teme
        const kruzicIcon = L.divIcon({
            className: 'custom-vertex-marker custom-vertex-marker-pipe',
            html: '<div style="width: 12px; height: 12px; background-color: #ffffff; border: 2px solid #0055ff; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4);"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });
        const m = L.marker(snappedLatLng, { icon: kruzicIcon, interactive: false }).addTo(this.map);
        this.drawingPipeMarkers.push(m);
        
        // Ako je kliknuto na uređaj (i to nije prva tačka), možemo automatski da završimo crtanje!
        if (this.drawingPipePoints.length > 1) {
            const snappedDevice = this.getSnappedDevicePoint(snappedLatLng);
            if (snappedDevice) {
                this.stopDrawingPipe(false);
            }
        }
    }

    onPipeDrawingMapMouseMove(e) {
        let snappedLatLng = e.latlng;
        let isSnapped = false;
        
        // Odredi aktivne tačke za snepovanje (prazan niz ako crtanje još nije počelo)
        const activePts = (this.isDrawingPipe && this.drawingPipePoints) ? this.drawingPipePoints : [];
        
        if (window.snapManager) {
            const snappedResult = window.snapManager.getSnappedResult(e.latlng, activePts);
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
        
        // Lebdeći merni tooltip (merni oblačić specifičan za creva)
        let tooltip = document.getElementById('pipe-measure-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'pipe-measure-tooltip';
            tooltip.style.position = 'absolute';
            tooltip.style.backgroundColor = 'rgba(18, 18, 18, 0.9)';
            tooltip.style.backdropFilter = 'blur(4px)';
            tooltip.style.color = '#ffffff';
            tooltip.style.padding = '6px 10px';
            tooltip.style.borderRadius = '4px';
            tooltip.style.border = '1px solid #0055ff';
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
        
        // Ako još nismo pokrenuli crtanje creva, samo prikaži pomoćni tekst i prekini
        if (!this.isDrawingPipe || !this.drawingPipePoints || this.drawingPipePoints.length === 0) {
            tooltip.innerHTML = `Kliknite za početak crtanja creva`;
            return;
        }
        
        const lastPt = this.drawingPipePoints[this.drawingPipePoints.length - 1];
        const segmentDist = lastPt.distanceTo(snappedLatLng);
        
        let prevTotal = 0;
        for (let i = 0; i < this.drawingPipePoints.length - 1; i++) {
            prevTotal += this.drawingPipePoints[i].distanceTo(this.drawingPipePoints[i+1]);
        }
        const liveTotal = prevTotal + segmentDist;
        
        tooltip.innerHTML = `Deonica: <span style="color: #0055ff;">${segmentDist.toFixed(1)} m</span><br>Ukupno: <span style="color: #39ff14;">${liveTotal.toFixed(1)} m</span>`;
        
        // Ažuriraj privremenu liniju
        const lineColor = isSnapped ? '#39ff14' : '#0055ff';
        const lineDash = isSnapped ? '' : '5, 5';
        
        if (this.tempPipeLine) {
            this.tempPipeLine.setLatLngs([lastPt, snappedLatLng]);
            this.tempPipeLine.setStyle({
                color: lineColor,
                dashArray: lineDash
            });
        }
    }

    /**
     * Događaj desnog klika tokom crtanja creva
     */
    onPipeDrawingContextMenu(e) {
        L.DomEvent.stopPropagation(e);
        this.stopDrawingPipe(false);
    }

    /**
     * Zaustavlja režim crtanja creva i čuva ili odbacuje crtež
     */
    stopDrawingPipe(cancelActive = false) {
        if (!this.isDrawingPipe) return;
        
        this.isDrawingPipe = false;
        
        const mapaEl = document.getElementById('mapa');
        if (mapaEl) {
            mapaEl.style.cursor = '';
            mapaEl.classList.remove('drawing-mode-active');
        }
        
        // Ukloni mrežne slušaoce
        document.removeEventListener('keydown', this.pipeEscapeHandler);
        this.pipeEscapeHandler = null;
        this.map.off('contextmenu', this.onPipeDrawingContextMenu, this);
        
        if (window.snapManager && window.snapManager.snapIndicator && this.map.hasLayer(window.snapManager.snapIndicator)) {
            this.map.removeLayer(window.snapManager.snapIndicator);
        }
        
        // Sakrij lebdeći merni tooltip
        const tooltip = document.getElementById('pipe-measure-tooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
        
        // Sakrij panel za podešavanje snapa
        if (window.snapManager) {
            window.snapManager.sakrijDrawingSettingsPanel();
        }
        
        // Ukloni markere i privremene polilinije sa mape
        this.drawingPipeMarkers.forEach(m => this.map.removeLayer(m));
        this.drawingPipeMarkers = [];
        
        if (this.tempPipeLine) {
            this.map.removeLayer(this.tempPipeLine);
            this.tempPipeLine = null;
        }
        
        if (this.activePipePolyline) {
            this.map.removeLayer(this.activePipePolyline);
            this.activePipePolyline = null;
        }
        
        if (cancelActive) {
            if (this.continuingPipeId) {
                // Ako smo otkazali nastavak, ponovo prikaži originalno crevo
                const origPipe = this.pipes.find(p => p.id === this.continuingPipeId);
                if (origPipe) {
                    this.drawPipeLine(origPipe);
                }
            }
            this.drawingPipePoints = [];
            this.continuingPipeId = null;
            this.selectTool(null);
        } else {
            // Sačuvaj crevo!
            if (this.drawingPipePoints.length >= 2) {
                const pointsArr = this.drawingPipePoints.map(pt => [pt.lat, pt.lng]);
                
                // Samoizlečenje (Self-healing) veza sa uređajima na osnovu bliskosti
                let fromId = null;
                let toId = null;
                let fromPin = null;
                let toPin = null;
                
                const firstPt = this.drawingPipePoints[0];
                const lastPt = this.drawingPipePoints[this.drawingPipePoints.length - 1];
                
                const snappedFrom = this.getSnappedDevicePoint(firstPt);
                if (snappedFrom) {
                    fromId = snappedFrom.deviceId;
                    fromPin = snappedFrom.pinName;
                    if (fromPin) {
                        pointsArr[0] = [snappedFrom.lat, snappedFrom.lng];
                    }
                }
                
                const snappedTo = this.getSnappedDevicePoint(lastPt);
                if (snappedTo) {
                    toId = snappedTo.deviceId;
                    toPin = snappedTo.pinName;
                    if (toPin) {
                        pointsArr[pointsArr.length - 1] = [snappedTo.lat, snappedTo.lng];
                    }
                }
                
                if (this.continuingPipeId) {
                    // Ažuriramo postojeće crevo!
                    const pipe = this.pipes.find(p => p.id === this.continuingPipeId);
                    if (pipe) {
                        pipe.points = pointsArr;
                        pipe.from = fromId;
                        pipe.to = toId;
                        pipe.fromPin = fromPin;
                        pipe.toPin = toPin;
                        
                        this.drawPipeLine(pipe);
                        this.spojiPovezanaCreva();
                        this.saveLayout();
                        
                        // Otvori modal karakteristika
                        const polyline = this.pipeLines[pipe.id];
                        this.openPipeCharacteristicsModal(pipe, polyline);
                    }
                } else {
                    // SNEPOVANJE NA POSTOJEĆE CREVO (RAČVANJE / BRANCHING)
                    // Proveravamo da li prva tačka crtanja snepuje na neko postojeće teme ili ivicu nekog creva.
                    // Ako ne, proveravamo i poslednju tačku (u slučaju da je korisnik crtao u obrnutom smeru).
                    let match = this.findPipeVertex(firstPt);
                    let isReversed = false;
                    
                    if (!match) {
                        const edgeMatch = this.findPipeEdgeSegment(firstPt);
                        if (edgeMatch) {
                            const pipePoints = edgeMatch.pipe.points;
                            pipePoints.splice(edgeMatch.index + 1, 0, [firstPt.lat, firstPt.lng]);
                            match = { pipe: edgeMatch.pipe, index: edgeMatch.index + 1 };
                        }
                    }
                    
                    if (!match) {
                        const endMatchVertex = this.findPipeVertex(lastPt);
                        if (endMatchVertex) {
                            match = endMatchVertex;
                            isReversed = true;
                        } else {
                            const endMatchEdge = this.findPipeEdgeSegment(lastPt);
                            if (endMatchEdge) {
                                const pipePoints = endMatchEdge.pipe.points;
                                pipePoints.splice(endMatchEdge.index + 1, 0, [lastPt.lat, lastPt.lng]);
                                match = { pipe: endMatchEdge.pipe, index: endMatchEdge.index + 1 };
                                isReversed = true;
                            }
                        }
                    }
                    
                    if (match) {
                        // Ako smo snepovali na ivicu, findPipeEdgeSegment je vec dodao teme u match.pipe.points.
                        // Potrebno je samo da osvezimo match.pipe na mapi.
                        const polyline = this.pipeLines[match.pipe.id];
                        if (polyline) {
                            if (this.pipesLayer) {
                                this.pipesLayer.removeLayer(polyline);
                            } else {
                                this.map.removeLayer(polyline);
                            }
                            delete this.pipeLines[match.pipe.id];
                        }
                        this.drawPipeLine(match.pipe);
                    }
                    
                    // Umesto da spajamo kao dvostruku granu u postojece crevo (sto gubi konekcije), 
                    // pravimo novo nezavisno crevo. Zbog deljenog temena ponasace se kao spojeno.
                    const newPipe = {
                        id: 'pipe_' + Date.now(),
                        from: fromId,
                        to: toId,
                        fromPin: fromPin,
                        toPin: toPin,
                        points: pointsArr,
                        properties: {
                            category: 'main',
                            thickness: 8,
                            color: match ? (match.pipe.properties.color || '#0055ff') : '#0055ff'
                        }
                    };
                    if (match && match.pipe && match.pipe.properties) {
                        newPipe.properties = JSON.parse(JSON.stringify(match.pipe.properties));
                    }
                    
                    this.pipes.push(newPipe);
                    this.drawPipeLine(newPipe);
                    this.spojiPovezanaCreva();
                    this.saveLayout();
                    
                    // Otvori modal karakteristika
                    const polyline = this.pipeLines[newPipe.id];
                    this.openPipeCharacteristicsModal(newPipe, polyline);
                }
            }
            
            this.drawingPipePoints = [];
            this.continuingPipeId = null;
            
            // Alat za crtanje creva ostaje aktivan za nastavljanje crtanja novih creva (kao kod lenjira)
            const mapaEl = document.getElementById('mapa');
            if (mapaEl) {
                mapaEl.style.cursor = this.getCustomCursor('pipe');
            }
        }
    }

    /**
     * Analizira sva creva i pronalazi sve slobodne tačke (tamo gde je pipe.from ili pipe.to null)
     * i iscrtava po jedan kružić na svakoj jedinstvenoj slobodnoj koordinati.
     */

    /**
     * Analizira sva creva i pronalazi sve slobodne tačke (tamo gde je pipe.from ili pipe.to null)
     * i iscrtava po jedan kružić na svakoj jedinstvenoj slobodnoj koordinati.
     */
    updatePipeJointMarkers() {
        if (!this.pipeJointsLayer) {
            this.pipeJointsLayer = L.layerGroup().addTo(this.map);
        }
        this.pipeJointsLayer.clearLayers();
        
        // Prikazujemo ih samo ako smo u Edit modu i ako je sloj cevi vidljiv na mapi
        if (!this.isEditMode || (this.pipesLayer && !this.map.hasLayer(this.pipesLayer))) {
            return;
        }
        
        // Grupisaćemo slobodne krajeve po koordinatama kako bismo izbegli preklapanje (dupli kružići)
        const uniqueJoints = {};
        
        this.pipes.forEach(pipe => {
            const endpoints = [];
            if (!pipe.from && pipe.points && pipe.points[0]) {
                endpoints.push(pipe.points[0]);
            }
            if (!pipe.to && pipe.points && pipe.points.length > 0 && pipe.points[pipe.points.length - 1]) {
                endpoints.push(pipe.points[pipe.points.length - 1]);
            }
            
            endpoints.forEach(pt => {
                const key = `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
                if (!uniqueJoints[key]) {
                    uniqueJoints[key] = {
                        latlng: L.latLng(pt[0], pt[1]),
                        pipesConnected: []
                    };
                }
                uniqueJoints[key].pipesConnected.push(pipe.id);
            });
        });
        
        // Iscrtaj po jedan marker za svaku jedinstvenu slobodnu tačku
        Object.values(uniqueJoints).forEach(joint => {
            // Koristimo svetlo-narandžasti/plavi krug koji se lepo uklapa u temu sa sjajem (neon-glow)
            const iconHtml = `
                <div class="pipe-joint-marker-glow" style="
                    width: 12px; 
                    height: 12px; 
                    background-color: rgba(15, 15, 25, 0.9); 
                    border: 2px solid #ff8c00; 
                    border-radius: 50%; 
                    box-shadow: 0 0 8px #ff8c00, inset 0 0 4px #ff8c00;
                    cursor: pointer;
                "></div>
            `;
            const customIcon = L.divIcon({
                className: 'custom-vertex-marker custom-pipe-joint-marker',
                html: iconHtml,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });
            
            const marker = L.marker(joint.latlng, {
                icon: customIcon,
                interactive: true
            }).addTo(this.pipeJointsLayer);
            
            // Klik na spoj/kraj creva dok crtamo crevo ili pokrećemo nastavak
            marker.on('click', (e) => {
                if (e && e.originalEvent) {
                    e.originalEvent._handledByLayer = true;
                    L.DomEvent.stopPropagation(e.originalEvent);
                    if (e.originalEvent.stopPropagation) {
                        e.originalEvent.stopPropagation();
                    }
                }
                L.DomEvent.stopPropagation(e);
                
                if (this.selectedTool === 'pipe') {
                    if (this.isDrawingPipe) {
                        this.onPipeDrawingMapClick({ latlng: joint.latlng });
                    } else {
                        // Nastavak crtanja postojećeg creva!
                        const nearEndpoint = this.getPipeEndpointNearLatLng(joint.latlng);
                        if (nearEndpoint) {
                            this.startDrawingPipe(nearEndpoint.latlng, nearEndpoint.pipe, nearEndpoint.isStart);
                        } else {
                            this.startDrawingPipe(joint.latlng);
                        }
                    }
                }
            });
        });
    }
    
    /**
     * Nalazi najbliži uređaj na mapi na osnovu udaljenosti u pikselima ekrana (manje od 20px)
     * Za ventile (valve) proverava i lepi se na vodene pinove W_IN i W_OUT.
     */
    getSnappedDevicePoint(latlng) {
        if (!this.map || !this.devices || this.devices.length === 0) return null;
        
        const mousePoint = this.map.latLngToContainerPoint(latlng);
        let closestDevice = null;
        let minDistance = 30; // Radijus u pikselima za hvatanje (povećano sa 20 na 30 zbog ofseta vodenih pinova)
        
        this.devices.forEach(device => {
            const devLatLng = L.latLng(device.lat, device.lng);
            const devPoint = this.map.latLngToContainerPoint(devLatLng);
            const dist = mousePoint.distanceTo(devPoint);
            
            if (dist < minDistance) {
                minDistance = dist;
                closestDevice = device;
            }
        });
        
        if (closestDevice) {
            if (closestDevice.type === 'valve') {
                const pinInLatLng = this.getWaterPinLatLng(closestDevice.id, 'W_IN');
                const pinOutLatLng = this.getWaterPinLatLng(closestDevice.id, 'W_OUT');
                
                let pinInDist = Infinity;
                let pinOutDist = Infinity;
                
                if (pinInLatLng) {
                    const pinInPoint = this.map.latLngToContainerPoint(pinInLatLng);
                    pinInDist = mousePoint.distanceTo(pinInPoint);
                }
                if (pinOutLatLng) {
                    const pinOutPoint = this.map.latLngToContainerPoint(pinOutLatLng);
                    pinOutDist = mousePoint.distanceTo(pinOutPoint);
                }
                
                // Za ventile UVEK snepujemo na najbliži vodovodni pin (nikada na centar ventila)
                if (pinInDist <= pinOutDist) {
                    return {
                        lat: pinInLatLng.lat,
                        lng: pinInLatLng.lng,
                        deviceId: closestDevice.id,
                        pinName: 'W_IN'
                    };
                } else {
                    return {
                        lat: pinOutLatLng.lat,
                        lng: pinOutLatLng.lng,
                        deviceId: closestDevice.id,
                        pinName: 'W_OUT'
                    };
                }
            }
            
            return {
                lat: closestDevice.lat,
                lng: closestDevice.lng,
                deviceId: closestDevice.id,
                pinName: null
            };
        }
        return null;
    }
    
    /**
     * Rukuje klikom na mapu za postavljanje novih uređaja ili crtanje creva
     */
    onMapClick(e) {
        if (e && e.originalEvent && e.originalEvent._handledByLayer) {
            return;
        }
        if (this.isSelectingValvesForScenario) return; // Blokiramo dodavanje uređaja dok selektujemo ventile
        if (!this.isEditMode || !this.selectedTool) return;
        
        if (this.selectedTool === 'pipe') {
            if (this.isDrawingPipe) {
                this.onPipeDrawingMapClick(e);
            } else {
                // Ako nismo počeli crtanje, proveravamo da li kliknemo blizu nekog kraja postojećeg creva da bismo ga nastavili
                const nearEndpoint = this.getPipeEndpointNearLatLng(e.latlng);
                if (nearEndpoint) {
                    this.startDrawingPipe(nearEndpoint.latlng, nearEndpoint.pipe, nearEndpoint.isStart);
                } else {
                    // Inače krećemo novo crtanje creva uz snap
                    let startLatLng = e.latlng;
                    if (window.snapManager) {
                        const snappedResult = window.snapManager.getSnappedResult(e.latlng, []);
                        startLatLng = snappedResult.latlng;
                    }
                    this.startDrawingPipe(startLatLng);
                }
            }
            return;
        }
        
        // Klik na mapi u modu elektroožičenja ne sme da kreira novu komponentu
        if (this.selectedTool === 'wire') {
            this.resetWireConnection();
            return;
        }
        
        const latlng = e.latlng;
        const id = 'dev_' + Date.now();
        const type = this.selectedTool;
        const name = this.getDefaultName(type);
        
        if (!ComponentRegistry.has(type)) {
            console.error(`Nepoznat tip komponente: ${type}`);
            return;
        }

        // Kreiranje uređaja kroz centralni registar komponenti (jedinstvena fabrika)
        const newDevice = ComponentRegistry.create(type, {
            id: id,
            name: name,
            arduinoId: '', // Prazan ID na početku
            lat: latlng.lat,
            lng: latlng.lng,
            status: type === 'valve' ? 'closed' : 'active' // Elektroventil krećemo kao zatvoren
        });

        this.devices.push(newDevice);
        this.createDeviceMarker(newDevice);
        this.saveLayout();
        
        // Deaktiviraj alat nakon uspešnog postavljanja pojedinačnog uređaja
        this.selectTool(null);
    }
    
    /**
     * Rukuje pomeranjem miša na mapi (potrebno za iscrtavanje creva i elektro-vodova u realnom vremenu)
     */
    onMapMouseMove(e) {
        if (!this.isEditMode) return;
        
        if (this.selectedTool === 'pipe') {
            this.onPipeDrawingMapMouseMove(e);
            return;
        }
    }
    
    /**
     * Generiše podrazumevano ime za uređaje
     */
    getDefaultName(type) {
        const count = this.devices.filter(d => d.type === type).length + 1;
        if (type === 'gnc') return `GNC Kontroler ${count}`;
        if (type === 'pump') return `Pumpa ${count}`;
        if (type === 'valve') return `Ventil ${count}`;
        if (type === 'gauge') return `Merač pritiska ${count}`;
        if (type === 'flow_meter') return `Merač protoka ${count}`;
        return `Uređaj ${count}`;
    }
    
    /**
     * Kreira Leaflet marker sa custom SVG/HTML ikonom za uređaj i iscrtava ga na mapi
     * @param {Object} device Objekat uređaja
     */
    createDeviceMarker(device) {
        const isWiringMode = (this.selectedTool === 'wire');
        const iconHtml = this.getDeviceIconHtml(device);
        
        let size = [36, 36];
        let anchor = [18, 18];
        let markerClass = 'custom-device-marker';
        
        
        const customIcon = L.divIcon({
            className: markerClass,
            html: iconHtml,
            iconSize: size,
            iconAnchor: anchor
        });
        
        const markerOptions = {
            icon: customIcon,
            draggable: this.isEditMode // Može se pomerati samo ako smo u edit modu
        };
        if (device.type === 'gnc') {
            markerOptions.pane = 'gncMarkerPane';
        }

        const marker = L.marker([device.lat, device.lng], markerOptions).addTo(this.devicesLayer || this.map);
        
        // Sačuvaj referencu
        this.deviceMarkers[device.id] = marker;
        
        // --- DOGAĐAJ: PREVLAČENJE MARKERA (Dizajniranje) ---
        marker.on('drag', (e) => {
            const newLatLng = e.target.getLatLng();
            device.lat = newLatLng.lat;
            device.lng = newLatLng.lng;
            
            // Ažuriraj i sva creva i ožičenja koja su povezana na ovaj uređaj u realnom vremenu!
            this.updateConnectedPipes(device.id);
            this.updateConnectedWires(device.id);
        });

        marker.on('dragend', (e) => {
            const newLatLng = e.target.getLatLng();
            device.lat = newLatLng.lat;
            device.lng = newLatLng.lng;
            
            this.updateConnectedPipes(device.id);
            this.updateConnectedWires(device.id);
            this.saveLayout();
        });
        
        // --- DOGAĐAJ: KLIK NA MARKER (Različito u Edit i Run modu) ---
        marker.on('click', (e) => {
            if (e && e.originalEvent) {
                e.originalEvent._handledByLayer = true;
                L.DomEvent.stopPropagation(e.originalEvent);
                if (e.originalEvent.stopPropagation) {
                    e.originalEvent.stopPropagation();
                }
            }
            if (e) L.DomEvent.stopPropagation(e);

            if (device.type === 'gnc') {
                this.toggleGncSchematic(device.id);
                return;
            }
            if (this.isEditMode && this.selectedTool === 'pipe') {
                const deviceLatLng = L.latLng(device.lat, device.lng);
                if (this.isDrawingPipe) {
                    // Ako crtamo, klikom na uređaj dodajemo to teme (i automatski završavamo ako je u pitanju spajanje)
                    this.onPipeDrawingMapClick({ latlng: deviceLatLng });
                } else {
                    // Inače pokrećemo crtanje iz tog uređaja
                    this.startDrawingPipe(deviceLatLng);
                }
            } else {
                // Ako je aktivan režim selekcije ventila, dozvoljavamo samo selekciju ventila i blokiramo sve ostale akcije na markerima
                if (this.isSelectingValvesForScenario) {
                    if (device.type === 'valve') {
                        this.toggleValveSelectionForScenario(device);
                    }
                    return;
                }
            }
        });

        // --- DOGAĐAJ: DUPLI KLIK NA MARKER (Otvara modal za podešavanje uređaja) ---
        marker.on('dblclick', (e) => {
            if (e) L.DomEvent.stopPropagation(e);
            
            // Zabrani interakciju ako je bilo koji modal već otvoren
            const activeModal = document.querySelector('.modal.show');
            if (activeModal) return;

            this.openDeviceCharacteristicsModal(device, marker);
        });

        // --- DOGAĐAJ: DESNI KLIK NA MARKER (Otvara PRIHVATI/ODBACI ako je u toku selekcija ventila) ---
        marker.on('contextmenu', (e) => {
            if (this.isSelectingValvesForScenario) {
                if (e) L.DomEvent.stopPropagation(e);
                this.showSelectionContextMenu(e.latlng);
            }
        });
    }
    
    /**
     * Vraća HTML strukturu custom ikonice na osnovu tipa uređaja i njegovog stanja
     */
    getDeviceIconHtml(device) {
        // Render se delegira komponenti (jedinstveni izvor istine za izgled male ikonice).
        // Svi uređaji se kreiraju kroz ComponentRegistry, pa su instance sa renderSmallIcon().
        if (device && typeof device.renderSmallIcon === 'function') {
            return device.renderSmallIcon();
        }
        // Defanzivni fallback (ne bi trebalo da se desi u normalnom radu)
        console.warn('Uređaj bez renderSmallIcon() metode:', device);
        return `<div class="device-icon-container"><div class="device-label">${device ? device.name : ''}</div></div>`;
    }
    
    /**
     * Kreira novo crevo (vezu) između dva uređaja (kompatibilnost)
     */
    createPipe(fromDevice, toDevice) {
        const startPoint = { lat: fromDevice.lat, lng: fromDevice.lng, deviceId: fromDevice.id };
        const endPoint = { lat: toDevice.lat, lng: toDevice.lng, deviceId: toDevice.id };
        this.createPipeFromPoints(startPoint, endPoint);
        this.resetPipeConnection();
    }

    /**
     * Kreira novo crevo (vezu) između dve tačke (uređaji ili slobodne koordinate)
     */
    createPipeFromPoints(startPoint, endPoint) {
        // Proveri da li veza već postoji da ne dupliramo
        let vecPostoji = false;
        if (startPoint.deviceId && endPoint.deviceId) {
            vecPostoji = this.pipes.some(p => 
                (p.from === startPoint.deviceId && p.to === endPoint.deviceId) || 
                (p.from === endPoint.deviceId && p.to === startPoint.deviceId)
            );
        }
        
        if (vecPostoji) {
            this.resetPipeConnection();
            return;
        }
        
        const newPipe = {
            id: 'pipe_' + Date.now(),
            from: startPoint.deviceId || null,
            to: endPoint.deviceId || null,
            points: [
                [startPoint.lat, startPoint.lng],
                [endPoint.lat, endPoint.lng]
            ],
            properties: {
                category: 'main',
                thickness: 8,
                color: '#0055ff'
            }
        };
        
        this.pipes.push(newPipe);
        this.spojiPovezanaCreva();
        this.saveLayout();
        
        // Deaktiviraj alat nakon uspešnog iscrtavanja creva
        this.selectTool(null);
    }
    
    /**
     * Iscrtava poliliniju creva na mapi na osnovu njegovih srazmernih svojstava (debljina i boja)
     */
    drawPipeLine(pipe) {
        if (!pipe.points || pipe.points.length < 2) return;

        // Ako već postoji iscrtano crevo sa ovim ID-jem, prvo ga bezbedno ukloni sa mape da izbegnemo dupliranje
        if (this.pipeLines[pipe.id]) {
            const staraPolyline = this.pipeLines[pipe.id];
            if (this.pipesLayer) {
                this.pipesLayer.removeLayer(staraPolyline);
            } else {
                this.map.removeLayer(staraPolyline);
            }
            delete this.pipeLines[pipe.id];
        }

        // Ažuriraj prvu tačku ako je povezan uređaj
        if (pipe.from) {
            const fromDev = this.devices.find(d => d.id === pipe.from);
            if (fromDev) {
                if (fromDev.type === 'valve' && pipe.fromPin) {
                    const pinLatLng = this.getWaterPinLatLng(pipe.from, pipe.fromPin);
                    if (pinLatLng) {
                        pipe.points[0] = [pinLatLng.lat, pinLatLng.lng];
                    } else {
                        pipe.points[0] = [fromDev.lat, fromDev.lng];
                    }
                } else {
                    pipe.points[0] = [fromDev.lat, fromDev.lng];
                }
            }
        }

        // Ažuriraj poslednju tačku ako je povezan uređaj
        if (pipe.to) {
            const toDev = this.devices.find(d => d.id === pipe.to);
            if (toDev) {
                if (toDev.type === 'valve' && pipe.toPin) {
                    const pinLatLng = this.getWaterPinLatLng(pipe.to, pipe.toPin);
                    if (pinLatLng) {
                        pipe.points[pipe.points.length - 1] = [pinLatLng.lat, pinLatLng.lng];
                    } else {
                        pipe.points[pipe.points.length - 1] = [toDev.lat, toDev.lng];
                    }
                } else {
                    pipe.points[pipe.points.length - 1] = [toDev.lat, toDev.lng];
                }
            }
        }

        const properties = pipe.properties || { category: 'main', thickness: 8, color: '#0055ff' };
        const color = properties.color || '#0055ff';
        const weight = properties.thickness || 8;

        const polyline = L.polyline(pipe.points, {
            color: color,
            weight: weight,
            opacity: 0.8
        }).addTo(this.pipesLayer || this.map);

        this.pipeLines[pipe.id] = polyline;

        // Klik na crevo otvara modal za podešavanje karakteristika
        polyline.on('click', (e) => {
            // Ako je aktivan bilo koji mod crtanja/merenja ili je izabran alat u edit modu
            if (this.isAnyDrawingOrMeasuringActive() || (this.isEditMode && this.selectedTool)) {
                // Ako je selektovan alat za crevo, prosleđujemo klik u onMapClick radi crtanja/nastavljanja/spajanja
                if (this.isEditMode && this.selectedTool === 'pipe') {
                    let clickEvent = {
                        latlng: e.latlng,
                        originalEvent: e.originalEvent
                    };
                    if (e.originalEvent) {
                        delete e.originalEvent._handledByLayer;
                    }
                    this.onMapClick(clickEvent);
                }
                return; // Dozvoli klik kroz crevo na mapu da bi snap i crtanje radili
            }

            // Spreči prenošenje klika na mapu i druge elemente za normalne klikove van crtanja
            if (e && e.originalEvent) {
                e.originalEvent._handledByLayer = true;
                L.DomEvent.stopPropagation(e.originalEvent);
                if (e.originalEvent.stopPropagation) {
                    e.originalEvent.stopPropagation();
                }
            }
            L.DomEvent.stopPropagation(e);
            
            this.openPipeCharacteristicsModal(pipe, polyline);
        });
    }
    
    /**
     * Ažurira koordinate polilinije creva kada se povezani uređaj pomera na mapi
     */
    updateConnectedPipes(deviceId) {
        this.pipes.forEach(pipe => {
            if (pipe.from === deviceId || pipe.to === deviceId) {
                if (pipe.from === deviceId) {
                    const fromDev = this.devices.find(d => d.id === pipe.from);
                    if (fromDev && pipe.points && pipe.points.length > 0) {
                        if (fromDev.type === 'valve' && pipe.fromPin) {
                            const pinLatLng = this.getWaterPinLatLng(pipe.from, pipe.fromPin);
                            if (pinLatLng) {
                                pipe.points[0] = [pinLatLng.lat, pinLatLng.lng];
                            } else {
                                pipe.points[0] = [fromDev.lat, fromDev.lng];
                            }
                        } else {
                            pipe.points[0] = [fromDev.lat, fromDev.lng];
                        }
                    }
                }
                if (pipe.to === deviceId) {
                    const toDev = this.devices.find(d => d.id === pipe.to);
                    if (toDev && pipe.points && pipe.points.length > 0) {
                        if (toDev.type === 'valve' && pipe.toPin) {
                            const pinLatLng = this.getWaterPinLatLng(pipe.to, pipe.toPin);
                            if (pinLatLng) {
                                pipe.points[pipe.points.length - 1] = [pinLatLng.lat, pinLatLng.lng];
                            } else {
                                pipe.points[pipe.points.length - 1] = [toDev.lat, toDev.lng];
                            }
                        } else {
                            pipe.points[pipe.points.length - 1] = [toDev.lat, toDev.lng];
                        }
                    }
                }
                if (this.pipeLines[pipe.id] && pipe.points) {
                    this.pipeLines[pipe.id].setLatLngs(pipe.points);
                }
            }
        });
        
        // Ažuriraj slobodne zglobove creva kako bi pratili kretanje u realnom vremenu
        this.updatePipeJointMarkers();
    }
    
    openDeviceCharacteristicsModal(device, marker) {
        // Postavi ID u skriveni input
        document.getElementById('dev-edit-id').value = device.id;
        
        // Popuni osnovna polja
        document.getElementById('dev-name').value = device.name || '';
        document.getElementById('dev-network-id').value = device.arduinoId || '';
        
        // Sakrij sve specifične sekcije za tipove uređaja i generalnu sekciju po potrebi
        document.querySelectorAll('.dev-type-section').forEach(sec => sec.classList.add('d-none'));
        
        const generalSec = document.getElementById('dev-sec-general');
        if (generalSec) {
            if (device.type === 'pump' || device.type === 'valve' || device.type === 'gauge' || device.type === 'flow_meter' || device.type === 'gnc') {
                generalSec.classList.add('d-none');
            } else {
                generalSec.classList.remove('d-none');
            }
        }
        
        // Prikaži odgovarajuću sekciju
        if (device.type === 'pump') {
            document.getElementById('dev-sec-pump').classList.remove('d-none');
            // Popuni polja za pumpu
            const pumpNameInput = document.getElementById('dev-pump-name');
            if (pumpNameInput) {
                pumpNameInput.value = device.name || '';
            }
            const pumpNetworkInput = document.getElementById('dev-pump-network-id');
            if (pumpNetworkInput) {
                pumpNetworkInput.value = device.arduinoId || '';
            }
            const capInput = document.getElementById('dev-pump-capacity');
            if (capInput) {
                capInput.value = (device.properties && device.properties.max_capacity) ? device.properties.max_capacity : '';
            }
            const portPinInput = document.getElementById('dev-pump-port-pin');
            if (portPinInput) {
                portPinInput.value = (device.properties && device.properties.port_pin) ? device.properties.port_pin : '';
            }
            
            // Podesi dugmad na osnovu stanja
            const btnOn = document.getElementById('btn-pump-on');
            const btnOff = document.getElementById('btn-pump-off');
            if (btnOn && btnOff) {
                if (device.status === 'on') {
                    btnOn.style.opacity = '1';
                    btnOff.style.opacity = '0.5';
                } else {
                    btnOn.style.opacity = '0.5';
                    btnOff.style.opacity = '1';
                }
            }
        } else if (device.type === 'valve') {
            document.getElementById('dev-sec-valve').classList.remove('d-none');
            // Popuni polja za ventil
            const valveNameInput = document.getElementById('dev-valve-name');
            if (valveNameInput) {
                valveNameInput.value = device.name || '';
            }
            const valveNetworkInput = document.getElementById('dev-valve-network-id');
            if (valveNetworkInput) {
                valveNetworkInput.value = device.arduinoId || '';
            }
            const promerSelect = document.getElementById('dev-valve-promer');
            if (promerSelect) {
                promerSelect.value = (device.properties && device.properties.promer) ? device.properties.promer : 'DN25';
            }
            const valvePortPinInput = document.getElementById('dev-valve-port-pin');
            if (valvePortPinInput) {
                valvePortPinInput.value = (device.properties && device.properties.port_pin) ? device.properties.port_pin : '';
            }
            
            // Podesi dugmad na osnovu stanja
            const btnOpen = document.getElementById('btn-valve-open');
            const btnClose = document.getElementById('btn-valve-close');
            if (btnOpen && btnClose) {
                if (device.status === 'open') {
                    btnOpen.style.opacity = '1';
                    btnClose.style.opacity = '0.5';
                } else {
                    btnOpen.style.opacity = '0.5';
                    btnClose.style.opacity = '1';
                }
            }
        } else if (device.type === 'gauge' || device.type === 'flow_meter') {
            document.getElementById('dev-sec-sensor').classList.remove('d-none');
            
            // Popuni polja za senzor
            const sensorNameInput = document.getElementById('dev-sensor-name');
            if (sensorNameInput) {
                sensorNameInput.value = device.name || '';
            }
            const sensorNetworkInput = document.getElementById('dev-sensor-network-id');
            if (sensorNetworkInput) {
                sensorNetworkInput.value = device.arduinoId || '';
            }
            const sensorPortPinInput = document.getElementById('dev-sensor-port-pin');
            if (sensorPortPinInput) {
                sensorPortPinInput.value = (device.properties && device.properties.port_pin) ? device.properties.port_pin : '';
            }

            // Popuni tip senzora
            const sensorType = (device.properties && device.properties.sensor_type) ? device.properties.sensor_type : 'pulse';
            const radioEl = document.getElementById(`sens-type-${sensorType === '4_20ma' ? '420' : sensorType}`);
            if (radioEl) {
                radioEl.checked = true;
            }
            
            // Popuni formulu
            const formulaInput = document.getElementById('dev-sensor-formula');
            if (formulaInput) {
                formulaInput.value = (device.properties && device.properties.transfer_function) ? device.properties.transfer_function : '';
            }
            
            // Prikaži/sakrij dugme za analogni sat
            const gaugeBtnContainer = document.getElementById('sensor-analog-gauge-container');
            if (gaugeBtnContainer) {
                if (!this.isEditMode) {
                    gaugeBtnContainer.classList.remove('d-none');
                } else {
                    gaugeBtnContainer.classList.add('d-none');
                }
            }

            // Zadatak 5: pri postavljanju meraca pritiska u drugi red postavi i polje za unos maksimalnog pritiska
            const colNetwork = document.getElementById('col-sensor-network-id');
            const colPortPin = document.getElementById('col-sensor-port-pin');
            const colMaxPressure = document.getElementById('col-sensor-max-pressure');
            const maxPressureInput = document.getElementById('dev-sensor-max-pressure');

            if (device.type === 'gauge') {
                if (colMaxPressure) colMaxPressure.classList.remove('d-none');
                if (colNetwork) {
                    colNetwork.className = 'col-4 mb-3';
                }
                if (colPortPin) {
                    colPortPin.className = 'col-4 mb-3';
                }
                if (maxPressureInput) {
                    maxPressureInput.value = (device.properties && device.properties.max_pressure) ? device.properties.max_pressure : '10.0';
                }
            } else {
                if (colMaxPressure) colMaxPressure.classList.add('d-none');
                if (colNetwork) {
                    colNetwork.className = 'col-6 mb-3';
                }
                if (colPortPin) {
                    colPortPin.className = 'col-6 mb-3';
                }
            }
        } else if (device.type === 'gnc') {
            const gncSec = document.getElementById('dev-sec-gnc');
            if (gncSec) gncSec.classList.remove('d-none');
            
            const gncNameInput = document.getElementById('dev-gnc-name');
            if (gncNameInput) {
                gncNameInput.value = device.name || '';
            }
            const gncNetworkInput = document.getElementById('dev-gnc-network-id');
            if (gncNetworkInput) {
                gncNetworkInput.value = device.arduinoId || '';
            }
            const gncModelSelect = document.getElementById('dev-gnc-model');
            if (gncModelSelect) {
                const modelVal = friendlyGncModel(device.properties && device.properties.gnc_model);
                gncModelSelect.value = modelVal;
            }
            const gncPortPinInput = document.getElementById('dev-gnc-port-pin');
            if (gncPortPinInput) {
                gncPortPinInput.value = (device.properties && device.properties.port_pin) ? device.properties.port_pin : '';
            }
            const gncLogicInput = document.getElementById('dev-gnc-logic');
            if (gncLogicInput) {
                gncLogicInput.value = (device.properties && device.properties.gnc_logic) ? device.properties.gnc_logic : '';
            }
            const rememberPosEl = document.getElementById('dev-gnc-remember-position');
            if (rememberPosEl) {
                rememberPosEl.checked = (device.properties && device.properties.remember_position) ? true : false;
            }
        }
        
        // Podesi interaktivnost zavisno od Edit / Run režima
        const btnDelete = document.getElementById('btn-dev-delete');
        const btnSave = document.getElementById('btn-dev-save');
        
        const inputs = [
            document.getElementById('dev-name'),
            document.getElementById('dev-network-id'),
            document.getElementById('dev-pump-name'),
            document.getElementById('dev-pump-network-id'),
            document.getElementById('dev-pump-capacity'),
            document.getElementById('dev-pump-port-pin'),
            document.getElementById('dev-valve-name'),
            document.getElementById('dev-valve-network-id'),
            document.getElementById('dev-valve-promer'),
            document.getElementById('dev-valve-port-pin'),
            document.getElementById('dev-sensor-name'),
            document.getElementById('dev-sensor-network-id'),
            document.getElementById('dev-sensor-port-pin'),
            document.getElementById('dev-sensor-formula'),
            document.getElementById('dev-gnc-name'),
            document.getElementById('dev-gnc-network-id'),
            document.getElementById('dev-gnc-model'),
            document.getElementById('dev-gnc-port-pin'),
            document.getElementById('dev-gnc-logic'),
            document.getElementById('dev-gnc-remember-position')
        ];
        const radios = document.querySelectorAll('input[name="sensor_type"]');
        
        if (this.isEditMode) {
            // Edit režim: omogući polja, prikaži snimi/ukloni, onemogući manuelnu kontrolu
            inputs.forEach(inp => { if (inp) inp.disabled = false; });
            radios.forEach(rad => rad.disabled = false);
            
            if (btnDelete) btnDelete.classList.remove('d-none');
            if (btnSave) btnSave.classList.remove('d-none');
            
            const btnPumpOn = document.getElementById('btn-pump-on');
            const btnPumpOff = document.getElementById('btn-pump-off');
            const btnValveOpen = document.getElementById('btn-valve-open');
            const btnValveClose = document.getElementById('btn-valve-close');
            if (btnPumpOn) btnPumpOn.disabled = false;
            if (btnPumpOff) btnPumpOff.disabled = false;
            if (btnValveOpen) btnValveOpen.disabled = false;
            if (btnValveClose) btnValveClose.disabled = false;
        } else {
            // Run režim: onemogući polja, sakrij snimi/ukloni, omogući kontrolne tastere
            inputs.forEach(inp => { if (inp) inp.disabled = true; });
            radios.forEach(rad => rad.disabled = true);
            
            if (btnDelete) btnDelete.classList.add('d-none');
            if (btnSave) btnSave.classList.add('d-none');
            
            const btnPumpOn = document.getElementById('btn-pump-on');
            const btnPumpOff = document.getElementById('btn-pump-off');
            const btnValveOpen = document.getElementById('btn-valve-open');
            const btnValveClose = document.getElementById('btn-valve-close');
            if (btnPumpOn) btnPumpOn.disabled = false;
            if (btnPumpOff) btnPumpOff.disabled = false;
            if (btnValveOpen) btnValveOpen.disabled = false;
            if (btnValveClose) btnValveClose.disabled = false;
        }
        
        // Prikaži modal
        const modalEl = document.getElementById('modalUredjajKarakteristike');
        const modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        modalObj.show();
    }
    
    /**
     * Otvara moderni tamni modal sa karakteristikama cevovoda / creva
     */
    openPipeCharacteristicsModal(pipe, polyline) {
        // Postavi ID u skriveni input
        document.getElementById('pipe-edit-id').value = pipe.id;
        
        // Podesi inicijalne vrednosti iz properties
        const properties = pipe.properties || {};
        const category = properties.category || 'main';
        const thickness = properties.thickness || 8;
        const color = properties.color || '#0055ff';
        
        document.getElementById('pipe-category-val').value = category;
        document.getElementById('pipe-thickness-val').value = thickness;
        
        // Selektuj ispravnu karticu kategorije u modalu
        document.querySelectorAll('.pipe-category-option').forEach(el => {
            el.classList.remove('selected');
            if (el.getAttribute('data-category') === category) {
                el.classList.add('selected');
            }
        });
        
        // Postavi boju u picker-u
        const colorPicker = document.getElementById('pipe-color-picker');
        if (colorPicker) {
            colorPicker.value = color;
        }
        
        // Podesi interaktivnost zavisno od Edit / Run režima
        const btnDelete = document.getElementById('btn-pipe-delete');
        const btnSave = document.getElementById('btn-pipe-save');
        const btnEditGeom = document.getElementById('btn-pipe-edit-geometry');
        
        if (this.isEditMode) {
            if (btnDelete) btnDelete.classList.remove('d-none');
            if (btnSave) btnSave.classList.remove('d-none');
            if (btnEditGeom) btnEditGeom.classList.remove('d-none');
            if (colorPicker) colorPicker.disabled = false;
            document.querySelectorAll('.pipe-category-option').forEach(el => {
                el.style.pointerEvents = 'auto';
                el.style.opacity = '1';
            });
        } else {
            if (btnDelete) btnDelete.classList.add('d-none');
            if (btnSave) btnSave.classList.add('d-none');
            if (btnEditGeom) btnEditGeom.classList.add('d-none');
            if (colorPicker) colorPicker.disabled = true;
            document.querySelectorAll('.pipe-category-option').forEach(el => {
                el.style.pointerEvents = 'none';
                el.style.opacity = '0.7';
            });
        }
        
        // Prikaži modal
        const modalEl = document.getElementById('modalCrevoKarakteristike');
        const modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        modalObj.show();
    }

    /**
     * Čisti aktivnu sesiju izmene geometrije creva (uklanja edit liniju i vertex markere)
     */
    ocistiIzmenuGeometrijeCreva(save = false) {
        if (this.geomEditPoly) {
            this.map.removeLayer(this.geomEditPoly);
            this.geomEditPoly = null;
        }
        if (this.geomEditMarkerSloj) {
            this.geomEditMarkerSloj.clearLayers();
            this.map.removeLayer(this.geomEditMarkerSloj);
            this.geomEditMarkerSloj = null;
        }
        const panel = document.getElementById('pipe-geom-edit-panel');
        if (panel) panel.classList.remove('show');
        
        if (window.snapManager && window.snapManager.snapIndicator) {
            this.map.removeLayer(window.snapManager.snapIndicator);
        }
        
        if (this.aktivnoUredjivanjeCreva) {
            const { pipe, originalPoints, originalFrom, originalTo, connectedPipesOriginalPoints } = this.aktivnoUredjivanjeCreva;
            if (!save) {
                // Ako ne snimamo, vrati originale
                pipe.points = JSON.parse(JSON.stringify(originalPoints));
                pipe.from = originalFrom;
                pipe.to = originalTo;

                // Restauracija originalnih koordinata povezanih creva
                if (connectedPipesOriginalPoints) {
                    Object.entries(connectedPipesOriginalPoints).forEach(([connPipeId, origPts]) => {
                        const connPipe = this.pipes.find(p => p.id === connPipeId);
                        if (connPipe) {
                            connPipe.points = JSON.parse(JSON.stringify(origPts));
                            const connPoly = this.pipeLines[connPipeId];
                            if (connPoly) {
                                connPoly.setLatLngs(connPipe.points);
                            }
                        }
                    });
                }
                
                // Ponovo iscrtaj originalnu poliliniju creva ako postoji
                const polyline = this.pipeLines[pipe.id];
                if (polyline) {
                    if (this.pipesLayer) {
                        this.pipesLayer.addLayer(polyline);
                    } else {
                        polyline.addTo(this.map);
                    }
                } else {
                    this.drawPipeLine(pipe);
                }
            } else {
                // Ako snimamo, ukloni staru poliliniju jer se njene koordinate menjaju
                const polyline = this.pipeLines[pipe.id];
                if (polyline) {
                    if (this.pipesLayer) {
                        this.pipesLayer.removeLayer(polyline);
                    } else {
                        this.map.removeLayer(polyline);
                    }
                    delete this.pipeLines[pipe.id];
                }
                // Iscrtaj ponovo crevo sa novom geometrijom
                this.drawPipeLine(pipe);
            }
            
            this.aktivnoUredjivanjeCreva = null;
        }

        if (this.pipeJointsLayer && !this.map.hasLayer(this.pipeJointsLayer)) {
            this.pipeJointsLayer.addTo(this.map);
        }
        
        this.updatePipeJointMarkers();
    }

    /**
     * Spaja sva creva koja su povezana "tačka na tačku" (slobodni krajevi) u jedan objekat (polyline).
     */
    spojiPovezanaCreva() {
        if (!this.pipes || this.pipes.length < 2) return;

        let mergedAny = true;
        const areEqual = (c1, c2) => {
            if (!c1 || !c2) return false;
            const lat1 = Array.isArray(c1) ? c1[0] : (c1.lat !== undefined ? c1.lat : null);
            const lng1 = Array.isArray(c1) ? c1[1] : (c1.lng !== undefined ? c1.lng : null);
            const lat2 = Array.isArray(c2) ? c2[0] : (c2.lat !== undefined ? c2.lat : null);
            const lng2 = Array.isArray(c2) ? c2[1] : (c2.lng !== undefined ? c2.lng : null);
            
            if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) return false;
            return Math.abs(lat1 - lat2) < 1e-5 && Math.abs(lng1 - lng2) < 1e-5;
        };

        while (mergedAny) {
            mergedAny = false;
            
            for (let i = 0; i < this.pipes.length; i++) {
                const pipeA = this.pipes[i];
                if (!pipeA.points || pipeA.points.length < 2) continue;
                
                const ptAStart = pipeA.points[0];
                const ptAEnd = pipeA.points[pipeA.points.length - 1];

                for (let j = i + 1; j < this.pipes.length; j++) {
                    const pipeB = this.pipes[j];
                    if (!pipeB.points || pipeB.points.length < 2) continue;
                    
                    const ptBStart = pipeB.points[0];
                    const ptBEnd = pipeB.points[pipeB.points.length - 1];

                    let merged = false;

                    // Slučaj 1: Kraj A se spaja sa Početkom B
                    if (areEqual(ptAEnd, ptBStart)) {
                        if (!pipeA.to || !pipeB.from || pipeA.to === pipeB.from) {
                            pipeA.points = pipeA.points.concat(pipeB.points.slice(1));
                            pipeA.to = pipeB.to;
                            pipeA.toPin = pipeB.toPin;
                            merged = true;
                        }
                    }
                    // Slučaj 2: Početak A se spaja sa Krajem B
                    else if (areEqual(ptAStart, ptBEnd)) {
                        if (!pipeA.from || !pipeB.to || pipeA.from === pipeB.to) {
                            pipeA.points = pipeB.points.slice(0, -1).concat(pipeA.points);
                            pipeA.from = pipeB.from;
                            pipeA.fromPin = pipeB.fromPin;
                            merged = true;
                        }
                    }
                    // Slučaj 3: Kraj A se spaja sa Krajem B
                    else if (areEqual(ptAEnd, ptBEnd)) {
                        if (!pipeA.to || !pipeB.to || pipeA.to === pipeB.to) {
                            const reversedB = [...pipeB.points].reverse();
                            pipeA.points = pipeA.points.concat(reversedB.slice(1));
                            pipeA.to = pipeB.from;
                            pipeA.toPin = pipeB.fromPin;
                            merged = true;
                        }
                    }
                    // Slučaj 4: Početak A se spaja sa Početkom B
                    else if (areEqual(ptAStart, ptBStart)) {
                        if (!pipeA.from || !pipeB.from || pipeA.from === pipeB.from) {
                            const reversedB = [...pipeB.points].reverse();
                            pipeA.points = reversedB.slice(0, -1).concat(pipeA.points);
                            pipeA.from = pipeB.to;
                            pipeA.fromPin = pipeB.toPin;
                            merged = true;
                        }
                    }

                    if (merged) {
                        // Sačuvaj preostala svojstva (debljina, boja) ako ih A nema, a B ih ima
                        if (pipeB.properties && (!pipeA.properties || Object.keys(pipeA.properties).length === 0)) {
                            pipeA.properties = pipeB.properties;
                        }
                        
                        // Ukloni staru liniju B sa mape
                        const polylineB = this.pipeLines[pipeB.id];
                        if (polylineB) {
                            if (this.pipesLayer) {
                                this.pipesLayer.removeLayer(polylineB);
                            } else {
                                this.map.removeLayer(polylineB);
                            }
                            delete this.pipeLines[pipeB.id];
                        }

                        // Ukloni pipeB iz niza
                        this.pipes.splice(j, 1);
                        mergedAny = true;
                        break;
                    }
                }
                
                if (mergedAny) {
                    break;
                }
            }
        }

        // Nakon svih spajanja, ponovo iscrtaj sve linije i osveži spojeve
        this.pipes.forEach(pipe => {
            const polyline = this.pipeLines[pipe.id];
            if (polyline) {
                if (this.pipesLayer) {
                    this.pipesLayer.removeLayer(polyline);
                } else {
                    this.map.removeLayer(polyline);
                }
                delete this.pipeLines[pipe.id];
            }
            this.drawPipeLine(pipe);
        });

        this.updatePipeJointMarkers();
    }

    /**
     * Pokreće režim interaktivne izmene geometrije (krajeva) creva na mapi
     */
    pokreniIzmenuGeometrijeCreva(pipe) {
        // Sakrij sve druge alate u bočnom panelu
        this.selectTool(null);

        // Prethodno očisti ako već postoji aktivna sesija izmene (da ne bi došlo do curenja)
        this.ocistiIzmenuGeometrijeCreva(false);

        const panel = document.getElementById('pipe-geom-edit-panel');
        const nameDisplay = document.getElementById('pipe-geom-edit-name-display');
        if (panel) {
            if (nameDisplay) nameDisplay.textContent = pipe.id;
            panel.classList.add('show');
        }

        // Kopiramo originalne podatke za slučaj ODUSTANI
        const originalPoints = JSON.parse(JSON.stringify(pipe.points));
        const originalFrom = pipe.from;
        const originalTo = pipe.to;

        this.aktivnoUredjivanjeCreva = {
            pipe: pipe,
            originalPoints: originalPoints,
            originalFrom: originalFrom,
            originalTo: originalTo
        };

        // Sakrij originalnu poliliniju creva
        const polyline = this.pipeLines[pipe.id];
        if (polyline) {
            if (this.pipesLayer) {
                this.pipesLayer.removeLayer(polyline);
            } else {
                this.map.removeLayer(polyline);
            }
        }

        // Privremeno sakrij joint markers da ne smetaju
        if (this.pipeJointsLayer) {
            this.map.removeLayer(this.pipeJointsLayer);
        }

        // Određujemo tačne LatLng tačke za početak i kraj na osnovu from/to ili points
        let startLatLng = null;
        let endLatLng = null;

        if (pipe.from) {
            const fromDev = this.devices.find(d => d.id === pipe.from);
            if (fromDev) {
                if (fromDev.type === 'valve' && pipe.fromPin) {
                    startLatLng = this.getWaterPinLatLng(pipe.from, pipe.fromPin);
                } else {
                    startLatLng = L.latLng(fromDev.lat, fromDev.lng);
                }
            }
        }
        if (!startLatLng && pipe.points && pipe.points[0]) {
            startLatLng = L.latLng(pipe.points[0]);
        }

        if (pipe.to) {
            const toDev = this.devices.find(d => d.id === pipe.to);
            if (toDev) {
                if (toDev.type === 'valve' && pipe.toPin) {
                    endLatLng = this.getWaterPinLatLng(pipe.to, pipe.toPin);
                } else {
                    endLatLng = L.latLng(toDev.lat, toDev.lng);
                }
            }
        }
        if (!endLatLng && pipe.points && pipe.points.length > 0 && pipe.points[pipe.points.length - 1]) {
            endLatLng = L.latLng(pipe.points[pipe.points.length - 1]);
        }

        if (!startLatLng || !endLatLng) return;

        // Obezbeđujemo da zadržimo sve međutačke creva tokom uređivanja geometrije
        let trenutneKoordinate = [];
        if (pipe.points && pipe.points.length >= 2) {
            trenutneKoordinate = pipe.points.map(pt => L.latLng(pt[0], pt[1]));
            // Sinhronizujemo krajeve sa povezanim uređajima u slučaju da su se pomerili
            trenutneKoordinate[0] = startLatLng;
            trenutneKoordinate[trenutneKoordinate.length - 1] = endLatLng;
        } else {
            trenutneKoordinate = [startLatLng, endLatLng];
        }

        // Inicijalizacija mape povezanih creva za svaku koordinatu aktivnog creva
        this.aktivnoUredjivanjeCreva.connectedPipesOriginalPoints = {};
        const connectedPipesMap = trenutneKoordinate.map((latlng, idx) => {
            const connections = [];
            for (let otherPipe of this.pipes) {
                if (otherPipe.id === pipe.id) continue;
                if (!otherPipe.points || otherPipe.points.length === 0) continue;
                for (let i = 0; i < otherPipe.points.length; i++) {
                    const pt = L.latLng(otherPipe.points[i]);
                    if (pt.distanceTo(latlng) < 0.1) { // 10 cm tolerancija
                        connections.push({
                            pipeId: otherPipe.id,
                            pointIndex: i
                        });
                        if (!this.aktivnoUredjivanjeCreva.connectedPipesOriginalPoints[otherPipe.id]) {
                            this.aktivnoUredjivanjeCreva.connectedPipesOriginalPoints[otherPipe.id] = JSON.parse(JSON.stringify(otherPipe.points));
                        }
                    }
                }
            }
            return connections;
        });
        this.aktivnoUredjivanjeCreva.connectedPipesMap = connectedPipesMap;

        const properties = pipe.properties || { category: 'main', thickness: 8, color: '#ff8c00' };
        const color = properties.color || '#ff8c00';
        const weight = properties.thickness || 8;

        // Kreiranje privremene isprekidane linije
        this.geomEditPoly = L.polyline(trenutneKoordinate, {
            color: color,
            weight: weight,
            dashArray: '5, 5',
            opacity: 0.8,
            interactive: true
        }).addTo(this.map);

        // Dinamičko dodavanje novog temena na dupli klik na liniju creva
        this.geomEditPoly.on('dblclick', (e) => {
            L.DomEvent.stopPropagation(e);
            if (e.originalEvent) {
                L.DomEvent.stopPropagation(e.originalEvent);
            }
            
            const kliknutaTacka = e.latlng;
            let najbliziSegmentIdx = -1;
            let minProjDist = Infinity;
            let ubaceniLatLng = kliknutaTacka;
            
            const p = this.map.latLngToContainerPoint(kliknutaTacka);
            
            for (let i = 0; i < trenutneKoordinate.length - 1; i++) {
                const pt1 = trenutneKoordinate[i];
                const pt2 = trenutneKoordinate[i+1];
                
                const p1 = this.map.latLngToContainerPoint(pt1);
                const p2 = this.map.latLngToContainerPoint(pt2);
                
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const lenSq = dx * dx + dy * dy;
                if (lenSq === 0) continue;
                
                let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t));
                
                const projX = p1.x + t * dx;
                const projY = p1.y + t * dy;
                const projPoint = L.point(projX, projY);
                const projDist = p.distanceTo(projPoint);
                
                if (projDist < minProjDist) {
                    minProjDist = projDist;
                    najbliziSegmentIdx = i;
                    ubaceniLatLng = this.map.containerPointToLatLng(projPoint);
                }
            }
            
            if (najbliziSegmentIdx !== -1 && minProjDist < 30) { // Tolerancija od 30px na ekranu
                // Ubacujemo novu tačku na pronađenu poziciju
                trenutneKoordinate.splice(najbliziSegmentIdx + 1, 0, ubaceniLatLng);
                if (this.aktivnoUredjivanjeCreva && this.aktivnoUredjivanjeCreva.connectedPipesMap) {
                    this.aktivnoUredjivanjeCreva.connectedPipesMap.splice(najbliziSegmentIdx + 1, 0, []);
                }
                
                // Osvežavamo poliliniju na mapi
                this.geomEditPoly.setLatLngs(trenutneKoordinate);
                
                // Ponovo iscrtavamo markere temena
                iscrtajMarkerTemena();
            }
        });

        this.geomEditMarkerSloj = L.featureGroup().addTo(this.map);

        const iscrtajMarkerTemena = () => {
            this.geomEditMarkerSloj.clearLayers();
            
            // Grupišemo tačke koje imaju istu lokaciju kako bismo izbegli dupliranje markera
            const jedinstveneTacke = [];
            trenutneKoordinate.forEach((latlng, idx) => {
                let found = jedinstveneTacke.find(t => t.latlng.distanceTo(latlng) < 0.1);
                if (found) {
                    found.indices.push(idx);
                } else {
                    jedinstveneTacke.push({ latlng: latlng, indices: [idx] });
                }
            });

            jedinstveneTacke.forEach(tacka => {
                const latlng = tacka.latlng;
                const indices = tacka.indices;
                
                const isStart = indices.includes(0);
                const isEnd = indices.includes(trenutneKoordinate.length - 1);
                const isBoundary = isStart || isEnd;
                
                const color = isBoundary ? '#ff8c00' : '#0055ff';

                const kruzicIcon = L.divIcon({
                    className: 'custom-vertex-marker-edit',
                    html: `<div style="width: 14px; height: 14px; background-color: #ffffff; border: 2.5px solid ${color}; border-radius: 50%; box-shadow: 0 1px 5px rgba(0,0,0,0.5); cursor: move;"></div>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                });

                const marker = L.marker(latlng, {
                    icon: kruzicIcon,
                    draggable: true
                }).addTo(this.geomEditMarkerSloj);

                // Izolacija klikova na markeru (da običan klik i drag ne propagiraju na mapu)
                marker.on('click mousedown dblclick', (e) => {
                    if (e && e.originalEvent) {
                        L.DomEvent.stopPropagation(e.originalEvent);
                    }
                    L.DomEvent.stopPropagation(e);
                });

                marker._originalLatLng = latlng; // Sačuvaj poziciju za poništavanje ako zatreba

                marker.on('contextmenu', (e) => {
                    L.DomEvent.stopPropagation(e);
                    
                    if (trenutneKoordinate.length <= 2) {
                        alert("Crevo mora imati najmanje 2 tačke!");
                        return;
                    }
                    
                    // Pokrećemo Bootstrap modal za potvrdu brisanja
                    const modalEl = document.getElementById('modalObrisiTackuCreva');
                    if (modalEl) {
                        const modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
                        
                        // Konfigurišemo dugme za potvrdu brisanja
                        const confirmBtn = document.getElementById('btn-potvrdi-brisanje-tacke');
                        const newConfirmBtn = confirmBtn.cloneNode(true);
                        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
                        
                        newConfirmBtn.addEventListener('click', () => {
                            // Uklanjamo tačke iz niza (odozada ka napred da ne poremetimo indekse)
                            indices.sort((a, b) => b - a).forEach(idx => {
                                trenutneKoordinate.splice(idx, 1);
                                if (this.aktivnoUredjivanjeCreva && this.aktivnoUredjivanjeCreva.connectedPipesMap) {
                                    this.aktivnoUredjivanjeCreva.connectedPipesMap.splice(idx, 1);
                                }
                            });
                            
                            // Ponovo određujemo from/to povezivanje u slučaju da smo obrisali prvu ili poslednju tačku
                            let fromId = null;
                            let toId = null;
                            let fromPin = null;
                            let toPin = null;
                            
                            const firstPt = trenutneKoordinate[0];
                            const lastPt = trenutneKoordinate[trenutneKoordinate.length - 1];
                            
                            const snappedFrom = this.getSnappedDevicePoint(firstPt);
                            if (snappedFrom) {
                                fromId = snappedFrom.deviceId;
                                fromPin = snappedFrom.pinName;
                                trenutneKoordinate[0] = L.latLng(snappedFrom.lat, snappedFrom.lng);
                            }
                            
                            const snappedTo = this.getSnappedDevicePoint(lastPt);
                            if (snappedTo) {
                                toId = snappedTo.deviceId;
                                toPin = snappedTo.pinName;
                                trenutneKoordinate[trenutneKoordinate.length - 1] = L.latLng(snappedTo.lat, snappedTo.lng);
                            }
                            
                            pipe.from = fromId;
                            pipe.to = toId;
                            pipe.fromPin = fromPin;
                            pipe.toPin = toPin;
                            
                            // Osvežavamo poliliniju na mapi
                            this.geomEditPoly.setLatLngs(trenutneKoordinate);
                            
                            // Ponovo iscrtavamo markere temena
                            iscrtajMarkerTemena();
                            
                            // Sakrij modal
                            modalObj.hide();
                        });
                        
                        modalObj.show();
                    } else {
                        // Fallback na klasični confirm ako modal ne postoji u DOM-u
                        if (confirm("Da li želite da obrišete ovu tačku sa creva za vodu?")) {
                            indices.sort((a, b) => b - a).forEach(idx => {
                                trenutneKoordinate.splice(idx, 1);
                                if (this.aktivnoUredjivanjeCreva && this.aktivnoUredjivanjeCreva.connectedPipesMap) {
                                    this.aktivnoUredjivanjeCreva.connectedPipesMap.splice(idx, 1);
                                }
                            });
                            
                            let fromId = null;
                            let toId = null;
                            let fromPin = null;
                            let toPin = null;
                            
                            const firstPt = trenutneKoordinate[0];
                            const lastPt = trenutneKoordinate[trenutneKoordinate.length - 1];
                            
                            const snappedFrom = this.getSnappedDevicePoint(firstPt);
                            if (snappedFrom) {
                                fromId = snappedFrom.deviceId;
                                fromPin = snappedFrom.pinName;
                                trenutneKoordinate[0] = L.latLng(snappedFrom.lat, snappedFrom.lng);
                            }
                            
                            const snappedTo = this.getSnappedDevicePoint(lastPt);
                            if (snappedTo) {
                                toId = snappedTo.deviceId;
                                toPin = snappedTo.pinName;
                                trenutneKoordinate[trenutneKoordinate.length - 1] = L.latLng(snappedTo.lat, snappedTo.lng);
                            }
                            
                            pipe.from = fromId;
                            pipe.to = toId;
                            pipe.fromPin = fromPin;
                            pipe.toPin = toPin;
                            
                            this.geomEditPoly.setLatLngs(trenutneKoordinate);
                            iscrtajMarkerTemena();
                        }
                    }
                });

                marker.on('drag', (e) => {
                    let noviPos = e.target.getLatLng();
                    let isSnapped = false;

                    if (isBoundary) {
                        const snappedDevice = this.getSnappedDevicePoint(noviPos);
                        const snappedPipe = this.getSnappedPipeEndpoint(noviPos, pipe.id);

                        if (snappedDevice) {
                            noviPos = L.latLng(snappedDevice.lat, snappedDevice.lng);
                            isSnapped = true;
                            if (isStart) {
                                pipe.from = snappedDevice.deviceId;
                                pipe.fromPin = snappedDevice.pinName;
                            }
                            if (isEnd) {
                                pipe.to = snappedDevice.deviceId;
                                pipe.toPin = snappedDevice.pinName;
                            }
                        } else if (snappedPipe) {
                            noviPos = L.latLng(snappedPipe.lat, snappedPipe.lng);
                            isSnapped = true;
                            if (isStart) {
                                pipe.from = null;
                                pipe.fromPin = null;
                            }
                            if (isEnd) {
                                pipe.to = null;
                                pipe.toPin = null;
                            }
                        } else {
                            if (isStart) {
                                pipe.from = null;
                                pipe.fromPin = null;
                            }
                            if (isEnd) {
                                pipe.to = null;
                                pipe.toPin = null;
                            }
                        }
                    } else {
                        if (window.snapManager) {
                            const otherPoints = trenutneKoordinate.filter((_, i) => !indices.includes(i));
                            const snappedResult = window.snapManager.getSnappedResult(noviPos, otherPoints);
                            noviPos = snappedResult.latlng;
                            isSnapped = snappedResult.snapped;
                        }
                    }

                    if (isSnapped && window.snapManager && window.snapManager.snapIndicator) {
                        window.snapManager.snapIndicator.setLatLng(noviPos).addTo(this.map);
                    } else {
                        if (window.snapManager && window.snapManager.snapIndicator) {
                            this.map.removeLayer(window.snapManager.snapIndicator);
                        }
                    }

                    e.target.setLatLng(noviPos);
                    
                    indices.forEach(idx => {
                        trenutneKoordinate[idx] = noviPos;
                        
                        // Real-time ažuriranje povezanih creva
                        if (this.aktivnoUredjivanjeCreva && this.aktivnoUredjivanjeCreva.connectedPipesMap) {
                            const connections = this.aktivnoUredjivanjeCreva.connectedPipesMap[idx];
                            if (connections) {
                                connections.forEach(conn => {
                                    const otherPipe = this.pipes.find(p => p.id === conn.pipeId);
                                    if (otherPipe && otherPipe.points && otherPipe.points[conn.pointIndex]) {
                                        otherPipe.points[conn.pointIndex] = [noviPos.lat, noviPos.lng];
                                        const otherPolyline = this.pipeLines[conn.pipeId];
                                        if (otherPolyline) {
                                            otherPolyline.setLatLngs(otherPipe.points);
                                        }
                                    }
                                });
                            }
                        }
                    });
                    
                    this.geomEditPoly.setLatLngs(trenutneKoordinate);
                });

                marker.on('dragend', (e) => {
                    let finalPos = e.target.getLatLng();
                    let isSnapped = false;

                    if (isBoundary) {
                        const snappedDevice = this.getSnappedDevicePoint(finalPos);
                        const snappedPipe = this.getSnappedPipeEndpoint(finalPos, pipe.id);

                        if (snappedDevice) {
                            finalPos = L.latLng(snappedDevice.lat, snappedDevice.lng);
                            isSnapped = true;
                            if (isStart) {
                                pipe.from = snappedDevice.deviceId;
                                pipe.fromPin = snappedDevice.pinName;
                            }
                            if (isEnd) {
                                pipe.to = snappedDevice.deviceId;
                                pipe.toPin = snappedDevice.pinName;
                            }
                        } else if (snappedPipe) {
                            finalPos = L.latLng(snappedPipe.lat, snappedPipe.lng);
                            isSnapped = true;
                            if (isStart) {
                                pipe.from = null;
                                pipe.fromPin = null;
                            }
                            if (isEnd) {
                                pipe.to = null;
                                pipe.toPin = null;
                            }
                        } else {
                            if (isStart) {
                                pipe.from = null;
                                pipe.fromPin = null;
                            }
                            if (isEnd) {
                                pipe.to = null;
                                pipe.toPin = null;
                            }
                        }
                    } else {
                        if (window.snapManager) {
                            const otherPoints = trenutneKoordinate.filter((_, i) => !indices.includes(i));
                            const snappedResult = window.snapManager.getSnappedResult(finalPos, otherPoints);
                            finalPos = snappedResult.latlng;
                            isSnapped = snappedResult.snapped;
                        }
                    }

                    e.target.setLatLng(finalPos);
                    
                    indices.forEach(idx => {
                        trenutneKoordinate[idx] = finalPos;

                        // Ažuriranje povezanih creva na finalnu (eventualno snepovanu) poziciju
                        if (this.aktivnoUredjivanjeCreva && this.aktivnoUredjivanjeCreva.connectedPipesMap) {
                            const connections = this.aktivnoUredjivanjeCreva.connectedPipesMap[idx];
                            if (connections) {
                                connections.forEach(conn => {
                                    const otherPipe = this.pipes.find(p => p.id === conn.pipeId);
                                    if (otherPipe && otherPipe.points && otherPipe.points[conn.pointIndex]) {
                                        otherPipe.points[conn.pointIndex] = [finalPos.lat, finalPos.lng];
                                        const otherPolyline = this.pipeLines[conn.pipeId];
                                        if (otherPolyline) {
                                            otherPolyline.setLatLngs(otherPipe.points);
                                        }
                                    }
                                });
                            }
                        }
                    });
                    
                    this.geomEditPoly.setLatLngs(trenutneKoordinate);

                    if (window.snapManager && window.snapManager.snapIndicator) {
                        this.map.removeLayer(window.snapManager.snapIndicator);
                    }

                    // Provera preklapanja sa ostalim temenima (manje od 1 metar)
                    let mergeWithIdx = -1;
                    let targetIdxToRemove = -1;
                    for (let j = 0; j < indices.length; j++) {
                        let currentIdx = indices[j];
                        for (let i = 0; i < trenutneKoordinate.length; i++) {
                            if (indices.includes(i)) continue;
                            const dist = this.map.distance(finalPos, trenutneKoordinate[i]);
                            if (dist < 1.0) {
                                mergeWithIdx = i;
                                targetIdxToRemove = currentIdx;
                                break;
                            }
                        }
                        if (mergeWithIdx !== -1) break;
                    }

                    if (mergeWithIdx !== -1 && targetIdxToRemove !== -1) {
                        if (trenutneKoordinate.length > 2) {
                            console.log(`Preklapanje detektovano na crevu: uklanja se teme na indeksu ${targetIdxToRemove}`);
                            
                            trenutneKoordinate.splice(targetIdxToRemove, 1);
                            if (this.aktivnoUredjivanjeCreva && this.aktivnoUredjivanjeCreva.connectedPipesMap) {
                                this.aktivnoUredjivanjeCreva.connectedPipesMap.splice(targetIdxToRemove, 1);
                            }
                            
                            // Re-evaluacija from i to za novo prve/poslednje teme
                            let fromId = null;
                            let toId = null;
                            let fromPin = null;
                            let toPin = null;
                            
                            const firstPt = trenutneKoordinate[0];
                            const lastPt = trenutneKoordinate[trenutneKoordinate.length - 1];
                            
                            const snappedFrom = this.getSnappedDevicePoint(firstPt);
                            if (snappedFrom) {
                                fromId = snappedFrom.deviceId;
                                fromPin = snappedFrom.pinName;
                                trenutneKoordinate[0] = L.latLng(snappedFrom.lat, snappedFrom.lng);
                            }
                            
                            const snappedTo = this.getSnappedDevicePoint(lastPt);
                            if (snappedTo) {
                                toId = snappedTo.deviceId;
                                toPin = snappedTo.pinName;
                                trenutneKoordinate[trenutneKoordinate.length - 1] = L.latLng(snappedTo.lat, snappedTo.lng);
                            }
                            
                            pipe.from = fromId;
                            pipe.to = toId;
                            pipe.fromPin = fromPin;
                            pipe.toPin = toPin;

                            this.geomEditPoly.setLatLngs(trenutneKoordinate);
                            
                            // Ponovo iscrtaj markere sa novim indeksima
                            iscrtajMarkerTemena();
                        } else {
                            if (marker._originalLatLng) {
                                marker.setLatLng(marker._originalLatLng);
                                trenutneKoordinate[idx] = marker._originalLatLng;
                                this.geomEditPoly.setLatLngs(trenutneKoordinate);
                            }
                        }
                    }
                });
            });
        };

        iscrtajMarkerTemena();

        const btnCancel = document.getElementById('btn-pipe-geom-cancel');
        const btnSave = document.getElementById('btn-pipe-geom-save');

        const noviBtnCancel = btnCancel.cloneNode(true);
        btnCancel.parentNode.replaceChild(noviBtnCancel, btnCancel);
        noviBtnCancel.addEventListener('click', () => {
            this.ocistiIzmenuGeometrijeCreva(false);
        });

        const noviBtnSave = btnSave.cloneNode(true);
        btnSave.parentNode.replaceChild(noviBtnSave, btnSave);
        noviBtnSave.addEventListener('click', () => {
            // Prvo dodelimo trenutne koordinate crevu koje se uređuje
            pipe.points = trenutneKoordinate.map(latlng => [latlng.lat, latlng.lng]);

            // Pozivamo standardno čišćenje sa čuvanjem (koje će ponovo iscrtati pipe sa novim koordinatama)
            this.ocistiIzmenuGeometrijeCreva(true);

            // SNEPOVANJE NA POSTOJEĆE CREVO (RAČVANJE / BRANCHING) nakon što su koordinate sačuvane
            if (pipe.points && pipe.points.length >= 2) {
                const firstPt = L.latLng(pipe.points[0]);
                const lastPt = L.latLng(pipe.points[pipe.points.length - 1]);
                
                let match = this.findPipeVertex(firstPt, pipe.id);
                let isReversed = false;
                
                if (!match) {
                    const edgeMatch = this.findPipeEdgeSegment(firstPt, pipe.id);
                    if (edgeMatch) {
                        const pipePoints = edgeMatch.pipe.points;
                        pipePoints.splice(edgeMatch.index + 1, 0, [firstPt.lat, firstPt.lng]);
                        match = { pipe: edgeMatch.pipe, index: edgeMatch.index + 1 };
                    }
                }
                
                if (!match) {
                    const endMatchVertex = this.findPipeVertex(lastPt, pipe.id);
                    if (endMatchVertex) {
                        match = endMatchVertex;
                        isReversed = true;
                    } else {
                        const endMatchEdge = this.findPipeEdgeSegment(lastPt, pipe.id);
                        if (endMatchEdge) {
                            const pipePoints = endMatchEdge.pipe.points;
                            pipePoints.splice(endMatchEdge.index + 1, 0, [lastPt.lat, lastPt.lng]);
                            match = { pipe: endMatchEdge.pipe, index: endMatchEdge.index + 1 };
                            isReversed = true;
                        }
                    }
                }

                if (match) {
                    // Samo osvežavamo match.pipe jer je u njemu dodato teme (ako je snepovano na ivicu)
                    const polyline = this.pipeLines[match.pipe.id];
                    if (polyline) {
                        if (this.pipesLayer) {
                            this.pipesLayer.removeLayer(polyline);
                        } else {
                            this.map.removeLayer(polyline);
                        }
                        delete this.pipeLines[match.pipe.id];
                    }
                    
                    // Ponovo iscrtavamo ciljno crevo
                    this.drawPipeLine(match.pipe);
                }
            }

            this.spojiPovezanaCreva();
            this.saveLayout();
        });
    }
    
    /**
     * Šalje nalog pumpi preko UDP Gateway-a na Python serveru
     */
    async sendPumpCommandPhysical(device, state) {
        const cmdValue = state === 'on' ? 'PUMP:1' : 'PUMP:0';
        
        if (!device.arduinoId) {
            this.addNetworkLog(`[MOCK RELAY] ${device.name} preklopljen u ${state.toUpperCase()} (Nema IP adrese)`, 'success');
            return;
        }

        const parts = device.arduinoId.split(':');
        const ip = parts[0];
        const port = parts[1] || '8888';

        this.addNetworkLog(`UDP slanje ka ${device.name} (${ip}:${port}): '${cmdValue}'...`, 'sending');

        try {
            const response = await fetch('/api/udp-relay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ip: ip,
                    port: parseInt(port),
                    msg: cmdValue,
                    wait_response: true
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.response && data.response !== 'TIMEOUT') {
                    this.addNetworkLog(`UDP potvrda od pumpe: '${data.response}'`, 'success');
                } else {
                    throw new Error(data.response || "TIMEOUT");
                }
            } else {
                throw new Error(`Gateway vratio status ${response.status}`);
            }
        } catch (err) {
            console.warn(`[MOCK PUMP] Konekcija ka ${device.name} simulirana.`, err.message);
            this.addNetworkLog(`[MOCK RELAY] ${device.name} -> ${state.toUpperCase()} (Simulirano)`, 'success');
        }
    }
    
    /**
     * Serijalizuje i čuva raspored svih postavljenih elemenata u localStorage i na RPi disk (bekend)
     */
    async saveLayout() {
        const layout = {
            devices: this.devices,
            pipes: this.pipes,
            scenarios: this.scenarios,
            wiring: this.wiring
        };
        
        // 1. Čuvamo u localStorage kao rezerva
        localStorage.setItem('irigacija_layout_v1', JSON.stringify(layout));
        
        // 2. Šaljemo na RPi bekend (zvanični Python server preko /api/ ruta)
        try {
            const response = await fetch('/api/layout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(layout)
            });

            if (response.ok) {
                console.log("Raspored uspešno sačuvan na RPi disku.");
                return true;
            } else {
                console.warn("Bekend vratio grešku pri čuvanju.");
                return false;
            }
        } catch (err) {
            console.warn("RPi bekend nije dostupan za čuvanje (offline fallback):", err.message);
            return false;
        }
    }
    
    /**
     * Učitava i rekonstruiše raspored elemenata sa RPi bekenda sa fallback-om na localStorage
     */
    /**
     * Rekonstruiše uređaj iz sačuvanih (plain) JSON podataka u instancu
     * odgovarajuće komponente preko centralnog registra.
     */
    instancirajUredjaj(dev) {
        if (dev && ComponentRegistry.has(dev.type)) {
            return ComponentRegistry.create(dev.type, dev);
        }
        console.warn('Nepoznat tip uređaja pri učitavanju, zadržavam kao običan objekat:', dev && dev.type);
        return dev;
    }

    async loadLayout() {
        let loaded = false;
        let layout = null;

        // 1. Pokušaj sa bekenda
        try {
            const response = await fetch('/api/layout');

            if (response.ok) {
                layout = await response.json();
                console.log("Raspored uspešno učitan sa RPi bekenda.");
                loaded = true;
            }
        } catch (err) {
            console.warn("Nije uspelo učitavanje sa RPi bekenda, prelazi se na localStorage:", err.message);
        }

        // 2. Fallback na localStorage
        if (!loaded) {
            const raw = localStorage.getItem('irigacija_layout_v1');
            if (raw) {
                try {
                    layout = JSON.parse(raw);
                    console.log("Raspored učitan iz lokalne memorije pretraživača (localStorage).");
                    loaded = true;
                } catch (e) {
                    console.error("Greška pri parsiranju localStorage šeme:", e);
                }
            }
        }

        if (loaded && layout) {
            this.clearCurrentLayout();
            this.devices = (layout.devices || []).filter(dev => dev.type !== 'wire').map(dev => this.instancirajUredjaj(dev));
            this.pipes = layout.pipes || [];
            this.scenarios = layout.scenarios || [];
            this.wiring = layout.wiring || [];
            
            this.rebuildVisualLayout();
            this.refreshScenarioDropdown();
            console.log(`Vizuelizovano: ${this.devices.length} uređaja, ${this.pipes.length} creva.`);
            
            if (window.fitSystemBounds) {
                window.fitSystemBounds();
            }
        }
    }

    /**
     * Briše sve elemente sa mape
     */
    clearCurrentLayout() {
        if (this.devicesLayer) {
            this.devicesLayer.clearLayers();
        } else {
            Object.values(this.deviceMarkers).forEach(marker => {
                this.map.removeLayer(marker);
            });
        }
        this.deviceMarkers = {};

        if (this.pipesLayer) {
            this.pipesLayer.clearLayers();
        } else {
            Object.values(this.pipeLines).forEach(line => {
                this.map.removeLayer(line);
            });
        }
        this.pipeLines = {};

        if (this.pipeJointsLayer) {
            this.pipeJointsLayer.clearLayers();
        }

        // Ukloni sve iscrtane kablove elektroožičenja
        if (this.wireLayers) {
            Object.values(this.wireLayers).forEach(layers => {
                layers.forEach(layer => this.map.removeLayer(layer));
            });
            this.wireLayers = {};
        }
        this.wiring = [];

        this.devices = [];
        this.pipes = [];
    }

    /**
     * Iscrtava učitane elemente na mapi
     */
    rebuildVisualLayout() {
        this.devices.forEach(device => {
            this.createDeviceMarker(device);
        });
        this.pipes.forEach(pipe => {
            this.drawPipeLine(pipe);
        });
        this.updatePipeJointMarkers();
        this.updateAllWires();
        this.updateAllPipes();
    }

    /**
     * Preuzima šemu kao JSON fajl
     */
    exportLayoutToJson() {
        const layout = {
            devices: this.devices,
            pipes: this.pipes,
            scenarios: this.scenarios,
            wiring: this.wiring
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(layout, null, 4));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "irigacija_raspored.json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        console.log("Raspored izvezen u JSON.");
    }

    /**
     * Uvozi šemu iz JSON fajla preko pretraživača
     */
    importLayoutFromJson(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const layout = JSON.parse(event.target.result);
                if (!layout.devices || !layout.pipes) {
                    throw new Error("Fajl nema ispravnu strukturu uređaja i veza.");
                }

                if (confirm("Da li želite da učitate izabrani raspored? Trenutna šema će biti prebrisana.")) {
                    this.clearCurrentLayout();
                    this.devices = (layout.devices || []).filter(dev => dev.type !== 'wire').map(dev => this.instancirajUredjaj(dev));
                    this.pipes = layout.pipes;
                    this.scenarios = layout.scenarios || [];
                    this.wiring = layout.wiring || [];

                    this.rebuildVisualLayout();
                    this.refreshScenarioDropdown();
                    await this.saveLayout();
                    alert("Raspored je uspešno uvezen!");
                }
            } catch (err) {
                alert("Greška pri čitanju fajla: " + err.message);
            }
            e.target.value = ''; // reset
        };
        reader.readAsText(file);
    }

    /**
     * Dodaje unos u mrežni monitor na dnu stranice
     */
    addNetworkLog(text, type = '') {
        const logsContainer = document.getElementById('monitor-logs');
        if (!logsContainer) return;

        const time = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${time}] ${text}`;
        
        logsContainer.appendChild(entry);
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    /**
     * Čisti konzolu mrežnog monitora
     */
    clearNetworkLogs() {
        const logsContainer = document.getElementById('monitor-logs');
        if (logsContainer) {
            logsContainer.innerHTML = '<div class="log-entry system">[SISTEM] Monitor očišćen. Slušam aktivnosti...</div>';
        }
    }

    /**
     * Pokreće anketiranje senzora u Run modu
     */
    startSensorPolling() {
        this.stopSensorPolling();
        this.pollingInterval = setInterval(() => {
            this.pollSensorsPhysical();
        }, 5000);
        this.pollSensorsPhysical(); // okini odmah
    }

    /**
     * Zaustavlja anketiranje
     */
    stopSensorPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * Periodično ispituje Arduine preko UDP Gateway-a na Python serveru
     */
    async pollSensorsPhysical() {
        const sensors = this.devices.filter(d => d.type === 'gauge' || d.type === 'pump' || d.type === 'flow_meter');
        
        if (sensors.length === 0) {
            this.simulateOfflineFlowsAndDashboard();
            return;
        }

        let flowMeterPolled = false;

        for (const sensor of sensors) {
            if (!sensor.arduinoId) {
                this.handleSimulatedSensorReading(sensor);
                if (sensor.type === 'flow_meter') flowMeterPolled = true;
                continue;
            }

            const parts = sensor.arduinoId.split(':');
            const ip = parts[0];
            const port = parts[1] || '8888';
            
            let msg = 'GET_STATUS';
            if (sensor.type === 'gauge') {
                msg = 'GET_PRESSURE';
            } else if (sensor.type === 'flow_meter') {
                msg = sensor.sensorType === 'analog' ? 'GET_FLOW' : 'GET_PULSES';
            }

            this.addNetworkLog(`UDP upit ka ${sensor.name} (${ip}:${port}): '${msg}'...`, 'sending');

            try {
                const response = await fetch(`/api/udp-relay?ip=${ip}&port=${port}&msg=${msg}&wait_response=true`);
                
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data.success && data.response && data.response !== 'TIMEOUT') {
                        const odgovor = data.response;
                        this.addNetworkLog(`UDP odgovor od ${sensor.name}: '${odgovor}'`, 'success');
                        
                        if (sensor.type === 'gauge') {
                            const val = parseFloat(odgovor) || 0.0;
                            sensor.lastValue = val;
                            this.updateDeviceVisualValue(sensor, `${val.toFixed(2)} bar`);
                            if (this.activeGaugeDevice && this.activeGaugeDevice.id === sensor.id) {
                                this.updateGaugeModalValue();
                            }
                        } else if (sensor.type === 'flow_meter') {
                            flowMeterPolled = true;
                            if (sensor.sensorType === 'analog') {
                                const flowRate = parseFloat(odgovor) || 0.0;
                                sensor.lastValue = flowRate;
                                this.updateDeviceVisualValue(sensor, `${flowRate.toFixed(1)} L/min`);
                                
                                const addedL = flowRate * (5.0 / 60.0);
                                this.totalWaterConsumption += addedL;
                                localStorage.setItem('irigacija_total_consumption', this.totalWaterConsumption);
                            } else {
                                const pulses = parseInt(odgovor, 10) || 0;
                                const addedL = pulses * (sensor.calibrationStep || 0.0022);
                                this.totalWaterConsumption += addedL;
                                localStorage.setItem('irigacija_total_consumption', this.totalWaterConsumption);
                                
                                const flowRate = addedL / (5.0 / 60.0);
                                sensor.lastValue = flowRate;
                                this.updateDeviceVisualValue(sensor, `${flowRate.toFixed(1)} L/min`);
                            }
                            if (this.activeGaugeDevice && this.activeGaugeDevice.id === sensor.id) {
                                this.updateGaugeModalValue();
                            }
                        }
                    } else {
                        throw new Error(data.response || "TIMEOUT");
                    }
                } else {
                    throw new Error(`Gateway status ${response.status}`);
                }
            } catch (err) {
                console.warn(`[MOCK GATEWAY] Konekcija ka ${sensor.name} simulirana.`, err.message);
                this.handleSimulatedSensorReading(sensor);
                if (sensor.type === 'flow_meter') flowMeterPolled = true;
            }
        }

        if (!flowMeterPolled) {
            this.simulateOfflineFlowsAndDashboard();
        } else {
            this.updateDashboardVisuals();
        }
    }

    /**
     * Rukuje simuliranim/mock očitavanjem za pojedinačne senzore bez adrese
     */
    handleSimulatedSensorReading(sensor) {
        if (sensor.type === 'gauge') {
            const openValves = this.devices.filter(d => d.type === 'valve' && d.status === 'open');
            let simulatedPressure = 0.0;
            if (openValves.length > 0) {
                simulatedPressure = 2.4 + Math.random() * 0.4;
            } else {
                simulatedPressure = 4.2 + Math.random() * 0.3;
            }
            sensor.lastValue = simulatedPressure;
            this.updateDeviceVisualValue(sensor, `${simulatedPressure.toFixed(2)} bar`);
            this.addNetworkLog(`[MOCK RELAY] ${sensor.name} -> ${simulatedPressure.toFixed(2)} bar (Simulirano)`, 'success');
            if (this.activeGaugeDevice && this.activeGaugeDevice.id === sensor.id) {
                this.updateGaugeModalValue();
            }
        } else if (sensor.type === 'flow_meter') {
            const openValves = this.devices.filter(d => d.type === 'valve' && d.status === 'open');
            let flowRate = 0.0;
            if (openValves.length > 0) {
                flowRate = (28.0 + Math.random() * 4.0) * openValves.length;
            }
            sensor.lastValue = flowRate;
            this.updateDeviceVisualValue(sensor, `${flowRate.toFixed(1)} L/min`);
            
            const addedL = flowRate * (5.0 / 60.0);
            this.totalWaterConsumption += addedL;
            localStorage.setItem('irigacija_total_consumption', this.totalWaterConsumption);
            
            this.addNetworkLog(`[MOCK RELAY] ${sensor.name} -> ${flowRate.toFixed(1)} L/min | +${addedL.toFixed(2)} L (Simulirano)`, 'success');
            if (this.activeGaugeDevice && this.activeGaugeDevice.id === sensor.id) {
                this.updateGaugeModalValue();
            }
        } else {
            this.addNetworkLog(`[MOCK RELAY] ${sensor.name} -> PUMPA AKTIVNA (Simulirano)`, 'success');
        }
    }

    /**
     * Pomoćna metoda za simulaciju protoka i potrošnje kada nema fizičkih protokomera
     */
    simulateOfflineFlowsAndDashboard() {
        const openValves = this.devices.filter(d => d.type === 'valve' && d.status === 'open');
        if (openValves.length > 0) {
            const simulatedFlow = 35.0 + Math.random() * 5.0;
            const addedLiters = simulatedFlow * (5.0 / 60.0);
            this.totalWaterConsumption += addedLiters;
            localStorage.setItem('irigacija_total_consumption', this.totalWaterConsumption);
        }
        this.updateDashboardVisuals();
    }

    /**
     * Otvara skočni analogni sat za izabrani uređaj
     */
    openGaugeModal(device) {
        this.activeGaugeDevice = device;
        
        const modal = document.getElementById('gauge-modal');
        if (!modal) return;
        
        const titleEl = document.getElementById('gauge-modal-title');
        if (titleEl) {
            titleEl.textContent = device.name;
        }
        
        const addrEl = document.getElementById('gauge-modal-device-id');
        if (addrEl) {
            addrEl.textContent = device.arduinoId ? `Mrežna adresa: ${device.arduinoId}` : 'Mrežna adresa nije podešena (simulacija rada)';
        }
        
        const unitEl = document.getElementById('gauge-unit');
        if (unitEl) {
            unitEl.textContent = device.type === 'gauge' ? 'bar' : 'L/min';
        }
        
        const scaleLabels = document.querySelectorAll('#analog-gauge .scale-label');
        if (scaleLabels.length === 6) {
            const vals = device.type === 'gauge' ? [0, 2, 4, 6, 8, 10] : [0, 20, 40, 60, 80, 100];
            for (let i = 0; i < 6; i++) {
                scaleLabels[i].textContent = vals[i];
            }
        }
        
        modal.classList.add('show');
        this.updateGaugeModalValue();
    }

    /**
     * Ažurira položaj kazaljke i digitalnu cifru u modalnom satu
     */
    updateGaugeModalValue() {
        if (!this.activeGaugeDevice) return;
        
        const device = this.activeGaugeDevice;
        const val = parseFloat(device.lastValue || 0.0);
        
        let angle = -120;
        
        if (device.type === 'gauge') {
            const clamped = Math.max(0, Math.min(val, 10));
            angle = -120 + (clamped / 10) * 240;
        } else if (device.type === 'flow_meter') {
            const clamped = Math.max(0, Math.min(val, 100));
            angle = -120 + (clamped / 100) * 240;
        }
        
        const needle = document.getElementById('gauge-needle-group');
        if (needle) {
            needle.style.transform = `rotate(${angle}deg)`;
        }
        
        const digitalVal = document.getElementById('gauge-digital-val');
        if (digitalVal) {
            digitalVal.textContent = device.type === 'gauge' ? val.toFixed(2) : val.toFixed(1);
        }
    }

    /**
     * Zatvara skočni analogni sat
     */
    closeGaugeModal() {
        const modal = document.getElementById('gauge-modal');
        if (modal) {
            modal.classList.remove('show');
        }
        this.activeGaugeDevice = null;
        this.selectTool(null);
    }

    /**
     * Ažurira retro-industrijski LED displej na vrhu mape
     */
    updateDashboardVisuals() {
        const digits = document.querySelectorAll('#total-consumption-display .digit');
        if (digits.length > 0) {
            const clamped = Math.min(Math.max(this.totalWaterConsumption, 0), 9999999.99);
            const parts = clamped.toFixed(2).split('.');
            const integerPart = parts[0].padStart(7, '0');
            const decimalPart = parts[1];
            const str = integerPart + '.' + decimalPart;
            
            for (let i = 0; i < digits.length; i++) {
                if (digits[i]) {
                    digits[i].textContent = str[i];
                }
            }
        }
        
        const zoneDigits = document.querySelectorAll('#active-zone-display .digit');
        let activeZoneNum = 0;
        let activeZoneName = '';
        
        const openValves = this.devices.filter(d => d.type === 'valve' && d.status === 'open');
        if (openValves.length > 0) {
            const firstValve = openValves[0];
            const match = firstValve.name.match(/\d+/);
            if (match) {
                activeZoneNum = parseInt(match[0], 10);
            } else {
                const idx = this.devices.filter(d => d.type === 'valve').indexOf(firstValve) + 1;
                activeZoneNum = idx;
            }
            activeZoneName = firstValve.name.toUpperCase();
        }
        
        if (zoneDigits.length > 0) {
            const zoneStr = String(activeZoneNum).padStart(2, '0');
            for (let i = 0; i < zoneDigits.length; i++) {
                if (zoneDigits[i]) {
                    zoneDigits[i].textContent = zoneStr[i];
                }
            }
        }
        
        const progNameEl = document.getElementById('active-program-name');
        if (progNameEl) {
            if (openValves.length > 0) {
                if (openValves.length === 1) {
                    progNameEl.textContent = `AKTIVNA ${activeZoneName} - NAVODNJAVANJE U TOKU`;
                    progNameEl.style.color = '#38bdf8';
                } else {
                    progNameEl.textContent = `SISTEM UKLJUČEN - AKTIVNO ${openValves.length} ZONA`;
                    progNameEl.style.color = '#38bdf8';
                }
            } else {
                progNameEl.textContent = "SISTEM UKLJUČEN - STATUS: ČEKANJE...";
                progNameEl.style.color = '#a0a0a0';
            }
        }
    }

    /**
     * Šalje nalog ventilu preko UDP Gateway-a na Python serveru
     */
    async sendValveCommandPhysical(device, state) {
        const cmdValue = state === 'open' ? 'VALVE:1' : 'VALVE:0';
        
        if (!device.arduinoId) {
            this.addNetworkLog(`[MOCK RELAY] ${device.name} preklopljen u ${state.toUpperCase()} (Nema IP adrese)`, 'success');
            return;
        }

        const parts = device.arduinoId.split(':');
        const ip = parts[0];
        const port = parts[1] || '8888';

        this.addNetworkLog(`UDP slanje ka ${device.name} (${ip}:${port}): '${cmdValue}'...`, 'sending');

        try {
            const response = await fetch('/api/udp-relay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ip: ip,
                    port: parseInt(port),
                    msg: cmdValue,
                    wait_response: true // čeka potvrdu od Arduina
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.response && data.response !== 'TIMEOUT') {
                    this.addNetworkLog(`UDP potvrda od ventila: '${data.response}'`, 'success');
                } else {
                    throw new Error(data.response || "TIMEOUT");
                }
            } else {
                throw new Error(`Gateway vratio status ${response.status}`);
            }
        } catch (err) {
            console.warn(`[MOCK VALVE] Konekcija ka ${device.name} simulirana.`, err.message);
            this.addNetworkLog(`[MOCK RELAY] ${device.name} -> ${state.toUpperCase()} (Simulirano)`, 'success');
        }
    }

    /**
     * Ažurira natpis sa trenutnom vrednošću očitavanja iznad markera
     */
    updateDeviceVisualValue(device, text) {
        const marker = this.deviceMarkers[device.id];
        if (!marker) return;

        const labelEl = marker.getElement()?.querySelector('.device-label');
        if (labelEl) {
            labelEl.innerHTML = `${device.name}<br><span style="color: #00ffcc; font-size: 9px; font-weight: bold;">${text}</span>`;
        }
    }

    refreshDeviceIcon(device) {
        const marker = this.deviceMarkers[device.id];
        if (!marker) return;

        const isWiringMode = (this.selectedTool === 'wire');
        const updatedIconHtml = this.getDeviceIconHtml(device);
        
        let size = [36, 36];
        let anchor = [18, 18];
        let markerClass = 'custom-device-marker';
        
        if (device.type === 'gnc' && isWiringMode) {
            size = [270, 250];
            anchor = [135, 125];
            markerClass = 'custom-device-marker gnc-schematic-marker';
        }

        marker.setIcon(L.divIcon({
            className: markerClass,
            html: updatedIconHtml,
            iconSize: size,
            iconAnchor: anchor
        }));
    }

    /**
     * Inicijalizuje događaje za modal scenarija zalivanja
     */
    initScenarioEvents() {
        // Dropdown promena scenarija
        const scenarioSelect = document.getElementById('scenario-select');
        if (scenarioSelect) {
            scenarioSelect.addEventListener('change', (e) => {
                this.activeScenarioId = e.target.value || null;
                this.refreshScenarioStepsTable();
                this.clearScenarioValveSelection();
            });
        }

        // Prikaz forme za kreiranje novog scenarija
        const btnNew = document.getElementById('btn-scenario-new');
        if (btnNew) {
            btnNew.addEventListener('click', () => {
                const container = document.getElementById('scenario-new-container');
                if (container) {
                    container.classList.toggle('d-none');
                }
            });
        }

        // Dugme za kreiranje novog scenarija
        const btnCreate = document.getElementById('btn-scenario-create');
        if (btnCreate) {
            btnCreate.addEventListener('click', () => {
                const nameInput = document.getElementById('scenario-new-name');
                const name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    alert("Naziv scenarija je obavezan!");
                    return;
                }

                const newScenario = {
                    id: 'sc_' + Date.now(),
                    name: name,
                    steps: []
                };

                this.scenarios.push(newScenario);
                this.activeScenarioId = newScenario.id;

                if (nameInput) nameInput.value = '';
                const container = document.getElementById('scenario-new-container');
                if (container) container.classList.add('d-none');

                this.refreshScenarioDropdown();
                this.saveLayout();
            });
        }

        // Dugme za otkazivanje unosa novog scenarija (ODBACI)
        const btnCancel = document.getElementById('btn-scenario-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                const nameInput = document.getElementById('scenario-new-name');
                if (nameInput) nameInput.value = '';
                const container = document.getElementById('scenario-new-container');
                if (container) container.classList.add('d-none');
            });
        }

        // Dugme za brisanje scenarija
        const btnDelete = document.getElementById('btn-scenario-delete');
        if (btnDelete) {
            btnDelete.addEventListener('click', () => {
                if (!this.activeScenarioId) {
                    alert("Nema aktivnog scenarija za brisanje.");
                    return;
                }

                const scenario = this.scenarios.find(s => s.id === this.activeScenarioId);
                if (!scenario) return;

                if (confirm(`Da li sigurno želiš da obrišeš scenario "${scenario.name}"?`)) {
                    this.scenarios = this.scenarios.filter(s => s.id !== this.activeScenarioId);
                    this.activeScenarioId = this.scenarios.length > 0 ? this.scenarios[0].id : null;
                    this.refreshScenarioDropdown();
                    this.saveLayout();
                }
            });
        }

        // Dugme za prelazak u režim selekcije ventila van modala
        const btnAddStep = document.getElementById('btn-add-valves-step');
        if (btnAddStep) {
            btnAddStep.addEventListener('click', () => {
                if (!this.activeScenarioId) {
                    alert("Prvo izaberite ili kreirajte scenario!");
                    return;
                }

                // Zatvori trenutni modal
                const modalEl = document.getElementById('modalZalivanje');
                const modalObj = bootstrap.Modal.getInstance(modalEl);
                if (modalObj) {
                    modalObj.hide();
                }

                // Aktiviraj režim selekcije ventila
                this.isSelectingValvesForScenario = true;
                this.clearScenarioValveSelection(); // krenemo sa praznom selekcijom

                // Prikaži gornji overlay sa uputstvima
                this.showSelectionOverlay();
            });
        }

        // Dugme za ručno čuvanje scenarija u modalu
        const btnSave = document.getElementById('btn-scenario-save');
        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                const uspeh = await this.saveLayout();
                if (uspeh) {
                    // Zatvori modal
                    const modalEl = document.getElementById('modalZalivanje');
                    const modalObj = bootstrap.Modal.getInstance(modalEl);
                    if (modalObj) modalObj.hide();
                    this.addNetworkLog("Scenariji za zalivanje su uspešno sačuvani.", "success");
                } else {
                    alert("Greška pri čuvanju scenarija.");
                }
            });
        }

        // Slušaj otvaranje i zatvaranje modala za čišćenje selekcije ventila
        const modalZalivanjeEl = document.getElementById('modalZalivanje');
        if (modalZalivanjeEl) {
            modalZalivanjeEl.addEventListener('hidden.bs.modal', () => {
                if (!this.isSelectingValvesForScenario) {
                    this.clearScenarioValveSelection();
                }
            });
            modalZalivanjeEl.addEventListener('shown.bs.modal', () => {
                this.refreshScenarioDropdown();
            });
        }
    }

    /**
     * Osvežava dropdown listu sa scenarijima i aktivira selektovani scenario
     */
    refreshScenarioDropdown() {
        const scenarioSelect = document.getElementById('scenario-select');
        if (!scenarioSelect) return;

        scenarioSelect.innerHTML = '';

        if (!this.scenarios || this.scenarios.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '-- Kreirajte novi scenario --';
            scenarioSelect.appendChild(opt);
            this.activeScenarioId = null;
        } else {
            // Ako aktivni scenario nije definisan ili više ne postoji, postavi prvi dostupan
            if (!this.activeScenarioId || !this.scenarios.some(s => s.id === this.activeScenarioId)) {
                this.activeScenarioId = this.scenarios[0].id;
            }

            this.scenarios.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                if (s.id === this.activeScenarioId) {
                    opt.selected = true;
                }
                scenarioSelect.appendChild(opt);
            });
        }

        this.refreshScenarioStepsTable();
    }

    /**
     * Osvežava tabelu koraka za trenutno aktivni scenario
     */
    refreshScenarioStepsTable() {
        const stepsBody = document.getElementById('scenario-steps-body');
        if (!stepsBody) return;

        stepsBody.innerHTML = '';

        if (!this.activeScenarioId) {
            stepsBody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center text-muted py-3">
                        Nema aktivnog scenarija. Izaberite ili kreirajte scenario iznad.
                    </td>
                </tr>
            `;
            return;
        }

        const scenario = this.scenarios.find(s => s.id === this.activeScenarioId);
        if (!scenario || !scenario.steps || scenario.steps.length === 0) {
            stepsBody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center text-muted py-3">
                        Ovaj scenario još nema definisanih koraka.<br>
                        <em>Kliknite na ventile na mapi i dodajte ih kao korak!</em>
                    </td>
                </tr>
            `;
            return;
        }

        scenario.steps.forEach((step, index) => {
            // Pronađi nazive svih ventila u ovom koraku
            const valveNames = step.valves.map(valveId => {
                const dev = this.devices.find(d => d.id === valveId);
                return dev ? dev.name : `Nepoznat ventil (${valveId})`;
            }).join(', ');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>#${index + 1}</strong></td>
                <td>
                    <div style="font-weight: 500; color: #00ffcc;">
                        <i class="fas fa-shower me-1"></i> ${valveNames}
                    </div>
                </td>
                <td>
                    <div class="input-group input-group-sm">
                        <input type="number" step="0.1" min="0.1" class="form-control form-control-custom text-center py-1 step-volume-input" 
                               value="${step.volume}" data-step-id="${step.id}" style="max-width: 100px; background: rgba(0,0,0,0.2);">
                        <span class="input-group-text bg-dark text-muted border-0" style="font-size: 11px;">m³</span>
                    </div>
                </td>
                <td class="text-center">
                    <button class="btn btn-outline-danger btn-sm py-1 px-2 btn-delete-step" data-step-id="${step.id}" title="Obriši korak">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;

            // Promena količine (kubikaže)
            const inputVolume = tr.querySelector('.step-volume-input');
            if (inputVolume) {
                inputVolume.addEventListener('change', (e) => {
                    const volumeVal = parseFloat(e.target.value);
                    if (!isNaN(volumeVal) && volumeVal > 0) {
                        step.volume = volumeVal;
                        this.saveLayout();
                    } else {
                        e.target.value = step.volume;
                    }
                });
            }

            // Brisanje koraka
            const btnDeleteStep = tr.querySelector('.btn-delete-step');
            if (btnDeleteStep) {
                btnDeleteStep.addEventListener('click', () => {
                    scenario.steps = scenario.steps.filter(st => st.id !== step.id);
                    this.refreshScenarioStepsTable();
                    this.saveLayout();
                });
            }

            stepsBody.appendChild(tr);
        });
    }

    /**
     * Uključuje ili isključuje ventil u trenutnu selekciju za scenario
     */
    toggleValveSelectionForScenario(device) {
        if (!this.selectedValvesForScenario) {
            this.selectedValvesForScenario = [];
        }

        const idx = this.selectedValvesForScenario.indexOf(device.id);
        if (idx > -1) {
            this.selectedValvesForScenario.splice(idx, 1);
        } else {
            this.selectedValvesForScenario.push(device.id);
        }

        // Osveži ikonicu ventila na mapi (da počne/prestane da pulsira)
        this.refreshDeviceIcon(device);

        // Ažuriraj brojač u modalu
        const counterEl = document.getElementById('selected-valves-counter');
        if (counterEl) {
            counterEl.textContent = `Selektovano ventila na mapi: ${this.selectedValvesForScenario.length}`;
        }
    }

    /**
     * Čisti selekciju svih ventila za scenario i uklanja pulsirajući efekat na mapi
     */
    clearScenarioValveSelection() {
        const valvesToClear = [...(this.selectedValvesForScenario || [])];
        this.selectedValvesForScenario = [];

        valvesToClear.forEach(valveId => {
            const dev = this.devices.find(d => d.id === valveId);
            if (dev) {
                this.refreshDeviceIcon(dev);
            }
        });

        // Ažuriraj brojač u modalu
        const counterEl = document.getElementById('selected-valves-counter');
        if (counterEl) {
            counterEl.textContent = `Selektovano ventila na mapi: 0`;
        }
    }

    /**
     * Prikaži gornji overlay sa uputstvima za grafičku selekciju ventila
     */
    showSelectionOverlay() {
        let overlay = document.getElementById('valves-selection-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'valves-selection-overlay';
            overlay.className = 'valves-selection-overlay';
            overlay.innerHTML = `
                <div class="valves-selection-content">
                    <i class="fas fa-info-circle text-warning"></i>
                    <span><strong>Režim selekcije ventila:</strong> Kliknite na ventile na mapi koje želite da dodate. Kada završite, <strong>kliknite desnim tasterom miša (desni klik)</strong> na mapi za opcije.</span>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        overlay.classList.remove('d-none');
    }

    /**
     * Sakrij gornji overlay za selekciju ventila
     */
    hideSelectionOverlay() {
        const overlay = document.getElementById('valves-selection-overlay');
        if (overlay) {
            overlay.classList.add('d-none');
        }
    }

    /**
     * Prikazuje mali plutajući context meni na mestu desnog klika za PRIHVATI/ODBACI
     */
    showSelectionContextMenu(latlng) {
        const content = document.createElement('div');
        content.className = 'selection-context-menu';
        content.style.padding = '5px';
        content.innerHTML = `
            <div style="font-weight: bold; color: #ffffff; font-size: 13px; margin-bottom: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">
                Korak Scenarija (${this.selectedValvesForScenario.length} ventila)
            </div>
            <div class="d-flex gap-2 justify-content-center">
                <button class="btn btn-sm btn-success btn-accept-selection" style="font-size: 11px; font-weight: bold; padding: 6px 12px; background: linear-gradient(135deg, #00ffcc, #00cc99); border: none; color: #121212; border-radius: 4px;">
                    <i class="fas fa-check"></i> PRIHVATI
                </button>
                <button class="btn btn-sm btn-danger btn-reject-selection" style="font-size: 11px; font-weight: bold; padding: 6px 12px; background: linear-gradient(135deg, #ff3366, #cc0044); border: none; color: white; border-radius: 4px;">
                    <i class="fas fa-times"></i> ODBACI
                </button>
            </div>
        `;

        const popup = L.popup({
            closeButton: false,
            className: 'selection-popup-custom',
            minWidth: 180
        })
        .setLatLng(latlng)
        .setContent(content)
        .openOn(this.map);

        // Poveži dugmad
        content.querySelector('.btn-accept-selection').addEventListener('click', () => {
            this.map.closePopup();
            this.acceptValveSelectionForScenario();
        });

        content.querySelector('.btn-reject-selection').addEventListener('click', () => {
            this.map.closePopup();
            this.rejectValveSelectionForScenario();
        });
    }

    /**
     * Prihvata selekciju, upisuje korak u scenario i ponovo otvara glavni modal
     */
    acceptValveSelectionForScenario() {
        this.isSelectingValvesForScenario = false;
        this.hideSelectionOverlay();

        if (this.selectedValvesForScenario.length === 0) {
            alert("Niste selektovali nijedan ventil! Selekcija je odbačena.");
            this.clearScenarioValveSelection();
            
            // Ponovo otvori modal za zalivanje
            const modalEl = document.getElementById('modalZalivanje');
            const modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            if (modalObj) modalObj.show();
            return;
        }

        const scenario = this.scenarios.find(s => s.id === this.activeScenarioId);
        if (scenario) {
            const newStep = {
                id: 'step_' + Date.now(),
                valves: [...this.selectedValvesForScenario],
                volume: 1.0 // podrazumevana količina od 1 m³
            };
            scenario.steps.push(newStep);
            
            this.clearScenarioValveSelection();
            this.refreshScenarioStepsTable();
            this.saveLayout();
        }

        // Ponovo otvori modal za zalivanje
        const modalEl = document.getElementById('modalZalivanje');
        const modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        if (modalObj) modalObj.show();
    }

    /**
     * Odbacuje selekciju, čisti sve i ponovo otvara glavni modal
     */
    rejectValveSelectionForScenario() {
        this.isSelectingValvesForScenario = false;
        this.hideSelectionOverlay();
        this.clearScenarioValveSelection();

        // Ponovo otvori modal za zalivanje
        const modalEl = document.getElementById('modalZalivanje');
        const modalObj = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        if (modalObj) modalObj.show();
    }

    /**
     * Generiše HTML pin-sheme (čipa) za zadati GNC uređaj
     */
    getGncSchematicHtml(device) {
        const model = (device.properties && device.properties.gnc_model) ? device.properties.gnc_model : 'GNC2444';
        const friendlyModel = friendlyGncModel(model);
        const counts = this.getGncPinCounts(model);
        
        // 1. GORE: Digitalni ulazi (DI1 - DI_max)
        let topPinsHtml = '';
        for (let i = 1; i <= counts.digIns; i++) {
            const pin = `DI${i}`;
            topPinsHtml += `
                <div class="pin-col" style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                    <div class="pin-socket pin-dig-in" data-device-id="${device.id}" data-pin-name="${pin}" onclick="window.editorManager.handlePinClick('${device.id}', '${pin}', this, event)"></div>
                    <span style="font-size: 8px; font-weight: bold; color: #888;">DI${i}</span>
                </div>
            `;
        }
        
        // 2. LEVO: Analogni ulazi (A1 - A_max)
        let leftPinsHtml = '';
        for (let i = 1; i <= counts.analogs; i++) {
            const pin = `A${i}`;
            leftPinsHtml += `
                <div class="pin-row" style="display: flex; align-items: center; gap: 4px; justify-content: flex-start; width: 100%;">
                    <div class="pin-socket pin-analog" data-device-id="${device.id}" data-pin-name="${pin}" onclick="window.editorManager.handlePinClick('${device.id}', '${pin}', this, event)"></div>
                    <span style="font-size: 8px; font-weight: bold; color: #8a8e95;">A${i}</span>
                </div>
            `;
        }
        
        // 3. DESNO: Releji (R1 - R_max)
        let rightPinsHtml = '';
        for (let i = 1; i <= counts.relays; i++) {
            const pin = `R${i}`;
            rightPinsHtml += `
                <div class="pin-row" style="display: flex; align-items: center; gap: 4px; justify-content: flex-end; width: 100%;">
                    <span style="font-size: 8px; font-weight: bold; color: #8a8e95;">R${i}</span>
                    <div class="pin-socket pin-relay" data-device-id="${device.id}" data-pin-name="${pin}" onclick="window.editorManager.handlePinClick('${device.id}', '${pin}', this, event)"></div>
                </div>
            `;
        }
        
        // 4. DOLE: Digitalni izlazi (DO1 - DO_max), VCC i GND
        let bottomPinsHtml = '';
        for (let i = 1; i <= counts.digOuts; i++) {
            const pin = `DO${i}`;
            bottomPinsHtml += `
                <div class="pin-col" style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                    <span style="font-size: 8px; font-weight: bold; color: #888;">DO${i}</span>
                    <div class="pin-socket pin-dig-out" data-device-id="${device.id}" data-pin-name="${pin}" onclick="window.editorManager.handlePinClick('${device.id}', '${pin}', this, event)"></div>
                </div>
            `;
        }
        // Dodaj VCC
        bottomPinsHtml += `
            <div class="pin-col" style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                <span style="font-size: 8px; font-weight: bold; color: #ef4444;">VCC</span>
                <div class="pin-socket pin-vcc" data-device-id="${device.id}" data-pin-name="VCC" onclick="window.editorManager.handlePinClick('${device.id}', 'VCC', this, event)"></div>
            </div>
        `;
        // Dodaj GND
        bottomPinsHtml += `
            <div class="pin-col" style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                <span style="font-size: 8px; font-weight: bold; color: #22c55e;">GND</span>
                <div class="pin-socket pin-gnd" data-device-id="${device.id}" data-pin-name="GND" onclick="window.editorManager.handlePinClick('${device.id}', 'GND', this, event)"></div>
            </div>
        `;
        
        return `
            <div class="gnc-schematic-close" onclick="window.editorManager.closeGncSchematic(event)"><i class="fas fa-times"></i></div>
            <div class="gnc-schematic-row top-pins">
                ${topPinsHtml}
            </div>
            <div class="gnc-schematic-middle">
                <div class="gnc-schematic-column-side left-pins">
                    ${leftPinsHtml}
                </div>
                <div class="gnc-schematic-core" onclick="window.editorManager.handleGncCoreClick('${device.id}', event)">
                    <div class="gnc-core-title" style="font-size: 11px; font-weight: 800; color: #df49ff; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; text-transform: uppercase; text-shadow: 0 0 6px rgba(223, 73, 255, 0.4);">${device.name}</div>
                    <div class="gnc-core-model" style="font-size: 24px; background: rgba(223,73,255,0.1); border: 1px solid rgba(223,73,255,0.3); padding: 2px 8px; border-radius: 6px; color: #df49ff; font-weight: bold; margin-top: 4px; letter-spacing: 0.5px; text-shadow: 0 0 8px rgba(223, 73, 255, 0.3);">${friendlyModel}</div>
                    <div class="gnc-core-status" style="font-size: 7px; color: #00ffcc; font-weight: bold; margin-top: 6px; animation: blink 1.2s infinite alternate;"><i class="fas fa-circle" style="font-size: 5px; margin-right: 2px;"></i> LIVE</div>
                </div>
                <div class="gnc-schematic-column-side right-pins">
                    ${rightPinsHtml}
                </div>
            </div>
            <div class="gnc-schematic-row bottom-pins">
                ${bottomPinsHtml}
            </div>
        `;
    }

    /**
     * Vraća broj i vrstu portova na osnovu modela GNC-a (sa pametnim parsiranjem GNCxxxx formata)
     */
    getGncPinCounts(model) {
        // Mapiranje starih/alternativnih naziva opcija na nove standarde
        let normModel = friendlyGncModel(model ? model.toString().toUpperCase() : 'GNC2444');
        
        // Automatsko parsiranje GNC<releji><analogni><digitalni_ulazi><digitalni_izlazi>
        const match = normModel.match(/^GNC(\d)(\d)(\d)(\d)$/);
        if (match) {
            return {
                relays: parseInt(match[1]),
                analogs: parseInt(match[2]),
                digIns: parseInt(match[3]),
                digOuts: parseInt(match[4])
            };
        }
        
        if (normModel === 'ESP32') {
            return {
                relays: 4,
                analogs: 4,
                digIns: 6,
                digOuts: 2
            };
        }
        
        // Podrazumevani fallback
        return {
            relays: 8,
            analogs: 8,
            digIns: 8,
            digOuts: 4
        };
    }

    /**
     * Otvara ili zatvara (toggle) panel sa pinovima za zadati GNC uređaj
     */
    toggleGncSchematic(deviceId) {
        const overlay = document.getElementById('gnc-schematic-overlay');
        if (!overlay) return;

        // Ako je već otvoren za ovaj isti GNC, zatvori ga
        if (overlay.classList.contains('show') && this.hoveredGncId === deviceId) {
            this.closeGncSchematic();
            return;
        }

        // Otvori za izabrani GNC
        const device = this.devices.find(d => d.id === deviceId);
        if (device) {
            // Skloni .overlay-active sa svih ostalih i dodaj na ovaj
            document.querySelectorAll('.gnc-hybrid-container').forEach(el => {
                el.classList.remove('overlay-active');
            });
            const container = document.querySelector(`.gnc-hybrid-container[data-device-id="${deviceId}"]`);
            if (container) {
                container.classList.add('overlay-active');
            }

            // Primeni sačuvanu poziciju ili resetuj na podrazumevani gornji desni ugao
            if (device.properties && device.properties.remember_position && device.properties.panel_left && device.properties.panel_top) {
                overlay.style.right = 'auto';
                overlay.style.bottom = 'auto';
                overlay.style.left = device.properties.panel_left;
                overlay.style.top = device.properties.panel_top;
            } else {
                overlay.style.left = '';
                overlay.style.top = '';
                overlay.style.right = '';
                overlay.style.bottom = '';
            }

            overlay.innerHTML = this.getGncSchematicHtml(device);
            overlay.classList.add('show');
            this.hoveredGncId = deviceId;
            
            this.updateAllWires();
            
            // Osvežavanje tokom animacije rastezanja i pozicioniranja
            const steps = [50, 100, 150, 200, 250, 300];
            steps.forEach(delay => {
                setTimeout(() => {
                    this.updateAllWires();
                }, delay);
            });
        }
    }

    /**
     * Zatvara panel sa pinovima
     */
    closeGncSchematic(event) {
        if (event) L.DomEvent.stopPropagation(event);

        const overlay = document.getElementById('gnc-schematic-overlay');
        if (overlay) {
            overlay.classList.remove('show');
            // NE čistimo stilove pozicije ovde odmah kako bismo omogućili CSS tranziciji (nestajanju) da se odigra na trenutnoj poziciji bez skakanja
            
            // Nakon što se tranzicija završi, praznimo innerHTML da bismo u potpunosti uklonili stare pinove iz DOM-a i sprečili bilo kakvo praćenje koordinata
            setTimeout(() => {
                if (overlay && !overlay.classList.contains('show')) {
                    overlay.innerHTML = '';
                }
            }, 350);
        }

        document.querySelectorAll('.gnc-hybrid-container').forEach(el => {
            el.classList.remove('overlay-active');
        });

        this.hoveredGncId = null;
        this.updateAllWires();
        
        // Deaktiviraj aktivni alat (isključi komponente) pri zatvaranju GNC panela sa pinovima
        this.selectTool(null);
    }

    /**
     * Upravlja klikom na centralno jezgro GNC panela (Core) i otvara veliki modal
     */
    handleGncCoreClick(deviceId, event) {
        if (event) L.DomEvent.stopPropagation(event);

        const device = this.devices.find(d => d.id === deviceId);
        if (device) {
            const marker = this.deviceMarkers[deviceId];
            this.openDeviceCharacteristicsModal(device, marker);
        }
    }

    /**
     * Nalazi tačnu geografsku LatLng poziciju za određeni pin uređaja na osnovu ekranskih koordinata (getBoundingClientRect)
     */
    getPinLatLng(deviceId, pinName) {
        // Ako je panel sa pinovima trenutno otvoren i prikazuje baš ovaj GNC
        if (this.hoveredGncId === deviceId) {
            const overlay = document.getElementById('gnc-schematic-overlay');
            if (overlay && overlay.classList.contains('show')) {
                const el = overlay.querySelector(`[data-device-id="${deviceId}"][data-pin-name="${pinName}"]`);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        const mapContainer = this.map.getContainer();
                        const mapRect = mapContainer.getBoundingClientRect();
                        
                        const x = rect.left + rect.width / 2 - mapRect.left;
                        const y = rect.top + rect.height / 2 - mapRect.top;
                        
                        const point = L.point(x, y);
                        return this.map.containerPointToLatLng(point);
                    }
                }
            }
        }

        // Ako panel nije aktivan, žica ide iz samog centra GNC-a na mapi
        const device = this.devices.find(d => d.id === deviceId);
        return device ? L.latLng(device.lat, device.lng) : null;
    }

    /**
     * Vraća geografski centar uređaja na mapi
     */
    getDeviceLatLng(deviceId) {
        const device = this.devices.find(d => d.id === deviceId);
        return device ? L.latLng(device.lat, device.lng) : null;
    }

    /**
     * Nalazi tačnu geografsku LatLng poziciju za određeni vodovodni pin ventila
     */
    getWaterPinLatLng(deviceId, pinName) {
        if (!this.map) return null;
        
        // Pouzdan, brz i precizan čisto matematički proračun na osnovu koordinata uređaja (izbegava zavisnost od DOM layout-a tokom prevlačenja).
        const device = this.devices.find(d => d.id === deviceId);
        if (!device) return null;
        
        const devLatLng = L.latLng(device.lat, device.lng);
        const zoom = this.map.getZoom();
        const devPoint = this.map.project(devLatLng, zoom);
        
        let offsetX = 0;
        let offsetY = -20; // 20px iznad centra (odgovara top: -8px za pin prečnika 12px na ikoni od 36px)
        if (pinName === 'W_IN') {
            offsetX = -10; // Pomereno levo
        } else if (pinName === 'W_OUT') {
            offsetX = 10; // Pomereno desno
        }
        
        const targetPoint = L.point(devPoint.x + offsetX, devPoint.y + offsetY);
        const targetLatLng = this.map.unproject(targetPoint, zoom);
        return targetLatLng;
    }

    /**
     * Preračunava i ažurira sve krajeve creva povezanih na vodovodne pinove ventila
     */
    updateAllPipes() {
        if (!this.pipes || this.pipes.length === 0) return;
        
        this.pipes.forEach(pipe => {
            if (pipe.from || pipe.to) {
                let updated = false;
                
                if (pipe.from) {
                    const fromDev = this.devices.find(d => d.id === pipe.from);
                    if (fromDev && fromDev.type === 'valve' && pipe.fromPin && pipe.points && pipe.points.length > 0) {
                        const pinLatLng = this.getWaterPinLatLng(pipe.from, pipe.fromPin);
                        if (pinLatLng) {
                            pipe.points[0] = [pinLatLng.lat, pinLatLng.lng];
                            updated = true;
                        }
                    }
                }
                
                if (pipe.to) {
                    const toDev = this.devices.find(d => d.id === pipe.to);
                    if (toDev && toDev.type === 'valve' && pipe.toPin && pipe.points && pipe.points.length > 0) {
                        const pinLatLng = this.getWaterPinLatLng(pipe.to, pipe.toPin);
                        if (pinLatLng) {
                            pipe.points[pipe.points.length - 1] = [pinLatLng.lat, pinLatLng.lng];
                            updated = true;
                        }
                    }
                }
                
                if (updated && this.pipeLines[pipe.id] && pipe.points) {
                    this.pipeLines[pipe.id].setLatLngs(pipe.points);
                }
            }
        });
    }

    /**
     * Upravlja klikom na pin (početak ili završetak spajanja električne veze)
     */
    handlePinClick(deviceId, pinName, el, event) {
        if (event) L.DomEvent.stopPropagation(event);
        
        // Zabrani interakciju ako je bilo koji modal otvoren
        const activeModal = document.querySelector('.modal.show');
        if (activeModal) return;

        if (this.selectedTool !== 'wire') return;

        if (this.wireStartPoint) {
            const from = this.wireStartPoint;

            // Spreči spajanje uređaja samog na sebe
            if (from.deviceId === deviceId) {
                alert("Ne možete povezati uređaj sam sa sobom!");
                this.resetWireConnection();
                return;
            }

            // Validacija kompatibilnosti pinova
            const errorMsg = this.validatePinConnection(from.deviceId, from.pinName, deviceId, pinName);
            if (errorMsg) {
                alert(errorMsg);
                this.resetWireConnection();
                return;
            }

            // Kreiraj trajnu vezu
            this.createWire(from.deviceId, from.pinName, deviceId, pinName);

            // Resetuj privremene varijable ožičenja i skuplja kartice
            this.resetWireConnection();
            
            // Deaktiviraj alat nakon uspešnog kreiranja električne veze
            this.selectTool(null);

        } else {
            // Početak kreiranja veze
            const pinLatLng = this.getPinLatLng(deviceId, pinName);
            if (!pinLatLng) return;

            this.wireStartPoint = {
                deviceId: deviceId,
                pinName: pinName,
                lat: pinLatLng.lat,
                lng: pinLatLng.lng,
                el: el
            };

            // Obeleži aktivni pin vizuelno
            el.classList.add('wiring-active');

            // Sakrij i sakupi plutajući panel sa pinovima odmah nakon što je pin kliknut, a žica neka krene iz centra GNC-a
            const overlay = document.getElementById('gnc-schematic-overlay');
            if (overlay) {
                overlay.classList.remove('show');
                if (this.gncHideTimeout) {
                    clearTimeout(this.gncHideTimeout);
                    this.gncHideTimeout = null;
                }

                // Ažuriramo startnu tačku žice na centar GNC-a
                const centerLatLng = this.getDeviceLatLng(deviceId);
                if (centerLatLng) {
                    this.wireStartPoint.lat = centerLatLng.lat;
                    this.wireStartPoint.lng = centerLatLng.lng;
                }
                this.hoveredGncId = null;
                this.updateAllWires();
            }

            // Aktivira praćenje pomeranja miša za rastegljivi kabl
            this.map.on('mousemove', this.handleWireMouseMove, this);
        }
    }

    /**
     * Upravlja klikom na vodeni pin (početak ili završetak crtanja creva)
     */
    handleWaterPinClick(deviceId, pinName, el, event) {
        if (event) {
            L.DomEvent.stopPropagation(event);
            if (event.stopPropagation) event.stopPropagation();
        }
        
        // Zabrani interakciju ako je bilo koji modal otvoren
        const activeModal = document.querySelector('.modal.show');
        if (activeModal) return;

        // Dozvoli samo ako je aktivan alat za crtanje creva
        if (this.selectedTool !== 'pipe') return;

        const pinLatLng = this.getWaterPinLatLng(deviceId, pinName);
        if (!pinLatLng) return;

        if (this.isDrawingPipe) {
            // Ako već crtamo crevo, klikom na vodeni pin dodajemo to teme i završavamo crtanje!
            this.drawingPipePoints.push(pinLatLng);
            this.activePipePolyline.setLatLngs(this.drawingPipePoints);
            
            // Dodajemo vizuelni marker za to teme
            const kruzicIcon = L.divIcon({
                className: 'custom-vertex-marker custom-vertex-marker-pipe',
                html: '<div style="width: 12px; height: 12px; background-color: #ffffff; border: 2px solid #0055ff; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4);"></div>',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });
            const m = L.marker(pinLatLng, { icon: kruzicIcon, interactive: false }).addTo(this.map);
            this.drawingPipeMarkers.push(m);

            // Uspešno završavamo i čuvamo crevo
            this.stopDrawingPipe(false);
        } else {
            // Inače pokrećemo crtanje creva iz tog vodenog pina
            this.startDrawingPipe(pinLatLng);
        }
    }

    /**
     * Iscrtava privremenu rastegljivu liniju kabla koja prati kursor
     */
    handleWireMouseMove(e) {
        if (!this.wireStartPoint) return;

        const startLatLng = L.latLng(this.wireStartPoint.lat, this.wireStartPoint.lng);
        const endLatLng = e.latlng;

        const points = [startLatLng, endLatLng];

        if (this.tempWireLine) {
            this.tempWireLine.setLatLngs(points);
        } else {
            this.tempWireLine = L.polyline(points, {
                color: '#df49ff',
                weight: 1.2,
                dashArray: '4, 4',
                opacity: 0.8,
                interactive: false
            }).addTo(this.map);
        }
    }

    /**
     * Vrši detaljnu bezbednosnu validaciju spajanja pinova
     */
    validatePinConnection(fromDeviceId, fromPin, toDeviceId, toPin) {
        const dev1 = this.devices.find(d => d.id === fromDeviceId);
        const dev2 = this.devices.find(d => d.id === toDeviceId);
        if (!dev1 || !dev2) return "Nepostojeći uređaj.";

        let gncDev = null, targetDev = null;
        let gncPin = null, targetPin = null;

        if (dev1.type === 'gnc') {
            gncDev = dev1; gncPin = fromPin;
            targetDev = dev2; targetPin = toPin;
        } else if (dev2.type === 'gnc') {
            gncDev = dev2; gncPin = toPin;
            targetDev = dev1; targetPin = fromPin;
        } else {
            return "Jedna strana u električnoj vezi mora uvek biti GNC kontroler!";
        }

        // 1. Validacija napajanja VCC i mase GND
        if (gncPin === 'VCC') {
            if (targetPin !== 'VCC') return "GNC VCC se može povezati isključivo na VCC pin senzora!";
            return null;
        }
        if (targetPin === 'VCC') {
            if (gncPin !== 'VCC') return "VCC pin senzora se može povezati isključivo na VCC pin GNC kontrolera!";
            return null;
        }

        if (gncPin === 'GND') {
            if (targetPin !== 'GND') return "GND pin sa GNC-a se može spojiti isključivo na GND pin drugog uređaja!";
            return null;
        }
        if (targetPin === 'GND') {
            if (gncPin !== 'GND') return "GND pin drugog uređaja se može spojiti isključivo na GND pin GNC kontrolera!";
            return null;
        }

        // 2. Relejni izlazi (R1-R8) i digitalni izlazi (DO1-DO4)
        const isGncOutput = gncPin.startsWith('R') || gncPin.startsWith('DO');
        if (isGncOutput) {
            if (targetDev.type === 'valve' && targetPin === 'IN') return null;
            if (targetDev.type === 'pump' && targetPin === 'CTRL') return null;
            return `Izlazni port ${gncPin} na GNC-u se može spojiti isključivo na 'IN' pin ventila ili 'CTRL' pin pumpe!`;
        }

        // 3. Analogni ulazi GNC-a (A1-A8)
        if (gncPin.startsWith('A')) {
            if (targetPin === 'SIG') {
                const sensorType = (targetDev.properties && targetDev.properties.sensor_type) ? targetDev.properties.sensor_type : 'pulse';
                if (sensorType === 'analog' || sensorType === '4_20ma') {
                    return null;
                }
                return `Analogni ulaz ${gncPin} zahteva analogni senzor (4-20mA ili 0-5V). Ciljni senzor "${targetDev.name}" je trenutno podešen kao pulsni!`;
            }
            return `Analogni ulaz ${gncPin} se može povezati samo na 'SIG' pin analognog senzora!`;
        }

        // 4. Digitalni/impulsni ulazi GNC-a (DI1-DI8)
        if (gncPin.startsWith('DI')) {
            if (targetPin === 'SIG') {
                const sensorType = (targetDev.properties && targetDev.properties.sensor_type) ? targetDev.properties.sensor_type : 'pulse';
                if (sensorType === 'pulse') {
                    return null;
                }
                return `Digitalni ulaz ${gncPin} zahteva impulsni/digitalni senzor. Ciljni senzor "${targetDev.name}" je trenutno podešen kao analogni!`;
            }
            return `Digitalni ulaz ${gncPin} se može povezati samo na 'SIG' pin pulsnog/digitalnog senzora!`;
        }

        return `Nije dozvoljeno povezivanje između pina ${fromPin} i pina ${toPin}!`;
    }

    /**
     * Kreira novi objekat električne veze i upisuje ga u niz
     */
    createWire(fromDeviceId, fromPin, toDeviceId, toPin) {
        const vecPostoji = this.wiring.some(w => 
            (w.fromDeviceId === fromDeviceId && w.fromPin === fromPin && w.toDeviceId === toDeviceId && w.toPin === toPin) ||
            (w.fromDeviceId === toDeviceId && w.fromPin === toPin && w.toDeviceId === fromDeviceId && w.toPin === fromPin)
        );
        if (vecPostoji) {
            alert("Ova električna veza već postoji!");
            return;
        }

        const wireId = 'wire_' + Date.now();

        // Odredimo boju signala za ogranke
        let color = '#ef4444'; // Podrazumevano crvena za direktne elektro-vodove
        let signalName = 'Električni signal';

        const isGncPin = (pin) => pin.startsWith('R') || pin.startsWith('A') || pin.startsWith('DI') || pin.startsWith('DO') || pin === 'VCC' || pin === 'GND';
        const gncPin = isGncPin(fromPin) ? fromPin : toPin;

        if (gncPin.startsWith('R') || gncPin.startsWith('DO')) {
            signalName = gncPin.startsWith('R') ? `Relejni izlaz ${gncPin}` : `Digitalni izlaz ${gncPin}`;
        } else if (gncPin.startsWith('A')) {
            signalName = `Analogni senzorski ulaz ${gncPin}`;
        } else if (gncPin.startsWith('DI')) {
            signalName = `Impulsni senzorski ulaz ${gncPin}`;
        } else if (gncPin === 'VCC') {
            signalName = 'Napajanje VCC (+5V/24V)';
        } else if (gncPin === 'GND') {
            signalName = 'Uzemljenje GND';
        }

        const newWire = {
            id: wireId,
            fromDeviceId: fromDeviceId,
            fromPin: fromPin,
            toDeviceId: toDeviceId,
            toPin: toPin,
            color: color,
            signalName: signalName
        };

        this.wiring.push(newWire);
        this.saveLayout();
        this.drawWireLine(newWire);
    }

    getPinContainerPoint(deviceId, pinName) {
        const device = this.devices.find(d => d.id === deviceId);
        if (!device) return null;

        let el = null;

        if (device.type === 'gnc') {
            const overlay = document.getElementById('gnc-schematic-overlay');
            const isOverlayShowingForThisDevice = overlay && overlay.classList.contains('show') && this.hoveredGncId === deviceId;
            if (isOverlayShowingForThisDevice) {
                el = document.querySelector(`#gnc-schematic-overlay [data-device-id="${deviceId}"][data-pin-name="${pinName}"]`);
            }
        } else {
            // Samo za kompaktne pinove ostalih uređaja na mapi (ventili, pumpe, senzori)
            el = document.querySelector(`.compact-device-pins [data-device-id="${deviceId}"][data-pin-name="${pinName}"]`);
        }

        if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const mapContainer = this.map.getContainer();
                const mapRect = mapContainer.getBoundingClientRect();
                return {
                    x: rect.left + rect.width / 2 - mapRect.left,
                    y: rect.top + rect.height / 2 - mapRect.top,
                    isPinSocket: true
                };
            }
        }

        // Ako pin-socket nije pronađen ili još uvek nije izrenderovan, žica ide iz samog centra uređaja na mapi
        const latLng = L.latLng(device.lat, device.lng);
        const pt = this.map.latLngToContainerPoint(latLng);
        return {
            x: pt.x,
            y: pt.y,
            isPinSocket: false
        };
    }

    /**
     * Iscrtava električni kabl kao SVG liniju unutar transparentnog SVG sloja
     */
    drawWireLineSvg(svgOverlay, wire) {
        const p1 = this.getPinContainerPoint(wire.fromDeviceId, wire.fromPin);
        const p2 = this.getPinContainerPoint(wire.toDeviceId, wire.toPin);

        if (!p1 || !p2) return;

        // Izračunaj rastojanje između tačaka
        let x1 = p1.x;
        let y1 = p1.y;
        let x2 = p2.x;
        let y2 = p2.y;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
            // Ako p1 nije pin socket (nego centar uređaja, npr. GNC sa zatvorenim modalom), skrati liniju sa te strane za 20px (radijus ikonice + mali gap)
            if (!p1.isPinSocket) {
                const shortenDist = 20; // radijus ikonice (18px) + 2px čistog prostora
                if (dist > shortenDist) {
                    x1 = x1 + (dx / dist) * shortenDist;
                    y1 = y1 + (dy / dist) * shortenDist;
                }
            }

            // Ako p2 nije pin socket (nego centar uređaja), skrati liniju sa te strane za 20px
            if (!p2.isPinSocket) {
                const shortenDist = 20; // radijus ikonice (18px) + 2px čistog prostora
                if (dist > shortenDist) {
                    x2 = x2 - (dx / dist) * shortenDist;
                    y2 = y2 - (dy / dist) * shortenDist;
                }
            }
        }

        const dev1 = this.devices.find(d => d.id === wire.fromDeviceId);
        const dev2 = this.devices.find(d => d.id === wire.toDeviceId);

        const labelText = `Elektroožičenje: ${dev1 ? dev1.name : ''} (${wire.fromPin}) ⚡ ${dev2 ? dev2.name : ''} (${wire.toPin}) [${wire.signalName || ''}]`;

        // Kreiraj SVG liniju
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', wire.color || '#ef4444');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('class', 'electrical-wire-line');
        
        // Podesi pointer-events za precizno detektovanje klikova i hovera na samu liniju
        line.style.pointerEvents = 'stroke';
        line.style.cursor = 'pointer';

        // Klik handler otvara modal ožičenja
        line.addEventListener('click', (e) => {
            if (this.isAnyDrawingOrMeasuringActive() || (this.isEditMode && this.selectedTool)) {
                // Dozvoli klik kroz liniju žice da bi snap i crtanje radili
                return;
            }
            e.stopPropagation();
            this.openWireCharacteristicsModal(wire);
        });

        // Desni klik handler za brzo brisanje u Edit modu
        line.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.isAnyDrawingOrMeasuringActive()) {
                // Završi ili otkaži ono što se crta u zavisnosti od aktivnog režima
                if (this.isDrawingPipe) {
                    this.stopDrawingPipe(false);
                } else if (this.wireStartPoint) {
                    this.resetWireConnection();
                } else if (window.crtanjeManager && window.crtanjeManager.crtanjeAktivno) {
                    window.crtanjeManager.zavrsiPoligon();
                } else if (window.measureManager && window.measureManager.isMeasuring) {
                    window.measureManager.stopMeasuring(false);
                }
                return;
            }

            if (!this.isEditMode) return;

            if (confirm(`Da li želite da obrišete ovu električnu vezu?\n\n${dev1 ? dev1.name : ''} (${wire.fromPin}) - ${dev2 ? dev2.name : ''} (${wire.toPin})`)) {
                this.deleteWire(wire.id);
            }
        });

        // Tooltip događaji
        line.addEventListener('mouseenter', (e) => {
            let tooltip = document.getElementById('wire-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'wire-tooltip';
                tooltip.style.position = 'absolute';
                tooltip.style.display = 'none';
                tooltip.style.background = 'rgba(10, 10, 15, 0.95)';
                tooltip.style.color = '#fff';
                tooltip.style.padding = '8px 12px';
                tooltip.style.borderRadius = '8px';
                tooltip.style.fontSize = '12px';
                tooltip.style.fontFamily = "'Outfit', sans-serif";
                tooltip.style.pointerEvents = 'none';
                tooltip.style.zIndex = '3000';
                tooltip.style.border = '1px solid rgba(223, 73, 255, 0.4)';
                tooltip.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
                tooltip.style.whiteSpace = 'nowrap';
                document.body.appendChild(tooltip);
            }
            tooltip.innerHTML = labelText;
            tooltip.style.display = 'block';
        });

        line.addEventListener('mousemove', (e) => {
            const tooltip = document.getElementById('wire-tooltip');
            if (tooltip) {
                tooltip.style.left = (e.pageX + 15) + 'px';
                tooltip.style.top = (e.pageY + 15) + 'px';
            }
        });

        line.addEventListener('mouseleave', () => {
            const tooltip = document.getElementById('wire-tooltip');
            if (tooltip) {
                tooltip.style.display = 'none';
            }
        });

        svgOverlay.appendChild(line);
    }

    /**
     * Briše električnu vezu iz niza i sa mape
     */
    deleteWire(wireId) {
        this.wiring = this.wiring.filter(w => w.id !== wireId);
        this.saveLayout();
        this.updateAllWires();
    }

    /**
     * Ažurira ožičenje za specifični uređaj (tokom prevlačenja markera)
     */
    updateConnectedWires(deviceId) {
        this.updateAllWires();
        
        // Rotiraj pinove na oba uređaja u realnom vremenu
        if (this.wiring) {
            this.wiring.forEach(wire => {
                if (wire.fromDeviceId === deviceId || wire.toDeviceId === deviceId) {
                    this.updatePinsPosition(wire.fromDeviceId);
                    this.updatePinsPosition(wire.toDeviceId);
                }
            });
        }
    }

    /**
     * Preračunava i ponovo iscrtava sve kablove na mapi (pri zumiranju ili pomeranju mape)
     */
    updateAllWires() {
        // Obriši stare slojeve ako su preostali unutar wireLayers
        if (this.wireLayers) {
            Object.keys(this.wireLayers).forEach(wireId => {
                this.wireLayers[wireId].forEach(layer => this.map.removeLayer(layer));
            });
            this.wireLayers = {};
        }

        // Pronađi ili kreiraj naš visokoprioritetni SVG sloj direktno unutar mapa kontejnera
        let svgOverlay = document.getElementById('wires-svg-overlay');
        if (!svgOverlay) {
            const mapaEl = document.getElementById('mapa');
            if (mapaEl) {
                svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svgOverlay.setAttribute('id', 'wires-svg-overlay');
                svgOverlay.style.position = 'absolute';
                svgOverlay.style.top = '0';
                svgOverlay.style.left = '0';
                svgOverlay.style.width = '100%';
                svgOverlay.style.height = '100%';
                svgOverlay.style.pointerEvents = 'none';
                svgOverlay.style.zIndex = '1045';
                mapaEl.appendChild(svgOverlay);
            }
        }

        // Isprazni SVG overlay pre ponovnog iscrtavanja
        if (svgOverlay) {
            while (svgOverlay.firstChild) {
                svgOverlay.removeChild(svgOverlay.firstChild);
            }
        }

        // Elektroožičenje treba uvek da bude vidljivo (i u editovanju i van njega)
        const shouldShowWires = true;
        
        if (shouldShowWires && svgOverlay) {
            if (this.wiring) {
                this.wiring.forEach(wire => {
                    this.drawWireLineSvg(svgOverlay, wire);
                });
                
                // Ažuriraj rotaciju pinova za sve uređaje na mapi koji nisu GNC
                this.devices.forEach(dev => {
                    if (dev.type !== 'gnc') {
                        this.updatePinsPosition(dev.id);
                    }
                });
            }
        }
    }

    /**
     * Kompatibilni omotač za eksterne pozive koji žele da iscrtaju jednu liniju (sada osvežava sve)
     */
    drawWireLine(wire) {
        this.updateAllWires();
    }

    /**
     * Otvara moderni tamni modal sa karakteristikama elektro-voda (žice)
     */
    openWireCharacteristicsModal(wire) {
        // Postavi ID u skriveni input
        document.getElementById('wire-edit-id').value = wire.id;

        const dev1 = this.devices.find(d => d.id === wire.fromDeviceId);
        const dev2 = this.devices.find(d => d.id === wire.toDeviceId);

        // Dinamički info o pinovima
        const infoEl = document.getElementById('wire-edit-info');
        if (infoEl) {
            infoEl.innerHTML = `
                <div class="wire-modal-connection-info mb-4" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444; font-family: 'Outfit', sans-serif;">
                    <div style="font-size: 11px; text-transform: uppercase; color: #888; font-weight: bold; margin-bottom: 5px;">Električna veza</div>
                    <div style="display: flex; align-items: center; justify-content: space-between; font-weight: bold;">
                        <span style="color: #60a5fa;">${dev1 ? dev1.name : 'Nepoznato'}</span>
                        <span style="font-size: 11px; background: rgba(96,165,250,0.1); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-weight: normal; margin-left: 5px;">${wire.fromPin}</span>
                        <span style="margin: 0 10px; color: #ef4444;"><i class="fas fa-plug-circle-bolt"></i></span>
                        <span style="color: #34d399;">${dev2 ? dev2.name : 'Nepoznato'}</span>
                        <span style="font-size: 11px; background: rgba(52,211,153,0.1); color: #34d399; padding: 2px 6px; border-radius: 4px; font-weight: normal; margin-left: 5px;">${wire.toPin}</span>
                    </div>
                    <div style="font-size: 12px; color: #9ca3af; margin-top: 10px; font-style: italic;">
                        Tip signala: ${wire.signalName || 'Opšti električni vod'}
                    </div>
                </div>
            `;
        }

        const color = wire.color || '#ef4444';
        const colorPicker = document.getElementById('wire-color-picker');
        if (colorPicker) {
            colorPicker.value = color;
        }

        // Podesi interaktivnost zavisno od Edit / Run režima
        const btnDelete = document.getElementById('btn-wire-delete');
        const btnSave = document.getElementById('btn-wire-save');

        if (this.isEditMode) {
            if (btnDelete) btnDelete.classList.remove('d-none');
            if (btnSave) btnSave.classList.remove('d-none');
            if (colorPicker) colorPicker.disabled = false;
        } else {
            if (btnDelete) btnDelete.classList.add('d-none');
            if (btnSave) btnSave.classList.add('d-none');
            if (colorPicker) colorPicker.disabled = true;
        }

        // Prikaži modal
        const modalEl = document.getElementById('modalZicaKarakteristike');
        const modalObj = new bootstrap.Modal(modalEl);
        modalObj.show();
    }

    /**
     * Dinamički preračunava uglove i pozicionira pinove na obodu kružnih uređaja
     */
    updatePinsPosition(deviceId) {
        const device = this.devices.find(d => d.id === deviceId);
        if (!device || device.type === 'gnc') return;

        // Pronađi marker u DOM-u
        const marker = this.deviceMarkers[deviceId];
        if (!marker || !marker._icon) return;

        const el = marker._icon;
        const pinElements = el.querySelectorAll('.compact-pin-socket');
        if (!pinElements || pinElements.length === 0) return;

        const deviceLatLng = L.latLng(device.lat, device.lng);

        // Pronađi sve žice povezane sa ovim uređajem
        const deviceWires = this.wiring.filter(w => w.fromDeviceId === deviceId || w.toDeviceId === deviceId);

        // Grupiši povezane pinove po ciljnom uređaju
        const connectedPins = [];
        deviceWires.forEach(wire => {
            const isFrom = wire.fromDeviceId === deviceId;
            const pinName = isFrom ? wire.fromPin : wire.toPin;
            const targetId = isFrom ? wire.toDeviceId : wire.fromDeviceId;
            const targetDev = this.devices.find(d => d.id === targetId);
            
            if (targetDev) {
                connectedPins.push({
                    pinName: pinName,
                    targetId: targetId,
                    targetLatlng: L.latLng(targetDev.lat, targetDev.lng)
                });
            }
        });

        // Grupišemo po targetId da bismo znali koliko pinova ide ka istom uređaju
        const targetsMap = {};
        connectedPins.forEach(p => {
            if (!targetsMap[p.targetId]) {
                targetsMap[p.targetId] = [];
            }
            targetsMap[p.targetId].push(p);
        });

        // Preračunaj pozicije za svaki povezani pin
        const pinPositions = {}; // pinName -> {x, y}
        const R = 18; // poluprečnik od 36px kružnog markera

        Object.keys(targetsMap).forEach(targetId => {
            const pinsList = targetsMap[targetId];
            const targetLatlng = pinsList[0].targetLatlng;

            // Izračunaj bazni ugao na ekranu
            const p1 = this.map.latLngToContainerPoint(deviceLatLng);
            const p2 = this.map.latLngToContainerPoint(targetLatlng);
            const baseAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x); // u radijanima

            const count = pinsList.length;
            pinsList.forEach((pinInfo, idx) => {
                let offset = 0;
                if (count === 2) {
                    // dva pina ka istom cilju: -20 i +20 stepeni
                    offset = (idx === 0) ? -20 * Math.PI / 180 : 20 * Math.PI / 180;
                } else if (count === 3) {
                    // tri pina: -25, 0, +25 stepeni
                    if (idx === 0) offset = -25 * Math.PI / 180;
                    else if (idx === 2) offset = 25 * Math.PI / 180;
                }

                const angle = baseAngle + offset;
                const x = 18 + R * Math.cos(angle) - 4.5;
                const y = 18 + R * Math.sin(angle) - 4.5;

                pinPositions[pinInfo.pinName] = { x: x, y: y };
            });
        });

        // Primeni pozicije na DOM elemente
        pinElements.forEach(pinEl => {
            const pinName = pinEl.getAttribute('data-pin-name');
            if (pinPositions[pinName]) {
                // Postavi inline stilove
                pinEl.style.left = `${pinPositions[pinName].x}px`;
                pinEl.style.top = `${pinPositions[pinName].y}px`;
                pinEl.style.bottom = 'auto'; // poništi CSS bottom pozicioniranje ako postoji
                pinEl.style.right = 'auto';  // poništi CSS right pozicioniranje ako postoji
            } else {
                // Resetuj na CSS default
                pinEl.style.left = '';
                pinEl.style.top = '';
                pinEl.style.bottom = '';
                pinEl.style.right = '';
            }
        });
    }
}
