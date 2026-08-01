import React from 'react';
import { PrismBackground } from './PrismBackground';

const HUE_BY_ACCENT: Record<string, number> = {
  emerald: -0.38,
  blue: -0.72,
  pink: 0.48,
  violet: 0.18,
  amber: -1.12,
  cyan: -0.56,
};

export const AppAtmosphere: React.FC<{ accent: string }> = ({ accent }) => (
  <div className="app-atmosphere" aria-hidden="true">
    <PrismBackground
      className="app-prism"
      intensity={0.88}
      speed={0.11}
      hueShift={HUE_BY_ACCENT[accent] ?? -0.38}
      interactive={false}
    />
    <div className="app-atmosphere-shade" />
  </div>
);
