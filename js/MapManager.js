/**
 * MapManager - Upravlja inicijalizacijom Leaflet mape i promenom slojeva (Satelit/Obična)
 */
export class MapManager {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.options = Object.assign({
            zoomControl: false,
            center: [0, 0],
            zoom: 2,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            wheelPxPerZoomLevel: 240
        }, options);
        
        this.map = null;
        this.layers = {};
        this.currentLayerKey = 'hybrid';
        
        this.init();
    }
    
    /**
     * Inicijalizuje mapu, dodaje Google Hybrid i OSM slojeve, i postavlja Zoom kontrolu
     */
    init() {
        this.map = L.map(this.containerId, {
            zoomControl: this.options.zoomControl,
            zoomSnap: this.options.zoomSnap,
            zoomDelta: this.options.zoomDelta,
            wheelPxPerZoomLevel: this.options.wheelPxPerZoomLevel
        }).setView(this.options.center, this.options.zoom);
        
        // Google Hybrid Satelitski sloj
        this.layers.hybrid = L.tileLayer('https://mt0.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}', {
            attribution: 'Map data &copy; Google',
            maxZoom: 20
        });
        
        // OpenStreetMap sloj
        this.layers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        });
        
        // Postavi defaultni sloj na satelitski
        this.layers.hybrid.addTo(this.map);
        
        // Dodavanje zoom kontrole dole desno
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    }
    
    /**
     * Menja trenutno aktivni sloj na mapi (Satelit <-> Obična) i ažurira tekst dugmeta
     * @param {HTMLElement} btnElement Dugme čiji tekst treba promeniti
     */
    toggleLayer(btnElement) {
        if (this.currentLayerKey === 'hybrid') {
            this.map.removeLayer(this.layers.hybrid);
            this.map.addLayer(this.layers.osm);
            this.currentLayerKey = 'osm';
            if (btnElement) {
                btnElement.innerText = "Mapa: Obična";
            }
        } else {
            this.map.removeLayer(this.layers.osm);
            this.map.addLayer(this.layers.hybrid);
            this.currentLayerKey = 'hybrid';
            if (btnElement) {
                btnElement.innerText = "Mapa: Satelit";
            }
        }
    }
    
    /**
     * Vraća Leaflet map instancu
     * @returns {L.Map}
     */
    getMapInstance() {
        return this.map;
    }
}
