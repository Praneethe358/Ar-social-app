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
      pos => resolve({ 
        lat: pos.coords.latitude, 
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy 
      }),
      err => reject(err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

/**
 * calculateGPSOffset(userLat, userLng, postLat, postLng, originalPos, initialHeading)
 * Translates GPS difference into a COMPASS-ALIGNED meter offset.
 */
export function calculateGPSOffset(userLat, userLng, postLat, postLng, originalPos, headingDeg = 0) {
  const metersPerLat = 111111;
  const metersPerLon = 111111 * Math.cos((userLat * Math.PI) / 180);

  // Raw physical distance from user to post's origin GPS
  const dx = (postLng - userLng) * metersPerLon;
  const dz = (postLat - userLat) * metersPerLat;

  // Convert Heading to Radians (Heading is degrees clockwise from North)
  const rad = (headingDeg * Math.PI) / 180;
  
  // Rotate the (dx, dz) vector by the negative heading to align with AR space
  // A-Frame: -Z is North if heading=0. 
  // If user faces East (90), we rotate everything -90 deg.
  const rotatedX = dx * Math.cos(rad) - dz * Math.sin(rad);
  const rotatedZ = dx * Math.sin(rad) + dz * Math.cos(rad);

  return {
    x: originalPos.x + rotatedX,
    y: originalPos.y, 
    z: originalPos.z - rotatedZ // North is -Z
  };
}


