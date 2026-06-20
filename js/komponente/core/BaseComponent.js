/**
 * BaseComponent.js
 * Osnovna apstraktna klasa za sve komponente sistema
 * 
 * Svaka komponenta mora implementirati 3 različita prikaza:
 * 1. renderSmallIcon() - Mala ikonica za geografsku mapu
 * 2. renderExpandedView() - Prošireni prikaz sa pinovima za šematski dijagram
 * 3. renderModalContent() - Detaljna forma za uređivanje u modalu
 */
export class BaseComponent {
    constructor(data = {}) {
        this.id = data.id || 'dev_' + Date.now();
        this.type = ''; // mora biti override-ovan u podklasi
        this.category = ''; // mora biti override-ovan u podklasi
        this.name = data.name || '';
        this.arduinoId = data.arduinoId || '';
        this.lat = data.lat;
        this.lng = data.lng;
        this.status = data.status || 'inactive';
        this.properties = data.properties || {};
        this.properties.pinAngles = this.properties.pinAngles || {};
    }
    
    // ========================================================================
    // APSTRAKTNE METODE - MORAJU biti implementirane u podklasama
    // ========================================================================
    
    /**
     * Prikaz 1: Mala ikonica za geografsku mapu
     * @returns {String} HTML string za malu ikonicu
     */
    renderSmallIcon() {
        throw new Error('renderSmallIcon() mora biti implementiran u podklasi');
    }
    
    /**
     * Prikaz 2: Prošireni prikaz sa pinovima za šematski dijagram
     * @returns {String} HTML string za prošireni prikaz
     */
    renderExpandedView() {
        throw new Error('renderExpandedView() mora biti implementiran u podklasi');
    }
    
    /**
     * Prikaz 3: Modal za detaljno uređivanje
     * @returns {Object} Objekat sa podacima za modal (title, sections, buttons)
     */
    renderModalContent() {
        throw new Error('renderModalContent() mora biti implementiran u podklasi');
    }
    
    // ========================================================================
    // POMOĆNE METODE - Opciono override-ovati u podklasama
    // ========================================================================
    
    /**
     * Vraća listu pinova komponente
     * @returns {Array} Niz objekata sa definicijom pinova
     */
    getPins() {
        return [];
    }

    /**
     * Generiše CSS poziciju rotiranog noda (pina)
     * @param {String} pinName Naziv pina (npr. 'OUT', 'VCC')
     * @param {Number} defaultAngle Ugao (0-359) na kom se nalazi ako nije promenjeno
     * @param {Number} radius Udaljenost od centra (default: 18 za postavljanje tačno na ivicu)
     * @returns {String} In-line CSS stil za pozicioniranje
     */
    getPinStyle(pinName, defaultAngle, radius = 18) {
        let angle = defaultAngle;
        if (this.properties.pinAngles && typeof this.properties.pinAngles[pinName] !== 'undefined') {
            angle = this.properties.pinAngles[pinName];
        }
        
        // CSS transform logika: 
        // 1. Odemo u centar ikonice (top: 50%, left: 50%)
        // 2. Pomerimo transform-origin u centar pina: transform: translate(-50%, -50%)
        // 3. Rotiramo se na traženi ugao oko centra ikonice
        // 4. Pomerimo se duž Y ose za radijus: translateY(-radius)
        // 5. Rotiramo kontranazad kako sam pin ne bi bio nakrivljen: rotate(-ugao)
        
        return `top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px) rotate(-${angle}deg);`;
    }

    /**
     * Automatski generiše HTML za sve pinove za prikaz male ikonice komponente.
     * Pinovi se raspoređuju kružno oko komponente ukoliko im ugao nije ručno postavljen.
     */
    generateSmallIconPinsHtml() {
        const pins = this.getPins();
        if (!pins || pins.length === 0) return '';
        
        let html = '<div class="compact-device-pins">';
        
        pins.forEach((pin, index) => {
            // Podrazumevani ugao kako bi se pinovi ravnomerno rasporedili u krug
            const defaultAngle = index * (360 / pins.length);
            
            // Da li je vodeni pin
            const isWater = pin.type === 'water_in' || pin.type === 'water_out' || pin.type === 'water_input' || pin.type === 'water_output';
            const pinClass = isWater ? 'water-pin-socket' : 'compact-pin-socket';
            const clickHandler = isWater ? 'handleWaterPinClick' : 'handlePinClick';
            
            // Oznaka na pinu se malo razlikuje za vodu
            const label = isWater ? (pin.type === 'water_in' ? 'Ulaz vode' : 'Izlaz vode') : pin.name;
            
            html += `
                <div class="${pinClass} pin-${pin.name.toLowerCase()}" 
                     data-device-id="${this.id}" 
                     data-pin-name="${pin.name}" 
                     data-pin-label="${label}" 
                     onclick="window.editorManager.${clickHandler}('${this.id}', '${pin.name}', this, event)" 
                     style="${this.getPinStyle(pin.name, defaultAngle, 18)}"></div>
            `;
        });
        
        html += '</div>';
        return html;
    }
    
    /**
     * Validira podatke komponente
     * @returns {Array} Niz string-ova sa greškama (prazan ako je validno)
     */
    validate() {
        return [];
    }
    
    /**
     * Vraća metapodatke o komponenti
     * @returns {Object} Objekat sa displayName, category, icon, color, etc.
     */
    getMetadata() {
        return {
            displayName: this.type,
            category: this.category,
            icon: 'fas fa-cube',
            color: '#666666',
            description: 'Komponenta sistema',
            version: '1.0.0'
        };
    }
    
    // ========================================================================
    // STANDARDNE METODE
    // ========================================================================
    
    /**
     * Serijalizuje komponentu u JSON objekat za čuvanje
     * @returns {Object} Plain JavaScript objekat
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            name: this.name,
            arduinoId: this.arduinoId,
            lat: this.lat,
            lng: this.lng,
            status: this.status,
            properties: { ...this.properties }
        };
    }
    
    /**
     * Vraća kratak rezime komponente
     * @returns {String} Tekstualni rezime
     */
    getSummary() {
        return `${this.name} (${this.type}) - Status: ${this.status}`;
    }
    
    /**
     * Ažurira podatke komponente iz objekta
     * @param {Object} data Objekat sa novim podacima
     */
    update(data) {
        if (data.name !== undefined) this.name = data.name;
        if (data.arduinoId !== undefined) this.arduinoId = data.arduinoId;
        if (data.lat !== undefined) this.lat = data.lat;
        if (data.lng !== undefined) this.lng = data.lng;
        if (data.status !== undefined) this.status = data.status;
        if (data.properties !== undefined) {
            this.properties = { ...this.properties, ...data.properties };
        }
    }
}
