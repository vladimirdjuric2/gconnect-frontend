/**
 * Pump.js
 * Pumpa za vodu sa kontrolom rada
 * Kategorija: IRIGACIJA
 */
import { BaseComponent } from '../core/BaseComponent.js';

export class Pump extends BaseComponent {
    constructor(data = {}) {
        super(data);
        this.type = 'pump';
        this.category = 'irigacija';
        this.status = data.status || 'off';
        
        // Specifična svojstva pumpe
        this.properties.max_capacity = this.properties.max_capacity || null;
        this.properties.port_pin = this.properties.port_pin || '';
    }
    
    // ========================================================================
    // PRIKAZ 1: MALA IKONICA (za geografsku mapu)
    // ========================================================================
    renderSmallIcon() {
        const colorClass = this.status === 'on'
            ? 'device-pump-on'
            : 'device-pump';

        return `
            <div class="device-icon-container ${colorClass}">
                <div class="device-label">${this.name}</div>
                <i class="fas fa-faucet-drip"></i>
                <div class="compact-device-pins">
                    <div class="compact-pin-socket pin-ctrl" data-device-id="${this.id}" data-pin-name="CTRL" data-pin-label="CTRL" onclick="window.editorManager.handlePinClick('${this.id}', 'CTRL', this, event)"></div>
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // PRIKAZ 2: PROŠIRENI PRIKAZ SA PINOVIMA (za šematski dijagram)
    // ========================================================================
    renderExpandedView() {
        const statusText = this.status === 'on' ? 'UKLJUČENA' : 'ISKLJUČENA';
        const statusColor = this.status === 'on' ? '#22c55e' : '#6b7280';
        const capacityText = this.properties.max_capacity 
            ? `${this.properties.max_capacity} m³/h` 
            : 'N/A';
        
        return `
            <div class="component-schematic-view pump-schematic">
                <!-- Glavni kontejner -->
                <div class="schematic-component-body">
                    <!-- Gornji deo - naziv -->
                    <div class="schematic-header">
                        <span class="schematic-name">${this.name}</span>
                        <span class="schematic-type">PUMPA</span>
                    </div>
                    
                    <!-- Srednji deo - ikonica i status -->
                    <div class="schematic-icon-area">
                        <i class="fas fa-faucet-drip fa-3x" style="color: ${statusColor}"></i>
                        <div class="status-indicator ${this.status}" style="background: ${statusColor}; color: white; padding: 4px 8px; border-radius: 4px; margin-top: 8px; font-size: 10px; font-weight: bold;">
                            ${statusText}
                        </div>
                    </div>
                    
                    <!-- Donji deo - tehnički podaci -->
                    <div class="schematic-specs" style="font-size: 11px; color: #ced4da; margin-top: 8px;">
                        <div>Kapacitet: ${capacityText}</div>
                        <div>Port: ${this.properties.port_pin || 'N/A'}</div>
                    </div>
                </div>
                
                <!-- Pinovi oko komponente -->
                <div class="compact-device-pins">
                    <!-- Kontrolni ulaz (levo) -->
                    <div class="pin-socket input-pin" 
                         data-device-id="${this.id}" 
                         data-pin-name="CTRL"
                         style="position: absolute; top: 50%; left: -10px; transform: translateY(-50%);">
                        <div class="pin-label">CTRL</div>
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
            title: 'Podešavanje pumpe za vodu',
            icon: 'fas fa-faucet-drip',
            iconColor: '#00ccff',
            sections: [
                {
                    name: 'basic',
                    title: 'Osnovni podaci',
                    fields: [
                        {
                            type: 'text',
                            id: 'pump-name',
                            label: 'Naziv pumpe *',
                            value: this.name,
                            required: true,
                            placeholder: 'Unesite naziv...'
                        },
                        {
                            type: 'number',
                            id: 'pump-capacity',
                            label: 'Maksimalni kapacitet (m³/h)',
                            value: this.properties.max_capacity || '',
                            step: 0.1,
                            placeholder: 'Npr. 15.0'
                        }
                    ]
                },
                {
                    name: 'network',
                    title: 'Mrežna konfiguracija',
                    fields: [
                        {
                            type: 'text',
                            id: 'pump-network-id',
                            label: 'Mrežna adresa (IP / ID)',
                            value: this.arduinoId,
                            placeholder: 'Npr. 192.168.1.100'
                        },
                        {
                            type: 'text',
                            id: 'pump-port-pin',
                            label: 'Naziv porta/pina',
                            value: this.properties.port_pin,
                            placeholder: 'Npr. GPIO21'
                        }
                    ]
                },
                {
                    name: 'controls',
                    title: 'Ručna kontrola rada',
                    customHtml: `
                        <div class="d-flex gap-2">
                            <button type="button" id="btn-pump-on" 
                                    class="btn btn-success flex-grow-1 font-weight-bold py-2" 
                                    style="font-size: 12px; opacity: ${this.status === 'on' ? '1' : '0.5'};">
                                <i class="fas fa-play"></i> UKLJUČI PUMPU
                            </button>
                            <button type="button" id="btn-pump-off" 
                                    class="btn btn-danger flex-grow-1 font-weight-bold py-2" 
                                    style="font-size: 12px; opacity: ${this.status === 'off' ? '1' : '0.5'};">
                                <i class="fas fa-stop"></i> ISKLJUČI PUMPU
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
            { name: 'CTRL', type: 'input', signal: 'control', required: true },
            { name: 'VCC', type: 'power', signal: 'power', voltage: '220V' },
            { name: 'GND', type: 'ground', signal: 'ground' }
        ];
    }
    
    validate() {
        const errors = [];
        if (!this.name || this.name.trim() === '') {
            errors.push('Naziv pumpe je obavezan');
        }
        return errors;
    }
    
    getMetadata() {
        return {
            displayName: 'Pumpa za vodu',
            category: 'irigacija',
            icon: 'fas fa-faucet-drip',
            color: '#00ccff',
            description: 'Pumpa za vodu sa elektromotornim pogonom',
            manufacturer: 'Generic',
            version: '1.0.0'
        };
    }
}
