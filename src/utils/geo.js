export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const toRad = deg => (deg * Math.PI) / 180;
  
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
            
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

export function getGPSLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject('Geolocation not supported on this device.');
      return;
    }
    
    // 1. GPS LOCATION: GET CURRENT POS
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

/**
 * calculateGPSOffset(userLoc, postLoc, localPos)
 * Translates the difference in GPS into a meter offset in AR space.
 * This ensures that if you start your AR session in a different spot,
 * the emoji stays physically in the same place.
 */
export function calculateGPSOffset(userLat, userLng, postLat, postLng, originalPos) {
  // Approximate meters per degree formulas
  const metersPerLat = 111111;
  const metersPerLon = 111111 * Math.cos((userLat * Math.PI) / 180);

  const dx = (postLng - userLng) * metersPerLon;
  const dz = (postLat - userLat) * metersPerLat;

  // In A-Frame/WebXR:
  // +X is Right (East), -Z is Forward (North)
  return {
    x: originalPos.x + dx,
    y: originalPos.y, 
    z: originalPos.z - dz // dz is North, North is -Z
  };
}

