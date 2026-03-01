import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="font-bold text-lg">
        🛸 Orbit
      </span>
    ),
  },
  links: [
    {
      text: 'GitHub',
      url: 'https://github.com/drewpayment/orbit',
      external: true,
    },
  ],
};
