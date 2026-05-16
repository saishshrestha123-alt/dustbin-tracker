/* ================================================================
   DUSTBIN LOCATION TRACKER — Node.js Backend Server
   ================================================================
   Receives GPS + fill level data from ESP32 via GPRS.
   Serves the web dashboard and exposes a REST API.

   SETUP (run these commands in the project folder):
     npm install express cors
     node server.js

   API ENDPOINTS:
   ──────────────────────────────────────────────────────────────
   GET /
     Serves the index.html web dashboard

   GET /api/location?lat=27.7&lon=85.3&fill=73
     Called by ESP32 to submit new sensor data.
     Parameters:
       lat  (required) - GPS latitude  (-90 to 90)
       lon  (required) - GPS longitude (-180 to 180)
       fill (optional) - Fill level 0–100. Defaults to last value.
     Response: { status: "ok", received: { lat, lon, fill, timestamp, updates } }

   GET /api/get-location
     Called by the browser every 5 seconds to refresh the dashboard.
     Response: { status: "ok", lat, lon, fill, timestamp, updates }
              or { status: "waiting" } if no data received yet

   TESTING WITHOUT ESP32 (open in browser):
     http://localhost:3000/api/location?lat=27.7172&lon=85.3240&fill=65
   ================================================================
*/

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());                                  // Allow all CORS origins
app.use(express.json());                          // Parse JSON bodies
app.use(express.urlencoded({ extended: true }));  // Parse query strings

// ── In-Memory Data Store ───────────────────────────────────────
// Stores only the most recent data point (one dustbin).
// For multiple bins, you would use a Map keyed by bin ID.
let latestData = {
  lat:       null,   // Latitude  (float)
  lon:       null,   // Longitude (float)
  fill:      null,   // Fill level 0–100 (integer)
  timestamp: null,   // ISO 8601 datetime string
  updates:   0,      // Running count of successful updates
};

// ================================================================
//  ROUTE 1: Receive sensor data from ESP32
//  GET /api/location?lat=27.7&lon=85.3&fill=73
// ================================================================
app.get('/api/location', (req, res) => {
  const { lat, lon, fill } = req.query;

  // ── Validate required fields ─────────────────────────────
  if (!lat || !lon) {
    console.warn('[API] ✗ Missing lat or lon in request');
    return res.status(400).json({
      error: 'Both lat and lon query parameters are required',
      example: '/api/location?lat=27.7172&lon=85.3240&fill=50'
    });
  }

  const parsedLat  = parseFloat(lat);
  const parsedLon  = parseFloat(lon);
  const parsedFill = (fill !== undefined && fill !== '') ? parseInt(fill, 10) : null;

  // ── Validate coordinate ranges ────────────────────────────
  if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
    return res.status(400).json({ error: `Invalid latitude: ${lat}. Must be -90 to 90.` });
  }
  if (isNaN(parsedLon) || parsedLon < -180 || parsedLon > 180) {
    return res.status(400).json({ error: `Invalid longitude: ${lon}. Must be -180 to 180.` });
  }

  // ── Validate fill level ───────────────────────────────────
  // If fill is provided but invalid, keep the last known value.
  // This handles the case where GPS is sent but ultrasonic fails.
  let validFill;
  if (parsedFill !== null && !isNaN(parsedFill)) {
    validFill = Math.min(100, Math.max(0, parsedFill));  // Clamp 0–100
  } else {
    validFill = latestData.fill;  // Keep last known fill level
    if (fill !== undefined) {
      console.warn(`[API] ⚠ Invalid fill value "${fill}" — keeping last: ${validFill}%`);
    }
  }

  // ── Store the data ────────────────────────────────────────
  latestData = {
    lat:       parsedLat,
    lon:       parsedLon,
    fill:      validFill,
    timestamp: new Date().toISOString(),
    updates:   latestData.updates + 1,
  };

  // ── Console log with visual fill bar ─────────────────────
  const bars    = validFill !== null ? Math.round(validFill / 10) : 0;
  const fillBar = '█'.repeat(bars) + '░'.repeat(10 - bars);
  const fillTag = validFill === null   ? '⬛ NO DATA'
                : validFill >= 90      ? '🔴 CRITICAL'
                : validFill >= 70      ? '🟠 HIGH'
                : validFill >= 40      ? '🟡 MEDIUM'
                :                       '🟢 LOW';

  console.log(
    `\n[UPDATE #${latestData.updates}] ${latestData.timestamp}` +
    `\n  GPS  → lat: ${parsedLat.toFixed(5)}, lon: ${parsedLon.toFixed(5)}` +
    `\n  Fill → [${fillBar}] ${validFill ?? '—'}% ${fillTag}`
  );

  // ── Respond to ESP32 ─────────────────────────────────────
  // ESP32 checks for HTTP 200 to confirm success.
  return res.status(200).json({
    status:   'ok',
    received: latestData,
  });
});

// ================================================================
//  ROUTE 2: Serve latest data to the web dashboard
//  GET /api/get-location
// ================================================================
app.get('/api/get-location', (req, res) => {
  // No data received yet (server just started)
  if (latestData.lat === null) {
    return res.status(200).json({
      status:  'waiting',
      message: 'No data received yet. Make sure the ESP32 is powered on and has GPRS signal.',
      lat:     null,
      lon:     null,
      fill:    null,
    });
  }

  // Return the latest data
  return res.status(200).json({
    status:    'ok',
    lat:       latestData.lat,
    lon:       latestData.lon,
    fill:      latestData.fill,
    timestamp: latestData.timestamp,
    updates:   latestData.updates,
  });
});

// ================================================================
//  ROUTE 3: Serve the frontend HTML dashboard
//  GET /
// ================================================================
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.status(404).send(`
      <h2>index.html not found</h2>
      <p>Place <code>index.html</code> in the same folder as <code>server.js</code></p>
      <p>Current folder: <code>${__dirname}</code></p>
    `);
  }
});

// ================================================================
//  ROUTE 4: Health check (useful for cloud deployments)
//  GET /health
// ================================================================
app.get('/health', (req, res) => {
  res.json({
    status:     'running',
    uptime_sec: Math.floor(process.uptime()),
    updates:    latestData.updates,
    last_seen:  latestData.timestamp,
  });
});

// ================================================================
//  START THE SERVER
// ================================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Dustbin Tracker — Node.js Server               ║');
  console.log('║   ESP32 + SIM808 + HC-SR04                       ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Web Dashboard  →  http://localhost:${PORT}`);
  console.log(`  Health Check   →  http://localhost:${PORT}/health`);
  console.log();
  console.log('  Test without ESP32 (paste in browser):');
  console.log(`  http://localhost:${PORT}/api/location?lat=27.7172&lon=85.3240&fill=65`);
  console.log();
  console.log('  Waiting for data from ESP32...');
});
