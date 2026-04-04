import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { socket } from '../../services/socketClient.js';

export default function LiveMapScreen() {
  const [busLocation, setBusLocation] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const childBusId = 'bus-123';

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tracking Bus: {childBusId}</Text>
        <Text style={styles.status}>
          {isConnected ? '🟢 Live Connection' : '🔴 Reconnecting...'}
        </Text>
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          Web fallback mode: native map is unavailable in browser. Live coordinates are shown below.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.text}>Connection: {isConnected ? '🟢 Live' : '🔴 Reconnecting...'}</Text>
        
        {busLocation ? (
          <>
            <Text style={styles.text}>Latitude: {busLocation.lat}</Text>
            <Text style={styles.text}>Longitude: {busLocation.lng}</Text>
            <Text style={styles.text}>Last Updated: {new Date(busLocation.timestamp).toLocaleTimeString()}</Text>
          </>
        ) : (
          <Text style={styles.text}>Waiting for bus to start moving...</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: 'white',
    alignItems: 'center',
    zIndex: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  status: {
    fontSize: 14,
    marginTop: 5,
    color: 'gray',
  },
  notice: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    marginHorizontal: 20,
  },
  noticeText: { color: '#1d4ed8' },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 10, elevation: 3 },
  text: { fontSize: 16, marginBottom: 10 },
});