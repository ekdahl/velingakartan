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
    document.getElementById('title').textContent = config.title;

    // Initialize theme toggle
    initializeThemeToggle();

    await startApp(config);
  } catch (error) {
    console.error('Boot error:', error);
    document.getElementById('title').textContent = 'Error: ' + error.message;
  }
}

boot();

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
      iconAnchor: [16, 32],
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
          const typ = feature.properties?.typ;
          return L.marker(latlng, {
            icon: getPlaceIcon(typ),
            riseOnHover: true
          });
        },
        onEachFeature: function(feature, layer) {
          if (feature.properties) {
            const props = feature.properties;
            const fromYear = props.fran ?? 'okänt';
            const toYear = props.till ?? 'okänt';
            const popupContent = `
              <strong>${props.namn}</strong><br>
              Typ: ${props.typ}<br>
              År: ${fromYear}-${toYear}
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

function initializeThemeToggle() {
  const themeToggle = document.getElementById('themeToggle');
  const htmlElement = document.documentElement;

  // Load saved theme or default to auto
  const savedTheme = localStorage.getItem('theme') || 'auto';
  setTheme(savedTheme);

  // Handle dropdown item clicks
  const attachListeners = () => {
    document.querySelectorAll('.dropdown-item[data-theme]').forEach(item => {
      // Remove existing listeners to avoid duplicates
      item.removeEventListener('click', handleThemeClick);
      item.addEventListener('click', handleThemeClick);
    });
  };

  const handleThemeClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const selectedTheme = e.currentTarget.dataset.theme;
    setTheme(selectedTheme);

    const dropdownInstance = bootstrap.Dropdown.getInstance(themeToggle);
    if (dropdownInstance) {
      dropdownInstance.hide();
    }
  };

  // Attach listeners immediately and after a short delay to ensure DOM is ready
  attachListeners();
  setTimeout(attachListeners, 100);

  function setTheme(theme) {
    localStorage.setItem('theme', theme);
    let actualTheme;

    if (theme === 'auto') {
      actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      actualTheme = theme;
    }

    htmlElement.setAttribute('data-bs-theme', actualTheme);
    updateThemeIcon(theme);

    // Listen for system theme changes when in auto mode
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e) => {
        const newActualTheme = e.matches ? 'dark' : 'light';
        htmlElement.setAttribute('data-bs-theme', newActualTheme);
      };

      // Remove existing listener to avoid duplicates
      mediaQuery.removeEventListener('change', handleChange);
      mediaQuery.addEventListener('change', handleChange);
    }
  }
}

function updateThemeIcon(theme) {
  const themeToggle = document.getElementById('themeToggle');
  const iconClass = theme === 'auto' ? 'bi-circle-half' : theme === 'dark' ? 'bi-moon-fill' : 'bi-sun-fill';
  const text = theme === 'auto' ? 'Auto' : theme.charAt(0).toUpperCase() + theme.slice(1);

  themeToggle.innerHTML = `<i class="bi ${iconClass}"></i>`;
  themeToggle.setAttribute('aria-label', `Theme: ${text}`);
  themeToggle.title = text;
}