import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="flex items-center gap-2 font-bold tracking-wider">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-fd-primary"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M18 12c0 3.31-2.69 6-6 6s-6-2.69-6-6" />
          <path d="M12 2a7 7 0 0 1 7 7" />
          <circle cx="12" cy="12" r="2" />
        </svg>
        ORBIT
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
