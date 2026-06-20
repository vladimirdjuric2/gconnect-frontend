/**
 * ComponentRegistry.js
 * Centralni registar svih komponenti sistema sa podrškom za kategorije
 * 
 * Omogućava dinamičko učitavanje i kreiranje komponenti,
 * organizovanih po kategorijama (irigacija, elektro, itd.)
 */
export class ComponentRegistry {
    static components = new Map();
    static categories = new Map();
    
    /**
     * Registruje novu komponentu u registar
     * @param {String} type Tip komponente (npr. 'valve', 'pump')
     * @param {Class} ComponentClass Klasa komponente
     * @param {String} category Kategorija (npr. 'irigacija', 'elektro')
     */
    static register(type, ComponentClass, category = 'default') {
        this.components.set(type, {
            class: ComponentClass,
            category: category
        });
        
        // Dodaj u kategoriju
        if (!this.categories.has(category)) {
            this.categories.set(category, []);
        }
        this.categories.get(category).push(type);
        
        console.log(`✅ Registrovana komponenta: ${type} (kategorija: ${category})`);
    }
    
    /**
     * Kreira novu instancu komponente
     * @param {String} type Tip komponente
     * @param {Object} data Inicijalni podaci
     * @returns {BaseComponent} Nova instanca komponente
     */
    static create(type, data = {}) {
        const entry = this.components.get(type);
        if (!entry) {
            throw new Error(`❌ Nepoznata komponenta: ${type}`);
        }
        return new entry.class(data);
    }
    
    /**
     * Vraća sve komponente iz određene kategorije
     * @param {String} category Naziv kategorije
     * @returns {Array} Niz tipova komponenti
     */
    static getByCategory(category) {
        return this.categories.get(category) || [];
    }
    
    /**
     * Vraća kategoriju za određeni tip komponente
     * @param {String} type Tip komponente
     * @returns {String} Naziv kategorije
     */
    static getCategoryForType(type) {
        const entry = this.components.get(type);
        return entry ? entry.category : null;
    }
    
    /**
     * Vraća sve kategorije
     * @returns {Array} Niz naziva kategorija
     */
    static getAllCategories() {
        return Array.from(this.categories.keys());
    }
    
    /**
     * Vraća sve tipove komponenti
     * @returns {Array} Niz tipova komponenti
     */
    static getAllTypes() {
        return Array.from(this.components.keys());
    }
    
    /**
     * Proverava da li tip komponente postoji u registru
     * @param {String} type Tip komponente
     * @returns {Boolean} True ako postoji
     */
    static has(type) {
        return this.components.has(type);
    }
    
    /**
     * Dinamičko učitavanje svih komponenti iz foldera
     * Ova metoda učitava sve komponente i registruje ih u sistem
     */
    static async autoLoadComponents() {
        console.log('🔄 Automatsko učitavanje komponenti...');
        
        try {
            // ================================================================
            // UČITAJ IRIGACIJA KOMPONENTE
            // ================================================================
            const { GncController } = await import('../irigacija/GncController.js?v=1.2.4');
            const { Pump } = await import('../irigacija/Pump.js?v=1.2.4');
            const { Valve } = await import('../irigacija/Valve.js?v=1.2.4');
            const { PressureGauge } = await import('../irigacija/PressureGauge.js?v=1.2.4');
            const { FlowMeter } = await import('../irigacija/FlowMeter.js?v=1.2.4');
            
            this.register('gnc', GncController, 'irigacija');
            this.register('pump', Pump, 'irigacija');
            this.register('valve', Valve, 'irigacija');
            this.register('gauge', PressureGauge, 'irigacija');
            this.register('flow_meter', FlowMeter, 'irigacija');
            
            // ================================================================
            // UČITAJ ELEKTRO KOMPONENTE (kada budu dostupne)
            // ================================================================
            // try {
            //     const { SolarPanel } = await import('../elektro/SolarPanel.js');
            //     const { Battery } = await import('../elektro/Battery.js');
            //     const { Inverter } = await import('../elektro/Inverter.js');
            //     
            //     this.register('solar_panel', SolarPanel, 'elektro');
            //     this.register('battery', Battery, 'elektro');
            //     this.register('inverter', Inverter, 'elektro');
            // } catch (e) {
            //     console.warn('⚠️ Elektro komponente nisu dostupne');
            // }
            
            console.log(`✅ Učitano ${this.components.size} komponenti u ${this.categories.size} kategorija`);
            console.log('📦 Dostupne kategorije:', Array.from(this.categories.keys()).join(', '));
            
        } catch (error) {
            console.error('❌ Greška pri učitavanju komponenti:', error);
            throw error;
        }
    }
    
    /**
     * Ispisuje statistiku registra u konzolu
     */
    static printStats() {
        console.log('═══════════════════════════════════════════════════════');
        console.log('📊 COMPONENT REGISTRY STATISTIKA');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`Ukupno komponenti: ${this.components.size}`);
        console.log(`Ukupno kategorija: ${this.categories.size}`);
        console.log('───────────────────────────────────────────────────────');
        
        this.categories.forEach((types, category) => {
            console.log(`📁 ${category.toUpperCase()} (${types.length} komponenti):`);
            types.forEach(type => {
                console.log(`   - ${type}`);
            });
        });
        
        console.log('═══════════════════════════════════════════════════════');
    }
}
