/**
 * GncController.js
 * Programabilni STM32 kontroler (GNC) za upravljanje sistemom navodnjavanja
 * Kategorija: IRIGACIJA
 */
import { BaseComponent } from '../core/BaseComponent.js';
import { friendlyGncModel } from '../core/Konstante.js';

export class GncController extends BaseComponent {
    constructor(data = {}) {
        super(data);
        this.type = 'gnc';
        this.category = 'irigacija';
        this.status = data.status || 'active';
        
        // Inicijalizacija podrazumevanih svojstava za GNC
        this.properties.gnc_model = this.properties.gnc_model || 'GNC2444';
        this.properties.port_pin = this.properties.port_pin || '';
        this.properties.gnc_logic = this.properties.gnc_logic || '';
        this.properties.remember_position = this.properties.remember_position || false;
        this.properties.panel_left = this.properties.panel_left || null;
        this.properties.panel_top = this.properties.panel_top || null;
    }
    
    // ========================================================================
    // PRIKAZ 1: MALA IKONICA (za geografsku mapu)
    // ========================================================================
    renderSmallIcon() {
        return `
            <div class="gnc-hybrid-container" data-device-id="${this.id}">
                <!-- Mala ikonica (Podrazumevano prikazana) -->
                <div class="device-icon-container device-gnc-active gnc-small-icon">
                    <div class="device-label">${this.name}</div>
                    <i class="fas fa-microchip"></i>
                    ${this.generateSmallIconPinsHtml()}
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // PRIKAZ 2: PROŠIRENI PRIKAZ SA PINOVIMA (za šematski dijagram)
    // ========================================================================
    renderExpandedView() {
        const friendlyModel = friendlyGncModel(this.properties.gnc_model);

        const pins = this._getPinConfiguration(friendlyModel);
        
        // Generisanje HTML-a za pinove po stranama
        const topPinsHtml = pins.top.map(pin => this._renderPin(pin)).join('');
        const bottomPinsHtml = pins.bottom.map(pin => this._renderPin(pin)).join('');
        const leftPinsHtml = pins.left.map(pin => this._renderPin(pin)).join('');
        const rightPinsHtml = pins.right.map(pin => this._renderPin(pin)).join('');
        
        return `
            <div class="gnc-schematic-container" data-device-id="${this.id}">
                <div class="gnc-schematic-close" onclick="window.editorManager.closeGncSchematic(event)">
                    <i class="fas fa-times"></i>
                </div>
                
                <div class="gnc-schematic-row top-pins">
                    ${topPinsHtml}
                </div>
                
                <div class="gnc-schematic-middle">
                    <div class="gnc-schematic-column-side left-pins">
                        ${leftPinsHtml}
                    </div>
                    
                    <div class="gnc-schematic-core" onclick="window.editorManager.handleGncCoreClick('${this.id}', event)">
                        <div class="gnc-core-title">${this.name}</div>
                        <div class="gnc-core-model">${friendlyModel}</div>
                        <div class="gnc-core-status">
                            <i class="fas fa-circle"></i> LIVE
                        </div>
                    </div>
                    
                    <div class="gnc-schematic-column-side right-pins">
                        ${rightPinsHtml}
                    </div>
                </div>
                
                <div class="gnc-schematic-row bottom-pins">
                    ${bottomPinsHtml}
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // PRIKAZ 3: MODAL ZA DETALJNO UREĐIVANJE
    // ========================================================================
    renderModalContent() {
        return {
            title: 'Podešavanje GNC Kontrolera',
            icon: 'fas fa-microchip',
            iconColor: '#df49ff',
            sections: [
                {
                    name: 'basic',
                    title: 'Osnovni podaci',
                    fields: [
                        {
                            type: 'text',
                            id: 'gnc-name',
                            label: 'Naziv uređaja *',
                            value: this.name,
                            required: true,
                            placeholder: 'Unesite naziv...'
                        },
                        {
                            type: 'select',
                            id: 'gnc-model',
                            label: 'Model slave uređaja',
                            value: this.properties.gnc_model,
                            options: [
                                { value: 'GNC2444', label: 'GNC2444' },
                                { value: 'GNC4444', label: 'GNC4444' },
                                { value: 'GNC8884', label: 'GNC8884' }
                            ]
                        }
                    ]
                },
                {
                    name: 'network',
                    title: 'Mrežna konfiguracija',
                    fields: [
                        {
                            type: 'text',
                            id: 'gnc-network-id',
                            label: 'Mrežna adresa (IP / ID)',
                            value: this.arduinoId,
                            placeholder: 'Npr. 192.168.1.150'
                        },
                        {
                            type: 'hidden',
                            id: 'gnc-port-pin',
                            value: this.properties.port_pin || ''
                        }
                    ]
                },
                {
                    name: 'settings',
                    title: 'Podešavanja',
                    fields: [
                        {
                            type: 'checkbox',
                            id: 'gnc-remember-position',
                            label: 'Zapamti poziciju panela sa pinovima na mapi',
                            checked: this.properties.remember_position
                        }
                    ]
                },
                {
                    name: 'logic',
                    title: 'Znanje Kontrolera (Programska logika / Pravila)',
                    fields: [
                        {
                            type: 'textarea',
                            id: 'gnc-logic',
                            value: this.properties.gnc_logic || '',
                            rows: 6,
                            placeholder: '# Primer logike rada GNC kontrolera:\n# Možete pisati uslove i definisati pravila ponašanja.\nIF pritisak_glavni > 4.2 THEN iskljuci_pumpu_1\nIF vlaznost_zemlje < 30% THEN otvori_ventil_A\nIF protok_vode == 0 THEN javi_gresku'
                        }
                    ]
                }
            ],
            buttons: [
                { id: 'delete', label: 'UKLONI', class: 'btn-danger', icon: 'fas fa-trash-alt' },
                { id: 'cancel', label: 'ODUSTANI', class: 'btn-secondary' },
                { id: 'save', label: 'SAČUVAJ', class: 'btn-primary', icon: 'fas fa-save' }
            ]
        };
    }
    
    // ========================================================================
    // POMOĆNE METODE
    // ========================================================================
    
    getPins() {
        const friendlyModel = friendlyGncModel(this.properties.gnc_model);

        const config = this._getPinConfiguration(friendlyModel);
        const allPins = [...config.top, ...config.bottom, ...config.left, ...config.right];
        
        return allPins.map(pin => ({
            name: pin.name,
            type: pin.type,
            signal: pin.signal || pin.type
        }));
    }
    
    validate() {
        const errors = [];
        if (!this.name || this.name.trim() === '') {
            errors.push('Naziv GNC kontrolera je obavezan');
        }
        if (!this.properties.gnc_model) {
            errors.push('Model GNC-a mora biti definisan');
        }
        return errors;
    }
    
    getMetadata() {
        return {
            displayName: 'GNC Kontroler',
            category: 'irigacija',
            icon: 'fas fa-microchip',
            color: '#df49ff',
            description: 'Programabilni STM32 kontroler za upravljanje sistemom',
            manufacturer: 'GimelNet',
            version: '1.0.0'
        };
    }
    
    getSummary() {
        const friendlyModel = friendlyGncModel(this.properties.gnc_model);
        return `${this.name} (${friendlyModel}) - Mreža: ${this.arduinoId || 'Nema IP'}`;
    }
    
    // ========================================================================
    // PRIVATNE METODE
    // ========================================================================
    
    _getPinConfiguration(model) {
        const configs = {
            'GNC2444': {
                top: [
                    { name: 'VCC', type: 'power', color: '#ef4444' },
                    { name: 'A1', type: 'analog_input', color: '#22c55e' },
                    { name: 'A2', type: 'analog_input', color: '#22c55e' }
                ],
                bottom: [
                    { name: 'GND', type: 'ground', color: '#6b7280' },
                    { name: 'DI1', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI2', type: 'digital_input', color: '#3b82f6' }
                ],
                left: [
                    { name: 'R1', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R2', type: 'relay_output', color: '#f59e0b' }
                ],
                right: [
                    { name: 'DO1', type: 'digital_output', color: '#8b5cf6' },
                    { name: 'DO2', type: 'digital_output', color: '#8b5cf6' }
                ]
            },
            'GNC4444': {
                top: [
                    { name: 'VCC', type: 'power', color: '#ef4444' },
                    { name: 'A1', type: 'analog_input', color: '#22c55e' },
                    { name: 'A2', type: 'analog_input', color: '#22c55e' },
                    { name: 'A3', type: 'analog_input', color: '#22c55e' },
                    { name: 'A4', type: 'analog_input', color: '#22c55e' }
                ],
                bottom: [
                    { name: 'GND', type: 'ground', color: '#6b7280' },
                    { name: 'DI1', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI2', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI3', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI4', type: 'digital_input', color: '#3b82f6' }
                ],
                left: [
                    { name: 'R1', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R2', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R3', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R4', type: 'relay_output', color: '#f59e0b' }
                ],
                right: [
                    { name: 'DO1', type: 'digital_output', color: '#8b5cf6' },
                    { name: 'DO2', type: 'digital_output', color: '#8b5cf6' },
                    { name: 'DO3', type: 'digital_output', color: '#8b5cf6' },
                    { name: 'DO4', type: 'digital_output', color: '#8b5cf6' }
                ]
            },
            'GNC8884': {
                top: [
                    { name: 'VCC', type: 'power', color: '#ef4444' },
                    { name: 'A1', type: 'analog_input', color: '#22c55e' },
                    { name: 'A2', type: 'analog_input', color: '#22c55e' },
                    { name: 'A3', type: 'analog_input', color: '#22c55e' },
                    { name: 'A4', type: 'analog_input', color: '#22c55e' },
                    { name: 'A5', type: 'analog_input', color: '#22c55e' },
                    { name: 'A6', type: 'analog_input', color: '#22c55e' },
                    { name: 'A7', type: 'analog_input', color: '#22c55e' },
                    { name: 'A8', type: 'analog_input', color: '#22c55e' }
                ],
                bottom: [
                    { name: 'GND', type: 'ground', color: '#6b7280' },
                    { name: 'DI1', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI2', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI3', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI4', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI5', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI6', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI7', type: 'digital_input', color: '#3b82f6' },
                    { name: 'DI8', type: 'digital_input', color: '#3b82f6' }
                ],
                left: [
                    { name: 'R1', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R2', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R3', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R4', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R5', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R6', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R7', type: 'relay_output', color: '#f59e0b' },
                    { name: 'R8', type: 'relay_output', color: '#f59e0b' }
                ],
                right: [
                    { name: 'DO1', type: 'digital_output', color: '#8b5cf6' },
                    { name: 'DO2', type: 'digital_output', color: '#8b5cf6' },
                    { name: 'DO3', type: 'digital_output', color: '#8b5cf6' },
                    { name: 'DO4', type: 'digital_output', color: '#8b5cf6' }
                ]
            }
        };
        
        return configs[model] || configs['GNC2444'];
    }
    
    _renderPin(pin) {
        return `
            <div class="pin-socket gnc-pin-${pin.type}" 
                 data-device-id="${this.id}" 
                 data-pin-name="${pin.name}"
                 style="background-color: ${pin.color};"
                 onclick="window.editorManager.handlePinClick('${this.id}', '${pin.name}', event)">
                <span class="pin-label">${pin.name}</span>
            </div>
        `;
    }
}
