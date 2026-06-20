/**
 * FlowMeter.js
 * Merač protoka vode
 * Kategorija: IRIGACIJA
 */
import { BaseComponent } from '../core/BaseComponent.js';

export class FlowMeter extends BaseComponent {
    constructor(data = {}) {
        super(data);
        this.type = 'flow_meter';
        this.category = 'irigacija';
        this.status = data.status || 'active';
        
        // Specifična svojstva merača protoka
        this.properties.sensor_type = this.properties.sensor_type || 'pulse';
        this.properties.transfer_function = this.properties.transfer_function || '';
        this.properties.port_pin = this.properties.port_pin || '';
        this.sensorType = data.sensorType || 'pulse';
        this.calibrationStep = data.calibrationStep || 0.0022;
    }
    
    // ========================================================================
    // PRIKAZ 1: MALA IKONICA (za geografsku mapu)
    // ========================================================================
    renderSmallIcon() {
        return `
            <div class="device-icon-container device-flow-meter">
                <div class="device-label">${this.name}</div>
                <i class="fas fa-water"></i>
                ${this.generateSmallIconPinsHtml()}
            </div>
        `;
    }
    
    // ========================================================================
    // PRIKAZ 2: PROŠIRENI PRIKAZ SA PINOVIMA (za šematski dijagram)
    // ========================================================================
    renderExpandedView() {
        const sensorTypeText = {
            'pulse': 'Impulsni',
            '4_20ma': '4-20 mA',
            'analog': 'Analogni'
        }[this.properties.sensor_type] || 'N/A';
        
        return `
            <div class="component-schematic-view flowmeter-schematic">
                <!-- Glavni kontejner -->
                <div class="schematic-component-body">
                    <!-- Gornji deo - naziv -->
                    <div class="schematic-header">
                        <span class="schematic-name">${this.name}</span>
                        <span class="schematic-type">PROTOK</span>
                    </div>
                    
                    <!-- Srednji deo - ikonica -->
                    <div class="schematic-icon-area">
                        <i class="fas fa-water fa-3x" style="color: #38bdf8"></i>
                        <div class="status-indicator active" style="background: #38bdf8; color: white; padding: 4px 8px; border-radius: 4px; margin-top: 8px; font-size: 10px; font-weight: bold;">
                            AKTIVAN
                        </div>
                    </div>
                    
                    <!-- Donji deo - tehnički podaci -->
                    <div class="schematic-specs" style="font-size: 11px; color: #ced4da; margin-top: 8px;">
                        <div>Tip: ${sensorTypeText}</div>
                        <div>Kalibracija: ${this.calibrationStep}</div>
                        <div>Port: ${this.properties.port_pin || 'N/A'}</div>
                    </div>
                </div>
                
                <!-- Pinovi oko komponente -->
                <div class="compact-device-pins">
                    <!-- Signal (levo) -->
                    <div class="pin-socket signal-pin" 
                         data-device-id="${this.id}" 
                         data-pin-name="SIG"
                         style="position: absolute; top: 50%; left: -10px; transform: translateY(-50%);">
                        <div class="pin-label">SIG</div>
                        <div class="pin-dot" style="width: 8px; height: 8px; background: #3b82f6; border-radius: 50%;"></div>
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
            title: 'Podešavanje merača protoka',
            icon: 'fas fa-water',
            iconColor: '#38bdf8',
            sections: [
                {
                    name: 'basic',
                    title: 'Osnovni podaci',
                    fields: [
                        {
                            type: 'text',
                            id: 'sensor-name',
                            label: 'Naziv uređaja *',
                            value: this.name,
                            required: true,
                            placeholder: 'Unesite naziv...'
                        },
                        {
                            type: 'radio',
                            id: 'sensor-type',
                            label: 'Tip signala / Povezivanje',
                            value: this.properties.sensor_type,
                            options: [
                                { value: 'pulse', label: 'Impulsni' },
                                { value: '4_20ma', label: '4-20 mA' },
                                { value: 'analog', label: 'Analogni (0-3.3V/5V/10V)' }
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
                            id: 'sensor-network-id',
                            label: 'Mrežna adresa (IP / ID)',
                            value: this.arduinoId,
                            placeholder: 'Npr. 192.168.1.100'
                        },
                        {
                            type: 'text',
                            id: 'sensor-port-pin',
                            label: 'Naziv porta/pina',
                            value: this.properties.port_pin,
                            placeholder: 'Npr. DI1'
                        }
                    ]
                },
                {
                    name: 'formula',
                    title: 'Prelazna funkcija',
                    fields: [
                        {
                            type: 'textarea',
                            id: 'sensor-formula',
                            label: 'Python formula / prelazna funkcija',
                            value: this.properties.transfer_function || '',
                            rows: 6,
                            placeholder: '# Primer formule za konverziju impulsa u protok:\n# x = broj impulsa\n# y = protok u L/min\ny = x * 0.0022'
                        }
                    ]
                },
                {
                    name: 'monitor',
                    title: 'Praćenje u realnom vremenu',
                    customHtml: `
                        <button type="button" id="btn-show-analog-gauge" 
                                class="btn btn-outline-info w-100 font-weight-bold py-2" 
                                style="font-size: 12px; border-color: #38bdf8; color: #38bdf8;">
                            <i class="fas fa-gauge-high"></i> OTVORI ANALOGNI SAT
                        </button>
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
            { name: 'SIG', type: 'signal', signal: 'digital', required: true },
            { name: 'VCC', type: 'power', signal: 'power', voltage: '5V' },
            { name: 'GND', type: 'ground', signal: 'ground' }
        ];
    }
    
    validate() {
        const errors = [];
        if (!this.name || this.name.trim() === '') {
            errors.push('Naziv merača protoka je obavezan');
        }
        if (!this.properties.sensor_type) {
            errors.push('Tip senzora mora biti definisan');
        }
        return errors;
    }
    
    getMetadata() {
        return {
            displayName: 'Merač protoka',
            category: 'irigacija',
            icon: 'fas fa-water',
            color: '#38bdf8',
            description: 'Senzor za merenje protoka vode u sistemu',
            manufacturer: 'Generic',
            version: '1.0.0'
        };
    }
    
    // Override toJSON za dodavanje sensorType i calibrationStep
    toJSON() {
        return {
            ...super.toJSON(),
            sensorType: this.sensorType,
            calibrationStep: this.calibrationStep
        };
    }
}
