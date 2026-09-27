// --- Multi-Revier & Super-Admin Data Store with Firebase Cloud Sync ---
let activeRevierCode = localStorage.getItem('jagdapp_active_revier_code') || null;

// Firebase Configuration & Initialization
const firebaseConfig = {
    apiKey: "AIzaSyB-JagdAppDefaultKey2026Sync",
    authDomain: "jagdapp-cloud.firebaseapp.com",
    projectId: "jagdapp-cloud",
    storageBucket: "jagdapp-cloud.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:jagdapp2026"
};

let firestoreDB = null;
let activeRevierUnsubscribe = null;
let isRemoteUpdating = false;

if (typeof firebase !== 'undefined') {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        firestoreDB = firebase.firestore();
        firestoreDB.enablePersistence({ synchronizeTabs: true }).catch(err => {
            console.warn('Firestore offline persistence warning:', err);
        });
    } catch (e) {
        console.warn('Firebase initialization:', e);
    }
}

const db = {
    getActiveRevierCode: () => activeRevierCode,
    setActiveRevierCode: (code) => {
        activeRevierCode = code;
        if (code) {
            localStorage.setItem('jagdapp_active_revier_code', code);
        } else {
            localStorage.removeItem('jagdapp_active_revier_code');
        }
        if (typeof updateRevierBadgeUI === 'function') {
            updateRevierBadgeUI();
        }
        if (typeof subscribeToRevierCloudSync === 'function' && code) {
            subscribeToRevierCloudSync(code);
        }
    },

    getAllReviere: () => {
        let all = JSON.parse(localStorage.getItem('jagdapp_all_reviere') || '{}');
        // Auto-migration for legacy single-revier data
        const legacyData = JSON.parse(localStorage.getItem('jagdapp_data') || '[]');
        if (Object.keys(all).length === 0 && legacyData.length > 0) {
            const defaultCode = 'REV-HAUPTREVIER';
            all[defaultCode] = {
                code: defaultCode,
                name: 'Hauptrevier',
                created: new Date().toISOString(),
                lastModified: new Date().toISOString(),
                layers: legacyData
            };
            localStorage.setItem('jagdapp_all_reviere', JSON.stringify(all));
            if (!activeRevierCode) {
                db.setActiveRevierCode(defaultCode);
            }
        }
        return all;
    },

    getRevier: (code) => {
        const all = db.getAllReviere();
        return all[code] || null;
    },

    createRevier: (name, customCode) => {
        const all = db.getAllReviere();
        let code = (customCode || ('REV-' + Math.random().toString(36).substr(2, 4).toUpperCase())).trim().toUpperCase();
        if (all[code]) {
            code = 'REV-' + Math.random().toString(36).substr(2, 5).toUpperCase();
        }
        const newRevier = {
            code: code,
            name: name || ('Revier ' + code),
            created: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            layers: []
        };
        all[code] = newRevier;
        localStorage.setItem('jagdapp_all_reviere', JSON.stringify(all));
        
        // Sync to Cloud Firestore
        if (firestoreDB) {
            firestoreDB.collection('reviere').doc(code).set({
                code: code,
                name: newRevier.name,
                created: newRevier.created,
                lastModified: newRevier.lastModified,
                layers: []
            }, { merge: true }).catch(err => {
                console.warn('Firestore create revier:', err);
            });
        }

        db.setActiveRevierCode(code);
        return newRevier;
    },

    saveLayersForActiveRevier: (layers) => {
        if (!activeRevierCode) return;
        const all = db.getAllReviere();
        if (!all[activeRevierCode]) {
            all[activeRevierCode] = {
                code: activeRevierCode,
                name: 'Revier ' + activeRevierCode,
                created: new Date().toISOString(),
                layers: []
            };
        }
        all[activeRevierCode].layers = layers;
        all[activeRevierCode].lastModified = new Date().toISOString();
        localStorage.setItem('jagdapp_all_reviere', JSON.stringify(all));

        // Sync to Cloud Firestore if change originated locally
        if (firestoreDB && !isRemoteUpdating) {
            firestoreDB.collection('reviere').doc(activeRevierCode).set({
                code: activeRevierCode,
                name: all[activeRevierCode].name || ('Revier ' + activeRevierCode),
                lastModified: new Date().toISOString(),
                layers: layers
            }, { merge: true }).catch(err => {
                console.warn('Firestore sync save error:', err);
            });
        }
    },

    loadLayers: () => {
        if (!activeRevierCode) return [];
        const revier = db.getRevier(activeRevierCode);
        return revier ? (revier.layers || []) : [];
    },

    deleteRevier: (code) => {
        const all = db.getAllReviere();
        delete all[code];
        localStorage.setItem('jagdapp_all_reviere', JSON.stringify(all));
        if (firestoreDB) {
            firestoreDB.collection('reviere').doc(code).delete().catch(e => console.warn('Firestore delete:', e));
        }
        if (activeRevierCode === code) {
            db.setActiveRevierCode(null);
        }
    },

    clear: () => {
        if (activeRevierCode) {
            db.saveLayersForActiveRevier([]);
        }
    }
};

let currentUser = null;

// --- DOM Elements ---
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authSection = document.getElementById('auth-section');
const userSection = document.getElementById('user-section');
const userEmailSpan = document.getElementById('user-email');
const inviteBtn = document.getElementById('invite-btn');
const inviteEmail = document.getElementById('invite-email');

// --- Modal Elements ---
const facilityModal = document.getElementById('facility-modal');
const facilityBtns = document.querySelectorAll('.facility-btn');
const cancelFacilityBtn = document.getElementById('cancel-facility-btn');
const facilityNameInput = document.getElementById('facility-name');
let pendingMarker = null;

const pathModal = document.getElementById('path-modal');
const pathBtns = document.querySelectorAll('.path-btn');
const cancelPathBtn = document.getElementById('cancel-path-btn');
const pathNameInput = document.getElementById('path-name');
let pendingPolyline = null;

const polygonModal = document.getElementById('polygon-modal');
const polygonBtns = document.querySelectorAll('.polygon-btn');
const cancelPolygonBtn = document.getElementById('cancel-polygon-btn');
const polygonNameInput = document.getElementById('polygon-name');
let pendingPolygon = null;

function getFacilityIcon(type) {
    let emoji = '📍';
    if (type === 'Ansitz') emoji = '🪑';
    if (type === 'Wildkamera') emoji = '📷';
    if (type === 'Kirrung') emoji = '🌽';
    
    return L.divIcon({
        className: 'custom-facility-icon',
        html: emoji,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -18]
    });
}

// Modal Logik
facilityBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        if (pendingMarker) {
            // Marker aktualisieren
            pendingMarker.setIcon(getFacilityIcon(type));
            if (!pendingMarker.jagdappId) {
                pendingMarker.jagdappId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
                pendingMarker.reservations = [];
            }
            pendingMarker.jagdappType = type; // Für späteres Speichern
            pendingMarker.jagdappName = facilityNameInput.value.trim();
            
            updateMarkerPopup(pendingMarker);
            pendingMarker.openPopup();
            
            // In DB speichern durch Update aller Layer, da es existierend oder neu sein kann
            if (typeof updateAllLayersInDB === 'function') {
                updateAllLayersInDB();
            }
            
            pendingMarker = null;
        }
        facilityModal.classList.add('hidden');
    });
});

if (cancelFacilityBtn) {
    cancelFacilityBtn.addEventListener('click', () => {
        if (pendingMarker) {
            if (!pendingMarker.jagdappId) {
                map.removeLayer(pendingMarker);
                drawnItems.removeLayer(pendingMarker);
            }
            pendingMarker = null;
        }
        facilityModal.classList.add('hidden');
    });
}

// Path Modal Logik
pathBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        if (pendingPolyline) {
            if (!pendingPolyline.jagdappId) {
                pendingPolyline.jagdappId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
            }
            pendingPolyline.jagdappType = type;
            pendingPolyline.jagdappName = pathNameInput.value.trim();
            
            if (type === 'Pirschweg') {
                pendingPolyline.setStyle({ color: '#8b4513', dashArray: '5, 10', weight: 3 });
            } else if (type === 'Zaun') {
                pendingPolyline.setStyle({ color: '#1f2937', dashArray: '2, 6', weight: 4 });
            } else {
                pendingPolyline.setStyle({ color: '#555', weight: 4 });
            }
            
            if (typeof updatePathPopup === 'function') {
                updatePathPopup(pendingPolyline);
            } else {
                pendingPolyline.bindPopup(`<div style="color: black; min-width: 120px;"><b>${type}</b></div>`);
            }
            
            if (typeof updateAllLayersInDB === 'function') {
                updateAllLayersInDB();
            }
            
            pendingPolyline = null;
        }
        pathModal.classList.add('hidden');
    });
});

if (cancelPathBtn) {
    cancelPathBtn.addEventListener('click', () => {
        if (pendingPolyline) {
            if (!pendingPolyline.jagdappId) {
                map.removeLayer(pendingPolyline);
                drawnItems.removeLayer(pendingPolyline);
            }
            pendingPolyline = null;
        }
        pathModal.classList.add('hidden');
    });
}

