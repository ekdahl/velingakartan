let map;

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
  map = L.map('map').setView(config.mapCenter, config.mapZoom);

  const baseLayers = {};
  const overlayLayers = {};

  function addConfiguredLayers(layerConfigs, targetGroup) {
    layerConfigs.forEach(layerCfg => {
      const layer = createLayer(layerCfg);
      const layerName = layerCfg.name || layerCfg.id || 'Unnamed';

      targetGroup[layerName] = layer;

      if (layerCfg.visible) {
        layer.addTo(map);
      }
    });
  }

  // Preferred format: separate lists for mutually exclusive base maps and stackable overlays.
  const configuredBaseLayers = Array.isArray(config.baseLayers) ? config.baseLayers : [];
  const configuredOverlayLayers = Array.isArray(config.overlays) ? config.overlays : [];

  addConfiguredLayers(configuredBaseLayers, baseLayers);
  addConfiguredLayers(configuredOverlayLayers, overlayLayers);

  const defaultPlaceIconConfig = {
    file: 'house.svg',
    iconAnchor: [16, 16],
    popupAnchor: [0, -32]
  };

  function normalizePlaceTypeKey(type) {
    if (!type) return '';

    return type
      .toString()
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  const configuredPlaceTypes = Array.isArray(config.placeTypes) ? config.placeTypes : [];

  const placeTypeLabelMap = configuredPlaceTypes.reduce((labelMap, placeType) => {
    const typeKey = normalizePlaceTypeKey(placeType?.type ?? placeType?.name);
    if (!typeKey) {
      return labelMap;
    }

    labelMap[typeKey] = placeType?.layerName ?? placeType?.name ?? placeType?.type ?? typeKey;
    return labelMap;
  }, {});

  const placeIconMap = configuredPlaceTypes
    ? configuredPlaceTypes.reduce((iconMap, placeType) => {
        const typeKey = normalizePlaceTypeKey(placeType?.type ?? placeType?.name);
        const markerFile = placeType?.placeMarker;
        if (!typeKey || !markerFile) {
          return iconMap;
        }

        const iconConfig = { file: markerFile };
        if (Array.isArray(placeType.iconAnchor)) {
          iconConfig.iconAnchor = placeType.iconAnchor;
        }
        if (Array.isArray(placeType.popupAnchor)) {
          iconConfig.popupAnchor = placeType.popupAnchor;
        }

        iconMap[typeKey] = iconConfig;
        return iconMap;
      }, {})
    : {};

  function toMarkerClassSuffix(type) {
    if (!type) return 'default';

    return normalizePlaceTypeKey(type)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default';
  }

  const markerSvgMap = await loadMarkerSvgMap(placeIconMap, defaultPlaceIconConfig);

  async function loadMarkerSvgMap(iconMap, defaultIconConfig) {
    const files = [
      ...new Set([
        ...Object.values(iconMap).map(iconCfg => iconCfg.file),
        defaultIconConfig.file
      ])
    ];

    const entries = await Promise.all(files.map(async file => {
      const markerPath = new URL(`img/map-markers/${file}`, document.location).href;
      try {
        const markerResponse = await fetch(markerPath);
        if (!markerResponse.ok) {
          throw new Error(`Could not fetch marker ${file}: ${markerResponse.status}`);
        }

        const markerSvg = await markerResponse.text();
        return [file, markerSvg];
      } catch (error) {
        console.warn(`Could not inline SVG marker '${file}', using image fallback.`, error);
        return [file, null];
      }
    }));

    return Object.fromEntries(entries);
  }

  function getPlaceIcon(type) {
    const normalizedType = normalizePlaceTypeKey(type);
    const iconConfig = {
      ...defaultPlaceIconConfig,
      ...(placeIconMap[normalizedType] || {})
    };
    if (type && !placeIconMap[normalizedType]) {
      console.warn(`Unknown place type for icon mapping: '${type}'`);
    }

    const iconAnchor = Array.isArray(iconConfig.iconAnchor)
      ? iconConfig.iconAnchor
      : defaultPlaceIconConfig.iconAnchor;
    const popupAnchor = Array.isArray(iconConfig.popupAnchor)
      ? iconConfig.popupAnchor
      : [0, -iconAnchor[1]];
    const inlineSvg = markerSvgMap[iconConfig.file];
    const markerClassName = `place-marker--${toMarkerClassSuffix(normalizedType)}`;

    if (inlineSvg) {
      return L.divIcon({
        html: `<span class="place-marker__icon" aria-hidden="true">${inlineSvg}</span>`,
        className: `place-marker ${markerClassName}`,
        iconSize: [32, 32],
        iconAnchor,
        popupAnchor
      });
    }

    return L.icon({
      iconUrl: new URL(`img/map-markers/${iconConfig.file}`, document.location).href,
      iconSize: [32, 32],
      iconAnchor,
      popupAnchor
    });
  }
  
  // Load and add GeoJSON places
  try {
    const geojsonPath = new URL('geojson/places.geojson', document.location).href;
    const geojsonResponse = await fetch(geojsonPath);
    if (geojsonResponse.ok) {
      const geojsonData = await geojsonResponse.json();
      const allFeatures = Array.isArray(geojsonData?.features) ? geojsonData.features : [];

      configuredPlaceTypes.forEach(placeType => {
        const typeKey = normalizePlaceTypeKey(placeType?.type ?? placeType?.name);
        if (!typeKey) {
          return;
        }

        const typeFeatures = allFeatures.filter(feature => {
          const featureTypeKey = normalizePlaceTypeKey(feature?.properties?.type);
          return featureTypeKey === typeKey;
        });

        if (!typeFeatures.length) {
          return;
        }

        const placesLayer = L.geoJSON(
          {
            type: 'FeatureCollection',
            features: typeFeatures
          },
          {
            pointToLayer: function(feature, latlng) {
              const type = feature.properties?.type;
              const marker = L.marker(latlng, {
                icon: getPlaceIcon(type),
                riseOnHover: true,
                title: feature.properties?.name ?? undefined
              });

              if (feature.properties?.id != null) {
                marker.bindTooltip(String(feature.properties.id));
              }
              return marker;
            },
            onEachFeature: function(feature, layer) {
              if (feature.properties) {
                const props = feature.properties;
                const placeTitle = props.id != null ? `${props.id} - ${props.name}` : props.name;
                const popupContent = `
                  <strong>${placeTitle}</strong><br>
                  Typ: ${props.type ?? ''}<br>
                  Skylt finns: ${props.hasSign ? 'Ja' : 'Nej'}<br>
                   ${props.hasText ? `<a href="#" class="open-place-modal" data-folder="${props.folder}" data-title="${placeTitle}">Läs mer</a>` : ''}
                `;
                layer.bindPopup(popupContent);
              }
            }
          }
        );

        const overlayLabel = placeTypeLabelMap[typeKey] || (placeType?.name ?? placeType?.type ?? typeKey);
        overlayLayers[overlayLabel] = placesLayer;
        placesLayer.addTo(map);
      });
    }
  } catch (error) {
    console.warn('Could not load GeoJSON:', error);
  }
  
  L.control.layers(baseLayers, overlayLayers, { position: 'topright' }).addTo(map);
  L.control.locate({
    strings: {
        popup: (data) => `
            You are within ${data.distance} ${data.unit} from this point
            <br><br>
            ${data.lat}, ${data.lng} &nbsp;
            <button onclick="navigator.clipboard.writeText('${data.lat},${data.lng}')">Copy</button>
        `
    }
}).addTo(map);
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
