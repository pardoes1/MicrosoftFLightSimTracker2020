// app.js - client-side code for MSFS Flight Tracker
// Connects to a server (WebSocket preferred, falls back to HTTP polling) that provides JSON flight state.

let map, aircraftMarker, aircraftIcon, pathPolyline, altitudeChart;
let aiMarkers = {};
let updateTimer = null;
let ws = null;
let pathLatLngs = [];

// DOM elements
const els = {};

function $(id) { return document.getElementById(id); }

function init() {
  // grab elements
  [
    'aircraftType','callsign','altitude','speed','heading','latitude','longitude','onGround',
    'connectBtn','clearBtn','showAiTraffic','trafficRange','rangeValue','aiTrafficList',
    'zoomIn','zoomOut','locateMe','altitudeChart','totalFlights','totalDistance','maxAltitude','maxSpeed',
    'mapTheme','updateInterval','serverUrl'
  ].forEach(id => els[id] = $(id));

  initMap();
  initChart();
  bindUi();
}

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 6);
  setMapTheme(els.mapTheme.value);

  aircraftIcon = L.icon({
    iconUrl: 'data:image/svg+xml;utf8,<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1"><path d="M2 12 L22 12 M12 2 L12 22" stroke="rgba(0,0,0,0.2)"/></svg>',
    iconSize: [36,36],
    iconAnchor: [18,18]
  });

  pathPolyline = L.polyline([], { color: 'red' }).addTo(map);
}

function setMapTheme(theme) {
  const tileLayers = {
    light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    dark: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
    satellite: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
  };
  const attribution = '&copy; OpenStreetMap contributors';

  // remove existing tile layer(s)
  map.eachLayer(layer => {
    if (layer && layer.options && layer.options.maxZoom) map.removeLayer(layer);
  });

  L.tileLayer(tileLayers[theme] || tileLayers.light, { maxZoom: 19, attribution }).addTo(map);
}

function initChart() {
  const ctx = document.getElementById('altitudeChart').getContext('2d');
  altitudeChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Altitude (ft)', data: [], borderColor: 'rgb(75, 192, 192)', tension: 0.2 }] },
    options: { scales: { x: { display: false }, y: { beginAtZero: true } } }
  });
}

function bindUi() {
  els.connectBtn.addEventListener('click', onConnectClicked);
  els.clearBtn.addEventListener('click', clearMap);
  els.showAiTraffic.addEventListener('change', () => renderAiList());
  els.trafficRange.addEventListener('input', (e) => { els.rangeValue.textContent = e.target.value; renderAiList(); });
  els.zoomIn.addEventListener('click', () => map.zoomIn());
  els.zoomOut.addEventListener('click', () => map.zoomOut());
  els.locateMe.addEventListener('click', locateAircraft);
  els.mapTheme.addEventListener('change', (e) => setMapTheme(e.target.value));
}

function onConnectClicked() {
  const url = els.serverUrl.value.trim();
  if (!url) return alert('Enter a server URL first');

  // Close previous connections
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }

  // Try WebSocket first
  tryConnectWebSocket(url).catch(() => {
    // fallback to HTTP polling
    startPollingHttp(url);
  });
}

async function tryConnectWebSocket(url) {
  return new Promise((resolve, reject) => {
    let wsUrl;
    try {
      const u = new URL(url);
      wsUrl = (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host + (u.pathname.endsWith('/') ? u.pathname.slice(0,-1) : u.pathname) + '/ws';
    } catch (err) {
      reject(err);
      return;
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.info('WebSocket connected to', wsUrl);
      els.connectBtn.textContent = 'Connected (WS)';
      resolve();
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        handleUpdate(data);
      } catch (e) { console.warn('Invalid WS data', e); }
    };

    ws.onclose = () => {
      console.info('WebSocket closed, falling back to HTTP');
      els.connectBtn.textContent = 'Connect to MSFS';
      reject(new Error('ws closed'));
    };

    ws.onerror = (e) => {
      console.warn('WebSocket error', e);
      try { ws.close(); } catch (e) {}
      ws = null;
      reject(e);
    };
  });
}

function startPollingHttp(url) {
  const base = url.replace(/\/$/, '');
  const interval = Math.max(100, parseInt(els.updateInterval.value) || 1000);
  els.connectBtn.textContent = 'Connected (HTTP)';

  // Do an immediate fetch and then interval
  fetchFlight(base).then(data => { if (data) handleUpdate(data); else console.info('No data yet'); });
  updateTimer = setInterval(() => fetchFlight(base).then(data => { if (data) handleUpdate(data); }), interval);
}

async function fetchFlight(base) {
  const endpoints = ['/api/flight','/api/state','/flight','/state','/data'];
  for (const p of endpoints) {
    try {
      const res = await fetch(base + p);
      if (!res.ok) continue;
      const data = await res.json();
      return data;
    } catch (e) {
      // try next
    }
  }
  return null;
}