// Polygon Modal Logik
polygonBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        if (pendingPolygon) {
            if (!pendingPolygon.jagdappId) {
                pendingPolygon.jagdappId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
            }
            pendingPolygon.jagdappName = polygonNameInput.value.trim();
            pendingPolygon.jagdappType = type;
            
            if (type === 'Sperrgebiet') {
                pendingPolygon.setStyle({ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.3 });
            } else {
                pendingPolygon.setStyle({ color: '#3388ff', fillColor: '#3388ff', fillOpacity: 0.2 });
                const center = pendingPolygon.getBounds().getCenter();
                updateHuntingSeasons(center.lat, center.lng);
            }
            
            if (typeof updatePolygonPopup === 'function') {
                updatePolygonPopup(pendingPolygon);
                pendingPolygon.openPopup();
            }
            
            if (typeof updateAllLayersInDB === 'function') {
                updateAllLayersInDB();
            }
            
            pendingPolygon = null;
        }
        polygonModal.classList.add('hidden');
    });
});

if (cancelPolygonBtn) {
    cancelPolygonBtn.addEventListener('click', () => {
        if (pendingPolygon) {
            if (!pendingPolygon.jagdappId) {
                map.removeLayer(pendingPolygon);
                drawnItems.removeLayer(pendingPolygon);
            }
            pendingPolygon = null;
        }
        polygonModal.classList.add('hidden');
    });
}

// --- Auth Flow (Super-Admin mit SHA-256 Passwortschutz) ---
const ADMIN_HASH = 'dab0e1c75c31d0b1b3f55933c01ac2dc79af099a4c157a83c35efa674cbdf3e2';

async function hashPassword(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        const input = prompt("🔐 Bitte Super-Admin Passwort eingeben:");
        if (!input) return;
        
        const inputHash = await hashPassword(input);
        if (inputHash === ADMIN_HASH) {
            currentUser = {
                email: 'admin@jagdapp.de',
                uid: 'admin_super_user_123'
            };
            updateUI();
            alert("✅ Erfolgreich als Super-Admin angemeldet!");
        } else {
            alert("❌ Falsches Passwort! Zugriff verweigert.");
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        currentUser = null;
        updateUI();
    });
}

function updateUI() {
    if (currentUser) {
        authSection.classList.add('hidden');
        userSection.classList.remove('hidden');
        userEmailSpan.textContent = currentUser.email;
    } else {
        authSection.classList.remove('hidden');
        userSection.classList.add('hidden');
        userEmailSpan.textContent = '';
    }
}

// --- Einladung ---
if (inviteBtn) {
    inviteBtn.addEventListener('click', () => {
        const email = inviteEmail ? inviteEmail.value : '';
        if (email && currentUser) {
            alert(`Einladung an ${email} wurde erfolgreich versendet! (Mock)`);
            if (inviteEmail) inviteEmail.value = '';
        } else if (!currentUser) {
            alert('Bitte melden Sie sich zuerst an.');
        } else {
            alert('Bitte geben Sie eine gültige E-Mail-Adresse ein.');
        }
    });
}


// --- Map Initialization ---
// Zentrale Koordinaten für Deutschland
const map = L.map('map', {
    center: [51.165691, 10.451526],
    zoom: 6,
    zoomControl: true
});

// OpenStreetMap Deutschland (FOSSGIS e.V. - Kostenlos & Ohne API-Key)
const osmDeTiles = L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://www.fossgis.de/">FOSSGIS e.V.</a>'
}).addTo(map);

// Esri Topografische Karte (Ideal für Jagdreviere & Gelände)
const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
});

// Esri Straßenkarte
const esriStreet = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
});

// Esri Satellitenbild (Ideal für Luftaufnahmen von Wald & Flur)
const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

L.control.layers({
    "🗺️ OpenStreetMap (DE)": osmDeTiles,
    "🏔️ Topo / Geländekarte": esriTopo,
    "🚗 Esri Straßenkarte": esriStreet,
    "🛰️ Satellit / Luftbild": esriSat
}, null, { position: 'topright' }).addTo(map);

// Ensure Leaflet calculates exact container size after layout renders
function fixMapSize() {
    if (map) {
        map.invalidateSize();
    }
}
window.addEventListener('load', fixMapSize);
window.addEventListener('resize', fixMapSize);
setTimeout(fixMapSize, 100);
setTimeout(fixMapSize, 500);
setTimeout(fixMapSize, 1000);

// Leaflet Geoman Controls hinzufügen (Zeichenwerkzeuge)
map.pm.addControls({
    position: 'topleft',
    drawCircle: false,
    drawCircleMarker: false,
    drawPolyline: false,
    drawRectangle: false,
    drawText: false,
    cutPolygon: false,
    editMode: true,
    dragMode: true,
    removalMode: true,
    
    // Wir blenden die Zeichenwerkzeuge hier aus, da wir jetzt große Buttons in der Seitenleiste haben
    drawPolygon: false,
    drawMarker: false,
});

// Snapping global aktivieren
map.pm.setGlobalOptions({
    snappable: true,
    snapDistance: 20
});

// Anpassen der Tooltips auf Deutsch
map.pm.setLang('de');

// Eigene Icons für Einrichtungen (Optional, hier nutzen wir den Standard-Marker)
// In einer echten App würde man hier verschiedene Icons zur Auswahl stellen (Ansitz, Kamera)

// --- Map Events (Zeichnen & Speichern) ---
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

function bindLayerEvents(layer) {
    layer.on('pm:edit', updateAllLayersInDB);
    layer.on('pm:markerdragend', updateAllLayersInDB);
    layer.on('pm:vertexadded', updateAllLayersInDB);
    layer.on('pm:vertexremoved', updateAllLayersInDB);
    layer.on('pm:dragend', updateAllLayersInDB);
}

// Realtime Cloud Synchronization with Firebase Firestore
function subscribeToRevierCloudSync(code) {
    if (activeRevierUnsubscribe) {
        activeRevierUnsubscribe();
        activeRevierUnsubscribe = null;
    }
    if (!firestoreDB || !code) return;

    activeRevierUnsubscribe = firestoreDB.collection('reviere').doc(code).onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            if (data && data.layers) {
                const all = db.getAllReviere();
                if (!all[code]) {
                    all[code] = { code: code, name: data.name || ('Revier ' + code), created: new Date().toISOString(), layers: [] };
                }
                all[code].layers = data.layers;
                if (data.name) all[code].name = data.name;
                localStorage.setItem('jagdapp_all_reviere', JSON.stringify(all));

                if (activeRevierCode === code) {
                    isRemoteUpdating = true;
                    renderMapLayers(data.layers);
                    isRemoteUpdating = false;
                }
            }
        }
    }, err => {
        console.warn('Firestore snapshot listener warning:', err);
    });
}

function renderMapLayers(savedData) {
    if (!drawnItems) return;
    drawnItems.clearLayers();
    let firstPolygonLoaded = false;
    try {
        (savedData || []).forEach(item => {
            let layer;
            if (item.type === 'polygon') {
                layer = L.polygon(item.latlngs);
                layer.jagdappId = item.id || Date.now().toString() + Math.random().toString(36).substr(2, 5);
                layer.jagdappName = item.name || '';
                layer.jagdappType = item.polygonType || 'Revier';
                if (!firstPolygonLoaded) {
                    const center = layer.getBounds().getCenter();
                    setTimeout(() => updateHuntingSeasons(center.lat, center.lng), 500);
                    firstPolygonLoaded = true;
                }
                if (typeof updatePolygonPopup === 'function') {
                    updatePolygonPopup(layer);
                }
            } else if (item.type === 'marker') {
                layer = L.marker(item.latlng);
                layer.jagdappId = item.id || Date.now().toString() + Math.random().toString(36).substr(2, 5);
                layer.jagdappName = item.name || '';
                if (item.facilityType) {
                    layer.setIcon(getFacilityIcon(item.facilityType));
                    layer.jagdappType = item.facilityType;
                } else {
                    layer.jagdappType = 'Unbekannt';
                }
                layer.reservations = item.reservations || [];
                updateMarkerPopup(layer);
            } else if (item.type === 'polyline') {
                layer = L.polyline(item.latlngs);
                layer.jagdappType = item.pathType;
                layer.jagdappName = item.name || '';
                layer.jagdappId = item.id || Date.now().toString() + Math.random().toString(36).substr(2, 5);
                if (item.pathType === 'Pirschweg') {
                    layer.setStyle({ color: '#8b4513', dashArray: '5, 10', weight: 3 });
                } else if (item.pathType === 'Zaun') {
                    layer.setStyle({ color: '#1f2937', dashArray: '2, 6', weight: 4 });
                } else {
                    layer.setStyle({ color: '#555', weight: 4 });
                }
                if (typeof updatePathPopup === 'function') {
                    updatePathPopup(layer);
                } else {
                    layer.bindPopup(`<div style="color: black; min-width: 120px;"><b>${item.pathType}</b></div>`);
                }
            }
            
            if (layer) {
                layer.options.pmIgnore = false;
                drawnItems.addLayer(layer);
                bindLayerEvents(layer);
            }
        });
    } catch (e) {
        console.error("Fehler beim Laden der Kartendaten:", e);
    }
}

