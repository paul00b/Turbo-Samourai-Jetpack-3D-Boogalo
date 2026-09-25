/**
 * Adresse du relais : l'ancien défaut « même hôte, port 8787 » resté enregistré dans les navigateurs
 * ne doit pas masquer un relais configuré au build (VITE_NET_URL), et l'erreur de connexion doit dire
 * la bonne chose selon que le relais est local ou hébergé à part.
 */
import { describe, expect, it } from 'vitest';
import { resolveSavedNetUrl } from '../src/io/settings';
import { connectionHint, isLocalRelay } from '../src/net/session';

const VERCEL_LEGACY = 'wss://turbo-samourai-jetpack-3-d-boogalo.vercel.app:8787';
const RELAY = 'wss://tsj-relais.onrender.com';

describe('adresse du relais enregistrée', () => {
  it('un relais configuré au build remplace l\'ancien défaut automatique', () => {
    expect(resolveSavedNetUrl(VERCEL_LEGACY, RELAY, VERCEL_LEGACY)).toBeNull();
  });

  it('sans relais configuré, l\'adresse enregistrée est gardée (dev, LAN)', () => {
    expect(resolveSavedNetUrl('ws://localhost:8787', '', 'ws://localhost:8787')).toBe('ws://localhost:8787');
  });

  it('une adresse choisie à la main est toujours gardée', () => {
    expect(resolveSavedNetUrl('wss://mon-relais.example', RELAY, VERCEL_LEGACY)).toBe('wss://mon-relais.example');
    expect(resolveSavedNetUrl('ws://192.168.1.67:8787', RELAY, VERCEL_LEGACY)).toBe('ws://192.168.1.67:8787');
  });

  it('une valeur invalide est ignorée', () => {
    expect(resolveSavedNetUrl('http://x', RELAY, VERCEL_LEGACY)).toBeNull();
    expect(resolveSavedNetUrl(42, RELAY, VERCEL_LEGACY)).toBeNull();
  });
});

describe('message de connexion impossible', () => {
  it('reconnaît un relais local ou du réseau local', () => {
    for (const url of ['ws://localhost:8787', 'ws://127.0.0.1:8787', 'ws://[::1]:8787', 'ws://192.168.1.67:8787', 'ws://10.0.0.4:8787', 'ws://tsj.local:8787']) {
      expect(isLocalRelay(url), url).toBe(true);
    }
    for (const url of [VERCEL_LEGACY, RELAY, 'pas une url']) expect(isLocalRelay(url), url).toBe(false);
  });

  it('en local il pense au relais éteint, en ligne au relais non hébergé', () => {
    expect(connectionHint('ws://localhost:8787')).toContain('npm run server');
    const online = connectionHint(VERCEL_LEGACY);
    expect(online).not.toContain('npm run server');
    expect(online).toContain('VITE_NET_URL');
  });
});
