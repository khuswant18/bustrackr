import React, { useEffect, useMemo, useState } from 'react';
import { socket } from '../../services/socketClient.js';

export default function LiveMapScreen() {
  const [busLocation, setBusLocation] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [mapLib, setMapLib] = useState(null);
  const childBusId = 'bus-123';

  const defaultCenter = useMemo(() => [28.6139, 77.209], []);
  const currentCenter = useMemo(() => {
    if (!busLocation) {
      return defaultCenter;
    }

    return [busLocation.lat, busLocation.lng];
  }, [busLocation, defaultCenter]);

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

      delete leaflet.Icon.Default.prototype._getIconUrl;
      leaflet.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (mounted) {
        setMapLib({ ...reactLeaflet });
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
      setBusLocation(data);
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
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('live-location-update', onLiveLocationUpdate);
    };
  }, []);

  if (!mapLib) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Tracking Bus: {childBusId}</h1>
        <p style={styles.status}>{isConnected ? 'Live Connection' : 'Reconnecting...'}</p>
        <div style={styles.card}>Loading browser map...</div>
      </div>
    );
  }

  const { MapContainer, Marker, Popup, TileLayer } = mapLib;

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Tracking Bus: {childBusId}</h1>
      <p style={styles.status}>{isConnected ? 'Live Connection' : 'Reconnecting...'}</p>

      <div style={styles.mapWrap}>
        <MapContainer 
          key={`${currentCenter[0]}-${currentCenter[1]}`}
          center={currentCenter}
          zoom={14}
          style={styles.map}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {busLocation ? (
            <Marker position={[busLocation.lat, busLocation.lng]}>
              <Popup>
                <div>
                  <strong>Bus {childBusId}</strong>
                  <br />
                  Lat: {busLocation.lat.toFixed(6)}
                  <br />
                  Lng: {busLocation.lng.toFixed(6)}
                </div>
              </Popup>
            </Marker>
          ) : null}
        </MapContainer>
      </div>

      <div style={styles.card}>
        {busLocation ? (
          <>
            <p style={styles.text}>Latitude: {busLocation.lat}</p>
            <p style={styles.text}>Longitude: {busLocation.lng}</p>
            <p style={styles.text}>Last Updated: {new Date(busLocation.timestamp).toLocaleTimeString()}</p>
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