// Initialer Render aus dem Speicher
renderMapLayers(db.loadLayers());
if (activeRevierCode) {
    subscribeToRevierCloudSync(activeRevierCode);
}

// Wenn etwas neues gezeichnet wird
map.on('pm:create', (e) => {
    const layer = e.layer;
    drawnItems.addLayer(layer);
    bindLayerEvents(layer);
    
    // Daten speichern
    let layerData = {};
    if (e.shape === 'Polygon') {
        pendingPolygon = layer;
        document.getElementById('polygon-name').value = '';
        polygonModal.classList.remove('hidden');
        return; // Wird erst im Modal gespeichert
    } else if (e.shape === 'Marker') {
        pendingMarker = layer;
        document.getElementById('facility-name').value = '';
        facilityModal.classList.remove('hidden');
        return; // Wird erst im Modal gespeichert
    } else if (e.shape === 'Line') {
        pendingPolyline = layer;
        document.getElementById('path-name').value = '';
        pathModal.classList.remove('hidden');
        return; // Wird erst im Modal gespeichert
    }
    
    // In unserer Mock-DB speichern (für Polygone)
    db.saveLayer(layerData);
});

// Update-Logik für Bearbeiten/Löschen (Multi-Revier Support)
function updateAllLayersInDB() {
    const layersArray = [];
    drawnItems.eachLayer(l => {
        let layerData = {};
        if (l instanceof L.Polygon) {
            layerData = { type: 'polygon', id: l.jagdappId, name: l.jagdappName, polygonType: l.jagdappType, latlngs: l.getLatLngs() };
            if (typeof updatePolygonPopup === 'function') {
                updatePolygonPopup(l);
            }
        } else if (l instanceof L.Marker) {
            layerData = { type: 'marker', facilityType: l.jagdappType, name: l.jagdappName, id: l.jagdappId, reservations: l.reservations, latlng: l.getLatLng() };
        } else if (l instanceof L.Polyline) {
            layerData = { type: 'polyline', pathType: l.jagdappType, name: l.jagdappName, id: l.jagdappId, latlngs: l.getLatLngs() };
        }
        if (Object.keys(layerData).length > 0) {
            layersArray.push(layerData);
        }
    });
    db.saveLayersForActiveRevier(layersArray);
}

map.on('pm:remove', (e) => {
    updateAllLayersInDB();
});

map.on('pm:edit', (e) => {
    updateAllLayersInDB();
});

