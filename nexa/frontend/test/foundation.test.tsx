import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PageTransition from '../src/motion/PageTransition';
import Skeleton from '../src/ui/Skeleton';
import Globe3D from '../src/three/Globe3D';
import { isLand } from '../src/three/landMask';
import { getStoredTheme, applyTheme } from '../src/theme';

describe('TypeScript foundation', () => {
  it('PageTransition renders its children inside <main>', () => {
    render(<PageTransition routeKey="feed" className="main-col"><p>hello</p></PageTransition>);
    const main = screen.getByRole('main');
    expect(main.className).toBe('main-col');
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('Skeleton is an accessible status region with the requested lines', () => {
    const { container } = render(<Skeleton lines={4} label="Loading feed" />);
    expect(screen.getByRole('status', { name: 'Loading feed' })).toBeTruthy();
    expect(container.querySelectorAll('.tw-h-4').length).toBe(4);
  });

  it('Globe3D shows a 🌍 fallback when WebGL is unavailable (jsdom)', async () => {
    const { container } = render(<Globe3D size={100} />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('canvas')).toBeNull();
    expect(await screen.findByText('🌍')).toBeTruthy();
  });

  it('land map knows the real world', () => {
    expect(isLand(28.6, 77.2)).toBe(true);     // Delhi
    expect(isLand(-33.9, 151.2)).toBe(true);   // Sydney
    expect(isLand(40.7, -74)).toBe(true);      // New York
    expect(isLand(0, -30)).toBe(false);        // mid-Atlantic
    expect(isLand(-30, -140)).toBe(false);     // South Pacific
  });

  it('theme module is typed and round-trips', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(getStoredTheme()).toBe('dark');
    expect(applyTheme('light')).toBe('light');
  });
});
