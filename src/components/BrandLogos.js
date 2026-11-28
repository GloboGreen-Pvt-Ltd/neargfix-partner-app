// Brand-coloured contact logos (WhatsApp, Gmail, phone call) for support rows.
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

export function WhatsAppLogo({ size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </Svg>
  );
}

export function GmailLogo({ size = 24 }) {
  return (
    <Svg width={size} height={(size * 42) / 52} viewBox="0 0 52 42">
      <Path fill="#4285F4" d="M3.6 42h8.4V21.6L0 12.6v25.8C0 40.4 1.6 42 3.6 42z" />
      <Path fill="#34A853" d="M40 42h8.4c2 0 3.6-1.6 3.6-3.6V12.6l-12 9z" />
      <Path fill="#FBBC04" d="M40 6v15.6l12-9V7.8c0-4.4-5.1-7-8.6-4.3z" />
      <Path fill="#EA4335" d="M12 21.6V6l14 10.5L40 6v15.6L26 32.1z" />
      <Path fill="#C5221F" d="M0 7.8v4.8l12 9V6L8.6 3.5C5.1.8 0 3.4 0 7.8z" />
    </Svg>
  );
}

// Phone-app style: green rounded square with a white handset.
export function CallLogo({ size = 24 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.26, backgroundColor: '#34A853', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="call" size={size * 0.6} color="#FFFFFF" />
    </View>
  );
}
