import React, { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../../services/socketClient.js';
import busIconImage from '../../images/bus.png';

export default function LiveMapScreen() {
  const [targetLocation, setTargetLocation] = useState(null);
  const [displayLocation, setDisplayLocation] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [mapLib, setMapLib] = useState(null);
  const [busIcon, setBusIcon] = useState(null);
  const animationFrameRef = useRef(null);
  const displayLocationRef = useRef(null);
  const childBusId = 'bus-123';

  const defaultCenter = useMemo(() => [28.6139, 77.209], []);

  useEffect(() => {
    let mounted = true;

    const loadMapLibraries = async () => {
      if (typeof window === 'undefined') {
        return;
      }

      const stylesheetId = 'leaflet-stylesheet';
      if (!document.getElementById(stylesheetId)) {
        const link = document.createElement('link');
        link.id = stylesheetId;
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      const leaflet = await import('leaflet');
      const reactLeaflet = await import('react-leaflet');
      const resolvedBusIconUrl = typeof busIconImage === 'string'
        ? busIconImage
        : (busIconImage?.src || busIconImage?.uri);

      delete leaflet.Icon.Default.prototype._getIconUrl;
      leaflet.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const customBusIcon = leaflet.icon({
        iconUrl: resolvedBusIconUrl,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -18],
      });

      if (mounted) {
        setMapLib({ ...reactLeaflet });
        setBusIcon(customBusIcon);
      }
    };

    loadMapLibraries();

    return () => {
      mounted = false; 
    }; 
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true);
      socket.emit('track-bus', childBusId);
    };

    const onDisconnect = () => setIsConnected(false);

    const onLiveLocationUpdate = (data) => {
      const nextLocation = {
        lat: data.lat,
        lng: data.lng,
        timestamp: data.timestamp,
      };

      setRoutePath((prev) => {
        const updated = [...prev, [nextLocation.lat, nextLocation.lng]];
        return updated.length > 250 ? updated.slice(updated.length - 250) : updated;
      });

      setTargetLocation(nextLocation);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('live-location-update', onLiveLocationUpdate);

    if (!socket.connected) {
      socket.connect();
    } else {
      onConnect();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('live-location-update', onLiveLocationUpdate);
    };
  }, []);

  useEffect(() => {
    displayLocationRef.current = displayLocation;
  }, [displayLocation]);

  useEffect(() => {
    if (!targetLocation) {
      return;
    }

    if (!displayLocationRef.current) {
      setDisplayLocation(targetLocation);
      return;
    }

    const from = { lat: displayLocationRef.current.lat, lng: displayLocationRef.current.lng };
    const to = { lat: targetLocation.lat, lng: targetLocation.lng };
    const durationMs = 2400;
    let animationStart;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const animate = (timestamp) => {
      if (!animationStart) {
        animationStart = timestamp;
      }

      const elapsed = timestamp - animationStart;
      const t = Math.min(1, elapsed / durationMs);
      const eased = t < 0.5 ? 2 * t * t : 1 - (Math.pow(-2 * t + 2, 2) / 2);
      const lat = from.lat + ((to.lat - from.lat) * eased);
      const lng = from.lng + ((to.lng - from.lng) * eased);

      setDisplayLocation({ lat, lng, timestamp: targetLocation.timestamp });

      if (t < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [targetLocation]);

  if (!mapLib) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Tracking Bus: {childBusId}</h1>
        <p style={styles.status}>{isConnected ? 'Live Connection' : 'Reconnecting...'}</p>
        <div style={styles.card}>Loading browser map...</div>
      </div>
    );
  }

  const { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } = mapLib;

  function RecenterOnLocation({ position }) {
    const map = useMap();

    useEffect(() => {
      if (!position) {
        return;
      }

      map.setView(position, map.getZoom(), { animate: true });
    }, [map, position]);

    return null;
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Tracking Bus: {childBusId}</h1>
      <p style={styles.status}>{isConnected ? 'Live Connection' : 'Reconnecting...'}</p>

      <div style={styles.mapWrap}>
        <MapContainer 
          center={defaultCenter}
          zoom={14}
          style={styles.map}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <RecenterOnLocation position={displayLocation ? [displayLocation.lat, displayLocation.lng] : null} />

          {routePath.length > 1 ? (
            <Polyline
              positions={routePath}
              pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.9 }}
            />
          ) : null}

          {displayLocation ? (
            <Marker position={[displayLocation.lat, displayLocation.lng]} icon={busIcon || undefined}>
              <Popup>
                <div>
                  <strong>Bus {childBusId}</strong>
                  <br />
                  Lat: {displayLocation.lat.toFixed(6)}
                  <br />
                  Lng: {displayLocation.lng.toFixed(6)}
                </div>
              </Popup>
            </Marker>
          ) : null}
        </MapContainer>
      </div>

      <div style={styles.card}>
        {displayLocation ? (
          <>
            <p style={styles.text}>Latitude: {displayLocation.lat}</p>
            <p style={styles.text}>Longitude: {displayLocation.lng}</p>
            <p style={styles.text}>Last Updated: {new Date(displayLocation.timestamp).toLocaleTimeString()}</p>
          </>
        ) : (
          <p style={styles.text}>Waiting for bus to start moving...</p>
        )}
      </div>
    </div>
  );
} 

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f5f7fb',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '24px',
  },
  status: {
    margin: 0,
    color: '#555',
  },
  mapWrap: {
    width: '100%',
    maxWidth: '960px',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.12)',
  },
  map: {
    width: '100%',
    height: '60vh',
    minHeight: '380px',
  },
  card: {
    width: '100%',
    maxWidth: '960px',
    borderRadius: '10px',
    background: '#fff',
    padding: '14px 16px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.08)',
  },
  text: {
    margin: '4px 0',
  },
};
