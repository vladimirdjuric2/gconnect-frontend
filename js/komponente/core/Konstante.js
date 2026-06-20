/**
 * Konstante.js
 * Centralizovane konstante sistema — modeli, boje i ikone uređaja.
 *
 * Cilj: ukloniti razbacano (duplirano) hardkodovanje istih vrednosti kroz
 * EditorManager i komponente. Sva vizuelna i logička mapiranja drže se na
 * jednom mestu kako bi izmena bila jednokratna.
 */

// ---------------------------------------------------------------------------
// MODELI GNC KONTROLERA
// ---------------------------------------------------------------------------
// Mapiranje internih (starih) STM32 oznaka na komercijalne GNC modele.
export const GNC_MODEL_MAP = {
    STM32F401: 'GNC2444',
    STM32F103: 'GNC4444',
    STM32H743: 'GNC8884'
};

/**
 * Vraća komercijalni (prijateljski) naziv GNC modela.
 * Ako je naziv već u GNC formatu, vraća ga nepromenjenog.
 * @param {String} model Interna ili komercijalna oznaka modela
 * @returns {String} Komercijalni naziv (npr. 'GNC2444')
 */
export function friendlyGncModel(model) {
    if (!model) return 'GNC2444';
    return GNC_MODEL_MAP[model] || model;
}

// ---------------------------------------------------------------------------
// BOJE I IKONE UREĐAJA (po tipu)
// ---------------------------------------------------------------------------
// Boje se koriste za prilagođene kursore alata, ikone i šematske prikaze.
export const DEVICE_COLORS = {
    gnc: '#df49ff',
    pump: '#00ccff',
    valve: '#ff3366',
    gauge: '#00ffcc',
    flow_meter: '#38bdf8',
    pipe: '#ff8c00',
    wire: '#ef4444'
};

// FontAwesome ikone po tipu uređaja (mala ikonica na mapi).
export const DEVICE_ICONS = {
    gnc: 'fas fa-microchip',
    pump: 'fas fa-faucet-drip',
    valve: 'fas fa-shower',
    gauge: 'fas fa-gauge-high',
    flow_meter: 'fas fa-water'
};