// --- Reservation & Edit Logic ---
function updateMarkerPopup(layer) {
    const typeName = layer.jagdappType || 'Unbekannt';
    const displayName = layer.jagdappName ? `<b>${layer.jagdappName}</b><br><span style="font-size:0.85em; color:#666;">${typeName}</span>` : `<b>${typeName}</b>`;
    const isAnsitz = typeName === 'Ansitz';
    let resHtml = '';
    if (layer.reservations && layer.reservations.length > 0) {
        resHtml = '<div style="margin-top:8px; font-size: 0.85rem; border-top: 1px solid #ccc; padding-top: 8px;"><b>Reservierungen:</b><br>';
        layer.reservations.forEach(r => {
            const start = new Date(r.start).toLocaleString('de-DE', {day: '2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
            const end = new Date(r.end).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
            resHtml += `• ${r.user}: ${start} - ${end}<br>`;
        });
        resHtml += '</div>';
    }

    let buttonHtml = isAnsitz ? `<button onclick="window.openBookingModal('${layer.jagdappId}')" style="margin-top: 8px; width: 100%; padding: 6px; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📅 Reservieren</button>` : '';

    let editHtml = `
        <div style="display: flex; gap: 4px; margin-top: 8px;">
            <button onclick="window.editMarkerType('${layer.jagdappId}')" style="flex:1; padding: 4px; font-size: 0.8rem; background: #4b5563; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Bearbeiten">✏️</button>
            <button onclick="window.toggleMarkerDrag('${layer.jagdappId}')" style="flex:1; padding: 4px; font-size: 0.8rem; background: #4b5563; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Verschieben">✋</button>
            <button onclick="window.deleteMarker('${layer.jagdappId}')" style="flex:1; padding: 4px; font-size: 0.8rem; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Löschen">🗑️</button>
        </div>
    `;

    layer.bindPopup(`<div style="min-width: 160px; color: black;">${displayName}${resHtml}${buttonHtml}${editHtml}</div>`);
}

window.editMarkerType = (markerId) => {
    drawnItems.eachLayer(layer => {
        if (layer.jagdappId === markerId) {
            pendingMarker = layer;
            document.getElementById('facility-name').value = layer.jagdappName || '';
            facilityModal.classList.remove('hidden');
            layer.closePopup();
        }
    });
};

window.toggleMarkerDrag = (markerId) => {
    drawnItems.eachLayer(layer => {
        if (layer.jagdappId === markerId) {
            if (layer.dragging && layer.dragging.enabled()) {
                layer.dragging.disable();
                updateAllLayersInDB();
                layer.closePopup();
                layer.unbindTooltip();
            } else {
                layer.dragging.enable();
                layer.closePopup();
                layer.bindTooltip("Verschiebe mich! Klicke auf mich zum Speichern.", {permanent: true, direction: "top"}).openTooltip();
                layer.once('click', () => {
                    layer.dragging.disable();
                    layer.unbindTooltip();
                    updateAllLayersInDB();
                });
            }
        }
    });
};

window.deleteMarker = (markerId) => {
    if(confirm("Möchtest du diese Einrichtung wirklich löschen?")) {
        drawnItems.eachLayer(layer => {
            if (layer.jagdappId === markerId) {
                map.removeLayer(layer);
                drawnItems.removeLayer(layer);
                updateAllLayersInDB();
            }
        });
    }
};

function updatePathPopup(layer) {
    const typeName = layer.jagdappType || 'Unbekannter Weg';
    const displayName = layer.jagdappName ? `<b>${layer.jagdappName}</b><br><span style="font-size:0.85em; color:#666;">${typeName}</span>` : `<b>${typeName}</b>`;
    let editHtml = `
        <div style="display: flex; gap: 4px; margin-top: 8px;">
            <button onclick="window.editPathType('${layer.jagdappId}')" style="flex:1; padding: 4px; font-size: 0.8rem; background: #4b5563; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Bearbeiten">✏️</button>
            <button onclick="window.togglePathEdit('${layer.jagdappId}')" style="flex:1; padding: 4px; font-size: 0.8rem; background: #4b5563; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Punkte bearbeiten">✋</button>
            <button onclick="window.deletePath('${layer.jagdappId}')" style="flex:1; padding: 4px; font-size: 0.8rem; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Löschen">🗑️</button>
        </div>
    `;
    layer.bindPopup(`<div style="min-width: 160px; color: black;">${displayName}${editHtml}</div>`);
}

window.editPathType = (pathId) => {
    drawnItems.eachLayer(layer => {
        if (layer.jagdappId === pathId) {
            pendingPolyline = layer;
            document.getElementById('path-name').value = layer.jagdappName || '';
            document.getElementById('path-modal').classList.remove('hidden');
            layer.closePopup();
        }
    });
};

window.togglePathEdit = (pathId) => {
    drawnItems.eachLayer(layer => {
        if (layer.jagdappId === pathId) {
            if (layer.pm.enabled()) {
                layer.pm.disable();
                updateAllLayersInDB();
                layer.closePopup();
            } else {
                layer.pm.enable();
                layer.closePopup();
                alert("Du kannst nun die Wegpunkte verschieben, löschen oder neue hinzufügen. Klicke erneut auf den Weg und auf das Hand-Symbol, um den Modus zu beenden.");
            }
        }
    });
};

window.deletePath = (pathId) => {
    if(confirm("Möchtest du diesen Weg wirklich löschen?")) {
        drawnItems.eachLayer(layer => {
            if (layer.jagdappId === pathId) {
                map.removeLayer(layer);
                drawnItems.removeLayer(layer);
                updateAllLayersInDB();
            }
        });
    }
};

// --- Edit Banner Helper ---
const editBanner = document.getElementById('edit-banner');
const editBannerText = document.getElementById('edit-banner-text');
const editBannerBtn = document.getElementById('edit-banner-btn');
let activeEditAction = null;

function showEditBanner(text, btnLabel, callback) {
    if (editBannerText && editBannerBtn && editBanner) {
        editBannerText.textContent = text;
        editBannerBtn.textContent = btnLabel || '💾 Speichern / Fertig';
        editBanner.classList.remove('hidden');
        
        editBannerBtn.onclick = () => {
            if (callback) callback();
            hideEditBanner();
        };
    }
}

function hideEditBanner() {
    if (editBanner) {
        editBanner.classList.add('hidden');
    }
    if (activeEditAction) {
        activeEditAction();
        activeEditAction = null;
    }
}

function updatePolygonPopup(layer) {
    let areaHectares = "Unbekannt";
    if (typeof turf !== 'undefined') {
        const geojson = layer.toGeoJSON();
        areaHectares = (turf.area(geojson) / 10000).toFixed(2);
    }
    const typeName = layer.jagdappType === 'Sperrgebiet' ? 'Sperrgebiet' : 'Revier';
    const nameStr = layer.jagdappName ? `<b>${layer.jagdappName}</b><br><span style="font-size:0.85em; color:#666;">${typeName}</span>` : `<b>${typeName}</b>`;
    const displayName = `${nameStr}<br>Fläche: <b>${areaHectares} ha</b>`;
    let editHtml = `
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
            <div style="display: flex; gap: 4px;">
                <button onclick="window.togglePolygonEdit('${layer.jagdappId}')" style="flex:1; padding: 6px 8px; font-size: 0.8rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;" title="Grenzen verändern">✋ Grenzen anpassen</button>
            </div>
            <div style="display: flex; gap: 4px;">
                <button onclick="window.startAddAreaToPolygon('${layer.jagdappId}')" style="flex:1; padding: 5px 6px; font-size: 0.8rem; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Zusätzliche Fläche (z.B. Weide) dazunehmen">➕ Erweitern</button>
                <button onclick="window.startSubtractAreaFromPolygon('${layer.jagdappId}')" style="flex:1; padding: 5px 6px; font-size: 0.8rem; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Fläche ausschneiden/abziehen">✂️ Abziehen</button>
            </div>
            <div style="display: flex; gap: 4px;">
                <button onclick="window.editPolygonName('${layer.jagdappId}')" style="flex:1; padding: 5px 6px; font-size: 0.8rem; background: #4b5563; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Umbenennen">✏️ Name</button>
                <button onclick="window.deletePolygon('${layer.jagdappId}')" style="flex:1; padding: 5px 6px; font-size: 0.8rem; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;" title="Löschen">🗑️ Löschen</button>
            </div>
        </div>
    `;
    const popupContent = `<div style="min-width: 190px; color: black; line-height: 1.4;">${displayName}${editHtml}</div>`;
    
    if (layer.getPopup()) {
        layer.setPopupContent(popupContent);
    } else {
        layer.bindPopup(popupContent);
    }
}

window.togglePolygonEdit = (polygonId) => {
    drawnItems.eachLayer(layer => {
        if (layer.jagdappId === polygonId) {
            if (layer.pm.enabled()) {
                layer.pm.disable();
                updateAllLayersInDB();
                hideEditBanner();
            } else {
                layer.pm.enable({ allowSelfIntersection: false });
                layer.closePopup();
                
                const onVertexEdit = () => {
                    updatePolygonPopup(layer);
                    updateAllLayersInDB();
                };
                layer.on('pm:markerdrag', onVertexEdit);
                layer.on('pm:vertexadded', onVertexEdit);
                layer.on('pm:vertexremoved', onVertexEdit);
                
                activeEditAction = () => {
                    layer.pm.disable();
                    layer.off('pm:markerdrag', onVertexEdit);
                    layer.off('pm:vertexadded', onVertexEdit);
                    layer.off('pm:vertexremoved', onVertexEdit);
                    updatePolygonPopup(layer);
                    updateAllLayersInDB();
                };
                
                showEditBanner(
                    "📍 Ziehe die Eckpunkte zum Anpassen. Graue Punkte auf Linien erzeugen neue Ecken.",
                    "💾 Fertig & Speichern",
                    () => {
                        if (activeEditAction) activeEditAction();
                    }
                );
            }
        }
    });
};

window.startAddAreaToPolygon = (targetPolygonId) => {
    drawnItems.eachLayer(targetLayer => {
        if (targetLayer.jagdappId === targetPolygonId) {
            targetLayer.closePopup();
            
            showEditBanner(
                "➕ Zeichne die zusätzliche Fläche (z.B. Weide) auf der Karte ein. Doppelklick zum Beenden.",
                "❌ Abbrechen",
                () => {
                    map.pm.disableDraw();
                }
            );

            map.pm.enableDraw('Polygon');
            
            const handleCreated = (e) => {
                if (e.shape !== 'Polygon') return;
                const newPolyLayer = e.layer;
                
                map.removeLayer(newPolyLayer);
                drawnItems.removeLayer(newPolyLayer);
                
                try {
                    const targetGeo = targetLayer.toGeoJSON();
                    const newGeo = newPolyLayer.toGeoJSON();
                    
                    const unionResult = turf.union(targetGeo, newGeo);
                    if (unionResult && unionResult.geometry) {
                        const tempGroup = L.geoJSON(unionResult);
                        const newLatLngs = [];
                        tempGroup.eachLayer(l => {
                            if (l.getLatLngs) newLatLngs.push(l.getLatLngs());
                        });
                        
                        targetLayer.setLatLngs(newLatLngs.length === 1 ? newLatLngs[0] : newLatLngs);
                        updatePolygonPopup(targetLayer);
                        updateAllLayersInDB();
                        
                        const calcArea = (turf.area(unionResult) / 10000).toFixed(2);
                        alert(`✅ Fläche erfolgreich erweitert! Neue Gesamtfläche: ${calcArea} ha`);
                    }
                } catch(err) {
                    console.error("Union error:", err);
                    alert("Konnte die Flächen nicht automatisch verschmelzen. Bitte stelle sicher, dass sich die Flächen berühren oder überschneiden.");
                }
                
                hideEditBanner();
            };
            
            map.once('pm:create', handleCreated);
        }
    });
};

window.startSubtractAreaFromPolygon = (targetPolygonId) => {
    drawnItems.eachLayer(targetLayer => {
        if (targetLayer.jagdappId === targetPolygonId) {
            targetLayer.closePopup();
            
            showEditBanner(
                "✂️ Zeichne die Fläche ein, die aus dem Revier herausgeschnitten werden soll.",
                "❌ Abbrechen",
                () => {
                    map.pm.disableDraw();
                }
            );

            map.pm.enableDraw('Polygon');
            
            const handleCreated = (e) => {
                if (e.shape !== 'Polygon') return;
                const cutPolyLayer = e.layer;
                
                map.removeLayer(cutPolyLayer);
                drawnItems.removeLayer(cutPolyLayer);
                
                try {
                    const targetGeo = targetLayer.toGeoJSON();
                    const cutGeo = cutPolyLayer.toGeoJSON();
                    
                    const diffResult = turf.difference(targetGeo, cutGeo);
                    if (diffResult && diffResult.geometry) {
                        const tempGroup = L.geoJSON(diffResult);
                        const newLatLngs = [];
                        tempGroup.eachLayer(l => {
                            if (l.getLatLngs) newLatLngs.push(l.getLatLngs());
                        });
                        
                        targetLayer.setLatLngs(newLatLngs.length === 1 ? newLatLngs[0] : newLatLngs);
                        updatePolygonPopup(targetLayer);
                        updateAllLayersInDB();
                        
                        const calcArea = (turf.area(diffResult) / 10000).toFixed(2);
                        alert(`✅ Fläche erfolgreich abgezogen! Neue Gesamtfläche: ${calcArea} ha`);
                    }
                } catch(err) {
                    console.error("Difference error:", err);
                    alert("Fehler beim Ausschneiden der Fläche. Bitte erstelle eine überschneidende Fläche.");
                }
                
                hideEditBanner();
            };
            
            map.once('pm:create', handleCreated);
        }
    });
};

window.editPolygonName = (polygonId) => {
    drawnItems.eachLayer(layer => {
        if (layer.jagdappId === polygonId) {
            pendingPolygon = layer;
            document.getElementById('polygon-name').value = layer.jagdappName || '';
            document.getElementById('polygon-modal').classList.remove('hidden');
            layer.closePopup();
        }
    });
};

window.deletePolygon = (polygonId) => {
    if(confirm("Möchtest du dieses Revier wirklich löschen?")) {
        drawnItems.eachLayer(layer => {
            if (layer.jagdappId === polygonId) {
                map.removeLayer(layer);
                drawnItems.removeLayer(layer);
                updateAllLayersInDB();
                // Wenn kein Polygon mehr da ist, Jagdzeiten zurücksetzen
                let hasPolygon = false;
                drawnItems.eachLayer(l => { if(l instanceof L.Polygon) hasPolygon = true; });
                if (!hasPolygon) {
                    document.getElementById('current-state').textContent = 'Kein Revier';
                    document.getElementById('seasons-list').innerHTML = 'Zeichnen Sie ein Revier (Polygon) ein, um die Jagdzeiten zu laden.';
                }
            }
        });
    }
};

let currentBookingMarkerId = null;
const bookingModal = document.getElementById('booking-modal');
const saveBookingBtn = document.getElementById('save-booking-btn');
const cancelBookingBtn = document.getElementById('cancel-booking-btn');
const bookingStart = document.getElementById('booking-start');
const bookingEnd = document.getElementById('booking-end');

window.openBookingModal = (markerId) => {
    currentBookingMarkerId = markerId;
    bookingModal.classList.remove('hidden');
    
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    bookingStart.value = now.toISOString().slice(0, 16);
    
    const end = new Date(now);
    end.setHours(end.getHours() + 4);
    bookingEnd.value = end.toISOString().slice(0, 16);
};

saveBookingBtn.addEventListener('click', () => {
    if (!currentBookingMarkerId || !bookingStart.value || !bookingEnd.value) {
        alert("Bitte füllen Sie alle Felder aus.");
        return;
    }
    
    const user = currentUser ? currentUser.email : 'Gast';
    const newReservation = {
        user: user,
        start: bookingStart.value,
        end: bookingEnd.value
    };
    
    drawnItems.eachLayer(layer => {
        if (layer.jagdappId === currentBookingMarkerId) {
            if (!layer.reservations) layer.reservations = [];
            layer.reservations.push(newReservation);
            updateMarkerPopup(layer);
            
            // Neu speichern
            updateAllLayersInDB();
            
            layer.openPopup();
        }
    });
    
    bookingModal.classList.add('hidden');
});

cancelBookingBtn.addEventListener('click', () => {
    bookingModal.classList.add('hidden');
});

// --- Sidebar Buttons für Zeichenwerkzeuge ---
const btnMarker = document.getElementById('btn-draw-marker');
const btnPolygon = document.getElementById('btn-draw-polygon');
const btnPolyline = document.getElementById('btn-draw-polyline');

btnMarker.addEventListener('click', () => {
    map.pm.enableDraw('Marker');
    btnMarker.style.backgroundColor = 'var(--primary)';
    btnMarker.style.color = 'white';
    btnMarker.textContent = '📍 Klicke jetzt auf die Karte...';
});

// --- Overpass Snapping ---
let snapLayerGroup = L.featureGroup().addTo(map);

async function loadSnapData(btnElement, defaultText) {
    if (map.getZoom() < 14) {
        btnElement.textContent = '⚠️ Näher ranzoomen für echtes Einrasten!';
        setTimeout(() => {
            if (btnElement.textContent.includes('⚠️')) {
                btnElement.textContent = defaultText;
            }
        }, 3500);
        return false;
    }
    
    btnElement.textContent = '⏳ Lädt Karten-Daten (Snapping)...';

    const bounds = map.getBounds();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
    
    const query = `
        [out:json][timeout:25];
        (
            way["highway"](${bbox});
            way["landuse"="forest"](${bbox});
            way["landuse"="farmland"](${bbox});
            way["landuse"="meadow"](${bbox});
            way["natural"="wood"](${bbox});
        );
        out body;
        >;
        out skel qt;
    `;
    
    try {
        let response;
        const encodedQuery = encodeURIComponent(query);
        try {
            response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodedQuery}`);
        } catch (err) {
            console.warn("First Overpass endpoint failed, trying fallback...", err);
            response = await fetch(`https://overpass.kumi.systems/api/interpreter?data=${encodedQuery}`);
        }
        
        if (!response.ok) {
            console.error("Overpass HTTP Error:", response.status);
            btnElement.textContent = '❌ Fehler beim Laden der Snapping-Daten';
            setTimeout(() => { btnElement.textContent = defaultText; }, 3000);
            return false;
        }

        const data = await response.json();
        
        if (typeof osmtogeojson !== 'undefined') {
            const geojson = osmtogeojson(data);
            
            if (geojson.features && geojson.features.length === 0) {
                btnElement.textContent = '⚠️ Keine Wege in diesem Ausschnitt gefunden';
                setTimeout(() => { btnElement.textContent = defaultText; }, 3000);
                return true; // We can still draw
            }

            snapLayerGroup.clearLayers();
            
            const snapLayer = L.geoJSON(geojson, {
                style: { color: '#f59e0b', weight: 2, dashArray: '4,4', opacity: 0.5 },
                pmIgnore: false
            });
            snapLayerGroup.addLayer(snapLayer);
            btnElement.textContent = defaultText; // Success, reset text
            return true;
        } else {
            console.error("osmtogeojson library is missing!");
            btnElement.textContent = '❌ Interner Fehler (Parser fehlt)';
            setTimeout(() => { btnElement.textContent = defaultText; }, 3000);
            return false;
        }
    } catch (e) {
        console.error("Overpass API Error:", e);
        btnElement.textContent = '❌ Netzwerk-Fehler beim Laden';
        setTimeout(() => { btnElement.textContent = defaultText; }, 3000);
        return false;
    }
}

btnPolyline.addEventListener('click', async () => {
    btnPolyline.style.backgroundColor = 'var(--primary)';
    btnPolyline.style.color = 'white';
    await loadSnapData(btnPolyline, '🚶 Zeichne auf der Karte... (Doppelklick zum Beenden)');
    map.pm.enableDraw('Line');
});

btnPolygon.addEventListener('click', async () => {
    btnPolygon.style.backgroundColor = 'var(--primary)';
    btnPolygon.style.color = 'white';
    await loadSnapData(btnPolygon, '📐 Zeichne auf der Karte... (Doppelklick zum Beenden)');
    map.pm.enableDraw('Polygon');
});

// Buttons zurücksetzen, wenn das Zeichnen beendet/abgebrochen wird
map.on('pm:create', () => {
    btnMarker.style.backgroundColor = '';
    btnMarker.style.color = '';
    btnMarker.textContent = '📍 Einrichtung setzen';
    
    btnPolyline.style.backgroundColor = '';
    btnPolyline.style.color = '';
    btnPolyline.textContent = '🚶 Wege einzeichnen';
    
    btnPolygon.style.backgroundColor = '';
    btnPolygon.style.color = '';
    btnPolygon.textContent = '📐 Revier einzeichnen';
});

map.on('pm:drawend', () => {
    btnMarker.style.backgroundColor = '';
    btnMarker.style.color = '';
    btnMarker.textContent = '📍 Einrichtung setzen';
    
    btnPolyline.style.backgroundColor = '';
    btnPolyline.style.color = '';
    btnPolyline.textContent = '🚶 Wege einzeichnen';
    
    btnPolygon.style.backgroundColor = '';
    btnPolygon.style.color = '';
    btnPolygon.textContent = '📐 Revier einzeichnen';
    
    if (typeof snapLayerGroup !== 'undefined') {
        snapLayerGroup.clearLayers();
    }
});

// --- Automatische Gemeindegrenzen laden ---
const btnAutoMunicipality = document.getElementById('btn-auto-municipality');
const inputAutoMunicipality = document.getElementById('auto-municipality-input');

if (btnAutoMunicipality && inputAutoMunicipality) {
    btnAutoMunicipality.addEventListener('click', async () => {
        const query = inputAutoMunicipality.value.trim();
        if (!query) {
            alert("Bitte gib einen Gemeindenamen ein.");
            return;
        }
        
        btnAutoMunicipality.textContent = "⏳ Lade Grenze...";
        btnAutoMunicipality.disabled = true;
        
        try {
            // Wir verwenden den User-Agent "JagdApp", da Nominatim das wünscht
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=geojson&polygon_geojson=1&limit=1`);
            
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            
            const data = await res.json();
            
            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
                    // Konvertiere das GeoJSON in temporäre Leaflet Layer
                    const geoJsonLayer = L.geoJSON(feature);
                    
                    let added = false;
                    geoJsonLayer.eachLayer(layer => {
                        if (layer instanceof L.Polygon) {
                            layer.jagdappId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
                            layer.jagdappName = feature.properties.name || query;
                            layer.options.pmIgnore = false;
                            
                            drawnItems.addLayer(layer);
                            bindLayerEvents(layer);
                            added = true;
                        }
                    });
                    
                    if (added) {
                        map.fitBounds(geoJsonLayer.getBounds());
                        const center = geoJsonLayer.getBounds().getCenter();
                        updateHuntingSeasons(center.lat, center.lng);
                        updateAllLayersInDB();
                        inputAutoMunicipality.value = '';
                    } else {
                        alert("Konnte die Flächen-Grenzen dieser Gemeinde nicht verarbeiten.");
                    }
                } else {
                    alert("Die Suchanfrage lieferte leider keine geschlossenen Flächen-Grenzen zurück. Versuche vielleicht einen genaueren Namen.");
                }
            } else {
                alert("Gemeinde nicht gefunden. Bitte überprüfe die Schreibweise.");
            }
        } catch (e) {
            console.error("Nominatim Fetch Error:", e);
            alert("Netzwerkfehler beim Abrufen der Gemeindegrenzen. Bitte versuche es später noch einmal.");
        } finally {
            btnAutoMunicipality.textContent = "🏙️ Gemeinde-Grenze laden";
            btnAutoMunicipality.disabled = false;
        }
    });
}

// --- Wetter & Wind Widget ---
const windSpeedEl = document.getElementById('wind-speed');
const windArrowEl = document.getElementById('wind-arrow');
const weatherIconEl = document.getElementById('weather-icon');

function getWeatherEmoji(code) {
    if (code === 0) return '☀️'; // Klarer Himmel
    if (code === 1 || code === 2) return '⛅'; // Heiter bis wolkig
    if (code === 3) return '☁️'; // Bedeckt
    if (code === 45 || code === 48) return '🌫️'; // Nebel
    if (code >= 51 && code <= 67) return '🌧️'; // Niesel/Regen
    if (code >= 71 && code <= 86) return '🌨️'; // Schnee
    if (code >= 80 && code <= 82) return '🌦️'; // Regenschauer
    if (code >= 95) return '⛈️'; // Gewitter
    return '⛅';
}

async function fetchWeather(lat, lng) {
    try {
        // Open-Meteo API ist kostenlos und benötigt keinen API Key
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
        const data = await response.json();
        
        if (data.current_weather) {
            const windSpeed = data.current_weather.windspeed; // in km/h
            const windDir = data.current_weather.winddirection; // 0-360 degrees
            const weatherCode = data.current_weather.weathercode;
            
            windSpeedEl.textContent = `${Math.round(windSpeed)} km/h`;
            weatherIconEl.textContent = getWeatherEmoji(weatherCode);
            
            // Pfeil '↑' zeigt nach oben (Norden).
            // Winddirection: 0 = Wind kommt von Norden (weht nach Süden).
            // Wir rotieren um winddirection + 180, damit der Pfeil anzeigt, IN WELCHE RICHTUNG der Wind weht (wohin die Witterung zieht).
            const rotation = windDir + 180; 
            windArrowEl.style.transform = `rotate(${rotation}deg)`;
        }
    } catch (error) {
        console.error("Fehler beim Laden des Wetters:", error);
        windSpeedEl.textContent = "Wetter n/a";
    }
}

// Initiale Wetterdaten für die Kartenmitte laden
fetchWeather(map.getCenter().lat, map.getCenter().lng);

// Wetterdaten aktualisieren, wenn man auf der Karte herumnavigiert
let weatherTimeout;
map.on('moveend', () => {
    clearTimeout(weatherTimeout);
    windSpeedEl.textContent = "Lädt...";
    // 1 Sekunde warten (Debounce), bevor wir die API rufen, um nicht zu viele Anfragen beim schnellen Wischen zu erzeugen
    weatherTimeout = setTimeout(() => {
        fetchWeather(map.getCenter().lat, map.getCenter().lng);
    }, 1000);
});

// --- Automatische Jagdzeiten (Schalenwild) ---
const huntingSeasonsDB = {
    "Bayern": [
        { name: "Rehwild (Böcke & Schmalrehe)", start: "05-01", end: "01-15" },
        { name: "Rehwild (Ricken & Kitze)", start: "09-01", end: "01-15" },
        { name: "Rotwild (Schmalspießer & Schmaltiere)", start: "06-01", end: "01-31" },
        { name: "Rotwild (Hirsche & restl. Kahlwild)", start: "08-01", end: "12-31" },
        { name: "Damwild (Schmalspießer & Schmaltiere)", start: "05-01", end: "01-15" },
        { name: "Damwild (Hirsche & restl. Kahlwild)", start: "09-01", end: "01-15" },
        { name: "Schwarzwild (ausg. führende Bachen)", start: "01-01", end: "12-31" }
    ],
    "Hessen": [
        { name: "Rehwild (Böcke & Schmalrehe)", start: "05-01", end: "01-31" },
        { name: "Rehwild (Ricken & Kitze)", start: "09-01", end: "01-31" },
        { name: "Rotwild (Schmalspießer & Schmaltiere)", start: "06-01", end: "01-31" },
        { name: "Rotwild (Hirsche & restl. Kahlwild)", start: "08-01", end: "01-31" },
        { name: "Damwild (Schmalspießer & Schmaltiere)", start: "05-01", end: "01-31" },
        { name: "Damwild (Hirsche & restl. Kahlwild)", start: "09-01", end: "01-31" },
        { name: "Schwarzwild (ausg. führende Bachen)", start: "01-01", end: "12-31" }
    ],
    "Niedersachsen": [
        { name: "Rehwild (Böcke)", start: "04-01", end: "01-31" },
        { name: "Rehwild (Schmalrehe)", start: "04-01", end: "01-31" },
        { name: "Rehwild (Ricken & Kitze)", start: "09-01", end: "01-31" },
        { name: "Rotwild (Schmalspießer & Schmaltiere)", start: "06-01", end: "01-31" },
        { name: "Rotwild (Hirsche & restl. Kahlwild)", start: "08-01", end: "01-31" },
        { name: "Damwild (Schmalspießer & Schmaltiere)", start: "05-01", end: "01-31" },
        { name: "Damwild (Hirsche & restl. Kahlwild)", start: "09-01", end: "01-31" },
        { name: "Schwarzwild (ausg. führende Bachen)", start: "01-01", end: "12-31" }
    ],
    "default": [ // Richtwert für restliche Bundesländer
        { name: "Rehwild (Böcke & Schmalrehe)", start: "05-01", end: "01-31" },
        { name: "Rehwild (Ricken & Kitze)", start: "09-01", end: "01-31" },
        { name: "Rotwild (Schmalspießer & Schmaltiere)", start: "06-01", end: "01-31" },
        { name: "Rotwild (Hirsche & restl. Kahlwild)", start: "08-01", end: "01-31" },
        { name: "Damwild (Schmalspießer & Schmaltiere)", start: "05-01", end: "01-31" },
        { name: "Damwild (Hirsche & restl. Kahlwild)", start: "09-01", end: "01-31" },
        { name: "Schwarzwild (ausg. führende Bachen)", start: "01-01", end: "12-31" }
    ]
};

function isSeasonOpen(startStr, endStr) {
    const now = new Date();
    // Format: MM-DD
    const currentMonthDay = (now.getMonth() + 1).toString().padStart(2, '0') + '-' + now.getDate().toString().padStart(2, '0');
    
    if (startStr <= endStr) {
        return currentMonthDay >= startStr && currentMonthDay <= endStr;
    } else {
        // Saison geht über den Jahreswechsel (z.B. Sep - Jan)
        return currentMonthDay >= startStr || currentMonthDay <= endStr;
    }
}

async function updateHuntingSeasons(lat, lng) {
    const stateEl = document.getElementById('current-state');
    const listEl = document.getElementById('seasons-list');
    
    stateEl.textContent = 'Lädt...';
    
    try {
        // Reverse Geocoding per OpenStreetMap Nominatim (Kostenlos)
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        
        let state = "Unbekannt";
        if (data && data.address && data.address.state) {
            state = data.address.state;
        }
        
        stateEl.textContent = state;
        
        // Hole DB oder Fallback
        const seasons = huntingSeasonsDB[state] || huntingSeasonsDB['default'];
        
        let html = '<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px;">';
        let foundOpen = false;
        
        seasons.forEach(animal => {
            const isOpen = isSeasonOpen(animal.start, animal.end);
            if (isOpen) {
                html += `<li><span style="color:var(--primary);">✔</span> <b style="color:white;">${animal.name}</b></li>`;
                foundOpen = true;
            }
        });
        
        if (!foundOpen) {
            html += `<li>Aktuell keine Jagdzeit für aufgeführtes Schalenwild.</li>`;
        }
        
        if (!huntingSeasonsDB[state] && state !== "Unbekannt") {
            html += `<li style="margin-top: 8px; font-size: 0.8rem; color: #f59e0b;">(Richtwerte verwendet. Länderspezifische Daten für ${state} noch nicht hinterlegt.)</li>`;
        }
        
        html += '</ul>';
        listEl.innerHTML = html;
        
    } catch(e) {
        stateEl.textContent = 'Fehler';
        listEl.innerHTML = 'Konnte Bundesland nicht ermitteln.';
        console.error("Geocoding Error:", e);
    }
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // Zeichen-Modus beenden
        map.pm.disableDraw();
        if (typeof snapLayerGroup !== 'undefined') {
            snapLayerGroup.clearLayers();
        }
        
        // Modal-Fenster schließen (entspricht einem Klick auf Abbrechen)
        if (!document.getElementById('facility-modal').classList.contains('hidden')) {
            document.getElementById('cancel-facility-btn').click();
        }
        if (!document.getElementById('path-modal').classList.contains('hidden')) {
            document.getElementById('cancel-path-btn').click();
        }
        if (!document.getElementById('polygon-modal').classList.contains('hidden')) {
            document.getElementById('cancel-polygon-btn').click();
        }
        if (!document.getElementById('booking-modal').classList.contains('hidden')) {
            document.getElementById('cancel-booking-btn').click();
        }
        if (document.getElementById('qr-modal') && !document.getElementById('qr-modal').classList.contains('hidden')) {
            document.getElementById('close-qr-btn').click();
        }
    }
});

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('PWA Service Worker registriert:', reg.scope))
            .catch(err => console.log('PWA Service Worker Fehler:', err));
    });
}

// --- Revier Export & Import (100% Serverlos & Datenschutzfreundlich) ---
const btnExportRevier = document.getElementById('btn-export-revier');
const btnImportRevier = document.getElementById('btn-import-revier');
const importFileInput = document.getElementById('import-file-input');

if (btnExportRevier) {
    btnExportRevier.addEventListener('click', () => {
        const layers = db.loadLayers();
        if (!layers || layers.length === 0) {
            alert("Es sind aktuell keine Revierdaten zum Exportieren vorhanden. Zeichne zuerst ein Revier auf der Karte!");
            return;
        }
        
        const exportObj = {
            appName: "Jagdapp",
            version: "1.0",
            exportDate: new Date().toISOString(),
            layers: layers
        };
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `Jagdrevier_${new Date().toISOString().slice(0,10)}.jagdapp`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    });
}

if (btnImportRevier && importFileInput) {
    btnImportRevier.addEventListener('click', () => {
        importFileInput.click();
    });
    
    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const importedData = JSON.parse(evt.target.result);
                const layers = importedData.layers || (Array.isArray(importedData) ? importedData : null);
                
                if (Array.isArray(layers)) {
                    if (confirm(`Möchtest du ${layers.length} Revier-Elemente importieren? Bestehende Daten bleiben erhalten.`)) {
                        const existing = db.loadLayers();
                        const combined = existing.concat(layers);
                        localStorage.setItem('jagdapp_data', JSON.stringify(combined));
                        location.reload();
                    }
                } else {
                    alert("Ungültiges Datei-Format.");
                }
            } catch(err) {
                console.error("Import error:", err);
                alert("Fehler beim Importieren der Datei. Bitte überprüfe die Datei.");
            }
        };
        reader.readAsText(file);
    });
}

// --- QR-Code & Link Teilen (Ohne Server / Registrierung) ---
const btnQrShare = document.getElementById('btn-qr-share');
const qrModal = document.getElementById('qr-modal');
const closeQrBtn = document.getElementById('close-qr-btn');
const copyShareLinkBtn = document.getElementById('copy-share-link-btn');

if (btnQrShare) {
    btnQrShare.addEventListener('click', () => {
        const layers = db.loadLayers();
        if (!layers || layers.length === 0) {
            alert("Es gibt noch keine Revierdaten zum Teilen. Bitte zeichne zuerst ein Revier auf der Karte.");
            return;
        }
        
        const compactLayers = layers.map(l => ({
            t: l.type,
            n: l.name,
            pt: l.polygonType || l.facilityType || l.pathType,
            ll: l.latlngs || l.latlng
        }));
        
        const jsonStr = JSON.stringify(compactLayers);
        const encoded = btoa(encodeURIComponent(jsonStr));
        const shareUrl = `${location.origin}${location.pathname}#revier=${encoded}`;
        
        if (typeof QRious !== 'undefined') {
            new QRious({
                element: document.getElementById('qr-canvas'),
                value: shareUrl,
                size: 220,
                level: 'L'
            });
        }
        
        qrModal.classList.remove('hidden');
        
        if (copyShareLinkBtn) {
            copyShareLinkBtn.onclick = () => {
                navigator.clipboard.writeText(shareUrl).then(() => {
                    alert("🔗 Teilen-Link wurde in die Zwischenablage kopiert! Du kannst ihn per WhatsApp, Signal oder E-Mail verschicken.");
                }).catch(() => {
                    alert("Sharing-Link: " + shareUrl);
                });
            };
        }
    });
}

if (closeQrBtn && qrModal) {
    closeQrBtn.addEventListener('click', () => {
        qrModal.classList.add('hidden');
    });
}

// Auto-Import beim Öffnen eines Teilen-Links
window.addEventListener('DOMContentLoaded', () => {
    if (location.hash && location.hash.includes('#revier=')) {
        try {
            const raw = location.hash.split('#revier=')[1];
            const jsonStr = decodeURIComponent(atob(raw));
            const compactLayers = JSON.parse(jsonStr);
            
            if (Array.isArray(compactLayers)) {
                const fullLayers = compactLayers.map(c => ({
                    type: c.t,
                    name: c.n,
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    polygonType: c.pt,
                    facilityType: c.pt,
                    pathType: c.pt,
                    latlngs: c.ll,
                    latlng: c.ll
                }));
                
                setTimeout(() => {
                    if (confirm("🔗 Du hast einen Revier-Teilen-Link geöffnet! Möchtest du dieses Revier auf deiner Karte speichern?")) {
                        const existing = db.loadLayers();
                        db.saveLayersForActiveRevier(existing.concat(fullLayers));
                        history.replaceState(null, null, location.pathname);
                        location.reload();
                    }
                }, 600);
            }
        } catch(e) {
            console.error("Error parsing share link:", e);
        }
    }
});

// --- Revier Badge & Admin UI Logic ---
function updateRevierBadgeUI() {
    const titleEl = document.getElementById('active-revier-title');
    const codeEl = document.getElementById('active-revier-code');
    const mobTitleEl = document.getElementById('mobile-revier-title');
    const mobCodeEl = document.getElementById('mobile-revier-code');
    const code = db.getActiveRevierCode();
    
    if (code) {
        const revier = db.getRevier(code);
        const name = revier ? revier.name : 'Revier ' + code;
        if (titleEl) titleEl.textContent = name;
        if (codeEl) codeEl.textContent = 'Code: ' + code;
        if (mobTitleEl) mobTitleEl.textContent = name;
        if (mobCodeEl) mobCodeEl.textContent = 'Code: ' + code;
    } else {
        if (titleEl) titleEl.textContent = 'Kein Revier gewählt';
        if (codeEl) codeEl.textContent = 'Code: ----';
        if (mobTitleEl) mobTitleEl.textContent = 'Kein Revier';
        if (mobCodeEl) mobCodeEl.textContent = 'Code: ----';
    }
}

// --- Mobile Sidebar Drawer & Quick Dock Listeners ---
const sidebarEl = document.getElementById('sidebar');
const mobileBackdrop = document.getElementById('mobile-backdrop');
const mobileToggleMenuBtn = document.getElementById('mobile-toggle-menu-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const mobileDockMenuBtn = document.getElementById('mobile-dock-menu');

const mobileDockMarker = document.getElementById('mobile-dock-marker');
const mobileDockPolyline = document.getElementById('mobile-dock-polyline');
const mobileDockPolygon = document.getElementById('mobile-dock-polygon');

function toggleMobileSidebar(show) {
    if (!sidebarEl) return;
    const isCurrentlyOpen = sidebarEl.classList.contains('mobile-open');
    const shouldOpen = typeof show === 'boolean' ? show : !isCurrentlyOpen;
    
    if (shouldOpen) {
        sidebarEl.classList.add('mobile-open');
        if (mobileBackdrop) mobileBackdrop.classList.remove('hidden');
    } else {
        sidebarEl.classList.remove('mobile-open');
        if (mobileBackdrop) mobileBackdrop.classList.add('hidden');
    }
}

const mapMenuToggleBtn = document.getElementById('map-menu-toggle-btn');

if (mapMenuToggleBtn) mapMenuToggleBtn.addEventListener('click', () => toggleMobileSidebar());
if (mobileToggleMenuBtn) mobileToggleMenuBtn.addEventListener('click', () => toggleMobileSidebar());
if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', () => toggleMobileSidebar(false));
if (mobileBackdrop) mobileBackdrop.addEventListener('click', () => toggleMobileSidebar(false));
if (mobileDockMenuBtn) mobileDockMenuBtn.addEventListener('click', () => toggleMobileSidebar());

if (mobileDockMarker) {
    mobileDockMarker.addEventListener('click', () => {
        if (btnMarker) btnMarker.click();
        toggleMobileSidebar(false);
    });
}
if (mobileDockPolyline) {
    mobileDockPolyline.addEventListener('click', () => {
        if (btnPolyline) btnPolyline.click();
        toggleMobileSidebar(false);
    });
}
if (mobileDockPolygon) {
    mobileDockPolygon.addEventListener('click', () => {
        if (btnPolygon) btnPolygon.click();
        toggleMobileSidebar(false);
    });
}

function loadActiveRevierLayersToMap() {
    if (typeof drawnItems === 'undefined' || !drawnItems) return;
    drawnItems.clearLayers();
    
    const savedData = db.loadLayers();
    let firstPolygonLoaded = false;
    
    savedData.forEach(item => {
        let layer;
        if (item.type === 'polygon') {
            layer = L.polygon(item.latlngs);
            layer.jagdappId = item.id || Date.now().toString() + Math.random().toString(36).substr(2, 5);
            layer.jagdappName = item.name || '';
            layer.jagdappType = item.polygonType || 'Revier';
            if (!firstPolygonLoaded) {
                const center = layer.getBounds().getCenter();
                setTimeout(() => updateHuntingSeasons(center.lat, center.lng), 500);
                firstPolygonLoaded = true;
            }
            if (typeof updatePolygonPopup === 'function') {
                updatePolygonPopup(layer);
            }
        } else if (item.type === 'marker') {
            layer = L.marker(item.latlng);
            layer.jagdappId = item.id || Date.now().toString() + Math.random().toString(36).substr(2, 5);
            layer.jagdappName = item.name || '';
            if (item.facilityType) {
                layer.setIcon(getFacilityIcon(item.facilityType));
                layer.jagdappType = item.facilityType;
            } else {
                layer.jagdappType = 'Unbekannt';
            }
            layer.reservations = item.reservations || [];
            updateMarkerPopup(layer);
        } else if (item.type === 'polyline') {
            layer = L.polyline(item.latlngs);
            layer.jagdappType = item.pathType;
            layer.jagdappName = item.name || '';
            layer.jagdappId = item.id || Date.now().toString() + Math.random().toString(36).substr(2, 5);
            if (item.pathType === 'Pirschweg') {
                layer.setStyle({ color: '#8b4513', dashArray: '5, 10', weight: 3 });
            } else {
                layer.setStyle({ color: '#555', weight: 4 });
            }
            if (typeof updatePathPopup === 'function') {
                updatePathPopup(layer);
            }
        }
        
        if (layer) {
            layer.options.pmIgnore = false;
            drawnItems.addLayer(layer);
            if (typeof bindLayerEvents === 'function') bindLayerEvents(layer);
        }
    });

    if (drawnItems.getLayers().length > 0 && map) {
        try {
            map.fitBounds(drawnItems.getBounds(), { padding: [50, 50], maxZoom: 16 });
        } catch(e) {}
    }
}

// --- Revier Selection Modal Handlers ---
const revierSelectModal = document.getElementById('revier-select-modal');
const btnChangeRevier = document.getElementById('btn-change-revier');
const btnJoinRevier = document.getElementById('btn-join-revier');
const joinCodeInput = document.getElementById('join-code-input');
const btnCreateRevier = document.getElementById('btn-create-revier');
const newRevierNameInput = document.getElementById('new-revier-name');
const btnCloseRevierSelect = document.getElementById('btn-close-revier-select');
const btnTriggerAdminLogin = document.getElementById('btn-trigger-admin-login');

function ensureRevierSelectedOrPrompt() {
    const activeCode = db.getActiveRevierCode();
    if (!activeCode && revierSelectModal) {
        revierSelectModal.classList.remove('hidden');
        if (btnCloseRevierSelect) btnCloseRevierSelect.classList.add('hidden');
    } else if (revierSelectModal) {
        if (btnCloseRevierSelect) btnCloseRevierSelect.classList.remove('hidden');
    }
}

if (btnChangeRevier) {
    btnChangeRevier.addEventListener('click', () => {
        if (revierSelectModal) {
            if (btnCloseRevierSelect) btnCloseRevierSelect.classList.remove('hidden');
            revierSelectModal.classList.remove('hidden');
        }
    });
}

if (btnCloseRevierSelect) {
    btnCloseRevierSelect.addEventListener('click', () => {
        if (db.getActiveRevierCode() && revierSelectModal) {
            revierSelectModal.classList.add('hidden');
        } else {
            alert("Bitte gib zuerst einen Revier-Code ein oder erstelle ein Revier.");
        }
    });
}

if (btnJoinRevier && joinCodeInput) {
    btnJoinRevier.addEventListener('click', () => {
        const code = joinCodeInput.value.trim().toUpperCase();
        if (!code) {
            alert("Bitte gib einen Revier-Code ein.");
            return;
        }
        const revier = db.getRevier(code);
        if (!revier) {
            if (confirm(`Revier mit Code "${code}" existiert noch nicht. Möchtest du es neu anlegen?`)) {
                db.createRevier('Revier ' + code, code);
                loadActiveRevierLayersToMap();
                if (revierSelectModal) revierSelectModal.classList.add('hidden');
            }
        } else {
            db.setActiveRevierCode(code);
            loadActiveRevierLayersToMap();
            if (revierSelectModal) revierSelectModal.classList.add('hidden');
        }
    });
}

if (btnCreateRevier && newRevierNameInput) {
    btnCreateRevier.addEventListener('click', () => {
        const name = newRevierNameInput.value.trim();
        if (!name) {
            alert("Bitte gib einen Namen für das neue Revier ein.");
            return;
        }
        const newRevier = db.createRevier(name);
        alert(`🎉 Revier "${newRevier.name}" erfolgreich erstellt!\nDein Revier-Code lautet: ${newRevier.code}\n\nTeile diesen Code mit deinen Mitjägern.`);
        newRevierNameInput.value = '';
        loadActiveRevierLayersToMap();
        if (revierSelectModal) revierSelectModal.classList.add('hidden');
    });
}

// --- Super-Admin Modal & Dashboard Handlers ---
const adminModal = document.getElementById('admin-modal');
const btnOpenAdminDashboard = document.getElementById('btn-open-admin-dashboard');
const btnCloseAdminDashboard = document.getElementById('btn-close-admin-dashboard');
const adminTableBody = document.getElementById('admin-revier-table-body');
const adminTotalCount = document.getElementById('admin-total-count');
const btnAdminCreateRevier = document.getElementById('btn-admin-create-revier');
const adminNewRevierNameInput = document.getElementById('admin-new-revier-name');
const adminNewRevierCodeInput = document.getElementById('admin-new-revier-code');

function renderAdminDashboard() {
    if (!adminTableBody) return;
    const allReviere = db.getAllReviere();
    const codes = Object.keys(allReviere);
    adminTableBody.innerHTML = '';
    
    if (codes.length === 0) {
        adminTableBody.innerHTML = '<tr><td colspan="5" style="padding: 16px; text-align: center; color: var(--text-muted);">Keine Reviere vorhanden.</td></tr>';
        if (adminTotalCount) adminTotalCount.textContent = 'Gesamt: 0 Reviere';
        return;
    }

    if (adminTotalCount) adminTotalCount.textContent = `Gesamt: ${codes.length} Reviere`;

    codes.forEach(code => {
        const r = allReviere[code];
        const elemCount = r.layers ? r.layers.length : 0;
        const modified = r.lastModified ? new Date(r.lastModified).toLocaleDateString('de-DE') : 'Unbekannt';
        const isActive = code === db.getActiveRevierCode();

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        tr.innerHTML = `
            <td style="padding: 10px; font-weight: bold; color: var(--primary);">${code} ${isActive ? '📌' : ''}</td>
            <td style="padding: 10px; color: white;">${r.name || 'Ohne Namen'}</td>
            <td style="padding: 10px;">${elemCount} Objekte</td>
            <td style="padding: 10px; color: var(--text-muted);">${modified}</td>
            <td style="padding: 10px; text-align: right; white-space: nowrap;">
                <button onclick="window.adminSwitchRevier('${code}')" class="primary-btn" style="width: auto; padding: 4px 8px; font-size: 0.75rem; margin-right: 4px;">👁️ Ansehen</button>
                <button onclick="window.adminDeleteRevier('${code}')" style="width: auto; padding: 4px 8px; font-size: 0.75rem; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">🗑️ Löschen</button>
            </td>
        `;
        adminTableBody.appendChild(tr);
    });
}

if (btnAdminCreateRevier) {
    btnAdminCreateRevier.addEventListener('click', () => {
        const name = adminNewRevierNameInput ? adminNewRevierNameInput.value.trim() : '';
        const customCode = adminNewRevierCodeInput ? adminNewRevierCodeInput.value.trim().toUpperCase() : '';
        
        if (!name) {
            alert("Bitte gib mindestens einen Reviernamen ein.");
            return;
        }

        const newRevier = db.createRevier(name, customCode);
        alert(`✅ Neues Revier erfolgreich angelegt!\nReviername: ${newRevier.name}\nRevier-Code: ${newRevier.code}`);
        if (adminNewRevierNameInput) adminNewRevierNameInput.value = '';
        if (adminNewRevierCodeInput) adminNewRevierCodeInput.value = '';
        renderAdminDashboard();
    });
}

window.adminSwitchRevier = (code) => {
    db.setActiveRevierCode(code);
    loadActiveRevierLayersToMap();
    renderAdminDashboard();
    if (adminModal) adminModal.classList.add('hidden');
};

window.adminDeleteRevier = (code) => {
    if (confirm(`Möchtest du das Revier "${code}" unwiderruflich löschen?`)) {
        db.deleteRevier(code);
        loadActiveRevierLayersToMap();
        renderAdminDashboard();
        ensureRevierSelectedOrPrompt();
    }
};

if (btnOpenAdminDashboard) {
    btnOpenAdminDashboard.addEventListener('click', () => {
        renderAdminDashboard();
        if (adminModal) adminModal.classList.remove('hidden');
    });
}

if (btnCloseAdminDashboard) {
    btnCloseAdminDashboard.addEventListener('click', () => {
        if (adminModal) adminModal.classList.add('hidden');
    });
}

if (btnTriggerAdminLogin) {
    btnTriggerAdminLogin.addEventListener('click', () => {
        if (loginBtn) loginBtn.click();
    });
}

// Initialisiere Revier Badge & lade die Kartendaten beim Start
window.addEventListener('load', () => {
    updateRevierBadgeUI();
    db.getAllReviere(); // Trigger Auto-Migration
    ensureRevierSelectedOrPrompt();
    if (db.getActiveRevierCode()) {
        loadActiveRevierLayersToMap();
    }
});
