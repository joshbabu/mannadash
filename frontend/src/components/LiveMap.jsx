import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet's default marker icons reference image files that don't resolve correctly through
// Vite's bundler — build simple colored circle markers instead, avoiding that whole problem.
function coloredIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function LiveMap({ riderPosition, destination }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const riderMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);

  // Initialize the map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const center = riderPosition || destination;
    const map = L.map(mapContainerRef.current, { zoomControl: false }).setView([center.lat, center.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    destMarkerRef.current = L.marker([destination.lat, destination.lng], { icon: coloredIcon('#e4572e') }).addTo(map);

    if (riderPosition) {
      riderMarkerRef.current = L.marker([riderPosition.lat, riderPosition.lng], { icon: coloredIcon('#4c7a52') }).addTo(map);
    }

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the rider marker (and pan to keep both pins visible) whenever a fresh position arrives —
  // without rebuilding the whole map
  useEffect(() => {
    if (!mapRef.current || !riderPosition) return;

    if (riderMarkerRef.current) {
      riderMarkerRef.current.setLatLng([riderPosition.lat, riderPosition.lng]);
    } else {
      riderMarkerRef.current = L.marker([riderPosition.lat, riderPosition.lng], { icon: coloredIcon('#4c7a52') }).addTo(mapRef.current);
    }

    const bounds = L.latLngBounds(
      [riderPosition.lat, riderPosition.lng],
      [destination.lat, destination.lng],
    );
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [riderPosition, destination]);

  return <div ref={mapContainerRef} style={{ height: 220, borderRadius: 16, overflow: 'hidden' }} />;
}
