/**
 * Valve.js
 * Električki upravljani ventil za kontrolu protoka vode
 * Kategorija: IRIGACIJA
 */
import { BaseComponent } from '../core/BaseComponent.js';

export class Valve extends BaseComponent {
    constructor(data = {}) {
        super(data);
        this.type = 'valve';
        this.category = 'irigacija';
        this.status = data.status || 'closed';
        
        // Specifična svojstva ventila
        this.properties.promer = this.properties.promer || 'DN50';
        this.properties.port_pin = this.properties.port_pin || '';
    }
    
    // ========================================================================
    // PRIKAZ 1: MALA IKONICA (za geografsku mapu)
    // ========================================================================
    renderSmallIcon() {
        let colorClass = this.status === 'open'
            ? 'device-valve-open'
            : 'device-valve-closed';

        // Dodatna klasa ako je ventil selektovan za scenario
        if (window.editorManager &&
            window.editorManager.selectedValvesForScenario &&
            window.editorManager.selectedValvesForScenario.includes(this.id)) {
            colorClass += ' device-valve-selected-scenario';
        }

        return `
            <div class="device-icon-container ${colorClass}">
                <div class="device-label">${this.name}</div>
                <i class="fas fa-shower"></i>
                ${this.generateSmallIconPinsHtml()}
            </div>
        `;
    }
    
    // ========================================================================
    // PRIKAZ 2: PROŠIRENI PRIKAZ SA PINOVIMA (za šematski dijagram)
    // ========================================================================
    renderExpandedView() {
        const statusText = this.status === 'open' ? 'OTVOREN' : 'ZATVOREN';
        const statusColor = this.status === 'open' ? '#22c55e' : '#ef4444';
        
        return `
            <div class="component-schematic-view valve-schematic">
                <!-- Glavni kontejner -->
                <div class="schematic-component-body">
                    <!-- Gornji deo - naziv -->
                    <div class="schematic-header">
                        <span class="schematic-name">${this.name}</span>
                        <span class="schematic-type">VENTIL</span>
                    </div>
                    
                    <!-- Srednji deo - ikonica i status -->
                    <div class="schematic-icon-area">
                        <i class="fas fa-shower fa-3x" style="color: ${statusColor}"></i>
                        <div class="status-indicator ${this.status}" style="background: ${statusColor}; color: white; padding: 4px 8px; border-radius: 4px; margin-top: 8px; font-size: 10px; font-weight: bold;">
                            ${statusText}
                        </div>
                    </div>
                    
                    <!-- Donji deo - tehnički podaci -->
                    <div class="schematic-specs" style="font-size: 11px; color: #ced4da; margin-top: 8px;">
                        <div>Promer: ${this.properties.promer}</div>
                        <div>Port: ${this.properties.port_pin || 'N/A'}</div>
                    </div>
                </div>
                
                <!-- Pinovi oko komponente -->
                <div class="compact-device-pins">
                    <!-- Kontrolni ulaz (levo) -->
                    <div class="pin-socket input-pin" 
                         data-device-id="${this.id}" 
                         data-pin-name="IN"
                         style="position: absolute; top: 50%; left: -10px; transform: translateY(-50%);">
                        <div class="pin-label">IN</div>
                        <div class="pin-dot" style="width: 8px; height: 8px; background: #f59e0b; border-radius: 50%;"></div>
                    </div>
                    
                    <!-- Napajanje VCC (gore desno) -->
                    <div class="pin-socket power-pin" 
                         data-device-id="${this.id}" 
                         data-pin-name="VCC"
                         style="position: absolute; top: 10px; right: -10px;">
                        <div class="pin-label">VCC</div>
                        <div class="pin-dot" style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%;"></div>
                    </div>
                    
                    <!-- Uzemljenje GND (dole desno) -->
                    <div class="pin-socket ground-pin" 
                         data-device-id="${this.id}" 
                         data-pin-name="GND"
                         style="position: absolute; bottom: 10px; right: -10px;">
                        <div class="pin-label">GND</div>
                        <div class="pin-dot" style="width: 8px; height: 8px; background: #6b7280; border-radius: 50%;"></div>
                    </div>
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // PRIKAZ 3: MODAL ZA DETALJNO UREĐIVANJE
    // ========================================================================
    renderModalContent() {
        return {
            title: 'Podešavanje elektroventila',
            icon: 'fas fa-shower',
            iconColor: '#ff3366',
            sections: [
                {
                    name: 'basic',
                    title: 'Osnovni podaci',
                    fields: [
                        {
                            type: 'text',
                            id: 'valve-name',
                            label: 'Naziv ventila *',
                            value: this.name,
                            required: true,
                            placeholder: 'Unesite naziv...'
                        },
                        {
                            type: 'select',
                            id: 'valve-promer',
                            label: 'Promer elektroventila',
                            value: this.properties.promer,
                            options: [
                                { value: 'DN25', label: 'DN25 (1")' },
                                { value: 'DN32', label: 'DN32 (1 1/4")' },
                                { value: 'DN40', label: 'DN40 (1 1/2")' },
                                { value: 'DN50', label: 'DN50 (2")' }
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
                            id: 'valve-network-id',
                            label: 'Mrežna adresa (IP / ID)',
                            value: this.arduinoId,
                            placeholder: 'Npr. 192.168.1.100'
                        },
                        {
                            type: 'text',
                            id: 'valve-port-pin',
                            label: 'Naziv porta/pina',
                            value: this.properties.port_pin,
                            placeholder: 'Npr. GPIO22'
                        }
                    ]
                },
                {
                    name: 'controls',
                    title: 'Ručno preklapanje stanja',
                    customHtml: `
                        <div class="d-flex gap-2">
                            <button type="button" id="btn-valve-open" 
                                    class="btn btn-success flex-grow-1 font-weight-bold py-2" 
                                    style="font-size: 12px; opacity: ${this.status === 'open' ? '1' : '0.5'};">
                                <i class="fas fa-unlock"></i> OTVORI VENTIL
                            </button>
                            <button type="button" id="btn-valve-close" 
                                    class="btn btn-danger flex-grow-1 font-weight-bold py-2" 
                                    style="font-size: 12px; opacity: ${this.status === 'closed' ? '1' : '0.5'};">
                                <i class="fas fa-lock"></i> ZATVORI VENTIL
                            </button>
                        </div>
                    `
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
        return [
            { name: 'W_IN', type: 'water_input', required: true },
            { name: 'W_OUT', type: 'water_output', required: true },
            { name: 'IN', type: 'input', signal: 'control', required: true },
            { name: 'VCC', type: 'power', signal: 'power', voltage: '24V' },
            { name: 'GND', type: 'ground', signal: 'ground' }
        ];
    }
    
    validate() {
        const errors = [];
        if (!this.name || this.name.trim() === '') {
            errors.push('Naziv ventila je obavezan');
        }
        if (!this.properties.promer) {
            errors.push('Promer mora biti definisan');
        }
        return errors;
    }
    
    getMetadata() {
        return {
            displayName: 'Elektroventil',
            category: 'irigacija',
            icon: 'fas fa-shower',
            color: '#ff3366',
            description: 'Električki upravljani ventil za kontrolu protoka vode',
            manufacturer: 'Generic',
            version: '1.0.0'
        };
    }
}
