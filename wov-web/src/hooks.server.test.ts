/**
 * Karte D1: ein Host, den nginx nicht kennt, faellt in `handle()` auf
 * world-of-mmorpg.com zurueck, bevor irgendeine Seite daraus eine absolute
 * Adresse baut. Auf `origin/main` gab es diese Weiche nicht — jeder Host
 * waere unveraendert durchgereicht worden.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';

function fakeEvent(url: string): RequestEvent {
  return { url: new URL(url) } as unknown as RequestEvent;
}

async function aufgeloesterHost(event: RequestEvent): Promise<string> {
  let gesehen = '';
  await handle({
    event,
    resolve: async (e) => {
      gesehen = e.url.host;
      return new Response('');
    },
  });
  return gesehen;
}

describe('handle(): unbekannter Host faellt auf world-of-mmorpg.com zurueck', () => {
  it('laesst world-of-mmorpg.com und .de unangetastet', async () => {
    expect(await aufgeloesterHost(fakeEvent('https://world-of-mmorpg.com/de/saga'))).toBe(
      'world-of-mmorpg.com',
    );
    expect(await aufgeloesterHost(fakeEvent('https://world-of-mmorpg.de/de/saga'))).toBe(
      'world-of-mmorpg.de',
    );
  });

  it('laesst die Uebergangsdomain world-of-vikings.com unangetastet', async () => {
    expect(await aufgeloesterHost(fakeEvent('https://world-of-vikings.com/de/saga'))).toBe(
      'world-of-vikings.com',
    );
  });

  it('ersetzt einen fremden Host durch world-of-mmorpg.com', async () => {
    expect(await aufgeloesterHost(fakeEvent('https://evil.example/de/saga'))).toBe(
      'world-of-mmorpg.com',
    );
  });

  it('nimmt einen erfundenen Port am fremden Host mit weg', async () => {
    expect(await aufgeloesterHost(fakeEvent('https://evil.example:1234/de/saga'))).toBe(
      'world-of-mmorpg.com',
    );
  });
});
