const paths = {
  sidebar: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M8 4v12" />
    </>
  ),
  chat: (
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 11.5v-6Z" />
  ),
  tasks: (
    <>
      <path d="M8 6h8M8 10h8M8 14h8" />
      <path d="M4 6h.01M4 10h.01M4 14h.01" />
    </>
  ),
  memory: (
    <>
      <path d="M5 3.5h10v13l-5-3-5 3v-13Z" />
    </>
  ),
  activity: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.5 1.5" />
    </>
  ),
  file: (
    <>
      <path d="M5.5 3h6l3.5 3.5v10.5h-9.5v-14Z" />
      <path d="M11.5 3v3.5h3.5" />
    </>
  ),
  folder: (
    <path d="M2.75 5.75c0-.83.67-1.5 1.5-1.5h4l1.6 1.7h5.9c.83 0 1.5.67 1.5 1.5v7.3c0 .83-.67 1.5-1.5 1.5h-11c-.83 0-1.5-.67-1.5-1.5v-9Z" />
  ),
  chevron: <path d="M6 8l4 4 4-4" />,
  send: <path d="M10 15.5V4.5M5.5 9 10 4.5 14.5 9" />,
  stop: <rect x="6" y="6" width="8" height="8" rx="1.5" />,
  speaker: (
    <>
      <path d="M3.5 8v4h3l4 3.5v-11l-4 3.5z" />
      <path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9" />
    </>
  ),
  mic: (
    <>
      <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
      <path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5.25" />
      <path d="m13 13 3.5 3.5" />
    </>
  ),
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  more: (
    <>
      <circle cx="5" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="15" cy="10" r="1.2" />
    </>
  ),
  pencil: <path d="M4.5 15.5l.8-3.2 7.7-7.7a1.6 1.6 0 0 1 2.3 2.3l-7.7 7.7-3.1.9z" />,
  screen: (
    <>
      <rect x="3" y="4" width="14" height="9.5" rx="1.5" />
      <path d="M7.5 16.5h5M10 13.5v3" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6h11M8 6V4.5h4V6" />
      <path d="M6 6l.7 9.2c.06.73.67 1.3 1.4 1.3h3.8c.73 0 1.34-.57 1.4-1.3L14 6" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
