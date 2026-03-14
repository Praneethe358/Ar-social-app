/**
 * geo.js — Day-3 GPS utilities
 *
 * Provides:
 *  - getGPSLocation()        Promise-based wrapper around navigator.geolocation
 *  - haversineDistance()     Distance (metres) between two GPS coordinates
 *  - isWithinRadius()        Boolean check: is a post within N metres of user?
 */

/* ─────────────────────────────────────────────
   Haversine Formula
   Returns the distance in METRES between two
   GPS coordinates on the surface of the Earth.
   ───────────────────────────────────────────── */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6_371_000; // Earth's radius in metres

  // Convert degrees → radians
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // distance in metres
}

/* ─────────────────────────────────────────────
   Radius check
   ───────────────────────────────────────────── */
export function isWithinRadius(userLat, userLon, postLat, postLon, radiusMetres = 50) {
  // If the post is missing GPS data (legacy), hide it so it doesn't spawn globally
  if (!postLat || !postLon) return false;
  const dist = haversineDistance(userLat, userLon, postLat, postLon);
  return dist <= radiusMetres;
}

/* ─────────────────────────────────────────────
   GPS to AR Local Coordinate Offset Math
   Because a user might open their camera far
   away from the origin point of a post, we must
   translate the global GPS distance into an 
   X (East-West) and Z (North-South) offset 
   relative to their current camera!
   ───────────────────────────────────────────── */
export function calculateGPSOffset(userLat, userLon, postLat, postLon, localPosition) {
  // If no GPS on the post, return its original position
  if (!postLat || !postLon) return localPosition;

  // Approximate meters per degree formulas
  // Latitude is roughly 111,111 meters per degree everywhere.
  // Longitude scaling depends on the Cosine of the Latitude.
  const latMid = (userLat + postLat) / 2;
  const metersPerLat = 111111;
  const metersPerLon = 111111 * Math.cos((latMid * Math.PI) / 180);

  // Calculate physical distance in meters East and North
  const metersEast = (postLon - userLon) * metersPerLon;
  const metersNorth = (postLat - userLat) * metersPerLat;

  // WebXR coordinates:
  // +X is Right (East), -Z is Forward (North)
  // We apply this physical meter offset to the original local coordinates!
  return {
    x: localPosition.x + metersEast,
    y: localPosition.y, // Keep the same height (assuming roughly flat terrain)
    z: localPosition.z - metersNorth // WebXR Z axis goes negative forward (North)
  };
}

/* ─────────────────────────────────────────────
   Get GPS location — Promise wrapper
   Resolves with { latitude, longitude, accuracy }
   Rejects with a user-friendly error string.
   ───────────────────────────────────────────── */
export function getGPSLocation(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject('GPS not supported on this device.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  pos.coords.accuracy, // metres
        });
      },
      (err) => {
        // Map browser error codes to readable messages
        const messages = {
          1: 'Location permission denied. Please allow location access.',
          2: 'Location unavailable. Try again outdoors.',
          3: 'Location request timed out. Try again.',
        };
        reject(messages[err.code] || `GPS error: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout:            10_000, // 10 seconds
        maximumAge:         30_000, // use cached position up to 30 s old
        ...options,
      }
    );
  });
}

/* ─────────────────────────────────────────────
   Watch GPS (continuous updates)
   Returns a watchId — call clearWatch(id) to stop.
   ───────────────────────────────────────────── */
export function watchGPS(onUpdate, onError) {
  if (!navigator.geolocation) {
    onError?.('GPS not supported on this device.');
    return null;
  }

  return navigator.geolocation.watchPosition(
    (pos) => onUpdate({
      latitude:  pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy:  pos.coords.accuracy,
    }),
    (err) => onError?.(`GPS watch error: ${err.message}`),
    { enableHighAccuracy: true, maximumAge: 15_000 }
  );
}

export function clearGPSWatch(watchId) {
  if (watchId !== null && watchId !== undefined) {
    navigator.geolocation.clearWatch(watchId);
  }
}
