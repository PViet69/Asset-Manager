import type { SVGProps } from "react";

interface ProviderLogoProps extends SVGProps<SVGSVGElement> {
  provider: string;
  size?: number;
  className?: string;
}

export function GoogleDriveLogo({ size = 24, className, ...props }: Omit<ProviderLogoProps, "provider">): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 87.3 78"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Google Drive"
      {...props}
    >
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

export function DropboxLogo({ size = 24, className, ...props }: Omit<ProviderLogoProps, "provider">): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Dropbox"
      {...props}
    >
      <path d="M6 2L0 6.5L6 11L12 6.5L6 2Z" fill="#0061FF" />
      <path d="M18 2L12 6.5L18 11L24 6.5L18 2Z" fill="#0061FF" />
      <path d="M0 15.5L6 20L12 15.5L6 11L0 15.5Z" fill="#0061FF" />
      <path d="M24 15.5L18 11L12 15.5L18 20L24 15.5Z" fill="#0061FF" />
      <path d="M6 21.25L12 17L18 21.25L12 25.5L6 21.25Z" transform="translate(0, -2.5) scale(1, 0.9)" fill="#0061FF" />
    </svg>
  );
}

export function ProviderLogo({ provider, size = 24, className, ...props }: ProviderLogoProps): JSX.Element {
  const normalized = provider.toLowerCase().replace(/[\s-]/g, "_");

  if (normalized === "google_drive" || normalized === "googledrive" || normalized === "gdrive") {
    return <GoogleDriveLogo size={size} className={className} {...props} />;
  }

  if (normalized === "dropbox") {
    return <DropboxLogo size={size} className={className} {...props} />;
  }

  // Fallback cloud storage icon for generic or unknown providers
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label={`${provider} storage provider`}
      {...props}
    >
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}
