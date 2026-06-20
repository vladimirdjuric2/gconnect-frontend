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
