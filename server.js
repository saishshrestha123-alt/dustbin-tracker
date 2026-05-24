const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let latestData = {
  lat:       null,
  lon:       null,
  fill:      null,
  timestamp: null,
  updates:   0,
};

// ================================================================
//  ROUTE 1: Receive data from ESP32
//  GET /api/location?lat=27.7&lon=85.3&fill=73
// ================================================================
app.get('/api/location', (req, res) => {
  const { lat, lon, fill } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({
      error: 'lat and lon are required',
      example: '/api/location?lat=27.7172&lon=85.3240&fill=50'
    });
  }

  const parsedLat  = parseFloat(lat);
  const parsedLon  = parseFloat(lon);
  const parsedFill = (fill !== undefined && fill !== '') ? parseInt(fill, 10) : null;

  if (isNaN(parsedLat) || parsedLat < -90  || parsedLat > 90)  return res.status(400).json({ error: 'Invalid latitude'  });
  if (isNaN(parsedLon) || parsedLon < -180 || parsedLon > 180) return res.status(400).json({ error: 'Invalid longitude' });

  let validFill = latestData.fill;
  if (parsedFill !== null && !isNaN(parsedFill)) {
    validFill = Math.min(100, Math.max(0, parsedFill));
  }

  latestData = {
    lat:       parsedLat,
    lon:       parsedLon,
    fill:      validFill,
    timestamp: new Date().toISOString(),
    updates:   latestData.updates + 1,
  };

  const bars    = validFill !== null ? Math.round(validFill / 10) : 0;
  const fillBar = '█'.repeat(bars) + '░'.repeat(10 - bars);
  const fillTag = validFill === null ? '⬛ NO DATA'
                : validFill >= 90   ? '🔴 CRITICAL'
                : validFill >= 70   ? '🟠 HIGH'
                : validFill >= 40   ? '🟡 MEDIUM'
                :                    '🟢 LOW';

  console.log(
    `\n[UPDATE #${latestData.updates}] ${latestData.timestamp}` +
    `\n  GPS  → lat: ${parsedLat.toFixed(5)}, lon: ${parsedLon.toFixed(5)}` +
    `\n  Fill → [${fillBar}] ${validFill ?? '—'}% ${fillTag}`
  );

  return res.status(200).json({ status: 'ok', received: latestData });
});

// ================================================================
//  ROUTE 2: Send latest data to dashboard
//  GET /api/get-location
// ================================================================
app.get('/api/get-location', (req, res) => {
  if (latestData.lat === null) {
    return res.status(200).json({
      status:  'waiting',
      message: 'No data yet. Make sure ESP32 is on with GPRS signal.',
      lat: null, lon: null, fill: null,
    });
  }
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
//  ROUTE 3: Serve dashboard
//  GET /
// ================================================================
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.status(404).send(`
      <h2>index.html not found</h2>
      <p>Place index.html in the same folder as server.js</p>
    `);
  }
});

// ================================================================
//  ROUTE 4: Health check
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
//  START SERVER
// ================================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Dustbin Tracker — Node.js Server               ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Dashboard  → http://localhost:${PORT}`);
  console.log(`  Health     → http://localhost:${PORT}/health`);
  console.log(`  Test URL   → http://localhost:${PORT}/api/location?lat=27.7172&lon=85.3240&fill=65`);
  console.log();
  console.log('  Waiting for ESP32 data...');
});
