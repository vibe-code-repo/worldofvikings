/**
 * Website entry point.
 *
 * The page itself is static HTML; this module only applies the shared design
 * tokens and points the Play button at the configured game URL, so that a
 * production build links to live.world-of-vikings.com instead of localhost.
 */
import { tokens } from '@wov/ui';

const root = document.documentElement;
root.style.setProperty('background', tokens.colorBackground);
root.style.setProperty('color', tokens.colorText);

const play = document.querySelector<HTMLAnchorElement>('[data-testid="play-link"]');
if (play) {
  play.style.background = tokens.colorAccent;
  play.style.color = tokens.colorBackground;
  const gameUrl = import.meta.env['VITE_GAME_URL'];
  if (typeof gameUrl === 'string' && gameUrl.length > 0) {
    play.href = gameUrl;
  }
}
