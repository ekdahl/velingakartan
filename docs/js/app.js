async function boot() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
    return;
  }

  try {
    // Construct config path that works both locally and on GitHub Pages
    // Get the directory containing index.html and fetch config.json from there
    const configPath = new URL('config.json', document.location).href;
    
    const response = await fetch(configPath);
    if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`);
    const config = await response.json();

    document.title = config.title;

    await startApp(config);
  } catch (error) {
    console.error('Boot error:', error);
  }
}

boot();

// Handle Bootstrap modal backdrop in fullscreen mode
const modalEl = document.getElementById('placeModal');
if (modalEl) {
  modalEl.addEventListener('show.bs.modal', () => {
    if (document.fullscreenElement) {
      // wait one tick so Bootstrap has created the backdrop
      setTimeout(() => {
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
          document.fullscreenElement.appendChild(backdrop);
        }
      }, 0);
    }
  });
}

async function startApp(config) {
  // Initialize the Leaflet map with center and zoom from config
  const map = L.map('map').setView(config.mapCenter, config.mapZoom);

  const layerList = [];

  // Add layers from config
  if (config.mapLayers && Array.isArray(config.mapLayers)) {
    config.mapLayers.forEach(layerCfg => {
      const layer = createLayer(layerCfg);
      const layerName = layerCfg.name || layerCfg.id || 'Unnamed';

      layerList.push({ name: layerName, layer, config: layerCfg });

      // Add to map if visible
      if (layerCfg.visible) {
        layer.addTo(map);
      }
    });
  }

  // Add built-in Leaflet layer control
  const baseLayers = {};
  const overlayLayers = {};
  
  layerList.forEach(({ name, layer }) => {
    overlayLayers[name] = layer;
  });

  const placeIconMap = {
    'kyrka': 'church.svg',
    'backstuga': 'house.svg',
    'torp': 'house-chimney.svg',
    'gård': 'building-wheat.svg',
    'skola': 'school.svg'
  };

  function getPlaceIcon(type) {
    const normalizedType = (type || '').toString().trim().toLowerCase();
    const iconFile = placeIconMap[normalizedType] || 'house.svg';
    if (!placeIconMap[normalizedType]) {
      console.warn(`Unknown place type for icon mapping: '${type}'`);
    }
    return L.icon({
      iconUrl: new URL(`img/map-markers/${iconFile}`, document.location).href,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -32]
    });
  }
  
  // Load and add GeoJSON places
  try {
    const geojsonPath = new URL('geojson/places.geojson', document.location).href;
    const geojsonResponse = await fetch(geojsonPath);
    if (geojsonResponse.ok) {
      const geojsonData = await geojsonResponse.json();
      const placesLayer = L.geoJSON(geojsonData, {
        pointToLayer: function(feature, latlng) {
          const type = feature.properties?.typ;
          return L.marker(latlng, {
            icon: getPlaceIcon(type),
            riseOnHover: true
          });
        },
        onEachFeature: function(feature, layer) {
          if (feature.properties) {
            const props = feature.properties;
            const popupContent = `
              <strong>${props.name}</strong><br>
              Typ: ${props.type ?? ''}<br>
              Skylt finns: ${props.hasSign ? 'Ja' : 'Nej'}<br>
               ${props.hasText ? `<a href="#" class="open-place-modal" data-folder="${props.folder}" data-title="${props.name}">Läs mer</a>` : ''}
            `;
            layer.bindPopup(popupContent);
          }
        }
      });
      overlayLayers['Platser'] = placesLayer;
      placesLayer.addTo(map);
    }
  } catch (error) {
    console.warn('Could not load GeoJSON:', error);
  }
  
  L.control.layers(baseLayers, overlayLayers, { position: 'topright' }).addTo(map);
  L.control.locate().addTo(map);
  map.addControl(new L.Control.FullScreen());

  return map;
}

function createLayer(cfg) {
  switch (cfg.type) {
    case "xyz":
      return L.tileLayer(
        cfg.url,
        cfg.options ?? {}
      );

    case "wms":
      return L.tileLayer.wms(
        cfg.url,
        cfg.options ?? {}
      );

    default:
      throw new Error(`Unknown layer type: ${cfg.type}`);
  }
}

async function openPlaceModal(title, folder) {
  try {
    const path = new URL(`places/${folder}/text.html`, document.location).href;

    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}`);
    }

    const html = await response.text();

    document.getElementById('placeModalTitle').textContent = title;
    document.getElementById('placeModalBody').innerHTML = html;

    const modal = new bootstrap.Modal(
      document.getElementById('placeModal')
    );
    modal.show();

  } catch (err) {
    console.error(err);
    document.getElementById('placeModalBody').innerHTML =
      '<p>Could not load information.</p>';
  }
}

document.addEventListener('click', async function (e) {
  const link = e.target.closest('.open-place-modal');
  if (!link) return;

  e.preventDefault();

  await openPlaceModal(
    link.dataset.title,
    link.dataset.folder
  );
});

// Stop map interactions when modal is open to prevent conflicts
modalEl.addEventListener('show.bs.modal', () => {
  map.dragging.disable();
  map.touchZoom.disable();
  map.scrollWheelZoom.disable();
  map.doubleClickZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();
});

modalEl.addEventListener('hidden.bs.modal', () => {
  map.dragging.enable();
  map.touchZoom.enable();
  map.scrollWheelZoom.enable();
  map.doubleClickZoom.enable();
  map.boxZoom.enable();
  map.keyboard.enable();
});
