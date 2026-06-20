/**
 * ElektroVentil.js
 * Komponenta za elektroventil sa vodenim i električnim priključcima
 * Kategorija: IRIGACIJA
 */
import { BaseComponent } from '../core/BaseComponent.js';

export class ElektroVentil extends BaseComponent {
    constructor(data = {}) {
        super(data);
        this.type = 'elektroventil';
        this.category = 'irigacija';
        this.status = data.status || 'active';
        
        this.properties.state = this.properties.state || 'closed'; // NC (Normally Closed)
    }
    
    // ========================================================================
    // PRIKAZ 1: MALA IKONICA (za geografsku mapu)
    // ========================================================================
    renderSmallIcon() {
        return `
            <div class="valve-hybrid-container" data-device-id="${this.id}">
                <div class="device-icon-container device-valve-active valve-small-icon">
                    <div class="device-label">${this.name}</div>
                    <i class="fas fa-faucet"></i>
                    ${this.generateSmallIconPinsHtml()}
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // PRIKAZ 2: PROŠIRENI PRIKAZ SA PINOVIMA
    // ========================================================================
    renderExpandedView() {
        const pins = this._getPinConfiguration();
        
        const topPinsHtml = pins.top.map(pin => this._renderPin(pin)).join('');
        const leftPinsHtml = pins.left.map(pin => this._renderPin(pin)).join('');
        const rightPinsHtml = pins.right.map(pin => this._renderPin(pin)).join('');
        
        return `
            <div class="valve-schematic-container" data-device-id="${this.id}" style="width: 250px;">
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
                    
                    <div class="valve-schematic-core" onclick="window.editorManager.handleGncCoreClick('${this.id}', event)">
                        <div class="gnc-core-title">${this.name}</div>
                        <div class="valve-core-status" style="color: #ef4444;">
                            <i class="fas fa-power-off"></i> CMD
                        </div>
                    </div>
                    
                    <div class="gnc-schematic-column-side right-pins">
                        ${rightPinsHtml}
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
            title: 'Podešavanje Elektroventila',
            icon: 'fas fa-faucet',
            iconColor: '#ef4444',
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
                            placeholder: 'Npr. Ventil Zona 1'
                        },
                        {
                            type: 'select',
                            id: 'valve-state',
                            label: 'Početno stanje',
                            value: this.properties.state,
                            options: [
                                { value: 'closed', label: 'Normalno zatvoren (NC)' },
                                { value: 'open', label: 'Normalno otvoren (NO)' }
                            ]
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
        const config = this._getPinConfiguration();
        const allPins = [...config.top, ...config.left, ...config.right];
        
        return allPins.map(pin => ({
            name: pin.name,
            type: pin.type,
            signal: pin.signal || pin.type
        }));
    }

    getMetadata() {
        return {
            displayName: 'Elektroventil',
            category: 'irigacija',
            icon: 'fas fa-faucet',
            color: '#ef4444',
            description: 'Ventil za propuštanje vode kontrolisan GNC signalom',
            manufacturer: 'GimelNet',
            version: '1.0.0'
        };
    }
    
    // ========================================================================
    // PRIVATNE METODE
    // ========================================================================
    _getPinConfiguration() {
        return {
            top: [
                { name: 'CMD', type: 'electrical_input', color: '#f59e0b' } // Električna kontrola (signal sa releja)
            ],
            left: [
                { name: 'IN', type: 'water_input', color: '#3b82f6' } // Ulaz vode sa pumpe
            ],
            right: [
                { name: 'OUT', type: 'water_output', color: '#0ea5e9' } // Izlaz vode ka crevima
            ]
        };
    }
    
    _renderPin(pin) {
        return `
            <div class="pin-socket valve-pin-${pin.type}" 
                 data-device-id="${this.id}" 
                 data-pin-name="${pin.name}"
                 style="background-color: ${pin.color}; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; margin: 5px;"
                 onclick="window.editorManager.handlePinClick('${this.id}', '${pin.name}', event)">
                <span class="pin-label" style="font-size: 10px; color: #fff;">${pin.name}</span>
            </div>
        `;
    }
}