function handleUpdate(data) {
  // expected fields: aircraftType, callsign, altitude, speed, heading, latitude, longitude, onGround, aiTraffic:[]
  if (!data) return;

  if (data.aircraftType) els.aircraftType.textContent = data.aircraftType;
  if (data.callsign) els.callsign.textContent = data.callsign;
  if (typeof data.altitude !== 'undefined') els.altitude.textContent = Math.round(data.altitude);
  if (typeof data.speed !== 'undefined') els.speed.textContent = Math.round(data.speed);
  if (typeof data.heading !== 'undefined') els.heading.textContent = Math.round(data.heading);
  if (typeof data.latitude !== 'undefined') els.latitude.textContent = data.latitude.toFixed(6);
  if (typeof data.longitude !== 'undefined') els.longitude.textContent = data.longitude.toFixed(6);
  if (typeof data.onGround !== 'undefined') els.onGround.textContent = data.onGround ? 'Yes' : 'No';

  if (typeof data.latitude !== 'undefined' && typeof data.longitude !== 'undefined') {
    updateAircraftPosition([data.latitude, data.longitude], data.heading);
    addPathPoint([data.latitude, data.longitude], data.altitude);
  }

  if (data.aiTraffic && Array.isArray(data.aiTraffic)) {
    updateAiTraffic(data.aiTraffic);
  }

  // basic stats (best-effort)
  if (typeof data.totalFlights !== 'undefined') els.totalFlights.textContent = data.totalFlights;
  if (typeof data.totalDistance !== 'undefined') els.totalDistance.textContent = data.totalDistance;
  if (typeof data.maxAltitude !== 'undefined') els.maxAltitude.textContent = data.maxAltitude;
  if (typeof data.maxSpeed !== 'undefined') els.maxSpeed.textContent = data.maxSpeed;
}

function updateAircraftPosition(latlng, heading) {
  if (!aircraftMarker) {
    aircraftMarker = L.marker(latlng, { icon: aircraftIcon, rotationAngle: heading || 0 }).addTo(map);
    map.setView(latlng);
  } else {
    aircraftMarker.setLatLng(latlng);
    if (aircraftMarker.setRotationAngle) aircraftMarker.setRotationAngle(heading || 0);
  }
}

function addPathPoint(latlng, altitude) {
  pathLatLngs.push(latlng);
  pathPolyline.setLatLngs(pathLatLngs);

  // update chart
  const time = new Date().toLocaleTimeString();
  altitudeChart.data.labels.push(time);
  altitudeChart.data.datasets[0].data.push(altitude || 0);
  if (altitudeChart.data.labels.length > 60) {
    altitudeChart.data.labels.shift();
    altitudeChart.data.datasets[0].data.shift();
  }
  altitudeChart.update();
}

function clearMap() {
  pathLatLngs = [];
  pathPolyline.setLatLngs([]);
  if (aircraftMarker) { map.removeLayer(aircraftMarker); aircraftMarker = null; }
  // remove AI markers
  Object.values(aiMarkers).forEach(m => { try { map.removeLayer(m); } catch(e){} });
  aiMarkers = {};
  // reset chart
  altitudeChart.data.labels = [];
  altitudeChart.data.datasets[0].data = [];
  altitudeChart.update();
  els.connectBtn.textContent = 'Connect to MSFS';
}

function updateAiTraffic(list) {
  // list items: {id, callsign, lat, lon, heading, altitude, distance}
  const show = els.showAiTraffic.checked;
  const maxRangeNm = parseFloat(els.trafficRange.value) || 100;

  // top-level list in sidebar
  els.aiTrafficList.innerHTML = '';

  list.forEach(ai => {
    const id = ai.id || ai.callsign || `${ai.lat}_${ai.lon}`;
    const dist = typeof ai.distance !== 'undefined' ? ai.distance : null;
    if (dist !== null && dist > maxRangeNm) return; // skip

    // add/refresh marker
    if (aiMarkers[id]) {
      aiMarkers[id].setLatLng([ai.lat, ai.lon]);
    } else {
      const m = L.circleMarker([ai.lat, ai.lon], { radius: 6, color: '#3388ff' }).addTo(map);
      aiMarkers[id] = m;
    }

    // list entry
    const el = document.createElement('div');
    el.className = 'traffic-entry';
    el.textContent = `${ai.callsign || 'AI'} — ${Math.round(ai.distance||0)} nm`;
    els.aiTrafficList.appendChild(el);
  });

  // show/hide markers
  Object.values(aiMarkers).forEach(m => { if (show) { if (!map.hasLayer(m)) map.addLayer(m); } else { if (map.hasLayer(m)) map.removeLayer(m); } });
}

function renderAiList() {
  // no-op, UI updates when new data arrives. We keep this for compatibility.
}

function locateAircraft() {
  if (aircraftMarker) map.setView(aircraftMarker.getLatLng(), Math.max(map.getZoom(), 8));
}

// If user hasn't got a server running, provide a local simulator toggle (developer convenience)
let simTimer = null;
function startLocalSimulation() {
  if (simTimer) return;
  let lat = 51.505, lon = -0.09, heading = 90, alt = 2000, speed = 120;
  simTimer = setInterval(() => {
    // simple straight-line motion
    const d = speed * (1/3600); // degrees per second approx (very rough)
    lon += 0.01 * Math.cos(heading*Math.PI/180);
    lat += 0.01 * Math.sin(heading*Math.PI/180);
    alt += (Math.random()-0.5)*20;
    const data = { aircraftType: 'Cessna 172', callsign: 'SIM123', altitude: alt, speed, heading, latitude: lat, longitude: lon, onGround: false, aiTraffic: [ { callsign: 'AI01', lat: lat+0.05, lon: lon+0.03, distance: 25 } ] };
    handleUpdate(data);
  }, 1000);
}

function stopLocalSimulation() { if (simTimer) { clearInterval(simTimer); simTimer = null; } }

// initialize on load
window.addEventListener('DOMContentLoaded', init);
